import React, { useEffect, useState } from "react";
import { api } from "./api";
const fresh = () => ({
  name: "",
  priority: 100,
  enabled: true,
  matchMode: "all",
  skillId: "",
  conditions: [{ field: "subject", operator: "contains", value: "" }],
});
const fields = {
  subject: "Subiect",
  body: "Corpul emailului",
  text: "Subiect sau corp",
  senderEmail: "Adresa expeditorului",
  senderDomain: "Domeniul expeditorului",
  attachmentName: "Numele atașamentului",
};
const operators = {
  contains: "Conține",
  equals: "Este exact",
  starts_with: "Începe cu",
  not_contains: "Nu conține",
};
export default function DispatchRules({ skills, notify, onOpen }) {
  const [rows, setRows] = useState([]),
    [draft, setDraft] = useState(fresh),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null);
  async function load() {
    setRows(await api("/dispatch-rules"));
  }
  useEffect(() => {
    load().catch((e) => notify(e.message));
  }, []);
  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-settings">
      <div className="page-heading">
        <div className="heading-simple">
          <div className="eyebrow">
            REGULI EXPLICITE · CONTROLUL ADMINISTRATORULUI
          </div>
          <h1>Reguli de dispecerizare</h1>
          <p>
            Stabilește competența după conținutul emailului. Distribuirea alege
            apoi agentul disponibil cu cele mai puține taskuri deschise.
          </p>
        </div>
      </div>
      <section className="panel workflow-panel">
        <h2>{editing ? "Modifică regula" : "Adaugă o regulă"}</h2>
        <p>
          Prioritatea cu număr mai mic se aplică prima. La aceeași prioritate,
          skilluri diferite înseamnă conflict și verificare manuală. Textul se
          compară fără diferențe de majuscule sau diacritice; condițiile nu sunt
          expresii regulate.
        </p>
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/dispatch-rules" + (editing ? "/" + editing : ""), {
                method: editing ? "PUT" : "POST",
                body: draft,
              });
              setEditing(null);
              setDraft(fresh());
              notify(
                "Regulă salvată. Se aplică solicitărilor procesate de acum.",
              );
            });
          }}
        >
          <div className="form-columns">
            <label>
              Numele regulii
              <input
                required
                maxLength={150}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Prioritate regulă
              <input
                type="number"
                required
                min="1"
                max="10000"
                value={draft.priority}
                onChange={(e) =>
                  setDraft({ ...draft, priority: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Competență atribuită
              <select
                required
                value={draft.skillId}
                onChange={(e) =>
                  setDraft({ ...draft, skillId: e.target.value })
                }
              >
                <option value="">Alege competența</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Condiții necesare
              <select
                value={draft.matchMode}
                onChange={(e) =>
                  setDraft({ ...draft, matchMode: e.target.value })
                }
              >
                <option value="all">Toate condițiile</option>
                <option value="any">Oricare condiție</option>
              </select>
            </label>
          </div>
          {draft.conditions.map((c, i) => (
            <div className="rule-condition" key={i}>
              <label>
                Câmp {i + 1}
                <select
                  value={c.field}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      conditions: draft.conditions.map((v, n) =>
                        n === i ? { ...v, field: e.target.value } : v,
                      ),
                    })
                  }
                >
                  {Object.entries(fields).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Comparație {i + 1}
                <select
                  value={c.operator}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      conditions: draft.conditions.map((v, n) =>
                        n === i ? { ...v, operator: e.target.value } : v,
                      ),
                    })
                  }
                >
                  {Object.entries(operators).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valoare {i + 1}
                <input
                  required
                  maxLength={250}
                  value={c.value}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      conditions: draft.conditions.map((v, n) =>
                        n === i ? { ...v, value: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="button white"
                disabled={draft.conditions.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: draft.conditions.filter((_, n) => n !== i),
                  })
                }
              >
                Elimină condiția
              </button>
            </div>
          ))}
          <div className="mailbox-actions">
            <button
              type="button"
              className="button white"
              disabled={draft.conditions.length >= 20}
              onClick={() =>
                setDraft({
                  ...draft,
                  conditions: [
                    ...draft.conditions,
                    { field: "subject", operator: "contains", value: "" },
                  ],
                })
              }
            >
              Adaugă condiție
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Regulă activă
            </label>
            <button
              className="button primary"
              disabled={busy || !skills.length}
            >
              Salvează regula
            </button>
            {editing && (
              <button
                type="button"
                className="button white"
                onClick={() => {
                  setEditing(null);
                  setDraft(fresh());
                }}
              >
                Anulează editarea
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="panel workflow-panel">
        <h2>Regulile organizației</h2>
        {!rows.length && (
          <p>
            Nicio regulă configurată. Solicitările fără potrivire rămân
            nealocate pentru verificare.
          </p>
        )}
        {rows.map((r) => (
          <div className="document-row" key={r.id}>
            <div>
              <strong>
                {r.priority} · {r.name}
              </strong>
              <p>
                {skills.find((s) => s.id === r.skillId)?.name} ·{" "}
                {r.enabled ? "Activă" : "Oprită"} ·{" "}
                {r.matchMode === "all" ? "Toate" : "Oricare"} condiții
              </p>
              {r.conditions.map((c, i) => (
                <p key={i}>
                  {fields[c.field]} · {operators[c.operator]} · „{c.value}”
                </p>
              ))}
            </div>
            <button
              className="button white"
              disabled={busy}
              onClick={() => {
                setEditing(r.id);
                const { id, ...body } = r;
                setDraft(body);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Modifică
            </button>
            <button
              className="button white"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api("/dispatch-rules/" + r.id, {
                    method: "PUT",
                    body: { ...r, id: undefined, enabled: !r.enabled },
                  }),
                )
              }
            >
              {r.enabled ? "Oprește" : "Activează"}
            </button>
            <button
              className="button white"
              disabled={busy}
              onClick={() =>
                run(() => api("/dispatch-rules/" + r.id, { method: "DELETE" }))
              }
            >
              Șterge
            </button>
          </div>
        ))}
      </section>
      <section className="panel workflow-panel">
        <h2>Testează regulile active</h2>
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () =>
              setResult(
                await api("/dispatch-rules/preview", {
                  method: "POST",
                  body: {
                    senderEmail: f.get("sender"),
                    subject: f.get("subject"),
                    body: f.get("body"),
                  },
                }),
              ),
            );
          }}
        >
          <label>
            Expeditor de test
            <input name="sender" type="email" required />
          </label>
          <label>
            Subiect de test
            <input name="subject" required maxLength={2000} />
          </label>
          <label>
            Text de test
            <textarea name="body" maxLength={200000} required />
          </label>
          <div className="mailbox-actions">
            <button className="button white" disabled={busy}>
              Verifică fără creare de task
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={(e) => {
                const form = e.currentTarget.closest("form");
                if (!form.reportValidity()) return;
                const f = new FormData(form);
                run(async () => {
                  const saved = await api("/dispatch-rules/test-message", {
                    method: "POST",
                    body: {
                      requestId: crypto.randomUUID(),
                      senderEmail: f.get("sender"),
                      subject: f.get("subject"),
                      body: f.get("body"),
                    },
                  });
                  await onOpen(saved.id);
                });
              }}
            >
              Creează task de test
            </button>
          </div>
        </form>
        {result && (
          <div className="itl-answer">
            <strong>
              {result.outcome === "matched"
                ? "Competență: " +
                  (skills.find((s) => s.id === result.skillId)?.name ||
                    result.skillId)
                : result.outcome === "ambiguous"
                  ? "Conflict: verificare manuală"
                  : "Nicio regulă potrivită: verificare manuală"}
            </strong>
            {result.matchedRules.map((r) => (
              <p key={r.id}>
                {r.priority} · {r.name} ·{" "}
                {skills.find((s) => s.id === r.skillId)?.name}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
