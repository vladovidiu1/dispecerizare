import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createKnowledge } from "./knowledge.js";
import { createEmma } from "./emma.js";
import { readWorkbook, cellText } from "./excel.js";
const uuid = z.string().uuid();
const fail = (status, message) => Object.assign(new Error(message), { status });
const ruleSchema = z
  .object({
    senderEmail: z
      .string()
      .email()
      .transform((s) => s.toLowerCase()),
    subjectContains: z.string().trim().max(200).default(""),
    sheetName: z.string().trim().min(1).max(150),
    headerRow: z.number().int().min(1).max(100).default(1),
    codeColumn: z.string().trim().min(1).max(150),
    skillId: uuid,
    enabled: z.boolean().default(false),
  })
  .strict();
export function registerWorkflows(
  app,
  {
    db,
    human,
    admin,
    accessible,
    ollama,
    aiRunner,
    knowledge = createKnowledge(db),
  },
) {
  app.get("/api/messages/:id/conversation", human, async (req, res) => {
    await accessible(db, req.actor, req.params.id);
    const entries = (
      await db.query(
        `SELECT id,sender_name AS "senderName",sender_email AS "senderEmail",subject,body,received_at AS "receivedAt" FROM mail_entries WHERE organization_id=$1 AND message_id=$2 ORDER BY received_at,created_at,id`,
        [req.actor.org, req.params.id],
      )
    ).rows;
    const attachments = (
      await db.query(
        `SELECT id,entry_id AS "entryId",filename,content_type AS "contentType",size,unavailable_reason AS "unavailableReason" FROM attachments WHERE organization_id=$1 AND message_id=$2 ORDER BY filename`,
        [req.actor.org, req.params.id],
      )
    ).rows;
    res.json({
      entries: entries.map((e) => ({
        ...e,
        attachments: attachments.filter((a) => a.entryId === e.id),
      })),
    });
  });
  app.get("/api/attachments/:id/download", human, async (req, res) => {
    const file = (
      await db.query(
        "SELECT * FROM attachments WHERE organization_id=$1 AND id=$2",
        [req.actor.org, uuid.parse(req.params.id)],
      )
    ).rows[0];
    if (!file) throw fail(404, "Atașament inexistent");
    await accessible(db, req.actor, file.message_id);
    if (!file.content)
      throw fail(404, file.unavailable_reason || "Atașament indisponibil");
    res
      .type("application/octet-stream")
      .attachment(file.filename)
      .send(file.content);
  });
  app.get("/api/knowledge", admin, async (req, res) =>
    res.json({
      items: await knowledge.list(req.actor.org),
      folder: "itl/" + req.actor.org,
    }),
  );
  app.post(
    "/api/knowledge/pdf",
    admin,
    express.raw({ type: "application/pdf", limit: "20mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw fail(400, "Încarcă un PDF.");
      let filename;
      try {
        filename = decodeURIComponent(
          req.headers["x-filename"] || "document.pdf",
        );
      } catch {
        throw fail(400, "Nume fișier invalid");
      }
      filename = filename.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 240);
      res
        .status(201)
        .json(await knowledge.add(req.actor.org, filename, req.body));
    },
  );
  app.post("/api/knowledge/scan", admin, async (req, res) =>
    res.json(await knowledge.scan(req.actor.org)),
  );
  app.delete("/api/knowledge/:id", admin, async (req, res) =>
    res.json(await knowledge.remove(req.actor.org, uuid.parse(req.params.id))),
  );
  app.get("/api/knowledge/:id/pdf", human, async (req, res) => {
    const doc = await knowledge.document(
      req.actor.org,
      uuid.parse(req.params.id),
    );
    if (!doc) throw fail(404, "ITL inexistent");
    res.type("application/pdf").attachment(doc.filename).send(doc.content);
  });
  app.get("/api/messages/:id/itl", human, async (req, res) => {
    const m = await accessible(db, req.actor, req.params.id);
    const sources = await knowledge.match(req.actor.org, m);
    res.json({ sources: sources.map(({ body, score, ...s }) => s) });
  });
  app.post("/api/messages/:id/itl", human, async (req, res) => {
    const m = await accessible(db, req.actor, req.params.id);
    const sources = await knowledge.match(req.actor.org, m);
    if (!sources.length) return res.json({ steps: [], sources: [] });
    let answer;
    try {
      answer = await aiRunner.run(() =>
        ollama.guide({ subject: m.subject, body: m.body, sources }),
      );
    } catch (e) {
      if (e.code?.startsWith("OLLAMA_"))
        return res.status(503).json({ error: e.message });
      throw e;
    }
    await accessible(db, req.actor, req.params.id);
    res.json({ ...answer, sources: sources.map(({ body, score, ...s }) => s) });
  });
  app.get("/api/emma/rules", admin, async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT id,sender_email AS "senderEmail",subject_contains AS "subjectContains",sheet_name AS "sheetName",header_row AS "headerRow",code_column AS "codeColumn",skill_id AS "skillId",enabled FROM emma_rules WHERE organization_id=$1 ORDER BY sender_email`,
          [req.actor.org],
        )
      ).rows,
    ),
  );
  app.post("/api/emma/rules", admin, async (req, res) => {
    const b = ruleSchema.parse(req.body);
    if (
      !(
        await db.query(
          "SELECT 1 FROM skills WHERE id=$1 AND organization_id=$2",
          [b.skillId, req.actor.org],
        )
      ).rowCount
    )
      throw fail(400, "Competență invalidă");
    const id = randomUUID();
    await db.query(
      "INSERT INTO emma_rules(id,organization_id,sender_email,subject_contains,sheet_name,header_row,code_column,skill_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        req.actor.org,
        b.senderEmail,
        b.subjectContains,
        b.sheetName,
        b.headerRow,
        b.codeColumn,
        b.skillId,
        b.enabled,
      ],
    );
    res.status(201).json({ id });
  });
  app.patch("/api/emma/rules/:id", admin, async (req, res) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const r = await db.query(
      "UPDATE emma_rules SET enabled=$1 WHERE id=$2 AND organization_id=$3",
      [enabled, uuid.parse(req.params.id), req.actor.org],
    );
    if (!r.rowCount) throw fail(404, "Regulă inexistentă");
    res.json({ ok: true });
  });
  app.delete("/api/emma/rules/:id", admin, async (req, res) => {
    await db.query(
      "DELETE FROM emma_rules WHERE id=$1 AND organization_id=$2",
      [uuid.parse(req.params.id), req.actor.org],
    );
    res.json({ ok: true });
  });
  app.post(
    "/api/emma/preview",
    admin,
    express.raw({ type: "application/octet-stream", limit: "10mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw fail(400, "Încarcă un fișier XLSX.");
      const w = await readWorkbook(req.body);
      res.json({
        sheets: w.worksheets.map((s) => ({
          name: s.name,
          rows: s.rowCount,
          preview: Array.from({ length: Math.min(s.rowCount, 10) }, (_, i) => {
            const cells = [];
            s.getRow(i + 1).eachCell((c, n) =>
              cells.push({ column: n, text: cellText(c).slice(0, 200) }),
            );
            return { row: i + 1, cells };
          }),
        })),
      });
    },
  );
  app.get("/api/emma/imports", admin, async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT i.state,i.created_tasks AS "createdTasks",i.ignored_rows AS "ignoredRows",i.error,a.filename,a.message_id AS "messageId",i.created_at AS "createdAt" FROM emma_imports i JOIN attachments a ON a.id=i.attachment_id WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT 50`,
          [req.actor.org],
        )
      ).rows,
    ),
  );
  app.post("/api/messages/:id/emma", admin, async (req, res) => {
    await accessible(db, req.actor, req.params.id);
    const entries = (
      await db.query(
        "SELECT id FROM mail_entries WHERE message_id=$1 AND organization_id=$2 ORDER BY received_at",
        [req.params.id, req.actor.org],
      )
    ).rows;
    const results = [];
    for (const entry of entries)
      results.push(
        await createEmma(db).process(req.actor.org, req.params.id, entry.id),
      );
    res.json({ results });
  });
  app.get("/api/dashboard", human, async (req, res) => {
    const scope = req.actor.role === "admin" ? null : req.actor.id,
      args = [req.actor.org, scope];
    const summary = (
      await db.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE status='Nou')::int AS waiting,count(*) FILTER(WHERE status='În lucru')::int AS working,count(*) FILTER(WHERE status='Rezolvat')::int AS resolved,count(*) FILTER(WHERE assigned_to IS NULL AND status<>'Rezolvat')::int AS unassigned,count(*) FILTER(WHERE received_at>=now()-interval '24 hours')::int AS received24h,round(avg(extract(epoch from(resolved_at-created_at))/60) FILTER(WHERE resolved_at>=created_at))::int AS "resolutionMinutes" FROM messages WHERE organization_id=$1 AND ($2::uuid IS NULL OR assigned_to=$2)`,
        args,
      )
    ).rows[0];
    const daily = (
      await db.query(
        `SELECT d::date::text AS day,
        (SELECT count(*)::int FROM messages m WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR assigned_to=$2) AND m.created_at>=(d AT TIME ZONE 'Europe/Bucharest') AND m.created_at<((d+interval '1 day') AT TIME ZONE 'Europe/Bucharest')) AS received,
        (SELECT count(*)::int FROM messages m WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR assigned_to=$2) AND m.resolved_at>=(d AT TIME ZONE 'Europe/Bucharest') AND m.resolved_at<((d+interval '1 day') AT TIME ZONE 'Europe/Bucharest')) AS resolved
        FROM generate_series(((now() AT TIME ZONE 'Europe/Bucharest')::date-6)::timestamp,((now() AT TIME ZONE 'Europe/Bucharest')::date)::timestamp,interval '1 day') d`,
        args,
      )
    ).rows;
    const categories = (
      await db.query(
        `SELECT coalesce(s.name,'De verificat') AS name,count(*)::int AS total,count(*) FILTER(WHERE m.status<>'Rezolvat')::int AS open FROM messages m LEFT JOIN skills s ON s.id=m.skill_id WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR m.assigned_to=$2) GROUP BY s.name ORDER BY total DESC LIMIT 12`,
        args,
      )
    ).rows;
    const agents = (
      await db.query(
        `SELECT u.id,u.name,u.capacity,u.available,count(m.id) FILTER(WHERE m.status<>'Rezolvat')::int AS load,count(m.id) FILTER(WHERE m.status='Rezolvat')::int AS resolved FROM users u LEFT JOIN messages m ON m.assigned_to=u.id WHERE u.organization_id=$1 AND u.active=true AND ($2::uuid IS NULL OR u.id=$2) GROUP BY u.id ORDER BY load DESC,u.name`,
        args,
      )
    ).rows;
    res.json({ summary, daily, categories, agents });
  });
}
