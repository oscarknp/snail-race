# 🐌 Snail Race

A full-stack fitness tracker that turns everyday exercise into a friendly snail race. Every racer starts as a
cartoon snail; upload a profile photo and that photo becomes your racer instead. Pick one of four sports, log distance by
hand or sync it from Strava, and your racer slides along a winding garden track toward 100% of your sport's goal.

| Sport | Fixed goal |
|---|---|
| 🚴 Cycling | 900 km |
| 🏃 Running | 225 km |
| 🚣 Rowing | 300 km |
| 🏊 Swimming | 75 km |

Because everyone races to 100% of their own goal, the track shows **percentages**, not raw distance: 90 km of cycling
and 30 km of rowing are both 10%, so those two racers stand side by side.

## Features

- **Accounts**: register, log in and out, reset a forgotten password by email. Sessions use httpOnly cookies.
- **Profiles**: display name, photo uploaded or taken with the device camera (live viewfinder on https/localhost, the phone's camera app elsewhere; cropped to a square in the browser, EXIF and GPS data stripped), race sport (one of the four; its goal is fixed and can't be edited), km or miles for display.
- **Racers**: without a photo you race as a cartoon snail in your own shell colour. With a photo, a round photo token in that colour replaces the snail on the track and on every profile view.
- **The race**: a large animated SVG track with a start line, finish flag, 25/50/75% markers, a crown for the leader, name tags and a slime trail for you. Racers glide forward when their share of their goal changes. Wide screens get a garden loop and phones get a switchback course.
- **Activities**: log sport, date, distance and notes. Only your race sport counts; other sports stay in your history. Edit or delete your own entries. Negative, zero, absurd and future entries are rejected on both client and server.
- **Leaderboard**: ranked by share of each racer's goal, with sport, distance, goal and distance to go.
- **Races**: everyone joins the default Grand Prix. Create races with a name and start and end dates, then invite people. Everyone races to 100% of their own sport goal using activities inside the dates. Invitees can join or decline. Completed races show a podium.
- **Dashboard**: your racer, total distance, race position, progress to your sport goal, recent activities, invitations and sync problems.
- **Strava (optional)**: OAuth connect, encrypted tokens, automatic import, webhooks plus scheduled fallback sync, "Sync now", Strava-type to race-sport mapping review, import history, duplicate handling, and disconnect with data deletion.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | [Deno 2](https://deno.com) (≥ 2.3) | TypeScript out of the box, built-in `node:sqlite`, one binary |
| API | [Hono](https://hono.dev) | Small, fast, typed routing |
| Validation | [Zod](https://zod.dev) | Server-side validation with per-field messages |
| Database | SQLite (`node:sqlite`, WAL mode) | Zero-ops, a single file on a volume. The SQL is portable to Postgres if the app outgrows one instance |
| Frontend | React 18 + React Router + Vite | Standard, well-known SPA tooling |
| Auth | Own implementation: scrypt password hashes, random session tokens stored as SHA-256 hashes | No third-party dependency; easy to audit |

## Quick start (local development)

Requirements: Deno 2.3 or newer.

```bash
cp .env.example .env          # defaults work out of the box
deno task build               # installs frontend deps and builds web/dist
deno task seed                # optional: four demo racers (password in server/scripts/seed.ts)
deno task start               # http://localhost:8000
```

For frontend hot reload, run the API and Vite side by side and open http://localhost:5173:

```bash
deno task dev                 # API on :8000, restarts on change
deno task dev:web             # Vite on :5173, proxies /api to :8000
```

When using Vite, set `APP_URL=http://localhost:5173` in `.env`, because cookies, origin checks and OAuth redirects use it.

Without SMTP settings, password-reset emails are printed to the API's console. Copy the link from there.

### Tasks

| Task | What it does |
|---|---|
| `deno task start` | Run the server (serves the API and `web/dist`) |
| `deno task dev` / `dev:web` | Development servers |
| `deno task build` | Build the frontend |
| `deno task test` | API and Strava integration tests (in-memory DB, fake Strava) |
| `deno task check` | Type-check the server |
| `deno task seed` | Demo data (refuses to run when `APP_ENV=production`) |
| `deno task strava:webhook [view\|create\|delete <id>]` | Manage the Strava webhook subscription |

## Configuration

Every option is documented in [.env.example](.env.example). The ones that matter in production:

- `APP_URL`: the public `https://` URL. Cookies become `Secure` automatically.
- `APP_ENV=production`
- `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64. Required in production. Keep it stable.
- `DATA_DIR` / `UPLOAD_DIR`: must be on persistent storage.
- `TRUST_PROXY=true` when behind a load balancer or reverse proxy.
- `SMTP_*`: needed for password resets to reach people.

## Strava integration

### 1. Create a Strava API application

1. Go to https://www.strava.com/settings/api and create an app.
2. Set **Authorization Callback Domain** to the host of `APP_URL` (`localhost` for local development, `snails.example.com` in production).
3. Put the **Client ID** and **Client Secret** in `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`. They stay on the server and never reach the browser.

Users then click **Connect with Strava** under *Profile → Activity tracking integrations*. They approve access on Strava's own site, so the app never sees their Strava password.

### 2. Webhooks (instant updates)

Strava pushes create, update and delete events and deauthorizations to `APP_URL/api/integrations/strava/webhook`. The URL must be publicly reachable over HTTPS. For local testing, use a tunnel (e.g. `cloudflared tunnel --url http://localhost:8000`) and set `APP_URL` to the tunnel URL.

```bash
# with the server running and STRAVA_WEBHOOK_VERIFY_TOKEN set
deno task strava:webhook create
```

Strava allows one subscription per application. Without webhooks the app still works: it re-syncs every `STRAVA_SYNC_INTERVAL_MINUTES`, and users can press **Sync now**.

### How it works

| Concern | Implementation |
|---|---|
| OAuth | `POST /api/integrations/strava/connect` creates a single-use `state` (stored hashed, tied to the logged-in user, 10-minute expiry) and returns Strava's authorize URL. The callback validates state, user, expiry and granted scope before exchanging the code. |
| Scope | `read,activity:read` by default, the minimum that reads activities and receives activity webhooks. Override with `STRAVA_SCOPE`. |
| Tokens | AES-256-GCM encrypted at rest. Refreshed 5 minutes before expiry, once even under concurrency. Rotated refresh tokens are saved immediately. A rejected refresh marks the connection *Reconnect needed*. |
| Sync | Incremental: `GET /athlete/activities?after=<cursor − 3 days>`, 100 per page, at most 20 pages per run. Interrupted syncs resume from the last imported activity. The first sync looks back `STRAVA_INITIAL_SYNC_DAYS`. |
| Webhooks | Answered within Strava's 2-second limit, then processed. Payloads aren't signed, so the server only uses their IDs: it looks up the athlete and fetches the activity from Strava itself. Deauthorization deletes the connection and the imported data. |
| Rate limits | Reads `X-RateLimit-*` / `X-ReadRateLimit-*` headers. On 429 the whole app pauses until the next 15-minute window, or until midnight UTC if the daily limit is hit (Strava's limits are per application). Scheduled syncs stop at 70% of the short-term budget. |
| Deduplication | Unique index on `(user_id, source, external_id)`, so repeated syncs update rows in place. |
| Disconnect | Revokes the token via Strava's `/oauth/revoke`, forgets the tokens, and by default deletes imported activities. |

### Sports and counting rules

The four sports and their goals live in [shared/sports.ts](shared/sports.ts). Strava `sport_type` values (falling back to the legacy `type`) map to them in
[server/integrations/strava/sportMap.ts](server/integrations/strava/sportMap.ts): `Run`, `TrailRun` and `VirtualRun` count as Running; `Ride`, `GravelRide`, `MountainBikeRide`, `VirtualRide` and e-bike types as Cycling; `Rowing` and `VirtualRow` as Rowing; `Swim` as Swimming.
Any other type (walks, hikes, yoga…) is stored as *Not raced* and never counts. Users can remap any type, and already-imported activities are re-categorised immediately.

All counting goes through [server/services/counting.ts](server/services/counting.ts). An activity counts toward a race when all of these hold:

1. It belongs to the participant, and its date falls inside the race's start and end dates (both days included). For Strava activities the date is the athlete's local start date (`start_date_local`), so an activity at 23:30 on 30 September is September even if it was already 1 October in UTC. Earlier imported history stays in the activity list, marked *outside the dates of your races*.
2. Its sport is the participant's race sport. Switching sport recalculates progress from the new sport's activities.
3. Its source matches the user's tracking method: **Manual**, **Strava**, or **Both**.
4. For imported activities: the user consented to share Strava totals.
5. With **Both**, a manual entry with the same date, the same sport, and a distance within 3% (minimum 50 m) of a counted Strava activity is treated as the same workout. Only the Strava copy counts. The user can mark it as *separate workout* to override.

A racer's position is `counted distance ÷ sport goal`, capped at 100%. The first to reach 100% wins, and finishers rank by the date they crossed. Standings are computed from the saved activities on every request, so edits, deletions and sport changes are reflected immediately.

### ⚠️ Strava API Agreement

Strava's [API Agreement](https://www.strava.com/legal/api) says Strava data provided by a user may only be shown to that user, unless they give explicit consent.
Snail Race handles this as follows:

- Connecting requires an explicit opt-in: *"my Strava distance totals are shown to people in my races."* Users can withdraw it at any time, and their Strava distance then stops counting.
- Other people only ever see **aggregate totals**. Individual Strava activities (names, dates, times) are visible only to their owner.
- The UI shows "Powered by Strava" and links each imported activity to "View on Strava".

Read the current agreement and brand guidelines yourself, and confirm with Strava if a leaderboard of totals suits your use, before launching publicly. Swap the text buttons for Strava's official
"Connect with Strava" and "Powered by Strava" assets from their [brand guidelines](https://developers.strava.com/guidelines/).

## Security notes

- Passwords: scrypt (N=16384, r=8, p=1) with per-user salt. Login is timing-safe, including for unknown emails.
- Sessions: 256-bit random tokens in `HttpOnly; SameSite=Lax` cookies (`Secure` on https). Only SHA-256 hashes are stored, and all of a user's sessions are revoked on password reset.
- CSRF: SameSite cookies, plus an Origin check on every state-changing API request.
- Authorization: every query that touches activities, profiles or connections is scoped to the session user. Another user's activity returns 404. Race visibility is limited to participants and invitees.
- Uploads: max 5 MB, type detected from magic bytes (JPEG/PNG/WebP only), random filenames, served only to logged-in users with `nosniff` and a `default-src 'none'` CSP.
- Headers: strict Content-Security-Policy, `frame-ancestors 'none'`, `nosniff`, and a referrer policy.
- Rate limits: on register, login, forgot-password and reset (in-memory; single instance).
- Secrets: Strava tokens and the client secret never reach the browser or the logs.

## Deployment

**Step-by-step server instructions are in [DEPLOY.md](DEPLOY.md)** (Unraid: [UNRAID.md](UNRAID.md)), with example configs in [deploy/](deploy/) and a [docker-compose.yml](docker-compose.yml).

The app is one process with two pieces of persistent state, the SQLite file and the photos folder. Run a **single instance** with a persistent volume.

### Docker (any host)

```bash
docker build -t snail-race .
docker run -d -p 8000:8000 -v snail-data:/data \
  -e APP_URL=https://snails.example.com \
  -e TOKEN_ENCRYPTION_KEY=... \
  -e TRUST_PROXY=true \
  -e SMTP_HOST=... -e SMTP_USER=... -e SMTP_PASS=... -e MAIL_FROM="Snail Race <hi@example.com>" \
  -e STRAVA_CLIENT_ID=... -e STRAVA_CLIENT_SECRET=... -e STRAVA_WEBHOOK_VERIFY_TOKEN=... \
  snail-race
```

Put it behind HTTPS (Caddy, nginx, or your platform's proxy). The image uses `denoland/deno:2.9.5`, the version the app was tested with.

### Fly.io example

```bash
fly launch --no-deploy               # detects the Dockerfile
fly volumes create snail_data --size 1
# in fly.toml: [mounts] source = "snail_data", destination = "/data"
fly secrets set TOKEN_ENCRYPTION_KEY=... APP_URL=https://<app>.fly.dev TRUST_PROXY=true STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_WEBHOOK_VERIFY_TOKEN=...
fly deploy
fly ssh console -C "deno task strava:webhook create"   # once, after the first deploy
```

Render, Railway or a plain VPS with systemd work the same way: build with `deno task build`, run `deno task start`, and mount a disk at `DATA_DIR`.

**Backups**: copy `DATA_DIR` (use `sqlite3 snail-race.db ".backup backup.db"` for a consistent snapshot) and `UPLOAD_DIR`.

## Project structure

```
server/
  main.ts, app.ts           server entry, middleware, routing, static files
  config.ts, db.ts          env config, SQLite + migrations
  lib/                      crypto, sessions, validation helpers, rate limiting, mail
  services/counting.ts      the single source of truth for what counts
  services/races.ts         standings, race status, default race
  routes/                   auth, profile, activities, races, dashboard, integrations
  integrations/registry.ts  list of activity providers (add Garmin etc. here)
  integrations/strava/      client (HTTP), service (OAuth, tokens, sync, webhooks), sport map
  scripts/                  seed data, webhook subscription management
  tests/                    API + Strava tests (fake Strava client)
shared/                     the four sports and their goals + unit conversion, used by both sides
web/src/
  components/RaceTrack.tsx  the animated race track
  components/Snail.tsx      the snail drawing
  pages/                    one file per screen
```

### Adding another fitness platform

1. Add a module under `server/integrations/<provider>/` with OAuth, sync and webhook handling. Strava's is the template.
2. Store imports in `activities` with `source = '<provider>'` and the provider's activity ID in `external_id`.
3. Register it in `integrations/registry.ts`, and add its source to the tracking-method rules in `services/counting.ts`.

`integration_connections`, `sync_logs` and `user_sport_mapping` are already keyed by provider.

## Data model

`users`, `sessions`, `password_resets`, `activities` (distance always in **meters**), `races`, `race_participants` (invited, joined or declined), `integration_connections` (encrypted tokens, sync cursor, status), `oauth_states`, `user_sport_mapping`, `sync_logs`. A user's goal isn't stored: it's derived from their sport. Migrations live in [server/db.ts](server/db.ts) and run on startup.

## Known limitations

- Single instance only: rate limiting and the sync scheduler run in memory, and storage is SQLite.
- No email verification on sign-up.
- Photos are stored on local disk. For multi-instance hosting, move them to object storage (S3 or R2) behind the same `/api/photos/:file` route.
