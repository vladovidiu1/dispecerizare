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
        return { size: 3_000_000, envelope: { subject: "Mare" } };
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
