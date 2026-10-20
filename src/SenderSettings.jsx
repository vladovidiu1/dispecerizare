import React, { useEffect, useState } from "react";
import { api } from "./api";
export default function SenderSettings({ user, notify }) {
  const [profile, setProfile] = useState(null),
    [provider, setProvider] = useState("outlook"),
    [busy, setBusy] = useState(false),
    [flow, setFlow] = useState(null),
    [error, setError] = useState("");
  async function load() {
    setProfile(await api("/sender-account"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!flow) return;
    let stopped = false,
      timer;
    async function poll() {
      try {
        const r = await api("/sender-account/authorization/" + flow.flowId, {
          method: "POST",
          body: {},
        });
        if (stopped) return;
        if (!r.pending) {
          setFlow(null);
          await load();
          notify("Adresa de expediere Microsoft este autorizată.");
          return;
        }
        timer = setTimeout(poll, (r.interval || flow.interval) * 1000);
      } catch (e) {
        if (!stopped) {
          setError(e.message);
          setFlow(null);
        }
      }
    }
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [flow]);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel workflow-panel">
      <h2>Adresa mea de expediere</h2>
      <p>
        Răspunsurile din task sunt trimise din contul autorizat aici.
        Destinatarul este expeditorul emailului inițial; „Reply-To” indică
        adresa monitorizată, pentru ca răspunsurile să revină în aplicație.
      </p>
      {profile && (
        <div className="document-row">
          <div>
            <strong>{profile.address}</strong>
            <p>
              {profile.provider} ·{" "}
              {profile.authorized ? "Autorizat" : "Necesită autorizare"}
              {profile.lastError ? " · " + profile.lastError : ""}
            </p>
          </div>
          {profile.provider === "outlook" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setFlow(
                    await api("/sender-account/authorize", {
                      method: "POST",
                      body: {},
                    }),
                  ),
                )
              }
            >
              Autorizează expedierea Microsoft
            </button>
          )}
          <button
            className="button white"
            disabled={busy || !profile.authorized}
            onClick={() =>
              run(async () => {
                await api("/sender-account/check", {
                  method: "POST",
                  body: {},
                });
                notify("Contul de expediere a fost verificat.");
              })
            }
          >
            Verifică expedierea
          </button>
          <button
            className="button white"
            disabled={busy}
            onClick={() =>
              run(() => api("/sender-account", { method: "DELETE" }))
            }
          >
            Deconectează expedierea
          </button>
        </div>
      )}
      {flow && (
        <div className="itl-answer">
          <p>
            Deschide pagina Microsoft și autentifică utilizatorul căruia îi
            aparține adresa de expediere. Verifică aplicația și permisiunile.
          </p>
          <a href={flow.verificationUri} target="_blank" rel="noreferrer">
            Deschide autorizarea Microsoft
          </a>
          <p>
            <strong>{flow.userCode}</strong>
          </p>
          <small>Așteptăm confirmarea autorizării…</small>
        </div>
      )}
      <details open={!profile}>
        <summary>
          {profile
            ? "Configurează sau schimbă adresa"
            : "Configurează adresa de expediere"}
        </summary>
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            const body = { provider, address: f.get("address") };
            if (provider === "outlook") {
              body.clientId = f.get("clientId");
              body.tenant = f.get("tenant") || "organizations";
            } else body.appPassword = f.get("password");
            run(async () => {
              await api("/sender-account", { method: "PUT", body });
              setFlow(null);
              form.reset();
              notify(
                "Configurație salvată." +
                  (provider === "outlook"
                    ? " Autorizează acum expedierea Microsoft."
                    : ""),
              );
            });
          }}
        >
          <label>
            Furnizor expediere
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="outlook">Outlook / Microsoft 365</option>
              <option value="gmail">Gmail</option>
              <option value="yahoo">Yahoo</option>
            </select>
          </label>
          <label>
            Adresa de expediere
            <input
              name="address"
              type="email"
              defaultValue={profile?.address || user.email}
              required
            />
          </label>
          {provider === "outlook" ? (
            <>
              <label>
                Client ID pentru expediere
                <input name="clientId" required />
              </label>
              <label>
                Tenant ID pentru expediere
                <input name="tenant" defaultValue="organizations" required />
              </label>
              <p>
                IT trebuie să permită autentificarea device code și permisiunile
                Microsoft Graph delegate User.Read, Mail.Send și offline_access.
                Nu utiliza parola contului Microsoft sau un client secret.
                Această configurare trimite din căsuța personală autorizată, nu
                face Send As pentru o căsuță shared.
              </p>
            </>
          ) : (
            <>
              <label>
                Parolă de aplicație pentru expediere
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={200}
                />
              </label>
              <p>
                Se folosește SMTP TLS al furnizorului, cu verificarea
                certificatului activă. Nu utiliza un cod temporar din
                autentificator.
              </p>
            </>
          )}
          <button className="button primary" disabled={busy}>
            Salvează adresa de expediere
          </button>
        </form>
      </details>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
