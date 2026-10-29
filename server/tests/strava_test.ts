import "./_setup.ts";
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { all, one, run } from "../db.ts";
import {
  type StravaActivity,
  StravaAuthError,
  type StravaClient,
  StravaError,
  StravaRateLimitError,
} from "../integrations/strava/client.ts";
import { handleWebhookEvent, setStravaClient, syncUser } from "../integrations/strava/service.ts";
import { daysAgo, registerUser, resetDb, TestClient } from "./helpers.ts";

const ATHLETE_ID = 4242;
const nowSec = () => Math.floor(Date.now() / 1000);

/** In-memory stand-in for the Strava API. */
function fakeStrava() {
  const s = {
    activities: new Map<number, StravaActivity>(),
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: nowSec() + 21600,
    refreshCalls: 0,
    listCalls: [] as number[],
    failRefresh: false,
    rateLimited: false,
    revoked: [] as string[],
  };
  const checkToken = (t: string) => {
    if (t !== s.accessToken) throw new StravaAuthError("bad token", 401);
    if (s.rateLimited) throw new StravaRateLimitError(nowSec() + 900);
  };
  const client: StravaClient = {
    authorizeUrl: (state, redirect) => `https://www.strava.com/oauth/authorize?state=${state}&redirect_uri=${redirect}`,
    exchangeCode: () =>
      Promise.resolve({
        access_token: s.accessToken,
        refresh_token: s.refreshToken,
        expires_at: s.expiresAt,
        athlete: { id: ATHLETE_ID, firstname: "Shelly", lastname: "Slug" },
      }),
    refresh: (rt) => {
      if (s.failRefresh || rt !== s.refreshToken) return Promise.reject(new StravaAuthError("invalid refresh", 400));
      s.refreshCalls++;
      s.accessToken = `access-${s.refreshCalls + 1}`;
      s.refreshToken = `refresh-${s.refreshCalls + 1}`;
      s.expiresAt = nowSec() + 21600;
      return Promise.resolve({ access_token: s.accessToken, refresh_token: s.refreshToken, expires_at: s.expiresAt });
    },
    revoke: (t) => {
      s.revoked.push(t);
      return Promise.resolve();
    },
    listActivities: async (token, after, page, perPage = 100) => {
      checkToken(token);
      s.listCalls.push(after);
      const list = [...s.activities.values()]
        .filter((a) => Date.parse(a.start_date) / 1000 > after)
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      return list.slice((page - 1) * perPage, page * perPage);
    },
    getActivity: async (token, id) => {
      checkToken(token);
      const a = s.activities.get(Number(id));
      if (!a) throw new StravaError("Not found", 404);
      return a;
    },
  };
  return { s, client };
}

function act(id: number, sport: string, km: number, daysBack: number): StravaActivity {
  const d = new Date(Date.now() - daysBack * 86400_000);
  return {
    id,
    name: `${sport} #${id}`,
    sport_type: sport,
    type: sport,
    distance: km * 1000,
    moving_time: 1800,
    start_date: d.toISOString(),
    start_date_local: `${d.toLocaleDateString("en-CA")}T07:00:00Z`,
  };
}

async function connect(client: TestClient) {
  const start = await client.post("/api/integrations/strava/connect", { consent: true });
  assertEquals(start.status, 200);
  const state = new URL(start.json.url).searchParams.get("state")!;
  const cb = await client.get(`/api/integrations/strava/callback?state=${state}&code=abc&scope=read,activity:read`);
  assertEquals(cb.status, 302);
  assert(cb.headers.get("location")!.includes("strava=connected"), cb.headers.get("location")!);
  await new Promise((r) => setTimeout(r, 20)); // the initial sync runs in the background
}

const myActs = (userId: number) =>
  all<{ external_id: string; sport: string; distance_m: number }>(
    "SELECT external_id, sport, distance_m FROM activities WHERE user_id = ? AND source = 'strava' ORDER BY external_id",
    userId,
  );

