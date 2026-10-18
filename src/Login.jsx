import React, { useState } from "react";
import { api } from "./api";
export default function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            onLogin(
              await api("/auth/login", {
                method: "POST",
                body: Object.fromEntries(form),
              }),
            );
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          relay<span className="brand-dot">.</span>
        </div>
        <h2>Intră în spațiul tău de lucru</h2>
        <p>Conectează-te cu datele primite de la administrator.</p>
        <label>
          ID organizație
          <input name="organizationId" required autoComplete="organization" />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Parolă
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Se conectează…" : "Autentificare"}
        </button>
      </form>
    </div>
  );
}
