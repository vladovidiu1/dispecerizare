import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDb, migrate } from "../db.js";
import { createApp } from "../app.js";
import { createRuleService } from "../rules.js";
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
    await request("/keys", {
      method: "POST",
      body: { name: "Ingestion worker" },
    })
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
const payload = (id) => ({
  mailboxId: mailbox,
  externalId: id,
  senderName: "Client Test",
  senderEmail: "client@example.test",
  subject: "Clarificare factură",
  body: "Vă rog detalii despre factură.",
  receivedAt: new Date().toISOString(),
});
test("ingestion, rule routing, duplicate protection and decision history", async () => {
  await createRuleService(db).save(org, {
    name: "Facturi",
    skillId: skill,
    enabled: true,
    conditions: [{ field: "subject", operator: "contains", value: "factură" }],
  });
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
  await createRuleService(db).process(org, message);
  const items = (await request("/messages")).data.items;
  assert.equal(items[0].agentId, agent);
  const history = (await request("/messages/" + message + "/history")).data;
  assert.deepEqual(
    history.map((h) => h.type),
    ["received", "review_required", "rule_decision", "assigned"],
  );
  assert.equal(history[2].data.outcome, "matched");
  assert.equal((await request("/messages", { bearer: key.token })).status, 403);
});
test("pending rule jobs leave messages in review until processed", async () => {
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
  for (const r of results) await createRuleService(db).process(org, r.data.id);
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
test("disabled classification payload is rejected; key revocation and logout invalidate credentials", async () => {
  const p = payload("invalid");
  p.classification = {
    skillId: randomUUID(),
    confidence: 0.99,
    model: "disabled",
  };
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
      (h) => h.type === "rule_decision",
    ),
  );
});

test("unavailable agents stay queued and duplicate IDs are mailbox scoped", async () => {
  const k = (
    await request("/keys", { method: "POST", body: { name: "Queue" } })
  ).data;
  await db.query(
    "UPDATE messages SET status='Rezolvat' WHERE organization_id=$1",
    [org],
  );
  await request("/agents/" + agent, {
    method: "PATCH",
    body: { available: false },
  });
  const r = await request("/ingest", {
    method: "POST",
    bearer: k.token,
    body: payload("unavailable"),
  });
  assert.equal(r.status, 201);
  await createRuleService(db).process(org, r.data.id);
  assert.equal(
    (await request("/messages/" + r.data.id + "/history")).data.at(-1).data
      .reason,
    "no_eligible_agent",
  );
  await request("/agents/" + agent, {
    method: "PATCH",
    body: { available: true },
  });
  const m = (
    await request("/mailboxes", {
      method: "POST",
      body: { provider: "gmail", address: "second@example.test" },
    })
  ).data.id;
  assert.equal(
    (
      await request("/ingest", {
        method: "POST",
        bearer: k.token,
        body: { ...payload("external-1"), mailboxId: m },
      })
    ).status,
    201,
  );
  await request("/skills", {
    method: "POST",
    cookie: otherCookie,
    body: { name: "Private skill" },
  });
});

