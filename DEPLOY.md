# Deploying Snail Race

This package contains the full source code and a ready-built frontend (`web/dist`). It does **not** contain
your local database, uploaded photos, or the `.env` file with your Strava secret. You create a fresh `.env`
on the server (step 2).

You need:

- A Linux server you can SSH into, with a domain name pointing at it (e.g. `snails.example.com`).
- Either **Docker** (option A) or **Deno 2.9+** (option B).

## 1. Upload and unpack

```bash
scp snail-race-deploy.tar.gz you@your-server:~
ssh you@your-server
sudo mkdir -p /opt/snail-race && sudo tar -xzf snail-race-deploy.tar.gz -C /opt/snail-race --strip-components=1
cd /opt/snail-race
```

## 2. Create `.env`

```bash
cp .env.example .env
nano .env
```

Set at least these:

| Setting | Value |
|---|---|
| `APP_URL` | `https://snails.example.com` (your real address, no trailing slash) |
| `APP_ENV` | `production` |
| `TOKEN_ENCRYPTION_KEY` | output of `openssl rand -base64 32`. Generate it once and keep it. |
| `TRUST_PROXY` | `true` (you'll be behind Caddy or nginx) |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | from https://www.strava.com/settings/api |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string, e.g. `openssl rand -hex 16` |
| `SMTP_*`, `MAIL_FROM` | so password-reset emails reach people (any SMTP provider) |

Then restrict access to the file: `chmod 600 .env`

## 3A. Run with Docker (recommended)

```bash
docker compose up -d --build
docker compose logs -f        # should print "Snail Race API listening" and "Strava: configured"
```

The database and photos live in the `snail-data` Docker volume, so they survive rebuilds and restarts.

## 3B. Or run with Deno + systemd

```bash
curl -fsSL https://deno.land/install.sh | sh          # or your distro's package; needs Deno 2.9+
sudo useradd --system --home /opt/snail-race snailrace
sudo chown -R snailrace:snailrace /opt/snail-race
sudo cp deploy/snail-race.service /etc/systemd/system/
sudo nano /etc/systemd/system/snail-race.service       # check the deno path (`which deno`)
sudo systemctl daemon-reload && sudo systemctl enable --now snail-race
journalctl -u snail-race -f
```

The frontend is already built. Data goes to `/opt/snail-race/data` and photos to `/opt/snail-race/uploads`.

## 4. nginx + HTTPS

The app listens on `127.0.0.1:8000`. nginx doesn't run the app; it receives visitors on ports 80/443 and passes
requests to it. The app serves its own pages, so there's nothing to copy into nginx's web root.

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo nano deploy/nginx.conf                             # replace snails.example.com (twice)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/snail-race
sudo ln -s /etc/nginx/sites-available/snail-race /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d snails.example.com              # adds the certificate + https redirect
```

The config raises nginx's upload limit to 6 MB (photos) and sets the forwarded-IP header the app uses when
`TRUST_PROXY=true`.

Open `https://snails.example.com`. You should see the landing page.

Prefer Caddy? Use [deploy/Caddyfile](deploy/Caddyfile) instead; it handles certificates by itself.

## 5. Point Strava at the new address

1. In https://www.strava.com/settings/api, change **Authorization Callback Domain** to your domain (`snails.example.com`, without `https://`).
2. Turn on instant updates (webhooks), once the site is reachable over HTTPS:
   ```bash
   docker compose exec snail-race deno task strava:webhook create   # Docker
   deno task strava:webhook create                                   # Deno (run in /opt/snail-race)
   ```
3. Your Strava app is in single-player mode until you raise the athlete limit (up to 10 in the dashboard; more needs Strava's review).

## Updating later

Upload the new package, unpack it over `/opt/snail-race` (your `.env`, `data/` and `uploads/` are untouched),
then `docker compose up -d --build` or `sudo systemctl restart snail-race`. Database migrations run automatically on start.

## Backups

- Docker: `docker compose exec snail-race sh -c 'cd /data && tar czf - .' > snail-backup.tgz`
- Deno: back up `/opt/snail-race/data` and `/opt/snail-race/uploads`

Keep `TOKEN_ENCRYPTION_KEY` with your backups. Without it, stored Strava connections can't be decrypted and users would have to reconnect.
