# Chrome Web Store listing (private to lambdal.com)

Lambda OS is published as a **Private** item on the Chrome Web Store, visible only to Lambda's Google Workspace
(`lambdal.com`), under a publisher owned by IT / Business Technology. IT force-installs it from Google Admin; Chrome
updates it by itself. Copy the fields below into the Developer Dashboard.

## Package

```bash
v=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
git archive --format=zip -o ../lambda-os-store-$v.zip HEAD -- . ':!README.md' ':!LICENSE' ':!.gitignore' ':!STORE.md' ':!PRIVACY.md'
```

`manifest.json` must be at the top of the zip (no folder around it), which this command does. Bump the version in
`manifest.json` for every upload; the store refuses a version it already has.

## Store listing

- **Name:** Lambda OS
- **Summary (132 max):** DC Ops command center for Lambda: sites, tickets, deployments, inventory and alerts from NetBox, Jira, Slack, Grafana and more.
- **Category:** Workflow & Planning
- **Language:** English
- **Description:**

  Lambda OS turns every new tab into a command center for Lambda Data Center Operations.

  • Every site on a globe, with health, open tickets, spares and builds
  • Your tickets first, with SLA countdowns, Grafana alerts and Yard host state
  • Deployments with Jira progress, Atium builds and purchase orders
  • Maintenance windows from Jira MAINT
  • Trace any ticket, host, part or shipment across apps on one timeline
  • Filter every list with one query; search everything with ⌘K
  • Ask AI about the loaded data through the Claude, ChatGPT or Gemini you're already signed in to (names, hosts and serials masked)

  It reads NetBox, Jira, Slack, Gmail, Google Calendar, NetSuite, Atium, Grafana and Yard Central with your own browser
  sign-ins. Nothing is stored on a server and no passwords or tokens are kept. For Lambda employees only.

- **Screenshots (1280×800):** `store/1-dashboard.png`, `store/2-ask-ai.png`, `store/3-maintenance.png` (demo data)
- **Small promo tile (440×280):** `store/promo-440x280.png`
- **Icon:** `icons/icon128.png`

## Privacy practices

- **Single purpose:** A new-tab dashboard that shows Lambda Data Center Operations data (sites, tickets, deployments, inventory, alerts) from the user's own work apps in one place.

- **Permission justifications:**
  - `storage`: saves the user's settings and the last loaded dashboard data in the browser, so new tabs open instantly.
  - `alarms`: refreshes the dashboard data and the daily brief on a schedule.
  - `tabs`: opens tickets, sites and apps the user clicks, and finds the user's own open Slack/Calendar/Atium tab to read from instead of opening another.
  - `scripting`: reads data from an open, signed-in page of the user's own apps (Slack, Google Calendar, Atium, Yard, NetSuite) and from the user's chosen AI chat, where those apps offer no API for a browser sign-in.
  - `declarativeNetRequestWithHostAccess`: removes browser-only headers from the extension's own API requests to the listed work apps, so those apps treat them as API calls.
  - `notifications`: desktop alerts for breached SLAs, new tickets, parts arriving and maintenance windows, which the user can turn off.
  - **Host permissions:** each listed host is one of the work apps the dashboard reads (Jira, NetBox, Slack, Gmail, Google Calendar, NetSuite, Atium, Grafana, Yard Central), the Lambda blog for the News tab, GitHub for the version check of non-store copies, and claude.ai / chatgpt.com / gemini.google.com for Ask AI through the user's own signed-in chat.
  - **Optional `https://*/*`:** asked only if the user enters a different address for one of their apps (for example another Jira or NetBox URL) in Settings.
  - **Optional `management`:** asked once, and dropped right after, to find the companion Lambda Rackside extension when the user clicks "Open in Rackside".
- **Remote code:** No. All code is in the package; nothing is downloaded and run.
- **Data usage:** It handles personally identifiable information, authentication information (the browser's existing sign-ins, never stored), personal communications (Slack mentions, email subjects) and website content. It's used only to show the user their own dashboard. It is not sold, not transferred to third parties except the AI chat the user chooses to ask (with names, emails, hosts and serials masked), and not used for anything unrelated to the dashboard or for creditworthiness or lending.
- **Privacy policy URL:** the published `PRIVACY.md` (for example on GitHub Pages under `lambdal`).
