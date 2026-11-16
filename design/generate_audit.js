const fs = require('fs');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DebtFree — Mobile Visual Redesign Audit</title>
<style>
  :root {
    --bg-canvas: #0C0E0D;
    --bg-card: #141816;
    --border-subtle: #222A25;
    --border-strong: #2E3831;
    --text-primary: #F1F5F2;
    --text-secondary: #9AA8A0;
    --text-tertiary: #6E7972;
    --mint-accent: #76DCB9;
    --positive: #86E3B8;
    --warning: #F5C563;
    --danger: #F08B78;
    --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: transparent;
    color: var(--text-primary);
    line-height: 1.4;
    padding: 2px 0;
    -webkit-font-smoothing: antialiased;
  }

  /* Screen Switcher Nav */
  .tab-nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 2px 2px 10px;
    scrollbar-width: none;
  }
  .nav-btn {
    padding: 6px 12px;
    border-radius: 8px;
    background: #141816;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }
  .nav-btn.active, .nav-btn:hover {
    background: #1C2721;
    border-color: var(--mint-accent);
    color: #FFFFFF;
  }

  /* Screen Panes */
  .pane { display: none; flex-direction: column; gap: 10px; }
  .pane.active { display: flex; }

  /* Comparison Grid (Side by side 2 columns) */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 680px) {
    .grid { grid-template-columns: 1fr; }
  }

  .col { display: flex; flex-direction: column; gap: 5px; }
  .col-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }
  .tag { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
  .tag.before { color: #8C9990; }
  .tag.after { color: var(--mint-accent); }
  .tag-sub { font-size: 10px; color: var(--text-tertiary); }

  /* Full Phone Frame Container */
  .phone {
    border-radius: 26px;
    border: 3px solid #232B26;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    overflow: hidden;
  }
  .phone.before { background: #1F201F; border-color: #2D332F; }
  .phone.after { background: #0C0E0D; border-color: #2E3831; }

  .status-bar {
    display: flex;
    justify-content: space-between;
    padding: 6px 14px 2px;
    font-size: 10px;
    font-weight: 600;
    color: #7A8780;
  }
  .body {
    padding: 6px 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* =========================================================================
     EXACT NATIVE APP BOTTOM TAB BAR (from FiveTabShell.tsx & AppIcon.tsx)
     CRITICAL CONSTRAINT: 100% UNCHANGED FROM CURRENT NATIVE APP IN BOTH VIEWS!
     - Height: 66px
     - Background: #242926
     - Border Top: 1px solid #353D38
     - Pill wrap: 48x30px, radius 15px, background #31534D
     - Active icon & label: #81DFD2
     - Inactive icon & label: #AAB3AD
     ========================================================================= */
  .native-tabbar {
    display: flex;
    justify-content: space-around;
    padding: 6px 6px;
    min-height: 66px;
    background: #242926 !important;
    border-top: 1px solid #353D38 !important;
  }

  .native-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2px 2px;
    gap: 3px;
    cursor: default;
  }
  .native-icon-wrap {
    width: 48px;
    height: 30px;
    border-radius: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #AAB3AD;
  }
  .native-tab.selected .native-icon-wrap {
    background: #31534D !important;
    color: #81DFD2 !important;
  }
  .native-label {
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    color: #AAB3AD;
    letter-spacing: 0.1px;
  }
  .native-tab.selected .native-label {
    color: #81DFD2 !important;
    font-weight: 600;
  }

  /* Card Styles */
  .c-before {
    background: #272D2A;
    border: 1px solid #37413B;
    border-radius: 12px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .c-after {
    background: #141816;
    border: 1px solid #222A25;
    border-radius: 12px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Common UI Elements */
  .row-sb { display: flex; justify-content: space-between; align-items: center; }
  .pill-seg {
    display: flex;
    background: #141715;
    border: 1px solid #26302A;
    border-radius: 8px;
    padding: 2px;
  }
  .pill-seg-item {
    flex: 1;
    text-align: center;
    font-size: 10px;
    padding: 4px 0;
    color: #7A8780;
    border-radius: 6px;
  }
  .pill-seg-item.active { background: #1C2420; color: #FFF; font-weight: 700; }
  .pill-seg-item.active-b { background: #31534D; color: #81DFD2; font-weight: 700; }

  .summary-box {
    background: #111513;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .summary-title { font-size: 11px; font-weight: 800; color: #FFF; }
  .summary-detail { color: var(--text-secondary); line-height: 1.35; }
  .hl-mint { color: var(--mint-accent); font-weight: 700; }
  .hl-coral { color: var(--danger); font-weight: 700; }
  .hl-amber { color: var(--warning); font-weight: 700; }

  /* Interactive Discretionary Scenario Switcher */
  .scenario-bar {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .sc-btn {
    flex: 1;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 9px;
    font-weight: 700;
    border: 1px solid #222A25;
    background: #141816;
    color: #8C9990;
    cursor: pointer;
    text-align: center;
  }
  .sc-btn.active-sc {
    border-color: var(--mint-accent);
    color: #FFF;
    background: #1C2621;
  }
</style>
</head>
<body>

  <!-- Screen Navigation Tabs -->
  <div class="tab-nav">
    <button class="nav-btn active" onclick="selectTab('pane-progress')">1. Progress (Exact Native Overview)</button>
    <button class="nav-btn" onclick="selectTab('pane-budget')">2. Budget (Dynamic Discretionary Cashflow)</button>
    <button class="nav-btn" onclick="selectTab('pane-home')">3. Home Tab</button>
    <button class="nav-btn" onclick="selectTab('pane-debt')">4. Debt (10-Trajectory)</button>
    <button class="nav-btn" onclick="selectTab('pane-transactions')">5. Transactions (Up/Down Filter)</button>
  </div>

  <!-- PANE 1: PROGRESS SCREEN (EXACT NATIVE OVERVIEW RESTORED) -->
  <div id="pane-progress" class="pane active">
    <div class="grid">
      <!-- BEFORE: EXACT CURRENT NATIVE APP PROGRESS OVERVIEW -->
      <div class="col">
        <div class="col-header">
          <span class="tag before">Progress: Current Native App</span>
          <span class="tag-sub">Exact Overview Screen (ProgressScreen.tsx)</span>
        </div>
        <div class="phone before">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <!-- App Bar with Gear Icon -->
            <div class="row-sb" style="border-bottom: 1px solid #353D38; padding-bottom: 6px;">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Progress</span>
              <span style="width: 22px; height: 22px; border-radius: 5px; background: #2D3531; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #81DFD2;">⚙</span>
            </div>

            <!-- Exact 3 Segments from ProgressScreen.tsx -->
            <div class="pill-seg" style="background: #141715;">
              <div class="pill-seg-item active-b">Overview</div>
              <div class="pill-seg-item">Utilization</div>
              <div class="pill-seg-item">Milestones</div>
            </div>

            <!-- CARD 1: Exact Balance Snapshot & Payoff Target -->
            <div class="c-before">
              <div class="row-sb" style="align-items: flex-start;">
                <div style="flex: 1; gap: 3px; display: flex; flex-direction: column;">
                  <span style="font-size: 8px; color: #9DA8A1; font-weight: 700; letter-spacing: 0.05em;">BALANCE SNAPSHOT</span>
                  <span style="font-size: 13px; font-weight: 700; color: #FFF; line-height: 1.2;">19% below reference balances</span>
                  <span style="font-size: 10px; color: #FFF; font-weight: 600;">$342,561.00 current balance</span>
                  <span style="font-size: 8px; color: #859189; line-height: 1.25; margin-top: 1px;">Compared with the higher of each current and entered original balance; changes may include corrections or credits.</span>
                </div>
                <!-- Circular Ring 19% -->
                <div style="width: 44px; height: 44px; border-radius: 50%; border: 4px solid #353D38; border-top-color: #81DFD2; border-right-color: #81DFD2; display: flex; flex-direction: column; align-items: center; justify-content: center; margin-left: 6px; flex-shrink: 0;">
                  <span style="font-size: 10px; font-weight: 700; color: #FFF;">19%</span>
                  <span style="font-size: 6px; color: #9DA8A1; text-transform: uppercase;">snapshot</span>
                </div>
              </div>

              <!-- Next Payoff Target Divider -->
              <div style="border-top: 1px solid #353D38; padding-top: 5px; margin-top: 2px;">
                <span style="font-size: 8px; color: #9DA8A1; font-weight: 700; letter-spacing: 0.05em;">NEXT PAYOFF TARGET · SNOWBALL</span>
                <div class="row-sb" style="margin-top: 3px;">
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #FFF;">Chase</div>
                    <div style="font-size: 9px; color: #9DA8A1;">24.25% APR · $10,025.00 balance</div>
                  </div>
                  <span style="font-size: 12px; color: #81DFD2; font-weight: 700;">#1</span>
                </div>
              </div>
            </div>

            <!-- CARD 2: Exact Current Month Activity Card -->
            <div class="c-before">
              <span style="font-size: 11px; font-weight: 700; color: #FFF;">Current month activity</span>
              <!-- Period Segments inside Card -->
              <div class="pill-seg" style="background: #141715; margin: 1px 0;">
                <div class="pill-seg-item active-b" style="font-size: 8px; padding: 2px 0;">Current month</div>
                <div class="pill-seg-item" style="font-size: 8px; padding: 2px 0;">Previous month</div>
                <div class="pill-seg-item" style="font-size: 8px; padding: 2px 0;">Lifetime</div>
              </div>

              <!-- Summary Block -->
              <div class="row-sb" style="align-items: flex-start; margin-top: 2px;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <span style="align-self: flex-start; background: #1E2C28; color: #81DFD2; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 4px;">6 TRANSACTIONS</span>
                  <span style="font-size: 11px; font-weight: 700; color: #FFF;">$1,198.00 in recorded payments</span>
                  <span style="font-size: 7.5px; color: #859189; line-height: 1.2;">Recorded history may be incomplete; loan payments without a principal allocation may not reduce the balance.</span>
                </div>
                <div style="text-align: right; margin-left: 6px; flex-shrink: 0;">
                  <div style="font-size: 8px; color: #9DA8A1;">Payments</div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">$1,198.00</div>
                </div>
              </div>

              <!-- Dividers and Financial Metrics -->
              <div class="row-sb" style="border-top: 1px solid #353D38; padding-top: 3px; font-size: 9px;">
                <span style="color: #9DA8A1;">Recorded payment balance reduction</span>
                <span style="color: #73D9C6; font-weight: 700;">$500.00</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #353D38; padding-top: 3px; font-size: 9px;">
                <span style="color: #9DA8A1;">Recorded payments</span>
                <span style="color: #FFF; font-weight: 700;">$1,198.00</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #353D38; padding-top: 3px; font-size: 9px;">
                <span style="color: #9DA8A1;">Accounts paid off</span>
                <span style="color: #FFF;">Unavailable</span>
              </div>

              <!-- Dual Tiles (Interest vs Net Change) -->
              <div style="display: flex; gap: 6px; margin-top: 2px;">
                <div style="flex: 1; background: #292D2B; border: 1px solid #353A37; border-radius: 8px; padding: 5px; display: flex; flex-direction: column; gap: 2px;">
                  <span style="font-size: 7.5px; color: #9DA8A1;">Interest & fees recorded</span>
                  <span style="font-size: 11px; font-weight: 700; color: #E3A088;">$0.00</span>
                </div>
                <div style="flex: 1; background: #292D2B; border: 1px solid #353A37; border-radius: 8px; padding: 5px; display: flex; flex-direction: column; gap: 2px;">
                  <span style="font-size: 7.5px; color: #9DA8A1;">Net balance change</span>
                  <span style="font-size: 11px; font-weight: 700; color: #73D9C6;">-$500.00</span>
                </div>
              </div>
            </div>

            <!-- CARD 3: Activity by Account -->
            <div class="c-before">
              <div class="row-sb">
                <span style="font-size: 10px; font-weight: 700; color: #FFF;">Activity by account</span>
                <span style="background: #242926; border: 1px solid #353D38; color: #9DA8A1; font-size: 8px; padding: 1px 4px; border-radius: 3px; font-weight: 700;">1 ACCOUNTS</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #353D38; padding-top: 4px; font-size: 9px;">
                <div style="display: flex; gap: 6px; align-items: center;">
                  <span style="width: 20px; height: 20px; border-radius: 50%; background: #2D3531; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #FFF; font-weight: 700;">CH</span>
                  <div>
                    <div style="font-size: 10px; font-weight: 700; color: #FFF;">Chase</div>
                    <div style="font-size: 8px; color: #9DA8A1;">6 entries · $1,198.00 paid</div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="color: #FFF; font-weight: 700;">$10,025.00</div>
                  <div style="color: #73D9C6; font-size: 8px; font-weight: 600;">-$500.00 net</div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="progress"></div>
        </div>
      </div>

      <!-- AFTER: TRUE PROGRESS OVERVIEW ELEVATED TO OBSIDIAN THEME -->
      <div class="col">
        <div class="col-header">
          <span class="tag after">Progress: Obsidian Redesign</span>
          <span class="tag-sub">Exact Native Content + Locked Native Tabs</span>
        </div>
        <div class="phone after">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <!-- App Bar with Crisp obsidian surface -->
            <div class="row-sb" style="border-bottom: 1px solid #222A25; padding-bottom: 6px;">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Progress</span>
              <span style="width: 22px; height: 22px; border-radius: 6px; background: #141816; border: 1px solid #222A25; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-secondary);">⚙</span>
            </div>

            <!-- Exact 3 Segments in Obsidian -->
            <div class="pill-seg" style="background: #0A0D0B; border: 1px solid #1E2621;">
              <div class="pill-seg-item active">Overview</div>
              <div class="pill-seg-item">Utilization</div>
              <div class="pill-seg-item">Milestones</div>
            </div>

            <!-- CARD 1: Exact Balance Snapshot & Payoff Target in Obsidian -->
            <div class="c-after">
              <div class="row-sb" style="align-items: flex-start;">
                <div style="flex: 1; gap: 3px; display: flex; flex-direction: column;">
                  <span style="font-size: 8px; color: #728078; font-weight: 800; letter-spacing: 0.05em;">BALANCE SNAPSHOT</span>
                  <span style="font-size: 13px; font-weight: 800; color: #FFF; line-height: 1.2;">19% below reference balances</span>
                  <span style="font-size: 10px; color: var(--positive); font-weight: 700;">$342,561.00 current balance</span>
                  <span style="font-size: 8px; color: #6E7972; line-height: 1.25; margin-top: 1px;">Compared with the higher of each current and entered original balance; changes may include corrections or credits.</span>
                </div>
                <!-- Circular Ring 19% with Mint Accent Glow -->
                <div style="width: 44px; height: 44px; border-radius: 50%; border: 4px solid #1C2420; border-top-color: var(--mint-accent); border-right-color: var(--mint-accent); display: flex; flex-direction: column; align-items: center; justify-content: center; margin-left: 6px; flex-shrink: 0;">
                  <span style="font-size: 10px; font-weight: 800; color: #FFF;">19%</span>
                  <span style="font-size: 6px; color: var(--mint-accent); text-transform: uppercase; font-weight: 700;">snapshot</span>
                </div>
              </div>

              <!-- Next Payoff Target Divider -->
              <div style="border-top: 1px solid #1C2420; padding-top: 5px; margin-top: 2px;">
                <span style="font-size: 8px; color: #728078; font-weight: 800; letter-spacing: 0.05em;">NEXT PAYOFF TARGET · SNOWBALL</span>
                <div class="row-sb" style="margin-top: 3px;">
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #FFF;">Chase</div>
                    <div style="font-size: 9px; color: #8A9990;">24.25% APR · $10,025.00 balance</div>
                  </div>
                  <span style="background: rgba(118, 220, 185, 0.12); color: var(--mint-accent); border: 1px solid rgba(118, 220, 185, 0.25); padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;">#1</span>
                </div>
              </div>
            </div>

            <!-- CARD 2: Exact Current Month Activity Card in Obsidian -->
            <div class="c-after">
              <span style="font-size: 11px; font-weight: 700; color: #FFF;">Current month activity</span>
              <!-- Period Segments inside Card -->
              <div class="pill-seg" style="background: #0A0D0B; border: 1px solid #1E2621; margin: 1px 0;">
                <div class="pill-seg-item active" style="font-size: 8px; padding: 2px 0;">Current month</div>
                <div class="pill-seg-item" style="font-size: 8px; padding: 2px 0;">Previous month</div>
                <div class="pill-seg-item" style="font-size: 8px; padding: 2px 0;">Lifetime</div>
              </div>

              <!-- Summary Block -->
              <div class="row-sb" style="align-items: flex-start; margin-top: 2px;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <span style="align-self: flex-start; background: rgba(118, 220, 185, 0.12); color: var(--mint-accent); border: 1px solid rgba(118, 220, 185, 0.25); font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 4px;">6 TRANSACTIONS</span>
                  <span style="font-size: 11px; font-weight: 800; color: #FFF;">$1,198.00 in recorded payments</span>
                  <span style="font-size: 7.5px; color: #6E7972; line-height: 1.2;">Recorded history may be incomplete; loan payments without a principal allocation may not reduce the balance.</span>
                </div>
                <div style="text-align: right; margin-left: 6px; flex-shrink: 0;">
                  <div style="font-size: 8px; color: #728078;">Payments</div>
                  <div style="font-size: 11px; font-weight: 800; color: #FFF;">$1,198.00</div>
                </div>
              </div>

              <!-- Dividers and Financial Metrics -->
              <div class="row-sb" style="border-top: 1px solid #1C2420; padding-top: 3px; font-size: 9px;">
                <span style="color: #8A9990;">Recorded payment balance reduction</span>
                <span style="color: var(--positive); font-weight: 800;">$500.00</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #1C2420; padding-top: 3px; font-size: 9px;">
                <span style="color: #8A9990;">Recorded payments</span>
                <span style="color: #FFF; font-weight: 700;">$1,198.00</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #1C2420; padding-top: 3px; font-size: 9px;">
                <span style="color: #8A9990;">Accounts paid off</span>
                <span style="color: #FFF;">Unavailable</span>
              </div>

              <!-- Dual Tiles (Interest vs Net Change) -->
              <div style="display: flex; gap: 6px; margin-top: 2px;">
                <div style="flex: 1; background: #0E1210; border: 1px solid #1C2420; border-radius: 8px; padding: 5px; display: flex; flex-direction: column; gap: 2px;">
                  <span style="font-size: 7.5px; color: #728078;">Interest & fees recorded</span>
                  <span style="font-size: 11px; font-weight: 800; color: var(--danger);">$0.00</span>
                </div>
                <div style="flex: 1; background: #0E1210; border: 1px solid #1C2420; border-radius: 8px; padding: 5px; display: flex; flex-direction: column; gap: 2px;">
                  <span style="font-size: 7.5px; color: #728078;">Net balance change</span>
                  <span style="font-size: 11px; font-weight: 800; color: var(--positive);">-$500.00</span>
                </div>
              </div>
            </div>

            <!-- CARD 3: Activity by Account -->
            <div class="c-after">
              <div class="row-sb">
                <span style="font-size: 10px; font-weight: 700; color: #FFF;">Activity by account</span>
                <span style="background: #141816; border: 1px solid #222A25; color: #8A9990; font-size: 8px; padding: 1px 5px; border-radius: 3px; font-weight: 700;">1 ACCOUNTS</span>
              </div>
              <div class="row-sb" style="border-top: 1px solid #1C2420; padding-top: 4px; font-size: 9px;">
                <div style="display: flex; gap: 6px; align-items: center;">
                  <span style="width: 20px; height: 20px; border-radius: 50%; background: #1C2420; border: 1px solid #28372E; display: flex; align-items: center; justify-content: center; font-size: 8px; color: var(--mint-accent); font-weight: 800;">CH</span>
                  <div>
                    <div style="font-size: 10px; font-weight: 700; color: #FFF;">Chase</div>
                    <div style="font-size: 8px; color: #728078;">6 entries · $1,198.00 paid</div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="color: #FFF; font-weight: 800;">$10,025.00</div>
                  <div style="color: var(--positive); font-size: 8px; font-weight: 700;">-$500.00 net</div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="progress"></div>
        </div>
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Progress Tab: Exact Native Progress Overview Restored & Bottom Tabs Locked</div>
      <div class="summary-detail">Card-for-card exact recreation of the genuine <span class="hl-mint">ProgressScreen.tsx Overview tab</span> using your live app data (19% Balance Snapshot with radial ring, Chase Snowball #1, 6 transactions with $1,198 payments, $500 reduction, dual metric tiles, and account list). <b>Bottom navigation tabs are 100% identical to the current native app in both views.</b></div>
    </div>
  </div>

  <!-- PANE 2: BUDGET SCREEN (DYNAMIC DISCRETIONARY CASHFLOW DEMONSTRATION) -->
  <div id="pane-budget" class="pane">
    <div class="grid">
      <!-- BEFORE: CURRENT BUDGET SCREEN CASHFLOW -->
      <div class="col">
        <div class="col-header">
          <span class="tag before">Budget: Current Native App</span>
          <span class="tag-sub">Static Monolithic Cashflow & Envelopes</span>
        </div>
        <div class="phone before">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb" style="border-bottom: 1px solid #353D38; padding-bottom: 6px;">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Budget</span>
              <span style="color: #81DFD2; font-size: 10px;">+ Add Bill</span>
            </div>

            <!-- Current Monthly Cashflow Overview (Real App Data: $8,558.33) -->
            <div class="c-before">
              <div class="row-sb">
                <div>
                  <span style="font-size: 9px; color: #9DA8A1;">Total monthly take-home income</span>
                  <div style="font-size: 16px; font-weight: 700; color: #FFF;">$8,558.33</div>
                </div>
                <span style="background: #2D3531; color: #81DFD2; padding: 2px 6px; border-radius: 4px; font-size: 9px;">Edit income</span>
              </div>

              <!-- Static single teal bar -->
              <div style="background: #353D38; height: 5px; border-radius: 3px; margin: 2px 0;">
                <div style="background: #81DFD2; width: 94%; height: 100%; border-radius: 3px;"></div>
              </div>

              <div class="row-sb" style="align-items: stretch; margin-top: 2px; font-size: 9px;">
                <div style="flex: 1;">
                  <div style="color: #9DA8A1;">Debt Plan</div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">$3,621.45</div>
                  <div style="color: #81DFD2;">43% of income</div>
                </div>
                <div style="width: 1px; background: #353A37; margin: 0 4px;"></div>
                <div style="flex: 1;">
                  <div style="color: #9DA8A1;">Debit Bills</div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">$4,373.99</div>
                  <div style="color: #AAB3AD;">51% of income</div>
                </div>
                <div style="width: 1px; background: #353A37; margin: 0 4px;"></div>
                <div style="flex: 1;">
                  <div style="color: #9DA8A1;">Free Cash</div>
                  <div style="font-size: 11px; font-weight: 700; color: #73D9C6;">$539.89</div>
                  <div style="color: #73D9C6;">6% unallocated</div>
                </div>
              </div>

              <div style="font-size: 8px; color: #859189; line-height: 1.25; margin-top: 2px;">
                Committed expenses and debt strategy payments. A linked recurring loan bill replaces that loan minimum in this commitment total.
              </div>
            </div>

            <!-- Current Envelope Breakdown -->
            <div class="c-before">
              <span style="font-size: 11px; font-weight: 700; color: #FFF;">Monthly Budget Breakdown</span>
              <div>
                <div class="row-sb" style="font-size: 9px;">
                  <span>Housing & Rent</span><span>$1,400 (88%)</span>
                </div>
                <div style="background: #353D38; height: 4px; border-radius: 2px; margin: 2px 0 4px;">
                  <div style="background: #81DFD2; width: 88%; height: 100%;"></div>
                </div>
                <div class="row-sb" style="font-size: 9px;">
                  <span>Subscriptions</span><span>$95 (78%)</span>
                </div>
                <div style="background: #353D38; height: 4px; border-radius: 2px; margin: 2px 0 4px;">
                  <div style="background: #81DFD2; width: 78%; height: 100%;"></div>
                </div>
                <div class="row-sb" style="font-size: 9px;">
                  <span>Utilities</span><span>$240 (45%)</span>
                </div>
                <div style="background: #353D38; height: 4px; border-radius: 2px;">
                  <div style="background: #81DFD2; width: 45%; height: 100%;"></div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="budget"></div>
        </div>
      </div>

      <!-- AFTER: DYNAMIC DISCRETIONARY CASHFLOW IN ALL 3 THRESHOLD COLORS -->
      <div class="col">
        <div class="col-header">
          <span class="tag after">Budget: Obsidian Redesign</span>
          <span class="tag-sub">Interactive Discretionary Cashflow States</span>
        </div>

        <!-- Interactive Scenario Picker for Discretionary Cashflow -->
        <div class="scenario-bar">
          <div id="btn-sc1" class="sc-btn active-sc" onclick="setCashflowScenario('critical')">
            <span style="color:var(--danger)">●</span> Critical: 6% Free (Current)
          </div>
          <div id="btn-sc2" class="sc-btn" onclick="setCashflowScenario('tight')">
            <span style="color:var(--warning)">●</span> Tight: 20% Free
          </div>
          <div id="btn-sc3" class="sc-btn" onclick="setCashflowScenario('healthy')">
            <span style="color:var(--mint-accent)">●</span> Healthy: 43% Free
          </div>
        </div>

        <div class="phone after">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Budget & Cashflow</span>
              <span style="background: var(--mint-accent); color: #0C0E0D; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 5px;">+ Add Bill</span>
            </div>

            <!-- DYNAMIC MONTHLY CASHFLOW OVERVIEW (ADAPTS LIVE TO DISCRETIONARY CASHFLOW COLOR) -->
            <div class="c-after">
              <div class="row-sb">
                <div>
                  <span style="font-size: 9px; color: #728078; text-transform: uppercase; font-weight: 800;">Monthly Take-Home</span>
                  <div id="sc-income" style="font-size: 17px; font-weight: 800; color: #FFF;">$8,558.33</div>
                </div>
                <span style="background: #1C2420; border: 1px solid #28372E; color: var(--mint-accent); padding: 2px 7px; border-radius: 5px; font-size: 9px; font-weight: 700;">Edit income</span>
              </div>

              <!-- Multi-Segment Cashflow Bar Showing Discretionary Segment in Dynamic Color -->
              <div style="display: flex; height: 7px; border-radius: 3.5px; overflow: hidden; background: #1C2420; margin: 3px 0;">
                <div id="sc-bar-debt" style="background: #4B5A52; width: 43%;" title="Debt Plan 43%"></div>
                <div id="sc-bar-bills" style="background: #6E7F76; width: 51%;" title="Debit Bills 51%"></div>
                <!-- Dynamic Discretionary Segment -->
                <div id="sc-bar-free" style="background: var(--danger); width: 6%; box-shadow: 0 0 8px rgba(240,139,120,0.5);" title="Free Cash 6% Critical"></div>
              </div>

              <!-- 3 Columns with Dynamic Discretionary Color Coding -->
              <div class="row-sb" style="align-items: stretch; margin-top: 2px; font-size: 9px;">
                <div style="flex: 1;">
                  <div style="color: #728078;">Debt Plan</div>
                  <div id="sc-val-debt" style="font-size: 11px; font-weight: 700; color: #FFF;">$3,621.45</div>
                  <div id="sc-pct-debt" style="color: #8A9990;">43% of income</div>
                </div>
                <div style="width: 1px; background: #222A25; margin: 0 4px;"></div>
                <div style="flex: 1;">
                  <div style="color: #728078;">Debit Bills</div>
                  <div id="sc-val-bills" style="font-size: 11px; font-weight: 700; color: #FFF;">$4,373.99</div>
                  <div id="sc-pct-bills" style="color: #8A9990;">51% of income</div>
                </div>
                <div style="width: 1px; background: #222A25; margin: 0 4px;"></div>

                <!-- DYNAMIC DISCRETIONARY / FREE CASHFLOW BOX -->
                <div id="sc-free-box" style="flex: 1.15; background: rgba(240, 139, 120, 0.12); border: 1px solid rgba(240, 139, 120, 0.35); border-radius: 6px; padding: 3px 5px;">
                  <div id="sc-free-label" style="color: var(--danger); font-weight: 800;">Free Cash</div>
                  <div id="sc-val-free" style="font-size: 12px; font-weight: 800; color: var(--danger);">$539.89</div>
                  <div id="sc-pct-free" style="color: var(--danger); font-weight: 700;">6% unallocated</div>
                </div>
              </div>
            </div>

            <!-- DYNAMIC % THRESHOLD BREAKDOWN ENVELOPES -->
            <div class="c-after">
              <div class="row-sb">
                <span style="font-size: 11px; font-weight: 700; color: #FFF;">Budget Envelopes</span>
                <span style="font-size: 8px; color: #728078;">Dynamic threshold colors</span>
              </div>
              <!-- ≥85% = Coral Warning -->
              <div>
                <div class="row-sb" style="font-size: 9px; margin-bottom: 2px;">
                  <span style="color: #FFF;">Housing & Rent <b style="color:var(--danger); font-weight:700;">88%</b></span>
                  <span style="color: var(--danger); font-weight: 700;">$1,400</span>
                </div>
                <div style="background: #1C2420; height: 4px; border-radius: 2px;">
                  <div style="background: var(--danger); width: 88%; height: 100%; border-radius: 2px;"></div>
                </div>
              </div>
              <!-- 70-84% = Amber Caution -->
              <div>
                <div class="row-sb" style="font-size: 9px; margin-bottom: 2px;">
                  <span style="color: #FFF;">Subscriptions <b style="color:var(--warning); font-weight:700;">78%</b></span>
                  <span style="color: var(--warning); font-weight: 700;">$95</span>
                </div>
                <div style="background: #1C2420; height: 4px; border-radius: 2px;">
                  <div style="background: var(--warning); width: 78%; height: 100%; border-radius: 2px;"></div>
                </div>
              </div>
              <!-- <70% = Mint Healthy -->
              <div>
                <div class="row-sb" style="font-size: 9px; margin-bottom: 2px;">
                  <span style="color: #FFF;">Utilities <b style="color:var(--mint-accent); font-weight:700;">45%</b></span>
                  <span style="color: var(--mint-accent); font-weight: 700;">$240</span>
                </div>
                <div style="background: #1C2420; height: 4px; border-radius: 2px;">
                  <div style="background: var(--mint-accent); width: 45%; height: 100%; border-radius: 2px;"></div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="budget"></div>
        </div>
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Budget Tab: Discretionary Cashflow Dynamic Colors</div>
      <div class="summary-detail">Discretionary / Free Cashflow now fully reflects the dynamic color thresholds: <span class="hl-coral">Coral (&lt;10% free / &ge;85% committed)</span> for tight cashflow such as your current 6% unallocated state, <span class="hl-amber">Amber (10–30% free / 70–84% committed)</span> for caution, and <span class="hl-mint">Mint (&gt;30% free / &lt;70% committed)</span> for healthy discretionary cushion. Try the 3 scenario pills above to preview each state live! <b>Bottom tabs remain 100% native.</b></div>
    </div>
  </div>

  <!-- PANE 3: HOME SCREEN -->
  <div id="pane-home" class="pane">
    <div class="grid">
      <!-- BEFORE -->
      <div class="col">
        <div class="col-header">
          <span class="tag before">Home: Current Native App</span>
          <span class="tag-sub">Charcoal #1F201F</span>
        </div>
        <div class="phone before">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb" style="border-bottom: 1px solid #353D38; padding-bottom: 6px;">
              <span style="font-size: 15px; font-weight: 800; color: #FFF;">Debt<span style="color:#81DFD2">Free</span></span>
              <span style="background: #2D3531; color: #81DFD2; padding: 2px 6px; border-radius: 5px; font-size: 10px;">Edit Setup</span>
            </div>
            <div>
              <div style="font-size: 17px; font-weight: 700; color: #FFF;">Hi, Ud0nTkNowM3</div>
              <div style="font-size: 11px; color: #9DA8A1;">Your debt-free journey</div>
            </div>
            <!-- Current Estimated Card (Original Layout) -->
            <div class="c-before">
              <div class="row-sb">
                <span style="font-size: 12px; font-weight: 700; color: #FFF;">Debt-free estimate</span>
                <span style="background: #31534D; color: #81DFD2; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 700;">ESTIMATE</span>
              </div>
              <span style="font-size: 10px; color: #9DA8A1;">Projected from your active payoff plan</span>
              <div style="display: flex; align-items: stretch; margin-top: 2px;">
                <div style="flex: 1; font-size: 19px; font-weight: 700; color: #81DFD2;">Jul 2027</div>
                <div style="width: 1px; background: #3D4741; margin: 0 10px;"></div>
                <div style="min-width: 60px; text-align: center;">
                  <div style="font-size: 14px; font-weight: 700; color: #FFF;">8</div>
                  <div style="font-size: 9px; color: #9DA8A1;">months to go</div>
                </div>
              </div>
              <div style="background: #353D38; height: 5px; border-radius: 3px;">
                <div style="background: #81DFD2; width: 43%; height: 100%; border-radius: 3px;"></div>
              </div>
            </div>
            <!-- Snapshot -->
            <div class="c-before">
              <div class="row-sb" style="font-size: 10px;"><span>Cards & Loans</span><span>1 accounts</span></div>
              <div class="row-sb">
                <div style="width: 44px; height: 44px; border-radius: 50%; border: 4px solid #81DFD2; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #FFF;">43%</div>
                <div style="text-align: right;">
                  <div style="font-size: 9px; color: #9DA8A1;">Balance</div>
                  <div style="font-size: 16px; font-weight: 700; color: #FFF;">$10,025.00</div>
                  <div style="font-size: 9px; color: #81DFD2;">-$7,517.00</div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="home"></div>
        </div>
      </div>

      <!-- AFTER -->
      <div class="col">
        <div class="col-header">
          <span class="tag after">Home: Obsidian Redesign</span>
          <span class="tag-sub">Obsidian #0C0E0D + Locked Native Tabs</span>
        </div>
        <div class="phone after">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb">
              <span style="font-size: 17px; font-weight: 800; color: #FFF;">Debt<span style="color:var(--mint-accent)">Free</span></span>
              <span style="background: #1C2420; border: 1px solid #28372E; color: var(--mint-accent); padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 700;">Edit Setup</span>
            </div>
            <div>
              <div style="font-size: 18px; font-weight: 800; color: #FFF;">Hi, Ud0nTkNowM3</div>
              <div style="font-size: 11px; color: #728078;">Your debt-free journey</div>
            </div>
            <!-- Preserved Exact Estimate Layout Elevated in Obsidian -->
            <div class="c-after">
              <div class="row-sb">
                <span style="font-size: 12px; font-weight: 700; color: #FFF;">Debt-free estimate</span>
                <span style="background: rgba(118, 220, 185, 0.12); color: var(--mint-accent); border: 1px solid rgba(118, 220, 185, 0.25); padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 800;">ESTIMATE</span>
              </div>
              <span style="font-size: 10px; color: #728078;">Projected from your active payoff plan</span>
              <div style="display: flex; align-items: stretch; margin-top: 2px;">
                <div style="flex: 1; font-size: 20px; font-weight: 800; color: var(--mint-accent);">Jul 2027</div>
                <div style="width: 1px; background: #222A25; margin: 0 10px;"></div>
                <div style="min-width: 60px; text-align: center;">
                  <div style="font-size: 15px; font-weight: 800; color: #FFF;">8</div>
                  <div style="font-size: 9px; color: #728078;">months to go</div>
                </div>
              </div>
              <div style="background: #1C2420; height: 5px; border-radius: 3px;">
                <div style="background: var(--mint-accent); width: 43%; height: 100%; border-radius: 3px; box-shadow: 0 0 6px rgba(118,220,185,0.4);"></div>
              </div>
            </div>
            <!-- Snapshot -->
            <div class="c-after">
              <div class="row-sb" style="font-size: 10px;">
                <span style="color: #FFF; font-weight: 700;">Cards & Loans</span>
                <span style="color: #728078;">1 accounts</span>
              </div>
              <div class="row-sb">
                <div style="width: 44px; height: 44px; border-radius: 50%; border: 4px solid #1C2420; border-top-color: var(--mint-accent); border-right-color: var(--mint-accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #FFF;">43%</div>
                <div style="text-align: right;">
                  <div style="font-size: 9px; color: #728078;">Balance</div>
                  <div style="font-size: 17px; font-weight: 800; color: #FFF;">$10,025.00</div>
                  <div style="font-size: 9px; color: var(--positive); font-weight: 700;">-$7,517.00</div>
                </div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="home"></div>
        </div>
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Home Screen: Preserved Native Hierarchy & Locked Bottom Tabs</div>
      <div class="summary-detail">Retains the exact two-box Estimated Date layout (<span class="hl-mint">Date | Divider | Months to go</span>). Upgrades surfaces to Obsidian #0C0E0D and #141816 while leaving the bottom tabs 100% native.</div>
    </div>
  </div>

  <!-- PANE 4: DEBT SCREEN -->
  <div id="pane-debt" class="pane">
    <div class="grid">
      <!-- BEFORE -->
      <div class="col">
        <div class="col-header">
          <span class="tag before">Debt: Current Native App</span>
          <span class="tag-sub">Simple Metric Cards</span>
        </div>
        <div class="phone before">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb" style="border-bottom: 1px solid #353D38; padding-bottom: 6px;">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Debts</span>
              <span style="color: #81DFD2; font-size: 10px;">+ Add</span>
            </div>
            <div class="c-before">
              <span style="font-size: 12px; font-weight: 700; color: #FFF;">Snowball Payoff Plan</span>
              <div class="row-sb" style="margin-top: 4px;">
                <div>
                  <div style="font-size: 9px; color: #9DA8A1;">Debt-free date</div>
                  <div style="font-size: 14px; font-weight: 700; color: #81DFD2;">Jul 2027</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 9px; color: #9DA8A1;">Total interest</div>
                  <div style="font-size: 14px; font-weight: 700; color: #E3A088;">$1,420</div>
                </div>
              </div>
            </div>
            <div class="c-before">
              <div class="row-sb">
                <div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">Chase Card</div>
                  <div style="font-size: 9px; color: #9DA8A1;">24.25% APR</div>
                </div>
                <div style="font-size: 13px; font-weight: 700; color: #FFF;">$10,025.00</div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="debt"></div>
        </div>
      </div>

      <!-- AFTER -->
      <div class="col">
        <div class="col-header">
          <span class="tag after">Debt: Obsidian Redesign</span>
          <span class="tag-sub">10-Statement Trajectory Timeline</span>
        </div>
        <div class="phone after">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb">
              <span style="font-size: 17px; font-weight: 800; color: #FFF;">Debts</span>
              <span style="background: var(--mint-accent); color: #0C0E0D; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 5px;">+ Add</span>
            </div>
            <div class="c-after">
              <div class="row-sb">
                <span style="font-size: 11px; font-weight: 700; color: #FFF;">Snowball Trajectory</span>
                <span style="font-size: 9px; color: var(--mint-accent); font-weight: 700;">Jul 2027</span>
              </div>
              <!-- 10-statement trajectory timeline -->
              <div style="margin: 4px 0 2px;">
                <svg width="100%" height="40" viewBox="0 0 200 40" style="overflow: visible;">
                  <path d="M 10 32 L 30 29 L 50 26 L 70 24 L 90 21 L 110 18 L 130 15 L 150 12 L 170 9 L 190 6" fill="none" stroke="rgba(118, 220, 185, 0.3)" stroke-width="2"/>
                  <!-- Hollow historical points -->
                  <circle cx="10" cy="32" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="30" cy="29" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="50" cy="26" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="70" cy="24" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="90" cy="21" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="110" cy="18" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="130" cy="15" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="150" cy="12" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <circle cx="170" cy="9" r="2.5" fill="#0C0E0D" stroke="#5E6E65" stroke-width="1.5"/>
                  <!-- Active glowing beacon -->
                  <circle cx="190" cy="6" r="4" fill="var(--mint-accent)"/>
                  <circle cx="190" cy="6" r="7" fill="none" stroke="var(--mint-accent)" stroke-width="1" opacity="0.5"/>
                </svg>
                <div class="row-sb" style="font-size: 8px; color: #728078;">
                  <span>Feb ($10.0k)</span>
                  <span style="color: var(--mint-accent); font-weight: 700;">Nov ($4.2k)</span>
                </div>
              </div>
            </div>
            <div class="c-after">
              <div class="row-sb">
                <div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">Chase Card</div>
                  <div style="font-size: 9px; color: #728078;">24.25% APR · Primary card</div>
                </div>
                <div style="font-size: 13px; font-weight: 800; color: #FFF;">$10,025.00</div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="debt"></div>
        </div>
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Debt Tab: 10-Statement Trajectory Timeline & Locked Tabs</div>
      <div class="summary-detail">Demonstrates 10 verified statement checkpoints with hollow history nodes and active beacon. Preserves native tab navigation.</div>
    </div>
  </div>

  <!-- PANE 5: TRANSACTIONS SCREEN -->
  <div id="pane-transactions" class="pane">
    <div class="grid">
      <!-- BEFORE -->
      <div class="col">
        <div class="col-header">
          <span class="tag before">Transactions: Current Native App</span>
          <span class="tag-sub">Dropdown Filters</span>
        </div>
        <div class="phone before">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb" style="border-bottom: 1px solid #353D38; padding-bottom: 6px;">
              <span style="font-size: 16px; font-weight: 800; color: #FFF;">Transactions</span>
              <span style="color: #81DFD2; font-size: 10px;">+ Add</span>
            </div>
            <div class="pill-seg" style="background: #141715;">
              <div class="pill-seg-item active-b">History</div>
              <div class="pill-seg-item">Upcoming</div>
              <div class="pill-seg-item">Scheduled</div>
            </div>
            <div style="display: flex; gap: 4px;">
              <span style="background: #272D2A; border: 1px solid #37413B; font-size: 9px; padding: 2px 5px; border-radius: 4px;">All accounts ▼</span>
              <span style="background: #272D2A; border: 1px solid #37413B; font-size: 9px; padding: 2px 5px; border-radius: 4px;">This month ▼</span>
            </div>
            <div class="c-before">
              <div class="row-sb">
                <div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">Chase Card Payment</div>
                  <div style="font-size: 9px; color: #9DA8A1;">2026-11-05 · payment</div>
                </div>
                <div style="font-size: 12px; font-weight: 700; color: #81DFD2;">-$250.00</div>
              </div>
              <div class="row-sb" style="border-top: 1px solid #353D38; padding-top: 4px;">
                <div>
                  <div style="font-size: 11px; font-weight: 700; color: #FFF;">Target Grocery</div>
                  <div style="font-size: 9px; color: #9DA8A1;">2026-11-03 · purchase</div>
                </div>
                <div style="font-size: 12px; font-weight: 700; color: #E3A088;">+$84.20</div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="transactions"></div>
        </div>
      </div>

      <!-- AFTER -->
      <div class="col">
        <div class="col-header">
          <span class="tag after">Transactions: Obsidian Redesign</span>
          <span class="tag-sub">Simple Up/Down Arrow Filter</span>
        </div>
        <div class="phone after">
          <div class="status-bar"><span>9:41</span><span>5G 100%</span></div>
          <div class="body">
            <div class="row-sb">
              <span style="font-size: 17px; font-weight: 800; color: #FFF;">Ledger</span>
              <span style="background: var(--mint-accent); color: #0C0E0D; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 5px;">+ Add</span>
            </div>
            <div class="pill-seg" style="background: #0A0D0B; border: 1px solid #1E2621;">
              <div class="pill-seg-item active">History</div>
              <div class="pill-seg-item">Upcoming</div>
              <div class="pill-seg-item">Scheduled</div>
            </div>
            <!-- Search & REFINED Up/Down Arrow Filter -->
            <div style="display: flex; gap: 6px; align-items: center;">
              <div style="flex: 1; background: #141816; border: 1px solid #222A25; border-radius: 7px; padding: 5px 8px; font-size: 10px; color: #728078;">
                🔍 Search payees...
              </div>
              <div style="background: #141816; border: 1px solid #222A25; border-radius: 7px; padding: 5px 8px; display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 10px; font-weight: 700; color: #FFF;">Filter</span>
                <span style="color: var(--mint-accent); font-size: 11px; font-weight: 800;">⇅</span>
              </div>
            </div>
            <!-- Ledger rows with clear financial color coding -->
            <div class="c-after">
              <div class="row-sb">
                <div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <span style="font-size: 11px; font-weight: 700; color: #FFF;">Chase Card Payment</span>
                    <span style="background: rgba(245, 197, 99, 0.12); color: var(--warning); border: 1px solid rgba(245, 197, 99, 0.25); font-size: 8px; padding: 1px 3px; border-radius: 3px; font-weight: 700;">Pending</span>
                  </div>
                  <div style="font-size: 9px; color: #728078;">Nov 5 · Debt Paydown</div>
                </div>
                <div style="font-size: 12px; font-weight: 700; color: var(--positive);">-$250.00</div>
              </div>
              <div class="row-sb" style="border-top: 1px solid #1C2420; padding-top: 6px;">
                <div>
                  <span style="font-size: 11px; font-weight: 700; color: #FFF;">Target Grocery</span>
                  <div style="font-size: 9px; color: #728078;">Nov 3 · Essential Expense</div>
                </div>
                <div style="font-size: 12px; font-weight: 700; color: var(--danger);">+$84.20</div>
              </div>
            </div>
          </div>
          <!-- EXACT CURRENT NATIVE BOTTOM TABS (UNTOUCHED) -->
          <div class="native-tabbar" data-tab="transactions"></div>
        </div>
      </div>
    </div>
    <div class="summary-box">
      <div class="summary-title">Transactions: Theme-Matched Up/Down Filter & Locked Tabs</div>
      <div class="summary-detail">Simple <span class="hl-mint">up/down arrow (⇅)</span> button following the Obsidian dark theme. Native bottom tabs strictly unchanged.</div>
    </div>
  </div>

  <script>
    // Tab Switching Logic
    function selectTab(id) {
      document.querySelectorAll('.pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      event.target.classList.add('active');
    }

    // Interactive Cashflow Scenarios Demonstrating Dynamic Discretionary Colors
    const CASHFLOW_SCENARIOS = {
      critical: {
        income: '$8,558.33',
        debtVal: '$3,621.45',
        debtPct: '43% of income',
        debtBar: '43%',
        billsVal: '$4,373.99',
        billsPct: '51% of income',
        billsBar: '51%',
        freeVal: '$539.89',
        freePct: '6% unallocated',
        freeBar: '6%',
        freeColor: 'var(--danger)',
        freeBg: 'rgba(240, 139, 120, 0.12)',
        freeBorder: 'rgba(240, 139, 120, 0.35)',
        freeShadow: '0 0 8px rgba(240, 139, 120, 0.5)'
      },
      tight: {
        income: '$6,500.00',
        debtVal: '$1,800.00',
        debtPct: '28% of income',
        debtBar: '28%',
        billsVal: '$3,400.00',
        billsPct: '52% of income',
        billsBar: '52%',
        freeVal: '$1,300.00',
        freePct: '20% unallocated',
        freeBar: '20%',
        freeColor: 'var(--warning)',
        freeBg: 'rgba(245, 197, 99, 0.12)',
        freeBorder: 'rgba(245, 197, 99, 0.35)',
        freeShadow: '0 0 8px rgba(245, 197, 99, 0.5)'
      },
      healthy: {
        income: '$5,200.00',
        debtVal: '$1,110.00',
        debtPct: '21% of income',
        debtBar: '21%',
        billsVal: '$1,850.00',
        billsPct: '36% of income',
        billsBar: '36%',
        freeVal: '$2,240.00',
        freePct: '43% unallocated',
        freeBar: '43%',
        freeColor: 'var(--mint-accent)',
        freeBg: 'rgba(118, 220, 185, 0.12)',
        freeBorder: 'rgba(118, 220, 185, 0.35)',
        freeShadow: '0 0 8px rgba(118, 220, 185, 0.5)'
      }
    };

    function setCashflowScenario(type) {
      document.querySelectorAll('.sc-btn').forEach(btn => btn.classList.remove('active-sc'));
      if (type === 'critical') document.getElementById('btn-sc1').classList.add('active-sc');
      if (type === 'tight') document.getElementById('btn-sc2').classList.add('active-sc');
      if (type === 'healthy') document.getElementById('btn-sc3').classList.add('active-sc');

      const sc = CASHFLOW_SCENARIOS[type];
      document.getElementById('sc-income').innerText = sc.income;
      document.getElementById('sc-val-debt').innerText = sc.debtVal;
      document.getElementById('sc-pct-debt').innerText = sc.debtPct;
      document.getElementById('sc-bar-debt').style.width = sc.debtBar;

      document.getElementById('sc-val-bills').innerText = sc.billsVal;
      document.getElementById('sc-pct-bills').innerText = sc.billsPct;
      document.getElementById('sc-bar-bills').style.width = sc.billsBar;

      document.getElementById('sc-val-free').innerText = sc.freeVal;
      document.getElementById('sc-val-free').style.color = sc.freeColor;
      document.getElementById('sc-pct-free').innerText = sc.freePct;
      document.getElementById('sc-pct-free').style.color = sc.freeColor;
      document.getElementById('sc-free-label').style.color = sc.freeColor;

      const box = document.getElementById('sc-free-box');
      box.style.background = sc.freeBg;
      box.style.borderColor = sc.freeBorder;

      const freeBar = document.getElementById('sc-bar-free');
      freeBar.style.width = sc.freeBar;
      freeBar.style.background = sc.freeColor;
      freeBar.style.boxShadow = sc.freeShadow;
    }

    // SVG Icons Definition from AppIcon.tsx
    const SVG_ICONS = {
      home: {
        active: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.15 3.32a1.3 1.3 0 0 1 1.7 0l7.5 6.45c.41.35.65.87.65 1.42v7.81a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7.81c0-.55.24-1.07.65-1.42l7.5-6.45ZM10.2 14a1.8 1.8 0 1 1 3.6 0v4.8h-3.6V14Z" fill="currentColor"/></svg>',
        inactive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 11l8-6.8L20 11v7.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.8V11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 13.5v6.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      },
      debt: {
        active: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 4.5h11.5a2.5 2.5 0 0 1 2.5 2.5v2.2a5.5 5.5 0 0 0-6.8 7.8H4.5A2.5 2.5 0 0 1 2 14.5V7a2.5 2.5 0 0 1 2.5-2.5Zm0 3.2v1.8h11V7.7h-11Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M16.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm2.1-5.3a.85.85 0 0 0-1.2-1.2l-1.5 1.5-.7-.7a.85.85 0 0 0-1.2 1.2l1.3 1.3c.33.33.87.33 1.2 0l2.1-2.1Z" fill="currentColor"/></svg>',
        inactive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 10V6.8A1.8 1.8 0 0 0 16.2 5H4.8A1.8 1.8 0 0 0 3 6.8v7.4A1.8 1.8 0 0 0 4.8 16H11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3 9h15" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="16.2" r="3.8" stroke="currentColor" stroke-width="1.8"/><path d="M15 16.2l1 1 2.2-2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      },
      transactions: {
        active: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 6.8A2.8 2.8 0 0 1 5.8 4h12.4A2.8 2.8 0 0 1 21 6.8v10.4a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2V6.8Zm10.7 1.1a.9.9 0 0 1 1.27 0l2.4 2.4a.9.9 0 0 1 0 1.27l-2.4 2.4a.9.9 0 1 1-1.27-1.27l.86-.86H7.5a.9.9 0 0 1 0-1.8h7.06l-.86-.87a.9.9 0 0 1 0-1.27Zm-3.4 5.9a.9.9 0 0 1 0 1.27l-.86.86H16.5a.9.9 0 1 1 0 1.8H9.44l.86.87a.9.9 0 0 1-1.27 1.27l-2.4-2.4a.9.9 0 0 1 0-1.27l2.4-2.4a.9.9 0 0 1 1.27 0Z" fill="currentColor"/></svg>',
        inactive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9.5h8.5m0 0-2.2-2.2m2.2 2.2-2.2 2.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 14.8H8m0 0 2.2-2.2M8 14.8l2.2 2.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      },
      budget: {
        active: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="9.2" height="16" rx="2.2" fill="currentColor"/><rect x="14.5" y="4" width="6" height="7" rx="2" fill="currentColor"/><rect x="14.5" y="13" width="6" height="7" rx="2" fill="currentColor"/></svg>',
        inactive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="9.2" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="14.5" y="4" width="6" height="7" rx="1.8" stroke="currentColor" stroke-width="1.8"/><rect x="14.5" y="13" width="6" height="7" rx="1.8" stroke="currentColor" stroke-width="1.8"/></svg>'
      },
      progress: {
        active: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="14" width="3.8" height="6" rx="1.2" fill="currentColor"/><rect x="10.1" y="10.5" width="3.8" height="9.5" rx="1.2" fill="currentColor"/><rect x="16.2" y="6.5" width="3.8" height="13.5" rx="1.2" fill="currentColor"/><path d="M4.5 10.2 11.5 5l3.5 2 3.8-3.2" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        inactive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="14" width="3.8" height="6" rx="1" stroke="currentColor" stroke-width="1.75"/><rect x="10.1" y="10.5" width="3.8" height="9.5" rx="1" stroke="currentColor" stroke-width="1.75"/><rect x="16.2" y="6.5" width="3.8" height="13.5" rx="1" stroke="currentColor" stroke-width="1.75"/></svg>'
      }
    };

    const TABS = [
      { key: 'home', label: 'Home' },
      { key: 'debt', label: 'Debt' },
      { key: 'transactions', label: 'Transactions' },
      { key: 'budget', label: 'Budget' },
      { key: 'progress', label: 'Progress' }
    ];

    // Populate all native tab bars identically across all phones
    document.querySelectorAll('.native-tabbar').forEach(bar => {
      const activeKey = bar.getAttribute('data-tab');
      bar.innerHTML = TABS.map(t => {
        const isSel = t.key === activeKey;
        const icon = isSel ? SVG_ICONS[t.key].active : SVG_ICONS[t.key].inactive;
        return '<div class="native-tab ' + (isSel ? 'selected' : '') + '">' +
                 '<div class="native-icon-wrap">' +
                   icon +
                 '</div>' +
                 '<div class="native-label">' + t.label + '</div>' +
               '</div>';
      }).join('');
    });
  </script>
</body>
</html>`;

fs.writeFileSync('C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/design/full-app-visual-audit.html', html, 'utf8');
console.log('Successfully written clean HTML. File length:', html.length);
