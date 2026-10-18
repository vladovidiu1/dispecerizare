import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMailProviders,
  requestDeviceCode,
  pollDeviceCode,
  verifyMicrosoft,
} from "../mail-providers.js";
async function mockHttp(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  try {
    await fn();
  } finally {
    global.fetch = original;
  }
}
const response = (x) =>
  new Response(JSON.stringify(x), {
    headers: { "Content-Type": "application/json" },
  });
const outlook = {
  provider: "outlook",
  address: "shared@example.test",
  shared: true,
  clientId: "11111111-1111-4111-8111-111111111111",
  tenant: "common",
  refreshToken: "fixture-refresh",
};
test("Microsoft device flow requests delegated shared-mail permission and handles pending authorization", async () =>
  mockHttp(
    async (url, options) => {
      assert.equal(new URL(url).hostname, "login.microsoftonline.com");
      const b = options.body;
      if (String(url).endsWith("devicecode")) {
        assert.match(b.get("scope"), /Mail.Read.Shared/);
        assert.match(b.get("scope"), /offline_access/);
        assert.equal(b.has("client_secret"), false);
        return response({
          device_code: "fixture-device",
          user_code: "ABCD",
          verification_uri: "https://microsoft.com/devicelogin",
          interval: 5,
          expires_in: 900,
        });
      }
      return new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 400,
      });
    },
    async () => {
      assert.equal((await requestDeviceCode(outlook)).user_code, "ABCD");
      assert.equal(
        (await pollDeviceCode(outlook, "fixture-device")).pending,
        true,
      );
    },
  ));
test("Outlook delta sync keeps immutable IDs, sanitizes HTML and uses provider checkpoint", async () => {
  let graphCalls = 0;
  await mockHttp(
    async (url, options) => {
      const u = new URL(url);
      if (u.hostname === "login.microsoftonline.com")
        return response({
          access_token: "fixture-access",
          refresh_token: "rotated",
        });
      assert.equal(u.hostname, "graph.microsoft.com");
      assert.equal(options.headers.Authorization, "Bearer fixture-access");
      assert.match(options.headers.Prefer, /ImmutableId/);
      assert.match(
        u.pathname,
        /users\/shared%40example.test\/mailFolders\/inbox\/messages\/delta/,
      );
      graphCalls++;
      return response({
        value: [
          {
            id: "immutable-1",
            subject: "Factură",
            body: {
              contentType: "html",
              content: "<p>Detalii <b>factură</b></p>",
            },
            from: {
              emailAddress: { name: "Client", address: "client@example.test" },
            },
            receivedDateTime: "2026-10-18T12:00:00Z",
          },
          { id: "deleted", "@removed": { reason: "deleted" } },
        ],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/users/shared%40example.test/mailFolders/inbox/messages/delta?$deltatoken=fixture",
      });
    },
    async () => {
      const provider = createMailProviders(),
        connection = {
          created_at: new Date(),
          initial_days: 1,
          sync_state: {},
        };
      const r = await provider.scan(connection, outlook);
      assert.equal(r.messages.length, 1);
      assert.equal(r.messages[0].externalId, "immutable-1");
      assert.ok(!r.messages[0].body.includes("<b>"));
      assert.equal(r.credentials.refreshToken, "rotated");
      await provider.scan(
        { ...connection, sync_state: r.state },
        r.credentials,
      );
      assert.equal(graphCalls, 2);
      await assert.rejects(
        () =>
          provider.scan(
            {
              ...connection,
              sync_state: { cursor: "https://attacker.test/steal" },
            },
            outlook,
          ),
        { code: "MAIL_CURSOR_INVALID" },
      );
    },
  );
});
test("Microsoft verifies authenticated mailbox ownership and delegated access", async () =>
  mockHttp(
    async (url) =>
      response(
        String(url).includes("/me?")
          ? { mail: "different@example.test" }
          : { id: "inbox" },
      ),
    async () => {
      await assert.rejects(
        () => verifyMicrosoft({ ...outlook, shared: false }, "fixture"),
        { code: "MAIL_ACCOUNT_MISMATCH" },
      );
      assert.equal(
        await verifyMicrosoft(outlook, "fixture"),
        "different@example.test",
      );
    },
  ));
