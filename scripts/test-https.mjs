// Optional integration check: PostgreSQL test DB, OpenSSL, Caddy 2, and a built UI.
// Creates its own CA and database schema. Does not install certificates or alter trust stores.
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import https from "node:https";
import net from "node:net";
import { connectDb, migrate } from "../server/db.js";
import { hashPassword } from "../server/security.js";
const caddy = process.env.CADDY_TEST_EXE || "caddy",
  root = connectDb(process.env.TEST_DATABASE_URL),
  schema = "https_" + randomUUID().replaceAll("-", ""),
  dir = await mkdtemp(join(tmpdir(), "relay-https-")),
  org = randomUUID(),
  admin = randomUUID(),
  password = randomUUID() + "-test";
let db,
  backend,
  proxy,
  proxyOutput = "";
function run(command, args) {
  return execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function stop(child) {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}
try {
  const port = await freePort(),
    tlsPort = await freePort(),
    origin = `https://relay.test:${tlsPort}`,
    caKey = join(dir, "ca.key"),
    caCert = join(dir, "ca.pem"),
    key = join(dir, "server.key"),
    csr = join(dir, "server.csr"),
    cert = join(dir, "server.pem"),
    extension = join(dir, "san.cnf");
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    caCert,
    "-days",
    "1",
    "-subj",
    "/CN=Relay isolated test CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ]);
  run("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    csr,
    "-subj",
    "/CN=relay.test",
  ]);
  await writeFile(
    extension,
    "subjectAltName=DNS:relay.test\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n",
  );
  run("openssl", [
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    caCert,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    cert,
    "-days",
    "1",
    "-extfile",
    extension,
  ]);
  await root.query("CREATE SCHEMA " + schema);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", "-c search_path=" + schema);
  db = connectDb(url.href);
  await migrate(db);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
    org,
    "HTTPS test",
  ]);
  await db.query(
    "INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Admin','https@example.test',$3,'admin')",
    [admin, org, hashPassword(password)],
  );
  const env = {
    ...process.env,
    APP_ORIGIN: origin,
    APP_ORIGINS: "",
    HOST: "127.0.0.1",
    PORT: String(port),
    TRUST_PROXY_HOPS: "1",
    NODE_ENV: "production",
    DATABASE_URL: url.href,
  };
  backend = spawn(process.execPath, ["server/https.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let backendOutput = "";
  backend.stdout.on("data", (b) => (backendOutput += b));
  backend.stderr.on("data", (b) => (backendOutput += b));
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (backend.exitCode !== null)
      throw Error("Backend startup failed: " + backendOutput);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Backend not ready");
  const config = (await readFile("deploy/Caddyfile", "utf8"))
    .replace("{$RELAY_HTTPS_SITE}", origin)
    .replace("{$RELAY_TLS_CERT_FILE}", cert.replaceAll("\\", "/"))
    .replace("{$RELAY_TLS_KEY_FILE}", key.replaceAll("\\", "/"))
    .replace("{$PORT:3001}", String(port))
    .replace(origin + " {", origin + " {\n bind 127.0.0.1");
  const file = join(dir, "Caddyfile");
  await writeFile(file, config);
  run(caddy, ["validate", "--config", file, "--adapter", "caddyfile"]);
  proxy = spawn(caddy, ["run", "--config", file, "--adapter", "caddyfile"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxy.stdout.on("data", (b) => (proxyOutput += b));
  proxy.stderr.on("data", (b) => (proxyOutput += b));
  const ca = await readFile(caCert);
  function request(
    path,
    { method = "GET", body, cookie, extraHeaders = {}, trust = true } = {},
  ) {
    return new Promise((resolve, reject) => {
      const text = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: "relay.test",
          port: tlsPort,
          path,
          method,
          servername: "relay.test",
          ca: trust ? ca : undefined,
          lookup: (hostname, options, callback) =>
            options.all
              ? callback(null, [{ address: "127.0.0.1", family: 4 }])
              : callback(null, "127.0.0.1", 4),
          headers: {
            ...(body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(text),
                }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...extraHeaders,
          },
        },
        (res) => {
          const parts = [];
          res.on("data", (b) => parts.push(b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(parts).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      if (text) req.write(text);
      req.end();
    });
  }
  ready = false;
  for (let n = 0; n < 100; n++) {
    if (proxy.exitCode !== null)
      throw Error("Proxy startup failed: " + proxyOutput);
    try {
      if ((await request("/api/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("HTTPS proxy not ready: " + proxyOutput);
  try {
    await request("/api/health", { trust: false });
    throw Error("Untrusted certificate accepted");
  } catch (e) {
    if (
      ![
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      ].includes(e.code)
    )
      throw e;
  }
  const html = await request("/");
  if (html.status !== 200 || !html.text.includes('id="root"'))
    throw Error("HTTPS compiled UI failed");
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { organizationId: org, email: "https@example.test", password },
    extraHeaders: {
      Origin: origin,
      "X-Forwarded-Proto": "http",
      "X-Forwarded-For": "198.51.100.99",
    },
  });
  if (login.status !== 200) throw Error("HTTPS login failed: " + login.text);
  const spoofed = await request("/api/auth/login", {
    method: "POST",
    body: { organizationId: org, email: "https@example.test", password },
    extraHeaders: { Origin: origin, "X-Forwarded-For": "203.0.113.88" },
  });
  const remaining = (r) =>
    Number(r.headers.ratelimit?.match(/remaining=(\d+)/)?.[1]);
  if (
    spoofed.status !== 200 ||
    !Number.isFinite(remaining(login)) ||
    remaining(spoofed) !== remaining(login) - 1
  )
    throw Error("Spoofed client IP changed the proxy rate-limit identity");
  const cookie = login.headers["set-cookie"][0];
  for (const flag of ["Secure", "HttpOnly", "SameSite=Strict"])
    if (!cookie.includes(flag)) throw Error("Missing cookie flag " + flag);
  if (
    !login.headers["strict-transport-security"] ||
    !login.headers["content-security-policy"]?.includes(
      "frame-ancestors 'none'",
    )
  )
    throw Error("HTTPS headers missing");
  if (
    (await request("/api/auth/me", { cookie: cookie.split(";")[0] })).status !==
    200
  )
    throw Error("HTTPS session failed");
  if (
    (
      await request("/api/auth/logout", {
        method: "POST",
        cookie: cookie.split(";")[0],
        extraHeaders: { Origin: "https://untrusted.test" },
      })
    ).status !== 403
  )
    throw Error("Foreign origin accepted");
  if ((await fetch(`http://127.0.0.1:${port}/api/auth/me`)).status !== 403)
    throw Error("Direct HTTP backend accepted");
  const privateResponse = await request("/.relay/https.env");
  if (privateResponse.text.includes("RELAY_TLS_KEY_FILE="))
    throw Error("Private configuration leaked");
  console.log(
    "PASS: real Caddy HTTPS, trusted test CA and hostname verification, rejection of untrusted CA, compiled UI, Secure session, CSP/HSTS, forwarded-header replacement and foreign-origin/direct-HTTP denial. No system trust-store changes.",
  );
} finally {
  await stop(proxy);
  await stop(backend);
  await db?.end();
  await root.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await root.end();
  await rm(dir, { recursive: true, force: true });
}
