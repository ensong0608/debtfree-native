import type { AppearancePalette } from './appearance-theme';

export type InspireArtKind =
  | 'hero-accounts'
  | 'hero-strategy'
  | 'hero-budget'
  | 'hero-expense'
  | 'hero-overview'
  | 'hero-utilization'
  | 'hero-milestones'
  | 'hero-paid'
  | 'hero-profile'
  | 'tile-pay'
  | 'tile-chg'
  | 'hero-calendar'
  | 'corner-wave'
  | 'corner-ridge'
  | 'corner-leaf';

// SVG artwork from the approved Inspire Fresh study.
export function phoneBackdropSvg(t: AppearancePalette, isDark: boolean) {
  const wisp = isDark ? 'rgba(255,255,255,.06)' : '#FFFFFF';
  const starCol = isDark ? t.sun1 : t.brand;
  const contourOp = isDark ? '0.18' : '0.26';
  const waveOp = isDark ? '0.16' : '0.28';
  return `
    <svg viewBox="0 0 430 880" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="bgSkyWash" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.82' : '0.78'}"/>
          <stop offset="28%" stop-color="${t.canvas}" stop-opacity="0"/>
          <stop offset="78%" stop-color="${t.canvas}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${t.sky3}" stop-opacity="${isDark ? '0.45' : '0.52'}"/>
        </linearGradient>
        <radialGradient id="bgGlowTop" cx="82%" cy="6%" r="48%">
          <stop offset="0%" stop-color="${t.sun1}" stop-opacity="${isDark ? '0.12' : '0.28'}"/>
          <stop offset="55%" stop-color="${t.brand2}" stop-opacity="${isDark ? '0.07' : '0.09'}"/>
          <stop offset="100%" stop-color="${t.canvas}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="bgGlowMid" cx="12%" cy="54%" r="46%">
          <stop offset="0%" stop-color="${t.brand}" stop-opacity="${isDark ? '0.09' : '0.08'}"/>
          <stop offset="100%" stop-color="${t.canvas}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="430" height="880" fill="url(#bgSkyWash)"/>
      <rect width="430" height="880" fill="url(#bgGlowTop)"/>
      <rect width="430" height="880" fill="url(#bgGlowMid)"/>

        <ellipse cx="96" cy="48" rx="68" ry="15" fill="${wisp}" opacity="0.58"/>
      <ellipse cx="332" cy="64" rx="58" ry="13" fill="${wisp}" opacity="0.48"/>
      <path d="M-10 112 Q115 92 225 108 T440 98" fill="none" stroke="${t.m1}" stroke-width="1.2" opacity="${contourOp}"/>
      <path d="M-10 124 Q130 108 245 120 T440 112" fill="none" stroke="${t.m2}" stroke-width="1" stroke-dasharray="4 6" opacity="${contourOp}"/>

        <path d="M-20 385 Q110 345 230 375 T450 355" fill="none" stroke="${t.m1}" stroke-width="1.4" opacity="${contourOp}"/>
      <path d="M-20 400 Q125 365 245 390 T450 372" fill="none" stroke="${t.brand2}" stroke-width="1" opacity="${isDark ? '0.12' : '0.18'}"/>
      <path d="M-20 620 Q150 588 280 618 T450 595" fill="none" stroke="${t.m2}" stroke-width="1.2" opacity="${contourOp}"/>

        <path d="M0 788 Q115 764 235 786 T430 774 L430 880 L0 880 Z" fill="${t.water}" opacity="${waveOp}"/>
      <path d="M0 808 Q130 788 265 808 T430 798 L430 880 L0 880 Z" fill="${t.m1}" opacity="${waveOp}"/>

        <circle cx="295" cy="34" r="1.6" fill="${starCol}" opacity="${isDark ? '0.55' : '0.28'}"/>
      <circle cx="372" cy="46" r="1.2" fill="${starCol}" opacity="${isDark ? '0.45' : '0.24'}"/>
      <circle cx="176" cy="54" r="1.3" fill="${starCol}" opacity="${isDark ? '0.4' : '0.2'}"/>
      <path d="M352 78 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6-4 -4-1.6 4-1.6z" fill="${starCol}" opacity="${isDark ? '0.48' : '0.26'}"/>
    </svg>`;
}

