import type { Sport } from "../../../shared/sports.ts";
import type { Unit } from "../../../shared/units.ts";

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string> = {}) {
    super(message);
  }
}

/** Fire-and-forget hook: anything that changes distances calls this so views refetch. */
export const dataChanged = new EventTarget();
export const notifyDataChanged = () => dataChanged.dispatchEvent(new Event("change"));

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      headers: init.body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("app:unauthorized"));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.fields ?? {});
  }
  return data as T;
}

// ---- Shared response types ----

export interface PublicUser {
  id: number;
  name: string;
  /** 1-3 race sports, in the order chosen. */
  sports: Sport[];
  /** Points needed to finish: 900 / 1050 / 1200 for 1 / 2 / 3 sports. */
  goalPoints: number | null;
  unit: Unit;
  photoUrl: string | null;
}

export interface Me extends PublicUser {
  email: string;
  trackingMethod: "manual" | "strava" | "both";
  stravaShareConsent: boolean;
  createdAt: string;
}

export interface Activity {
  id: number;
  source: string;
  /** One of the race sports, or "other" for imported types that aren't raced. */
  sport: string;
  sourceSportType: string | null;
  name: string | null;
  date: string;
  distanceM: number;
  /** Points at the sport's rate (counted or not). */
  points: number;
  movingTimeS: number | null;
  notes: string | null;
  counts: boolean;
  excludedReason: string | null;
  excludedLabel: string | null;
  duplicateOf: number | null;
  notDuplicate: boolean;
  externalUrl: string | null;
  createdAt: string;
}

export interface Standing {
  rank: number;
  user: PublicUser;
  points: number;
  goalPoints: number | null;
  /** Share of the racer's own points goal (0..1); this is their position on the track. */
  progress: number;
  remainingPoints: number | null;
  /** Counted distance across all of their sports. */
  distanceM: number;
  bySport: { sport: Sport; distanceM: number; points: number }[];
  /** Some of this racer's counted distance was imported from Strava. */
  fromStrava: boolean;
  finishedOn: string | null;
  activityCount: number;
  lastActivityOn: string | null;
}

export interface Race {
  id: number;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  isDefault: boolean;
  createdBy: number | null;
  isOwner: boolean;
  status: "upcoming" | "active" | "completed";
  participantCount: number;
  invitedCount: number;
  myStatus: "invited" | "joined" | "declined" | null;
  podium?: Standing[];
}

export interface RaceDetail {
  race: Race;
  standings: Standing[];
  invited: { id: number; name: string }[];
}
