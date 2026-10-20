import { test } from "node:test";
import assert from "node:assert/strict";
import { simpleParser } from "mailparser";
import { createSendProviders } from "../send-providers.js";
import { requestDeviceCode } from "../mail-providers.js";
const mail = {
  from_address: "agent@example.test",
  to_address: "client@example.test",
  reply_to_address: "shared@example.test",
  subject: "Re: Solicitare",
  body: "Răspuns verificat.",
  internet_message_id: "<unique@example.test>",
  in_reply_to: "<original@client.test>",
  reference_ids: ["<original@client.test>"],
};
test("SMTP uses fixed verified TLS destinations and sends original-thread headers with no arbitrary recipients", async () => {
  let config,
    message,
    closed = 0;
  const p = createSendProviders({
    smtpFactory: (c) => {
      config = c;
      return {
        verify: async () => {},
        sendMail: async (m) => {
          message = m;
          return { accepted: [{ address: mail.to_address }] };
        },
        close: () => closed++,
      };
    },
  });
  await p.verify({
    provider: "gmail",
    address: mail.from_address,
    appPassword: "fixture",
  });
  assert.equal(config.host, "smtp.gmail.com");
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.tls.rejectUnauthorized, true);
  await p.send(
    { provider: "yahoo", address: mail.from_address, appPassword: "fixture" },
    mail,
  );
  assert.equal(config.host, "smtp.mail.yahoo.com");
  assert.equal(message.to, mail.to_address);
  assert.equal(message.replyTo, mail.reply_to_address);
  assert.equal(message.inReplyTo, mail.in_reply_to);
  assert.deepEqual(message.references, mail.reference_ids);
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);
  assert.equal(closed, 2);
});
test("SMTP differentiates definitive rejection from ambiguous interruption", async () => {
  for (const [error, unknown] of [
    [{ code: "EAUTH" }, false],
    [{ code: "ETIMEDOUT" }, true],
    [{ responseCode: 550 }, false],
  ]) {
    const p = createSendProviders({
      smtpFactory: () => ({
        sendMail: async () => {
          throw error;
        },
        close: () => {},
      }),
    });
    await assert.rejects(
      () => p.send({ provider: "gmail" }, mail),
      (e) => e.unknown === unknown,
    );
  }
});
test("Microsoft sender device flow requests Mail.Send without requesting shared send rights", async () => {
  const previous = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, options) => {
    body = new URLSearchParams(options.body);
    return Response.json({ device_code: "fixture", user_code: "fixture" });
  };
  try {
    await requestDeviceCode({
      clientId: "fixture",
      tenant: "organizations",
      purpose: "send",
    });
    assert.match(
      body.get("scope"),
      /https:\/\/graph\.microsoft\.com\/Mail\.Send(?: |$)/,
    );
    assert.ok(!body.get("scope").includes("Mail.Send.Shared"));
    assert.ok(!body.get("scope").includes("Mail.Read"));
  } finally {
    globalThis.fetch = previous;
  }
});
test("Graph sends MIME as authenticated personal user, matches sender account and retains RFC conversation references", async () => {
  const previous = globalThis.fetch;
  let raw,
    paths = [];
  globalThis.fetch = async (url, o) => {
    paths.push(String(url));
    if (String(url).includes("/token"))
      return Response.json({
        access_token: "private-fixture",
        refresh_token: "rotated-fixture",
      });
    if (String(url).includes("/me?"))
      return Response.json({ mail: mail.from_address });
    if (String(url).endsWith("/me/sendMail")) {
      assert.equal(o.method, "POST");
      assert.equal(o.headers["Content-Type"], "text/plain");
      raw = Buffer.from(o.body, "base64");
      return new Response(null, { status: 202 });
    }
    throw Error("Unexpected endpoint");
  };
  const c = {
    provider: "outlook",
    tenant: "organizations",
    clientId: "fixture",
    address: mail.from_address,
    refreshToken: "private-fixture",
  };
  try {
    const p = createSendProviders();
    await p.verify(c);
    await assert.rejects(
      () => p.verify({ ...c, address: "other@example.test" }),
      { code: "SEND_ACCOUNT_MISMATCH" },
    );
    await p.send(c, mail);
    const m = await simpleParser(raw);
    assert.equal(m.from.value[0].address, mail.from_address);
    assert.equal(m.to.value[0].address, mail.to_address);
    assert.equal(m.replyTo.value[0].address, mail.reply_to_address);
    assert.equal(m.inReplyTo, mail.in_reply_to);
    assert.equal(m.messageId, mail.internet_message_id);
    assert.deepEqual(
      Array.isArray(m.references) ? m.references : [m.references],
      [mail.in_reply_to],
    );
    assert.ok(m.text.includes("Răspuns"));
    assert.ok(paths.some((p) => p.endsWith("/me/sendMail")));
  } finally {
    globalThis.fetch = previous;
  }
});
