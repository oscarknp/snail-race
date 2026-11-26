import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { GOAL_POINTS, goalPoints, isSoloSport, MAX_SPORTS, SPORTS } from "../../../shared/sports.ts";
import { api, ApiError, type Me } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Field } from "../components/ui.tsx";
import { RacerPortrait } from "../components/Racer.tsx";

function useSubmit() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        if (!Object.keys(e.fields).length) setFormError(e.message);
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { errors, setErrors, formError, busy, run };
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <div style={{ textAlign: "center" }}>
          <RacerPortrait user={{ id: 3, name: "Pilot", photoUrl: null }} size={96} title="" />
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export function Login() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { errors, formError, busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      setMe(await api<Me>("/auth/login", { body: { email, password } }));
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    });
  };

  return (
    <AuthCard title="Welcome back" subtitle="Welcome aboard. Log in to keep flying.">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <Field label="Email" id="login-email" error={errors.email}>
          <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="login-password" error={errors.password}>
          <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <div className="spread small">
          <Link to="/forgot-password">Forgot your password?</Link>
          <Link to="/register">Create an account</Link>
        </div>
      </form>
    </AuthCard>
  );
}

export function Register() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const { errors, setErrors, formError, busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sports.length) {
      setErrors({ sports: "Pick at least one sport" });
      return;
    }
    if (password.length < 8) {
      setErrors({ password: "Password must be at least 8 characters" });
      return;
    }
    run(async () => {
      setMe(await api<Me>("/auth/register", { body: { name, email, password, sports } }));
      navigate("/profile?welcome=1", { replace: true });
    });
  };

  return (
    <AuthCard title="Join the race" subtitle="Create your pilot. You'll be on the runway in seconds.">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <Field label="Your name" id="reg-name" error={errors.name} hint="Shown next to your plane">
          <input id="reg-name" className="input" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email" id="reg-email" error={errors.email}>
          <input id="reg-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="reg-password" error={errors.password} hint="At least 8 characters">
          <input id="reg-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <SportPicker value={sports} onChange={setSports} error={sportsError(errors)} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Preparing your plane…" : "Get my wings"}</button>
        <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
          Already racing? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { errors, formError, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/auth/forgot", { body: { email } });
      setSent(true);
    });
  };
  return (
    <AuthCard title="Forgot your password?" subtitle="It happens to the best of pilots.">
      {sent
        ? (
          <div className="notice ok" role="status">
            <div>If an account exists for <strong>{email}</strong>, we've sent a reset link. It works for one hour.</div>
          </div>
        )
        : (
          <form className="form" onSubmit={submit} noValidate>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <Field label="Email" id="forgot-email" error={errors.email}>
              <input id="forgot-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
      <p className="small" style={{ textAlign: "center", marginTop: 16 }}><Link to="/login">Back to log in</Link></p>
    </AuthCard>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { errors, setErrors, formError, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setErrors({ confirm: "Passwords don't match" });
      return;
    }
    run(async () => {
      setMe(await api<Me>("/auth/reset", { body: { token, password } }));
      navigate("/", { replace: true });
    });
  };
  if (!token) {
    return (
      <AuthCard title="Reset link missing" subtitle="Open the link from your email, or request a new one.">
        <Link className="btn btn-primary btn-block" to="/forgot-password">Request a new link</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="Make it a good one. Pilots never forget a checklist.">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <div className="form-error" role="alert">{formError} <Link to="/forgot-password">Request a new link</Link></div>}
        <Field label="New password" id="reset-password" error={errors.password} hint="At least 8 characters">
          <input id="reset-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Confirm password" id="reset-confirm" error={errors.confirm}>
          <input id="reset-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
    </AuthCard>
  );
}

/** Server errors for the sports list may be keyed "sports" or "sports.0". */
export function sportsError(errors: Record<string, string>): string | undefined {
  return Object.entries(errors).find(([k]) => k === "sports" || k.startsWith("sports."))?.[1];
}

/**
 * Pick 1-3 race sports, or a solo sport (walking) on its own. Each shows its points per km;
 * the goal depends on the choice. Picking a solo sport replaces the others, and vice versa.
 */
export function SportPicker({ value, onChange, error }: { value: string[]; onChange: (sports: string[]) => void; error?: string }) {
  const goal = goalPoints(value);
  const solo = value.some(isSoloSport);
  const full = !solo && value.length >= MAX_SPORTS;
  const combinable = SPORTS.filter((s) => s.soloGoal === null);
  const soloSports = SPORTS.filter((s) => s.soloGoal !== null);

  function pick(id: string) {
    const on = value.includes(id);
    if (on) return onChange(value.filter((x) => x !== id));
    if (isSoloSport(id) || solo) return onChange([id]);
    onChange([...value, id]);
  }

  const option = (s: (typeof SPORTS)[number]) => {
    const on = value.includes(s.id);
    return (
      <button
        key={s.id}
        type="button"
        aria-pressed={on}
        disabled={!on && full && s.soloGoal === null}
        className={`option-card sport-option${s.soloGoal !== null ? " solo" : ""}`}
        onClick={() => pick(s.id)}
      >
        <span className="sport-emoji" aria-hidden="true">{s.emoji}</span>
        <strong>{s.label}</strong>
        <span>
          {s.pointsPerKm} {s.pointsPerKm === 1 ? "point" : "points"} per km
          {s.soloGoal !== null && ` · on its own, goal ${s.soloGoal} points`}
        </span>
      </button>
    );
  };

  return (
    <div className="field">
      <span className="label" id="sport-picker-label">Your race sports (pick 1 to {MAX_SPORTS}, or walking on its own)</span>
      <div className="sport-picker" role="group" aria-labelledby="sport-picker-label">
        {combinable.map(option)}
        {soloSports.map(option)}
      </div>
      {error
        ? <span className="error" role="alert">{error}</span>
        : (
          <span className="hint">
            {goal
              ? (
                <>
                  Your goal: <strong>{goal.toLocaleString()} points</strong>
                  {solo ? " (walking can't be combined with other sports)" : full ? ` (that's the maximum of ${MAX_SPORTS} sports)` : ""}
                </>
              )
              : `Goal: ${GOAL_POINTS[1]} points with 1 sport, ${GOAL_POINTS[2]} with 2, ${GOAL_POINTS[3]} with 3. Walking (solo): ${soloSports[0]?.soloGoal} points.`}
          </span>
        )}
    </div>
  );
}