Deno.test("OAuth: connect requires consent, validates state, encrypts tokens", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  const { client, user } = await registerUser("Shelly");

  assertEquals((await client.post("/api/integrations/strava/connect", { consent: false })).status, 400);

  // Forged / unknown state is rejected.
  const forged = await client.get("/api/integrations/strava/callback?state=forged&code=abc&scope=activity:read");
  assert(forged.headers.get("location")!.includes("strava_error"));

  // State issued to another user can't be used by this one.
  const other = await registerUser("Mallory");
  const otherStart = await other.client.post("/api/integrations/strava/connect", { consent: true });
  const stolen = new URL(otherStart.json.url).searchParams.get("state")!;
  const r = await client.get(`/api/integrations/strava/callback?state=${stolen}&code=abc&scope=activity:read`);
  assert(r.headers.get("location")!.includes("strava_error"));

  // Missing activity scope is rejected.
  const st = new URL((await client.post("/api/integrations/strava/connect", { consent: true })).json.url).searchParams.get("state")!;
  const noScope = await client.get(`/api/integrations/strava/callback?state=${st}&code=abc&scope=read`);
  assert(decodeURIComponent(noScope.headers.get("location")!).includes("permission to read your activities"));

  await connect(client);
  const conn = one<{ access_token_enc: string; refresh_token_enc: string }>(
    "SELECT * FROM integration_connections WHERE user_id = ?",
    user.id,
  )!;
  assert(!conn.access_token_enc.includes(s.accessToken), "access token must be encrypted at rest");
  assert(!conn.refresh_token_enc.includes(s.refreshToken), "refresh token must be encrypted at rest");

  const details = await client.get("/api/integrations/strava");
  assertEquals(details.json.connection.athleteName, "Shelly Slug");
  assert(!JSON.stringify(details.json).includes(s.accessToken), "tokens never reach the browser");
  assertEquals((await client.get("/api/me")).json.trackingMethod, "both");
});

Deno.test("sync imports once, never duplicates, and only the race sport counts", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  s.activities.set(1, act(1, "Run", 5, 0));
  s.activities.set(2, act(2, "Ride", 20, 0));
  s.activities.set(3, act(3, "TrailRun", 8, 0));
  s.activities.set(4, { ...act(4, "Yoga", 0, 0), distance: 0 });
  s.activities.set(5, act(5, "Walk", 4, 0));
  const { client, user } = await registerUser("Shelly", "running");
  await connect(client);

  assertEquals(myActs(user.id).length, 4, "distance-less activities are skipped");
  const again = await client.post("/api/integrations/strava/sync");
  assertEquals(again.json.result.status, "ok");
  assertEquals(myActs(user.id).length, 4, "re-sync must not duplicate");
  // Incremental: the second sync asks only for recent activities.
  assert(s.listCalls[1] > s.listCalls[0]);

  // Run + TrailRun are running; the ride is another race sport, the walk isn't a race sport.
  const list = await client.get("/api/activities");
  assertEquals(list.json.totalM, 13000);
  const ride = list.json.activities.find((a: any) => a.sourceSportType === "Ride");
  assertEquals(ride.sport, "cycling");
  assertEquals(ride.excludedReason, "other_sport");
  assert(ride.externalUrl.endsWith("/activities/2"));
  assertEquals(list.json.activities.find((a: any) => a.sourceSportType === "Walk").sport, "other");

  // Remap Walk into running: it now counts too. Unmapping TrailRun makes it stop counting.
  await client.put("/api/integrations/strava/mapping", { sourceType: "Walk", category: "running" });
  await client.put("/api/integrations/strava/mapping", { sourceType: "TrailRun", category: "other" });
  assertEquals((await client.get("/api/activities")).json.totalM, 9000);
  assertEquals((await client.put("/api/integrations/strava/mapping", { sourceType: "Walk", category: "hiking" })).status, 400);

  // Imported activities can't be edited or deleted locally.
  const imported = list.json.activities.find((a: any) => a.source === "strava");
  assertEquals((await client.del(`/api/activities/${imported.id}`)).status, 403);
});

