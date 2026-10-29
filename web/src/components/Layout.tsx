import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";

const LINKS = [
  { to: "/", label: "Snail Race", end: true },
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
            <img src="/favicon.svg" alt="" /> Snail Race
          </Link>
          {me && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm nav-toggle"
                aria-expanded={open}
                aria-controls="main-nav"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? "✕ Close" : "☰ Menu"}
              </button>
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
            </>
          )}
          {!me && (
            <nav className="nav nav-guest" aria-label="Account">
              <NavLink to="/login">Log in</NavLink>
              <Link to="/register" className="btn btn-primary btn-sm">Join the race</Link>
            </nav>
          )}
        </div>
      </header>
      <div id="main">
        <Outlet />
      </div>
      <footer className="footer">
        🐌 Slow and steady wins the race. · <span className="powered-strava">Compatible with Strava</span>
      </footer>
    </>
  );
}
