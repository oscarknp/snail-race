// Manage the app's Strava webhook subscription (Strava allows one per application).
//   deno task strava:webhook view
//   deno task strava:webhook create   # needs the app reachable at APP_URL over HTTPS
//   deno task strava:webhook delete <id>
import { config } from "../config.ts";

const { clientId, clientSecret, webhookVerifyToken, apiBase } = config.strava;
if (!clientId || !clientSecret) {
  console.error("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET first.");
  Deno.exit(1);
}
const endpoint = `${apiBase}/push_subscriptions`;
const [cmd = "view", id] = Deno.args;

if (cmd === "view") {
  const res = await fetch(`${endpoint}?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret })}`);
  console.log(res.status, await res.text());
} else if (cmd === "create") {
  if (!webhookVerifyToken) {
    console.error("Set STRAVA_WEBHOOK_VERIFY_TOKEN (any random string) first.");
    Deno.exit(1);
  }
  const callback = `${config.appUrl}/api/integrations/strava/webhook`;
  console.log(`Creating subscription for ${callback} (the server must be running and reachable)...`);
  const res = await fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: callback,
      verify_token: webhookVerifyToken,
    }),
  });
  const text = await res.text();
  console.log(res.status, text);
  if (res.ok) console.log("Optionally set STRAVA_WEBHOOK_SUBSCRIPTION_ID to the id above so other events are rejected.");
} else if (cmd === "delete" && id) {
  const res = await fetch(
    `${endpoint}/${encodeURIComponent(id)}?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret })}`,
    { method: "DELETE" },
  );
  console.log(res.status, await res.text());
} else {
  console.log("Usage: deno task strava:webhook [view | create | delete <id>]");
}
