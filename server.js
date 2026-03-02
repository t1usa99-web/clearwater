/**
 * ClearWater - Node.js server (no npm dependencies)
 * Uses only Node.js built-in modules: http, fs, path, url
 * Requires Node.js 18+ (for built-in fetch)
 *
 * Routes:
 *   GET /                       → SPA homepage (index.html)
 *   GET /report/:pwsid          → SSR water quality report page
 *   GET /zip/:zip               → Redirect to top system for that ZIP
 *   GET /sitemap.xml            → Auto-generated XML sitemap
 *   GET /robots.txt             → Robots file
 *   GET /api/systems?zip=XXXXX  → JSON: water systems near ZIP
 *   GET /api/report?pwsid=XXXXX → JSON: full report data
 *   GET /public/*               → Static files
 *
 * Data sources:
 *   api.zippopotam.us           - ZIP code -> city + state
 *   data.epa.gov/efservice       - EPA Envirofacts SDWIS API
 */

import http   from 'http';
import fs     from 'fs';
import path   from 'path';
import zlib   from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT     = process.env.PORT    || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC   = path.join(__dirname, 'public');
const EPA_BASE = 'https://data.epa.gov/efservice';
const ZIP_API  = 'https://api.zippopotam.us/us';

// ─── Blog articles (loaded from articles.json at startup) ─────────
let ARTICLES = [];
try {
  const articlesPath = path.join(__dirname, 'articles.json');
  if (fs.existsSync(articlesPath)) {
    ARTICLES = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
    console.log(`[articles] Loaded ${ARTICLES.length} articles`);
  }
} catch (e) { console.error('[articles] Failed to load:', e.message); }

// ─── MIME types ───────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.xml':  'application/xml; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

// ─── In-memory cache (24 h TTL, max 1000 entries) ────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000;
const _cache    = new Map();

const getCached = (key) => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
};

const setCached = (key, data) => {
  if (_cache.size >= 1000) {
    // Evict the oldest entry
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { data, ts: Date.now() });
};

// ─── Helpers ──────────────────────────────────────────────────────
const escHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fetchJSON = async (url, timeout = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; ClearWater/1.0; +https://clearwater.app)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) { console.warn(`[fetch] ${res.status} for ${url}`); return null; }
    const text = await res.text();
    if (!text || text.trim() === '[]') return [];
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[fetch] error for ${url}: ${err.message}`);
    return null;
  }
};

// Gzip a Buffer/string if the request accepts it; returns { body, encoding }
const maybeGzip = (req, content) => new Promise((resolve) => {
  const raw  = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  const enc  = req?.headers?.['accept-encoding'] || '';
  if (!enc.includes('gzip')) return resolve({ body: raw, encoding: null });
  zlib.gzip(raw, (err, buf) => resolve(err ? { body: raw, encoding: null } : { body: buf, encoding: 'gzip' }));
});

const sendJSON = async (req, res, status, data) => {
  const body = JSON.stringify(data);
  const { body: out, encoding } = await maybeGzip(req, body);
  const headers = {
    'Content-Type':   'application/json',
    'Content-Length': out.length,
    'Cache-Control':  'no-cache',
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(status, headers);
  res.end(out);
};

const sendHTML = async (req, res, html, status = 200) => {
  const { body: out, encoding } = await maybeGzip(req, html);
  const headers = {
    'Content-Type':   'text/html; charset=utf-8',
    'Cache-Control':  'no-cache',
    'Content-Length': out.length,
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(status, headers);
  res.end(out);
};

// Static files - long-lived cache for versioned assets (CSS, JS, fonts, icons)
const STATIC_CACHEABLE = new Set(['.css', '.js', '.ico', '.svg', '.png', '.woff2', '.woff']);
const serveStatic = (req, res, filePath) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext     = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (STATIC_CACHEABLE.has(ext)) {
      // Immutable: browsers cache for 1 year; change the filename/query to bust
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
};

// ─── Data normalizers ─────────────────────────────────────────────
const get = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj[k] ?? obj[k.toUpperCase()];
    if (v !== undefined && v !== null) return v;
  }
  return '';
};

const normalizeSystem = (s) => ({
  pwsid:      String(get(s, 'pwsid') || '').toUpperCase(),
  name:       get(s, 'pws_name')              || 'Unknown System',
  city:       get(s, 'city_name')             || '',
  state:      get(s, 'state_code')            || get(s, 'primacy_agency_code') || '',
  zip:        get(s, 'zip_code')              || '',
  population: parseInt(get(s, 'population_served_count') || 0) || 0,
  sourceType: get(s, 'primary_source_code')   || get(s, 'gw_sw_code') || '',
  pwsType:    get(s, 'pws_type_code')         || '',
  ownerType:  get(s, 'owner_type_code')       || '',
  primacy:    get(s, 'primacy_agency_code')   || '',
});

const normalizeViolation = (v) => ({
  id:                String(get(v, 'violation_id')            || ''),
  pwsid:             String(get(v, 'pwsid')                   || '').toUpperCase(),
  contaminantCode:   String(get(v, 'contaminant_code')        || ''),
  contaminantName:   String(get(v, 'contaminant_name')        || ''),
  violationCode:     String(get(v, 'violation_code')          || ''),
  violationCategory: String(get(v, 'violation_category_code') || ''),
  isHealthBased:     String(get(v, 'is_health_based_ind') || 'N').toUpperCase() === 'Y',
  beginDate:         String(get(v, 'compl_per_begin_date')    || ''),
  endDate:           String(get(v, 'compl_per_end_date')      || ''),
  status:            String(get(v, 'compliance_status_code')  || ''),
  ruleCode:          String(get(v, 'rule_code')               || ''),
  ruleGroupCode:     String(get(v, 'rule_group_code')         || ''),
  violMeasure:       parseFloat(get(v, 'viol_measure')        || 0) || null,
  unit:              String(get(v, 'unit_of_measure')         || ''),
  stateCode:         String(get(v, 'primacy_agency_code')     || ''),
  tier:              String(get(v, 'public_notification_tier')|| ''),
});

const normalizeSample = (s, dateMap = {}) => {
  const sampleId = String(get(s, 'sample_id') || get(s, 'sar_id') || '');
  return {
    pwsid:           String(get(s, 'pwsid')            || '').toUpperCase(),
    contaminantCode: String(get(s, 'contaminant_code') || ''),
    sampleDate:      dateMap[sampleId] || String(get(s, 'sample_date') || ''),
    resultSign:      String(get(s, 'result_sign_code') || ''),
    result:          parseFloat(get(s, 'sample_measure') || 0) || 0,
    unit:            String(get(s, 'unit_of_measure')  || ''),
    sampleId,
  };
};

// ─── Server-side grade computation ───────────────────────────────
// Mirrors the logic in public/app.js so SSR meta tags can show the grade.
const isActiveServer = (v) => {
  const status = (v.status || '').toUpperCase().trim();
  if (status === 'R' || status === 'K') return false;
  if (status === 'O') return true;
  if (!v.endDate || v.endDate.trim() === '') return true;
  const end = new Date(v.endDate);
  if (isNaN(end.getTime())) return true;
  return end > new Date();
};

const computeGradeServer = (violations) => {
  const now = new Date();
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const recentHealth  = violations.filter(v => v.isHealthBased && new Date(v.beginDate) > fiveYearsAgo);
  const activeHealth  = violations.filter(v => v.isHealthBased && isActiveServer(v));
  const activeAll     = violations.filter(v => isActiveServer(v));

  let grade;
  if      (activeHealth.length > 0)       grade = 'F';
  else if (recentHealth.length >= 5)      grade = 'D';
  else if (recentHealth.length >= 2)      grade = 'C';
  else if (recentHealth.length === 1)     grade = 'B';
  else if (activeAll.length > 3)          grade = 'C';
  else                                    grade = 'A';

  const labels = {
    A: 'Meets all standards: no recent health-based violations',
    B: '1 recent health-based violation, generally safe',
    C: 'Multiple violations, some concern warranted',
    D: 'Significant health-based violations: take precautions',
    F: 'Active health violation: check with your utility immediately',
  };

  return { grade, label: labels[grade], activeHealth: activeHealth.length, recentHealth: recentHealth.length };
};

// ─── ZIP → City/State lookup ──────────────────────────────────────
const zipToCity = async (zip) => {
  const cached = getCached(`zip:${zip}`);
  if (cached) return cached;
  const data = await fetchJSON(`${ZIP_API}/${zip}`, 8000);
  if (!data || !data.places || !data.places[0]) return null;
  const result = {
    city:  data.places[0]['place name'].toUpperCase(),
    state: data.places[0]['state abbreviation'].toUpperCase(),
  };
  setCached(`zip:${zip}`, result);
  return result;
};

// ─── Core data fetchers (with cache) ─────────────────────────────
const fetchSystemsForZip = async (zip) => {
  const cacheKey = `systems:${zip}`;
  const cached = getCached(cacheKey);
  if (cached) { console.log(`[cache hit] ${cacheKey}`); return cached; }

  const location = await zipToCity(zip);
  if (!location) return [];

  const { city, state } = location;
  const encodedCity = encodeURIComponent(city);
  console.log(`[systems] ZIP ${zip} → ${city}, ${state}`);

  let systems = await fetchJSON(`${EPA_BASE}/WATER_SYSTEM/primacy_agency_code/${state}/city_name/${encodedCity}/pws_activity_code/A/rows/0:30/JSON`);

  if (!systems || systems.length === 0) {
    systems = await fetchJSON(`${EPA_BASE}/WATER_SYSTEM/state_code/${state}/city_name/${encodedCity}/pws_activity_code/A/rows/0:30/JSON`);
  }

  if (!systems || systems.length === 0) {
    const all = await fetchJSON(`${EPA_BASE}/WATER_SYSTEM/city_name/${encodedCity}/pws_activity_code/A/rows/0:50/JSON`);
    if (Array.isArray(all)) {
      systems = all.filter(s =>
        (get(s, 'state_code') || get(s, 'primacy_agency_code') || '').toUpperCase() === state
      );
    }
  }

  if (!Array.isArray(systems) || systems.length === 0) {
    setCached(cacheKey, []);
    return [];
  }

  const seen = new Set();
  const normalized = systems
    .map(normalizeSystem)
    .filter(s => s.pwsid && !seen.has(s.pwsid) && seen.add(s.pwsid))
    .sort((a, b) => b.population - a.population)
    .slice(0, 15);

  setCached(cacheKey, normalized);
  return normalized;
};

const fetchReportData = async (pwsid) => {
  const cacheKey = `report:${pwsid}`;
  const cached = getCached(cacheKey);
  if (cached) { console.log(`[cache hit] ${cacheKey}`); return cached; }

  console.log(`[report] Fetching ${pwsid}`);

  // EPA Envirofacts: rows/0:500 max for filtered queries to avoid HTTP 500.
  // LCR_SAMPLE_RESULT has no date - join dates from LCR_SAMPLE by sample_id.
  const [violResult, sampleResult, lcrSampleResult, sysResult] = await Promise.allSettled([
    fetchJSON(`${EPA_BASE}/VIOLATION/pwsid/${pwsid}/rows/0:500/JSON`),
    fetchJSON(`${EPA_BASE}/LCR_SAMPLE_RESULT/pwsid/${pwsid}/rows/0:200/JSON`),
    fetchJSON(`${EPA_BASE}/LCR_SAMPLE/pwsid/${pwsid}/rows/0:200/JSON`),
    fetchJSON(`${EPA_BASE}/WATER_SYSTEM/pwsid/${pwsid}/JSON`),
  ]);

  const dateMap = {};
  if (lcrSampleResult.value && Array.isArray(lcrSampleResult.value)) {
    for (const row of lcrSampleResult.value) {
      const id   = String(get(row, 'sample_id') || '');
      const date = String(get(row, 'sampling_end_date') || get(row, 'sampling_start_date') || '');
      if (id && date) dateMap[id] = date;
    }
  }

  const violations = (violResult.value && Array.isArray(violResult.value))
    ? violResult.value.map(normalizeViolation) : [];
  const samples    = (sampleResult.value && Array.isArray(sampleResult.value))
    ? sampleResult.value.map(s => normalizeSample(s, dateMap)) : [];
  const sysArr     = (sysResult.value && Array.isArray(sysResult.value)) ? sysResult.value : [];
  const system     = sysArr[0] ? normalizeSystem(sysArr[0]) : null;

  console.log(`[report] ${pwsid}: ${violations.length} violations, ${samples.length} samples`);

  const result = { system, violations, samples };
  setCached(cacheKey, result);
  return result;
};

// ─── index.html template ──────────────────────────────────────────
// Always read from disk so edits are picked up without restart.
// The SSR response is already cached in _cache per-pwsid, so the
// file I/O only happens once per unique report request anyway.
const getIndexHtml = () =>
  fs.promises.readFile(path.join(PUBLIC, 'index.html'), 'utf-8');

// ─── SSR: build report page from index.html template ─────────────
const SOURCE_LABELS = { GW:'Groundwater', SW:'Surface Water', GU:'GWUDI', GWP:'Groundwater Purchased', SWP:'Surface Water Purchased' };
const GRADE_COLORS  = { A:'#22c55e', B:'#84cc16', C:'#f59e0b', D:'#f97316', F:'#ef4444' };

const renderSSRPage = async (system, violations, samples) => {
  const { grade, label, activeHealth } = computeGradeServer(violations);
  const location = [system.city, system.state].filter(Boolean).join(', ');
  const pop      = system.population > 0 ? `${system.population.toLocaleString()} people served` : '';
  const source   = SOURCE_LABELS[system.sourceType] || '';

  // Avoid "CHICAGO, CHICAGO, IL" when the system name IS the city name
  const nameUpper = (system.name || '').toUpperCase().trim();
  const cityUpper = (system.city || '').toUpperCase().trim();
  const titleLocation = cityUpper && nameUpper === cityUpper
    ? [system.name, system.state].filter(Boolean).join(', ')   // "CHICAGO, IL"
    : `${system.name}${location ? `, ${location}` : ''}`;     // "Metro Water, Chicago, IL"

  const title = `${titleLocation} Water Quality | ClearWater`;
  const desc  = `Water quality for ${system.name}${location ? `, ${location}` : ''}. `
    + `Grade ${grade}: ${label}. ${violations.length} total violations on record. Free EPA data.`;
  const canonical = `${BASE_URL}/report/${escHtml(system.pwsid)}`;
  const gradeColor = GRADE_COLORS[grade] || '#64748b';

  // A short plain-text violation summary for non-JS crawlers
  const healthViolations = violations.filter(v => v.isHealthBased).slice(0, 6);
  const violationList = healthViolations.length
    ? `<ul>${healthViolations.map(v => {
        const status = isActiveServer(v) ? 'Active' : 'Resolved';
        const name   = v.contaminantName || `Contaminant #${v.contaminantCode}`;
        return `<li>${escHtml(name)}: ${escHtml(v.violationCategory)} (${status})</li>`;
      }).join('')}</ul>`
    : '<p>No health-based violations on record.</p>';

  // FAQ for rich snippets - dynamically generated from violation data
  const recentViolations = violations
    .filter(v => v.isHealthBased)
    .slice(0, 3)
    .map(v => v.contaminantName || `Contaminant #${v.contaminantCode}`)
    .filter(Boolean);

  const faqAnswerSafe = grade === 'A'
    ? `${system.name} currently has no active health-based violations and has met all EPA standards in recent years. While this indicates good water quality compliance, you may still want to consider filtering your water, especially if your home has older plumbing that may contain lead.`
    : grade === 'B'
    ? `${system.name} has had 1 health-based violation in the last 5 years. The system generally meets EPA standards. Review the violation history below for details.`
    : `${system.name} has had multiple health-based violations in recent years (grade ${grade}). Review the specific violations below and consider filtering your drinking water.`;

  const faqAnswerViol = recentViolations.length > 0
    ? `Recent health-based violations at ${system.name} include: ${recentViolations.join(', ')}. See the full violation history on this page for dates, status, and details.`
    : `${system.name} has ${violations.length} total violations on record, but none are currently active health-based violations.`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type':    'Dataset',
        'name':     title,
        'description': desc,
        'url':      canonical,
        'creator':  { '@type': 'Organization', 'name': 'U.S. Environmental Protection Agency' },
        'temporalCoverage': '2000/..',
        'spatialCoverage':  location,
        'license':  'https://www.usa.gov/government-works',
      },
      {
        '@type': 'FAQPage',
        'mainEntity': [
          {
            '@type': 'Question',
            'name': `Is ${system.name} water safe to drink?`,
            'acceptedAnswer': { '@type': 'Answer', 'text': faqAnswerSafe },
          },
          {
            '@type': 'Question',
            'name': `What violations has ${system.name} had?`,
            'acceptedAnswer': { '@type': 'Answer', 'text': faqAnswerViol },
          },
          {
            '@type': 'Question',
            'name': `Does ${system.name} water have lead?`,
            'acceptedAnswer': {
              '@type': 'Answer',
              'text': `Lead in drinking water typically comes from household plumbing, not from ${system.name}'s treatment plant. See the Lead & Copper section on this page for the most recent 90th-percentile lead test results. If your home was built before 1986, consider running cold water for 30 seconds before drinking and using an NSF/ANSI 53-certified filter.`,
            },
          },
        ],
      },
    ],
  });

  const injectedHead = `
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ClearWater: Is Your Tap Water Safe? Free EPA water quality lookup.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(desc)}">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <script type="application/ld+json">${jsonLd}</script>
  <script>window.__PRELOADED__=${JSON.stringify({ system, violations, samples })};</script>`;

  // SSR summary injected into the placeholder - visible to non-JS crawlers
  const ssrSummary = `
    <div id="ssr-summary" style="padding:2rem;max-width:800px;margin:0 auto;font-family:system-ui,sans-serif">
      <a href="/" style="color:#0ea5e9;text-decoration:none;font-size:14px">← Search another ZIP code</a>
      <h1 style="margin:1rem 0 0.25rem;font-size:1.75rem">${escHtml(system.name)}</h1>
      <p style="color:#64748b;margin:0 0 1.5rem">
        ${escHtml(location)}${pop ? ` · ${escHtml(pop)}` : ''}${source ? ` · ${escHtml(source)}` : ''}
      </p>
      <div style="display:inline-flex;align-items:center;gap:12px;padding:12px 20px;border:3px solid ${gradeColor};border-radius:12px;margin-bottom:1.5rem">
        <span style="font-size:2.5rem;font-weight:800;color:${gradeColor};line-height:1">${escHtml(grade)}</span>
        <span style="color:#334155;font-size:0.95rem">${escHtml(label)}</span>
      </div>
      <p><strong>${violations.length} total violations</strong> on record.
        ${activeHealth > 0
          ? `<strong style="color:#ef4444">${activeHealth} currently active health violation${activeHealth !== 1 ? 's' : ''}.</strong>`
          : 'No currently active health-based violations.'}</p>
      ${healthViolations.length ? `<h2 style="margin-top:1.5rem;font-size:1.1rem">Health-Based Violations</h2>${violationList}` : ''}
      <p style="margin-top:1.5rem;padding:1rem;background:#f1f5f9;border-radius:8px;font-size:14px;color:#64748b">
        <noscript>Enable JavaScript for the full interactive report.</noscript>
        <span class="js-loading-msg">Loading interactive report…</span>
      </p>
    </div>`;

  let html = await getIndexHtml();

  // Replace <title> with injected head tags
  html = html.replace(
    /<title>[^<]*<\/title>/,
    injectedHead
  );

  // Inject SSR summary into placeholder
  html = html.replace('<!-- SSR_CONTENT_PLACEHOLDER -->', ssrSummary);

  return html;
};

