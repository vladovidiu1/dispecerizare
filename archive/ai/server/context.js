// Retrieve approved examples across the firm's history; never learn from unreviewed AI guesses.
export async function getContext(db, org, subject, body, excludeId = null) {
  const stop = new Set(
    "buna bună ziua salut va vă rog multumesc mulțumesc pentru este sunt care din cu de la pe si și un o am ne sa să as aș dori".split(
      " ",
    ),
  );
  const words = [
    ...new Set(
      (subject + " " + body.slice(0, 3000))
        .toLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) || [],
    ),
  ]
    .filter((w) => !stop.has(w))
    .slice(0, 32);
  const query = words.join(" | ");
  const { rows } = await db.query(
    `WITH candidates AS (
 SELECT e.id,e.skill_id,e.subject,e.body,'curated' AS source,false AS confirmed,'epoch'::timestamptz AS updated_at FROM classification_examples e WHERE e.organization_id=$1
 UNION ALL
 SELECT m.id,m.skill_id,m.subject,m.body,'human-confirmed',true,COALESCE(m.tag_confirmed_at,m.updated_at) FROM messages m WHERE m.organization_id=$1 AND m.tag_source='human' AND m.skill_id IS NOT NULL AND ($3::uuid IS NULL OR m.id<>$3)
 ), dedup AS (
 SELECT DISTINCT ON(md5(lower(trim(subject))||'|'||lower(trim(body)))) * FROM candidates ORDER BY md5(lower(trim(subject))||'|'||lower(trim(body))),confirmed DESC,updated_at DESC,id
 ), scored AS (
 SELECT *,ts_rank_cd(to_tsvector('simple',subject||' '||body),to_tsquery('simple',NULLIF($2,''))) AS rank FROM dedup
 ), balanced AS (
 SELECT *,row_number() OVER(PARTITION BY skill_id ORDER BY COALESCE(rank,0) DESC,confirmed DESC,updated_at DESC,id) AS rn FROM scored
 ) SELECT id,skill_id AS "skillId",subject,body,source FROM balanced WHERE rn<=2 ORDER BY COALESCE(rank,0) DESC,confirmed DESC,updated_at DESC,id LIMIT 6`,
    [org, query, excludeId],
  );
  return rows;
}
