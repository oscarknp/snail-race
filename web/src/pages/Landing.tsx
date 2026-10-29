import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RaceTrack } from "../components/RaceTrack.tsx";
import { sportTargetM } from "../../../shared/sports.ts";
import type { Race, Standing } from "../lib/api.ts";

const DEMO_RACE: Race = {
  id: 0,
  name: "Demo Derby",
  description: null,
  startDate: "2026-01-01",
  endDate: null,
  isDefault: true,
  createdBy: null,
  isOwner: false,
  status: "active",
  participantCount: 4,
  invitedCount: 0,
  myStatus: null,
};

const DEMO = [
  { id: 1, name: "Speedy Sue", sport: "running", pct: 72 },
  { id: 2, name: "Turbo Tom", sport: "cycling", pct: 58 },
  { id: 4, name: "Rowan Rower", sport: "rowing", pct: 31 },
  { id: 5, name: "Gentle Gus", sport: "swimming", pct: 12 },
] as const;

function demoStandings(bonus: number): Standing[] {
  return DEMO.map((d, i) => {
    const share = Math.min(100, d.pct + bonus * (i === 2 ? 3 : 1)) / 100;
    const goalM = sportTargetM(d.sport)!;
    return {
      rank: 0,
      user: { id: d.id, name: d.name, sport: d.sport, goalM, unit: "km" as const, photoUrl: null },
      distanceM: share * goalM,
      goalM,
      progress: share,
      remainingM: (1 - share) * goalM,
      finishedOn: null,
      activityCount: 3,
      lastActivityOn: null,
    };
  }).sort((a, b) => b.progress - a.progress).map((s, i) => ({ ...s, rank: i + 1 }));
}

export function Landing() {
  const [bonus, setBonus] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBonus((b) => (b >= 8 ? 0 : b + 4)), 3500);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="container">
      <section className="landing-hero">
        <div>
          <h1>Every workout moves your snail closer to the finish line.</h1>
          <p className="lede">
            Snail Race turns your runs, walks, rides and swims into a friendly race. Upload a photo, become a snail,
            log your distance by hand or sync it from Strava, and slime past your friends.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <Link to="/register" className="btn btn-primary">Create my snail</Link>
            <Link to="/login" className="btn btn-secondary">I already race</Link>
          </div>
        </div>
        <div className="race-hero" aria-label="Demo race">
          <RaceTrack race={DEMO_RACE} standings={demoStandings(bonus)} meId={-1} unit="km" />
        </div>
      </section>
      <section className="grid grid-3" style={{ marginBottom: 48 }}>
        <div className="card feature">
          <span className="icon" aria-hidden="true">📸</span>
          <div><h3>Race as yourself</h3><p className="muted">Upload a profile photo and it becomes your racer on the track. No photo? You race as a snail.</p></div>
        </div>
        <div className="card feature">
          <span className="icon" aria-hidden="true">📏</span>
          <div><h3>Four sports, one track</h3><p className="muted">Cycle 900 km, row 300 km, run 225 km or swim 75 km. Everyone races to 100% of their own goal. Log by hand or sync from Strava.</p></div>
        </div>
        <div className="card feature">
          <span className="icon" aria-hidden="true">🏁</span>
          <div><h3>Race your people</h3><p className="muted">Everyone joins the Grand Prix. Start your own races with friends, dates and a finish line.</p></div>
        </div>
      </section>
    </main>
  );
}
