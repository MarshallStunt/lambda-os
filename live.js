// Live data from NetBox, Jira, Slack, Gmail, Google Calendar and NetSuite, using the user's own browser sessions
// (no tokens stored). Runs in the new-tab page and in the service worker (importScripts), so no DOM here.
// refresh() fetches every enabled source in parallel and stores a normalized snapshot in chrome.storage.local:
//   { at, sources: {netbox, jira, slack, gmail, calendar, netsuite}, nb, jira, slack, gmail, calendar, netsuite }
// A source that fails keeps its last good data (marked stale). data.js turns the snapshot into what the dashboard draws.

const LambdaLive = (() => {
  const DEFAULTS = {
    mode: 'live',                                          // live | demo
    jiraUrl: 'https://lambda-inc.atlassian.net',
    netboxUrl: 'https://netbox.prod.lambdalabs.cloud',
    netboxToken: '',                                       // optional; the NetBox browser login is used otherwise
    fleetJql: 'project = DC AND statusCategory != Done ORDER BY updated DESC',
    mineJql: 'project = DC AND statusCategory != Done AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser())',
    // Projects = PMO initiatives, deployments = PMO epics (+ Cluster Intake epics). Workstreams are their child epics.
    portfolioJql: 'project = PMO AND issuetype in (Initiative, Epic) AND statusCategory != Done ORDER BY updated DESC',
    intakeJql: 'project = CI AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC',
    maxTickets: 3000,
    refreshMinutes: 10,                                    // background refresh; 0 = only when I click ↻
    appTabs: true,                                         // keep pinned background tabs for apps read from a page (apptabs.js)
    netsuiteUrl: 'https://4930164.app.netsuite.com',
    atiumUrl: 'https://kelsier.aws.lambdalabs.cloud',
    yardUrl: 'https://yard-central.aws.lambdalabs.cloud',   // Yard Central: each host's state, pool, lock and Starbase (read-only)
    grafanaUrl: 'https://grafana.aws.lambdalabs.cloud',        // Grafana (production): site power, temperatures, firing hardware alerts         // Atium (Infrastructure Intelligence): builds, site assets
    nsOnHandSearch: '3151',                                // ***Cloud: Material On Hand
    nsMovesSearch: '3152',                                 // ***Cloud: Material Transactions Full List
    calendarEmail: '',                                     // defaults to the Gmail / Jira account
    sources: { netbox: true, jira: true, slack: true, gmail: true, calendar: true, netsuite: true, atium: true, grafana: true, yard: true },
    // AI assistant: provider 'off' | 'anthropic' | 'openai' | 'gemini' | 'local'. Keys stay in this browser and are never put in backups.
    ai: { provider: 'off', keys: { anthropic: '', openai: '', gemini: '', local: '' },
      models: { anthropic: 'claude-opus-5-5', openai: '', gemini: 'gemini-flash-lite-latest', local: '' },
      localUrl: 'http://localhost:1234/v1', effort: 'medium' },
    // What may reach the AI. mode: 'redact' (mask the items below) | 'off' (send as-is) | 'local' (never call an AI)
    privacy: { mode: 'redact', people: true, emails: true, network: true, serials: true, hostnames: false,
      messages: true, calendar: false, money: true, words: '' },
    // Appearance: theme 'system' | 'light' | 'dark'; accent; density; text size; glow; motion
    look: { theme: 'system', accent: 'cyan', density: 'comfortable', text: 'normal', glow: 'on', motion: 'full' },
    // Desktop alerts (checked after every background refresh) and the daily brief.
    alerts: { enabled: true, slaHours: 4, myTickets: true, assigned: true, tracked: true, parts: true, mentions: false, siteCritical: false, sources: true, atium: true, grafana: true, siteHealth: true, yard: true,
      quietFrom: '', quietTo: '', badge: true },
    brief: { enabled: true, time: '08:30', days: 'weekdays', autoOpen: true, ai: false },
    // Smart processing: 'local' (rules only) or 'ai' (your AI provider settles what the rules can't, when it's available).
    smart: { mode: 'local', volunteer: true, matching: true, priority: true, slack: false, backup: true },
  };
  // Jira fields are found by name, so nothing depends on this Jira's customfield IDs.
  const JIRA_FIELDS = {
    site: 'Data Center Location(s)', host: 'Hostname', cabinet: 'Cabinet Name', ru: 'Rack Position',
    devLink: 'Device Link', pn: 'Lambda Part Number', devType: 'Device Type', sla: 'Time to resolution',
    plannedStart: 'Planned Start', plannedEnd: 'Planned End', completion: 'Completion Date', projectType: 'Project Type',
    deployType: 'Deployment Type', size: 'Size', gpuType: 'GPU Type', slack: 'Slack Channel',
  };
  const TICKET_FIELDS = ['site', 'host', 'cabinet', 'ru', 'devLink', 'pn', 'devType', 'sla'];
  const PORTFOLIO_FIELDS = ['site', 'plannedStart', 'plannedEnd', 'completion', 'projectType', 'deployType', 'size', 'gpuType', 'slack'];

  const trim = u => String(u || '').trim().replace(/\/+$/, '');
  async function settings() {
    const { settings: s } = await chrome.storage.local.get('settings');
    const ai = { ...DEFAULTS.ai, ...(s?.ai || {}) };
    ai.keys = { ...DEFAULTS.ai.keys, ...(s?.ai?.keys || {}) }; ai.models = { ...DEFAULTS.ai.models, ...(s?.ai?.models || {}) };
    return { ...DEFAULTS, ...(s || {}), sources: { ...DEFAULTS.sources, ...(s?.sources || {}) }, ai,
      privacy: { ...DEFAULTS.privacy, ...(s?.privacy || {}) }, look: { ...DEFAULTS.look, ...(s?.look || {}) },
      alerts: { ...DEFAULTS.alerts, ...(s?.alerts || {}) }, brief: { ...DEFAULTS.brief, ...(s?.brief || {}) }, smart: { ...DEFAULTS.smart, ...(s?.smart || {}) } };
  }

  class AuthError extends Error { constructor(msg, login) { super(msg); this.auth = true; this.login = login; } }
  const decode = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

  async function getJson(url, { headers = {}, login, name }) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, credentials: headers.Authorization ? 'omit' : 'include' });
    } catch (e) {
      throw new Error(`Can't reach ${name} (${e.message}). Are you on the VPN?`);
    }
    const type = res.headers.get('content-type') || '';
    if (res.status === 401 || res.status === 403 || /\/login/.test(res.url) || (res.ok && type.includes('text/html'))) {
      throw new AuthError(`Not signed in to ${name}.`, login);
    }
    if (!res.ok) throw new Error(`${name} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  }

  /* ---------------- NetBox ---------------- */
  // ~97% of NetBox changes come from automation accounts (podcrawler, nexus…); the feed shows people only.
  const isPerson = c => /@/.test(c.user_name || '');
  const nbHeaders = s => { const t = (s.netboxToken || '').trim(); return t ? { Authorization: t.startsWith('nbt_') ? `Bearer ${t}` : `Token ${t}` } : {}; };
  async function netbox(s, progress) {
    const base = trim(s.netboxUrl), headers = nbHeaders(s);
    const get = path => getJson(base + path, { headers, login: `${base}/login/`, name: 'NetBox' });
    const all = async (path, label) => {
      let out = [], url = path;
      while (url) {
        const r = await get(url);
        out = out.concat(r.results || []);
        progress?.(`NetBox: ${out.length} ${label}`);
        url = r.next ? new URL(r.next).pathname + new URL(r.next).search : null;
      }
      return out;
    };
    const sites = await all('/api/dcim/sites/?limit=1000', 'sites'); // also proves we're signed in
    const [locations, consumables, changes] = await Promise.all([
      all('/api/dcim/locations/?limit=1000&fields=id,name,site', 'locations'),
      all('/api/plugins/inventory-consumables/consumables/?limit=1000&fields=id,consumable_type,storage_location,onsite_quantity,receiving_quantity,alert_at_quantity', 'stock lines')
        .catch(() => []),
      get('/api/core/object-changes/?limit=400&ordering=-time&fields=id,time,user_name,action,changed_object_type,changed_object_id,object_repr')
        .then(r => (r.results || []).filter(isPerson).slice(0, 40)).catch(() => []),
    ]);
    // Device history for the Devices card: how many devices were created after each of the last 30 days (one small
    // count query per day, read once a day and kept), so the card can show the count on each of those days.
    let devHist = null;
    try {
      let prev = null; try { ({ snapshot: { nb: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* none */ }
      const dk = t => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      if (prev?.devHist && dk(prev.devHist.at) === dk(Date.now())) devHist = prev.devHist;
      else {
        const days = Array.from({ length: 29 }, (_, i) => dk(Date.now() - (i + 1) * 864e5));
        const after = {};
        for (let i = 0; i < days.length; i += 6) await Promise.all(days.slice(i, i + 6).map(async d => {
          const r = await get(`/api/dcim/devices/?created__gt=${d}T23:59:59&limit=1&brief=1`); after[d] = r.count || 0; }));
        devHist = { at: Date.now(), after };
      }
    } catch { devHist = null; }
    const locSite = new Map(locations.map(l => [l.id, l.site?.name || '']));
    const types = {};
    const stock = [];
    for (const c of consumables) {
      const t = c.consumable_type || {};
      const pn = t.name || t.part_number || String(t.id);
      types[pn] ||= { pn, name: t.description || '', mfr: t.manufacturer?.name || '' };
      const onsite = Number(c.onsite_quantity) || 0, receiving = Number(c.receiving_quantity) || 0, alert = Number(c.alert_at_quantity) || 0;
      if (!onsite && !receiving && !alert) continue;
      stock.push({ site: locSite.get(c.storage_location?.id) || '', loc: c.storage_location?.name || '', pn, onsite, receiving, alert });
    }
    return {
      base,
      sites: sites.map(x => ({
        id: x.id, name: x.name, status: x.status?.value || '', facility: x.facility || '', description: x.description || '',
        address: (x.physical_address || '').replace(/\s+/g, ' ').trim(), region: x.region?.name || '', tz: x.time_zone || '',
        lat: x.latitude, lon: x.longitude, racks: x.rack_count || 0, devices: x.device_count || 0,
      })),
      stock, types, devHist,
      changes: changes.map(c => ({ at: Date.parse(c.time), user: c.user_name || '', action: c.action?.label || c.action?.value || '',
        type: String(c.changed_object_type || '').split('.').pop(), repr: c.object_repr || '', id: c.id || null, objId: c.changed_object_id || null })),
    };
  }

  /* ---------------- Jira ---------------- */
  const val = v => v == null ? '' : Array.isArray(v) ? v.map(val).filter(Boolean).join(' | ')
    : typeof v === 'object' ? String(v.value ?? v.name ?? v.displayName ?? '') : String(v);
  const filled = v => v != null && v !== '' && !(Array.isArray(v) && !v.length);
  const stripOrder = jql => String(jql).replace(/\s+ORDER\s+BY[\s\S]*$/i, '');

  // Jira can have several fields with the same name (this one has three "Hostname"s): keep all, use the first filled.
  // Fields by name. If one isn't found (renamed in Jira), Smart processing's earlier match is used when AI is on, and
  // the missing names plus the custom fields Jira has now are kept so the AI can match them (once) after this refresh.
  async function jiraFields(get, s) {
    const fields = await get('/rest/api/3/field');
    const ids = n => fields.filter(f => f.name.toLowerCase() === n.toLowerCase()).map(f => f.id);
    const F = Object.fromEntries(Object.entries(JIRA_FIELDS).map(([k, n]) => [k, ids(n)]));
    let ai = {}; try { const { snapshot } = await chrome.storage.local.get('snapshot'); if (s?.smart?.mode === 'ai') ai = snapshot?.smart?.cache?.fields || {}; } catch { /* none */ }
    const known = new Set(fields.map(f => f.id)), missing = [];
    for (const k of Object.keys(JIRA_FIELDS)) if (!F[k].length) { if (ai[k] && known.has(ai[k])) F[k] = [ai[k]]; else missing.push(k); }
    Object.defineProperty(F, 'miss', { enumerable: false, value: missing.length ? { missing: missing.map(k => ({ key: k, name: JIRA_FIELDS[k] })),
      candidates: fields.filter(f => f.custom).map(f => ({ id: f.id, name: f.name })).slice(0, 500) } : null });
    Object.defineProperty(F, 'aiUsed', { enumerable: false, value: Object.keys(JIRA_FIELDS).filter(k => ai[k] && F[k][0] === ai[k] && !ids(JIRA_FIELDS[k]).length) });
    return F;
  }
  const fieldList = (F, keys) => keys.flatMap(k => F[k] || []);

  async function search(get, jql, max, fields, progress, label = 'tickets') {
    let out = [], token = '';
    do {
      const r = await get(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=1000&fields=${fields}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
      out = out.concat(r.issues || []);
      progress?.(`Jira: ${out.length} ${label}`);
      token = r.nextPageToken;
    } while (token && out.length < max);
    return out;
  }
  // `parent in (…)` for many keys, a few dozen at a time, in parallel.
  async function children(get, keys, fields, max) {
    const chunks = [];
    for (let i = 0; i < keys.length; i += 40) chunks.push(keys.slice(i, i + 40));
    return (await Promise.all(chunks.map(c => search(get, `parent in (${c.join(',')})`, max, fields)))).flat();
  }

  function mapIssue(i, F, base, mine) {
    const f = i.fields, pick = k => (F[k] || []).map(id => f[id]).find(filled), sla = pick('sla')?.ongoingCycle;
    const siteV = pick('site');
    return {
      key: i.key, url: `${base}/browse/${i.key}`, summary: f.summary || '', status: f.status?.name || '',
      priority: f.priority?.name || '—', assigneeId: f.assignee?.accountId || null, assigneeName: f.assignee?.displayName || 'Unassigned',
      created: Date.parse(f.created), updated: Date.parse(f.updated),
      slaDue: sla && !sla.paused ? sla.breachTime?.epochMillis ?? null : null, slaPaused: !!sla?.paused, slaBreached: !!sla?.breached,
      siteRaw: (Array.isArray(siteV) ? siteV.map(val) : [val(siteV)]).filter(Boolean),
      host: val(pick('host')).split(/[\s,|]+/)[0], cabinet: val(pick('cabinet')),
      ru: parseInt(val(pick('ru')), 10) || null, devLink: val(pick('devLink')),
      pn: val(pick('pn')).split(/[\s,|]+/)[0], devType: val(pick('devType')),
      mine: mine.has(i.key),
    };
  }

  // Projects (PMO initiatives) and deployments (PMO epics + Cluster Intake epics), with workstreams and progress.
  async function portfolio(get, F, s, base, progress) {
    const pf = ['summary', 'status', 'issuetype', 'parent', 'assignee', 'duedate', 'updated', 'created', ...fieldList(F, PORTFOLIO_FIELDS)].join(',');
    const [items, intake, watched] = await Promise.all([
      search(get, s.portfolioJql, 1500, pf, progress, 'projects & deployments'),
      s.intakeJql ? search(get, s.intakeJql, 800, pf).catch(() => []) : [],
      search(get, `(${stripOrder(s.portfolioJql)}) AND watcher = currentUser()`, 1500, 'summary').catch(() => []),
    ]);
    const isInit = i => /initiative/i.test(i.fields.issuetype?.name || '');
    const epics = [...items, ...intake].filter(i => !isInit(i));
    progress?.('Jira: workstreams');
    const kids = await children(get, epics.map(i => i.key), 'summary,status,issuetype,project,parent,duedate,assignee', 5000);
    const isEpic = k => k.fields.issuetype?.hierarchyLevel === 1 || /epic/i.test(k.fields.issuetype?.name || '');
    const ws = kids.filter(isEpic);
    const grand = ws.length ? await children(get, ws.map(k => k.key), 'status,parent', 20000) : [];
    const isDone = x => x.fields.status?.statusCategory?.key === 'done';
    const tally = new Map();
    for (const g of grand) { const k = g.fields.parent?.key, t = tally.get(k) || { total: 0, done: 0 }; t.total++; if (isDone(g)) t.done++; tally.set(k, t); }
    const byParent = new Map();
    for (const k of kids) {
      const p = k.fields.parent?.key, e = byParent.get(p) || { ws: [], tasks: { total: 0, done: 0 } };
      if (isEpic(k)) {
        const t = tally.get(k.key) || { total: 0, done: 0 };
        e.ws.push({ key: k.key, url: `${base}/browse/${k.key}`, project: k.fields.project?.key || '', summary: k.fields.summary || '', status: k.fields.status?.name || '',
          cat: k.fields.status?.statusCategory?.key || '', due: k.fields.duedate || '', assigneeName: k.fields.assignee?.displayName || '', ...t });
      } else { e.tasks.total++; if (isDone(k)) e.tasks.done++; }
      byParent.set(p, e);
    }
    const watchedSet = new Set(watched.map(i => i.key));
    const map = (i, source) => {
      const f = i.fields, pick = k => (F[k] || []).map(id => f[id]).find(filled), siteV = pick('site'), kids = byParent.get(i.key) || { ws: [], tasks: { total: 0, done: 0 } };
      return {
        key: i.key, url: `${base}/browse/${i.key}`, source, kind: isInit(i) ? 'project' : 'deployment', summary: f.summary || '',
        status: f.status?.name || '', cat: f.status?.statusCategory?.key || '', parentKey: f.parent?.key || '', parentSummary: f.parent?.fields?.summary || '',
        assigneeId: f.assignee?.accountId || null, assigneeName: f.assignee?.displayName || 'Unassigned',
        created: Date.parse(f.created), updated: Date.parse(f.updated), due: f.duedate || '',
        siteRaw: (Array.isArray(siteV) ? siteV.map(val) : [val(siteV)]).filter(Boolean),
        plannedStart: val(pick('plannedStart')), plannedEnd: val(pick('plannedEnd')), completion: val(pick('completion')),
        projectType: val(pick('projectType')), deployType: val(pick('deployType')), size: val(pick('size')), gpuType: val(pick('gpuType')),
        slack: val(pick('slack')), watched: watchedSet.has(i.key), workstreams: kids.ws, tasks: kids.tasks,
      };
    };
    return [...items.map(i => map(i, 'PMO')), ...intake.map(i => map(i, 'CI'))];
  }

  // Tickets closed in the last 31 days as [created, resolved, key]. Jira closes ~2,000 a month at 100 per page, so the
  // full read happens once a day; every other refresh only asks for what closed since the last one and merges it in.
  async function closedTickets(get, jql, slaIds = [], F = {}) {
    let prev = null; try { ({ snapshot: { jira: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* none yet */ }
    const now = Date.now(), cut = now - 31 * 864e5, old = prev?.closed30, at = prev?.closed30At || 0, fullAt = prev?.closed30Full || 0;
    // [created, resolved, key, SLA deadline, site values, hostname] (the deadline rebuilds SLA breached; the site and
    // host let the top cards' charts follow the site picker)
    const slaOf = f => { for (const id of slaIds) { const v = f[id]; const c = v?.completedCycles?.at?.(-1) || v?.ongoingCycle; const t = c?.breachTime?.epochMillis; if (t) return t; } return 0; };
    const siteIds = F.site || [], hostIds = F.host || [], first = (f, ids) => ids.map(id => f[id]).find(filled);
    const fields = ['created', 'resolutiondate', ...slaIds, ...siteIds, ...hostIds].join(',');
    const row = i => { const sv = first(i.fields, siteIds);
      return [Date.parse(i.fields.created), Date.parse(i.fields.resolutiondate), i.key, slaOf(i.fields), (Array.isArray(sv) ? sv.map(val) : [val(sv)]).filter(Boolean), val(first(i.fields, hostIds)).split(/[\s,|]+/)[0] || '']; };
    let rows, full = fullAt;
    if (old && now - fullAt < 864e5 && old.every(x => x.length === 6)) {
      const mins = Math.ceil((now - at) / 60e3) + 10;
      const fresh = (await search(get, `${jql.replace(/resolved >= -31d$/, '')}resolved >= "-${mins}m"`, 2000, fields, null, 'closed tickets')).map(row);
      const byKey = new Map(old.map(x => [x[2], x])); fresh.forEach(x => byKey.set(x[2], x));
      rows = [...byKey.values()];
    } else { rows = (await search(get, jql, 6000, fields, null, 'closed tickets')).map(row); full = now; }
    const out = rows.filter(([c, r]) => c && r && r >= cut); out.fullAt = full;
    return out;
  }
  // Deployment epics closed in the last 31 days ([created, resolved, summary]), so Active deployments and GPUs in
  // deployments can rebuild their 30 days: a deployment counts on the days between its creation and its close.
  async function closedEpics(get, s) {
    const noDone = j => stripOrder(j).replace(/\s+AND\s+statusCategory\s*!=\s*Done/i, '').replace(/statusCategory\s*!=\s*Done\s+AND\s+/i, '');
    const jqls = [s.portfolioJql, s.intakeJql].filter(Boolean).map(j => `(${noDone(j)}) AND resolved >= -31d`);
    const rows = (await Promise.all(jqls.map(j => search(get, j, 1000, 'summary,created,resolutiondate,issuetype').catch(() => [])))).flat();
    return rows.filter(i => !/initiative/i.test(i.fields.issuetype?.name || '')).map(i => [Date.parse(i.fields.created), Date.parse(i.fields.resolutiondate), i.fields.summary || '']).filter(([c, r]) => c && r);
  }
  // Where you work: the DC tickets assigned to you at any point in the last 90 days (closed ones too), by their site
  // value or hostname. Lambda OS turns this into "Your sites" in the site picker. Read once a day and kept until tomorrow.
  async function workHistory(get, s, F) {
    let prev = null; try { ({ snapshot: { jira: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* none */ }
    const dk = t => new Date(t).toDateString();
    if (prev?.workHist && dk(prev.workHist.at) === dk(Date.now())) return prev.workHist;
    const fleet = stripOrder(s.fleetJql).replace(/\s+AND\s+statusCategory\s*!=\s*Done/i, '').replace(/statusCategory\s*!=\s*Done\s+AND\s+/i, '');
    const jql = `(${fleet}) AND assignee WAS currentUser() AND updated >= -90d`;
    const siteIds = F.site || [], hostIds = F.host || [], first = (f, ids) => ids.map(id => f[id]).find(filled);
    const rows = await search(get, jql, 3000, [...siteIds, ...hostIds].join(',') || 'summary', null, 'of your tickets');
    const counts = {};
    for (const i of rows) {
      const sv = first(i.fields, siteIds), raws = (Array.isArray(sv) ? sv.map(val) : [val(sv)]).filter(Boolean);
      const key = raws[0] || `host:${val(first(i.fields, hostIds)).split(/[\s,|]+/)[0] || ''}`;
      if (key !== 'host:') counts[key] = (counts[key] || 0) + 1;
    }
    return { at: Date.now(), total: rows.length, counts, days: 90 };
  }
  // Waiting on parts / RMA for each of the last 29 days, from Jira's history search ("status WAS IN (...) ON date").
  // Each count takes a few seconds, so this runs once a day (6 at a time) and is kept until tomorrow.
  async function waitingHistory(base, s, issues) {
    let prev = null; try { ({ snapshot: { jira: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* none */ }
    const dk = t => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    if (prev?.waitHist && dk(prev.waitHist.at) === dk(Date.now())) return prev.waitHist;
    const project = (stripOrder(s.fleetJql).match(/project\s*=\s*"?([A-Z][A-Z0-9_]+)"?/i) || [])[1];
    let names = [...new Set(issues.map(i => i.fields?.status?.name).filter(n => /part|rma/i.test(n || '')))];
    // plus statuses Smart processing sorted as "waiting on parts" (names the rule doesn't recognise)
    try { const { snapshot: sp } = await chrome.storage.local.get('snapshot'); if (s.smart?.mode === 'ai') names = [...new Set([...names, ...Object.entries(sp?.smart?.cache?.status || {}).filter(([, c]) => c === 'waiting_parts').map(([nm]) => nm)])]; } catch { /* none */ }
    if (project) try {
      const st = await getJson(`${base}/rest/api/3/project/${project}/statuses`, { login: base, name: 'Jira' });
      names = [...new Set([...names, ...st.flatMap(t => t.statuses.map(x => x.name)).filter(n => /part|rma/i.test(n))])];
    } catch { /* keep what the open tickets show */ }
    if (!names.length) return null;
    const scope = stripOrder(s.fleetJql).replace(/\s+AND\s+statusCategory\s*!=\s*Done/i, '').replace(/statusCategory\s*!=\s*Done\s+AND\s+/i, '');
    const count = async day => {
      const r = await fetch(`${base}/rest/api/3/search/approximate-count`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
        body: JSON.stringify({ jql: `(${scope}) AND status WAS IN (${names.map(n => JSON.stringify(n)).join(', ')}) ON "${day}"` }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).count;
    };
    const days = Array.from({ length: 29 }, (_, i) => dk(Date.now() - (i + 1) * 864e5)), counts = {};
    for (let i = 0; i < days.length; i += 6) await Promise.all(days.slice(i, i + 6).map(async d => { counts[d] = await count(d); }));
    return { at: Date.now(), counts, statuses: names };
  }
  async function jira(s, progress) {
    const base = trim(s.jiraUrl);
    const get = p => getJson(base + p, { login: base, name: 'Jira' });
    const me = await get('/rest/api/3/myself');
    const F = await jiraFields(get, s);
    const want = ['summary', 'status', 'priority', 'assignee', 'created', 'updated', ...fieldList(F, TICKET_FIELDS)].join(',');
    // Tickets closed in the last 31 days (only their open/close dates), so the Open DC tickets card can draw a real
    // 30-day history: open count, new and closed for every day.
    let prevJ = null; try { ({ snapshot: { jira: prevJ } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* first run */ }
    const startedAt = Date.now();
    const closedJql = `(${stripOrder(s.fleetJql).replace(/\s+AND\s+statusCategory\s*!=\s*Done/i, '').replace(/statusCategory\s*!=\s*Done\s+AND\s+/i, '')}) AND resolved >= -31d`;
    const [issues, mineIssues, port, closed, epicsClosed] = await Promise.all([
      search(get, s.fleetJql, s.maxTickets, want, progress),
      search(get, s.mineJql, 500, 'summary').catch(() => []),
      portfolio(get, F, s, base, progress).then(v => ({ v }), e => ({ e })),
      closedTickets(get, closedJql, F.sla || [], F).catch(() => null),
      closedEpics(get, s).catch(() => null),
    ]);
    const mine = new Set(mineIssues.map(i => i.key));
    return {
      base, me: { id: me.accountId, name: me.displayName, email: me.emailAddress || '', tz: me.timeZone },
      tickets: issues.map(i => mapIssue(i, F, base, mine)),
      portfolio: port.v || [], portfolioError: port.e ? String(port.e.message || port.e) : '',
      // A history read that fails keeps the last good one (the next refresh tries again) instead of wiping the charts.
      closed30: closed || prevJ?.closed30 || null, closed30At: closed ? startedAt : prevJ?.closed30At || null, closed30Full: closed ? closed.fullAt || null : prevJ?.closed30Full || null,
      closedEpics: epicsClosed || prevJ?.closedEpics || null,
      fieldMiss: F.miss, fieldsByAI: F.aiUsed,
      waitHist: await waitingHistory(base, s, issues).catch(() => prevJ?.waitHist || null),
      workHist: await workHistory(get, s, F).catch(() => prevJ?.workHist || null),
    };
  }

  /* ---------------- Access + fetching through an open tab ---------------- */
  const hostOf = o => o.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
  class AccessError extends Error { constructor(origins) { super(`Lambda OS hasn't been allowed to read ${origins.map(hostOf).join(', ')} yet. Click to allow.`); this.access = origins; } }
  async function needAccess(origins) {
    if (!chrome.permissions?.contains) return;
    if (!(await chrome.permissions.contains({ origins }))) throw new AccessError(origins);
  }
  // Runs inside a tab of that site, so the request carries the tab's own sign-in.
  async function fetchInPage(u) {
    try {
      const r = await fetch(u, { credentials: 'include' });
      return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', url: r.url, text: await r.text() };
    } catch (e) { return { error: String(e.message || e) }; }
  }
  // Fetch directly from the extension; if that isn't signed in (or is blocked), read inside a tab of the site: the user's
  // own tab if one is open, otherwise Lambda OS's self-healing pinned (or temporary) tab for that app (apptabs.js).
  async function fetchSignedIn(url, { app: appKey, name, login, good }) {
    await LambdaTabs.checkPaused(appKey, name); // backing off after a bot check: don't send anything
    const why = [];
    let res;
    try {
      const r = await fetch(url, { credentials: 'include' });
      res = { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', url: r.url, text: await r.text() };
      if (good(res)) return res;
      await LambdaTabs.botCheck(appKey, name, res);
      why.push(`direct: HTTP ${res.status}${/login|signin|ServiceLogin|accounts\.google/i.test(res.url) ? ', sent to sign-in' : ''}`);
    } catch (e) { if (e.paused) throw e; why.push(`direct: ${e.message}`); }
    const s = await settings(), app = LambdaTabs.apps(s)[appKey];
    if (!app) throw new AuthError(`Not signed in to ${name} (${why.join('; ')}).`, login);
    let out;
    try { ({ result: out } = await LambdaTabs.run(app, fetchInPage, [url], { useOwn: s.appTabs !== false })); }
    catch (e) { if (e.auth || e.paused) throw e; throw new Error(`${name}: couldn't read through a ${name} tab (${e.message}).`); }
    if (out && !out.error && good(out)) return out;
    await LambdaTabs.botCheck(appKey, name, out);
    why.push(`tab: ${out?.error || `HTTP ${out?.status}`}`);
    throw new AuthError(`Not signed in to ${name} (${why.join('; ')}).`, login);
  }

  /* ---------------- Slack (runs inside the user's open Slack tab) ---------------- */
  // Reads with the Slack tab's own session, so the extension never stores a Slack token.
  async function slackInPage(since) {
    try {
      // A tab that's just starting needs a moment to load the session; then try every signed-in workspace,
      // the one open in the tab first.
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let teams = [];
      for (let i = 0; i < 30 && !teams.length; i++) {
        const cfg = JSON.parse(localStorage.getItem('localConfig_v2') || 'null');
        teams = Object.entries(cfg?.teams || {}).filter(([, t]) => t?.token);
        if (!teams.length) await wait(500);
      }
      if (!teams.length) return { ok: false, error: /signin|workspace-signin|checkcookie/i.test(location.href) ? 'Not signed in to Slack in that tab.' : 'LOADING' };
      const here = (location.pathname.match(/\/client\/(T[A-Z0-9]+)/) || [])[1];
      teams.sort(([a], [b]) => (b === here) - (a === here));
      let team = null;
      for (const [, t] of teams) {
        const fd = new FormData(); fd.append('token', t.token);
        const r = await (await fetch('/api/auth.test', { method: 'POST', body: fd, credentials: 'include' })).json().catch(() => ({}));
        if (r.ok) { team = t; break; }
      }
      if (!team) return { ok: false, error: 'Not signed in to Slack in that tab.' };
      const call = async (m, p = {}) => {
        const fd = new FormData(); fd.append('token', team.token);
        for (const [k, v] of Object.entries(p)) fd.append(k, v);
        const r = await (await fetch('/api/' + m, { method: 'POST', body: fd, credentials: 'include' })).json();
        if (!r.ok) throw new Error(`${m}: ${r.error}`);
        return r;
      };
      const clean = t => String(t || '').replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1').replace(/<@[A-Z0-9]+>/g, '@someone')
        .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1').replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1')
        .replace(/<!([a-z]+)>/g, '@$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const me = await call('auth.test');
      const found = await call('search.messages', { query: `<@${me.user_id}>`, count: since ? 20 : 40, sort: 'timestamp' });
      const mentions = (found.messages?.matches || []).map(m => ({
        at: Math.round(parseFloat(m.ts) * 1000), channel: m.channel?.name || '', channelId: m.channel?.id || '', isDm: !!(m.channel?.is_im || m.channel?.is_mpim),
        user: m.username || m.user_name || '', text: clean(m.text).slice(0, 280), link: m.permalink || '',
      })).filter(m => !since || m.at > since);
      if (since) return { ok: true, mentions };
      let channels = [], cursor = '';
      do {
        const r = await call('users.conversations', { types: 'public_channel,private_channel', limit: 1000, exclude_archived: true, cursor });
        channels = channels.concat(r.channels || []);
        cursor = r.response_metadata?.next_cursor || '';
      } while (cursor && channels.length < 5000);
      // Volunteer requests: call-outs for people to travel to another site's deployment, plus links to a site's Atium
      // onsite schedule (where volunteers sign up). Last 45 days; the dashboard decides which ones are real requests.
      const after = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10), seen = new Set(), volunteer = [];
      for (const q of ['volunteer', 'volunteers', 'onsite-schedule', '"extra hands"', '"need help" onsite', '"anyone available"', '"head over"', '"come out" help']) {
        const r = await call('search.messages', { query: `${q} after:${after}`, count: 40, sort: 'timestamp' }).catch(() => null);
        for (const m of r?.messages?.matches || []) {
          const id = (m.channel?.id || '') + m.ts;
          if (seen.has(id) || m.channel?.is_im || m.channel?.is_mpim) continue;
          seen.add(id);
          volunteer.push({ at: Math.round(parseFloat(m.ts) * 1000), channel: m.channel?.name || '', channelId: m.channel?.id || '',
            user: m.username || m.user_name || '', text: clean(m.text).slice(0, 600), link: m.permalink || '',
            atiumSites: [...new Set([...String(m.text || '').matchAll(/\/sites\/(\d+)\/deployment\/onsite-schedule/g)].map(x => Number(x[1])))] });
        }
      }
      return {
        ok: true, me: { id: me.user_id, name: me.user }, url: String(me.url || '').replace(/\/$/, ''), team: team.name, mentions, volunteer,
        channels: channels.map(c => ({ id: c.id, name: c.name, members: c.num_members || 0, topic: String(c.topic?.value || '').slice(0, 140), purpose: String(c.purpose?.value || '').slice(0, 200) })),
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }
  async function slack(since = 0) {
    await needAccess(['https://app.slack.com/*']);
    const s = await settings(), app = LambdaTabs.apps(s).slack;
    const read = () => LambdaTabs.run(app, slackInPage, [since], { useOwn: s.appTabs !== false });
    let result, own, tab;
    try {
      ({ result, own, tab } = await read());
      // Still starting up, or the stored session looks stale: reload our own tab once and look again before deciding
      // anything (a tab you're using is never reloaded). Only a real sign-in page counts as signed out.
      if (!result?.ok && own && !tab.active) { await LambdaTabs.reload(app, tab); ({ result, own, tab } = await read()); }
    } catch (e) { if (e.auth || e.paused) throw e; throw new Error(`Slack: couldn't read through the Slack tab (${e.message}).`); }
    if (result?.error === 'LOADING') throw new Error('Slack is still loading in its tab; trying again next refresh.');
    if (!result?.ok && own && /not signed in/i.test(result?.error || '')) throw new AuthError('SIGN_IN: sign in once in the pinned Slack tab', app.url);
    if (!result?.ok) throw new Error(`Slack: ${result?.error || 'the Slack tab did not answer. Reload it and try again.'}`);
    return result;
  }

  /* ---------------- Gmail (unread inbox via the Atom feed) ---------------- */
  const tag = (x, t) => decode((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
  async function gmail() {
    await needAccess(['https://mail.google.com/*']);
    const x = (await fetchSignedIn('https://mail.google.com/mail/u/0/feed/atom', { app: 'gmail', name: 'Gmail', login: 'https://mail.google.com/', good: r => r.ok && /<feed/.test(r.text) })).text;
    return {
      email: (tag(x, 'title').match(/[\w.+-]+@[\w.-]+/) || [])[0] || '',
      unread: Number((x.match(/<fullcount>(\d+)/) || [])[1]) || 0,
      entries: x.split('<entry>').slice(1).map(e => ({
        title: tag(e, 'title') || '(no subject)', summary: tag(e, 'summary').slice(0, 240), from: tag(e, 'name'), fromEmail: tag(e, 'email'),
        at: Date.parse(tag(e, 'issued') || tag(e, 'modified')) || Date.now(),
        link: decode((e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || 'https://mail.google.com/'),
      })),
    };
  }

  /* ---------------- Google Calendar (read from Lambda OS's pinned Calendar tab) ----------------
     Google's agenda feed now answers automated requests with an "unusual traffic" page, so Lambda OS reads the normal
     Calendar page (schedule view) in its own pinned tab instead. That page keeps itself up to date, so reading it sends
     Google no extra requests; apptabs.js refreshes the tab every 30 minutes. */
  // Runs inside the Calendar tab: each event button has a screen-reader label like
  // "9:30am to 10am, Title, Name, Accepted, Location, November 16, 2026" or "All day, Title, …, November 13 – 16, 2026".
  async function readGoogleCalendar() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let els = [];
    for (let i = 0; i < 30; i++) {
      els = [...document.querySelectorAll('[data-eventid][role="button"][aria-label]')];
      if (els.length || (i > 12 && document.querySelector('[role="main"]'))) break;
      await wait(500);
    }
    const DATE = /,\s*([A-Z][a-z]+ \d{1,2}(?:\s*[–-]\s*(?:[A-Z][a-z]+ )?\d{1,2})?,\s*\d{4})\s*$/;
    const out = [], seen = new Set();
    for (const el of els) {
      const label = el.getAttribute('aria-label') || '';
      if (/^working location/i.test(label)) continue;
      const dm = label.match(DATE); if (!dm) continue;
      const parts = label.slice(0, dm.index).split(/,\s*/);
      const allDay = /^all day$/i.test(parts[0]);
      const tm = !allDay && parts[0].match(/^(\d{1,2}(?::\d{2})?\s?[ap]m)\s+to\s+(\d{1,2}(?::\d{2})?\s?[ap]m)$/i);
      if (!allDay && !tm) continue;
      const title = parts[1] || '(no title)';
      const day = dm[1].replace(/\s*[–-]\s*(?:[A-Z][a-z]+ )?\d{1,2}(?=,)/, ''); // "November 13 – 16, 2026" → "November 13, 2026"
      const key = title + day + (tm ? tm[1] : 'all');
      if (seen.has(key)) continue; seen.add(key);
      out.push({ title, date: dm[1], day, time: tm ? tm[1] : '', end: tm ? tm[2] : '', allDay,
        status: parts.find(p => /^(Accepted|Declined|Tentative|Needs RSVP|Organizer)$/i.test(p)) || '' });
    }
    return { ok: true, url: location.href, events: out };
  }
  // "9:30am" / "12pm" on "November 16, 2026" → ms
  function eventTime(day, time) {
    const m = String(time || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i), d = new Date(day);
    if (isNaN(d)) return null;
    if (m) { let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; d.setHours(h, Number(m[2] || 0), 0, 0); }
    return d.getTime();
  }
  async function calendar(s, email) {
    await needAccess(['https://calendar.google.com/*']);
    const app = LambdaTabs.apps(s).calendar;
    let result;
    try { ({ result } = await LambdaTabs.run(app, readGoogleCalendar, [], { useOwn: s.appTabs !== false })); }
    catch (e) { if (e.auth || e.paused) throw e; throw new Error(`Google Calendar: couldn't read the Calendar tab (${e.message}).`); }
    if (!result?.ok) throw new Error('Google Calendar: the Calendar tab did not answer; trying again next refresh.');
    const who = s.calendarEmail || email || '';
    const events = result.events.map(e => {
      const at = eventTime(e.day, e.allDay ? '' : e.time), d = at ? new Date(at) : null;
      return { title: e.title, date: e.date, time: e.allDay ? '' : e.time, end: e.end, allDay: e.allDay, status: e.status, at,
        link: d ? `https://calendar.google.com/calendar/u/0/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : app.url };
    }).filter(e => e.at && !/^declined$/i.test(e.status)).sort((a, b) => a.at - b.at);
    return { email: who, events: events.slice(0, 60) };
  }

  /* ---------------- NetSuite (CSV export of saved searches) ---------------- */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const hi = rows.findIndex(r => r.length >= 3 && r.filter(Boolean).length >= 3); // skip the title lines NetSuite puts first
    if (hi < 0) return [];
    const head = rows[hi].map(h => h.trim());
    return rows.slice(hi + 1).filter(r => r.length >= 3).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  async function netsuite(s, progress) {
    const base = trim(s.netsuiteUrl);
    let origin; try { origin = new URL(base).origin; } catch { throw new Error(`NetSuite address “${base}” isn't a valid URL (Settings).`); }
    await needAccess([origin + '/*']);
    const csv = async id => {
      const r = await fetchSignedIn(`${base}/app/common/search/searchresults.nl?searchid=${encodeURIComponent(id)}&csv=Export&OfficeXML=F&pdf=&size=&twbx=F&report=&grid=&dle=T&searchtype=Custom`, {
        app: 'netsuite', name: 'NetSuite', login: `${base}/app/center/card.nl`, good: r => r.ok && /comma-separated|csv/i.test(r.type) });
      return parseCsv(r.text);
    };
    progress?.('NetSuite: material on hand');
    const col = (row, ...re) => { for (const k of Object.keys(row)) if (re.some(r => r.test(k))) return row[k]; return ''; };
    const [onhand, moves] = await Promise.all([csv(s.nsOnHandSearch), s.nsMovesSearch ? csv(s.nsMovesSearch).catch(() => []) : []]);
    return {
      base,
      onhand: onhand.map(r => ({ item: col(r, /^item$/i), legacy: col(r, /legacy/i).replace(/^- None -$/, ''), name: col(r, /display name|description/i),
        qty: Number(col(r, /on hand/i).replace(/,/g, '')) || 0, loc: col(r, /location/i) })).filter(r => r.item),
      moves: moves.map(r => ({ date: col(r, /^date$/i), at: Date.parse(col(r, /^date$/i)) || 0, type: col(r, /^type$/i), doc: col(r, /document/i),
        deployment: col(r, /^deployment$/i), dcLoc: col(r, /^dc location$/i), from: col(r, /from location/i), to: col(r, /to location/i),
        status: col(r, /shipment status/i), rma: col(r, /rma/i), tracking: col(r, /tracking/i) })).filter(r => r.doc),
    };
  }

  /* ---------------- Atium (runs inside an Atium tab, with that tab's own Okta sign-in) ----------------
     Atium keeps its sign-in in the page, so like Slack it's read from inside an Atium tab (yours, or Lambda OS's pinned
     one). The token is used only inside that tab and never stored by Lambda OS. Two requests per refresh.
     Atium's access token lasts an hour and the Atium page only renews it when it makes a request itself, which an idle
     pinned tab never does. So, like the Atium page, on a 401 this renews it with Atium's own /api/auth/refresh and saves
     the result back where Atium keeps it; only if that fails is it a real "sign in". One reader for both jobs:
     what = 'portfolio' (sites + builds, every refresh) or 'pos' (one site's purchase orders, when its card opens). */
  async function atiumInPage(what = 'portfolio', siteId = null) {
    try {
      const KEY = 'kelsier_okta_auth', wait = ms => new Promise(r => setTimeout(r, ms));
      const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
      let auth = null;
      for (let i = 0; i < 30 && !auth?.access_token; i++) { auth = stored(); if (!auth?.access_token) await wait(500); }
      if (!auth?.access_token) return { ok: false, error: /okta|login|signin/i.test(location.href) ? 'Not signed in to Atium in that tab.' : 'LOADING' };
      let renewing = null;
      const renew = () => renewing ||= (async () => {
        // A page that just loaded with an expired token renews it itself. Okta accepts each renewal only once, so give
        // the page a moment first and use its new token; only renew ourselves if nothing changes.
        const changed = () => { const c = stored(); return c?.access_token && c.access_token !== auth.access_token ? c : null; };
        for (let i = 0; i < 8 && !changed(); i++) await wait(400);
        if (changed()) { auth = changed(); return true; }
        const cur = stored() || auth;
        if (!cur.refresh_token) return false;
        const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: cur.refresh_token }) });
        if (!r.ok) { await wait(800); if (changed()) { auth = changed(); return true; } return false; } // lost the race: the page's renewal won
        const nu = await r.json();
        if (!nu?.access_token) return false;
        auth = { ...cur, ...nu, refresh_token: nu.refresh_token ?? cur.refresh_token };
        localStorage.setItem(KEY, JSON.stringify(auth)); // same place and shape the Atium page saves it
        return true;
      })();
      const get = async path => {
        for (let tries = 0; ; tries++) {
          const r = await fetch(path, { headers: { Authorization: 'Bearer ' + auth.access_token } });
          if (r.status === 401 && tries === 0 && await renew().catch(() => false)) continue;
          if (r.status === 401) throw Object.assign(new Error('Not signed in to Atium in that tab (session expired).'), { auth: true });
          if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
          return r.json();
        }
      };
      if (what === 'onsite') {
        // Who is signed up to be on site (Atium Onsite Schedule) from a week ago to 4 weeks ahead, for each site asked.
        const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), bySite = {};
        for (const id of [].concat(siteId).slice(0, 8)) {
          try {
            const j = await get(`/api/ui/sites/${id}/deployment/onsite-schedule?start_date=${day(-7)}&end_date=${day(28)}`);
            bySite[id] = (j.entries || []).map(e => ({ name: e.user_name, date: e.schedule_date, hours: e.hours || 0 }));
          } catch (e) { if (e.auth) throw e; bySite[id] = null; }
        }
        return { ok: true, base: location.origin, me: auth.user?.name || '', bySite };
      }
      if (what === 'pos') {
        // Atium pages at 100 orders / 200 lines; read at most 5 pages of each. No prices: receiving progress and dates.
        const all = async (path, key, size) => {
          const out = []; let total = Infinity;
          for (let off = 0; off < total && off < size * 5; off += size) {
            const j = await get(`/api/ui/sites/${siteId}/${path}?limit=${size}&offset=${off}`);
            out.push(...(j[key] || [])); total = j.total ?? 0;
            if (!(j[key] || []).length) break;
          }
          return out;
        };
        const [pos, items] = await Promise.all([all('purchase-orders', 'purchase_orders', 100), all('purchase-orders/items', 'items', 200)]);
        const lines = new Map();
        for (const it of items) { if (!lines.has(it.purchase_id)) lines.set(it.purchase_id, []); lines.get(it.purchase_id).push(it); }
        const min = xs => xs.filter(Boolean).sort()[0] || null;
        return {
          ok: true, base: location.origin, siteId, url: `${location.origin}/sites/${siteId}/purchase-orders`,
          pos: pos.map(p => {
            const open = (lines.get(p.purchase_id) || []).filter(l => l.status !== 'complete');
            const kinds = {}; for (const l of open) kinds[l.kind || 'item'] = (kinds[l.kind || 'item'] || 0) + 1;
            return { id: p.purchase_id, name: p.purchase_name, supplier: p.supplier_name || '', status: p.purchase_status || '', date: p.purchase_date || null,
              assets: p.total_assets || 0, assetsIn: p.received_assets || 0, consumables: p.total_consumables || 0, consumablesIn: p.received_consumables || 0,
              pct: (p.received_percent ?? 0) / 100, openLines: open.length, kinds,
              expected: min(open.map(l => l.min_expected_receipt_date || l.consumable_purchase?.expected_receipt_date)),
              promise: min(open.map(l => l.min_vendor_promise_date || l.consumable_purchase?.vendor_promise_date)) };
          }),
        };
      }
      const [sites, port] = await Promise.all([get('/api/ui/sites'), get('/api/ui/builds/portfolio')]); // a renewal is shared; Atium's site list can take ~20 s
      return {
        ok: true, base: location.origin,
        sites: (sites.sites || []).map(x => ({ id: x.id, name: x.name, slug: x.slug, assets: x.asset_count || 0, consumables: x.consumable_count || 0 })),
        builds: (port.builds || []).map(b => ({
          id: b.id, name: b.name || b.cluster_name, siteId: b.site_id, customer: b.customer_override || b.customer || '', gpuModel: b.gpu_model || b.gpu_type || '',
          planned: b.planned_gpu_qty || 0, installed: b.installed_gpu_qty || 0, gpus: b.effective_gpu_qty || b.planned_gpu_qty || 0, mw: b.mw ?? null,
          racked: b.devices_racked || 0, devices: b.devices_total || 0, validated: b.yard_validated || 0, hosts: b.yard_hosts_total || 0,
          conversion: !!b.is_conversion, epic: b.jira_epic_key || null, updated: b.updated_at || null,
          milestones: (b.milestones || []).map(m => ({ type: m.milestone_type, name: m.display_name, status: m.status,
            done: m.actual_date || m.finished_date || null, scheduled: m.scheduled_date || null })),
        })),
      };
    } catch (e) { return { ok: false, error: String(e.message || e), auth: !!e.auth }; }
  }
  // Runs one of the Atium readers in an Atium tab (yours, or our pinned one) with the usual sign-in handling.
  async function atiumRun(s, fn, args = []) {
    const app = LambdaTabs.apps(s).atium;
    if (!app) throw new Error(`Atium address “${s.atiumUrl}” isn't a valid URL.`);
    await needAccess([new URL(app.url).origin + '/*']);
    const read = () => LambdaTabs.run(app, fn, args, { useOwn: s.appTabs !== false });
    let result, own, tab;
    try {
      ({ result, own, tab } = await read());
      // Still loading, or its sign-in just expired: reload our own tab once (Atium renews its sign-in on load).
      if (!result?.ok && own && !tab.active) { await LambdaTabs.reload(app, tab); ({ result, own, tab } = await read()); }
    } catch (e) { if (e.auth || e.paused) throw e; throw new Error(`Atium: couldn't read through the Atium tab (${e.message}).`); }
    if (result?.error === 'LOADING') throw new Error('Atium is still loading in its tab; trying again next refresh.');
    if (!result?.ok && (result?.auth || /not signed in/i.test(result?.error || ''))) throw new AuthError(own ? 'SIGN_IN: sign in once in the pinned Atium tab' : 'Not signed in to Atium.', app.url);
    if (!result?.ok) throw new Error(`Atium: ${result?.error || 'the Atium tab did not answer.'}`);
    return result;
  }
  // Sites + builds every refresh; plus purchase orders for "your" sites (the dashboard keeps that list in atiumWatch:
  // sites of your tickets and tracked deployments), at most 6 sites, each re-read every 3 hours, for alerts and the brief.
  async function atium(s) {
    const result = await atiumRun(s, atiumInPage, ['portfolio']);
    let watch = [], prev = null;
    try { ({ atiumWatch: watch = [], snapshot: { atium: prev } = {} } = await chrome.storage.local.get(['atiumWatch', 'snapshot'])); } catch { /* none yet */ }
    const posBySite = {}, now = Date.now(), ids = new Set(result.sites.map(x => x.id));
    for (const id of watch.filter(id => ids.has(id)).slice(0, 6)) {
      const had = prev?.posBySite?.[id];
      if (had && now - had.at < 3 * 3600e3) { posBySite[id] = had; continue; }
      try { const r = await atiumRun(s, atiumInPage, ['pos', id]); posBySite[id] = { at: now, pos: r.pos }; }
      catch { if (had) posBySite[id] = had; } // keep the last good read; a PO read never fails the whole refresh
    }
    return { ...result, posBySite };
  }
  async function atiumOnsite(siteIds) {
    const s = await settings();
    if (s.sources?.atium === false) throw new Error('Atium is turned off in Settings.');
    return atiumRun(s, atiumInPage, ['onsite', siteIds.map(Number)]);
  }
  async function atiumPOs(siteId) {
    const s = await settings();
    if (s.sources?.atium === false) throw new Error('Atium is turned off in Settings.');
    return atiumRun(s, atiumInPage, ['pos', Number(siteId)]);
  }

  /* ---------------- Grafana (production monitoring) ----------------
     Read with your Grafana sign-in: directly first, and if that's refused, inside a temporary Grafana tab. For every
     site's metrics store ("Lambda ORD01-CL01", "…-LM01", "…-FACILITY") it asks four small instant queries: PDU power,
     hottest host inlets, firing alerts (with host, rack, U and since-when) and unreachable network devices. Self-contained,
     so the same function also runs inside a Grafana page. */
  async function grafanaRead(base) {
    try {
      base = base || location.origin;
      const get = async p => {
        const r = await fetch(base + p, { credentials: 'include', headers: { Accept: 'application/json' } });
        const type = r.headers.get('content-type') || '';
        if (r.status === 401 || r.status === 403 || /\/login/.test(r.url) || type.includes('text/html')) throw Object.assign(new Error('Not signed in to Grafana.'), { auth: true });
        if (!r.ok) throw new Error(`${p.split('?')[0]}: HTTP ${r.status}`);
        return r.json();
      };
      const dsl = await get('/api/datasources');
      const stores = dsl.filter(d => d.type === 'prometheus').map(d => ({ uid: d.uid, m: String(d.name).match(/^Lambda ([A-Z]{3}\d{2})-((?:CL|LM)\d+|FACILITY)$/) }))
        .filter(x => x.m).map(x => ({ uid: x.uid, site: x.m[1], cluster: x.m[2] }));
      const Q = {
        pdu: 'sum(st4InputCordActivePower) / 1000',
        inlet: "topk(3, max by (hostname, rack) (redfish_chassis_temperature_celsius{sensor=~'Inlet Temp|GPU Inlet Temp'} > 0))",
        alerts: 'max by (alertname, severity, hostname, rack, rack_u_position, gpu_id, team) (ALERTS_FOR_STATE)',
        unreach: "max by (hostname, rack, role) (probe_success{job='blackbox_net_network_devices'} == 0)",
      };
      const jobs = stores.flatMap(s => Object.entries(Q).map(([k, q]) => ({ s, k, q }))), done = [];
      let next = 0;
      const worker = async () => { while (next < jobs.length) { const j = jobs[next++];
        try { const r = await get(`/api/datasources/proxy/uid/${encodeURIComponent(j.s.uid)}/api/v1/query?query=${encodeURIComponent(j.q)}`); done.push({ ...j, rows: r.data?.result || [] }); }
        catch (e) { if (e.auth) throw e; done.push({ ...j, err: e.message }); } } };
      await Promise.all(Array.from({ length: 8 }, worker));
      const sites = {};
      const S = code => sites[code] ||= { pduKw: null, inlet: [], alerts: [], counts: {}, unreachable: [], clusters: [], errors: 0, board: null };
      for (const j of done) {
        const x = S(j.s.site);
        if (!x.clusters.includes(j.s.cluster)) x.clusters.push(j.s.cluster);
        if (j.err) { x.errors++; continue; }
        if (j.k === 'pdu') for (const r of j.rows) { const v = +r.value[1]; if (v > 0) x.pduKw = (x.pduKw || 0) + v; }
        if (j.k === 'inlet') for (const r of j.rows) x.inlet.push({ temp: +r.value[1], host: r.metric.hostname || '', rack: r.metric.rack || '' });
        if (j.k === 'unreach') for (const r of j.rows) x.unreachable.push({ host: r.metric.hostname || '', rack: r.metric.rack || '', role: r.metric.role || '' });
        if (j.k === 'alerts') for (const r of j.rows) {
          const m = r.metric, name = m.alertname || 'Alert';
          x.counts[name] = (x.counts[name] || 0) + 1;
          const al = { name, since: Math.round(+r.value[1] * 1000) }; // only non-empty fields, to keep the snapshot small
          for (const [k, v] of [['severity', (m.severity || '').toLowerCase()], ['host', m.hostname], ['rack', m.rack], ['u', m.rack_u_position], ['gpu', m.gpu_id], ['team', m.team]]) if (v) al[k] = v;
          x.alerts.push(al);
        }
      }
      for (const x of Object.values(sites)) {
        x.inlet.sort((a, b) => b.temp - a.temp); x.inlet = x.inlet.slice(0, 3); x.unreachable = x.unreachable.slice(0, 50);
        x.alerts.sort((a, b) => (b.severity === 'critical') - (a.severity === 'critical') || b.since - a.since); x.alerts = x.alerts.slice(0, 400); // counts keep the full totals
      }
      // Dashboards: each site's "Site Health" board (or its board in the Datacenter folder), plus the fleet-wide ones.
      const links = {};
      try {
        for (const d of await get('/api/search?type=dash-db&limit=5000')) {
          const sh = String(d.title).match(/^([A-Z]{3}\d{2})\s*-\s*Site Health$/), dc = d.folderTitle === 'Datacenter' && String(d.title).match(/^([A-Z]{3}\d{2})$/);
          if (sh) S(sh[1]).board = d.url; else if (dc && !S(dc[1]).board) S(dc[1]).board = d.url;
          for (const [k, t] of [['dcOps', 'DC Ops Status'], ['rackHealth', 'Air-Cooled Pod Floor Plan & Rack Health'], ['pdu', 'PDU Power & Environmental'], ['gpuThermal', 'GPU Thermal & Throttling'], ['repair', 'Repair Priority'], ['dcAlerts', 'Alerts: DC Alerts']])
            if (d.title === t && !links[k]) links[k] = d.url;
        }
      } catch (e) { if (e.auth) throw e; }
      for (const [k, x] of Object.entries(sites)) if (!x.clusters.length && !x.board) delete sites[k];
      // Fleet health: the same checks as the "Site Health" boards (leaks, tripped breakers, PDU alarms, power-shelf PSUs
      // at 0 W, hosts with hardware faults, hottest inlets, network devices down, devices we can't monitor), asked once
      // for every site at once from the shared "Lambda Private Cloud Metrics" store, each problem with host, rack and U.
      let fleet = null;
      const pc = dsl.find(d => d.type === 'prometheus' && /private cloud metrics/i.test(d.name));
      if (pc) {
        const HWM = [['redfish_chassis_leak_detector_health', '', 'Leak detector'], ['redfish_chassis_fan_health', '', 'Fan'], ['redfish_chassis_power_powersupply_health', '', 'PSU'],
          ['redfish_chassis_temperature_sensor_health', '', 'Temp sensor'], ['redfish_chassis_health', "chassis_id!~'HGX_GPU.*'", 'Chassis'], ['redfish_gpu_health', '', 'GPU'],
          ['redfish_gpu_memory_health', '', 'GPU memory'], ['redfish_gpu_nvlink_health', '', 'NVLink'], ['redfish_system_health_state', '', 'System'],
          ['redfish_system_processor_health_state', "processor_id!~'GPU.*'", 'CPU'], ['redfish_system_memory_health_state', "memory_id!~'GPU.*'", 'DIMM'],
          ['redfish_system_storage_drive_health_state', '', 'Drive'], ['redfish_system_ethernet_interface_health_state', '', 'NIC'], ['redfish_manager_health_state', '', 'BMC']];
        const BL = "job=~'net-snmp-entity|net-snmp-if|pdu-snmp|pdu-snmp-raritan|powershelf-snmp|redfish-gpu-hosts|redfish-nvlink-switches|redfish-weka-hosts'";
        const FQ = {
          leak: 'max by (dc, hostname, rack, rack_u_position, leak_detector_id) (redfish_chassis_leak_detector_health > 1)',
          breaker: 'max by (dc, hostname, rack, st4BranchLabel) ((st4BranchStatus >= 12) <= 13)',
          pdu: "max by (dc, hostname, rack, metric) (label_replace({__name__=~'st4InputCordStatus|st4InputCordActivePowerStatus|st4LineCurrentStatus|st4PhaseVoltageStatus|st4TempSensorStatus'} >= 8 != 15 != 16, \"metric\", \"$1\", \"__name__\", \"st4(.+)Status\") or label_replace(st4BranchStatus >= 8 != 12 != 13 != 15 != 16, \"metric\", \"Branch\", \"\", \"\") or label_replace(measurementsInletSensorState == 2 or measurementsInletSensorState == 6 or measurementsInletSensorState == 8 or measurementsInletSensorState == 11, \"metric\", \"Raritan inlet\", \"\", \"\"))",
          shelf: 'max by (dc, hostname, rack, rack_u_position, obmcPowerUnitName) (obmcPowerUnitInputPower <= 0)',
          hw: 'max by (dc, hostname, rack, rack_u_position, component) (' + HWM.map(([m, s, c]) => `label_replace(${m}${s ? '{' + s + '}' : ''} > 1, "component", "${c}", "", "")`).join(' or ') + ')',
          tray: 'topk by (dc) (10, max by (dc, hostname, rack) (redfish_telemetry_ambient_inlet_temperature_celsius > 0))',
          air: "topk by (dc) (10, max by (dc, hostname, rack) (redfish_chassis_temperature_celsius{sensor=~'Inlet Temp|GPU Inlet Temp'} > 0))",
          net: "max by (dc, hostname, rack, role) (probe_success{job='blackbox_net_network_devices'} == 0)",
          blindCount: `count by (dc, job) (up{${BL}} == 0)`,
          blind: `topk by (dc) (25, max by (dc, job, hostname, rack) (up{${BL}} == 0))`,
          power: 'sum by (dc) (st4InputCordActivePower) / 1000',
          shelfPower: 'sum by (dc) (obmcPowerUnitInputPower) / 1000',
        };
        const code = dc => (String(dc || '').match(/^[a-z]{3}\d{2}/) || [])[0]?.toUpperCase() || null;
        const fr = await Promise.all(Object.entries(FQ).map(async ([k, q]) => {
          try { return [k, (await get(`/api/datasources/proxy/uid/${encodeURIComponent(pc.uid)}/api/v1/query?query=${encodeURIComponent(q)}`)).data?.result || [], null]; }
          catch (e) { if (e.auth) throw e; return [k, [], e.message]; } }));
        fleet = { at: Date.now(), checks: {}, power: {}, errors: {} };
        for (const [k, rows, err] of fr) {
          if (err) { fleet.errors[k] = err; continue; }
          if (k === 'power' || k === 'shelfPower') { for (const x of rows) { const c = code(x.metric.dc); if (c) fleet.power[c] = (fleet.power[c] || 0) + (+x.value[1] || 0); } continue; }
          fleet.checks[k] = rows.map(x => { const m = x.metric, c = code(m.dc); if (!c) return null;
            const it = { s: c, v: +x.value[1] };
            for (const [kk, v] of [['h', m.hostname], ['r', m.rack], ['u', String(m.rack_u_position || '').replace(/\.0$/, '')],
              ['w', m.leak_detector_id || m.st4BranchLabel || m.metric || m.obmcPowerUnitName && 'PSU ' + m.obmcPowerUnitName || m.component || m.role || m.job]]) if (v) it[kk] = v;
            return it; }).filter(Boolean).slice(0, 2000);
        }
      }
      return { ok: true, base, at: Date.now(), stores: stores.length, sites, links, fleet };
    } catch (e) { return { ok: false, error: String(e.message || e), auth: !!e.auth }; }
  }
  // "Newly tripped" and "new leak" are worked out against what earlier refreshes saw (first seen times), so a breaker
  // that was already off before Lambda OS ever looked isn't called new.
  async function firstSeen(result) {
    if (!result?.fleet) return result;
    let prev = null; try { ({ snapshot: { grafana: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* none yet */ }
    const was = prev?.fleet?.seen || null, now = Date.now(), seen = {};
    // A check that failed this time keeps its earlier first-seen times, so the next good read doesn't call old ones "new".
    for (const k of ['leak', 'breaker', 'shelf']) if (!result.fleet.checks[k] && was) for (const [key, t] of Object.entries(was)) if (key.startsWith(k + '|')) seen[key] = t;
    for (const k of ['leak', 'breaker', 'shelf']) for (const it of result.fleet.checks[k] || []) {
      const key = `${k}|${it.s}|${it.h || ''}|${it.w || ''}`;
      seen[key] = was ? (was[key] ?? now) : 0; // 0 = already there the first time we looked
      if (seen[key]) it.since = seen[key];
    }
    result.fleet.seen = seen;
    return result;
  }
  async function grafana(s) {
    const base = trim(s.grafanaUrl);
    await needAccess([new URL(base).origin + '/*']);
    const direct = await grafanaRead(base);
    if (direct.ok) return firstSeen(direct);
    if (!direct.auth) throw new Error(`Grafana: ${direct.error}`);
    // Direct reading was refused (some sign-ins only work inside the page): read through a Grafana tab instead.
    const app = LambdaTabs.apps(s).grafana;
    let result;
    try { ({ result } = await LambdaTabs.run(app, grafanaRead, [''], { useOwn: s.appTabs !== false })); }
    catch (e) { if (e.auth || e.paused) throw e; throw new Error(`Grafana: couldn't read through a Grafana tab (${e.message}).`); }
    if (result?.ok) return firstSeen(result);
    if (result?.auth) throw new AuthError('Not signed in to Grafana.', `${base}/login`);
    throw new Error(`Grafana: ${result?.error || 'the Grafana tab did not answer.'}`);
  }

  /* ---------------- Yard Central (host state, pool, lock, Starbase) ---------------- */
  // Runs inside a Yard Central tab: uses the page's own sign-in, only for read-only host searches, and never returns or
  // keeps the sign-in itself. Answers are matched by exact hostname; field names are read loosely (Yard changes often).
  async function yardInPage(hosts) {
    try {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let token = null;
      for (let i = 0; i < 30 && !token; i++) { token = localStorage.getItem('token'); if (!token) await wait(500); }
      if (!token) return { ok: false, error: /login|okta|signin/i.test(location.href) ? 'Not signed in to Yard Central in that tab.' : 'LOADING' };
      const H = () => ({ Authorization: 'Bearer ' + localStorage.getItem('token'), Accept: 'application/json' });
      const get = async p => {
        const r = await fetch(p, { headers: H() });
        if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Yard Central sign-in expired.'), { auth: true });
        if (!r.ok) throw new Error(`${p.split('?')[0]}: HTTP ${r.status}`);
        return r.json();
      };
      const regs = await get('/api/v1/regions');
      const list = (Array.isArray(regs) ? regs : regs.regions || regs.results || regs.data || Object.values(regs).find(Array.isArray) || []);
      const regionIds = list.map(x => typeof x === 'string' ? x : x.id || x.key || x.name || x.region).filter(Boolean).map(x => String(x).toLowerCase());
      const scalar = v => v == null || typeof v !== 'object';
      const pick = (o, re, not) => { for (const [k, v] of Object.entries(o)) if (re.test(k) && !(not && not.test(k)) && v != null && v !== '') return scalar(v) ? v : (Array.isArray(v) ? v.join(', ') : v.name || v.username || v.id || JSON.stringify(v).slice(0, 60)); return null; };
      const rows = j => { const a = Array.isArray(j) ? j : j.results || j.items || j.data || j.hosts || Object.values(j).find(Array.isArray) || [];
        return a.flatMap(x => { const inner = x && Object.values(x).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object' && ('hostname' in v[0] || 'name' in v[0]));
          return inner ? inner.map(h => ({ region: x.region || x.name, ...h })) : [x]; }); };
      const out = {}, todo = [...hosts];
      const worker = async () => { while (todo.length) { const h = todo.shift();
        try {
          const j = await get(`/api/v1/search?q=${encodeURIComponent(h)}&endpoint=hosts&search_deep=false&include_jira=false&format=json&page=1&page_size=10&status=active,inactive,decommissioned${regionIds.length ? '&region=' + regionIds.join(',') : ''}`);
          const m = rows(j).find(x => String(pick(x, /^(hostname|host_?name|name)$/i) || '').toLowerCase() === h.toLowerCase());
          out[h] = m ? { found: true, region: pick(m, /region/i), status: pick(m, /^status$/i), state: pick(m, /state/i, /status|starbase/i), pool: pick(m, /pool/i),
            lockedBy: pick(m, /lock/i), starbase: pick(m, /starbase/i), serial: pick(m, /serial/i), type: pick(m, /type|model/i, /state/i) } : { found: false };
        } catch (e) { if (e.auth) throw e; out[h] = { error: String(e.message || e) }; } } };
      await Promise.all(Array.from({ length: 6 }, worker));
      return { ok: true, hosts: out };
    } catch (e) { return { ok: false, error: String(e.message || e), auth: !!e.auth }; }
  }
  // Which hosts to look up: your tickets' hosts first, then the most urgent ones, at most 150 per refresh; each answer
  // is kept 30 minutes, so the whole open-ticket list is covered within a few refreshes.
  async function yard(s, jr) {
    const app = LambdaTabs.apps(s).yard;
    if (!app) throw new Error(`Yard address “${s.yardUrl}” isn't a valid URL.`);
    await needAccess([new URL(app.url).origin + '/*']);
    let prev = null; try { ({ snapshot: { yard: prev } = {} } = await chrome.storage.local.get('snapshot')); } catch { /* first run */ }
    const now = Date.now(), keep = {};
    // Hosts you hold a lock on stay (and are re-checked) until you unlock them, so "still locked by you" can't go stale.
    const mine = v => typeof LambdaAlerts !== 'undefined' && v?.lockedBy && LambdaAlerts.isMe({ ME: { name: jr?.me?.name, email: jr?.me?.email } }, v.lockedBy);
    let extra = {}; try { ({ yardExtra: extra = {} } = await chrome.storage.local.get('yardExtra')); } catch { /* none */ }
    for (const [h, v] of [...Object.entries(prev?.hosts || {}), ...Object.entries(extra)]) // extra: hosts looked up on demand from lists in the dashboard
      if ((now - (v.at || 0) < 6 * 3600e3 || mine(v)) && (!keep[h] || (v.at || 0) > (keep[h].at || 0))) keep[h] = v; // older than 6h: dropped
    const tickets = [...(jr?.tickets || [])].filter(t => t.host).sort((a, b) => (b.mine - a.mine) || ((a.slaDue || 9e15) - (b.slaDue || 9e15)));
    const locks = Object.keys(keep).filter(h => mine(keep[h]));
    // First time (nothing looked up yet): just your own tickets' hosts, so Yard is ready fast; the rest fill in over the
    // next refreshes (150 at a time).
    const first = !Object.keys(keep).length, pool = first ? tickets.filter(t => t.mine) : tickets;
    const want = [...new Set([...pool.map(t => t.host.toLowerCase()), ...locks])].filter(h => !keep[h] || now - keep[h].at > 30 * 60e3).slice(0, first ? 40 : 150);
    if (!want.length) return { at: now, base: new URL(app.url).origin, hosts: keep };
    const read = () => LambdaTabs.run(app, yardInPage, [want], { useOwn: s.appTabs !== false });
    let result, own, tab;
    try {
      ({ result, own, tab } = await read());
      if (!result?.ok && own && !tab.active) { await LambdaTabs.reload(app, tab); ({ result, own, tab } = await read()); } // its sign-in renews on load
    } catch (e) { if (e.auth || e.paused) throw e; throw new Error(`Yard: couldn't read through the Yard Central tab (${e.message}).`); }
    if (result?.error === 'LOADING') throw new Error('Yard Central is still loading in its tab; trying again next refresh.');
    if (!result?.ok && result?.auth) throw new AuthError(own ? 'SIGN_IN: sign in once in the pinned Yard Central tab' : 'Not signed in to Yard Central.', app.url);
    if (!result?.ok) throw new Error(`Yard: ${result?.error || 'the Yard Central tab did not answer.'}`);
    for (const [h, v] of Object.entries(result.hosts)) if (!v.error) keep[h] = { ...v, at: now };
    return { at: now, base: new URL(app.url).origin, hosts: keep };
  }

  // On demand, for hosts listed in the dashboard (site health, search, the second brain…): up to 40 at a time, answers
  // kept 30 minutes in `yardExtra` (the next refresh folds them into the snapshot). Only when Yard is on and reachable.
  async function yardLookup(hosts) {
    const s = await settings();
    if (s.sources?.yard === false) throw new Error('Yard is turned off in Settings.');
    const app = LambdaTabs.apps(s).yard; if (!app) throw new Error('No Yard address.');
    let { yardExtra: extra = {}, snapshot } = await chrome.storage.local.get(['yardExtra', 'snapshot']);
    if (snapshot?.sources?.yard?.quiet) throw new Error('Yard is not available for you.');
    const now = Date.now(), have = h => extra[h] || snapshot?.yard?.hosts?.[h];
    const all = [...new Set(hosts.filter(Boolean).map(h => String(h).toLowerCase()))];
    const want = all.filter(h => !have(h) || now - (have(h).at || 0) > 30 * 60e3).slice(0, 40);
    if (want.length) {
      const { result } = await LambdaTabs.run(app, yardInPage, [want], { useOwn: s.appTabs !== false });
      if (!result?.ok) throw new Error(result?.error || 'Yard Central did not answer.');
      ({ yardExtra: extra = {} } = await chrome.storage.local.get('yardExtra'));
      for (const [h, v] of Object.entries(result.hosts)) if (!v.error) extra[h] = { ...v, at: now };
      for (const [h, v] of Object.entries(extra)) if (now - (v.at || 0) > 6 * 3600e3) delete extra[h];
      await chrome.storage.local.set({ yardExtra: extra });
    }
    return Object.fromEntries(all.map(h => [h, have(h)]).filter(([, v]) => v));
  }

  /* ---------------- Refresh ---------------- */
  const NAMES = { netbox: 'NetBox', jira: 'Jira', slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', netsuite: 'NetSuite', atium: 'Atium', grafana: 'Grafana', yard: 'Yard' };
  const KEYS = { netbox: 'nb', jira: 'jira', slack: 'slack', gmail: 'gmail', calendar: 'calendar', netsuite: 'netsuite', atium: 'atium', grafana: 'grafana', yard: 'yard' };
  let inflight = null;
  // A source this account doesn't have (never signed in, 3 tries in a row) goes quiet: no pill, no pinned tab, and it's
  // only tried again once a day (or when you click Check connections in Settings). One that worked before stays loud.
  const QUIET_AFTER = 3, QUIET_RETRY = 864e5, SKIP = Symbol('quiet');
  // One load at a time across every new tab and the background: whoever starts first does the work (a shared lock in
  // storage), the others wait for its result. A lock older than LOCK_MS is from a load that died (tab closed).
  const LOCK_MS = 4 * 60e3;
  const waitFinal = () => new Promise(res => {
    const done = v => { chrome.storage.onChanged.removeListener(on); clearTimeout(t); res(v); };
    const on = (ch, area) => { if (area === 'local' && ch.snapshot?.newValue && !ch.snapshot.newValue.partial) done(ch.snapshot.newValue); };
    const t = setTimeout(() => chrome.storage.local.get('snapshot').then(r => done(r.snapshot)), LOCK_MS);
    chrome.storage.onChanged.addListener(on);
  });
  function refresh(progress, opts = {}) {
    inflight ||= (async () => {
      const { refreshLock } = await chrome.storage.local.get('refreshLock');
      if (!opts.retryAll && refreshLock && Date.now() - refreshLock < LOCK_MS) { progress?.('Another Lambda OS tab is loading; waiting for it…'); return waitFinal(); }
      await chrome.storage.local.set({ refreshLock: Date.now() });
      try { return await load(progress, opts); } finally { await chrome.storage.local.remove('refreshLock').catch(() => {}); }
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function load(progress, opts) {
    {
      const s = await settings();
      const { snapshot: prev } = await chrome.storage.local.get('snapshot');
      const resting = k => !opts.retryAll && prev?.sources?.[k]?.quiet && Date.now() - (prev.sources[k].triedAt || 0) < QUIET_RETRY;
      const on = k => s.sources[k] !== false;
      const off = Promise.resolve(undefined);
      // Off: undefined. Resting (quiet, tried within the day): SKIP, so it isn't even started. Otherwise: read it.
      // A tab-related hiccup (tab still loading, page didn't answer) gets one more try after a short pause before the
      // source counts as failing; sign-in, access and paused problems don't (only you can fix those).
      const RETRY = /tab|loading|didn.t answer|did not answer|timed? ?out|starting/i;
      const once = async f => { try { return await f(); } catch (e) {
        if (e?.auth || e?.access || e?.paused || !RETRY.test(String(e?.message || e))) throw e;
        await new Promise(r => setTimeout(r, 2500)); return f(); } };
      // opts.onApp hears each app start and finish (the first-load screen shows them as a checklist).
      const tell = (k, state, why) => { try { opts.onApp?.({ key: k, name: NAMES[k], state, why }); } catch { /* display only */ } };
      const go = (k, f) => { if (!on(k)) return off; if (resting(k)) return Promise.resolve(SKIP);
        tell(k, 'loading');
        const p = once(f); p.then(() => tell(k, 'ready'), e => tell(k, e?.auth ? 'signin' : e?.access ? 'allow' : 'failed', String(e?.message || e))); return p; };
      const val = v => v === SKIP ? null : v;
      const nbP = go('netbox', () => netbox(s, progress));
      const jrP = go('jira', () => jira(s, progress));
      const gmP = go('gmail', () => gmail());
      const calP = go('calendar', () => Promise.allSettled([gmP, jrP]).then(([g, j]) => calendar(s, val(g.value)?.email || val(j.value)?.me?.email)));
      const results = {
        netbox: nbP, jira: jrP, gmail: gmP, calendar: calP,
        slack: go('slack', () => slack()),
        netsuite: go('netsuite', () => netsuite(s, progress)),
        atium: go('atium', () => atium(s)),
        grafana: go('grafana', () => grafana(s)),
        yard: go('yard', () => jrP.catch(() => null).then(j => yard(s, val(j)))), // needs the ticket hosts first
      };
      // Records one source's outcome in a snapshot (shared by the early core snapshot and the full one).
      const record = (snapshot, k, r) => {
        const key = KEYS[k];
        if (r.status === 'fulfilled' && r.value === SKIP) { snapshot.sources[k] = prev.sources[k]; snapshot[key] = prev?.[key] || null; return; } // resting quiet source
        if (r.status === 'fulfilled' && r.value === undefined) { snapshot.sources[k] = { off: true, name: NAMES[k] }; snapshot[key] = null; return; }
        if (r.status === 'fulfilled') { snapshot.sources[k] = { ok: true, at: Date.now(), name: NAMES[k], everOk: true }; snapshot[key] = r.value; return; }
        const was = prev?.sources?.[k];
        snapshot.sources[k] = { ok: false, name: NAMES[k], error: r.reason?.message || String(r.reason), auth: !!r.reason?.auth, login: r.reason?.login || '', access: r.reason?.access || null,
          failingSince: was && !was.ok && !was.off ? (was.failingSince || prev.at) : Date.now(), // first failure of this outage
          everOk: !!was?.everOk || !!prev?.[key], fails: (was && !was.ok && !was.off ? was.fails || 0 : 0) + 1, triedAt: Date.now() };
        const sk = snapshot.sources[k];
        if (!sk.everOk && sk.auth && sk.fails >= QUIET_AFTER) sk.quiet = true; // never signed in here: probably no account
        snapshot[key] = prev?.[key] || null; // keep the last good data, shown as stale
        // "Showing data from …" = the last refresh that worked, which stays put while the outage lasts
        if (snapshot[key]) snapshot.sources[k].staleAt = was?.ok ? was.at : (was?.staleAt || prev?.at);
      };
      // Each app is saved as soon as it's done (marked partial until all are), so new tabs and a first load show what's
      // in already, and one slow app never holds up the others. Apps still loading keep their previous data meanwhile.
      const working = { at: Date.now(), version: 2, sources: {}, partial: true, smart: prev?.smart || null };
      for (const k of Object.keys(results)) if (prev?.sources?.[k]) { working.sources[k] = prev.sources[k]; working[KEYS[k]] = prev[KEYS[k]] ?? null; }
      let writing = null, again = false;
      const flush = async () => { if (writing) { again = true; return; }
        writing = chrome.storage.local.set({ snapshot: { ...working, at: Date.now() } }).catch(() => {});
        await writing; writing = null; if (again) { again = false; flush(); } };
      for (const [k, p] of Object.entries(results)) Promise.resolve(p).then(v => ({ status: 'fulfilled', value: v }), e => ({ status: 'rejected', reason: e }))
        .then(r => { if (r.value === SKIP) return; record(working, k, r); if (working.nb || working.jira) flush(); });
      const settled = await Promise.allSettled(Object.values(results));
      const snapshot = { at: Date.now(), version: 2, sources: {} };
      Object.keys(results).forEach((k, i) => record(snapshot, k, settled[i]));
      // Optional AI step on what the rules couldn't settle (see smart.js). Never blocks the data: on any problem the
      // earlier answers are kept and the local rules decide the rest.
      if (typeof LambdaSmart !== 'undefined') {
        try { snapshot.smart = await LambdaSmart.enrich(snapshot, s, prev?.smart, progress || (() => {})); }
        catch (e) { snapshot.smart = { ...(prev?.smart || {}), at: Date.now(), live: false, why: `AI step failed (${e.message}). Using the local rules.` }; }
      } else snapshot.smart = prev?.smart || null;
      while (writing) await writing;
      await chrome.storage.local.set({ snapshot });
      return snapshot;
    }
  }

  // New feed items since `since` (ms) from every connected source.
  async function pollFeed(since) {
    const s = await settings(), out = [];
    const mins = Math.max(1, Math.ceil((Date.now() - since) / 60000) + 1);
    const jbase = trim(s.jiraUrl), nbase = trim(s.netboxUrl), on = k => s.sources[k] !== false;
    await Promise.allSettled([
      on('jira') && (async () => {
        const jql = `((${stripOrder(s.fleetJql)}) OR (${stripOrder(s.portfolioJql)})) AND updated >= "-${mins}m" ORDER BY updated DESC`;
        const r = await getJson(`${jbase}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,updated,assignee`, { login: jbase, name: 'Jira' });
        for (const i of r.issues || []) {
          const at = Date.parse(i.fields.updated);
          if (at > since) out.push({ src: 'jira', at, ref: i.key, text: `${i.key} · ${i.fields.status?.name} — ${i.fields.summary}`,
            meta: { key: i.key, status: i.fields.status?.name || '', summary: i.fields.summary || '', assignee: i.fields.assignee?.displayName || '', url: `${jbase}/browse/${i.key}` } });
        }
      })(),
      on('netbox') && (async () => {
        const r = await getJson(`${nbase}/api/core/object-changes/?limit=300&ordering=-time&time_after=${encodeURIComponent(new Date(since).toISOString())}&fields=id,time,user_name,action,changed_object_type,changed_object_id,object_repr`, { headers: nbHeaders(s), login: nbase, name: 'NetBox' });
        for (const c of (r.results || []).filter(isPerson)) {
          const at = Date.parse(c.time);
          if (at > since) out.push({ src: 'netbox', at, ref: null, text: `${c.user_name} ${String(c.action?.label || '').toLowerCase()} ${String(c.changed_object_type || '').split('.').pop()} ${c.object_repr}`,
            meta: { user: c.user_name || '', action: c.action?.label || '', type: String(c.changed_object_type || '').split('.').pop(), repr: c.object_repr || '', id: c.id, objId: c.changed_object_id, base: nbase } });
        }
      })(),
      on('slack') && (async () => {
        const r = await slack(since);
        for (const m of r.mentions) out.push({ src: 'slack', at: m.at, url: m.link, text: `${m.isDm ? 'DM' : '#' + m.channel} · ${m.user}: ${m.text}`, meta: m });
      })(),
      on('gmail') && (async () => {
        const g = await gmail();
        for (const e of g.entries) if (e.at > since) out.push({ src: 'mail', at: e.at, url: e.link, text: `${e.from}: ${e.title}`, meta: e });
      })(),
    ].filter(Boolean));
    return out.sort((a, b) => b.at - a.at);
  }

  // Every site each source needs, so Settings and the dashboard can ask for all of them in one click.
  function originsFor(s) {
    const o = k => { try { return new URL(s[k]).origin + '/*'; } catch { return null; } };
    const on = k => s.sources?.[k] !== false;
    return [on('jira') && o('jiraUrl'), on('netbox') && o('netboxUrl'), on('netsuite') && o('netsuiteUrl'), on('atium') && o('atiumUrl'), on('grafana') && o('grafanaUrl'), on('yard') && o('yardUrl'),
      on('slack') && 'https://app.slack.com/*', on('gmail') && 'https://mail.google.com/*', on('calendar') && 'https://calendar.google.com/*'].filter(Boolean);
  }
  return { DEFAULTS, NAMES, settings, refresh, pollFeed, originsFor, atiumPOs, atiumOnsite, yardLookup };
})();

if (typeof self !== 'undefined') self.LambdaLive = LambdaLive;
