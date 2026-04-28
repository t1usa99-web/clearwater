# ClearWater Project Memory (CLAUDE.md)

## Project Overview
- **Site**: https://www.checkclearwater.com
- **Repo**: https://github.com/t1usa99-web/clearwater
- **Purpose**: Free EPA water quality lookup tool. Shows contaminant data, violations, and certified testing labs by state.

## Key Files
- `labs.json` — Array of 50 state objects, each with `{state, labs: [{name, city, phone, email, website}]}`. ~1105 labs total.
- `app.js?v=11` — Frontend JS (served from checkclearwater.com, not in repo)
- State pages rendered server-side at `/water-testing/{state_abbr}` (e.g. `/water-testing/tx`)

## Labs Enrichment (Completed April 2026)
- **Source**: EPA certified lab list scraped into `all_labs_data.txt` (511 no-website labs)
- **Enrichment**: Google Places API → 471 labs matched with website URLs
- **Committed**: "Add website URLs for 471 labs (Google Places enrichment)" — commit `c966c31b`
- **Result**: Labs now show "Visit website →" links on state pages
- **Files on VM** (session-local, not persisted):
  - `/sessions/.../website_lookup.json` — 941-entry dict `{"STATE||labname": "url"}`
  - `/sessions/.../website_map.txt` — 471 lines of `idx:url`
  - `/sessions/.../all_labs_data.txt` — 511 lines `STATE|||NAME|||CITY|||PHONE|||EMAIL`

## GitHub Auth Approach
- **Preferred: GitHub API with fine-grained personal access token (PAT)**
  - Generate at: https://github.com/settings/tokens?type=beta
  - Scope: `t1usa99-web/clearwater` repo only, Contents read/write
  - Use API: `PUT /repos/t1usa99-web/clearwater/contents/{path}` with Base64-encoded content
  - Tokens expire — regenerate at the URL above when needed
- **Fallback: GitHub web editor** (if token unavailable)
  - CodeMirror 6 EditorView accessible via: `document.querySelector('.cm-content').cmTile.view`
  - Commit dialog input: `#commit-message-input`

## Site Architecture
- Frontend fetches `/api/systems?zip=` and `/api/report?pwsid=` (server-side)
- Labs data served server-side from `labs.json` in this repo (not raw.githubusercontent.com CDN)
- State lab pages: `/water-testing/{state_abbr}` — server-rendered with lab + website data

## City Pages Expansion (April 2026)
- **Source**: US Census Bureau API (2022 ACS 5-year estimates), cities with pop ≥ 10,000
- **File**: `cities.json` — 4,161 cities with `{state, slug, name, pop}`
- **Before**: ~330 hardcoded cities in `POPULAR_CITY_PAGES` array in server.js
- **After**: `CITY_PAGES` loaded from `cities.json` at startup; `POPULAR_CITY_PAGES` aliases it (with old array as fallback)
- **Impact**: Sitemap grows from ~330 → 4,161 city URLs; cities hub & state pages show all cities

## PFAS Integration (April 2026)
- **Source**: EPA UCMR5 (Fifth Unregulated Contaminant Monitoring Rule), updated quarterly
  - Download: https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule
  - Data covers 29 PFAS compounds tested at water systems 2023–2025
  - Last refresh: January 15, 2026 (~95% complete); final release fall 2026
- **File**: `pfas.json` — 3,539 water systems with PFAS detections, keyed by PWSID
  - Format: `{ "PWSID": { "PFOA": 0.0123, "PFOS": 0.0456, ... }, ... }`
  - Values are max detected concentration in µg/L across all sampling events
- **Integration**: Loaded at startup; displayed as PFAS table on SSR report pages
  - Includes EPA MCLs (finalized April 2024): PFOA/PFOS 0.004, PFHxS/PFNA/GenX 0.010 µg/L
  - Also injected into `__PRELOADED__` and `/api/report` response as `pfas` field

## Data Notes
- Labs in `labs.json` are matched by `state + "||" + name.toLowerCase().trim()`
- Some lab names contain em dashes (–) — match accordingly
- ~741 labs still have no website as of April 2026 (out of 1105 total)
