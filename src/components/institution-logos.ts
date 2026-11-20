/**
 * Bundled account-mark artwork and aliases for reuse across screens.
 *
 * Chase, Citi, Discover, Wells Fargo, Capital One, and Best Buy are carried
 * over unchanged from the original AccountMark component.
 *
 * The U.S. Bank shield uses paths from the official website logo.
 * https://www.usbank.com/etc.clientlibs/ecm-global/clientlibs/clientlib-resources/resources/images/svg/logo-personal.svg
 *
 * PenFed is the PNG delivered by the owner's Brave image link for the
 * Brandfetch symbol at https://cdn.brandfetch.io/idd5CjbQjj/theme/dark/symbol.svg .
 */

export const accountMarkArtwork = {
  chase: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#117ACA"/>
    <path d="M14.5 9h10l3.5 3.5H14.5V9Zm16.5 5.5v10l-3.5 3.5V14.5H31ZM25.5 31h-10L12 27.5h13.5V31ZM9 25.5v-10L12.5 12v13.5H9Z" fill="#FFFFFF"/>
  </svg>`,
  citi: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#003B70"/>
    <path d="M14 17.5a8 8 0 0 1 13.4 0" fill="none" stroke="#EF3B24" stroke-width="2.8" stroke-linecap="round"/>
    <text x="20" y="27.5" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="11.5" font-weight="800" letter-spacing="-.3">citi</text>
  </svg>`,
  discover: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#141821"/>
    <path d="M5 32 Q24 28 37 16 L40 29 Q40 40 29 40 H11 Q5 40 5 34 Z" fill="#FF6000" opacity=".92"/>
    <circle cx="27.8" cy="18.2" r="5.2" fill="#FF6000"/>
    <text x="13" y="23" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="13" font-weight="800">D</text>
  </svg>`,
  wellsfargo: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#D71E28"/>
    <rect x="3.5" y="3.5" width="33" height="33" rx="8.5" fill="none" stroke="#FFCD41" stroke-width="1.6" opacity=".65"/>
    <text x="20" y="24.5" text-anchor="middle" fill="#FFCD41" font-family="serif" font-size="13.5" font-weight="700" letter-spacing=".4">WF</text>
  </svg>`,
  capone: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#004977"/>
    <path d="M8 25.5 C16 14 28 13.5 33 17 C26 17.5 18 20.5 11 28 Z" fill="#D03027"/>
    <text x="18" y="19" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="10" font-weight="800">C1</text>
  </svg>`,
  bestbuy: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#FFE000"/>
    <path d="M8 14.5 L12.5 10 H31 V30 H12.5 L8 25.5 Z" fill="#FFF200" stroke="#090D14" stroke-width="1.6"/>
    <circle cx="12" cy="20" r="1.5" fill="#090D14"/>
    <text x="21.8" y="23.2" text-anchor="middle" fill="#090D14" font-family="sans-serif" font-size="8.2" font-weight="900">BBY</text>
  </svg>`,
  usbank: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#FFFFFF" stroke="#D6DEE8"/>
    <g transform="translate(7 9) scale(.299)">
      <polygon points="0 54.5 43.5 72 87 54.5 87 0 0 0 0 54.5" fill="#CF2A36"/>
      <g transform="translate(-30.74 -38.59)" fill="#FFFFFF">
        <path d="M63.83,85.76c-1.9,3.15-6.08,4.47-9.74,4.47-8.87,0-13.85-6.45-13.85-14.21V53H51.38V73.67c0,3.52,1.9,6.3,5.86,6.3,3.74,0,6.08-2.56,6.08-6.22V53H74.46V82.9a58.43,58.43,0,0,0,.36,6.52H64.13A25.91,25.91,0,0,1,63.83,85.76Z"/>
        <path d="M88.31,77.41c.15,2.49,1.91,4.91,5.72,4.91,2.86,0,4.25-1.54,4.25-3.15,0-1.32-.88-2.42-3.59-3l-4.18-1C82.75,73.53,79.67,69.13,79.67,64c0-6.66,5.86-12.09,14-12.09,10.55,0,14.22,6.6,14.58,10.85L99,64.44A4.78,4.78,0,0,0,93.81,60c-2.13,0-4,1.25-4,3.15,0,1.54,1.25,2.42,2.86,2.71l4.84,1c7.54,1.53,11.2,6.08,11.2,11.42,0,6.23-4.76,12.31-14.5,12.31-11.43,0-15.09-7.4-15.39-11.43Z"/>
      </g>
    </g>
  </svg>`,
  penfed: { source: require('./institution-assets/penfed.png') as number },
  auto: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#1E293B"/>
    <path d="M10 21.5 L13 14.5 H27 L30 21.5 V27 H10 V21.5 Z" fill="none" stroke="#F5C563" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="14.5" cy="27" r="2.1" fill="#F5C563"/>
    <circle cx="25.5" cy="27" r="2.1" fill="#F5C563"/>
    <path d="M8.5 21.5 H31.5" stroke="#F5C563" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  home: `<svg viewBox="0 0 40 40">
    <rect width="40" height="40" rx="11" fill="#1E3A8A"/>
    <path d="M9 20.5 L20 11 L31 20.5" fill="none" stroke="#93C5FD" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12.5 18.5 V29.5 H27.5 V18.5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
    <rect x="17.5" y="22.5" width="5" height="7" rx="1" fill="#93C5FD"/>
  </svg>`,
} as const;

export type AccountMarkArtworkKey = keyof typeof accountMarkArtwork;

const institutionAliases: readonly [RegExp, AccountMarkArtworkKey][] = [
  [/\bchase\b/i, 'chase'],
  [/\bciti\b/i, 'citi'],
  [/\bdiscover\b/i, 'discover'],
  [/\bwells\s*fargo\b/i, 'wellsfargo'],
  [/\bcapital\s*(?:one|1)\b/i, 'capone'],
  [/\bbest\s*buy\b/i, 'bestbuy'],
  [/\b(?:u\.?\s*s\.?\s*bank|usb\s*connect)\b/i, 'usbank'],
  [/\bpen\s*fed\b/i, 'penfed'],
  [/\bpentagon\s+federal(?:\s+credit\s+union)?\b/i, 'penfed'],
];

/** Resolve category marks first, then institution aliases, then legacy name hints. */
export function resolveAccountMarkArtwork(name: string, category?: string): AccountMarkArtworkKey | undefined {
  const type = category?.toLowerCase();
  if (type === 'mortgage' || type === 'home') return 'home';
  if (type === 'auto loan' || type === 'auto') return 'auto';
  return institutionAliases.find(([pattern]) => pattern.test(name))?.[1]
    ?? (/\b(mortgage|home loan)\b/i.test(name) ? 'home' : /\bauto\b/i.test(name) ? 'auto' : undefined);
}
