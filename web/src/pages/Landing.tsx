import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RaceTrack } from "../components/RaceTrack.tsx";
import { goalPoints, type Sport } from "../../../shared/sports.ts";
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

const DEMO: { id: number; name: string; sports: Sport[]; pct: number }[] = [
  { id: 1, name: "Speedy Sue", sports: ["running"], pct: 72 },
  { id: 2, name: "Turbo Tom", sports: ["cycling", "running"], pct: 58 },
  { id: 4, name: "Rowan Rower", sports: ["rowing", "swimming", "cycling"], pct: 31 },
  { id: 5, name: "Gentle Gus", sports: ["swimming"], pct: 12 },
];

function demoStandings(bonus: number): Standing[] {
  return DEMO.map((d, i) => {
    const share = Math.min(100, d.pct + bonus * (i === 2 ? 3 : 1)) / 100;
    const goal = goalPoints(d.sports)!;
    return {
      rank: 0,
      user: { id: d.id, name: d.name, sports: d.sports, goalPoints: goal, unit: "km" as const, photoUrl: null },
      points: share * goal,
      goalPoints: goal,
      progress: share,
      remainingPoints: (1 - share) * goal,
      distanceM: 0,
      bySport: [],
      fromStrava: false,
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
          <h1>Every workout flies you closer to the finish.</h1>
          <p className="lede">
            Sky Race turns your rides, runs, rows and swims into a friendly air race. Earn points for every kilometre,
            log by hand or sync from Strava, and fly past your friends on the way to the finish.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <Link to="/register" className="btn btn-primary">Get my wings</Link>
            <Link to="/login" className="btn btn-secondary">I already fly</Link>
          </div>
        </div>
        <div className="race-hero" aria-label="Demo race">
          <RaceTrack race={DEMO_RACE} standings={demoStandings(bonus)} meId={-1} unit="km" />
        </div>
      </section>
      <section className="grid grid-3" style={{ marginBottom: 48 }}>
        <div className="card feature">
          <span className="icon" aria-hidden="true">📸</span>
          <div><h3>Race as yourself</h3><p className="muted">Upload a profile photo and it becomes your pilot badge in the sky. No photo? You fly your own little plane.</p></div>
        </div>
        <div className="card feature">
          <span className="icon" aria-hidden="true">📏</span>
          <div><h3>Five sports, one sky</h3><p className="muted">Earn points per km: cycling 1, walking 2, rowing 3, running 4, swimming 12. Race in up to 3 sports to 900, 1050 or 1200 points, or walk on your own to 500. Log by hand or sync from Strava.</p></div>
        </div>
        <div className="card feature">
          <span className="icon" aria-hidden="true">🏁</span>
          <div><h3>Race your people</h3><p className="muted">Everyone joins the Sky Rally. Start your own races with friends, dates and a finish line.</p></div>
        </div>
      </section>
    </main>
  );
}
