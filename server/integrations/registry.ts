// Activity providers known to the app. Adding a platform (Garmin, Polar, ...) means
// adding an entry here plus a module like ./strava with its own routes and sync service.
// Imported activities all land in the shared `activities` table keyed by (user, source, external_id).
import { stravaConfigured } from "../config.ts";
import { getConnection } from "./strava/service.ts";

export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
  status: string | null;
}

export function listProviders(userId: number): ProviderInfo[] {
  const strava = getConnection(userId);
  return [
    {
      id: "strava",
      label: "Strava",
      configured: stravaConfigured(),
      connected: Boolean(strava),
      status: strava?.status ?? null,
    },
  ];
}