Deno.test("webhooks: create, update, delete and deauthorization", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  const { client, user } = await registerUser("Shelly");
  await connect(client);
  const anon = new TestClient();

  // Subscription validation handshake.
  const bad = await anon.get("/api/integrations/strava/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x");
  assertEquals(bad.status, 403);
  const ok = await anon.get("/api/integrations/strava/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123");
  assertEquals(ok.json, { "hub.challenge": "abc123" });

  s.activities.set(10, act(10, "Run", 7, 0));
  await handleWebhookEvent({ object_type: "activity", aspect_type: "create", object_id: 10, owner_id: ATHLETE_ID });
  assertEquals(myActs(user.id).map((a) => a.distance_m), [7000]);

  s.activities.set(10, { ...act(10, "Run", 9, 0) });
  await handleWebhookEvent({ object_type: "activity", aspect_type: "update", object_id: 10, owner_id: ATHLETE_ID });
  assertEquals(myActs(user.id).map((a) => a.distance_m), [9000]);

  s.activities.set(10, { ...act(10, "Ride", 9, 0) });
  await handleWebhookEvent({ object_type: "activity", aspect_type: "update", object_id: 10, owner_id: ATHLETE_ID });
  assertEquals(myActs(user.id)[0].sport, "cycling", "sport changes are reflected");

  // Webhook payload is only a hint: the event's owner must match a connection.
  await handleWebhookEvent({ object_type: "activity", aspect_type: "delete", object_id: 10, owner_id: 999 });
  assertEquals(myActs(user.id).length, 1);

  await handleWebhookEvent({ object_type: "activity", aspect_type: "delete", object_id: 10, owner_id: ATHLETE_ID });
  assertEquals(myActs(user.id).length, 0);

  s.activities.set(11, act(11, "Run", 3, 0));
  await handleWebhookEvent({ object_type: "activity", aspect_type: "create", object_id: 11, owner_id: ATHLETE_ID });
  await handleWebhookEvent({ object_type: "athlete", aspect_type: "update", object_id: ATHLETE_ID, owner_id: ATHLETE_ID, updates: { authorized: "false" } });
  assertEquals(myActs(user.id).length, 0, "deauthorizing on Strava removes imported data");
  assertEquals((await client.get("/api/integrations/strava")).json.connection, null);
});

Deno.test("expired tokens refresh (with rotation); revoked refresh asks to reconnect", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  const { client, user } = await registerUser("Shelly");
  await connect(client);

  run("UPDATE integration_connections SET expires_at = ? WHERE user_id = ?", nowSec() - 10, user.id);
  s.activities.set(1, act(1, "Run", 5, 0));
  const r = await client.post("/api/integrations/strava/sync");
  assertEquals(r.json.result.status, "ok");
  assertEquals(s.refreshCalls, 1);
  assertEquals(myActs(user.id).length, 1);

  run("UPDATE integration_connections SET expires_at = ? WHERE user_id = ?", nowSec() - 10, user.id);
  s.failRefresh = true;
  const r2 = await client.post("/api/integrations/strava/sync");
  assertEquals(r2.json.result.status, "error");
  assertEquals(r2.json.details.connection.status, "needs_reauth");
  assert(r2.json.details.connection.lastError.includes("Reconnect"));
});

Deno.test("rate limits pause syncing instead of hammering Strava", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  const { client } = await registerUser("Shelly");
  await connect(client);
  s.rateLimited = true;
  const r = await client.post("/api/integrations/strava/sync");
  assertEquals(r.json.result.status, "rate_limited");
  const calls = s.listCalls.length;
  const r2 = await client.post("/api/integrations/strava/sync");
  assertEquals(r2.json.result.status, "rate_limited");
  assertEquals(s.listCalls.length, calls, "no request while paused");
});

Deno.test("manual + Strava: likely duplicates count once, with an override", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  s.activities.set(1, act(1, "Run", 10, 0));
  const { client } = await registerUser("Shelly");
  await connect(client);
  const today = new Date().toLocaleDateString("en-CA");
  const manual = await client.post("/api/activities", { sport: "running", date: today, distance: 10.1 });
  const different = await client.post("/api/activities", { sport: "running", date: today, distance: 4 });
  assertEquals(manual.json.excludedReason, "duplicate");
  assertEquals(different.json.counts, true);
  assertEquals((await client.get("/api/activities")).json.totalM, 14000);

  const overridden = await client.post(`/api/activities/${manual.json.id}/not-duplicate`, { notDuplicate: true });
  assertEquals(overridden.json.counts, true);

  // Tracking method "manual" ignores Strava entirely; "strava" ignores manual entries.
  await client.patch("/api/me", { trackingMethod: "manual" });
  assertEquals((await client.get("/api/activities")).json.totalM, 14100);
  await client.patch("/api/me", { trackingMethod: "strava" });
  assertEquals((await client.get("/api/activities")).json.totalM, 10000);
});

