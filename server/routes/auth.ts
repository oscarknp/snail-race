import { Hono } from "hono";
import { z } from "zod";
import { SPORT_IDS } from "../../shared/sports.ts";
import { config } from "../config.ts";
import { nowSec, one, run, tx } from "../db.ts";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto.ts";
import { type AppEnv, HttpError, jsonBody, parse } from "../lib/http.ts";
import { sendMail } from "../lib/mailer.ts";
import { clientIp, rateLimit } from "../lib/rateLimit.ts";
import { createSession, destroyAllSessions, destroySession } from "../lib/session.ts";
import type { UserRow } from "../lib/types.ts";
import { joinDefaultRace } from "../services/races.ts";
import { meResponse } from "./profile.ts";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password is too long");

// A real hash to compare against when the email doesn't exist, so response timing
// doesn't reveal which emails are registered.
const DUMMY_HASH = await hashPassword(randomToken());

export const auth = new Hono<AppEnv>()
  .post("/register", async (c) => {
    rateLimit(`register:${clientIp(c)}`, 10, 60 * 60_000);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, "Enter your name").max(40, "Name must be 40 characters or fewer"),
        email,
        password,
        sport: z.enum(SPORT_IDS, { errorMap: () => ({ message: "Pick the sport you'll race in" }) }),
      }),
      await jsonBody(c),
    );
    if (one("SELECT 1 FROM users WHERE email = ?", body.email)) {
      throw new HttpError(409, "An account with that email already exists", { email: "Already registered — try logging in" });
    }
    const hash = await hashPassword(body.password);
    const userId = tx(() => {
      const id = Number(
        run("INSERT INTO users (email, password_hash, name, sport) VALUES (?, ?, ?, ?)", body.email, hash, body.name, body.sport)
          .lastInsertRowid,
      );
      joinDefaultRace(id);
      return id;
    });
    createSession(c, userId);
    return c.json(meResponse(one<UserRow>("SELECT * FROM users WHERE id = ?", userId)!), 201);
  })
  .post("/login", async (c) => {
    const body = parse(z.object({ email, password: z.string().min(1, "Enter your password").max(200) }), await jsonBody(c));
    rateLimit(`login:${clientIp(c)}:${body.email}`, 10, 15 * 60_000);
    const user = one<UserRow>("SELECT * FROM users WHERE email = ?", body.email);
    const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "That email and password don't match");
    createSession(c, user.id);
    return c.json(meResponse(user));
  })
  .post("/logout", (c) => {
    destroySession(c);
    return c.json({ ok: true });
  })
  .get("/me", (c) => {
    const user = c.get("user");
    return c.json(user ? meResponse(user) : null);
  })
  .post("/forgot", async (c) => {
    const body = parse(z.object({ email }), await jsonBody(c));
    rateLimit(`forgot:${clientIp(c)}`, 5, 15 * 60_000);
    const user = one<UserRow>("SELECT * FROM users WHERE email = ?", body.email);
    if (user) {
      const token = randomToken();
      run(
        "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        sha256(token),
        user.id,
        nowSec() + 3600,
      );
      const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Snail Race password",
        text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your Snail Race password.\n` +
          `Open this link within one hour to choose a new one:\n\n${link}\n\n` +
          `If you didn't ask for this, you can ignore this email.`,
      });
    }
    // Same answer either way so this can't be used to discover accounts.
    return c.json({ ok: true });
  })
  .post("/reset", async (c) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), await jsonBody(c));
    rateLimit(`reset:${clientIp(c)}`, 10, 15 * 60_000);
    const row = one<{ user_id: number; expires_at: number; used_at: number | null }>(
      "SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
      sha256(body.token),
    );
    if (!row || row.used_at || row.expires_at < nowSec()) {
      throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
    }
    const hash = await hashPassword(body.password);
    tx(() => {
      run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", hash, row.user_id);
      run("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", nowSec(), row.user_id);
      destroyAllSessions(row.user_id);
    });
    createSession(c, row.user_id);
    return c.json(meResponse(one<UserRow>("SELECT * FROM users WHERE id = ?", row.user_id)!));
  });
