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
- The GitHub API returns 401 from external domains — use the **GitHub web editor** (github.com/edit) instead
- CodeMirror 6 EditorView accessible via: `document.querySelector('.cm-content').cmTile.view`
- Commit dialog input: `#commit-message-input`

## Site Architecture
- Frontend fetches `/api/systems?zip=` and `/api/report?pwsid=` (server-side)
- Labs data served server-side from `labs.json` in this repo (not raw.githubusercontent.com CDN)
- State lab pages: `/water-testing/{state_abbr}` — server-rendered with lab + website data

## Data Notes
- Labs in `labs.json` are matched by `state + "||" + name.toLowerCase().trim()`
- Some lab names contain em dashes (–) — match accordingly
- ~741 labs still have no website as of April 2026 (out of 1105 total)
