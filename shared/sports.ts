// The four race sports and the points system. Every kilometre earns points at its sport's
// rate, chosen so each sport's reference distance is worth the same 900 points.
export const SPORTS = [
  { id: "cycling", label: "Cycling", emoji: "🚴", pointsPerKm: 1, targetKm: 900 },
  { id: "running", label: "Running", emoji: "🏃", pointsPerKm: 4, targetKm: 225 },
  { id: "rowing", label: "Rowing", emoji: "🚣", pointsPerKm: 3, targetKm: 300 },
  { id: "swimming", label: "Swimming", emoji: "🏊", pointsPerKm: 12, targetKm: 75 },
] as const;

export type Sport = (typeof SPORTS)[number]["id"];

export const SPORT_IDS = SPORTS.map((s) => s.id) as [Sport, ...Sport[]];

/** A racer can take part in up to this many sports at once. */
export const MAX_SPORTS = 3;

/** Points needed to finish, by how many sports a racer takes part in. */
export const GOAL_POINTS: Record<number, number> = { 1: 900, 2: 1050, 3: 1200 };

/** Imported activities whose type isn't one of the race sports are stored as "other" and never count. */
export const OTHER_SPORT = "other";

export function isSport(id: unknown): id is Sport {
  return typeof id === "string" && SPORT_IDS.includes(id as Sport);
}

export function sportLabel(id: string | null | undefined): string {
  return SPORTS.find((s) => s.id === id)?.label ?? (id === OTHER_SPORT ? "Other" : id || "—");
}

export function sportEmoji(id: string | null | undefined): string {
  return SPORTS.find((s) => s.id === id)?.emoji ?? "✈️";
}

export function pointsPerKm(sport: string | null | undefined): number {
  return SPORTS.find((s) => s.id === sport)?.pointsPerKm ?? 0;
}

/** Points earned for a distance in meters (0 for sports that aren't raced). */
export function pointsFor(sport: string | null | undefined, meters: number): number {
  return (meters / 1000) * pointsPerKm(sport);
}

/** Points needed to finish for a set of sports, or null when none is chosen. */
export function goalPoints(sports: readonly string[]): number | null {
  const n = sports.filter(isSport).length;
  return n ? GOAL_POINTS[Math.min(n, MAX_SPORTS)] : null;
}

/** Sports are stored as a comma-separated list on the user row, in the order chosen. */
export function parseSports(value: string | null | undefined): Sport[] {
  return (value ?? "").split(",").filter(isSport);
}

export function formatPoints(points: number): string {
  // Decimals only for small amounts (a 2.4 km ride is 2.4 pts); totals read as whole points.
  const digits = Math.abs(points) < 10 && points % 1 !== 0 ? 1 : 0;
  return `${points.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} pts`;
}
