import React, { useEffect, useState } from "react";
import { api } from "./api";
export default function TaskResources({ id, version, admin, notify }) {
  const [entries, setEntries] = useState([]),
    [sources, setSources] = useState([]),
    [answer, setAnswer] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setEntries([]);
    setSources([]);
    setAnswer(null);
    setError("");
    Promise.all([
      api("/messages/" + id + "/conversation"),
      api("/messages/" + id + "/itl"),
    ])
      .then(([c, k]) => {
        if (active) {
          setEntries(c.entries);
          setSources(k.sources);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, version]);
  return (
    <section className="task-resources">
      <h3>Conversație și atașamente</h3>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {entries.map((entry, i) => (
        <article className="conversation-entry" key={entry.id}>
          <div className="conversation-heading">
            <strong>{entry.senderName}</strong>
            <span>{new Date(entry.receivedAt).toLocaleString("ro-RO")}</span>
          </div>
          <small>
            {entry.senderEmail} · {i === 0 ? "Mesaj inițial" : "Actualizare"}
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
      <div className="itl-help">
        <div>
          <h3>Instrucțiuni de lucru</h3>
          <p>
            {sources.length
              ? "Am găsit fragmente ITL cu termeni relevanți. Verifică dacă se aplică solicitării."
              : "Nu am găsit un ITL relevant în documentele indexate."}
          </p>
        </div>
        <button
          className="button primary"
          disabled={!sources.length || busy}
          onClick={async () => {
            setBusy(true);
            setAnswer(null);
            try {
              setAnswer(
                await api("/messages/" + id + "/itl", {
                  method: "POST",
                  body: {},
                }),
              );
            } catch (e) {
              notify(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Qwen caută pașii…" : "Cum să rezolv"}
        </button>
      </div>
      {sources.map((s) => (
        <p className="source-link" key={s.id}>
          <a
            href={"/api/knowledge/" + s.documentId + "/pdf#page=" + s.page}
            target="_blank"
            rel="noreferrer"
          >
            {s.title} · pagina {s.page}
          </a>
        </p>
      ))}
      {answer && (
        <div className="itl-answer">
          <h3>Pași propuși din ITL</h3>
          {!answer.steps.length ? (
            <p>
              Fragmentele găsite nu oferă o procedură suficientă. Consultă
              documentele sau cere ajutor.
            </p>
          ) : (
            <ol>
              {answer.steps.map((step, i) => {
                const source = answer.sources.find(
                  (s) => s.id === step.sourceId,
                );
                return (
                  <li key={i}>
                    <p>{step.text}</p>
                    <blockquote>{step.quote}</blockquote>
                    <small>
                      {source?.title} · pagina {source?.page}
                    </small>
                  </li>
                );
              })}
            </ol>
          )}
          <small>
            Asistență AI locală. Verifică procedura și condițiile ei înainte de
            aplicare.
          </small>
        </div>
      )}
      {admin && (
        <button
          className="button white"
          onClick={async () => {
            try {
              const r = await api("/messages/" + id + "/emma", {
                method: "POST",
                body: {},
              });
              notify(
                r.results.some((x) => x.matched)
                  ? "Procesare EMMA încheiată. Verifică jurnalul importurilor."
                  : "Nicio regulă EMMA activă nu se potrivește acestui email.",
              );
            } catch (e) {
              notify(e.message);
            }
          }}
        >
          Aplică regulile EMMA acestui email
        </button>
      )}
    </section>
  );
}
