import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useState } from "react";
import { isSport, SPORTS, sportLabel } from "../../../shared/sports.ts";
import { fromMeters, type Unit } from "../../../shared/units.ts";
import { type Activity, api, ApiError, notifyDataChanged } from "../lib/api.ts";
import { useMe } from "../lib/auth.tsx";
import { dist, todayIso } from "../lib/format.ts";
import { Field, Modal, useToast } from "./ui.tsx";

const CHEERS = [
  "Slime on! 🐌",
  "Your snail is positively zooming.",
  "Shell yeah! 🐚",
  "That's some serious slime mileage.",
  "The lettuce at the finish line trembles. 🥬",
];

function ActivityForm({ initial, onDone }: { initial?: Activity; onDone: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [sport, setSport] = useState<string>(initial && isSport(initial.sport) ? initial.sport : me.sport ?? "cycling");
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [unit, setUnit] = useState<Unit>(me.unit);
  const [distance, setDistance] = useState(initial ? String(Math.round(fromMeters(initial.distanceM, me.unit) * 100) / 100) : "");
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(distance);
    const local: Record<string, string> = {};
    if (!distance.trim() || !Number.isFinite(value)) local.distance = "Enter a distance";
    else if (value <= 0) local.distance = "Distance must be greater than zero";
    if (!date) local.date = "Pick a date";
    else if (date > todayIso()) local.date = "That date is in the future — snails can't time travel";
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const body = { sport, date, distance: value, unit, name, notes };
      const saved = initial
        ? await api<Activity>(`/activities/${initial.id}`, { method: "PATCH", body })
        : await api<Activity>("/activities", { body });
      notifyDataChanged();
      if (initial) toast("Activity updated");
      else if (saved.counts) toast(`+${dist(saved.distanceM, unit)} — ${CHEERS[Math.floor(Math.random() * CHEERS.length)]}`);
      else toast(saved.excludedLabel ?? "Saved, but it doesn't count toward your races");
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (!Object.keys(err.fields).length) setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {formError && <div className="form-error" role="alert">{formError}</div>}
      <Field
        label="Sport"
        id="act-sport"
        error={errors.sport}
        hint={me.sport && sport !== me.sport ? `Heads up: only ${sportLabel(me.sport).toLowerCase()} counts toward your race.` : undefined}
      >
        <select id="act-sport" className="input" value={sport} onChange={(e) => setSport(e.target.value)}>
          {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Distance" id="act-distance" error={errors.distance}>
          <div className="input-group">
            <input
              id="act-distance"
              className="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="5.0"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              aria-invalid={Boolean(errors.distance)}
              required
            />
            <select className="input" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="km">km</option>
              <option value="mi">mi</option>
            </select>
          </div>
        </Field>
        <Field label="Date" id="act-date" error={errors.date}>
          <input id="act-date" className="input" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={Boolean(errors.date)} required />
        </Field>
      </div>
      <Field label="Title (optional)" id="act-name" error={errors.name}>
        <input id="act-name" className="input" maxLength={80} placeholder="Morning plod" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Notes (optional)" id="act-notes" error={errors.notes} hint={`${notes.length}/500`}>
        <textarea id="act-notes" className="input" maxLength={500} placeholder="Felt speedy. Overtook a slug." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save changes" : "Log it & move my snail"}
      </button>
    </form>
  );
}

const LogContext = createContext<(activity?: Activity) => void>(() => {});

/** Lets any page open the "log activity" dialog (e.g. the floating button). */
export function ActivityDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ activity?: Activity } | null>(null);
  const show = useCallback((activity?: Activity) => setOpen({ activity }), []);
  const close = useCallback(() => setOpen(null), []);
  return (
    <LogContext.Provider value={show}>
      {children}
      {open && (
        <Modal title={open.activity ? "Edit activity" : "Log an activity"} onClose={close}>
          <ActivityForm initial={open.activity} onDone={close} />
        </Modal>
      )}
    </LogContext.Provider>
  );
}

export const useActivityDialog = () => useContext(LogContext);

export function LogButton({ floating = false, label = "Log activity" }: { floating?: boolean; label?: string }) {
  const open = useActivityDialog();
  return (
    <button type="button" className={`btn btn-primary${floating ? " fab" : ""}`} onClick={() => open()}>
      <span aria-hidden="true">＋</span> {label}
    </button>
  );
}
