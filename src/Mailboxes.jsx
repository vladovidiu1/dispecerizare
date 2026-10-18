import React, { useEffect, useState } from "react";
import { Mail, RefreshCw, Search, Plus, ShieldCheck } from "lucide-react";
import { api } from "./api";
const names = {
  outlook: "Outlook / Microsoft 365",
  gmail: "Gmail",
  yahoo: "Yahoo Mail",
};
const errors = {
  MAIL_AUTH: "Autorizare lipsă, expirată sau refuzată. Reconectează contul.",
  MAIL_NETWORK:
    "Furnizorul nu răspunde. Verifică rețeaua și setările contului.",
  MAIL_PROVIDER: "Furnizorul a refuzat cererea. Verifică permisiunile.",
  MAIL_ACCOUNT_MISMATCH: "Contul autorizat nu corespunde adresei configurate.",
  MAIL_UIDVALIDITY_CHANGED:
    "Căsuța și-a schimbat identificatorul. Oprește monitorizarea și pornește din nou doar de acum; istoricul nu este importat automat.",
  MAIL_VAULT:
    "Cheia locală pentru credențiale lipsește sau nu corespunde. Restaurează cheia ori reconfigurează conexiunea.",
};
export default function Mailboxes() {
  const [rows, setRows] = useState([]),
    [provider, setProvider] = useState("outlook"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [flow, setFlow] = useState(null),
    [selected, setSelected] = useState(""),
    [results, setResults] = useState([]);
  async function load() {
    setRows(await api("/mail-connections"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!flow) return;
    let live = true,
      timer;
    async function poll() {
      try {
        const r = await api("/mail-authorizations/" + flow.flowId + "/poll", {
          method: "POST",
        });
        if (!live) return;
        if (r.pending) {
          timer = setTimeout(poll, (r.interval || 5) * 1000);
        } else {
          setFlow(null);
          setMessage(
            "Cont Microsoft autorizat. Poți verifica și activa monitorizarea.",
          );
          await load();
        }
      } catch (e) {
        if (live) {
          setError(e.message);
          setFlow(null);
        }
      }
    }
    timer = setTimeout(poll, (flow.interval || 5) * 1000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [flow]);
  async function action(fn) {
    setBusy(true);
    setError("");
    setMessage("");
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
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SURSELE SOLICITĂRILOR</div>
          <h1>Conectează căsuța echipei.</h1>
          <p>
            Emailurile sunt citite fără a fi șterse sau marcate ca citite.
            Fiecare mesaj importat devine task.
          </p>
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <div className="info-note" role="status">
          {message}
        </div>
      )}
      {flow && (
        <section className="panel mailbox-auth">
          <h2>Autorizează în Microsoft</h2>
          <p>
            Deschide pagina Microsoft și introdu codul de mai jos.
            Autentifică-te cu utilizatorul care are acces la căsuță și verifică
            numele aplicației și permisiunile înainte de acceptare.
          </p>
          <strong className="device-code">{flow.userCode}</strong>
          <a
            className="button primary"
            href={flow.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            Deschide Microsoft
          </a>
          <p>
            Așteptăm autorizarea. Codul este temporar; după repornirea
            serverului începe o autorizare nouă.
          </p>
        </section>
      )}
      <div className="ai-grid">
        <section className="panel ai-form">
          <h2>
            <Plus size={17} />
            Adaugă o căsuță
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = Object.fromEntries(new FormData(form));
              action(async () => {
                const body = {
                  provider,
                  address: d.address,
                  initialDays: Number(d.initialDays),
                  pollSeconds: Number(d.pollSeconds),
                };
                if (provider === "outlook")
                  Object.assign(body, {
                    clientId: d.clientId,
                    tenant: d.tenant || "common",
                    shared: d.shared === "on",
                  });
                else body.appPassword = d.appPassword;
                await api("/mail-connections", { method: "POST", body });
                form.reset();
                setMessage(
                  "Conexiune salvată. Autorizează contul Microsoft sau verifică parola de aplicație, apoi activează monitorizarea.",
                );
              });
            }}
          >
            <label>
              Furnizor
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {Object.entries(names).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Adresă email
              <input
                name="address"
                type="email"
                required
                autoComplete="off"
                placeholder="echipa@firma.ro"
              />
            </label>
            {provider === "outlook" ? (
              <>
                <label>
                  Application (client) ID
                  <input
                    name="clientId"
                    required
                    placeholder="ID-ul aplicației din Microsoft Entra"
                  />
                </label>
                <label>
                  Directory (tenant) ID sau common
                  <input
                    name="tenant"
                    placeholder="Tenant ID din Microsoft Entra"
                    required
                  />
                </label>
                <p className="form-help">
                  Aceste ID-uri se iau din Microsoft Entra. Tenant ID este
                  diferit de ID-ul organizației folosit la autentificarea în
                  Relay.
                </p>
                <label className="mail-checkbox">
                  <input name="shared" type="checkbox" />
                  Este o shared mailbox
                </label>
                <details>
                  <summary>Configurare Microsoft necesară</summary>
                  <p>
                    În Microsoft Entra, înregistrează aplicația ca public
                    client, activează „Allow public client flows” și adaugă
                    permisiuni Microsoft Graph delegate: User.Read, Mail.Read
                    și, pentru shared mailbox, Mail.Read.Shared. Poate fi
                    necesar acordul administratorului firmei. Nu se folosește
                    client secret sau parola contului.
                  </p>
                  <p>
                    Pentru shared mailbox autorizează un utilizator cu acces la
                    acea căsuță. Dacă politica firmei blochează device-code
                    login, metoda trebuie aprobată de IT sau va fi necesar un
                    flux OAuth alternativ.
                  </p>
                </details>
              </>
            ) : (
              <>
                <label>
                  Parolă de aplicație
                  <input
                    name="appPassword"
                    type="password"
                    required
                    autoComplete="new-password"
                  />
                </label>
                <p className="form-help">
                  Folosește o parolă de aplicație generată în setările de
                  securitate {names[provider]}, nu parola obișnuită. Gmail
                  necesită verificare în doi pași și permisiunea de folosire a
                  parolelor de aplicație; unele conturi Workspace le interzic.
                  Yahoo poate restricționa generarea lor. Conexiunea folosește
                  IMAP cu TLS.
                </p>
              </>
            )}
            <div className="form-columns">
              <label>
                Import istoric opțional: ultimele zile
                <input
                  name="initialDays"
                  type="number"
                  min="1"
                  max="90"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Verificare la câte secunde
                <input
                  name="pollSeconds"
                  type="number"
                  min="30"
                  max="3600"
                  defaultValue="60"
                  required
                />
              </label>
            </div>
            <button className="button primary" disabled={busy}>
              <Mail size={16} />
              Salvează conexiunea
            </button>
          </form>
          <p className="form-help">
            <ShieldCheck size={14} /> Credențialele sunt criptate pe server.
            Păstrează copia cheii locale împreună cu backupul bazei de date.
          </p>
        </section>
        <section className="mailbox-list">
          {!rows.length && (
            <div className="panel ai-form">
              <h2>Prima conexiune</h2>
              <p>
                Adaugă adresa din formular. Începe cu o căsuță de test și un
                import inițial de o zi.
              </p>
            </div>
          )}
          {rows.map((r) => (
            <div className="panel mailbox-card" key={r.id}>
              <div className="mailbox-card-head">
                <div>
                  <h2>{r.address}</h2>
                  <p>
                    {names[r.provider]}
                    {r.shared ? " · Shared mailbox" : ""}
                  </p>
                </div>
                <span className={"status " + (r.enabled ? "done" : "progress")}>
                  {r.enabled ? "Monitorizare activă" : "Oprită"}
                </span>
              </div>
              {r.monitorFrom && (
                <p>
                  Doar mesaje noi de la:{" "}
                  {new Date(r.monitorFrom).toLocaleString("ro-RO")}
                </p>
              )}
              <p>
                {r.authorized
                  ? "Credențiale configurate"
                  : "Necesită reconectare"}
              </p>
              <p>
                Ultima sincronizare:{" "}
                {r.lastSyncedAt
                  ? new Date(r.lastSyncedAt).toLocaleString("ro-RO")
                  : "Încă nu a rulat"}{" "}
                · {r.queued} mesaje în procesare
              </p>
              {r.lastError && (
                <p className="error-text">
                  {errors[r.lastError] ||
                    "Sincronizarea a eșuat. Verifică autorizarea și conexiunea."}
                </p>
              )}
              <div className="mailbox-actions">
                {r.provider === "outlook" && (
                  <button
                    className="button white"
                    disabled={busy}
                    onClick={() =>
                      action(async () =>
                        setFlow(
                          await api(
                            "/mail-connections/" + r.id + "/authorize",
                            { method: "POST" },
                          ),
                        ),
                      )
                    }
                  >
                    Autorizează Microsoft
                  </button>
                )}
                <button
                  className="button white"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/mail-connections/" + r.id + "/check", {
                        method: "POST",
                      });
                      setMessage("Conexiunea a fost verificată.");
                    })
                  }
                >
                  Verifică
                </button>
                <button
                  className="button primary"
                  disabled={busy || (!r.authorized && !r.enabled)}
                  onClick={() =>
                    action(async () => {
                      if (r.enabled) {
                        await api("/mail-connections/" + r.id, {
                          method: "PATCH",
                          body: { enabled: false },
                        });
                        setMessage("Monitorizare oprită.");
                      } else {
                        await api("/mail-connections/" + r.id + "/start-now", {
                          method: "POST",
                        });
                        setMessage(
                          "Monitorizare pornită doar pentru emailurile sosite de acum. Mesajele existente în Inbox au fost ignorate. Poți trimite un email nou pentru test.",
                        );
                      }
                    })
                  }
                >
                  {r.enabled
                    ? "Oprește monitorizarea"
                    : "Pornește doar de acum"}
                </button>
                {!r.enabled && (
                  <button
                    className="button white"
                    disabled={busy || !r.authorized}
                    onClick={() =>
                      action(async () => {
                        await api("/mail-connections/" + r.id, {
                          method: "PATCH",
                          body: { enabled: true },
                        });
                        setMessage(
                          r.monitorFrom || r.lastSyncedAt
                            ? "Monitorizare reluată de la ultimul punct salvat."
                            : "Monitorizare activată cu importul istoricului recent configurat.",
                        );
                      })
                    }
                  >
                    {r.monitorFrom || r.lastSyncedAt
                      ? "Reia de la ultima verificare"
                      : `Pornește cu istoric (${r.initialDays} ${r.initialDays === 1 ? "zi" : "zile"})`}
                  </button>
                )}
                <button
                  className="button white"
                  disabled={
                    busy ||
                    !r.authorized ||
                    (!r.enabled && !r.monitorFrom && !r.lastSyncedAt)
                  }
                  title="Alege mai întâi punctul de pornire al monitorizării"
                  onClick={() =>
                    action(async () => {
                      const data = await api(
                        "/mail-connections/" + r.id + "/sync",
                        { method: "POST" },
                      );
                      setMessage(
                        `${data.imported} mesaje noi importate. Clasificarea continuă în fundal, câte un mesaj odată.`,
                      );
                    })
                  }
                >
                  <RefreshCw size={14} />
                  Sincronizează acum
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(r.id);
                    setResults([]);
                  }}
                >
                  <Search size={14} />
                  Caută în căsuță
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/mail-connections/" + r.id + "/disconnect", {
                        method: "POST",
                      });
                      setMessage(
                        "Conexiune deconectată. Taskurile importate rămân salvate.",
                      );
                    })
                  }
                >
                  Deconectează
                </button>
              </div>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/mail-connections/" + r.id, {
                      method: "DELETE",
                    });
                    if (selected === r.id) {
                      setSelected("");
                      setResults([]);
                    }
                    setMessage(
                      "Configurație eliminată. Taskurile și istoricul rămân salvate; poți adăuga conexiunea din nou.",
                    );
                  })
                }
              >
                Elimină configurația (păstrează taskurile)
              </button>
              {r.provider !== "outlook" && (
                <details>
                  <summary>Actualizează parola de aplicație</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const appPassword = new FormData(form).get("appPassword");
                      action(async () => {
                        await api("/mail-connections/" + r.id + "/password", {
                          method: "PUT",
                          body: { appPassword },
                        });
                        form.reset();
                        setMessage(
                          "Parolă actualizată și conexiune verificată.",
                        );
                      });
                    }}
                  >
                    <input
                      aria-label={"Parolă nouă " + r.address}
                      name="appPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                    />
                    <button className="button white" disabled={busy}>
                      Actualizează
                    </button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </section>
      </div>
      {selected && (
        <section className="panel ai-form mailbox-search">
          <h2>
            Caută în Inbox · {rows.find((r) => r.id === selected)?.address}
          </h2>
          <p>
            Căutarea citește din căsuță. Rezultatele devin taskuri numai când
            apeși Importă.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const query = new FormData(e.currentTarget).get("query");
              action(async () => {
                setResults(
                  (
                    await api("/mail-connections/" + selected + "/search", {
                      method: "POST",
                      body: { query },
                    })
                  ).items,
                );
              });
            }}
          >
            <label>
              Text căutat
              <input
                name="query"
                minLength={2}
                maxLength={200}
                required
                placeholder="Subiect, expeditor sau text"
              />
            </label>
            <button className="button white" disabled={busy}>
              <Search size={15} />
              Caută emailuri
            </button>
          </form>
          <div className="example-list">
            {results.map((m) => (
              <div key={m.externalId}>
                <strong>{m.subject}</strong>
                <span>
                  {m.senderName} · {m.senderEmail}
                </span>
                <p>{m.preview}</p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const result = await api(
                        "/mail-connections/" + selected + "/import",
                        {
                          method: "POST",
                          body: { externalIds: [m.externalId] },
                        },
                      );
                      setMessage(
                        result.imported
                          ? "Email importat. Clasificarea este în coadă."
                          : "Emailul exista deja; nu a fost creat un duplicat.",
                      );
                    })
                  }
                >
                  Importă ca task
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
