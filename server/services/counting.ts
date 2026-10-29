// Decides which activities count toward a user's distance. This is the single place the
// rules live; totals, race standings and the activity list all go through it.
import type { ActivityRow, TrackingMethod, UserRow } from "../lib/types.ts";

export type Exclusion = "no_sport" | "other_sport" | "tracking_method" | "no_share_consent" | "duplicate" | "outside_races";

export interface CountingPrefs {
  /** The user's race sport; only activities of this sport count. */
  sport: string | null;
  trackingMethod: TrackingMethod;
  shareConsent: boolean;
}

export interface Evaluated extends ActivityRow {
  counts: boolean;
  excludedReason: Exclusion | null;
  duplicateOf: number | null;
}

export function prefsFromUser(user: UserRow): CountingPrefs {
  return {
    sport: user.sport,
    trackingMethod: user.tracking_method,
    shareConsent: Boolean(user.strava_share_consent),
  };
}

/**
 * Likely-duplicate rule for manual vs imported entries: same calendar date, same sport,
 * and distances within 3% (minimum 50 m). Anything looser is treated as a separate
 * workout. Users can override a match with "not a duplicate".
 */
export function isLikelyDuplicate(manual: ActivityRow, imported: ActivityRow): boolean {
  if (manual.date !== imported.date || manual.sport !== imported.sport) return false;
  const tolerance = Math.max(50, 0.03 * Math.max(manual.distance_m, imported.distance_m));
  return Math.abs(manual.distance_m - imported.distance_m) <= tolerance;
}

export function evaluate(activities: ActivityRow[], prefs: CountingPrefs): Evaluated[] {
  const out: Evaluated[] = activities.map((a) => {
    let reason: Exclusion | null = null;
    if (!prefs.sport) reason = "no_sport";
    else if (a.sport !== prefs.sport) reason = "other_sport";
    else if (a.source === "manual") {
      if (prefs.trackingMethod === "strava") reason = "tracking_method";
    } else {
      if (prefs.trackingMethod === "manual") reason = "tracking_method";
      else if (!prefs.shareConsent) reason = "no_share_consent";
    }
    return { ...a, counts: reason === null, excludedReason: reason, duplicateOf: null };
  });

  if (prefs.trackingMethod === "both") {
    // Imported records are the source of truth, so the manual twin is the one set aside.
    const claimed = new Set<number>();
    const imported = out.filter((a) => a.source !== "manual" && a.counts);
    for (const m of out) {
      if (m.source !== "manual" || !m.counts || m.not_duplicate) continue;
      const twin = imported.find((i) => !claimed.has(i.id) && isLikelyDuplicate(m, i));
      if (twin) {
        claimed.add(twin.id);
        m.counts = false;
        m.excludedReason = "duplicate";
        m.duplicateOf = twin.id;
      }
    }
  }
  return out;
}

export interface RaceWindow {
  start_date: string;
  end_date: string | null;
}

/**
 * For the user's own activity list and totals: an activity only counts if it falls inside
 * the dates of at least one race they've joined. (Race standings apply each race's own
 * dates directly, so this only keeps the personal views consistent with them.)
 */
export function applyRaceWindows(evaluated: Evaluated[], windows: RaceWindow[]): Evaluated[] {
  for (const a of evaluated) {
    if (!a.counts) continue;
    const inside = windows.some((w) => a.date >= w.start_date && (!w.end_date || a.date <= w.end_date));
    if (!inside) {
      a.counts = false;
      a.excludedReason = "outside_races";
    }
  }
  return evaluated;
}

export function countedTotal(evaluated: Evaluated[]): number {
  return evaluated.reduce((sum, a) => sum + (a.counts ? a.distance_m : 0), 0);
}

export const EXCLUSION_LABELS: Record<Exclusion, string> = {
  no_sport: "Not counted: pick your race sport in your profile",
  other_sport: "Not counted: only your race sport counts",
  tracking_method: "Not counted: your tracking method excludes this source",
  no_share_consent: "Not counted: Strava sharing consent is off",
  duplicate: "Not counted: looks like the same workout as a Strava activity",
  outside_races: "Not counted: outside the dates of your races",
};
