import { config, stravaConfigured } from "./config.ts";
import { createApp } from "./app.ts";
import { getDb } from "./db.ts";
import { validateEncryptionKey } from "./lib/crypto.ts";
import { purgeExpiredSessions } from "./lib/session.ts";
import { startStravaScheduler } from "./integrations/strava/service.ts";
import { ensureDefaultRace } from "./services/races.ts";

// Catch missing production settings at startup rather than on the first Strava connect.
if (config.isProd) {
  if (!config.tokenEncryptionKey) {
    console.error("TOKEN_ENCRYPTION_KEY must be set when APP_ENV=production (any random secret of 32+ characters)");
    Deno.exit(1);
  }
  try {
    validateEncryptionKey();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(1);
  }
  if (!config.appUrl.startsWith("https://")) {
    console.warn(`[config] APP_URL is ${config.appUrl}; use your public https:// address so cookies are secure and Strava redirects work`);
  }
}

// Exit promptly on `docker stop` / Ctrl+C. In a container the app is PID 1, which
// ignores SIGTERM unless it's handled explicitly.
if (Deno.build.os !== "windows") {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(signal, () => {
      console.log(`[server] ${signal} received, shutting down`);
      Deno.exit(0);
    });
  }
}

getDb();
ensureDefaultRace();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60_000);
startStravaScheduler();

Deno.serve({ port: config.port, onListen: ({ port }) => {
  console.log(`🐌 Snail Race API listening on http://localhost:${port}`);
  console.log(`   App URL: ${config.appUrl}`);
  console.log(`   Strava: ${stravaConfigured() ? "configured" : "not configured (manual tracking only)"}`);
} }, createApp().fetch);
