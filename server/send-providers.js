import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { refreshMicrosoft } from "./mail-providers.js";
const fail = (code, message, unknown = false) =>
  Object.assign(new Error(message), { code, status: 400, unknown });
async function graph(path, credentials, options = {}) {
  const auth = await refreshMicrosoft(credentials);
  let response;
  try {
    response = await fetch("https://graph.microsoft.com/v1.0" + path, {
      ...options,
      headers: {
        Authorization: "Bearer " + auth.accessToken,
        ...options.headers,
      },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
  } catch {
    throw fail(
      "SEND_NETWORK",
      "Conexiunea cu Microsoft a fost întreruptă.",
      options.method === "POST",
    );
  }
  if (!response.ok)
    throw fail(
      [401, 403].includes(response.status) ? "SEND_AUTH" : "SEND_PROVIDER",
      "Microsoft a refuzat operația de trimitere sau accesul.",
      options.method === "POST" && response.status >= 500,
    );
  return { response, credentials: auth.credentials };
}
export function createSendProviders({
  smtpFactory = (options) => nodemailer.createTransport(options),
} = {}) {
  function transport(c) {
    return smtpFactory({
      host: c.provider === "gmail" ? "smtp.gmail.com" : "smtp.mail.yahoo.com",
      port: 465,
      secure: true,
      auth: { user: c.address, pass: c.appPassword },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      logger: false,
      debug: false,
    });
  }
  return {
    async verify(c) {
      if (c.provider === "outlook") {
        const r = await graph("/me?$select=mail,userPrincipalName", c);
        const user = await r.response.json();
        if (
          ![user.mail, user.userPrincipalName].some(
            (email) => email?.toLowerCase() === c.address,
          )
        )
          throw fail(
            "SEND_ACCOUNT_MISMATCH",
            "Contul Microsoft autorizat nu corespunde adresei de expediere.",
          );
        return { credentials: r.credentials };
      }
      const t = transport(c);
      try {
        await t.verify();
        return { credentials: c };
      } catch {
        throw fail(
          "SEND_AUTH",
          "Autentificarea SMTP nu a reușit. Verifică parola de aplicație și politica furnizorului.",
        );
      } finally {
        t.close?.();
      }
    },
    async send(c, mail) {
      const options = {
        from: mail.from_address,
        to: mail.to_address,
        replyTo: mail.reply_to_address,
        subject: mail.subject,
        text: mail.body,
        messageId: mail.internet_message_id,
        inReplyTo: mail.in_reply_to,
        references: mail.reference_ids,
        disableFileAccess: true,
        disableUrlAccess: true,
      };
      if (c.provider === "outlook") {
        const raw = await new MailComposer(options).compile().build();
        const r = await graph("/me/sendMail", c, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: raw.toString("base64"),
        });
        return { credentials: r.credentials };
      }
      const t = transport(c);
      try {
        const r = await t.sendMail(options);
        if (
          !r.accepted?.some(
            (a) =>
              String(a.address || a).toLowerCase() ===
              mail.to_address.toLowerCase(),
          )
        )
          throw fail(
            "SEND_REJECTED",
            "Destinatarul a fost refuzat de furnizor.",
          );
        return { credentials: c };
      } catch (e) {
        if (e.code?.startsWith("SEND_")) throw e;
        const definite =
          ["EAUTH", "EENVELOPE", "EDNS"].includes(e.code) ||
          (e.code === "ECONNECTION" && e.command === "CONN") ||
          (Number(e.responseCode) >= 400 && Number(e.responseCode) < 600);
        throw fail(
          definite ? "SEND_REJECTED" : "SEND_UNKNOWN",
          definite
            ? "Furnizorul nu a acceptat mesajul."
            : "Rezultatul trimiterii este necunoscut; verifică înainte de retrimitere.",
          !definite,
        );
      } finally {
        t.close?.();
      }
    },
  };
}
