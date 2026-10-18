import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
export const mailError = (
  code,
  message = "Conexiunea la email nu a reușit. Verifică autorizarea și setările contului.",
) => Object.assign(new Error(message), { code, status: 400 });
const graphOrigin = "https://graph.microsoft.com";
async function jsonFetch(url, options = {}, limit = 5_000_000) {
  try {
    const r = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!r.ok) {
      let auth = r.status === 401 || r.status === 403;
      if (new URL(url).hostname === "login.microsoftonline.com") {
        try {
          const detail = await r.json();
          auth ||= [
            "invalid_grant",
            "invalid_client",
            "unauthorized_client",
            "interaction_required",
            "access_denied",
          ].includes(detail.error);
        } catch {}
      }
      throw mailError(auth ? "MAIL_AUTH" : "MAIL_PROVIDER");
    }
    let size = 0;
    const parts = [];
    for await (const p of r.body) {
      size += p.length;
      if (size > limit) throw mailError("MAIL_RESPONSE_TOO_LARGE");
      parts.push(p);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (e) {
    if (e.code?.startsWith("MAIL_")) throw e;
    throw mailError("MAIL_NETWORK");
  }
}
function graphPath(credentials) {
  return credentials.shared
    ? "/v1.0/users/" + encodeURIComponent(credentials.address)
    : "/v1.0/me";
}
export async function refreshMicrosoft(credentials) {
  if (!credentials.refreshToken)
    throw mailError("MAIL_AUTH", "Autorizează mai întâi contul Microsoft.");
  const result = await jsonFetch(
    `https://login.microsoftonline.com/${credentials.tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    },
  );
  return {
    accessToken: result.access_token,
    credentials: {
      ...credentials,
      refreshToken: result.refresh_token || credentials.refreshToken,
    },
  };
}
export async function requestDeviceCode(credentials) {
  return jsonFetch(
    `https://login.microsoftonline.com/${credentials.tenant}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        scope:
          "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read" +
          (credentials.shared
            ? " https://graph.microsoft.com/Mail.Read.Shared"
            : ""),
      }),
    },
  );
}
export async function pollDeviceCode(credentials, code) {
  try {
    const r = await fetch(
      `https://login.microsoftonline.com/${credentials.tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: code,
        }),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    const result = await r.json();
    if (!r.ok) {
      if (["authorization_pending", "slow_down"].includes(result.error))
        return { pending: true, slow: result.error === "slow_down" };
      throw mailError(
        "MAIL_AUTH",
        "Autorizarea Microsoft a expirat sau a fost refuzată. Reîncearcă autorizarea.",
      );
    }
    if (!result.access_token || !result.refresh_token)
      throw mailError("MAIL_AUTH");
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    };
  } catch (e) {
    if (e.code?.startsWith("MAIL_")) throw e;
    throw mailError("MAIL_NETWORK");
  }
}
async function graphGet(path, token) {
  const url = new URL(path, graphOrigin);
  if (url.origin !== graphOrigin || !url.pathname.startsWith("/v1.0/"))
    throw mailError("MAIL_CURSOR_INVALID");
  return jsonFetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Prefer: 'IdType="ImmutableId"',
    },
  });
}
export async function verifyMicrosoft(credentials, token) {
  const me = await graphGet("/v1.0/me?$select=mail,userPrincipalName", token);
  if (
    !credentials.shared &&
    ![me.mail, me.userPrincipalName].some(
      (a) => a?.toLowerCase() === credentials.address.toLowerCase(),
    )
  )
    throw mailError(
      "MAIL_ACCOUNT_MISMATCH",
      "Contul Microsoft autorizat nu corespunde adresei configurate.",
    );
  await graphGet(
    graphPath(credentials) + "/mailFolders/inbox?$select=id",
    token,
  );
  return me.mail || me.userPrincipalName;
}
function normalizeGraph(m) {
  return {
    externalId: m.id,
    threadId: m.conversationId || null,
    senderName: m.from?.emailAddress?.name || "Expeditor necunoscut",
    senderEmail: m.from?.emailAddress?.address || "unknown@local.invalid",
    subject: (m.subject || "(Fără subiect)").slice(0, 2000),
    body: (m.body?.contentType?.toLowerCase() === "html"
      ? convert(m.body.content || "", {
          wordwrap: false,
          selectors: [{ selector: "img", format: "skip" }],
        })
      : m.body?.content || ""
    ).slice(0, 200000),
    receivedAt: m.receivedDateTime || new Date().toISOString(),
  };
}
function normalizeAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")
    ? email.toLowerCase()
    : "unknown@local.invalid";
}
async function withImap(credentials, fn, factory) {
  const client = factory({
    host:
      credentials.provider === "gmail"
        ? "imap.gmail.com"
        : "imap.mail.yahoo.com",
    port: 993,
    secure: true,
    auth: { user: credentials.address, pass: credentials.appPassword },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: true },
  });
  client.on("error", () => {});
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    return await fn(client, box);
  } catch (e) {
    if (e.code?.startsWith("MAIL_")) throw e;
    throw mailError(e.authenticationFailed ? "MAIL_AUTH" : "MAIL_NETWORK");
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
async function imapMessage(client, box, uid, parseEmail) {
  const meta = await client.fetchOne(
    String(uid),
    { envelope: true, size: true },
    { uid: true },
  );
  if (!meta) throw mailError("MAIL_MESSAGE_MISSING");
  const tooLarge = meta.size > 2_000_000;
  let parsed;
  if (!tooLarge) {
    const raw = await client.fetchOne(
      String(uid),
      { source: true },
      { uid: true },
    );
    if (!raw?.source) throw mailError("MAIL_MESSAGE_MISSING");
    parsed = await parseEmail(raw.source, {
      skipHtmlToText: false,
      skipTextToHtml: true,
      skipImageLinks: true,
    });
  }
  const from = parsed?.from?.value?.[0] || meta.envelope?.from?.[0] || {};
  return {
    externalId: `${box.uidValidity}:${uid}`,
    threadId: parsed?.inReplyTo || parsed?.messageId || null,
    senderName: (from.name || from.address || "Expeditor necunoscut").slice(
      0,
      200,
    ),
    senderEmail: normalizeAddress(from.address),
    subject: (
      parsed?.subject ||
      meta.envelope?.subject ||
      "(Fără subiect)"
    ).slice(0, 2000),
    body: tooLarge
      ? "Mesaj mai mare de 2 MB. Verifică emailul original în căsuță; conținutul nu a fost importat automat."
      : (parsed?.text || "").slice(0, 200000),
    receivedAt: (
      parsed?.date ||
      meta.envelope?.date ||
      new Date()
    ).toISOString(),
    skipAi: tooLarge,
  };
}
export function createMailProviders({
  imapFactory = (options) => new ImapFlow(options),
  parseEmail = simpleParser,
} = {}) {
  const withClient = (c, fn) => withImap(c, fn, imapFactory);
  const readMessage = (c, b, u) => imapMessage(c, b, u, parseEmail);
  return {
    async check(credentials) {
      if (credentials.provider === "outlook") {
        const auth = await refreshMicrosoft(credentials);
        const account = await verifyMicrosoft(
          auth.credentials,
          auth.accessToken,
        );
        return { credentials: auth.credentials, account };
      }
      return withClient(credentials, async () => ({
        credentials,
        account: credentials.address,
      }));
    },
    async startNow(connection, credentials) {
      if (credentials.provider === "outlook") {
        const auth = await refreshMicrosoft(credentials);
        await verifyMicrosoft(auth.credentials, auth.accessToken);
        return {
          credentials: auth.credentials,
          state: { startMode: "future", since: new Date().toISOString() },
        };
      }
      return withClient(credentials, async (client, box) => {
        const next = Number(box.uidNext);
        if (!Number.isSafeInteger(next) || next < 1)
          throw mailError(
            "MAIL_CURSOR_INVALID",
            "Furnizorul nu a returnat un punct sigur de pornire. Nu au fost importate mesaje.",
          );
        return {
          credentials,
          state: {
            startMode: "future",
            since: new Date().toISOString(),
            uidValidity: String(box.uidValidity),
            lastUid: next - 1,
          },
        };
      });
    },
    async scan(connection, credentials) {
      if (credentials.provider === "outlook") {
        const auth = await refreshMicrosoft(credentials);
        let path = connection.sync_state.cursor;
        if (!path) {
          const since =
            connection.sync_state.since ||
            new Date(
              new Date(connection.created_at).getTime() -
                connection.initial_days * 86400000,
            ).toISOString();
          path =
            graphPath(credentials) +
            "/mailFolders/inbox/messages/delta?" +
            new URLSearchParams({
              $select: "id,conversationId,subject,body,from,receivedDateTime",
              $filter: "receivedDateTime ge " + since,
              $top: "50",
            });
        }
        const data = await graphGet(path, auth.accessToken);
        return {
          credentials: auth.credentials,
          messages: (data.value || [])
            .filter((m) => !m["@removed"])
            .map(normalizeGraph),
          state: {
            ...connection.sync_state,
            cursor: data["@odata.nextLink"] || data["@odata.deltaLink"] || path,
          },
        };
      }
      return withClient(credentials, async (client, box) => {
        const previous = connection.sync_state;
        const same = String(previous.uidValidity) === String(box.uidValidity);
        if (previous.startMode === "future" && !same)
          throw mailError(
            "MAIL_UIDVALIDITY_CHANGED",
            "Căsuța și-a schimbat identificatorul intern. Oprește monitorizarea și alege din nou „Pornește doar de acum”.",
          );
        const last = same ? Number(previous.lastUid || 0) : 0;
        const checkpoint =
          same &&
          Number.isSafeInteger(previous.lastUid) &&
          previous.lastUid >= 0;
        const query = checkpoint
          ? { uid: `${last + 1}:*` }
          : {
              since: new Date(
                new Date(connection.created_at).getTime() -
                  connection.initial_days * 86400000,
              ),
            };
        const uids = ((await client.search(query, { uid: true })) || [])
          .filter((n) => n > last)
          .sort((a, b) => a - b)
          .slice(0, 50);
        const messages = [];
        for (const uid of uids)
          messages.push(await readMessage(client, box, uid));
        return {
          credentials,
          messages,
          state: {
            ...previous,
            uidValidity: String(box.uidValidity),
            lastUid: uids.at(-1) || last,
          },
        };
      });
    },
    async search(connection, credentials, term) {
      if (credentials.provider === "outlook") {
        const auth = await refreshMicrosoft(credentials);
        const phrase = term.replace(/["\\\r\n]/g, " ").trim();
        const data = await graphGet(
          graphPath(credentials) +
            "/mailFolders/inbox/messages?" +
            new URLSearchParams({
              $search: '"' + phrase + '"',
              $select: "id,conversationId,subject,body,from,receivedDateTime",
              $top: "20",
            }),
          auth.accessToken,
        );
        return {
          credentials: auth.credentials,
          messages: (data.value || []).map(normalizeGraph),
        };
      }
      return withClient(credentials, async (client, box) => {
        const uids = (
          (await client.search(
            { or: [{ subject: term }, { from: term }, { body: term }] },
            { uid: true },
          )) || []
        )
          .sort((a, b) => b - a)
          .slice(0, 20);
        const messages = [];
        for (const uid of uids)
          messages.push(await readMessage(client, box, uid));
        return { credentials, messages };
      });
    },
    async read(connection, credentials, externalIds) {
      if (credentials.provider === "outlook") {
        const auth = await refreshMicrosoft(credentials);
        const messages = [];
        for (const id of externalIds)
          messages.push(
            normalizeGraph(
              await graphGet(
                graphPath(credentials) +
                  "/messages/" +
                  encodeURIComponent(id) +
                  "?$select=id,conversationId,subject,body,from,receivedDateTime",
                auth.accessToken,
              ),
            ),
          );
        return { credentials: auth.credentials, messages };
      }
      return withClient(credentials, async (client, box) => {
        const messages = [];
        for (const id of externalIds) {
          const parts = id.split(":");
          if (
            parts.length !== 2 ||
            parts[0] !== String(box.uidValidity) ||
            !/^\d+$/.test(parts[1])
          )
            throw mailError("MAIL_CURSOR_INVALID");
          messages.push(await readMessage(client, box, Number(parts[1])));
        }
        return { credentials, messages };
      });
    },
  };
}
