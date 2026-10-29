// Configuration comes from environment variables. A local `.env` file is loaded
// for development; real environment variables always win over it.
loadDotEnv(".env");

function env(key: string, fallback?: string): string | undefined {
  const v = Deno.env.get(key);
  return v === undefined || v === "" ? fallback : v;
}

const appUrl = (env("APP_URL", "http://localhost:5173") as string).replace(/\/$/, "");

export const config = {
  port: Number(env("PORT", "8000")),
  // Public URL the browser uses. Used for email links, OAuth redirects and Origin checks.
  appUrl,
  isProd: env("APP_ENV", "development") === "production",
  dataDir: env("DATA_DIR", "./data") as string,
  databasePath: env("DATABASE_PATH"),
  uploadDir: env("UPLOAD_DIR", "./uploads") as string,
  staticDir: env("STATIC_DIR", "./web/dist") as string,
  tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY"),
  secureCookies: appUrl.startsWith("https://"),
  // Set when running behind a reverse proxy (Fly, Render, nginx...) so client IPs come from X-Forwarded-For.
  trustProxy: env("TRUST_PROXY", "false") === "true",
  defaultRace: {
    name: env("DEFAULT_RACE_NAME", "The Great Garden Grand Prix") as string,
  },
  mail: {
    smtpHost: env("SMTP_HOST"),
    smtpPort: Number(env("SMTP_PORT", "587")),
    smtpUser: env("SMTP_USER"),
    smtpPass: env("SMTP_PASS"),
    from: env("MAIL_FROM", "Snail Race <no-reply@snailrace.local>") as string,
  },
  strava: {
    clientId: env("STRAVA_CLIENT_ID"),
    clientSecret: env("STRAVA_CLIENT_SECRET"),
    webhookVerifyToken: env("STRAVA_WEBHOOK_VERIFY_TOKEN"),
    // `activity:read` is the smallest scope that can read activities and receive activity webhooks.
    // Set to "read,activity:read_all" if participants should be able to count "Only You" activities.
    scope: env("STRAVA_SCOPE", "read,activity:read") as string,
    syncIntervalMinutes: Number(env("STRAVA_SYNC_INTERVAL_MINUTES", "60")),
    initialSyncDays: Number(env("STRAVA_INITIAL_SYNC_DAYS", "365")),
    apiBase: "https://www.strava.com/api/v3",
    oauthBase: "https://www.strava.com/oauth",
  },
};

export function stravaConfigured(): boolean {
  return Boolean(config.strava.clientId && config.strava.clientSecret);
}

function loadDotEnv(path: string) {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let value = m[2];
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    if (Deno.env.get(m[1]) === undefined) Deno.env.set(m[1], value);
  }
}
