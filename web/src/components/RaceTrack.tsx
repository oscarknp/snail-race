import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Race, Standing } from "../lib/api.ts";
import { formatPoints, sportEmoji } from "../../../shared/sports.ts";
import type { Unit } from "../../../shared/units.ts";
import { dist, formatDate, ordinal, pct, racerColors } from "../lib/format.ts";
import { useElementWidth, usePrefersReducedMotion } from "../lib/hooks.ts";
import { type Theme, useTheme } from "../lib/theme.tsx";
import { RacerShape, TOKEN } from "./Racer.tsx";
import { Avatar } from "./ui.tsx";

// Two hand-drawn flight routes: a wide loop for desktops, a switchback for phones.
const LAYOUTS = {
  wide: {
    w: 1000,
    h: 560,
    trackW: 66,
    scale: 0.72,
    d: "M 70 478 C 260 512, 470 446, 700 476 S 930 478, 925 400 S 860 318, 760 322 C 600 330, 470 292, 300 326 S 70 330, 78 248 S 160 160, 290 170 C 480 186, 640 128, 930 140",
  },
  tall: {
    w: 400,
    h: 920,
    trackW: 58,
    scale: 0.62,
    d: "M 60 860 L 280 860 C 370 860 370 720 280 720 L 120 720 C 30 720 30 580 120 580 L 280 580 C 370 580 370 440 280 440 L 120 440 C 30 440 30 300 120 300 L 280 300 C 370 300 370 160 280 160 L 90 160",
  },
} as const;

type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

/** Day and night colours for the sky scene. */
const SKY = {
  light: {
    stops: ["#79bff5", "#b5dcfb", "#e4f3ff"],
    glow: "#fff3c4",
    cloud: "#ffffff",
    cloudOpacity: 0.92,
    bird: "#2d4a66",
    corridor: "#ffffff",
    corridorOpacity: [0.28, 0.35],
    route: "#0d2b4c",
    routeOpacity: 0.55,
    waypoint: { fill: "#ffffff", stroke: "#0d2b4c" },
    label: { bg: "#ffffff", stroke: "#c3d3e3", text: "#10243b" },
    leaderLabel: "#0d2b4c",
  },
  dark: {
    stops: ["#050f24", "#0d2649", "#1a4170"],
    glow: "#dbe6ff",
    cloud: "#a9bdd6",
    cloudOpacity: 0.2,
    bird: "#a9bdd6",
    corridor: "#9fc3ff",
    corridorOpacity: [0.08, 0.12],
    route: "#cfe3ff",
    routeOpacity: 0.6,
    waypoint: { fill: "#102036", stroke: "#cfe3ff" },
    label: { bg: "#102036", stroke: "#2c4a70", text: "#e6eef7" },
    leaderLabel: "#2d6cb8",
  },
} satisfies Record<Theme, unknown>;

interface Pt {
  x: number;
  y: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Animate each racer's displayed progress toward its real value. */
function useAnimatedProgress(standings: Standing[]) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<Record<number, number>>({});
  const [moving, setMoving] = useState<Set<number>>(new Set());
  const shownRef = useRef<Record<number, number>>({});
  const key = standings.map((s) => `${s.user.id}:${s.progress.toFixed(5)}`).join("|");

  useEffect(() => {
    const from = { ...shownRef.current };
    const to: Record<number, number> = {};
    for (const s of standings) to[s.user.id] = s.progress;
    const movers = new Set(standings.filter((s) => Math.abs((from[s.user.id] ?? 0) - s.progress) > 0.0005).map((s) => s.user.id));
    if (reduced || movers.size === 0) {
      shownRef.current = to;
      setShown(to);
      setMoving(new Set());
      return;
    }
    const duration = 1500;
    const start = performance.now();
    let raf = 0;
    setMoving(movers);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      const next: Record<number, number> = {};
      for (const id of Object.keys(to).map(Number)) {
        const a = from[id] ?? 0;
        next[id] = a + (to[id] - a) * e;
      }
      shownRef.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setMoving(new Set());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced]);

  return { shown, moving };
}

/** Points toward the racer's own goal, in words. */
function goalText(s: Standing): string {
  if (!s.goalPoints) return "hasn't picked a sport yet";
  return `${formatPoints(s.points)} of ${s.goalPoints.toLocaleString()}`;
}

