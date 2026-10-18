import { transaction } from "./db.js";
import { getContext } from "./context.js";
import {
  event,
  requireSkill,
  classifyMessage,
  distributeWaiting,
} from "./messages.js";
export function createAiRunner(db, ollama) {
  let busy = false;
  return {
    async run(fn) {
      if (busy)
        throw Object.assign(
          new Error("Modelul procesează deja un mesaj. Așteaptă finalizarea."),
          { status: 409 },
        );
      busy = true;
      let lock,
        held = false;
      try {
        lock = await db.connect();
        held = (
          await lock.query("SELECT pg_try_advisory_lock(73412002) AS locked")
        ).rows[0].locked;
        if (!held)
          throw Object.assign(new Error("Modelul este deja în lucru."), {
            status: 409,
          });
        return await fn();
      } finally {
        try {
          if (held) await lock.query("SELECT pg_advisory_unlock(73412002)");
        } finally {
          lock?.release();
          busy = false;
        }
      }
    },
    async process(org, id) {
      const m = (
        await db.query(
          "SELECT * FROM messages WHERE organization_id=$1 AND id=$2",
          [org, id],
        )
      ).rows[0];
      if (!m || m.tag_source === "human" || m.status !== "Nou" || m.assigned_to)
        return { cancelled: true };
      const skills = (
        await db.query(
          "SELECT id,name FROM skills WHERE organization_id=$1 ORDER BY name",
          [org],
        )
      ).rows;
      if (!skills.length || skills.length > 60)
        throw Object.assign(new Error("Configurează competențele"), {
          code: "AI_SKILL_CONFIG",
        });
      const examples = await getContext(db, org, m.subject, m.body, id);
      const classification = await ollama.classify({
        subject: m.subject.slice(0, 1000),
        body: m.body.slice(0, 6000),
        skills,
        examples,
      });
      return transaction(db, async (c) => {
        await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          org,
        ]);
        const current = (
          await c.query(
            "SELECT * FROM messages WHERE id=$1 AND organization_id=$2 FOR UPDATE",
            [id, org],
          )
        ).rows[0];
        if (current.body !== m.body)
          throw Object.assign(
            new Error("Email actualizat în timpul clasificării"),
            { code: "AI_INPUT_CHANGED" },
          );
        if (
          current.tag_source === "human" ||
          current.status !== "Nou" ||
          current.assigned_to
        ) {
          await event(
            c,
            org,
            id,
            { type: "system" },
            "classification_discarded",
            { reason: "human_or_workflow_change" },
          );
          return { cancelled: true };
        }
        await requireSkill(c, org, classification.skillId);
        await c.query(
          "UPDATE messages SET skill_id=$1,updated_at=now() WHERE id=$2",
          [classification.skillId, id],
        );
        await classifyMessage(c, { org, type: "system" }, id, {
          ...classification,
          exampleRefs: examples.map((e) => ({ id: e.id, source: e.source })),
          inputTruncated: m.body.length > 6000,
        });
        return { classification };
      });
    },
  };
}
export function startWorkers(
  db,
  mailService,
  aiRunner,
  { intervalMs = 5000 } = {},
) {
  let stopped = false,
    polling = false,
    processing = false;
  const active = new Set();
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      await mailService.pollDue();
      await distributeWaiting(db);
    } catch (e) {
      console.error("Mail worker:", e.code || e.name);
    } finally {
      polling = false;
    }
  }
  async function process() {
    if (stopped || processing) return;
    processing = true;
    try {
      await aiRunner.run(async () => {
        const job = await transaction(db, async (c) => {
          const row = (
            await c.query(
              "SELECT * FROM processing_jobs WHERE ((state IN ('pending','retry') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now())) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1",
            )
          ).rows[0];
          if (!row) return null;
          await c.query(
            "UPDATE processing_jobs SET state='running',attempts=attempts+1,lease_until=now()+interval '15 minutes',updated_at=now() WHERE message_id=$1",
            [row.message_id],
          );
          return { ...row, attempts: row.attempts + 1 };
        });
        if (!job) return;
        try {
          const result = await aiRunner.process(
            job.organization_id,
            job.message_id,
          );
          await db.query(
            "UPDATE processing_jobs SET state=$1,lease_until=NULL,last_error=NULL,updated_at=now() WHERE message_id=$2 AND state='running'",
            [result.cancelled ? "cancelled" : "done", job.message_id],
          );
        } catch (e) {
          const code = e.code || "AI_PROCESSING";
          const retry =
            [
              "OLLAMA_UNAVAILABLE",
              "OLLAMA_HTTP",
              "AI_SKILL_CONFIG",
              "AI_INPUT_CHANGED",
            ].includes(code) && job.attempts < 3;
          await db.query(
            "UPDATE processing_jobs SET state=$1,lease_until=NULL,last_error=$2,next_attempt_at=now()+make_interval(secs=>$3),updated_at=now() WHERE message_id=$4 AND state='running'",
            [
              retry ? "retry" : "failed",
              code,
              Math.min(300, 30 * 2 ** job.attempts),
              job.message_id,
            ],
          );
          await event(
            db,
            job.organization_id,
            job.message_id,
            { type: "system" },
            "classification_failed",
            { reason: code, retryScheduled: retry },
          );
        }
      });
    } catch (e) {
      if (e.status !== 409) console.error("AI worker:", e.code || e.name);
    } finally {
      processing = false;
    }
  }
  function track(p) {
    active.add(p);
    p.finally(() => active.delete(p));
  }
  const timer = setInterval(() => {
    track(poll());
    track(process());
  }, intervalMs);
  timer.unref();
  track(poll());
  track(process());
  return async () => {
    stopped = true;
    clearInterval(timer);
    await Promise.allSettled([...active]);
  };
}
