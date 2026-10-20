import { randomUUID } from "node:crypto";
import { event, eligibleAgent } from "../../../server/messages.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
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
