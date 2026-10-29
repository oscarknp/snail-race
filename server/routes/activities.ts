import { Hono } from "hono";
import { z } from "zod";
import { SPORT_IDS } from "../../shared/sports.ts";
import { toMeters } from "../../shared/units.ts";
import { all, one, run } from "../db.ts";
import { type AppEnv, currentUser, HttpError, idParam, jsonBody, parse, requireAuth } from "../lib/http.ts";
import type { ActivityRow, UserRow } from "../lib/types.ts";
import {
  applyRaceWindows,
  countedTotal,
  evaluate,
  EXCLUSION_LABELS,
  type Evaluated,
  prefsFromUser,
  type RaceWindow,
} from "../services/counting.ts";

export function activityResponse(a: Evaluated) {
  return {
    id: a.id,
    source: a.source,
    sport: a.sport,
    sourceSportType: a.source_sport_type,
    name: a.name,
    date: a.date,
    distanceM: a.distance_m,
    movingTimeS: a.moving_time_s,
    notes: a.notes,
    counts: a.counts,
    excludedReason: a.excludedReason,
    excludedLabel: a.excludedReason ? EXCLUSION_LABELS[a.excludedReason] : null,
    duplicateOf: a.duplicateOf,
    notDuplicate: Boolean(a.not_duplicate),
    externalUrl: a.source === "strava" && a.external_id ? `https://www.strava.com/activities/${a.external_id}` : null,
    createdAt: a.created_at,
  };
}

export function evaluatedActivitiesFor(user: UserRow): Evaluated[] {
  const acts = all<ActivityRow>(
    "SELECT * FROM activities WHERE user_id = ? ORDER BY date DESC, COALESCE(started_at, created_at) DESC, id DESC",
    user.id,
  );
  const windows = all<RaceWindow>(
    `SELECT r.start_date, r.end_date FROM races r JOIN race_participants p ON p.race_id = r.id
     WHERE p.user_id = ? AND p.status = 'joined'`,
    user.id,
  );
  return applyRaceWindows(evaluate(acts, prefsFromUser(user)), windows);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").refine(
  (d) => !Number.isNaN(Date.parse(d)),
  "Use a valid date",
);

function activityInput(user: UserRow) {
  // Allow "tomorrow" so people in time zones ahead of the server aren't blocked.
  const latest = new Date(Date.now() + 86400_000).toLocaleDateString("en-CA");
  return z.object({
    sport: z.enum(SPORT_IDS, { errorMap: () => ({ message: "Choose a sport" }) }),
    date: isoDate
      .refine((d) => d <= latest, "That date is in the future — snails can't time travel")
      .refine((d) => d >= "2000-01-01", "That date is too far in the past"),
    distance: z.number({ invalid_type_error: "Enter a distance" })
      .finite()
      .positive("Distance must be greater than zero")
      .max(1000, "That's further than any snail (or human) goes in one go"),
    unit: z.enum(["km", "mi"]).default(user.unit),
    name: z.string().trim().max(80).optional().transform((v) => v || null),
    notes: z.string().trim().max(500, "Notes must be 500 characters or fewer").optional().transform((v) => v || null),
  });
}

function findOwn(userId: number, id: number): ActivityRow {
  // Scoping by user_id means other people's activities are simply "not found".
  const a = one<ActivityRow>("SELECT * FROM activities WHERE id = ? AND user_id = ?", id, userId);
  if (!a) throw new HttpError(404, "Activity not found");
  return a;
}

function assertManual(a: ActivityRow) {
  if (a.source !== "manual") {
    throw new HttpError(403, "Imported activities are managed by their source. Edit them there, or change your sport selection.");
  }
}

export const activities = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", (c) => {
    const user = currentUser(c);
    const evaluated = evaluatedActivitiesFor(user);
    return c.json({
      totalM: countedTotal(evaluated),
      activities: evaluated.map(activityResponse),
    });
  })
  .post("/", async (c) => {
    const user = currentUser(c);
    const body = parse(activityInput(user), await jsonBody(c));
    const id = Number(
      run(
        `INSERT INTO activities (user_id, source, sport, name, date, distance_m, notes)
         VALUES (?, 'manual', ?, ?, ?, ?, ?)`,
        user.id,
        body.sport,
        body.name,
        body.date,
        toMeters(body.distance, body.unit),
        body.notes,
      ).lastInsertRowid,
    );
    const created = evaluatedActivitiesFor(user).find((a) => a.id === id)!;
    return c.json(activityResponse(created), 201);
  })
  .patch("/:id", async (c) => {
    const user = currentUser(c);
    const existing = findOwn(user.id, idParam(c));
    assertManual(existing);
    const body = parse(activityInput(user), await jsonBody(c));
    run(
      `UPDATE activities SET sport = ?, name = ?, date = ?, distance_m = ?, notes = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?`,
      body.sport,
      body.name,
      body.date,
      toMeters(body.distance, body.unit),
      body.notes,
      existing.id,
      user.id,
    );
    return c.json(activityResponse(evaluatedActivitiesFor(user).find((a) => a.id === existing.id)!));
  })
  .post("/:id/not-duplicate", async (c) => {
    const user = currentUser(c);
    const existing = findOwn(user.id, idParam(c));
    assertManual(existing);
    const body = parse(z.object({ notDuplicate: z.boolean() }), await jsonBody(c));
    run("UPDATE activities SET not_duplicate = ? WHERE id = ? AND user_id = ?", body.notDuplicate ? 1 : 0, existing.id, user.id);
    return c.json(activityResponse(evaluatedActivitiesFor(user).find((a) => a.id === existing.id)!));
  })
  .delete("/:id", (c) => {
    const user = currentUser(c);
    const existing = findOwn(user.id, idParam(c));
    assertManual(existing);
    run("DELETE FROM activities WHERE id = ? AND user_id = ?", existing.id, user.id);
    return c.json({ ok: true });
  });
