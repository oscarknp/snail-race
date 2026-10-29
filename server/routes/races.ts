import { Hono } from "hono";
import { z } from "zod";
import { all, one, run, tx } from "../db.ts";
import { type AppEnv, currentUser, HttpError, idParam, jsonBody, parse, requireAuth } from "../lib/http.ts";
import type { RaceRow } from "../lib/types.ts";
import { canViewRace, ensureDefaultRace, raceStandings, raceSummary } from "../services/races.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

const raceInput = z
  .object({
    name: z.string().trim().min(2, "Give your race a name").max(60, "Race names must be 60 characters or fewer"),
    description: z.string().trim().max(300).optional().transform((v) => v || null),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    inviteUserIds: z.array(z.number().int().positive()).max(200).optional(),
  })
  .refine((r) => !r.endDate || r.endDate >= r.startDate, { message: "End date must be after the start date", path: ["endDate"] });

function loadRace(id: number, userId: number): RaceRow {
  const race = one<RaceRow>("SELECT * FROM races WHERE id = ?", id);
  if (!race || !canViewRace(race, userId)) throw new HttpError(404, "Race not found");
  return race;
}

function invite(raceId: number, inviterId: number, userIds: number[]) {
  for (const uid of new Set(userIds)) {
    if (uid === inviterId || !one("SELECT 1 FROM users WHERE id = ?", uid)) continue;
    // Re-inviting someone who declined is allowed; existing participants are left alone.
    run(
      `INSERT INTO race_participants (race_id, user_id, status, invited_by) VALUES (?, ?, 'invited', ?)
       ON CONFLICT (race_id, user_id) DO UPDATE SET status = 'invited', invited_by = excluded.invited_by
       WHERE race_participants.status = 'declined'`,
      raceId,
      uid,
      inviterId,
    );
  }
}

export const races = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", (c) => {
    const user = currentUser(c);
    ensureDefaultRace();
    const rows = all<RaceRow>(
      `SELECT DISTINCT r.* FROM races r LEFT JOIN race_participants p ON p.race_id = r.id AND p.user_id = ?
       WHERE r.is_default = 1 OR r.created_by = ? OR p.user_id IS NOT NULL
       ORDER BY r.is_default DESC, r.start_date DESC`,
      user.id,
      user.id,
    );
    return c.json(
      rows.map((r) => {
        const summary = raceSummary(r, user.id);
        // Completed races carry their podium so the list can show results.
        const podium = summary.status === "completed" ? raceStandings(r).slice(0, 3) : undefined;
        return { ...summary, podium };
      }),
    );
  })
  .post("/", async (c) => {
    const user = currentUser(c);
    const body = parse(raceInput, await jsonBody(c));
    const id = tx(() => {
      const raceId = Number(
        run(
          `INSERT INTO races (name, description, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?)`,
          body.name,
          body.description,
          body.startDate,
          body.endDate ?? null,
          user.id,
        ).lastInsertRowid,
      );
      run("INSERT INTO race_participants (race_id, user_id, status) VALUES (?, ?, 'joined')", raceId, user.id);
      invite(raceId, user.id, body.inviteUserIds ?? []);
      return raceId;
    });
    return c.json(raceSummary(one<RaceRow>("SELECT * FROM races WHERE id = ?", id)!, user.id), 201);
  })
  .get("/:id", (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    const invited = all<{ id: number; name: string }>(
      `SELECT u.id, u.name FROM race_participants p JOIN users u ON u.id = p.user_id
       WHERE p.race_id = ? AND p.status = 'invited' ORDER BY u.name`,
      race.id,
    );
    return c.json({ race: raceSummary(race, user.id), standings: raceStandings(race), invited });
  })
  .patch("/:id", async (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    if (race.created_by !== user.id) throw new HttpError(403, "Only the race organiser can change it");
    const body = parse(raceInput, await jsonBody(c));
    run(
      `UPDATE races SET name = ?, description = ?, start_date = ?, end_date = ? WHERE id = ?`,
      body.name,
      body.description,
      body.startDate,
      body.endDate ?? null,
      race.id,
    );
    return c.json(raceSummary(one<RaceRow>("SELECT * FROM races WHERE id = ?", race.id)!, user.id));
  })
  .post("/:id/invite", async (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    const me = one<{ status: string }>("SELECT status FROM race_participants WHERE race_id = ? AND user_id = ?", race.id, user.id);
    if (me?.status !== "joined") throw new HttpError(403, "Join the race before inviting others");
    const body = parse(z.object({ userIds: z.array(z.number().int().positive()).min(1, "Pick at least one person").max(200) }), await jsonBody(c));
    invite(race.id, user.id, body.userIds);
    return c.json({ ok: true });
  })
  .post("/:id/join", (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    // Only the default race is open; other races need an invitation first.
    const existing = one<{ status: string }>("SELECT status FROM race_participants WHERE race_id = ? AND user_id = ?", race.id, user.id);
    if (!race.is_default && !existing && race.created_by !== user.id) throw new HttpError(403, "You need an invitation to join this race");
    run(
      `INSERT INTO race_participants (race_id, user_id, status) VALUES (?, ?, 'joined')
       ON CONFLICT (race_id, user_id) DO UPDATE SET status = 'joined'`,
      race.id,
      user.id,
    );
    return c.json(raceSummary(race, user.id));
  })
  .post("/:id/decline", (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    run("UPDATE race_participants SET status = 'declined' WHERE race_id = ? AND user_id = ? AND status = 'invited'", race.id, user.id);
    return c.json(raceSummary(race, user.id));
  })
  .post("/:id/leave", (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    if (race.created_by === user.id) throw new HttpError(403, "Organisers can't leave their own race");
    run("UPDATE race_participants SET status = 'declined' WHERE race_id = ? AND user_id = ?", race.id, user.id);
    return c.json(raceSummary(race, user.id));
  })
  .delete("/:id", (c) => {
    const user = currentUser(c);
    const race = loadRace(idParam(c), user.id);
    if (race.created_by !== user.id || race.is_default) throw new HttpError(403, "Only the organiser can delete this race");
    run("DELETE FROM races WHERE id = ?", race.id);
    return c.json({ ok: true });
  });
