import { randomUUID } from "node:crypto";
import { readWorkbook, rowsFromSheet } from "./excel.js";
import { storeMessage, event, eligibleAgent } from "./messages.js";
import { transaction } from "./db.js";
export function createEmma(db) {
  return {
    async process(org, messageId, entryId) {
      const lock = await db.connect();
      let held = false;
      try {
        held = (
          await lock.query(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            ["emma:" + messageId],
          )
        ).rows[0].locked;
        if (!held)
          throw Object.assign(
            new Error(
              "Acest raport EMMA este deja procesat. Reîncearcă după finalizare.",
            ),
            { status: 409 },
          );
        const m = (
          await db.query(
            "SELECT * FROM mail_entries WHERE id=$1 AND organization_id=$2",
            [entryId, org],
          )
        ).rows[0];
        if (!m) return { matched: false };
        const rules = (
          await db.query(
            `SELECT * FROM emma_rules WHERE organization_id=$1 AND enabled=true AND sender_email=$2 AND position(lower(subject_contains) in lower($3))>0 ORDER BY length(subject_contains) DESC,id`,
            [org, m.sender_email.toLowerCase(), m.subject],
          )
        ).rows;
        if (!rules.length) return { matched: false };
        if (rules.length > 1) {
          await event(db, org, messageId, { type: "system" }, "emma_failed", {
            reason: "Mai multe reguli EMMA se potrivesc. Restrânge regulile.",
          });
          return { matched: true, failed: true };
        }
        const rule = rules[0];
        const files = (
          await db.query(
            `SELECT * FROM attachments WHERE organization_id=$1 AND entry_id=$2 AND lower(filename) LIKE '%.xlsx'`,
            [org, entryId],
          )
        ).rows;
        if (!files.length) {
          await event(db, org, messageId, { type: "system" }, "emma_failed", {
            reason: "Regula EMMA se potrivește, dar nu există atașament XLSX.",
          });
          return { matched: true, failed: true };
        }
        let total = 0,
          failed = false,
          processed = false;
        for (const file of files) {
          if (
            (
              await db.query(
                "SELECT 1 FROM emma_imports WHERE attachment_id=$1 AND state='done'",
                [file.id],
              )
            ).rowCount
          )
            continue;
          try {
            processed = true;
            if (!file.content)
              throw Object.assign(
                new Error("Atașamentul nu este disponibil local."),
                { status: 400 },
              );
            const workbook = await readWorkbook(file.content);
            const rows = rowsFromSheet(workbook, {
              sheetName: rule.sheet_name,
              headerRow: rule.header_row,
              codeColumn: rule.code_column,
            });
            const supported = new Set(
              (
                await db.query(
                  "SELECT DISTINCT unnest(emma_codes) AS code FROM users u JOIN agent_skills a ON a.user_id=u.id WHERE u.organization_id=$1 AND u.active=true AND a.skill_id=$2",
                  [org, rule.skill_id],
                )
              ).rows.map((r) => r.code),
            );
            const selected = rows.filter((r) => supported.has(r.code));
            if (selected.length > 1000)
              throw Object.assign(
                new Error(
                  "Peste 1.000 de erori eligibile. Împarte raportul înainte de import.",
                ),
                { status: 400 },
              );
            let created = 0;
            for (const row of selected) {
              const saved = await storeMessage(
                db,
                { org, type: "system" },
                {
                  mailboxId: m.mailbox_id,
                  externalId: `emma:${file.id}:${row.row}`,
                  senderName: m.sender_name,
                  senderEmail: m.sender_email,
                  subject: `EMMA ${row.code} · ${file.filename} · rând ${row.row}`,
                  body: row.body,
                  receivedAt: m.received_at,
                  taskKind: "emma",
                  sourceMessageId: messageId,
                  emmaCode: row.code,
                  skillId: rule.skill_id,
                },
              );
              if (saved.duplicate) continue;
              await transaction(db, async (c) => {
                await c.query(
                  "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
                  [org],
                );
                const current = (
                  await c.query(
                    "SELECT assigned_to FROM messages WHERE id=$1 FOR UPDATE",
                    [saved.id],
                  )
                ).rows[0];
                if (current.assigned_to) return;
                const agent = await eligibleAgent(
                  c,
                  org,
                  rule.skill_id,
                  row.code,
                );
                if (agent) {
                  await c.query(
                    "UPDATE messages SET assigned_to=$1 WHERE id=$2",
                    [agent.id, saved.id],
                  );
                  await event(
                    c,
                    org,
                    saved.id,
                    { type: "system" },
                    "assigned",
                    {
                      from: null,
                      to: agent.id,
                      method: "emma-code-and-load",
                    },
                  );
                }
                await event(
                  c,
                  org,
                  saved.id,
                  { type: "system" },
                  "emma_created",
                  {
                    sourceMessageId: messageId,
                    filename: file.filename,
                    row: row.row,
                    code: row.code,
                  },
                );
              });
              created++;
            }
            await db.query(
              `INSERT INTO emma_imports(attachment_id,organization_id,rule_id,state,created_tasks,ignored_rows) VALUES($1,$2,$3,'done',$4,$5) ON CONFLICT(attachment_id) DO UPDATE SET state='done',created_tasks=EXCLUDED.created_tasks,ignored_rows=EXCLUDED.ignored_rows,error=NULL`,
              [file.id, org, rule.id, created, rows.length - selected.length],
            );
            await event(
              db,
              org,
              messageId,
              { type: "system" },
              "emma_imported",
              {
                filename: file.filename,
                created,
                ignored: rows.length - selected.length,
              },
            );
            total += created;
          } catch (e) {
            failed = true;
            const error =
              e.status === 400
                ? e.message
                : "Importul Excel a eșuat. Verifică structura și regula.";
            await db.query(
              `INSERT INTO emma_imports(attachment_id,organization_id,rule_id,state,error) VALUES($1,$2,$3,'failed',$4) ON CONFLICT(attachment_id) DO UPDATE SET state='failed',error=EXCLUDED.error`,
              [file.id, org, rule.id, error],
            );
            await event(db, org, messageId, { type: "system" }, "emma_failed", {
              filename: file.filename,
              reason: error,
            });
          }
        }
        if (!failed && processed)
          await db.query(
            "UPDATE messages SET status='Rezolvat',resolved_at=now(),updated_at=now() WHERE id=$1 AND assigned_to IS NULL",
            [messageId],
          );
        return { matched: true, created: total, failed };
      } finally {
        try {
          if (held)
            await lock.query(
              "SELECT pg_advisory_unlock(hashtextextended($1,0))",
              ["emma:" + messageId],
            );
        } finally {
          lock.release();
        }
      }
    },
  };
}
