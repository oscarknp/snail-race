// Fills a development database with a few demo racers and activities.
//   deno task seed
// Every demo account uses the password below. Never run this against production.
import { config } from "../config.ts";
import { getDb, one, run } from "../db.ts";
import { hashPassword } from "../lib/crypto.ts";
import { ensureDefaultRace, joinDefaultRace } from "../services/races.ts";

export const DEMO_PASSWORD = "snail-demo-123";

const RACERS = [
  // Each activity is [sport, km]; a racer's sports are the ones they log.
  { name: "Speedy Sue", email: "sue@demo.test", acts: [["running", 5.2], ["running", 8.1], ["running", 10.4], ["running", 12.0]] },
  { name: "Turbo Tom", email: "tom@demo.test", acts: [["cycling", 61.5], ["cycling", 48.2], ["running", 7.5]] },
  { name: "Rowan Rower", email: "rowan@demo.test", acts: [["rowing", 12.1], ["rowing", 15.8], ["swimming", 2.0], ["cycling", 30.0]] },
  { name: "Gentle Gus", email: "gus@demo.test", acts: [["swimming", 1.5], ["swimming", 2.4]] },
];

if (config.isProd) {
  console.error("Refusing to seed a production database.");
  Deno.exit(1);
}

getDb();
ensureDefaultRace();
const hash = await hashPassword(DEMO_PASSWORD);
for (const r of RACERS) {
  if (one("SELECT 1 FROM users WHERE email = ?", r.email)) continue;
  const id = Number(
    run(
      "INSERT INTO users (email, password_hash, name, sports) VALUES (?, ?, ?, ?)",
      r.email,
      hash,
      r.name,
      [...new Set(r.acts.map(([sport]) => sport))].join(","),
    ).lastInsertRowid,
  );
  joinDefaultRace(id);
  r.acts.forEach(([sport, km], i) => {
    const date = new Date(Date.now() - i * 86400_000).toLocaleDateString("en-CA");
    run("INSERT INTO activities (user_id, source, sport, date, distance_m) VALUES (?, 'manual', ?, ?, ?)", id, sport, date, Number(km) * 1000);
  });
  console.log(`Created ${r.name} <${r.email}>`);
}
console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
