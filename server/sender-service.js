import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { createVault } from "./vault.js";
import { event } from "./messages.js";
import { requestDeviceCode, pollDeviceCode } from "./mail-providers.js";
import { createSendProviders } from "./send-providers.js";
const uuid = z.string().uuid(),
  email = z
    .string()
    .email()
    .max(320)
    .transform((s) => s.toLowerCase());
const fail = (status, message) => Object.assign(new Error(message), { status });
const config = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("outlook"),
      address: email,
      clientId: uuid,
      tenant: z
        .union([uuid, z.enum(["common", "organizations", "consumers"])])
        .default("organizations"),
    })
    .strict(),
  z
    .object({
      provider: z.enum(["gmail", "yahoo"]),
      address: email,
      appPassword: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
const reference = (value) => /^<[^<>\s\r\n]{1,998}>$/.test(value || "");
export function createSenderService(
  db,
  {
    vault = createVault(),
    providers = createSendProviders(),
    device = { request: requestDeviceCode, poll: pollDeviceCode },
  } = {},
) {
  const flows = new Map();
  async function withLock(userId, fn) {
    const c = await db.connect();
    let held = false;
    try {
      held = (
        await c.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          ["sender-user:" + userId],
        )
      ).rows[0].locked;
      if (!held)
        throw fail(
          409,
          "Contul de expediere este deja în lucru. Reîncearcă după finalizare.",
        );
      return await fn();
    } finally {
      try {
        if (held)
          await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
            "sender-user:" + userId,
          ]);
      } finally {
        c.release();
      }
    }
  }
  async function own(actor, c = db) {
    const row = (
      await c.query(
        "SELECT * FROM sender_accounts WHERE organization_id=$1 AND user_id=$2",
        [actor.org, actor.id],
      )
    ).rows[0];
    if (!row)
      throw fail(404, "Configurează mai întâi adresa de expediere în Setări");
    return row;
  }
  async function task(c, actor, id, lock = false) {
    const row = (
      await c.query(
        "SELECT * FROM messages WHERE id=$1 AND organization_id=$2" +
          (lock ? " FOR UPDATE" : ""),
        [uuid.parse(id), actor.org],
      )
    ).rows[0];
    if (!row || (actor.role !== "admin" && row.assigned_to !== actor.id))
      throw fail(404, "Task inexistent");
    return row;
  }
  async function saveCredentials(id, credentials) {
    await db.query(
      "UPDATE sender_accounts SET encrypted_credentials=$1,last_error=NULL WHERE id=$2",
      [await vault.seal(credentials), id],
    );
  }
  async function finish(mail, manual = false, connection) {
    const apply = async (c) => {
      const row = (
        await c.query("SELECT * FROM outgoing_mail WHERE id=$1 FOR UPDATE", [
          mail.id,
        ])
      ).rows[0];
      if (row.state === "sent") return;
      const m = (
        await c.query(
          "SELECT mailbox_id FROM messages WHERE id=$1 AND organization_id=$2",
          [mail.message_id, mail.organization_id],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO mail_entries(id,organization_id,message_id,mailbox_id,external_id,internet_message_id,sender_name,sender_email,subject,body,received_at,direction) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,now(),'outbound') ON CONFLICT(mailbox_id,external_id) DO NOTHING`,
        [
          mail.id,
          mail.organization_id,
          mail.message_id,
          m.mailbox_id,
          "outgoing:" + mail.id,
          mail.internet_message_id,
          mail.from_address,
          mail.subject,
          mail.body,
        ],
      );
      await c.query(
        "UPDATE outgoing_mail SET state='sent',sent_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1",
        [mail.id],
      );
      await c.query("UPDATE messages SET updated_at=now() WHERE id=$1", [
        mail.message_id,
      ]);
      await event(
        c,
        mail.organization_id,
        mail.message_id,
        { id: mail.actor_id, type: "user" },
        "reply_sent",
        {
          outgoingId: mail.id,
          from: mail.from_address,
          to: mail.to_address,
          replyTo: mail.reply_to_address,
          internetMessageId: mail.internet_message_id,
          confirmedManually: manual,
        },
      );
    };
    return connection ? apply(connection) : transaction(db, apply);
  }
  const service = {
    async profile(actor) {
      const row = (
        await db.query(
          "SELECT * FROM sender_accounts WHERE organization_id=$1 AND user_id=$2",
          [actor.org, actor.id],
        )
      ).rows[0];
      if (!row) return null;
      let authorized = false,
        lastError = row.last_error;
      try {
        const c = row.encrypted_credentials
          ? await vault.open(row.encrypted_credentials)
          : {};
        authorized = !!(c.refreshToken || c.appPassword);
      } catch {
        lastError = "SEND_VAULT";
      }
      return {
        id: row.id,
        provider: row.provider,
        address: row.address,
        authorized,
        lastError,
      };
    },
    async configure(actor, input) {
      const b = config.parse(input);
      if (b.appPassword) b.appPassword = b.appPassword.replace(/\s/g, "");
      return withLock(actor.id, async () => {
        const credentials = { ...b, purpose: "send" };
        if (b.provider !== "outlook") await providers.verify(credentials);
        await db.query(
          `INSERT INTO sender_accounts(id,organization_id,user_id,provider,address,encrypted_credentials) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET provider=EXCLUDED.provider,address=EXCLUDED.address,encrypted_credentials=EXCLUDED.encrypted_credentials,revision=sender_accounts.revision+1,last_error=NULL WHERE sender_accounts.organization_id=EXCLUDED.organization_id`,
          [
            randomUUID(),
            actor.org,
            actor.id,
            b.provider,
            b.address,
            await vault.seal(credentials),
          ],
        );
        for (const [id, f] of flows)
          if (f.userId === actor.id) flows.delete(id);
        return { ok: true };
      });
    },
    async disconnect(actor) {
      return withLock(actor.id, async () => {
        const row = await own(actor);
        await db.query(
          "UPDATE sender_accounts SET encrypted_credentials=NULL,revision=revision+1 WHERE id=$1",
          [row.id],
        );
        await db.query(
          "UPDATE outgoing_mail SET state='cancelled',last_error='SENDER_DISCONNECTED' WHERE sender_account_id=$1 AND state='queued'",
          [row.id],
        );
        for (const [id, f] of flows)
          if (f.userId === actor.id) flows.delete(id);
        return { ok: true };
      });
    },
    async check(actor) {
      return withLock(actor.id, async () => {
        const row = await own(actor);
        if (!row.encrypted_credentials)
          throw fail(400, "Autorizează contul de expediere");
        try {
          const r = await providers.verify(
            await vault.open(row.encrypted_credentials),
          );
          await saveCredentials(row.id, r.credentials);
          return { ok: true };
        } catch (e) {
          await db.query(
            "UPDATE sender_accounts SET last_error=$1 WHERE id=$2",
            [e.code || "SEND_AUTH", row.id],
          );
          throw e;
        }
      });
    },
    async authorize(actor) {
      return withLock(actor.id, async () => {
        const row = await own(actor);
        if (row.provider !== "outlook" || !row.encrypted_credentials)
          throw fail(400, "Folosește parola de aplicație pentru Gmail/Yahoo");
        for (const [id, f] of flows)
          if (f.expires < Date.now() || f.userId === actor.id) flows.delete(id);
        if (flows.size >= 1000)
          throw fail(429, "Prea multe autorizări în curs");
        const credentials = await vault.open(row.encrypted_credentials);
        const r = await device.request(credentials);
        let url;
        try {
          url = new URL(r.verification_uri);
        } catch {
          throw fail(400, "Răspuns Microsoft invalid");
        }
        if (
          url.protocol !== "https:" ||
          ![
            "microsoft.com",
            "www.microsoft.com",
            "microsoftonline.com",
            "login.microsoftonline.com",
          ].includes(url.hostname) ||
          !r.device_code ||
          !r.user_code
        )
          throw fail(400, "Răspuns Microsoft invalid");
        const flowId = randomUUID(),
          interval = Math.max(5, Number(r.interval) || 5);
        flows.set(flowId, {
          org: actor.org,
          userId: actor.id,
          accountId: row.id,
          revision: row.revision,
          deviceCode: r.device_code,
          interval,
          nextPoll: Date.now() + interval * 1000,
          expires:
            Date.now() + Math.min(900, Number(r.expires_in) || 900) * 1000,
        });
        return {
          flowId,
          userCode: r.user_code,
          verificationUri: r.verification_uri,
          interval,
        };
      });
    },
    async poll(actor, id) {
      const f = flows.get(uuid.parse(id));
      if (!f || f.org !== actor.org || f.userId !== actor.id)
        throw fail(404, "Autorizare inexistentă sau expirată");
      if (f.expires < Date.now()) {
        flows.delete(id);
        throw fail(410, "Autorizarea a expirat");
      }
      if (Date.now() < f.nextPoll)
        return { pending: true, interval: f.interval };
      f.nextPoll = Date.now() + f.interval * 1000;
      return withLock(actor.id, async () => {
        const row = await own(actor);
        if (row.id !== f.accountId || row.revision !== f.revision) {
          flows.delete(id);
          throw fail(409, "Configurația adresei s-a schimbat");
        }
        const c = await vault.open(row.encrypted_credentials);
        const r = await device.poll(c, f.deviceCode);
        if (r.pending) {
          if (r.slow) f.interval += 5;
          return { pending: true, interval: f.interval };
        }
        const checked = await providers.verify({
          ...c,
          refreshToken: r.refreshToken,
        });
        await saveCredentials(row.id, checked.credentials);
        flows.delete(id);
        return { pending: false, ok: true };
      });
    },
    async queue(actor, messageId, input) {
      const b = z
        .object({ requestId: uuid, body: z.string().trim().min(1).max(20000) })
        .strict()
        .parse(input);
      return transaction(db, async (c) => {
        await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          actor.org,
        ]);
        const m = await task(c, actor, messageId, true);
        const prior = (
          await c.query(
            "SELECT id,message_id,body,state FROM outgoing_mail WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3",
            [actor.org, actor.id, b.requestId],
          )
        ).rows[0];
        if (prior) {
          if (prior.message_id !== m.id || prior.body !== b.body)
            throw fail(
              409,
              "Același identificator nu poate fi reutilizat pentru alt răspuns",
            );
          return { id: prior.id, state: prior.state, duplicate: true };
        }
        if (
          (
            await c.query(
              "SELECT 1 FROM outgoing_mail WHERE message_id=$1 AND state IN ('queued','sending','unknown')",
              [m.id],
            )
          ).rowCount
        )
          throw fail(
            409,
            "Există un răspuns în curs sau cu rezultat necunoscut. Verifică-l înainte de altă trimitere.",
          );
        const account = await own(actor, c);
        const credentials = account.encrypted_credentials
          ? await vault.open(account.encrypted_credentials)
          : {};
        if (!credentials.refreshToken && !credentials.appPassword)
          throw fail(400, "Autorizează adresa de expediere în Setări");
        const original = (
          await c.query(
            `SELECT e.*,b.address AS mailbox_address FROM mail_entries e JOIN mailboxes b ON b.id=e.mailbox_id WHERE e.organization_id=$1 AND e.message_id=$2 AND e.direction='inbound' ORDER BY e.received_at,e.created_at,e.id LIMIT 1`,
            [actor.org, m.source_message_id || m.id],
          )
        ).rows[0];
        if (!original || !reference(original.internet_message_id))
          throw fail(
            400,
            "Emailul inițial nu are Message-ID disponibil. Trimiterea în conversație nu poate fi garantată pentru acest task.",
          );
        const to = email.parse(original.sender_email),
          replyTo = email.parse(original.mailbox_address),
          id = randomUUID(),
          messageIdHeader = `<${id}@${account.address.split("@")[1]}>`,
          subject = (
            /^re:/i.test(original.subject)
              ? original.subject
              : "Re: " + original.subject
          )
            .replace(/[\r\n]/g, " ")
            .slice(0, 2000);
        await c.query(
          `INSERT INTO outgoing_mail(id,organization_id,message_id,actor_id,sender_account_id,sender_revision,request_id,original_entry_id,from_address,to_address,reply_to_address,subject,body,internet_message_id,in_reply_to,reference_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            id,
            actor.org,
            m.id,
            actor.id,
            account.id,
            account.revision,
            b.requestId,
            original.id,
            account.address,
            to,
            replyTo,
            subject,
            b.body,
            messageIdHeader,
            original.internet_message_id,
            JSON.stringify([original.internet_message_id]),
          ],
        );
        await c.query("UPDATE messages SET updated_at=now() WHERE id=$1", [
          m.id,
        ]);
        await event(c, actor.org, m.id, actor, "reply_queued", {
          outgoingId: id,
          from: account.address,
          to,
          replyTo,
        });
        return { id, state: "queued", duplicate: false };
      });
    },
    async reconcile(actor, id, input) {
      const b = z
        .object({
          result: z.enum(["sent", "not_sent"]),
          note: z.string().trim().min(10).max(2000),
        })
        .strict()
        .parse(input);
      const mail = (
        await db.query(
          "SELECT * FROM outgoing_mail WHERE organization_id=$1 AND id=$2",
          [actor.org, uuid.parse(id)],
        )
      ).rows[0];
      if (!mail) throw fail(404, "Răspuns inexistent");
      return withLock(mail.actor_id, () =>
        transaction(db, async (c) => {
          await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
            actor.org,
          ]);
          await task(c, actor, mail.message_id, true);
          const current = (
            await c.query(
              "SELECT * FROM outgoing_mail WHERE id=$1 FOR UPDATE",
              [mail.id],
            )
          ).rows[0];
          if (current.state !== "unknown")
            throw fail(
              409,
              "Doar trimiterile cu rezultat necunoscut se verifică manual",
            );
          if (b.result === "sent") await finish(current, true, c);
          else
            await c.query(
              "UPDATE outgoing_mail SET state='failed',last_error='SEND_CONFIRMED_NOT_SENT',lease_until=NULL WHERE id=$1",
              [mail.id],
            );
          await event(
            c,
            actor.org,
            mail.message_id,
            actor,
            "reply_reconciled",
            { outgoingId: mail.id, result: b.result, note: b.note },
          );
          return { ok: true };
        }),
      );
    },
    async processDue() {
      const expired = (
        await db.query(
          "UPDATE outgoing_mail SET state='unknown',last_error='SEND_INTERRUPTED',lease_until=NULL WHERE state='sending' AND lease_until<now() RETURNING *",
        )
      ).rows;
      for (const row of expired)
        await event(
          db,
          row.organization_id,
          row.message_id,
          { type: "system" },
          "reply_unknown",
          { outgoingId: row.id, reason: "SEND_INTERRUPTED" },
        );
      const candidate = (
        await db.query(
          "SELECT * FROM outgoing_mail WHERE state='queued' ORDER BY created_at LIMIT 1",
        )
      ).rows[0];
      if (!candidate) return;
      try {
        await withLock(candidate.actor_id, async () => {
          const work = await transaction(db, async (c) => {
            await c.query(
              "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
              [candidate.organization_id],
            );
            const m = (
                await c.query("SELECT * FROM messages WHERE id=$1 FOR UPDATE", [
                  candidate.message_id,
                ])
              ).rows[0],
              user = (
                await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
                  candidate.actor_id,
                ])
              ).rows[0],
              account = (
                await c.query(
                  "SELECT * FROM sender_accounts WHERE id=$1 FOR UPDATE",
                  [candidate.sender_account_id],
                )
              ).rows[0],
              row = (
                await c.query(
                  "SELECT * FROM outgoing_mail WHERE id=$1 FOR UPDATE",
                  [candidate.id],
                )
              ).rows[0];
            if (row.state !== "queued") return;
            let credentials;
            try {
              credentials = account?.encrypted_credentials
                ? await vault.open(account.encrypted_credentials)
                : {};
            } catch {
              await c.query(
                "UPDATE outgoing_mail SET state='failed',last_error='SEND_VAULT' WHERE id=$1",
                [row.id],
              );
              await event(
                c,
                row.organization_id,
                row.message_id,
                { type: "system" },
                "reply_failed",
                { outgoingId: row.id, reason: "SEND_VAULT" },
              );
              return;
            }
            if (
              !user?.active ||
              (user.role !== "admin" && m.assigned_to !== user.id) ||
              !account ||
              account.revision !== row.sender_revision ||
              (!credentials.refreshToken && !credentials.appPassword)
            ) {
              await c.query(
                "UPDATE outgoing_mail SET state='cancelled',last_error='SENDER_OR_TASK_CHANGED' WHERE id=$1",
                [row.id],
              );
              return;
            }
            await c.query(
              "UPDATE outgoing_mail SET state='sending',lease_until=now()+interval '2 minutes' WHERE id=$1",
              [row.id],
            );
            return { row, credentials };
          });
          if (!work) return;
          try {
            const r = await providers.send(work.credentials, work.row);
            await saveCredentials(work.row.sender_account_id, r.credentials);
            await finish(work.row);
          } catch (e) {
            const unknown =
              e.unknown === true ||
              (!e.code?.startsWith("SEND_") && !e.code?.startsWith("MAIL_"));
            await db.query(
              "UPDATE outgoing_mail SET state=$1,last_error=$2,lease_until=NULL WHERE id=$3",
              [
                unknown ? "unknown" : "failed",
                e.code?.startsWith("SEND_") || e.code?.startsWith("MAIL_")
                  ? e.code
                  : "SEND_UNKNOWN",
                work.row.id,
              ],
            );
            await event(
              db,
              work.row.organization_id,
              work.row.message_id,
              { type: "system" },
              unknown ? "reply_unknown" : "reply_failed",
              {
                outgoingId: work.row.id,
                reason:
                  e.code?.startsWith("SEND_") || e.code?.startsWith("MAIL_")
                    ? e.code
                    : "SEND_UNKNOWN",
              },
            );
          }
        });
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    },
  };
  return service;
}
export function registerSenderRoutes(app, { human, service }) {
  app.get("/api/sender-account", human, async (req, res) =>
    res.json(await service.profile(req.actor)),
  );
  app.put("/api/sender-account", human, async (req, res) =>
    res.json(await service.configure(req.actor, req.body)),
  );
  app.delete("/api/sender-account", human, async (req, res) =>
    res.json(await service.disconnect(req.actor)),
  );
  app.post("/api/sender-account/check", human, async (req, res) =>
    res.json(await service.check(req.actor)),
  );
  app.post("/api/sender-account/authorize", human, async (req, res) =>
    res.json(await service.authorize(req.actor)),
  );
  app.post("/api/sender-account/authorization/:id", human, async (req, res) =>
    res.json(await service.poll(req.actor, req.params.id)),
  );
}
