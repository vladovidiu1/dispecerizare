import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { checkPassword, hashPassword, hashToken, token } from "./security.js";
const uuid = z.string().uuid(),
  text = z.string().trim().min(1),
  email = z
    .string()
    .email()
    .transform((s) => s.toLowerCase());
const fail = (status, message) => Object.assign(new Error(message), { status });
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  organizationId: u.organization_id,
});
async function event(c, org, message, actor, type, data) {
  await c.query(
    "INSERT INTO message_events(organization_id,message_id,actor_id,actor_type,type,data) VALUES($1,$2,$3,$4,$5,$6)",
    [org, message, actor.id || null, actor.type, type, data],
  );
}
const agentSchema = z.object({
  name: text.max(150),
  email,
  password: z.string().min(12).max(200),
  skills: z.array(uuid).max(100).default([]),
  capacity: z.number().int().min(1).max(1000).default(20),
});
const ingestSchema = z.object({
  mailboxId: uuid,
  externalId: text.max(1000),
  threadId: text.max(1000).optional(),
  senderName: text.max(200),
  senderEmail: email,
  subject: z.string().max(2000),
  body: z.string().max(200000),
  receivedAt: z.string().datetime({ offset: true }),
  priority: z.enum(["Scăzută", "Medie", "Ridicată"]).default("Medie"),
  classification: z
    .object({
      skillId: uuid,
      confidence: z.number().min(0).max(1),
      model: text.max(150),
      promptVersion: text.max(150),
      reason: z.string().max(4000).default(""),
    })
    .optional(),
});
const messageSelect = `SELECT m.*, s.name AS category, u.name AS agent FROM messages m LEFT JOIN skills s ON s.id=m.skill_id LEFT JOIN users u ON u.id=m.assigned_to`;
function present(m) {
  return {
    id: m.id,
    name: m.sender_name,
    email: m.sender_email,
    initials: m.sender_name
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    color: "purple",
    subject: m.subject,
    text: m.body,
    category: m.category || "De verificat",
    skillId: m.skill_id,
    agent: m.agent || "Nealocat",
    agentId: m.assigned_to,
    priority: m.priority,
    status: m.status,
    receivedAt: m.received_at,
    time: new Intl.DateTimeFormat("ro-RO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Bucharest",
    }).format(m.received_at),
    externalId: m.external_id,
  };
}
export function createApp(
  db,
  {
    production = false,
    appOrigin = "http://localhost:5173",
    trustProxyHops = 0,
  } = {},
) {
  const app = express();
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 10
  )
    throw new Error("Invalid TRUST_PROXY_HOPS");
  app.set("trust proxy", trustProxyHops);
  app.disable("x-powered-by");
  app.use(production ? helmet() : helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "300kb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== appOrigin
    )
      return next(fail(403, "Origine nepermisă"));
    next();
  });
  app.post(
    "/api/auth/login",
    rateLimit({ windowMs: 900000, limit: 20, legacyHeaders: false }),
    async (req, res) => {
      const b = z
        .object({
          organizationId: uuid,
          email,
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const {
        rows: [user],
      } = await db.query(
        "SELECT * FROM users WHERE organization_id=$1 AND email=$2 AND active=true",
        [b.organizationId, b.email],
      );
      // Perform the same password derivation even when the account does not exist.
      const valid = checkPassword(b.password, user?.password_hash || dummyHash);
      if (!user || !valid) throw fail(401, "Date de autentificare incorecte");
      const t = token();
      await db.query("DELETE FROM sessions WHERE expires_at<now()");
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '8 hours')",
        [hashToken(t), user.id],
      );
      res
        .cookie("relay_session", t, {
          httpOnly: true,
          sameSite: "strict",
          secure: production,
          maxAge: 8 * 3600000,
          path: "/api",
        })
        .json(publicUser(user));
    },
  );
  app.use("/api", async (req, res, next) => {
    const bearer = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    if (bearer) {
      const {
        rows: [key],
      } = await db.query(
        "SELECT * FROM api_keys WHERE token_hash=$1 AND revoked_at IS NULL",
        [hashToken(bearer)],
      );
      if (!key) throw fail(401, "Cheie API invalidă");
      req.actor = { org: key.organization_id, type: "robot" };
      return next();
    }
    const t = req.cookies.relay_session;
    if (!t) throw fail(401, "Autentificare necesară");
    const {
      rows: [user],
    } = await db.query(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
      [hashToken(t)],
    );
    if (!user) throw fail(401, "Sesiune expirată");
    req.actor = {
      org: user.organization_id,
      id: user.id,
      type: "user",
      role: user.role,
    };
    req.user = user;
    next();
  });
  const human = (req, res, next) =>
    req.actor.type === "user"
      ? next()
      : next(fail(403, "Acces rezervat utilizatorilor"));
  const admin = (req, res, next) =>
    req.actor.role === "admin"
      ? next()
      : next(fail(403, "Acces rezervat administratorilor"));
  app.get("/api/auth/me", human, (req, res) => res.json(publicUser(req.user)));
  app.post("/api/auth/logout", human, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hashToken(req.cookies.relay_session),
    ]);
    res
      .clearCookie("relay_session", {
        path: "/api",
        sameSite: "strict",
        secure: production,
        httpOnly: true,
      })
      .status(204)
      .end();
  });
  app.get("/api/skills", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,name FROM skills WHERE organization_id=$1 ORDER BY name",
          [req.actor.org],
        )
      ).rows,
    ),
  );
  app.post("/api/skills", admin, async (req, res) => {
    const b = z.object({ name: text.max(100) }).parse(req.body);
    res
      .status(201)
      .json(
        (
          await db.query(
            "INSERT INTO skills(id,organization_id,name) VALUES($1,$2,$3) RETURNING id,name",
            [randomUUID(), req.actor.org, b.name],
          )
        ).rows[0],
      );
  });
  app.get("/api/examples", async (req, res) =>
    res.json(
      (
        await db.query(
          'SELECT id,skill_id AS "skillId",subject,body FROM classification_examples WHERE organization_id=$1 ORDER BY id LIMIT 1000',
          [req.actor.org],
        )
      ).rows,
    ),
  );
  app.post("/api/examples", admin, async (req, res) => {
    const b = z
      .object({
        skillId: uuid,
        subject: text.max(2000),
        body: text.max(200000),
      })
      .parse(req.body);
    await requireSkill(db, req.actor.org, b.skillId);
    res
      .status(201)
      .json(
        (
          await db.query(
            "INSERT INTO classification_examples VALUES($1,$2,$3,$4,$5) RETURNING id",
            [randomUUID(), req.actor.org, b.skillId, b.subject, b.body],
          )
        ).rows[0],
      );
  });
  app.get("/api/agents", human, async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.capacity,u.available,COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM agent_skills a JOIN skills s ON s.id=a.skill_id WHERE a.user_id=u.id),'[]') AS skills,(SELECT count(*)::int FROM messages m WHERE m.assigned_to=u.id AND m.status<>'Rezolvat') AS load FROM users u WHERE u.organization_id=$1 AND u.active=true ORDER BY u.name`,
      [req.actor.org],
    );
    res.json(
      rows.map((u) => ({
        ...u,
        initials: u.name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join(""),
        color: "purple",
      })),
    );
  });
  app.post("/api/agents", admin, async (req, res) => {
    const b = agentSchema.parse(req.body);
    const id = randomUUID();
    await transaction(db, async (c) => {
      for (const s of new Set(b.skills))
        await requireSkill(c, req.actor.org, s);
      await c.query(
        "INSERT INTO users(id,organization_id,name,email,password_hash,role,capacity) VALUES($1,$2,$3,$4,$5,'agent',$6)",
        [
          id,
          req.actor.org,
          b.name,
          b.email,
          hashPassword(b.password),
          b.capacity,
        ],
      );
      for (const s of new Set(b.skills))
        await c.query("INSERT INTO agent_skills VALUES($1,$2,$3)", [
          req.actor.org,
          id,
          s,
        ]);
    });
    res.status(201).json({ id });
  });
  app.patch("/api/agents/:id", admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z
      .object({
        available: z.boolean().optional(),
        capacity: z.number().int().min(1).max(1000).optional(),
        skills: z.array(uuid).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    await transaction(db, async (c) => {
      const r = await c.query(
        "SELECT id FROM users WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [req.actor.org, id],
      );
      if (!r.rowCount) throw fail(404, "Agent inexistent");
      if (b.available !== undefined)
        await c.query("UPDATE users SET available=$1 WHERE id=$2", [
          b.available,
          id,
        ]);
      if (b.capacity !== undefined)
        await c.query("UPDATE users SET capacity=$1 WHERE id=$2", [
          b.capacity,
          id,
        ]);
      if (b.skills) {
        for (const s of new Set(b.skills))
          await requireSkill(c, req.actor.org, s);
        await c.query("DELETE FROM agent_skills WHERE user_id=$1", [id]);
        for (const s of new Set(b.skills))
          await c.query("INSERT INTO agent_skills VALUES($1,$2,$3)", [
            req.actor.org,
            id,
            s,
          ]);
      }
    });
    res.status(204).end();
  });
  app.get("/api/mailboxes", admin, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,provider,address FROM mailboxes WHERE organization_id=$1",
          [req.actor.org],
        )
      ).rows,
    ),
  );
  app.post("/api/mailboxes", admin, async (req, res) => {
    const b = z
      .object({ provider: text.max(100), address: email })
      .parse(req.body);
    res
      .status(201)
      .json(
        (
          await db.query(
            "INSERT INTO mailboxes VALUES($1,$2,$3,$4) RETURNING id,provider,address",
            [randomUUID(), req.actor.org, b.provider, b.address],
          )
        ).rows[0],
      );
  });
  app.post("/api/keys", admin, async (req, res) => {
    const b = z.object({ name: text.max(100) }).parse(req.body);
    const t = token(),
      id = randomUUID();
    await db.query(
      "INSERT INTO api_keys(id,organization_id,name,token_hash) VALUES($1,$2,$3,$4)",
      [id, req.actor.org, b.name, hashToken(t)],
    );
    res.status(201).json({ id, token: t });
  });
  app.delete("/api/keys/:id", admin, async (req, res) => {
    const r = await db.query(
      "UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND organization_id=$2",
      [uuid.parse(req.params.id), req.actor.org],
    );
    if (!r.rowCount) throw fail(404, "Cheie inexistentă");
    res.status(204).end();
  });
  app.post("/api/ingest", async (req, res) => {
    if (req.actor.type !== "robot")
      throw fail(403, "Folosește cheia robotului");
    const b = ingestSchema.parse(req.body);
    let duplicate = false;
    const id = await transaction(db, async (c) => {
      // Serialize assignments inside one organization so concurrent workers cannot overfill an agent.
      await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.actor.org,
      ]);
      if (
        !(
          await c.query(
            "SELECT 1 FROM mailboxes WHERE id=$1 AND organization_id=$2",
            [b.mailboxId, req.actor.org],
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
        await requireSkill(c, req.actor.org, b.classification.skillId);
      const id = randomUUID();
      await c.query(
        "INSERT INTO messages(id,organization_id,mailbox_id,external_id,thread_id,sender_name,sender_email,subject,body,received_at,priority,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          id,
          req.actor.org,
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
      await event(c, req.actor.org, id, req.actor, "received", {
        mailboxId: b.mailboxId,
        externalId: b.externalId,
      });
      if (b.classification) {
        const cl = b.classification;
        await c.query(
          "INSERT INTO classifications(id,organization_id,message_id,skill_id,confidence,model,prompt_version,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            req.actor.org,
            id,
            cl.skillId,
            cl.confidence,
            cl.model,
            cl.promptVersion,
            cl.reason,
          ],
        );
        await event(c, req.actor.org, id, req.actor, "classified", cl);
        let agent;
        if (cl.confidence >= 0.75) {
          agent = (
            await c.query(
              `SELECT u.id FROM users u JOIN agent_skills a ON a.user_id=u.id WHERE u.organization_id=$1 AND a.skill_id=$2 AND u.active=true AND u.available=true AND (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat')<u.capacity ORDER BY (SELECT count(*) FROM messages WHERE assigned_to=u.id AND status<>'Rezolvat')::float/u.capacity, u.id LIMIT 1`,
              [req.actor.org, cl.skillId],
            )
          ).rows[0];
        }
        if (agent) {
          await c.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
            agent.id,
            id,
          ]);
          await event(c, req.actor.org, id, req.actor, "assigned", {
            from: null,
            to: agent.id,
            method: "skill-and-capacity",
          });
        } else
          await event(c, req.actor.org, id, req.actor, "review_required", {
            reason:
              cl.confidence < 0.75 ? "low_confidence" : "no_eligible_agent",
          });
      } else
        await event(c, req.actor.org, id, req.actor, "review_required", {
          reason: "unclassified",
        });
      return id;
    });
    res.status(duplicate ? 200 : 201).json({ id, duplicate });
  });
  app.get("/api/messages", human, async (req, res) => {
    const b = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const scope = req.actor.role === "admin" ? null : req.actor.id;
    const { rows } = await db.query(
      messageSelect +
        " WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR m.assigned_to=$2) ORDER BY m.received_at DESC,m.id LIMIT $3 OFFSET $4",
      [req.actor.org, scope, b.limit, b.offset],
    );
    const {
      rows: [{ count }],
    } = await db.query(
      "SELECT count(*)::int FROM messages WHERE organization_id=$1 AND ($2::uuid IS NULL OR assigned_to=$2)",
      [req.actor.org, scope],
    );
    res.json({
      items: rows.map(present),
      total: count,
      limit: b.limit,
      offset: b.offset,
    });
  });
  async function accessible(c, actor, id, lock = false) {
    const {
      rows: [m],
    } = await c.query(
      "SELECT * FROM messages WHERE id=$1 AND organization_id=$2" +
        (lock ? " FOR UPDATE" : ""),
      [uuid.parse(id), actor.org],
    );
    if (!m || (actor.role !== "admin" && m.assigned_to !== actor.id))
      throw fail(404, "Mesaj inexistent");
    return m;
  }
  app.get("/api/messages/:id/history", human, async (req, res) => {
    await accessible(db, req.actor, req.params.id);
    res.json(
      (
        await db.query(
          'SELECT e.id,e.type,e.data,e.created_at AS "createdAt",e.actor_type AS "actorType",u.name AS "actorName" FROM message_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.organization_id=$1 AND e.message_id=$2 ORDER BY e.id',
          [req.actor.org, req.params.id],
        )
      ).rows,
    );
  });
  app.get("/api/messages/:id/notes", human, async (req, res) => {
    await accessible(db, req.actor, req.params.id);
    res.json(
      (
        await db.query(
          'SELECT n.id,n.body,n.created_at AS "createdAt",u.name AS "authorName" FROM notes n JOIN users u ON u.id=n.author_id WHERE n.organization_id=$1 AND n.message_id=$2 ORDER BY n.created_at',
          [req.actor.org, req.params.id],
        )
      ).rows,
    );
  });
  app.post("/api/messages/:id/notes", human, async (req, res) => {
    const b = z.object({ body: text.max(20000) }).parse(req.body);
    await transaction(db, async (c) => {
      await accessible(c, req.actor, req.params.id, true);
      await c.query(
        "INSERT INTO notes(id,organization_id,message_id,author_id,body) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), req.actor.org, req.params.id, req.actor.id, b.body],
      );
      await event(c, req.actor.org, req.params.id, req.actor, "note_added", {});
    });
    res.status(201).json({ saved: true });
  });
  app.patch("/api/messages/:id", human, async (req, res) => {
    const b = z
      .object({
        status: z.enum(["Nou", "În lucru", "Rezolvat"]).optional(),
        assignedTo: uuid.nullable().optional(),
        skillId: uuid.nullable().optional(),
        priority: z.enum(["Scăzută", "Medie", "Ridicată"]).optional(),
      })
      .strict()
      .parse(req.body);
    if (
      req.actor.role !== "admin" &&
      Object.keys(b).some((k) => k !== "status")
    )
      throw fail(403, "Doar administratorul poate modifica repartizarea");
    await transaction(db, async (c) => {
      await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.actor.org,
      ]);
      const m = await accessible(c, req.actor, req.params.id, true);
      if (b.skillId) await requireSkill(c, req.actor.org, b.skillId);
      if (
        b.assignedTo &&
        !(
          await c.query(
            "SELECT 1 FROM users WHERE organization_id=$1 AND id=$2 AND active=true",
            [req.actor.org, b.assignedTo],
          )
        ).rowCount
      )
        throw fail(400, "Agent invalid");
      const fields = {
        status: "status",
        assignedTo: "assigned_to",
        skillId: "skill_id",
        priority: "priority",
      };
      for (const [key, value] of Object.entries(b)) {
        const column = fields[key];
        if (m[column] !== value) {
          await c.query(
            `UPDATE messages SET ${column}=$1,updated_at=now() WHERE id=$2`,
            [value, m.id],
          );
          await event(
            c,
            req.actor.org,
            m.id,
            req.actor,
            key === "assignedTo" ? "assigned" : "updated",
            { field: key, from: m[column], to: value, method: "manual" },
          );
        }
      }
    });
    res.status(204).end();
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Rută inexistentă" }),
  );
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "Date invalide",
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    if (err.code === "23505")
      return res.status(409).json({ error: "Înregistrarea există deja" });
    if (err.status)
      return res
        .status(err.status)
        .json({ error: err.status < 500 ? err.message : "Eroare internă" });
    console.error("API error:", err.code || err.name);
    res.status(500).json({ error: "Eroare internă" });
  });
  return app;
}
async function requireSkill(c, org, id) {
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
const dummyHash = hashPassword("unused-password-for-timing");
