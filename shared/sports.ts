// The four race sports. Each has a fixed distance goal; race progress is the share of
// that goal a racer has covered, so different sports can race on the same track.
export const SPORTS = [
  { id: "cycling", label: "Cycling", emoji: "🚴", targetKm: 900 },
  { id: "running", label: "Running", emoji: "🏃", targetKm: 225 },
  { id: "rowing", label: "Rowing", emoji: "🚣", targetKm: 300 },
  { id: "swimming", label: "Swimming", emoji: "🏊", targetKm: 75 },
] as const;

export type Sport = (typeof SPORTS)[number]["id"];

export const SPORT_IDS = SPORTS.map((s) => s.id) as [Sport, ...Sport[]];

/** Imported activities whose type isn't one of the race sports are stored as "other" and never count. */
export const OTHER_SPORT = "other";

export function isSport(id: unknown): id is Sport {
  return typeof id === "string" && SPORT_IDS.includes(id as Sport);
}

export function sportLabel(id: string | null | undefined): string {
  return SPORTS.find((s) => s.id === id)?.label ?? (id === OTHER_SPORT ? "Other" : id || "—");
}

export function sportEmoji(id: string | null | undefined): string {
  return SPORTS.find((s) => s.id === id)?.emoji ?? "🐌";
}

/** Fixed goal for a sport in meters, or null when no race sport is chosen. */
export function sportTargetM(id: string | null | undefined): number | null {
  const s = SPORTS.find((x) => x.id === id);
  return s ? s.targetKm * 1000 : null;
}
