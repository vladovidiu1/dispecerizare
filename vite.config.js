import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const allowedHosts = [env.APP_ORIGIN, ...(env.APP_ORIGINS || "").split(",")]
    .filter(Boolean)
    .map((origin) => new URL(origin.trim()).hostname);
  return {
    server: {
      allowedHosts,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "**/*.{crt,pem,key,pfx,p12}",
          "**/.git/**",
          "**/.relay/**",
        ],
      },
      proxy: { "/api": env.API_PROXY_TARGET || "http://127.0.0.1:3001" },
    },
  };
});
