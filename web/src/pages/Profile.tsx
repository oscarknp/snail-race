import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OTHER_SPORT, SPORTS, sportLabel, sportTargetM } from "../../../shared/sports.ts";
import type { Unit } from "../../../shared/units.ts";
import { CameraDialog, canUseLiveCamera } from "../components/CameraCapture.tsx";
import { SnailPortrait } from "../components/Snail.tsx";
import { SportPicker } from "./Auth.tsx";
import { ConfirmDialog, ErrorBox, Field, Loading, useToast } from "../components/ui.tsx";
import { api, ApiError, type Me, notifyDataChanged } from "../lib/api.ts";
import { useAuth, useMe } from "../lib/auth.tsx";
import { dist, formatDateTime, timeAgo } from "../lib/format.ts";
import { useLoad } from "../lib/hooks.ts";

export function Profile() {
  const [params] = useSearchParams();
  useEffect(() => {
    if (location.hash === "#tracking") document.getElementById("tracking")?.scrollIntoView({ behavior: "smooth" });
  }, []);
  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <p>Customise your racer and choose how your distance is tracked.</p>
        </div>
      </div>
      {params.get("welcome") && (
        <div className="notice ok" style={{ marginBottom: 20 }}>
          <span aria-hidden="true">🎉</span>
          <div><strong>Welcome to the race!</strong> Upload or take a photo to race as yourself, and check your sport and its distance goal.</div>
        </div>
      )}
      <div className="stack" style={{ gap: 20 }}>
        <RacerCard />
        <TrackingSettings />
      </div>
    </main>
  );
}

