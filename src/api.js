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

export async function upload(path, file, contentType) {
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": contentType,
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Încărcarea a eșuat");
  return data;
}
