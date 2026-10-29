import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LogButton } from "../components/ActivityForm.tsx";
import { RaceTrack, StandingsList } from "../components/RaceTrack.tsx";
import { ConfirmDialog, ErrorBox, Loading, useToast } from "../components/ui.tsx";
import { InviteDialog } from "./Races.tsx";
import { api, ApiError, notifyDataChanged, type Race, type RaceDetail } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, formatDate, pct } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

export function RacePage() {
  const me = useMe();
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const races = useLoad(() => api<Race[]>("/races"), []);
  const raceId = params.id ? Number(params.id) : races.data?.find((r) => r.isDefault)?.id;
  const detail = useLoad(
    () => (raceId ? api<RaceDetail>(`/races/${raceId}`) : Promise.resolve(null)),
    [raceId],
  );

  async function act(path: string, success: string) {
    try {
      await api(`/races/${raceId}/${path}`, { body: {} });
      toast(success);
      notifyDataChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    }
  }

  if (races.error) return <main className="page container"><ErrorBox message={races.error} onRetry={races.reload} /></main>;
  if (detail.error) return <main className="page container"><ErrorBox message={detail.error} onRetry={detail.reload} /></main>;
  if (!detail.data) return <main className="page container"><Loading label="Lining up the snails…" /></main>;

  const { race, standings } = detail.data;
  const leader = standings[0];
  const mine = standings.find((s) => s.user.id === me.id);
  const myRaces = (races.data ?? []).filter((r) => r.myStatus === "joined" || r.isDefault);

  return (
    <main className="page container">
      <div className="race-hero">
        <div className="race-hero-head">
          <div>
            <h1>{race.name}</h1>
            <div className="row small muted" style={{ marginTop: 4 }}>
              <span>🏁 First to 100% of their sport's goal wins</span>
              <span>· {formatDate(race.startDate)} → {race.endDate ? formatDate(race.endDate) : "no end date"}</span>
              <span className={`badge ${race.status === "active" ? "badge-ok" : race.status === "upcoming" ? "badge-warn" : "badge-off"}`}>{race.status}</span>
            </div>
          </div>
          <div className="row">
            {myRaces.length > 1 && (
              <select
                className="input"
                style={{ width: "auto" }}
                aria-label="Choose a race"
                value={race.id}
                onChange={(e) => {
                  const r = myRaces.find((x) => x.id === Number(e.target.value));
                  navigate(r?.isDefault ? "/" : `/races/${e.target.value}`);
                }}
              >
                {myRaces.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {race.myStatus === "invited" && (
          <div className="notice info" style={{ margin: "0 20px 12px" }}>
            <span aria-hidden="true">💌</span>
            <div className="spread" style={{ flex: 1 }}>
              <span>You've been invited to this race.</span>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => act("join", "You're in! Slime responsibly.")}>Join race</button>
                <button className="btn btn-secondary btn-sm" onClick={() => act("decline", "Invitation declined")}>Decline</button>
              </div>
            </div>
          </div>
        )}
        {race.isDefault && race.myStatus !== "joined" && (
          <div className="notice info" style={{ margin: "0 20px 12px" }}>
            <span aria-hidden="true">🐌</span>
            <div className="spread" style={{ flex: 1 }}>
              <span>You're not in this race right now.</span>
              <button className="btn btn-primary btn-sm" onClick={() => act("join", "Back on the track!")}>Join race</button>
            </div>
          </div>
        )}

        <div className="leader-banner" aria-live="polite">
          {leader && leader.progress > 0
            ? (
              <>
                <span className="crown" aria-hidden="true">👑</span>
                <span>
                  <strong>{leader.user.id === me.id ? "You are" : `${leader.user.name} is`}</strong>{" "}
                  {leader.finishedOn ? "the champion!" : `leading at ${pct(leader.progress)} of their goal`}
                </span>
                {mine && mine.user.id !== leader.user.id && (
                  <span className="muted">· You're {pct(leader.progress - mine.progress)} behind</span>
                )}
                {mine && (
                  <span className="muted">
                    · {mine.finishedOn
                      ? "You finished! 🎉"
                      : mine.remainingM !== null
                      ? `${dist(mine.remainingM, me.unit)} to your finish`
                      : "Pick your sport in your profile to start moving"}
                  </span>
                )}
              </>
            )
            : <span>🌱 Nobody has left the starting line yet. Log some distance and take the lead!</span>}
        </div>

        <RaceTrack race={race} standings={standings} meId={me.id} unit={me.unit} />
        <StandingsList standings={standings} meId={me.id} unit={me.unit} />

        <div className="row" style={{ padding: "0 20px 20px" }}>
          <Link to={`/leaderboard?race=${race.id}`} className="btn btn-secondary btn-sm">Full leaderboard</Link>
          {!race.isDefault && race.myStatus === "joined" && (
            <button className="btn btn-secondary btn-sm" onClick={() => setInviting(true)}>Invite racers</button>
          )}
          {!race.isDefault && race.myStatus === "joined" && !race.isOwner && (
            <button className="btn btn-ghost btn-sm" onClick={() => act("leave", "You left the race")}>Leave race</button>
          )}
          {race.isDefault && race.myStatus === "joined" && (
            <button className="btn btn-ghost btn-sm" onClick={() => act("leave", "You left the Grand Prix. Come back any time!")}>Leave race</button>
          )}
          {race.isOwner && !race.isDefault && (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>Delete race</button>
          )}
        </div>
      </div>

      {inviting && <InviteDialog race={race} existing={[...standings.map((s) => s.user.id), ...detail.data.invited.map((i) => i.id)]} onClose={() => setInviting(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this race?"
          confirmLabel="Delete race"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api(`/races/${race.id}`, { method: "DELETE" });
            toast("Race deleted");
            navigate("/races");
          }}
        >
          <p>Everyone's progress in “{race.name}” disappears. Their activities stay safe in their own history.</p>
        </ConfirmDialog>
      )}
      <LogButton floating />
    </main>
  );
}