export function horizonSvg(t: AppearancePalette, isDark: boolean) {
  const cloudFill = isDark ? 'rgba(255,255,255,.1)' : '#FFFFFF';
  const sunHaloOp = isDark ? '0.18' : '0.28';
  const sunOp = isDark ? '0.58' : '0.84';
  return `
    <svg viewBox="0 0 360 190" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="insSky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${t.sky1}"/>
          <stop offset="55%" stop-color="${t.sky2}"/>
          <stop offset="100%" stop-color="${t.sky3}"/>
        </linearGradient>
        <linearGradient id="insSun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${t.sun1}"/>
          <stop offset="100%" stop-color="${t.sun2}"/>
        </linearGradient>
      </defs>
      <rect width="360" height="190" fill="url(#insSky)"/>
      <circle cx="304" cy="82" r="44" fill="${t.sun1}" opacity="${sunHaloOp}"/>
      <circle cx="304" cy="82" r="27" fill="url(#insSun)" opacity="${sunOp}"/>
      <ellipse cx="94" cy="36" rx="34" ry="10" fill="${cloudFill}" opacity="0.52"/>
      <ellipse cx="206" cy="24" rx="42" ry="10" fill="${cloudFill}" opacity="0.42"/>
      <path d="M132 148 L196 74 L246 118 L292 88 L360 148 Z" fill="${t.m1}" opacity="0.82"/>
      <path d="M176 150 L226 94 L268 128 L314 104 L360 150 Z" fill="${t.m2}" opacity="0.66"/>
      <path d="M236 150 L276 114 L318 140 L345 122 L360 150 Z" fill="${t.m3}" opacity="0.48"/>
      <rect x="0" y="146" width="360" height="24" fill="${t.water}" opacity="0.65"/>
      <path d="M140 155 h42 M205 159 h56 M280 154 h36" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="${isDark ? '0.18' : '0.45'}"/>
      <path d="M0 164 Q90 158 190 163 T360 161 L360 190 L0 190 Z" fill="${t.sand}" opacity="0.68"/>
      <path d="M312 152 l6-18 6 18 z M324 153 l5-14 5 14 z M296 154 l4-12 4 12 z" fill="${t.pine}" opacity="0.72"/>
      <path d="M238 48 q4-4 8 0 q4-4 8 0" fill="none" stroke="${t.m3}" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>
      <path d="M260 58 q3-3 6 0 q3-3 6 0" fill="none" stroke="${t.m3}" stroke-width="1.1" stroke-linecap="round" opacity="0.45"/>
    </svg>`;
}
export function cornerArtworkSvg(kind: InspireArtKind, t: AppearancePalette, isDark: boolean) {
  const soft = isDark ? '0.26' : '0.42';
  const subtle = isDark ? '0.14' : '0.22';
  const cloud = isDark ? 'rgba(255,255,255,.08)' : '#FFFFFF';
  if (kind === 'hero-accounts') {
    return `
      <svg viewBox="0 0 360 140" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroAccSky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.sky1}" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="${t.sky3}" stop-opacity="0.95"/>
          </linearGradient>
        </defs>
        <rect width="360" height="140" fill="url(#heroAccSky)"/>
        <circle cx="308" cy="36" r="34" fill="${t.sun1}" opacity="${isDark ? '0.16' : '0.32'}"/>
        <circle cx="308" cy="36" r="19" fill="${t.sun2}" opacity="${isDark ? '0.35' : '0.52'}"/>
        <ellipse cx="145" cy="24" rx="40" ry="9" fill="${cloud}" opacity="0.45"/>
        <path d="M180 110 Q245 78 360 94 L360 140 L150 140 Z" fill="${t.m1}" opacity="0.55"/>
        <path d="M0 118 Q105 98 220 114 T360 104 L360 140 L0 140 Z" fill="${t.water}" opacity="0.55"/>
        <path d="M0 128 Q120 112 245 126 T360 118 L360 140 L0 140 Z" fill="${t.m2}" opacity="0.34"/>
        <path d="M276 112 L279 84 L285 84 L288 112 Z" fill="${t.pine}" opacity="0.42"/>
        <circle cx="282" cy="81" r="3" fill="${t.sun1}" opacity="0.8"/>
      </svg>`;
  }
  if (kind === 'hero-strategy') {
    return `
      <svg viewBox="0 0 360 140" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroStrSky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.sky2}" stop-opacity="0.75"/>
            <stop offset="100%" stop-color="${t.sky3}" stop-opacity="0.95"/>
          </linearGradient>
        </defs>
        <rect width="360" height="140" fill="url(#heroStrSky)"/>
        <circle cx="306" cy="34" r="36" fill="${t.sun1}" opacity="${isDark ? '0.16' : '0.3'}"/>
        <path d="M306 20 l2.5 8 8 2.5 -8 2.5 -2.5 8 -2.5-8 -8-2.5 8-2.5z" fill="${t.sun2}" opacity="${isDark ? '0.72' : '0.85'}"/>
        <path d="M110 140 L185 96 L225 112 L288 54 L360 116 L360 140 Z" fill="${t.m1}" opacity="0.62"/>
        <path d="M180 140 L242 94 L274 108 L324 72 L360 106 L360 140 Z" fill="${t.m2}" opacity="0.48"/>
        <path d="M168 124 Q226 102 288 58" fill="none" stroke="${t.brand}" stroke-width="1.8" stroke-dasharray="4 4" opacity="0.52"/>
        <path d="M312 118 l5-15 5 15 z M324 121 l4-11 4 11 z" fill="${t.pine}" opacity="0.45"/>
      </svg>`;
  }
  if (kind === 'hero-budget') {
    return `
      <svg viewBox="0 0 360 175" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroBudG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.surface}" stop-opacity="0"/>
            <stop offset="100%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.28' : '0.42'}"/>
          </linearGradient>
        </defs>
        <rect width="360" height="175" fill="url(#heroBudG)"/>
        <circle cx="315" cy="34" r="42" fill="${t.sun1}" opacity="${isDark ? '0.12' : '0.26'}"/>
        <ellipse cx="242" cy="30" rx="34" ry="8" fill="${cloud}" opacity="0.5"/>
        <path d="M170 175 Q242 122 360 132 L360 175 Z" fill="${t.m1}" opacity="${subtle}"/>
        <path d="M210 175 Q285 138 360 150 L360 175 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M140 52 Q235 32 355 58" fill="none" stroke="${t.brand2}" stroke-width="1.3" opacity="${subtle}"/>
      </svg>`;
  }
  if (kind === 'hero-expense') {
    return `
      <svg viewBox="0 0 360 175" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroExpG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.surface}" stop-opacity="0"/>
            <stop offset="100%" stop-color="${t.sky3}" stop-opacity="${isDark ? '0.26' : '0.38'}"/>
          </linearGradient>
        </defs>
        <rect width="360" height="175" fill="url(#heroExpG)"/>
        <circle cx="318" cy="40" r="38" fill="${t.sun2}" opacity="${isDark ? '0.1' : '0.18'}"/>
        <path d="M180 144 L236 106 L278 128 L322 98 L360 132 L360 175 L160 175 Z" fill="${t.m1}" opacity="${subtle}"/>
        <path d="M0 154 Q115 142 230 156 T360 148 L360 175 L0 175 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M235 162 h48 M255 167 h34" stroke="${t.brand}" stroke-width="1.2" stroke-linecap="round" opacity="0.28"/>
      </svg>`;
  }
  if (kind === 'hero-overview') {
    return `
      <svg viewBox="0 0 360 190" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroOvG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.2' : '0.3'}"/>
            <stop offset="100%" stop-color="${t.sky3}" stop-opacity="${isDark ? '0.3' : '0.45'}"/>
          </linearGradient>
        </defs>
        <rect width="360" height="190" fill="url(#heroOvG)"/>
        <circle cx="272" cy="108" r="56" fill="${t.sun1}" opacity="${isDark ? '0.1' : '0.22'}"/>
        <path d="M0 162 Q95 142 195 160 T360 145 L360 190 L0 190 Z" fill="${t.m1}" opacity="${subtle}"/>
        <path d="M18 112 Q110 88 210 104" fill="none" stroke="${t.brand2}" stroke-width="1.2" stroke-dasharray="3 5" opacity="${subtle}"/>
        <path d="M312 152 l5-14 5 14 z M324 155 l4-10 4 10 z" fill="${t.pine}" opacity="${subtle}"/>
      </svg>`;
  }
  if (kind === 'hero-utilization') {
    return `
      <svg viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroUtG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.surface}" stop-opacity="0"/>
            <stop offset="100%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.22' : '0.36'}"/>
          </linearGradient>
        </defs>
        <rect width="360" height="220" fill="url(#heroUtG)"/>
        <circle cx="282" cy="96" r="64" fill="${t.brand2}" opacity="${isDark ? '0.09' : '0.13'}"/>
        <path d="M140 190 Q225 166 360 184 L360 220 L120 220 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M165 204 Q255 184 360 198 L360 220 L150 220 Z" fill="${t.m1}" opacity="${subtle}"/>
      </svg>`;
  }
  if (kind === 'hero-milestones') {
    return `
      <svg viewBox="0 0 360 110" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="heroMilG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.sky2}" stop-opacity="${isDark ? '0.18' : '0.35'}"/>
            <stop offset="100%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.32' : '0.52'}"/>
          </linearGradient>
        </defs>
        <rect width="360" height="110" fill="url(#heroMilG)"/>
        <circle cx="48" cy="55" r="46" fill="${t.sun1}" opacity="${isDark ? '0.12' : '0.26'}"/>
        <path d="M210 110 L264 48 L302 82 L332 58 L360 92 L360 110 Z" fill="${t.m1}" opacity="${soft}"/>
        <path d="M250 110 L296 66 L326 90 L360 72 L360 110 Z" fill="${t.m2}" opacity="${subtle}"/>
        <path d="M294 26 l2 6 6 2 -6 2 -2 6 -2-6 -6-2 6-2z" fill="${t.sun2}" opacity="0.65"/>
        <circle cx="332" cy="34" r="2.2" fill="${t.brand}" opacity="0.45"/>
      </svg>`;
  }
  if (kind === 'hero-paid') {
    return `
      <svg viewBox="0 0 360 170" preserveAspectRatio="xMidYMid slice">
        <circle cx="322" cy="24" r="44" fill="${t.sun1}" opacity="${isDark ? '0.1' : '0.24'}"/>
        <path d="M0 144 Q110 112 220 136 T360 116 L360 170 L0 170 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M296 14 l1.8 5 5 1.8 -5 1.8 -1.8 5 -1.8-5 -5-1.8 5-1.8z" fill="${t.brand}" opacity="0.45"/>
      </svg>`;
  }
  if (kind === 'hero-profile') {
    return `
      <svg viewBox="0 0 360 90" preserveAspectRatio="xMidYMid slice">
        <circle cx="314" cy="28" r="34" fill="${t.sun1}" opacity="${isDark ? '0.14' : '0.28'}"/>
        <path d="M160 90 Q245 48 360 66 L360 90 Z" fill="${t.m1}" opacity="${soft}"/>
        <path d="M210 90 Q285 60 360 74 L360 90 Z" fill="${t.water}" opacity="${soft}"/>
      </svg>`;
  }
  if (kind === 'tile-pay') {
    return `
      <svg viewBox="0 0 180 95" preserveAspectRatio="xMidYMid slice">
        <path d="M0 68 Q45 50 95 66 T180 54 L180 95 L0 95 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M0 78 Q55 62 115 76 T180 68 L180 95 L0 95 Z" fill="${t.pos}" opacity="${isDark ? '0.1' : '0.12'}"/>
        <circle cx="152" cy="22" r="14" fill="${t.pos}" opacity="${isDark ? '0.1' : '0.12'}"/>
      </svg>`;
  }
  if (kind === 'tile-chg') {
    return `
      <svg viewBox="0 0 180 95" preserveAspectRatio="xMidYMid slice">
        <circle cx="154" cy="22" r="18" fill="${t.sun2}" opacity="${isDark ? '0.1' : '0.16'}"/>
        <path d="M0 72 Q60 56 120 70 T180 58 L180 95 L0 95 Z" fill="${t.sand}" opacity="${isDark ? '0.14' : '0.22'}"/>
      </svg>`;
  }
  if (kind === 'hero-calendar') {
    return `
      <svg viewBox="0 0 360 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="calSkyG" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0%" stop-color="${t.sky1}" stop-opacity="${isDark ? '0.22' : '0.36'}"/>
            <stop offset="100%" stop-color="${t.sky3}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="360" height="72" fill="url(#calSkyG)"/>
        <circle cx="318" cy="22" r="16" fill="${t.sun1}" opacity="${isDark ? '0.15' : '0.3'}"/>
        <path d="M0 248 Q110 228 235 246 T360 236 L360 280 L0 280 Z" fill="${t.water}" opacity="${isDark ? '0.1' : '0.15'}"/>
      </svg>`;
  }
  if (kind === 'corner-wave') {
    return `
      <svg viewBox="0 0 360 120" preserveAspectRatio="xMidYMid slice">
        <path d="M180 120 Q255 86 360 102 L360 120 Z" fill="${t.water}" opacity="${subtle}"/>
        <path d="M220 120 Q295 96 360 110 L360 120 Z" fill="${t.m1}" opacity="${subtle}"/>
      </svg>`;
  }
  if (kind === 'corner-ridge') {
    return `
      <svg viewBox="0 0 360 120" preserveAspectRatio="xMidYMid slice">
        <path d="M210 120 L268 76 L306 100 L338 82 L360 104 L360 120 Z" fill="${t.m1}" opacity="${subtle}"/>
        <circle cx="322" cy="28" r="16" fill="${t.sun1}" opacity="${isDark ? '0.1' : '0.2'}"/>
      </svg>`;
  }
  if (kind === 'corner-leaf') {
    return `
      <svg viewBox="0 0 360 140" preserveAspectRatio="xMidYMid slice">
        <circle cx="332" cy="24" r="28" fill="${t.brand2}" opacity="${isDark ? '0.08' : '0.1'}"/>
        <path d="M312 138 Q326 98 354 84 Q346 118 312 138 Z" fill="${t.pos}" opacity="${isDark ? '0.12' : '0.14'}"/>
        <path d="M292 140 Q306 112 328 104 Q322 126 292 140 Z" fill="${t.brand}" opacity="${isDark ? '0.1' : '0.12'}"/>
      </svg>`;
  }
  return '';
}
