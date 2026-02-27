/**
 * ClearWater — Node.js server (no npm dependencies)
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
 *   api.zippopotam.us           — ZIP code → city + state
 *   data.epa.gov/efservice       — EPA Envirofacts SDWIS API
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

// Static files — long-lived cache for versioned assets (CSS, JS, fonts, icons)
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
    A: 'Meets all standards — no recent health-based violations',
    B: '1 recent health-based violation — generally safe',
    C: 'Multiple violations — some concern warranted',
    D: 'Significant health-based violations — take precautions',
    F: 'Active health violation — check with your utility immediately',
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
  // LCR_SAMPLE_RESULT has no date — join dates from LCR_SAMPLE by sample_id.
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

  const title = `${system.name} — ${location} Water Quality | ClearWater`;
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
        return `<li>${escHtml(name)} — ${escHtml(v.violationCategory)} (${status})</li>`;
      }).join('')}</ul>`
    : '<p>No health-based violations on record.</p>';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type':    'Dataset',
    'name':     title,
    'description': desc,
    'url':      canonical,
    'creator':  { '@type': 'Organization', 'name': 'U.S. Environmental Protection Agency' },
    'temporalCoverage': '2000/..',
    'spatialCoverage':  location,
    'license':  'https://www.usa.gov/government-works',
  });

  const injectedHead = `
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(desc)}">
  <link rel="canonical" href="${canonical}">
  <script type="application/ld+json">${jsonLd}</script>
  <script>window.__PRELOADED__=${JSON.stringify({ system, violations, samples })};</script>`;

  // SSR summary injected into the placeholder — visible to non-JS crawlers
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
  const title    = `${stateName} Tap Water Quality — Water Systems &amp; Safety Grades | ClearWater`;
  const titleStr = `${stateName} Tap Water Quality — Water Systems & Safety Grades | ClearWater`;
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
  <link rel="canonical" href="${canonical}">
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
    // All 50 state hub pages
    ...Object.keys(US_STATES).map(code =>
      `  <url><loc>${BASE_URL}/state/${code.toLowerCase()}</loc><changefreq>monthly</changefreq><priority>0.9</priority><lastmod>${today}</lastmod></url>`
    ),
    // Popular city ZIP redirects
    ...POPULAR_CITIES.map(c =>
      `  <url><loc>${BASE_URL}/zip/${c.zip}</loc><changefreq>monthly</changefreq><priority>0.8</priority><lastmod>${today}</lastmod></url>`
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

  // SSR report page: /report/:pwsid
  const reportMatch = pathname.match(/^\/report\/([A-Za-z0-9]{3,14})$/);
  if (reportMatch) return handleSSRReport(req, res, reportMatch[1]);

  // ZIP redirect: /zip/:zip
  const zipMatch = pathname.match(/^\/zip\/(\d{5})$/);
  if (zipMatch) return handleZipRedirect(res, zipMatch[1]);

  // State hub page: /state/:xx
  const stateMatch = pathname.match(/^\/state\/([a-zA-Z]{2})$/);
  if (stateMatch) return handleStatePage(req, res, stateMatch[1]);

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
