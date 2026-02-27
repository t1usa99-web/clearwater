/* ═══════════════════════════════════════════════════════════════
   ClearWater — Frontend Application
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ──────────────────────────────────────────────────────
const state = {
  view: 'search',
  zip: '',
  systems: [],
  selectedSystem: null,
  report: null,
};

// ─── EPA Contaminant Database ────────────────────────────────────
// Maps contaminant codes to names, health info, and MCL values
const CONTAMINANTS = {
  '0001': { name: 'Fluoride',                   mcl: 4.0,     unit: 'mg/L',  cat: 'Inorganic',       health: 'At high levels, can cause dental and skeletal fluorosis. Most water systems add fluoride for dental health.' },
  '0002': { name: 'Arsenic',                    mcl: 0.010,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Long-term exposure linked to skin damage, circulatory problems, and increased cancer risk. Occurs naturally in rock and soil.' },
  '0003': { name: 'Barium',                     mcl: 2,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Elevated levels may increase blood pressure. Found naturally in rock and used industrially.' },
  '0004': { name: 'Cadmium',                    mcl: 0.005,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Kidney damage from long-term exposure. Comes from galvanized pipe corrosion and industrial discharge.' },
  '0005': { name: 'Chromium',                   mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Occurs naturally and from industrial discharges.' },
  '0006': { name: 'Lead',                       mcl: 0.015,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Serious brain and nervous system damage, especially in children and fetuses. Usually enters water from old pipes and fixtures, not the source water itself.' },
  '0007': { name: 'Mercury (inorganic)',        mcl: 0.002,   unit: 'mg/L',  cat: 'Heavy Metal',     health: 'Kidney damage from long-term exposure. Enters water from industrial waste and natural deposits.' },
  '0008': { name: 'Nitrate',                    mcl: 10,      unit: 'mg/L',  cat: 'Inorganic',       health: 'Serious blood disorder (methemoglobinemia/"blue baby syndrome") in infants under 6 months. Less risk for adults. Common from fertilizer and septic runoff.' },
  '0009': { name: 'Nitrite',                    mcl: 1,       unit: 'mg/L',  cat: 'Inorganic',       health: 'Same concern as nitrate — dangerous for infants. Short-term exposure is the main risk.' },
  '0010': { name: 'Selenium',                   mcl: 0.05,    unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair and fingernail loss, numbness in extremities. Found naturally and in mining/industrial discharge.' },
  '0011': { name: 'Silver',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Skin discoloration (argyria). From mining, natural deposits, and industrial uses.' },
  '0012': { name: 'Antimony',                   mcl: 0.006,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Nausea, vomiting, and increased blood cholesterol. From industrial chemicals and natural deposits.' },
  '0013': { name: 'Beryllium',                  mcl: 0.004,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Intestinal lesions. Discharge from metal refineries and aerospace industries.' },
  '0014': { name: 'Cyanide',                    mcl: 0.2,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Nerve damage and thyroid problems. From steel and plastics factories, fertilizer production.' },
  '0015': { name: 'Nickel',                     mcl: 0.1,     unit: 'mg/L',  cat: 'Inorganic',       health: 'Allergic dermatitis. Metal industries and natural deposits.' },
  '0016': { name: 'Thallium',                   mcl: 0.002,   unit: 'mg/L',  cat: 'Inorganic',       health: 'Hair loss, changes in blood and kidneys, intestines, and liver. Leaching from ore-processing and electronics. Rare.' },
  '1001': { name: 'Benzene',                    mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Anemia and immune system damage; known human carcinogen. From factories, gas stations, underground fuel storage.' },
  '1002': { name: 'Carbon Tetrachloride',       mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. From industrial chemical use.' },
  '1003': { name: 'Chlorobenzene',              mcl: 0.1,     unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver and kidney effects. Discharge from chemical and agricultural chemical factories.' },
  '1005': { name: 'Total Trihalomethanes (TTHMs)', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'Increased risk of cancer with long-term exposure. Formed when chlorine disinfectants react with naturally occurring organic matter in water.' },
  '1006': { name: 'Haloacetic Acids (HAA5)',    mcl: 0.060,   unit: 'mg/L',  cat: 'Disinfection Byproduct', health: 'Increased risk of cancer. Like TTHMs, formed as a byproduct of water chlorination.' },
  '1007': { name: '1,2-Dichloroethane',         mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Increased cancer risk. Industrial chemical discharge.' },
  '1015': { name: 'Tetrachloroethylene (PCE)',  mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. Discharge from dry cleaners and auto shops.' },
  '1016': { name: 'Toluene',                    mcl: 1,       unit: 'mg/L',  cat: 'Volatile Organic', health: 'Nervous system, kidney, or liver problems. Discharge from petroleum factories.' },
  '1021': { name: 'Trichloroethylene (TCE)',    mcl: 0.005,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Liver problems and increased cancer risk. Discharge from metal degreasing sites and other factories.' },
  '1022': { name: 'Vinyl Chloride',             mcl: 0.002,   unit: 'mg/L',  cat: 'Volatile Organic', health: 'Increased cancer risk. Leaching from PVC pipes; discharge from plastics factories.' },
  '2000': { name: 'Alachlor (herbicide)',       mcl: 0.002,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Eye, liver, kidney, or spleen problems; anemia; increased cancer risk. Runoff from herbicide use on row crops.' },
  '2001': { name: 'Atrazine',                   mcl: 0.003,   unit: 'mg/L',  cat: 'Pesticide',        health: 'Cardiovascular system or reproductive problems. Widely used herbicide, runoff from crops.' },
  '2050': { name: 'Total Coliform',             mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Coliform bacteria indicate water may be contaminated with disease-causing organisms. Stomach and intestinal illness may result.' },
  '2051': { name: 'Fecal Coliform / E. coli',   mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Indicates the possible presence of fecal contamination. Can cause serious gastrointestinal illness.' },
  '2049': { name: 'E. coli',                    mcl: 0,       unit: 'presence', cat: 'Microbial',     health: 'Fecal contamination indicator. Gastrointestinal illness risk; especially dangerous for immunocompromised individuals.' },
  '3100': { name: 'Turbidity',                  mcl: 1,       unit: 'NTU',   cat: 'Physical',         health: 'High turbidity can interfere with disinfection and indicate the presence of contaminants. May cause stomach or gut illness.' },
  '4010': { name: 'Chloramines (as Cl₂)',       mcl: 4,       unit: 'mg/L',  cat: 'Disinfectant',     health: 'Eye and nose irritation, stomach discomfort, anemia at very high levels. Used as a water disinfectant.' },
  '4020': { name: 'Chlorine (as Cl₂)',          mcl: 4,       unit: 'mg/L',  cat: 'Disinfectant',     health: 'Eye and nose irritation, stomach discomfort at high levels. Intentionally added for disinfection.' },
  '4030': { name: 'Chlorine Dioxide (as ClO₂)', mcl: 0.8,     unit: 'mg/L',  cat: 'Disinfectant',     health: 'Anemia and nervous system effects in infants and young children. Used as an alternative disinfectant.' },
  '7000': { name: 'Combined Radium (226 & 228)', mcl: 5,      unit: 'pCi/L', cat: 'Radionuclide',     health: 'Increased cancer risk with long-term exposure. Occurs naturally in some rock formations.' },
  '7001': { name: 'Radium-226',                  mcl: null,   unit: 'pCi/L', cat: 'Radionuclide',     health: 'Part of combined radium standard. Occurs naturally; increased cancer risk.' },
  '7002': { name: 'Radium-228',                  mcl: null,   unit: 'pCi/L', cat: 'Radionuclide',     health: 'Part of combined radium standard. Occurs naturally; increased cancer risk.' },
  '7500': { name: 'Uranium',                    mcl: 0.030,   unit: 'mg/L',  cat: 'Radionuclide',     health: 'Kidney toxicity and increased cancer risk. Occurs naturally in rock and soil.' },
  '7501': { name: 'Gross Alpha Activity',       mcl: 15,      unit: 'pCi/L', cat: 'Radionuclide',     health: 'Increased cancer risk from radioactive particles. Naturally occurring in some groundwater.' },
  '7502': { name: 'Beta/Photon Emitters',       mcl: 4,       unit: 'mrem/yr', cat: 'Radionuclide',   health: 'Increased cancer risk. Can be naturally occurring or from industrial or nuclear sources.' },
  // Stage 2 Disinfection Byproducts Rule (D/DBP) — different codes from Phase I
  '2950': { name: 'Total Trihalomethanes (TTHMs)', mcl: 0.080, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'TTHMs form when chlorine used to disinfect water reacts with natural organic matter. Long-term exposure is linked to increased cancer risk and pregnancy complications. Measured as a running annual average; short-term spikes are common.' },
  '2456': { name: 'Haloacetic Acids (HAA5)',       mcl: 0.060, unit: 'mg/L', cat: 'Disinfection Byproduct', health: 'HAA5 are disinfection byproducts formed when chlorine reacts with organic matter. Long-term exposure is associated with increased cancer risk.' },
  // Radionuclide MCL codes (rule group 300)
  '5000': { name: 'Gross Alpha Particle Activity', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide', health: 'Naturally occurring radioactive particles found in some groundwater. Long-term exposure above the MCL increases cancer risk.' },
  '4000': { name: 'Gross Alpha (incl. Radium-226, excl. Radon)', mcl: 15, unit: 'pCi/L', cat: 'Radionuclide', health: 'Naturally occurring radioactivity. Long-term exposure above 15 pCi/L increases cancer risk.' },
  // Lead & Copper Rule codes used in VIOLATION table
  '0300': { name: 'Copper',  mcl: 1.3,   unit: 'mg/L',  cat: 'Heavy Metal',  health: 'Copper can cause short-term gastrointestinal distress. Excessive long-term exposure can cause liver and kidney damage. Copper in water usually comes from home plumbing.' },
  '0301': { name: 'Lead',    mcl: 0.015, unit: 'mg/L',  cat: 'Heavy Metal',  health: 'No safe level of lead exposure is known. It causes serious developmental and neurological harm, especially in children under 6 and pregnant women. Lead enters water from pipes and fixtures, not the source water.' },
  // LCR 90th percentile codes (used in LCR_SAMPLE_RESULT)
  'PB90': { name: 'Lead (90th Percentile)',   mcl: 0.015, unit: 'mg/L', cat: 'Heavy Metal', health: 'The 90th percentile lead level across all household tap samples. If this exceeds 0.015 mg/L, the utility must take corrective action. Even low levels are harmful to children.' },
  'CU90': { name: 'Copper (90th Percentile)', mcl: 1.3,   unit: 'mg/L', cat: 'Heavy Metal', health: 'The 90th percentile copper level. If above 1.3 mg/L, corrective action is required. Usually comes from household plumbing.' },
};

// ─── Violation Category Lookup ────────────────────────────────────
const VIOLATION_CATEGORIES = {
  'MCL':  { label: 'MCL Exceeded',               type: 'health',     color: 'health-based', desc: 'The level of a contaminant in your water exceeded the maximum legal limit (MCL) set by the EPA.' },
  'MRDL': { label: 'Disinfectant Level Exceeded', type: 'health',     color: 'health-based', desc: 'The disinfectant used to treat water exceeded the maximum residual disinfectant level allowed.' },
  'TT':   { label: 'Treatment Technique Failure', type: 'health',     color: 'health-based', desc: 'A required water treatment process (like filtration or disinfection) was not properly carried out.' },
  'M/R':  { label: 'Missed Testing',              type: 'monitoring', color: 'monitoring',   desc: 'Required water quality testing was not performed or results were not reported on time. Water may or may not be safe — we simply don\'t know.' },
  'PN':   { label: 'Public Notice',               type: 'reporting',  color: 'reporting',    desc: 'The utility failed to notify customers about a water quality issue within the required time.' },
  'CCR':  { label: 'Consumer Report Missing',     type: 'reporting',  color: 'reporting',    desc: 'The annual water quality report (Consumer Confidence Report) was not published or delivered to customers.' },
  'Other':{ label: 'Other Violation',             type: 'other',      color: 'other',        desc: 'A violation of the Safe Drinking Water Act occurred.' },
};

// Source type codes → readable labels
const SOURCE_TYPES = {
  GW: 'Groundwater', SW: 'Surface Water', GU: 'Groundwater Under Surface Water Influence',
  GWP: 'Groundwater Purchased', SWP: 'Surface Water Purchased',
};

// PWS type codes
const PWS_TYPES = {
  CWS: 'Community Water System', NTNCWS: 'Non-Transient Non-Community', TNCWS: 'Transient Non-Community',
};

// ─── DOM Refs ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const views = {
  search:    $('view-search'),
  loading:   $('view-loading'),
  select:    $('view-select'),
  report:    $('view-report'),
  noresults: $('view-noresults'),
  error:     $('view-error'),
};

// ─── View Management ──────────────────────────────────────────────
function showView(name) {
  state.view = name;
  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[name]) views[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── URL Management ───────────────────────────────────────────────
function pushReportUrl(pwsid) {
  const target = `/report/${pwsid}`;
  if (window.location.pathname !== target) {
    history.pushState({ pwsid, view: 'report' }, '', target);
  }
  // Hide the SSR summary once JS has rendered the interactive report
  const ssrSummary = document.getElementById('ssr-summary');
  if (ssrSummary) ssrSummary.remove();
  const jsMsg = document.querySelector('.js-loading-msg');
  if (jsMsg) jsMsg.remove();
}

function pushSearchUrl() {
  if (window.location.pathname !== '/') {
    history.pushState({ view: 'search' }, '', '/');
  }
}

// ─── API Calls ────────────────────────────────────────────────────
async function fetchSystems(zip) {
  const res = await fetch(`/api/systems?zip=${encodeURIComponent(zip)}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not search water systems.');
  }
  return res.json();
}

async function fetchReport(pwsid) {
  const res = await fetch(`/api/report?pwsid=${encodeURIComponent(pwsid)}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load the water quality report.');
  }
  return res.json();
}

// ─── Grade Computation ────────────────────────────────────────────
function computeGrade(violations) {
  const now = new Date();
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

  // Health-based violations in last 5 years
  const recentHealth = violations.filter(v => {
    if (!v.isHealthBased) return false;
    const date = parseDate(v.beginDate);
    return date && date >= fiveYearsAgo;
  });

  // Currently active violations
  const activeViolations = violations.filter(v => isActive(v));
  const activeHealth = activeViolations.filter(v => v.isHealthBased);

  const score = {
    activeHealth: activeHealth.length,
    recentHealth: recentHealth.length,
    active: activeViolations.length,
  };

  let grade;
  if (activeHealth.length > 0)            grade = 'F';
  else if (recentHealth.length >= 5)      grade = 'D';
  else if (recentHealth.length >= 2)      grade = 'C';
  else if (recentHealth.length === 1)     grade = 'B';
  else if (activeViolations.length > 3)   grade = 'C';
  else                                    grade = 'A';

  const labels = {
    A: 'Meets all standards — no recent health-based violations',
    B: '1 recent health-based violation — generally safe',
    C: 'Multiple violations — some concern warranted',
    D: 'Significant health-based violations — take precautions',
    F: 'Active health violation — check with your utility immediately',
  };

  return { grade, label: labels[grade], score };
}

// ─── Helpers ─────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  // Handle formats: MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isActive(v) {
  // compliance_status_code meanings:
  //   R = Return to Compliance (resolved)
  //   K = Resolved by State (administrative closure)
  //   O = Open (active violation)
  //   (blank / other) = check end date
  const status = (v.status || '').toUpperCase().trim();
  if (status === 'R' || status === 'K') return false;  // Resolved
  if (status === 'O') return true;                     // Open = active
  // Fallback: check end date
  if (!v.endDate || v.endDate.trim() === '') return true;
  const end = parseDate(v.endDate);
  if (!end) return true;
  return end > new Date();
}

function getViolationCategory(v) {
  const cat = (v.violationCategory || '').trim().toUpperCase();
  return VIOLATION_CATEGORIES[cat] || VIOLATION_CATEGORIES['Other'];
}

function getContaminantInfo(code) {
  const clean = String(code || '').replace(/^0+/, '').padStart(4, '0');
  return CONTAMINANTS[clean] || CONTAMINANTS[code] || null;
}

function getContaminantName(v) {
  if (v.contaminantName && v.contaminantName.trim()) return v.contaminantName.trim();
  const info = getContaminantInfo(v.contaminantCode);
  if (info) return info.name;
  return v.contaminantCode ? `Contaminant #${v.contaminantCode}` : 'Unknown Contaminant';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pluralize(n, singular, plural = singular + 's') {
  return `${n} ${n === 1 ? singular : plural}`;
}

// ─── Rendering: System Cards ──────────────────────────────────────
function renderSystemCard(sys) {
  const pop = sys.population > 0
    ? `Serves ${sys.population.toLocaleString()} people`
    : '';
  const source = SOURCE_TYPES[sys.sourceType] || sys.sourceType || '';
  const type = PWS_TYPES[sys.pwsType] || sys.pwsType || '';
  const location = [sys.city, sys.state].filter(Boolean).join(', ');

  return `
    <button class="system-card" data-pwsid="${escapeHtml(sys.pwsid)}" role="listitem" aria-label="Select ${escapeHtml(sys.name)}">
      <div class="system-card-info">
        <div class="system-name">${escapeHtml(sys.name)}</div>
        <div class="system-meta">
          ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ''}
          ${pop ? `<span>👥 ${escapeHtml(pop)}</span>` : ''}
          ${source ? `<span class="system-meta-pill">${escapeHtml(source)}</span>` : ''}
          ${type ? `<span class="system-meta-pill">${escapeHtml(type)}</span>` : ''}
          <span class="system-meta-pill" style="font-size:11px;color:var(--text-subtle)">ID: ${escapeHtml(sys.pwsid)}</span>
        </div>
      </div>
      <div class="system-card-arrow">→</div>
    </button>
  `;
}

// ─── Rendering: Report Header ─────────────────────────────────────
function renderReportHeader(system, gradeData) {
  const { grade } = gradeData;
  const location = [system.city, system.state].filter(Boolean).join(', ');
  const pop = system.population > 0 ? `${system.population.toLocaleString()} people served` : '';
  const source = SOURCE_TYPES[system.sourceType] || system.sourceType || '';

  return `
    <div class="grade-circle grade-${grade}" aria-label="Water quality grade ${grade}">${grade}</div>
    <div class="report-title">
      <div class="report-system-name">${escapeHtml(system.name)}</div>
      <div class="report-system-meta">
        ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ''}
        ${pop ? `<span>👥 ${escapeHtml(pop)}</span>` : ''}
        ${source ? `<span>💧 ${escapeHtml(source)}</span>` : ''}
        <span>ID: ${escapeHtml(system.pwsid)}</span>
      </div>
      <div class="report-grade-label grade-label-${grade}">${escapeHtml(gradeData.label)}</div>
    </div>
  `;
}

// ─── Rendering: Stats Row ─────────────────────────────────────────
function renderStats(violations, samples, gradeData) {
  const active = violations.filter(isActive);
  const activeHealth = active.filter(v => v.isHealthBased);
  const totalHealth = violations.filter(v => v.isHealthBased);
  const leadSamples = samples.filter(s => ['PB90','pb90','0006','6'].includes(String(s.contaminantCode)));
  const copperSamples = samples.filter(s => ['CU90','cu90','0300','300'].includes(String(s.contaminantCode)));

  const leadAL = 0.015, copperAL = 1.3;
  const leadOver = leadSamples.filter(s => s.result > leadAL).length;
  const copperOver = copperSamples.filter(s => s.result > copperAL).length;

  return `
    <div class="stat-card">
      <div class="stat-number ${activeHealth.length > 0 ? 'danger' : 'safe'}">${activeHealth.length}</div>
      <div class="stat-label">Active Health Violations</div>
    </div>
    <div class="stat-card">
      <div class="stat-number ${totalHealth.length > 2 ? 'warn' : totalHealth.length > 0 ? 'warn' : 'muted'}">${totalHealth.length}</div>
      <div class="stat-label">Total Health Violations (history)</div>
    </div>
    <div class="stat-card">
      <div class="stat-number ${active.length > 0 ? 'warn' : 'safe'}">${active.length}</div>
      <div class="stat-label">Currently Open Violations</div>
    </div>
  `;
}

// ─── Rendering: Violation Card ────────────────────────────────────
function renderViolationCard(v) {
  const catInfo = getViolationCategory(v);
  const contaminantName = getContaminantName(v);
  const contaminantInfo = getContaminantInfo(v.contaminantCode);
  const active = isActive(v);
  const cardClass = catInfo.color;

  const statusBadge = active
    ? '<span class="badge badge-danger">● Active</span>'
    : '<span class="badge badge-muted">Resolved</span>';

  const typeBadge = v.isHealthBased
    ? '<span class="badge badge-danger">Health-Based</span>'
    : catInfo.type === 'monitoring'
      ? '<span class="badge badge-warn">Monitoring</span>'
      : '<span class="badge badge-purple">Reporting</span>';

  const healthCallout = contaminantInfo && v.isHealthBased
    ? `<div class="health-callout">
        <span class="health-callout-icon">🩺</span>
        <span>${escapeHtml(contaminantInfo.health)}</span>
       </div>`
    : '';

  const ruleName = v.ruleName ? `<span><strong>Rule:</strong> ${escapeHtml(v.ruleName)}</span>` : '';

  return `
    <div class="violation-card ${cardClass}" data-health="${v.isHealthBased}" data-active="${active}" data-type="${catInfo.type}">
      <div class="violation-top">
        <div class="violation-name">${escapeHtml(contaminantName)}</div>
        <div class="violation-badges">
          ${statusBadge}
          ${typeBadge}
        </div>
      </div>
      <p class="violation-desc">${escapeHtml(catInfo.desc)}</p>
      ${healthCallout}
      <div class="violation-meta">
        <span><strong>Type:</strong> ${escapeHtml(catInfo.label)}</span>
        <span><strong>Started:</strong> ${formatDate(v.beginDate)}</span>
        ${!active
          ? `<span><strong>Resolved:</strong> ${v.endDate ? formatDate(v.endDate) : 'Yes (via compliance)'}</span>`
          : '<span style="color:var(--danger);font-weight:600">⚠ Still open</span>'}
        ${ruleName}
      </div>
    </div>
  `;
}

// ─── Rendering: Lead & Copper Tab ─────────────────────────────────
function renderLeadCopper(samples) {
  // EPA SDWIS uses 'PB90' for lead 90th percentile and 'CU90' for copper
  // Some older entries may use numeric codes
  const leadCode   = ['PB90', 'pb90', '0006', '6', '1006'];
  const copperCode = ['CU90', 'cu90', '0300', '300', '1300'];

  const leadSamples   = samples.filter(s => leadCode.includes(String(s.contaminantCode)));
  const copperSamples = samples.filter(s => copperCode.includes(String(s.contaminantCode)));

  if (leadSamples.length === 0 && copperSamples.length === 0) {
    return `
      <div class="no-data-note">
        <span>ℹ️</span>
        <span>No lead or copper sample results are available for this water system in the EPA database. This is common for smaller systems or those that haven't triggered monitoring requirements.</span>
      </div>
      <div class="lc-intro">
        <strong>About Lead & Copper Testing:</strong> Under the EPA's Lead and Copper Rule, water systems must test water at homes with lead service lines or copper pipes with lead solder. If more than 10% of samples exceed the action levels (<strong>15 ppb for lead</strong>, <strong>1,300 ppb for copper</strong>), the utility must take corrective action.
        <br><br>
        <strong>Important:</strong> Even if your water system hasn't had lead violations, lead can enter drinking water from pipes and fixtures inside your home, especially in homes built before 1986. Consider a certified lead test kit or filter if you have concerns.
      </div>
    `;
  }

  const leadAL   = 0.015;  // mg/L = 15 ppb
  const copperAL = 1.3;    // mg/L = 1300 ppb

  const renderTable = (samples, contaminantName, actionLevel, unit) => {
    if (samples.length === 0) return `<p style="color:var(--text-subtle);font-size:14px;padding:8px 0">No ${contaminantName} sample data available.</p>`;

    // Sort by date desc, take most recent 20
    const sorted = [...samples]
      .sort((a, b) => (parseDate(b.sampleDate) || 0) - (parseDate(a.sampleDate) || 0))
      .slice(0, 20);

    const maxVal = Math.max(...sorted.map(s => s.result), actionLevel);

    const rows = sorted.map(s => {
      const pct = Math.min((s.result / maxVal) * 100, 100);
      const overLimit = s.result > actionLevel;
      const barClass = overLimit ? 'danger' : s.result > actionLevel * 0.7 ? 'warn' : 'safe';
      const valClass = overLimit ? 'danger' : 'safe';
      const sign = s.resultSign === '>' ? '>' : s.resultSign === '<' ? '<' : '';
      return `
        <tr>
          <td>${formatDate(s.sampleDate)}</td>
          <td>
            <div class="gauge-wrap">
              <div class="gauge-bar-bg">
                <div class="gauge-bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div>
              </div>
              <span class="gauge-value ${valClass}">${sign}${s.result} ${unit}</span>
            </div>
          </td>
          <td>${overLimit ? '<span class="badge badge-danger">Over AL</span>' : '<span class="badge badge-safe">Below AL</span>'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="lc-table-wrap">
        <table class="lc-table" aria-label="${contaminantName} samples">
          <thead>
            <tr>
              <th>Sample Date</th>
              <th>Level (Action Level = ${actionLevel} ${unit})</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="al-note">Action Level (AL): ${actionLevel} ${unit}. If >10% of samples exceed the AL, corrective action is required.</p>
    `;
  };

  return `
    <div class="lc-intro">
      <strong>Lead & Copper Rule:</strong> Water utilities must test for lead and copper at the tap. If more than 10% of samples exceed the action levels, the utility must take corrective action (like adding corrosion control treatment or replacing lead service lines).
      <br><br>
      <strong>Action Levels:</strong> Lead: <strong>15 ppb (0.015 mg/L)</strong> · Copper: <strong>1,300 ppb (1.3 mg/L)</strong>
      <br><br>
      Note: Lead in water often comes from <em>your home's own pipes and fixtures</em>, not the water source itself. Older homes (pre-1986) are at greater risk.
    </div>

    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">Lead Samples</h3>
    ${renderTable(leadSamples, 'Lead', leadAL, 'mg/L')}

    <h3 style="font-size:16px;font-weight:700;margin:20px 0 8px">Copper Samples</h3>
    ${renderTable(copperSamples, 'Copper', copperAL, 'mg/L')}
  `;
}

// ─── Rendering: Recommendations Tab ──────────────────────────────
function renderRecommendations(violations, samples, system) {
  const recs = [];
  const activeHealth = violations.filter(v => v.isHealthBased && isActive(v));
  const leadSamples   = samples.filter(s => ['PB90','pb90','0006','6'].includes(String(s.contaminantCode)));
  const leadOver      = leadSamples.filter(s => s.result > 0.015);
  const hasTthms      = violations.some(v => v.contaminantCode === '1005' && isActive(v));
  const hasNitrate    = violations.some(v => ['0008','0009'].includes(v.contaminantCode));
  const hasBacteria   = violations.some(v => ['2050','2051','2049'].includes(v.contaminantCode));
  const hasRecentHealth = violations.filter(v => {
    const d = parseDate(v.beginDate);
    return v.isHealthBased && d && d > new Date(Date.now() - 5*365*24*60*60*1000);
  }).length > 0;

  if (activeHealth.length > 0) {
    recs.push({
      icon: '🚨',
      title: 'Active health violation — contact your utility',
      desc: `Your water system has ${pluralize(activeHealth.length, 'active health-based violation')}. Contact your utility immediately to ask what is being done and whether you should use bottled water or a certified filter in the meantime.`,
      priority: true,
      tags: ['Urgent', 'Call Your Utility'],
    });
  }

  if (hasBacteria || violations.some(v => ['2050','2051','2049'].includes(v.contaminantCode) && isActive(v))) {
    recs.push({
      icon: '🦠',
      title: 'Boil water advisory may be needed',
      desc: 'Bacteria violations indicate possible microbial contamination. Boiling water for at least 1 minute kills most bacteria and viruses. Follow any boil water advisories from your utility.',
      priority: true,
      tags: ['Bacteria', 'Boil Water'],
    });
  }

  if (leadOver.length > 0) {
    recs.push({
      icon: '🪣',
      title: 'Flush your tap before drinking',
      desc: 'Lead was detected above the action level. Run your cold water tap for 30–60 seconds before drinking, especially after periods of non-use. Lead usually comes from your home\'s pipes, not the source water.',
      priority: true,
      tags: ['Lead', 'Especially for Children', 'Pregnant Women'],
    });
  }

  if (hasTthms) {
    recs.push({
      icon: '🚿',
      title: 'Consider a carbon filter for disinfection byproducts',
      desc: 'Trihalomethanes and haloacetic acids form when chlorine reacts with organic matter. An NSF-certified pitcher or under-sink activated carbon filter (NSF Standard 53) can reduce these compounds.',
      priority: false,
      tags: ['TTHMs', 'Filter Recommendation'],
    });
  }

  if (hasNitrate) {
    recs.push({
      icon: '🍼',
      title: 'Do not give tap water to infants if nitrate violation exists',
      desc: 'High nitrate levels can cause a dangerous blood disorder in babies under 6 months ("blue baby syndrome"). Use certified bottled water or a reverse osmosis filter for infant formula until the violation is resolved.',
      priority: hasRecentHealth,
      tags: ['Nitrate', 'Infants', 'Reverse Osmosis'],
    });
  }

  if (leadSamples.length > 0 && leadOver.length === 0) {
    recs.push({
      icon: '🏠',
      title: 'Check your home\'s plumbing for lead pipes',
      desc: 'Even if your water system passed lead tests, lead can enter water from pipes inside your home. Homes built before 1986 may have lead service lines or lead solder. A home test kit (around $20–$30) can confirm.',
      priority: false,
      tags: ['Lead', 'Home Plumbing'],
    });
  }

  if (violations.filter(v => !v.isHealthBased && isActive(v)).length > 0) {
    recs.push({
      icon: '📋',
      title: 'Ask your utility about open monitoring violations',
      desc: 'Monitoring violations mean required tests weren\'t done or reported. This doesn\'t automatically mean your water is unsafe — but it\'s worth asking your utility what happened.',
      priority: false,
      tags: ['Monitoring', 'Contact Utility'],
    });
  }

  if (recs.length === 0) {
    recs.push({
      icon: '✅',
      title: 'Your water meets all federal standards — no action required',
      desc: 'Based on available EPA records, this water system has no recent health-based violations. Continue using tap water normally. You may still consider a certified filter for taste or peace of mind.',
      priority: false,
      good: true,
      tags: ['No Violations Found'],
    });
  }

  recs.push({
    icon: '💧',
    title: 'Get your free annual water quality report',
    desc: 'Every community water system is required to publish an annual Consumer Confidence Report (CCR) by July 1 each year. Contact your utility or search for it online — it contains detailed testing results specific to your system.',
    priority: false,
    tags: ['Consumer Confidence Report', 'Free'],
  });

  recs.push({
    icon: '🔬',
    title: 'Know what filters work for what',
    desc: `
      <strong>Activated carbon (pitcher/faucet):</strong> Removes chlorine, TTHMs, HAAs, some VOCs and pesticides. Does NOT remove lead well on its own.<br>
      <strong>NSF 53 certified filter:</strong> Specifically tested to reduce lead and other contaminants — look for this certification.<br>
      <strong>Reverse osmosis:</strong> Removes nearly everything including lead, nitrates, arsenic, radionuclides, and PFAS. More expensive but comprehensive.<br>
      <strong>Boiling:</strong> Kills bacteria and viruses. Does NOT remove chemical contaminants.
    `,
    priority: false,
    tags: ['Filter Guide'],
  });

  return `<div class="recs-grid">${recs.map(r => `
    <div class="rec-card ${r.priority ? 'priority' : ''} ${r.good ? 'good' : ''}">
      <div class="rec-icon">${r.icon}</div>
      <div class="rec-body">
        <div class="rec-title">${escapeHtml(r.title)}</div>
        <div class="rec-desc">${r.desc.includes('<') ? r.desc : escapeHtml(r.desc)}</div>
        ${r.tags ? `<div class="rec-tags">${r.tags.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

// ─── Report Rendering ─────────────────────────────────────────────
function renderReport(report) {
  const { system, violations, samples } = report;

  const gradeData = computeGrade(violations);

  // Header
  $('report-header').innerHTML = renderReportHeader(system, gradeData);

  // Stats
  $('report-stats').innerHTML = renderStats(violations, samples, gradeData);

  // Tab counts
  const healthCount = violations.filter(v => v.isHealthBased).length;
  const leadCount   = samples.filter(s => ['PB90','pb90','CU90','cu90','0006','6','0300','300'].includes(String(s.contaminantCode))).length;

  const violCount = $('tab-count-violations');
  const leadCnt   = $('tab-count-lead');
  violCount.textContent = violations.length;
  violCount.classList.toggle('has-danger', healthCount > 0);
  leadCnt.textContent = leadCount;

  // Violations tab
  renderViolationsTab(violations);

  // Lead & Copper tab
  $('lead-copper-content').innerHTML = renderLeadCopper(samples);

  // Recommendations tab
  $('recs-content').innerHTML = renderRecommendations(violations, samples, system);

  showView('report');
}

function renderViolationsTab(violations, filter = 'all', activeOnly = false) {
  let filtered = violations;

  if (filter === 'health')      filtered = filtered.filter(v => v.isHealthBased);
  else if (filter === 'monitoring') filtered = filtered.filter(v => !v.isHealthBased);

  if (activeOnly) filtered = filtered.filter(isActive);

  // Sort: active first, then by beginDate desc
  filtered.sort((a, b) => {
    const aActive = isActive(a) ? 1 : 0;
    const bActive = isActive(b) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const da = parseDate(a.beginDate) || 0;
    const db = parseDate(b.beginDate) || 0;
    return db - da;
  });

  const list = $('violations-list');

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <h3>${violations.length === 0 ? 'No violation records found' : 'No violations match this filter'}</h3>
        <p>${violations.length === 0
          ? 'The EPA database has no violation records for this water system, or the data may not be available.'
          : 'Try adjusting your filters to see more results.'}</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(renderViolationCard).join('');
}

// ─── Event Handlers ───────────────────────────────────────────────

// Search form
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zip = $('zip-input').value.trim();
  const errorEl = $('search-error');

  if (!/^\d{5}$/.test(zip)) {
    errorEl.textContent = 'Please enter a valid 5-digit ZIP code.';
    $('zip-input').focus();
    return;
  }

  errorEl.textContent = '';
  state.zip = zip;

  showView('loading');
  $('loading-text').textContent = `Searching for water systems in ${zip}…`;

  try {
    const systems = await fetchSystems(zip);
    state.systems = systems;

    if (systems.length === 0) {
      $('noresults-zip').textContent = zip;
      showView('noresults');
      return;
    }

    if (systems.length === 1) {
      // Auto-select if only one system
      await loadSystem(systems[0]);
    } else {
      $('select-zip').textContent = zip;
      $('systems-list').innerHTML = systems.map(renderSystemCard).join('');
      showView('select');
    }
  } catch (err) {
    $('error-msg').textContent = err.message || 'An unexpected error occurred.';
    showView('error');
  }
});

// Only allow digits in ZIP input
$('zip-input').addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, 5);
});

// System selection
$('systems-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.system-card');
  if (!card) return;
  const pwsid = card.dataset.pwsid;
  const system = state.systems.find(s => s.pwsid === pwsid);
  if (system) await loadSystem(system);
});

async function loadSystem(system) {
  state.selectedSystem = system;
  showView('loading');
  $('loading-text').textContent = `Loading report for ${system.name}…`;

  try {
    const report = await fetchReport(system.pwsid);
    state.report = report;
    if (!report.system) report.system = system;
    renderReport(report);
    pushReportUrl(system.pwsid);
  } catch (err) {
    $('error-msg').textContent = err.message || 'Failed to load the water quality report.';
    showView('error');
  }
}

async function loadSystemById(pwsid) {
  showView('loading');
  $('loading-text').textContent = `Loading report…`;
  try {
    const report = await fetchReport(pwsid);
    state.report = report;
    state.selectedSystem = report.system;
    renderReport(report);
  } catch (err) {
    $('error-msg').textContent = err.message || 'Failed to load the water quality report.';
    showView('error');
  }
}

// Back buttons
$('back-from-select').addEventListener('click', () => {
  showView('search');
  $('zip-input').value = state.zip;
  $('zip-input').focus();
});

$('back-from-report').addEventListener('click', () => {
  pushSearchUrl();
  if (state.systems.length > 1) {
    showView('select');
  } else {
    showView('search');
    $('zip-input').value = state.zip;
  }
});

$('noresults-back').addEventListener('click', () => {
  showView('search');
  $('zip-input').focus();
});

$('error-back').addEventListener('click', () => {
  if (state.systems.length > 0) {
    showView('select');
  } else {
    showView('search');
  }
});

$('logo-link').addEventListener('click', (e) => {
  e.preventDefault();
  pushSearchUrl();
  showView('search');
  $('zip-input').value = '';
  $('search-error').textContent = '';
});

// Section scroll-spy — highlights the nav link for the section nearest the top
const _sectionLinks = document.querySelectorAll('.section-link[href^="#"]');
const _sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      _sectionLinks.forEach(link =>
        link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`)
      );
    }
  });
}, {
  // Fire when section crosses ~20% from the top of the viewport
  rootMargin: '-15% 0px -75% 0px',
  threshold: 0,
});
document.querySelectorAll('.report-section').forEach(sec => _sectionObserver.observe(sec));

// Violation filters
document.querySelector('.filter-group').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const filter = btn.dataset.filter;
  const activeOnly = $('active-only').checked;
  renderViolationsTab(state.report?.violations || [], filter, activeOnly);
});

$('active-only').addEventListener('change', () => {
  const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
  renderViolationsTab(state.report?.violations || [], filter, $('active-only').checked);
});

// ─── Browser back / forward ───────────────────────────────────────
window.addEventListener('popstate', async (e) => {
  const s = e.state;
  if (s && s.pwsid) {
    // Navigating to a report — use cached report if available, otherwise fetch
    if (state.report && state.report.system && state.report.system.pwsid === s.pwsid) {
      renderReport(state.report);
    } else {
      await loadSystemById(s.pwsid);
    }
  } else {
    // Navigating back to home / search
    showView('search');
    if (state.zip) $('zip-input').value = state.zip;
  }
});

// ─── SSR hydration: if server pre-loaded report data, render it ───
// This runs when the user visits /report/:pwsid directly (SSR page).
if (window.__PRELOADED__) {
  const { system, violations, samples } = window.__PRELOADED__;
  if (system) {
    state.report          = { system, violations, samples };
    state.selectedSystem  = system;
    // Replace browser history entry so back button goes home
    history.replaceState({ pwsid: system.pwsid, view: 'report' }, '', window.location.pathname);
    renderReport(state.report);
    // Clean up SSR summary after interactive report renders
    const ssrEl = document.getElementById('ssr-summary');
    if (ssrEl) ssrEl.remove();
    const jsMsg = document.querySelector('.js-loading-msg');
    if (jsMsg) jsMsg.remove();
  }
}
