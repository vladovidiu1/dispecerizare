import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateHttpsConfig } from "../https-config.js";
const valid = {
  APP_ORIGIN: "https://relay.example.test",
  APP_ORIGINS: "",
  HOST: "127.0.0.1",
  PORT: "3001",
  NODE_ENV: "production",
  TRUST_PROXY_HOPS: "1",
};
test("HTTPS profile accepts an exact internal origin and a single loopback proxy", () => {
  assert.deepEqual(validateHttpsConfig(valid), {
    origin: valid.APP_ORIGIN,
    site: valid.APP_ORIGIN,
    port: 3001,
  });
  assert.equal(
    validateHttpsConfig({
      ...valid,
      APP_ORIGIN: "https://relay.example.test:8443",
    }).site,
    "https://relay.example.test:8443",
  );
});
test("HTTPS profile rejects insecure origins, exposed backend, unsafe proxy trust and disabled certificate validation", () => {
  for (const patch of [
    { APP_ORIGIN: "http://relay.example.test" },
    { APP_ORIGIN: "https://relay.example.test/" },
    { APP_ORIGIN: "https://user:pass@relay.example.test" },
    { APP_ORIGINS: "http://192.168.1.50:3001" },
    { APP_ORIGINS: "*" },
    { HOST: "0.0.0.0" },
    { TRUST_PROXY_HOPS: "2" },
    { NODE_ENV: "development" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { PORT: "abc" },
    { PORT: "443" },
  ])
    assert.throws(() => validateHttpsConfig({ ...valid, ...patch }));
});
test("proxy configuration requires local certificate files outside public directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-config-"));
  try {
    const cert = join(dir, "cert.pem"),
      key = join(dir, "private.key");
    await writeFile(cert, "fixture certificate");
    await writeFile(key, "fixture key", { mode: 0o600 });
    assert.throws(() => validateHttpsConfig(valid, { checkFiles: true }));
    assert.doesNotThrow(() =>
      validateHttpsConfig(
        { ...valid, RELAY_TLS_CERT_FILE: cert, RELAY_TLS_KEY_FILE: key },
        { checkFiles: true },
      ),
    );
    assert.throws(() =>
      validateHttpsConfig(
        {
          ...valid,
          RELAY_TLS_CERT_FILE: cert,
          RELAY_TLS_KEY_FILE: join(dir, "missing"),
        },
        { checkFiles: true },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proxy rejects a key inside public even when its subdirectory starts with two dots", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-private-"));
  try {
    const publicDir = join(root, "public", "..not-outside");
    await mkdir(publicDir, { recursive: true });
    const cert = join(root, "cert.pem"),
      key = join(publicDir, "private.key");
    await writeFile(cert, "fixture");
    await writeFile(key, "fixture");
    assert.throws(
      () =>
        validateHttpsConfig(
          { ...valid, RELAY_TLS_CERT_FILE: cert, RELAY_TLS_KEY_FILE: key },
          { checkFiles: true, rootDir: root },
        ),
      /outside public and dist/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