test("production requires HTTPS and sessions use Secure HttpOnly SameSite cookies", async () => {
  const productionServer = createApp(db, {
    production: true,
    trustProxyHops: 1,
    appOrigin: "https://relay.example.test",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => productionServer.once("listening", r));
  try {
    const direct = await fetch(
      "http://127.0.0.1:" + productionServer.address().port + "/api/auth/me",
    );
    assert.equal(direct.status, 403);
    const r = await fetch(
      "http://127.0.0.1:" + productionServer.address().port + "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-Proto": "https",
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

test("all former AI routes are disabled and never invoke injected model", async () => {
  let calls = 0;
  const s = createApp(db, {
    ollama: {
      status: async () => {
        calls++;
      },
      classify: async () => {
        calls++;
      },
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  try {
    for (const [path, method] of [
      ["/ai/status", "GET"],
      ["/ai/test", "POST"],
    ]) {
      const r = await fetch(
        "http://127.0.0.1:" + s.address().port + "/api" + path,
        { method, headers: { Cookie: adminCookie } },
      );
      assert.equal(r.status, 410);
    }
    assert.equal(calls, 0);
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test("agent retags own task with audited automatic routing, no model call, and admin can override any skill", async () => {
  let aiCalls = 0;
  const s = createApp(db, {
    ollama: {
      status: async () => ({ reachable: false }),
      classify: async () => {
        aiCalls++;
        throw Error("Model must not be called");
      },
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const call = async (
    path,
    { body, cookie = adminCookie, method = body ? "POST" : "GET" } = {},
  ) => {
    const r = await fetch(
      "http://127.0.0.1:" + s.address().port + "/api" + path,
      {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  };
  try {
    const target = (await call("/skills", { body: { name: "Retag target" } }))
        .data.id,
      empty = (await call("/skills", { body: { name: "Retag empty" } })).data
        .id;
    const next = (
      await call("/agents", {
        body: {
          name: "Retag Recipient",
          email: "retag@example.test",
          password,
          skills: [target],
          capacity: 1,
        },
      })
    ).data.id;
    const login = await fetch(
      "http://127.0.0.1:" + s.address().port + "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: org,
          email: "agent@example.test",
          password,
        }),
      },
    );
    const ownerCookie = login.headers.get("set-cookie").split(";")[0];
    await call("/messages/" + message, {
      method: "PATCH",
      body: { assignedTo: agent, status: "În lucru" },
    });
    const classificationsBefore = (
      await db.query(
        "SELECT count(*)::int AS n FROM classifications WHERE message_id=$1",
        [message],
      )
    ).rows[0].n;
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { skillId: target },
        })
      ).status,
      204,
    );
    const {
      rows: [m],
    } = await db.query("SELECT * FROM messages WHERE id=$1", [message]);
    assert.equal(m.skill_id, target);
    assert.equal(m.assigned_to, next);
    assert.equal(m.status, "Nou");
    assert.equal(
      (await call("/messages/" + message + "/history", { cookie: ownerCookie }))
        .status,
      404,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { skillId: empty },
        })
      ).status,
      404,
    );
    let events = (await call("/messages/" + message + "/history")).data;
    const tag = events.findLast((e) => e.data.field === "skillId");
    assert.equal(tag.actorName, "Agent Test");
    assert.equal(tag.data.from, skill);
    assert.equal(tag.data.to, target);
    assert.equal(events.at(-1).data.method, "tag-change");
    // An admin overrides skills, availability and capacity explicitly.
    await call("/agents/" + admin, {
      method: "PATCH",
      body: { available: false, capacity: 1 },
    });
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          body: { assignedTo: admin },
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await db.query("SELECT assigned_to FROM messages WHERE id=$1", [
          message,
        ])
      ).rows[0].assigned_to,
      admin,
    );
    await call("/messages/" + message, {
      method: "PATCH",
      body: { assignedTo: agent },
    });
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { assignedTo: next },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { priority: "Ridicată" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { skillId: null },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { skillId: empty, status: "Rezolvat" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          cookie: ownerCookie,
          body: { skillId: empty },
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await db.query("SELECT assigned_to FROM messages WHERE id=$1", [
          message,
        ])
      ).rows[0].assigned_to,
      null,
    );
    events = (await call("/messages/" + message + "/history")).data;
    assert.equal(events.at(-1).type, "review_required");
    assert.equal(events.at(-1).data.reason, "no_eligible_agent");
    const foreign = (
      await db.query("SELECT id FROM skills WHERE organization_id=$1 LIMIT 1", [
        otherOrg,
      ])
    ).rows[0].id;
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          body: { skillId: foreign },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/messages/" + message, {
          method: "PATCH",
          body: { skillId: target, assignedTo: admin },
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await db.query("SELECT assigned_to FROM messages WHERE id=$1", [
          message,
        ])
      ).rows[0].assigned_to,
      admin,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM classifications WHERE message_id=$1",
          [message],
        )
      ).rows[0].n,
      classificationsBefore,
    );
    assert.equal(aiCalls, 0);
  } finally {
    await new Promise((r) => s.close(r));
  }
});
