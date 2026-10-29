import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, Empty, ErrorBox, Field, Loading, Modal, useToast } from "../components/ui.tsx";
import { api, ApiError, notifyDataChanged, type PublicUser, type Race } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { formatDate, pct, todayIso } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

type Tab = "active" | "upcoming" | "completed";

export function Races() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api<Race[]>("/races"), []);
  const [tab, setTab] = useState<Tab>("active");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const invitations = (data ?? []).filter((r) => r.myStatus === "invited");
  const visible = (data ?? []).filter((r) => r.status === tab && r.myStatus !== "invited");

  async function respond(race: Race, action: "join" | "decline") {
    try {
      await api(`/races/${race.id}/${action}`, { body: {} });
      toast(action === "join" ? `You joined ${race.name}!` : "Invitation declined");
      notifyDataChanged();
      if (action === "join") navigate(`/races/${race.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    }
  }

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <h1>Races &amp; challenges</h1>
          <p>Everyone races in the Grand Prix. Start your own race to challenge friends on your own terms.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ Create a race</button>
      </div>

      {invitations.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2>💌 Invitations</h2>
          <ul className="list">
            {invitations.map((r) => (
              <li key={r.id} className="spread">
                <div>
                  <strong>{r.name}</strong>
                  <div className="faint">{formatDate(r.startDate)} → {r.endDate ? formatDate(r.endDate) : "open-ended"} · {r.participantCount} racing</div>
                </div>
                <div className="row">
                  <button className="btn btn-primary btn-sm" onClick={() => respond(r, "join")}>Join</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => respond(r, "decline")}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="segmented" role="group" aria-label="Filter races" style={{ marginBottom: 16 }}>
        {(["active", "upcoming", "completed"] as Tab[]).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "active" ? "Racing now" : t === "upcoming" ? "Upcoming" : "Completed"}
          </button>
        ))}
      </div>

      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && visible.length === 0 && (
        <div className="card">
          <Empty emoji={tab === "completed" ? "🏆" : "🌱"} title={tab === "completed" ? "No finished races yet" : tab === "upcoming" ? "Nothing on the horizon" : "No races here"}>
            <p>{tab === "completed" ? "Results from finished races will show up here." : "Create a race and invite some fellow snails."}</p>
          </Empty>
        </div>
      )}
      <div className="grid grid-2">
        {visible.map((r) => <RaceCard key={r.id} race={r} />)}
      </div>

      {creating && <CreateRaceDialog onClose={() => setCreating(false)} />}
    </main>
  );
}

function RaceCard({ race }: { race: Race }) {
  return (
    <article className="card stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{race.name}</h2>
        {race.isDefault && <span className="badge badge-ok">Everyone</span>}
        {race.isOwner && <span className="badge badge-warn">Organiser</span>}
      </div>
      {race.description && <p className="muted" style={{ margin: 0 }}>{race.description}</p>}
      <div className="row small muted">
        <span>🏁 Race to 100% of your goal</span>
        <span>📅 {formatDate(race.startDate)} → {race.endDate ? formatDate(race.endDate) : "open-ended"}</span>
        <span>🐌 {race.participantCount} racing</span>
      </div>
      {race.podium && race.podium.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Final results</div>
          <ol className="list" style={{ paddingLeft: 0 }}>
            {race.podium.map((s, i) => (
              <li key={s.user.id} className="row" style={{ padding: "6px 0" }}>
                <span aria-hidden="true">{["🥇", "🥈", "🥉"][i]}</span>
                <Avatar user={s.user} size={28} />
                <strong>{s.user.name}</strong>
                <span className="faint">{pct(s.progress)} of goal{s.finishedOn ? ` · finished ${formatDate(s.finishedOn)}` : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="row">
        <Link className="btn btn-secondary btn-sm" to={race.isDefault ? "/" : `/races/${race.id}`}>View race</Link>
        <Link className="btn btn-ghost btn-sm" to={`/leaderboard?race=${race.id}`}>Leaderboard</Link>
      </div>
    </article>
  );
}

function PeoplePicker({ selected, onChange, exclude }: { selected: number[]; onChange: (ids: number[]) => void; exclude: number[] }) {
  const { data, loading } = useLoad(() => api<PublicUser[]>("/users"), []);
  const [q, setQ] = useState("");
  const people = useMemo(
    () => (data ?? []).filter((u) => !exclude.includes(u.id) && u.name.toLowerCase().includes(q.toLowerCase())),
    [data, q, exclude],
  );
  if (loading && !data) return <Loading label="Finding snails…" />;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" placeholder="Search racers…" aria-label="Search racers" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 220, overflow: "auto", border: "2px solid var(--line)", borderRadius: 12, padding: "4px 10px" }}>
        {people.length === 0 && <p className="faint" style={{ margin: "8px 0" }}>No one else to invite yet.</p>}
        {people.map((u) => (
          <label key={u.id} className="checkbox" style={{ padding: "8px 0", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={selected.includes(u.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))}
            />
            <Avatar user={u} size={28} /> {u.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function CreateRaceDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [invite, setInvite] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const race = await api<Race>("/races", {
        body: {
          name,
          description,
          startDate,
          endDate: endDate || null,
          inviteUserIds: invite,
        },
      });
      toast(`“${race.name}” is ready. On your marks…`);
      notifyDataChanged();
      onClose();
      navigate(`/races/${race.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (!Object.keys(err.fields).length) setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create a race" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <Field label="Race name" id="race-name" error={errors.name}>
          <input id="race-name" className="input" maxLength={60} placeholder="The Lettuce Dash" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description (optional)" id="race-desc" error={errors.description}>
          <input id="race-desc" className="input" maxLength={300} placeholder="First to the compost heap wins." value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="notice info">
          <span aria-hidden="true">🏁</span>
          <div>Everyone races to 100% of their own sport's goal (cycling 900 km, rowing 300 km, running 225 km, swimming 75 km), counting activities between the start and end dates.</div>
        </div>
        <div className="form-row">
          <Field label="Start date" id="race-start" error={errors.startDate}>
            <input id="race-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="End date (optional)" id="race-end" error={errors.endDate}>
            <input id="race-end" className="input" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <div className="field">
          <span className="label">Invite racers</span>
          <PeoplePicker selected={invite} onChange={setInvite} exclude={[me.id]} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Painting the start line…" : "Create race"}</button>
      </form>
    </Modal>
  );
}

export function InviteDialog({ race, existing, onClose }: { race: Race; existing: number[]; onClose: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Invite to ${race.name}`} onClose={onClose}>
      <div className="stack">
        {error && <div className="form-error" role="alert">{error}</div>}
        <PeoplePicker selected={selected} onChange={setSelected} exclude={existing} />
        <button
          className="btn btn-primary btn-block"
          disabled={busy || selected.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/races/${race.id}/invite`, { body: { userIds: selected } });
              toast(`Sent ${selected.length} invitation${selected.length === 1 ? "" : "s"} 💌`);
              notifyDataChanged();
              onClose();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Couldn't send invitations");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : `Invite ${selected.length || ""}`.trim()}
        </button>
      </div>
    </Modal>
  );
}
