import { Hono } from "hono";
import { one } from "../db.ts";
import { type AppEnv, currentUser, HttpError, requireAuth } from "../lib/http.ts";
import type { RaceRow } from "../lib/types.ts";
import { countedTotal } from "../services/counting.ts";
import { canViewRace, ensureDefaultRace, raceStandings, raceSummary } from "../services/races.ts";
import { activityResponse, evaluatedActivitiesFor } from "./activities.ts";
import { meResponse } from "./profile.ts";

export const dashboard = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", (c) => {
    const user = currentUser(c);
    const raceId = Number(c.req.query("raceId"));
    let race = raceId ? one<RaceRow>("SELECT * FROM races WHERE id = ?", raceId) : ensureDefaultRace();
    if (!race || !canViewRace(race, user.id)) {
      if (raceId) throw new HttpError(404, "Race not found");
      race = ensureDefaultRace();
    }
    const evaluated = evaluatedActivitiesFor(user);
    const standings = raceStandings(race);
    return c.json({
      me: meResponse(user),
      totalM: countedTotal(evaluated),
      activityCount: evaluated.length,
      race: raceSummary(race, user.id),
      myStanding: standings.find((s) => s.user.id === user.id) ?? null,
      leader: standings[0] ?? null,
      participantCount: standings.length,
      recent: evaluated.slice(0, 5).map(activityResponse),
    });
  });
