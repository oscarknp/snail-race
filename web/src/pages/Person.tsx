import { Link, useParams } from "react-router-dom";
import { sportEmoji, sportLabel } from "../../../shared/sports.ts";
import { SnailPortrait } from "../components/Snail.tsx";
import { Empty, ErrorBox, Loading } from "../components/ui.tsx";
import { api, type PublicUser, type Race, type Standing } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, formatDate, ordinal, pct } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

interface PersonData {
  user: PublicUser;
  memberSince: string;
  races: { race: Race; standing: Standing | null }[];
}

export function Person() {
  const { id } = useParams();
  const me = useMe();
  const { data, error } = useLoad(() => api<PersonData>(`/users/${id}`), [id]);
  if (error) return <main className="page container"><ErrorBox message={error} /></main>;
  if (!data) return <main className="page container"><Loading /></main>;
  const { user } = data;
  return (
    <main className="page container">
      <section className="card" style={{ marginBottom: 20 }}>
        <div className="snail-card">
          <SnailPortrait user={user} size={170} />
          <div>
            <h1 style={{ marginBottom: 4 }}>{user.name}{user.id === me.id && <span className="faint"> (you)</span>}</h1>
            <div className="muted">{user.sport ? `${sportEmoji(user.sport)} ${sportLabel(user.sport)}` : "Sport: a mystery"}</div>
            {user.goalM && <div className="muted">Goal: {dist(user.goalM, me.unit, 0)}</div>}
            <div className="faint">Racing since {formatDate(data.memberSince)}</div>
          </div>
        </div>
      </section>
      <section className="card">
        <h2>Races</h2>
        {data.races.length === 0 && <Empty title="Not in any races you can see" />}
        <ul className="list">
          {data.races.map(({ race, standing }) => (
            <li key={race.id} className="spread">
              <div>
                <Link to={race.isDefault ? "/" : `/races/${race.id}`}><strong>{race.name}</strong></Link>
                <div className="faint">{race.status === "completed" ? "Finished race" : race.status === "upcoming" ? "Starts soon" : "Racing now"}</div>
              </div>
              {standing && (
                <div style={{ textAlign: "right" }}>
                  <strong>{ordinal(standing.rank)}</strong> · {pct(standing.progress)} of goal
                  <div className="faint">{dist(standing.distanceM, me.unit)}{standing.finishedOn ? " · finished 🏁" : ""}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
