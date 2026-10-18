import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
export function validateHttpsConfig(
  env,
  { checkFiles = false, rootDir = process.cwd() } = {},
) {
  const fail = (message) => {
    throw new Error(message);
  };
  let url;
  try {
    url = new URL(env.APP_ORIGIN);
  } catch {
    fail(
      "APP_ORIGIN must be an exact HTTPS origin approved for this installation.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== env.APP_ORIGIN ||
    url.username ||
    url.password
  )
    fail(
      "APP_ORIGIN must be an exact HTTPS origin, without path, credentials or trailing slash.",
    );
  if (env.HOST !== "127.0.0.1")
    fail(
      "HTTPS profile requires HOST=127.0.0.1; only the proxy is exposed to the network.",
    );
  if (env.TRUST_PROXY_HOPS !== "1")
    fail(
      "HTTPS profile requires TRUST_PROXY_HOPS=1 for the local HTTPS proxy.",
    );
  if (env.NODE_ENV !== "production")
    fail("HTTPS profile requires NODE_ENV=production.");
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    fail("PORT must be an integer from 1024 to 65535.");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    fail("TLS certificate verification must remain enabled.");
  const origins = (env.APP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let u;
    try {
      u = new URL(origin);
    } catch {
      fail("Invalid APP_ORIGINS entry.");
    }
    if (
      u.protocol !== "https:" ||
      u.origin !== origin ||
      u.username ||
      u.password
    )
      fail("Every APP_ORIGINS entry must be an exact HTTPS origin.");
  }
  if (checkFiles) {
    for (const name of ["RELAY_TLS_CERT_FILE", "RELAY_TLS_KEY_FILE"]) {
      if (!env[name])
        fail(name + " is required; obtain a certificate and key from IT.");
      const file = resolve(rootDir, env[name]);
      if (!existsSync(file) || !statSync(file).isFile())
        fail(name + " must refer to an existing regular file.");
      for (const folder of ["dist", "public"]) {
        const root = resolve(rootDir, folder);
        const rel = relative(
          existsSync(root) ? realpathSync(root) : root,
          realpathSync(file),
        );
        const outside =
          rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
        if (!outside) fail(name + " must remain outside public and dist.");
      }
    }
  }
  return { origin: url.origin, site: url.origin, port };
}
