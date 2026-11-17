export type ThemePreference = 'System' | 'Dark' | 'Light' | 'Inspire';
export type AccentColor = 'Indigo' | 'Cobalt';
export type AppearancePalette = { canvas: string; surface: string; raised: string; border: string; text: string; muted: string; brand: string; onBrand: string; hero: string; onHero: string; tint: string; inputBorder: string };
export const defaultAccentColor: AccentColor = 'Cobalt';
export const inspirePalette: AppearancePalette = {
  canvas: '#EEF8FA',
  surface: '#FFFFFF',
  raised: '#E3F4F7',
  border: '#CBE6EC',
  text: '#102A3A',
  muted: '#4E7284',
  brand: '#0A85A5',
  onBrand: '#FFFFFF',
  hero: '#C6EEF4',
  onHero: '#102A3A',
  tint: '#E2F5F9',
  inputBorder: '#8CC4D0',
};
export const palettes: Record<AccentColor, { light: AppearancePalette; dark: AppearancePalette; inspire: AppearancePalette }> = {
  Indigo: {
    light: { canvas:'#F6F5F2', surface:'#FFFFFF', raised:'#F0EFF4', border:'#E2DFE8', text:'#24232D', muted:'#676471', brand:'#5147A8', onBrand:'#FFFFFF', hero:'#282443', onHero:'#FAF8FF', tint:'#EEEBF8', inputBorder:'#8D8B95' },
    dark: { canvas:'#000000', surface:'#111113', raised:'#1A1A1D', border:'#262629', text:'#F5F5F7', muted:'#9898A0', brand:'#B9B1FF', onBrand:'#1A1533', hero:'#1B1733', onHero:'#FAF8FF', tint:'#181722', inputBorder:'#3A3A42' },
    inspire: inspirePalette,
  },
  Cobalt: {
    light: { canvas:'#F6F7FB', surface:'#FFFFFF', raised:'#EEF2FA', border:'#DCE3F0', text:'#0F1A2E', muted:'#5A677D', brand:'#0051FB', onBrand:'#FFFFFF', hero:'#070D5B', onHero:'#FFFFFF', tint:'#E8F0FF', inputBorder:'#9AA8BF' },
    dark: { canvas:'#000000', surface:'#111113', raised:'#1A1A1D', border:'#262629', text:'#F5F5F7', muted:'#9898A0', brand:'#4F90FF', onBrand:'#07112B', hero:'#091124', onHero:'#FFFFFF', tint:'#151924', inputBorder:'#3A3A42' },
    inspire: inspirePalette,
  },
};

export function accentActionColors(accentColor: AccentColor, palette: AppearancePalette, isInspire = false): { bg: string; fg: string } {
  if (isInspire) return { bg: '#0B89A8', fg: '#FFFFFF' };
  return accentColor === 'Cobalt' ? { bg: '#0051FB', fg: '#FFFFFF' } : { bg: palette.brand, fg: palette.onBrand };
}

