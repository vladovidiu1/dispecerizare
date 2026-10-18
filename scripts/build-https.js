import { validateHttpsConfig } from "../server/https-config.js";
import { build } from "vite";
validateHttpsConfig(process.env);
process.env.VITE_API_ENABLED = "true";
await build();
