import { useId } from "react";
import { racerColors } from "../lib/format.ts";

interface RacerUser {
  id: number;
  name: string;
  photoUrl: string | null;
}

/** Vertical centre and radius of the photo badge, shared with the race track for positioning. */
export const TOKEN = { cy: -32, r: 31 };

/** Gold pilot wings shown above the race leader. */
function LeaderWings({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} className="bob">
      <path d="M-4,0 C-9,-5 -18,-5 -25,-1 C-18,0 -11,2 -4,4 Z" fill="#ffc23d" stroke="#a87b00" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4,0 C9,-5 18,-5 25,-1 C18,0 11,2 4,4 Z" fill="#ffc23d" stroke="#a87b00" strokeWidth="1.5" strokeLinejoin="round" />
      <circle r="6" fill="#ffc23d" stroke="#a87b00" strokeWidth="1.5" />
      <path d="M0,-3.6 L1.1,-1.1 3.6,-1.1 1.6,0.6 2.3,3.2 0,1.7 -2.3,3.2 -1.6,0.6 -3.6,-1.1 -1.1,-1.1 Z" fill="#a87b00" />
    </g>
  );
}

/** Silver pilot wings behind a photo badge. */
function BadgeWings() {
  const wing = "M-27,-39 C-37,-46 -51,-46 -60,-41 C-52,-38 -44,-34 -27,-27 Z";
  const feathers = "M-33,-40 L-37,-35 M-40,-42 L-44,-37 M-47,-43 L-51,-39";
  return (
    <g fill="#e9f0f7" stroke="#7d91a8" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d={wing} />
      <path d={feathers} fill="none" />
      <g transform="scale(-1,1)">
        <path d={wing} />
        <path d={feathers} fill="none" />
      </g>
    </g>
  );
}

/**
 * A racer's figure in local coordinates: origin at the bottom-centre, roughly 90 x 55 units.
 * Racers with a profile photo are drawn as a round photo badge with pilot wings; everyone
 * else is a cartoon propeller plane in their own colour, flying to the right.
 */
export function RacerShape({ user, leader = false, moving = false }: { user: RacerUser; leader?: boolean; moving?: boolean }) {
  const { fill, stroke } = racerColors(user.id);
  const clipId = `badge-${useId().replace(/:/g, "")}`;

  if (user.photoUrl) {
    const inner = TOKEN.r - 5;
    return (
      <g className={moving ? "moving" : undefined}>
        <ellipse cx="0" cy="5" rx="22" ry="3" fill="rgba(13,43,76,0.12)" />
        <g className="plane-body">
          <BadgeWings />
          <circle cy={TOKEN.cy} r={TOKEN.r} fill={fill} stroke={stroke} strokeWidth="3" />
          <clipPath id={clipId}>
            <circle cy={TOKEN.cy} r={inner} />
          </clipPath>
          <circle cy={TOKEN.cy} r={inner} fill="#fff" />
          <image
            href={user.photoUrl}
            x={-inner}
            y={TOKEN.cy - inner}
            width={inner * 2}
            height={inner * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle cy={TOKEN.cy} r={inner} fill="none" stroke="#fff" strokeWidth="3" />
        </g>
        {leader && <LeaderWings x={0} y={TOKEN.cy - TOKEN.r - 6} />}
      </g>
    );
  }

  return (
    <g className={moving ? "moving" : undefined}>
      <ellipse cx="2" cy="5" rx="26" ry="3" fill="rgba(13,43,76,0.12)" />
      <g className="plane-body">
        {/* far-side tailplane */}
        <path d="M-30,-24 L-46,-22 C-47.5,-20 -46.5,-18.5 -44.5,-18.5 L-30,-20 Z" fill={stroke} />
        {/* fin */}
        <path d="M-27,-29 L-37,-46 C-38.5,-48.5 -42,-48 -42,-45 L-40,-26 Z" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
        {/* fuselage */}
        <path
          d="M36,-22 C36,-29 28,-32 16,-32 L-20,-30 L-41,-27 L-41,-20.5 L-20,-16 L16,-13.5 C28,-13.5 36,-16 36,-22 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M-36,-23.5 L31,-21.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
        {/* canopy */}
        <path d="M2,-31 C6,-42 20,-42 25,-31 Z" fill="#bfe6ff" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        <path d="M8,-35 C10,-38.5 14,-39.5 17,-39" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* wing */}
        <path d="M-14,-20.5 C-6,-25 14,-25 19,-20.5 C14,-17 -6,-16.5 -14,-20.5 Z" fill={stroke} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
        {/* nose and propeller */}
        <path d="M35.5,-26.5 C41.5,-25.5 41.5,-18.5 35.5,-17.5 Z" fill="#e5edf5" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        <ellipse className="prop" cx="41" cy="-22" rx="2.2" ry="14" fill="rgba(30,45,60,0.55)" />
      </g>
      {leader && <LeaderWings x={2} y={-50} />}
    </g>
  );
}

/** Stand-alone racer for cards, profile previews and lists. */
export function RacerPortrait({ user, size = 120, leader = false, title }: { user: RacerUser; size?: number; leader?: boolean; title?: string }) {
  return (
    <svg
      className="racer-portrait"
      width={size}
      height={size * (88 / 124)}
      viewBox="-62 -80 124 88"
      role="img"
      aria-label={title ?? (user.photoUrl ? `${user.name}'s racer photo` : `${user.name}'s plane`)}
    >
      <RacerShape user={user} leader={leader} />
    </svg>
  );
}