Deno.test("race window excludes Strava activities outside its dates", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  s.activities.set(1, act(1, "Run", 6, 3));
  s.activities.set(2, act(2, "Run", 50, 40));
  const { client } = await registerUser("Shelly");
  await connect(client);
  const race = await client.post("/api/races", { name: "Fortnight", startDate: daysAgo(14), endDate: daysAgo(0) });
  const detail = await client.get(`/api/races/${race.json.id}`);
  assertEquals(detail.json.standings[0].distanceM, 6000);
});

Deno.test("disconnect revokes access and deletes imported data", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  s.activities.set(1, act(1, "Run", 5, 0));
  const { client, user } = await registerUser("Shelly");
  await connect(client);
  await client.post("/api/activities", { sport: "running", date: daysAgo(0), distance: 2 });
  assertEquals(myActs(user.id).length, 1);

  const r = await client.post("/api/integrations/strava/disconnect", { deleteImported: true });
  assertEquals(r.status, 200);
  assertNotEquals(s.revoked.length, 0);
  assertEquals(myActs(user.id).length, 0);
  assertEquals(one("SELECT 1 FROM integration_connections WHERE user_id = ?", user.id), undefined);
  const list = await client.get("/api/activities");
  assertEquals(list.json.totalM, 2000, "manual tracking keeps working");
});

Deno.test("race dates: Strava activities only count inside the event period (inclusive, athlete's local date)", async () => {
  resetDb();
  const { s, client: fake } = fakeStrava();
  setStravaClient(fake);
  const start = daysAgo(10); // think "1 October"
  const end = daysAgo(2); // think "31 October"
  const dayBefore = daysAgo(11); // "30 September"
  const dayAfter = daysAgo(1); // "1 November"
  const at = (id: number, km: number, localDate: string, localTime: string, utc: string): StravaActivity => ({
    id,
    name: `Run ${id}`,
    sport_type: "Run",
    distance: km * 1000,
    moving_time: 1800,
    start_date: utc,
    start_date_local: `${localDate}T${localTime}Z`,
  });
  // 23:30 local the evening before the race: already the race's first day in UTC, but still "September" for the athlete.
  s.activities.set(1, at(1, 30, dayBefore, "23:30:00", `${start}T04:30:00Z`));
  s.activities.set(2, at(2, 10, start, "00:15:00", `${start}T05:15:00Z`)); // first day: counts
  s.activities.set(3, at(3, 12, end, "23:50:00", `${dayAfter}T04:50:00Z`)); // last day, late evening: counts
  s.activities.set(4, at(4, 40, dayAfter, "07:00:00", `${dayAfter}T12:00:00Z`)); // the day after: doesn't count
  s.activities.set(5, at(5, 50, daysAgo(45), "07:00:00", `${daysAgo(45)}T12:00:00Z`)); // weeks earlier: doesn't count

  const { client } = await registerUser("Shelly", "running");
  await connect(client);
  const race = await client.post("/api/races", { name: "October", startDate: start, endDate: end });
  // Leave the always-open Grand Prix so only this race's dates apply to the activity list.
  const def = (await client.get("/api/races")).json.find((r: any) => r.isDefault);
  await client.post(`/api/races/${def.id}/leave`);

  const standing = (await client.get(`/api/races/${race.json.id}`)).json.standings[0];
  assertEquals(standing.distanceM, 22000, "only the runs on the first and last day count");
  assertEquals(standing.progress, 22 / 225);

  const list = await client.get("/api/activities");
  const byName = Object.fromEntries(list.json.activities.map((a: any) => [a.name, a]));
  assertEquals(byName["Run 2"].counts, true);
  assertEquals(byName["Run 3"].counts, true);
  for (const n of ["Run 1", "Run 4", "Run 5"]) {
    assertEquals(byName[n].counts, false, n);
    assertEquals(byName[n].excludedReason, "outside_races", n);
  }
  assertEquals(list.json.totalM, 22000);

  // A manual entry before the race is treated the same way.
  const early = await client.post("/api/activities", { sport: "running", date: dayBefore, distance: 5 });
  assertEquals(early.json.excludedReason, "outside_races");
  assertEquals((await client.get(`/api/races/${race.json.id}`)).json.standings[0].distanceM, 22000);
});
