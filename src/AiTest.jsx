import React, { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, ArrowUpRight } from "lucide-react";
import { api } from "./api";
export default function AiTest({ onOpen }) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [examples, setExamples] = useState([]),
    [skills, setSkills] = useState([]),
    [saving, setSaving] = useState(false);
  const requestId = useRef(null);
  async function check() {
    setStatus(null);
    try {
      setStatus(await api("/ai/status"));
    } catch (e) {
      setError(e.message);
    }
  }
  async function loadConfig() {
    const [s, e] = await Promise.all([api("/skills"), api("/examples")]);
    setSkills(s);
    setExamples(e);
  }
  useEffect(() => {
    check();
    loadConfig().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CLASIFICARE LOCALĂ</div>
          <h1>Un email. Agentul potrivit.</h1>
          <p>
            Testează configurația echipei cu modelul de pe acest calculator.
          </p>
        </div>
      </div>
      <div className="panel ai-status">
        <div>
          <strong>Ollama · {status?.model || "Se verifică…"}</strong>
          <p>
            {!status
              ? "Se verifică legătura cu modelul…"
              : !status.reachable
                ? "Ollama nu răspunde. Deschide Ollama pe calculatorul pe care rulează backendul."
                : !status.installed
                  ? "Ollama este pornit, dar modelul configurat nu este instalat."
                  : "Model disponibil local. Prima clasificare poate dura câteva minute."}
          </p>
        </div>
        <button className="button white" disabled={busy} onClick={check}>
          <RefreshCw size={15} />
          Verifică legătura
        </button>
      </div>
      <div className="ai-grid">
        <section className="panel ai-form">
          <h2>Email de test</h2>
          <p>
            Textul este salvat ca task în aplicație. Nu se trimite niciun email.
          </p>
          <form
            onChange={() => {
              if (!busy) {
                requestId.current = null;
                setResult(null);
              }
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setResult(null);
              requestId.current ||= crypto.randomUUID();
              try {
                setResult(
                  await api("/ai/test", {
                    method: "POST",
                    body: {
                      ...Object.fromEntries(new FormData(e.currentTarget)),
                      requestId: requestId.current,
                    },
                  }),
                );
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Nume expeditor
                <input
                  name="senderName"
                  required
                  maxLength={200}
                  defaultValue="Client Test"
                />
              </label>
              <label>
                Email expeditor
                <input
                  name="senderEmail"
                  type="email"
                  required
                  defaultValue="client@example.com"
                />
              </label>
              <label>
                Subiect
                <input
                  name="subject"
                  required
                  maxLength={1000}
                  placeholder="De exemplu: Clarificare factură"
                />
              </label>
              <label>
                Conținut email
                <textarea
                  name="body"
                  required
                  maxLength={6000}
                  rows={7}
                  placeholder="Introdu textul emailului de test…"
                />
              </label>
              <button
                className="button primary"
                disabled={!status?.installed || !skills.length}
              >
                <Sparkles size={16} />
                {busy ? "Modelul procesează…" : "Clasifică și creează task"}
              </button>
            </fieldset>
          </form>
          {busy && (
            <p role="status">
              Procesăm un singur mesaj odată. Lasă pagina deschisă până apare
              rezultatul.
            </p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {result && (
            <div className="ai-result" role="status">
              <h2>
                {result.warning
                  ? "Task salvat pentru verificare"
                  : "Task salvat"}
              </h2>
              <p>
                {result.warning ||
                  result.notice ||
                  `${result.message?.category} · ${result.message?.agent}`}
              </p>
              {result.classification && (
                <>
                  <p>{result.classification.reason}</p>
                  <small>
                    Estimare model:{" "}
                    {Math.round(result.classification.confidence * 100)}% ·{" "}
                    {result.classification.model}. Estimarea nu este o garanție
                    de corectitudine.
                  </small>
                </>
              )}
              <button className="text-button" onClick={() => onOpen(result.id)}>
                Deschide taskul
                <ArrowUpRight size={15} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  requestId.current = null;
                  setResult(null);
                }}
              >
                Pregătește un test nou
              </button>
            </div>
          )}
        </section>
        <section className="panel ai-form">
          <h2>Exemple pentru model</h2>
          <p>
            Competențele și exemplele sunt citite din baza de date a firmei.
            Pentru acest pilot, promptul folosește primele patru exemple (după
            ID), cu texte scurtate.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setSaving(true);
              setError("");
              try {
                await api("/examples", {
                  method: "POST",
                  body: Object.fromEntries(new FormData(form)),
                });
                await loadConfig();
                form.reset();
              } catch (e) {
                setError(e.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              Competență
              <select
                aria-label="Competență exemplu"
                name="skillId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Alege competența
                </option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subiect exemplu
              <input name="subject" maxLength={1000} required />
            </label>
            <label>
              Text exemplu
              <textarea name="body" maxLength={6000} rows={4} required />
            </label>
            <button
              className="button white"
              disabled={saving || !skills.length}
            >
              {saving ? "Se salvează…" : "Salvează exemplul"}
            </button>
          </form>
          <div className="example-list">
            {examples.map((e) => (
              <div key={e.id}>
                <strong>{e.subject}</strong>
                <span>{skills.find((s) => s.id === e.skillId)?.name}</span>
                <p>{e.body}</p>
              </div>
            ))}
          </div>
          {!skills.length && (
            <p>Adaugă mai întâi competențele în Echipă & competențe.</p>
          )}
        </section>
      </div>
    </>
  );
}
