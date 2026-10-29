import { useState } from "react";
import { Link } from "react-router-dom";
import { sportEmoji, sportLabel } from "../../../shared/sports.ts";
import type { Unit } from "../../../shared/units.ts";
import { LogButton, useActivityDialog } from "../components/ActivityForm.tsx";
import { ConfirmDialog, Empty, ErrorBox, Loading, useToast } from "../components/ui.tsx";
import { type Activity, api, ApiError, notifyDataChanged } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, formatDate } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

type Filter = "all" | "manual" | "strava" | "excluded";

export function Activities() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad(() => api<{ totalM: number; activities: Activity[] }>("/activities"), []);
  const [filter, setFilter] = useState<Filter>("all");

  const list = (data?.activities ?? []).filter((a) =>
    filter === "all" ? true : filter === "excluded" ? !a.counts : a.source === filter
  );
  const hasStrava = (data?.activities ?? []).some((a) => a.source === "strava");

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <h1>Activities</h1>
          <p>
            {data ? <>Counted distance: <strong>{dist(data.totalM, me.unit)}</strong> across {data.activities.filter((a) => a.counts).length} activities.</> : "Your workout history."}
          </p>
        </div>
        <LogButton />
      </div>

      <div className="segmented" role="group" aria-label="Filter activities" style={{ marginBottom: 16 }}>
        {([
          ["all", "All"],
          ["manual", "Manual"],
          ...(hasStrava ? [["strava", "Strava"]] : []),
          ["excluded", "Not counted"],
        ] as [Filter, string][]).map(([f, label]) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>

      <section className="card">
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && data.activities.length === 0 && (
          <Empty title="Nothing logged yet" emoji="👟">
            <p>Every kilometre counts. Log one by hand, or <Link to="/profile#tracking">connect Strava</Link> to import them.</p>
            <LogButton label="Log my first activity" />
          </Empty>
        )}
        {data && data.activities.length > 0 && list.length === 0 && <Empty title="Nothing matches this filter" emoji="🔍" />}
        <ul className="list">
          {list.map((a) => <li key={a.id}><ActivityRow activity={a} unit={me.unit} /></li>)}
        </ul>
      </section>
      {hasStrava && <p className="powered-strava" style={{ textAlign: "right", marginTop: 8 }}>Powered by Strava</p>}
    </main>
  );
}

export function ActivityRow({ activity: a, unit, compact = false }: { activity: Activity; unit: Unit; compact?: boolean }) {
  const openDialog = useActivityDialog();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const manual = a.source === "manual";

  async function remove() {
    setBusy(true);
    try {
      await api(`/activities/${a.id}`, { method: "DELETE" });
      toast("Activity deleted. Your snail slid back a little.");
      notifyDataChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't delete", "error");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  async function markNotDuplicate(value: boolean) {
    try {
      await api(`/activities/${a.id}/not-duplicate`, { body: { notDuplicate: value } });
      toast(value ? "Got it, both workouts count" : "Marked as a duplicate");
      notifyDataChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    }
  }

  return (
    <div className={`activity-item${a.counts ? "" : " excluded"}`}>
      <span className="sport-icon" aria-hidden="true">{sportEmoji(a.sport)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="title">{a.name || sportLabel(a.sport)}</div>
        <div className="meta">
          <span>{formatDate(a.date)}</span>
          <span>{sportLabel(a.sport)}{a.sourceSportType && a.source !== "manual" ? ` (${a.sourceSportType})` : ""}</span>
          <span className={`badge ${manual ? "badge-manual" : "badge-strava"}`}>{manual ? "Manual" : "Strava"}</span>
          {a.counts ? <span className="badge badge-ok">Counts</span> : <span className="badge badge-off" title={a.excludedLabel ?? ""}>Not counted</span>}
        </div>
        {!a.counts && a.excludedLabel && !compact && <div className="faint" style={{ marginTop: 2 }}>{a.excludedLabel}</div>}
        {a.notes && !compact && <div className="small muted" style={{ marginTop: 2 }}>{a.notes}</div>}
      </div>
      <div>
        <div className="dist">{dist(a.distanceM, unit, 2)}</div>
        {!compact && (
          <div className="activity-actions">
            {manual && a.excludedReason === "duplicate" && (
              <button className="btn btn-ghost btn-sm" onClick={() => markNotDuplicate(true)}>Separate workout</button>
            )}
            {manual && a.notDuplicate && <button className="btn btn-ghost btn-sm" onClick={() => markNotDuplicate(false)}>It's a duplicate</button>}
            {manual && <button className="btn btn-ghost btn-sm" onClick={() => openDialog(a)} aria-label={`Edit ${a.name || sportLabel(a.sport)} on ${formatDate(a.date)}`}>Edit</button>}
            {manual && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)} aria-label={`Delete ${a.name || sportLabel(a.sport)} on ${formatDate(a.date)}`}>Delete</button>}
            {a.externalUrl && (
              <a className="btn btn-ghost btn-sm" href={a.externalUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--strava)" }}>
                View on Strava
              </a>
            )}
          </div>
        )}
      </div>
      {confirm && (
        <ConfirmDialog title="Delete this activity?" confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(false)}>
          <p>{dist(a.distanceM, unit, 2)} of {sportLabel(a.sport).toLowerCase()} on {formatDate(a.date)} will be removed and your snail will move back.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
