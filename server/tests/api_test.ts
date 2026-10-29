import "./_setup.ts";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { daysAgo, registerUser, resetDb, TestClient } from "./helpers.ts";

const today = () => new Date().toLocaleDateString("en-CA");
const PNG_1PX = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (ch) => ch.charCodeAt(0));

Deno.test("register, log out, log back in; activity history persists", async () => {
  resetDb();
  const { client, user } = await registerUser("Gary");
  assertEquals(user.name, "Gary");
  assertEquals((await client.get("/api/auth/me")).json.email, "gary@example.com");

  const logged = await client.post("/api/activities", { sport: "running", date: today(), distance: 5.5 });
  assertEquals(logged.status, 201);
  assert(logged.json.counts);

  await client.post("/api/auth/logout");
  assertEquals((await client.get("/api/auth/me")).json, null);
  assertEquals((await client.get("/api/activities")).status, 401);

  const bad = await client.post("/api/auth/login", { email: "gary@example.com", password: "wrong-password" });
  assertEquals(bad.status, 401);
  const ok = await client.post("/api/auth/login", { email: "GARY@example.com", password: "slow-and-steady" });
  assertEquals(ok.status, 200);
  const list = await client.get("/api/activities");
  assertEquals(list.json.activities.length, 1);
  assertEquals(list.json.totalM, 5500);
});

Deno.test("duplicate email and weak password are rejected with field errors", async () => {
  resetDb();
  await registerUser("Gary");
  const c = new TestClient();
  const dup = await c.post("/api/auth/register", { name: "G2", email: "gary@example.com", password: "long-enough", sport: "running" });
  assertEquals(dup.status, 409);
  const weak = await c.post("/api/auth/register", { name: "G3", email: "g3@example.com", password: "short", sport: "running" });
  assertEquals(weak.status, 400);
  assert(weak.json.fields.password);
  const noSport = await c.post("/api/auth/register", { name: "G4", email: "g4@example.com", password: "long-enough", sport: "walking" });
  assertEquals(noSport.status, 400);
  assert(noSport.json.fields.sport);
});

Deno.test("password reset flow", async () => {
  resetDb();
  await registerUser("Gary");
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  const c = new TestClient();
  try {
    assertEquals((await c.post("/api/auth/forgot", { email: "gary@example.com" })).status, 200);
    assertEquals((await c.post("/api/auth/forgot", { email: "nobody@example.com" })).status, 200);
  } finally {
    console.log = orig;
  }
  const token = logs.join("\n").match(/token=([A-Za-z0-9_%-]+)/)![1];
  const reset = await c.post("/api/auth/reset", { token: decodeURIComponent(token), password: "a-brand-new-one" });
  assertEquals(reset.status, 200);
  assertEquals((await c.post("/api/auth/reset", { token: decodeURIComponent(token), password: "again-again" })).status, 400);
  const login = await new TestClient().post("/api/auth/login", { email: "gary@example.com", password: "a-brand-new-one" });
  assertEquals(login.status, 200);
});

Deno.test("profile: update details and upload a photo", async () => {
  resetDb();
  const { client } = await registerUser("Gary");
  const upd = await client.patch("/api/me", { name: "Turbo Gary", sport: "cycling", goal: 50, unit: "mi" });
  assertEquals(upd.status, 200);
  assertEquals(upd.json.name, "Turbo Gary");
  // The goal is fixed by the sport; a submitted goal is ignored.
  assertEquals(upd.json.goalM, 900_000);
  assertEquals((await client.patch("/api/me", { sport: "rowing" })).json.goalM, 300_000);
  assertEquals((await client.patch("/api/me", { sport: "walking" })).status, 400);

  const form = new FormData();
  form.append("photo", new File([PNG_1PX], "me.png", { type: "image/png" }));
  const up = await client.req("POST", "/api/me/photo", form);
  assertEquals(up.status, 200);
  assert(up.json.photoUrl.startsWith("/api/photos/"));
  const img = await client.get(up.json.photoUrl);
  assertEquals(img.status, 200);
  assertEquals(img.headers.get("content-type"), "image/png");

  const fake = new FormData();
  fake.append("photo", new File(["<svg onload=alert(1)>"], "x.png", { type: "image/png" }));
  assertEquals((await client.req("POST", "/api/me/photo", fake)).status, 415);

  // Photos are only served to logged-in users.
  assertEquals((await new TestClient().get(up.json.photoUrl)).status, 401);
});

