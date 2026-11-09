# Lambda OS (prototype)

A Chrome extension that replaces the new-tab page with an ops command center: a fleet globe, a
knowledge graph linking sites, racks, devices, tickets, parts and people, a live feed, your Jira
queue, and a ⌘K bar that searches everything and answers questions.

**Status: v0.3.** Live data from **NetBox** (sites, racks, devices, spares, change log), **Jira** (DC tickets, plus
projects and deployments from PMO and Cluster Intake), **NetSuite** (material on hand and material movements),
**Slack** (your mentions and channels), **Gmail** (unread) and **Google Calendar** (your agenda). Every source uses your
own browser sign-in, and no tokens are stored. Every NetBox site is on the globe, including Canada, Mexico and anywhere else.

- **Fleet** is a globe wrapped in real **satellite imagery** with place labels (Esri World Imagery), rendered with WebGL.
  Zooming in far hands off to a street-level tile map at the same spot (down to individual buildings); zooming back
  out returns to the globe. Each site card has **◎ Exact location**, which flies to the site's NetBox coordinates at
  building level. Base maps: Satellite, Dark (CARTO), Streets (OpenStreetMap), or Dots (offline, no imagery).
  Map tiles load from those providers as images, so they need internet but no extra permissions. Attribution is shown on the map.
  Land outlines for the Dots mode come from Natural Earth 1:110m (public domain), bundled in `world.js`.
- **Deployments**: a timeline of PMO epics grouped by project (initiative), with progress from their workstreams
  (DCID, SDN, SCR, STORAGE…), health, planned dates and overdue flags. ☆ stars a deployment so it shows in the
  **Tracking** tab. Deployments link to their sites, Slack channels, calendar meetings and NetSuite shipments.
- **Second brain**: everything linked, drawn as neurons. Signals fire along the connections, and hot spots (breached
  tickets, at-risk deployments, fresh mentions) fire more.
- **Settings** has source toggles, **Reset to defaults**, and **Save / Load backup** (settings plus tracked deployments as JSON; a NetBox token is never written to the file).

- **AI assistant**: **✨ Ask AI** in the top bar (or ⌘J) opens a chat panel; ⌘K questions go there too. Claude
  (default `claude-opus-5-5`), OpenAI, Gemini, or a local model (LM Studio / Ollama) with your own key (Settings → AI).
  Answers are grounded in the loaded data, support follow-ups, and link straight to tickets, deployments and sites.
  AI requests carry no cookies, referrer or browser headers and identify as `lambda-os/<version>` (background header rule).
- **Privacy** (Settings → Privacy): mask names, emails, IPs/MACs, serials, hostnames, amounts and your own word list
  before anything is sent (placeholders are swapped back only on your screen), leave out Slack/email or calendar,
  or never send to an AI. **What was sent** under every answer shows the exact message.
- **Appearance** (Settings → Appearance, or ◐ in the top bar): System / Light / Dark, six accent colors, density,
  text size, glow and motion. The map/brain stage stays dark in both themes.
- **Alerts** (Settings → Alerts): Chrome notifications after each background refresh when your tickets near or pass
  SLA, a ticket is assigned to you, a tracked deployment changes status, a part you're waiting on is on hand, and
  optionally Slack mentions or a site turning critical. The first run takes a baseline (no flood). Several alerts
  merge into one, quiet hours are respected, and the toolbar icon shows your urgent count.
  If a source stays signed out or stops updating for 15 minutes, you get one alert for that outage with a sign-in link;
  the brief opens with a warning listing stale sources, and empty panels say "not connected" instead of "nothing".
- **Daily brief** (☀ Brief, ⌘K, or the morning notification): today's meetings, your breached and due tickets, tracked
  deployments with progress since yesterday, new tickets and low spares at your sites, parts arrived, mentions.
  Opens on your first new tab after the brief time (default 08:30 on weekdays). Can be summarized by your AI provider.
