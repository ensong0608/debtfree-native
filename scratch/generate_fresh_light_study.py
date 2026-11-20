import base64
import re
import struct
import zlib
from pathlib import Path


def ttf_to_woff(ttf: bytes) -> bytes:
    sfnt_ver, num_tables = struct.unpack(">IH", ttf[:6])
    tables = []
    pos = 12
    for _ in range(num_tables):
        tag, csum, off, length = struct.unpack(">4sIII", ttf[pos : pos + 16])
        pos += 16
        raw = ttf[off : off + length]
        comp = zlib.compress(raw, 9)
        data = comp if len(comp) < len(raw) else raw
        tables.append((tag, csum, length, data))
    total_sfnt = 12 + 16 * num_tables + sum((l + 3) & ~3 for _, _, l, _ in tables)
    woff_header_size = 44 + 20 * num_tables
    out_dir = bytearray()
    out_data = bytearray()
    cur_off = woff_header_size
    for tag, csum, orig_len, data in tables:
        out_dir += struct.pack(">4sIIII", tag, cur_off, len(data), orig_len, csum)
        pad = (-len(data)) & 3
        out_data += data + b"\x00" * pad
        cur_off += len(data) + pad
    total_len = woff_header_size + len(out_data)
    hdr = struct.pack(
        ">IIIHHIHHIIIII",
        0x774F4646,
        sfnt_ver,
        total_len,
        num_tables,
        0,
        total_sfnt,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
    )
    return bytes(hdr + out_dir + out_data)


ROOT = Path(__file__).resolve().parent.parent
REF = (ROOT / "design" / "signature-uphold-consistent-2026-11-16.html").read_text(encoding="utf-8")

license_start = REF.find("<!-- Montserrat")
font_start = REF.find("<style>@font-face")
font_end = REF.find("#argon-studies")
if font_end == -1:
    font_end = REF.find("#account-studies")

assert license_start != -1 and font_start != -1 and font_end != -1
license_comment = REF[license_start:font_start]
font_style_open = re.sub(
    r"data:font/ttf;base64,([A-Za-z0-9+/=]+)",
    lambda m: "data:font/woff;base64," + base64.b64encode(ttf_to_woff(base64.b64decode(m.group(1)))).decode("ascii"),
    REF[font_start:font_end],
)