Deno.test("activity validation rejects negative, zero, huge and future entries", async () => {
  resetDb();
  const { client } = await registerUser("Gary");
  for (const bad of [
    { sport: "running", date: today(), distance: -3 },
    { sport: "running", date: today(), distance: 0 },
    { sport: "running", date: today(), distance: 5000 },
    { sport: "running", date: "2999-01-01", distance: 5 },
    { sport: "flying", date: today(), distance: 5 },
    { sport: "running", date: "not-a-date", distance: 5 },
  ]) {
    const r = await client.post("/api/activities", bad);
    assertEquals(r.status, 400, JSON.stringify(bad));
  }
});

Deno.test("fixed sport goals: the race is ranked by share of each racer's goal", async () => {
  resetDb();
  const cyclist = await registerUser("Cyril", "cycling"); // 900 km goal
  const rower = await registerUser("Rowena", "rowing"); // 300 km goal
  const runner = await registerUser("Rita", "running"); // 225 km goal
  const swimmer = await registerUser("Sam", "swimming"); // 75 km goal
  await cyclist.client.post("/api/activities", { sport: "cycling", date: today(), distance: 90 }); // 10%
  await rower.client.post("/api/activities", { sport: "rowing", date: today(), distance: 30 }); // 10%
  await runner.client.post("/api/activities", { sport: "running", date: today(), distance: 45 }); // 20%
  await swimmer.client.post("/api/activities", { sport: "swimming", date: today(), distance: 3 }); // 4%
  // Other sports don't move your racer.
  await runner.client.post("/api/activities", { sport: "cycling", date: today(), distance: 500 });

  const races = await swimmer.client.get("/api/races");
  const def = races.json.find((r: any) => r.isDefault);
  const s = (await swimmer.client.get(`/api/races/${def.id}`)).json.standings;
  const byName = Object.fromEntries(s.map((x: any) => [x.user.name, x]));
  assertEquals(s[0].user.name, "Rita");
  assertEquals(byName.Cyril.progress, 0.1);
  assertEquals(byName.Rowena.progress, 0.1);
  assertEquals(byName.Cyril.rank, byName.Rowena.rank, "same share of goal = same place");
  assertEquals(byName.Rita.progress, 0.2);
  assertEquals(byName.Rita.distanceM, 45000);
  assertEquals(byName.Sam.progress, 0.04);
  assertEquals(byName.Cyril.goalM, 900_000);
  assertEquals(byName.Cyril.remainingM, 810_000);

  const list = await runner.client.get("/api/activities");
  const ride = list.json.activities.find((a: any) => a.sport === "cycling");
  assertEquals(ride.excludedReason, "other_sport");
  assertEquals(list.json.totalM, 45000);

  const dash = await rower.client.get("/api/dashboard");
  assertEquals(dash.json.leader.user.name, "Rita");
  assertEquals(dash.json.myStanding.progress, 0.1);
});

Deno.test("switching sport recalculates progress from that sport's activities", async () => {
  resetDb();
  const { client } = await registerUser("Flip", "running");
  await client.post("/api/activities", { sport: "running", date: today(), distance: 22.5 });
  await client.post("/api/activities", { sport: "swimming", date: today(), distance: 15 });
  assertEquals((await client.get("/api/dashboard")).json.myStanding.progress, 0.1);
  await client.patch("/api/me", { sport: "swimming" });
  assertEquals((await client.get("/api/dashboard")).json.myStanding.progress, 0.2);
});

