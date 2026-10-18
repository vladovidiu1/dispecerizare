import { spawn } from "node:child_process";
import { validateHttpsConfig } from "../server/https-config.js";
const { site } = validateHttpsConfig(process.env, { checkFiles: true });
const action = process.argv[2] === "validate" ? "validate" : "run";
const child = spawn(
  process.env.CADDY_EXE || "caddy",
  [action, "--config", "deploy/Caddyfile", "--adapter", "caddyfile"],
  {
    stdio: "inherit",
    env: { ...process.env, RELAY_HTTPS_SITE: site },
    shell: false,
  },
);
child.on("error", () => {
  console.error(
    "Caddy could not start. Use a Caddy 2 binary approved by IT; set CADDY_EXE to its full path.",
  );
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
