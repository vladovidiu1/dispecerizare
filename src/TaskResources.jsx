import React, { useEffect, useState, useRef } from "react";
import { api } from "./api";
const states = {
  queued: "În coada de trimitere",
  sending: "Se trimite",
  sent: "Acceptat de furnizor",
  failed: "Trimitere nereușită",
  unknown: "Rezultat necunoscut — verifică înainte de retrimitere",
  cancelled: "Trimitere anulată",
};
export default function TaskResources({
  id,
  version,
  admin,
  notify,
  team = [],
  onChanged,
  onTransferred,
}) {
  const [entries, setEntries] = useState([]),
    [sources, setSources] = useState([]),
    [resolutions, setResolutions] = useState([]),
    [suggestions, setSuggestions] = useState([]),
    [outgoing, setOutgoing] = useState([]),
    [profile, setProfile] = useState(null),
    [context, setContext] = useState(null),
    [showHelp, setShowHelp] = useState(false),
    [showResolution, setShowResolution] = useState(false),
    [showTransfer, setShowTransfer] = useState(false),
    [showReply, setShowReply] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reply, setReply] = useState("");
  const requestId = useRef(null);
  async function conversation() {
    const c = await api("/messages/" + id + "/conversation");
    setEntries(c.entries);
    setOutgoing(c.outgoing || []);
    setContext(c.replyContext || null);
    return c;
  }
  async function load() {
    const [, k, r, s, p] = await Promise.all([
      conversation(),
      api("/messages/" + id + "/itl"),
      api("/messages/" + id + "/resolutions"),
      api("/messages/" + id + "/suggestions"),
      api("/sender-account"),
    ]);
    setSources(k.sources);
    setResolutions(r);
    setSuggestions(s);
    setProfile(p);
  }
  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [id, version]);
  const pending = outgoing.some((o) => ["queued", "sending"].includes(o.state));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => conversation().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, [pending, id]);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="task-resources">
      <h3>Conversație și atașamente</h3>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {entries.map((entry, i) => (
        <article
          className={
            "conversation-entry " +
            (entry.direction === "outbound" ? "outbound" : "")
          }
          key={entry.id}
        >
          <div className="conversation-heading">
            <strong>{entry.senderName}</strong>
            <span>{new Date(entry.receivedAt).toLocaleString("ro-RO")}</span>
          </div>
          <small>
            {entry.senderEmail} ·{" "}
            {entry.direction === "outbound"
              ? "Răspuns trimis"
              : i === 0
                ? "Mesaj inițial"
                : "Actualizare"}
          </small>
          <p className="email-body">{entry.body}</p>
          {entry.attachments.map((a) => (
            <div className="attachment-row" key={a.id}>
              {a.unavailableReason ? (
                <span>
                  {a.filename} · {a.unavailableReason}
                </span>
              ) : (
                <a href={"/api/attachments/" + a.id + "/download"} download>
                  {a.filename}{" "}
                  <small>({Math.max(1, Math.round(a.size / 1024))} KB)</small> ↓
                </a>
              )}
            </div>
          ))}
        </article>
      ))}
      <div className="mailbox-actions task-action-buttons">
        <button
          className="button primary"
          onClick={() => setShowResolution(!showResolution)}
        >
          Cum am rezolvat
        </button>
        <button
          className="button white"
          onClick={() => setShowTransfer(!showTransfer)}
        >
          Transferă unui coleg
        </button>
        <button
          className="button white"
          onClick={() => setShowReply(!showReply)}
        >
          Răspunde prin email
        </button>
        <button
          className="button white"
          disabled={!sources.length && !suggestions.length}
          onClick={() => setShowHelp(!showHelp)}
        >
          Cum să rezolv
        </button>
      </div>
      {showResolution && (
        <form
          className="ai-form task-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            run(async () => {
              await api("/messages/" + id + "/resolutions", {
                method: "POST",
                body: {
                  summary: f.get("summary"),
                  steps: f.get("steps"),
                  shareable: f.get("shareable") === "on",
                  resolveTask: f.get("resolve") === "on",
                },
              });
              setShowResolution(false);
              notify("Rezoluție salvată în istoricul taskului.");
            });
          }}
        >
          <h3>Documentează rezolvarea</h3>
          <label>
            Rezumatul soluției
            <input name="summary" minLength={5} maxLength={300} required />
          </label>
          <label>
            Pașii efectuați
            <textarea name="steps" minLength={10} maxLength={20000} required />
          </label>
          <label className="checkbox">
            <input name="shareable" type="checkbox" defaultChecked />
            Disponibilă colegilor ca exemplu după rezolvarea taskului
          </label>
          <p>
            Descrie procedura fără parole, date personale sau informații
            specifice clientului.
          </p>
          <label className="checkbox">
            <input name="resolve" type="checkbox" defaultChecked />
            Marchează taskul Rezolvat
          </label>
          <button className="button primary" disabled={busy}>
            Salvează rezolvarea
          </button>
        </form>
      )}
      {showTransfer && (
        <form
          className="ai-form task-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            api("/messages/" + id + "/transfer", {
              method: "POST",
              body: { assignedTo: f.get("to"), reason: f.get("reason") },
            })
              .then(async () => {
                notify(
                  "Task transferat. Noul responsabil îl primește cu starea Nou.",
                );
                await onTransferred?.();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <h3>Predă taskul unui coleg</h3>
          <p>
            Transferul păstrează conversația și documentele. Poți alege explicit
            un coleg activ, inclusiv cu alte competențe; verifică încărcarea
            înainte de predare.
          </p>
          <label>
            Coleg destinatar
            <select name="to" required>
              <option value="">Alege colegul</option>
              {team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.load}/{u.capacity} taskuri ·{" "}
                  {u.skills.join(", ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ce ai făcut și ce rămâne de rezolvat
            <textarea name="reason" minLength={5} maxLength={4000} required />
          </label>
          <button className="button primary" disabled={busy}>
            Confirmă transferul
          </button>
        </form>
      )}
      {showReply && (
        <form
          className="ai-form task-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!requestId.current) requestId.current = crypto.randomUUID();
            run(async () => {
              await api("/messages/" + id + "/reply", {
                method: "POST",
                body: { requestId: requestId.current, body: reply },
              });
              requestId.current = null;
              setReply("");
              setShowReply(false);
              notify(
                "Răspuns pus în coada de trimitere. Urmărește starea în task.",
              );
            });
          }}
        >
          <h3>Răspuns în conversația inițială</h3>
          <p>
            De la:{" "}
            <strong>
              {profile?.address || "Configurează adresa personală în Setări"}
            </strong>
          </p>
          <p>
            Către:{" "}
            <strong>{context?.to || "Expeditorul emailului inițial"}</strong>
            <br />
            Reply-To: {context?.replyTo || "Căsuța monitorizată"}
          </p>
          {!profile?.authorized && (
            <p className="error-text">
              Autorizează adresa de expediere în Setări înainte de trimitere.
            </p>
          )}
          {context && !context.canReply && (
            <p className="error-text">
              Emailul inițial nu are Message-ID disponibil. Nu putem păstra
              corect conversația pentru acest task.
            </p>
          )}
          <label>
            Textul răspunsului
            <textarea
              minLength={1}
              maxLength={20000}
              required
              value={reply}
              readOnly={!!requestId.current}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          <p>
            Acțiunea trimite un email real. Nu adaugă doar o notă internă.
            Confirmarea furnizorului nu garantează livrarea la destinatar.
          </p>
          <button
            className="button primary"
            disabled={
              busy ||
              !reply.trim() ||
              !profile?.authorized ||
              (context && !context.canReply) ||
              outgoing.some((o) =>
                ["queued", "sending", "unknown"].includes(o.state),
              )
            }
          >
            {requestId.current
              ? "Verifică / reia aceeași cerere"
              : "Trimite răspunsul prin email"}
          </button>
        </form>
      )}
      {outgoing.length > 0 && (
        <div className="outgoing-list">
          <h3>Starea răspunsurilor</h3>
          {outgoing.map((o) => (
            <article className="conversation-entry" key={o.id}>
              <strong>{states[o.state] || o.state}</strong>
              <p>
                {o.fromAddress} → {o.toAddress}
              </p>
              <small>
                {new Date(o.createdAt).toLocaleString("ro-RO")}
                {o.lastError ? " · " + o.lastError : ""}
              </small>
              {["failed", "unknown", "queued", "sending"].includes(o.state) && (
                <p className="email-body">{o.body}</p>
              )}
              {o.state === "unknown" && (
                <form
                  className="ai-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(() =>
                      api("/outgoing-mail/" + o.id + "/reconcile", {
                        method: "POST",
                        body: { result: f.get("result"), note: f.get("note") },
                      }),
                    );
                  }}
                >
                  <p>
                    Verifică trimiterea în contul furnizorului sau cu
                    administratorul. Nu retrimite până nu clarifici rezultatul.
                  </p>
                  <label>
                    Rezultatul verificării
                    <select name="result">
                      <option value="sent">
                        Confirm că mesajul a fost trimis
                      </option>
                      <option value="not_sent">
                        Confirm că mesajul NU a fost trimis
                      </option>
                    </select>
                  </label>
                  <label>
                    Dovada verificării
                    <input
                      name="note"
                      required
                      minLength={10}
                      maxLength={2000}
                    />
                  </label>
                  <button className="button white" disabled={busy}>
                    Înregistrează verificarea
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
      {resolutions.length > 0 && (
        <div className="resolution-list">
          <h3>Rezolvări documentate</h3>
          {resolutions.map((r) => (
            <article className="conversation-entry" key={r.id}>
              <strong>{r.summary}</strong>
              <p className="email-body">{r.steps}</p>
              <small>
                {r.authorName} · {new Date(r.createdAt).toLocaleString("ro-RO")}{" "}
                ·{" "}
                {r.shareable
                  ? "Reutilizabilă după rezolvare"
                  : "Doar în acest task"}
              </small>
            </article>
          ))}
        </div>
      )}
      {showHelp && (
        <div className="itl-answer">
          <h3>Instrucțiuni și soluții documentate</h3>
          <p>
            Fragmentele și exemplele sunt căutate după termeni și competență.
            Verifică aplicabilitatea; nu sunt generate automat.
          </p>
          {sources.map((s) => (
            <article key={s.id}>
              <a
                href={"/api/knowledge/" + s.documentId + "/pdf#page=" + s.page}
                target="_blank"
                rel="noreferrer"
              >
                {s.title} · pagina {s.page}
              </a>
              <p className="email-body">{s.body}</p>
            </article>
          ))}
          {suggestions.map((s) => (
            <article key={s.id}>
              <strong>{s.summary}</strong>
              <p className="email-body">{s.steps}</p>
              <small>
                {s.skill} · {new Date(s.createdAt).toLocaleDateString("ro-RO")}
              </small>
            </article>
          ))}
        </div>
      )}
      {admin && (
        <button
          className="button white"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api("/messages/" + id + "/emma", {
                method: "POST",
                body: {},
              });
              notify(
                r.results.some((x) => x.matched)
                  ? "Procesare EMMA încheiată. Verifică jurnalul importurilor."
                  : "Nicio regulă EMMA activă nu se potrivește acestui email.",
              );
            })
          }
        >
          Aplică regulile EMMA acestui email
        </button>
      )}
    </section>
  );
}
