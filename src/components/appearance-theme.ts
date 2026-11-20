// @ts-expect-error TS5097: Node's direct TypeScript tests need the source extension.
import { freshAccentStudy, inspireMoodStudy } from './appearance-study-colors.ts';

export const THEME_STYLES = ['Fresh', 'Inspire'] as const;
export const THEME_MODES = ['System', 'Light', 'Dark'] as const;
export const ACCENT_COLORS = ['green', 'cobalt', 'amber', 'teal', 'cyan', 'indigo', 'violet', 'berry', 'coral', 'slate'] as const;

export type ThemeStyle = typeof THEME_STYLES[number];
export type ThemeMode = typeof THEME_MODES[number];
export type AccentColor = typeof ACCENT_COLORS[number];
export type AppearancePreferences = { style: ThemeStyle; mode: ThemeMode; accent: AccentColor };

export type AppearancePalette = {
  canvas: string; surface: string; raised: string; navBg: string; border: string;
  cardBorder: string; graphOutline: string; text: string; muted: string;
  brand: string; brand2: string; onBrand: string; accentInk: string; quoteInk: string;
  hero: string; heroBg: string; onHero: string; heroSecondary: string; heroBorder: string;
  homeBg: string; homeBorder: string; homeInk: string; homeSecondary: string;
  homeQuote: string; homeCta: string; homeTrack: string; homeFill: string; homePillBg: string;
  tint: string; selection: string; selectionInk: string; pos: string; posInk: string;
  posSoft: string; neg: string; utilGood: string; inputBorder: string;
  sky1: string; sky2: string; sky3: string; sun1: string; sun2: string;
  m1: string; m2: string; m3: string; water: string; sand: string; pine: string;
};

export const defaultAccentColor: AccentColor = 'green';
export const DEFAULT_APPEARANCE: AppearancePreferences = { style: 'Fresh', mode: 'System', accent: defaultAccentColor };

export function appearanceStorageKeys(id: string) {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const encodedId = Array.from(id, character => character.codePointAt(0)!.toString(16)).join('-');
  return {
    preferences: `debtfree-pref-appearance.${encodedId}`,
    legacyTheme: `debtfree-pref-theme.${safeId}`,
    legacyAccent: `debtfree-pref-accent.${encodedId}`,
    legacyPlainAccent: `debtfree-pref-accent.${safeId}`,
  };
}

export function resolveAppearancePreferences(
  stored: string | null,
  legacyTheme: string | null = null,
  legacyAccent: string | null = null,
): AppearancePreferences {
  let parsed: Partial<AppearancePreferences> | null = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    // Fall back to the legacy fields if the new value cannot be decoded.
  }
  return {
    style: parsed?.style && THEME_STYLES.includes(parsed.style)
      ? parsed.style
      : legacyTheme === 'Inspire' ? 'Inspire' : 'Fresh',
    mode: parsed?.mode && THEME_MODES.includes(parsed.mode)
      ? parsed.mode
      : legacyTheme === 'Inspire' ? 'Light' : legacyTheme === 'Light' || legacyTheme === 'Dark' ? legacyTheme : 'System',
    accent: parsed?.accent && ACCENT_COLORS.includes(parsed.accent)
      ? parsed.accent
      : legacyAccent === 'Indigo' ? 'indigo' : legacyAccent === 'Cobalt' ? 'cobalt' : defaultAccentColor,
  };
}

export function isLightMode(mode: ThemeMode, system: 'light' | 'dark' | null | undefined): boolean {
  return mode === 'Light' || (mode === 'System' && system === 'light');
}

const moodFor = (color: AccentColor) => inspireMoodStudy[color === 'cyan' ? 'coastal' : color];

export function accentDetails(style: ThemeStyle, color: AccentColor) {
  const pack = style === 'Inspire' ? moodFor(color) : freshAccentStudy[color];
  return { label: pack.label, swatch: pack.hex };
}

