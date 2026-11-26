import { goalPoints, parseSports } from "../../shared/sports.ts";
import { config } from "../config.ts";
import { all, one, run } from "../db.ts";
import type { ActivityRow, RaceRow, UserRow } from "../lib/types.ts";
import { publicUser } from "../lib/types.ts";
import { evaluate, prefsFromUser } from "./counting.ts";

export type RaceStatus = "upcoming" | "active" | "completed";

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, server-local

export function raceStatus(race: RaceRow, on = today()): RaceStatus {
  if (race.start_date > on) return "upcoming";
  if (race.end_date && race.end_date < on) return "completed";
  return "active";
}

const WELCOME_RACE_DESCRIPTION = "The everyone-welcome air race. Every pilot takes off here.";

export function ensureDefaultRace(): RaceRow {
  const existing = one<RaceRow>("SELECT * FROM races WHERE is_default = 1");
  if (existing) return existing;
  run(
    `INSERT INTO races (name, description, start_date, end_date, is_default) VALUES (?, ?, ?, ?, 1)`,
    config.defaultRace.name,
    WELCOME_RACE_DESCRIPTION,
    config.defaultRace.startDate,
    config.defaultRace.endDate,
  );
  return one<RaceRow>("SELECT * FROM races WHERE is_default = 1")!;
}

export function joinDefaultRace(userId: number) {
  const race = ensureDefaultRace();
  run(
    `INSERT INTO race_participants (race_id, user_id, status) VALUES (?, ?, 'joined')
     ON CONFLICT (race_id, user_id) DO NOTHING`,
    race.id,
    userId,
  );
}

export interface SportTotal {
  sport: string;
  distanceM: number;
  points: number;
}

export interface Standing {
  rank: number;
  user: ReturnType<typeof publicUser>;
  points: number;
  goalPoints: number | null;
  /** Share of the racer's own points goal, 0..1. This is what positions them on the track. */
  progress: number;
  remainingPoints: number | null;
  /** Counted distance across all of the racer's sports. */
  distanceM: number;
  bySport: SportTotal[];
  /** True when any counted activity was imported from Strava (the UI credits Strava then). */
  fromStrava: boolean;
  finishedOn: string | null;
  activityCount: number;
  lastActivityOn: string | null;
}

/**
 * Race standings computed fresh from saved activities, so edits are always reflected.
 * Every km earns points at its sport's rate; racers chase a goal that depends on how
 * many sports they take part in (900 / 1050 / 1200), so progress is a share of that.
 */
export function raceStandings(race: RaceRow): Standing[] {
  const users = all<UserRow>(
    `SELECT u.* FROM race_participants p JOIN users u ON u.id = p.user_id
     WHERE p.race_id = ? AND p.status = 'joined'`,
    race.id,
  );
  if (!users.length) return [];
  const ids = users.map((u) => u.id);
  const params: (string | number)[] = [...ids, race.start_date];
  let sql = `SELECT * FROM activities WHERE user_id IN (${ids.map(() => "?").join(",")}) AND date >= ?`;
  if (race.end_date) {
    sql += " AND date <= ?";
    params.push(race.end_date);
  }
  sql += " ORDER BY date, COALESCE(started_at, created_at), id";
  const acts = all<ActivityRow>(sql, ...params);

  const rows = users.map((u) => {
    const sports = parseSports(u.sports);
    const goal = goalPoints(sports);
    const counted = evaluate(acts.filter((a) => a.user_id === u.id), prefsFromUser(u)).filter((a) => a.counts);
    let points = 0;
    let distanceM = 0;
    let finishedOn: string | null = null;
    const bySport = new Map<string, SportTotal>(sports.map((sp) => [sp, { sport: sp, distanceM: 0, points: 0 }]));
    for (const a of counted) {
      points += a.points;
      distanceM += a.distance_m;
      const t = bySport.get(a.sport)!;
      t.distanceM += a.distance_m;
      t.points += a.points;
      if (goal && !finishedOn && points >= goal) finishedOn = a.date;
    }
    return {
      rank: 0,
      user: publicUser(u),
      points,
      goalPoints: goal,
      progress: goal ? Math.min(1, points / goal) : 0,
      remainingPoints: goal ? Math.max(0, goal - points) : null,
      distanceM,
      bySport: [...bySport.values()],
      fromStrava: counted.some((a) => a.source === "strava"),
      finishedOn,
      activityCount: counted.length,
      lastActivityOn: counted.at(-1)?.date ?? null,
    };
  });

  // Finishers rank by who crossed first; everyone else by share of their goal.
  rows.sort((a, b) => {
    if (a.finishedOn && b.finishedOn && a.finishedOn !== b.finishedOn) return a.finishedOn < b.finishedOn ? -1 : 1;
    if (a.finishedOn && !b.finishedOn) return -1;
    if (!a.finishedOn && b.finishedOn) return 1;
    return b.progress - a.progress || a.user.name.localeCompare(b.user.name);
  });
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && Math.abs(prev.progress - r.progress) < 1e-9 && prev.finishedOn === r.finishedOn ? prev.rank : i + 1;
  });
  return rows;
}

export function raceSummary(race: RaceRow, viewerId: number) {
  const counts = one<{ joined: number; invited: number }>(
    `SELECT SUM(status = 'joined') AS joined, SUM(status = 'invited') AS invited
     FROM race_participants WHERE race_id = ?`,
    race.id,
  )!;
  const mine = one<{ status: string }>(
    "SELECT status FROM race_participants WHERE race_id = ? AND user_id = ?",
    race.id,
    viewerId,
  );
  return {
    id: race.id,
    name: race.name,
    description: race.description,
    startDate: race.start_date,
    endDate: race.end_date,
    isDefault: Boolean(race.is_default),
    createdBy: race.created_by,
    isOwner: race.created_by === viewerId,
    status: raceStatus(race),
    participantCount: counts.joined ?? 0,
    invitedCount: counts.invited ?? 0,
    myStatus: (mine?.status ?? null) as "invited" | "joined" | "declined" | null,
  };
}

/** Races are visible to their participants and invitees; the default race to everyone. */
export function canViewRace(race: RaceRow, userId: number): boolean {
  if (race.is_default || race.created_by === userId) return true;
  return Boolean(one("SELECT 1 FROM race_participants WHERE race_id = ? AND user_id = ?", race.id, userId));
}