test("Gmail and Yahoo use read-only IMAP with verified TLS, stable UIDVALIDITY IDs and no duplicate range", async () => {
  for (const provider of ["gmail", "yahoo"]) {
    let options,
      search,
      sourceReads = 0;
    const client = {
      on() {},
      async connect() {},
      async mailboxOpen(name, opts) {
        assert.equal(name, "INBOX");
        assert.equal(opts.readOnly, true);
        return { uidValidity: 99n };
      },
      async search(q, opts) {
        search = q;
        assert.equal(opts.uid, true);
        return [10, 11];
      },
      async fetchOne(uid, fields, opts) {
        assert.equal(opts.uid, true);
        if (fields.source) {
          sourceReads++;
          return { source: Buffer.from("fixture") };
        }
        return { size: 100, envelope: {} };
      },
      async logout() {},
      close() {},
    };
    const providers = createMailProviders({
      imapFactory: (o) => ((options = o), client),
      parseEmail: async () => ({
        from: { value: [{ address: "client@example.test", name: "Client" }] },
        subject: "Factură",
        text: "Text",
        date: new Date("2026-10-18"),
      }),
    });
    const r = await providers.scan(
      {
        sync_state: { uidValidity: "99", lastUid: 10 },
        created_at: new Date(),
        initial_days: 1,
      },
      { provider, address: "account@example.test", appPassword: "fixture" },
    );
    assert.equal(
      options.host,
      provider === "gmail" ? "imap.gmail.com" : "imap.mail.yahoo.com",
    );
    assert.equal(options.secure, true);
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.logger, false);
    assert.deepEqual(search, { uid: "11:*" });
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0].externalId, "99:11");
    assert.equal(sourceReads, 1);
    assert.equal(r.state.lastUid, 11);
  }
});
test("oversize IMAP messages retain metadata for manual review without downloading source", async () => {
  let source = false;
  const providers = createMailProviders({
    imapFactory: () => ({
      on() {},
      async connect() {},
      async mailboxOpen() {
        return { uidValidity: 1n };
      },
      async search() {
        return [1];
      },
      async fetchOne(uid, fields) {
        if (fields.source) source = true;
        return { size: 31_000_000, envelope: { subject: "Mare" } };
      },
      async logout() {},
      close() {},
    }),
  });
  const r = await providers.scan(
    { sync_state: {}, created_at: new Date(), initial_days: 1 },
    {
      provider: "yahoo",
      address: "account@example.test",
      appPassword: "fixture",
    },
  );
  assert.equal(source, false);
  assert.equal(r.messages[0].skipAi, true);
});

test("start-now snapshots IMAP UIDNEXT without reading existing messages and imports only higher UIDs", async () => {
  let fetches = [],
    phase = "baseline",
    seenQuery;
  const providers = createMailProviders({
    imapFactory: () => ({
      on() {},
      async connect() {},
      async mailboxOpen(name, opts) {
        assert.equal(opts.readOnly, true);
        return { uidValidity: 7n, uidNext: 101 };
      },
      async search(q) {
        seenQuery = q;
        return phase === "baseline" ? [100] : [100, 101];
      },
      async fetchOne(uid, fields) {
        fetches.push(uid);
        return fields.source
          ? { source: Buffer.from("fixture") }
          : { size: 100, envelope: {} };
      },
      async logout() {},
      close() {},
    }),
    parseEmail: async () => ({
      from: { value: [{ address: "client@example.test" }] },
      subject: "Nou",
      text: "Nou",
      date: new Date(),
    }),
  });
  const credentials = {
    provider: "gmail",
    address: "test@example.test",
    appPassword: "fixture",
  };
  const started = await providers.startNow({}, credentials);
  assert.equal(started.state.lastUid, 100);
  assert.equal(fetches.length, 0);
  let r = await providers.scan({ sync_state: started.state }, credentials);
  assert.deepEqual(seenQuery, { uid: "101:*" });
  assert.equal(r.messages.length, 0);
  assert.equal(fetches.length, 0);
  phase = "new";
  r = await providers.scan({ sync_state: r.state }, credentials);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].externalId, "7:101");
  assert.equal(r.state.startMode, "future");
  assert.ok(fetches.every((u) => u === "101"));
  await assert.rejects(
    () =>
      providers.scan(
        { sync_state: { ...started.state, uidValidity: "6" } },
        credentials,
      ),
    { code: "MAIL_UIDVALIDITY_CHANGED" },
  );
});
test("start-now handles an empty IMAP mailbox and fails closed if UIDNEXT is missing", async () => {
  let query;
  const p = createMailProviders({
    imapFactory: () => ({
      on() {},
      async connect() {},
      async mailboxOpen() {
        return { uidValidity: 1n, uidNext: 1 };
      },
      async search(q) {
        query = q;
        return [];
      },
      async logout() {},
      close() {},
    }),
  });
  const c = {
      provider: "yahoo",
      address: "test@example.test",
      appPassword: "fixture",
    },
    r = await p.startNow({}, c);
  assert.equal(r.state.lastUid, 0);
  await p.scan({ sync_state: r.state }, c);
  assert.deepEqual(query, { uid: "1:*" });
  const invalid = createMailProviders({
    imapFactory: () => ({
      on() {},
      async connect() {},
      async mailboxOpen() {
        return { uidValidity: 1n };
      },
      async logout() {},
      close() {},
    }),
  });
  await assert.rejects(() => invalid.startNow({}, c), {
    code: "MAIL_CURSOR_INVALID",
  });
});
test("Outlook start-now verifies access without fetching mail and anchors future delta to activation time", async () => {
  let mailQueries = 0;
  await mockHttp(
    async (url) => {
      const u = new URL(url);
      if (u.hostname === "login.microsoftonline.com")
        return response({ access_token: "fixture", refresh_token: "rotated" });
      if (u.pathname === "/v1.0/me")
        return response({ mail: "test@example.test" });
      if (u.pathname.endsWith("/mailFolders/inbox"))
        return response({ id: "inbox" });
      mailQueries++;
      assert.equal(
        u.searchParams.get("$filter"),
        "receivedDateTime ge " + anchor,
      );
      return response({
        value: [],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=fixture",
      });
    },
    async () => {
      const p = createMailProviders();
      const r = await p.startNow({}, outlook);
      anchor = r.state.since;
      assert.equal(mailQueries, 0);
      const scanned = await p.scan({ sync_state: r.state }, r.credentials);
      assert.equal(mailQueries, 1);
      assert.equal(scanned.state.since, anchor);
    },
  );
});
let anchor;

