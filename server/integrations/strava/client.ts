// Thin wrapper around the Strava HTTP API. `fetch` is injectable so tests can run
// the whole sync pipeline against a fake Strava.
import { config } from "../../config.ts";

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  athlete?: { id: number; firstname?: string; lastname?: string; username?: string };
}

export interface StravaActivity {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  distance: number;
  moving_time?: number;
  start_date: string;
  start_date_local: string;
  manual?: boolean;
}

export class StravaError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
/** Access was revoked or the refresh token is no longer valid; the user must reconnect. */
export class StravaAuthError extends StravaError {}
export class StravaRateLimitError extends StravaError {
  constructor(public retryAt: number) {
    super("Strava rate limit reached", 429);
  }
}

export interface RateUsage {
  shortUsage: number;
  shortLimit: number;
  dailyUsage: number;
  dailyLimit: number;
}

/** Read the most restrictive of the overall and read-only rate limit headers. */
export function parseRateHeaders(h: Headers): RateUsage | null {
  const pairs = (name: string) => h.get(name)?.split(",").map((n) => Number(n.trim()));
  const candidates = [
    [pairs("X-ReadRateLimit-Usage"), pairs("X-ReadRateLimit-Limit")],
    [pairs("X-RateLimit-Usage"), pairs("X-RateLimit-Limit")],
  ].filter(([u, l]) => u && l) as [number[], number[]][];
  if (!candidates.length) return null;
  const ratio = ([u, l]: [number[], number[]]) => Math.max(u[0] / l[0], u[1] / l[1]);
  const [usage, limit] = candidates.sort((a, b) => ratio(b) - ratio(a))[0];
  return { shortUsage: usage[0], shortLimit: limit[0], dailyUsage: usage[1], dailyLimit: limit[1] };
}

/** Windows reset every 15 minutes on the quarter hour; the daily limit at midnight UTC. */
export function rateLimitRetryAt(usage: RateUsage | null, nowMs: number): number {
  const now = new Date(nowMs);
  if (usage && usage.dailyUsage >= usage.dailyLimit) {
    return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000);
  }
  const quarter = 15 * 60_000;
  return Math.floor((Math.floor(nowMs / quarter) + 1) * quarter / 1000);
}

export interface StravaClientDeps {
  fetch: typeof fetch;
  now: () => number;
  /** Called with the rate limit headers of every API response. */
  onUsage?: (usage: RateUsage) => void;
}

export function createStravaClient(deps: StravaClientDeps = { fetch: (...a) => fetch(...a), now: () => Date.now() }) {
  const { clientId, clientSecret, apiBase, oauthBase } = config.strava;

  async function tokenRequest(params: Record<string, string>): Promise<StravaTokenResponse> {
    const res = await deps.fetch(`${oauthBase}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, ...params }),
    });
    if (res.status === 400 || res.status === 401) {
      await res.body?.cancel();
      throw new StravaAuthError("Strava rejected the authorization. Please reconnect.", res.status);
    }
    if (res.status === 429) throw new StravaRateLimitError(rateLimitRetryAt(parseRateHeaders(res.headers), deps.now()));
    if (!res.ok) throw new StravaError(`Strava token request failed (${res.status})`, res.status);
    return await res.json();
  }

  async function api<T>(path: string, accessToken: string): Promise<T> {
    const res = await deps.fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const usage = parseRateHeaders(res.headers);
    if (usage) deps.onUsage?.(usage);
    if (res.status === 429) {
      await res.body?.cancel();
      throw new StravaRateLimitError(rateLimitRetryAt(usage, deps.now()));
    }
    if (res.status === 401) {
      await res.body?.cancel();
      throw new StravaAuthError("Strava access token was rejected", 401);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new StravaError(`Strava API error ${res.status} on ${path.split("?")[0]}`, res.status);
    }
    return await res.json();
  }

  return {
    authorizeUrl(state: string, redirectUri: string) {
      const q = new URLSearchParams({
        client_id: clientId!,
        redirect_uri: redirectUri,
        response_type: "code",
        approval_prompt: "auto",
        scope: config.strava.scope,
        state,
      });
      return `${oauthBase}/authorize?${q}`;
    },
    exchangeCode: (code: string) => tokenRequest({ code, grant_type: "authorization_code" }),
    refresh: (refreshToken: string) => tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }),
    /** Revokes the token and its counterpart (Strava's current revoke endpoint). */
    async revoke(token: string) {
      const res = await deps.fetch(`${oauthBase}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ token }),
      });
      await res.body?.cancel();
      if (!res.ok) throw new StravaError(`Strava revoke failed (${res.status})`, res.status);
    },
    listActivities: (accessToken: string, after: number, page: number, perPage = 100) =>
      api<StravaActivity[]>(`/athlete/activities?after=${after}&page=${page}&per_page=${perPage}`, accessToken),
    getActivity: (accessToken: string, id: string) => api<StravaActivity>(`/activities/${encodeURIComponent(id)}`, accessToken),
  };
}

export type StravaClient = ReturnType<typeof createStravaClient>;
