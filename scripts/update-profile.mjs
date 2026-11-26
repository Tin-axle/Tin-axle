import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'assets');
fs.mkdirSync(outDir, { recursive: true });

const USERNAME = 'Tin-axle';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ghHeaders() {
  const h = { 'User-Agent': 'Tin-axle-profile-updater' };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

// ============================================================================
// FETCH LIVE GITHUB DATA (CONTRIBUTIONS + PUBLIC REPOS + LANGUAGE BYTES)
// ============================================================================
async function fetchLiveGitHubData() {
  // 1. Live contribution calendar from GitHub profile contributions endpoint
  const contribHtml = await (await fetch(`https://github.com/users/${USERNAME}/contributions`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })).text();

  const tipMap = {};
  for (const m of contribHtml.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/g)) {
    tipMap[m[1]] = m[2].trim();
  }

  const days = [];
  for (const m of contribHtml.matchAll(/<td\b[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const tag = m[0];
    const date = m[1];
    const levelM = tag.match(/data-level="(\d)"/);
    const idM = tag.match(/id="([^"]+)"/);
    const tip = idM ? (tipMap[idM[1]] || '') : '';
    const countM = tip.match(/^(\d+)\s+contribution/);
    days.push({
      date,
      level: levelM ? Number(levelM[1]) : 0,
      count: countM ? Number(countM[1]) : 0,
      tip
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const totalContributions = days.reduce((s, d) => s + d.count, 0);
  const activeDays = days.filter(d => d.count > 0 || d.level > 0).length;
  const maxDay = days.reduce((m, d) => (d.count > m.count ? d : m), { date: '', count: 0 });

  let curStreak = 0;
  let peakStreak = 0;
  let peakStreakEnd = '';
  for (const d of days) {
    if (d.count > 0 || d.level > 0) {
      curStreak++;
      if (curStreak >= peakStreak) {
        peakStreak = curStreak;
        peakStreakEnd = d.date;
      }
    } else {
      curStreak = 0;
    }
  }

  // 2. Live public repositories and per-language byte counts (with graceful rate-limit fallback)
  const cachePath = path.join(__dirname, 'repos-cache.json');
  const cached = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : { repos: [] };

  let repos = [];
  const langBytes = {};
  let apiComplete = true;

  try {
    const reposRes = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`, {
      headers: ghHeaders()
    });
    const reposRaw = await reposRes.json();
    if (!reposRes.ok || !Array.isArray(reposRaw)) {
      apiComplete = false;
    } else {
      for (const r of reposRaw) {
        if (r.name.toLowerCase() === USERNAME.toLowerCase()) continue;
        const lRes = await fetch(r.languages_url, { headers: ghHeaders() });
        const langs = await lRes.json();
        if (!lRes.ok || !langs || langs.message) {
          // Fall back to cached language bytes for this repo if unauthenticated rate limit hit
          const cachedRepo = cached.repos.find(cr => cr.name === r.name);
          const fallbackLangs = cachedRepo ? cachedRepo.languages : {};
          apiComplete = false;
          repos.push({
            name: r.name,
            language: r.language || Object.keys(fallbackLangs)[0] || 'Other',
            languages: fallbackLangs,
            stars: r.stargazers_count || 0,
            url: r.html_url
          });
        } else {
          repos.push({
            name: r.name,
            language: r.language || Object.keys(langs)[0] || 'Other',
            languages: langs,
            stars: r.stargazers_count || 0,
            url: r.html_url
          });
        }
      }
    }
  } catch {
    apiComplete = false;
  }

  if (repos.length === 0 && cached.repos.length > 0) {
    repos = cached.repos;
  } else if (apiComplete && repos.length > 0) {
    fs.writeFileSync(cachePath, JSON.stringify({ repos }, null, 2), 'utf8');
  }

  for (const r of repos) {
    for (const [k, v] of Object.entries(r.languages || {})) {
      if (typeof v === 'number') langBytes[k] = (langBytes[k] || 0) + v;
    }
  }

  const totalBytes = Object.values(langBytes).reduce((s, v) => s + v, 0) || 1;
  const langStats = Object.entries(langBytes)
    .map(([name, bytes]) => ({
      name,
      bytes,
      pct: (bytes / totalBytes) * 100
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    days,
    totalContributions,
    activeDays,
    maxDay,
    peakStreak,
    peakStreakEnd,
    repos,
    langStats,
    totalBytes
  };
}

function formatDateUpper(iso) {
  if (!iso) return '';
  const dt = new Date(iso + 'T00:00:00Z');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

function formatMonthYear(iso) {
  if (!iso) return '';
  const dt = new Date(iso + 'T00:00:00Z');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

// ============================================================================
// 1. HUD HEADER WITH ORANGE ASCII PORTRAIT (1040 x 470)
// ============================================================================
function buildHudHeader(data) {
  const rawPortrait = JSON.parse(fs.readFileSync(path.join(__dirname, 'portrait-data.json'), 'utf8').replace(/^\uFEFF/, ''));
  const portraitData = rawPortrait.map(r => (Array.isArray(r) ? r : r.value));
  const rows = portraitData.length;    // 40
  const cols = portraitData[0].length; // 64

  const lumGrid = portraitData.map(r => r.map(p => p[0]));
  const warmGrid = portraitData.map(r => r.map(p => p[1]));
  const satGrid = portraitData.map(r => r.map(p => p[2] ?? 0));

  const chars = ' .:-=+*#%@';
  const tierColors = [
    '#9e612a',
    '#bd722b',
    '#d98029',
    '#ed8326',
    '#f59c42',
    '#f9b566',
    '#fccb8d',
    '#ffe0b5',
    '#fff1db',
  ];

  const cx = 212;
  const cy = 248;
  const radius = 152;
  const startX = 68;
  const startY = 101;
  const lineH = 7.6;
  const charW = 4.55;

  let asciiLinesSvg = '';

  for (let y = 0; y < rows; y++) {
    const lineRuns = [];
    let curColor = null;
    let curText = '';

    for (let x = 0; x < cols; x++) {
      const px = startX + x * charW + charW / 2;
      const py = startY + y * lineH;
      const dist = Math.hypot((px - cx) / radius, (py - cy) / radius);

      if (dist > 0.99) {
        if (curColor !== 'space') {
          if (curText) lineRuns.push({ color: curColor, text: curText });
          curColor = 'space';
          curText = ' ';
        } else {
          curText += ' ';
        }
        continue;
      }

      const lum = lumGrid[y][x];
      const warm = warmGrid[y][x];
      const sat = satGrid[y][x];

      // Sobel edge magnitude for glasses, eyes, brows, hair contours, collar
      let edge = 0;
      if (y > 0 && y < rows - 1 && x > 0 && x < cols - 1) {
        const gx = -lumGrid[y-1][x-1] + lumGrid[y-1][x+1] - 2*lumGrid[y][x-1] + 2*lumGrid[y][x+1] - lumGrid[y+1][x-1] + lumGrid[y+1][x+1];
        const gy = -lumGrid[y-1][x-1] - 2*lumGrid[y-1][x] - lumGrid[y-1][x+1] + lumGrid[y+1][x-1] + 2*lumGrid[y+1][x] + lumGrid[y+1][x+1];
        edge = Math.min(255, Math.hypot(gx, gy) * 0.55);
      }

      // Isolate neutral gray studio backdrop (lum ~72..120, low warmth < 16, low saturation < 18, low edge < 24)
      const isBackdrop = lum > 68 && lum < 126 && warm < 16 && sat < 18 && edge < 24;

      let intensity = 0;
      if (isBackdrop) {
        // Subtle HUD dot texture in empty studio area
        intensity = ((x + y) % 4 === 0) ? 0.08 : 0.0;
      } else if (lum < 56 && warm < 22) {
        // Dark hair, glasses frames, suit blazer -> sleek mid-warm silhouette + bright edge contours
        const depth = (56 - lum) / 56;
        intensity = 0.22 + depth * 0.24 + (edge / 255) * 0.52;
      } else {
        // Lit face, forehead, nose, cheeks, glasses highlights, red tie -> bright warm/light/pale orange
        const faceNorm = Math.max(0, Math.min(1, (lum - 48) / 165));
        const warmBoost = Math.max(0, Math.min(0.24, (warm - 14) / 140));
        intensity = 0.30 + faceNorm * 0.62 + warmBoost + (edge / 255) * 0.20;
      }

      if (dist > 0.83) {
        intensity *= Math.max(0, (1.0 - dist) / 0.17);
      }
      intensity = Math.max(0, Math.min(1, intensity));

      const charIdx = Math.min(chars.length - 1, Math.floor(intensity * (chars.length - 0.01)));
      const ch = chars[charIdx];

      if (ch === ' ') {
        if (curColor !== 'space') {
          if (curText) lineRuns.push({ color: curColor, text: curText });
          curColor = 'space';
          curText = ' ';
        } else {
          curText += ' ';
        }
      } else {
        const colIdx = Math.min(tierColors.length - 1, Math.floor(intensity * (tierColors.length - 0.01)));
        const col = tierColors[colIdx];
        if (curColor !== col) {
          if (curText) lineRuns.push({ color: curColor, text: curText });
          curColor = col;
          curText = ch;
        } else {
          curText += ch;
        }
      }
    }
    if (curText) lineRuns.push({ color: curColor, text: curText });

    const spans = lineRuns
      .map(r => (r.color === 'space' ? esc(r.text) : `<tspan fill="${r.color}">${esc(r.text)}</tspan>`))
      .join('');
    asciiLinesSvg += `      <text x="${startX}" y="${(startY + y * lineH).toFixed(1)}" xml:space="preserve">${spans}</text>\n`;
  }

  let ringTicks = '';
  for (let deg = 0; deg < 360; deg += 6) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 30 === 0;
    const r1 = isMajor ? 168 : 172;
    const r2 = isMajor ? 182 : 177;
    ringTicks += `    <line x1="${(cx + Math.cos(rad) * r1).toFixed(1)}" y1="${(cy + Math.sin(rad) * r1).toFixed(1)}" x2="${(cx + Math.cos(rad) * r2).toFixed(1)}" y2="${(cy + Math.sin(rad) * r2).toFixed(1)}" stroke="${isMajor ? '#ffd39e' : '#ed8326'}" stroke-width="${isMajor ? 1.5 : 0.8}" opacity="${isMajor ? 0.85 : 0.4}"/>\n`;
  }

  let stars = '';
  for (let i = 0; i < 42; i++) {
    const sx = ((i * 197 + 43) % 1010) + 15;
    const sy = ((i * 131 + 29) % 440) + 15;
    const sr = (i % 4 === 0) ? 1.4 : 0.85;
    stars += `  <circle cx="${sx}" cy="${sy}" r="${sr}" fill="#ffe3bd" opacity="${(0.18 + (i % 5) * 0.10).toFixed(2)}"/>\n`;
  }

  // Activity bars driven by recent 22 weeks of real contributions!
  const weeklyTotals = [];
  for (let i = Math.max(0, data.days.length - 154); i < data.days.length; i += 7) {
    const slice = data.days.slice(i, i + 7);
    weeklyTotals.push(slice.reduce((s, d) => s + d.count, 0));
  }
  const maxWeekVal = Math.max(1, ...weeklyTotals);
  let waveBars = '';
  weeklyTotals.slice(-22).forEach((val, idx) => {
    const h = Math.max(5, Math.round((val / maxWeekVal) * 32));
    const bx = 434 + idx * 8.2;
    const by = 436 - h;
    const col = h > 24 ? '#ffe0b5' : h > 14 ? '#f7aa57' : '#ed8326';
    waveBars += `    <rect x="${bx.toFixed(1)}" y="${by}" width="4.6" height="${h}" rx="1.5" fill="${col}" opacity="0.88" class="bar-pulse" style="animation-delay:${(idx * 0.11).toFixed(2)}s"/>\n`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="470" viewBox="0 0 1040 470" role="img" aria-label="Justine Smith C. Rendaje — Profile Header">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070a10"/>
      <stop offset="55%" stop-color="#0d1119"/>
      <stop offset="100%" stop-color="#131822"/>
    </linearGradient>
    <radialGradient id="coreGlow" cx="21%" cy="52%" r="36%">
      <stop offset="0%" stop-color="#ed8326" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#f7a854" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#070a10" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rightGlow" cx="82%" cy="22%" r="40%">
      <stop offset="0%" stop-color="#ffd299" stop-opacity="0.11"/>
      <stop offset="100%" stop-color="#070a10" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="nameGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fff3e0"/>
      <stop offset="48%" stop-color="#ffd299"/>
      <stop offset="100%" stop-color="#f79f44"/>
    </linearGradient>
    <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe2b8" stop-opacity="0"/>
      <stop offset="48%" stop-color="#f8b05d" stop-opacity="0.34"/>
      <stop offset="52%" stop-color="#fff0d9" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#ed8326" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ed8326" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#ffd39e" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ed8326" stop-opacity="0.08"/>
    </linearGradient>
    <clipPath id="portraitClip">
      <circle cx="${cx}" cy="${cy}" r="${radius}"/>
    </clipPath>
    <filter id="glowSoft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      .mono { font-family: 'Consolas', 'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', monospace; }
      .sans { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
      .ascii { font-family: 'Consolas', 'SFMono-Regular', 'Courier New', monospace; font-size: 7.4px; font-weight: 700; letter-spacing: 0.15px; }
      .spin-cw { transform-origin: ${cx}px ${cy}px; animation: spinCW 34s linear infinite; }
      .spin-ccw { transform-origin: ${cx}px ${cy}px; animation: spinCCW 22s linear infinite; }
      .spin-slow { transform-origin: ${cx}px ${cy}px; animation: spinCW 54s linear infinite; }
      .scan-beam { animation: scanDown 4.4s ease-in-out infinite; }
      .blink { animation: blinkPulse 2.2s ease-in-out infinite; }
      .bar-pulse { animation: barGlow 2.8s ease-in-out infinite; }
      @keyframes spinCW { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes spinCCW { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
      @keyframes scanDown {
        0% { transform: translateY(-165px); opacity: 0; }
        12% { opacity: 0.95; }
        88% { opacity: 0.95; }
        100% { transform: translateY(165px); opacity: 0; }
      }
      @keyframes blinkPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      @keyframes barGlow { 0%, 100% { opacity: 0.88; } 50% { opacity: 0.48; } }
    </style>
  </defs>

  <rect x="0.5" y="0.5" width="1039" height="469" rx="14" fill="url(#bgGrad)" stroke="#ed8326" stroke-opacity="0.45" stroke-width="1.2"/>
  <rect x="0.5" y="0.5" width="1039" height="469" rx="14" fill="url(#coreGlow)"/>
  <rect x="0.5" y="0.5" width="1039" height="469" rx="14" fill="url(#rightGlow)"/>

  <!-- Subtle HUD Grid -->
  <g stroke="#ed8326" stroke-opacity="0.06" stroke-width="1">
    <line x1="0" y1="60" x2="1040" y2="60"/>
    <line x1="0" y1="150" x2="1040" y2="150"/>
    <line x1="0" y1="240" x2="1040" y2="240"/>
    <line x1="0" y1="330" x2="1040" y2="330"/>
    <line x1="0" y1="420" x2="1040" y2="420"/>
    <line x1="412" y1="42" x2="412" y2="444"/>
    <line x1="620" y1="42" x2="620" y2="444"/>
    <line x1="830" y1="42" x2="830" y2="444"/>
  </g>

  <!-- Starfield -->
${stars}

  <!-- Outer HUD Corner Brackets -->
  <g fill="none" stroke="#f7a854" stroke-width="2" stroke-linecap="round">
    <path d="M 16 38 L 16 16 L 44 16"/>
    <path d="M 996 16 L 1024 16 L 1024 38"/>
    <path d="M 16 432 L 16 454 L 44 454"/>
    <path d="M 996 454 L 1024 454 L 1024 432"/>
  </g>

  <!-- Top Bar -->
  <g class="mono" font-size="10.5" letter-spacing="1.4">
    <circle cx="34" cy="31" r="4" fill="#ffd39e" class="blink" filter="url(#glowSoft)"/>
    <text x="46" y="34.5" fill="#ffd39e" font-weight="700">SECTOR: ILOILO-PH</text>
    <text x="762" y="34.5" fill="#f7a854" opacity="0.9">GITHUB.COM/TIN-AXLE</text>
    <rect x="945" y="22" width="64" height="17" rx="3" fill="#ed8326" fill-opacity="0.16" stroke="#f7a854" stroke-opacity="0.7" stroke-width="0.9"/>
    <text x="977" y="34" fill="#ffe4be" text-anchor="middle" font-size="9.5" font-weight="700">ONLINE</text>
  </g>
  <line x1="22" y1="47" x2="1018" y2="47" stroke="url(#accentLine)" stroke-width="1"/>

  <!-- LEFT CHAMBER: ORANGE ASCII PORTRAIT + HUD RINGS -->
  <g>
    <circle cx="${cx}" cy="${cy}" r="${radius + 2}" fill="#080b12" stroke="#ed8326" stroke-opacity="0.4" stroke-width="1.2"/>

    <g class="spin-slow">
${ringTicks}
    </g>

    <g class="spin-cw" fill="none">
      <circle cx="${cx}" cy="${cy}" r="189" stroke="#f7a854" stroke-opacity="0.42" stroke-width="1.4" stroke-dasharray="48 18 14 24 80 20"/>
      <circle cx="${cx}" cy="${cy}" r="161" stroke="#ffd39e" stroke-opacity="0.65" stroke-width="2" stroke-dasharray="32 95 16 110"/>
    </g>

    <g class="spin-ccw" fill="none">
      <circle cx="${cx}" cy="${cy}" r="156" stroke="#ed8326" stroke-opacity="0.75" stroke-width="1.2" stroke-dasharray="12 8 3 8"/>
      <circle cx="${cx}" cy="${cy}" r="196" stroke="#ed8326" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="6 14"/>
    </g>

    <g stroke="#ffd39e" stroke-width="1.3" opacity="0.75">
      <line x1="${cx}" y1="${cy - 196}" x2="${cx}" y2="${cy - 166}"/>
      <line x1="${cx}" y1="${cy + 166}" x2="${cx}" y2="${cy + 196}"/>
      <line x1="${cx - 196}" y1="${cy}" x2="${cx - 166}" y2="${cy}"/>
      <line x1="${cx + 166}" y1="${cy}" x2="${cx + 196}" y2="${cy}"/>
    </g>

    <g clip-path="url(#portraitClip)">
      <g class="ascii">
${asciiLinesSvg}      </g>
      <rect x="${cx - radius}" y="${cy - 18}" width="${radius * 2}" height="36" fill="url(#scanGrad)" class="scan-beam"/>
    </g>
  </g>

  <!-- RIGHT CHAMBER: PROFILE SUMMARY -->
  <g>
    <rect x="432" y="68" width="146" height="22" rx="4" fill="#ed8326" fill-opacity="0.14" stroke="#f7a854" stroke-opacity="0.55" stroke-width="1"/>
    <text x="505" y="83" text-anchor="middle" class="mono" font-size="10.2" fill="#ffd39e" letter-spacing="1.4" font-weight="700">DEVELOPER PROFILE</text>

    <text x="596" y="83" class="mono" font-size="10" fill="#d99b66" letter-spacing="1">GITHUB: <tspan fill="#ffe4be" font-weight="700">@Tin-axle</tspan></text>

    <text x="432" y="132" class="sans" font-size="33" font-weight="800" letter-spacing="1.2" fill="url(#nameGrad)" filter="url(#glowSoft)">JUSTINE SMITH C. RENDAJE</text>

    <line x1="432" y1="145" x2="1008" y2="145" stroke="url(#accentLine)" stroke-width="1.6"/>

    <text x="432" y="170" class="mono" font-size="13.2" fill="#ffe2ba" letter-spacing="0.8" font-weight="600">CS STUDENT  ·  FULL-STACK DEVELOPER  ·  TECHNICAL PROJECT LEAD</text>

    <g class="mono" font-size="11.2" fill="#e6b07a">
      <text x="432" y="196"><tspan fill="#ed8326" font-weight="700">&gt; EDU:</tspan>  BS Computer Science · University of San Agustin (2023 – 2027)</text>
      <text x="432" y="216"><tspan fill="#ed8326" font-weight="700">&gt; LEAD:</tspan> Tech Dept Lead (ADS) · Ex-CEO (ADS) · VP Finance (ICS) · Tech Officer (Holotech)</text>
      <text x="432" y="236"><tspan fill="#ed8326" font-weight="700">&gt; WEB:</tspan>  Iloilo City, Philippines  ·  justinerendaje.vercel.app</text>
    </g>

    <g transform="translate(432, 256)">
      <polygon points="0,8 8,0 134,0 134,74 126,82 0,82" fill="#121824" fill-opacity="0.9" stroke="#ed8326" stroke-opacity="0.55" stroke-width="1.1"/>
      <text x="14" y="22" class="mono" font-size="9.2" fill="#d99b66" letter-spacing="1.1">CONTRIBUTIONS</text>
      <text x="14" y="54" class="sans" font-size="27" font-weight="800" fill="#ffe4be">${data.totalContributions.toLocaleString('en-US')}</text>
      <text x="14" y="71" class="mono" font-size="9" fill="#f7a854">${data.activeDays} ACTIVE DAYS</text>

      <g transform="translate(147, 0)">
        <polygon points="0,8 8,0 134,0 134,74 126,82 0,82" fill="#121824" fill-opacity="0.9" stroke="#ed8326" stroke-opacity="0.55" stroke-width="1.1"/>
        <text x="14" y="22" class="mono" font-size="9.2" fill="#d99b66" letter-spacing="1.0">USERS ONBOARDED</text>
        <text x="14" y="54" class="sans" font-size="27" font-weight="800" fill="#ffe4be">8,183</text>
        <text x="14" y="71" class="mono" font-size="9" fill="#f7a854">USA ATTENDANCE</text>
      </g>

      <g transform="translate(294, 0)">
        <polygon points="0,8 8,0 134,0 134,74 126,82 0,82" fill="#121824" fill-opacity="0.9" stroke="#ed8326" stroke-opacity="0.55" stroke-width="1.1"/>
        <text x="14" y="22" class="mono" font-size="9.2" fill="#d99b66" letter-spacing="1.1">PEAK STREAK</text>
        <text x="14" y="54" class="sans" font-size="27" font-weight="800" fill="#ffe4be">${data.peakStreak}D</text>
        <text x="14" y="71" class="mono" font-size="9" fill="#f7a854">MAX ${data.maxDay.count} / DAY</text>
      </g>

      <g transform="translate(441, 0)">
        <polygon points="0,8 8,0 134,0 134,74 126,82 0,82" fill="#121824" fill-opacity="0.9" stroke="#ed8326" stroke-opacity="0.55" stroke-width="1.1"/>
        <text x="14" y="22" class="mono" font-size="9.2" fill="#d99b66" letter-spacing="1.1">AWARDS &amp; CERTS</text>
        <text x="14" y="54" class="sans" font-size="27" font-weight="800" fill="#ffe4be">4 · 6</text>
        <text x="14" y="71" class="mono" font-size="9" fill="#f7a854">AWARDS · CERTS</text>
      </g>
    </g>

    <g transform="translate(432, 350)">
      <rect x="0" y="0" width="575" height="27" rx="5" fill="#ed8326" fill-opacity="0.09" stroke="#ed8326" stroke-opacity="0.35" stroke-width="1"/>
      <text x="12" y="17.5" class="mono" font-size="9.0" fill="#ffd39e" letter-spacing="0.4">CORE STACK: <tspan fill="#fff0d9">TypeScript · Python · JS · Java · React/Next · Vue/Nuxt · Node · Firebase · PyTorch</tspan></text>
    </g>

    <g>
      <text x="434" y="396" class="mono" font-size="8.8" fill="#d99b66" letter-spacing="1.1">WEEKLY ACTIVITY (LAST 22 WEEKS)</text>
${waveBars}
      <g transform="translate(636, 392)" class="mono" font-size="9.4" fill="#e6b07a">
        <text x="0" y="10"><tspan fill="#ffd39e" font-weight="700">AWARDS:</tspan>   3rd Place Next Gen Regional Hackathon '26</text>
        <text x="0" y="26"><tspan fill="#ffd39e" font-weight="700">CERTS:</tspan>    IBM AI · AWS Cloud · Cisco Python/DS</text>
        <text x="0" y="42"><tspan fill="#ffd39e" font-weight="700">STATUS:</tspan>   <tspan fill="#ffe4be">OPEN TO COLLABORATION &amp; SOFTWARE ROLES</tspan></text>
      </g>
    </g>
  </g>
</svg>`;

  fs.writeFileSync(path.join(outDir, 'hud-header.svg'), svg, 'utf8');
  console.log('Generated assets/hud-header.svg:', (svg.length / 1024).toFixed(1), 'KB');
}

// ============================================================================
// 2. ISOMETRIC 3D CONTRIBUTION CITY (1040 x 540) — LIVE GITHUB DATA
// ============================================================================
function buildContributionCity(data) {
  const days = data.days;
  const firstDate = new Date(days[0].date + 'T00:00:00Z');
  const firstDow = firstDate.getUTCDay();

  const gridCells = days.map((d, i) => {
    const dt = new Date(d.date + 'T00:00:00Z');
    const week = Math.floor((i + firstDow) / 7);
    const dow = dt.getUTCDay();
    return { ...d, week, dow };
  });

  const maxWeek = Math.max(...gridCells.map(c => c.week));
  const wx = 14.2;
  const wy = -2.35;
  const dx = 11.4;
  const dy = 8.4;
  const originX = 96;
  const originY = 398;
  const padW = 0.42;
  const padD = 0.42;

  function isoPt(w, d) {
    return [originX + w * wx + d * dx, originY + w * wy + d * dy];
  }

  const maxCount = Math.max(1, data.maxDay.count);
  const items = gridCells.map(c => {
    const [cx, cy] = isoPt(c.week, c.dow);
    const norm = c.count / maxCount;
    const h = c.count === 0 ? 2.5 : Math.round(14 + Math.pow(norm, 0.72) * 155);
    return { ...c, cx, cy, h };
  });

  items.sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  let stars = '';
  for (let i = 0; i < 48; i++) {
    const sx = ((i * 211 + 19) % 1012) + 14;
    const sy = ((i * 97 + 64) % 250) + 52;
    const sr = (i % 5 === 0) ? 1.35 : 0.8;
    stars += `  <circle cx="${sx}" cy="${sy}" r="${sr}" fill="#ffe4be" opacity="${(0.16 + (i % 4) * 0.11).toFixed(2)}"/>\n`;
  }

  const bp0 = isoPt(-0.9, -0.9);
  const bp1 = isoPt(maxWeek + 0.9, -0.9);
  const bp2 = isoPt(maxWeek + 0.9, 6.9);
  const bp3 = isoPt(-0.9, 6.9);
  const bpThickness = 14;

  const basePlatform = `
  <g>
    <polygon points="${bp3[0].toFixed(1)},${bp3[1].toFixed(1)} ${bp2[0].toFixed(1)},${bp2[1].toFixed(1)} ${bp2[0].toFixed(1)},${(bp2[1]+bpThickness).toFixed(1)} ${bp3[0].toFixed(1)},${(bp3[1]+bpThickness).toFixed(1)}" fill="#0e1420" stroke="#ed8326" stroke-opacity="0.38" stroke-width="1"/>
    <polygon points="${bp0[0].toFixed(1)},${bp0[1].toFixed(1)} ${bp3[0].toFixed(1)},${bp3[1].toFixed(1)} ${bp3[0].toFixed(1)},${(bp3[1]+bpThickness).toFixed(1)} ${bp0[0].toFixed(1)},${(bp0[1]+bpThickness).toFixed(1)}" fill="#121a28" stroke="#ed8326" stroke-opacity="0.32" stroke-width="1"/>
    <polygon points="${bp0[0].toFixed(1)},${bp0[1].toFixed(1)} ${bp1[0].toFixed(1)},${bp1[1].toFixed(1)} ${bp2[0].toFixed(1)},${bp2[1].toFixed(1)} ${bp3[0].toFixed(1)},${bp3[1].toFixed(1)}" fill="#0a0f18" stroke="#f7a854" stroke-opacity="0.48" stroke-width="1.2"/>
  </g>`;

  function towerColors(count) {
    if (count === 0) return { top: '#141b27', left: '#0f1520', right: '#0b1018', stroke: 'rgba(237,131,38,0.22)', glow: false };
    if (count <= 3)  return { top: '#f5a654', left: '#d9822b', right: '#a66221', stroke: '#ffd39e', glow: false };
    if (count <= 8)  return { top: '#f9bc73', left: '#ed8326', right: '#bd6d22', stroke: '#ffe1b8', glow: false };
    if (count <= 16) return { top: '#ffd59e', left: '#f59c42', right: '#cc7724', stroke: '#ffebd0', glow: true };
    return { top: '#fff0d6', left: '#f9b361', right: '#db8228', stroke: '#fff7eb', glow: true };
  }

  let buildingsSvg = '';
  let peakCell = null;
  let streakEndCell = null;

  for (const c of items) {
    if (c.date === data.maxDay.date) peakCell = c;
    if (c.date === data.peakStreakEnd) streakEndCell = c;

    const pBack  = isoPt(c.week - padW, c.dow - padD);
    const pRight = isoPt(c.week + padW, c.dow - padD);
    const pFront = isoPt(c.week + padW, c.dow + padD);
    const pLeft  = isoPt(c.week - padW, c.dow + padD);
    const col = towerColors(c.count);

    if (c.count === 0) {
      buildingsSvg += `    <polygon points="${pBack[0].toFixed(1)},${pBack[1].toFixed(1)} ${pRight[0].toFixed(1)},${pRight[1].toFixed(1)} ${pFront[0].toFixed(1)},${pFront[1].toFixed(1)} ${pLeft[0].toFixed(1)},${pLeft[1].toFixed(1)}" fill="${col.top}" stroke="#ed8326" stroke-opacity="0.17" stroke-width="0.6"/>\n`;
    } else {
      const h = c.h;
      const tBack  = [pBack[0],  pBack[1]  - h];
      const tRight = [pRight[0], pRight[1] - h];
      const tFront = [pFront[0], pFront[1] - h];
      const tLeft  = [pLeft[0],  pLeft[1]  - h];

      buildingsSvg += `    <g${col.glow ? ' filter="url(#towerGlow)"' : ''}>\n`;
      buildingsSvg += `      <polygon points="${tBack[0].toFixed(1)},${tBack[1].toFixed(1)} ${tLeft[0].toFixed(1)},${tLeft[1].toFixed(1)} ${pLeft[0].toFixed(1)},${pLeft[1].toFixed(1)} ${pBack[0].toFixed(1)},${pBack[1].toFixed(1)}" fill="${col.left}" stroke="${col.stroke}" stroke-opacity="0.42" stroke-width="0.5"/>\n`;
      buildingsSvg += `      <polygon points="${tLeft[0].toFixed(1)},${tLeft[1].toFixed(1)} ${tFront[0].toFixed(1)},${tFront[1].toFixed(1)} ${pFront[0].toFixed(1)},${pFront[1].toFixed(1)} ${pLeft[0].toFixed(1)},${pLeft[1].toFixed(1)}" fill="${col.right}" stroke="${col.stroke}" stroke-opacity="0.34" stroke-width="0.5"/>\n`;

      if (h >= 24) {
        const floors = Math.min(11, Math.floor((h - 10) / 13));
        for (let f = 1; f <= floors; f++) {
          const fy = f * 12;
          const op = (0.42 + (f % 2) * 0.36).toFixed(2);
          buildingsSvg += `      <line x1="${(tBack[0] + 1.4).toFixed(1)}" y1="${(tBack[1] + fy + 0.9).toFixed(1)}" x2="${(tLeft[0] - 1.4).toFixed(1)}" y2="${(tLeft[1] + fy - 0.9).toFixed(1)}" stroke="#fff2db" stroke-opacity="${op}" stroke-width="1.15"/>\n`;
          buildingsSvg += `      <line x1="${(tLeft[0] + 1.6).toFixed(1)}" y1="${(tLeft[1] + fy - 0.3).toFixed(1)}" x2="${(tFront[0] - 1.6).toFixed(1)}" y2="${(tFront[1] + fy + 0.3).toFixed(1)}" stroke="#ffd39e" stroke-opacity="${(op * 0.72).toFixed(2)}" stroke-width="1.05"/>\n`;
        }
      }

      buildingsSvg += `      <polygon points="${tBack[0].toFixed(1)},${tBack[1].toFixed(1)} ${tRight[0].toFixed(1)},${tRight[1].toFixed(1)} ${tFront[0].toFixed(1)},${tFront[1].toFixed(1)} ${tLeft[0].toFixed(1)},${tLeft[1].toFixed(1)}" fill="${col.top}" stroke="#fff5e6" stroke-opacity="0.72" stroke-width="0.65"/>\n`;
      buildingsSvg += `    </g>\n`;
    }
  }

  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const seenMonths = new Set();
  let monthLabels = '';
  for (const c of gridCells) {
    const ym = c.date.slice(0, 7);
    if (!seenMonths.has(ym) && c.date.slice(8, 10) <= '07') {
      seenMonths.add(ym);
      const mIdx = Number(c.date.slice(5, 7)) - 1;
      const pt = isoPt(c.week, 7.6);
      monthLabels += `    <text x="${pt[0].toFixed(1)}" y="${(pt[1] + 12).toFixed(1)}" class="mono" font-size="9.2" fill="#e6aa6c" text-anchor="middle" opacity="0.88">${monthNames[mIdx]}</text>\n`;
    }
  }

  let calloutsSvg = '';
  if (peakCell) {
    const px = peakCell.cx;
    const pyTop = peakCell.cy - peakCell.h;
    const boxX = Math.max(36, Math.min(680, px - 320));
    const boxY = Math.max(88, pyTop - 68);
    calloutsSvg += `
  <g>
    <line x1="${px.toFixed(1)}" y1="${pyTop.toFixed(1)}" x2="${px.toFixed(1)}" y2="${(pyTop - 26).toFixed(1)}" stroke="#fff0d6" stroke-width="1.4"/>
    <circle cx="${px.toFixed(1)}" cy="${(pyTop - 26).toFixed(1)}" r="4" fill="#fff3e0" class="beacon"/>
    <circle cx="${px.toFixed(1)}" cy="${(pyTop - 26).toFixed(1)}" r="10" fill="none" stroke="#ffd39e" stroke-width="1" opacity="0.55" class="beacon-ring"/>
    <polyline points="${px.toFixed(1)},${(pyTop - 26).toFixed(1)} ${(px - 22).toFixed(1)},${(boxY + 18).toFixed(1)} ${(boxX + 168).toFixed(1)},${(boxY + 18).toFixed(1)}" fill="none" stroke="#ffd39e" stroke-width="1.1"/>
    <rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="168" height="36" rx="5" fill="#101622" fill-opacity="0.92" stroke="#f7a854" stroke-width="1"/>
    <text x="${(boxX + 10).toFixed(1)}" y="${(boxY + 15).toFixed(1)}" class="mono" font-size="9.0" fill="#ffe4be" font-weight="700">PEAK DAY: ${data.maxDay.count} CONTRIBS</text>
    <text x="${(boxX + 10).toFixed(1)}" y="${(boxY + 28).toFixed(1)}" class="mono" font-size="8.4" fill="#d99b66">${formatDateUpper(data.maxDay.date)}</text>
  </g>`;
  }

  if (streakEndCell) {
    const sx = streakEndCell.cx;
    const syTop = streakEndCell.cy - streakEndCell.h;
    calloutsSvg += `
  <g>
    <polyline points="${sx.toFixed(1)},${syTop.toFixed(1)} ${Math.min(990, sx + 14).toFixed(1)},${Math.max(126, syTop - 44).toFixed(1)} ${Math.min(990, sx + 14).toFixed(1)},126" fill="none" stroke="#ffd39e" stroke-width="1.1" stroke-dasharray="3 2"/>
    <circle cx="${sx.toFixed(1)}" cy="${syTop.toFixed(1)}" r="3.4" fill="#fff3e0" class="beacon"/>
    <rect x="854" y="90" width="156" height="36" rx="5" fill="#101622" fill-opacity="0.94" stroke="#f7a854" stroke-width="1"/>
    <text x="864" y="105" class="mono" font-size="9.0" fill="#ffe4be" font-weight="700">${data.peakStreak}-DAY PEAK STREAK</text>
    <text x="864" y="118" class="mono" font-size="8.4" fill="#f7a854">${formatDateUpper(data.peakStreakEnd)}</text>
  </g>`;
  }

  const windowLabel = `${formatMonthYear(days[0].date)} – ${formatMonthYear(days[days.length - 1].date)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="540" viewBox="0 0 1040 540" role="img" aria-label="3D Isometric GitHub Contributions for Tin-axle (${data.totalContributions} contributions)">
  <defs>
    <linearGradient id="cityBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070a10"/>
      <stop offset="60%" stop-color="#0d121c"/>
      <stop offset="100%" stop-color="#131924"/>
    </linearGradient>
    <radialGradient id="cityGlow" cx="68%" cy="46%" r="44%">
      <stop offset="0%" stop-color="#ed8326" stop-opacity="0.18"/>
      <stop offset="55%" stop-color="#f7a854" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#070a10" stop-opacity="0"/>
    </radialGradient>
    <filter id="towerGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      .mono { font-family: 'Consolas', 'SFMono-Regular', 'Cascadia Code', monospace; }
      .sans { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
      .beacon { animation: pulseCore 2s ease-in-out infinite; }
      .beacon-ring { animation: pulseRing 2.6s ease-out infinite; }
      @keyframes pulseCore { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @keyframes pulseRing { 0% { opacity: 0.75; } 100% { opacity: 0.08; } }
    </style>
  </defs>

  <rect x="0.5" y="0.5" width="1039" height="539" rx="14" fill="url(#cityBg)" stroke="#ed8326" stroke-opacity="0.45" stroke-width="1.2"/>
  <rect x="0.5" y="0.5" width="1039" height="539" rx="14" fill="url(#cityGlow)"/>

  <g fill="none" stroke="#f7a854" stroke-width="1.8" stroke-linecap="round">
    <path d="M 16 36 L 16 16 L 40 16"/>
    <path d="M 1000 16 L 1024 16 L 1024 36"/>
    <path d="M 16 504 L 16 524 L 40 524"/>
    <path d="M 1000 524 L 1024 524 L 1024 504"/>
  </g>

${stars}

  <g>
    <text x="34" y="39" class="mono" font-size="11.5" fill="#ffd39e" letter-spacing="1.6" font-weight="700">GITHUB CONTRIBUTIONS — @TIN-AXLE</text>
    <text x="34" y="57" class="mono" font-size="10" fill="#d99b66">${days.length}-DAY GITHUB ACTIVITY · BUILDING HEIGHT = DAILY CONTRIBUTIONS</text>

    <g transform="translate(606, 22)" class="mono">
      <rect x="0" y="0" width="96" height="38" rx="5" fill="#121824" stroke="#ed8326" stroke-opacity="0.5"/>
      <text x="10" y="15" font-size="8.2" fill="#d99b66">TOTAL / YR</text>
      <text x="10" y="31" font-size="14" fill="#ffe4be" font-weight="700">${data.totalContributions.toLocaleString('en-US')}</text>

      <rect x="104" y="0" width="98" height="38" rx="5" fill="#121824" stroke="#ed8326" stroke-opacity="0.5"/>
      <text x="114" y="15" font-size="8.2" fill="#d99b66">ACTIVE DAYS</text>
      <text x="114" y="31" font-size="14" fill="#ffe4be" font-weight="700">${data.activeDays}</text>

      <rect x="210" y="0" width="98" height="38" rx="5" fill="#121824" stroke="#ed8326" stroke-opacity="0.5"/>
      <text x="220" y="15" font-size="8.2" fill="#d99b66">PEAK DAY</text>
      <text x="220" y="31" font-size="14" fill="#ffe4be" font-weight="700">${data.maxDay.count}</text>

      <rect x="316" y="0" width="92" height="38" rx="5" fill="#121824" stroke="#ed8326" stroke-opacity="0.5"/>
      <text x="326" y="15" font-size="8.2" fill="#d99b66">STREAK</text>
      <text x="326" y="31" font-size="14" fill="#ffe4be" font-weight="700">${data.peakStreak}D</text>
    </g>
  </g>
  <line x1="24" y1="70" x2="1016" y2="70" stroke="#ed8326" stroke-opacity="0.25" stroke-width="1"/>
  <line x1="28" y1="312" x2="1012" y2="312" stroke="#ed8326" stroke-opacity="0.08" stroke-dasharray="4 6"/>

${basePlatform}

  <g>
${buildingsSvg}  </g>

  <g>
${monthLabels}  </g>

${calloutsSvg}

  <g transform="translate(34, 496)" class="mono" font-size="9.5">
    <text x="0" y="14" fill="#d99b66" letter-spacing="1">ACTIVITY LEVEL:</text>
    <rect x="128" y="4" width="14" height="12" rx="2" fill="#141b27" stroke="#ed8326" stroke-opacity="0.4"/>
    <text x="148" y="14" fill="#c48a58">0</text>
    <rect x="172" y="4" width="14" height="12" rx="2" fill="#f5a654"/>
    <text x="192" y="14" fill="#e6aa6c">1–3</text>
    <rect x="228" y="4" width="14" height="12" rx="2" fill="#f9bc73"/>
    <text x="248" y="14" fill="#f7b76e">4–8</text>
    <rect x="286" y="4" width="14" height="12" rx="2" fill="#ffd59e"/>
    <text x="306" y="14" fill="#ffd39e">9–16</text>
    <rect x="350" y="4" width="14" height="12" rx="2" fill="#fff0d6"/>
    <text x="370" y="14" fill="#fff0d6">17+</text>

    <text x="972" y="14" fill="#d99b66" text-anchor="end">${windowLabel} · LIVE GITHUB CONTRIBUTIONS</text>
  </g>
</svg>`;

  fs.writeFileSync(path.join(outDir, 'contribution-city.svg'), svg, 'utf8');
  console.log('Generated assets/contribution-city.svg:', (svg.length / 1024).toFixed(1), 'KB');
}

// ============================================================================
// 3. REVOLVING TECHNOLOGY SOLAR SYSTEM + PROFILE PICTURE CORE (1040 x 660)
// ============================================================================
function buildSolarSystem(data) {
  const cx = 520;
  const cy = 338;
  const avatarB64 = fs.readFileSync(path.join(__dirname, 'avatar-160.b64'), 'utf8').trim();

  let stars = '';
  for (let i = 0; i < 82; i++) {
    const sx = ((i * 173 + 29) % 1010) + 15;
    const sy = ((i * 127 + 61) % 540) + 68;
    const sr = (i % 7 === 0) ? 1.5 : (i % 3 === 0 ? 1.0 : 0.65);
    const op = (0.18 + (i % 5) * 0.13).toFixed(2);
    const twinkle = i % 6 === 0 ? ` class="star-twinkle" style="animation-delay:${((i * 0.27) % 4).toFixed(2)}s"` : '';
    stars += `  <circle cx="${sx}" cy="${sy}" r="${sr}" fill="${i % 4 === 0 ? '#ffd39e' : '#fff2dc'}" opacity="${op}"${twinkle}/>\n`;
  }

  function ellipsePath(rx, ry) {
    return `M ${rx},0 A ${rx},${ry} 0 1,1 ${-rx},0 A ${rx},${ry} 0 1,1 ${rx},0 Z`;
  }

  const pctOf = (name) => {
    const found = data.langStats.find(l => l.name.toLowerCase() === name.toLowerCase());
    return found ? found.pct : 0;
  };
  const webPct = pctOf('JavaScript') + pctOf('HTML') + pctOf('CSS');

  // Dynamically map live public repos by primary language (+ verified resume projects)
  const reposByLang = (lang) => data.repos.filter(r => (r.language || '').toLowerCase() === lang.toLowerCase()).map(r => r.name);

  const tsRepos = [...reposByLang('TypeScript').map(n => ({ name: n, publicRepo: true })), { name: 'USA Attendance*', publicRepo: false }];
  const pyRepos = [...reposByLang('Python').map(n => ({ name: n, publicRepo: true })), { name: 'Medicalexa*', publicRepo: false }];
  const jsRepos = [...reposByLang('JavaScript').map(n => ({ name: n, publicRepo: true })), { name: 'Quarto', publicRepo: true }];

  function distributeMoons(list, dur, baseR) {
    return list.map((m, idx) => ({
      ...m,
      dur,
      begin: Number(((idx / Math.max(1, list.length)) * dur + 0.4).toFixed(2)),
      mr: m.publicRepo ? Math.max(4.8, baseR - idx * 0.4) : 5.4
    }));
  }

  const tsPct = pctOf('TypeScript');
  const pyPct = pctOf('Python');
  const psPct = pctOf('PowerShell');
  const glslPct = pctOf('GLSL');
  const totalKB = (data.totalBytes / 1024).toFixed(1);

  const planets = [
    {
      id: 'ps',
      name: 'POWERSHELL',
      stat: `${psPct.toFixed(1)}%`,
      rx: 142, ry: 70, dur: 18, begin: 12.0,
      r: Math.max(11, Math.min(18, 10 + psPct * 1.1)),
      grad: 'url(#planetPS)', ring: false,
      moonOrbit: { rx: 38, ry: 24 },
      moons: [{ name: 'KoiPond.ps1', dur: 6.5, begin: 0.4, mr: 3.8, publicRepo: true }]
    },
    {
      id: 'glsl',
      name: 'GLSL',
      stat: `${glslPct.toFixed(1)}%`,
      rx: 204, ry: 96, dur: 24, begin: 2.6,
      r: Math.max(10.5, Math.min(16, 10 + glslPct * 1.0)),
      grad: 'url(#planetGLSL)', ring: false,
      moonOrbit: null,
      moons: []
    },
    {
      id: 'ts',
      name: 'TYPESCRIPT',
      stat: `${tsPct.toFixed(1)}%`,
      rx: 278, ry: 128, dur: 34, begin: 17.0,
      r: Math.max(24, Math.min(35, 16 + tsPct * 0.28)),
      grad: 'url(#planetTS)', ring: true,
      moonOrbit: { rx: 82, ry: 52 },
      moons: distributeMoons(tsRepos, 11.0, 6.6)
    },
    {
      id: 'py',
      name: 'PYTHON',
      stat: `${pyPct.toFixed(1)}%`,
      rx: 356, ry: 162, dur: 44, begin: 0.5,
      r: Math.max(22, Math.min(32, 16 + pyPct * 0.28)),
      grad: 'url(#planetPY)', ring: false,
      moonOrbit: { rx: 78, ry: 50 },
      moons: distributeMoons(pyRepos, 12.5, 6.4)
    },
    {
      id: 'js',
      name: 'JAVASCRIPT & WEB',
      stat: `${webPct.toFixed(1)}% + COLLAB`,
      rx: 422, ry: 194, dur: 56, begin: 42.0,
      r: 18, grad: 'url(#planetJS)', ring: true,
      moonOrbit: { rx: 62, ry: 36 },
      moons: distributeMoons(jsRepos, 9.5, 6.0)
    },
    {
      id: 'java',
      name: 'JAVA & CLOUD',
      stat: 'RESUME CORE',
      rx: 476, ry: 220, dur: 70, begin: 17.5,
      r: 16.5, grad: 'url(#planetJAVA)', ring: false,
      moonOrbit: { rx: 72, ry: 38 },
      moons: [
        { name: 'React / Vue',         dur: 13.5, begin: 6.75, mr: 4.8, publicRepo: false },
        { name: 'Firebase / Supabase', dur: 13.5, begin: 0.0,  mr: 4.8, publicRepo: false },
      ]
    }
  ];

  let orbitsSvg = '';
  planets.forEach((p, idx) => {
    const dash = idx === 0 ? '4 4' : idx === 3 ? '8 4' : idx === 5 ? '3 6' : '';
    const op = (0.36 - idx * 0.025).toFixed(2);
    orbitsSvg += `    <ellipse cx="${cx}" cy="${cy}" rx="${p.rx}" ry="${p.ry}" fill="none" stroke="#f7a854" stroke-opacity="${op}" stroke-width="1.1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`;
  });

  let planetsSvg = '';
  for (const p of planets) {
    const orbitD = ellipsePath(p.rx, p.ry);
    planetsSvg += `  <g transform="translate(${cx}, ${cy})">\n`;
    planetsSvg += `    <g>\n`;
    planetsSvg += `      <animateMotion dur="${p.dur}s" begin="-${p.begin}s" repeatCount="indefinite" path="${orbitD}" />\n`;

    if (p.moonOrbit && p.moons.length > 0) {
      planetsSvg += `      <ellipse cx="0" cy="0" rx="${p.moonOrbit.rx}" ry="${p.moonOrbit.ry}" fill="none" stroke="#ffd39e" stroke-opacity="0.28" stroke-width="0.9" stroke-dasharray="3 4"/>\n`;
    }

    if (p.ring) {
      const rrx = Math.round(p.r * 1.66);
      const rry = Math.round(p.r * 0.44);
      planetsSvg += `      <g transform="rotate(-14)">\n`;
      planetsSvg += `        <ellipse cx="0" cy="0" rx="${rrx}" ry="${rry}" fill="none" stroke="#ffd39e" stroke-opacity="0.62" stroke-width="2.4"/>\n`;
      planetsSvg += `        <ellipse cx="0" cy="0" rx="${rrx + 5}" ry="${rry + 2}" fill="none" stroke="#ed8326" stroke-opacity="0.34" stroke-width="1"/>\n`;
      planetsSvg += `      </g>\n`;
    }

    planetsSvg += `      <circle cx="0" cy="0" r="${(p.r + 6).toFixed(1)}" fill="#ed8326" fill-opacity="0.16"/>\n`;
    planetsSvg += `      <circle cx="0" cy="0" r="${p.r.toFixed(1)}" fill="${p.grad}" stroke="#ffe4be" stroke-opacity="0.7" stroke-width="1.1"/>\n`;

    if (p.r >= 24) {
      planetsSvg += `      <g clip-path="url(#clip-${p.id})">\n`;
      planetsSvg += `        <path d="M ${(-p.r - 8).toFixed(1)} -7 Q 0 -1 ${(p.r + 8).toFixed(1)} -7" fill="none" stroke="#fff2dc" stroke-opacity="0.32" stroke-width="2.2">\n`;
      planetsSvg += `          <animateTransform attributeName="transform" type="translate" values="-6 0; 6 0; -6 0" dur="5s" repeatCount="indefinite" />\n`;
      planetsSvg += `        </path>\n`;
      planetsSvg += `        <path d="M ${(-p.r - 8).toFixed(1)} 9 Q 0 15 ${(p.r + 8).toFixed(1)} 9" fill="none" stroke="#a65d1e" stroke-opacity="0.34" stroke-width="2.4">\n`;
      planetsSvg += `          <animateTransform attributeName="transform" type="translate" values="6 0; -6 0; 6 0" dur="6.5s" repeatCount="indefinite" />\n`;
      planetsSvg += `        </path>\n`;
      planetsSvg += `      </g>\n`;
    }

    const ly = p.r >= 24 ? -2 : -(p.r + 12);
    if (p.r >= 24) {
      planetsSvg += `      <text x="0" y="${ly}" text-anchor="middle" class="mono label-halo" font-size="9.6" font-weight="800" fill="#fff6e8" letter-spacing="0.7">${esc(p.name)}</text>\n`;
      planetsSvg += `      <text x="0" y="${ly + 11.5}" text-anchor="middle" class="mono label-halo" font-size="8.6" font-weight="700" fill="#ffd39e">${esc(p.stat)}</text>\n`;
    } else {
      planetsSvg += `      <text x="0" y="${ly.toFixed(1)}" text-anchor="middle" class="mono label-halo" font-size="9.6" font-weight="700" fill="#fff0d9" letter-spacing="0.6">${esc(p.name)}</text>\n`;
      planetsSvg += `      <text x="0" y="${(ly + 10.5).toFixed(1)}" text-anchor="middle" class="mono label-halo" font-size="8.0" fill="#f7a854">${esc(p.stat)}</text>\n`;
    }

    if (p.moonOrbit && p.moons.length > 0) {
      const mPath = ellipsePath(p.moonOrbit.rx, p.moonOrbit.ry);
      for (const m of p.moons) {
        planetsSvg += `      <g>\n`;
        planetsSvg += `        <animateMotion dur="${m.dur}s" begin="-${m.begin}s" repeatCount="indefinite" path="${mPath}" />\n`;
        planetsSvg += `        <circle cx="0" cy="0" r="${(m.mr + 3).toFixed(1)}" fill="#ffd39e" fill-opacity="0.18"/>\n`;
        if (m.publicRepo) {
          planetsSvg += `        <circle cx="0" cy="0" r="${m.mr.toFixed(1)}" fill="url(#moonGlow)" stroke="#fff3e0" stroke-width="0.95"/>\n`;
        } else {
          planetsSvg += `        <circle cx="0" cy="0" r="${m.mr.toFixed(1)}" fill="#141b28" stroke="#ffd39e" stroke-width="1.3"/>\n`;
          planetsSvg += `        <circle cx="0" cy="0" r="${(m.mr * 0.44).toFixed(1)}" fill="#ffd39e"/>\n`;
        }
        planetsSvg += `        <text x="${(m.mr + 5).toFixed(1)}" y="3" text-anchor="start" class="mono label-halo" font-size="8.6" font-weight="700" fill="#ffe6c4">${esc(m.name)}</text>\n`;
        planetsSvg += `      </g>\n`;
      }
    }

    planetsSvg += `    </g>\n`;
    planetsSvg += `  </g>\n`;
  }

  const tsR = planets.find(p => p.id === 'ts').r.toFixed(1);
  const pyR = planets.find(p => p.id === 'py').r.toFixed(1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="660" viewBox="0 0 1040 660" role="img" aria-label="Animated Languages and Repositories Solar System for Tin-axle">
  <defs>
    <linearGradient id="spaceBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06090f"/>
      <stop offset="50%" stop-color="#0b1019"/>
      <stop offset="100%" stop-color="#111622"/>
    </linearGradient>
    <radialGradient id="sunHalo" cx="50%" cy="51.2%" r="34%">
      <stop offset="0%" stop-color="#ffd59e" stop-opacity="0.34"/>
      <stop offset="32%" stop-color="#ed8326" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#06090f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="avatarRim" cx="50%" cy="50%" r="50%">
      <stop offset="66%" stop-color="#ed8326" stop-opacity="0"/>
      <stop offset="88%" stop-color="#f7a854" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#ffe2ba" stop-opacity="0.72"/>
    </radialGradient>
    <radialGradient id="planetTS" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#fff0d6"/>
      <stop offset="38%" stop-color="#f9ba6e"/>
      <stop offset="78%" stop-color="#ed8326"/>
      <stop offset="100%" stop-color="#b5621c"/>
    </radialGradient>
    <radialGradient id="planetPY" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffe7c4"/>
      <stop offset="42%" stop-color="#f7a854"/>
      <stop offset="82%" stop-color="#df7d24"/>
      <stop offset="100%" stop-color="#9e5a1d"/>
    </radialGradient>
    <radialGradient id="planetJS" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#fff4e0"/>
      <stop offset="48%" stop-color="#fccb8a"/>
      <stop offset="100%" stop-color="#e3862d"/>
    </radialGradient>
    <radialGradient id="planetPS" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffe3ba"/>
      <stop offset="55%" stop-color="#f2a24f"/>
      <stop offset="100%" stop-color="#b86b24"/>
    </radialGradient>
    <radialGradient id="planetGLSL" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#fff8eb"/>
      <stop offset="50%" stop-color="#ffd7a3"/>
      <stop offset="100%" stop-color="#f29b42"/>
    </radialGradient>
    <radialGradient id="planetJAVA" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffe9c9"/>
      <stop offset="55%" stop-color="#e89a4a"/>
      <stop offset="100%" stop-color="#a86222"/>
    </radialGradient>
    <radialGradient id="moonGlow" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#fff8ec"/>
      <stop offset="55%" stop-color="#ffd39e"/>
      <stop offset="100%" stop-color="#ed8326"/>
    </radialGradient>
    <clipPath id="coreAvatarClip">
      <circle cx="${cx}" cy="${cy}" r="36"/>
    </clipPath>
    <clipPath id="clip-ts">
      <circle cx="0" cy="0" r="${tsR}"/>
    </clipPath>
    <clipPath id="clip-py">
      <circle cx="0" cy="0" r="${pyR}"/>
    </clipPath>
    <filter id="sunBlur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      .mono { font-family: 'Consolas', 'SFMono-Regular', 'Cascadia Code', monospace; }
      .label-halo { paint-order: stroke; stroke: #070b12; stroke-width: 3.4px; stroke-linejoin: round; }
      .spin-sun { transform-origin: ${cx}px ${cy}px; animation: spinCW 24s linear infinite; }
      .spin-sun-rev { transform-origin: ${cx}px ${cy}px; animation: spinCCW 16s linear infinite; }
      .sun-pulse { animation: pulseSun 3.2s ease-in-out infinite; }
      .star-twinkle { animation: twinkle 3.6s ease-in-out infinite; }
      @keyframes spinCW { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes spinCCW { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
      @keyframes pulseSun { 0%, 100% { opacity: 0.94; } 50% { opacity: 0.55; } }
      @keyframes twinkle { 0%, 100% { opacity: 0.85; } 50% { opacity: 0.2; } }
    </style>
  </defs>

  <rect x="0.5" y="0.5" width="1039" height="659" rx="14" fill="url(#spaceBg)" stroke="#ed8326" stroke-opacity="0.45" stroke-width="1.2"/>
  <rect x="0.5" y="0.5" width="1039" height="659" rx="14" fill="url(#sunHalo)"/>

  <g fill="none" stroke="#f7a854" stroke-width="1.8" stroke-linecap="round">
    <path d="M 16 36 L 16 16 L 40 16"/>
    <path d="M 1000 16 L 1024 16 L 1024 36"/>
    <path d="M 16 624 L 16 644 L 40 644"/>
    <path d="M 1000 644 L 1024 644 L 1024 624"/>
  </g>

${stars}

  <g stroke="#ed8326" stroke-opacity="0.09" stroke-width="1">
    <line x1="24" y1="${cy}" x2="1016" y2="${cy}"/>
    <line x1="${cx}" y1="74" x2="${cx}" y2="602"/>
  </g>

  <g>
    <text x="34" y="39" class="mono" font-size="11.5" fill="#ffd39e" letter-spacing="1.6" font-weight="700">LANGUAGES &amp; REPOSITORIES — @TIN-AXLE</text>
    <text x="34" y="57" class="mono" font-size="10" fill="#d99b66">PLANET SIZE = GITHUB LANGUAGE SHARE (${totalKB} KB) · MOONS = REPOSITORIES</text>
    <rect x="850" y="24" width="158" height="24" rx="4" fill="#ed8326" fill-opacity="0.14" stroke="#f7a854" stroke-opacity="0.55"/>
    <text x="929" y="40" text-anchor="middle" class="mono" font-size="9.5" fill="#ffe4be" font-weight="700">6 LANGUAGES · LIVE</text>
  </g>
  <line x1="24" y1="68" x2="1016" y2="68" stroke="#ed8326" stroke-opacity="0.25" stroke-width="1"/>

  <g>
${orbitsSvg}  </g>

  <!-- Central Profile Picture -->
  <g>
    <circle cx="${cx}" cy="${cy}" r="58" fill="none" stroke="#f7a854" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="10 6" class="spin-sun"/>
    <circle cx="${cx}" cy="${cy}" r="49" fill="none" stroke="#ffd39e" stroke-opacity="0.65" stroke-width="1.6" stroke-dasharray="22 14" class="spin-sun-rev"/>
    <circle cx="${cx}" cy="${cy}" r="43" fill="#ed8326" fill-opacity="0.26" class="sun-pulse" filter="url(#sunBlur)"/>
    <circle cx="${cx}" cy="${cy}" r="38" fill="#101622" stroke="#ffe4be" stroke-width="1.8" filter="url(#sunBlur)"/>
    <image href="data:image/jpeg;base64,${avatarB64}" x="${cx - 36}" y="${cy - 36}" width="72" height="72" preserveAspectRatio="xMidYMid slice" clip-path="url(#coreAvatarClip)"/>
    <circle cx="${cx}" cy="${cy}" r="36" fill="url(#avatarRim)"/>
    <circle cx="${cx}" cy="${cy}" r="36.5" fill="none" stroke="#ffd39e" stroke-opacity="0.9" stroke-width="1.5"/>
    <rect x="${cx - 41}" y="${cy + 40}" width="82" height="16" rx="8" fill="#0d131f" fill-opacity="0.92" stroke="#f7a854" stroke-opacity="0.7" stroke-width="0.9"/>
    <text x="${cx}" y="${cy + 51}" text-anchor="middle" class="mono" font-size="8.6" font-weight="700" fill="#ffe6c4">@TIN-AXLE</text>
  </g>

${planetsSvg}

  <line x1="24" y1="608" x2="1016" y2="608" stroke="#ed8326" stroke-opacity="0.25" stroke-width="1"/>
  <g transform="translate(34, 624)" class="mono" font-size="9.2">
    <circle cx="6" cy="5" r="5" fill="url(#moonGlow)" stroke="#fff3e0" stroke-width="0.9"/>
    <text x="18" y="8.5" fill="#ffe4be">Public GitHub Repository</text>

    <circle cx="196" cy="5" r="5" fill="#141b28" stroke="#ffd39e" stroke-width="1.3"/>
    <circle cx="196" cy="5" r="2.2" fill="#ffd39e"/>
    <text x="208" y="8.5" fill="#e6b07a">* Resume Project / Core Stack</text>

    <text x="972" y="8.5" text-anchor="end" fill="#d99b66">GITHUB API: TS ${tsPct.toFixed(1)}% · PY ${pyPct.toFixed(1)}% · PS1 ${psPct.toFixed(1)}% · GLSL ${glslPct.toFixed(1)}% · WEB ${webPct.toFixed(1)}%</text>
  </g>
</svg>`;

  fs.writeFileSync(path.join(outDir, 'tech-solar-system.svg'), svg, 'utf8');
  console.log('Generated assets/tech-solar-system.svg:', (svg.length / 1024).toFixed(1), 'KB');
}

// ============================================================================
// 4. TECHNOLOGY STACK & LANGUAGE BREAKDOWN (1040 x 250)
// ============================================================================
function buildHudTelemetry(data) {
  const barW = 976;
  const pctOf = (name) => {
    const found = data.langStats.find(l => l.name.toLowerCase() === name.toLowerCase());
    return found ? found.pct : 0;
  };
  const webPct = pctOf('JavaScript') + pctOf('HTML') + pctOf('CSS') + pctOf('Dockerfile');

  const segs = [
    { name: 'TypeScript',  pct: pctOf('TypeScript'), color: '#f7a854' },
    { name: 'Python',      pct: pctOf('Python'),     color: '#ffd39e' },
    { name: 'PowerShell',  pct: pctOf('PowerShell'), color: '#ed8326' },
    { name: 'GLSL',        pct: pctOf('GLSL'),       color: '#fff0d6' },
    { name: 'JS/HTML/CSS', pct: webPct,              color: '#c9782e' },
  ].filter(s => s.pct > 0);

  let barSvg = '';
  let curX = 32;
  for (const s of segs) {
    const w = Math.max(6, (s.pct / 100) * barW);
    barSvg += `    <rect x="${curX.toFixed(1)}" y="118" width="${(w - 2).toFixed(1)}" height="12" rx="3" fill="${s.color}"/>\n`;
    curX += w;
  }

  let legendSvg = '';
  const xOffsets = [0, 180, 340, 520, 650];
  segs.forEach((s, i) => {
    legendSvg += `    <text x="${xOffsets[i] ?? i * 165}" y="38" font-size="11" fill="${s.color}">■ ${esc(s.name)} <tspan fill="#ffe4be" font-weight="700">${s.pct.toFixed(1)}%</tspan></text>\n`;
  });

  const totalKB = (data.totalBytes / 1024).toFixed(1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="250" viewBox="0 0 1040 250" role="img" aria-label="Language Distribution and Technology Stack">
  <defs>
    <linearGradient id="telBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070a10"/>
      <stop offset="100%" stop-color="#111722"/>
    </linearGradient>
    <style>
      .mono { font-family: 'Consolas', 'SFMono-Regular', 'Cascadia Code', monospace; }
    </style>
  </defs>

  <rect x="0.5" y="0.5" width="1039" height="249" rx="14" fill="url(#telBg)" stroke="#ed8326" stroke-opacity="0.45" stroke-width="1.2"/>

  <g fill="none" stroke="#f7a854" stroke-width="1.6" stroke-linecap="round">
    <path d="M 14 32 L 14 14 L 36 14"/>
    <path d="M 1004 14 L 1026 14 L 1026 32"/>
    <path d="M 14 218 L 14 236 L 36 236"/>
    <path d="M 1004 236 L 1026 236 L 1026 218"/>
  </g>

  <text x="32" y="38" class="mono" font-size="11.2" fill="#ffd39e" letter-spacing="1.5" font-weight="700">TECHNOLOGY STACK &amp; LANGUAGE BREAKDOWN</text>
  <text x="1008" y="38" text-anchor="end" class="mono" font-size="9.8" fill="#d99b66">${totalKB} KB · ${data.repos.length} PUBLIC REPOSITORIES</text>
  <line x1="24" y1="49" x2="1016" y2="49" stroke="#ed8326" stroke-opacity="0.24"/>

  <g transform="translate(32, 62)" class="mono">
    <text x="0" y="14" font-size="9.5" fill="#d99b66">GITHUB LANGUAGE DISTRIBUTION (BY BYTE WEIGHT)</text>
${legendSvg}  </g>

  <rect x="32" y="118" width="976" height="12" rx="3" fill="#141b27"/>
${barSvg}

  <g transform="translate(32, 148)" class="mono">
    <rect x="0" y="0" width="234" height="78" rx="7" fill="#101622" stroke="#ed8326" stroke-opacity="0.4"/>
    <text x="12" y="21" font-size="9.4" fill="#ffd39e" font-weight="700">FRONTEND</text>
    <text x="12" y="42" font-size="8.8" fill="#f7b76e">React · Next.js · Vue 3 · Nuxt 4</text>
    <text x="12" y="60" font-size="8.6" fill="#d99b66">Three.js · Quasar · Pinia · HTML/CSS</text>

    <rect x="248" y="0" width="234" height="78" rx="7" fill="#101622" stroke="#ed8326" stroke-opacity="0.4"/>
    <text x="260" y="21" font-size="9.4" fill="#ffd39e" font-weight="700">BACKEND &amp; CLOUD</text>
    <text x="260" y="42" font-size="8.8" fill="#f7b76e">Node.js · FastAPI · Cloud Functions</text>
    <text x="260" y="60" font-size="8.6" fill="#d99b66">Firebase · Firestore · Supabase · AWS</text>

    <rect x="496" y="0" width="234" height="78" rx="7" fill="#101622" stroke="#ed8326" stroke-opacity="0.4"/>
    <text x="508" y="21" font-size="9.4" fill="#ffd39e" font-weight="700">AI, NLP &amp; DATA</text>
    <text x="508" y="42" font-size="8.8" fill="#f7b76e">PyTorch · Hugging Face Transformers</text>
    <text x="508" y="60" font-size="8.6" fill="#d99b66">spaCy · NetworkX · PrimeKG · Chart.js</text>

    <rect x="744" y="0" width="232" height="78" rx="7" fill="#101622" stroke="#ed8326" stroke-opacity="0.4"/>
    <text x="756" y="21" font-size="9.4" fill="#ffd39e" font-weight="700">TOOLS &amp; LEADERSHIP</text>
    <text x="756" y="42" font-size="8.8" fill="#f7b76e">Git · GitHub · VS Code · Android</text>
    <text x="756" y="60" font-size="8.6" fill="#d99b66">AntiGravity IDE · UI/UX · Tech Lead</text>
  </g>
</svg>`;

  fs.writeFileSync(path.join(outDir, 'hud-telemetry.svg'), svg, 'utf8');
  console.log('Generated assets/hud-telemetry.svg:', (svg.length / 1024).toFixed(1), 'KB');
}

// ============================================================================
// 5. SECTION DIVIDER (1040 x 24)
// ============================================================================
function buildHudDivider() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="24" viewBox="0 0 1040 24" role="img" aria-label="Divider">
  <defs>
    <linearGradient id="divGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ed8326" stop-opacity="0"/>
      <stop offset="18%" stop-color="#ed8326" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="#ffe2ba" stop-opacity="0.95"/>
      <stop offset="82%" stop-color="#ed8326" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ed8326" stop-opacity="0"/>
    </linearGradient>
    <style>
      .pulse { animation: travel 4.5s ease-in-out infinite; }
      @keyframes travel { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
    </style>
  </defs>
  <line x1="16" y1="12" x2="1024" y2="12" stroke="url(#divGrad)" stroke-width="1.4"/>
  <polygon points="520,5 527,12 520,19 513,12" fill="#ffe2ba" class="pulse"/>
  <polygon points="492,9 496,12 492,15 488,12" fill="#f7a854" opacity="0.8"/>
  <polygon points="548,9 552,12 548,15 544,12" fill="#f7a854" opacity="0.8"/>
  <line x1="452" y1="12" x2="480" y2="12" stroke="#ffd39e" stroke-width="2" opacity="0.7"/>
  <line x1="560" y1="12" x2="588" y2="12" stroke="#ffd39e" stroke-width="2" opacity="0.7"/>
</svg>`;
  fs.writeFileSync(path.join(outDir, 'hud-divider.svg'), svg, 'utf8');
  console.log('Generated assets/hud-divider.svg:', (svg.length / 1024).toFixed(1), 'KB');
}

async function main() {
  const data = await fetchLiveGitHubData();
  console.log(`Live GitHub data for @${USERNAME}: ${data.totalContributions} contribs, ${data.activeDays} active days, peak ${data.maxDay.count} (${data.maxDay.date}), streak ${data.peakStreak}d, ${data.repos.length} repos`);
  buildHudHeader(data);
  buildContributionCity(data);
  buildSolarSystem(data);
  buildHudTelemetry(data);
  buildHudDivider();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
