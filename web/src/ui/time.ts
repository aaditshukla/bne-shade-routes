// Time slots: slot i starts at 06:00 + 15·i min, Brisbane time (UTC+10, no daylight saving).
export const SLOTS = 51;

/** Nearest slot to this moment in Brisbane, clamped to 06:00–18:30 (contract: round, not floor). */
export function slotAt(date: Date): number {
  const mins = (date.getTime() / 60_000 + 600) % 1440; // minutes since Brisbane midnight
  return Math.min(SLOTS - 1, Math.max(0, Math.round((mins - 360) / 15)));
}

/** Slot start, plus an optional walk in minutes (rounded), as '4:30 pm'. */
export function slotTime(slot: number, plusMin = 0): string {
  const total = 360 + 15 * slot + Math.round(plusMin);
  const h = Math.floor(total / 60);
  return `${((h + 11) % 12) + 1}:${String(total % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
