// Serve the compiled UI and API together. APP_ORIGIN must match the address agents use.
process.env.SERVE_UI = "true";
await import("./index.js");