CSS = r"""
#bitless-full-study{font-family:'Proxima Nova','Montserrat',Arial,sans-serif;color:var(--foreground)}
#bitless-full-study *{box-sizing:border-box}
#bitless-full-study [hidden]{display:none!important}
#bitless-full-study button{font-family:inherit;cursor:pointer}

/* Review bar controls (hidden inside gallery-shell preview iframe) */
#bitless-full-study .design-picker,
#bitless-full-study .screen-picker{
  display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin:0 auto 10px;max-width:720px;
}
#bitless-full-study .design-picker button,
#bitless-full-study .screen-picker button{
  font:600 12px/1.2 'Montserrat',Arial,sans-serif;
  border:1px solid var(--border,#dde5ef);
  background:var(--card,#ffffff);
  color:var(--foreground,#182032);
  border-radius:999px;
  padding:8px 13px;
  transition:background .15s ease,border-color .15s ease,color .15s ease,transform .12s ease;
}
#bitless-full-study .design-picker button:hover,
#bitless-full-study .screen-picker button:hover{transform:translateY(-1px)}
#bitless-full-study .design-picker button[aria-pressed=true],
#bitless-full-study .screen-picker button[aria-pressed=true]{
  background:#49CC68;border-color:#49CC68;color:#090D14;font-weight:700;
}

/* Stage & Phone Shell */
#bitless-full-study .stage{max-width:430px;margin:0 auto;container-type:inline-size}
#bitless-full-study .phone{
  height:203.87cqw;
  position:relative;
  border-radius:6cqw;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  line-height:1.25;
  box-shadow:0 16px 44px rgba(9,13,20,.14),0 2px 8px rgba(9,13,20,.08);
  border:1px solid var(--line);
  background:var(--paper);
  color:var(--ink);
  font-family:'Proxima Nova','Montserrat',sans-serif;
}
#bitless-full-study .phone *,
#bitless-full-study .phone button{
  font-family:'Proxima Nova','Montserrat',sans-serif!important;
}

/* Theme Tokens: Fresh Light (signature) vs After Dark (studio) */
#bitless-full-study .phone.uphold-signature{
  --paper:#F7F9F8;
  --surface:#FFFFFF;
  --surface-2:#EEF3F0;
  --ink:#090D14;
  --muted-ink:#5D6862;
  --line:#E1E8E4;
  --brand-accent:#49CC68;
  --brand-ink:#090D14;
  --positive:#49CC68;
  --positive-ink:#167E36;
  --positive-soft:#EAF7ED;
  --negative:#E34F52;
  --negative-soft:#FDECEC;
  --warn:#D97706;
  --warn-soft:#FEF3C7;
  --purple:#8B5CF6;
  --purple-soft:#F3EEFE;
  --hero-bg:#49CC68;
  --hero-ink:#090D14;
  --hero-secondary:#123B1D;
  --hero-art:#FFFFFF33;
  --home-bg:linear-gradient(122deg,#49CC68 0%,#84FB7F 100%);
  --home-ink:#090D14;
  --home-secondary:#143B1F;
  --home-track:#090D1422;
  --home-fill:#090D14;
  --selection:#EAF7ED;
  --selection-ink:#090D14;
  --pill-bg:#FFFFFF;
  --pill-ink:#090D14;
  --count-bg:#FFFFFF30;
  --fade-bg:#F7F9F8;
  --nav-bg:#FFFFFF;
}
#bitless-full-study .phone.uphold-studio{
  --paper:#090D14;
  --surface:#141B24;
  --surface-2:#1C2531;
  --ink:#F5F7FA;
  --muted-ink:#A6B1BD;
  --line:#27323F;
  --brand-accent:#84FB7F;
  --brand-ink:#090D14;
  --positive:#84FB7F;
  --positive-ink:#84FB7F;
  --positive-soft:#182E22;
  --negative:#FF655E;
  --negative-soft:#2E1B1E;
  --warn:#FBBF24;
  --warn-soft:#2D2514;
  --purple:#A78BFA;
  --purple-soft:#231E38;
  --hero-bg:linear-gradient(122deg,#141B24 0%,#1B2530 100%);
  --hero-ink:#F5F7FA;
  --hero-secondary:#A6B1BD;
  --hero-art:#84FB7F24;
  --home-bg:linear-gradient(122deg,#49CC68 0%,#84FB7F 100%);
  --home-ink:#090D14;
  --home-secondary:#143B1F;
  --home-track:#090D1426;
  --home-fill:#090D14;
  --selection:#1E3325;
  --selection-ink:#84FB7F;
  --pill-bg:#1D2733;
  --pill-ink:#F5F7FA;
  --count-bg:#FFFFFF36;
  --fade-bg:#090D14;
  --nav-bg:#111720;
}

/* Status bar strip */
#bitless-full-study .statusbar{
  display:flex;align-items:center;justify-content:space-between;
  padding:2.6cqw 5.5cqw 1cqw;font-size:3cqw;font-weight:600;color:var(--ink);
  flex-shrink:0;background:var(--paper);
}
#bitless-full-study .status-icons{display:flex;align-items:center;gap:1.5cqw;color:var(--ink)}

/* Header Chrome */
#bitless-full-study .chrome{
  display:flex;align-items:center;justify-content:space-between;
  padding:2.2cqw 4.2cqw 2.4cqw;flex-shrink:0;background:var(--paper);
}
#bitless-full-study .brand{
  display:flex;align-items:center;gap:2.3cqw;
  font-size:5.1cqw;font-weight:700;letter-spacing:-.14cqw;color:var(--ink);
}
#bitless-full-study .logo-mark{
  width:5.4cqw;height:7.1cqw;color:var(--brand-accent);flex-shrink:0;display:block;
}
#bitless-full-study .gear-btn{
  width:8.6cqw;height:8.6cqw;border-radius:50%;
  border:1px solid var(--line);background:var(--surface);color:var(--muted-ink);
  display:grid;place-items:center;padding:0;
}
#bitless-full-study .gear-btn svg{width:4.4cqw;height:4.4cqw}

/* Settings Header */
#bitless-full-study .settings-chrome{
  display:grid;grid-template-columns:9cqw 1fr 9cqw;align-items:center;
  padding:2.2cqw 4.2cqw 2.4cqw;flex-shrink:0;background:var(--paper);
  border-bottom:1px solid var(--line);
}
#bitless-full-study .settings-chrome h2{
  margin:0;text-align:center;font-size:4.6cqw;font-weight:700;color:var(--ink);letter-spacing:-.1cqw;
}
#bitless-full-study .close-btn{
  grid-column:3;width:8.6cqw;height:8.6cqw;border-radius:50%;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  display:grid;place-items:center;padding:0;font-size:4.2cqw;font-weight:500;line-height:1;
}

/* Inner Section Tabs (Active underline only, no full-width baseline) */
#bitless-full-study .sections{
  display:flex;padding:0 4.2cqw;flex-shrink:0;gap:2cqw;background:var(--paper);
}
#bitless-full-study .sections button{
  flex:1;border:0;border-bottom:2.2px solid transparent;
  padding:2.1cqw 0 2.4cqw;background:transparent;color:var(--muted-ink);
  font-size:3.8cqw;font-weight:700;transition:color .15s ease,border-color .15s ease;
}
#bitless-full-study .sections button[aria-selected=true]{
  color:var(--positive-ink);border-bottom-color:var(--brand-accent);
}

/* Scrollable Content Area */
#bitless-full-study .content{
  flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;
  padding:2.8cqw 4.2cqw 18cqw;
}
#bitless-full-study .content::-webkit-scrollbar{display:none}
#bitless-full-study .phone[data-page=settings] .content{padding-bottom:8cqw}

/* Currency & Numeric Typography */
#bitless-full-study .money-pair{
  display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums;
}
#bitless-full-study .currency-symbol{
  font-size:.72em;font-weight:500;letter-spacing:0;margin-right:.16em;
}
#bitless-full-study .currency-value{display:inline-block}
#bitless-full-study .money-pair small{display:inline!important;font-size:.62em;letter-spacing:0;font-weight:600;color:inherit;margin:0}
#bitless-full-study .tabular{font-variant-numeric:tabular-nums}

/* Shared Cards & Headings */
#bitless-full-study .card{
  background:var(--surface);border:1px solid var(--line);border-radius:4.2cqw;
  padding:3.8cqw 4cqw;margin-bottom:3cqw;
}
#bitless-full-study .sec-head{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  margin:3.6cqw 0 2.2cqw;padding:0 .6cqw;
}
#bitless-full-study .sec-head h3{
  margin:0;font-size:4cqw;font-weight:700;color:var(--ink);letter-spacing:-.08cqw;
}
#bitless-full-study .sec-head span{
  font-size:max(11px,3cqw);font-weight:600;color:var(--muted-ink);
}
#bitless-full-study .info-dot{
  display:inline-grid;place-items:center;width:4.2cqw;height:4.2cqw;border-radius:50%;
  border:1.4px solid currentColor;font-size:2.5cqw;font-weight:700;opacity:.72;flex-shrink:0;
}

/* Home Screen */
#bitless-full-study .h-greeting{
  font-size:5.3cqw;font-weight:700;letter-spacing:-.15cqw;color:var(--ink);
  margin:.2cqw 0 3.2cqw .6cqw;
}
#bitless-full-study .h-hero{
  isolation:isolate;position:relative;overflow:hidden;
  border-radius:4.8cqw;padding:4.2cqw;margin-bottom:3.4cqw;
  background:var(--home-bg);color:var(--home-ink);
  border:1px solid rgba(9,13,20,.08);
  box-shadow:0 2.4cqw 5cqw -2cqw rgba(73,204,104,.28),inset 0 1px 0 rgba(255,255,255,.3);
}
#bitless-full-study .h-hero:before{
  content:'';position:absolute;z-index:-1;width:62cqw;height:62cqw;
  right:-22cqw;top:-26cqw;border-radius:50%;
  border:1px solid rgba(255,255,255,.36);
  box-shadow:0 0 0 6cqw rgba(255,255,255,.08),0 0 0 12cqw rgba(255,255,255,.05);
}
#bitless-full-study .h-light{
  position:absolute;inset:-20% -60%;z-index:-1;
  background:linear-gradient(108deg,transparent 35%,rgba(255,255,255,.35) 50%,transparent 65%);
  transform:translateX(-70%);pointer-events:none;
}
#bitless-full-study .h-hero.playing .h-light{animation:heroSweep 1.1s ease-out forwards}
@keyframes heroSweep{from{transform:translateX(-70%)}to{transform:translateX(70%)}}

#bitless-full-study .h-label{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  font-size:3.8cqw;font-weight:700;color:var(--home-ink);
}
#bitless-full-study .h-label>span:first-child{display:inline-flex;align-items:center;gap:1.6cqw}
#bitless-full-study .h-estimate{
  font-size:max(10px,2.5cqw);font-weight:600;letter-spacing:.08cqw;
  padding:.9cqw 2.4cqw;border-radius:999px;border:1px solid rgba(9,13,20,.28);
  background:rgba(255,255,255,.16);color:var(--home-ink);
}
#bitless-full-study .h-scope{
  font-size:max(11px,2.9cqw);color:var(--home-secondary);font-weight:500;margin-top:.8cqw;
}
#bitless-full-study .h-date-row{
  display:flex;align-items:center;justify-content:space-between;gap:3cqw;margin:3.2cqw 0 3.2cqw;
}
#bitless-full-study .h-short-date{
  font-size:8.4cqw;font-weight:700;letter-spacing:-.25cqw;color:var(--home-ink);line-height:1;
}
#bitless-full-study .h-count{
  border-left:1px solid rgba(9,13,20,.2);padding:1cqw 2.8cqw;border-radius:2.6cqw;
  background:var(--count-bg);text-align:left;min-width:25cqw;
}
#bitless-full-study .h-count strong{
  display:block;font-size:5.6cqw;font-weight:700;line-height:1.05;color:var(--home-ink);
}
#bitless-full-study .h-count span{
  display:block;font-size:2.5cqw;font-weight:600;letter-spacing:.05cqw;color:var(--home-secondary);line-height:1.2;margin-top:.4cqw;
}
#bitless-full-study .h-progress{
  display:grid;grid-template-columns:repeat(7,1fr);gap:1.5cqw;margin-bottom:2.8cqw;
}
#bitless-full-study .h-progress i{
  display:block;height:1.8cqw;border-radius:999px;background:var(--home-track);
}
#bitless-full-study .h-progress i.on{background:var(--home-fill)}
#bitless-full-study .h-progress i.part{
  background:linear-gradient(90deg,var(--home-fill) 28%,var(--home-track) 28%);
}
#bitless-full-study .h-footer{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  font-size:max(11px,3cqw);color:var(--home-secondary);font-weight:500;
}
#bitless-full-study .h-footer strong{color:var(--home-ink);font-weight:700}

/* Home Snapshot Card */
#bitless-full-study .snap-head{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;margin-bottom:3cqw;
}
#bitless-full-study .snap-title{font-size:4.1cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .snap-title span{font-weight:500;color:var(--muted-ink);font-size:3.2cqw}
#bitless-full-study .snap-body{
  display:grid;grid-template-columns:25cqw 1fr;gap:4.2cqw;align-items:center;
}
#bitless-full-study .snap-ring{
  width:24cqw;height:24cqw;border-radius:50%;
  background:conic-gradient(var(--brand-accent) 0 28%,var(--line) 28% 100%);
  display:grid;place-items:center;margin:0 auto;
}
#bitless-full-study .snap-ring-inner{
  width:17.2cqw;height:17.2cqw;border-radius:50%;background:var(--surface);
  display:grid;place-items:center;font-size:4.4cqw;font-weight:700;color:var(--ink);
}
#bitless-full-study .snap-metrics{display:grid;gap:2.2cqw}
#bitless-full-study .snap-metric>small{
  display:block;font-size:max(11px,2.9cqw);color:var(--muted-ink);font-weight:500;margin-bottom:.4cqw;
}
#bitless-full-study .snap-metric .val{font-size:5.1cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .snap-metric .val.pos{color:var(--positive-ink)}
#bitless-full-study .snap-divider{height:1px;background:var(--line)}
#bitless-full-study .h-pages{
  display:flex;justify-content:center;align-items:center;gap:1.5cqw;margin-top:3.2cqw;
}
#bitless-full-study .h-pages b{
  width:4.4cqw;height:1.4cqw;border-radius:999px;background:var(--brand-accent);display:block;
}
#bitless-full-study .h-pages i{
  width:1.4cqw;height:1.4cqw;border-radius:50%;background:var(--line);display:block;
}

/* Shared Row & Pill Styles */
#bitless-full-study .card-title-row{
  display:flex;align-items:flex-start;justify-content:space-between;gap:2cqw;margin-bottom:2.8cqw;
}
#bitless-full-study .card-title-row h4{
  margin:0;font-size:4.1cqw;font-weight:700;color:var(--ink);
}
#bitless-full-study .card-title-row p{
  margin:.6cqw 0 0;font-size:max(11px,2.9cqw);color:var(--muted-ink);
}
#bitless-full-study .see-all{
  font-size:max(11px,3.1cqw);font-weight:600;color:var(--positive-ink);white-space:nowrap;
  background:transparent;border:0;padding:0;
}
#bitless-full-study .rank{
  width:6.8cqw;height:6.8cqw;border-radius:2cqw;background:var(--surface-2);
  color:var(--ink);display:grid;place-items:center;font-size:3.2cqw;font-weight:700;flex-shrink:0;
}
#bitless-full-study .lead-icon{
  width:9.2cqw;height:9.2cqw;border-radius:50%;display:grid;place-items:center;flex-shrink:0;
  background:var(--positive-soft);color:var(--positive-ink);
}
#bitless-full-study .lead-icon.neutral{background:var(--surface-2);color:var(--muted-ink)}
#bitless-full-study .lead-icon.neg{background:var(--negative-soft);color:var(--negative)}
#bitless-full-study .lead-icon.purp{background:var(--purple-soft);color:var(--purple)}
#bitless-full-study .lead-icon svg{width:4.4cqw;height:4.4cqw}

#bitless-full-study .list-row{
  display:flex;align-items:center;gap:2.6cqw;padding:2cqw 0;
}
#bitless-full-study .list-row + .list-row{border-top:1px solid var(--line)}
#bitless-full-study .row-main{flex:1;min-width:0}
#bitless-full-study .row-main strong{
  display:block;font-size:3.7cqw;font-weight:700;color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#bitless-full-study .row-main span{
  display:block;font-size:max(11px,2.8cqw);color:var(--muted-ink);margin-top:.4cqw;
}
#bitless-full-study .date-pill{
  font-size:max(11px,2.8cqw);font-weight:700;padding:1.4cqw 2.6cqw;border-radius:2.2cqw;
  background:var(--selection);color:var(--selection-ink);white-space:nowrap;
}
#bitless-full-study .chev{color:var(--muted-ink);font-size:4.2cqw;font-weight:600;margin-left:.8cqw}

/* Accounts & Strategy Compact Equal Heroes */
#bitless-full-study .compact-hero{
  isolation:isolate;position:relative;overflow:hidden;
  border-radius:4.4cqw;padding:4cqw 4.2cqw;min-height:31.5cqw;
  display:flex;flex-direction:column;justify-content:space-between;
  background:var(--hero-bg);color:var(--hero-ink);
  border:1px solid var(--hero-art);margin-bottom:3cqw;
}
#bitless-full-study .accounts-hero:after{
  content:'';position:absolute;z-index:-1;width:62cqw;height:44cqw;
  right:-24cqw;top:-16cqw;border-radius:42%;border:1px solid var(--hero-art);
  transform:rotate(-24deg);
  box-shadow:0 0 0 4.2cqw var(--hero-art),0 0 0 8.5cqw rgba(255,255,255,.04);
}
#bitless-full-study .strategy-hero:after{
  content:'';position:absolute;inset:0;z-index:-1;
  background:repeating-linear-gradient(125deg,transparent 0 5.6cqw,var(--hero-art) 5.6cqw 5.8cqw);
  mask-image:linear-gradient(90deg,transparent 36%,#000);
}
#bitless-full-study .hero-top{
  display:flex;align-items:center;justify-content:space-between;
  font-size:max(11px,3.1cqw);font-weight:600;color:var(--hero-secondary);letter-spacing:.04cqw;
}
#bitless-full-study .hero-big{
  font-size:8.6cqw;font-weight:700;letter-spacing:-.25cqw;color:var(--hero-ink);
  margin:1.4cqw 0 1cqw;line-height:1.08;
}
#bitless-full-study .hero-bottom{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  font-size:max(11px,3cqw);color:var(--hero-secondary);font-weight:500;
}
#bitless-full-study .hero-chip{
  padding:1cqw 2.6cqw;border-radius:999px;font-size:max(11px,2.8cqw);font-weight:700;
  background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.22);color:var(--hero-ink);
}
#bitless-full-study .uphold-studio .hero-chip{
  background:rgba(132,251,127,.14);border-color:rgba(132,251,127,.3);color:#84FB7F;
}

/* Accounts Filter Strip (Collapsed Search + Scrollable Pills + Edge Fade) */
#bitless-full-study .acct-filter-row{
  display:flex;align-items:center;gap:2cqw;margin-bottom:3.2cqw;position:relative;
}
#bitless-full-study .icon-square{
  width:9.8cqw;height:9.8cqw;border-radius:2.8cqw;border:1px solid var(--line);
  background:var(--surface);color:var(--positive-ink);display:grid;place-items:center;flex-shrink:0;
}
#bitless-full-study .icon-square svg{width:4.4cqw;height:4.4cqw}
#bitless-full-study .pills-scroll{
  display:flex;align-items:center;gap:1.8cqw;overflow-x:auto;scrollbar-width:none;
  flex:1;min-width:0;padding-right:6cqw;
  -webkit-mask-image:linear-gradient(90deg,#000 84%,transparent 100%);
  mask-image:linear-gradient(90deg,#000 84%,transparent 100%);
}
#bitless-full-study .pills-scroll::-webkit-scrollbar{display:none}
#bitless-full-study .pill{
  display:inline-flex;align-items:center;justify-content:center;gap:1.4cqw;
  height:9.6cqw;padding:0 3.6cqw;border-radius:999px;
  border:1px solid var(--line);background:var(--pill-bg);color:var(--pill-ink);
  font-size:max(11px,3.1cqw);font-weight:600;white-space:nowrap;flex-shrink:0;
}
#bitless-full-study .pill.active{
  background:var(--brand-accent);border-color:var(--brand-accent);color:var(--brand-ink);font-weight:700;
}

/* Group heading with Sort on right (All view hides group balance) */
#bitless-full-study .group-head{
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  margin:1.2cqw 0 2.4cqw .4cqw;
}
#bitless-full-study .group-head h3{
  margin:0;font-size:3.8cqw;font-weight:700;color:var(--muted-ink);
}
#bitless-full-study .sort-btn{
  display:inline-flex;align-items:center;gap:5cqw;
  padding:2cqw 3.2cqw;border-radius:2.8cqw;border:1px solid var(--line);
  background:var(--surface);color:var(--ink);font-size:3.3cqw;font-weight:600;
}
#bitless-full-study .sort-btn svg{width:3.4cqw;height:3.4cqw;color:var(--positive-ink)}

/* Account Cards */
#bitless-full-study .debt-card{
  background:var(--surface);border:1px solid var(--line);border-radius:4cqw;
  padding:3.6cqw 3.8cqw;margin-bottom:2.4cqw;
}
#bitless-full-study .debt-top{display:flex;align-items:center;gap:2.6cqw}
#bitless-full-study .debt-bal{
  font-size:4.2cqw;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:1.4cqw;
}
#bitless-full-study .mini-track{
  height:1.7cqw;border-radius:999px;background:var(--line);overflow:hidden;margin:2.8cqw 0 2cqw;
}
#bitless-full-study .mini-track i{
  display:block;height:100%;border-radius:999px;background:var(--brand-accent);
}
#bitless-full-study .debt-foot{
  display:flex;align-items:center;justify-content:space-between;
  font-size:max(11px,2.9cqw);font-weight:600;color:var(--muted-ink);
}
#bitless-full-study .debt-foot .red-txt{color:var(--positive-ink);font-weight:700}

/* Strategy Screen */
#bitless-full-study .scope-row{display:flex;gap:2.2cqw;margin-bottom:3.4cqw}
#bitless-full-study .method-grid{display:grid;grid-template-columns:1fr 1fr;gap:2.4cqw;margin-bottom:3cqw}
#bitless-full-study .method-card{
  background:var(--surface);border:1.5px solid var(--line);border-radius:3.6cqw;
  padding:3.2cqw 3.4cqw;display:grid;gap:1.2cqw;
}
#bitless-full-study .method-card.selected{
  background:var(--selection);border-color:var(--brand-accent);
}
#bitless-full-study .method-card-top{
  display:flex;align-items:center;justify-content:space-between;color:var(--positive-ink);
}
#bitless-full-study .method-card-top svg{width:4.4cqw;height:4.4cqw}
#bitless-full-study .method-card strong{font-size:3.8cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .method-card span{font-size:max(11px,2.8cqw);color:var(--muted-ink)}
#bitless-full-study .extra-well{
  display:flex;align-items:center;justify-content:space-between;
  background:var(--surface-2);border:1px solid var(--line);border-radius:3cqw;
  padding:3cqw 3.6cqw;margin-top:2.4cqw;
}
#bitless-full-study .extra-well strong{font-size:5.2cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .extra-well span{font-size:3.2cqw;color:var(--muted-ink);font-weight:500}
#bitless-full-study .est-pill{
  font-size:max(11px,2.8cqw);font-weight:700;padding:1cqw 2.8cqw;border-radius:999px;
  border:1px solid var(--brand-accent);background:var(--positive-soft);color:var(--positive-ink);
}

/* Transactions: History */
#bitless-full-study .two-up{display:grid;grid-template-columns:1fr 1fr;gap:2.4cqw;margin-bottom:2.8cqw}
#bitless-full-study .metric-tile{
  background:var(--surface);border:1px solid var(--line);border-radius:3.6cqw;padding:3.4cqw 3.6cqw;
}
#bitless-full-study .metric-tile .lbl{
  display:flex;align-items:center;gap:1.4cqw;font-size:max(11px,2.9cqw);
  color:var(--muted-ink);font-weight:600;margin-bottom:1.4cqw;
}
#bitless-full-study .metric-tile .big{font-size:5.2cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .metric-tile .big.pos{color:var(--positive-ink)}
#bitless-full-study .metric-tile .big.neg{color:var(--negative)}

#bitless-full-study .tx-toolbar{display:flex;align-items:center;gap:2cqw;margin-bottom:3cqw}
#bitless-full-study .date-select{
  flex:1;min-width:0;height:9.8cqw;padding:0 3.2cqw;border-radius:2.8cqw;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  display:flex;align-items:center;justify-content:space-between;gap:2cqw;
  font-size:3.3cqw;font-weight:600;
}
#bitless-full-study .date-select-left{display:flex;align-items:center;gap:2cqw;min-width:0}
#bitless-full-study .date-select svg{width:4cqw;height:4cqw;color:var(--positive-ink);flex-shrink:0}
#bitless-full-study .tx-card{
  background:var(--surface);border:1px solid var(--line);border-radius:3.8cqw;
  padding:3.2cqw 3.6cqw;margin-bottom:2.2cqw;
}
#bitless-full-study .tx-date{
  font-size:max(11px,2.9cqw);font-weight:600;color:var(--muted-ink);margin-bottom:2cqw;
}
#bitless-full-study .tx-row{display:flex;align-items:center;gap:2.6cqw}
#bitless-full-study .tx-right{text-align:right;white-space:nowrap}
#bitless-full-study .tx-amt{font-size:4.1cqw;font-weight:700;display:block}
#bitless-full-study .tx-amt.pos{color:var(--positive-ink)}
#bitless-full-study .tx-amt.neg{color:var(--negative)}
#bitless-full-study .tx-status{
  font-size:max(11px,2.7cqw);font-weight:600;color:var(--muted-ink);margin-top:.5cqw;display:block;
}
#bitless-full-study .tx-status.pos{color:var(--positive-ink)}

/* Transactions: Scheduled Calendar */
#bitless-full-study .cal-head{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:2.8cqw;
}
#bitless-full-study .cal-head h4{margin:0;font-size:4.3cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .cal-arrows{display:flex;gap:3cqw;color:var(--positive-ink);font-size:4.4cqw;font-weight:700}
#bitless-full-study .cal-grid{
  display:grid;grid-template-columns:repeat(7,1fr);gap:1.2cqw .6cqw;text-align:center;
}
#bitless-full-study .cal-dow{font-size:2.9cqw;font-weight:600;color:var(--muted-ink);padding-bottom:1cqw}
#bitless-full-study .cal-day{
  padding:1cqw 0;font-size:3.2cqw;font-weight:500;color:var(--muted-ink);
  display:flex;flex-direction:column;align-items:center;gap:.8cqw;min-height:8.4cqw;
}
#bitless-full-study .cal-day.due{color:var(--ink);font-weight:700}
#bitless-full-study .cal-dots{display:flex;align-items:center;gap:.9cqw;height:1.8cqw}
#bitless-full-study .dot{width:1.6cqw;height:1.6cqw;border-radius:50%;display:inline-block}
#bitless-full-study .dot.paid{background:var(--brand-accent)}
#bitless-full-study .dot.unpaid{background:#F59E0B}
#bitless-full-study .dot.pending{background:#8B5CF6}
#bitless-full-study .dot.planned{background:#38BDF8;border-radius:1px;transform:rotate(45deg);width:1.4cqw;height:1.4cqw}
#bitless-full-study .cal-legend{
  display:flex;justify-content:center;flex-wrap:wrap;gap:3.4cqw;
  margin-top:2.4cqw;padding-top:2.2cqw;border-top:1px solid var(--line);
  font-size:2.7cqw;color:var(--muted-ink);font-weight:500;
}
#bitless-full-study .cal-legend span{display:inline-flex;align-items:center;gap:1.2cqw}
#bitless-full-study .sched-actions{display:flex;flex-direction:column;align-items:flex-end;gap:1.2cqw}
#bitless-full-study .split-btn{
  font-size:max(11px,2.8cqw);font-weight:700;padding:1.1cqw 3.2cqw;border-radius:999px;
  border:1.4px solid var(--brand-accent);background:transparent;color:var(--positive-ink);
}
#bitless-full-study .pay-btn{
  font-size:max(11px,2.8cqw);font-weight:700;padding:1.1cqw 3.6cqw;border-radius:999px;
  border:0;background:var(--brand-accent);color:var(--brand-ink);
}

/* Budget Screen (Preserves Distinct Category Identity Colors) */
#bitless-full-study .income-head{
  display:flex;align-items:center;gap:1.6cqw;font-size:3.5cqw;font-weight:600;color:var(--muted-ink);
}
#bitless-full-study .income-val{
  font-size:8cqw;font-weight:700;letter-spacing:-.2cqw;color:var(--ink);margin:1.2cqw 0 2.6cqw;
}
#bitless-full-study .multi-bar{
  display:flex;gap:1cqw;height:3cqw;margin-bottom:3.4cqw;
}
#bitless-full-study .multi-bar i{display:block;height:100%;border-radius:999px}
#bitless-full-study .income-split{
  display:grid;grid-template-columns:1fr 1fr;gap:3cqw;align-items:center;
}
#bitless-full-study .avail-box{
  border-radius:3cqw;padding:2.4cqw 3cqw;
  border:1px solid rgba(73,204,104,.32);background:var(--positive-soft);
}
#bitless-full-study .avail-box>small{
  display:block;font-size:2.9cqw;font-weight:700;color:var(--positive-ink);margin-bottom:.6cqw;
}
#bitless-full-study .avail-box strong{font-size:4.8cqw;font-weight:700;color:var(--positive-ink)}
#bitless-full-study .month-step{
  display:flex;align-items:center;gap:2.6cqw;font-size:3.3cqw;font-weight:700;color:var(--ink);
}
#bitless-full-study .month-step span{color:var(--positive-ink);font-size:4cqw}
#bitless-full-study .cat-row{padding:3cqw 0}
#bitless-full-study .cat-row + .cat-row{border-top:1px solid var(--line)}
#bitless-full-study .cat-top{display:flex;align-items:center;gap:2.6cqw}
#bitless-full-study .cat-track{
  height:1.6cqw;border-radius:999px;background:var(--line);margin-top:2.2cqw;overflow:hidden;
}
#bitless-full-study .cat-track i{display:block;height:100%;border-radius:999px}

/* Progress: Overview */
#bitless-full-study .seg3{
  display:grid;grid-template-columns:repeat(3,1fr);padding:1cqw;border-radius:3cqw;
  background:var(--surface-2);border:1px solid var(--line);margin:2.6cqw 0 3cqw;
}
#bitless-full-study .seg3 span{
  text-align:center;padding:2.2cqw 1cqw;border-radius:2.2cqw;
  font-size:3.1cqw;font-weight:700;color:var(--muted-ink);
}
#bitless-full-study .seg3 span.active{
  background:var(--brand-accent);color:var(--brand-ink);
}
#bitless-full-study .speed-banner{
  display:grid;grid-template-columns:1fr 34cqw;gap:2.4cqw;align-items:center;
  border-radius:3.6cqw;padding:3.4cqw;background:var(--positive-soft);
  border:1px solid rgba(73,204,104,.24);margin-bottom:3cqw;
}
#bitless-full-study .speed-banner h4{
  margin:0;font-size:5.2cqw;font-weight:700;color:var(--ink);
}
#bitless-full-study .speed-banner p{
  margin:1.2cqw 0 2.2cqw;font-size:3.1cqw;font-weight:700;color:var(--positive-ink);
}
#bitless-full-study .target-pill{
  display:inline-flex;align-items:center;gap:1.2cqw;padding:1.2cqw 2.4cqw;border-radius:999px;
  background:var(--surface);border:1px solid rgba(73,204,104,.3);
  font-size:2.8cqw;font-weight:700;color:var(--ink);
}
#bitless-full-study .recorded-big{
  font-size:7.2cqw;font-weight:700;color:var(--positive-ink);margin:1cqw 0 .6cqw;line-height:1.08;
}

/* Progress: Utilization (Risk Colors Intact) */
#bitless-full-study .util-hero{
  display:grid;grid-template-columns:1fr 35cqw;gap:3.2cqw;align-items:center;
}
#bitless-full-study .util-kv{padding:1.6cqw 0}
#bitless-full-study .util-kv + .util-kv{border-top:1px solid var(--line)}
#bitless-full-study .util-kv>small{
  display:block;font-size:2.8cqw;color:var(--muted-ink);font-weight:500;
}
#bitless-full-study .util-kv strong{font-size:3.8cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .util-gauge{text-align:center}
#bitless-full-study .util-donut{
  width:29cqw;height:29cqw;border-radius:50%;margin:0 auto 2cqw;
  background:conic-gradient(#1F9D4C 0 26.8%,var(--line) 26.8% 100%);
  display:grid;place-items:center;
}
#bitless-full-study .uphold-studio .util-donut{
  background:conic-gradient(#84FB7F 0 26.8%,var(--line) 26.8% 100%);
}
#bitless-full-study .util-donut-inner{
  width:21cqw;height:21cqw;border-radius:50%;background:var(--surface);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
}
#bitless-full-study .util-donut-inner strong{font-size:4.6cqw;font-weight:700;color:var(--ink)}
#bitless-full-study .util-donut-inner span{font-size:2.6cqw;color:var(--muted-ink)}
#bitless-full-study .risk-badge{
  font-size:3cqw;font-weight:700;padding:1.1cqw 2.8cqw;border-radius:999px;color:#fff;display:inline-block;
}
#bitless-full-study .risk-good{background:#1F9D4C}
#bitless-full-study .risk-watch{background:#D97706}
#bitless-full-study .risk-high{background:#E34F52}
#bitless-full-study .util-bar-wrap{position:relative;margin:2.6cqw 0 1.6cqw}
#bitless-full-study .util-bar-track{height:2.2cqw;border-radius:999px;background:var(--line);overflow:hidden}
#bitless-full-study .util-bar-fill{height:100%;border-radius:999px}
#bitless-full-study .target-marker{
  position:absolute;left:30%;top:-.9cqw;bottom:-.9cqw;width:0;
  border-left:2px dashed var(--ink);opacity:.65;
}

/* Progress: Milestones */
#bitless-full-study .award-seal{
  width:15cqw;height:15cqw;border-radius:50%;background:var(--positive-soft);
  border:1.5px solid var(--brand-accent);display:grid;place-items:center;color:var(--positive-ink);
  flex-shrink:0;
}
#bitless-full-study .award-seal svg{width:7.5cqw;height:7.5cqw}
#bitless-full-study .timeline-row{display:flex;align-items:flex-start;gap:3cqw;position:relative}
#bitless-full-study .timeline-row + .timeline-row{margin-top:3.4cqw}
#bitless-full-study .check-dot{
  width:7.2cqw;height:7.2cqw;border-radius:50%;background:var(--brand-accent);color:var(--brand-ink);
  display:grid;place-items:center;font-size:3.6cqw;font-weight:700;flex-shrink:0;position:relative;z-index:1;
}
#bitless-full-study .timeline-line{
  position:absolute;left:3.5cqw;top:7.2cqw;bottom:-3.6cqw;width:1.5px;background:var(--line);
}

/* Settings Screen */
#bitless-full-study .profile-card{
  display:flex;align-items:center;gap:3.2cqw;padding:3.6cqw 4cqw;border-radius:4cqw;
  background:var(--positive-soft);border:1px solid rgba(73,204,104,.24);margin-bottom:3.8cqw;
}
#bitless-full-study .avatar{
  width:11.5cqw;height:11.5cqw;border-radius:50%;background:var(--brand-accent);color:var(--brand-ink);
  display:grid;place-items:center;flex-shrink:0;
}
#bitless-full-study .avatar svg{width:6cqw;height:6cqw}
#bitless-full-study .set-group-lbl{
  font-size:2.9cqw;font-weight:700;letter-spacing:.08cqw;color:var(--positive-ink);
  margin:3.2cqw 0 1.4cqw 1cqw;
}
#bitless-full-study .set-card{
  background:var(--surface);border:1px solid var(--line);border-radius:3.8cqw;padding:0 3.6cqw;
}
#bitless-full-study .set-row{
  display:flex;align-items:center;gap:3cqw;padding:3cqw 0;
}
#bitless-full-study .set-row + .set-row{border-top:1px solid var(--line)}
#bitless-full-study .set-row svg{width:4.4cqw;height:4.4cqw;color:var(--muted-ink);flex-shrink:0}
#bitless-full-study .set-val{font-size:3.3cqw;color:var(--muted-ink);font-weight:500;margin-right:.6cqw}

/* Floating + FAB (Fresh Light Green, Only on Accounts / Transactions / Budget) */
#bitless-full-study .fab{
  position:absolute;z-index:5;right:4.4cqw;bottom:18.6cqw;
  width:13.2cqw;height:13.2cqw;border-radius:50%;border:0;
  background:var(--brand-accent);color:var(--brand-ink);
  box-shadow:0 2cqw 4.5cqw rgba(9,13,20,.26);
  display:grid;place-items:center;pointer-events:none;
}
#bitless-full-study .fab svg{width:6.2cqw;height:6.2cqw}

/* Five-Tab Bottom Dock (24x24 1.8px outline SVG family) */
#bitless-full-study .nav{
  height:14.8cqw;flex-shrink:0;z-index:4;
  background:var(--nav-bg);border-top:1px solid var(--line);
  display:grid;grid-template-columns:repeat(5,1fr);align-items:center;
  padding:0 1.5cqw 1cqw;
}
#bitless-full-study .nav-item{
  border:0;background:transparent;padding:1.2cqw 0;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1cqw;
  color:var(--muted-ink);font-size:2.55cqw;font-weight:600;
}
#bitless-full-study .nav-item svg{width:5.4cqw;height:5.4cqw;display:block}
#bitless-full-study .nav-item[aria-current=page]{color:var(--positive-ink);font-weight:700}
#bitless-full-study .nav-item[aria-current=page] svg{color:var(--brand-accent)}

/* Footer Disclosure & Color Key */
#bitless-full-study .review-footer{
  display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:10px;
  margin:12px auto 4px;max-width:720px;
}
#bitless-full-study .motion-replay{
  font:600 11.5px/1 'Montserrat',Arial,sans-serif;
  padding:7px 12px;border-radius:999px;border:1px solid var(--border,#dde5ef);
  background:var(--card,#fff);color:var(--foreground,#182032);
}
#bitless-full-study .preview-note{
  font:500 11px/1.3 Arial,sans-serif;color:var(--muted-foreground,#68758a);
}
#bitless-full-study .signal-legend{
  display:flex;justify-content:center;flex-wrap:wrap;gap:8px 18px;
  margin:6px auto 2px;font:500 11px/1.4 Arial,sans-serif;color:var(--muted-foreground,#68758a);
}
#bitless-full-study .signal-legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
#bitless-full-study .signal-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}
"""

