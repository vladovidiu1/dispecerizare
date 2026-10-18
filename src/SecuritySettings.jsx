import React, { useEffect, useState } from "react";
import { api } from "./api";
export default function SecuritySettings({ user, onSignedOut, notify }) {
  const [busy, setBusy] = useState(false),
    [users, setUsers] = useState([]),
    [error, setError] = useState("");
  async function load() {
    if (user.role === "admin") setUsers(await api("/security/users"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="workflow-settings">
      <section className="panel workflow-panel">
        <h1>Securitatea contului</h1>
        <p>
          {user.email} · {user.role === "admin" ? "Administrator" : "Agent"}
        </p>
        <h2>Schimbă parola proprie</h2>
        <p>
          După schimbare, toate sesiunile contului sunt închise. Te vei
          autentifica din nou cu noua parolă.
        </p>
        <form
          className="ai-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setError("");
            if (f.get("newPassword") !== f.get("confirmPassword")) {
              setError("Parolele noi nu coincid.");
              return;
            }
            setBusy(true);
            try {
              await api("/auth/password", {
                method: "POST",
                body: {
                  currentPassword: f.get("currentPassword"),
                  newPassword: f.get("newPassword"),
                },
              });
              notify("Parolă schimbată. Autentifică-te din nou.");
              onSignedOut();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Parola curentă
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              required
            />
          </label>
          <label>
            Parola nouă (minimum 12 caractere)
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              required
            />
          </label>
          <label>
            Confirmă parola nouă
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Se salvează…" : "Schimbă parola și închide sesiunile"}
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </section>
      {user.role === "admin" && (
        <section className="panel workflow-panel">
          <h2>Accesul utilizatorilor</h2>
          <p>
            Dezactivarea blochează autentificarea și închide sesiunile.
            Taskurile utilizatorului rămân alocate: verifică-le și
            redistribuie-le manual înainte sau după dezactivare.
          </p>
          {users.map((u) => (
            <div className="document-row" key={u.id}>
              <div>
                <strong>{u.name}</strong>
                <p>
                  {u.email} · {u.role === "admin" ? "Administrator" : "Agent"} ·{" "}
                  {u.active ? "Activ" : "Dezactivat"}
                </p>
              </div>
              <button
                className="button white"
                disabled={busy || u.id === user.id}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/agents/" + u.id, {
                      method: "PATCH",
                      body: { active: !u.active },
                    });
                    await load();
                    notify(
                      u.active
                        ? "Cont dezactivat și sesiuni închise."
                        : "Cont reactivat.",
                    );
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {u.active ? "Dezactivează contul" : "Reactivează contul"}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
