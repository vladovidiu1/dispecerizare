import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDb, migrate } from "../db.js";
import { createApp } from "../app.js";
import { createRuleService, evaluateRules } from "../rules.js";
import { storeMessage, distributeWaiting } from "../messages.js";
import { createSenderService } from "../sender-service.js";
import { createVault } from "../vault.js";
import { hashPassword } from "../security.js";
const root = connectDb(process.env.TEST_DATABASE_URL),
  schema = "collab_" + randomUUID().replaceAll("-", ""),
  org = randomUUID(),
  otherOrg = randomUUID(),
  admin = randomUUID(),
  agent = randomUUID(),
  second = randomUUID(),
  outsider = randomUUID(),
  skill = randomUUID(),
  otherSkill = randomUUID(),
  mailbox = randomUUID();
let db,
  dir,
  vault,
  sender,
  rules,
  server,
  base,
  cookies = {},
  sent = [],
  sendMode = "ok",
  release,
  entered;
const actor = (id = agent) => ({
  id,
  org,
  role: id === admin ? "admin" : "agent",
  type: "user",
});
const providers = {
  verify: async (c) => ({ credentials: c }),
  send: async (c, m) => {
    sent.push(m);
    if (sendMode === "wait") {
      entered();
      await new Promise((r) => (release = r));
    }
    if (sendMode === "unknown")
      throw Object.assign(Error("network"), {
        code: "SEND_UNKNOWN",
        unknown: true,
      });
    if (sendMode === "reject")
      throw Object.assign(Error("rejected"), { code: "SEND_REJECTED" });
    return { credentials: c };
  },
};
async function req(path, { id = admin, method = "GET", body } = {}) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: cookies[id] || "",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
async function task(options = {}) {
  const { owner = agent, ...input } = options;
  const r = await storeMessage(
    db,
    { org, type: "system" },
    {
      mailboxId: mailbox,
      externalId: randomUUID(),
      internetMessageId: "<" + randomUUID() + "@client.test>",
      senderName: "Client",
      senderEmail: "client@example.test",
      subject: "Resetare parola",
      body: "Resetare parola utilizator.",
      receivedAt: new Date().toISOString(),
      ...input,
    },
  );
  if (owner)
    await db.query(
      "UPDATE messages SET assigned_to=$1,skill_id=$2 WHERE id=$3",
      [owner, skill, r.id],
    );
  return r.id;
}
async function configure(id = agent) {
  return sender.configure(actor(id), {
    provider: "gmail",
    address: id + "@gmail.com",
    appPassword: "fixture-app-password",
  });
}
const reply = (
  id,
  requestId = randomUUID(),
  body = "Am rezolvat solicitarea dumneavoastră.",
) => sender.queue(actor(), id, { requestId, body });
const state = async (id) =>
  (await db.query("SELECT * FROM outgoing_mail WHERE id=$1", [id])).rows[0];
before(async () => {
  await root.query("CREATE SCHEMA " + schema);
  const u = new URL(process.env.TEST_DATABASE_URL);
  u.searchParams.set("options", "-c search_path=" + schema);
  db = connectDb(u.href);
  await migrate(db);
  await migrate(db);
  dir = await mkdtemp(join(tmpdir(), "relay-collab-"));
  vault = createVault(dir);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)", [
    org,
    "Collab",
    otherOrg,
    "Other",
  ]);
  for (const [id, o, role] of [
    [admin, org, "admin"],
    [agent, org, "agent"],
    [second, org, "agent"],
    [outsider, otherOrg, "admin"],
  ])
    await db.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role,capacity) VALUES($1,$2,$3,$4,$5,$6,100)",
      [
        id,
        o,
        id,
        id + "@example.test",
        hashPassword("fixture-password-1234"),
        role,
      ],
    );
  await db.query("INSERT INTO skills VALUES($1,$2,$3),($4,$2,$5)", [
    skill,
    org,
    "Acces",
    otherSkill,
    "Facturare",
  ]);
  for (const id of [agent, second])
    await db.query("INSERT INTO agent_skills VALUES($1,$2,$3)", [
      org,
      id,
      skill,
    ]);
  await db.query("INSERT INTO mailboxes VALUES($1,$2,$3,$4)", [
    mailbox,
    org,
    "gmail",
    "shared@example.test",
  ]);
  sender = createSenderService(db, {
    vault,
    providers,
    device: {
      request: async () => ({
        device_code: "secret-device",
        user_code: "USER-CODE",
        verification_uri: "https://microsoft.com/devicelogin",
        interval: 5,
        expires_in: 900,
      }),
      poll: async () => ({ refreshToken: "secret-refresh" }),
    },
  });
  rules = createRuleService(db);
  server = createApp(db, { ruleService: rules, senderService: sender }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  for (const id of [admin, agent, second, outsider]) {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: id === outsider ? otherOrg : org,
        email: id + "@example.test",
        password: "fixture-password-1234",
      }),
    });
    assert.equal(r.status, 200);
    cookies[id] = r.headers.get("set-cookie").split(";")[0];
  }
});
after(async () => {
  release?.();
  if (server) await new Promise((r) => server.close(r));
  await db?.end();
  await root.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await root.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});