HTML_BODY = r"""
<svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">
  <symbol id="bl-mark" viewBox="100 12 156 208" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 212 99 C 196 87, 160 87, 160 105 C 160 123, 196 123, 214 113 C 242 125, 246 164, 218 182 C 192 198, 148 192, 130 166 C 112 140, 114 82, 136 56 C 156 32, 200 34, 218 56 C 230 71, 226 89, 212 99 Z"/>
  </symbol>
  <symbol id="nav-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.8 11.1 12 3.4l9.2 7.7"/><path d="M4.8 9.5V20h14.4V9.5"/><path d="M12 11.3v6.2"/><path d="M14.2 12.4c-.35-.7-1.1-1.05-2.1-1.05-1.15 0-1.9.55-1.9 1.35 0 1.8 4 1 4 3.1 0 .8-.78 1.4-2.05 1.4-1.02 0-1.82-.4-2.2-1.15"/>
  </symbol>
  <symbol id="nav-accounts" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="M4 9.8h16"/><path d="M7 14.2h4"/>
  </symbol>
  <symbol id="nav-transactions" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="5.5" width="16" height="14.5" rx="1.8"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/><circle cx="8" cy="13" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r=".6" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r=".6" fill="currentColor" stroke="none"/><circle cx="8" cy="16.5" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none"/><circle cx="16" cy="16.5" r=".6" fill="currentColor" stroke="none"/>
  </symbol>
  <symbol id="nav-budget" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5.4 5h12.2a2 2 0 0 1 2 2v1.3"/><path d="M5.5 5a2.5 2.5 0 0 0 0 5h14.8v9.2H5.5A2.5 2.5 0 0 1 3 16.7V7.5A2.5 2.5 0 0 1 5.5 5Z"/><path d="M17.3 12.5h4v4h-4a2 2 0 0 1 0-4Z"/><circle cx="17.7" cy="14.5" r=".5" fill="currentColor" stroke="none"/>
  </symbol>
  <symbol id="nav-progress" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.5" y="3.8" width="17" height="11.5" rx="1.5"/><path d="m7.5 11.2 3.1-3.1 2.2 1.9 3.8-4.1"/><path d="M14.2 5.9h2.5v2.5"/><path d="m8 15.3 4 5.2 4-5.2M12 20.5h-4M12 20.5h4"/>
  </symbol>
  <symbol id="ic-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.76l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.98 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.76.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-.98H3a2 2 0 1 1 0-4h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.76.32H9a1.6 1.6 0 0 0 .98-1.47V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 .98 1.47 1.6 1.6 0 0 0 1.76-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.76V9c.2.62.78 1.04 1.44 1.05H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.51.95Z"/>
  </symbol>
  <symbol id="ic-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>
  <symbol id="ic-filter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16l-6 7.5V19l-4 1.5v-7Z"/></symbol>
  <symbol id="ic-sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3"/></symbol>
  <symbol id="ic-chev-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></symbol>
  <symbol id="ic-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></symbol>
  <symbol id="ic-bars" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 19v-5M12 19V9M18 19V5"/></symbol>
  <symbol id="ic-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12 7 7h10l2 5v5H5v-5Z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/><path d="M3.5 12h17"/></symbol>
  <symbol id="ic-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6l-7-3Z"/></symbol>
  <symbol id="ic-trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5V8a3 3 0 0 0 3 3M17 6h2.5A1.5 1.5 0 0 1 21 7.5V8a3 3 0 0 1-3 3M12 14v5M8 19h8"/></symbol>
  <symbol id="ic-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
  <symbol id="ic-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 2-2 1.8 1.8 0 0 1 1.8-1.8H19A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="10.5" cy="7.5" r=".9" fill="currentColor"/><circle cx="15" cy="8.5" r=".9" fill="currentColor"/></symbol>
  <symbol id="ic-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/></symbol>
  <symbol id="ic-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></symbol>
  <symbol id="ic-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.2"/><path d="M17.5 14c2 .4 3.5 2 3.5 4.5"/></symbol>
  <symbol id="ic-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></symbol>
  <symbol id="ic-history" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="ic-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"/></symbol>
</svg>

<div id="bitless-full-study">
  <div class="design-picker" role="group" aria-label="Theme variants">
    <button data-design="signature" aria-pressed="true">Fresh Light</button>
    <button data-design="studio" aria-pressed="false">After Dark</button>
  </div>
  <div class="screen-picker" role="group" aria-label="App screens">
    <button data-screen="home" aria-pressed="true">Home</button>
    <button data-screen="accounts" aria-pressed="false">Accounts</button>
    <button data-screen="strategy" aria-pressed="false">Strategy</button>
    <button data-screen="history" aria-pressed="false">Transactions · History</button>
    <button data-screen="scheduled" aria-pressed="false">Transactions · Scheduled</button>
    <button data-screen="budget" aria-pressed="false">Budget</button>
    <button data-screen="overview" aria-pressed="false">Progress · Overview</button>
    <button data-screen="utilization" aria-pressed="false">Progress · Utilization</button>
    <button data-screen="milestones" aria-pressed="false">Progress · Milestones</button>
    <button data-screen="settings" aria-pressed="false">Settings</button>
  </div>

  <div class="stage">
    <div class="phone uphold-signature" data-page="home">
      <div class="statusbar" aria-hidden="true">
        <span>6:20</span>
        <span class="status-icons"><span>5G</span><span>▲</span><span>▮</span></span>
      </div>

      <div class="chrome" id="main-chrome">
        <div class="brand">
          <svg class="logo-mark" aria-hidden="true"><use href="#bl-mark"/></svg>
          <span class="brand-title">BitLess</span>
        </div>
        <button class="gear-btn" data-nav="settings" aria-label="Open settings"><svg><use href="#ic-gear"/></svg></button>
      </div>

      <div class="settings-chrome" id="settings-chrome" hidden>
        <h2>Settings</h2>
        <button class="close-btn" id="close-settings-btn" aria-label="Close Settings">✕</button>
      </div>

      <div class="sections" id="section-tabs" role="tablist" aria-label="Section tabs" hidden></div>

      <div class="content" id="study-page" role="tabpanel"></div>

      <button class="fab" id="add-fab" aria-label="Quick add button" hidden><svg><use href="#ic-plus"/></svg></button>

      <nav class="nav" id="bottom-nav" aria-label="Main navigation">
        <button class="nav-item" data-nav="home" aria-current="page"><svg><use href="#nav-home"/></svg><span>Home</span></button>
        <button class="nav-item" data-nav="accounts"><svg><use href="#nav-accounts"/></svg><span>Accounts</span></button>
        <button class="nav-item" data-nav="history"><svg><use href="#nav-transactions"/></svg><span>Transactions</span></button>
        <button class="nav-item" data-nav="budget"><svg><use href="#nav-budget"/></svg><span>Budget</span></button>
        <button class="nav-item" data-nav="overview"><svg><use href="#nav-progress"/></svg><span>Progress</span></button>
      </nav>
    </div>
  </div>

  <div class="review-footer">
    <button class="motion-replay">Replay Home motion</button>
    <span class="preview-note">Proxima Nova unavailable · Montserrat preview stand-in</span>
  </div>
  <div class="signal-legend" aria-label="Financial color key">
    <span><i id="leg-pos" style="background:#49CC68"></i>Debt reduced / Brand accent</span>
    <span><i id="leg-neg" style="background:#E34F52"></i>Debt increased / Charges</span>
    <span><i style="background:#60A5FA"></i>Category &amp; utilization colors stay distinct</span>
  </div>
</div>

<script>
(() => {
  const root = document.getElementById('bitless-full-study');
  const phone = root.querySelector('.phone');
  const content = document.getElementById('study-page');
  const mainChrome = document.getElementById('main-chrome');
  const settingsChrome = document.getElementById('settings-chrome');
  const sectionTabs = document.getElementById('section-tabs');
  const bottomNav = document.getElementById('bottom-nav');
  const addFab = document.getElementById('add-fab');
  const brandTitle = root.querySelector('.brand-title');
  const replayBtn = root.querySelector('.motion-replay');
  const legPos = document.getElementById('leg-pos');
  const legNeg = document.getElementById('leg-neg');

  let design = 'signature';
  let page = 'home';
  let lastNonSettings = 'home';

  const money = (whole, cents = '', prefix = '') =>
    `<span class="money-pair">${prefix ? `<span>${prefix}</span>` : ''}<span class="currency-symbol">$</span><span class="currency-value">${whole}${cents ? `<small>.${cents}</small>` : ''}</span></span>`;

  const svgIcon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

  const tabMap = {
    home: { nav: 'home', title: 'BitLess', sections: null, fab: false },
    accounts: { nav: 'accounts', title: 'Accounts', sections: [{ id: 'accounts', label: 'Accounts' }, { id: 'strategy', label: 'Strategy' }], fab: true },
    strategy: { nav: 'accounts', title: 'Accounts', sections: [{ id: 'accounts', label: 'Accounts' }, { id: 'strategy', label: 'Strategy' }], fab: false },
    history: { nav: 'history', title: 'Transactions', sections: [{ id: 'history', label: 'History' }, { id: 'scheduled', label: 'Scheduled' }], fab: true },
    scheduled: { nav: 'history', title: 'Transactions', sections: [{ id: 'history', label: 'History' }, { id: 'scheduled', label: 'Scheduled' }], fab: true },
    budget: { nav: 'budget', title: 'Budget', sections: null, fab: true },
    overview: { nav: 'overview', title: 'Progress', sections: [{ id: 'overview', label: 'Overview' }, { id: 'utilization', label: 'Utilization' }, { id: 'milestones', label: 'Milestones' }], fab: false },
    utilization: { nav: 'overview', title: 'Progress', sections: [{ id: 'overview', label: 'Overview' }, { id: 'utilization', label: 'Utilization' }, { id: 'milestones', label: 'Milestones' }], fab: false },
    milestones: { nav: 'overview', title: 'Progress', sections: [{ id: 'overview', label: 'Overview' }, { id: 'utilization', label: 'Utilization' }, { id: 'milestones', label: 'Milestones' }], fab: false },
    settings: { nav: null, title: 'Settings', sections: null, fab: false }
  };

  function screenHome() {
    return `
      <div class="h-greeting">Hi, Lawrence</div>
      <div class="h-hero playing">
        <div class="h-light" aria-hidden="true"></div>
        <div class="h-label">
          <span>Debt-Free Date <i class="info-dot">i</i></span>
          <span class="h-estimate">ESTIMATE</span>
        </div>
        <div class="h-scope">Cards / Loans &amp; Auto</div>
        <div class="h-date-row">
          <div class="h-short-date">MAR 2028</div>
          <div class="h-count"><strong>16</strong><span>MONTHS<br>TO GO</span></div>
        </div>
        <div class="h-progress" aria-label="Freedom progress">
          <i class="on"></i><i class="on"></i><i class="part"></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="h-footer">
          <span>Keep building your freedom.</span>
          <strong>Avalanche ›</strong>
        </div>
      </div>

      <div class="card">
        <div class="snap-head">
          <div class="snap-title">Your Accounts <span>· Cards &amp; Loans (9)</span></div>
          <i class="info-dot" style="color:var(--muted-ink)">i</i>
        </div>
        <div class="snap-body">
          <div class="snap-ring"><div class="snap-ring-inner">28%</div></div>
          <div class="snap-metrics">
            <div class="snap-metric"><small>Paid</small><div class="val pos">${money('17,178','55')}</div></div>
            <div class="snap-divider"></div>
            <div class="snap-metric"><small>Balance</small><div class="val">${money('44,119','33')}</div></div>
          </div>
        </div>
        <div class="h-pages" aria-hidden="true"><b></b><i></i><i></i></div>
      </div>

      <div class="card">
        <div class="card-title-row">
          <div><h4>Payoff Strategy</h4><p>Avalanche · Cards &amp; Loans</p></div>
          <button class="see-all" data-jump="strategy">See all ›</button>
        </div>
        <div class="list-row">
          <span class="rank">1</span>
          <span class="lead-icon">${svgIcon('nav-accounts')}</span>
          <div class="row-main"><strong>Discover</strong><span>26.74% APR</span></div>
          <span class="date-pill">Dec 2026</span>
        </div>
        <div class="list-row">
          <span class="rank">2</span>
          <span class="lead-icon">${svgIcon('nav-accounts')}</span>
          <div class="row-main"><strong>Citi Cash</strong><span>25.74% APR</span></div>
          <span class="date-pill">Feb 2027</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row">
          <div><h4>Recent Activity</h4><p>November 2026 ledger</p></div>
          <button class="see-all" data-jump="history">See all ›</button>
        </div>
        <div class="list-row">
          <span class="lead-icon pos">${svgIcon('nav-accounts')}</span>
          <div class="row-main"><strong>Payment</strong><span>Chase Freed · Nov 16</span></div>
          <div class="tx-right"><span class="tx-amt pos">${money('136','77','−')}</span><span class="tx-status pos">✓ Paid</span></div>
        </div>
        <div class="list-row">
          <span class="lead-icon purp">${svgIcon('nav-accounts')}</span>
          <div class="row-main"><strong>Single purchase</strong><span>Chase Prime · Nov 17</span></div>
          <div class="tx-right"><span class="tx-amt neg">${money('10','62','+')}</span></div>
        </div>
      </div>
    `;
  }

  function screenAccounts() {
    const cards = [
      { name: 'Chase Freed', type: 'Credit card · 21.24% APR', w: '4,618', c: '93', pct: '13.0', date: 'Nov 2027' },
      { name: 'Chase Prime', type: 'Credit card · 23.49% APR', w: '6,899', c: '54', pct: '2.0', date: 'Jun 2027' },
      { name: 'Citi Card Double Cash', type: 'Credit card · 21.74% APR', w: '4,200', c: '10', pct: '3.9', date: 'Oct 2027' }
    ];
    return `
      <div class="compact-hero accounts-hero">
        <div class="hero-top"><span>Total Balance</span><i class="info-dot">i</i></div>
        <div class="hero-big">${money('375,435','31')}</div>
        <div class="hero-bottom"><span>11 active accounts</span><span>All active categories</span></div>
      </div>

      <div class="acct-filter-row">
        <button class="icon-square" aria-label="Search accounts">${svgIcon('ic-search')}</button>
        <div class="pills-scroll" role="group" aria-label="Account categories">
          <span class="pill active">All (11)</span>
          <span class="pill">Credit Cards</span>
          <span class="pill">Auto</span>
          <span class="pill">Home</span>
          <span class="pill">Paid Off</span>
        </div>
      </div>

      <div class="group-head">
        <h3>Credit Cards</h3>
        <button class="sort-btn"><span>Name</span>${svgIcon('ic-chev-down')}</button>
      </div>

      ${cards.map(a => `
        <div class="debt-card">
          <div class="debt-top">
            <span class="lead-icon">${svgIcon('nav-accounts')}</span>
            <div class="row-main"><strong>${a.name}</strong><span>${a.type}</span></div>
            <div class="debt-bal">${money(a.w, a.c)}<span class="chev">›</span></div>
          </div>
          <div class="mini-track"><i style="width:${a.pct}%"></i></div>
          <div class="debt-foot">
            <span class="red-txt">↓ ${a.pct}% reduced</span>
            <span>Est. ${a.date}</span>
          </div>
        </div>
      `).join('')}

      <div class="group-head" style="margin-top:3.4cqw">
        <h3>Auto</h3>
      </div>
      <div class="debt-card">
        <div class="debt-top">
          <span class="lead-icon">${svgIcon('ic-car')}</span>
          <div class="row-main"><strong>Civic Touring</strong><span>Auto loan · 4.49% APR</span></div>
          <div class="debt-bal">${money('18,240','00')}<span class="chev">›</span></div>
        </div>
        <div class="mini-track"><i style="width:18.2%"></i></div>
        <div class="debt-foot">
          <span class="red-txt">↓ 18.2% reduced</span>
          <span>Est. Mar 2029</span>
        </div>
      </div>
    `;
  }

  function screenStrategy() {
    const order = [
      { n: 1, name: 'Discover', apr: '26.74% APR', w: '1,953', c: '64', date: 'Dec 2026' },
      { n: 2, name: 'Citi Cash', apr: '25.74% APR', w: '5,285', c: '56', date: 'Feb 2027' },
      { n: 3, name: 'Wells Fargo', apr: '24.99% APR', w: '4,756', c: '45', date: 'Apr 2027' }
    ];
    return `
      <div class="compact-hero strategy-hero">
        <div class="hero-top"><span>ESTIMATED PAYOFF</span><i class="info-dot">i</i></div>
        <div class="hero-big">Mar 2028</div>
        <div class="hero-bottom"><span>16 months</span><span class="hero-chip">Avalanche</span></div>
      </div>

      <div class="scope-row">
        <span class="pill active">Debt strategy</span>
        <span class="pill">Mortgage strategy</span>
      </div>

      <div class="sec-head" style="margin-top:0"><h3>Your method</h3></div>
      <div class="method-grid">
        <div class="method-card">
          <div class="method-card-top">${svgIcon('ic-bolt')}</div>
          <strong>Snowball</strong>
          <span>Smallest balance first</span>
        </div>
        <div class="method-card selected">
          <div class="method-card-top">${svgIcon('ic-bars')}</div>
          <strong>Avalanche</strong>
          <span>Highest APR first</span>
        </div>
      </div>

      <div class="card">
        <div class="snap-head" style="margin-bottom:0">
          <div class="snap-title" style="font-size:3.9cqw">Extra monthly payment</div>
          <i class="info-dot" style="color:var(--muted-ink)">i</i>
        </div>
        <div class="extra-well">
          <strong>${money('2,500','00')}</strong>
          <span>/ month</span>
        </div>
      </div>

      <div class="sec-head">
        <h3>Payoff order</h3>
        <span class="est-pill">Estimated</span>
      </div>
      <div class="card" style="padding:1.8cqw 3.8cqw">
        ${order.map(r => `
          <div class="list-row">
            <span class="rank">${r.n}</span>
            <span class="lead-icon">${svgIcon('nav-accounts')}</span>
            <div class="row-main"><strong>${r.name}</strong><span>${r.apr}</span></div>
            <div class="tx-right">
              <strong style="font-size:3.8cqw;color:var(--ink)">${money(r.w, r.c)}</strong>
              <div style="margin-top:1cqw"><span class="date-pill">${r.date}</span></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function screenHistory() {
    const txs = [
      { date: 'Nov 17, 2026', title: 'Single purchase', sub: 'Chase Prime - Purchase', amt: ['10','62','+'], kind: 'neg', cls: 'purp' },
      { date: 'Nov 16, 2026', title: 'Payment', sub: 'Chase Freed - Payment', amt: ['136','77','−'], kind: 'pos', cls: '', status: '✓ Paid' },
      { date: 'Nov 14, 2026', title: 'USBConnect', sub: 'USBConnect - Purchase', amt: ['79','09','+'], kind: 'neg', cls: 'purp' },
      { date: 'Nov 14, 2026', title: 'USBConnect', sub: 'USBConnect - Purchase', amt: ['57','42','+'], kind: 'neg', cls: 'purp' }
    ];
    return `
      <div class="two-up">
        <div class="metric-tile">
          <div class="lbl"><span style="color:var(--positive-ink)">↘</span> Payments</div>
          <div class="big pos">${money('6,722','83')}</div>
        </div>
        <div class="metric-tile">
          <div class="lbl"><span style="color:var(--negative)">↗</span> Interest &amp; Fees</div>
          <div class="big neg">${money('890','60')}</div>
        </div>
      </div>

      <div class="tx-toolbar">
        <div class="date-select">
          <span class="date-select-left">${svgIcon('nav-transactions')}<span>November 2026</span></span>
          ${svgIcon('ic-chev-down')}
        </div>
        <button class="icon-square" aria-label="Search">${svgIcon('ic-search')}</button>
        <button class="icon-square" aria-label="Filters">${svgIcon('ic-filter')}</button>
        <button class="icon-square" aria-label="Sort">${svgIcon('ic-sort')}</button>
      </div>

      ${txs.map(t => `
        <div class="tx-card">
          <div class="tx-date">${t.date}</div>
          <div class="tx-row">
            <span class="lead-icon ${t.cls}">${svgIcon('nav-accounts')}</span>
            <div class="row-main"><strong>${t.title}</strong><span>${t.sub}</span></div>
            <div class="tx-right">
              <span class="tx-amt ${t.kind}">${money(t.amt[0], t.amt[1], t.amt[2])}</span>
              ${t.status ? `<span class="tx-status pos">${t.status}</span>` : ''}
            </div>
            <span class="chev">›</span>
          </div>
        </div>
      `).join('')}
    `;
  }

  function screenScheduled() {
    const dots = {
      1:['paid'], 2:['paid'], 5:['paid'], 9:['paid'], 13:['paid'], 17:['paid'],
      19:['unpaid'], 20:['paid','unpaid'], 22:['paid'], 24:['planned'], 25:['pending'],
      27:['paid'], 28:['paid']
    };
    const days = Array.from({length:30}, (_,i)=>i+1);
    const items = [
      { name:'Citi Card Double Cash', sub:'Due Nov 1 · Minimum payment', status:'Paid', kind:'pos', w:'121', c:'52', btn:'split' },
      { name:'Discover', sub:'Due Nov 1 · Minimum payment', status:'Paid', kind:'pos', w:'96', c:'85', btn:'split' },
      { name:'House', sub:'Due Nov 1 · Minimum payment', status:'Paid', kind:'pos', w:'2,210', c:'90', btn:'split' },
      { name:'Wells Fargo', sub:'Due Nov 19 · Minimum payment', status:'Unpaid', kind:'warn', w:'145', c:'00', btn:'pay' }
    ];
    return `
      <div class="card">
        <div class="cal-head">
          <h4>November 2026</h4>
          <div class="cal-arrows"><span>‹</span><span>›</span></div>
        </div>
        <div class="cal-grid">
          ${['S','M','T','W','T','F','S'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
          ${days.map(d => {
            const ds = dots[d] || [];
            return `<div class="cal-day ${ds.length?'due':''}">
              <span>${d}</span>
              <div class="cal-dots">${ds.map(k=>`<i class="dot ${k}"></i>`).join('')}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="cal-legend">
          <span><i class="dot paid"></i>Paid</span>
          <span><i class="dot unpaid"></i>Unpaid</span>
          <span><i class="dot pending"></i>Pending</span>
          <span><i class="dot planned"></i>Planned</span>
        </div>
      </div>

      <div class="sec-head">
        <h3>November 2026</h3>
        <span class="est-pill">16 items</span>
      </div>

      <div class="card" style="padding:1.6cqw 3.8cqw">
        ${items.map(it => `
          <div class="list-row" style="padding:2.6cqw 0">
            <span class="lead-icon">${svgIcon('nav-accounts')}</span>
            <div class="row-main">
              <strong>${it.name}</strong>
              <span>${it.sub}</span>
              <span style="color:${it.kind==='pos'?'var(--positive-ink)':'var(--warn)'};font-weight:700;margin-top:.5cqw">${it.status}</span>
            </div>
            <div class="sched-actions">
              <strong style="font-size:3.9cqw;color:var(--ink)">${money(it.w,it.c)}</strong>
              ${it.btn==='split' ? `<button class="split-btn">Split</button>` : `<button class="pay-btn">Pay</button>`}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function screenBudget() {
    const cats = [
      { name:'Debt payments', pct:'49%', sub:'Card minimums + extra', w:'3,804', c:'09', color:'#76DCB9', textCol:'#178A5B', fill:49, icon:'nav-accounts' },
      { name:'Housing & Rent', pct:'30%', sub:'2 active items (includes 1 synced loan)', w:'2,373', c:'90', color:'#60A5FA', textCol:'#2563EB', fill:30, icon:'nav-home' },
      { name:'Subscriptions', pct:'2%', sub:'4 active bills', w:'189', c:'72', color:'#A78BFA', textCol:'#7C3AED', fill:2.4, icon:'nav-accounts' },
      { name:'Insurance', pct:'2%', sub:'1 active bill', w:'179', c:'80', color:'#EC4899', textCol:'#BE185D', fill:2.3, icon:'ic-shield' },
      { name:'Transportation', pct:'8%', sub:'1 active item (includes 1 synced loan)', w:'587', c:'30', color:'#F5C563', textCol:'#B45309', fill:7.5, icon:'ic-car' }
    ];
    return `
      <div class="card">
        <div class="income-head"><span>Monthly Income</span><span style="color:var(--positive-ink)">✎</span></div>
        <div class="income-val">${money('7,800','00')}</div>
        <div class="multi-bar" aria-label="Category allocation breakdown">
          <i style="width:48%;background:#76DCB9"></i>
          <i style="width:30%;background:#60A5FA"></i>
          <i style="width:2.5%;background:#A78BFA"></i>
          <i style="width:2.5%;background:#EC4899"></i>
          <i style="width:8%;background:#F5C563"></i>
          <i style="width:6%;background:#F08B78"></i>
        </div>
        <div class="income-split">
          <div>
            <small style="display:block;font-size:2.9cqw;color:var(--muted-ink);font-weight:600;margin-bottom:.6cqw">Budget</small>
            <strong style="font-size:4.8cqw;color:var(--ink)">${money('7,134','81')}</strong>
          </div>
          <div class="avail-box">
            <small>Available</small>
            <strong>${money('665','19')}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row" style="align-items:center;margin-bottom:2cqw">
          <h4>Budget breakdown</h4>
          <div class="month-step"><span>‹</span><strong>Nov 2026</strong><span>›</span></div>
        </div>
        ${cats.map(c => {
          const dispCol = design === 'studio' ? c.color : c.textCol;
          return `
            <div class="cat-row">
              <div class="cat-top">
                <span class="lead-icon" style="background:${c.color}22;color:${dispCol}">${svgIcon(c.icon)}</span>
                <div class="row-main">
                  <strong>${c.name} <span style="display:inline;color:${dispCol};font-size:3.1cqw;margin-left:1cqw">${c.pct}</span></strong>
                  <span>${c.sub}</span>
                </div>
                <strong style="font-size:3.9cqw;color:${dispCol}">${money(c.w,c.c)}</strong>
                <span class="chev">›</span>
              </div>
              <div class="cat-track"><i style="width:${c.fill}%;background:${c.color}"></i></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function screenOverview() {
    const acts = [
      { name:'Citi Costco', entries:'2 entries', w:'304', c:'03', sign:'−', kind:'pos' },
      { name:'Chase Freed', entries:'1 entry', w:'136', c:'77', sign:'−', kind:'pos' },
      { name:'Chase Prime', entries:'3 entries', w:'10', c:'62', sign:'+', kind:'neg' }
    ];
    return `
      <div class="card">
        <h4 style="margin:0;font-size:4.5cqw;font-weight:700;color:var(--ink)">November 2026 progress</h4>
        <div class="seg3">
          <span class="active">This Month</span>
          <span>Previous</span>
          <span>Lifetime</span>
        </div>

        <div class="speed-banner">
          <div>
            <h4>Excellent!</h4>
            <p>${money('2,331','44')} above your plan</p>
            <span class="target-pill"><span style="color:var(--positive-ink)">↗</span> 53% above target</span>
          </div>
          <div style="text-align:center">
            <svg viewBox="0 0 120 74" style="width:100%;height:auto;display:block">
              <path d="M16 58 A44 44 0 0 1 20 42" fill="none" stroke="#E87A24" stroke-width="8" stroke-linecap="butt"/>
              <path d="M22 39 A44 44 0 0 1 32 25" fill="none" stroke="#F4A825" stroke-width="8"/>
              <path d="M35 23 A44 44 0 0 1 51 16" fill="none" stroke="#ECC92B" stroke-width="8"/>
              <path d="M54 15 A44 44 0 0 1 70 15" fill="none" stroke="#A3D93B" stroke-width="8"/>
              <path d="M73 16 A44 44 0 0 1 89 24" fill="none" stroke="#62D45A" stroke-width="8"/>
              <path d="M91 27 A44 44 0 0 1 101 41" fill="none" stroke="#36B362" stroke-width="8"/>
              <path d="M103 44 A44 44 0 0 1 105 58" fill="none" stroke="#1C7C47" stroke-width="8"/>
              <line x1="60" y1="60" x2="88" y2="33" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
              <circle cx="60" cy="60" r="4.5" fill="currentColor"/>
            </svg>
            <div style="display:flex;justify-content:space-between;font-size:2.4cqw;color:var(--muted-ink);font-weight:600;margin-top:-1cqw">
              <span>0%</span><strong style="font-size:4.2cqw;color:var(--ink)">153%</strong><span>200%+</span>
            </div>
          </div>
        </div>

        <div style="margin-bottom:3.2cqw">
          <div style="display:flex;align-items:center;gap:1.8cqw;font-size:3.2cqw;color:var(--muted-ink);font-weight:600">
            <span>Recorded</span><i class="info-dot">i</i>
          </div>
          <div class="recorded-big">${money('6,722','83')}</div>
          <div style="font-size:3.1cqw;color:var(--muted-ink)">${money('4,391','39')} planned</div>
        </div>

        <div class="two-up">
          <div class="metric-tile" style="padding:3cqw">
            <span class="lead-icon purp" style="margin-bottom:2cqw">${svgIcon('ic-bars')}</span>
            <div class="lbl" style="margin-bottom:1cqw">Interest &amp; Fees recorded</div>
            <div class="big" style="font-size:4.3cqw">${money('890','60')}</div>
          </div>
          <div class="metric-tile" style="padding:3cqw">
            <span class="lead-icon" style="margin-bottom:2cqw">↘</span>
            <div class="lbl" style="margin-bottom:1cqw">Recorded balance change</div>
            <div class="big pos" style="font-size:4.3cqw">${money('3,226','89','−')}</div>
          </div>
        </div>

        <div class="sec-head" style="margin-top:1cqw">
          <h3>Activity by account</h3>
          <span>11 accounts</span>
        </div>
        ${acts.map(a => `
          <div class="list-row">
            <span class="lead-icon ${a.kind==='neg'?'neg':''}">${svgIcon('nav-accounts')}</span>
            <div class="row-main"><strong>${a.name}</strong><span>${a.entries}</span></div>
            <strong style="font-size:3.7cqw;color:${a.kind==='pos'?'var(--positive-ink)':'var(--negative)'}">${money(a.w,a.c,a.sign)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function screenUtilization() {
    const cards = [
      { name:'Citi Costco', apr:'22.99% APR', pct:'27.7%', label:'Good', badge:'risk-good', barCol:'#1F9D4C', width:27.7, bal:['9,836','57'] },
      { name:'Chase Prime', apr:'23.49% APR', pct:'45.9%', label:'Watch', badge:'risk-watch', barCol:'#D97706', width:45.9, bal:['6,899','54'] },
      { name:'Discover', apr:'26.74% APR', pct:'78.1%', label:'High', badge:'risk-high', barCol:'#E34F52', width:78.1, bal:['1,953','64'] }
    ];
    return `
      <div class="card">
        <div class="util-hero">
          <div>
            <div class="util-kv"><small>Total limit</small><strong>${money('164,800','00')}</strong></div>
            <div class="util-kv"><small>Used credit</small><strong>${money('44,119','33')}</strong></div>
            <div class="util-kv"><small>Available credit</small><strong>${money('120,680','67')}</strong></div>
            <div class="util-kv"><small>Target utilization</small><strong>30%</strong></div>
            <div class="util-kv"><small>To reach 30%</small><strong>${money('0','00')}</strong></div>
          </div>
          <div class="util-gauge">
            <div style="text-align:right;margin-bottom:2cqw"><i class="info-dot" style="color:var(--muted-ink)">i</i></div>
            <div class="util-donut">
              <div class="util-donut-inner"><strong>26.8%</strong><span>Utilization</span></div>
            </div>
            <strong style="display:block;font-size:4.1cqw;color:var(--ink);margin-bottom:1.2cqw">Healthy</strong>
            <div style="display:flex;justify-content:center;gap:2.4cqw;font-size:2.6cqw;color:var(--muted-ink)">
              <span><i class="dot paid"></i> Used</span>
              <span><i class="dot" style="background:var(--line)"></i> Available</span>
            </div>
          </div>
        </div>
      </div>

      <div class="two-up">
        <div class="metric-tile">
          <div class="lbl">Available credit</div>
          <div class="big" style="font-size:4.6cqw">${money('120,680','67')}</div>
        </div>
        <div class="metric-tile">
          <div class="lbl">Cards tracked</div>
          <div class="big" style="font-size:4.6cqw">9</div>
        </div>
      </div>

      ${cards.map(c => `
        <div class="card" style="padding:3.4cqw 3.8cqw;margin-bottom:2.4cqw">
          <div class="debt-top">
            <span class="lead-icon neutral">${svgIcon('nav-accounts')}</span>
            <div class="row-main"><strong>${c.name}</strong><span>${c.apr}</span></div>
            <div style="text-align:right">
              <span class="risk-badge ${c.badge}">${c.pct}</span>
              <div style="font-size:2.6cqw;font-weight:700;color:${c.barCol};margin-top:.8cqw">${c.label}</div>
            </div>
            <span class="chev">›</span>
          </div>
          <div class="util-bar-wrap">
            <div class="util-bar-track"><div class="util-bar-fill" style="width:${c.width}%;background:${c.barCol}"></div></div>
            <div class="target-marker"></div>
          </div>
          <div style="text-align:center;font-size:2.7cqw;color:var(--muted-ink);margin-bottom:2cqw">30% target</div>
          <div class="debt-foot" style="border-top:1px solid var(--line);padding-top:2cqw">
            <span>Balance</span>
            <strong style="color:var(--ink);font-size:3.8cqw">${money(c.bal[0],c.bal[1])}</strong>
          </div>
        </div>
      `).join('')}
    `;
  }

  function screenMilestones() {
    const locked = ['First debt paid off','25% Debt Free','Halfway Mark (50%)','75% Debt Free'];
    return `
      <div class="card" style="display:flex;align-items:center;gap:3.4cqw">
        <div class="award-seal">${svgIcon('ic-trophy')}</div>
        <div>
          <div style="font-size:2.8cqw;font-weight:700;letter-spacing:.08cqw;color:var(--muted-ink)">YOUR PROGRESS</div>
          <div style="font-size:4.5cqw;font-weight:700;color:var(--ink);margin:.6cqw 0"><span style="font-size:6.2cqw">2</span> achievements</div>
          <div style="font-size:max(11px,2.9cqw);color:var(--muted-ink)">0 in progress · 5 locked</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row"><h4>Your path</h4><i class="info-dot" style="color:var(--muted-ink)">i</i></div>
        <div class="timeline-row">
          <div class="timeline-line"></div>
          <span class="check-dot">✓</span>
          <div class="row-main"><strong>First payment recorded</strong><span>Recorded · 2026-07-01</span></div>
          <i class="info-dot" style="color:var(--muted-ink)">i</i>
        </div>
        <div class="timeline-row">
          <span class="check-dot">✓</span>
          <div class="row-main"><strong>First $1,000.00 paydown</strong><span>Recorded</span></div>
          <i class="info-dot" style="color:var(--muted-ink)">i</i>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row" style="margin-bottom:1.4cqw">
          <div style="font-size:2.8cqw;font-weight:700;letter-spacing:.08cqw;color:var(--muted-ink)">CURRENT GOAL</div>
          <span class="est-pill">26.8%</span>
        </div>
        <strong style="display:block;font-size:4cqw;color:var(--ink);margin-bottom:.8cqw">Credit utilization ≤ 30%</strong>
        <span style="font-size:max(11px,2.9cqw);color:var(--muted-ink)">Current state · not a historical award</span>
      </div>

      <div class="card">
        <div class="card-title-row">
          <div><h4>Payoff milestones</h4><p>Locked · complete history needed</p></div>
        </div>
        ${locked.map(m => `
          <div class="list-row" style="padding:2.6cqw 0">
            <div class="row-main"><strong style="font-weight:500;color:var(--muted-ink)">${m}</strong></div>
            <i class="info-dot" style="color:var(--muted-ink)">i</i>
          </div>
        `).join('')}
      </div>
    `;
  }

  function screenSettings() {
    const themeLabel = design === 'signature' ? 'Fresh Light' : 'After Dark';
    return `
      <div class="profile-card">
        <div class="avatar">${svgIcon('ic-user')}</div>
        <div class="row-main"><strong>Lawrence Lee</strong><span>lawrenceirvin.lee@gmail.com</span></div>
        <span class="chev" style="color:var(--positive-ink)">›</span>
      </div>

      <div class="set-group-lbl">PREFERENCES</div>
      <div class="set-card">
        <div class="set-row" id="theme-toggle-row" style="cursor:pointer">
          ${svgIcon('ic-sun')}<div class="row-main"><strong>Theme</strong></div><span class="set-val">${themeLabel}</span><span class="chev">›</span>
        </div>
        <div class="set-row">
          ${svgIcon('ic-palette')}<div class="row-main"><strong>Accent color</strong></div><span class="set-val">BitLess Green</span><span class="chev">›</span>
        </div>
        <div class="set-row">
          <span style="width:4.4cqw;text-align:center;font-size:3.5cqw;font-weight:700;color:var(--muted-ink)">Aa</span>
          <div class="row-main"><strong>Text size</strong></div><span class="set-val">100%</span><span class="chev">›</span>
        </div>
        <div class="set-row">
          ${svgIcon('ic-bell')}<div class="row-main"><strong>Notifications</strong><span>Payment &amp; progress alerts</span></div><span class="chev">›</span>
        </div>
        <div class="set-row">
          ${svgIcon('ic-flag')}<div class="row-main"><strong>Payoff preferences</strong><span>Strategy and extra payment</span></div><span class="chev">›</span>
        </div>
      </div>

      <div class="set-group-lbl">HOUSEHOLD</div>
      <div class="set-card">
        <div class="set-row">
          ${svgIcon('ic-users')}<div class="row-main"><strong>Members</strong></div><span class="set-val">2 members</span><span class="chev">›</span>
        </div>
        <div class="set-row">
          ${svgIcon('ic-globe')}<div class="row-main"><strong>Currency &amp; timezone</strong></div><span class="set-val">USD</span><span class="chev">›</span>
        </div>
      </div>

      <div class="set-group-lbl">DATA &amp; SECURITY</div>
      <div class="set-card">
        <div class="set-row">
          ${svgIcon('ic-shield')}<div class="row-main"><strong>Security</strong><span>Account and sign-in</span></div><span class="chev">›</span>
        </div>
        <div class="set-row">
          ${svgIcon('ic-history')}<div class="row-main"><strong>Backup &amp; recovery</strong><span>Export and review backups</span></div><span class="chev">›</span>
        </div>
      </div>

      <div class="set-group-lbl">HELP &amp; INFORMATION</div>
      <div class="set-card">
        <div class="set-row">
          <i class="info-dot" style="color:var(--muted-ink)">i</i>
          <div class="row-main"><strong>Help &amp; support</strong><span>Guides, privacy and terms</span></div><span class="chev">›</span>
        </div>
      </div>
    `;
  }

  const builders = {
    home: screenHome,
    accounts: screenAccounts,
    strategy: screenStrategy,
    history: screenHistory,
    scheduled: screenScheduled,
    budget: screenBudget,
    overview: screenOverview,
    utilization: screenUtilization,
    milestones: screenMilestones,
    settings: screenSettings
  };

  function render() {
    const meta = tabMap[page] || tabMap.home;
    phone.className = `phone uphold-${design}`;
    phone.dataset.page = page;

    legPos.style.background = design === 'studio' ? '#84FB7F' : '#49CC68';
    legNeg.style.background = design === 'studio' ? '#FF655E' : '#E34F52';

    root.querySelectorAll('[data-design]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.design === design)));
    root.querySelectorAll('[data-screen]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.screen === page)));

    const isSettings = page === 'settings';
    mainChrome.hidden = isSettings;
    settingsChrome.hidden = !isSettings;
    bottomNav.hidden = isSettings;
    addFab.hidden = !meta.fab;

    brandTitle.textContent = meta.title;

    if (meta.sections) {
      sectionTabs.hidden = false;
      sectionTabs.innerHTML = meta.sections.map(s =>
        `<button role="tab" data-sub="${s.id}" aria-selected="${s.id === page}">${s.label}</button>`
      ).join('');
      sectionTabs.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => {
        page = b.dataset.sub;
        lastNonSettings = page;
        render();
      }));
    } else {
      sectionTabs.hidden = true;
      sectionTabs.innerHTML = '';
    }

    bottomNav.querySelectorAll('.nav-item').forEach(b => {
      if (b.dataset.nav === meta.nav) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    replayBtn.hidden = page !== 'home';
    content.innerHTML = (builders[page] || screenHome)();
    content.scrollTop = 0;

    content.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => {
      page = el.dataset.jump;
      lastNonSettings = page;
      render();
    }));

    const themeRow = document.getElementById('theme-toggle-row');
    if (themeRow) {
      themeRow.addEventListener('click', () => {
        design = design === 'signature' ? 'studio' : 'signature';
        render();
      });
    }
  }

  root.querySelectorAll('[data-design]').forEach(b => b.addEventListener('click', () => {
    design = b.dataset.design;
    render();
  }));
  root.querySelectorAll('[data-screen]').forEach(b => b.addEventListener('click', () => {
    page = b.dataset.screen;
    if (page !== 'settings') lastNonSettings = page;
    render();
  }));
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    page = b.dataset.nav;
    if (page !== 'settings') lastNonSettings = page;
    render();
  }));
  document.getElementById('close-settings-btn').addEventListener('click', () => {
    page = lastNonSettings || 'home';
    render();
  });
  replayBtn.addEventListener('click', () => {
    const hero = content.querySelector('.h-hero');
    if (hero) {
      hero.classList.remove('playing');
      void hero.offsetWidth;
      hero.classList.add('playing');
    }
  });

  render();
})();
</script>
"""

out = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>BitLess Fresh Light & After Dark Full-App Design Study</title>'
    + license_comment
    + font_style_open
    + CSS
    + '</style>'
    + '</head><body>'
    + HTML_BODY
    + '</body></html>\n'
)

target = ROOT / "design" / "fresh-light-dark-full-app-2026-11-17.html"
target.write_text(out, encoding="utf-8")
print(f"Wrote {target} ({target.stat().st_size} bytes)")