/** Distance per sport, e.g. "🚴 300 km · 🏃 20 km". */
function sportBreakdown(s: Standing, unit: Unit): string {
  return s.bySport.map((b) => `${sportEmoji(b.sport)} ${dist(b.distanceM, unit)}`).join(" · ");
}

export const sportIcons = (sports: readonly string[]) => sports.map(sportEmoji).join("");

/**
 * The race track. Everyone races to 100% of their own sport's goal, so a racer's position
 * is their share of that goal, not raw distance. `unit` is the viewer's display unit.
 */
export function RaceTrack({ race, standings, meId, unit }: { race: Race; standings: Standing[]; meId: number; unit: Unit }) {
  const { ref: wrapRef, width } = useElementWidth<HTMLDivElement>();
  const layout: Layout = width && width < 640 ? LAYOUTS.tall : LAYOUTS.wide;
  const pathRef = useRef<SVGPathElement>(null);
  const [geom, setGeom] = useState<{ len: number; d: string } | null>(null);
  const { shown, moving } = useAnimatedProgress(standings);
  const [focusId, setFocusId] = useState<number | null>(null);
  const { theme } = useTheme();
  const sky = SKY[theme];

  useLayoutEffect(() => {
    if (pathRef.current) setGeom({ len: pathRef.current.getTotalLength(), d: layout.d });
  }, [layout.d]);

  const ready = geom && geom.d === layout.d && pathRef.current;
  const pointAt = (p: number): Pt => {
    const el = pathRef.current!;
    const pt = el.getPointAtLength(Math.max(0, Math.min(1, p)) * geom!.len);
    return { x: pt.x, y: pt.y };
  };
  const tangentAt = (p: number): Pt => {
    const a = pointAt(Math.max(0, p - 0.003));
    const b = pointAt(Math.min(1, p + 0.003));
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };

  // Sky decorations: clouds may drift behind the route; birds and balloons keep clear of it.
  const decor = useMemo(() => {
    if (!ready) return [];
    const samples: Pt[] = [];
    for (let i = 0; i <= 240; i++) samples.push(pointAt(i / 240));
    const rand = mulberry32(layout.w * 7 + layout.h);
    const items: { x: number; y: number; kind: Decor; s: number }[] = [];
    const wide = layout === LAYOUTS.wide;
    const want: [Decor, number, number][] = [["cloud", wide ? 11 : 8, 0], ["bird", wide ? 7 : 5, 0.9], ["balloon", wide ? 2 : 1, 1.1]];
    for (const [kind, count, clearance] of want) {
      let placed = 0;
      let attempts = 0;
      while (placed < count && attempts++ < 2000) {
        const x = 20 + rand() * (layout.w - 40);
        // Balloons hang below their anchor point, so keep them away from the top edge.
        const top = kind === "balloon" ? 60 : 20;
        const y = top + rand() * (layout.h - top - 20);
        const clear = !clearance || samples.every((p) => Math.hypot(p.x - x, p.y - y) > layout.trackW * clearance);
        const spaced = items.every((it) => Math.hypot(it.x - x, it.y - y) > (kind === "cloud" ? 90 : 40));
        if (clear && spaced) {
          items.push({ x, y, kind, s: kind === "cloud" ? 0.7 + rand() * 0.9 : 0.8 + rand() * 0.4 });
          placed++;
        }
      }
    }
    return items;
  }, [ready, layout]);

  const stars = useMemo(() => {
    const rand = mulberry32(layout.w + layout.h * 3);
    return Array.from({ length: layout === LAYOUTS.wide ? 70 : 55 }, () => ({
      x: rand() * layout.w,
      y: rand() * layout.h * 0.85,
      r: 0.6 + rand() * 1.3,
      o: 0.35 + rand() * 0.6,
    }));
  }, [layout]);

  const markerLabel = (f: number) => `${Math.round(f * 100)}%`;

  // Place racers: rank order decides lanes so close racers don't stack exactly.
  const placed = useMemo(() => {
    if (!ready) return [];
    const n = standings.length;
    const maxOffset = layout.trackW * 0.3;
    const spacing = n > 1 ? Math.min(13, (2 * maxOffset) / (n - 1)) : 0;
    return standings.map((s, i) => {
      const p = shown[s.user.id] ?? 0;
      const pt = pointAt(p);
      const t = tangentAt(p);
      const lane = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      const off = Math.max(-maxOffset, Math.min(maxOffset, lane * spacing));
      const x = pt.x - t.y * off;
      const y = pt.y + t.x * off + layout.trackW * 0.22;
      const flip = t.x < -0.2;
      // Planes pitch with the route.
      const tilt = Math.max(-24, Math.min(24, (Math.atan2(t.y, Math.abs(t.x)) * 180) / Math.PI)) * (flip ? -1 : 1);
      return { s, x, y, flip, tilt: Math.abs(t.x) < 0.3 ? 0 : tilt };
    });
  }, [ready, shown, standings, layout]);

  // Labels: me, leader and the focused racer first; skip ones that would collide.
  const labels = useMemo(() => {
    const prio = (id: number, rank: number) => (id === focusId ? 0 : id === meId ? 1 : rank === 1 ? 2 : 3 + rank);
    const order = [...placed].sort((a, b) => prio(a.s.user.id, a.s.rank) - prio(b.s.user.id, b.s.rank));
    const boxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
    const out = new Map<number, number>();
    const h = 22;
    for (const p of order) {
      const name = p.s.user.name.length > 14 ? p.s.user.name.slice(0, 13) + "…" : p.s.user.name;
      const w = (name.length + 10) * 7.2 + 16;
      for (let tier = 0; tier < 3; tier++) {
        const y = p.y - 62 * layout.scale - 8 - tier * (h + 4);
        const box = { x1: p.x - w / 2, x2: p.x + w / 2, y1: y - h, y2: y };
        if (!boxes.some((b) => b.x1 < box.x2 && box.x1 < b.x2 && b.y1 < box.y2 && box.y1 < b.y2)) {
          boxes.push(box);
          out.set(p.s.user.id, tier);
          break;
        }
      }
    }
    return out;
  }, [placed, focusId, meId, layout]);

  const leader = standings[0];
  const focused = placed.find((p) => p.s.user.id === focusId);
  const scale = width ? width / layout.w : 1;
  const start = ready ? pointAt(0) : null;
  const startT = ready ? tangentAt(0) : null;
  const finish = ready ? pointAt(1) : null;
  const finishT = ready ? tangentAt(1) : null;
  const myProgress = shown[meId];
  const summary = standings.length
    ? `Race track. ${standings.map((s) => `${s.user.name} ${ordinal(s.rank)} at ${pct(s.progress)} of their goal`).join(", ")}.`
    : "Race track with no racers yet.";

  return (
    <div className="track-wrap" ref={wrapRef} onMouseLeave={() => setFocusId(null)}>
      <svg className="track-svg" viewBox={`0 0 ${layout.w} ${layout.h}`} role="img" aria-label={summary}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky.stops[0]} />
            <stop offset="0.55" stopColor={sky.stops[1]} />
            <stop offset="1" stopColor={sky.stops[2]} />
          </linearGradient>
          <radialGradient id="sun" cx="0.08" cy="0.02" r="0.6">
            <stop offset="0" stopColor={sky.glow} stopOpacity={theme === "dark" ? 0.35 : 0.9} />
            <stop offset="0.25" stopColor={sky.glow} stopOpacity={theme === "dark" ? 0.12 : 0.35} />
            <stop offset="1" stopColor={sky.glow} stopOpacity="0" />
          </radialGradient>
          <pattern id="checker" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#fff" />
            <rect width="4" height="4" fill="#0d2b4c" />
            <rect x="4" y="4" width="4" height="4" fill="#0d2b4c" />
          </pattern>
        </defs>
        <rect width={layout.w} height={layout.h} fill="url(#sky)" />
        <rect width={layout.w} height={layout.h} fill="url(#sun)" />
        {theme === "dark" && (
          <g aria-hidden="true">
            {stars.map((st, i) => <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#ffffff" opacity={st.o} />)}
            <mask id="crescent">
              <circle cx="64" cy="52" r="20" fill="#fff" />
              <circle cx="73" cy="46" r="17" fill="#000" />
            </mask>
            <circle cx="64" cy="52" r="20" fill="#f1f4ff" mask="url(#crescent)" />
          </g>
        )}

        {decor.filter((d) => d.kind === "cloud").map((d, i) => <Decoration key={`c${i}`} {...d} sky={sky} />)}

        {/* Flight route: a soft corridor with a dotted line, like an airline route map */}
        <path d={layout.d} fill="none" stroke={sky.corridor} strokeWidth={layout.trackW} strokeLinecap="round" strokeLinejoin="round" opacity={sky.corridorOpacity[0]} />
        <path ref={pathRef} d={layout.d} fill="none" stroke={sky.corridor} strokeWidth={layout.trackW * 0.45} strokeLinecap="round" strokeLinejoin="round" opacity={sky.corridorOpacity[1]} />
        <path d={layout.d} fill="none" stroke={sky.route} strokeWidth="3" strokeDasharray="1 11" strokeLinecap="round" opacity={sky.routeOpacity} />

        {decor.filter((d) => d.kind !== "cloud").map((d, i) => <Decoration key={`d${i}`} {...d} sky={sky} />)}

        {/* Contrail behind the viewer's plane */}
        {ready && myProgress !== undefined && myProgress > 0 && (
          <g fill="none" strokeLinecap="round" strokeDasharray={`${myProgress * geom!.len} ${geom!.len}`}>
            <path d={layout.d} stroke="#ffffff" strokeWidth="9" opacity="0.9" />
            <path d={layout.d} stroke={racerColors(meId).fill} strokeWidth="3" opacity="0.9" />
          </g>
        )}

        {/* Waypoints at 25 / 50 / 75 % */}
        {ready && [0.25, 0.5, 0.75].map((f) => {
          const pt = pointAt(f);
          const t = tangentAt(f);
          const ox = -t.y * (layout.trackW / 2 + 18);
          const oy = t.x * (layout.trackW / 2 + 18);
          const side = oy > 0 ? -1 : 1;
          return (
            <g key={f}>
              <path d={`M${pt.x},${pt.y - 7} L${pt.x + 6.5},${pt.y + 4.5} L${pt.x - 6.5},${pt.y + 4.5} Z`} fill={sky.waypoint.fill} stroke={sky.waypoint.stroke} strokeWidth="2" strokeLinejoin="round" />
              <g transform={`translate(${pt.x + ox * side} ${pt.y + oy * side})`}>
                <rect x="-26" y="-11" width="52" height="22" rx="4" fill="#0d2b4c" />
                <text y="5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#ffd166" fontFamily="'Barlow Condensed', sans-serif" letterSpacing="0.5">
                  {markerLabel(f)}
                </text>
              </g>
            </g>
          );
        })}

        {/* Takeoff runway */}
        {start && startT && (
          <g transform={`translate(${start.x} ${start.y}) rotate(${(Math.atan2(startT.y, startT.x) * 180) / Math.PI})`}>
            <Runway width={layout.trackW * 0.62} />
            <g transform={`rotate(${-(Math.atan2(startT.y, startT.x) * 180) / Math.PI})`}>
              {(() => {
                const below = start.y + layout.trackW / 2 + 40 < layout.h;
                const y = below ? layout.trackW / 2 + 8 : -layout.trackW / 2 - 32;
                return (
                  <>
                    <rect x="-38" y={y} width="76" height="24" rx="4" fill="#0d2b4c" />
                    <text x="0" y={y + 17} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700" fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">✈ TAKEOFF</text>
                  </>
                );
              })()}
            </g>
          </g>
        )}

        {/* Landing runway, control tower and windsock */}
        {finish && finishT && (
          <g>
            <g transform={`translate(${finish.x} ${finish.y}) rotate(${(Math.atan2(finishT.y, finishT.x) * 180) / Math.PI})`}>
              <Runway width={layout.trackW * 0.62} finish />
            </g>
            <g transform={`translate(${finish.x + (layout === LAYOUTS.wide ? -34 : 34)} ${finish.y - layout.trackW / 2 - 4})`}>
              <Tower />
              <g transform={`translate(${layout === LAYOUTS.wide ? -26 : 22} 0)`}>
                <Windsock />
              </g>
              <rect x="-36" y="-100" width="72" height="22" rx="4" fill="#cf4313" />
              <text y="-84" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700" fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">FINISH</text>
            </g>
          </g>
        )}

        {/* Racers, back to front */}
        {[...placed].sort((a, b) => a.y - b.y).map(({ s, x, y, flip, tilt }) => {
          const me = s.user.id === meId;
          const isLeader = s.rank === 1 && s.points > 0;
          const photo = Boolean(s.user.photoUrl);
          return (
            <g
              key={s.user.id}
              className="racer-g"
              transform={`translate(${x} ${y})`}
              tabIndex={0}
              role="button"
              aria-label={`${s.user.name}${me ? " (you)" : ""}: ${ordinal(s.rank)} place, ${pct(s.progress)} of goal, ${goalText(s)} points`}
              onMouseEnter={() => setFocusId(s.user.id)}
              onFocus={() => setFocusId(s.user.id)}
              onBlur={() => setFocusId(null)}
              onClick={() => setFocusId(focusId === s.user.id ? null : s.user.id)}
            >
              {/* Planes turn to face the way they fly; photos always stay upright and unmirrored. */}
              <g transform={photo ? `scale(${layout.scale})` : `rotate(${tilt}) scale(${(flip ? -1 : 1) * layout.scale} ${layout.scale})`}>
                <RacerShape user={s.user} leader={isLeader} moving={moving.has(s.user.id)} />
              </g>
              {me && (
                <circle
                  cx="0"
                  cy={(photo ? TOKEN.cy : -22) * layout.scale}
                  r={(photo ? TOKEN.r + 5 : 34) * layout.scale}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeDasharray="5 5"
                  opacity="0.9"
                />
              )}
            </g>
          );
        })}

        {/* Name tags on top of everything */}
        {placed.map(({ s, x, y }) => {
          const tier = labels.get(s.user.id);
          if (tier === undefined) return null;
          const me = s.user.id === meId;
          const name = s.user.name.length > 14 ? s.user.name.slice(0, 13) + "…" : s.user.name;
          const text = `${sportIcons(s.user.sports)} ${name} · ${pct(s.progress)}`;
          const w = text.length * 7.2 + 16;
          const ly = y - 62 * layout.scale - 8 - tier * 26;
          return (
            <g key={s.user.id} transform={`translate(${x} ${ly})`} className="racer-label" aria-hidden="true">
              {tier > 0 && <line x1="0" y1="0" x2="0" y2={tier * 26} stroke={sky.label.text} strokeWidth="1.5" opacity="0.4" />}
              <rect x={-w / 2} y="-22" width={w} height="22" rx="6" fill={me ? "#cf4313" : s.rank === 1 ? sky.leaderLabel : sky.label.bg} stroke={me || s.rank === 1 ? "none" : sky.label.stroke} />
              <text y="-6.5" textAnchor="middle" fontSize="12.5" fill={me || s.rank === 1 ? "#fff" : sky.label.text}>{text}</text>
            </g>
          );
        })}
      </svg>

      {standings.length === 0 && (
        <div className="track-empty"><div>No pilots on the route yet. Invite some friends! ✈️</div></div>
      )}
      {race.status === "upcoming" && standings.length > 0 && (
        <div className="track-empty"><div>Departure on {formatDate(race.startDate)}. Pilots are running their pre-flight checks…</div></div>
      )}

      {focused && width > 0 && (
        <div className="racer-tip" style={{ left: Math.min(Math.max(focused.x * scale, 100), width - 100), top: (focused.y - 50 * layout.scale) * scale }}>
          <strong>{focused.s.user.name}{focused.s.user.id === meId ? " (you)" : ""}</strong>
          <div>{ordinal(focused.s.rank)} place · {pct(focused.s.progress, 1)} of goal</div>
          <div>{goalText(focused.s)}</div>
          {focused.s.bySport.length > 0 && <div className="faint">{sportBreakdown(focused.s, unit)}</div>}
          <div className="faint">
            {focused.s.finishedOn
              ? `Finished ${formatDate(focused.s.finishedOn)} 🎉`
              : focused.s.remainingPoints !== null && `${formatPoints(focused.s.remainingPoints)} to go`}
          </div>
        </div>
      )}
      {leader && <span className="sr-only">Leader: {leader.user.name}</span>}
    </div>
  );
}

type Decor = "cloud" | "bird" | "balloon";

function Decoration({ x, y, kind, s, sky }: { x: number; y: number; kind: Decor; s: number; sky: (typeof SKY)[Theme] }) {
  const t = `translate(${x} ${y}) scale(${s})`;
  if (kind === "cloud") {
    return (
      <g transform={t} fill={sky.cloud} opacity={sky.cloudOpacity}>
        <ellipse cx="0" cy="0" rx="34" ry="11" />
        <circle cx="-14" cy="-6" r="12" />
        <circle cx="4" cy="-12" r="16" />
        <circle cx="20" cy="-4" r="11" />
      </g>
    );
  }
  if (kind === "bird") {
    return (
      <g transform={t} className="bob">
        <path d="M-9 0 Q-4.5 -6 0 0 Q4.5 -6 9 0" fill="none" stroke={sky.bird} strokeWidth="2.2" strokeLinecap="round" />
      </g>
    );
  }
  // hot-air balloon
  return (
    <g transform={t} className="bob">
      <path d="M0 -36 C-17 -36 -20 -18 -12 -8 L-5 2 L5 2 L12 -8 C20 -18 17 -36 0 -36 Z" fill="#ffc23d" stroke="#a8730a" strokeWidth="1.5" />
      <path d="M0 -36 C-6 -30 -7 -14 -4 2 M0 -36 C6 -30 7 -14 4 2" fill="none" stroke="#cf4313" strokeWidth="3" />
      <path d="M-5 2 L-4 8 M5 2 L4 8" stroke="#7a5a2b" strokeWidth="1.2" />
      <rect x="-5" y="8" width="10" height="7" rx="1.5" fill="#a0703c" />
    </g>
  );
}

/** A short runway drawn along the route: asphalt, centreline and threshold bars. */
function Runway({ width, finish = false }: { width: number; finish?: boolean }) {
  const len = 84;
  return (
    <g>
      <rect x={-len / 2} y={-width / 2} width={len} height={width} rx="3" fill="#4a5564" />
      <line x1={-len / 2 + 14} y1="0" x2={len / 2 - 14} y2="0" stroke="#fff" strokeWidth="2" strokeDasharray="7 6" />
      {[-0.32, -0.16, 0.16, 0.32].map((f) => (
        <rect key={f} x={-len / 2 + 3} y={f * width - 1.5} width="8" height="3" fill="#fff" />
      ))}
      {finish && <rect x={len / 2 - 12} y={-width / 2} width="10" height={width} fill="url(#checker)" />}
    </g>
  );
}

function Tower() {
  return (
    <g>
      <rect x="-5" y="-46" width="10" height="46" fill="#e9eef4" stroke="#7d91a8" strokeWidth="1.5" />
      <path d="M-15 -46 L15 -46 L11 -61 L-11 -61 Z" fill="#6cc4ff" stroke="#0d2b4c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M-5 -49 L-4 -58 M2 -49 L2 -58" stroke="#fff" strokeWidth="1.5" opacity="0.8" />
      <rect x="-13" y="-65" width="26" height="4" rx="1" fill="#0d2b4c" />
      <line x1="0" y1="-65" x2="0" y2="-74" stroke="#0d2b4c" strokeWidth="1.5" />
      <circle className="beacon" cx="0" cy="-75" r="2.5" fill="#ff4b3e" />
    </g>
  );
}

function Windsock() {
  return (
    <g>
      <line x1="0" y1="0" x2="0" y2="-40" stroke="#7d91a8" strokeWidth="2" />
      <g className="flag">
        <path d="M0 -41 L9 -40 L9 -32 L0 -31 Z" fill="#cf4313" />
        <path d="M9 -40 L18 -39 L18 -33 L9 -32 Z" fill="#fff" />
        <path d="M18 -39 L26 -38 L26 -34 L18 -33 Z" fill="#cf4313" />
      </g>
    </g>
  );
}

/** Compact standings list shown under the track. */
export function StandingsList({ standings, meId, unit }: { standings: Standing[]; meId: number; unit: Unit }) {
  if (!standings.length) return null;
  return (
    <div className="standings">
      {standings.map((s) => (
        <div key={s.user.id} className={`standing-row${s.user.id === meId ? " me" : ""}`}>
          <div className={`rank r${s.rank}`}>{s.rank <= 3 && s.points > 0 ? ["🥇", "🥈", "🥉"][s.rank - 1] : s.rank}</div>
          <Avatar user={s.user} />
          <div style={{ minWidth: 0 }}>
            <div className="name">
              <span aria-hidden="true">{sportIcons(s.user.sports)} </span>
              <Link to={`/people/${s.user.id}`} style={{ color: "inherit", textDecoration: "none" }}>{s.user.name}</Link>
              {s.user.id === meId && <span className="badge badge-warn" style={{ marginLeft: 6 }}>You</span>}
            </div>
            <div className="progress bar" aria-hidden="true"><span style={{ width: `${s.progress * 100}%` }} /></div>
          </div>
          <div className="right">
            <strong>{pct(s.progress)}</strong>
            <div className="faint" title={sportBreakdown(s, unit)}>{s.finishedOn ? "Finished! 🏁" : `${goalText(s)} pts`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
