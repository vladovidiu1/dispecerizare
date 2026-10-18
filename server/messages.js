import { randomUUID } from "node:crypto";
import { transaction } from "./db.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
export async function event(c, org, message, actor, type, data) {
  await c.query(
    "INSERT INTO message_events(organization_id,message_id,actor_id,actor_type,type,data) VALUES($1,$2,$3,$4,$5,$6)",
    [org, message, actor.id || null, actor.type, type, data],
  );
}
export async function requireSkill(c, org, id) {
  if (
    !(
      await c.query("SELECT 1 FROM skills WHERE organization_id=$1 AND id=$2", [
        org,
        id,
      ])
    ).rowCount
  )
    throw fail(400, "Competență invalidă");
}
export async function classifyMessage(c, actor, id, cl) {
  const current = (
    await c.query(
      "SELECT tag_source FROM messages WHERE id=$1 AND organization_id=$2 FOR UPDATE",
      [id, actor.org],
    )
  ).rows[0];
  if (!current || current.tag_source === "human")
    throw fail(409, "Decizia umană are prioritate față de AI");
  await c.query(
    "INSERT INTO classifications(id,organization_id,message_id,skill_id,confidence,model,prompt_version,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      actor.org,
      id,
      cl.skillId,
      cl.confidence,
      cl.model,
      cl.promptVersion,
      cl.reason,
    ],
  );
  await c.query(
    "UPDATE messages SET tag_source='ai' WHERE id=$1 AND tag_source IS DISTINCT FROM 'human'",
    [id],
  );
  await event(c, actor.org, id, actor, "classified", cl);
  let agent;
  if (cl.confidence >= 0.75) {
    agent = await eligibleAgent(c, actor.org, cl.skillId);
  }
  if (agent) {
    await c.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
      agent.id,
      id,
    ]);
    await event(c, actor.org, id, actor, "assigned", {
      from: null,
      to: agent.id,
      method: "skill-and-capacity",
    });
  } else
    await event(c, actor.org, id, actor, "review_required", {
      reason: cl.confidence < 0.75 ? "low_confidence" : "no_eligible_agent",
    });
}

