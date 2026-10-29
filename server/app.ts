import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config.ts";
import { type AppEnv, HttpError } from "./lib/http.ts";
import { loadUser } from "./lib/session.ts";
import { activities } from "./routes/activities.ts";
import { auth } from "./routes/auth.ts";
import { dashboard } from "./routes/dashboard.ts";
import { integrations } from "./routes/integrations.ts";
import { profile } from "./routes/profile.ts";
import { races } from "./routes/races.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WEBHOOK_PATH = "/api/integrations/strava/webhook";
const appOrigin = new URL(config.appUrl).origin;

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      // The profile page can take a photo with the camera; nothing else needs device access.
      permissionsPolicy: { camera: ["self"], microphone: [], geolocation: [] },
    }),
  );

  // CSRF defence in depth on top of SameSite=Lax cookies: state-changing API calls must
  // come from our own origin. Strava's webhook is the one cross-site caller.
  app.use("/api/*", async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.path !== WEBHOOK_PATH) {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      const ok = origin ? origin === appOrigin : site === "same-origin" || site === undefined && !config.isProd;
      if (!ok) return c.json({ error: "Cross-site request blocked" }, 403);
    }
    await next();
  });

  app.use("/api/*", loadUser);

  app.route("/api/auth", auth);
  app.route("/api", profile);
  app.route("/api/activities", activities);
  app.route("/api/races", races);
  app.route("/api/dashboard", dashboard);
  app.route("/api/integrations", integrations);
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, fields: err.fields }, err.status);
    }
    console.error("[server] unhandled error", err);
    return c.json({ error: "Something went wrong on our side. Please try again." }, 500);
  });

  // Built frontend, with SPA fallback to index.html for client-side routes.
  app.get("*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (!path.includes("..")) {
      const file = path === "/" ? "/index.html" : path;
      try {
        const data = await Deno.readFile(`${config.staticDir}${file}`);
        return c.body(data, 200, {
          "Content-Type": contentType(file),
          "Cache-Control": file.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        });
      } catch { /* fall through */ }
    }
    try {
      const html = await Deno.readTextFile(`${config.staticDir}/index.html`);
      return c.html(html, 200, { "Cache-Control": "no-cache" });
    } catch {
      return c.text("Frontend not built. Run `deno task build`, or use `deno task dev:web` in development.", 404);
    }
  });

  return app;
}

function contentType(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase();
  return {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    ico: "image/x-icon",
    json: "application/json",
    webmanifest: "application/manifest+json",
    woff2: "font/woff2",
    txt: "text/plain; charset=utf-8",
  }[ext ?? ""] ?? "application/octet-stream";
}