const freshBase = {
  light: {
    canvas: '#F7F9F8', surface: '#FFFFFF', raised: '#EEF3F0', navBg: '#FFFFFF',
    border: '#E1E8E4', text: '#090D14', muted: '#5D6862', neg: '#E34F52', inputBorder: '#899A90',
  },
  dark: {
    canvas: '#090D14', surface: '#141B24', raised: '#1C2531', navBg: '#111720',
    border: '#27323F', text: '#F5F7FA', muted: '#A6B1BD', neg: '#FF655E', inputBorder: '#526175',
  },
};

export type GradientStop = { color: string; offset: string };
export function gradientStops(fill: string): GradientStop[] {
  return Array.from(fill.matchAll(/(#[0-9a-f]{6})\s+(\d+%)/gi), ([, color, offset]) => ({ color, offset }));
}

function createPalette(style: ThemeStyle, color: AccentColor, mode: 'light' | 'dark'): AppearancePalette {
  const mood = moodFor(color)[mode];
  const fresh = freshAccentStudy[color][mode];
  const isInspire = style === 'Inspire';
  const base = freshBase[mode];
  const t = isInspire ? mood : fresh;
  const hero = gradientStops(t.heroBg)[0]?.color ?? t.heroBg;
  // These light study fills need dark button text to reach 4.5:1 contrast.
  const onBrand = mode === 'light' && (color === 'amber' || color === 'teal' || color === 'cyan' || color === 'coral')
    ? (isInspire ? '#080C12' : '#090D14')
    : t.brandInk;
  return {
    ...(isInspire ? {
      canvas: mood.paper, surface: mood.surface, raised: mood.surface2, navBg: mood.navBg,
      border: mood.line, cardBorder: mood.cardBorder, graphOutline: mood.graphOutline,
      text: mood.ink, muted: mood.mutedInk, neg: mode === 'light' ? '#D94F4F' : '#FB7185',
      inputBorder: mood.cardBorder,
    } : {
      ...base, cardBorder: base.border, graphOutline: base.border,
    }),
    brand: t.brand, brand2: t.brand2, onBrand, accentInk: t.accentInk,
    quoteInk: isInspire ? mood.quoteInk : t.accentInk,
    hero, heroBg: t.heroBg, onHero: t.heroInk, heroSecondary: t.heroSec,
    heroBorder: isInspire ? mood.heroBorder : base.border,
    homeBg: t.homeBg, homeBorder: isInspire ? mood.homeBorder : fresh.homePillBorder,
    homeInk: t.homeInk, homeSecondary: t.homeSec,
    homeQuote: isInspire ? mood.homeQuote : fresh.homeSec,
    homeCta: isInspire ? mood.homeCta : fresh.homeInk,
    homeTrack: isInspire ? mood.graphOutline : fresh.homeTrack,
    homeFill: isInspire ? mood.brand : fresh.homeFill,
    homePillBg: isInspire ? mood.surface : fresh.homePillBg,
    tint: t.sel, selection: t.sel, selectionInk: t.selInk,
    pos: t.pos, posInk: t.posInk, posSoft: t.posSoft, utilGood: t.utilGood,
    sky1: mood.sky1, sky2: mood.sky2, sky3: mood.sky3, sun1: mood.sun1, sun2: mood.sun2,
    m1: mood.m1, m2: mood.m2, m3: mood.m3, water: mood.water, sand: mood.sand, pine: mood.pine,
  };
}

type StylePalettes = Record<ThemeStyle, Record<'light' | 'dark', AppearancePalette>>;
const paletteCache = new Map<AccentColor, StylePalettes>();
for (const color of ACCENT_COLORS) {
  paletteCache.set(color, {
    Fresh: { light: createPalette('Fresh', color, 'light'), dark: createPalette('Fresh', color, 'dark') },
    Inspire: { light: createPalette('Inspire', color, 'light'), dark: createPalette('Inspire', color, 'dark') },
  });
}

export function getAppearancePalette(style: ThemeStyle, color: AccentColor, isLight: boolean): AppearancePalette {
  return paletteCache.get(color)![style][isLight ? 'light' : 'dark'];
}

export function payActionColors(palette: AppearancePalette, isLight: boolean) {
  const meadow = isLight && palette.brand.toUpperCase() === '#15803D';
  return { background: meadow ? '#22C55E' : palette.brand, text: meadow ? '#090D14' : palette.onBrand };
}
