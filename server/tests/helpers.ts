import { ORIGIN } from "./_setup.ts";
import { createApp } from "../app.ts";
import { useMemoryDb } from "../db.ts";
import { resetRateLimits } from "../lib/rateLimit.ts";

export const app = createApp();

export function resetDb() {
  useMemoryDb();
  resetRateLimits();
}

/** A tiny browser: keeps the session cookie between requests. */
export class TestClient {
  cookie = "";

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await app.request(path, { method, headers: h, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0];
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  }

  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  del = (p: string) => this.req("DELETE", p);
}

export async function registerUser(name: string, sport = "running", email = `${name.toLowerCase()}@example.com`) {
  const c = new TestClient();
  const r = await c.post("/api/auth/register", { name, email, password: "slow-and-steady", sport });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
  return { client: c, user: r.json };
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString("en-CA");
