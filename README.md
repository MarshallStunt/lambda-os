# Lambda OS (prototype)

A Chrome extension that replaces the new-tab page with an ops command center: a fleet globe, a
knowledge graph linking sites, racks, devices, tickets, parts and people, a live feed, your Jira
queue, and a ⌘K bar that searches everything and answers questions.

**Status: v0.3.** Live data from **NetBox** (sites, racks, devices, spares, change log), **Jira** (DC tickets, plus
projects and deployments from PMO and Cluster Intake), **NetSuite** (material on hand and material movements),
**Slack** (your mentions and channels), **Gmail** (unread), **Google Calendar** (your agenda) and **Atium** (builds). Every source uses your
own browser sign-in, and no tokens are stored. Every NetBox site is on the globe, including Canada, Mexico and anywhere else.

- **Fleet** is a globe wrapped in real **satellite imagery** with place labels (Esri World Imagery), rendered with WebGL.
  Zooming in far hands off to a street-level tile map at the same spot (down to individual buildings); zooming back
  out returns to the globe. Each site card has **◎ Exact location**, which flies to the site's NetBox coordinates at
  building level. Base maps: Satellite or Dots (offline, no imagery).
  Satellite tiles load from Esri as images, so they need internet but no extra permissions. Attribution is shown on the map.
  Land outlines for the Dots mode come from Natural Earth 1:110m (public domain), bundled in `world.js`.
- **Deployments**: a timeline of PMO epics grouped by project (initiative), with progress from their workstreams
  (DCID, SDN, SCR, STORAGE…), health, planned dates and overdue flags. ☆ stars a deployment so it shows in the
  **Tracking** tab. Deployments link to their sites, Slack channels, calendar meetings and NetSuite shipments.
- **Second brain**: everything linked, drawn as neurons. Signals fire along the connections, and hot spots (breached
  tickets, at-risk deployments, fresh mentions) fire more. **2D / 3D** switch in its toolbar: 3D lays the same graph out in
  depth (near neurons bigger and brighter), turns slowly on its own, drag to turn it, Shift+drag to pan, scroll to zoom.
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
- **Atium** (kelsier.aws.lambdalabs.cloud): every tracked build (customer, GPUs, MW, stage, racked and validated
  progress, next milestone and hand-off) on its site card, matched to the Jira deployment (same site and GPU count) so the
  deployment panel shows real build progress; asset counts per site; completed milestones in the live feed. Read through
  an Atium tab with your Okta sign-in, which never leaves that tab (two requests per refresh). Opening a site card
  also loads that site's purchase orders: what is still waiting to be received, expected dates and late orders
  (Atium has no prices; cached 10 minutes). Alerts (Settings → Alerts) tell you when a build milestone at your sites goes late, a
  hand-off is a week away, or a purchase order at your sites goes past due; the daily brief has the same list. A purchase
  order is late after the vendor's promised date (or Atium's expected date); more than 30 days past due counts as "stale"
  (usually not updated in Atium), so it is shown quietly and never alerted. For this, each refresh also reads purchase
  orders for up to 6 of your sites, at most every 3 hours.
- **Volunteer requests**: the left column's Volunteer tab lists call-outs in Slack for people to go and help at
  another site's deployment (last 45 days, one per site), found by searching Slack for volunteer requests and links to
  Atium onsite schedules, with jokes and incident or engineering channels filtered out. Each shows who has signed up in
  that site's Atium onsite schedule for the next 4 weeks (and whether you have), with Sign up in Atium and Open in
  Slack buttons. Requests also appear on the site card and, for the last 7 days, in the daily brief.
- **Grafana** (production, grafana.aws.lambdalabs.cloud): read with your Grafana sign-in (directly, or through a temporary
  Grafana tab if direct reading is refused). For every site's metrics store it asks four small queries: PDU power,
  hottest host inlets, firing alerts (host, rack, U, since when) and unreachable network devices. Site cards get a
  **Health · Grafana** section; alerts are tied to their device (hostnames match NetBox) and so to open tickets (⚠ badge);
  new hardware alerts appear in the live feed; Settings → Alerts can notify you of new critical hardware alerts at your
  sites (one notification per site); ⌘K opens the main DC dashboards. The staging Grafana has no production sites.
- **Health view** (4th tab in the middle panel, or **H**): every site against the checks from Grafana's Site Health boards,
  asked once for the whole fleet: leaks, breakers tripped ("new" = in the last 24 h), PDU alarms, power-shelf PSUs at 0 W,
  hosts with hardware faults (fan, PSU, GPU, HBM, NVLink, DIMM, drive, NIC, BMC…), hottest inlet (GPU tray 55/65 °C, air
  32/40 °C), network devices down and devices that can't be monitored, plus site power. Worst sites first; click any number
  for the hosts, racks and U positions. Leaks and newly tripped breakers also show on the site card and, at your sites,
  send an urgent notification (Settings → Alerts → Site health).
- **Smart processing (optional AI)**: Settings → Data → Smart processing chooses **Local only** (default: fixed rules,
  nothing sent anywhere) or **AI when available**. Fetching is always local. In AI mode, after each refresh your AI
  provider looks only at what the rules couldn't settle: which Slack messages are real volunteer requests (with dates and
  head-count; needs its own Slack opt-in), Atium builds / NetSuite shipments / meetings the rules couldn't link to a
  deployment, and the order of your own tickets (hourly). Text is masked like Ask AI, each item is asked about once
  (answers are cached), at most 3 small requests per refresh, and if the AI is missing or fails the local rules decide.
  A ✨ AI tag by the refresh time shows it's on.
