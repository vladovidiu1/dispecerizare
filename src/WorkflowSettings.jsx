import React, { useEffect, useState } from "react";
import { api, upload } from "./api";
export default function WorkflowSettings({ skills, notify }) {
  const [docs, setDocs] = useState([]),
    [folder, setFolder] = useState(""),
    [rules, setRules] = useState([]),
    [imports, setImports] = useState([]),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false);
  async function load() {
    const [d, r, i] = await Promise.all([
      api("/knowledge"),
      api("/emma/rules"),
      api("/emma/imports"),
    ]);
    setDocs(d.items);
    setFolder(d.folder);
    setRules(r);
    setImports(i);
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
          <div className="eyebrow">CUNOȘTINȚELE ECHIPEI</div>
          <h1>ITL & automatizări EMMA</h1>
          <p>
            Documente și fișiere procesate local, pe calculatorul aplicației.
          </p>
        </div>
      </div>
      <section className="panel workflow-panel">
        <h2>Biblioteca ITL · PDF</h2>
        <p>
          Încarcă PDF-uri cu text selectabil. Documentele scanate au nevoie de
          OCR înainte de import. Maximum 20 MB și 500 pagini per PDF.
        </p>
        <label className="file-field">
          Adaugă un PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file)
                run(async () => {
                  const r = await upload(
                    "/knowledge/pdf",
                    file,
                    "application/pdf",
                  );
                  notify(
                    r.duplicate
                      ? "Documentul este deja indexat."
                      : "PDF indexat local.",
                  );
                });
              e.target.value = "";
            }}
          />
        </label>
        <details>
          <summary>Încarcă din folderul aplicației</summary>
          <p>
            Pe PC-ul sau serverul aplicației, creează folderul{" "}
            <code>.relay/{folder}</code>, copiază PDF-urile și apasă butonul.
            Dacă ai setat RELAY_DATA_DIR, folosește acel director în loc de
            .relay. Subfolderele nu sunt citite.
          </p>
          <button
            className="button white"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api("/knowledge/scan", {
                  method: "POST",
                  body: {},
                });
                notify(
                  `${r.imported} importate, ${r.duplicates} deja existente, ${r.errors.length} erori.`,
                );
                if (r.errors.length) setPreview({ errors: r.errors });
              })
            }
          >
            Indexează folderul ITL
          </button>
        </details>
        {docs.map((d) => (
          <div className="document-row" key={d.id}>
            <a
              href={"/api/knowledge/" + d.id + "/pdf"}
              target="_blank"
              rel="noreferrer"
            >
              {d.title}
            </a>
            <span>{d.chunks} fragmente</span>
            <button
              className="button white"
              disabled={busy}
              onClick={() =>
                run(() => api("/knowledge/" + d.id, { method: "DELETE" }))
              }
            >
              Scoate din index
            </button>
          </div>
        ))}
        {!docs.length && <p>Biblioteca este încă goală.</p>}
      </section>
      <section className="panel workflow-panel">
        <h2>Rapoarte Excel EMMA</h2>
        <p>
          Un task pentru fiecare rând al cărui cod este configurat la un agent
          activ cu competența aleasă. Distribuirea respectă disponibilitatea și
          capacitatea. Restul codurilor sunt ignorate. Fișiere acceptate: XLSX,
          maximum 10 MB, 10.000 rânduri per foaie; maximum 1.000 taskuri per
          fișier.
        </p>
        <p>
          Configurează codurile în „Echipă & competențe”. Apoi verifică
          structura unui Excel de test și adaugă regula de mai jos. Formulele
          Excel nu sunt executate.
        </p>
        <label className="file-field">
          Verifică structura unui Excel
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file)
                run(async () =>
                  setPreview(
                    await upload(
                      "/emma/preview",
                      file,
                      "application/octet-stream",
                    ),
                  ),
                );
              e.target.value = "";
            }}
          />
        </label>
        {preview && (
          <div className="excel-preview">
            {preview.errors?.map((e, i) => (
              <p key={i} className="error-text">
                {e.filename}: {e.error}
              </p>
            ))}
            {preview.sheets?.map((s) => (
              <details key={s.name} open>
                <summary>
                  {s.name} · {s.rows} rânduri
                </summary>
                <div className="preview-table">
                  <table>
                    <tbody>
                      {s.preview.map((r) => (
                        <tr key={r.row}>
                          <th>{r.row}</th>
                          {r.cells.map((c) => (
                            <td key={c.column}>{c.text}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            run(async () => {
              await api("/emma/rules", {
                method: "POST",
                body: {
                  senderEmail: f.get("sender"),
                  subjectContains: f.get("subject"),
                  sheetName: f.get("sheet"),
                  headerRow: Number(f.get("header")),
                  codeColumn: f.get("column"),
                  skillId: f.get("skill"),
                  enabled: f.get("enabled") === "on",
                },
              });
              form.reset();
              notify("Regulă EMMA salvată.");
            });
          }}
        >
          <div className="form-columns">
            <label>
              Expeditor raport
              <input
                type="email"
                name="sender"
                required
                placeholder="facturare@companie.ro"
              />
            </label>
            <label>
              Subiectul conține
              <input
                name="subject"
                maxLength={200}
                placeholder="ex. erori tarifare EMMA"
              />
            </label>
            <label>
              Numele exact al foii Excel
              <input name="sheet" required placeholder="ex. Sheet1" />
            </label>
            <label>
              Rândul antetului
              <input
                name="header"
                type="number"
                min="1"
                max="100"
                defaultValue="1"
                required
              />
            </label>
            <label>
              Numele exact al coloanei de cod
              <input name="column" required placeholder="ex. Cod eroare" />
            </label>
            <label>
              Competență pentru taskurile EMMA
              <select name="skill" required>
                <option value="">Alege competența</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox">
            <input name="enabled" type="checkbox" />
            Activează regula pentru următoarele emailuri
          </label>
          <button className="button primary" disabled={busy || !skills.length}>
            Adaugă regula EMMA
          </button>
        </form>
        {rules.map((r) => (
          <div className="document-row" key={r.id}>
            <div>
              <strong>{r.senderEmail}</strong>
              <p>
                {r.subjectContains || "Orice subiect"} · {r.sheetName} · antet
                rând {r.headerRow} · {r.codeColumn}
              </p>
            </div>
            <button
              className="button white"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api("/emma/rules/" + r.id, {
                    method: "PATCH",
                    body: { enabled: !r.enabled },
                  }),
                )
              }
            >
              {r.enabled ? "Oprește regula" : "Activează regula"}
            </button>
            <button
              className="button white"
              disabled={busy}
              onClick={() =>
                run(() => api("/emma/rules/" + r.id, { method: "DELETE" }))
              }
            >
              Șterge regula
            </button>
          </div>
        ))}
      </section>
      <section className="panel workflow-panel">
        <h2>Ultimele importuri EMMA</h2>
        <button
          className="button white"
          disabled={busy}
          onClick={() => run(async () => {})}
        >
          Actualizează jurnalul
        </button>
        {imports.map((i, n) => (
          <div className="document-row" key={n}>
            <div>
              <strong>{i.filename}</strong>
              <p>
                {new Date(i.createdAt).toLocaleString("ro-RO")} ·{" "}
                {i.createdTasks} taskuri create · {i.ignoredRows} rânduri
                ignorate
              </p>
              {i.error && <p className="error-text">{i.error}</p>}
            </div>
            <span>
              {i.state === "done" ? "Procesat" : "Necesită verificare"}
            </span>
          </div>
        ))}
        {!imports.length && (
          <p>
            Niciun raport procesat încă. Testează cu un Excel fără date
            confidențiale.
          </p>
        )}
      </section>
    </div>
  );
}
