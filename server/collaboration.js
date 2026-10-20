import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { event } from "./messages.js";
import { searchTerms } from "./knowledge.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
export function registerCollaborationRoutes(
  app,
  { db, human, admin, accessible, senderService },
) {
  app.get("/api/messages/:id/resolutions", human, async (req, res) => {
    await accessible(db, req.actor, req.params.id);
    res.json(
      (
        await db.query(
          `SELECT r.id,r.summary,r.steps,r.shareable,r.created_at AS "createdAt",u.name AS "authorName" FROM task_resolutions r JOIN users u ON u.id=r.author_id WHERE r.organization_id=$1 AND r.message_id=$2 ORDER BY r.created_at DESC`,
          [req.actor.org, req.params.id],
        )
      ).rows,
    );
  });
  app.post("/api/messages/:id/resolutions", human, async (req, res) => {
    const b = z
      .object({
        summary: z.string().trim().min(5).max(300),
        steps: z.string().trim().min(10).max(20000),
        shareable: z.boolean().default(true),
        resolveTask: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    await transaction(db, async (c) => {
      await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.actor.org,
      ]);
      const m = await accessible(c, req.actor, req.params.id, true);
      await c.query(
        "INSERT INTO task_resolutions(id,organization_id,message_id,author_id,summary,steps,shareable) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          req.actor.org,
          m.id,
          req.actor.id,
          b.summary,
          b.steps,
          b.shareable,
        ],
      );
      await event(c, req.actor.org, m.id, req.actor, "resolution_added", {
        resolutionId: id,
        summary: b.summary,
        shareable: b.shareable,
      });
      await c.query("UPDATE messages SET updated_at=now() WHERE id=$1", [m.id]);
      if (b.resolveTask && m.status !== "Rezolvat") {
        await c.query(
          "UPDATE messages SET status='Rezolvat',resolved_at=now(),updated_at=now() WHERE id=$1",
          [m.id],
        );
        await event(c, req.actor.org, m.id, req.actor, "updated", {
          field: "status",
          from: m.status,
          to: "Rezolvat",
          method: "resolution",
        });
      }
    });
    res.status(201).json({ id });
  });
  app.get("/api/messages/:id/suggestions", human, async (req, res) => {
    const m = await accessible(db, req.actor, req.params.id);
    const terms = searchTerms(m.subject + " " + m.body.slice(0, 3000));
    if (!terms.length) return res.json([]);
    const query = terms.map((t) => "'" + t.replace(/'/g, "") + "'").join(" | ");
    res.json(
      (
        await db.query(
          `SELECT r.id,r.summary,r.steps,r.created_at AS "createdAt",s.name AS skill,ts_rank_cd(to_tsvector('simple',r.summary||' '||r.steps),to_tsquery('simple',$4)) AS relevance FROM task_resolutions r JOIN messages m ON m.id=r.message_id LEFT JOIN skills s ON s.id=m.skill_id WHERE r.organization_id=$1 AND r.message_id<>$2 AND r.shareable AND m.status='Rezolvat' AND ($3::uuid IS NULL OR m.skill_id=$3) AND to_tsvector('simple',r.summary||' '||r.steps) @@ to_tsquery('simple',$4) ORDER BY relevance DESC,r.created_at DESC LIMIT 5`,
          [req.actor.org, m.id, m.skill_id, query],
        )
      ).rows,
    );
  });
  app.post("/api/messages/:id/transfer", human, async (req, res) => {
    const b = z
      .object({
        assignedTo: z.string().uuid(),
        reason: z.string().trim().min(5).max(4000),
      })
      .strict()
      .parse(req.body);
    await transaction(db, async (c) => {
      await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.actor.org,
      ]);
      const m = await accessible(c, req.actor, req.params.id, true);
      if (m.assigned_to === b.assignedTo)
        throw fail(400, "Taskul este deja la acest coleg");
      if (
        !(
          await c.query(
            "SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND active=true",
            [b.assignedTo, req.actor.org],
          )
        ).rowCount
      )
        throw fail(400, "Colegul nu este activ în această organizație");
      if (
        (
          await c.query(
            "SELECT 1 FROM outgoing_mail WHERE message_id=$1 AND state='sending'",
            [m.id],
          )
        ).rowCount
      )
        throw fail(
          409,
          "Așteaptă finalizarea răspunsului în curs de trimitere",
        );
      await c.query(
        "UPDATE outgoing_mail SET state='cancelled',last_error='TASK_TRANSFERRED' WHERE message_id=$1 AND state='queued'",
        [m.id],
      );
      await c.query(
        "UPDATE dispatch_jobs SET state='cancelled',lease_until=NULL WHERE message_id=$1 AND state IN ('pending','running','retry')",
        [m.id],
      );
      await c.query(
        "UPDATE messages SET assigned_to=$1,status='Nou',resolved_at=NULL,updated_at=now() WHERE id=$2",
        [b.assignedTo, m.id],
      );
      await event(c, req.actor.org, m.id, req.actor, "assigned", {
        from: m.assigned_to,
        to: b.assignedTo,
        method: "handover",
        reason: b.reason,
        previousStatus: m.status,
      });
    });
    res.status(204).end();
  });
  app.post("/api/messages/:id/reply", human, async (req, res) =>
    res
      .status(202)
      .json(await senderService.queue(req.actor, req.params.id, req.body)),
  );
  app.post("/api/outgoing-mail/:id/reconcile", human, async (req, res) =>
    res.json(await senderService.reconcile(req.actor, req.params.id, req.body)),
  );
}
