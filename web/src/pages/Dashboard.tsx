import { Link } from "react-router-dom";
import { formatPoints, pointsPerKm, sportEmoji, sportLabel } from "../../../shared/sports.ts";
import { LogButton } from "../components/ActivityForm.tsx";
import { RacerPortrait } from "../components/Racer.tsx";
import { Empty, ErrorBox, Loading } from "../components/ui.tsx";
import { ActivityRow } from "./Activities.tsx";
import { type Activity, api, type Me, type Race, type Standing } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, ordinal, pct } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

interface DashboardData {
  me: Me;
  totalM: number;
  totalPoints: number;
  activityCount: number;
  race: Race;
  myStanding: Standing | null;
  leader: Standing | null;
  participantCount: number;
  recent: Activity[];
}

export function Dashboard() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad(() => api<DashboardData>("/dashboard"), []);
  const races = useLoad(() => api<Race[]>("/races"), []);
  const strava = useLoad(() => api<{ connection: { status: string; lastError: string | null } | null }>("/integrations/strava"), []);

  if (error) return <main className="page container"><ErrorBox message={error} onRetry={reload} /></main>;
  if (loading && !data) return <main className="page container"><Loading /></main>;
  if (!data) return null;

  const { race, myStanding: s, leader } = data;
  const invitations = (races.data ?? []).filter((r) => r.myStatus === "invited");
  const conn = strava.data?.connection;

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <h1>Hi, {me.name.split(" ")[0]}! 👋</h1>
          <p>{s && s.progress > 0 ? "You're airborne. Keep that throttle open." : "Your plane is waiting on the runway."}</p>
        </div>
        <LogButton />
      </div>

      <div className="stack" style={{ marginBottom: 20 }}>
        {!me.photoUrl && (
          <div className="notice info">
            <span aria-hidden="true">📸</span>
            <div>You're flying a standard-issue plane. <Link to="/profile">Upload a profile photo</Link> to fly as yourself instead.</div>
          </div>
        )}
        {invitations.length > 0 && (
          <div className="notice">
            <span aria-hidden="true">💌</span>
            <div>You have {invitations.length} race invitation{invitations.length > 1 ? "s" : ""}. <Link to="/races">Take a look</Link></div>
          </div>
        )}
        {conn && (conn.status !== "active" || conn.lastError) && (
          <div className="notice danger">
            <span aria-hidden="true">⚠️</span>
            <div>Strava sync needs attention: {conn.lastError ?? "please reconnect"} <Link to="/profile#tracking">Fix it</Link></div>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="racer-card">
            <RacerPortrait user={me} size={150} leader={s?.rank === 1 && (s?.progress ?? 0) > 0} />
            <div>
              <h2 style={{ marginBottom: 2 }}>{me.name}</h2>
              <div className="muted">
                {me.sports.length
                  ? `${me.sports.map((sp) => `${sportEmoji(sp)} ${sportLabel(sp)}`).join(", ")} · goal ${me.goalPoints!.toLocaleString()} pts`
                  : "No sport picked yet"}
              </div>
              <div className="faint">{me.trackingMethod === "manual" ? "Manual tracking" : me.trackingMethod === "strava" ? "Strava tracking" : "Manual + Strava"}</div>
              <Link to="/profile" className="btn btn-ghost btn-sm" style={{ marginTop: 6, paddingLeft: 0 }}>Edit profile →</Link>
            </div>
          </div>
          <hr className="sep" />
          <div className="stats">
            <div className="stat"><span className="value">{formatPoints(data.totalPoints)}</span><span className="label">Points earned</span></div>
            <div className="stat"><span className="value">{dist(data.totalM, me.unit)}</span><span className="label">Counted distance</span></div>
            <div className="stat"><span className="value">{s ? ordinal(s.rank) : "—"}</span><span className="label">Position of {data.participantCount}</span></div>
            <div className="stat"><span className="value">{data.activityCount}</span><span className="label">Activities logged</span></div>
          </div>
        </section>

        <section className="card stack">
          <div className="card-head">
            <h2>{race.name}</h2>
            <Link to={race.isDefault ? "/" : `/races/${race.id}`} className="btn btn-secondary btn-sm">Watch the race</Link>
          </div>
          {s
            ? (
              <>
                {s.goalPoints
                  ? (
                    <div>
                      <div className="spread small">
                        <strong>Progress to {s.goalPoints.toLocaleString()} points</strong>
                        <span>{pct(s.progress, 1)}</span>
                      </div>
                      <div className="progress"><span style={{ width: `${s.progress * 100}%` }} /></div>
                      <div className="faint" style={{ marginTop: 4 }}>
                        {formatPoints(s.points)} earned ·{" "}
                        {s.finishedOn ? "You crossed the finish line! 🏁" : `${formatPoints(s.remainingPoints ?? 0)} to go`}
                      </div>
                      <ul className="list" style={{ marginTop: 8 }}>
                        {s.bySport.map((b) => (
                          <li key={b.sport} className="spread small" style={{ padding: "6px 0" }}>
                            <span>{sportEmoji(b.sport)} {sportLabel(b.sport)} <span className="faint">· {pointsPerKm(b.sport)} pts/km</span></span>
                            <span><strong>{formatPoints(b.points)}</strong> <span className="faint">({dist(b.distanceM, me.unit)})</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                  : (
                    <div className="notice">
                      <span aria-hidden="true">👉</span>
                      <div><Link to="/profile">Pick your sports</Link> to get your points goal and start moving.</div>
                    </div>
                  )}
                {leader && leader.user.id !== me.id && leader.progress > 0 && (
                  <div className="notice">
                    <span aria-hidden="true">👑</span>
                    <div>
                      {leader.user.name} leads at {pct(leader.progress)} of their goal ({formatPoints(leader.points)} of {leader.goalPoints?.toLocaleString()}).
                      You're {pct(leader.progress - s.progress)} behind.
                    </div>
                  </div>
                )}
                {leader && leader.user.id === me.id && s.progress > 0 && (
                  <div className="notice ok"><span aria-hidden="true">👑</span><div>You're leading the pack! Don't look back.</div></div>
                )}
              </>
            )
            : <p className="muted">You're not in this race. <Link to="/">Join from the race page</Link>.</p>}
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h2>Recent activities</h2>
          <Link to="/activities" className="btn btn-ghost btn-sm">See all →</Link>
        </div>
        {data.recent.length === 0
          ? (
            <Empty title="No activities yet" emoji="👟">
              <p>Log your first distance and watch your plane take off.</p>
              <LogButton label="Log my first activity" />
            </Empty>
          )
          : <ul className="list">{data.recent.map((a) => <li key={a.id}><ActivityRow activity={a} unit={me.unit} compact /></li>)}</ul>}
      </section>
      <LogButton floating />
    </main>
  );
}