- **Go anywhere**: ⌘K jumps to Jira queues, NetBox, NetSuite searches, Slack, Gmail and Calendar.

## Install (unpacked)
Easiest to keep up to date is a git copy (the repo is private: you need access to `MarshallStunt/lambda-os`):
```bash
git clone https://github.com/MarshallStunt/lambda-os.git ~/lambda-os
```
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `lambda-os` folder. Keep the folder where it is: Chrome runs the extension from it.
3. Data refreshes in the background every 10 minutes by default (Settings → Data → *Refresh data automatically*: 2 min … 1 h, or off).
4. Sign in to Jira (lambda-inc.atlassian.net), NetBox (VPN on), NetSuite and Google, keep a Slack tab open, then open a new tab. The first load takes ~10 s; after that it opens instantly from cache and refreshes every 10 minutes in the background.
4. The ⚙ button opens Settings: Jira site, the JQL for the dashboard and "My queue", NetBox address, optional NetBox token, live/demo.

## Using it
- **⌘K** or **/** opens search. Try `CMH01`, a hostname, `DC-33191`, `low stock at LAX01`, `203-000536`, `waiting parts on site`, `what breaches SLA today`, or start with `?` to force a question.
- **f** opens the Fleet globe, **b** the Second brain, **d** Deployments, and **Esc** closes things.
- Globe: drag to rotate, scroll to zoom, click a site for inventory and tickets.
- Graph: hover a node to trace its links, drag to pan, scroll to zoom, click to open.

## Updates
Like Lambda Rackside: every 2 hours Lambda OS reads the latest `manifest.json` from the private repo with your GitHub
sign-in in Chrome (sign in to GitHub with an account that can see the repo). When there's a newer version you get a
**NEW** badge, one notification, and **⬆ Update** in the top bar. Settings → **Updates** has a one-line command that
finds your folder and runs `git pull` (or downloads the ZIP for non-git copies), then **Reload extension**. Settings,
tracked deployments and keys are kept. To release: bump `version` in `manifest.json` and push to `main`.

## Files
| File | What it is |
|---|---|
| `live.js` | NetBox + Jira fetchers, using browser sessions. Writes a snapshot to `chrome.storage.local` |
| `data.js` | Turns the snapshot (or demo data) into sites, tickets, devices, parts, people, KPIs and feed. Also handles geo placement |
| `world.js` | World land outlines for the flat map (Natural Earth 1:110m via world-atlas@2.0.2) |
| `newtab.html/.css/.js` | The dashboard. No libraries, because MV3 pages can't load remote code |
| `settings.html/.js` | Options page: sources, appearance, AI, privacy, backup/reset |
| `ai.js` | AI providers (streaming), reversible privacy redaction, model listing |
| `updates.js` | New-version check against the GitHub repo, update command |
| `alerts.js` | Alert rules, daily history, the brief's contents (shared by the worker and the page) |
| `icons/` | App and notification icon |
| `theme.js` | Applies the saved look before first paint |
| `background.js` | Background refresh every 10 min, plain-client header rule, toolbar button |

## How the data maps
- **Sites**: NetBox sites. `ATL01 - …` is a data center, `POP - YUL51` is a POP, `prem-*` is on-prem. Planned, retired and decommissioning sites are drawn hollow. Duplicate codes are merged.
- **Tickets**: the Jira fields "Data Center Location(s)", "Hostname", "Cabinet Name", "Rack Position", "Lambda Part Number" and "Time to resolution" (SLA), matched by name. If several fields share a name, the first filled one wins.
- **Spares**: NetBox inventory-consumables per storage location, then per site. "Low" means at or below the line's alert quantity.
- **Feed**: Jira updates plus NetBox changes made by people. Automation accounts are filtered out.

## Not yet
- Claude: it needs an org-approved API path. The ⌘K answers are computed from the loaded data.
- Slack only works while a Slack tab is open, because it reads through that tab's session.
- Part names: most NetBox consumable types are bare P/Ns. The Rackside parts catalog could name them.
