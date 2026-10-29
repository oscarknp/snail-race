import { Link, useSearchParams } from "react-router-dom";
import { sportEmoji, sportLabel } from "../../../shared/sports.ts";
import { Avatar, Empty, ErrorBox, Loading } from "../components/ui.tsx";
import { api, type Race, type RaceDetail } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, formatDate, pct } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

export function Leaderboard() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const races = useLoad(() => api<Race[]>("/races"), []);
  const raceId = Number(params.get("race")) || races.data?.find((r) => r.isDefault)?.id;
  const detail = useLoad(() => (raceId ? api<RaceDetail>(`/races/${raceId}`) : Promise.resolve(null)), [raceId]);

  const race = detail.data?.race;
  const rows = detail.data?.standings ?? [];
  const options = (races.data ?? []).filter((r) => r.myStatus === "joined" || r.isDefault);

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p>
            {race ? <>{race.name} · ranked by share of each racer's sport goal</> : "Who's the speediest snail?"}
          </p>
        </div>
        {options.length > 1 && (
          <select className="input" style={{ width: "auto" }} aria-label="Race" value={raceId ?? ""} onChange={(e) => setParams({ race: e.target.value })}>
            {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      <section className="card">
        {(races.error || detail.error) && <ErrorBox message={(races.error || detail.error)!} onRetry={detail.reload} />}
        {!detail.data && !detail.error && <Loading />}
        {race && rows.length === 0 && <Empty title="No racers yet" />}
        {race && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Racer</th>
                  <th scope="col">Sport</th>
                  <th scope="col" className="num">Progress</th>
                  <th scope="col" className="num">Distance</th>
                  <th scope="col" className="num">Goal</th>
                  <th scope="col" className="num">To go</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.user.id} className={s.user.id === me.id ? "me" : undefined}>
                    <td style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.1rem" }}>
                      {s.rank <= 3 && s.progress > 0 ? ["🥇", "🥈", "🥉"][s.rank - 1] : s.rank}
                    </td>
                    <td>
                      <Link to={`/people/${s.user.id}`} className="person">
                        <Avatar user={s.user} size={36} />
                        <span><strong>{s.user.name}</strong>{s.user.id === me.id && <span className="faint"> (you)</span>}</span>
                      </Link>
                    </td>
                    <td>{s.user.sport ? `${sportEmoji(s.user.sport)} ${sportLabel(s.user.sport)}` : <span className="faint">not chosen</span>}</td>
                    <td className="num" style={{ minWidth: 120 }}>
                      <strong>{pct(s.progress, 1)}</strong>
                      <div className="progress" style={{ height: 6, marginTop: 4 }} aria-hidden="true"><span style={{ width: `${s.progress * 100}%` }} /></div>
                    </td>
                    <td className="num">{dist(s.distanceM, me.unit)}</td>
                    <td className="num">{s.goalM ? dist(s.goalM, me.unit, 0) : "—"}</td>
                    <td className="num">
                      {s.finishedOn ? `🏁 ${formatDate(s.finishedOn)}` : s.remainingM !== null ? dist(s.remainingM, me.unit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
