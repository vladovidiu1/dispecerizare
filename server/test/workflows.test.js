import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { connectDb, migrate, transaction } from "../db.js";
import { createApp } from "../app.js";
import { storeMessage, distributeWaiting } from "../messages.js";
import { createKnowledge } from "../knowledge.js";
import { createEmma } from "../emma.js";
import { createMailService } from "../mail-service.js";
import { createVault } from "../vault.js";
import { hashPassword } from "../security.js";
import { readWorkbook, rowsFromSheet } from "../excel.js";
import { createAiRunner } from "../ai-runner.js";
const root = connectDb(process.env.TEST_DATABASE_URL),
  schema = "workflows_" + randomUUID().replaceAll("-", ""),
  org = randomUUID(),
  otherOrg = randomUUID(),
  admin = randomUUID(),
  agent = randomUUID(),
  second = randomUUID(),
  outsider = randomUUID(),
  skill = randomUUID(),
  mailbox = randomUUID();
let db,
  server,
  base,
  adminCookie,
  agentCookie,
  otherCookie,
  dir,
  guideCalls = 0;
async function request(
  path,
  {
    cookie = adminCookie,
    method = "GET",
    body,
    origin,
    raw,
    type,
    filename,
  } = {},
) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  if (raw) {
    headers["Content-Type"] = type;
    headers["X-Filename"] = encodeURIComponent(filename || "fixture.pdf");
  } else if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(base + "/api" + path, {
    method,
    headers,
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  return {
    status: r.status,
    data:
      r.status === 204
        ? null
        : r.headers.get("content-type")?.includes("json")
          ? await r.json()
          : Buffer.from(await r.arrayBuffer()),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function save(input = {}) {
  return storeMessage(
    db,
    { org, type: "system" },
    {
      mailboxId: mailbox,
      externalId: randomUUID(),
      senderName: "Client",
      senderEmail: "client@example.test",
      subject: "Resetare parola cont",
      body: "Nu pot accesa contul, resetare parola utilizator.",
      receivedAt: new Date().toISOString(),
      priority: "Medie",
      ...input,
    },
  );
}
export function fixturePdf(
  text = "Resetare parola cont utilizator. Verifica identitatea si contractul. Deschide ecranul Resetare parola. Confirma modificarea.",
) {
  const content = `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`,
    objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = Buffer.byteLength(pdf);
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf);
}
before(async () => {
  await root.query("CREATE SCHEMA " + schema);
  const u = new URL(process.env.TEST_DATABASE_URL);
  u.searchParams.set("options", "-c search_path=" + schema);
  db = connectDb(u.href);
  await migrate(db);
  await migrate(db);
  dir = await mkdtemp(join(tmpdir(), "relay-workflows-"));
  await db.query("INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)", [
    org,
    "Workflows",
    otherOrg,
    "Other",
  ]);
  for (const [id, o, role, name] of [
    [admin, org, "admin", "Admin"],
    [agent, org, "agent", "Agent A"],
    [second, org, "agent", "Agent B"],
    [outsider, otherOrg, "admin", "Other"],
  ])
    await db.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role,capacity) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        o,
        name,
        id + "@example.test",
        hashPassword("fixture-password-1234"),
        role,
        id === agent ? 40 : 20,
      ],
    );
  await db.query("INSERT INTO skills VALUES($1,$2,$3)", [skill, org, "Acces"]);
  for (const id of [agent, second])
    await db.query("INSERT INTO agent_skills VALUES($1,$2,$3)", [
      org,
      id,
      skill,
    ]);
  await db.query("INSERT INTO mailboxes VALUES($1,$2,$3,$4)", [
    mailbox,
    org,
    "yahoo",
    "inbox@example.test",
  ]);
  const ollama = {
    status: async () => ({ reachable: true }),
    guide: async ({ sources }) => {
      guideCalls++;
      return {
        steps: [
          {
            text: "Verifică identitatea.",
            sourceId: sources[0].id,
            quote: sources[0].body.slice(0, 50),
          },
        ],
        model: "fixture",
      };
    },
  };
  server = createApp(db, {
    ollama,
    additionalOrigins: ["http://relay-pc:5173"],
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  for (const [id, which] of [
    [admin, "admin"],
    [agent, "agent"],
    [outsider, "other"],
  ]) {
    const r = await request("/auth/login", {
      method: "POST",
      body: {
        organizationId: id === outsider ? otherOrg : org,
        email: id + "@example.test",
        password: "fixture-password-1234",
      },
      cookie: null,
    });
    assert.equal(r.status, 200);
    if (which === "admin") adminCookie = r.cookie;
    if (which === "agent") agentCookie = r.cookie;
    if (which === "other") otherCookie = r.cookie;
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db?.end();
  await root.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await root.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});
test("equal task counts across same-skill agents with different capacities, including concurrent ingestion", async () => {
  await Promise.all(
    Array.from({ length: 20 }, () =>
      save({
        classification: {
          skillId: skill,
          confidence: 0.99,
          model: "fixture",
          promptVersion: "v1",
          reason: "",
        },
      }),
    ),
  );
  const counts = (
    await db.query(
      "SELECT assigned_to,count(*)::int AS n FROM messages WHERE organization_id=$1 AND assigned_to IS NOT NULL GROUP BY assigned_to",
      [org],
    )
  ).rows;
  assert.equal(counts.length, 2);
  assert.deepEqual(
    counts.map((x) => x.n),
    [10, 10],
  );
});
test("conversation replies update one task, preserve agent/tag, reopen resolved work, deduplicate and never merge by subject alone", async () => {
  const first = await save({
    internetMessageId: "<root@fixture>",
    body: "Initial text",
    classification: {
      skillId: skill,
      confidence: 0.99,
      model: "fixture",
      promptVersion: "v1",
      reason: "",
    },
  });
  const original = (
    await db.query("SELECT * FROM messages WHERE id=$1", [first.id])
  ).rows[0];
  await db.query(
    "UPDATE messages SET status='Rezolvat',resolved_at=now(),tag_source='human' WHERE id=$1",
    [first.id],
  );
  const ext = randomUUID(),
    reply = await save({
      externalId: ext,
      internetMessageId: "<reply@fixture>",
      inReplyTo: "<root@fixture>",
      body: "New text",
      attachments: [
        {
          filename: "../factura.pdf",
          contentType: "application/pdf",
          content: Buffer.from("fixture attachment"),
        },
      ],
    });
  assert.equal(reply.id, first.id);
  assert.equal(reply.updated, true);
  const row = (await db.query("SELECT * FROM messages WHERE id=$1", [first.id]))
    .rows[0];
  assert.equal(row.assigned_to, original.assigned_to);
  assert.equal(row.tag_source, "human");
  assert.equal(row.body, "New text");
  assert.equal(row.status, "Nou");
  assert.equal(row.resolved_at, null);
  const secondReply = await save({
    inReplyTo: "<reply@fixture>",
    body: "Third text",
  });
  assert.equal(secondReply.id, first.id);
  assert.equal((await save({ externalId: ext })).duplicate, true);
  assert.notEqual((await save()).id, first.id);
  const conversation = await request("/messages/" + first.id + "/conversation");
  assert.equal(conversation.data.entries.length, 3);
  const attachment = conversation.data.entries.flatMap((e) => e.attachments)[0];
  assert.equal(attachment.filename.includes("/"), false);
  assert.equal(
    (
      await request("/attachments/" + attachment.id + "/download")
    ).data.toString(),
    "fixture attachment",
  );
  assert.equal(
    (
      await request("/attachments/" + attachment.id + "/download", {
        cookie: otherCookie,
      })
    ).status,
    404,
  );
  await db.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
    agent,
    first.id,
  ]);
  assert.equal(
    (
      await request("/messages/" + first.id + "/conversation", {
        cookie: agentCookie,
      })
    ).status,
    200,
  );
  await db.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
    second,
    first.id,
  ]);
  assert.equal(
    (
      await request("/attachments/" + attachment.id + "/download", {
        cookie: agentCookie,
      })
    ).status,
    404,
  );
});
test("provider conversations are mailbox scoped and old historical replies do not overwrite newer content", async () => {
  const initial = await save({
    threadId: "outlook-conversation",
    body: "Latest",
    receivedAt: new Date().toISOString(),
  });
  const update = await save({
    threadId: "outlook-conversation",
    body: "Older",
    receivedAt: "2020-01-01T00:00:00Z",
  });
  assert.equal(update.id, initial.id);
  assert.equal(
    (await db.query("SELECT body FROM messages WHERE id=$1", [initial.id]))
      .rows[0].body,
    "Latest",
  );
  const otherMailbox = randomUUID();
  await db.query("INSERT INTO mailboxes VALUES($1,$2,$3,$4)", [
    otherMailbox,
    org,
    "outlook",
    "other@example.test",
  ]);
  assert.notEqual(
    (await save({ mailboxId: otherMailbox, threadId: "outlook-conversation" }))
      .id,
    initial.id,
  );
});
test("waiting queue assigns without AI when capacity becomes available; low confidence stays in review", async () => {
  await db.query("UPDATE users SET available=false WHERE id=ANY($1::uuid[])", [
    [agent, second],
  ]);
  const good = await save({
      classification: {
        skillId: skill,
        confidence: 0.99,
        model: "fixture",
        promptVersion: "v1",
        reason: "",
      },
    }),
    low = await save({
      classification: {
        skillId: skill,
        confidence: 0.3,
        model: "fixture",
        promptVersion: "v1",
        reason: "",
      },
    });
  await distributeWaiting(db);
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [good.id]))
      .rows[0].assigned_to,
    null,
  );
  await db.query("UPDATE users SET available=true WHERE id=$1", [agent]);
  await distributeWaiting(db);
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [good.id]))
      .rows[0].assigned_to,
    agent,
  );
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [low.id]))
      .rows[0].assigned_to,
    null,
  );
});
test("PDF upload, duplicate detection, page-aware local retrieval, guidance and organization/admin isolation", async () => {
  const doc = await request("/knowledge/pdf", {
    method: "POST",
    raw: fixturePdf(),
    type: "application/pdf",
  });
  assert.equal(doc.status, 201, JSON.stringify(doc.data));
  assert.ok(doc.data.chunks);
  assert.equal(
    (
      await request("/knowledge/pdf", {
        method: "POST",
        raw: fixturePdf(),
        type: "application/pdf",
      })
    ).data.duplicate,
    true,
  );
  assert.equal(
    (
      await request("/knowledge/pdf", {
        method: "POST",
        raw: fixturePdf(),
        type: "application/pdf",
        cookie: agentCookie,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/knowledge/pdf", {
        method: "POST",
        raw: Buffer.from("bad"),
        type: "application/pdf",
      })
    ).status,
    400,
  );
  const task = await save();
  await db.query("UPDATE messages SET assigned_to=$1 WHERE id=$2", [
    agent,
    task.id,
  ]);
  const matches = await request("/messages/" + task.id + "/itl", {
    cookie: agentCookie,
  });
  assert.equal(matches.status, 200);
  assert.ok(matches.data.sources.length);
  assert.equal(matches.data.sources[0].page, 1);
  const answer = await request("/messages/" + task.id + "/itl", {
    method: "POST",
    body: {},
    cookie: agentCookie,
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.data));
  assert.equal(answer.data.steps.length, 1);
  assert.equal(guideCalls, 1);
  assert.equal(
    (
      await request("/knowledge/" + doc.data.id + "/pdf", {
        cookie: otherCookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/knowledge/" + doc.data.id + "/pdf", {
        cookie: agentCookie,
      })
    ).status,
    200,
  );
  const unrelated = await save({
    subject: "Zebra astronomy",
    body: "Unrelated galactic telescope",
  });
  assert.deepEqual(
    (await request("/messages/" + unrelated.id + "/itl")).data.sources,
    [],
  );
  const knowledge = createKnowledge(db, { dataDir: dir });
  await mkdir(join(dir, "itl", org), { recursive: true });
  await writeFile(
    join(dir, "itl", org, "instructions.pdf"),
    fixturePdf(
      "Contract facturare EMMA E01 verifica tariful contractului si perioada. Deschide dosarul pentru verificarea documentelor.",
    ),
  );
  const scanned = await knowledge.scan(org);
  assert.equal(scanned.imported, 1);
  assert.equal((await knowledge.scan(org)).duplicates, 1);
  assert.equal((await knowledge.list(otherOrg)).length, 0);
});
test("EMMA preview, exact header matching, formula exclusion, per-code task dispatch, ignored codes and import idempotency", async () => {
  await db.query(
    "UPDATE users SET available=true,emma_codes=$1 WHERE id=ANY($2::uuid[])",
    [["E01"], [agent, second]],
  );
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Erori");
  sheet.addRow(["Cod eroare", "Contract", "Detalii"]);
  sheet.addRow(["E01", "C100", "Tarif incorect"]);
  sheet.addRow(["E99", "C200", "Al departament"]);
  sheet.addRow(["e01", "C300", "Alt tarif"]);
  sheet.addRow([
    { formula: '"E01"', result: "E01" },
    "C400",
    "Nu executa formula",
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const preview = await request("/emma/preview", {
    method: "POST",
    type: "application/octet-stream",
    raw: buffer,
    filename: "errors.xlsx",
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.sheets[0].name, "Erori");
  const parsed = await readWorkbook(buffer);
  assert.equal(
    rowsFromSheet(parsed, {
      sheetName: "Erori",
      headerRow: 1,
      codeColumn: "Cod eroare",
    }).length,
    3,
  );
  assert.throws(() =>
    rowsFromSheet(parsed, {
      sheetName: "Missing",
      headerRow: 1,
      codeColumn: "Cod eroare",
    }),
  );
  const rule = await request("/emma/rules", {
    method: "POST",
    body: {
      senderEmail: "facturare@example.test",
      subjectContains: "EMMA",
      sheetName: "Erori",
      headerRow: 1,
      codeColumn: "Cod eroare",
      skillId: skill,
      enabled: true,
    },
  });
  assert.equal(rule.status, 201);
  const report = await save({
    senderEmail: "facturare@example.test",
    subject: "Raport EMMA",
    attachments: [
      {
        filename: "errors.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: buffer,
      },
    ],
  });
  const emma = createEmma(db);
  const result = await emma.process(org, report.id, report.entryId);
  assert.equal(result.created, 2);
  assert.equal(result.failed, false);
  let children = (
    await db.query("SELECT * FROM messages WHERE source_message_id=$1", [
      report.id,
    ])
  ).rows;
  assert.equal(children.length, 2);
  assert.ok(
    children.every(
      (c) => c.emma_code === "E01" && [agent, second].includes(c.assigned_to),
    ),
  );
  assert.ok(children.every((c) => c.task_kind === "emma"));
  await emma.process(org, report.id, report.entryId);
  children = (
    await db.query("SELECT * FROM messages WHERE source_message_id=$1", [
      report.id,
    ])
  ).rows;
  assert.equal(children.length, 2);
  const audit = (await request("/emma/imports")).data.find(
    (i) => i.messageId === report.id,
  );
  assert.equal(audit.ignoredRows, 1);
  assert.equal(audit.state, "done");
  assert.equal(
    (await request("/emma/rules", { cookie: agentCookie })).status,
    403,
  );
});
test("EMMA reserves unavailable eligible codes in queue and malformed spreadsheets retain a visible failure", async () => {
  await db.query("UPDATE users SET available=false WHERE id=ANY($1::uuid[])", [
    [agent, second],
  ]);
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Erori");
  sheet.addRow(["Cod eroare"]);
  sheet.addRow(["E01"]);
  const good = await save({
    senderEmail: "facturare@example.test",
    subject: "Raport EMMA",
    attachments: [
      {
        filename: "pending.xlsx",
        content: Buffer.from(await workbook.xlsx.writeBuffer()),
      },
    ],
  });
  await createEmma(db).process(org, good.id, good.entryId);
  const child = (
    await db.query("SELECT * FROM messages WHERE source_message_id=$1", [
      good.id,
    ])
  ).rows[0];
  assert.equal(child.assigned_to, null);
  await db.query("UPDATE users SET available=true WHERE id=$1", [agent]);
  await distributeWaiting(db);
  assert.equal(
    (await db.query("SELECT assigned_to FROM messages WHERE id=$1", [child.id]))
      .rows[0].assigned_to,
    agent,
  );
  const bad = await save({
    senderEmail: "facturare@example.test",
    subject: "Raport EMMA",
    attachments: [{ filename: "broken.xlsx", content: Buffer.from("broken") }],
  });
  const result = await createEmma(db).process(org, bad.id, bad.entryId);
  assert.equal(result.failed, true);
  assert.equal(
    (await request("/emma/imports")).data.find((i) => i.messageId === bad.id)
      .state,
    "failed",
  );
});
test("dashboard aggregates all tasks with user scope, and LAN origin allowlist remains explicit", async () => {
  const dashboard = await request("/dashboard");
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
  const expected = (
    await db.query(
      "SELECT count(*)::int AS n FROM messages WHERE organization_id=$1",
      [org],
    )
  ).rows[0].n;
  assert.equal(dashboard.data.summary.total, expected);
  assert.equal(dashboard.data.daily.length, 7);
  assert.equal(
    dashboard.data.daily.at(-1).day,
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const scoped = await request("/dashboard", { cookie: agentCookie });
  const mine = (
    await db.query(
      "SELECT count(*)::int AS n FROM messages WHERE assigned_to=$1",
      [agent],
    )
  ).rows[0].n;
  assert.equal(scoped.data.summary.total, mine);
  assert.ok(scoped.data.agents.every((a) => a.id === agent));
  assert.equal(
    (await request("/dashboard", { cookie: otherCookie })).data.summary.total,
    0,
  );
  const ruleBody = {
    senderEmail: "other-report@example.test",
    sheetName: "Sheet1",
    codeColumn: "Code",
    skillId: skill,
  };
  assert.equal(
    (
      await request("/emma/rules", {
        method: "POST",
        body: ruleBody,
        origin: "http://relay-pc:5173",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request("/emma/rules", {
        method: "POST",
        body: ruleBody,
        origin: "https://malicious.example.test",
      })
    ).status,
    403,
  );
});

test("mail polling recovers a committed root email without a job and never reclassifies a reply update", async () => {
  let raw = {
    externalId: "checkpoint-root",
    internetMessageId: "<checkpoint-root>",
    senderName: "Client",
    senderEmail: "client@example.test",
    subject: "Resetare parola",
    body: "Resetare parola utilizator.",
    receivedAt: new Date().toISOString(),
  };
  const providers = {
    scan: async (row, c) => ({
      credentials: c,
      messages: [raw],
      state: { cursor: "fixture" },
    }),
  };
  const service = createMailService(db, {
    vault: createVault(join(dir, "vault")),
    providers,
  });
  const connection = await service.create(org, {
    provider: "gmail",
    address: "recovery@example.test",
    appPassword: "fixture",
  });
  const row = (
    await db.query("SELECT mailbox_id FROM mailbox_connections WHERE id=$1", [
      connection.id,
    ])
  ).rows[0];
  const saved = await storeMessage(
    db,
    { org, type: "system" },
    { ...raw, mailboxId: row.mailbox_id },
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM processing_jobs WHERE message_id=$1", [
        saved.id,
      ])
    ).rowCount,
    0,
  );
  await service.sync(connection.id, org);
  assert.equal(
    (
      await db.query("SELECT state FROM processing_jobs WHERE message_id=$1", [
        saved.id,
      ])
    ).rows[0].state,
    "pending",
  );
  let calls = 0;
  const runner = createAiRunner(db, {
    classify: async () => {
      calls++;
      return {
        skillId: skill,
        confidence: 0.99,
        model: "fixture",
        promptVersion: "v1",
        reason: "",
      };
    },
  });
  await runner.process(org, saved.id);
  await db.query(
    "UPDATE processing_jobs SET state='done' WHERE message_id=$1",
    [saved.id],
  );
  raw = {
    ...raw,
    externalId: "checkpoint-reply",
    internetMessageId: "<checkpoint-reply>",
    inReplyTo: "<checkpoint-root>",
    body: "Actualizare noua pentru acelasi cont.",
    receivedAt: new Date().toISOString(),
  };
  await service.sync(connection.id, org);
  await service.sync(connection.id, org);
  assert.equal(calls, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM messages WHERE mailbox_id=$1",
        [row.mailbox_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM mail_entries WHERE message_id=$1",
        [saved.id],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await db.query("SELECT state FROM processing_jobs WHERE message_id=$1", [
        saved.id,
      ])
    ).rows[0].state,
    "done",
  );
});
