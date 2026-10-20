import { transaction } from "./db.js";
import { distributeWaiting, event } from "./messages.js";
export function startWorkers(
  db,
  mailService,
  ruleService,
  senderService,
  { intervalMs = 5000 } = {},
) {
  let stopped = false;
  const busy = { poll: false, rules: false, send: false },
    active = new Set();
  async function run(name, fn) {
    if (stopped || busy[name]) return;
    busy[name] = true;
    try {
      await fn();
    } catch (e) {
      console.error("Worker " + name + ":", e.code || e.name);
    } finally {
      busy[name] = false;
    }
  }
  async function rules() {
    const job = await transaction(db, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM dispatch_jobs WHERE (state IN ('pending','retry') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return;
      await c.query(
        "UPDATE dispatch_jobs SET state='running',attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() WHERE message_id=$1",
        [row.message_id],
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) return;
    try {
      const result = await ruleService.process(
        job.organization_id,
        job.message_id,
      );
      await db.query(
        "UPDATE dispatch_jobs SET state=$1,lease_until=NULL,last_error=NULL,updated_at=now() WHERE message_id=$2 AND state='running'",
        [result.cancelled ? "cancelled" : "done", job.message_id],
      );
    } catch (e) {
      await db.query(
        "UPDATE dispatch_jobs SET state=$1,last_error=$2,lease_until=NULL,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE message_id=$3 AND state='running'",
        [
          job.attempts < 3 ? "retry" : "failed",
          e.code || "DISPATCH_ERROR",
          job.message_id,
        ],
      );
      await event(
        db,
        job.organization_id,
        job.message_id,
        { type: "system" },
        "dispatch_failed",
        { reason: e.code || "DISPATCH_ERROR" },
      );
    }
  }
  function tick() {
    for (const [name, fn] of [
      [
        "poll",
        async () => {
          await mailService.pollDue();
          await distributeWaiting(db);
        },
      ],
      ["rules", rules],
      [
        "send",
        async () => {
          await senderService?.processDue();
        },
      ],
    ]) {
      const p = run(name, fn);
      active.add(p);
      p.finally(() => active.delete(p));
    }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await Promise.allSettled([...active]);
  };
}
