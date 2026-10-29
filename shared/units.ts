// All distances are stored in meters. Units only matter at the edges (forms and display).
export type Unit = "km" | "mi";

export const UNITS: Unit[] = ["km", "mi"];

const METERS_PER: Record<Unit, number> = { km: 1000, mi: 1609.344 };

export function toMeters(value: number, unit: Unit): number {
  return value * METERS_PER[unit];
}

export function fromMeters(meters: number, unit: Unit): number {
  return meters / METERS_PER[unit];
}

export function formatDistance(meters: number, unit: Unit, digits = 1): string {
  const v = fromMeters(meters, unit);
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}
