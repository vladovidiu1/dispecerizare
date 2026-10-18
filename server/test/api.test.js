import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDb, migrate } from "../db.js";
import { createApp } from "../app.js";
import { hashPassword } from "../security.js";
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL is required; tests create and remove an isolated schema",
  );
const root = connectDb(url),
  schema = "test_" + randomUUID().replaceAll("-", "");
let db,
  server,
  base,
  adminCookie,
  agentCookie,
  key,
  skill,
  mailbox,
  agent,
  message,
  otherCookie;
const org = randomUUID(),
  otherOrg = randomUUID(),
  admin = randomUUID(),
  otherAdmin = randomUUID();
const password = "test-only-password-123";
async function request(
  path,
  { cookie = adminCookie, bearer, method = "GET", body, origin } = {},
) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = "Bearer " + bearer;
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (origin) headers.Origin = origin;
  const r = await fetch(base + "/api" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? null : await r.json();
  return {
    status: r.status,
    data,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  await root.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(url);
  u.searchParams.set("options", "-c search_path=" + schema);
  db = connectDb(u.href);
  await migrate(db);
  await migrate(db);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)", [
    org,
    "Test firm",
    otherOrg,
    "Other firm",
  ]);
  for (const [id, o, e] of [
    [admin, org, "admin@example.test"],
    [otherAdmin, otherOrg, "other@example.test"],
  ])
    await db.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Admin',$3,$4,'admin')",
      [id, o, e, hashPassword(password)],
    );
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.end();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
});
test("authentication, origin protection, persistent sessions", async () => {
  assert.equal((await request("/messages", { cookie: null })).status, 401);
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: {
          organizationId: org,
          email: "admin@example.test",
          password: "wrong",
        },
      })
    ).status,
    401,
  );
  const r = await request("/auth/login", {
    method: "POST",
    body: { organizationId: org, email: "admin@example.test", password },
  });
  assert.equal(r.status, 200);
  adminCookie = r.cookie;
  assert.equal((await request("/auth/me")).data.id, admin);
  assert.equal(
    (
      await request("/skills", {
        method: "POST",
        origin: "https://untrusted.test",
        body: { name: "Bad" },
      })
    ).status,
    403,
  );
  otherCookie = (
    await request("/auth/login", {
      method: "POST",
      body: { organizationId: otherOrg, email: "other@example.test", password },
    })
  ).cookie;
});
test("skills, examples, agent and mailbox configuration", async () => {
  skill = (
    await request("/skills", { method: "POST", body: { name: "Facturare" } })
  ).data.id;
  assert.equal(
    (await request("/skills", { method: "POST", body: { name: "Facturare" } }))
      .status,
    409,
  );
  assert.equal(
    (
      await request("/examples", {
        method: "POST",
        body: { skillId: skill, subject: "Factură", body: "Vreau detalii." },
      })
    ).status,
    201,
  );
  agent = (
    await request("/agents", {
      method: "POST",
      body: {
        name: "Agent Test",
        email: "agent@example.test",
        password,
        skills: [skill],
        capacity: 1,
      },
    })
  ).data.id;
  mailbox = (
    await request("/mailboxes", {
      method: "POST",
      body: { provider: "gmail", address: "shared@example.test" },
    })
  ).data.id;
  key = (
    await request("/keys", { method: "POST", body: { name: "Ollama worker" } })
  ).data;
  assert.equal(
    (await request("/skills", { cookie: otherCookie })).data.length,
    0,
  );
  assert.equal(
    (
      await request("/agents", {
        method: "POST",
        cookie: otherCookie,
        body: {
          name: "Cross firm",
          email: "cross@example.test",
          password,
          skills: [skill],
        },
      })
    ).status,
    400,
  );
  agentCookie = (
    await request("/auth/login", {
      method: "POST",
      body: { organizationId: org, email: "agent@example.test", password },
    })
  ).cookie;
});
const payload = (id, confidence = 0.95) => ({
  mailboxId: mailbox,
  externalId: id,
  senderName: "Client Test",
  senderEmail: "client@example.test",
  subject: "Clarificare factură",
  body: "Vă rog detalii despre factură.",
  receivedAt: new Date().toISOString(),
  classification: {
    skillId: skill,
    confidence,
    model: "qwen:8b",
    promptVersion: "v1",
    reason: "Solicitare de facturare",
  },
});
test("ingestion, routing, duplicate protection and original classification history", async () => {
  const p = payload("external-1");
  const r = await request("/ingest", {
    method: "POST",
    bearer: key.token,
    body: p,
  });
  assert.equal(r.status, 201);
  message = r.data.id;
  const duplicate = await request("/ingest", {
    method: "POST",
    bearer: key.token,
    body: p,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.id, message);
  assert.equal(duplicate.data.duplicate, true);
  const items = (await request("/messages")).data.items;
  assert.equal(items[0].agentId, agent);
  const history = (await request("/messages/" + message + "/history")).data;
  assert.deepEqual(
    history.map((h) => h.type),
    ["received", "classified", "assigned"],
  );
  assert.equal(history[1].data.model, "qwen:8b");
  assert.equal((await request("/messages", { bearer: key.token })).status, 403);
});
test("capacity and low-confidence leave messages in review queue", async () => {
  await request("/ingest", {
    method: "POST",
    bearer: key.token,
    body: payload("capacity-full"),
  });
  await request("/ingest", {
    method: "POST",
    bearer: key.token,
    body: payload("low-confidence", 0.4),
  });
  const { items } = (await request("/messages")).data;
  assert.equal(items.filter((m) => m.agentId === agent).length, 1);
  assert.equal(items.filter((m) => m.agentId === null).length, 2);
  assert.equal(
    (await request("/messages", { cookie: agentCookie })).data.items.length,
    1,
  );
});
test("role and organization isolation, audit changes and internal notes", async () => {
  assert.equal(
    (
      await request("/messages/" + message + "/history", {
        cookie: otherCookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/messages/" + message, {
        method: "PATCH",
        cookie: agentCookie,
        body: { assignedTo: admin },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/agents", {
        method: "POST",
        cookie: agentCookie,
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/messages/" + message, {
        method: "PATCH",
        cookie: agentCookie,
        body: { status: "În lucru" },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await request("/messages/" + message + "/notes", {
        method: "POST",
        cookie: agentCookie,
        body: { body: "Am contactat clientul." },
      })
    ).status,
    201,
  );
  assert.equal(
    (await request("/messages/" + message + "/notes")).data[0].body,
    "Am contactat clientul.",
  );
  const events = (await request("/messages/" + message + "/history")).data;
  assert.equal(events.find((e) => e.type === "updated").data.from, "Nou");
  assert.equal(events.at(-1).actorName, "Agent Test");
  assert.equal(
    (
      await request("/messages/" + message, {
        method: "PATCH",
        body: { assignedTo: otherAdmin },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/messages/" + message, {
        method: "PATCH",
        body: { unknown: 1 },
      })
    ).status,
    400,
  );
});
test("concurrent ingestion respects capacity and idempotency", async () => {
  await request("/messages/" + message, {
    method: "PATCH",
    body: { status: "Rezolvat" },
  });
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      request("/ingest", {
        method: "POST",
        bearer: key.token,
        body: payload("concurrent-" + i),
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  const rows = (
    await db.query(
      "SELECT count(*)::int AS n FROM messages WHERE assigned_to=$1 AND status<>'Rezolvat'",
      [agent],
    )
  ).rows;
  assert.equal(rows[0].n, 1);
  const p = payload("same-concurrent");
  const duplicates = await Promise.all([
    request("/ingest", { method: "POST", bearer: key.token, body: p }),
    request("/ingest", { method: "POST", bearer: key.token, body: p }),
  ]);
  assert.deepEqual(duplicates.map((r) => r.status).sort(), [200, 201]);
  assert.equal(duplicates[0].data.id, duplicates[1].data.id);
});
test("invalid classification rolls back; key revocation and logout invalidate credentials", async () => {
  const p = payload("invalid");
  p.classification.skillId = randomUUID();
  assert.equal(
    (await request("/ingest", { method: "POST", bearer: key.token, body: p }))
      .status,
    400,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM messages WHERE external_id=$1", ["invalid"]))
      .rowCount,
    0,
  );
  assert.equal(
    (await request("/keys/" + key.id, { method: "DELETE" })).status,
    204,
  );
  assert.equal(
    (
      await request("/ingest", {
        method: "POST",
        bearer: key.token,
        body: payload("revoked"),
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/auth/logout", { method: "POST", cookie: agentCookie }))
      .status,
    204,
  );
  assert.equal(
    (await request("/auth/me", { cookie: agentCookie })).status,
    401,
  );
});

test("database survives API restart and sessions keep their original authorization", async () => {
  await new Promise((r) => server.close(r));
  await migrate(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await request("/auth/me")).data.id, admin);
  assert.equal(
    (await request("/messages/" + message + "/notes")).data[0].body,
    "Am contactat clientul.",
  );
  assert.ok(
    (await request("/messages/" + message + "/history")).data.some(
      (h) => h.type === "classified",
    ),
  );
});

test("unavailable agents, low confidence with free capacity, and source-specific duplicate IDs", async () => {
  const newKey = (
    await request("/keys", { method: "POST", body: { name: "Queue tests" } })
  ).data;
  await db.query(
    "UPDATE messages SET status='Rezolvat' WHERE organization_id=$1",
    [org],
  );
  await request("/agents/" + agent, {
    method: "PATCH",
    body: { available: false },
  });
  let r = await request("/ingest", {
    method: "POST",
    bearer: newKey.token,
    body: payload("unavailable"),
  });
  assert.equal(r.status, 201);
  assert.equal(
    (await request("/messages/" + r.data.id + "/history")).data.at(-1).data
      .reason,
    "no_eligible_agent",
  );
  await request("/agents/" + agent, {
    method: "PATCH",
    body: { available: true },
  });
  r = await request("/ingest", {
    method: "POST",
    bearer: newKey.token,
    body: payload("low-free", 0.1),
  });
  assert.equal(
    (await request("/messages/" + r.data.id + "/history")).data.at(-1).data
      .reason,
    "low_confidence",
  );
  const p = payload("unclassified");
  delete p.classification;
  r = await request("/ingest", {
    method: "POST",
    bearer: newKey.token,
    body: p,
  });
  assert.equal(
    (await request("/messages/" + r.data.id + "/history")).data.at(-1).data
      .reason,
    "unclassified",
  );
  const otherMailbox = (
    await request("/mailboxes", {
      method: "POST",
      body: { provider: "imap", address: "second@example.test" },
    })
  ).data.id;
  const duplicate = payload("external-1");
  duplicate.mailboxId = otherMailbox;
  assert.equal(
    (
      await request("/ingest", {
        method: "POST",
        bearer: newKey.token,
        body: duplicate,
      })
    ).status,
    201,
  );
  const foreignSkill = (
    await request("/skills", {
      cookie: otherCookie,
      method: "POST",
      body: { name: "Private skill" },
    })
  ).data.id;
  const foreign = payload("cross-tenant");
  foreign.classification.skillId = foreignSkill;
  assert.equal(
    (
      await request("/ingest", {
        method: "POST",
        bearer: newKey.token,
        body: foreign,
      })
    ).status,
    400,
  );
});

test("production sessions use Secure HttpOnly SameSite cookies", async () => {
  const productionServer = createApp(db, {
    production: true,
    appOrigin: "https://relay.example.test",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => productionServer.once("listening", r));
  try {
    const r = await fetch(
      "http://127.0.0.1:" + productionServer.address().port + "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://relay.example.test",
        },
        body: JSON.stringify({
          organizationId: org,
          email: "admin@example.test",
          password,
        }),
      },
    );
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(
      r.headers.get("content-security-policy"),
      /default-src 'self'/,
    );
  } finally {
    await new Promise((r) => productionServer.close(r));
  }
});

test("manual local-AI flow uses firm configuration, persists failures, deduplicates and restricts access", async () => {
  let calls = 0,
    captured,
    mode = "success",
    release;
  const ai = {
    status: async () => ({
      reachable: true,
      installed: true,
      model: "fixture:8b",
    }),
    classify: async (input) => {
      calls++;
      captured = input;
      if (mode === "wait")
        await new Promise((r) => {
          release = r;
        });
      if (mode === "fail")
        throw Object.assign(new Error("private failure"), {
          code: "OLLAMA_UNAVAILABLE",
        });
      return {
        skillId: skill,
        confidence: 0.95,
        model: "fixture:8b",
        promptVersion: "fixture-v1",
        reason: "Facturare",
      };
    },
  };
  const s = createApp(db, { ollama: ai }).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const call = async (path, body, cookie = adminCookie) => {
    const r = await fetch(
      "http://127.0.0.1:" + s.address().port + "/api" + path,
      {
        method: body ? "POST" : "GET",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: r.status, data: await r.json() };
  };
  const data = () => ({
    requestId: randomUUID(),
    senderName: "Client",
    senderEmail: "client@example.test",
    subject: "Factură",
    body: "Detalii factură",
  });
  try {
    await db.query(
      "UPDATE messages SET status='Rezolvat' WHERE organization_id=$1",
      [org],
    );
    assert.equal((await call("/ai/status")).data.installed, true);
    const input = data(),
      success = await call("/ai/test", input);
    assert.equal(success.status, 201);
    assert.equal(success.data.message.agentId, agent);
    assert.equal(captured.skills.length, 1);
    assert.equal(captured.skills[0].id, skill);
    assert.ok(captured.examples.length > 0);
    assert.equal((await call("/ai/test", input)).data.duplicate, true);
    assert.equal(calls, 1);
    mode = "fail";
    const failure = await call("/ai/test", data());
    assert.equal(failure.status, 201);
    assert.equal(failure.data.message.agentId, null);
    assert.ok(failure.data.warning);
    const events = await db.query(
      "SELECT type,data FROM message_events WHERE message_id=$1 ORDER BY id",
      [failure.data.id],
    );
    assert.equal(events.rows.at(-1).type, "classification_failed");
    assert.equal(events.rows.at(-1).data.reason, "OLLAMA_UNAVAILABLE");
    const freshCookie = (
      await request("/auth/login", {
        method: "POST",
        body: { organizationId: org, email: "agent@example.test", password },
      })
    ).cookie;
    assert.equal((await call("/ai/test", data(), freshCookie)).status, 403);
    assert.equal((await call("/ai/test", data(), otherCookie)).status, 201);
    assert.ok(captured.skills.every((s) => s.id !== skill));
    mode = "wait";
    const pending = call("/ai/test", data());
    for (let i = 0; i < 100 && !release; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(release);
    assert.equal((await call("/ai/test", data())).status, 409);
    release();
    assert.equal((await pending).status, 201);
  } finally {
    release?.();
    await new Promise((r) => s.close(r));
  }
});
