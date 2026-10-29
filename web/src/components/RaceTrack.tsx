import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Race, Standing } from "../lib/api.ts";
import { sportEmoji, sportLabel } from "../../../shared/sports.ts";
import type { Unit } from "../../../shared/units.ts";
import { dist, formatDate, ordinal, pct, shellColors } from "../lib/format.ts";
import { useElementWidth, usePrefersReducedMotion } from "../lib/hooks.ts";
import { SnailShape, TOKEN } from "./Snail.tsx";
import { Avatar } from "./ui.tsx";

// Two hand-drawn courses: a wide garden loop for desktops, a switchback for phones.
const LAYOUTS = {
  wide: {
    w: 1000,
    h: 560,
    trackW: 66,
    snail: 0.72,
    d: "M 70 478 C 260 512, 470 446, 700 476 S 930 478, 925 400 S 860 318, 760 322 C 600 330, 470 292, 300 326 S 70 330, 78 248 S 160 160, 290 170 C 480 186, 640 128, 930 140",
  },
  tall: {
    w: 400,
    h: 920,
    trackW: 58,
    snail: 0.62,
    d: "M 60 860 L 280 860 C 370 860 370 720 280 720 L 120 720 C 30 720 30 580 120 580 L 280 580 C 370 580 370 440 280 440 L 120 440 C 30 440 30 300 120 300 L 280 300 C 370 300 370 160 280 160 L 90 160",
  },
} as const;

type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

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