// ─── Popular cities list (used in sitemap + could be used by frontend) ──
const POPULAR_CITIES = [
  { name: 'New York City, NY',    zip: '10001' },
  { name: 'Los Angeles, CA',      zip: '90001' },
  { name: 'Chicago, IL',          zip: '60601' },
  { name: 'Houston, TX',          zip: '77001' },
  { name: 'Phoenix, AZ',          zip: '85001' },
  { name: 'Philadelphia, PA',     zip: '19101' },
  { name: 'San Antonio, TX',      zip: '78201' },
  { name: 'San Diego, CA',        zip: '92101' },
  { name: 'Dallas, TX',           zip: '75201' },
  { name: 'Jacksonville, FL',     zip: '32201' },
  { name: 'Austin, TX',           zip: '78701' },
  { name: 'Fort Worth, TX',       zip: '76101' },
  { name: 'Columbus, OH',         zip: '43201' },
  { name: 'Charlotte, NC',        zip: '28201' },
  { name: 'Indianapolis, IN',     zip: '46201' },
  { name: 'San Francisco, CA',    zip: '94101' },
  { name: 'Seattle, WA',          zip: '98101' },
  { name: 'Denver, CO',           zip: '80201' },
  { name: 'Nashville, TN',        zip: '37201' },
  { name: 'Atlanta, GA',          zip: '30301' },
  { name: 'Las Vegas, NV',        zip: '89101' },
  { name: 'Portland, OR',         zip: '97201' },
  { name: 'Memphis, TN',          zip: '38101' },
  { name: 'Louisville, KY',       zip: '40201' },
  { name: 'Baltimore, MD',        zip: '21201' },
  { name: 'Milwaukee, WI',        zip: '53201' },
  { name: 'Albuquerque, NM',      zip: '87101' },
  { name: 'Tucson, AZ',           zip: '85701' },
  { name: 'Fresno, CA',           zip: '93701' },
  { name: 'Sacramento, CA',       zip: '95801' },
];

// ─── US State data ────────────────────────────────────────────────
const US_STATES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri',
  MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
};

