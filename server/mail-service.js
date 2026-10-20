import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.js";
import { storeMessage, event } from "./messages.js";
import { createEmma } from "./emma.js";
import { createVault } from "./vault.js";
import {
  createMailProviders,
  requestDeviceCode,
  pollDeviceCode,
  verifyMicrosoft,
  mailError,
} from "./mail-providers.js";
const email = z
    .string()
    .email()
    .transform((s) => s.toLowerCase()),
  uuid = z.string().uuid();
const common = {
  address: email,
  initialDays: z.number().int().min(1).max(90).default(1),
  pollSeconds: z.number().int().min(30).max(3600).default(60),
};
const tenant = z
  .union([uuid, z.enum(["common", "organizations", "consumers"])])
  .default("common");
const configSchema = z.discriminatedUnion("provider", [
  z.object({
    ...common,
    provider: z.literal("outlook"),
    clientId: uuid,
    tenant,
    shared: z.boolean().default(false),
  }),
  z.object({
    ...common,
    provider: z.enum(["gmail", "yahoo"]),
    appPassword: z.string().trim().min(1).max(200),
  }),
]);
export function createMailService(
  db,
  {
    vault = createVault(),
    providers = createMailProviders(),
    device = {
      request: requestDeviceCode,
      poll: pollDeviceCode,
      verify: verifyMicrosoft,
    },
  } = {},
) {
  const flows = new Map();
  const emma = createEmma(db);
  async function owned(id, org) {
    const row = (
      await db.query(
        "SELECT c.*,m.address FROM mailbox_connections c JOIN mailboxes m ON m.id=c.mailbox_id WHERE c.id=$1 AND c.organization_id=$2",
        [uuid.parse(id), org],
      )
    ).rows[0];
    if (!row)
      throw Object.assign(new Error("Conexiune inexistentă"), { status: 404 });
    return row;
  }
  async function exclusive(id, org, fn, decrypt = true) {
    const lock = await db.connect();
    let held = false;
    try {
      held = (
        await lock.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [id],
        )
      ).rows[0].locked;
      if (!held)
        throw Object.assign(
          new Error(
            "Această căsuță este deja în lucru. Reîncearcă în câteva secunde.",
          ),
          { status: 409 },
        );
      const row = await owned(id, org);
      return await fn(
        row,
        decrypt ? await vault.open(row.encrypted_credentials) : null,
      );
    } finally {
      try {
        if (held)
          await lock.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [id],
          );
      } finally {
        lock.release();
      }
    }
  }
  async function saveCredentials(id, credentials) {
    await db.query(
      "UPDATE mailbox_connections SET encrypted_credentials=$1 WHERE id=$2",
      [await vault.seal(credentials), id],
    );
  }
  async function importMessages(row, messages) {
    let imported = 0;
    for (const raw of messages) {
      const b = { ...raw, mailboxId: row.mailbox_id, priority: "Medie" };
      const result = await storeMessage(
        db,
        { org: row.organization_id, type: "system" },
        b,
      );
      if (!result.duplicate) imported++;
      const report = await emma.process(
        row.organization_id,
        result.id,
        result.entryId,
      );
      if (report.matched) {
        await db.query(
          "UPDATE dispatch_jobs SET state='cancelled',lease_until=NULL WHERE message_id=$1 AND state IN ('pending','running','retry')",
          [result.id],
        );
        continue;
      }
      if (result.updated) continue;
      await db.query(
        "INSERT INTO dispatch_jobs(message_id,organization_id,state,last_error) SELECT id,organization_id,$2,$3 FROM messages WHERE id=$1 AND tag_source IS DISTINCT FROM 'human' AND status='Nou' AND assigned_to IS NULL AND task_kind='email' ON CONFLICT(message_id) DO NOTHING",
        [
          result.id,
          raw.skipDispatch || raw.skipAi ? "failed" : "pending",
          raw.skipDispatch || raw.skipAi ? "MAIL_MESSAGE_TOO_LARGE" : null,
        ],
      );
    }
    return imported;
  }
  const service = {
    async list(org) {
      const { rows } = await db.query(
        `SELECT c.id,c.provider,c.enabled,c.initial_days AS "initialDays",c.poll_seconds AS "pollSeconds",c.last_synced_at AS "lastSyncedAt",c.last_error AS "lastError",c.sync_state->>'startMode' AS "startMode",c.sync_state->>'since' AS "monitorFrom",m.address,c.encrypted_credentials,(SELECT count(*)::int FROM dispatch_jobs j JOIN messages x ON x.id=j.message_id WHERE x.mailbox_id=c.mailbox_id AND j.state IN ('pending','running','retry')) AS queued FROM mailbox_connections c JOIN mailboxes m ON m.id=c.mailbox_id WHERE c.organization_id=$1 ORDER BY c.created_at DESC`,
        [org],
      );
      return Promise.all(
        rows.map(async (row) => {
          const { encrypted_credentials, ...safe } = row;
          let c;
          try {
            c = await vault.open(encrypted_credentials);
          } catch {
            return { ...safe, lastError: "MAIL_VAULT", authorized: false };
          }
          return {
            ...safe,
            authorized:
              c.provider === "outlook" ? !!c.refreshToken : !!c.appPassword,
            shared: !!c.shared,
          };
        }),
      );
    },
    async create(org, input) {
      const b = configSchema.parse(input);
      if (b.appPassword) b.appPassword = b.appPassword.replace(/\s/g, "");
      return transaction(db, async (c) => {
        const mailbox = (
          await c.query(
            "INSERT INTO mailboxes(id,organization_id,provider,address) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,address) DO UPDATE SET address=EXCLUDED.address RETURNING id",
            [randomUUID(), org, b.provider, b.address],
          )
        ).rows[0];
        const id = randomUUID();
        await c.query(
          "INSERT INTO mailbox_connections(id,organization_id,mailbox_id,provider,encrypted_credentials,initial_days,poll_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            org,
            mailbox.id,
            b.provider,
            await vault.seal(b),
            b.initialDays,
            b.pollSeconds,
          ],
        );
        return { id };
      });
    },
    async check(id, org) {
      return exclusive(id, org, async (row, c) => {
        try {
          const r = await providers.check(c);
          await saveCredentials(id, r.credentials);
          await db.query(
            "UPDATE mailbox_connections SET last_error=NULL WHERE id=$1",
            [id],
          );
          return { ok: true, account: r.account };
        } catch (e) {
          await db.query(
            "UPDATE mailbox_connections SET last_error=$1 WHERE id=$2",
            [e.code?.startsWith("MAIL_") ? e.code : "MAIL_CONNECTION", id],
          );
          throw e;
        }
      });
    },
    async startNow(id, org) {
      return exclusive(id, org, async (row, c) => {
        if (row.enabled)
          throw Object.assign(
            new Error(
              "Oprește monitorizarea înainte să alegi un punct nou de pornire.",
            ),
            { status: 409 },
          );
        const result = await providers.startNow(row, c);
        await saveCredentials(id, result.credentials);
        await db.query(
          "UPDATE mailbox_connections SET sync_state=$1,enabled=true,last_attempt_at=NULL,last_error=NULL WHERE id=$2",
          [result.state, id],
        );
        return { ok: true, monitorFrom: result.state.since };
      });
    },
    async update(id, org, input) {
      const b = z
        .object({
          enabled: z.boolean().optional(),
          pollSeconds: z.number().int().min(30).max(3600).optional(),
        })
        .strict()
        .parse(input);
      await owned(id, org);
      if (b.enabled === true) await service.check(id, org);
      await db.query(
        "UPDATE mailbox_connections SET enabled=COALESCE($1,enabled),poll_seconds=COALESCE($2,poll_seconds) WHERE id=$3 AND organization_id=$4",
        [b.enabled ?? null, b.pollSeconds ?? null, id, org],
      );
      return { ok: true };
    },
    async password(id, org, input) {
      const b = z
        .object({ appPassword: z.string().trim().min(1).max(200) })
        .parse(input);
      return exclusive(id, org, async (row, c) => {
        if (c.provider === "outlook")
          throw mailError("MAIL_AUTH", "Folosește autorizarea Microsoft.");
        const credentials = {
          ...c,
          appPassword: b.appPassword.replace(/\s/g, ""),
        };
        const checked = await providers.check(credentials);
        await saveCredentials(id, checked.credentials);
        await db.query(
          "UPDATE mailbox_connections SET last_error=NULL WHERE id=$1",
          [id],
        );
        return { ok: true };
      });
    },
    async remove(id, org) {
      return exclusive(
        id,
        org,
        async () => {
          await db.query(
            "DELETE FROM mailbox_connections WHERE id=$1 AND organization_id=$2",
            [id, org],
          );
          for (const [k, v] of flows)
            if (v.connectionId === id) flows.delete(k);
          return { ok: true };
        },
        false,
      );
    },
    async disconnect(id, org) {
      return exclusive(id, org, async (row, c) => {
        await db.query(
          "UPDATE mailbox_connections SET enabled=false,encrypted_credentials=$1 WHERE id=$2",
          [
            await vault.seal({
              provider: c.provider,
              address: c.address,
              clientId: c.clientId,
              tenant: c.tenant,
              shared: c.shared,
            }),
            id,
          ],
        );
        for (const [k, v] of flows) if (v.connectionId === id) flows.delete(k);
        return { ok: true };
      });
    },
    async authorize(id, org) {
      return exclusive(id, org, async (row, c) => {
        if (c.provider !== "outlook") throw mailError("MAIL_PROVIDER");
        for (const [k, v] of flows)
          if (v.expires < Date.now() || v.connectionId === id) flows.delete(k);
        if ([...flows.values()].filter((f) => f.org === org).length >= 5)
          throw mailError(
            "MAIL_AUTH",
            "Finalizează autorizările deja începute.",
          );
        const r = await device.request(c);
        if (!r.device_code || !r.user_code || !r.verification_uri)
          throw mailError("MAIL_AUTH");
        const verification = new URL(r.verification_uri);
        if (
          verification.protocol !== "https:" ||
          ![
            "microsoft.com",
            "www.microsoft.com",
            "login.microsoftonline.com",
            "microsoftonline.com",
          ].includes(verification.hostname)
        )
          throw mailError("MAIL_AUTH");
        const flowId = randomUUID();
        const interval = Math.max(5, Number(r.interval) || 5);
        flows.set(flowId, {
          org,
          connectionId: id,
          code: r.device_code,
          expires:
            Date.now() + Math.min(900, Number(r.expires_in) || 900) * 1000,
          interval,
          nextPoll: Date.now() + interval * 1000,
        });
        return {
          flowId,
          userCode: r.user_code,
          verificationUri: r.verification_uri,
          interval,
          expiresIn: Math.min(900, Number(r.expires_in) || 900),
        };
      });
    },
    async pollAuthorization(flowId, org) {
      const f = flows.get(uuid.parse(flowId));
      if (!f || f.org !== org)
        throw Object.assign(new Error("Autorizare inexistentă sau expirată"), {
          status: 404,
        });
      if (f.expires < Date.now()) {
        flows.delete(flowId);
        throw Object.assign(
          new Error("Autorizarea a expirat. Începe din nou."),
          { status: 410 },
        );
      }
      if (Date.now() < f.nextPoll)
        return { pending: true, interval: f.interval };
      f.nextPoll = Date.now() + f.interval * 1000;
      return exclusive(f.connectionId, org, async (row, c) => {
        const r = await device.poll(c, f.code);
        if (r.pending) {
          if (r.slow) f.interval += 5;
          return { pending: true, interval: f.interval };
        }
        const account = await device.verify(c, r.accessToken);
        await saveCredentials(row.id, { ...c, refreshToken: r.refreshToken });
        await db.query(
          "UPDATE mailbox_connections SET last_error=NULL WHERE id=$1",
          [row.id],
        );
        flows.delete(flowId);
        return { pending: false, ok: true, account };
      });
    },
    async sync(id, org) {
      return exclusive(id, org, async (row, c) => {
        await db.query(
          "UPDATE mailbox_connections SET last_attempt_at=now() WHERE id=$1",
          [id],
        );
        try {
          const r = await providers.scan(row, c);
          await saveCredentials(id, r.credentials);
          const imported = await importMessages(row, r.messages);
          await db.query(
            "UPDATE mailbox_connections SET sync_state=$1,last_synced_at=now(),last_error=NULL WHERE id=$2",
            [r.state, id],
          );
          return { imported, read: r.messages.length };
        } catch (e) {
          await db.query(
            "UPDATE mailbox_connections SET last_error=$1,enabled=CASE WHEN $1='MAIL_AUTH' THEN false ELSE enabled END WHERE id=$2",
            [e.code?.startsWith("MAIL_") ? e.code : "MAIL_CONNECTION", id],
          );
          throw e;
        }
      });
    },
    async search(id, org, input) {
      const b = z
        .object({ query: z.string().trim().min(2).max(200) })
        .parse(input);
      return exclusive(id, org, async (row, c) => {
        const r = await providers.search(row, c, b.query);
        await saveCredentials(id, r.credentials);
        return {
          items: r.messages.map((m) => ({
            externalId: m.externalId,
            subject: m.subject,
            senderName: m.senderName,
            senderEmail: m.senderEmail,
            receivedAt: m.receivedAt,
            preview: m.body.slice(0, 350),
          })),
        };
      });
    },
    async import(id, org, input) {
      const b = z
        .object({
          externalIds: z.array(z.string().min(1).max(2000)).min(1).max(20),
        })
        .parse(input);
      return exclusive(id, org, async (row, c) => {
        const r = await providers.read(row, c, b.externalIds);
        await saveCredentials(id, r.credentials);
        return { imported: await importMessages(row, r.messages) };
      });
    },
    async pollDue() {
      const rows = (
        await db.query(
          "SELECT id,organization_id FROM mailbox_connections WHERE enabled=true AND (last_attempt_at IS NULL OR last_attempt_at < now()-make_interval(secs=>poll_seconds)) ORDER BY last_attempt_at NULLS FIRST LIMIT 10",
        )
      ).rows;
      for (const row of rows) {
        try {
          await service.sync(row.id, row.organization_id);
        } catch {
          /* Error code is persisted; no credentials/provider bodies in logs. */
        }
      }
    },
  };
  return service;
}
export function registerMailRoutes(app, admin, service) {
  app.get("/api/mail-connections", admin, async (req, res) =>
    res.json(await service.list(req.actor.org)),
  );
  app.post("/api/mail-connections", admin, async (req, res) =>
    res.status(201).json(await service.create(req.actor.org, req.body)),
  );
  app.delete("/api/mail-connections/:id", admin, async (req, res) =>
    res.json(await service.remove(req.params.id, req.actor.org)),
  );
  app.patch("/api/mail-connections/:id", admin, async (req, res) =>
    res.json(await service.update(req.params.id, req.actor.org, req.body)),
  );
  app.put("/api/mail-connections/:id/password", admin, async (req, res) =>
    res.json(await service.password(req.params.id, req.actor.org, req.body)),
  );
  for (const [route, method] of [
    ["start-now", "startNow"],
    ["check", "check"],
    ["authorize", "authorize"],
    ["sync", "sync"],
    ["disconnect", "disconnect"],
  ])
    app.post("/api/mail-connections/:id/" + route, admin, async (req, res) =>
      res.json(await service[method](req.params.id, req.actor.org)),
    );
  app.post("/api/mail-authorizations/:id/poll", admin, async (req, res) =>
    res.json(await service.pollAuthorization(req.params.id, req.actor.org)),
  );
  app.post("/api/mail-connections/:id/search", admin, async (req, res) =>
    res.json(await service.search(req.params.id, req.actor.org, req.body)),
  );
  app.post("/api/mail-connections/:id/import", admin, async (req, res) =>
    res.json(await service.import(req.params.id, req.actor.org, req.body)),
  );
}
