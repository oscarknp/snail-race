import { formatDistance, fromMeters, type Unit } from "../../../shared/units.ts";

export { formatDistance, fromMeters };

export const dist = (m: number, unit: Unit, digits = 1) => formatDistance(m, unit, digits);

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export const todayIso = () => new Date().toLocaleDateString("en-CA");

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A stable, cheerful shell colour per racer. */
const SHELLS = [
  ["#ff8a5b", "#b8461f"],
  ["#ffc145", "#a8730a"],
  ["#7cc6fe", "#2f6f9f"],
  ["#c792ea", "#7a3fa3"],
  ["#ff6f91", "#a8304d"],
  ["#5ad2b4", "#22806a"],
  ["#f9a03f", "#a35c0c"],
  ["#9ad86b", "#4d7f27"],
  ["#ff9cc7", "#a84a76"],
  ["#8fa8ff", "#3c55b0"],
];

export function shellColors(id: number): { fill: string; stroke: string } {
  const [fill, stroke] = SHELLS[(id * 7) % SHELLS.length];
  return { fill, stroke };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
