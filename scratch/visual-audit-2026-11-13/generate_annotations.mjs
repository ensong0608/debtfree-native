import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/scratch/visual-audit-2026-11-13';
const OUT_DIR = path.join(ROOT, 'annotations');
const TMP_DIR = path.join(ROOT, '_html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Board geometry:
// Studio canvas: 1680 x 1060
// Top bar: y=0..82
// Two phones centered:
//   Phone 1 (Left): x=450, y=108, w=368, h=798 (exact 1440:3120 = 0.461538 ratio) -> right edge 818
//   Phone 2 (Right): x=862, y=108, w=368, h=798 -> right edge 1230
// Left gutter cards: x=36..412 (w=376)
// Right gutter cards: x=1268..1644 (w=376)
// Bottom footer strip: y=934..1040

const P1 = { x: 452, y: 112, w: 368, h: 798 };
const P2 = { x: 860, y: 112, w: 368, h: 798 };

function buildBoardHTML(board) {
  const cards = [];
  const boxes = [];
  const paths = [];

  for (const c of board.callouts) {
    const phone = c.phone === 1 ? P1 : P2;
    // box [x%, y%, w%, h%] inside phone
    const bx = phone.x + (c.box[0] / 100) * phone.w;
    const by = phone.y + (c.box[1] / 100) * phone.h;
    const bw = (c.box[2] / 100) * phone.w;
    const bh = (c.box[3] / 100) * phone.h;

    const isMajor = c.severity === 'major';
    const stroke = isMajor ? '#FF4D6A' : '#FFB020';
    const fill = isMajor ? 'rgba(255, 77, 106, 0.14)' : 'rgba(255, 176, 32, 0.14)';
    const badgeText = isMajor ? 'MAJOR' : 'POLISH';

    boxes.push(`
      <div class="annot-box" style="left:${bx.toFixed(1)}px;top:${by.toFixed(1)}px;width:${bw.toFixed(1)}px;height:${bh.toFixed(1)}px;border-color:${stroke};background:${fill};">
        <span class="annot-num" style="background:${stroke};">${c.num}</span>
      </div>
    `);

    const isLeft = c.side === 'left';
    const cx = isLeft ? 36 : 1268;
    const cw = 376;
    const cy = c.cardY;

    // Anchor on box edge facing gutter
    const startX = isLeft ? bx : bx + bw;
    const startY = by + bh * (c.anchorY ?? 0.5);
    const endX = isLeft ? cx + cw : cx;
    const endY = cy + 44;

    const dx = (endX - startX) * 0.45;
    const cp1x = startX + dx;
    const cp1y = startY;
    const cp2x = endX - dx;
    const cp2y = endY;

    paths.push(`
      <path d="M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}"
            fill="none" stroke="${stroke}" stroke-width="2.5" stroke-dasharray="6 4" opacity="0.92" />
      <circle cx="${startX.toFixed(1)}" cy="${startY.toFixed(1)}" r="5" fill="${stroke}" />
      <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5" fill="${stroke}" />
    `);

    cards.push(`
      <div class="callout-card" style="left:${cx}px;top:${cy}px;width:${cw}px;border-left:4px solid ${stroke};">
        <div class="callout-head">
          <span class="pill" style="background:${stroke};">${c.num} · ${badgeText}</span>
          <span class="screen-tag">${c.screenTag}</span>
        </div>
        <div class="callout-title">${c.title}</div>
        <div class="callout-body">${c.text}</div>
        ${c.reviewer ? `<div class="callout-meta">Source: ${c.reviewer}</div>` : ''}
      </div>
    `);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1680px;
    height: 1060px;
    overflow: hidden;
    background: radial-gradient(circle at 50% 0%, #162244 0%, #090E1A 70%);
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #F3F6FC;
    position: relative;
  }
  .topbar {
    position: absolute; left: 36px; right: 36px; top: 22px; height: 64px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 14px;
  }
  .brand-row { display: flex; align-items: center; gap: 14px; }
  .brand-pill {
    background: linear-gradient(135deg, #0051FB, #27EEE9);
    color: #070D5B; font-weight: 800; font-size: 13px; letter-spacing: 0.06em;
    padding: 6px 12px; border-radius: 999px; text-transform: uppercase;
  }
  h1 { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; color: #FFFFFF; }
  .subtitle { font-size: 14px; color: #9FB0D1; margin-top: 2px; }
  .legend { display: flex; gap: 16px; align-items: center; font-size: 13px; color: #C7D4EC; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .phone-frame {
    position: absolute;
    border-radius: 28px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.65), 0 0 0 2px rgba(255,255,255,0.14);
    background: #000;
  }
  .phone-frame img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .phone-caption {
    position: absolute;
    font-size: 13px; font-weight: 600; color: #BFD0F0;
    text-align: center;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px;
    padding: 5px 14px;
  }
  .annot-box {
    position: absolute;
    border: 2.5px dashed;
    border-radius: 10px;
    z-index: 5;
  }
  .annot-num {
    position: absolute;
    top: -12px; left: -12px;
    width: 24px; height: 24px;
    border-radius: 50%;
    color: #080C18;
    font-weight: 800; font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }
  svg.leaders {
    position: absolute; left: 0; top: 0; width: 1680px; height: 1060px;
    pointer-events: none; z-index: 6;
  }
  .callout-card {
    position: absolute;
    background: rgba(17, 25, 45, 0.94);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    padding: 13px 15px;
    box-shadow: 0 14px 32px rgba(0,0,0,0.45);
    z-index: 7;
  }
  .callout-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px;
  }
  .pill {
    font-size: 11px; font-weight: 800; color: #090D18;
    padding: 3px 9px; border-radius: 999px; letter-spacing: 0.04em;
  }
  .screen-tag { font-size: 11px; color: #8CA0C6; font-weight: 600; }
  .callout-title { font-size: 14.5px; font-weight: 700; color: #FFFFFF; margin-bottom: 4px; }
  .callout-body { font-size: 12.8px; line-height: 1.42; color: #CFD9ED; }
  .callout-meta { font-size: 11px; color: #7DA2E8; margin-top: 6px; font-weight: 600; }
  .footer-bar {
    position: absolute; left: 36px; right: 36px; bottom: 20px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 12px;
    padding: 11px 18px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; color: #B9C8E4;
  }
  .footer-bar strong { color: #27EEE9; }
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="brand-row">
        <span class="brand-pill">BitLess Visual Audit · 2026-11-13</span>
        <h1>${board.title}</h1>
      </div>
      <div class="subtitle">${board.subtitle}</div>
    </div>
    <div class="legend">
      <span><i class="dot" style="background:#FF4D6A"></i>Major UX / Layout Issue</span>
      <span><i class="dot" style="background:#FFB020"></i>Polish / Hierarchy / Brand Alignment</span>
    </div>
  </div>

  <div class="phone-frame" style="left:${P1.x}px;top:${P1.y}px;width:${P1.w}px;height:${P1.h}px;">
    <img src="file:///${ROOT}/${board.img1}" />
  </div>
  <div class="phone-caption" style="left:${P1.x}px;top:${P1.y + P1.h + 12}px;width:${P1.w}px;">${board.cap1}</div>

  <div class="phone-frame" style="left:${P2.x}px;top:${P2.y}px;width:${P2.w}px;height:${P2.h}px;">
    <img src="file:///${ROOT}/${board.img2}" />
  </div>
  <div class="phone-caption" style="left:${P2.x}px;top:${P2.y + P2.h + 12}px;width:${P2.w}px;">${board.cap2}</div>

  ${boxes.join('\n')}
  <svg class="leaders" viewBox="0 0 1680 1060">${paths.join('\n')}</svg>
  ${cards.join('\n')}

  <div class="footer-bar">
    <span><strong>Audit Condition:</strong> Pixel 1440×3120 · OS Font Scale 115% · Dynamic Type ON (ignore translucent Android DevTools gear)</span>
    <span><strong>Takeaway:</strong> ${board.takeaway}</span>
  </div>
</body>
</html>`;
}

const BOARDS = [
  {
    out: '01-progress-overview-annotations.png',
    title: 'Progress → Overview: Above-the-Fold Clipping & Label Wrapping',
    subtitle: 'Side-by-side Light & Dark capture showing how 115% scale + tall hero cards push Recorded Activity behind the floating dock',
    img1: 'light/24-progress-overview.png',
    cap1: 'Light Mode · light/24-progress-overview.png',
    img2: 'dark/24-progress-overview.png',
    cap2: 'Dark Mode · dark/24-progress-overview.png',
    takeaway: 'Compress Balance Scope + Snapshot ring card by ~110dp so all 4 Activity rows clear the dock unclipped.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 130, severity: 'polish',
        box: [3, 17, 94, 12],
        screenTag: 'Scope Selector · Both Themes',
        title: 'Hey! This scope control is chunky & redundant',
        text: 'Tall 2-line segmented box + uppercase "BALANCE SCOPE" header repeats "Cards & Loans" directly above "BALANCE SNAPSHOT · Cards & Loans". Trim height to a slim 1-line pill.',
        reviewer: 'Luna High · Manager'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 365, severity: 'major',
        box: [3, 30.5, 94, 26.5],
        screenTag: 'Balance Snapshot Hero',
        title: 'Hey! Hero eats 27% height & breaks brand palette',
        text: 'Excess top/bottom padding pushes Recorded Activity into the dock, while the Indigo/purple arc and active pill mismatch the #0051FB cobalt BitLess icon.',
        reviewer: 'Luna High · Manager'
      },
      {
        num: 3, phone: 1, side: 'left', cardY: 635, severity: 'major',
        box: [4, 65, 38, 19.5], anchorY: 0.65,
        screenTag: 'Payments Recorded Column',
        title: 'Hey! Narrow left pane wraps into 3 awkward lines',
        text: '"12 confirmed entries" breaks across 3 lines inside the purple column at 115% scale. Flatten to a single summary header bar above clean 1-line metric rows.',
        reviewer: 'Manager Audit'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 220, severity: 'polish',
        box: [3, 30.5, 94, 26.5],
        screenTag: 'Dark Snapshot Contrast',
        title: 'Hey! Dark purple wash flattens surface hierarchy',
        text: 'Using tinted #221D41 cards on #121215 dark mode feels slightly muddy vs crisp BitLess Cobalt (#0051FB) / Turquoise (#27EEE9) accents on slate surfaces.',
        reviewer: 'Manager Audit'
      },
      {
        num: 5, phone: 2, side: 'right', cardY: 575, severity: 'major',
        box: [42, 65, 54, 20], anchorY: 0.78,
        screenTag: 'Bottom Dock Clipping · Both Themes',
        title: 'Hey! "Net balance change" is sliced by the dock!',
        text: '"Balance reduction" & "Net balance change" wrap to 2 lines, and "change" is literally cut in half behind the floating dock before any scroll in Light & Dark.',
        reviewer: 'Luna High · Manager'
      }
    ]
  },
  {
    out: '02-progress-utilization-milestones-annotations.png',
    title: 'Progress → Utilization & Milestones: Asymmetric Cards & Floating Timeline',
    subtitle: 'Left-heavy stacked metrics create empty voids next to the Utilization donut, while Milestones mixes uncarded timeline nodes with bordered cards',
    img1: 'light/26-progress-utilization.png',
    cap1: 'Utilization · light/26-progress-utilization.png',
    img2: 'dark/27-progress-milestones.png',
    cap2: 'Milestones · dark/27-progress-milestones.png',
    takeaway: 'Use a balanced 2×2 metric grid below a compact Utilization ring, and enclose Milestones path items inside a unified card.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 160, severity: 'major',
        box: [4, 17, 92, 41.5], anchorY: 0.35,
        screenTag: 'Utilization Hero Card',
        title: 'Hey! 5 stacked metrics leave huge blank voids',
        text: 'Stacking Total limit → To reach 30% down the left column stretches the card to 42% viewport height, stranding empty whitespace above and below the right donut.',
        reviewer: 'Manager Audit'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 420, severity: 'polish',
        box: [56, 32, 36, 19], anchorY: 0.5,
        screenTag: 'Donut Center Label',
        title: 'Hey! "Utilization Watch" wraps tightly inside ring',
        text: 'At 115% font scale, "Utilization Watch" breaks into two cramped lines inside the circle. A concise single-line pill ("Watch · 47%") breathes much better.',
        reviewer: 'Manager Audit'
      },
      {
        num: 3, phone: 1, side: 'left', cardY: 660, severity: 'major',
        box: [4, 72.5, 92, 13], anchorY: 0.5,
        screenTag: 'Cards to Review',
        title: 'Hey! Chase alert card is half-buried by the dock',
        text: 'The most actionable card on the screen (Chase at 50.1% · High) sits sliced behind the bottom tab bar until the user scrolls.',
        reviewer: 'Manager Audit'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 160, severity: 'polish',
        box: [5, 16.5, 90, 15.5], anchorY: 0.5,
        screenTag: 'Milestones Header',
        title: 'Hey! Uncarded trophy floats on bare canvas',
        text: 'Unlike every other tab hero, "2 achievements" sits directly on the raw background with loose outer spacing and an oversized double-ring trophy.',
        reviewer: 'Manager Audit'
      },
      {
        num: 5, phone: 2, side: 'right', cardY: 420, severity: 'major',
        box: [5, 34.5, 90, 29.5], anchorY: 0.75,
        screenTag: 'Your Path Timeline',
        title: 'Hey! Timeline line fades awkwardly into thin air',
        text: 'Vertical rail trails off into blank space before hitting an isolated bordered box ("NEXT UNLOCK · CURRENT GOAL"). Put the full path inside one cohesive card.',
        reviewer: 'Manager Audit'
      },
      {
        num: 6, phone: 2, side: 'right', cardY: 685, severity: 'major',
        box: [5, 79, 90, 7.5], anchorY: 0.5,
        screenTag: 'Payoff Milestones',
        title: 'Hey! "Payoff milestones" sliced behind the dock',
        text: 'Subtitle "Locked · complete history needed" grazes the floating dock lip. Compacting the trophy hero into a banner reveals this section cleanly.',
        reviewer: 'Manager Audit'
      }
    ]
  },
  {
    out: '03-home-welcome-annotations.png',
    title: 'Welcome Sheet & Home Tab: Greeting Conflict, ISO Date & Fold Push',
    subtitle: 'First-impression flow mixes time-of-day greetings, raw ISO dates, Indigo vs Cobalt brand split, and hides all Payoff Strategy rows below the fold',
    img1: 'light/01-welcome-sheet.png',
    cap1: 'Welcome Modal · light/01-welcome-sheet.png',
    img2: 'light/02-home.png',
    cap2: 'Home Tab · light/02-home.png',
    takeaway: 'Fix "Good morning" + "2026-11-18" in Welcome, default accent to BitLess Cobalt (#0051FB), and tighten Your Accounts to expose Chase #1.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 185, severity: 'major',
        box: [3, 71, 94, 7.5], anchorY: 0.5,
        screenTag: 'UI_PREFERENCES Rule #2',
        title: 'Hey! "Good morning" violates greeting rules',
        text: 'UI_PREFERENCES explicitly forbids time-of-day greetings ("Hi, Name" only), AND it contradicts Home right behind it ("Hi, Ud0nTkNowM3").',
        reviewer: 'Manager Audit · UI_PREFERENCES'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 465, severity: 'major',
        box: [3, 81.5, 94, 7.5], anchorY: 0.5,
        screenTag: 'Date & Copy Polish',
        title: 'Hey! Raw ISO date "2026-11-18" in Welcome!',
        text: '"Booking minimum - Upcoming\\n2026-11-18" reads like a debug string. Format cleanly as "Booking minimum · Due Nov 18" matching Upcoming cards.',
        reviewer: 'Manager Audit'
      },
      {
        num: 3, phone: 2, side: 'right', cardY: 150, severity: 'polish',
        box: [3, 5, 94, 39], anchorY: 0.15,
        screenTag: 'Brand Palette Mismatch',
        title: 'Hey! Indigo accent fights BitLess Cobalt logo',
        text: 'Header logo uses vivid #0051FB cobalt + sky/mint, while Settings gear, hero card (#221D41), and pills default to Indigo (#5147A8). Make Cobalt the default.',
        reviewer: 'Manager Audit · UI_PREFERENCES'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 430, severity: 'major',
        box: [3, 46, 94, 31], anchorY: 0.5,
        screenTag: 'Vertical Density',
        title: 'Hey! Carousel card has too much vertical padding',
        text: 'The "Your accounts" card eats 31% of viewport height for 4 lines of data + pager dots, pushing every single Payoff Strategy row completely off-screen.',
        reviewer: 'Manager Audit'
      },
      {
        num: 5, phone: 2, side: 'right', cardY: 690, severity: 'major',
        box: [3, 78.5, 94, 6], anchorY: 0.5,
        screenTag: 'Above-the-Fold Continuity',
        title: 'Hey! Payoff Strategy heading stranded at dock lip',
        text: 'Users see "Payoff strategy / See all >" sitting on top of the dock with zero account rows underneath. Trim 70dp above to surface Chase #1 cleanly.',
        reviewer: 'Manager Audit'
      }
    ]
  },
  {
    out: '04-accounts-strategy-annotations.png',
    title: 'Accounts & Strategy: Orphaned Filter, Line Wrap & Triple Header Stack',
    subtitle: 'Category dropdown leaves an empty left gutter, Discover violates the unsplit Est. payoff rule, and Strategy stacks 3 navigation tiers above Payoff Order',
    img1: 'light/04-accounts-list.png',
    cap1: 'Accounts List · light/04-accounts-list.png',
    img2: 'dark/11-accounts-strategy.png',
    cap2: 'Debt Strategy (Dark) · dark/11-accounts-strategy.png',
    takeaway: 'Merge Category filter into Search/Sort bar, keep Discover APR·Est. on 1 line, and combine Strategy header toggles.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 190, severity: 'polish',
        box: [3, 32.5, 94, 6.2], anchorY: 0.5,
        screenTag: 'Filter Row Alignment',
        title: 'Hey! Lonely filter dropdown leaves 55% dead space',
        text: '"All categories v" floats right-aligned on its own row above "Search debts | Name". Move it into a clean horizontal chip strip or inline bar.',
        reviewer: 'Manager Audit'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 465, severity: 'major',
        box: [4, 65.8, 92, 9.6], anchorY: 0.5,
        screenTag: 'UI_PREFERENCES · Est. Payoff Rule',
        title: 'Hey! Discover splits "Est. May 2028" onto 2 lines!',
        text: 'Booking & Chase fit on 1 subtitle line, while Discover wraps "23.45% APR ·\\nEst. May 2028" at 115% scale — breaking the "keep Est. <Payoff> unsplit" rule.',
        reviewer: 'Manager Audit · UI_PREFERENCES'
      },
      {
        num: 3, phone: 1, side: 'left', cardY: 700, severity: 'polish',
        box: [4, 48, 92, 16.8], anchorY: 0.5,
        screenTag: 'Surface Consistency',
        title: 'Hey! Flat hairline rows vs rounded cards elsewhere',
        text: 'CARDS & LOANS uses bare transparent hairline dividers on cream canvas, contrasting with crisp elevated cards on Budget, Progress, and Settings.',
        reviewer: 'Manager Audit'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 190, severity: 'major',
        box: [3, 9.5, 94, 26], anchorY: 0.35,
        screenTag: 'Header Stack Compression',
        title: 'Hey! Triple stacked headers crush Payoff Order',
        text: '"Accounts | Strategy" tabs + "Debt strategy | Mortgage strategy" pills + dark hero eat 36% of the viewport before "Your method" even begins.',
        reviewer: 'Manager Audit'
      },
      {
        num: 5, phone: 2, side: 'right', cardY: 560, severity: 'major',
        box: [3, 73, 94, 7.5], anchorY: 0.5,
        screenTag: 'Bottom CTA + Dock Clip',
        title: 'Hey! "02 Discover" cut in half behind CTA dock!',
        text: 'The two-tier "+ Add Debt Account" dock cuts right through "02 Discover". Merging Strategy sub-pills into the hero frees enough height to show 01 & 02.',
        reviewer: 'Manager Audit'
      }
    ]
  },
  {
    out: '05-transactions-budget-annotations.png',
    title: 'Transactions → Upcoming & Scheduled: Grammar Bug, Pills & Row Clip',
    subtitle: 'Upcoming shows "1 items" + 4 competing pill types, while Scheduled repeats "Planned installments" and clips the HOME row behind the CTA dock',
    img1: 'light/17-transactions-upcoming.png',
    cap1: 'Transactions · light/17-transactions-upcoming.png',
    img2: 'light/18-transactions-scheduled.png',
    cap2: 'Scheduled · light/18-transactions-scheduled.png',
    takeaway: 'Fix "1 item" pluralization, replace repeated "Planned installments" card subtitles with bill details, and unify pill styles.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 200, severity: 'major',
        box: [4, 31.2, 92, 4.8], anchorY: 0.5,
        screenTag: 'Copy & Pluralization',
        title: 'Hey! Grammar bug: "1 items" pill',
        text: 'November 2026 displays "1 items" instead of "1 item". Also notice 4 competing pill styles on one screen ("9 unpaid", "1 items", "Unpaid", "Pay").',
        reviewer: 'Manager Audit'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 480, severity: 'polish',
        box: [4, 36.5, 92, 16], anchorY: 0.65,
        screenTag: 'Card Density · Upcoming',
        title: 'Hey! Too many pill badges per bill card',
        text: 'Every card repeats an amber "Unpaid" badge even inside an "Unpaid" section, creating visual noise. Keep status inline ("Minimum payment · Unpaid") beside one clean Pay CTA.',
        reviewer: 'Manager Audit'
      },
      {
        num: 3, phone: 2, side: 'right', cardY: 230, severity: 'polish',
        box: [5, 56, 90, 23], anchorY: 0.45,
        screenTag: 'Scheduled Installments Copy',
        title: 'Hey! Cards repeat "Planned installments" 3 times',
        text: 'Right beneath the "Planned installments" heading, every collapsed card says "Planned installments" instead of showing count & total ("3 steps · $600/mo").',
        reviewer: 'Manager Audit'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 540, severity: 'major',
        box: [5, 72.5, 90, 8], anchorY: 0.5,
        screenTag: 'Casing & Dock Clipping',
        title: 'Hey! "HOME" ALL-CAPS & row clipped by CTA dock',
        text: 'Inconsistent capitalization ("HOME" vs "Discover") and the "HOME" card is sliced right across its subtitle & "Show" toggle by the bottom Add Transaction dock.',
        reviewer: 'Manager Audit'
      }
    ]
  },
  {
    out: '06-budget-settings-dock-annotations.png',
    title: 'Budget, Appearance & Dock: Indigo Default & Stranded Label',
    subtitle: 'Appearance defaults to Indigo beside Cobalt, Budget clips "Subscriptions", and Compact Dock centers "Budget" under tab 3 instead of tab 4',
    img1: 'light/20-budget.png',
    cap1: 'Budget · light/20-budget.png',
    img2: 'dark/29b-appearance-subpage.png',
    cap2: 'Appearance · dark/29b-appearance-subpage.png',
    takeaway: 'Set Cobalt (#0051FB) as default accent, center compact dock label under the active circular pill, and remove duplicate X on subpages.',
    callouts: [
      {
        num: 1, phone: 1, side: 'left', cardY: 165, severity: 'polish',
        box: [4, 12, 92, 37], anchorY: 0.45,
        screenTag: 'Budget Hero · Indigo vs Cobalt',
        title: 'Hey! Indigo "Edit" & "34.3%" clash with Cobalt logo',
        text: 'Budget breakdown & icons look crisp, but Edit, 34.3% DTI, and "+ Add Monthly Expense" render in muted Indigo while the BitLess header mark is Cobalt (#0051FB).',
        reviewer: 'Luna Max + Manager'
      },
      {
        num: 2, phone: 1, side: 'left', cardY: 455, severity: 'major',
        box: [4, 75.5, 92, 5.5], anchorY: 0.5,
        screenTag: 'Bottom CTA Dock Clip',
        title: 'Hey! "Subscriptions" sliced off above floating CTA',
        text: 'The 3rd category row ("Subscriptions") peeks out halfway behind the "+ Add Monthly Expense" tier, reducing initial fold scanability.',
        reviewer: 'Manager Audit'
      },
      {
        num: 3, phone: 1, side: 'left', cardY: 710, severity: 'major',
        box: [22, 85, 58, 11], anchorY: 0.72,
        screenTag: 'Compact Dock Bug (UI_PREFERENCES L131)',
        title: 'Hey! "Budget" label stranded under Tab 3 instead of Tab 4!',
        text: 'Flash Low caught this: FiveTabShell compact mode centers the text label across full dock width (under Transactions), leaving it unaligned under the active Budget pill.',
        reviewer: 'Flash Low + Manager'
      },
      {
        num: 4, phone: 2, side: 'right', cardY: 160, severity: 'polish',
        box: [3, 4.5, 94, 7.5], anchorY: 0.5,
        screenTag: 'Subpage Header Redundancy',
        title: 'Hey! Dual "<" Back AND "X" Close on subpage',
        text: 'Appearance is a Settings subpage, yet renders both "<" and "X" in the top bar. Keep "<" Back on subpages and reserve "X" for top-level sheets.',
        reviewer: 'Flash Med'
      },
      {
        num: 5, phone: 2, side: 'right', cardY: 460, severity: 'major',
        box: [7, 36.8, 86, 6.8], anchorY: 0.5,
        screenTag: 'Root Cause of Brand Drift',
        title: 'Hey! Indigo is selected by default right beside Cobalt!',
        text: 'This explains why every hero, toggle, and tab clashes with the Cobalt BitLess icon: switching default Accent to Cobalt (#0051FB) aligns the whole app.',
        reviewer: 'Manager + Luna XHigh'
      }
    ]
  }
];

for (const b of BOARDS) {
  const htmlPath = path.join(TMP_DIR, b.out.replace('.png', '.html'));
  const pngPath = path.join(OUT_DIR, b.out);
  fs.writeFileSync(htmlPath, buildBoardHTML(b), 'utf8');
  execFileSync(EDGE, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1680,1060',
    `--screenshot=${pngPath}`,
    `file:///${htmlPath}`
  ]);
  console.log('Rendered:', pngPath);
}
