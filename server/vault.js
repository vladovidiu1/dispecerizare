import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
export function createVault(
  directory = process.env.RELAY_DATA_DIR || resolve(".relay"),
) {
  let keyPromise;
  async function key() {
    return (keyPromise ||= (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, "credential.key");
      try {
        await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const k = await readFile(path);
      if (k.length !== 32) throw new Error("Invalid local credential key");
      return k;
    })());
  }
  return {
    async seal(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", await key(), iv);
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    },
    async open(value) {
      const raw = Buffer.from(value, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        await key(),
        raw.subarray(0, 12),
      );
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(raw.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      );
    },
  };
}
