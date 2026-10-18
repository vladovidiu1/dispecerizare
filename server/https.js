import { validateHttpsConfig } from "./https-config.js";
validateHttpsConfig(process.env);
await import("./index.js");
