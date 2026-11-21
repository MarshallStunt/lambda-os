# Lambda OS

> **Proprietary — Lambda internal use only.** Do not copy, redistribute, clone its functionality, or provide this code to any AI tool or service. See [LICENSE](LICENSE).

A Chrome extension that turns every new tab into a command center for Data Center Ops: every site on a satellite globe,
your tickets, deployments, spares and shipments, site health, Slack, email and calendar in one place, with search, an
optional AI assistant, alerts and a daily brief. It reads everything with **your own browser sign-ins**: no server, no
stored passwords or tokens.

**Guide for users:** the [Lambda OS page on Confluence](https://lambda-inc.atlassian.net/wiki/spaces/HardwareOps/pages/2593882138) (install, features, troubleshooting).
**Help and ideas:** message **Hadi Khodja** on [Slack](https://lambda.slack.com/team/U0AAMLCUCUA).

## Install (about 5 minutes, just Chrome)
1. Download the zip from the [Lambda OS folder on Google Drive](https://drive.google.com/drive/folders/1RoYPMbG7DTKtXErXekowG0LrXoRWGj0s) (right-click → **Download**). Its name shows the version, e.g. `lambda-os-0.14.3.zip`.
2. Unzip it and move the `lambda-os` folder into **Documents** (Chrome runs Lambda OS from it, so keep it there).
3. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the folder.
4. Open a new tab (click **Keep it** if Chrome asks). The first load shows a checklist of your apps; the tour asks which apps you have access to.

Works on Windows, macOS and Linux. Git users can `git clone` this repo instead.

## Data sources
| App | What it gives | How it's read |
|---|---|---|
| **NetBox** | Sites, racks, devices, spares, change log | Your NetBox sign-in (VPN) |
| **Jira** | DC tickets and SLAs; PMO / Cluster Intake deployments and projects | Your Jira sign-in |
| **NetSuite** | Material on hand and movements | A temporary NetSuite tab |
| **Slack** | Mentions, your channels, volunteer requests | Your Slack tab, or a small pinned one |
| **Gmail / Calendar** | Unread mail, today's meetings | Your Google sign-in (Calendar from a pinned tab) |
| **Atium** | Builds, milestones, hand-offs, purchase orders, onsite schedules | A pinned Atium tab (Okta) |
| **Grafana** | Site health, power, heat, firing hardware alerts | Your Grafana sign-in |
| **Yard Central** | Host state, pool, locks, Starbase (read-only) | A pinned Yard tab (Okta) |

Only **Jira and NetBox** are required. An app you don't have stays out of the way: it goes quiet after 3 failed sign-ins
(retried daily), or untick it in the tour or Settings → Sources.

## Features
- **Fleet globe**: satellite imagery (Esri) with a street-level map when you zoom in; site colors from tickets and Grafana health; ◎ Exact location; Dots mode works offline.
- **Site cards**: tickets, spares, NetSuite material, Atium builds and purchase orders, Grafana health, Yard totals, volunteer requests.
- **Your tickets** (left): SLA countdown, ⚠ Grafana alerts, Yard state, ⚠ In prod / 🔒 Locked filter; plus Tracking (☆ deployments), Inbox (Slack + Gmail), Volunteer and News tabs.
- **News**: the newest posts on the Lambda blog, read from its public RSS feed every 2 hours (no sign-in, no AI); the badge counts new posts. If the feed can't be read, the last posts stay with a note. Hide it in Settings → Data.
- **Linked** (bottom of every ticket, device, deployment, part and Yard cluster card): everything it's connected to, clickable: device, rack, site, cluster, people, part, deployments, Slack channels and the other tickets on the same host or rack. When you open the card, Lambda OS also asks the apps with your sign-ins: Jira links, parent and sub-tasks, any issue in any project or service desk (RMA, Shipping, Warehouse…) that mentions it, Slack messages, and the device's NetBox journal and changes (cached 5 minutes). **🧠 Show in Second brain** opens the graph centred on the item with its links lit up; click empty space to let go.
- **⏱ Trace from every card**: each card that pops up (ticket, device, deployment, part, site card, alerts, daily brief) has **⏱ Trace** in its header and a small ⏱ on every row that holds something traceable (each ticket, RMA, shipment, NetSuite document, PO, part, Slack message…), so every instance can be traced on its own; a row with several things in it asks which one.
- **⏱ Trace anything**: right-click anything on the dashboard (a ticket row, host, shipment, NetSuite document, PO, feed item, Slack message or selected text) and pick what to trace from the menu, or hover it and press **T**. It recognizes ticket and request keys (DC, RMA, SHP, WHS…), hostnames, part numbers, NetSuite documents and tracking numbers. Shift+right-click keeps the browser's menu.
- **⏱ Trace** (**T**, or ⏱ Trace on a ticket, device, deployment or part card): one item's whole history on a timeline (Ctrl/⌘ + scroll or pinch to zoom, drag or scroll sideways to move), in lanes per app: the ticket's life with every status / assignee change and comment, every other ticket ever filed on the same host or serial (closed ones and service desks like RMA, Shipping and Warehouse too), NetBox (added, changes by people, journal), Grafana alerts, Yard state now, Slack messages, and Atium milestones, NetSuite movements and meetings for deployments. It also picks up everything already loaded that mentions the item: the live feed, Slack mentions, unread Gmail, NetSuite movements (by document, tracking or RMA number), Atium purchase orders and meetings; tracking and RMA numbers it finds become related items you can trace next. The left column lists what's related (device, chassis and installed nodes, other tickets, RMAs, part): tick one to add its history to the same timeline, click it to trace it instead; the trail at the top steps back. Read with your sign-ins only when you open it.
- **▽ Filter** (top bar, **⌘⇧F** / Ctrl+Shift+F): one query for every list. It narrows the left-column tabs (each tab's count becomes the number of matches), the live feed, the sites list (sites with matching tickets stay) and the Deployments and Health views; rows that don't match fade in open cards and in Trace. Plain words must all match; `OR` / `|` either, `-word` / `NOT` leave out, `"…"` exact phrase, `( )` group. Fields: `site:IAD03` (contains, `*` = anything), `status=Open` (exactly), `status!=Done` (not), and `site status assignee host part priority key src from channel type project`; time: `sla<4h`, `age>7d`, `updated<1d`; flags: `is:breached is:mine is:unassigned is:open is:done is:locked is:prod is:tracked is:late`, `has:alert has:part has:host`. It suggests fields and values as you type, says what's wrong when a query can't be read, **?** shows examples, and **☆** saves a filter for one click later. Esc or ✕ clears; it stays while the tab is open.
- **🛠 Maintenance windows** (Jira MAINT, "Maintenance Requests"). **Where to look:** the **🛠 Maint** button in the top bar (count = now or within 24 h; red when there's an emergency) opens the list grouped as Emergency · Happening now · Next 24 hours · Later, with ★ on your sites; also ⌘K → "maintenance". each request's type, urgency, region and window (Not Before → Not After, deadline). Placed at a site by the site code in its region or cluster (`staging-sjc02-cl01` → SJC02) or the city in a cloud region (`us-sanjose-1` → San Jose), and on hosts when it names hostnames (its host list is usually cloud host ids, which can't be matched to hostnames yet). Shown on site cards and the sites list (🛠 = now or within 24 h), on tickets and device cards for affected hosts, as a group at the top of the Deployments view, and as a lane in Trace; click one for its card. Alerts: an emergency request or a window opening within the hour at your sites, and one of your tickets' hosts going into maintenance (Settings → Alerts). Filter: `is:maint`, `has:maint`, `type:"Power Cycle"`.
- **Six top cards** for everyone: open tickets, SLA breached, deployments, GPUs, devices, waiting parts, each with ▲/▼ vs yesterday and a 30-day chart.
- **Views**: Fleet (**F**), Second brain (**B**, 2D/3D graph of everything linked, including Yard clusters), Deployments (**D**, timeline by project), Health (**H**, every site's leaks, breakers, PDUs, power shelves, hardware faults, heat, network), Trace (**T**, one item's history). **E** enlarges the middle panel.
- **📍 Site picker**: all sites, your sites (from your Jira history, deployments and ★ stars) or any you tick. Each view also has its own All sites / Your sites switch.
- **Live feed**: Jira, NetBox, Grafana, Atium, NetSuite, Slack and Gmail events; click one for its details and links.
- **⌘K search** (or **/**) for sites, hosts, tickets, deployments, parts and questions; **✨ Ask AI** (⌘J) answers through the **Claude, ChatGPT or Gemini you're already signed in to in this browser**, with no API key. By default it picks automatically: whichever of them you're signed in to (Claude first), checked quietly with your browser sign-in; Settings → AI shows what it found and lets you pin one. You only type in Ask AI: Lambda OS sends the question with privacy masking (names, hosts, serials… hidden before sending) through that chat in one minimized window, reused for every question, and shows the answer here as it's written. Follow-ups stay in the same chat. If the chat needs you (signed out, a "verify you're human" check), its window comes up and Ask AI says so; once you're in, Lambda OS minimizes it, brings you back and asks your question. If it fails (usage limit, window closed, the site changed), the answer shows the site's message with **Try again**, **Show** and **Ask ChatGPT / Gemini instead**. It reads the chat page, so a site redesign can break it until Lambda OS is updated.
- **Alerts and daily brief**: SLA, new assignments, tracked deployments, parts on hand, Atium milestones and late POs, Grafana hardware alerts, leaks and breakers, Yard warnings (host still in production, locked by someone else, still locked by you), and apps that stop updating.
- **Lambda Rackside**: open a ticket in Rackside from its details, and Rackside can open tickets here.

## How it loads
- **New tabs open instantly** from the last saved data; a background refresh runs every 10 minutes.
- **One load at a time** across all tabs and the background (a lock renewed every 5 s, taken over after 20 s if its tab dies). Each app is saved as soon as it's in.
- **First load**: a checklist of each app; the dashboard opens as soon as Jira or NetBox is ready, panels say what's still loading, and the page fills in after you pause.
- **When an app needs you** (sign in, allow access, or Jira/NetBox down): a bar under the top bar with **Sign in** (noticed automatically when it works), **I don't have it** and **Later**. Other hiccups are retried; after 30 minutes a quiet grey "old data" pill appears.
- **App tabs live in one hidden window** (`apptabs.js`): Slack, Calendar, Atium, Yard, temporary NetSuite/Grafana tabs and the Ask AI chat all open in a single minimized window (marked by a small "Lambda OS background tabs" page), never in your tab bar. Every part of Lambda OS shares that window, also after a restart; copies are merged, stray duplicate tabs closed, Gmail/Yard tabs closed after an hour unused, the window closed when nothing needs it, and minimized again if it's left open. Tabs are healed automatically (reloaded if discarded, sent home if they wander, refreshed every 30 min); your own tabs are never touched.
- **Removing and re-adding** Lambda OS starts completely fresh; use ↻ on `chrome://extensions` to pick up new code without losing anything.

## Updates and releasing
Lambda OS checks `manifest.json` on GitHub every 2 hours and shows **⬆ Update** when there's a newer version. To update,
download the new zip, replace the `lambda-os` folder (same place, same name) and click ↻ on `chrome://extensions`.

To release:
1. Bump `version` in `manifest.json`, commit and push to `main`.
2. `git archive --format=zip --prefix=lambda-os/ -o ../lambda-os-$(node -p "require('./manifest.json').version").zip HEAD`
3. In the Drive folder, right-click the zip → **File information** → **Manage versions** → **Upload new version** (keeps the link), then rename it to the new version.
4. Update the Confluence page and its screenshots (demo data).

## Files
| File | What it is |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `newtab.html/.css/.js` | The dashboard (no libraries: MV3 pages can't load remote code) |
| `live.js` | Readers for every app, the shared load lock, the snapshot in `chrome.storage.local` |
| `data.js` | Turns the snapshot (or demo data) into sites, tickets, devices, KPIs, feed; first-load screen |
| `apptabs.js` | App tabs in one hidden, minimized window: shared, de-duplicated, kept healthy |
| `hidden.html` | The marker page that identifies that window |
| `alerts.js` | Alert rules, daily history, the brief, Yard checks |
| `smart.js` | Rule helpers (the old API-based AI step is off; Ask AI uses the browser chat) |
| `ai.js` | Ask AI setup and privacy masking |
| `webchat.js` | Sends Ask AI questions through the signed-in Claude / ChatGPT / Gemini chat and reads the answers back |
| `background.js` | Background refresh, alerts, the brief, fresh-install cleanup, Rackside link |
| `settings.html/.js` | Settings: sources, appearance, AI, privacy, alerts, backup |
| `updates.js` | New-version check |
| `news.js` | Lambda blog posts for the News tab (RSS) |
| `theme.js`, `world.js`, `icons/` | Theme before first paint, land outlines (Natural Earth), icons |

## How the data maps
- **Sites**: NetBox sites. `ATL01 - …` is a data center, `POP - YUL51` a POP, `prem-*` on-prem; planned and retired sites are drawn hollow.
- **Tickets**: Jira fields "Data Center Location(s)", "Hostname", "Cabinet Name", "Rack Position", "Lambda Part Number" and "Time to resolution" (SLA), matched by name.
- **Spares**: NetBox inventory consumables per storage location, rolled up per site; "low" means at or below the alert quantity.
- **Feed**: people's changes only (automation accounts are filtered out).