// ─── Contaminant pages data ───────────────────────────────────────
// Each entry: slug -> { name, code, mcl, unit, cat, health, sources, whatToDo }
const CONTAMINANT_PAGES = {
  'lead': {
    name: 'Lead', code: '0006', mcl: 0.015, unit: 'mg/L', cat: 'Heavy Metal',
    health: 'No safe level of lead exposure is known. Lead causes serious brain and nervous system damage, especially in children under 6 and pregnant women. Even low levels can reduce IQ, impair hearing, and cause learning and behavior problems in children. Adults face risks of high blood pressure and kidney damage.',
    sources: 'Lead enters tap water from corroding pipes, solder, and brass fixtures inside homes and buildings, not from the source water. Homes built before 1986 are most likely to have lead pipes or lead solder. The water utility may deliver lead-free water, but lead can leach in as it travels through older plumbing.',
    whatToDo: 'Run the cold water tap for 30 seconds to 2 minutes before drinking if water has been sitting in pipes (overnight or after being away). Always use cold water for drinking and cooking. Consider an NSF/ANSI 53-certified filter. Get your water tested if you have a child under 6 or are pregnant.',
  },
  'arsenic': {
    name: 'Arsenic', code: '0002', mcl: 0.010, unit: 'mg/L', cat: 'Inorganic',
    health: 'Long-term exposure is linked to skin damage, circulatory problems, and increased risk of bladder, lung, and skin cancer. Arsenic also affects the nervous system and can contribute to diabetes. The EPA lowered the MCL from 0.05 to 0.01 mg/L in 2001 in response to cancer evidence.',
    sources: 'Arsenic occurs naturally in rock and soil and dissolves into groundwater, making it most common in private and small community wells. Mining operations, agricultural pesticides, and industrial discharge can also elevate levels. Naturally high concentrations are found in parts of the Southwest, New England, and upper Midwest.',
    whatToDo: 'Use a point-of-use reverse osmosis (RO) filter or activated alumina filter, both rated NSF/ANSI 53 for arsenic removal. Boiling water does not remove arsenic. Check your utility\'s Consumer Confidence Report for measured levels.',
  },
  'nitrate': {
    name: 'Nitrate', code: '0008', mcl: 10, unit: 'mg/L', cat: 'Inorganic',
    health: 'Nitrate is acutely dangerous for infants under 6 months, causing methemoglobinemia ("blue baby syndrome") where the blood loses its ability to carry oxygen. For adults and older children, short-term exposure above the MCL may cause similar issues. Long-term exposure at lower levels is being studied for possible cancer links.',
    sources: 'The primary source is agricultural fertilizer runoff, which enters groundwater and streams. Animal waste from feedlots and septic system leakage also contribute significantly. Nitrate is most common in rural agricultural areas and in surface-influenced groundwater.',
    whatToDo: 'Do not give tap water above the MCL to infants or use it to mix formula. Boiling does NOT remove nitrate; it concentrates it. Use bottled water or a reverse osmosis filter (NSF/ANSI 58 certified) for infant formula and drinking water. Pregnant women should also use caution.',
  },
  'nitrite': {
    name: 'Nitrite', code: '0009', mcl: 1, unit: 'mg/L', cat: 'Inorganic',
    health: 'Like nitrate, nitrite is most dangerous for infants under 6 months, causing methemoglobinemia. Short-term exposure is the primary concern. Nitrite is typically found at lower levels than nitrate since bacteria quickly convert nitrite to nitrate.',
    sources: 'Comes from the same sources as nitrate: fertilizer runoff, animal waste, and septic systems. It can also form in water distribution systems when nitrifying bacteria break down chloramine disinfectants.',
    whatToDo: 'Do not give elevated-nitrite water to infants or use it to mix formula. Boiling concentrates nitrite rather than removing it. Use bottled water or reverse osmosis filtration for infant feeding.',
  },
  'fluoride': {
    name: 'Fluoride', code: '0001', mcl: 4.0, unit: 'mg/L', cat: 'Inorganic',
    health: 'At the MCL (4 mg/L), long-term exposure can cause dental fluorosis (pitting of teeth) and skeletal fluorosis (joint pain and bone damage). However, at low levels (0.7 mg/L), fluoride is intentionally added to most water systems to prevent tooth decay, a practice recommended by public health authorities since the 1940s.',
    sources: 'Fluoride occurs naturally in groundwater from certain rock formations. Many utilities also add fluoride at 0.7 mg/L for dental health benefits. Natural fluoride levels above the MCL are found in parts of the Southwest, Southeast, and Appalachian states.',
    whatToDo: 'If fluoride is above 4 mg/L, use a reverse osmosis filter or distillation system. Standard carbon filters do NOT remove fluoride. Check with your dentist if you have young children who may be getting too much fluoride total (water + dental products).',
  },
  'copper': {
    name: 'Copper', code: '0300', mcl: 1.3, unit: 'mg/L', cat: 'Heavy Metal',
    health: 'Short-term exposure above the action level can cause nausea, vomiting, diarrhea, and stomach cramps. Long-term exposure can cause liver and kidney damage. Children with Wilson\'s disease are particularly vulnerable. Copper is an essential mineral in small amounts but harmful at high concentrations.',
    sources: 'Copper in tap water almost always comes from copper household plumbing, not from the source water. Acidic or low-pH water is more corrosive and leaches more copper from pipes. Copper plumbing is very common in homes built after the 1960s.',
    whatToDo: 'Run cold water for 30 seconds before drinking if water has stood in pipes. Use cold water for drinking and cooking (hot water dissolves more copper). If levels are high, consider an NSF/ANSI 53-certified filter. Proper pH adjustment by the utility is the main long-term fix.',
  },
  'chromium': {
    name: 'Chromium', code: '0005', mcl: 0.1, unit: 'mg/L', cat: 'Inorganic',
    health: 'The EPA MCL covers total chromium. Trivalent chromium (Cr-III) is an essential nutrient at low levels. Hexavalent chromium (Cr-VI) is a probable human carcinogen and can cause allergic dermatitis and respiratory problems. Made famous by the Erin Brockovich case in Hinkley, CA.',
    sources: 'Chromium occurs naturally in rock and soil. Cr-VI is also discharged from electroplating operations, leather tanning, and industrial cooling towers. Natural deposits are found across the West; industrial contamination is site-specific.',
    whatToDo: 'Standard carbon filters do not effectively remove hexavalent chromium. Use a reverse osmosis or ion exchange filter rated for chromium removal. Community water systems are required to test and treat for total chromium.',
  },
  'barium': {
    name: 'Barium', code: '0003', mcl: 2, unit: 'mg/L', cat: 'Inorganic',
    health: 'Short-term exposure above the MCL can cause muscle weakness, swelling in the brain, and damage to the heart, liver, and kidneys. Long-term exposure is associated with elevated blood pressure.',
    sources: 'Barium occurs naturally in rock formations and is used industrially in drilling muds, paint, glass, and rubber. It enters water through natural dissolution from rock and from industrial discharges.',
    whatToDo: 'Ion exchange or reverse osmosis filters can reduce barium levels. Check your utility\'s Consumer Confidence Report for measured levels. Contact your utility if you have concerns.',
  },
  'cadmium': {
    name: 'Cadmium', code: '0004', mcl: 0.005, unit: 'mg/L', cat: 'Inorganic',
    health: 'Kidney damage from long-term exposure. Cadmium accumulates in the body over time. High short-term levels cause nausea and vomiting. Cadmium is a probable human carcinogen.',
    sources: 'Enters water from corrosion of galvanized pipes (cadmium is an impurity in zinc), discharge from metal refineries, and runoff from hazardous waste sites and fields treated with phosphate fertilizers.',
    whatToDo: 'Replace galvanized pipes if possible. Use a reverse osmosis or distillation filter. Run water before drinking if pipes are old. Cadmium violations are relatively rare in community water systems.',
  },
  'selenium': {
    name: 'Selenium', code: '0010', mcl: 0.05, unit: 'mg/L', cat: 'Inorganic',
    health: 'Selenium is an essential trace element, but at high levels causes selenosis: hair and fingernail loss, numbness in fingers and toes, circulatory problems, and possible nerve damage.',
    sources: 'Occurs naturally in certain soils and rock. High natural levels are found in the Great Plains and interior West. Also enters water from mining operations, oil refineries, and agricultural drainage.',
    whatToDo: 'Reverse osmosis and distillation are effective at reducing selenium. Ion exchange filters also work. Check your utility\'s Consumer Confidence Report.',
  },
  'mercury': {
    name: 'Mercury', code: '0007', mcl: 0.002, unit: 'mg/L', cat: 'Heavy Metal',
    health: 'Kidney damage from long-term exposure to inorganic mercury in drinking water. Mercury is best known for neurological effects from methylmercury in fish, but inorganic mercury in drinking water primarily affects the kidneys.',
    sources: 'Enters water from industrial waste discharge, natural deposits, landfills, and cropland runoff. Coal-fired power plants and chlor-alkali plants are major industrial sources.',
    whatToDo: 'Reverse osmosis or granular activated carbon filters can reduce inorganic mercury. Mercury violations in public water systems are very rare.',
  },
  'thallium': {
    name: 'Thallium', code: '0016', mcl: 0.002, unit: 'mg/L', cat: 'Inorganic',
    health: 'Long-term exposure above the MCL causes hair loss, changes in blood and kidneys, intestines, and liver. Thallium is highly toxic; acute high-level exposure can be fatal.',
    sources: 'Enters water from leaching at ore-processing sites and from electrical, glass, and pharmaceutical industries. Thallium contamination in water is rare but has occurred near mining operations.',
    whatToDo: 'Reverse osmosis and activated alumina are the most effective treatment methods. Thallium violations in public water systems are very rare.',
  },
  'antimony': {
    name: 'Antimony', code: '0012', mcl: 0.006, unit: 'mg/L', cat: 'Inorganic',
    health: 'Long-term exposure above the MCL can increase blood cholesterol and decrease blood sugar. Short-term exposure at high levels causes nausea, vomiting, and diarrhea.',
    sources: 'Occurs naturally and enters water from petroleum refinery discharge, fire retardants manufacturing, ceramics production, and natural deposits.',
    whatToDo: 'Reverse osmosis and coagulation/filtration are effective treatment methods. Antimony violations in public water systems are uncommon.',
  },
  'beryllium': {
    name: 'Beryllium', code: '0013', mcl: 0.004, unit: 'mg/L', cat: 'Inorganic',
    health: 'Long-term exposure may cause intestinal lesions. Beryllium is a probable human carcinogen. Inhalation of beryllium dust is more concerning than ingestion, but the MCL protects against drinking water exposure.',
    sources: 'Enters water from discharge of metal refineries, coal-burning factories, and electrical, aerospace, and defense industries. Also occurs naturally in some rock.',
    whatToDo: 'Reverse osmosis and activated alumina filtration can reduce beryllium. Beryllium violations in public water systems are very rare.',
  },
  'cyanide': {
    name: 'Cyanide', code: '0014', mcl: 0.2, unit: 'mg/L', cat: 'Inorganic',
    health: 'Short-term exposure above the MCL can cause rapid breathing, tremors, and other nervous system effects. Long-term exposure can cause nerve damage and thyroid problems.',
    sources: 'Enters water from discharge of steel and plastics factories and from fertilizer production. Cyanide is used in gold mining (heap leaching) and can contaminate water near mining sites.',
    whatToDo: 'Reverse osmosis and chlorination can effectively remove cyanide from water. Activated carbon filters may help. Cyanide violations are uncommon but do occur in industrial areas.',
  },
  'nickel': {
    name: 'Nickel', code: '0015', mcl: 0.1, unit: 'mg/L', cat: 'Inorganic',
    health: 'Can cause allergic dermatitis in sensitive individuals. Long-term exposure above the MCL may cause damage to the heart and liver. Some animal studies suggest possible cancer risk.',
    sources: 'Occurs naturally in soil and groundwater. Also enters water from metal industries, mining operations, and sewage discharge. Can leach from stainless steel pipes and fittings.',
    whatToDo: 'Reverse osmosis and ion exchange filters can reduce nickel levels. Nickel violations in community water systems are rare.',
  },
  'iron': {
    name: 'Iron', code: '1028', mcl: null, unit: 'mg/L', cat: 'Secondary Standard',
    health: 'Iron has no federal primary health-based MCL but is regulated under secondary standards for aesthetics. High iron gives water a metallic taste, rusty or orange-brown color, and stains laundry and fixtures. Elevated iron can encourage bacterial growth in distribution pipes.',
    sources: 'Iron occurs naturally and is very common in groundwater, especially in regions with iron-bearing rock or soil. It also enters water from corrosion of iron and steel pipes in distribution systems and home plumbing.',
    whatToDo: 'An iron filter (oxidizing or greensand filter), water softener, or whole-house sediment filter can help reduce iron. If you see rust-colored water suddenly, contact your water utility, as this may indicate pipe damage.',
  },
  'manganese': {
    name: 'Manganese', code: '1032', mcl: null, unit: 'mg/L', cat: 'Secondary Standard',
    health: 'No federal primary MCL, but the EPA recommends keeping levels below 0.3 mg/L and has a secondary standard of 0.05 mg/L for aesthetics. Emerging research suggests long-term exposure above 0.3 mg/L may affect neurological development in children and infants.',
    sources: 'Manganese occurs naturally in soil and rock and is common in groundwater, especially in low-oxygen conditions. It also enters water from industrial discharge and natural sediment disturbance.',
    whatToDo: 'Oxidation followed by filtration is the most effective treatment. Water softeners can help but are not ideal for manganese. Contact your utility if concerned. The EPA is evaluating whether to establish a primary health-based MCL.',
  },
  'total-coliform': {
    name: 'Total Coliform', code: '2050', mcl: 0, unit: 'presence', cat: 'Microbial',
    health: 'Total coliform bacteria are used as an indicator of water quality. Their presence may indicate contamination with human or animal fecal material that could contain disease-causing organisms, leading to stomach and intestinal illness.',
    sources: 'Coliform bacteria are naturally present in the environment and in animal digestive systems. They enter water from surface water runoff, treatment failures, and distribution system contamination (main breaks, pressure losses).',
    whatToDo: 'If your utility has issued a boil water notice, boil water vigorously for 1 minute before drinking or use bottled water. If a violation was reported but no boil notice issued, contact your utility to understand the specific situation.',
  },
  'e-coli': {
    name: 'E. coli', code: '2049', mcl: 0, unit: 'presence', cat: 'Microbial',
    health: 'E. coli is a fecal indicator organism. Its presence indicates direct fecal contamination and is a serious health concern. E. coli can cause severe gastrointestinal illness and certain strains (like O157:H7) can cause kidney failure, especially in children.',
    sources: 'Enters water from human sewage, animal waste, and stormwater runoff. Detection indicates a treatment failure, damaged distribution pipes, or contaminated source water. E. coli violations require immediate public notification.',
    whatToDo: 'Follow any boil water advisory or "do not drink" notice immediately. Use bottled water until the advisory is lifted. E. coli violations require corrective action and are among the most serious water quality events.',
  },
  'turbidity': {
    name: 'Turbidity', code: '0700', mcl: 0.3, unit: 'NTU', cat: 'Physical',
    health: 'High turbidity (cloudiness) can interfere with disinfection by allowing pathogens to hide behind particles. While not a direct health hazard, a turbidity violation indicates the filtration system may not be working properly, potentially allowing Giardia, Cryptosporidium, and viruses to pass through.',
    sources: 'Caused by suspended particles including sediment, algae, and organic matter from natural erosion, stormwater runoff, or disturbance of sediment in distribution pipes. Surface water systems are especially susceptible after heavy rain.',
    whatToDo: 'Turbidity violations usually trigger a boil water advisory. Follow any advisory issued by your utility. To remove turbidity at home, use a sediment filter or reverse osmosis system. A 1 NTU limit applies generally; filtered systems must meet 0.3 NTU.',
  },
  'trihalomethanes': {
    name: 'Total Trihalomethanes (TTHMs)', code: '2950', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct',
    health: 'TTHMs form when chlorine reacts with naturally occurring organic matter in water. Long-term exposure is linked to increased risk of bladder cancer, and some studies associate high levels with reproductive problems and miscarriage risk.',
    sources: 'TTHMs are not found in nature; they are created during the water treatment process. Levels are higher in surface water systems and in summer months when organic matter and water temperatures are highest.',
    whatToDo: 'Activated carbon filters (NSF/ANSI 53 certified) and reverse osmosis reduce TTHMs. Refrigerating water in an open pitcher can also help dissipate them. Boiling water does not remove TTHMs and may concentrate them.',
  },
  'haloacetic-acids': {
    name: 'Haloacetic Acids (HAA5)', code: '2456', mcl: 0.060, unit: 'mg/L', cat: 'Disinfection Byproduct',
    health: 'Five haloacetic acids that form as byproducts of chlorination, similar to TTHMs. Long-term exposure is associated with increased cancer risk. Some studies suggest reproductive effects at high levels.',
    sources: 'Formed during water chlorination when chlorine reacts with organic matter. Levels vary seasonally, are higher in summer, and are highest in systems treating surface water with high organic content.',
    whatToDo: 'Activated carbon filters and reverse osmosis can reduce HAA5 levels. Point-of-use filters at the kitchen tap are practical. Check your Consumer Confidence Report for annual average levels.',
  },
  'chloramine': {
    name: 'Chloramines', code: '4010', mcl: 4, unit: 'mg/L', cat: 'Disinfectant',
    health: 'At normal disinfectant levels, chloramines are not a significant health risk for most people. High levels (above the MCL) can cause eye and nose irritation and stomach discomfort. People on kidney dialysis must use special water treatment since chloramines can enter the bloodstream through dialysis.',
    sources: 'Chloramines are added intentionally to disinfect water and to maintain a longer-lasting residual than free chlorine. Formed by reacting chlorine with ammonia. Many utilities use chloramine to reduce TTHM and HAA5 formation.',
    whatToDo: 'No action needed at permitted levels for the general public. If you are on kidney dialysis, notify your provider about your water treatment type. Whole-house carbon filters can reduce chloramine for sensitive individuals.',
  },
  'chlorine': {
    name: 'Chlorine', code: '4020', mcl: 4, unit: 'mg/L', cat: 'Disinfectant',
    health: 'Chlorine at levels used for disinfection is generally considered safe. Above the MCL, it can cause eye and nose irritation and stomach discomfort. Chlorine taste and odor is an aesthetic complaint, not typically a health concern at permitted levels.',
    sources: 'Chlorine is added intentionally to drinking water to kill bacteria, viruses, and other pathogens. It is the most widely used drinking water disinfectant in the US and has dramatically reduced waterborne disease since its introduction in the early 1900s.',
    whatToDo: 'Chlorine smell and taste can be reduced by using an activated carbon filter or by refrigerating water in an open pitcher. No health action is needed at permitted levels. An MCL violation for chlorine means the utility overdosed, which is unusual.',
  },
  'chlorine-dioxide': {
    name: 'Chlorine Dioxide', code: '4030', mcl: 0.8, unit: 'mg/L', cat: 'Disinfectant',
    health: 'Short-term exposure above the MCL can cause nervous system effects and anemia in infants and young children. Chlorine dioxide and its byproduct chlorite are regulated because of these concerns.',
    sources: 'Chlorine dioxide is used as an alternative disinfectant, particularly by systems that want to avoid TTHM and HAA5 formation. It is generated on-site at treatment plants.',
    whatToDo: 'If your utility has a chlorine dioxide violation, contact them for details. Reverse osmosis can reduce chlorine dioxide and its byproducts. Such violations are uncommon and typically indicate a dosing problem at the treatment plant.',
  },
  'radium': {
    name: 'Combined Radium', code: '7000', mcl: 5, unit: 'pCi/L', cat: 'Radionuclide',
    health: 'Long-term exposure to radium above the MCL increases the risk of bone cancer. Radium is a naturally occurring radioactive element that accumulates in bone tissue because it mimics calcium. It decays and produces radon gas.',
    sources: 'Radium occurs naturally in certain rock formations (granite, sandstone) and dissolves into groundwater. Most commonly found in deep groundwater in the Midwest, South, and New England. Rare in surface water systems.',
    whatToDo: 'Reverse osmosis and ion exchange (water softeners) effectively reduce radium. Point-of-use RO filters at the kitchen tap are practical for drinking water. Radium violations are most common in small community systems and private wells in affected regions.',
  },
  'uranium': {
    name: 'Uranium', code: '7500', mcl: 0.030, unit: 'mg/L', cat: 'Radionuclide',
    health: 'Uranium causes kidney toxicity and increases cancer risk with long-term exposure. It is both a chemical toxin (damaging kidneys) and a source of radiation (alpha particle emission). The MCL was set primarily based on kidney toxicity.',
    sources: 'Uranium occurs naturally in certain rock and soil formations and dissolves into groundwater. Most common in the West (Colorado, Wyoming, South Dakota), New England, and parts of the Midwest.',
    whatToDo: 'Reverse osmosis and ion exchange are effective at reducing uranium. If your community system has violations, contact your utility. Private well users in uranium-prone areas should test their water.',
  },
  'gross-alpha': {
    name: 'Gross Alpha Activity', code: '5000', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide',
    health: 'A measure of total radioactivity from alpha-emitting particles, primarily naturally occurring radionuclides like radium-226 and thorium. Long-term exposure above 15 pCi/L increases cancer risk.',
    sources: 'Alpha radiation in groundwater comes from naturally occurring radioactive materials in rock and soil, mainly radium, uranium, and thorium. Found most often in areas with granite or uranium-bearing rock.',
    whatToDo: 'Reverse osmosis and distillation can reduce gross alpha activity. Ask your utility which specific radionuclides are elevated. Additional testing is usually required to identify the specific radioactive compounds.',
  },
  'benzene': {
    name: 'Benzene', code: '2976', mcl: 0.005, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Benzene is a known human carcinogen. Long-term exposure causes leukemia and anemia by damaging bone marrow. It also suppresses the immune system. There is no known safe level of benzene exposure.',
    sources: 'Benzene enters water from gasoline and crude oil spills, underground storage tank leaks, industrial discharge, and natural gas operations. It is a key component of gasoline and a widely used industrial solvent.',
    whatToDo: 'Activated carbon filters and reverse osmosis effectively remove benzene. If your utility has benzene violations, use bottled water or a certified filter for drinking. Violations can occur from fuel spills or industrial contamination near water sources.',
  },
  'trichloroethylene': {
    name: 'Trichloroethylene (TCE)', code: '2996', mcl: 0.005, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'TCE is a likely human carcinogen associated with kidney cancer, liver cancer, and non-Hodgkin lymphoma. It can also cause liver, kidney, and nervous system damage. TCE is one of the most common groundwater contaminants at Superfund sites.',
    sources: 'TCE was widely used as a metal degreaser in manufacturing and by the military. Commonly found at former military bases, manufacturing facilities, and dry cleaning sites. It readily leaches from contaminated soil into groundwater.',
    whatToDo: 'Activated carbon filters and air stripping effectively remove TCE. Reverse osmosis also works. Homes near contaminated industrial sites or military bases may be at heightened risk. Contact your utility if you suspect TCE contamination.',
  },
  'tetrachloroethylene': {
    name: 'Tetrachloroethylene (PCE/PERC)', code: '2990', mcl: 0.005, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'PCE is a probable human carcinogen associated with increased risk of bladder cancer, non-Hodgkin lymphoma, and multiple myeloma. Long-term exposure also causes liver and kidney damage and neurological effects.',
    sources: 'The primary source is dry cleaning operations. PCE has been widely used in dry cleaning since the 1950s. It leaches readily from contaminated soil into groundwater. Also used as a metal degreaser in industrial settings.',
    whatToDo: 'Activated carbon filters and reverse osmosis effectively remove PCE. People living near dry cleaning facilities or industrial areas should be especially aware. Check your utility\'s Consumer Confidence Report and contact them if concerned.',
  },
  'vinyl-chloride': {
    name: 'Vinyl Chloride', code: '1022', mcl: 0.002, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Vinyl chloride is a known human carcinogen, causing liver cancer (hepatic angiosarcoma) with long-term exposure. It has one of the lowest MCLs of common VOCs in drinking water, reflecting its high carcinogenic potency.',
    sources: 'Enters water from the breakdown of other chlorinated solvents (TCE, PCE) in groundwater, and from discharge of plastics factories and chemical plants. Under normal conditions, PVC pipes do not release vinyl chloride into water.',
    whatToDo: 'Activated carbon filtration and aeration effectively remove vinyl chloride. Reverse osmosis also works. Violations are uncommon but occur at sites with TCE/PCE contamination that has undergone natural breakdown.',
  },
  'methylene-chloride': {
    name: 'Methylene Chloride', code: '2984', mcl: 0.005, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Long-term exposure causes liver damage and increased cancer risk. Methylene chloride metabolizes in the body to carbon monoxide, which can cause adverse cardiovascular effects.',
    sources: 'Used as a paint stripper, metal degreaser, and pharmaceutical manufacturing solvent. Enters water from industrial discharge and improper waste disposal near water sources.',
    whatToDo: 'Activated carbon and reverse osmosis can remove methylene chloride. Violations in public water systems are uncommon.',
  },
  'toluene': {
    name: 'Toluene', code: '2991', mcl: 1.0, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Long-term exposure above the MCL can cause nervous system, kidney, or liver problems. Pregnant women exposed to high levels may have children with developmental problems.',
    sources: 'Found in gasoline and used as an industrial solvent in paints, lacquers, and adhesives. Enters water from fuel spills, underground storage tank leaks, and industrial discharge.',
    whatToDo: 'Activated carbon filters are effective at removing toluene. Toluene has a relatively high MCL (1 mg/L) and violations are uncommon; most occur near fuel or industrial spills near wellfields.',
  },
  'xylenes': {
    name: 'Xylenes (Total)', code: '2959', mcl: 10, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Long-term exposure above the MCL may cause nervous system damage. Short-term exposure can cause irritation of the eyes, nose, and throat, dizziness, and headaches.',
    sources: 'Xylenes are components of gasoline and are used as industrial solvents. They enter water from petroleum product spills, underground storage tank leaks, and industrial discharge.',
    whatToDo: 'Activated carbon filtration is effective at removing xylenes. Xylenes have a relatively high MCL (10 mg/L) and violations are uncommon in community water systems.',
  },
  'ethylbenzene': {
    name: 'Ethylbenzene', code: '2987', mcl: 0.7, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Long-term exposure above the MCL may cause liver or kidney effects. Animal studies suggest possible carcinogenic effects. Classified as a possible human carcinogen.',
    sources: 'Found in gasoline and used as a solvent in manufacturing. Enters water from petroleum product spills, underground storage tank leaks, and industrial discharge.',
    whatToDo: 'Activated carbon filtration is effective. Ethylbenzene has a relatively high MCL and violations are uncommon in community water systems.',
  },
  'styrene': {
    name: 'Styrene', code: '2989', mcl: 0.1, unit: 'mg/L', cat: 'Volatile Organic',
    health: 'Long-term exposure above the MCL may cause liver, kidney, and circulatory system effects. Styrene is a possible human carcinogen based on animal studies.',
    sources: 'An industrial monomer used to make plastics (polystyrene) and rubber. Enters water from discharge of rubber, plastics, and resin factories, and from fuel spills.',
    whatToDo: 'Activated carbon and reverse osmosis can remove styrene. Styrene violations in community water systems are relatively uncommon.',
  },
  'chloroform': {
    name: 'Chloroform', code: '2968', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct',
    health: 'Chloroform is the most common trihalomethane (THM) in drinking water. Long-term exposure is linked to liver damage and increased cancer risk. It is regulated as part of the total trihalomethane (TTHM) limit.',
    sources: 'Chloroform forms during water chlorination when chlorine reacts with naturally occurring organic matter. It is a treatment byproduct, not a source contaminant. Levels are highest in surface water systems in summer.',
    whatToDo: 'Activated carbon filters (NSF/ANSI 53 certified) and reverse osmosis effectively remove chloroform. As part of the TTHM group, reducing total disinfection byproducts is the primary goal.',
  },
  'atrazine': {
    name: 'Atrazine', code: '2010', mcl: 0.003, unit: 'mg/L', cat: 'Pesticide',
    health: 'Long-term exposure above the MCL can cause cardiovascular problems and reproductive system issues. Animal studies suggest possible cancer risk. Atrazine is one of the most commonly detected herbicides in US drinking water.',
    sources: 'One of the most widely applied herbicides in the US, used primarily on corn. Enters water through agricultural runoff and is highly persistent. Levels are highest in spring after application and in Midwestern agricultural watersheds.',
    whatToDo: 'Activated carbon and reverse osmosis effectively remove atrazine. Levels tend to spike seasonally after application. Check your utility\'s Consumer Confidence Report for average annual levels versus seasonal peaks.',
  },
  'alachlor': {
    name: 'Alachlor', code: '2005', mcl: 0.002, unit: 'mg/L', cat: 'Pesticide',
    health: 'Long-term exposure above the MCL can cause eye, liver, kidney, or spleen problems, and anemia. Alachlor is a probable human carcinogen.',
    sources: 'A widely used herbicide on corn and soybeans. Enters water through agricultural runoff. Detected in surface water and shallow groundwater in the Corn Belt, especially in the Midwest.',
    whatToDo: 'Activated carbon and reverse osmosis can reduce alachlor. Violations are most common in surface water systems in the Midwest during spring runoff.',
  },
  'carbofuran': {
    name: 'Carbofuran', code: '2020', mcl: 0.04, unit: 'mg/L', cat: 'Pesticide',
    health: 'Can cause problems with blood, the nervous system, and the reproductive system. Carbofuran inhibits acetylcholinesterase and is highly toxic to birds as well as mammals.',
    sources: 'A soil fumigant and insecticide used on rice, alfalfa, corn, and potatoes. Most uses were cancelled by the EPA in 2009 due to environmental and health concerns. Still found in groundwater from historical use.',
    whatToDo: 'Activated carbon and reverse osmosis can reduce carbofuran. Violations are increasingly rare as its use has been phased out in the US.',
  },
  'glyphosate': {
    name: 'Glyphosate', code: '2039', mcl: 0.7, unit: 'mg/L', cat: 'Pesticide',
    health: 'Long-term exposure above the MCL may cause kidney problems and reproductive difficulties. The MCL has a significant safety margin above levels that cause effects in animal studies. The carcinogenic classification of glyphosate is debated among regulatory agencies.',
    sources: 'Glyphosate (the active ingredient in Roundup) is the most widely used herbicide in the world. It enters water from agricultural runoff. Residues are found in some surface water, especially in agricultural areas.',
    whatToDo: 'MCL exceedances are uncommon in community water systems. Activated carbon and reverse osmosis can reduce glyphosate levels if concerned.',
  },
  'pcbs': {
    name: 'Polychlorinated Biphenyls (PCBs)', code: '2383', mcl: 0.0005, unit: 'mg/L', cat: 'Synthetic Organic',
    health: 'PCBs are probable human carcinogens and can harm the immune, reproductive, nervous, and endocrine systems. They accumulate in fatty tissue. Children exposed in utero may have lower IQ and developmental problems.',
    sources: 'Industrial chemicals used in electrical equipment and other applications until they were banned in 1979. They persist in the environment for decades and enter water from contaminated industrial sites, hazardous waste, and sediment disturbance.',
    whatToDo: 'Activated carbon and reverse osmosis can remove PCBs. Violations in public water systems are uncommon but can occur near former industrial sites or in areas with contaminated sediment.',
  },
  'chlordane': {
    name: 'Chlordane', code: '2380', mcl: 0.002, unit: 'mg/L', cat: 'Pesticide',
    health: 'Long-term exposure may cause liver problems, nervous system damage, and increased cancer risk. Chlordane is a persistent organic pollutant that accumulates in the food chain and in fatty tissue.',
    sources: 'Widely used as a termiticide in homes until it was banned in 1988. Can leach from soil into groundwater near treated structures and persist for decades.',
    whatToDo: 'Activated carbon filtration and reverse osmosis can reduce chlordane. Violations in public water supplies are very rare; it is more of a concern for private wells near homes treated before 1988.',
  },
  'dioxin': {
    name: 'Dioxin (2,3,7,8-TCDD)', code: '2065', mcl: 0.00000003, unit: 'mg/L', cat: 'Synthetic Organic',
    health: 'Dioxin is one of the most toxic substances known. It causes reproductive difficulties and is a known human carcinogen at very low doses. Its MCL of 0.00000003 mg/L (30 parts per quadrillion) is the lowest MCL set by the EPA for any contaminant.',
    sources: 'A byproduct of industrial processes including burning of chlorinated materials, chemical manufacturing, and paper bleaching. Enters water from industrial discharge and contaminated runoff.',
    whatToDo: 'Dioxin violations in public water systems are extremely rare. Activated carbon filtration can reduce dioxin levels. If you are concerned about dioxin near an industrial site, contact your state environmental agency.',
  },
  'aldicarb': {
    name: 'Aldicarb', code: '2300', mcl: 0.003, unit: 'mg/L', cat: 'Pesticide',
    health: 'Aldicarb is one of the most acutely toxic pesticides. It inhibits acetylcholinesterase, causing nervous system effects: nausea, sweating, dizziness, weakness, and in severe cases seizures. Long-term lower-level exposure causes similar nervous system effects.',
    sources: 'A carbamate insecticide applied to cotton, potatoes, and other crops. It is highly water-soluble and leaches readily into groundwater. Many states have banned or restricted its use.',
    whatToDo: 'Reverse osmosis and activated carbon can reduce aldicarb. Many states have standards stricter than the federal MCL. Violations are most common in sandy-soil agricultural areas where it was heavily applied.',
  },
  'dbcp': {
    name: 'DBCP (1,2-Dibromo-3-chloropropane)', code: '2210', mcl: 0.0002, unit: 'mg/L', cat: 'Pesticide',
    health: 'DBCP is a probable human carcinogen. It caused sterility in male workers who handled it and may cause reproductive harm at lower levels. Also associated with liver and kidney damage.',
    sources: 'A soil fumigant banned in the 1970s after causing sterility in factory workers. Residues persist in agricultural groundwater decades after application. Elevated levels are still found in California\'s Central Valley and other former agricultural regions.',
    whatToDo: 'Activated carbon filtration and reverse osmosis can remove DBCP. Private well owners in former pineapple, cotton, or soybean growing areas should test their water. DBCP violations still occur occasionally in California.',
  },
  'edb': {
    name: 'Ethylene Dibromide (EDB)', code: '2214', mcl: 0.00005, unit: 'mg/L', cat: 'Pesticide',
    health: 'EDB is a probable human carcinogen with a very low MCL (0.05 ppb) reflecting its high toxicity. It can cause liver, stomach, and reproductive system problems. Workers exposed to high levels suffered serious neurological damage.',
    sources: 'Was used as a gasoline additive (anti-knock agent) and soil fumigant on crops including soybeans, cotton, and citrus. Banned in 1984. Residues persist in some groundwater supplies near former agricultural or fuel storage areas.',
    whatToDo: 'Activated carbon and reverse osmosis effectively remove EDB. Violations are uncommon but can still occur in former agricultural areas or near old fuel storage sites.',
  },
  'aldrin': {
    name: 'Aldrin', code: '2356', mcl: null, unit: 'mg/L', cat: 'Pesticide',
    health: 'A banned organochlorine pesticide that is highly toxic to humans and wildlife. Accumulates in fatty tissue and the food chain. No current federal MCL exists in drinking water. Health effects include nervous system damage and possible cancer.',
    sources: 'Used as an insecticide on corn and other crops and as a termiticide until it was banned in 1974. Persists in soil for decades. Residues can still be found in some groundwater near former treatment sites.',
    whatToDo: 'Activated carbon and reverse osmosis can remove aldrin. If aldrin is detected in your water, contact your utility or state environmental agency, as this may indicate historical pesticide contamination in your area.',
  },
  '2-4-d': {
    name: '2,4-D', code: '2105', mcl: 0.07, unit: 'mg/L', cat: 'Pesticide',
    health: 'Long-term exposure above the MCL can cause kidney, liver, or adrenal gland problems. 2,4-D is one of the most widely used herbicides in the US and is currently under review by the EPA for potential cancer risk.',
    sources: 'Applied to lawns, crops, and rights-of-way. One of the most widely used herbicides globally. Enters water through agricultural and residential runoff. An active ingredient in many common lawn weedkillers.',
    whatToDo: 'Activated carbon filtration and reverse osmosis can reduce 2,4-D. Violations in community water systems are uncommon but can occur in agricultural regions during spring runoff.',
  },
  'simazine': {
    name: 'Simazine', code: '2107', mcl: 0.004, unit: 'mg/L', cat: 'Pesticide',
    health: 'Simazine is a triazine herbicide similar to atrazine. Long-term exposure above the MCL may cause problems with blood, liver, kidney, and adrenal glands.',
    sources: 'Used to control broadleaf weeds in corn crops, orchards, and on residential lawns. Enters water through agricultural and residential runoff. Detected in surface and groundwater in agricultural areas.',
    whatToDo: 'Activated carbon and reverse osmosis can reduce simazine. Violations are most common in agricultural surface water systems in the spring.',
  },
  'pfas': {
    name: 'PFAS (Per- and Polyfluoroalkyl Substances)', code: null, mcl: 0.000000004, unit: 'mg/L (PFOA/PFOS)', cat: 'Emerging Contaminant',
    health: 'PFAS are a group of thousands of synthetic chemicals used in non-stick cookware, waterproof clothing, food packaging, and firefighting foam. Long-term exposure has been linked to cancer (kidney, testicular), thyroid disease, immune system suppression, reproductive problems, and developmental delays in children. They are called "forever chemicals" because they do not break down in the environment or the human body.',
    sources: 'PFAS contamination in drinking water is primarily linked to military bases and airports using AFFF (aqueous film-forming foam) for fire training, industrial facilities (3M, DuPont/Chemours), and consumer product manufacturing sites. Contaminated sites have been found in all 50 states. PFAS in water can also come from landfill leachate and agricultural use of PFAS-contaminated sewage sludge.',
    whatToDo: 'In April 2024, the EPA finalized the first-ever national drinking water standards for PFAS, setting MCLs of 4 parts per trillion (0.000000004 mg/L) for PFOA and PFOS individually, and 10 ppt for PFNA, PFHxS, and HFPO-DA (GenX). Water utilities have until 2027 to comply. Granular activated carbon (GAC) filtration and reverse osmosis (RO) are the most effective treatment methods for PFAS. Point-of-use RO filters at the kitchen tap are practical for households. Check the EPA\'s PFAS Analytic Tools to find contaminated sites near you.',
  },
  'radon': {
    name: 'Radon', code: null, mcl: null, unit: 'pCi/L', cat: 'Radionuclide',
    health: 'Radon is a naturally occurring radioactive gas that can dissolve into groundwater. When released from tap water during showering or other household uses, it becomes an inhalation hazard. Radon in air is the second leading cause of lung cancer in the US after smoking. Ingested radon (from drinking) is a smaller risk but may contribute to stomach cancer.',
    sources: 'Radon comes from the natural breakdown of uranium in soil and rock. It is most common in groundwater drawn from granite and certain other rock formations. States with elevated radon include New England, Appalachia, Montana, Idaho, and parts of the Southeast. Surface water typically has very low radon levels.',
    whatToDo: 'The EPA has proposed but not finalized an MCL for radon in drinking water. Aeration (running water over air) is very effective at removing radon from tap water. Activated carbon filters also work but concentrate the radon in the filter. If you are concerned about radon in your home\'s air (the bigger risk), contact your state radon office for testing resources.',
  },
  'perchlorate': {
    name: 'Perchlorate', code: null, mcl: 0.000056, unit: 'mg/L', cat: 'Inorganic',
    health: 'Perchlorate interferes with the thyroid gland\'s ability to produce hormones needed for normal metabolism. Children, fetuses, and people with thyroid disorders are most vulnerable. Long-term exposure can cause hypothyroidism and may impair fetal neurodevelopment.',
    sources: 'Perchlorate contamination in drinking water comes from rocket fuel and explosives manufacturing, military installations, fireworks, and airbag inflators. It also occurs naturally in some arid western soils. Contamination is most prevalent in California, Texas, Nevada, and near defense manufacturing sites.',
    whatToDo: 'In 2023, the EPA finalized the first national drinking water standard for perchlorate, setting an MCL of 56 parts per trillion (0.000056 mg/L). Ion exchange and reverse osmosis are effective treatment methods. Water systems have until 2028 to comply with the new standard.',
  },
  'hexavalent-chromium': {
    name: 'Hexavalent Chromium (Chromium-6)', code: '0005', mcl: 0.1, unit: 'mg/L', cat: 'Inorganic',
    health: 'Hexavalent chromium (Cr-VI) is a probable human carcinogen. Long-term exposure through drinking water is associated with increased risk of stomach and other cancers. It can also cause allergic dermatitis, respiratory problems, and kidney damage. Made famous by the Erin Brockovich case in Hinkley, California, where contaminated groundwater from Pacific Gas & Electric caused health problems for residents.',
    sources: 'Cr-VI is discharged from industrial operations including chrome plating, leather tanning, stainless steel production, and cooling towers. It also occurs naturally in some rock formations. Contamination is most common near industrial sites in California, New Jersey, Texas, and other industrial states.',
    whatToDo: 'The current EPA MCL covers total chromium (0.1 mg/L), not specifically Cr-VI. California has its own MCL of 10 ppb for Cr-VI specifically. Reverse osmosis is the most effective treatment for Cr-VI removal. Ion exchange also works. Standard carbon filters are generally not effective against hexavalent chromium.',
  },
};

