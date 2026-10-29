# Run Snail Race on your computer

Everything runs from this folder. Your data (accounts, activities, photos) is saved in `data/` and `uploads/`
inside it.

## 1. Install Deno (once)

Snail Race runs on [Deno](https://deno.com). On a Mac with Homebrew:

```bash
brew install deno
```

Or use the official installer: `curl -fsSL https://deno.land/install.sh | sh`

## 2. Start it

- **Mac:** double-click **Start Snail Race.command**. The first time, macOS may say it's from an unidentified
  developer: right-click the file, choose **Open**, then **Open** again.
- **Or in Terminal** (Mac or Linux): `sh start.sh`

The first start asks for your Strava **Client ID** and **Client Secret**. Press Enter to skip if you only want manual
logging; you can add them later in `.env`. Your browser then opens **http://localhost:8000**.

Keep the Terminal window open while you use the app. To stop it, press **Ctrl+C** or close the window.

## Strava

In your Strava API settings (https://www.strava.com/settings/api), the **Authorization Callback Domain** must be
`localhost`. Activities sync when you press **Sync now** on your profile and automatically every hour while the app
is running. (Instant updates from Strava need a public web address, so they don't work on a local computer.)

## Good to know

- To change the port, run `PORT=8080 sh start.sh` before the first start, or edit `APP_URL` and `PORT` in `.env`.
- Only people on your computer can open `localhost`. Friends on other devices can't reach it unless you host it
  on a server.
- **Back up** by copying the `data/` and `uploads/` folders. `data/dev-secrets.json` holds the key that protects
  Strava connections, so keep it with the database.
- Optional demo racers: `deno task seed` (all use the password shown in the output).
- More detail (features, how counting works, settings) is in [README.md](README.md).
