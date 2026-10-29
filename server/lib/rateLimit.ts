import { HttpError } from "./http.ts";
import type { Context } from "hono";
import { getConnInfo } from "hono/deno";
import { config } from "../config.ts";

// Small in-memory fixed-window limiter. Good enough for a single instance; swap for
// a shared store (Redis etc.) if the app is ever scaled horizontally.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}


/**
 * Client IP. Proxy headers are only trusted when TRUST_PROXY is set. X-Real-IP is preferred;
 * otherwise the last X-Forwarded-For entry, which our own proxy appended (earlier entries
 * can be sent by the client and spoofed).
 */
export function clientIp(c: Context): string {
  if (config.trustProxy) {
    const real = c.req.header("x-real-ip")?.trim();
    if (real) return real;
    const fwd = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function resetRateLimits() {
  buckets.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000);