- **Self-healing app tabs** (`apptabs.js`): Slack can only be read from an open page. If you have Slack open, Lambda OS
  reads from your tab and never closes, reloads or moves it. Otherwise it keeps its own small pinned Slack tab. Google
  Calendar is always read from its own pinned tab (schedule view), because Google answers the automated agenda feed with
  "unusual traffic". Gmail gets one only if the direct read fails; NetSuite uses a temporary tab closed after 5 idle
  minutes. Pinned copies are recognised only at the exact address Lambda OS opened, so your own pinned tabs are safe. Every
  minute it reloads that tab if Chrome discarded it, sends it back if it wandered off, and refreshes it every 30 min. If
  it lands on a sign-in page you'll see "SIGN_IN: sign in once in the pinned … tab"; on a bot check ("unusual
  traffic") that app pauses for 30 minutes. Settings → Data turns it off (and closes the pinned tabs).

## Install (about 5 minutes, just Chrome)
1. **Download the Lambda OS zip** from the [Lambda OS folder on Google Drive](https://drive.google.com/drive/folders/1RoYPMbG7DTKtXErXekowG0LrXoRWGj0s) (right-click it → **Download**).
   Its name shows the version, for example `lambda-os-0.8.9.zip`.
2. **Unzip it.** Mac: double-click it in Downloads. Windows: right-click it → **Extract All…** → **Extract**.
3. **Move the `lambda-os` folder into Documents** and keep it there: Chrome runs Lambda OS from it.
4. In Chrome, go to `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
5. Turn on **Developer mode** (top right).
6. Click **Load unpacked** (top left) and pick the `lambda-os` folder in Documents.
7. Open a new tab. If Chrome asks about the new tab page, click **Keep it**.
8. In the **Sources** row under the top bar, click anything yellow (*allow*) or red (*sign in*) to connect it.

Works on **Windows, macOS and Linux**. Technical users can `git clone https://github.com/MarshallStunt/lambda-os.git`
instead and update with the one-line command in Settings → Updates.

## Using it
- **⌘K** (Ctrl+K on Windows/Linux) or **/** opens search; **⌘J** / Ctrl+J opens the AI panel. Try `CMH01`, a hostname, `DC-33191`, `low stock at LAX01`, `203-000536`, `waiting parts on site`, `what breaches SLA today`, or start with `?` to force a question.
- **📍 Site picker** (top bar, next to search): All sites, Your sites (where you work: the site of most of your Jira tickets over the last 90 days, plus any other site with at least 25% of them, plus sites of deployments assigned to you; ★ any site to add it, or un-★ a suggestion to drop it), or any sites you tick (`only` picks one). The top cards and their charts, tickets, feed, sites list, Second brain, Health, deployments, notifications and the brief all follow it; the globe zooms to those sites; search still covers every site. Each person's choice is saved in their own browser. Devices and Waiting parts keep their 30-day chart for all sites only.
- **Second brain, Deployments and Health** each have their own **All sites / Your sites** switch (inside whatever the top-bar picker shows); each remembers its choice.
- **DC Ops / Management** (under the greeting) switches the top cards: Management shows SLA met % (last 30 days, 7-day rolling chart), sites healthy, deployments at risk and GPUs handed off this month (Atium).
- A short **tour** runs the first time; take it again from Settings → Help.
- **f** opens the Fleet globe, **b** the Second brain, **d** Deployments, **e** (or the ⤢ button) makes the middle panel fill the screen, and **Esc** closes things.
- Globe: drag to rotate, scroll to zoom, click a site for inventory and tickets.
- Graph: hover a node to trace its links, drag to pan, scroll to zoom, click to open.

## Updates
Every 2 hours Lambda OS reads the latest `manifest.json` from this repo on GitHub. When there's a newer version you get
a **NEW** badge, one notification and **⬆ Update** in the top bar. To update: download
the zip again (its name shows the version, e.g. `lambda-os-0.8.9.zip`) from the [Lambda OS folder](https://drive.google.com/drive/folders/1RoYPMbG7DTKtXErXekowG0LrXoRWGj0s), unzip it, replace the old `lambda-os` folder with the new one (same place, same name), then
click ↻ on `chrome://extensions` (or Settings → Updates → **Reload extension**). Settings and tracked deployments are
kept. Git copies: Settings → Updates has a one-line command.

To release: bump `version` in `manifest.json`, push to `main`, build the zip named with the version
(`git archive --format=zip --prefix=lambda-os/ -o ../lambda-os-$(node -p "require('./manifest.json').version").zip HEAD`), then in the
[Lambda OS Drive folder](https://drive.google.com/drive/folders/1RoYPMbG7DTKtXErXekowG0LrXoRWGj0s) upload it as a new version of the zip
(right-click → **File information** → **Manage versions**, so the file's link stays the same) and rename the file to the new
version's name. Unzipping always gives a folder called `lambda-os`, whatever the zip is called.

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
- Part names: most NetBox consumable types are bare P/Ns. The Rackside parts catalog could name them.

## Help and ideas

Questions, ideas or something not working? Message **Hadi Khodja** on Slack: https://lambda.slack.com/team/U0AAMLCUCUA
