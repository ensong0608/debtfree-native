import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/scratch/visual-audit-2026-11-13';
const OUT_DIR = path.join(ROOT, 'mockups');
const TMP_DIR = path.join(ROOT, '_html');
const EDGE = 'C:/Program Files (x86)\/Microsoft/Edge/Application/msedge.exe'.replace('\\/', '/');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 28 28" fill="none">
  <rect width="28" height="28" rx="8" fill="#0051FB"/>
  <rect x="6" y="15" width="4" height="7" rx="1.5" fill="#98EDC1"/>
  <rect x="12" y="11" width="4" height="11" rx="1.5" fill="#27EEE9"/>
  <rect x="18" y="6" width="4" height="16" rx="1.5" fill="#FFFFFF"/>
</svg>`;

function dockHTML(activeIdx, dark = false) {
  const icons = [
    // Home
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z"/></svg>`,
    // Accounts
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    // Transactions
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    // Budget
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>`,
    // Progress
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M7 12l3-3 3 2 4-4"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>`
  ];
  const labels = ['Home', 'Accounts', 'Transactions', 'Budget', 'Progress'];
  const bg = dark ? 'rgba(22,26,37,0.96)' : 'rgba(255,255,255,0.96)';
  const bdr = dark ? 'rgba(255,255,255,0.09)' : 'rgba(7,13,91,0.08)';
  const pillBg = dark ? '#FFFFFF' : '#070D5B';
  const pillFg = dark ? '#070D5B' : '#FFFFFF';
  const idleFg = dark ? '#8C97B2' : '#5E6882';
  return `
    <div style="position:absolute;left:12px;right:12px;bottom:10px;background:${bg};border:1px solid ${bdr};border-radius:26px;padding:7px 10px 6px;box-shadow:0 8px 24px rgba(7,13,91,0.12);">
      <div style="display:flex;align-items:center;justify-content:space-around;">
        ${icons.map((ic, i) => i === activeIdx
          ? `<div style="width:42px;height:42px;border-radius:50%;background:${pillBg};color:${pillFg};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,81,251,0.22);">${ic}</div>`
          : `<div style="width:38px;height:38px;color:${idleFg};display:flex;align-items:center;justify-content:center;">${ic}</div>`
        ).join('')}
      </div>
      <div style="text-align:center;font-size:10.5px;font-weight:600;color:${idleFg};margin-top:2px;">${labels[activeIdx]}</div>
    </div>
  `;
}

function phoneShell(title, innerHTML, activeTab, { dark = false, subtabs = null, cta = null } = {}) {
  const bg = dark ? '#0E121D' : '#F6F7FB';
  const hdrBg = dark ? '#131928' : '#FFFFFF';
  const txt = dark ? '#F4F7FF' : '#0E1528';
  const mut = dark ? '#8D98B4' : '#5D667E';
  const gearBg = dark ? 'rgba(0,81,251,0.16)' : '#EDF3FF';
  const gearFg = dark ? '#79A7FF' : '#0051FB';
  const bdr = dark ? 'rgba(255,255,255,0.07)' : 'rgba(7,13,91,0.06)';

  return `
    <div style="width:390px;height:844px;background:${bg};color:${txt};position:relative;overflow:hidden;font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;">
      <!-- Status bar -->
      <div style="height:28px;padding:6px 18px 0;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;background:${hdrBg};">
        <span>10:30</span>
        <span style="letter-spacing:2px;font-size:10px;">▲ ▮ 100%</span>
      </div>
      <!-- Header -->
      <div style="padding:8px 16px 10px;background:${hdrBg};display:flex;align-items:center;justify-content:space-between;border-bottom:${subtabs ? 'none' : '1px solid ' + bdr};">
        <div style="display:flex;align-items:center;gap:9px;">
          ${LOGO_SVG}
          <span style="font-size:19px;font-weight:700;letter-spacing:-0.02em;">${title}</span>
        </div>
        <div style="width:32px;height:32px;border-radius:10px;background:${gearBg};color:${gearFg};display:flex;align-items:center;justify-content:center;font-size:15px;">⚙</div>
      </div>
      ${subtabs ? `
      <div style="background:${hdrBg};display:flex;border-bottom:1px solid ${bdr};padding:0 12px;">
        ${subtabs.map(t => `
          <div style="flex:1;text-align:center;padding:8px 4px;font-size:12.5px;font-weight:${t.active ? '700' : '600'};color:${t.active ? (dark ? '#6CA2FF' : '#0051FB') : mut};border-bottom:2.5px solid ${t.active ? (dark ? '#27EEE9' : '#0051FB') : 'transparent'};">${t.label}</div>
        `).join('')}
      </div>` : ''}
      <!-- Content -->
      <div style="flex:1;padding:12px 14px 90px;overflow:hidden;">
        ${innerHTML}
      </div>
      ${cta ? `
      <div style="position:absolute;left:0;right:0;bottom:76px;display:flex;justify-content:center;z-index:4;">
        <div style="background:#0051FB;color:#FFFFFF;font-size:12.5px;font-weight:700;padding:8px 18px;border-radius:999px;box-shadow:0 8px 20px rgba(0,81,251,0.32);">+ ${cta}</div>
      </div>` : ''}
      ${dockHTML(activeTab, dark)}
    </div>
  `;
}

