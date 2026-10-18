import { defineConfig } from "vite";
export default defineConfig({
  server: {
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.relay/**"],
    },
    proxy: { "/api": process.env.API_PROXY_TARGET || "http://127.0.0.1:3001" },
  },
});
