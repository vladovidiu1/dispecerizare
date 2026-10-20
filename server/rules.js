import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { eligibleAgent, event, requireSkill } from "./messages.js";
export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    priority: z.number().int().min(1).max(10000).default(100),
    enabled: z.boolean().default(false),
    matchMode: z.enum(["all", "any"]).default("all"),
    skillId: z.string().uuid(),
    conditions: z
      .array(
        z
          .object({
            field: z.enum([
              "senderEmail",
              "senderDomain",
              "subject",
              "body",
              "text",
              "attachmentName",
            ]),
            operator: z.enum([
              "contains",
              "equals",
              "starts_with",
              "not_contains",
            ]),
            value: z.string().trim().min(1).max(250),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export function evaluateRules(rules, message) {
  const values = {
    senderEmail: message.senderEmail,
    senderDomain: message.senderEmail?.split("@").at(-1),
    subject: message.subject,
    body: message.body,
    text: message.subject + " " + message.body,
    attachmentName: (message.attachmentNames || []).join("\n"),
  };
  const matched = rules
    .filter(
      (r) =>
        r.enabled &&
        r.conditions[r.matchMode === "any" ? "some" : "every"]((condition) => {
          const candidates =
            condition.field === "attachmentName"
              ? message.attachmentNames || []
              : [values[condition.field]];
          const needle = normalize(condition.value);
          if (condition.operator === "not_contains")
            return candidates.every(
              (value) => !normalize(value).includes(needle),
            );
          return candidates.some((raw) => {
            const value = normalize(raw);
            return {
              contains: () => value.includes(needle),
              equals: () => value === needle,
              starts_with: () => value.startsWith(needle),
            }[condition.operator]();
          });
        }),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  if (!matched.length)
    return {
      outcome: "no_match",
      skillId: null,
      ruleId: null,
      matchedRules: [],
    };
  const top = matched.filter((r) => r.priority === matched[0].priority),
    ambiguous = new Set(top.map((r) => r.skillId)).size > 1;
  return {
    outcome: ambiguous ? "ambiguous" : "matched",
    skillId: ambiguous ? null : top[0].skillId,
    ruleId: ambiguous ? null : top[0].id,
    matchedRules: matched.map((r) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      skillId: r.skillId,
      conditions: r.conditions,
      matchMode: r.matchMode,
    })),
  };
}
export function createRuleService(db) {
  const list = async (org, c = db) =>
    (
      await c.query(
        `SELECT id,name,priority,enabled,match_mode AS "matchMode",conditions,skill_id AS "skillId" FROM dispatch_rules WHERE organization_id=$1 ORDER BY priority,name,id`,
        [org],
      )
    ).rows;
  async function inputFor(org, id, c = db) {
    const row = (
      await c.query(
        "SELECT * FROM messages WHERE id=$1 AND organization_id=$2",
        [id, org],
      )
    ).rows[0];
    if (!row) return null;
    const names = (
      await c.query(
        "SELECT filename FROM attachments WHERE organization_id=$1 AND message_id=$2",
        [org, id],
      )
    ).rows.map((r) => r.filename);
    return { ...row, senderEmail: row.sender_email, attachmentNames: names };
  }
  return {
    list,
    async save(org, input, id) {
      const b = ruleSchema.parse(input);
      await requireSkill(db, org, b.skillId);
      id = id || randomUUID();
      const result = await db.query(
        `INSERT INTO dispatch_rules(id,organization_id,name,priority,enabled,match_mode,conditions,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,priority=EXCLUDED.priority,enabled=EXCLUDED.enabled,match_mode=EXCLUDED.match_mode,conditions=EXCLUDED.conditions,skill_id=EXCLUDED.skill_id,updated_at=now() WHERE dispatch_rules.organization_id=EXCLUDED.organization_id RETURNING id`,
        [
          id,
          org,
          b.name,
          b.priority,
          b.enabled,
          b.matchMode,
          JSON.stringify(b.conditions),
          b.skillId,
        ],
      );
      if (!result.rowCount)
        throw Object.assign(new Error("Regulă inexistentă"), { status: 404 });
      return { id };
    },
    async preview(org, input) {
      const b = z
        .object({
          senderEmail: z.string().email(),
          subject: z.string().max(2000),
          body: z.string().max(200000),
          attachmentNames: z.array(z.string().max(240)).max(50).default([]),
        })
        .strict()
        .parse(input);
      return evaluateRules(await list(org), b);
    },
    async process(org, id) {
      return transaction(db, async (c) => {
        await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          org,
        ]);
        const row = (
          await c.query(
            "SELECT * FROM messages WHERE organization_id=$1 AND id=$2 FOR UPDATE",
            [org, id],
          )
        ).rows[0];
        if (
          !row ||
          row.tag_source === "human" ||
          row.assigned_to ||
          row.status !== "Nou" ||
          row.task_kind !== "email"
        )
          return { cancelled: true };
        const result = evaluateRules(
          await list(org, c),
          await inputFor(org, id, c),
        );
        await c.query(
          "UPDATE messages SET skill_id=$1,tag_source=$2,updated_at=now() WHERE id=$3",
          [result.skillId, result.skillId ? "rule" : null, id],
        );
        await c.query(
          "INSERT INTO rule_decisions(id,organization_id,message_id,rule_id,skill_id,outcome,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            org,
            id,
            result.ruleId,
            result.skillId,
            result.outcome,
            result,
          ],
        );
        await event(c, org, id, { type: "system" }, "rule_decision", result);
        if (result.skillId) {
          const agent = await eligibleAgent(c, org, result.skillId);
          if (agent) {
            await c.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
              agent.id,
              id,
            ]);
            await event(c, org, id, { type: "system" }, "assigned", {
              from: null,
              to: agent.id,
              method: "dispatch-rule",
              ruleId: result.ruleId,
            });
          } else
            await event(c, org, id, { type: "system" }, "review_required", {
              reason: "no_eligible_agent",
            });
        } else
          await event(c, org, id, { type: "system" }, "review_required", {
            reason: result.outcome,
          });
        return result;
      });
    },
  };
}
export function registerRuleRoutes(
  app,
  { db, admin, service = createRuleService(db) },
) {
  app.get("/api/dispatch-rules", admin, async (req, res) =>
    res.json(await service.list(req.actor.org)),
  );
  app.post("/api/dispatch-rules", admin, async (req, res) =>
    res.status(201).json(await service.save(req.actor.org, req.body)),
  );
  app.put("/api/dispatch-rules/:id", admin, async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (
      !(
        await db.query(
          "SELECT 1 FROM dispatch_rules WHERE id=$1 AND organization_id=$2",
          [id, req.actor.org],
        )
      ).rowCount
    )
      throw Object.assign(new Error("Regulă inexistentă"), { status: 404 });
    res.json(await service.save(req.actor.org, req.body, id));
  });
  app.delete("/api/dispatch-rules/:id", admin, async (req, res) => {
    await db.query(
      "DELETE FROM dispatch_rules WHERE id=$1 AND organization_id=$2",
      [z.string().uuid().parse(req.params.id), req.actor.org],
    );
    res.json({ ok: true });
  });
  app.post("/api/dispatch-rules/preview", admin, async (req, res) =>
    res.json(await service.preview(req.actor.org, req.body)),
  );
  app.post("/api/dispatch-rules/test-message", admin, async (req, res) => {
    const { storeMessage } = await import("./messages.js");
    const input = z
      .object({
        requestId: z.string().uuid(),
        senderEmail: z.string().email(),
        subject: z.string().min(1).max(2000),
        body: z.string().max(200000),
      })
      .strict()
      .parse(req.body);
    const mailbox = (
      await db.query(
        "INSERT INTO mailboxes(id,organization_id,provider,address) VALUES($1,$2,'manual-test','relay-test@local.invalid') ON CONFLICT(organization_id,address) DO UPDATE SET address=EXCLUDED.address RETURNING id",
        [randomUUID(), req.actor.org],
      )
    ).rows[0];
    const saved = await storeMessage(db, req.actor, {
      ...input,
      senderName: input.senderEmail,
      mailboxId: mailbox.id,
      externalId: input.requestId,
      receivedAt: new Date().toISOString(),
    });
    if (!saved.duplicate) await service.process(req.actor.org, saved.id);
    res.status(saved.duplicate ? 200 : 201).json(saved);
  });
}
