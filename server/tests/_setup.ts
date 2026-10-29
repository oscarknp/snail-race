// Imported first by every test file so config picks these up before it loads.
const tmp = Deno.makeTempDirSync({ prefix: "snail-race-test-" });
Deno.env.set("DATABASE_PATH", ":memory:");
Deno.env.set("DATA_DIR", tmp);
Deno.env.set("UPLOAD_DIR", `${tmp}/uploads`);
Deno.env.set("APP_URL", "http://localhost:5173");
Deno.env.set("TOKEN_ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
Deno.env.set("STRAVA_CLIENT_ID", "12345");
Deno.env.set("STRAVA_CLIENT_SECRET", "test-secret");
Deno.env.set("STRAVA_WEBHOOK_VERIFY_TOKEN", "verify-me");

export const ORIGIN = "http://localhost:5173";
