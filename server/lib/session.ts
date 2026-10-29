import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config.ts";
import { one, run, nowSec } from "../db.ts";
import { randomToken, sha256 } from "./crypto.ts";
import type { AppEnv } from "./http.ts";
import type { UserRow } from "./types.ts";

const COOKIE = "sr_session";
const SESSION_DAYS = 30;

// Only a hash of the session token is stored, so a leaked database cannot be replayed as cookies.
export function createSession(c: Context, userId: number) {
  const token = randomToken();
  const now = nowSec();
  run(
    "INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    sha256(token),
    userId,
    now + SESSION_DAYS * 86400,
    now,
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export function destroySession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) run("DELETE FROM sessions WHERE id_hash = ?", sha256(token));
  deleteCookie(c, COOKIE, { path: "/" });
}

export function destroyAllSessions(userId: number) {
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  let user: UserRow | null = null;
  if (token) {
    user = one<UserRow>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ?`,
      sha256(token),
      nowSec(),
    ) ?? null;
  }
  c.set("user", user);
  await next();
};

export function purgeExpiredSessions() {
  const now = nowSec();
  run("DELETE FROM sessions WHERE expires_at <= ?", now);
  run("DELETE FROM password_resets WHERE expires_at <= ?", now);
  run("DELETE FROM oauth_states WHERE expires_at <= ?", now);
}
