import { goalPoints, parseSports } from "../../shared/sports.ts";
import type { Unit } from "../../shared/units.ts";

export type TrackingMethod = "manual" | "strava" | "both";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  /** Comma-separated race sports, in the order chosen (max 3). */
  sports: string;
  unit: Unit;
  photo_file: string | null;
  tracking_method: TrackingMethod;
  strava_share_consent: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: number;
  user_id: number;
  source: string;
  external_id: string | null;
  sport: string;
  source_sport_type: string | null;
  name: string | null;
  date: string;
  started_at: string | null;
  distance_m: number;
  moving_time_s: number | null;
  notes: string | null;
  not_duplicate: number;
  created_at: string;
  updated_at: string;
}

export interface RaceRow {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  is_default: number;
  created_by: number | null;
  created_at: string;
}

export interface ConnectionRow {
  id: number;
  user_id: number;
  provider: string;
  external_user_id: string;
  display_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: number | null;
  scope: string | null;
  status: "active" | "needs_reauth" | "error";
  last_sync_at: string | null;
  last_error: string | null;
  sync_cursor: number | null;
  rate_limited_until: number | null;
  created_at: string;
}

/** The subset of a user that is safe to show to other participants. */
export function publicUser(u: Pick<UserRow, "id" | "name" | "sports" | "photo_file" | "unit">) {
  const sports = parseSports(u.sports);
  return {
    id: u.id,
    name: u.name,
    sports,
    // The goal depends only on how many sports someone takes part in, so it's derived.
    goalPoints: goalPoints(sports),
    unit: u.unit,
    photoUrl: u.photo_file ? `/api/photos/${u.photo_file}` : null,
  };
}