// Ordered list of slugs for the contaminants listing page
const CONTAMINANT_SLUGS_ORDERED = [
  'lead', 'arsenic', 'nitrate', 'nitrite', 'fluoride', 'copper',
  'trihalomethanes', 'haloacetic-acids', 'e-coli', 'total-coliform', 'turbidity',
  'chromium', 'radium', 'uranium', 'gross-alpha', 'benzene', 'trichloroethylene',
  'tetrachloroethylene', 'vinyl-chloride', 'atrazine', 'chloramine', 'chlorine',
  'barium', 'cadmium', 'selenium', 'iron', 'manganese', 'nickel', 'mercury',
  'thallium', 'antimony', 'beryllium', 'cyanide', 'chloroform', 'methylene-chloride',
  'toluene', 'xylenes', 'ethylbenzene', 'styrene', 'chlordane', 'pcbs', 'dioxin',
  'aldicarb', 'glyphosate', 'atrazine', 'alachlor', 'carbofuran', '2-4-d',
  'simazine', 'dbcp', 'edb', 'aldrin', 'chlorine-dioxide', 'chlordane',
];

const renderContaminantPage = (slug, c) => {
  const mclDisplay = c.mcl === null
    ? 'None (secondary)' : c.mcl === 0
    ? 'Zero tolerance' : `${c.mcl} ${c.unit}`;
  const mclClass = c.mcl === null ? '' : c.mcl === 0 ? 'fact-danger' : '';

  const title    = `${c.name} in Drinking Water: Health Effects &amp; Safety | ClearWater`;
  const titleStr = `${c.name} in Drinking Water: Health Effects & Safety | ClearWater`;
  const desc     = `Learn about ${c.name} in drinking water: EPA limits (MCL), health effects, where it comes from, and what to do if your water has a violation.`;
  const canonical = `${BASE_URL}/contaminant/${slug}`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    'name': titleStr,
    'description': desc,
    'url': canonical,
    'about': {
      '@type': 'Thing',
      'name': c.name,
      'description': c.health,
    },
    'mainEntity': {
      '@type': 'FAQPage',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': `What is the EPA limit for ${c.name} in drinking water?`,
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': c.mcl === null
              ? `There is no federal MCL (Maximum Contaminant Level) for ${c.name}. It is monitored under secondary or unregulated contaminant programs.`
              : c.mcl === 0
              ? `The EPA requires zero detectable ${c.name} in drinking water under the Maximum Contaminant Level Goal (MCLG). Any detectable presence is a violation.`
              : `The EPA Maximum Contaminant Level (MCL) for ${c.name} is ${c.mcl} ${c.unit}.`,
          },
        },
        {
          '@type': 'Question',
          'name': `What are the health effects of ${c.name} in drinking water?`,
          'acceptedAnswer': { '@type': 'Answer', 'text': c.health },
        },
        {
          '@type': 'Question',
          'name': `What should I do if my water has a ${c.name} violation?`,
          'acceptedAnswer': { '@type': 'Answer', 'text': c.whatToDo },
        },
      ],
    },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(titleStr)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="contaminant-hero">
      <div class="container">
        <p class="contaminant-breadcrumb">
          <a href="/">ClearWater</a> &rsaquo;
          <a href="/contaminants">Contaminants</a> &rsaquo;
          ${escHtml(c.name)}
        </p>
        <span class="contaminant-cat-badge">${escHtml(c.cat)}</span>
        <h1 class="contaminant-title">${escHtml(c.name)} in Drinking Water</h1>
        <p class="contaminant-subtitle">EPA limits, health effects, and what to do if your water is affected.</p>
      </div>
    </div>

    <div class="contaminant-content container">

      <div class="fact-bar">
        <div class="fact-item ${mclClass}">
          <div class="fact-label">EPA Limit (MCL)</div>
          <div class="fact-value">${escHtml(mclDisplay)}</div>
          ${c.mcl !== null ? `<div class="fact-note">${escHtml(c.unit)}</div>` : ''}
        </div>
        <div class="fact-item">
          <div class="fact-label">Category</div>
          <div class="fact-value" style="font-size:1rem">${escHtml(c.cat)}</div>
        </div>
        <div class="fact-item">
          <div class="fact-label">Data Source</div>
          <div class="fact-value" style="font-size:0.9rem">EPA SDWIS</div>
          <div class="fact-note">Updated quarterly</div>
        </div>
      </div>

      <div class="contaminant-section">
        <h2>&#129640; Health Effects</h2>
        <p>${escHtml(c.health)}</p>
      </div>

      <div class="contaminant-section">
        <h2>&#128205; Sources in Water</h2>
        <p>${escHtml(c.sources)}</p>
      </div>

      <div class="contaminant-section">
        <h2>&#9989; What To Do</h2>
        <p>${escHtml(c.whatToDo)}</p>
      </div>

      <div class="contaminant-cta">
        <h2>Check your tap water for ${escHtml(c.name)}</h2>
        <p>Search your ZIP code to see if your water system has had ${escHtml(c.name)} violations, plus lead testing results and an overall safety grade.</p>
        <a href="/" class="cta-btn">Search your ZIP code &rarr;</a>
      </div>

      <p style="font-size:13px;color:#94a3b8;text-align:center;margin-top:8px">
        Data from the EPA's <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener" style="color:#64748b">Safe Drinking Water Information System (SDWIS)</a>.
        MCLs reflect minimum federal standards; some contaminants may pose health risks below these thresholds.
      </p>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA's <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
      <div class="footer-states">
        <p class="footer-states-label">All contaminants</p>
        <div class="footer-states-links">
          ${Object.keys(CONTAMINANT_PAGES).map(s =>
            `<a href="/contaminant/${s}">${escHtml(CONTAMINANT_PAGES[s].name)}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
};

const renderContaminantsListPage = () => {
  const title    = 'Drinking Water Contaminants: Health Effects &amp; EPA Limits | ClearWater';
  const titleStr = 'Drinking Water Contaminants: Health Effects & EPA Limits | ClearWater';
  const desc     = 'EPA limits, health effects, and safety information for common drinking water contaminants including lead, arsenic, nitrate, PFAS, and more. Free EPA data.';
  const canonical = `${BASE_URL}/contaminants`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    'name': titleStr,
    'description': desc,
    'url': canonical,
    'about': { '@type': 'Thing', 'name': 'Drinking Water Contaminants' },
  });

  const slugs = Object.keys(CONTAMINANT_PAGES);
  const cardHtml = slugs.map(slug => {
    const c = CONTAMINANT_PAGES[slug];
    const mclTxt = c.mcl === null ? 'No federal MCL' : c.mcl === 0 ? 'Zero tolerance' : `MCL: ${c.mcl} ${c.unit}`;
    return `<a href="/contaminant/${slug}" class="contaminant-card">
      <div class="contaminant-card-name">${escHtml(c.name)}</div>
      <div class="contaminant-card-meta">${escHtml(mclTxt)}</div>
      <span class="contaminant-card-cat">${escHtml(c.cat)}</span>
    </a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(titleStr)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb"><a href="/">ClearWater</a> &rsaquo; Contaminants</p>
        <h1 class="state-page-title">Drinking Water Contaminants</h1>
        <p class="state-page-sub">
          EPA limits, health effects, and safety information for ${slugs.length} regulated and monitored contaminants found in US drinking water.
          Click any contaminant to learn more, then search your ZIP to check your local water.
        </p>
      </div>
    </div>

    <div class="container">
      <div class="contaminants-grid">
        ${cardHtml}
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA's <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
      <div class="footer-states">
        <p class="footer-states-label">Water quality by state</p>
        <div class="footer-states-links">
          ${Object.entries(US_STATES).map(([code, name]) =>
            `<a href="/state/${code.toLowerCase()}">${escHtml(name)}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
};

const handleContaminantPage = (req, res, slug) => {
  const c = CONTAMINANT_PAGES[slug];
  if (!c) {
    res.writeHead(302, { Location: '/contaminants' });
    res.end();
    return;
  }
  const html = renderContaminantPage(slug, c);
  sendHTML(req, res, html);
};

const handleContaminantsList = (req, res) => {
  const html = renderContaminantsListPage();
  sendHTML(req, res, html);
};

// ─── Popular cities for sitemap + footer links ────────────────────
const POPULAR_CITY_PAGES = [
  // AL
  { state:'AL', slug:'birmingham',       name:'Birmingham'       },
  { state:'AL', slug:'montgomery',       name:'Montgomery'       },
  { state:'AL', slug:'huntsville',       name:'Huntsville'       },
  { state:'AL', slug:'mobile',           name:'Mobile'           },
  { state:'AL', slug:'tuscaloosa',       name:'Tuscaloosa'       },
  // AK
  { state:'AK', slug:'anchorage',        name:'Anchorage'        },
  // AZ
  { state:'AZ', slug:'phoenix',          name:'Phoenix'          },
  { state:'AZ', slug:'tucson',           name:'Tucson'           },
  { state:'AZ', slug:'mesa',             name:'Mesa'             },
  { state:'AZ', slug:'chandler',         name:'Chandler'         },
  { state:'AZ', slug:'scottsdale',       name:'Scottsdale'       },
  { state:'AZ', slug:'gilbert',          name:'Gilbert'          },
  { state:'AZ', slug:'glendale',         name:'Glendale'         },
  { state:'AZ', slug:'tempe',            name:'Tempe'            },
  { state:'AZ', slug:'peoria',           name:'Peoria'           },
  // AR
  { state:'AR', slug:'little-rock',      name:'Little Rock'      },
  { state:'AR', slug:'fayetteville',     name:'Fayetteville'     },
  { state:'AR', slug:'fort-smith',       name:'Fort Smith'       },
  // CA
  { state:'CA', slug:'los-angeles',      name:'Los Angeles'      },
  { state:'CA', slug:'san-diego',        name:'San Diego'        },
  { state:'CA', slug:'san-jose',         name:'San Jose'         },
  { state:'CA', slug:'san-francisco',    name:'San Francisco'    },
  { state:'CA', slug:'fresno',           name:'Fresno'           },
  { state:'CA', slug:'sacramento',       name:'Sacramento'       },
  { state:'CA', slug:'long-beach',       name:'Long Beach'       },
  { state:'CA', slug:'oakland',          name:'Oakland'          },
  { state:'CA', slug:'bakersfield',      name:'Bakersfield'      },
  { state:'CA', slug:'anaheim',          name:'Anaheim'          },
  { state:'CA', slug:'riverside',        name:'Riverside'        },
  { state:'CA', slug:'santa-ana',        name:'Santa Ana'        },
  { state:'CA', slug:'irvine',           name:'Irvine'           },
  { state:'CA', slug:'stockton',         name:'Stockton'         },
  { state:'CA', slug:'chula-vista',      name:'Chula Vista'      },
  { state:'CA', slug:'fremont',          name:'Fremont'          },
  { state:'CA', slug:'san-bernardino',   name:'San Bernardino'   },
  { state:'CA', slug:'modesto',          name:'Modesto'          },
  { state:'CA', slug:'fontana',          name:'Fontana'          },
  { state:'CA', slug:'moreno-valley',    name:'Moreno Valley'    },
  { state:'CA', slug:'glendale',         name:'Glendale'         },
  { state:'CA', slug:'oxnard',           name:'Oxnard'           },
  { state:'CA', slug:'huntington-beach', name:'Huntington Beach' },
  { state:'CA', slug:'santa-clarita',    name:'Santa Clarita'    },
  { state:'CA', slug:'garden-grove',     name:'Garden Grove'     },
  { state:'CA', slug:'oceanside',        name:'Oceanside'        },
  { state:'CA', slug:'rancho-cucamonga', name:'Rancho Cucamonga' },
  { state:'CA', slug:'santa-rosa',       name:'Santa Rosa'       },
  { state:'CA', slug:'ontario',          name:'Ontario'          },
  { state:'CA', slug:'elk-grove',        name:'Elk Grove'        },
  { state:'CA', slug:'corona',           name:'Corona'           },
  { state:'CA', slug:'salinas',          name:'Salinas'          },
  { state:'CA', slug:'hayward',          name:'Hayward'          },
  { state:'CA', slug:'torrance',         name:'Torrance'         },
  { state:'CA', slug:'sunnyvale',        name:'Sunnyvale'        },
  { state:'CA', slug:'escondido',        name:'Escondido'        },
  // CO
  { state:'CO', slug:'denver',           name:'Denver'           },
  { state:'CO', slug:'colorado-springs', name:'Colorado Springs' },
  { state:'CO', slug:'aurora',           name:'Aurora'           },
  { state:'CO', slug:'fort-collins',     name:'Fort Collins'     },
  { state:'CO', slug:'lakewood',         name:'Lakewood'         },
  { state:'CO', slug:'thornton',         name:'Thornton'         },
  { state:'CO', slug:'pueblo',           name:'Pueblo'           },
  { state:'CO', slug:'boulder',          name:'Boulder'          },
  // CT
  { state:'CT', slug:'bridgeport',       name:'Bridgeport'       },
  { state:'CT', slug:'new-haven',        name:'New Haven'        },
  { state:'CT', slug:'hartford',         name:'Hartford'         },
  { state:'CT', slug:'stamford',         name:'Stamford'         },
  { state:'CT', slug:'waterbury',        name:'Waterbury'        },
  // DE
  { state:'DE', slug:'wilmington',       name:'Wilmington'       },
  // FL
  { state:'FL', slug:'jacksonville',     name:'Jacksonville'     },
  { state:'FL', slug:'miami',            name:'Miami'            },
  { state:'FL', slug:'tampa',            name:'Tampa'            },
  { state:'FL', slug:'orlando',          name:'Orlando'          },
  { state:'FL', slug:'st-petersburg',    name:'St. Petersburg'   },
  { state:'FL', slug:'hialeah',          name:'Hialeah'          },
  { state:'FL', slug:'tallahassee',      name:'Tallahassee'      },
  { state:'FL', slug:'fort-lauderdale',  name:'Fort Lauderdale'  },
  { state:'FL', slug:'port-st-lucie',    name:'Port St. Lucie'   },
  { state:'FL', slug:'cape-coral',       name:'Cape Coral'       },
  { state:'FL', slug:'pembroke-pines',   name:'Pembroke Pines'   },
  { state:'FL', slug:'hollywood',        name:'Hollywood'        },
  { state:'FL', slug:'miramar',          name:'Miramar'          },
  { state:'FL', slug:'gainesville',      name:'Gainesville'      },
  { state:'FL', slug:'coral-springs',    name:'Coral Springs'    },
  { state:'FL', slug:'clearwater',       name:'Clearwater'       },
  { state:'FL', slug:'palm-bay',         name:'Palm Bay'         },
  { state:'FL', slug:'west-palm-beach',  name:'West Palm Beach'  },
  { state:'FL', slug:'lakeland',         name:'Lakeland'         },
  { state:'FL', slug:'pompano-beach',    name:'Pompano Beach'    },
  // GA
  { state:'GA', slug:'atlanta',          name:'Atlanta'          },
  { state:'GA', slug:'columbus',         name:'Columbus'         },
  { state:'GA', slug:'savannah',         name:'Savannah'         },
  { state:'GA', slug:'athens',           name:'Athens'           },
  { state:'GA', slug:'augusta',          name:'Augusta'          },
  { state:'GA', slug:'macon',            name:'Macon'            },
  // HI
  { state:'HI', slug:'honolulu',         name:'Honolulu'         },
  // ID
  { state:'ID', slug:'boise',            name:'Boise'            },
  { state:'ID', slug:'nampa',            name:'Nampa'            },
  { state:'ID', slug:'meridian',         name:'Meridian'         },
  // IL
  { state:'IL', slug:'chicago',          name:'Chicago'          },
  { state:'IL', slug:'aurora',           name:'Aurora'           },
  { state:'IL', slug:'naperville',       name:'Naperville'       },
  { state:'IL', slug:'joliet',           name:'Joliet'           },
  { state:'IL', slug:'rockford',         name:'Rockford'         },
  { state:'IL', slug:'springfield',      name:'Springfield'      },
  { state:'IL', slug:'elgin',            name:'Elgin'            },
  { state:'IL', slug:'peoria',           name:'Peoria'           },
  // IN
  { state:'IN', slug:'indianapolis',     name:'Indianapolis'     },
  { state:'IN', slug:'fort-wayne',       name:'Fort Wayne'       },
  { state:'IN', slug:'evansville',       name:'Evansville'       },
  { state:'IN', slug:'south-bend',       name:'South Bend'       },
  { state:'IN', slug:'carmel',           name:'Carmel'           },
  // IA
  { state:'IA', slug:'des-moines',       name:'Des Moines'       },
  { state:'IA', slug:'cedar-rapids',     name:'Cedar Rapids'     },
  { state:'IA', slug:'davenport',        name:'Davenport'        },
  // KS
  { state:'KS', slug:'wichita',          name:'Wichita'          },
  { state:'KS', slug:'overland-park',    name:'Overland Park'    },
  { state:'KS', slug:'kansas-city',      name:'Kansas City'      },
  { state:'KS', slug:'topeka',           name:'Topeka'           },
  // KY
  { state:'KY', slug:'louisville',       name:'Louisville'       },
  { state:'KY', slug:'lexington',        name:'Lexington'        },
  // LA
  { state:'LA', slug:'new-orleans',      name:'New Orleans'      },
  { state:'LA', slug:'baton-rouge',      name:'Baton Rouge'      },
  { state:'LA', slug:'shreveport',       name:'Shreveport'       },
  { state:'LA', slug:'lafayette',        name:'Lafayette'        },
  // ME
  { state:'ME', slug:'portland',         name:'Portland'         },
  // MD
  { state:'MD', slug:'baltimore',        name:'Baltimore'        },
  { state:'MD', slug:'frederick',        name:'Frederick'        },
  { state:'MD', slug:'rockville',        name:'Rockville'        },
  // MA
  { state:'MA', slug:'boston',           name:'Boston'           },
  { state:'MA', slug:'worcester',        name:'Worcester'        },
  { state:'MA', slug:'springfield',      name:'Springfield'      },
  { state:'MA', slug:'cambridge',        name:'Cambridge'        },
  { state:'MA', slug:'lowell',           name:'Lowell'           },
  // MI
  { state:'MI', slug:'detroit',          name:'Detroit'          },
  { state:'MI', slug:'grand-rapids',     name:'Grand Rapids'     },
  { state:'MI', slug:'warren',           name:'Warren'           },
  { state:'MI', slug:'sterling-heights', name:'Sterling Heights' },
  { state:'MI', slug:'ann-arbor',        name:'Ann Arbor'        },
  { state:'MI', slug:'lansing',          name:'Lansing'          },
  { state:'MI', slug:'flint',            name:'Flint'            },
  { state:'MI', slug:'dearborn',         name:'Dearborn'         },
  { state:'MI', slug:'livonia',          name:'Livonia'          },
  // MN
  { state:'MN', slug:'minneapolis',      name:'Minneapolis'      },
  { state:'MN', slug:'saint-paul',       name:'Saint Paul'       },
  { state:'MN', slug:'rochester',        name:'Rochester'        },
  { state:'MN', slug:'duluth',           name:'Duluth'           },
  { state:'MN', slug:'bloomington',      name:'Bloomington'      },
  // MS
  { state:'MS', slug:'jackson',          name:'Jackson'          },
  { state:'MS', slug:'gulfport',         name:'Gulfport'         },
  // MO
  { state:'MO', slug:'kansas-city',      name:'Kansas City'      },
  { state:'MO', slug:'st-louis',         name:'St. Louis'        },
  { state:'MO', slug:'springfield',      name:'Springfield'      },
  { state:'MO', slug:'columbia',         name:'Columbia'         },
  { state:'MO', slug:'independence',     name:'Independence'     },
  // MT
  { state:'MT', slug:'billings',         name:'Billings'         },
  { state:'MT', slug:'missoula',         name:'Missoula'         },
  // NE
  { state:'NE', slug:'omaha',            name:'Omaha'            },
  { state:'NE', slug:'lincoln',          name:'Lincoln'          },
  // NV
  { state:'NV', slug:'las-vegas',        name:'Las Vegas'        },
  { state:'NV', slug:'henderson',        name:'Henderson'        },
  { state:'NV', slug:'reno',             name:'Reno'             },
  { state:'NV', slug:'north-las-vegas',  name:'North Las Vegas'  },
  // NH
  { state:'NH', slug:'manchester',       name:'Manchester'       },
  { state:'NH', slug:'nashua',           name:'Nashua'           },
  // NJ
  { state:'NJ', slug:'newark',           name:'Newark'           },
  { state:'NJ', slug:'jersey-city',      name:'Jersey City'      },
  { state:'NJ', slug:'paterson',         name:'Paterson'         },
  { state:'NJ', slug:'elizabeth',        name:'Elizabeth'        },
  { state:'NJ', slug:'trenton',          name:'Trenton'          },
  { state:'NJ', slug:'camden',           name:'Camden'           },
  // NM
  { state:'NM', slug:'albuquerque',      name:'Albuquerque'      },
  { state:'NM', slug:'las-cruces',       name:'Las Cruces'       },
  { state:'NM', slug:'rio-rancho',       name:'Rio Rancho'       },
  { state:'NM', slug:'santa-fe',         name:'Santa Fe'         },
  // NY
  { state:'NY', slug:'new-york-city',    name:'New York City'    },
  { state:'NY', slug:'buffalo',          name:'Buffalo'          },
  { state:'NY', slug:'rochester',        name:'Rochester'        },
  { state:'NY', slug:'yonkers',          name:'Yonkers'          },
  { state:'NY', slug:'syracuse',         name:'Syracuse'         },
  { state:'NY', slug:'albany',           name:'Albany'           },
  // NC
  { state:'NC', slug:'charlotte',        name:'Charlotte'        },
  { state:'NC', slug:'raleigh',          name:'Raleigh'          },
  { state:'NC', slug:'greensboro',       name:'Greensboro'       },
  { state:'NC', slug:'durham',           name:'Durham'           },
  { state:'NC', slug:'winston-salem',    name:'Winston-Salem'    },
  { state:'NC', slug:'fayetteville',     name:'Fayetteville'     },
  { state:'NC', slug:'cary',             name:'Cary'             },
  { state:'NC', slug:'wilmington',       name:'Wilmington'       },
  // ND
  { state:'ND', slug:'fargo',            name:'Fargo'            },
  { state:'ND', slug:'bismarck',         name:'Bismarck'         },
  // OH
  { state:'OH', slug:'columbus',         name:'Columbus'         },
  { state:'OH', slug:'cleveland',        name:'Cleveland'        },
  { state:'OH', slug:'cincinnati',       name:'Cincinnati'       },
  { state:'OH', slug:'toledo',           name:'Toledo'           },
  { state:'OH', slug:'akron',            name:'Akron'            },
  { state:'OH', slug:'dayton',           name:'Dayton'           },
  { state:'OH', slug:'parma',            name:'Parma'            },
  // OK
  { state:'OK', slug:'oklahoma-city',    name:'Oklahoma City'    },
  { state:'OK', slug:'tulsa',            name:'Tulsa'            },
  { state:'OK', slug:'norman',           name:'Norman'           },
  { state:'OK', slug:'broken-arrow',     name:'Broken Arrow'     },
  // OR
  { state:'OR', slug:'portland',         name:'Portland'         },
  { state:'OR', slug:'eugene',           name:'Eugene'           },
  { state:'OR', slug:'salem',            name:'Salem'            },
  { state:'OR', slug:'gresham',          name:'Gresham'          },
  { state:'OR', slug:'hillsboro',        name:'Hillsboro'        },
  { state:'OR', slug:'bend',             name:'Bend'             },
  // PA
  { state:'PA', slug:'philadelphia',     name:'Philadelphia'     },
  { state:'PA', slug:'pittsburgh',       name:'Pittsburgh'       },
  { state:'PA', slug:'allentown',        name:'Allentown'        },
  { state:'PA', slug:'erie',             name:'Erie'             },
  { state:'PA', slug:'reading',          name:'Reading'          },
  { state:'PA', slug:'scranton',         name:'Scranton'         },
  // RI
  { state:'RI', slug:'providence',       name:'Providence'       },
  // SC
  { state:'SC', slug:'columbia',         name:'Columbia'         },
  { state:'SC', slug:'charleston',       name:'Charleston'       },
  { state:'SC', slug:'north-charleston', name:'North Charleston' },
  { state:'SC', slug:'greenville',       name:'Greenville'       },
  // SD
  { state:'SD', slug:'sioux-falls',      name:'Sioux Falls'      },
  { state:'SD', slug:'rapid-city',       name:'Rapid City'       },
  // TN
  { state:'TN', slug:'nashville',        name:'Nashville'        },
  { state:'TN', slug:'memphis',          name:'Memphis'          },
  { state:'TN', slug:'knoxville',        name:'Knoxville'        },
  { state:'TN', slug:'chattanooga',      name:'Chattanooga'      },
  { state:'TN', slug:'clarksville',      name:'Clarksville'      },
  // TX
  { state:'TX', slug:'houston',          name:'Houston'          },
  { state:'TX', slug:'san-antonio',      name:'San Antonio'      },
  { state:'TX', slug:'dallas',           name:'Dallas'           },
  { state:'TX', slug:'austin',           name:'Austin'           },
  { state:'TX', slug:'fort-worth',       name:'Fort Worth'       },
  { state:'TX', slug:'el-paso',          name:'El Paso'          },
  { state:'TX', slug:'arlington',        name:'Arlington'        },
  { state:'TX', slug:'corpus-christi',   name:'Corpus Christi'   },
  { state:'TX', slug:'plano',            name:'Plano'            },
  { state:'TX', slug:'laredo',           name:'Laredo'           },
  { state:'TX', slug:'lubbock',          name:'Lubbock'          },
  { state:'TX', slug:'garland',          name:'Garland'          },
  { state:'TX', slug:'irving',           name:'Irving'           },
  { state:'TX', slug:'amarillo',         name:'Amarillo'         },
  { state:'TX', slug:'grand-prairie',    name:'Grand Prairie'    },
  { state:'TX', slug:'brownsville',      name:'Brownsville'      },
  { state:'TX', slug:'mckinney',         name:'McKinney'         },
  { state:'TX', slug:'frisco',           name:'Frisco'           },
  { state:'TX', slug:'pasadena',         name:'Pasadena'         },
  { state:'TX', slug:'killeen',          name:'Killeen'          },
  { state:'TX', slug:'waco',             name:'Waco'             },
  { state:'TX', slug:'mesquite',         name:'Mesquite'         },
  { state:'TX', slug:'denton',           name:'Denton'           },
  // UT
  { state:'UT', slug:'salt-lake-city',   name:'Salt Lake City'   },
  { state:'UT', slug:'west-valley-city', name:'West Valley City' },
  { state:'UT', slug:'provo',            name:'Provo'            },
  { state:'UT', slug:'west-jordan',      name:'West Jordan'      },
  { state:'UT', slug:'orem',             name:'Orem'             },
  { state:'UT', slug:'st-george',        name:'St. George'       },
  // VT
  { state:'VT', slug:'burlington',       name:'Burlington'       },
  // VA
  { state:'VA', slug:'virginia-beach',   name:'Virginia Beach'   },
  { state:'VA', slug:'norfolk',          name:'Norfolk'          },
  { state:'VA', slug:'chesapeake',       name:'Chesapeake'       },
  { state:'VA', slug:'richmond',         name:'Richmond'         },
  { state:'VA', slug:'newport-news',     name:'Newport News'     },
  { state:'VA', slug:'alexandria',       name:'Alexandria'       },
  { state:'VA', slug:'hampton',          name:'Hampton'          },
  { state:'VA', slug:'roanoke',          name:'Roanoke'          },
  // WA
  { state:'WA', slug:'seattle',          name:'Seattle'          },
  { state:'WA', slug:'spokane',          name:'Spokane'          },
  { state:'WA', slug:'tacoma',           name:'Tacoma'           },
  { state:'WA', slug:'vancouver',        name:'Vancouver'        },
  { state:'WA', slug:'bellevue',         name:'Bellevue'         },
  { state:'WA', slug:'kent',             name:'Kent'             },
  { state:'WA', slug:'everett',          name:'Everett'          },
  { state:'WA', slug:'renton',           name:'Renton'           },
  // WV
  { state:'WV', slug:'charleston',       name:'Charleston'       },
  { state:'WV', slug:'huntington',       name:'Huntington'       },
  // WI
  { state:'WI', slug:'milwaukee',        name:'Milwaukee'        },
  { state:'WI', slug:'madison',          name:'Madison'          },
  { state:'WI', slug:'green-bay',        name:'Green Bay'        },
  { state:'WI', slug:'kenosha',          name:'Kenosha'          },
  { state:'WI', slug:'racine',           name:'Racine'           },
  // WY
  { state:'WY', slug:'cheyenne',         name:'Cheyenne'         },
  { state:'WY', slug:'casper',           name:'Casper'           },
];

// ─── City pages ───────────────────────────────────────────────────
const fetchSystemsForCity = async (stateCode, cityName) => {
  const cacheKey = `city:${stateCode}:${cityName}`;
  const cached = getCached(cacheKey);
  if (cached) { console.log(`[cache hit] ${cacheKey}`); return cached; }

  console.log(`[city] Fetching systems for ${cityName}, ${stateCode}`);
  const encodedCity = encodeURIComponent(cityName);

  let data = await fetchJSON(
    `${EPA_BASE}/WATER_SYSTEM/primacy_agency_code/${stateCode}/city_name/${encodedCity}/pws_activity_code/A/rows/0:50/JSON`,
    20000
  );
  if (!Array.isArray(data) || data.length === 0) {
    data = await fetchJSON(
      `${EPA_BASE}/WATER_SYSTEM/state_code/${stateCode}/city_name/${encodedCity}/pws_activity_code/A/rows/0:50/JSON`,
      20000
    );
  }

  // Third try: broad city_name query (no state filter), then client-side filter.
  // This catches cities where primacy_agency_code doesn't match state abbrev exactly
  // (e.g. San Antonio TX, Philadelphia PA, Fort Worth TX).
  if (!Array.isArray(data) || data.length === 0) {
    const all = await fetchJSON(
      `${EPA_BASE}/WATER_SYSTEM/city_name/${encodedCity}/pws_activity_code/A/rows/0:100/JSON`,
      20000
    );
    if (Array.isArray(all) && all.length > 0) {
      data = all.filter(s =>
        (String(get(s, 'primacy_agency_code') || '')).toUpperCase() === stateCode ||
        (String(get(s, 'state_code')          || '')).toUpperCase() === stateCode
      );
    }
  }

  // Fourth try: title-case city name (e.g. "Seattle" instead of "SEATTLE").
  // Some states store city names in mixed case in the EPA database.
  if (!Array.isArray(data) || data.length === 0) {
    const cityTitle   = cityName.split(' ').map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const encodedTitle = encodeURIComponent(cityTitle);
    let titleData = await fetchJSON(
      `${EPA_BASE}/WATER_SYSTEM/primacy_agency_code/${stateCode}/city_name/${encodedTitle}/pws_activity_code/A/rows/0:50/JSON`,
      20000
    );
    if (!Array.isArray(titleData) || titleData.length === 0) {
      titleData = await fetchJSON(
        `${EPA_BASE}/WATER_SYSTEM/state_code/${stateCode}/city_name/${encodedTitle}/pws_activity_code/A/rows/0:50/JSON`,
        20000
      );
    }
    if (!Array.isArray(titleData) || titleData.length === 0) {
      const all = await fetchJSON(
        `${EPA_BASE}/WATER_SYSTEM/city_name/${encodedTitle}/pws_activity_code/A/rows/0:100/JSON`,
        20000
      );
      if (Array.isArray(all) && all.length > 0) {
        titleData = all.filter(s =>
          (String(get(s, 'primacy_agency_code') || '')).toUpperCase() === stateCode ||
          (String(get(s, 'state_code')          || '')).toUpperCase() === stateCode
        );
      }
    }
    if (Array.isArray(titleData) && titleData.length > 0) data = titleData;
  }

  if (!Array.isArray(data) || data.length === 0) { setCached(cacheKey, []); return []; }

  const seen = new Set();
  const systems = data
    .map(normalizeSystem)
    .filter(s => s.pwsid && !seen.has(s.pwsid) && seen.add(s.pwsid))
    .sort((a, b) => b.population - a.population)
    .slice(0, 30);

  setCached(cacheKey, systems);
  return systems;
};

// Fetch violation summaries for all systems in a city in parallel, return grade map
const fetchViolationsForCity = async (systems) => {
  const results = await Promise.allSettled(
    systems.map(s => fetchJSON(`${EPA_BASE}/VIOLATION/pwsid/${s.pwsid}/rows/0:200/JSON`, 12000))
  );
  const grades = {};
  results.forEach((result, i) => {
    const pwsid = systems[i].pwsid;
    const violations = (result.status === 'fulfilled' && Array.isArray(result.value))
      ? result.value.map(normalizeViolation)
      : [];
    const g = computeGradeServer(violations);
    grades[pwsid] = {
      ...g,
      totalViolations:  violations.length,
      healthViolations: violations.filter(v => v.isHealthBased).length,
    };
  });
  return grades;
};

const renderCityPage = (stateCode, stateName, cityDisplay, citySlug, systems, grades = {}) => {
  const totalPop   = systems.reduce((s, x) => s + x.population, 0);
  const title      = `${cityDisplay}, ${stateName} Tap Water Quality: Safety Report | ClearWater`;
  const desc       = `Free EPA water quality data for ${cityDisplay}, ${stateName}. ${systems.length} water ${systems.length === 1 ? 'utility' : 'utilities'} serving ${totalPop > 0 ? totalPop.toLocaleString() + '+' : 'thousands of'} residents. See violations, lead levels, and a safety grade.`;
  const canonical  = `${BASE_URL}/${stateCode.toLowerCase()}/${citySlug}`;

  const faqItems = [
    {
      q: `Is ${cityDisplay}, ${stateName} tap water safe to drink?`,
      a: `${cityDisplay} has ${systems.length} community water ${systems.length === 1 ? 'system' : 'systems'} regulated by the EPA. Each system is required to test regularly for hundreds of contaminants and publicly report any violations. Click any water system listed above to see its specific violation history, lead test results, and a plain-English safety grade.`,
    },
    {
      q: `How many water utilities serve ${cityDisplay}, ${stateName}?`,
      a: `${systems.length} community water ${systems.length === 1 ? 'system serves' : 'systems serve'} ${cityDisplay}, ${stateName}${totalPop > 0 ? ', providing water to approximately ' + totalPop.toLocaleString() + ' people' : ''}. Different neighborhoods may be served by different utilities. Enter your ZIP code at the top to find your specific provider.`,
    },
    {
      q: `Does ${cityDisplay} tap water have lead?`,
      a: `Lead in drinking water typically enters from old pipes and fixtures inside homes and buildings, not from the treatment plant. The EPA requires water systems to monitor for lead under the Lead and Copper Rule. Click any water system above to see its most recent 90th-percentile lead test results. Homes built before 1986 are most likely to have lead plumbing components.`,
    },
    {
      q: `What contaminants have been found in ${cityDisplay} drinking water?`,
      a: `EPA violation records for ${cityDisplay} water systems are listed on each utility's report page. Common regulated contaminants include disinfection byproducts (TTHMs, HAA5), coliform bacteria, nitrates, and lead. Click any utility above to see its full violation history going back 10 years.`,
    },
    {
      q: `How do I find out which water company serves my address in ${cityDisplay}?`,
      a: `Enter your ${cityDisplay} ZIP code in the search box at the top of this page. ClearWater will identify the specific water system serving your area and show you its EPA violation history, lead test results, and an overall safety grade. You can also check your water bill or your utility's annual Consumer Confidence Report (CCR).`,
    },
  ];

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        'name': title,
        'description': desc,
        'url': canonical,
        'about': {
          '@type': 'Place',
          'name': `${cityDisplay}, ${stateName}`,
          'addressLocality': cityDisplay,
          'addressRegion': stateCode,
          'addressCountry': 'US',
        },
      },
      {
        '@type': 'FAQPage',
        'mainEntity': faqItems.map(f => ({
          '@type': 'Question',
          'name': f.q,
          'acceptedAnswer': { '@type': 'Answer', 'text': f.a },
        })),
      },
    ],
  });

  const cardHtml = systems.map(s => {
    const loc = [s.city, s.state].filter(Boolean).join(', ');
    const pop = s.population > 0 ? `${s.population.toLocaleString()} people` : '';
    const src = SOURCE_LABELS[s.sourceType] || '';
    const g   = grades[s.pwsid];
    const gradeBadge = g
      ? `<span class="ssc-grade ssc-grade-${g.grade.toLowerCase()}">${escHtml(g.grade)}</span>`
      : '';
    let summaryHtml = '';
    if (g) {
      if (g.activeHealth > 0) {
        summaryHtml = `<span class="ssc-summary ssc-summary-warn">&#9888; ${g.activeHealth} active health violation${g.activeHealth > 1 ? 's' : ''}</span>`;
      } else if (g.recentHealth > 0) {
        summaryHtml = `<span class="ssc-summary ssc-summary-caution">${g.recentHealth} health violation${g.recentHealth > 1 ? 's' : ''} in past 5 yrs</span>`;
      } else {
        summaryHtml = `<span class="ssc-summary ssc-summary-ok">&#10003; No recent health violations</span>`;
      }
    }
    return `<a href="/report/${escHtml(s.pwsid)}" class="state-system-card">
      <div class="ssc-top">
        <span class="ssc-name">${escHtml(s.name)}</span>
        ${gradeBadge}
      </div>
      <span class="ssc-meta">${escHtml(loc)}${pop ? ' &middot; ' + escHtml(pop) : ''}${src ? ' &middot; ' + escHtml(src) : ''}</span>
      ${summaryHtml}
    </a>`;
  }).join('\n');

  const faqHtml = faqItems.map((f, i) => `
    <details class="faq-item"${i === 0 ? ' open' : ''}>
      <summary class="faq-q">${escHtml(f.q)}</summary>
      <div class="faq-a"><p>${escHtml(f.a)}</p></div>
    </details>`).join('');

  // Nearby cities from same state for internal linking
  const nearbyCities = POPULAR_CITY_PAGES
    .filter(c => c.state === stateCode && c.slug !== citySlug)
    .slice(0, 8);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb">
          <a href="/">ClearWater</a> &rsaquo;
          <a href="/state/${stateCode.toLowerCase()}">${escHtml(stateName)}</a> &rsaquo;
          ${escHtml(cityDisplay)}
        </p>
        <h1 class="state-page-title">${escHtml(cityDisplay)}, ${escHtml(stateName)} Tap Water Quality</h1>
        <p class="state-page-sub">
          Free EPA data for ${systems.length} community water ${systems.length === 1 ? 'system' : 'systems'}
          ${totalPop > 0 ? `serving ${totalPop.toLocaleString()}+ residents` : `in ${escHtml(cityDisplay)}`}.
          Click any system to see violations, lead test results, and a safety grade.
        </p>
      </div>
    </div>

    <div class="container state-systems-grid" style="padding-top:32px;padding-bottom:0">
      ${cardHtml}
    </div>

    <div class="container" style="max-width:760px;margin:0 auto;padding:16px 24px 0">
      <div class="city-search-cta">
        <p>&#128269; Not sure which system serves your address?</p>
        <a href="/" class="city-search-link">Enter your ZIP code to find your exact water provider &rarr;</a>
      </div>

      <section class="faq-section">
        <h2 class="faq-title">${escHtml(cityDisplay)} Drinking Water: Frequently Asked Questions</h2>
        ${faqHtml}
      </section>

      ${nearbyCities.length > 0 ? `
      <div class="footer-states" style="margin-bottom:32px">
        <p class="footer-states-label">Other cities in ${escHtml(stateName)}</p>
        <div class="footer-states-links">
          ${nearbyCities.map(c => `<a href="/${c.state.toLowerCase()}/${c.slug}">${escHtml(c.name)}</a>`).join('')}
          <a href="/state/${stateCode.toLowerCase()}">All ${escHtml(stateName)} systems &rarr;</a>
        </div>
      </div>` : ''}
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
        ClearWater is an informational tool; contact your utility or the EPA for official data.
      </p>
      <div class="footer-states">
        <p class="footer-states-label">Water quality by state</p>
        <div class="footer-states-links">
          ${Object.entries(US_STATES).map(([code, name]) =>
            `<a href="/state/${code.toLowerCase()}">${escHtml(name)}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
};

const handleCityPage = async (req, res, stateCode, citySlug) => {
  stateCode = stateCode.toUpperCase();
  const stateName = US_STATES[stateCode];
  if (!stateName) { res.writeHead(302, { Location: '/' }); res.end(); return; }

  // Convert slug to display name (spokane → Spokane, los-angeles → Los Angeles)
  const cityDisplay = citySlug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const cityName = citySlug.replace(/-/g, ' ').toUpperCase();

  try {
    const systems = await fetchSystemsForCity(stateCode, cityName);
    if (systems.length === 0) {
      // No systems found - redirect to state page
      res.writeHead(302, { Location: `/state/${stateCode.toLowerCase()}` });
      res.end();
      return;
    }
    const grades = await fetchViolationsForCity(systems);
    const html = renderCityPage(stateCode, stateName, cityDisplay, citySlug, systems, grades);
    sendHTML(req, res, html);
  } catch (err) {
    console.error('[/city]', err.message);
    res.writeHead(302, { Location: `/state/${stateCode.toLowerCase()}` });
    res.end();
  }
};

// ─── Rankings page ────────────────────────────────────────────────
// Notable water quality cases and cities with known issues for link bait + SEO
const NOTABLE_CITIES = [
  { city: 'Flint',          state: 'MI', slug: 'flint',          note: 'Lead crisis 2014-2019; ongoing pipe replacement',    grade: 'F' },
  { city: 'Newark',         state: 'NJ', slug: 'newark',         note: 'Lead action level exceeded 2017-2021',               grade: 'F' },
  { city: 'Pittsburgh',     state: 'PA', slug: 'pittsburgh',     note: 'Elevated lead in older homes; pipe replacement ongoing', grade: 'D' },
  { city: 'Milwaukee',      state: 'WI', slug: 'milwaukee',      note: 'Lead service lines; 1993 Cryptosporidium outbreak',  grade: 'C' },
  { city: 'Baltimore',      state: 'MD', slug: 'baltimore',      note: 'Lead and chemical violations in some systems',       grade: 'C' },
  { city: 'Detroit',        state: 'MI', slug: 'detroit',        note: 'Lead pipe replacement program ongoing',              grade: 'C' },
  { city: 'Benton Harbor',  state: 'MI', slug: 'benton-harbor',  note: 'Exceeded lead action level 2018-2021',               grade: 'F' },
  { city: 'Jackson',        state: 'MS', slug: 'jackson',        note: 'Multiple boil water advisories and pressure failures', grade: 'F' },
  { city: 'Camden',         state: 'NJ', slug: 'camden',         note: 'Multiple health-based violations in recent years',   grade: 'D' },
  { city: 'New Orleans',    state: 'LA', slug: 'new-orleans',    note: 'Aging infrastructure; lead pipe concerns',           grade: 'C' },
  { city: 'Cleveland',      state: 'OH', slug: 'cleveland',      note: 'TTHM violations and lead concerns in older areas',   grade: 'C' },
  { city: 'Fresno',         state: 'CA', slug: 'fresno',         note: 'Arsenic violations in some small systems nearby',    grade: 'C' },
  { city: 'Stockton',       state: 'CA', slug: 'stockton',       note: 'Nitrate violations in surrounding agricultural areas', grade: 'C' },
  { city: 'El Paso',        state: 'TX', slug: 'el-paso',        note: 'TTHM violations in some service areas',              grade: 'C' },
  { city: 'Laredo',         state: 'TX', slug: 'laredo',         note: 'Elevated nitrate levels near agricultural zones',    grade: 'C' },
];

const renderRankingsPage = () => {
  const title    = 'US Cities with Water Quality Concerns: Violations & Safety Grades | ClearWater';
  const desc     = 'Which US cities have had the most water quality violations? See EPA violation records for major cities including Flint, Newark, Pittsburgh, and more.';
  const canonical = `${BASE_URL}/rankings`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    'name': title,
    'description': desc,
    'url': canonical,
  });

  const gradeColor = { F: 'badge-f', D: 'badge-d', C: 'badge-c' };

  const notableHtml = NOTABLE_CITIES.map((c, i) => `
    <a href="/${c.state.toLowerCase()}/${c.slug}" class="rankings-item">
      <span class="rankings-rank">${i + 1}</span>
      <span class="rankings-name">${escHtml(c.city)}, ${escHtml(c.state)}</span>
      <span class="rankings-meta">${escHtml(c.note)}</span>
      <span class="rankings-badge ${gradeColor[c.grade] || ''}">${escHtml(c.grade)}</span>
    </a>`).join('');

  // Contaminant-by-state risk sections
  const contaminantRisk = [
    { name: 'Lead',     emoji: '⚠️', states: 'Michigan, New Jersey, Pennsylvania, Illinois, Maryland', desc: 'Cities with older housing stock and lead service lines are at highest risk. The Lead and Copper Rule requires action when the 90th-percentile sample exceeds 15 ppb.' },
    { name: 'Nitrate',  emoji: '🌾', states: 'Iowa, Illinois, Indiana, Nebraska, Kansas, California (Central Valley)', desc: 'Nitrate from agricultural fertilizer runoff is most common in the Midwest and California\'s agricultural regions. Especially dangerous for infants under 6 months.' },
    { name: 'Arsenic',  emoji: '🏔️', states: 'Arizona, New Mexico, Nevada, California, New England', desc: 'Naturally occurring arsenic in groundwater is highest in the Southwest, parts of the Midwest, and New England. Many small systems exceed the 10 ppb MCL.' },
    { name: 'PFAS',     emoji: '🏭', states: 'Michigan, New Hampshire, North Carolina, Pennsylvania, Colorado', desc: 'PFAS contamination is linked to military bases, fire training facilities, and industrial sites. The EPA set new MCLs for PFOS and PFOA in April 2024.' },
    { name: 'Radium',   emoji: '☢️', states: 'Illinois, Iowa, Wisconsin, Minnesota, Texas', desc: 'Naturally occurring radium in deep groundwater is most common in the Midwest and parts of Texas. Many small systems rely on groundwater with elevated radium levels.' },
  ];

  const riskHtml = contaminantRisk.map(r => `
    <div class="contaminant-section" style="margin-bottom:16px">
      <h2>${r.emoji} ${escHtml(r.name)} Risk</h2>
      <p><strong>Highest risk states:</strong> ${escHtml(r.states)}</p>
      <p style="margin-top:8px">${escHtml(r.desc)}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb"><a href="/">ClearWater</a> &rsaquo; Water Quality Rankings</p>
        <h1 class="state-page-title">US Cities with Water Quality Concerns</h1>
        <p class="state-page-sub">
          Cities with documented EPA violations, notable water safety incidents, or ongoing infrastructure challenges.
          Click any city to see EPA violation records for its water systems.
        </p>
      </div>
    </div>

    <div class="container" style="max-width:900px;margin:0 auto;padding:40px 24px 64px">

      <div class="rankings-section">
        <h2 class="rankings-title">&#9888;&#65039; Cities with Notable Water Quality Issues</h2>
        <ul class="rankings-list">
          ${notableHtml}
        </ul>
        <p style="font-size:13px;color:#94a3b8;margin-top:16px">
          Grades and notes are based on EPA SDWIS records and publicly reported incidents.
          Click any city to see current violation data. Always check your specific water system report for the most accurate information.
        </p>
      </div>

      <div class="rankings-section">
        <h2 class="rankings-title">&#127757; Contaminant Risk by Region</h2>
        ${riskHtml}
      </div>

      <div class="contaminant-cta">
        <h2>Check your city's water quality</h2>
        <p>Enter your ZIP code to see EPA violations, lead test results, and a safety grade for your specific water system.</p>
        <a href="/" class="cta-btn">Search your ZIP code &rarr;</a>
      </div>

      <div class="footer-states" style="margin-top:32px">
        <p class="footer-states-label">Browse by state</p>
        <div class="footer-states-links">
          ${Object.entries(US_STATES).map(([code, name]) =>
            `<a href="/state/${code.toLowerCase()}">${escHtml(name)}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
    </div>
  </footer>
</body>
</html>`;
};

const handleRankingsPage = (req, res) => {
  sendHTML(req, res, renderRankingsPage());
};

// ─── /cities hub page ─────────────────────────────────────────────
const renderCitiesHubPage = () => {
  const title    = 'Browse US Cities: Tap Water Quality by City | ClearWater';
  const desc     = 'Find EPA tap water quality data for every major US city. Browse 300+ cities organized by state — see water safety grades, violations, and lead test results.';
  const canonical = `${BASE_URL}/cities`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        'name': title,
        'description': desc,
        'url': canonical,
      },
      {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'ClearWater', 'item': BASE_URL },
          { '@type': 'ListItem', 'position': 2, 'name': 'All Cities', 'item': canonical },
        ],
      },
    ],
  });

  // Group cities by state code
  const byState = POPULAR_CITY_PAGES.reduce((acc, c) => {
    if (!acc[c.state]) acc[c.state] = [];
    acc[c.state].push(c);
    return acc;
  }, {});

  const stateSections = Object.keys(byState).sort().map(code => {
    const stateName = US_STATES[code] || code;
    const links = byState[code].map(c =>
      `<a href="/${code.toLowerCase()}/${escHtml(c.slug)}">${escHtml(c.name)}</a>`
    ).join('');
    return `
    <div class="cities-hub-section">
      <h2><a href="/state/${code.toLowerCase()}">${escHtml(stateName)}</a></h2>
      <div class="cities-hub-links">${links}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb"><a href="/">ClearWater</a> › All Cities</p>
        <h1 class="state-page-title">Browse US Cities by Water Quality</h1>
        <p class="state-page-sub">
          EPA tap water data for ${POPULAR_CITY_PAGES.length}+ cities across all 50 states.
          Click any city to see water utilities, violation history, and safety grades.
        </p>
      </div>
    </div>

    <div class="container" style="padding-top:32px; padding-bottom:48px">
      ${stateSections}
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
    </div>
  </footer>
</body>
</html>`;
};

const handleCitiesHub = (req, res) => sendHTML(req, res, renderCitiesHubPage());

// ─── Blog / Articles ───────────────────────────────────────────────
const CATEGORY_LABELS = { contaminants: 'Contaminants', guides: 'How-To Guide', states: 'State Guide' };

const renderBlogListPage = () => {
  const title    = 'Water Quality Blog: Guides, Safety Tips & Contaminant Deep-Dives | ClearWater';
  const desc     = 'Expert guides on drinking water safety, contaminants, EPA violations, and how to protect your household. Free resources from ClearWater.';
  const canonical = `${BASE_URL}/blog`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type':    'CollectionPage',
    'name':     title,
    'description': desc,
    'url':      canonical,
  });

  const cardHtml = ARTICLES.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:40px 0">Articles coming soon — check back daily.</p>'
    : ARTICLES.map(a => {
        const catLabel = CATEGORY_LABELS[a.category] || a.category;
        const dateStr  = new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
        return `<a href="/blog/${escHtml(a.slug)}" class="blog-card">
          <span class="blog-card-cat">${escHtml(catLabel)}</span>
          <span class="blog-card-title">${escHtml(a.title)}</span>
          <span class="blog-card-excerpt">${escHtml(a.excerpt)}</span>
          <span class="blog-card-date">${escHtml(dateStr)}</span>
        </a>`;
      }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">Search by ZIP &rarr;</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb"><a href="/">ClearWater</a> › Blog</p>
        <h1 class="state-page-title">Water Quality Blog</h1>
        <p class="state-page-sub">
          Expert guides on drinking water safety, contaminants, EPA violations, and how to protect your household.
          New articles published daily.
        </p>
      </div>
    </div>

    <div class="container">
      <div class="blog-grid">
        ${cardHtml}
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
    </div>
  </footer>
</body>
</html>`;
};

const renderArticlePage = (article) => {
  const catLabel  = CATEGORY_LABELS[article.category] || article.category;
  const dateStr   = new Date(article.date + 'T12:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const canonical = `${BASE_URL}/blog/${article.slug}`;
  const title     = `${article.title} | ClearWater`;

  const jsonLd = JSON.stringify({
    '@context':        'https://schema.org',
    '@type':           'Article',
    'headline':        article.title,
    'description':     article.excerpt,
    'url':             canonical,
    'datePublished':   article.date,
    'dateModified':    article.date,
    'author':          { '@type': 'Organization', 'name': 'ClearWater', 'url': BASE_URL },
    'publisher':       { '@type': 'Organization', 'name': 'ClearWater', 'url': BASE_URL },
    'wordCount':       article.wordCount || 0,
    'articleSection':  catLabel,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(article.excerpt)}">
  <meta property="og:title" content="${escHtml(article.title)}">
  <meta property="og:description" content="${escHtml(article.excerpt)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/blog">&larr; Blog</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="article-header">
      <p class="article-breadcrumb"><a href="/">ClearWater</a> › <a href="/blog">Blog</a> › ${escHtml(catLabel)}</p>
      <p class="article-cat">${escHtml(catLabel)}</p>
      <h1 class="article-title">${escHtml(article.title)}</h1>
      <p class="article-meta">Published ${escHtml(dateStr)}${article.wordCount ? ' &nbsp;·&nbsp; ' + article.wordCount.toLocaleString() + ' words' : ''}</p>
    </div>

    <article class="article-content">
      ${article.content}
    </article>

    <div class="container" style="max-width:740px;padding-bottom:48px">
      <div class="contaminant-cta" style="margin-top:0">
        <div>
          <p class="cta-title">Check Your Tap Water for Free</p>
          <p class="cta-sub">Enter your ZIP code to see EPA violation records, lead test results, and a safety grade for your specific water utility.</p>
        </div>
        <a href="/" class="cta-btn">Check My Water &rarr;</a>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
    </div>
  </footer>
</body>
</html>`;
};

