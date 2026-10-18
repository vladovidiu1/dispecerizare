import express from "express";
import { fileURLToPath } from "node:url";
import { connectDb, migrate } from "./db.js";
import { createApp } from "./app.js";
import { createOllama } from "./ollama.js";
import { createAiRunner, startWorkers } from "./ai-runner.js";
import { createMailService } from "./mail-service.js";
if (
  process.env.NODE_ENV === "production" &&
  !process.env.APP_ORIGIN?.startsWith("https://")
)
  throw new Error("Production requires HTTPS APP_ORIGIN");
const db = connectDb();
await migrate(db);
const ollama = createOllama(),
  aiRunner = createAiRunner(db, ollama),
  mailService = createMailService(db);
const stopWorkers = startWorkers(db, mailService, aiRunner);
const app = createApp(db, {
  ollama,
  aiRunner,
  mailService,
  production: process.env.NODE_ENV === "production",
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),
  additionalOrigins: (process.env.APP_ORIGINS || " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  appOrigin: process.env.APP_ORIGIN || "http://localhost:5173",
});
if (process.env.NODE_ENV === "production" || process.env.SERVE_UI === "true") {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  app.use(express.static(dist));
  app.get("/{*path}", (req, res) => res.sendFile(dist + "/index.html"));
}
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () => console.log("Relay API started"),
);
async function shutdown() {
  server.close(async () => {
    await stopWorkers();
    await db.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
