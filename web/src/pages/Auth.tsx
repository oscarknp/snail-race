import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SPORTS } from "../../../shared/sports.ts";
import { api, ApiError, type Me } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Field } from "../components/ui.tsx";
import { SnailPortrait } from "../components/Snail.tsx";

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
          <SnailPortrait user={{ id: 3, name: "Snail", photoUrl: null }} size={96} title="" />
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
    <AuthCard title="Welcome back" subtitle="Your snail missed you. Log in to keep racing.">
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
  const [sport, setSport] = useState("");
  const { errors, setErrors, formError, busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sport) {
      setErrors({ sport: "Pick the sport you'll race in" });
      return;
    }
    if (password.length < 8) {
      setErrors({ password: "Password must be at least 8 characters" });
      return;
    }
    run(async () => {
      setMe(await api<Me>("/auth/register", { body: { name, email, password, sport } }));
      navigate("/profile?welcome=1", { replace: true });
    });
  };

  return (
    <AuthCard title="Join the race" subtitle="Create your racer. You'll be on the starting line in seconds.">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <Field label="Your name" id="reg-name" error={errors.name} hint="Shown next to your snail">
          <input id="reg-name" className="input" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email" id="reg-email" error={errors.email}>
          <input id="reg-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="reg-password" error={errors.password} hint="At least 8 characters">
          <input id="reg-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <SportPicker value={sport} onChange={setSport} error={errors.sport} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Hatching your snail…" : "Create my snail"}</button>
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
    <AuthCard title="Forgot your password?" subtitle="It happens to the best of snails.">
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
    <AuthCard title="Choose a new password" subtitle="Make it a good one. Snails never forget.">
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

/** The four race sports as big buttons, each showing its fixed distance goal. */
export function SportPicker({ value, onChange, error }: { value: string; onChange: (sport: string) => void; error?: string }) {
  return (
    <div className="field">
      <span className="label" id="sport-picker-label">Your race sport</span>
      <div className="sport-picker" role="radiogroup" aria-labelledby="sport-picker-label">
        {SPORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={value === s.id}
            className="option-card sport-option"
            onClick={() => onChange(s.id)}
          >
            <span className="sport-emoji" aria-hidden="true">{s.emoji}</span>
            <strong>{s.label}</strong>
            <span>{s.targetKm} km goal</span>
          </button>
        ))}
      </div>
      {error ? <span className="error" role="alert">{error}</span> : <span className="hint">The goal is fixed per sport. Everyone races to 100% of theirs.</span>}
    </div>
  );
}