test("rules normalize accents, priority, all/any, exclusions, attachments and fail closed on conflicts", () => {
  const a = {
      id: "a",
      enabled: true,
      priority: 100,
      matchMode: "all",
      skillId: skill,
      conditions: [
        { field: "subject", operator: "contains", value: "FACTURĂ" },
        { field: "senderDomain", operator: "equals", value: "example.test" },
      ],
    },
    b = { ...a, id: "b", skillId: otherSkill };
  const m = {
    senderEmail: "client@example.test",
    subject: "Detalii factura nouă",
    body: "Text",
  };
  assert.equal(evaluateRules([a], m).skillId, skill);
  assert.equal(evaluateRules([a, b], m).outcome, "ambiguous");
  assert.equal(evaluateRules([a, { ...b, priority: 101 }], m).skillId, skill);
  assert.equal(
    evaluateRules([{ ...a, enabled: false }], m).outcome,
    "no_match",
  );
  assert.equal(
    evaluateRules(
      [
        {
          ...a,
          matchMode: "any",
          conditions: [
            { field: "body", operator: "starts_with", value: "Text" },
            { field: "subject", operator: "equals", value: "no" },
          ],
        },
      ],
      m,
    ).outcome,
    "matched",
  );
  assert.equal(
    evaluateRules(
      [
        {
          ...a,
          conditions: [
            {
              field: "attachmentName",
              operator: "equals",
              value: "raport.xlsx",
            },
          ],
        },
      ],
      { ...m, attachmentNames: ["nota.pdf", "raport.xlsx"] },
    ).outcome,
    "matched",
  );
  assert.equal(
    evaluateRules(
      [
        {
          ...a,
          conditions: [
            {
              field: "attachmentName",
              operator: "not_contains",
              value: ".exe",
            },
          ],
        },
      ],
      { ...m, attachmentNames: ["nota.pdf", "run.exe"] },
    ).outcome,
    "no_match",
  );
});
test("rule CRUD is admin and organization scoped; rule dispatch balances same-skill agents and preserves decision snapshot on deletion", async () => {
  const input = {
    name: "Resetare",
    enabled: true,
    skillId: skill,
    conditions: [{ field: "text", operator: "contains", value: "resetare" }],
  };
  assert.equal(
    (await req("/dispatch-rules", { id: agent, method: "POST", body: input }))
      .status,
    403,
  );
  const r = await req("/dispatch-rules", { method: "POST", body: input });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await req("/dispatch-rules/" + r.data.id, {
        id: outsider,
        method: "PUT",
        body: input,
      })
    ).status,
    404,
  );
  const ids = await Promise.all(
    Array.from({ length: 20 }, () => task({ owner: null })),
  );
  await Promise.all(ids.map((id) => rules.process(org, id)));
  const rows = (
    await db.query(
      "SELECT assigned_to,count(*)::int n FROM messages WHERE id=ANY($1::uuid[]) GROUP BY assigned_to",
      [ids],
    )
  ).rows;
  assert.deepEqual(rows.map((r) => r.n).sort(), [10, 10]);
  await req("/dispatch-rules/" + r.data.id, { method: "DELETE" });
  const decision = (
    await db.query("SELECT * FROM rule_decisions WHERE message_id=$1", [ids[0]])
  ).rows[0];
  assert.equal(decision.rule_id, null);
  assert.equal(decision.detail.matchedRules[0].name, "Resetare");
  assert.equal((await db.query("SELECT 1 FROM classifications")).rowCount, 0);
});
test("conflicts and absent rules remain unassigned; human decisions and existing owners are never overridden", async () => {
  const input = {
    name: "Conflict",
    enabled: true,
    skillId: skill,
    conditions: [{ field: "text", operator: "contains", value: "resetare" }],
  };
  const a = await rules.save(org, input),
    b = await rules.save(org, { ...input, skillId: otherSkill });
  const id = await task({ owner: null });
  assert.equal((await rules.process(org, id)).outcome, "ambiguous");
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [id]))
      .rows[0].assigned_to,
    null,
  );
  await db.query(
    "UPDATE messages SET skill_id=$1,tag_source='human' WHERE id=$2",
    [skill, id],
  );
  assert.equal((await rules.process(org, id)).cancelled, true);
  const owned = await task();
  assert.equal((await rules.process(org, owned)).cancelled, true);
  await req("/dispatch-rules/" + a.id, { method: "DELETE" });
  await req("/dispatch-rules/" + b.id, { method: "DELETE" });
  const no = await task({ owner: null });
  assert.equal((await rules.process(org, no)).outcome, "no_match");
});
test("resolutions persist immutably, can resolve work, and only shared resolved solutions become lexical suggestions", async () => {
  const first = await task(),
    next = await task();
  const data = {
    summary: "Resetare parola utilizator",
    steps: "Verifică identitatea și resetează parola utilizatorului.",
    shareable: true,
    resolveTask: true,
  };
  assert.equal(
    (
      await req("/messages/" + first + "/resolutions", {
        id: second,
        method: "POST",
        body: data,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/messages/" + first + "/resolutions", {
        id: agent,
        method: "POST",
        body: data,
      })
    ).status,
    201,
  );
  const list = await req("/messages/" + first + "/resolutions", { id: agent });
  assert.equal(list.data[0].steps, data.steps);
  assert.equal(
    (await db.query("SELECT status FROM messages WHERE id=$1", [first])).rows[0]
      .status,
    "Rezolvat",
  );
  let suggestions = await req("/messages/" + next + "/suggestions", {
    id: agent,
  });
  assert.ok(suggestions.data.some((s) => s.summary === data.summary));
  assert.ok(
    suggestions.data.every((s) => !("messageId" in s) && !("body" in s)),
  );
  const privateTask = await task();
  await req("/messages/" + privateTask + "/resolutions", {
    id: agent,
    method: "POST",
    body: { ...data, summary: "Resetare parola secret", shareable: false },
  });
  suggestions = await req("/messages/" + next + "/suggestions", { id: agent });
  assert.ok(
    !suggestions.data.some((s) => s.summary === "Resetare parola secret"),
  );
  assert.equal(
    (await req("/messages/" + first + "/resolutions", { id: outsider })).status,
    404,
  );
});
test("handover requires current owner and active same-org recipient; preserves skill and complete handover reason", async () => {
  const id = await task();
  await db.query("UPDATE messages SET status='În lucru' WHERE id=$1", [id]);
  for (const [who, to, expected] of [
    [second, second, 404],
    [agent, outsider, 400],
    [agent, agent, 400],
  ])
    assert.equal(
      (
        await req("/messages/" + id + "/transfer", {
          id: who,
          method: "POST",
          body: { assignedTo: to, reason: "Am efectuat prima verificare." },
        })
      ).status,
      expected,
    );
  await db.query("UPDATE users SET active=false WHERE id=$1", [second]);
  assert.equal(
    (
      await req("/messages/" + id + "/transfer", {
        id: agent,
        method: "POST",
        body: { assignedTo: second, reason: "Verificare finală necesară" },
      })
    ).status,
    400,
  );
  await db.query("UPDATE users SET active=true WHERE id=$1", [second]);
  assert.equal(
    (
      await req("/messages/" + id + "/transfer", {
        id: agent,
        method: "POST",
        body: {
          assignedTo: second,
          reason: "Am verificat datele. Colegul trebuie să confirme accesul.",
        },
      })
    ).status,
    204,
  );
  const m = (await db.query("SELECT * FROM messages WHERE id=$1", [id]))
    .rows[0];
  assert.equal(m.assigned_to, second);
  assert.equal(m.status, "Nou");
  assert.equal(m.skill_id, skill);
  assert.equal(
    (await req("/messages/" + id + "/conversation", { id: agent })).status,
    404,
  );
  assert.equal(
    (await req("/messages/" + id + "/conversation", { id: second })).status,
    200,
  );
  const event = (
    await db.query(
      "SELECT data FROM message_events WHERE message_id=$1 AND type='assigned' ORDER BY id DESC LIMIT 1",
      [id],
    )
  ).rows[0].data;
  assert.equal(event.method, "handover");
  assert.ok(event.reason.includes("Colegul"));
  assert.equal(event.previousStatus, "În lucru");
});
test("sender identities encrypt secrets, isolate each user and reject arbitrary SMTP destinations", async () => {
  await configure();
  const profile = (await req("/sender-account", { id: agent })).data;
  assert.equal(profile.authorized, true);
  assert.ok(!JSON.stringify(profile).includes("fixture-app-password"));
  assert.equal((await req("/sender-account", { id: second })).data, null);
  const row = (
    await db.query(
      "SELECT encrypted_credentials FROM sender_accounts WHERE user_id=$1",
      [agent],
    )
  ).rows[0];
  assert.ok(!row.encrypted_credentials.includes("fixture-app-password"));
  assert.equal(
    (await vault.open(row.encrypted_credentials)).appPassword,
    "fixture-app-password",
  );
  assert.equal(
    (
      await req("/sender-account", {
        id: agent,
        method: "PUT",
        body: {
          provider: "gmail",
          address: "test@gmail.com",
          appPassword: "x",
          host: "attacker.test",
        },
      })
    ).status,
    400,
  );
});
test("reply uses original sender and RFC headers, is idempotent, and sends exactly once through outbox", async () => {
  const id = await task();
  const original = (
    await db.query(
      "SELECT * FROM mail_entries WHERE message_id=$1 AND direction='inbound'",
      [id],
    )
  ).rows[0];
  await storeMessage(
    db,
    { org, type: "system" },
    {
      mailboxId: mailbox,
      externalId: randomUUID(),
      internetMessageId: "<update@client.test>",
      inReplyTo: original.internet_message_id,
      senderName: "Other",
      senderEmail: "other@example.test",
      subject: "Re: Resetare parola",
      body: "Actualizare",
      receivedAt: new Date().toISOString(),
    },
  );
  const key = randomUUID(),
    a = await reply(id, key),
    b = await reply(id, key);
  assert.equal(a.id, b.id);
  assert.equal(b.duplicate, true);
  await assert.rejects(() => reply(id, key, "Alt text"), { status: 409 });
  const before = sent.length;
  await sender.processDue();
  await sender.processDue();
  assert.equal(sent.length, before + 1);
  const mail = await state(a.id);
  assert.equal(mail.state, "sent");
  assert.equal(mail.from_address, agent + "@gmail.com");
  assert.equal(mail.to_address, "client@example.test");
  assert.equal(mail.reply_to_address, "shared@example.test");
  assert.equal(mail.in_reply_to, original.internet_message_id);
  assert.deepEqual(mail.reference_ids, [original.internet_message_id]);
  const c = await req("/messages/" + id + "/conversation", { id: agent });
  assert.equal(c.data.replyContext.to, "client@example.test");
  assert.equal(c.data.replyContext.canReply, true);
  assert.equal(
    c.data.entries.filter((e) => e.direction === "outbound").length,
    1,
  );
  const echo = await storeMessage(
    db,
    { org, type: "system" },
    {
      mailboxId: mailbox,
      externalId: randomUUID(),
      internetMessageId: mail.internet_message_id,
    },
  );
  assert.equal(echo.duplicate, true);
  const incoming = await storeMessage(
    db,
    { org, type: "system" },
    {
      mailboxId: mailbox,
      externalId: randomUUID(),
      internetMessageId: "<new-reply@client.test>",
      inReplyTo: mail.internet_message_id,
      senderName: "Client",
      senderEmail: "client@example.test",
      subject: "Re: Resetare parola",
      body: "Multumesc",
      receivedAt: new Date().toISOString(),
    },
  );
  assert.equal(incoming.id, id);
  assert.equal(incoming.updated, true);
});
test("outbox never auto-retries ambiguous sends; audit reconciliation permits explicit resend only after verification", async () => {
  sendMode = "unknown";
  const id = await task(),
    r = await reply(id);
  const before = sent.length;
  await sender.processDue();
  assert.equal((await state(r.id)).state, "unknown");
  await sender.processDue();
  assert.equal(sent.length, before + 1);
  await assert.rejects(() => reply(id), { status: 409 });
  assert.equal(
    (
      await req("/outgoing-mail/" + r.id + "/reconcile", {
        id: second,
        method: "POST",
        body: {
          result: "not_sent",
          note: "Verificat în contul expeditorului.",
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/outgoing-mail/" + r.id + "/reconcile", {
        id: agent,
        method: "POST",
        body: {
          result: "not_sent",
          note: "Verificat cu administratorul, mesajul nu a fost acceptat.",
        },
      })
    ).status,
    200,
  );
  assert.equal((await state(r.id)).state, "failed");
  sendMode = "ok";
  const next = await reply(id);
  await sender.processDue();
  assert.equal((await state(next.id)).state, "sent");
});
test("expired send lease becomes unknown without network calls; manual sent confirmation creates one conversation entry", async () => {
  const id = await task(),
    r = await reply(id);
  await db.query(
    "UPDATE outgoing_mail SET state='sending',lease_until=now()-interval '1 minute' WHERE id=$1",
    [r.id],
  );
  const before = sent.length;
  await sender.processDue();
  assert.equal(sent.length, before);
  assert.equal((await state(r.id)).state, "unknown");
  await sender.reconcile(actor(), r.id, {
    result: "sent",
    note: "Confirmat în folderul Sent al contului.",
  });
  assert.equal((await state(r.id)).state, "sent");
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM mail_entries WHERE id=$1 AND direction='outbound'",
        [r.id],
      )
    ).rowCount,
    1,
  );
});
test("handover cancels queued messages and in-flight send blocks reassignment and sender reconfiguration", async () => {
  const id = await task(),
    r = await reply(id);
  assert.equal(
    (
      await req("/messages/" + id + "/transfer", {
        id: agent,
        method: "POST",
        body: {
          assignedTo: second,
          reason: "Predau pentru verificarea finală.",
        },
      })
    ).status,
    204,
  );
  assert.equal((await state(r.id)).state, "cancelled");
  const busy = await task(),
    queued = await reply(busy);
  sendMode = "wait";
  const started = new Promise((r) => (entered = r)),
    processing = sender.processDue();
  await started;
  try {
    assert.equal(
      (
        await req("/messages/" + busy + "/transfer", {
          id: agent,
          method: "POST",
          body: { assignedTo: second, reason: "Predau pentru verificare" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("/messages/" + busy, {
          method: "PATCH",
          body: { assignedTo: second },
        })
      ).status,
      409,
    );
    await assert.rejects(() => configure(), { status: 409 });
  } finally {
    release();
    await processing;
    sendMode = "ok";
  }
  assert.equal((await state(queued.id)).state, "sent");
});
test("missing source headers prevent email; changed sender identity cancels queued mail before provider call", async () => {
  const no = await task({ internetMessageId: null });
  await assert.rejects(() => reply(no), { status: 400 });
  const id = await task(),
    r = await reply(id);
  await configure();
  const before = sent.length;
  await sender.processDue();
  assert.equal(sent.length, before);
  assert.equal((await state(r.id)).state, "cancelled");
});
test("Microsoft sender authorization is user-bound and keeps tokens private", async () => {
  const a = actor(second);
  await sender.configure(a, {
    provider: "outlook",
    address: second + "@example.test",
    clientId: randomUUID(),
  });
  const f = await sender.authorize(a);
  assert.equal(f.userCode, "USER-CODE");
  assert.ok(!JSON.stringify(f).includes("secret-device"));
  assert.equal((await sender.poll(a, f.flowId)).pending, true);
  await assert.rejects(() => sender.poll(actor(), f.flowId), { status: 404 });
  const now = Date.now;
  try {
    Date.now = () => now() + 6000;
    assert.equal((await sender.poll(a, f.flowId)).ok, true);
  } finally {
    Date.now = now;
  }
  const p = await sender.profile(a);
  assert.equal(p.authorized, true);
  assert.ok(!JSON.stringify(p).includes("secret-refresh"));
});

test("upgrade 003 to 004 preserves AI examples, classifications and old jobs while migrating only eligible work", async () => {
  const upgrade = "upgrade_" + randomUUID().replaceAll("-", "");
  await root.query("CREATE SCHEMA " + upgrade);
  const u = new URL(process.env.TEST_DATABASE_URL);
  u.searchParams.set("options", "-c search_path=" + upgrade);
  const d = connectDb(u.href);
  try {
    await d.query(
      "CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const [v, file] of [
      ["001", "001_initial.sql"],
      ["002", "002_mail_learning.sql"],
      ["003", "003_workflows.sql"],
    ]) {
      await d.query(
        await readFile(
          new URL("../migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
      await d.query("INSERT INTO schema_migrations(version) VALUES($1)", [v]);
    }
    const o = randomUUID(),
      s = randomUUID(),
      box = randomUUID(),
      m = randomUUID(),
      example = randomUUID(),
      cl = randomUUID();
    await d.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      o,
      "Historical",
    ]);
    await d.query("INSERT INTO skills VALUES($1,$2,$3)", [
      s,
      o,
      "Historical skill",
    ]);
    await d.query("INSERT INTO mailboxes VALUES($1,$2,$3,$4)", [
      box,
      o,
      "gmail",
      "history@example.test",
    ]);
    await d.query(
      "INSERT INTO messages(id,organization_id,mailbox_id,external_id,sender_name,sender_email,subject,body,received_at,skill_id,tag_source) VALUES($1,$2,$3,'historical','Client','client@example.test','Old subject','Old text',now(),$4,'ai')",
      [m, o, box, s],
    );
    await d.query(
      "INSERT INTO classifications(id,organization_id,message_id,skill_id,confidence,model,prompt_version,reason) VALUES($1,$2,$3,$4,0.9,'old-qwen','old-v1','historical')",
      [cl, o, m, s],
    );
    await d.query(
      "INSERT INTO classification_examples VALUES($1,$2,$3,'Example','Example body')",
      [example, o, s],
    );
    await d.query(
      "INSERT INTO processing_jobs(message_id,organization_id,state) VALUES($1,$2,'retry')",
      [m, o],
    );
    const before = (
      await d.query("SELECT row_to_json(c) data FROM classifications c")
    ).rows[0].data;
    await migrate(d);
    await migrate(d);
    assert.deepEqual(
      (await d.query("SELECT row_to_json(c) data FROM classifications c"))
        .rows[0].data,
      before,
    );
    assert.equal(
      (await d.query("SELECT id FROM classification_examples")).rows[0].id,
      example,
    );
    assert.equal(
      (await d.query("SELECT state FROM processing_jobs")).rows[0].state,
      "retry",
    );
    assert.equal(
      (await d.query("SELECT state FROM dispatch_jobs")).rows[0].state,
      "pending",
    );
    assert.equal(
      (await d.query("SELECT tag_source FROM messages")).rows[0].tag_source,
      "ai",
    );
  } finally {
    await d.end();
    await root.query("DROP SCHEMA " + upgrade + " CASCADE");
  }
});

test("unreadable sender vault fails visibly before network send", async () => {
  const id = await task(),
    r = await reply(id);
  const row = (
    await db.query(
      "SELECT encrypted_credentials FROM sender_accounts WHERE user_id=$1",
      [agent],
    )
  ).rows[0];
  await db.query(
    "UPDATE sender_accounts SET encrypted_credentials='corrupt-fixture' WHERE user_id=$1",
    [agent],
  );
  const before = sent.length;
  try {
    await sender.processDue();
    assert.equal(sent.length, before);
    assert.equal((await state(r.id)).state, "failed");
    assert.equal((await state(r.id)).last_error, "SEND_VAULT");
  } finally {
    await db.query(
      "UPDATE sender_accounts SET encrypted_credentials=$1 WHERE user_id=$2",
      [row.encrypted_credentials, agent],
    );
  }
});
