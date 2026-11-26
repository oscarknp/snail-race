// The race sports and the points system. Every kilometre earns points at its sport's rate.
// The four combinable sports are worth 900 points over their reference distance. A "solo"
// sport can't be combined with others and has its own fixed goal.
export const SPORTS = [
  { id: "cycling", label: "Cycling", emoji: "🚴", pointsPerKm: 1, targetKm: 900, soloGoal: null },
  { id: "running", label: "Running", emoji: "🏃", pointsPerKm: 4, targetKm: 225, soloGoal: null },
  { id: "rowing", label: "Rowing", emoji: "🚣", pointsPerKm: 3, targetKm: 300, soloGoal: null },
  { id: "swimming", label: "Swimming", emoji: "🏊", pointsPerKm: 12, targetKm: 75, soloGoal: null },
  { id: "walking", label: "Walking", emoji: "🚶", pointsPerKm: 2, targetKm: 250, soloGoal: 500 },
] as const;

export type Sport = (typeof SPORTS)[number]["id"];

export const SPORT_IDS = SPORTS.map((s) => s.id) as [Sport, ...Sport[]];

/** A racer can take part in up to this many sports at once. */
export const MAX_SPORTS = 3;

/** Points needed to finish, by how many (combinable) sports a racer takes part in. */
export const GOAL_POINTS: Record<number, number> = { 1: 900, 2: 1050, 3: 1200 };

/** True for sports that must be chosen on their own (walking). */
export function isSoloSport(id: string | null | undefined): boolean {
  return SPORTS.some((s) => s.id === id && s.soloGoal !== null);
}

/** Why a set of sports isn't allowed, or null when it's fine. */
export function sportsProblem(sports: readonly string[]): string | null {
  const solo = sports.find(isSoloSport);
  if (solo && sports.length > 1) return `${sportLabel(solo)} can't be combined with other sports`;
  if (sports.length > MAX_SPORTS) return `You can take part in up to ${MAX_SPORTS} sports`;
  return null;
}

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
  const list = sports.filter(isSport);
  // A solo sport sets its own goal (validation keeps it from being combined).
  const solo = SPORTS.find((s) => s.soloGoal !== null && list.includes(s.id));
  if (solo) return solo.soloGoal;
  return list.length ? GOAL_POINTS[Math.min(list.length, MAX_SPORTS)] : null;
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