const handleBlogList = (req, res) => sendHTML(req, res, renderBlogListPage());

const handleBlogPost = (req, res, slug) => {
  const article = ARTICLES.find(a => a.slug === slug);
  if (!article) { res.writeHead(302, { Location: '/blog' }); res.end(); return; }
  sendHTML(req, res, renderArticlePage(article));
};

const fetchSystemsForState = async (stateCode) => {
  const cacheKey = `state:${stateCode}`;
  const cached   = getCached(cacheKey);
  if (cached) { console.log(`[cache hit] ${cacheKey}`); return cached; }

  console.log(`[state] Fetching systems for ${stateCode}`);
  const data = await fetchJSON(
    `${EPA_BASE}/WATER_SYSTEM/primacy_agency_code/${stateCode}/pws_activity_code/A/pws_type_code/CWS/rows/0:200/JSON`,
    20000
  );
  if (!Array.isArray(data)) { setCached(cacheKey, []); return []; }

  const seen = new Set();
  const systems = data
    .map(normalizeSystem)
    .filter(s => s.pwsid && s.population > 0 && !seen.has(s.pwsid) && seen.add(s.pwsid))
    .sort((a, b) => b.population - a.population)
    .slice(0, 150);

  setCached(cacheKey, systems);
  return systems;
};

