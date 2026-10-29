import { OTHER_SPORT, type Sport } from "../../../shared/sports.ts";
import { all } from "../../db.ts";

// Strava `sport_type` (and legacy `type`) values -> race sports. Anything else is stored as
// "other" and never counts; users can remap a Strava type themselves (e.g. EBikeRide).
export const STRAVA_SPORT_MAP: Record<string, Sport> = {
  Run: "running",
  TrailRun: "running",
  VirtualRun: "running",
  Ride: "cycling",
  GravelRide: "cycling",
  MountainBikeRide: "cycling",
  VirtualRide: "cycling",
  EBikeRide: "cycling",
  EMountainBikeRide: "cycling",
  Velomobile: "cycling",
  Handcycle: "cycling",
  Rowing: "rowing",
  VirtualRow: "rowing",
  Swim: "swimming",
};

export function defaultCategory(stravaType: string): string {
  return STRAVA_SPORT_MAP[stravaType] ?? OTHER_SPORT;
}

export function userMappingOverrides(userId: number): Map<string, string> {
  const rows = all<{ source_type: string; category: string }>(
    "SELECT source_type, category FROM user_sport_mapping WHERE user_id = ? AND provider = 'strava'",
    userId,
  );
  return new Map(rows.map((r) => [r.source_type, r.category]));
}

export function resolveCategory(stravaType: string, overrides: Map<string, string>): string {
  return overrides.get(stravaType) ?? defaultCategory(stravaType);
}
