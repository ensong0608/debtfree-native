// Centralized real-text inspiring phrases for the Inspire theme.
// Stored as editable strings in one place and rotated automatically across app sessions/visits.

export type InspireQuoteSlot =
  | 'greeting'
  | 'heroCorner'
  | 'heroFooter'
  | 'accountsLeft'
  | 'accountsRight'
  | 'budgetIncome'
  | 'budgetFooter'
  | 'progressRecorded'
  | 'settingsFooter';

export const INSPIRE_QUOTES: Record<InspireQuoteSlot, readonly string[]> = {
  greeting: [
    "You're one step closer to a debt-free future. \u2665",
    'A calm plan makes every dollar lighter. \u2665',
    'Today is a fresh page in your money story. \u2665',
    'Steady habits build real freedom. \u2665',
  ],
  heroCorner: [
    'A brighter tomorrow\nis possible \u2665',
    'Clear skies\nahead \u2665',
    'Your future self\nwill thank you \u2665',
    'Peace of mind\nis growing \u2665',
  ],
  heroFooter: [
    'Keep building your freedom.',
    'Every payment brings the horizon closer.',
    'Consistent beats perfect.',
    'One cycle at a time.',
  ],
  accountsLeft: [
    'Small steps count \u2665',
    'Slow progress is still progress \u2665',
    'Every dollar counts \u2665',
    'Momentum adds up \u2665',
  ],
  accountsRight: [
    'You got this!',
    'Keep going!',
    'Stay steady!',
    'Proud of your focus!',
  ],
  budgetIncome: [
    "You're on track \u2665",
    'Every dollar has a purpose \u2665',
    'Clarity brings peace \u2665',
    'Balanced & intentional \u2665',
  ],
  budgetFooter: [
    'Progress today, brighter days tomorrow \u2665',
    'Giving every dollar a clear home \u2665',
    'Calm choices create lasting freedom \u2665',
    'Small adjustments, big peace of mind \u2665',
  ],
  progressRecorded: [
    'Every dollar forward counts \u2665',
    'Look how far you have come \u2665',
    'Real momentum in motion \u2665',
    'Proof that your plan works \u2665',
  ],
  settingsFooter: [
    'Keep building your freedom \u2665',
    'Warmth, clarity, and steady momentum \u2665',
    'Designed to cheer you on every step \u2665',
  ],
};

// Rotates once per app launch + advances gently with calendar day & slot offset
// so the user sees varied phrases naturally without repeating on the same screen.
const SESSION_SEED = Math.floor(Math.random() * 100);

export function getInspireQuote(slot: InspireQuoteSlot, cycleOffset = 0): string {
  const list = INSPIRE_QUOTES[slot];
  if (!list.length) return '';
  const now = new Date();
  const dayIndex = now.getFullYear() * 366 + now.getMonth() * 31 + now.getDate();
  const idx = Math.abs(SESSION_SEED + dayIndex + cycleOffset) % list.length;
  return list[idx];
}