const renderStatePage = (stateCode, stateName, systems) => {
  const title    = `${stateName} Tap Water Quality: Water Systems &amp; Safety Grades | ClearWater`;
  const titleStr = `${stateName} Tap Water Quality: Water Systems & Safety Grades | ClearWater`;
  const desc     = `Find EPA water quality data for ${stateName} water utilities. Search violations, lead & copper test results, and safety grades for ${systems.length}+ water systems.`;
  const canonical = `${BASE_URL}/state/${stateCode.toLowerCase()}`;
  const totalPop  = systems.reduce((s, x) => s + x.population, 0);

  const cardHtml = systems.map(s => {
    const loc = [s.city, s.state].filter(Boolean).join(', ');
    const pop = s.population > 0 ? `${s.population.toLocaleString()} people` : '';
    const src = SOURCE_LABELS[s.sourceType] || '';
    return `<a href="/report/${escHtml(s.pwsid)}" class="state-system-card">
      <span class="ssc-name">${escHtml(s.name)}</span>
      <span class="ssc-meta">${escHtml(loc)}${pop ? ' · ' + escHtml(pop) : ''}${src ? ' · ' + escHtml(src) : ''}</span>
    </a>`;
  }).join('\n');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    'name': titleStr,
    'description': desc,
    'url': canonical,
    'about': { '@type': 'Place', 'name': stateName, 'addressRegion': stateCode },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(titleStr)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ClearWater: Is Your Tap Water Safe? Free EPA water quality lookup.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 3C14 3 5 12 5 17.5a9 9 0 0 0 18 0C23 12 14 3 14 3z" fill="#0ea5e9"/>
        </svg>
        ClearWater
      </a>
      <nav>
        <a class="header-link" href="/">← Search by ZIP</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="state-page-hero">
      <div class="container">
        <p class="state-breadcrumb"><a href="/">ClearWater</a> › All States › ${escHtml(stateName)}</p>
        <h1 class="state-page-title">${escHtml(stateName)} Tap Water Quality</h1>
        <p class="state-page-sub">
          EPA water quality data for ${systems.length} community water systems
          serving ${totalPop > 0 ? totalPop.toLocaleString() + '+ people' : 'residents'} in ${escHtml(stateName)}.
          Click any system to see violations, lead testing results, and a safety grade.
        </p>
      </div>
    </div>

    ${(() => {
      const stateCities = POPULAR_CITY_PAGES.filter(c => c.state === stateCode);
      if (stateCities.length === 0) return '';
      return `<div class="container state-city-links">
      <p class="footer-states-label">Cities in ${escHtml(stateName)}</p>
      <div class="footer-states-links">
        ${stateCities.map(c =>
          `<a href="/${stateCode.toLowerCase()}/${escHtml(c.slug)}">${escHtml(c.name)}</a>`
        ).join('')}
      </div>
    </div>`;
    })()}

    <div class="container state-systems-grid">
      ${cardHtml}
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p class="footer-text">
        Data from the EPA&rsquo;s <a href="https://www.epa.gov/ground-water-and-drinking-water/safe-drinking-water-information-system-sdwis-federal-reporting" target="_blank" rel="noopener">Safe Drinking Water Information System (SDWIS)</a>, updated quarterly.
      </p>
    </div>
  </footer>
</body>
</html>`;
};

const handleStatePage = async (req, res, stateCode) => {
  stateCode = stateCode.toUpperCase();
  const stateName = US_STATES[stateCode];
  if (!stateName) { res.writeHead(302, { Location: '/' }); res.end(); return; }
  try {
    const systems = await fetchSystemsForState(stateCode);
    const html    = renderStatePage(stateCode, stateName, systems);
    sendHTML(req, res, html);
  } catch (err) {
    console.error('[/state]', err.message);
    res.writeHead(302, { Location: '/' });
    res.end();
  }
};

// ─── API handlers ─────────────────────────────────────────────────
const handleSystems = async (req, res, params) => {
  const zip = (params.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return sendJSON(req, res, 400, { error: 'Please enter a valid 5-digit ZIP code.' });
  }
  try {
    const systems = await fetchSystemsForZip(zip);
    return sendJSON(req, res, 200, systems);
  } catch (err) {
    console.error('[/api/systems]', err.message);
    return sendJSON(req, res, 500, { error: 'Failed to search water systems. Please try again.' });
  }
};

const handleReport = async (req, res, params) => {
  const pwsid = (params.get('pwsid') || '').trim().toUpperCase();
  if (!pwsid || !/^[A-Z0-9]{3,14}$/.test(pwsid)) {
    return sendJSON(req, res, 400, { error: 'Invalid water system ID.' });
  }
  try {
    const data = await fetchReportData(pwsid);
    return sendJSON(req, res, 200, data);
  } catch (err) {
    console.error('[/api/report]', err.message);
    return sendJSON(req, res, 500, { error: 'Failed to load report. Please try again.' });
  }
};

// ─── SSR: /report/:pwsid ─────────────────────────────────────────
const handleSSRReport = async (req, res, pwsid) => {
  pwsid = pwsid.trim().toUpperCase();
  if (!pwsid || !/^[A-Z0-9]{3,14}$/.test(pwsid)) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }
  try {
    const { system, violations, samples } = await fetchReportData(pwsid);
    if (!system) {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    const html = await renderSSRPage(system, violations, samples);
    sendHTML(req, res, html);
  } catch (err) {
    console.error('[/report]', err.message);
    res.writeHead(302, { Location: '/' });
    res.end();
  }
};

// ─── Redirect: /zip/:zip → /report/:pwsid ────────────────────────
const handleZipRedirect = async (res, zip) => {
  if (!/^\d{5}$/.test(zip)) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }
  try {
    const systems = await fetchSystemsForZip(zip);
    if (systems.length === 0) {
      res.writeHead(302, { Location: `/?zip=${zip}` });
    } else {
      res.writeHead(302, { Location: `/report/${systems[0].pwsid}` });
    }
    res.end();
  } catch (err) {
    console.error('[/zip]', err.message);
    res.writeHead(302, { Location: '/' });
    res.end();
  }
};

// ─── Sitemap ──────────────────────────────────────────────────────
const handleSitemap = async (res) => {
  const cached = getCached('sitemap');
  if (cached) {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(cached);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    `  <url><loc>${BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority><lastmod>${today}</lastmod></url>`,
    // Contaminants hub page
    `  <url><loc>${BASE_URL}/contaminants</loc><changefreq>monthly</changefreq><priority>0.9</priority><lastmod>${today}</lastmod></url>`,
    // Individual contaminant pages
    ...Object.keys(CONTAMINANT_PAGES).map(slug =>
      `  <url><loc>${BASE_URL}/contaminant/${slug}</loc><changefreq>monthly</changefreq><priority>0.85</priority><lastmod>${today}</lastmod></url>`
    ),
    // All 50 state hub pages
    ...Object.keys(US_STATES).map(code =>
      `  <url><loc>${BASE_URL}/state/${code.toLowerCase()}</loc><changefreq>monthly</changefreq><priority>0.9</priority><lastmod>${today}</lastmod></url>`
    ),
    // Popular city ZIP redirects
    ...POPULAR_CITIES.map(c =>
      `  <url><loc>${BASE_URL}/zip/${c.zip}</loc><changefreq>monthly</changefreq><priority>0.8</priority><lastmod>${today}</lastmod></url>`
    ),
    // Rankings page
    `  <url><loc>${BASE_URL}/rankings</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${today}</lastmod></url>`,
    // Cities hub page
    `  <url><loc>${BASE_URL}/cities</loc><changefreq>weekly</changefreq><priority>0.9</priority><lastmod>${today}</lastmod></url>`,
    // Blog hub page
    `  <url><loc>${BASE_URL}/blog</loc><changefreq>daily</changefreq><priority>0.9</priority><lastmod>${today}</lastmod></url>`,
    // Individual blog articles
    ...ARTICLES.map(a =>
      `  <url><loc>${BASE_URL}/blog/${a.slug}</loc><changefreq>monthly</changefreq><priority>0.8</priority><lastmod>${a.date}</lastmod></url>`
    ),
    // City pages
    ...POPULAR_CITY_PAGES.map(c =>
      `  <url><loc>${BASE_URL}/${c.state.toLowerCase()}/${c.slug}</loc><changefreq>monthly</changefreq><priority>0.85</priority><lastmod>${today}</lastmod></url>`
    ),
  ];

  // Attempt to add top 1,000 water systems (best-effort, non-blocking)
  try {
    const topSystems = await fetchJSON(`${EPA_BASE}/WATER_SYSTEM/pws_activity_code/A/pws_type_code/CWS/rows/0:1000/JSON`, 20000);
    if (Array.isArray(topSystems)) {
      const sorted = topSystems
        .map(normalizeSystem)
        .filter(s => s.pwsid && s.population > 0)
        .sort((a, b) => b.population - a.population)
        .slice(0, 1000);
      for (const s of sorted) {
        urls.push(`  <url><loc>${BASE_URL}/report/${escHtml(s.pwsid)}</loc><changefreq>monthly</changefreq><priority>0.6</priority><lastmod>${today}</lastmod></url>`);
      }
    }
  } catch (_) { /* non-fatal */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  setCached('sitemap', xml);
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
  res.end(xml);
};

// ─── robots.txt ───────────────────────────────────────────────────
const handleRobots = (res) => {
  const txt = `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`;
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(txt);
};

// ─── HTTP Router ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u        = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  // API routes
  if (pathname === '/api/systems') return handleSystems(req, res, u.searchParams);
  if (pathname === '/api/report')  return handleReport(req, res, u.searchParams);


  // Special files
  if (pathname === '/sitemap.xml') return handleSitemap(res);
  if (pathname === '/robots.txt')  return handleRobots(res);
  if (pathname === '/favicon.ico') return serveStatic(req, res, path.join(PUBLIC, 'favicon.svg'));

  // SSR report page: /report/:pwsid
  const reportMatch = pathname.match(/^\/report\/([A-Za-z0-9]{3,14})$/);
  if (reportMatch) return handleSSRReport(req, res, reportMatch[1]);

  // ZIP redirect: /zip/:zip
  const zipMatch = pathname.match(/^\/zip\/(\d{5})$/);
  if (zipMatch) return handleZipRedirect(res, zipMatch[1]);

  // State hub page: /state/:xx
  const stateMatch = pathname.match(/^\/state\/([a-zA-Z]{2})$/);
  if (stateMatch) return handleStatePage(req, res, stateMatch[1]);

  // Contaminants list page: /contaminants
  if (pathname === '/contaminants') return handleContaminantsList(req, res);

  // Individual contaminant page: /contaminant/:slug
  const contaminantMatch = pathname.match(/^\/contaminant\/([\w-]{2,60})$/);
  if (contaminantMatch) return handleContaminantPage(req, res, contaminantMatch[1]);

  // Rankings page: /rankings
  if (pathname === '/rankings') return handleRankingsPage(req, res);

  // Cities hub page: /cities — MUST be before the city catch-all
  if (pathname === '/cities') return handleCitiesHub(req, res);

  // Blog hub: /blog
  if (pathname === '/blog') return handleBlogList(req, res);

  // Individual blog post: /blog/:slug
  const blogMatch = pathname.match(/^\/blog\/([\w-]{2,80})$/);
  if (blogMatch) return handleBlogPost(req, res, blogMatch[1]);

  // City pages: /[state-abbr]/[city-slug] — MUST be last before static fallback
  const cityMatch = pathname.match(/^\/([a-z]{2})\/([a-z0-9-]{2,60})$/);
  if (cityMatch) return handleCityPage(req, res, cityMatch[1], cityMatch[2]);

  // Static files
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const ext      = path.extname(safePath);
  const filePath = ext ? path.join(PUBLIC, safePath) : path.join(PUBLIC, 'index.html');

  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }

  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  💧  ClearWater is running!              ║
  ║      ${BASE_URL.padEnd(34)}║
  ╚══════════════════════════════════════════╝
  `);
});