/** How far along their own sport goal a racer is, in words. */
function goalText(s: Standing, unit: Unit): string {
  if (!s.goalM) return "hasn't picked a sport yet";
  return `${dist(s.distanceM, unit)} of ${dist(s.goalM, unit, 0)} ${sportLabel(s.user.sport).toLowerCase()}`;
}

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

  // Scatter garden decorations away from the track.
  const decor = useMemo(() => {
    if (!ready) return [];
    const samples: Pt[] = [];
    for (let i = 0; i <= 240; i++) samples.push(pointAt(i / 240));
    const rand = mulberry32(layout.w * 7 + layout.h);
    const items: { x: number; y: number; kind: number; s: number }[] = [];
    let attempts = 0;
    const target = layout === LAYOUTS.wide ? 46 : 34;
    while (items.length < target && attempts++ < 3000) {
      const x = 15 + rand() * (layout.w - 30);
      const y = 15 + rand() * (layout.h - 30);
      const clear = samples.every((s) => Math.hypot(s.x - x, s.y - y) > layout.trackW * 0.95);
      const spaced = items.every((it) => Math.hypot(it.x - x, it.y - y) > 34);
      if (clear && spaced) items.push({ x, y, kind: Math.floor(rand() * 6), s: 0.8 + rand() * 0.5 });
    }
    return items;
  }, [ready, layout]);

  const markerLabel = (f: number) => `${Math.round(f * 100)}%`;

  // Place snails: rank order decides lanes so close racers don't stack exactly.
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
      const tilt = Math.max(-18, Math.min(18, (Math.atan2(t.y, Math.abs(t.x)) * 180) / Math.PI)) * (flip ? -1 : 1);
      return { s, x, y, flip, tilt: Math.abs(t.x) < 0.3 ? 0 : tilt };
    });
  }, [ready, shown, standings, layout]);

  // Labels: me, leader and the focused snail first; skip ones that would collide.
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
        const y = p.y - 62 * layout.snail - 8 - tier * (h + 4);
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
          <pattern id="grass" width="40" height="40" patternUnits="userSpaceOnUse">
            <rect width="40" height="40" fill="#86cf60" />
            <path d="M6 30 l2 -7 l2 7 M24 14 l2 -6 l2 6 M30 36 l1.5 -5 l1.5 5" stroke="#6fbb4b" strokeWidth="2" fill="none" strokeLinecap="round" />
          </pattern>
          <pattern id="checker" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#fff" />
            <rect width="6" height="6" fill="#1f2d1b" />
            <rect x="6" y="6" width="6" height="6" fill="#1f2d1b" />
          </pattern>
          <radialGradient id="sunlight" cx="0.15" cy="0" r="0.9">
            <stop offset="0" stopColor="#fff6c4" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff6c4" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={layout.w} height={layout.h} fill="url(#grass)" />
        <rect width={layout.w} height={layout.h} fill="url(#sunlight)" />

        {decor.map((d, i) => <Decoration key={i} {...d} />)}

        {/* Track */}
        <path d={layout.d} fill="none" stroke="#8a6238" strokeWidth={layout.trackW + 10} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <path ref={pathRef} d={layout.d} fill="none" stroke="#e3c59a" strokeWidth={layout.trackW} strokeLinecap="round" strokeLinejoin="round" />
        <path d={layout.d} fill="none" stroke="#d2ab78" strokeWidth={layout.trackW - 18} strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        <path d={layout.d} fill="none" stroke="#fffaf0" strokeWidth="3" strokeDasharray="14 14" opacity="0.7" />

        {/* Slime trail for the viewer */}
        {ready && myProgress !== undefined && myProgress > 0 && (
          <path
            d={layout.d}
            fill="none"
            stroke={shellColors(meId).fill}
            strokeWidth="9"
            strokeLinecap="round"
            opacity="0.45"
            strokeDasharray={`${myProgress * geom!.len} ${geom!.len}`}
          />
        )}

        {/* Quarter markers */}
        {ready && [0.25, 0.5, 0.75].map((f) => {
          const pt = pointAt(f);
          const t = tangentAt(f);
          const ox = -t.y * (layout.trackW / 2 + 16);
          const oy = t.x * (layout.trackW / 2 + 16);
          const side = oy > 0 ? -1 : 1;
          return (
            <g key={f} transform={`translate(${pt.x + ox * side} ${pt.y + oy * side})`}>
              <rect x="-2" y="-4" width="4" height="22" fill="#8a6238" />
              <rect x="-27" y="-22" width="54" height="22" rx="5" fill="#fffaf0" stroke="#8a6238" strokeWidth="2.5" />
              <text y="-6" textAnchor="middle" fontSize="12" fontWeight="800" fill="#5a3d1c" fontFamily="Nunito, sans-serif">{markerLabel(f)}</text>
            </g>
          );
        })}

        {/* Start line */}
        {start && startT && (
          <g transform={`translate(${start.x} ${start.y}) rotate(${(Math.atan2(startT.y, startT.x) * 180) / Math.PI})`}>
            <rect x="-6" y={-layout.trackW / 2} width="12" height={layout.trackW} fill="url(#checker)" />
            <g transform={`rotate(${-(Math.atan2(startT.y, startT.x) * 180) / Math.PI})`}>
              {(() => {
                const below = start.y + layout.trackW / 2 + 40 < layout.h;
                const y = below ? layout.trackW / 2 + 10 : -layout.trackW / 2 - 34;
                return (
                  <>
                    <rect x="-30" y={y} width="60" height="24" rx="12" fill="#2f6b2a" />
                    <text x="0" y={y + 17} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="800" fontFamily="Nunito, sans-serif">START</text>
                  </>
                );
              })()}
            </g>
          </g>
        )}

        {/* Finish line + flag */}
        {finish && finishT && (
          <g>
            <g transform={`translate(${finish.x} ${finish.y}) rotate(${(Math.atan2(finishT.y, finishT.x) * 180) / Math.PI})`}>
              <rect x="-8" y={-layout.trackW / 2 - 4} width="16" height={layout.trackW + 8} fill="url(#checker)" stroke="#1f2d1b" strokeWidth="1.5" />
            </g>
            <g transform={`translate(${finish.x + (layout === LAYOUTS.wide ? 22 : -22)} ${finish.y - layout.trackW / 2 - 4})`}>
              <rect x="-2" y="-62" width="4" height="64" fill="#5a3d1c" rx="2" />
              <g className="flag">
                <rect x="2" y="-62" width="40" height="26" fill="url(#checker)" stroke="#1f2d1b" strokeWidth="1.5" />
              </g>
              <rect x="-34" y="-90" width="68" height="22" rx="11" fill="#d9482a" />
              <text y="-74" textAnchor="middle" fill="#fff" fontSize="12.5" fontWeight="800" fontFamily="Nunito, sans-serif">FINISH</text>
            </g>
          </g>
        )}

        {/* Snails, back to front */}
        {[...placed].sort((a, b) => a.y - b.y).map(({ s, x, y, flip, tilt }) => {
          const me = s.user.id === meId;
          const isLeader = s.rank === 1 && s.distanceM > 0;
          const photo = Boolean(s.user.photoUrl);
          return (
            <g
              key={s.user.id}
              className="snail-g"
              transform={`translate(${x} ${y})`}
              tabIndex={0}
              role="button"
              aria-label={`${s.user.name}${me ? " (you)" : ""}: ${ordinal(s.rank)} place, ${pct(s.progress)} of goal, ${goalText(s, unit)}`}
              onMouseEnter={() => setFocusId(s.user.id)}
              onFocus={() => setFocusId(s.user.id)}
              onBlur={() => setFocusId(null)}
              onClick={() => setFocusId(focusId === s.user.id ? null : s.user.id)}
            >
              {/* Snails turn to face the way they travel; photos always stay upright and unmirrored. */}
              <g transform={photo ? `scale(${layout.snail})` : `rotate(${tilt}) scale(${(flip ? -1 : 1) * layout.snail} ${layout.snail})`}>
                <SnailShape user={s.user} leader={isLeader} moving={moving.has(s.user.id)} />
              </g>
              {me && (
                <circle
                  cx="0"
                  cy={(photo ? TOKEN.cy : -22) * layout.snail}
                  r={(photo ? TOKEN.r + 5 : 34) * layout.snail}
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
          const text = `${sportEmoji(s.user.sport)} ${name} · ${pct(s.progress)}`;
          const w = text.length * 7.2 + 16;
          const ly = y - 62 * layout.snail - 8 - tier * 26;
          return (
            <g key={s.user.id} transform={`translate(${x} ${ly})`} className="snail-label" aria-hidden="true">
              {tier > 0 && <line x1="0" y1="0" x2="0" y2={tier * 26} stroke="#1f2d1b" strokeWidth="1.5" opacity="0.4" />}
              <rect x={-w / 2} y="-22" width={w} height="22" rx="11" fill={me ? "#d9482a" : s.rank === 1 ? "#1f2d1b" : "#fffaf0"} stroke={me || s.rank === 1 ? "none" : "#c9bfa6"} />
              <text y="-6.5" textAnchor="middle" fontSize="12.5" fill={me || s.rank === 1 ? "#fff" : "#1f2d1b"}>{text}</text>
            </g>
          );
        })}
      </svg>

      {standings.length === 0 && (
        <div className="track-empty"><div>No snails on the track yet. Invite some friends! 🐌</div></div>
      )}
      {race.status === "upcoming" && standings.length > 0 && (
        <div className="track-empty"><div>The race starts {formatDate(race.startDate)}. Snails are warming up their slime…</div></div>
      )}

      {focused && width > 0 && (
        <div className="snail-tip" style={{ left: Math.min(Math.max(focused.x * scale, 100), width - 100), top: (focused.y - 50 * layout.snail) * scale }}>
          <strong>{focused.s.user.name}{focused.s.user.id === meId ? " (you)" : ""}</strong>
          <div>{ordinal(focused.s.rank)} place · {pct(focused.s.progress, 1)} of goal</div>
          <div className="faint">{sportEmoji(focused.s.user.sport)} {goalText(focused.s, unit)}</div>
          <div className="faint">
            {focused.s.finishedOn
              ? `Finished ${formatDate(focused.s.finishedOn)} 🎉`
              : focused.s.remainingM !== null && `${dist(focused.s.remainingM, unit)} to go`}
          </div>
        </div>
      )}
      {leader && <span className="sr-only">Leader: {leader.user.name}</span>}
    </div>
  );
}

function Decoration({ x, y, kind, s }: { x: number; y: number; kind: number; s: number }) {
  const t = `translate(${x} ${y}) scale(${s})`;
  switch (kind) {
    case 0: // daisy
      return (
        <g transform={t}>
          {[0, 60, 120, 180, 240, 300].map((a) => <ellipse key={a} cx="0" cy="-6" rx="3.5" ry="6" fill="#fff" transform={`rotate(${a})`} />)}
          <circle r="4" fill="#ffc93c" />
        </g>
      );
    case 1: // tulip
      return (
        <g transform={t}>
          <path d="M0 0 L0 14" stroke="#3f8f3a" strokeWidth="2.5" />
          <path d="M-7 -8 Q-7 4 0 4 Q7 4 7 -8 L3.5 -4 L0 -10 L-3.5 -4 Z" fill="#ff6f91" />
        </g>
      );
    case 2: // mushroom
      return (
        <g transform={t}>
          <rect x="-3.5" y="-4" width="7" height="10" rx="3" fill="#fff4e0" />
          <path d="M-12 -3 Q0 -20 12 -3 Z" fill="#e5484d" />
          <circle cx="-4" cy="-9" r="2" fill="#fff" />
          <circle cx="4" cy="-7" r="1.6" fill="#fff" />
        </g>
      );
    case 3: // pebbles
      return (
        <g transform={t}>
          <ellipse cx="0" cy="0" rx="9" ry="6" fill="#bfb6a3" />
          <ellipse cx="9" cy="3" rx="5" ry="3.5" fill="#d3ccbc" />
        </g>
      );
    case 4: // clover
      return (
        <g transform={t} fill="#4fa83a">
          <circle cx="-4" cy="-3" r="4.5" />
          <circle cx="4" cy="-3" r="4.5" />
          <circle cx="0" cy="3" r="4.5" />
        </g>
      );
    default: // grass tuft
      return (
        <g transform={t}>
          <path d="M-6 6 Q-5 -4 -8 -10 M0 6 Q0 -6 2 -13 M6 6 Q5 -3 9 -9" stroke="#3f8f3a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

/** Compact standings list shown under the track. */
export function StandingsList({ standings, meId, unit }: { standings: Standing[]; meId: number; unit: Unit }) {
  if (!standings.length) return null;
  return (
    <div className="standings">
      {standings.map((s) => (
        <div key={s.user.id} className={`standing-row${s.user.id === meId ? " me" : ""}`}>
          <div className={`rank r${s.rank}`}>{s.rank <= 3 && s.distanceM > 0 ? ["🥇", "🥈", "🥉"][s.rank - 1] : s.rank}</div>
          <Avatar user={s.user} />
          <div style={{ minWidth: 0 }}>
            <div className="name">
              <span aria-hidden="true">{sportEmoji(s.user.sport)} </span>
              <Link to={`/people/${s.user.id}`} style={{ color: "inherit", textDecoration: "none" }}>{s.user.name}</Link>
              {s.user.id === meId && <span className="badge badge-warn" style={{ marginLeft: 6 }}>You</span>}
            </div>
            <div className="progress bar" aria-hidden="true"><span style={{ width: `${s.progress * 100}%` }} /></div>
          </div>
          <div className="right">
            <strong>{pct(s.progress)}</strong>
            <div className="faint">{s.finishedOn ? "Finished! 🏁" : goalText(s, unit)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