export async function storeMessage(db, actor, b) {
  return transaction(db, async (c) => {
    await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      actor.org,
    ]);
    if (
      !(
        await c.query(
          "SELECT 1 FROM mailboxes WHERE id=$1 AND organization_id=$2",
          [b.mailboxId, actor.org],
        )
      ).rowCount
    )
      throw fail(404, "Adresă de email inexistentă");
    const existing = (
      await c.query(
        "SELECT e.id,e.message_id,m.external_id AS root_external_id FROM mail_entries e JOIN messages m ON m.id=e.message_id WHERE e.mailbox_id=$1 AND e.external_id=$2",
        [b.mailboxId, b.externalId],
      )
    ).rows[0];
    if (existing)
      return {
        id: existing.message_id,
        entryId: existing.id,
        duplicate: true,
        updated: existing.root_external_id !== b.externalId,
      };
    // Only provider conversation IDs or RFC reply headers join tasks. Subject alone never does.
    const refs = [b.inReplyTo, ...(b.references || [])]
      .filter(Boolean)
      .slice(-100);
    let prior;
    if (b.taskKind !== "emma") {
      const matches = (
        await c.query(
          `SELECT DISTINCT m.id FROM messages m LEFT JOIN mail_entries e ON e.message_id=m.id
        WHERE m.mailbox_id=$1 AND m.task_kind='email' AND (($2::text IS NOT NULL AND m.thread_id=$2) OR e.internet_message_id=ANY($3::text[]) OR m.thread_id=ANY($3::text[])) LIMIT 2`,
          [b.mailboxId, b.threadId || null, refs],
        )
      ).rows;
      // Ambiguous references require a separate task rather than merging unrelated work.
      if (matches.length === 1) prior = matches[0];
    }
    if (b.classification)
      await requireSkill(c, actor.org, b.classification.skillId);
    const id = prior?.id || randomUUID(),
      entryId = randomUUID();
    if (prior) {
      const old = (
        await c.query(
          "SELECT status,received_at FROM messages WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      const newer = new Date(b.receivedAt) >= new Date(old.received_at);
      if (newer)
        await c.query(
          `UPDATE messages SET body=$1,subject=$2,sender_name=$3,sender_email=$4,received_at=GREATEST(received_at,$5),updated_at=now(),status=CASE WHEN status='Rezolvat' THEN 'Nou' ELSE status END,resolved_at=NULL WHERE id=$6`,
          [b.body, b.subject, b.senderName, b.senderEmail, b.receivedAt, id],
        );
      await event(c, actor.org, id, actor, "email_update", {
        externalId: b.externalId,
        reopened: newer && old.status === "Rezolvat",
      });
    } else {
      await c.query(
        `INSERT INTO messages(id,organization_id,mailbox_id,external_id,thread_id,sender_name,sender_email,subject,body,received_at,priority,skill_id,task_kind,source_message_id,emma_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          actor.org,
          b.mailboxId,
          b.externalId,
          b.threadId || null,
          b.senderName,
          b.senderEmail,
          b.subject,
          b.body,
          b.receivedAt,
          b.priority || "Medie",
          b.classification?.skillId || b.skillId || null,
          b.taskKind || "email",
          b.sourceMessageId || null,
          b.emmaCode || null,
        ],
      );
    }
    await c.query(
      `INSERT INTO mail_entries(id,organization_id,message_id,mailbox_id,external_id,internet_message_id,thread_id,sender_name,sender_email,subject,body,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entryId,
        actor.org,
        id,
        b.mailboxId,
        b.externalId,
        b.internetMessageId || null,
        b.threadId || null,
        b.senderName,
        b.senderEmail,
        b.subject,
        b.body,
        b.receivedAt,
      ],
    );
    let bytes = 0;
    for (const file of (b.attachments || []).slice(0, 50)) {
      const content = Buffer.isBuffer(file.content) ? file.content : null;
      bytes += content?.length || 0;
      const allowed =
        content && content.length <= 20_000_000 && bytes <= 30_000_000;
      await c.query(
        `INSERT INTO attachments(id,organization_id,message_id,entry_id,filename,content_type,size,content,unavailable_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          actor.org,
          id,
          entryId,
          String(file.filename || "atasament")
            .replace(/[\\/\x00-\x1f]/g, "_")
            .slice(0, 240),
          String(file.contentType || "application/octet-stream").slice(0, 200),
          content?.length ||
            Math.min(2147483647, Math.max(0, Number(file.size) || 0)),
          allowed ? content : null,
          allowed
            ? null
            : file.unavailableReason ||
              "Atașament prea mare sau indisponibil la import.",
        ],
      );
    }
    if (!prior) {
      await event(c, actor.org, id, actor, "received", {
        mailboxId: b.mailboxId,
        externalId: b.externalId,
      });
      if (b.classification)
        await classifyMessage(c, actor, id, b.classification);
      else
        await event(c, actor.org, id, actor, "review_required", {
          reason: "unclassified",
        });
    }
    return { id, entryId, duplicate: false, updated: !!prior };
  });
}

export async function eligibleAgent(c, org, skillId, emmaCode = null) {
  return (
    await c.query(
      `SELECT u.id FROM users u JOIN agent_skills a ON a.user_id=u.id WHERE u.organization_id=$1 AND a.skill_id=$2 AND u.active=true AND u.available=true AND ($3::text IS NULL OR $3=ANY(u.emma_codes)) AND (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat')<u.capacity ORDER BY (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat'), (SELECT max(created_at) FROM message_events WHERE organization_id=u.organization_id AND type='assigned' AND data->>'to'=u.id::text) NULLS FIRST, u.id LIMIT 1`,
      [org, skillId, emmaCode],
    )
  ).rows[0];
}

// Drain classified waiting tasks when capacity becomes free, without invoking AI.
export async function distributeWaiting(db) {
  const orgs = (
    await db.query(
      "SELECT DISTINCT organization_id FROM messages WHERE assigned_to IS NULL AND status='Nou' AND skill_id IS NOT NULL",
    )
  ).rows;
  for (const { organization_id: org } of orgs)
    await transaction(db, async (c) => {
      await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const waiting = (
        await c.query(
          `SELECT m.* FROM messages m WHERE m.organization_id=$1 AND m.assigned_to IS NULL AND m.status='Nou' AND m.skill_id IS NOT NULL AND (m.tag_source='human' OR m.task_kind='emma' OR (SELECT confidence FROM classifications WHERE message_id=m.id ORDER BY created_at DESC LIMIT 1)>=0.75) AND EXISTS(SELECT 1 FROM users u JOIN agent_skills a ON a.user_id=u.id WHERE u.organization_id=m.organization_id AND a.skill_id=m.skill_id AND u.active AND u.available AND (m.emma_code IS NULL OR m.emma_code=ANY(u.emma_codes)) AND (SELECT count(*) FROM messages load WHERE load.assigned_to=u.id AND load.status<>'Rezolvat')<u.capacity) ORDER BY m.received_at,m.id LIMIT 100`,
          [org],
        )
      ).rows;
      for (const m of waiting) {
        const agent = await eligibleAgent(c, org, m.skill_id, m.emma_code);
        if (!agent) continue;
        await c.query(
          "UPDATE messages SET assigned_to=$1,updated_at=now() WHERE id=$2",
          [agent.id, m.id],
        );
        await event(c, org, m.id, { type: "system" }, "assigned", {
          from: null,
          to: agent.id,
          method: "waiting-queue",
        });
      }
    });
}