Deno.test("users cannot edit or delete other users' activities or profiles", async () => {
  resetDb();
  const a = await registerUser("Alice");
  const b = await registerUser("Bob");
  const act = await a.client.post("/api/activities", { sport: "running", date: today(), distance: 10 });
  const id = act.json.id;
  assertEquals((await b.client.patch(`/api/activities/${id}`, { sport: "running", date: today(), distance: 99 })).status, 404);
  assertEquals((await b.client.del(`/api/activities/${id}`)).status, 404);
  assertEquals((await b.client.get("/api/activities")).json.activities.length, 0);
  // PATCH /api/me only ever touches the caller.
  await b.client.patch("/api/me", { name: "Hacker" });
  assertEquals((await a.client.get("/api/me")).json.name, "Alice");
  // Owner can edit and delete.
  const edited = await a.client.patch(`/api/activities/${id}`, { sport: "running", date: today(), distance: 12 });
  assertEquals(edited.json.distanceM, 12000);
  assertEquals((await a.client.del(`/api/activities/${id}`)).status, 200);
});

Deno.test("cross-site state-changing requests are blocked", async () => {
  resetDb();
  const a = await registerUser("Alice");
  const r = await a.client.req("POST", "/api/activities", { sport: "running", date: today(), distance: 1 }, { origin: "https://evil.example" });
  assertEquals(r.status, 403);
});

Deno.test("custom race: invitations and date range", async () => {
  resetDb();
  const a = await registerUser("Alice", "running");
  const b = await registerUser("Bob", "swimming");
  const outsider = await registerUser("Olga");
  const created = await a.client.post("/api/races", {
    name: "Spring Sprint",
    startDate: daysAgo(10),
    endDate: daysAgo(1),
    inviteUserIds: [b.user.id],
  });
  assertEquals(created.status, 201);
  const raceId = created.json.id;

  // Not invited: can't see or join.
  assertEquals((await outsider.client.get(`/api/races/${raceId}`)).status, 404);
  assertEquals((await outsider.client.post(`/api/races/${raceId}/join`)).status, 404);

  assertEquals((await b.client.post(`/api/races/${raceId}/join`)).json.myStatus, "joined");

  await a.client.post("/api/activities", { sport: "running", date: daysAgo(5), distance: 45 }); // 20%, counts
  await a.client.post("/api/activities", { sport: "running", date: daysAgo(20), distance: 100 }); // before the race
  await b.client.post("/api/activities", { sport: "swimming", date: daysAgo(4), distance: 50 });
  await b.client.post("/api/activities", { sport: "swimming", date: daysAgo(3), distance: 30 }); // crosses 75 km
  await b.client.post("/api/activities", { sport: "swimming", date: daysAgo(0), distance: 30 }); // after the race

  const detail = await a.client.get(`/api/races/${raceId}`);
  const [first, second] = detail.json.standings;
  assertEquals(first.user.name, "Bob");
  assertEquals(first.finishedOn, daysAgo(3));
  assertEquals(first.progress, 1);
  assertEquals(first.distanceM, 80000);
  assertEquals(second.progress, 0.2);
  assertEquals(detail.json.race.status, "completed");

  const list = await a.client.get("/api/races");
  const done = list.json.find((r: any) => r.id === raceId);
  assertEquals(done.podium[0].user.name, "Bob");
});

Deno.test("Strava-only tracking needs a Strava connection", async () => {
  resetDb();
  const { client } = await registerUser("Gary");
  const r = await client.patch("/api/me", { trackingMethod: "strava" });
  assertEquals(r.status, 400);
  assertEquals((await client.patch("/api/me", { trackingMethod: "both" })).status, 200);
});

Deno.test("encryption: secrets round-trip with the configured key", async () => {
  const { encryptSecret, decryptSecret } = await import("../lib/crypto.ts");
  // The test setup uses a base64 key; round-trip with it.
  assertEquals(decryptSecret(encryptSecret("strava-token")), "strava-token");
});
