import { useId } from "react";
import { shellColors } from "../lib/format.ts";

interface SnailUser {
  id: number;
  name: string;
  photoUrl: string | null;
}

/** Vertical centre and radius of the photo token, shared with the race track for positioning. */
export const TOKEN = { cy: -32, r: 31 };

/**
 * A racer's figure in local coordinates: origin at the bottom-centre, roughly 80 x 60 units.
 * Racers with a profile photo are drawn as a round photo token; everyone else is a cartoon
 * snail facing right.
 */
export function SnailShape({ user, leader = false, moving = false }: { user: SnailUser; leader?: boolean; moving?: boolean }) {
  const { fill, stroke } = shellColors(user.id);
  const clipId = `token-${useId().replace(/:/g, "")}`;

  if (user.photoUrl) {
    const inner = TOKEN.r - 5;
    return (
      <g className={moving ? "moving" : undefined}>
        <ellipse cx="0" cy="1" rx="24" ry="4.5" fill="rgba(0,0,0,0.18)" />
        <g className="photo-token">
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
        {leader && <Crown x={0} y={TOKEN.cy - TOKEN.r - 2} />}
      </g>
    );
  }

  return (
    <g className={moving ? "moving" : undefined}>
      <ellipse cx="2" cy="1" rx="38" ry="4.5" fill="rgba(0,0,0,0.18)" />
      <g className="snail-body">
        <path
          d="M-38,0 C-38,-7 -31,-10 -22,-10 L16,-10 C23,-10 27,-15 29,-23 C31,-31 43,-31 43,-21 C43,-10 39,0 31,0 Z"
          fill="#b5e48c"
          stroke="#3f7d20"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M-30,-4 L24,-4" stroke="#dcf7c5" strokeWidth="3" strokeLinecap="round" />
        <g className="stalk">
          <path d="M32,-27 L28,-44" stroke="#3f7d20" strokeWidth="3" strokeLinecap="round" />
          <circle cx="28" cy="-46" r="5" fill="#fff" stroke="#3f7d20" strokeWidth="2" />
          <circle cx="29.6" cy="-46" r="2.3" fill="#1f2d1b" />
        </g>
        <g className="stalk b">
          <path d="M38,-26 L41,-42" stroke="#3f7d20" strokeWidth="3" strokeLinecap="round" />
          <circle cx="41" cy="-44" r="5" fill="#fff" stroke="#3f7d20" strokeWidth="2" />
          <circle cx="42.6" cy="-44" r="2.3" fill="#1f2d1b" />
        </g>
        <path d="M34,-15 Q37.5,-11.5 41,-15" fill="none" stroke="#3f7d20" strokeWidth="2" strokeLinecap="round" />
        <circle cx="36" cy="-19.5" r="2.6" fill="#ff8f8f" opacity="0.75" />
        <g transform="translate(-6,-31)">
          <circle r="25" fill={fill} stroke={stroke} strokeWidth="3" />
          <circle r="21" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="9 6" opacity="0.45" />
          <path
            d="M0,0 m-2.5,0 a2.5,2.5 0 1,1 5,0 a5.5,5.5 0 1,1 -11,0 a8.5,8.5 0 1,1 17,0 a11.5,11.5 0 1,1 -23,0 a14.5,14.5 0 1,1 29,0"
            fill="none"
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        {leader && <Crown x={-6} y={-60} />}
      </g>
    </g>
  );
}

function Crown({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} className="bob">
      <path d="M-13,0 L-13,-11 L-6.5,-4.5 L0,-14 L6.5,-4.5 L13,-11 L13,0 Z" fill="#ffd23f" stroke="#a87b00" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="0" cy="-15" r="2.4" fill="#ff6f91" />
    </g>
  );
}

/** Stand-alone racer figure for cards, profile previews and lists. */
export function SnailPortrait({ user, size = 120, leader = false, title }: { user: SnailUser; size?: number; leader?: boolean; title?: string }) {
  return (
    <svg width={size} height={size * 0.85} viewBox="-48 -80 100 85" role="img" aria-label={title ?? (user.photoUrl ? `${user.name}'s racer photo` : `${user.name}'s snail`)}>
      <SnailShape user={user} leader={leader} />
    </svg>
  );
}
