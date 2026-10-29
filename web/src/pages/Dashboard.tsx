import { Link } from "react-router-dom";
import { sportEmoji, sportLabel } from "../../../shared/sports.ts";
import { LogButton } from "../components/ActivityForm.tsx";
import { SnailPortrait } from "../components/Snail.tsx";
import { Empty, ErrorBox, Loading } from "../components/ui.tsx";
import { ActivityRow } from "./Activities.tsx";
import { type Activity, api, type Me, type Race, type Standing } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, ordinal, pct } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

interface DashboardData {
  me: Me;
  totalM: number;
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
          <p>{s && s.progress > 0 ? "Your snail is on the move. Keep that slime flowing." : "Your snail is warming up at the start line."}</p>
        </div>
        <LogButton />
      </div>

      <div className="stack" style={{ marginBottom: 20 }}>
        {!me.photoUrl && (
          <div className="notice info">
            <span aria-hidden="true">📸</span>
            <div>You're racing as a snail. <Link to="/profile">Upload a profile photo</Link> to race as yourself instead.</div>
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
          <div className="snail-card">
            <SnailPortrait user={me} size={150} leader={s?.rank === 1 && (s?.progress ?? 0) > 0} />
            <div>
              <h2 style={{ marginBottom: 2 }}>{me.name}</h2>
              <div className="muted">
                {me.sport ? `${sportEmoji(me.sport)} ${sportLabel(me.sport)} · goal ${dist(me.goalM ?? 0, me.unit, 0)}` : "No sport picked yet"}
              </div>
              <div className="faint">{me.trackingMethod === "manual" ? "Manual tracking" : me.trackingMethod === "strava" ? "Strava tracking" : "Manual + Strava"}</div>
              <Link to="/profile" className="btn btn-ghost btn-sm" style={{ marginTop: 6, paddingLeft: 0 }}>Edit profile →</Link>
            </div>
          </div>
          <hr className="sep" />
          <div className="stats">
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
                {me.goalM
                  ? (
                    <div>
                      <div className="spread small">
                        <strong>Progress to your {sportLabel(me.sport).toLowerCase()} goal</strong>
                        <span>{pct(s.progress, 1)}</span>
                      </div>
                      <div className="progress"><span style={{ width: `${s.progress * 100}%` }} /></div>
                      <div className="faint" style={{ marginTop: 4 }}>
                        {dist(s.distanceM, me.unit)} of {dist(me.goalM, me.unit, 0)} ·{" "}
                        {s.finishedOn ? "You crossed the finish line! 🏁" : `${dist(s.remainingM ?? 0, me.unit)} to go`}
                      </div>
                    </div>
                  )
                  : (
                    <div className="notice">
                      <span aria-hidden="true">👉</span>
                      <div><Link to="/profile">Pick your sport</Link> to get your distance goal and start moving.</div>
                    </div>
                  )}
                {leader && leader.user.id !== me.id && leader.progress > 0 && (
                  <div className="notice">
                    <span aria-hidden="true">👑</span>
                    <div>
                      {leader.user.name} leads at {pct(leader.progress)} of their {sportLabel(leader.user.sport).toLowerCase()} goal.
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
              <p>Log your first distance and watch your snail leave the start line.</p>
              <LogButton label="Log my first activity" />
            </Empty>
          )
          : <ul className="list">{data.recent.map((a) => <li key={a.id}><ActivityRow activity={a} unit={me.unit} compact /></li>)}</ul>}
      </section>
      <LogButton floating />
    </main>
  );
}
