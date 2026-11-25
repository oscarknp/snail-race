import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { useTheme } from "../lib/theme.tsx";

const LINKS = [
  { to: "/", label: "Sky Race", end: true },
  { to: "/dashboard", label: "My Dashboard" },
  { to: "/activities", label: "Activities" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/races", label: "Races" },
  { to: "/profile", label: "My Profile" },
];

export function Layout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" /> Sky Race
          </Link>
          {me && (
            <>
              <nav id="main-nav" className={`nav${open ? " open" : ""}`} aria-label="Main">
                {LINKS.map((l) => (
                  <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
                ))}
                <button
                  type="button"
                  className="linklike"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  Logout
                </button>
              </nav>
              <div className="header-actions push">
                <ThemeToggle />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm nav-toggle"
                  aria-expanded={open}
                  aria-controls="main-nav"
                  onClick={() => setOpen((o) => !o)}
                >
                  {open ? "✕ Close" : "☰ Menu"}
                </button>
              </div>
            </>
          )}
          {!me && (
            <nav className="nav nav-guest" aria-label="Account">
              <NavLink to="/login">Log in</NavLink>
              <Link to="/register" className="btn btn-primary btn-sm">Join the race</Link>
            </nav>
          )}
          {!me && (
            <div className="header-actions">
              <ThemeToggle />
            </div>
          )}
        </div>
      </header>
      <div id="main">
        <Outlet />
      </div>
      <footer className="footer">
        ✈️ Blue skies and tailwinds. · <span className="powered-strava">Compatible with Strava</span>
      </footer>
    </>
  );
}

/** One-click switch between light and dark. "Auto" (follow the device) lives in the profile. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" className="btn btn-ghost btn-sm theme-toggle" onClick={toggle} aria-label={label} title={label}>
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
