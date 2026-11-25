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
  const dup = await c.post("/api/auth/register", { name: "G2", email: "gary@example.com", password: "long-enough", sports: ["running"] });
  assertEquals(dup.status, 409);
  const weak = await c.post("/api/auth/register", { name: "G3", email: "g3@example.com", password: "short", sports: ["running"] });
  assertEquals(weak.status, 400);
  assert(weak.json.fields.password);
  for (const sports of [[], ["walking"], ["running", "running"], ["running", "cycling", "rowing", "swimming"]]) {
    const r = await c.post("/api/auth/register", { name: "G4", email: "g4@example.com", password: "long-enough", sports });
    assertEquals(r.status, 400, JSON.stringify(sports));
    assert(Object.keys(r.json.fields).some((k) => k.startsWith("sports")), JSON.stringify(r.json));
  }
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
  const upd = await client.patch("/api/me", { name: "Turbo Gary", sports: ["cycling"], goal: 50, unit: "mi" });
  assertEquals(upd.status, 200);
  assertEquals(upd.json.name, "Turbo Gary");
  // The goal follows from the number of sports; a submitted goal is ignored.
  assertEquals(upd.json.sports, ["cycling"]);
  assertEquals(upd.json.goalPoints, 900);
  assertEquals((await client.patch("/api/me", { sports: ["rowing", "cycling"] })).json.goalPoints, 1050);
  assertEquals((await client.patch("/api/me", { sports: ["rowing", "cycling", "swimming"] })).json.goalPoints, 1200);
  assertEquals((await client.patch("/api/me", { sports: ["running", "rowing", "cycling", "swimming"] })).status, 400);
  assertEquals((await client.patch("/api/me", { sports: [] })).status, 400);
  assertEquals((await client.get("/api/me")).json.sports, ["rowing", "cycling", "swimming"]);

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

Deno.test("points: 1/4/3/12 points per km; the race is ranked by share of each racer's goal", async () => {
  resetDb();
  const cyclist = await registerUser("Cyril", "cycling"); // 1 pt/km, goal 900
  const rower = await registerUser("Rowena", "rowing"); // 3 pts/km, goal 900
  const runner = await registerUser("Rita", "running"); // 4 pts/km, goal 900
  const swimmer = await registerUser("Sam", "swimming"); // 12 pts/km, goal 900
  await cyclist.client.post("/api/activities", { sport: "cycling", date: today(), distance: 90 }); // 90 pts = 10%
  await rower.client.post("/api/activities", { sport: "rowing", date: today(), distance: 30 }); // 90 pts = 10%
  const run = await runner.client.post("/api/activities", { sport: "running", date: today(), distance: 45 }); // 180 pts = 20%
  await swimmer.client.post("/api/activities", { sport: "swimming", date: today(), distance: 3 }); // 36 pts = 4%
  assertEquals(run.json.points, 180);
  // A sport you don't take part in doesn't count.
  const ride = await runner.client.post("/api/activities", { sport: "cycling", date: today(), distance: 500 });
  assertEquals(ride.json.excludedReason, "other_sport");

  const def = (await swimmer.client.get("/api/races")).json.find((r: any) => r.isDefault);
  const s = (await swimmer.client.get(`/api/races/${def.id}`)).json.standings;
  const byName = Object.fromEntries(s.map((x: any) => [x.user.name, x]));
  assertEquals(s[0].user.name, "Rita");
  assertEquals(byName.Cyril.points, 90);
  assertEquals(byName.Rowena.points, 90);
  assertEquals(byName.Cyril.progress, 0.1);
  assertEquals(byName.Rowena.progress, 0.1);
  assertEquals(byName.Cyril.rank, byName.Rowena.rank, "same points share = same place");
  assertEquals(byName.Rita.points, 180);
  assertEquals(byName.Rita.progress, 0.2);
  assertEquals(byName.Rita.distanceM, 45000);
  assertEquals(byName.Sam.points, 36);
  assertEquals(byName.Sam.progress, 0.04);
  assertEquals(byName.Cyril.goalPoints, 900);
  assertEquals(byName.Cyril.remainingPoints, 810);

  const list = await runner.client.get("/api/activities");
  assertEquals(list.json.totalPoints, 180);
  assertEquals(list.json.totalM, 45000);
});

Deno.test("multi-sport racers: goal is 1050 for two sports and 1200 for three", async () => {
  resetDb();
  const duo = await registerUser("Duo", ["cycling", "running"]);
  const trio = await registerUser("Trio", ["cycling", "running", "swimming"]);
  for (const c of [duo.client, trio.client]) {
    await c.post("/api/activities", { sport: "cycling", date: today(), distance: 105 }); // 105 pts
    await c.post("/api/activities", { sport: "running", date: today(), distance: 52.5 }); // 210 pts
    await c.post("/api/activities", { sport: "swimming", date: today(), distance: 2.5 }); // 30 pts (trio only)
  }
  const def = (await duo.client.get("/api/races")).json.find((r: any) => r.isDefault);
  const s = (await duo.client.get(`/api/races/${def.id}`)).json.standings;
  const byName = Object.fromEntries(s.map((x: any) => [x.user.name, x]));
  assertEquals(byName.Duo.goalPoints, 1050);
  assertEquals(byName.Duo.points, 315);
  assertEquals(byName.Duo.progress, 315 / 1050);
  assertEquals(byName.Trio.goalPoints, 1200);
  assertEquals(byName.Trio.points, 345);
  assertEquals(byName.Trio.progress, 345 / 1200);
  assertEquals(byName.Trio.bySport.map((b: any) => [b.sport, b.points]), [["cycling", 105], ["running", 210], ["swimming", 30]]);

  // Finishing: the day the points reach the goal.
  await duo.client.post("/api/activities", { sport: "cycling", date: today(), distance: 735 });
  const after = (await duo.client.get(`/api/races/${def.id}`)).json.standings[0];
  assertEquals(after.user.name, "Duo");
  assertEquals(after.progress, 1);
  assertEquals(after.finishedOn, today());
});

Deno.test("changing sports recalculates progress from the new sports' activities", async () => {
  resetDb();
  const { client } = await registerUser("Flip", "running");
  await client.post("/api/activities", { sport: "running", date: today(), distance: 22.5 }); // 90 pts
  await client.post("/api/activities", { sport: "swimming", date: today(), distance: 15 }); // 180 pts
  assertEquals((await client.get("/api/dashboard")).json.myStanding.progress, 0.1);
  await client.patch("/api/me", { sports: ["swimming"] });
  assertEquals((await client.get("/api/dashboard")).json.myStanding.progress, 0.2);
  await client.patch("/api/me", { sports: ["running", "swimming"] });
  const both = (await client.get("/api/dashboard")).json.myStanding;
  assertEquals(both.points, 270);
  assertEquals(both.progress, 270 / 1050);
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

  await a.client.post("/api/activities", { sport: "running", date: daysAgo(5), distance: 45 }); // 180 pts = 20%, counts
  await a.client.post("/api/activities", { sport: "running", date: daysAgo(20), distance: 100 }); // before the race
  await b.client.post("/api/activities", { sport: "swimming", date: daysAgo(4), distance: 50 });
  await b.client.post("/api/activities", { sport: "swimming", date: daysAgo(3), distance: 30 }); // 960 pts: crosses 900
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
