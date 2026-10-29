import { Hono } from "hono";
import { z } from "zod";
import { OTHER_SPORT, SPORT_IDS } from "../../shared/sports.ts";
import { config, stravaConfigured } from "../config.ts";
import { all, run, tx } from "../db.ts";
import { type AppEnv, currentUser, HttpError, jsonBody, parse, requireAuth } from "../lib/http.ts";
import { listProviders } from "../integrations/registry.ts";
import { defaultCategory, resolveCategory, userMappingOverrides } from "../integrations/strava/sportMap.ts";
import {
  beginConnect,
  completeConnect,
  disconnect,
  getConnection,
  handleWebhookEvent,
  PROVIDER,
  type StravaWebhookEvent,
  stravaStatusInfo,
  syncUser,
} from "../integrations/strava/service.ts";

function stravaDetails(userId: number) {
  const conn = getConnection(userId);
  const overrides = userMappingOverrides(userId);
  const typeCounts = all<{ source_sport_type: string; n: number }>(
    `SELECT source_sport_type, COUNT(*) AS n FROM activities WHERE user_id = ? AND source = ?
     GROUP BY source_sport_type ORDER BY n DESC`,
    userId,
    PROVIDER,
  );
  const sourceTypes = typeCounts.map((t) => ({
    type: t.source_sport_type,
    count: t.n,
    category: resolveCategory(t.source_sport_type, overrides),
    defaultCategory: defaultCategory(t.source_sport_type),
    overridden: overrides.has(t.source_sport_type),
  }));
  const logs = all<Record<string, unknown>>(
    `SELECT id, trigger, status, imported, updated, deleted, message, started_at AS startedAt, finished_at AS finishedAt
     FROM sync_logs WHERE user_id = ? AND provider = ? ORDER BY id DESC LIMIT 20`,
    userId,
    PROVIDER,
  );
  return {
    configured: stravaConfigured(),
    connection: conn
      ? {
        athleteId: conn.external_user_id,
        athleteName: conn.display_name,
        status: conn.status,
        scope: conn.scope,
        lastSyncAt: conn.last_sync_at,
        lastError: conn.last_error,
        connectedAt: conn.created_at,
        rateLimitedUntil: conn.rate_limited_until && conn.rate_limited_until * 1000 > Date.now()
          ? new Date(conn.rate_limited_until * 1000).toISOString()
          : null,
        importedCount: typeCounts.reduce((n, t) => n + t.n, 0),
      }
      : null,
    autoSync: {
      webhooks: Boolean(config.strava.webhookVerifyToken),
      intervalMinutes: config.strava.syncIntervalMinutes,
    },
    appRateLimitedUntil: stravaStatusInfo().rateLimitedUntil,
    sourceTypes,
    logs,
  };
}

export const integrations = new Hono<AppEnv>()
  // ---- Webhook endpoints: called by Strava, no user session ----
  .get("/strava/webhook", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode !== "subscribe" || !config.strava.webhookVerifyToken || token !== config.strava.webhookVerifyToken || !challenge) {
      return c.json({ error: "Verification failed" }, 403);
    }
    return c.json({ "hub.challenge": challenge });
  })
  .post("/strava/webhook", async (c) => {
    let event: StravaWebhookEvent;
    try {
      event = await c.req.json();
    } catch {
      return c.json({ ok: false }, 400);
    }
    const expectedSub = Deno.env.get("STRAVA_WEBHOOK_SUBSCRIPTION_ID");
    if (expectedSub && String(event.subscription_id) !== expectedSub) return c.json({ ok: false }, 403);
    if (typeof event.owner_id !== "number" || typeof event.object_id !== "number") return c.json({ ok: false }, 400);
    // Strava wants a 200 within two seconds, so process after responding.
    setTimeout(() => handleWebhookEvent(event).catch((e) => console.error("[strava] webhook processing failed", e)), 0);
    return c.json({ ok: true });
  })
  // ---- OAuth callback: a browser redirect, so it answers with redirects, not JSON ----
  .get("/strava/callback", async (c) => {
    const user = c.get("user");
    const back = (params: string) => c.redirect(`${config.appUrl}/profile?${params}#tracking`);
    if (!user) return c.redirect(`${config.appUrl}/login`);
    try {
      await completeConnect(user.id, {
        code: c.req.query("code"),
        state: c.req.query("state"),
        scope: c.req.query("scope"),
        error: c.req.query("error"),
      });
    } catch (e) {
      const message = e instanceof HttpError ? e.message : "Couldn't connect to Strava. Please try again.";
      if (!(e instanceof HttpError)) console.error("[strava] connect failed", e instanceof Error ? e.message : e);
      return back(`strava_error=${encodeURIComponent(message)}`);
    }
    syncUser(user.id, "initial").catch(() => {});
    return back("strava=connected");
  })
  // ---- Everything below needs a logged-in user and only touches their own data ----
  .use(requireAuth)
  .get("/", (c) => {
    const user = currentUser(c);
    return c.json({ trackingMethod: user.tracking_method, providers: listProviders(user.id) });
  })
  .get("/strava", (c) => c.json(stravaDetails(currentUser(c).id)))
  .post("/strava/connect", async (c) => {
    const user = currentUser(c);
    parse(
      z.object({ consent: z.literal(true, { errorMap: () => ({ message: "Please agree to share your Strava distance totals with your races" }) }) }),
      await jsonBody(c),
    );
    return c.json({ url: beginConnect(user.id) });
  })
  .post("/strava/sync", async (c) => {
    const user = currentUser(c);
    if (!getConnection(user.id)) throw new HttpError(404, "Strava isn't connected");
    const result = await syncUser(user.id, "manual");
    return c.json({ result, details: stravaDetails(user.id) });
  })
  .post("/strava/disconnect", async (c) => {
    const user = currentUser(c);
    const body = parse(z.object({ deleteImported: z.boolean().default(true) }), await jsonBody(c));
    await disconnect(user.id, body.deleteImported);
    return c.json(stravaDetails(user.id));
  })
  .post("/strava/consent", async (c) => {
    const user = currentUser(c);
    const body = parse(z.object({ consent: z.boolean() }), await jsonBody(c));
    run("UPDATE users SET strava_share_consent = ? WHERE id = ?", body.consent ? 1 : 0, user.id);
    return c.json({ consent: body.consent });
  })
  .put("/strava/mapping", async (c) => {
    const user = currentUser(c);
    const body = parse(
      z.object({ sourceType: z.string().min(1).max(60), category: z.enum([...SPORT_IDS, OTHER_SPORT]).nullable() }),
      await jsonBody(c),
    );
    tx(() => {
      if (body.category === null || body.category === defaultCategory(body.sourceType)) {
        run("DELETE FROM user_sport_mapping WHERE user_id = ? AND provider = ? AND source_type = ?", user.id, PROVIDER, body.sourceType);
      } else {
        run(
          `INSERT INTO user_sport_mapping (user_id, provider, source_type, category) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, provider, source_type) DO UPDATE SET category = excluded.category`,
          user.id,
          PROVIDER,
          body.sourceType,
          body.category,
        );
      }
      // Re-categorise already imported activities so totals update immediately.
      run(
        "UPDATE activities SET sport = ? WHERE user_id = ? AND source = ? AND source_sport_type = ?",
        body.category ?? defaultCategory(body.sourceType),
        user.id,
        PROVIDER,
        body.sourceType,
      );
    });
    return c.json(stravaDetails(user.id));
  });
