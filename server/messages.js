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
  let duplicate = false;
  const id = await transaction(db, async (c) => {
    // Serialize assignments inside one organization so concurrent workers cannot overfill an agent.
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
    const existing = await c.query(
      "SELECT id FROM messages WHERE mailbox_id=$1 AND external_id=$2",
      [b.mailboxId, b.externalId],
    );
    if (existing.rowCount) {
      duplicate = true;
      return existing.rows[0].id;
    }
    if (b.classification)
      await requireSkill(c, actor.org, b.classification.skillId);
    const id = randomUUID();
    await c.query(
      "INSERT INTO messages(id,organization_id,mailbox_id,external_id,thread_id,sender_name,sender_email,subject,body,received_at,priority,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
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
        b.priority,
        b.classification?.skillId || null,
      ],
    );
    await event(c, actor.org, id, actor, "received", {
      mailboxId: b.mailboxId,
      externalId: b.externalId,
    });
    if (b.classification) await classifyMessage(c, actor, id, b.classification);
    else
      await event(c, actor.org, id, actor, "review_required", {
        reason: "unclassified",
      });
    return id;
  });
  return { id, duplicate };
}

export async function eligibleAgent(c, org, skillId) {
  return (
    await c.query(
      `SELECT u.id FROM users u JOIN agent_skills a ON a.user_id=u.id WHERE u.organization_id=$1 AND a.skill_id=$2 AND u.active=true AND u.available=true AND (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat')<u.capacity ORDER BY (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat')::float/u.capacity, u.id LIMIT 1`,
      [org, skillId],
    )
  ).rows[0];
}
