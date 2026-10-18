export const backendEnabled = import.meta.env.VITE_API_ENABLED === "true";
export async function api(path, options = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (r.status === 204) return null;
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Conexiunea a eșuat");
  return data;
}
