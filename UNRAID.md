# Snail Race on Unraid (GitHub + Unraid GUI)

How it fits together: you put the code on GitHub. GitHub builds the Docker image for you and publishes it as
`ghcr.io/<your-github-name>/snail-race`. Unraid then installs it from the Docker tab like any other container,
and **Check for Updates** works.

No terminal is needed. Total time is about 20 minutes, most of it waiting for the first build.

---

## Part 1: Put the code on GitHub (one time)

### 1. Get a GitHub account and GitHub Desktop

- Sign up at https://github.com/signup if you don't have an account. Note your **username**.
- Install **GitHub Desktop** from https://desktop.github.com and sign in with that account.

### 2. Create the repository

1. Unzip `snail-race-github.zip`. You get a folder called **snail-race**. Put it somewhere permanent, e.g. Documents.
2. In GitHub Desktop: **File → Add Local Repository…** → choose the **snail-race** folder.
3. It says the folder isn't a Git repository yet. Click **create a repository**, keep the name `snail-race`,
   and click **Create Repository**.
4. Click **Publish repository** (top bar). Keep the name `snail-race`. *Keep this code private* is your choice;
   both work. Click **Publish Repository**.

### 3. Wait for the image to build

1. Open `https://github.com/<your-github-name>/snail-race` and click the **Actions** tab.
2. You'll see **Build and publish image** running. It runs the tests, then builds the image (3–6 minutes).
3. Wait for the green ✓. If it shows a red ✗, click it to see which step failed.

### 4. Make the image public

Unraid downloads the image without logging in to GitHub, so the image must be public. It contains no secrets:
your keys and passwords live only in Unraid's settings.

1. On GitHub, click your profile picture → **Your profile** → **Packages** tab → **snail-race**.
2. **Package settings** (bottom right) → **Danger Zone** → **Change visibility** → **Public** → confirm.

If GitHub won't let you make the package public while the repository is private, make the repository public
instead (repository **Settings** → **Danger Zone** → **Change visibility**). The code contains no secrets either.

---

## Part 2: Install it in Unraid (GUI)

### 5. Add the template (makes the form fill itself in)

1. In Unraid, go to **Shares → flash** and make sure **SMB export** is on (Security: *Secure* or *Private*).
2. On your Mac, use Finder → **Go → Connect to Server…** → `smb://tower/flash` (use your server's name or IP).
3. Open `config/plugins/dockerMan/templates-user/` and copy in **my-snail-race.xml** from the
   `snail-race/unraid/` folder.

### 6. Create the container

1. Unraid **Docker** tab → **Add Container** → **Template** dropdown → **snail-race** (under *User templates*).
2. Fill in:

| Field | What to enter |
|---|---|
| **Repository** | `ghcr.io/<your-github-name>/snail-race:latest`. Your GitHub username **in lowercase**. |
| **APP_URL** | The exact address you'll open the app at: `https://snails.yourdomain.com` through your reverse proxy (recommended), or `http://<unraid-ip>:8000`. Logins only work at this exact address. |
| **TOKEN_ENCRYPTION_KEY** | A random secret of 32+ characters. Let your password manager generate one and **save it there**: changing it later disconnects everyone's Strava. |
| **TRUST_PROXY** | `true` if a reverse proxy sits in front, otherwise `false`. |
| **STRAVA_CLIENT_ID / SECRET** | From https://www.strava.com/settings/api. Leave empty for manual tracking only. |
| Web UI port | Change it if 8000 is already used on your server, and use the same port in APP_URL. |

   Under **Advanced View** (toggle at the top right): PUID `99` / PGID `100` are Unraid's defaults, so leave
   them. Mail settings for password-reset emails are optional.
3. Click **Apply**. Unraid downloads the image and starts it.
4. After about 20 seconds the container shows as **healthy**. Click its icon → **WebUI**.

**No template?** In Add Container, fill in Name `snail-race`, Repository as above, then **Add another Path, Port,
Variable** for: Port `8000` → `8000`; Path container `/data` → host `/mnt/user/appdata/snail-race`; and the
variables `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `TRUST_PROXY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
`PUID`=`99`, `PGID`=`100`.

### 7. Reverse proxy and HTTPS (Nginx Proxy Manager)

Add a **Proxy Host**:
- **Domain:** `snails.yourdomain.com`. **Forward:** `http`, your Unraid IP, port `8000`.
- **SSL** tab: request a Let's Encrypt certificate, and turn on *Force SSL*.
- **Advanced** tab, custom config: `client_max_body_size 6m;` (needed for profile photo uploads).

Then edit the container: set APP_URL to `https://snails.yourdomain.com` and TRUST_PROXY to `true` → **Apply**.

Using SWAG or plain nginx instead? See `deploy/nginx.conf` for the same settings.

### 8. Point Strava at it

In https://www.strava.com/settings/api, set **Authorization Callback Domain** to the host in your APP_URL
(`snails.yourdomain.com`, without `https://` or the port). Strava expects a domain name. I'm not sure it accepts
a bare LAN IP, so use the reverse-proxy domain if it refuses one.

Optional, for instant updates (needs the public https address and `STRAVA_WEBHOOK_VERIFY_TOKEN` set to any random
string): click the container icon → **Console**, then run:

```
deno task strava:webhook create
```

Without this, activities sync every hour and whenever someone presses **Sync now**.

---

## Updating

1. Change files in your `snail-race` folder (or replace them with a newer version).
2. GitHub Desktop: write a summary → **Commit to main** → **Push origin**.
3. Wait for the green ✓ in the Actions tab.
4. Unraid **Docker** tab → **Check for Updates** → **apply update** on snail-race. Your data stays.

## Backups

Back up `/mnt/user/appdata/snail-race` (the Appdata Backup plugin covers it) and keep your
TOKEN_ENCRYPTION_KEY in your password manager.

## Troubleshooting

- **Container stops right away:** check **Logs**. A missing or too-short TOKEN_ENCRYPTION_KEY is reported there.
- **"Cross-site request blocked" when logging in:** you're not using the exact APP_URL address.
- **Unraid can't pull the image:** the package isn't public yet (step 4), or the Repository name isn't all
  lowercase.
- **Photo upload fails behind the proxy:** add `client_max_body_size 6m;` (step 7).