test("IMAP imports RFC reply references and binary attachments from MIME without marking mail read", async () => {
  const source = Buffer.from(
    'From: Client <client@example.test>\r\nTo: inbox@example.test\r\nSubject: Re: Resetare\r\nMessage-ID: <reply@example.test>\r\nIn-Reply-To: <root@example.test>\r\nReferences: <root@example.test> <previous@example.test>\r\nDate: Sun, 18 Oct 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nActualizare\r\n--fixture\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="document.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nZml4dHVyZQ==\r\n--fixture--\r\n',
  );
  const provider = createMailProviders({
    imapFactory: () => ({
      on() {},
      async connect() {},
      async mailboxOpen(name, options) {
        assert.equal(options.readOnly, true);
        return { uidValidity: 1n };
      },
      async search() {
        return [1];
      },
      async fetchOne(uid, fields) {
        return fields.source
          ? { source }
          : { size: source.length, envelope: {} };
      },
      async logout() {},
      close() {},
    }),
  });
  const result = await provider.scan(
      { sync_state: {}, created_at: new Date(), initial_days: 1 },
      {
        provider: "yahoo",
        address: "inbox@example.test",
        appPassword: "fixture",
      },
    ),
    m = result.messages[0];
  assert.equal(m.internetMessageId, "<reply@example.test>");
  assert.equal(m.inReplyTo, "<root@example.test>");
  assert.deepEqual(m.references, [
    "<root@example.test>",
    "<previous@example.test>",
  ]);
  assert.equal(m.attachments[0].content.toString(), "fixture");
  assert.equal(m.attachments[0].filename, "document.pdf");
});
test("Outlook imports conversation IDs, internet message IDs and file attachments without executing them", async () => {
  const original = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    paths.push(u.pathname);
    if (u.hostname === "login.microsoftonline.com")
      return Response.json({ access_token: "fixture" });
    if (u.pathname.endsWith("/attachments"))
      return Response.json({
        value: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "report.xlsx",
            contentType: "application/octet-stream",
            size: 7,
            contentBytes: Buffer.from("fixture").toString("base64"),
          },
        ],
      });
    return Response.json({
      value: [
        {
          id: "mail-1",
          conversationId: "thread-1",
          internetMessageId: "<graph@example.test>",
          hasAttachments: true,
          subject: "Raport",
          body: { contentType: "text", content: "Actualizare" },
          receivedDateTime: "2026-10-18T12:00:00Z",
        },
      ],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/messages/delta?token=fixture",
    });
  };
  try {
    const result = await createMailProviders().scan(
      { sync_state: {}, created_at: new Date(), initial_days: 1 },
      {
        provider: "outlook",
        address: "inbox@example.test",
        clientId: "fixture",
        tenant: "common",
        refreshToken: "fixture",
      },
    );
    const m = result.messages[0];
    assert.equal(m.threadId, "thread-1");
    assert.equal(m.internetMessageId, "<graph@example.test>");
    assert.equal(m.attachments[0].content.toString(), "fixture");
    assert.ok(paths.some((p) => p.endsWith("/attachments")));
  } finally {
    globalThis.fetch = original;
  }
});
