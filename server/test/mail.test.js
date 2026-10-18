import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDb, migrate } from "../db.js";
import { createVault } from "../vault.js";
import { createMailService } from "../mail-service.js";
import { createApp } from "../app.js";
import { createAiRunner, startWorkers } from "../ai-runner.js";
import { getContext } from "../context.js";
import { hashPassword } from "../security.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw Error("TEST_DATABASE_URL required");
const root = connectDb(url),
  schema = "mail_" + randomUUID().replaceAll("-", "");
let db,
  dir,
  vault,
  service,
  server,
  base,
  cookie,
  agentCookie,
  connectionId,
  mailboxId,
  runner;
const org = randomUUID(),
  otherOrg = randomUUID(),
  admin = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  sa = randomUUID(),
  sb = randomUUID(),
  password = "fixture-password-1234";
let remoteMessages = [],
  providerFailure = false,
  modelFailure = false,
  blockModel = false,
  releaseModel,
  captured;
let deviceCalls = 0;
const providers = {
  check: async (c) => {
    if (providerFailure)
      throw Object.assign(new Error("Fixture offline"), {
        code: "MAIL_NETWORK",
        status: 400,
      });
    return { credentials: c, account: c.address };
  },
  scan: async (row, c) => {
    if (providerFailure)
      throw Object.assign(new Error("Offline"), {
        code: "MAIL_NETWORK",
        status: 400,
      });
    return {
      credentials: c,
      messages: remoteMessages,
      state: { cursor: "fixture-next" },
    };
  },
  search: async (row, c, q) => ({
    credentials: c,
    messages: remoteMessages.filter((m) => m.subject.includes(q)),
  }),
  read: async (row, c, ids) => ({
    credentials: c,
    messages: remoteMessages.filter((m) => ids.includes(m.externalId)),
  }),
};
const ollama = {
  status: async () => ({ installed: true }),
  classify: async (input) => {
    captured = input;
    if (blockModel) await new Promise((r) => (releaseModel = r));
    if (modelFailure)
      throw Object.assign(new Error("Fixture offline"), {
        code: "OLLAMA_UNAVAILABLE",
      });
    return {
      skillId: sa,
      confidence: 0.97,
      reason: "Fixture factură",
      model: "fixture",
      promptVersion: "v-test",
    };
  },
};
async function request(
  path,
  { body, method = body ? "POST" : "GET", session = cookie } = {},
) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: r.status === 204 ? null : await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const raw = (id, subject = "Factură importantă") => ({
  externalId: id,
  senderName: "Client",
  senderEmail: "client@example.test",
  subject,
  body: "Vreau detalii despre factura emisă.",
  receivedAt: new Date().toISOString(),
});
async function waitFor(fn) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Condition did not complete");
}
before(async () => {
  await root.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(url);
  u.searchParams.set("options", "-c search_path=" + schema);
  db = connectDb(u.href);
  await migrate(db);
  await migrate(db);
  dir = await mkdtemp(join(tmpdir(), "relay-vault-"));
  vault = createVault(dir);
  service = createMailService(db, {
    vault,
    providers,
    device: {
      request: async () => ({
        device_code: "private-device-fixture",
        user_code: "TEST-CODE",
        verification_uri: "https://microsoft.com/devicelogin",
        interval: 5,
        expires_in: 900,
      }),
      poll: async () => {
        deviceCalls++;
        return {
          accessToken: "private-access-fixture",
          refreshToken: "private-refresh-fixture",
        };
      },
      verify: async () => "admin@example.test",
    },
  });
  runner = createAiRunner(db, ollama);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)", [
    org,
    "Mail firm",
    otherOrg,
    "Other firm",
  ]);
  for (const [id, name, email, role] of [
    [admin, "Admin", "admin@example.test", "admin"],
    [a, "Agent A", "a@example.test", "agent"],
    [b, "Agent B", "b@example.test", "agent"],
  ])
    await db.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)",
      [id, org, name, email, hashPassword(password), role],
    );
  await db.query("INSERT INTO skills VALUES($1,$2,$3),($4,$2,$5)", [
    sa,
    org,
    "Facturare",
    sb,
    "Suport",
  ]);
  await db.query("INSERT INTO agent_skills VALUES($1,$2,$3),($1,$4,$5)", [
    org,
    a,
    sa,
    b,
    sb,
  ]);
  server = createApp(db, {
    ollama,
    aiRunner: runner,
    mailService: service,
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  cookie = (
    await request("/auth/login", {
      body: { organizationId: org, email: "admin@example.test", password },
    })
  ).cookie;
  agentCookie = (
    await request("/auth/login", {
      body: { organizationId: org, email: "a@example.test", password },
    })
  ).cookie;
});
after(async () => {
  releaseModel?.();
  if (server) await new Promise((r) => server.close(r));
  await db?.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
  await rm(dir, { recursive: true, force: true });
});
test("mail credentials are encrypted, never returned, organization scoped, and admin only", async () => {
  const c = await request("/mail-connections", {
    body: {
      provider: "gmail",
      address: "inbox@example.test",
      appPassword: "fixture-app-password",
      initialDays: 1,
      pollSeconds: 60,
    },
  });
  assert.equal(c.status, 201);
  connectionId = c.data.id;
  const row = (
    await db.query("SELECT * FROM mailbox_connections WHERE id=$1", [
      connectionId,
    ])
  ).rows[0];
  mailboxId = row.mailbox_id;
  assert.ok(!row.encrypted_credentials.includes("fixture-app-password"));
  assert.equal(
    (await vault.open(row.encrypted_credentials)).appPassword,
    "fixture-app-password",
  );
  const listing = await request("/mail-connections");
  assert.ok(!JSON.stringify(listing.data).includes("password"));
  assert.ok(!JSON.stringify(listing.data).includes("encrypted_credentials"));
  assert.equal(
    (await request("/mail-connections", { session: agentCookie })).status,
    403,
  );
  await assert.rejects(() => service.sync(connectionId, otherOrg), {
    status: 404,
  });
  const wrong = createVault(join(dir, "wrong"));
  await assert.rejects(() => wrong.open(row.encrypted_credentials));
});
test("sync and remote search import into a persistent queue without duplicate tasks or cursor loss", async () => {
  remoteMessages = [raw("source-1")];
  assert.equal(
    (
      await request("/mail-connections/" + connectionId + "/check", {
        method: "POST",
      })
    ).status,
    200,
  );
  const sync = await request("/mail-connections/" + connectionId + "/sync", {
    method: "POST",
  });
  assert.equal(sync.data.imported, 1);
  assert.equal(
    (
      await request("/mail-connections/" + connectionId + "/sync", {
        method: "POST",
      })
    ).data.imported,
    0,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM processing_jobs")).rows[0].n,
    1,
  );
  const found = await request("/mail-connections/" + connectionId + "/search", {
    body: { query: "Factură" },
  });
  assert.equal(found.data.items.length, 1);
  assert.ok(!("body" in found.data.items[0]));
  assert.equal(
    (
      await request("/mail-connections/" + connectionId + "/import", {
        body: { externalIds: ["source-1"] },
      })
    ).data.imported,
    0,
  );
  providerFailure = true;
  assert.equal(
    (
      await request("/mail-connections/" + connectionId + "/sync", {
        method: "POST",
      })
    ).status,
    400,
  );
  const row = (
    await db.query(
      "SELECT sync_state,last_error FROM mailbox_connections WHERE id=$1",
      [connectionId],
    )
  ).rows[0];
  assert.equal(row.sync_state.cursor, "fixture-next");
  assert.equal(row.last_error, "MAIL_NETWORK");
  providerFailure = false;
});
test("worker resumes persisted jobs, dispatches once, and does not learn unconfirmed AI labels", async () => {
  const stop = startWorkers(db, service, runner, { intervalMs: 20 });
  try {
    await waitFor(
      async () =>
        (
          await db.query(
            "SELECT count(*)::int n FROM processing_jobs WHERE state='done'",
          )
        ).rows[0].n === 1,
    );
  } finally {
    await stop();
  }
  const row = (
    await db.query("SELECT * FROM messages WHERE external_id='source-1'")
  ).rows[0];
  assert.equal(row.assigned_to, a);
  assert.equal(row.tag_source, "ai");
  assert.equal(
    (await getContext(db, org, "Factură importantă", row.body)).length,
    0,
  );
});
test("corrected human tag is authoritative, retrieved with current tag and supersedes contradictory seed example", async () => {
  const m = (
    await db.query("SELECT * FROM messages WHERE external_id='source-1'")
  ).rows[0];
  await request("/examples", {
    body: { skillId: sa, subject: m.subject, body: m.body },
  });
  assert.equal(
    (
      await request("/messages/" + m.id, {
        method: "PATCH",
        session: agentCookie,
        body: { skillId: sb },
      })
    ).status,
    204,
  );
  const current = (await db.query("SELECT * FROM messages WHERE id=$1", [m.id]))
    .rows[0];
  assert.equal(current.tag_source, "human");
  assert.equal(current.skill_id, sb);
  assert.equal(current.assigned_to, b);
  const context = await getContext(db, org, m.subject, m.body);
  assert.equal(context.length, 1);
  assert.equal(context[0].source, "human-confirmed");
  assert.equal(context[0].skillId, sb);
  assert.equal((await getContext(db, otherOrg, m.subject, m.body)).length, 0);
  assert.equal(
    (
      await request("/messages/" + m.id + "/retry-classification", {
        method: "POST",
      })
    ).status,
    409,
  );
  assert.equal((await runner.process(org, m.id)).cancelled, true);
});
test("a correction made during inference is not overwritten, and worker job is cancelled", async () => {
  remoteMessages = [raw("source-2", "Problemă nouă")];
  await service.sync(connectionId, org);
  const m = (
    await db.query("SELECT * FROM messages WHERE external_id='source-2'")
  ).rows[0];
  blockModel = true;
  releaseModel = null;
  const stop = startWorkers(db, service, runner, { intervalMs: 20 });
  try {
    await waitFor(() => !!releaseModel);
    assert.equal(
      (
        await request("/messages/" + m.id, {
          method: "PATCH",
          body: { skillId: sb, assignedTo: null },
        })
      ).status,
      204,
    );
    releaseModel();
    blockModel = false;
    await waitFor(
      async () =>
        (
          await db.query(
            "SELECT state FROM processing_jobs WHERE message_id=$1",
            [m.id],
          )
        ).rows[0].state === "cancelled",
    );
  } finally {
    releaseModel?.();
    blockModel = false;
    await stop();
  }
  const updated = (await db.query("SELECT * FROM messages WHERE id=$1", [m.id]))
    .rows[0];
  assert.equal(updated.tag_source, "human");
  assert.equal(updated.skill_id, sb);
  assert.equal(
    (
      await db.query("SELECT 1 FROM classifications WHERE message_id=$1", [
        m.id,
      ])
    ).rowCount,
    0,
  );
});
test("model outage retains task and schedules retry; admin can requeue after recovery", async () => {
  remoteMessages = [raw("source-3")];
  await service.sync(connectionId, org);
  const m = (
    await db.query("SELECT * FROM messages WHERE external_id='source-3'")
  ).rows[0];
  modelFailure = true;
  let stop = startWorkers(db, service, runner, { intervalMs: 20 });
  try {
    await waitFor(
      async () =>
        (
          await db.query(
            "SELECT state FROM processing_jobs WHERE message_id=$1",
            [m.id],
          )
        ).rows[0].state === "retry",
    );
  } finally {
    await stop();
  }
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [m.id]))
      .rows[0].assigned_to,
    null,
  );
  modelFailure = false;
  assert.equal(
    (
      await request("/messages/" + m.id + "/retry-classification", {
        method: "POST",
      })
    ).status,
    202,
  );
  stop = startWorkers(db, service, runner, { intervalMs: 20 });
  try {
    await waitFor(
      async () =>
        (
          await db.query(
            "SELECT state FROM processing_jobs WHERE message_id=$1",
            [m.id],
          )
        ).rows[0].state === "done",
    );
  } finally {
    await stop();
  }
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [m.id]))
      .rows[0].assigned_to,
    a,
  );
  assert.ok(captured.examples.some((e) => e.source === "human-confirmed"));
});
test("Microsoft device authorization binds flow to organization and never returns private device or refresh token", async () => {
  const id = (
    await service.create(org, {
      provider: "outlook",
      address: "shared@example.test",
      clientId: randomUUID(),
      shared: true,
    })
  ).id;
  const flow = await service.authorize(id, org);
  assert.equal(flow.userCode, "TEST-CODE");
  assert.ok(!JSON.stringify(flow).includes("private-device"));
  assert.equal(
    (await service.pollAuthorization(flow.flowId, org)).pending,
    true,
  );
  assert.equal(deviceCalls, 0);
  await assert.rejects(() => service.pollAuthorization(flow.flowId, otherOrg), {
    status: 404,
  });
  const now = Date.now;
  try {
    Date.now = () => now() + 6000;
    const result = await service.pollAuthorization(flow.flowId, org);
    assert.equal(result.ok, true);
    assert.ok(!JSON.stringify(result).includes("private-refresh"));
  } finally {
    Date.now = now;
  }
  const row = (
    await db.query("SELECT * FROM mailbox_connections WHERE id=$1", [id])
  ).rows[0];
  assert.equal(
    (await vault.open(row.encrypted_credentials)).refreshToken,
    "private-refresh-fixture",
  );
  assert.equal(
    (await service.list(org)).find((r) => r.id === id).authorized,
    true,
  );
  await service.disconnect(id, org);
  assert.equal(
    (await service.list(org)).find((r) => r.id === id).authorized,
    false,
  );
});
test("expired worker lease is recovered after an interrupted process", async () => {
  remoteMessages = [raw("source-after-crash")];
  await service.sync(connectionId, org);
  const m = (
    await db.query(
      "SELECT id FROM messages WHERE external_id='source-after-crash'",
    )
  ).rows[0];
  await db.query(
    "UPDATE processing_jobs SET state='running',attempts=1,lease_until=now()-interval '1 minute' WHERE message_id=$1",
    [m.id],
  );
  const stop = startWorkers(db, service, runner, { intervalMs: 20 });
  try {
    await waitFor(
      async () =>
        (
          await db.query(
            "SELECT state FROM processing_jobs WHERE message_id=$1",
            [m.id],
          )
        ).rows[0].state === "done",
    );
  } finally {
    await stop();
  }
  assert.equal(
    (
      await db.query(
        "SELECT attempts FROM processing_jobs WHERE message_id=$1",
        [m.id],
      )
    ).rows[0].attempts,
    2,
  );
});
test("human can confirm a correct AI label without redispatch and direct classification cannot overwrite it", async () => {
  const m = (
    await db.query(
      "SELECT * FROM messages WHERE external_id='source-after-crash'",
    )
  ).rows[0];
  const count = (
    await db.query(
      "SELECT count(*)::int n FROM classifications WHERE message_id=$1",
      [m.id],
    )
  ).rows[0].n;
  assert.equal(
    (
      await request("/messages/" + m.id + "/confirm-tag", {
        method: "POST",
        session: agentCookie,
      })
    ).status,
    204,
  );
  const updated = (await db.query("SELECT * FROM messages WHERE id=$1", [m.id]))
    .rows[0];
  assert.equal(updated.tag_source, "human");
  assert.equal(updated.assigned_to, m.assigned_to);
  assert.equal((await runner.process(org, m.id)).cancelled, true);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM classifications WHERE message_id=$1",
        [m.id],
      )
    ).rows[0].n,
    count,
  );
});
test("monitoring settings persist; disconnect/removal keep imported history", async () => {
  await service.update(connectionId, org, { enabled: true, pollSeconds: 30 });
  assert.equal(
    (await service.list(org)).find((r) => r.id === connectionId).enabled,
    true,
  );
  await service.disconnect(connectionId, org);
  const row = (await service.list(org)).find((r) => r.id === connectionId);
  assert.equal(row.enabled, false);
  assert.equal(row.authorized, false);
  assert.ok(
    (await db.query("SELECT 1 FROM messages WHERE mailbox_id=$1", [mailboxId]))
      .rowCount >= 3,
  );
  await service.remove(connectionId, org);
  assert.equal(
    (await service.list(org)).some((r) => r.id === connectionId),
    false,
  );
  assert.ok(
    (await db.query("SELECT 1 FROM messages WHERE mailbox_id=$1", [mailboxId]))
      .rowCount >= 3,
  );
});