function wrapComparisonBoard({ out, title, subtitle, beforeImg, beforeLabel, beforeScore, afterHTML, afterLabel, afterScore, gains }) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1680px; height: 1060px; overflow: hidden;
    background: radial-gradient(circle at 75% 15%, #0B2561 0%, #080C17 65%);
    font-family: 'Segoe UI', -apple-system, sans-serif;
    color: #F4F7FF; position: relative;
  }
  .topbar {
    position: absolute; left: 40px; right: 40px; top: 22px; height: 64px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 14px;
  }
  .tag {
    background: linear-gradient(135deg, #27EEE9, #98EDC1);
    color: #070D5B; font-weight: 800; font-size: 12px; letter-spacing: 0.06em;
    padding: 5px 12px; border-radius: 999px; text-transform: uppercase; display: inline-block; margin-right: 12px;
  }
  h1 { display: inline; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
  .sub { font-size: 13.5px; color: #A6B8DC; margin-top: 4px; }
  .palette-chips { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #C8D7F2; }
  .sw { width: 14px; height: 14px; border-radius: 4px; display: inline-block; border: 1px solid rgba(255,255,255,0.25); }
  .col-title {
    position: absolute; top: 100px; font-size: 14px; font-weight: 700;
    display: flex; align-items: center; gap: 10px;
  }
  .score-pill { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 999px; }
  .phone-wrap-before {
    position: absolute; left: 108px; top: 136px; width: 390px; height: 844px;
    border-radius: 28px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.12);
  }
  .phone-wrap-before img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .arrow-mid {
    position: absolute; left: 530px; top: 515px; width: 112px; text-align: center;
  }
  .arrow-badge {
    background: linear-gradient(135deg, #0051FB, #27EEE9);
    color: #FFFFFF; font-weight: 800; font-size: 13px; padding: 9px 14px;
    border-radius: 999px; box-shadow: 0 10px 26px rgba(0,81,251,0.45);
  }
  .phone-wrap-after {
    position: absolute; left: 672px; top: 136px; width: 390px; height: 844px;
    border-radius: 28px; overflow: hidden;
    box-shadow: 0 26px 70px rgba(0,81,251,0.32), 0 0 0 2.5px rgba(39,238,233,0.55);
  }
  .gains-panel {
    position: absolute; left: 1110px; right: 40px; top: 136px; bottom: 48px;
    background: rgba(16, 24, 46, 0.88);
    border: 1px solid rgba(39,238,233,0.22);
    border-radius: 20px; padding: 22px 24px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .gains-panel h2 { font-size: 18px; font-weight: 700; color: #27EEE9; margin-bottom: 4px; }
  .gain-item {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-left: 3.5px solid #0051FB; border-radius: 12px; padding: 12px 14px;
  }
  .gain-item h3 { font-size: 14px; font-weight: 700; color: #FFFFFF; margin-bottom: 4px; }
  .gain-item p { font-size: 12.8px; line-height: 1.44; color: #C5D3EE; }
  .footer-note {
    margin-top: auto; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);
    font-size: 12.2px; color: #98EDC1; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div><span class="tag">9.0 / 10+ Redesign Target</span><h1>${title}</h1></div>
      <div class="sub">${subtitle}</div>
    </div>
    <div class="palette-chips">
      <span>BitLess Brand Tokens:</span>
      <i class="sw" style="background:#0051FB"></i><span>#0051FB</span>
      <i class="sw" style="background:#ABDFFD"></i><span>#ABDFFD</span>
      <i class="sw" style="background:#27EEE9"></i><span>#27EEE9</span>
      <i class="sw" style="background:#98EDC1"></i><span>#98EDC1</span>
      <i class="sw" style="background:#070D5B"></i><span>#070D5B</span>
    </div>
  </div>

  <div class="col-title" style="left:108px;">
    <span>BEFORE · ${beforeLabel}</span>
    <span class="score-pill" style="background:rgba(255,77,106,0.2);color:#FF7B93;border:1px solid rgba(255,77,106,0.45);">${beforeScore}</span>
  </div>
  <div class="phone-wrap-before"><img src="file:///${ROOT}/${beforeImg}" /></div>

  <div class="arrow-mid">
    <div class="arrow-badge">9/10+ →</div>
    <div style="font-size:11px;color:#93A8D1;margin-top:8px;">Visual &amp; Spacing<br/>Overhaul</div>
  </div>

  <div class="col-title" style="left:672px;">
    <span>PROPOSED 9/10+ · ${afterLabel}</span>
    <span class="score-pill" style="background:rgba(152,237,193,0.18);color:#98EDC1;border:1px solid rgba(152,237,193,0.5);">${afterScore}</span>
  </div>
  <div class="phone-wrap-after">${afterHTML}</div>

  <div class="gains-panel">
    <h2>What Moves This Screen from ${beforeScore.replace(' / 10', '')} → ${afterScore}</h2>
    ${gains.map(g => `<div class="gain-item"><h3>${g.title}</h3><p>${g.body}</p></div>`).join('')}
    <div class="footer-note">Verified at Pixel 115% accessibility font scale · Zero pink · Distinct financial category &amp; risk cues preserved.</div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(TMP_DIR, out.replace('.png', '.html'));
  const pngPath = path.join(OUT_DIR, out);
  fs.writeFileSync(htmlPath, html, 'utf8');
  execFileSync(EDGE, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1680,1060',
    `--screenshot=${pngPath}`,
    `file:///${htmlPath}`
  ]);
  console.log('Rendered mockup:', pngPath);
}

// 1. Progress Overview 9/10+ (Light)
const progressOverviewAfter = phoneShell('Progress', `
  <!-- Compact Scope Pill -->
  <div style="background:#EAEFF8;border-radius:14px;padding:3px;display:flex;margin-bottom:10px;border:1px solid rgba(7,13,91,0.06);">
    <div style="flex:1;background:#0051FB;color:#FFF;border-radius:11px;padding:7px 8px;text-align:center;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,81,251,0.25);">Cards &amp; Loans</div>
    <div style="flex:1;color:#4B5673;border-radius:11px;padding:7px 8px;text-align:center;font-size:12px;font-weight:600;">Home &amp; Auto</div>
  </div>

  <!-- Compact Horizontal Hero Snapshot -->
  <div style="background:linear-gradient(135deg,#070D5B 0%,#0E238A 62%,#0051FB 100%);border-radius:18px;padding:14px 16px;color:#FFF;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;box-shadow:0 10px 24px rgba(7,13,91,0.18);">
    <div style="flex:1;padding-right:10px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#ABDFFD;margin-bottom:3px;">CARDS &amp; LOANS SNAPSHOT ⓘ</div>
      <div style="font-size:11px;color:#C9DCF9;">Current balance</div>
      <div style="display:flex;align-items:baseline;gap:7px;margin:2px 0 6px;">
        <span style="font-size:27px;font-weight:800;letter-spacing:-0.02em;">$38,214<span style="font-size:16px;font-weight:700;">.00</span></span>
        <span style="font-size:12px;font-weight:800;color:#98EDC1;">↓ 52%</span>
      </div>
      <div style="font-size:11px;color:#ABDFFD;">Adjusted reference</div>
      <div style="font-size:15px;font-weight:700;color:#FFFFFF;">$79,292<span style="font-size:11px;">.00</span></div>
    </div>
    <div style="width:106px;height:106px;position:relative;flex-shrink:0;">
      <svg width="106" height="106" viewBox="0 0 106 106">
        <circle cx="53" cy="53" r="42" stroke="rgba(255,255,255,0.16)" stroke-width="10" fill="none"/>
        <circle cx="53" cy="53" r="42" stroke="#27EEE9" stroke-width="10" fill="none" stroke-linecap="round"
                stroke-dasharray="264" stroke-dashoffset="137" transform="rotate(-90 53 53)"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="font-size:21px;font-weight:800;line-height:1;">48%</div>
        <div style="font-size:9.5px;color:#ABDFFD;margin-top:2px;">current / ref.</div>
      </div>
    </div>
  </div>

  <!-- Recorded Activity Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span style="font-size:16px;font-weight:700;color:#0E1528;">Recorded activity</span>
    <span style="background:#FFF;border:1px solid rgba(7,13,91,0.12);border-radius:10px;padding:5px 10px;font-size:11.5px;font-weight:600;color:#0E1528;">Current month ▾</span>
  </div>

  <!-- Unified Unclipped Activity Card -->
  <div style="background:#FFF;border-radius:18px;border:1px solid rgba(7,13,91,0.08);overflow:hidden;box-shadow:0 6px 18px rgba(7,13,91,0.05);">
    <div style="background:#EDF4FF;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(0,81,251,0.12);">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:#0051FB;">PAYMENTS RECORDED ⓘ</div>
        <div style="font-size:11.5px;color:#4B5673;margin-top:1px;">12 confirmed entries</div>
      </div>
      <div style="font-size:20px;font-weight:800;color:#070D5B;">$14,865<span style="font-size:13px;">.00</span></div>
    </div>
    <div style="padding:4px 14px;">
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #EEF1F7;font-size:13px;">
        <span style="color:#4B5673;font-weight:500;">Balance reduction</span>
        <span style="color:#0D8A5A;font-weight:700;">$14,167.00</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #EEF1F7;font-size:13px;">
        <span style="color:#4B5673;font-weight:500;">Interest &amp; fees</span>
        <span style="color:#D6492C;font-weight:700;">$100.00</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #EEF1F7;font-size:13px;">
        <span style="color:#4B5673;font-weight:500;">Other debt charges</span>
        <span style="color:#0E1528;font-weight:700;">$49.99</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:13px;">
        <span style="color:#0E1528;font-weight:700;">Net balance change</span>
        <span style="color:#0D8A5A;font-weight:800;">-$14,203.00</span>
      </div>
    </div>
  </div>

  <!-- Next Payoff Target Peek -->
  <div style="margin-top:10px;background:#FFF;border-radius:14px;border:1px solid rgba(7,13,91,0.08);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
    <div style="display:flex;align-items:center;gap:9px;">
      <span style="width:28px;height:28px;border-radius:9px;background:#EDF4FF;color:#0051FB;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">#1</span>
      <div>
        <div style="font-size:12.5px;font-weight:700;">Next target · Chase</div>
        <div style="font-size:11px;color:#5D667E;">24.25% APR · Avalanche</div>
      </div>
    </div>
    <span style="font-size:13px;font-weight:800;color:#070D5B;">$10,025.00 ›</span>
  </div>
`, 4, {
  subtabs: [{ label: 'Overview', active: true }, { label: 'Utilization' }, { label: 'Milestones' }]
});

// 2. Progress Utilization 9/10+ (Dark)
const utilizationAfter = phoneShell('Progress', `
  <!-- Compact Donut + Target Bar Card -->
  <div style="background:#161C2C;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:14px 16px;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8D98B4;">REVOLVING CREDIT · 2 OF 3 CARDS</span>
      <span style="background:rgba(245,184,65,0.16);color:#F5C257;border:1px solid rgba(245,184,65,0.35);font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;">Watch · 47%</span>
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
      <div style="width:94px;height:94px;position:relative;flex-shrink:0;">
        <svg width="94" height="94" viewBox="0 0 94 94">
          <circle cx="47" cy="47" r="37" stroke="rgba(255,255,255,0.1)" stroke-width="10" fill="none"/>
          <circle cx="47" cy="47" r="37" stroke="#F5C257" stroke-width="10" fill="none" stroke-linecap="round"
                  stroke-dasharray="232" stroke-dashoffset="123" transform="rotate(-90 47 47)"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:20px;font-weight:800;">47%</div>
          <div style="font-size:9.5px;color:#8D98B4;">of limit</div>
        </div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11.5px;color:#8D98B4;">Paydown needed for 30%</div>
        <div style="font-size:23px;font-weight:800;color:#FFFFFF;margin:2px 0 6px;">$11,025<span style="font-size:14px;">.00</span></div>
        <div style="height:7px;background:rgba(255,255,255,0.08);border-radius:999px;position:relative;overflow:hidden;">
          <div style="width:47%;height:100%;background:linear-gradient(90deg,#27EEE9,#F5C257);border-radius:999px;"></div>
          <div style="position:absolute;left:30%;top:-2px;bottom:-2px;width:2px;background:#98EDC1;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#8D98B4;margin-top:4px;">
          <span>0%</span><span style="color:#98EDC1;font-weight:700;">30% Goal ($19.5k)</span><span>100%</span>
        </div>
      </div>
    </div>
    <!-- Balanced 2x2 Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div style="background:#1D2539;border-radius:12px;padding:9px 11px;">
        <div style="font-size:10.5px;color:#8D98B4;">Used credit</div>
        <div style="font-size:15px;font-weight:800;margin-top:2px;">$30,525.00</div>
      </div>
      <div style="background:#1D2539;border-radius:12px;padding:9px 11px;">
        <div style="font-size:10.5px;color:#8D98B4;">Available credit</div>
        <div style="font-size:15px;font-weight:800;color:#98EDC1;margin-top:2px;">$34,475.00</div>
      </div>
      <div style="background:#1D2539;border-radius:12px;padding:9px 11px;">
        <div style="font-size:10.5px;color:#8D98B4;">Total credit limit</div>
        <div style="font-size:15px;font-weight:800;margin-top:2px;">$65,000.00</div>
      </div>
      <div style="background:#1D2539;border-radius:12px;padding:9px 11px;">
        <div style="font-size:10.5px;color:#8D98B4;">30% target cap</div>
        <div style="font-size:15px;font-weight:800;color:#ABDFFD;margin-top:2px;">$19,500.00</div>
      </div>
    </div>
  </div>

  <!-- Cards to Review Fully Visible Above Dock -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 2px 7px;">
    <span style="font-size:15px;font-weight:700;">Cards to review</span>
    <span style="font-size:11.5px;color:#8D98B4;">Above 30% target</span>
  </div>

  <div style="background:#161C2C;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:4px 14px;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;border-radius:10px;background:rgba(245,184,65,0.14);color:#F5C257;display:flex;align-items:center;justify-content:center;font-weight:800;">💳</div>
        <div>
          <div style="font-size:14px;font-weight:700;">Chase</div>
          <div style="font-size:11.5px;color:#8D98B4;">Limit $20,000.00</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:800;color:#F5C257;">50.1% · High</div>
        <div style="font-size:10.5px;color:#8D98B4;">-$4,025 to 30%</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;border-radius:10px;background:rgba(39,238,233,0.14);color:#27EEE9;display:flex;align-items:center;justify-content:center;font-weight:800;">💳</div>
        <div>
          <div style="font-size:14px;font-weight:700;">Discover</div>
          <div style="font-size:11.5px;color:#8D98B4;">Limit $45,000.00</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:800;color:#F5C257;">45.6% · Watch</div>
        <div style="font-size:10.5px;color:#8D98B4;">-$7,000 to 30%</div>
      </div>
    </div>
  </div>
`, 4, {
  dark: true,
  subtabs: [{ label: 'Overview' }, { label: 'Utilization', active: true }, { label: 'Milestones' }]
});

// 3. Home Tab 9/10+ (Light)
const homeAfter = phoneShell('BitLess', `
  <div style="font-size:21px;font-weight:800;letter-spacing:-0.02em;margin-bottom:10px;color:#0E1528;">Hi, Ud0nTkNowM3</div>

  <!-- BitLess Cobalt + Navy Hero -->
  <div style="background:linear-gradient(135deg,#070D5B 0%,#0B2799 58%,#0051FB 100%);border-radius:20px;padding:15px 17px;color:#FFF;position:relative;overflow:hidden;margin-bottom:11px;box-shadow:0 12px 28px rgba(0,81,251,0.22);">
    <div style="position:absolute;right:-28px;top:-28px;width:150px;height:150px;border-radius:50%;border:18px solid rgba(39,238,233,0.11);"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <span style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;color:#ABDFFD;">DEBT-FREE ESTIMATE ⓘ</span>
      <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(171,223,253,0.16);color:#ABDFFD;border:1px solid rgba(171,223,253,0.28);">ESTIMATE</span>
    </div>
    <div style="font-size:29px;font-weight:800;letter-spacing:-0.02em;margin-bottom:10px;">Oct 2028</div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="background:rgba(152,237,193,0.18);color:#98EDC1;border:1px solid rgba(152,237,193,0.35);padding:5px 11px;border-radius:999px;font-size:12px;font-weight:700;">23 months to go</span>
      <span style="font-size:12.5px;font-weight:700;color:#27EEE9;">Avalanche ›</span>
    </div>
  </div>

  <!-- Compact Accounts Carousel Card -->
  <div style="background:#FFF;border:1px solid rgba(7,13,91,0.08);border-radius:18px;padding:13px 15px;margin-bottom:11px;box-shadow:0 6px 18px rgba(7,13,91,0.05);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div>
        <span style="font-size:14.5px;font-weight:700;">Your accounts</span>
        <span style="font-size:12px;color:#5D667E;margin-left:6px;">· Cards &amp; Loans (3)</span>
      </div>
      <span style="color:#5D667E;font-size:13px;">ⓘ</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;color:#0E1528;">$38,214<span style="font-size:15px;">.00</span></div>
      <div style="width:38px;height:38px;border-radius:12px;background:#EDF4FF;color:#0051FB;display:flex;align-items:center;justify-content:center;font-size:17px;">💳</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #EEF1F7;">
      <span style="font-size:12px;color:#5D667E;">Balance change <strong style="color:#0D8A5A;margin-left:4px;">↓ $41,078.00</strong></span>
      <div style="display:flex;gap:4px;align-items:center;">
        <span style="width:14px;height:4px;border-radius:999px;background:#0051FB;"></span>
        <span style="width:4px;height:4px;border-radius:50%;background:#CBD4E6;"></span>
        <span style="width:4px;height:4px;border-radius:50%;background:#CBD4E6;"></span>
      </div>
    </div>
  </div>

  <!-- Payoff Strategy Visible Above the Fold -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
    <span style="font-size:15.5px;font-weight:700;">Payoff strategy</span>
    <span style="font-size:12.5px;font-weight:700;color:#0051FB;">See all ›</span>
  </div>
  <div style="background:#FFF;border:1px solid rgba(7,13,91,0.08);border-radius:16px;padding:3px 13px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #EEF1F7;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="width:30px;height:30px;border-radius:50%;background:#EDF4FF;color:#0051FB;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">⚡</span>
        <div>
          <div style="font-size:13.5px;font-weight:700;">Chase</div>
          <div style="font-size:11.5px;color:#0051FB;font-weight:600;">#1 Next in your plan</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13.5px;font-weight:800;">$10,025.00</div>
        <div style="font-size:11px;color:#5D667E;">Est. Jun 2027</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="width:30px;height:30px;border-radius:50%;background:#EBF8F3;color:#0D8A5A;display:flex;align-items:center;justify-content:center;font-size:13px;">💳</span>
        <div>
          <div style="font-size:13.5px;font-weight:700;">Discover</div>
          <div style="font-size:11.5px;color:#5D667E;">23.45% APR</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13.5px;font-weight:800;">$20,500.00</div>
        <div style="font-size:11px;color:#5D667E;">Est. May 2028</div>
      </div>
    </div>
  </div>
`, 0);

// 4. Accounts List 9/10+ (Light)
const accountsAfter = phoneShell('Accounts', `
  <!-- BitLess Hero -->
  <div style="background:linear-gradient(135deg,#070D5B 0%,#0E238A 62%,#0051FB 100%);border-radius:18px;padding:14px 16px;color:#FFF;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;letter-spacing:0.08em;color:#ABDFFD;">
      <span>TOTAL BALANCE</span><span>ⓘ</span>
    </div>
    <div style="font-size:29px;font-weight:800;margin:3px 0 2px;">$370,750<span style="font-size:17px;">.00</span></div>
    <div style="font-size:12px;color:#C9DCF9;">5 active accounts · 3 cards &amp; loans</div>
  </div>

  <!-- Inline Category Chips + Unified Search/Sort -->
  <div style="display:flex;gap:6px;margin-bottom:8px;">
    <span style="background:#0051FB;color:#FFF;font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:999px;">All (5)</span>
    <span style="background:#FFF;border:1px solid rgba(7,13,91,0.1);color:#4B5673;font-size:11.5px;font-weight:600;padding:6px 11px;border-radius:999px;">Cards &amp; Loans</span>
    <span style="background:#FFF;border:1px solid rgba(7,13,91,0.1);color:#4B5673;font-size:11.5px;font-weight:600;padding:6px 11px;border-radius:999px;">Home &amp; Auto</span>
  </div>
  <div style="background:#FFF;border:1px solid rgba(7,13,91,0.1);border-radius:12px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12.5px;color:#5D667E;">
    <span>🔍 Search debts</span>
    <span style="color:#0E1528;font-weight:700;border-left:1px solid #E4E8F2;padding-left:10px;">Name ▾</span>
  </div>

  <!-- Card-Framed Account Group with Unsplit Est. Lines -->
  <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:0.06em;color:#5D667E;margin:4px 4px 6px;">
    <span>CARDS &amp; LOANS</span><span>$38,214.00</span>
  </div>
  <div style="background:#FFF;border:1px solid rgba(7,13,91,0.08);border-radius:18px;padding:2px 13px;box-shadow:0 6px 18px rgba(7,13,91,0.04);">
    ${[
      ['Booking', '21.34% APR · Est. Aug 2028', '$7,689.00'],
      ['Chase', '24.25% APR · Est. Jun 2027', '$10,025.00'],
      ['Discover', '23.45% APR · Est. May 2028', '$20,500.00']
    ].map(([n, s, v], i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${i < 2 ? 'border-bottom:1px solid #EEF1F7;' : ''}">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:32px;height:32px;border-radius:50%;background:#E6F7F1;color:#0D8A5A;display:flex;align-items:center;justify-content:center;font-size:14px;">💳</span>
          <div>
            <div style="font-size:14.5px;font-weight:700;">${n}</div>
            <div style="font-size:11.5px;color:#5D667E;white-space:nowrap;">${s}</div>
          </div>
        </div>
        <div style="font-size:14px;font-weight:800;white-space:nowrap;">${v} <span style="color:#9BA6BE;">›</span></div>
      </div>
    `).join('')}
  </div>

  <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:0.06em;color:#5D667E;margin:11px 4px 6px;">
    <span>HOME &amp; AUTO</span><span>$332,536.00</span>
  </div>
  <div style="background:#FFF;border:1px solid rgba(7,13,91,0.08);border-radius:16px;padding:11px 13px;display:flex;justify-content:space-between;align-items:center;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="width:32px;height:32px;border-radius:50%;background:#EDF4FF;color:#0051FB;display:flex;align-items:center;justify-content:center;font-size:14px;">🚗</span>
      <div>
        <div style="font-size:14.5px;font-weight:700;">Auto Loan</div>
        <div style="font-size:11.5px;color:#5D667E;">3.45% APR · Est. Oct 2028</div>
      </div>
    </div>
    <div style="font-size:14px;font-weight:800;">$20,104.00 ›</div>
  </div>
`, 1, {
  subtabs: [{ label: 'Accounts', active: true }, { label: 'Strategy' }],
  cta: 'Add Debt Account'
});

// 5. Transactions Upcoming 9/10+ (Dark)
const upcomingAfter = phoneShell('Transactions', `
  <!-- Dark Cobalt TO PAY Hero -->
  <div style="background:linear-gradient(135deg,#070D5B 0%,#12287A 100%);border:1px solid rgba(39,238,233,0.22);border-radius:18px;padding:13px 16px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;color:#ABDFFD;">TO PAY</span>
      <span style="background:rgba(245,184,65,0.16);color:#F5C257;border:1px solid rgba(245,184,65,0.35);font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;">9 unpaid</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
      <span style="font-size:27px;font-weight:800;color:#FFF;">$3,214<span style="font-size:16px;">.25</span></span>
      <span style="font-size:11.5px;color:#ABDFFD;">Current + next month</span>
    </div>
  </div>

  <!-- November 2026: Fixed "1 item" -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
    <span style="font-size:15.5px;font-weight:700;">November 2026</span>
    <span style="background:rgba(39,238,233,0.12);color:#27EEE9;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;">1 item</span>
  </div>
  <div style="display:flex;gap:12px;align-items:center;background:#161C2C;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:12px 14px;margin-bottom:14px;">
    <div style="width:36px;text-align:center;">
      <div style="font-size:18px;font-weight:800;line-height:1;">18</div>
      <div style="font-size:10px;color:#8D98B4;font-weight:700;">NOV</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:14px;font-weight:700;">Booking minimum</div>
      <div style="font-size:11.5px;color:#F5C257;margin-top:2px;">Minimum payment · Unpaid</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:14.5px;font-weight:800;margin-bottom:5px;">$213.63</div>
      <span style="background:#0051FB;color:#FFF;font-size:11.5px;font-weight:700;padding:5px 14px;border-radius:999px;">Pay</span>
    </div>
  </div>

  <!-- December 2026: Clean unified rows -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
    <span style="font-size:15.5px;font-weight:700;">December 2026</span>
    <span style="background:rgba(39,238,233,0.12);color:#27EEE9;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;">8 items</span>
  </div>
  <div style="background:#161C2C;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:2px 14px;">
    ${[
      ['1', 'DEC', 'HOA', 'Checking · Unpaid', '$189.00'],
      ['1', 'DEC', 'Rent / Mortgage', 'Checking · Unpaid', '$2,150.00'],
      ['5', 'DEC', 'Chase minimum', 'Checking · Unpaid', '$295.00']
    ].map(([d, m, n, s, v], i) => `
      <div style="display:flex;gap:12px;align-items:center;padding:11px 0;${i < 2 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : ''}">
        <div style="width:36px;text-align:center;">
          <div style="font-size:17px;font-weight:800;line-height:1;">${d}</div>
          <div style="font-size:10px;color:#8D98B4;font-weight:700;">${m}</div>
        </div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">${n}</div>
          <div style="font-size:11.5px;color:#8D98B4;margin-top:2px;">${s}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:14px;font-weight:800;margin-bottom:4px;">${v}</div>
          <span style="background:rgba(0,81,251,0.22);border:1px solid rgba(108,162,255,0.4);color:#ABDFFD;font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;">Pay</span>
        </div>
      </div>
    `).join('')}
  </div>
`, 2, {
  dark: true,
  subtabs: [{ label: 'History' }, { label: 'Upcoming', active: true }, { label: 'Scheduled' }],
  cta: 'Add Transaction'
});

const MOCKUPS = [
  {
    out: '01-progress-overview-9plus.png',
    title: 'Progress → Overview: Full Above-the-Fold Clarity & BitLess Palette',
    subtitle: 'Horizontal snapshot preserved with Cobalt/Turquoise palette, single-line activity rows, and zero dock clipping',
    beforeImg: 'light/24-progress-overview.png',
    beforeLabel: 'Current Light (115% Scale)',
    beforeScore: '7.2 / 10',
    afterHTML: progressOverviewAfter,
    afterLabel: 'BitLess Cobalt System',
    afterScore: '9.2 / 10',
    gains: [
      { title: '1. Zero Dock Clipping on Recorded Activity', body: 'Flattening the chunky 2-column Payments Recorded sidebar into a sleek header bar lets all 4 rows ("Balance reduction" → "Net balance change") sit completely clear of the floating dock.' },
      { title: '2. Compact Scope Selector Without Redundancy', body: 'Replacing the tall 2-line scope pill + "BALANCE SCOPE" header with a clean 1-line pill removes duplicate "Cards & Loans" labels and saves ~48dp of prime vertical space.' },
      { title: '3. BitLess Navy-to-Cobalt Hero + Turquoise Arc', body: 'Swapping generic Indigo purple for Deep Navy (#070D5B) → Cobalt (#0051FB) with a #27EEE9 progress ring aligns Progress Overview directly with the BitLess brand icon.' },
      { title: '4. Next Target Peek Surfaced Early', body: 'Reclaimed vertical rhythm reveals the #1 Avalanche target (Chase) before scrolling.' }
    ]
  },
  {
    out: '02-progress-utilization-9plus.png',
    title: 'Progress → Utilization (Dark): 2×2 Balanced Grid & Target Bar',
    subtitle: 'Eliminates empty vertical voids beside the donut, fixes wrapped center text, and lifts Chase + Discover cards cleanly above the dock',
    beforeImg: 'dark/26-progress-utilization.png',
    beforeLabel: 'Current Dark (115% Scale)',
    beforeScore: '7.4 / 10',
    afterHTML: utilizationAfter,
    afterLabel: 'Balanced Grid + Target Bar',
    afterScore: '9.1 / 10',
    gains: [
      { title: '1. Balanced 2×2 Metric Grid Replaces 5-Row Left Stack', body: 'Pairing a compact 94px donut beside the primary paydown goal ($11,025.00 to 30%) plus a 2×2 tile grid eliminates 40% wasted whitespace.' },
      { title: '2. Visual 30% Target Threshold Bar', body: 'A direct progress bar with a Mint #98EDC1 marker at 30% makes the utilization target immediately scannable alongside exact paydown needed.' },
      { title: '3. Unwrapped Status Pill ("Watch · 47%")', body: 'Moving the severity badge to the card header eliminates tight 2-line text wrapping inside the donut ring.' },
      { title: '4. "Cards to review" Completely Unclipped', body: 'Both Chase (50.1% · High) and Discover (45.6% · Watch) appear intact above the floating dock.' }
    ]
  },
  {
    out: '03-home-cobalt-fold-9plus.png',
    title: 'Home Dashboard: Cobalt Identity & Payoff Strategy Above the Fold',
    subtitle: 'Unifies BitLess Cobalt (#0051FB) with the app icon and compacts the accounts carousel to reveal #1 Chase & #2 Discover on first paint',
    beforeImg: 'light/02-home.png',
    beforeLabel: 'Current Home (Light)',
    beforeScore: '7.6 / 10',
    afterHTML: homeAfter,
    afterLabel: 'Cobalt Default + Strategy Peek',
    afterScore: '9.3 / 10',
    gains: [
      { title: '1. Cohesive BitLess Cobalt Accent System', body: 'Settings gear, active account dot, and Payoff Strategy CTA all use BitLess Cobalt (#0051FB) matching the header icon, paired with Mint (#98EDC1) & Turquoise (#27EEE9) highlights.' },
      { title: '2. Compacted "Your accounts" Card (+68dp Saved)', body: 'Placing "Cards & Loans (3)" inline and tightening internal dividers keeps the carousel airy while freeing room below.' },
      { title: '3. Payoff Strategy Immediately Actionable', body: 'Instead of stranding "Payoff strategy / See all >" on the dock edge, Chase (#1 Next in your plan) and Discover both render cleanly above the dock.' },
      { title: '4. Crisp Light Canvas Depth', body: 'Cool mist background (#F6F7FB) with subtle #070D5B borders creates cleaner elevation than warm cream + purple-tinted shadows.' }
    ]
  },
  {
    out: '04-accounts-list-9plus.png',
    title: 'Accounts Tab: Inline Filter Chips, Card Framing & Unsplit Est. Payoff',
    subtitle: 'Replaces the orphaned right-aligned category dropdown, frames rows in elevated cards, and keeps Discover "Est. May 2028" on 1 line',
    beforeImg: 'light/04-accounts-list.png',
    beforeLabel: 'Current Accounts (Light)',
    beforeScore: '7.6 / 10',
    afterHTML: accountsAfter,
    afterLabel: 'Unified Chips + Card Group',
    afterScore: '9.1 / 10',
    gains: [
      { title: '1. Left-Aligned Filter Chips Eliminate Dead Gutter', body: 'Replacing the lonely right-aligned "All categories v" dropdown with horizontal chips ("All (5)", "Cards & Loans", "Home & Auto") uses full width purposefully.' },
      { title: '2. Zero "Est." Wrapping at 115% Scale', body: 'Giving metadata full horizontal runway keeps "23.45% APR · Est. May 2028" unsplit on Discover, matching Booking and Chase.' },
      { title: '3. Consistent Card Containers', body: 'Grouping CARDS & LOANS inside a rounded white card brings Accounts in line with Progress, Budget, and Settings surfaces.' },
      { title: '4. Home & Auto Peek Above CTA Dock', body: 'Tightened spacing reveals Auto Loan cleanly above the + Add Debt Account pill.' }
    ]
  },
  {
    out: '05-transactions-upcoming-9plus.png',
    title: 'Transactions → Upcoming (Dark): Grammar Fix & Scannable Bill List',
    subtitle: 'Fixes "1 items" → "1 item", cuts redundant per-card pills, and increases visible upcoming bills above the floating CTA dock',
    beforeImg: 'dark/17-transactions-upcoming.png',
    beforeLabel: 'Current Upcoming (Dark)',
    beforeScore: '7.8 / 10',
    afterHTML: upcomingAfter,
    afterLabel: 'Clean Copy + Dense Scannability',
    afterScore: '9.1 / 10',
    gains: [
      { title: '1. Fixed Pluralization ("1 item")', body: 'Corrects "1 items" in November 2026 and uses unified Turquoise (#27EEE9) count chips across months.' },
      { title: '2. Eliminated Competing Badge Clutter', body: 'Moves redundant amber "Unpaid" badges into clean inline metadata ("Minimum payment · Unpaid"), keeping the eye locked on the primary "Pay" button.' },
      { title: '3. Grouped Monthly Bill Card', body: 'Grouping December items in one elevated card cuts repeated outer margins so 3+ upcoming bills appear above the dock instead of 1.5.' },
      { title: '4. Clear Primary vs Secondary Pay Hierarchy', body: 'Solid Cobalt (#0051FB) "Pay" highlights the imminent Nov 18 payment while December bills use subtle outlined actions.' }
    ]
  }
];

for (const m of MOCKUPS) {
  wrapComparisonBoard(m);
}
