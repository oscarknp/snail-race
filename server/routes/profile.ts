import { Hono } from "hono";
import { z } from "zod";
import { SPORT_IDS } from "../../shared/sports.ts";
import { config } from "../config.ts";
import { all, one, run } from "../db.ts";
import { randomToken } from "../lib/crypto.ts";
import { type AppEnv, currentUser, HttpError, idParam, jsonBody, parse, requireAuth } from "../lib/http.ts";
import { publicUser, type RaceRow, type UserRow } from "../lib/types.ts";
import { canViewRace, raceStandings, raceSummary } from "../services/races.ts";

export function meResponse(u: UserRow) {
  return {
    ...publicUser(u),
    email: u.email,
    trackingMethod: u.tracking_method,
    stravaShareConsent: Boolean(u.strava_share_consent),
    createdAt: u.created_at,
  };
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Identify the image type from its first bytes; the client-supplied MIME type isn't trusted. */
function sniffImage(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

const PHOTO_NAME = /^[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

async function removePhotoFile(file: string | null) {
  if (!file || !PHOTO_NAME.test(file)) return;
  await Deno.remove(`${config.uploadDir}/${file}`).catch(() => {});
}

// Mounted at /api, so auth is scoped to these paths rather than "*" (which would also
// catch other routers' public endpoints such as the Strava webhook).
export const profile = new Hono<AppEnv>()
  .use("/me", requireAuth)
  .use("/me/*", requireAuth)
  .use("/users", requireAuth)
  .use("/users/*", requireAuth)
  .use("/photos/*", requireAuth)
  .get("/me", (c) => c.json(meResponse(currentUser(c))))
  .patch("/me", async (c) => {
    const user = currentUser(c);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, "Enter a display name").max(40, "Display name must be 40 characters or fewer").optional(),
        // The distance goal is fixed by the sport, so there's no goal field to set.
        sport: z.enum(SPORT_IDS, { errorMap: () => ({ message: "Choose cycling, running, rowing or swimming" }) }).optional(),
        unit: z.enum(["km", "mi"]).optional(),
        trackingMethod: z.enum(["manual", "strava", "both"]).optional(),
      }),
      await jsonBody(c),
    );
    if (body.trackingMethod === "strava" && !one("SELECT 1 FROM integration_connections WHERE user_id = ? AND provider = 'strava'", user.id)) {
      throw new HttpError(400, "Connect Strava before switching to Strava-only tracking", { trackingMethod: "Connect Strava first" });
    }
    run(
      `UPDATE users SET name = ?, sport = ?, unit = ?, tracking_method = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      body.name ?? user.name,
      body.sport ?? user.sport,
      body.unit ?? user.unit,
      body.trackingMethod ?? user.tracking_method,
      user.id,
    );
    return c.json(meResponse(one<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!));
  })
  .post("/me/photo", async (c) => {
    const user = currentUser(c);
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_PHOTO_BYTES + 64 * 1024) throw new HttpError(413, "Photos must be 5 MB or smaller");
    const form = await c.req.parseBody();
    const file = form.photo;
    if (!(file instanceof File)) throw new HttpError(400, "Choose a photo to upload");
    if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, "Photos must be 5 MB or smaller");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = sniffImage(bytes);
    if (!ext) throw new HttpError(415, "Please upload a JPEG, PNG or WebP image");
    const name = `${randomToken(18)}.${ext}`;
    await Deno.mkdir(config.uploadDir, { recursive: true });
    await Deno.writeFile(`${config.uploadDir}/${name}`, bytes, { mode: 0o644 });
    run("UPDATE users SET photo_file = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", name, user.id);
    await removePhotoFile(user.photo_file);
    return c.json(meResponse(one<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!));
  })
  .delete("/me/photo", async (c) => {
    const user = currentUser(c);
    run("UPDATE users SET photo_file = NULL WHERE id = ?", user.id);
    await removePhotoFile(user.photo_file);
    return c.json(meResponse(one<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!));
  })
  .get("/users", (c) => {
    const users = all<UserRow>("SELECT id, name, sport, photo_file, unit FROM users ORDER BY name COLLATE NOCASE");
    return c.json(users.map(publicUser));
  })
  .get("/users/:id", (c) => {
    const viewer = currentUser(c);
    const u = one<UserRow>("SELECT * FROM users WHERE id = ?", idParam(c));
    if (!u) throw new HttpError(404, "That snail has wandered off");
    // Only aggregate race results are shared with other people, never individual activities.
    const races = all<RaceRow>(
      `SELECT r.* FROM races r JOIN race_participants p ON p.race_id = r.id
       WHERE p.user_id = ? AND p.status = 'joined' ORDER BY r.is_default DESC, r.start_date DESC`,
      u.id,
    ).filter((r) => canViewRace(r, viewer.id));
    return c.json({
      user: publicUser(u),
      memberSince: u.created_at,
      races: races.map((r) => ({
        race: raceSummary(r, viewer.id),
        standing: raceStandings(r).find((s) => s.user.id === u.id) ?? null,
      })),
    });
  })
  .get("/photos/:file", async (c) => {
    const file = c.req.param("file");
    if (!PHOTO_NAME.test(file)) throw new HttpError(404, "Not found");
    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await Deno.readFile(`${config.uploadDir}/${file}`);
    } catch {
      throw new HttpError(404, "Not found");
    }
    const ext = file.split(".").pop() as keyof typeof CONTENT_TYPES;
    return c.body(data, 200, {
      "Content-Type": CONTENT_TYPES[ext],
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    });
  });
