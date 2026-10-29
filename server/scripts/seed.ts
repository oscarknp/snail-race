// Fills a development database with a few demo racers and activities.
//   deno task seed
// Every demo account uses the password below. Never run this against production.
import { config } from "../config.ts";
import { getDb, one, run } from "../db.ts";
import { hashPassword } from "../lib/crypto.ts";
import { ensureDefaultRace, joinDefaultRace } from "../services/races.ts";

export const DEMO_PASSWORD = "snail-demo-123";

const RACERS = [
  { name: "Speedy Sue", email: "sue@demo.test", sport: "running", km: [5.2, 8.1, 10.4, 6.3, 12.0, 9.5] },
  { name: "Turbo Tom", email: "tom@demo.test", sport: "cycling", km: [61.5, 48.2, 79.9, 55.0] },
  { name: "Rowan Rower", email: "rowan@demo.test", sport: "rowing", km: [12.1, 9.4, 15.8, 11.0, 14.7] },
  { name: "Gentle Gus", email: "gus@demo.test", sport: "swimming", km: [1.5, 2.0, 2.4] },
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
    run("INSERT INTO users (email, password_hash, name, sport) VALUES (?, ?, ?, ?)", r.email, hash, r.name, r.sport).lastInsertRowid,
  );
  joinDefaultRace(id);
  r.km.forEach((km, i) => {
    const date = new Date(Date.now() - i * 86400_000).toLocaleDateString("en-CA");
    run("INSERT INTO activities (user_id, source, sport, date, distance_m) VALUES (?, 'manual', ?, ?, ?)", id, r.sport, date, km * 1000);
  });
  console.log(`Created ${r.name} <${r.email}>`);
}
console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