/** Centre-crop to a 512px square JPEG in the browser. Also strips EXIF (incl. GPS) data. */
async function prepareSquarePhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file doesn't look like an image we can read. Try a JPEG or PNG."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(512, side);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that photo"))), "image/jpeg", 0.88));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function RacerCard() {
  const me = useMe();
  const { setMe } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [name, setName] = useState(me.name);
  const [sport, setSport] = useState<string>(me.sport ?? "");
  const [unit, setUnit] = useState<Unit>(me.unit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    if (!name.trim()) return setErrors({ name: "Enter a display name" });
    if (!sport) return setErrors({ sport: "Pick the sport you'll race in" });
    setBusy(true);
    try {
      const updated = await api<Me>("/me", {
        method: "PATCH",
        body: { name, sport, unit },
      });
      setMe(updated);
      notifyDataChanged();
      toast("Profile saved");
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.keys(err.fields).length ? err.fields : { _: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return setPhotoError("That photo is huge! Please pick one under 20 MB.");
    await uploadPhoto(file);
  }

  function takePhoto() {
    setPhotoError(null);
    // Without live camera support (e.g. plain http), fall back to the OS camera picker.
    if (canUseLiveCamera()) setCamera(true);
    else captureRef.current?.click();
  }

  async function uploadPhoto(source: Blob) {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const blob = await prepareSquarePhoto(source);
      const form = new FormData();
      form.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      setMe(await api<Me>("/me/photo", { body: form }));
      notifyDataChanged();
      toast("Looking sharp! That's your racer now.");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      setMe(await api<Me>("/me/photo", { method: "DELETE" }));
      notifyDataChanged();
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Your racer</h2>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <div className="photo-edit">
            <SnailPortrait user={{ ...me, name: name || me.name }} size={190} />
            <div className="stack" style={{ gap: 8 }}>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" id="photo-input" tabIndex={-1} onChange={onPhoto} />
              <input ref={captureRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPhoto} />
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                {photoBusy ? "Uploading…" : me.photoUrl ? "🖼️ Replace photo" : "🖼️ Upload photo"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={takePhoto} disabled={photoBusy}>📷 Take a photo</button>
              {me.photoUrl && <button type="button" className="btn btn-ghost btn-sm" onClick={removePhoto} disabled={photoBusy}>Remove photo</button>}
              <span className="faint">Square photos of faces look best. We crop it for you.</span>
            </div>
          </div>
          {photoError && <div className="form-error" role="alert">{photoError}</div>}
          {camera && (
            <CameraDialog
              onClose={() => setCamera(false)}
              onCapture={(blob) => {
                setCamera(false);
                uploadPhoto(blob);
              }}
            />
          )}
        </div>
        <form className="form" onSubmit={save} noValidate>
          {errors._ && <div className="form-error" role="alert">{errors._}</div>}
          <Field label="Display name" id="p-name" error={errors.name} hint="Shown next to your snail">
            <input id="p-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SportPicker value={sport} onChange={setSport} error={errors.sport} />
          {me.sport && sport !== me.sport && (
            <div className="notice" role="status">
              <span aria-hidden="true">🔁</span>
              <div>Switching to {sportLabel(sport).toLowerCase()} recalculates your progress: only your {sportLabel(sport).toLowerCase()} activities will count.</div>
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <span className="label">Distance goal</span>
              <div className="input" aria-readonly="true" style={{ background: "var(--cream)", display: "flex", alignItems: "center" }}>
                {sport ? dist(sportTargetM(sport)!, unit, 0) : "Pick a sport"}
              </div>
              <span className="hint">Fixed for {sport ? sportLabel(sport).toLowerCase() : "each sport"}</span>
            </div>
            <Field label="Preferred unit" id="p-unit">
              <select id="p-unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="km">Kilometres</option>
                <option value="mi">Miles</option>
              </select>
            </Field>
          </div>
          <div className="faint">Email: {me.email}</div>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        </form>
      </div>
    </section>
  );
}

// ---------------- Activity tracking integrations ----------------

interface StravaDetails {
  configured: boolean;
  connection: {
    athleteId: string;
    athleteName: string | null;
    status: "active" | "needs_reauth" | "error";
    scope: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    connectedAt: string;
    rateLimitedUntil: string | null;
    importedCount: number;
  } | null;
  autoSync: { webhooks: boolean; intervalMinutes: number };
  appRateLimitedUntil: number | null;
  sourceTypes: { type: string; count: number; category: string; defaultCategory: string; overridden: boolean }[];
  logs: { id: number; trigger: string; status: string; imported: number; updated: number; deleted: number; message: string; startedAt: string }[];
}

const METHODS = [
  { id: "manual", title: "Manual", text: "You enter distances yourself." },
  { id: "strava", title: "Strava", text: "Only imported Strava activities count." },
  { id: "both", title: "Both", text: "Manual and Strava. Likely duplicates count once." },
] as const;

function TrackingSettings() {
  const me = useMe();
  const { setMe } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, reload, setData } = useLoad(() => api<StravaDetails>("/integrations/strava"), []);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleteImported, setDeleteImported] = useState(true);
  const connectError = params.get("strava_error");

  // Coming back from Strava: the first import runs in the background, so refresh a few times.
  useEffect(() => {
    if (params.get("strava") !== "connected") return;
    toast("Strava connected! Fetching your activities…");
    const timers = [1500, 4000, 9000].map((ms) => setTimeout(() => { reload(); notifyDataChanged(); }, ms));
    api<Me>("/me").then(setMe).catch(() => {});
    params.delete("strava");
    setParams(params, { replace: true });
    return () => timers.forEach(clearTimeout);
  }, []);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  }

  const setMethod = (m: string) =>
    run("method", async () => {
      setMe(await api<Me>("/me", { method: "PATCH", body: { trackingMethod: m } }));
      notifyDataChanged();
      toast("Tracking method updated");
    });

  const connect = () =>
    run("connect", async () => {
      const { url } = await api<{ url: string }>("/integrations/strava/connect", { body: { consent: true } });
      window.location.assign(url);
    });

  const syncNow = () =>
    run("sync", async () => {
      const r = await api<{ result: { status: string; message: string }; details: StravaDetails }>("/integrations/strava/sync", { body: {} });
      setData(r.details);
      notifyDataChanged();
      toast(r.result.status === "ok" ? `Synced: ${r.result.message}` : r.result.message, r.result.status === "ok" ? "ok" : "error");
    });

  const remap = (sourceType: string, category: string) =>
    run("map", async () => {
      setData(await api<StravaDetails>("/integrations/strava/mapping", { method: "PUT", body: { sourceType, category } }));
      notifyDataChanged();
    });

  const setShare = (value: boolean) =>
    run("consent", async () => {
      await api("/integrations/strava/consent", { body: { consent: value } });
      setMe(await api<Me>("/me"));
      notifyDataChanged();
    });

  const conn = data?.connection;

  return (
    <section className="card" id="tracking">
      <div className="card-head">
        <h2>Activity tracking integrations</h2>
        <span className="powered-strava">Powered by Strava</span>
      </div>

      <div className="field" style={{ marginBottom: 20 }}>
        <span className="label" id="method-label">Tracking method</span>
        <div className="option-cards" role="group" aria-labelledby="method-label">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="option-card"
              aria-pressed={me.trackingMethod === m.id}
              onClick={() => setMethod(m.id)}
              disabled={busy === "method" || (m.id === "strava" && !conn && me.trackingMethod !== "strava")}
            >
              <strong>{m.title}</strong>
              <span>{m.id === "strava" && !conn ? "Connect Strava below to use this." : m.text}</span>
            </button>
          ))}
        </div>
        {me.trackingMethod !== "manual" && !conn && <span className="hint">Connect Strava below to start importing activities.</span>}
      </div>

      {connectError && (
        <div className="notice danger" style={{ marginBottom: 16 }} role="alert">
          <span aria-hidden="true">⚠️</span>
          <div className="spread" style={{ flex: 1 }}>
            <span>{connectError}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { params.delete("strava_error"); setParams(params, { replace: true }); }}>Dismiss</button>
          </div>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <Loading />}

      {data && !data.configured && (
        <div className="notice info">
          <span aria-hidden="true">🔧</span>
          <div>Strava isn't set up on this server yet. The site admin needs to add <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code>. Manual tracking works in the meantime.</div>
        </div>
      )}

      {data && data.configured && !conn && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Connect your Strava account and your runs, rides, walks and swims are imported automatically. We only ask to <strong>read</strong> your
            activities. You'll log in on Strava's own site; we never see your Strava password.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree that my Strava distance <em>totals</em> are shown to people in my races. Individual Strava activities stay private to me.</span>
          </label>
          <div>
            <button className="btn btn-strava" disabled={!consent || busy === "connect"} onClick={connect}>
              {busy === "connect" ? "Opening Strava…" : "Connect with Strava"}
            </button>
          </div>
        </div>
      )}

      {data && conn && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="spread">
            <div>
              <div className="row">
                <strong style={{ fontSize: "1.1rem" }}>{conn.athleteName ?? `Athlete ${conn.athleteId}`}</strong>
                {conn.status === "active" && !conn.lastError && <span className="badge badge-ok">Connected</span>}
                {conn.status === "active" && conn.lastError && <span className="badge badge-warn">Sync problem</span>}
                {conn.status === "needs_reauth" && <span className="badge badge-danger">Reconnect needed</span>}
              </div>
              <div className="faint">
                Last synced {timeAgo(conn.lastSyncAt)} · {conn.importedCount} activities imported ·{" "}
                {data.autoSync.webhooks ? "instant updates on" : "instant updates off"} · checks every {data.autoSync.intervalMinutes} min
              </div>
            </div>
            <div className="row">
              {conn.status === "needs_reauth"
                ? <button className="btn btn-strava btn-sm" onClick={connect} disabled={busy === "connect"}>Reconnect Strava</button>
                : <button className="btn btn-secondary btn-sm" onClick={syncNow} disabled={busy === "sync"}>{busy === "sync" ? "Syncing…" : "↻ Sync now"}</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setDisconnecting(true)}>Disconnect</button>
            </div>
          </div>

          {conn.lastError && (
            <div className="notice danger" role="alert"><span aria-hidden="true">⚠️</span><div>{conn.lastError}</div></div>
          )}
          {(conn.rateLimitedUntil || data.appRateLimitedUntil) && (
            <div className="notice"><span aria-hidden="true">⏳</span><div>Strava asked us to slow down. Syncing resumes automatically after {formatDateTime(conn.rateLimitedUntil ?? new Date(data.appRateLimitedUntil! * 1000).toISOString())}.</div></div>
          )}
          {!me.stravaShareConsent && (
            <div className="notice">
              <span aria-hidden="true">🔒</span>
              <div className="spread" style={{ flex: 1 }}>
                <span>Strava distances don't count right now because sharing totals with your races is turned off.</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setShare(true)}>Turn sharing on</button>
              </div>
            </div>
          )}
          {me.trackingMethod === "manual" && (
            <div className="notice info"><span aria-hidden="true">ℹ️</span><div>Your tracking method is <strong>Manual</strong>, so imported activities are shown but don't count. Choose Strava or Both above.</div></div>
          )}

          <div className="notice info">
            <span aria-hidden="true">🎽</span>
            <div>
              Only imported <strong>{me.sport ? sportLabel(me.sport).toLowerCase() : "race-sport"}</strong> activities dated within a race's
              start and end dates move your racer in that race. Everything else stays visible in your history. Change your sport under “Your racer” above.
            </div>
          </div>

          {data.sourceTypes.length > 0 && (
            <div>
              <h3>Sport mapping</h3>
              <p className="faint" style={{ marginTop: -4 }}>Which race sport each Strava type counts as. Change one if it lands in the wrong place.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Strava type</th><th scope="col" className="num">Activities</th><th scope="col">Counts as</th></tr></thead>
                  <tbody>
                    {data.sourceTypes.map((t) => (
                      <tr key={t.type}>
                        <td><strong>{t.type}</strong>{t.overridden && <span className="badge badge-warn" style={{ marginLeft: 6 }}>custom</span>}</td>
                        <td className="num">{t.count}</td>
                        <td>
                          <select className="input" aria-label={`Category for ${t.type}`} value={t.category} onChange={(e) => remap(t.type, e.target.value)} disabled={busy === "map"} style={{ minWidth: 180 }}>
                            {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.label}{s.id === t.defaultCategory ? " (default)" : ""}</option>)}
                            <option value={OTHER_SPORT}>Not raced{t.defaultCategory === OTHER_SPORT ? " (default)" : ""}</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <label className="checkbox">
            <input type="checkbox" checked={me.stravaShareConsent} onChange={(e) => setShare(e.target.checked)} disabled={busy === "consent"} />
            <span>Show my Strava distance totals to people in my races (needed for Strava distance to count)</span>
          </label>

          <div>
            <h3>Import history</h3>
            {data.logs.length === 0
              ? <p className="faint">No syncs yet.</p>
              : (
                <div className="table-wrap">
                  <table className="table log-table">
                    <thead><tr><th scope="col">When</th><th scope="col">Trigger</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead>
                    <tbody>
                      {data.logs.map((l) => (
                        <tr key={l.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(l.startedAt)}</td>
                          <td>{{ manual: "Sync now", initial: "First import", scheduled: "Automatic", webhook: "Strava update" }[l.trigger] ?? l.trigger}</td>
                          <td>
                            <span className={`badge ${l.status === "ok" ? "badge-ok" : l.status === "rate_limited" ? "badge-warn" : l.status === "skipped" ? "badge-off" : "badge-danger"}`}>
                              {l.status === "ok" ? "OK" : l.status === "rate_limited" ? "Paused" : l.status}
                            </span>
                          </td>
                          <td>{l.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}

      {disconnecting && (
        <ConfirmDialog
          title="Disconnect Strava?"
          confirmLabel="Disconnect"
          danger
          busy={busy === "disconnect"}
          onCancel={() => setDisconnecting(false)}
          onConfirm={() =>
            run("disconnect", async () => {
              setData(await api<StravaDetails>("/integrations/strava/disconnect", { body: { deleteImported } }));
              setMe(await api<Me>("/me"));
              notifyDataChanged();
              setDisconnecting(false);
              toast("Strava disconnected");
            })}
        >
          <p>We'll revoke Snail Race's access on Strava and forget your Strava tokens. New activities won't be imported.</p>
          <label className="checkbox">
            <input type="checkbox" checked={deleteImported} onChange={(e) => setDeleteImported(e.target.checked)} />
            <span>Also delete my {conn?.importedCount ?? 0} imported Strava activities (recommended). Manual entries are kept.</span>
          </label>
          {!deleteImported && <p className="faint">Kept activities keep counting toward your races.</p>}
        </ConfirmDialog>
      )}
      {conn && <p className="faint" style={{ marginTop: 16 }}>Connected {formatDateTime(conn.connectedAt)} · scope: {conn.scope ?? "?"}</p>}
    </section>
  );
}
