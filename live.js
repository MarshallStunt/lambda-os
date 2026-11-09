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
    netsuiteUrl: 'https://4930164.app.netsuite.com',
    nsOnHandSearch: '3151',                                // ***Cloud: Material On Hand
    nsMovesSearch: '3152',                                 // ***Cloud: Material Transactions Full List
    calendarEmail: '',                                     // defaults to the Gmail / Jira account
    sources: { netbox: true, jira: true, slack: true, gmail: true, calendar: true, netsuite: true },
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
    alerts: { enabled: true, slaHours: 4, myTickets: true, assigned: true, tracked: true, parts: true, mentions: false, siteCritical: false, sources: true,
      quietFrom: '', quietTo: '', badge: true },
    brief: { enabled: true, time: '08:30', days: 'weekdays', autoOpen: true, ai: false },
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
      alerts: { ...DEFAULTS.alerts, ...(s?.alerts || {}) }, brief: { ...DEFAULTS.brief, ...(s?.brief || {}) } };
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
      get('/api/core/object-changes/?limit=400&ordering=-time&fields=id,time,user_name,action,changed_object_type,object_repr')
        .then(r => (r.results || []).filter(isPerson).slice(0, 40)).catch(() => []),
    ]);
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
      stock, types,
      changes: changes.map(c => ({ at: Date.parse(c.time), user: c.user_name || '', action: c.action?.label || c.action?.value || '',
        type: String(c.changed_object_type || '').split('.').pop(), repr: c.object_repr || '' })),
    };
  }

  /* ---------------- Jira ---------------- */
  const val = v => v == null ? '' : Array.isArray(v) ? v.map(val).filter(Boolean).join(' | ')
    : typeof v === 'object' ? String(v.value ?? v.name ?? v.displayName ?? '') : String(v);
  const filled = v => v != null && v !== '' && !(Array.isArray(v) && !v.length);
  const stripOrder = jql => String(jql).replace(/\s+ORDER\s+BY[\s\S]*$/i, '');

  // Jira can have several fields with the same name (this one has three "Hostname"s): keep all, use the first filled.
  async function jiraFields(get) {
    const fields = await get('/rest/api/3/field');
    const ids = n => fields.filter(f => f.name.toLowerCase() === n.toLowerCase()).map(f => f.id);
    return Object.fromEntries(Object.entries(JIRA_FIELDS).map(([k, n]) => [k, ids(n)]));
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

  async function jira(s, progress) {
    const base = trim(s.jiraUrl);
    const get = p => getJson(base + p, { login: base, name: 'Jira' });
    const me = await get('/rest/api/3/myself');
    const F = await jiraFields(get);
    const want = ['summary', 'status', 'priority', 'assignee', 'created', 'updated', ...fieldList(F, TICKET_FIELDS)].join(',');
    const [issues, mineIssues, port] = await Promise.all([
      search(get, s.fleetJql, s.maxTickets, want, progress),
      search(get, s.mineJql, 500, 'summary').catch(() => []),
      portfolio(get, F, s, base, progress).then(v => ({ v }), e => ({ e })),
    ]);
    const mine = new Set(mineIssues.map(i => i.key));
    return {
      base, me: { id: me.accountId, name: me.displayName, email: me.emailAddress || '', tz: me.timeZone },
      tickets: issues.map(i => mapIssue(i, F, base, mine)),
      portfolio: port.v || [], portfolioError: port.e ? String(port.e.message || port.e) : '',
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
  // Fetch directly from the extension; if that isn't signed in (or is blocked), retry inside an open tab of the site.
  async function fetchSignedIn(url, { name, tabPattern, login, good }) {
    const why = [];
    let res;
    try {
      const r = await fetch(url, { credentials: 'include' });
      res = { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', url: r.url, text: await r.text() };
      if (good(res)) return res;
      why.push(`direct: HTTP ${res.status}${/login|signin|ServiceLogin|accounts\.google/i.test(res.url) ? ', sent to sign-in' : ''}`);
    } catch (e) { why.push(`direct: ${e.message}`); }
    const [tab] = await chrome.tabs.query({ url: tabPattern }).catch(() => []);
    if (!tab) throw new AuthError(`${name}: not signed in from the extension, and no ${name} tab is open to read through (${why.join('; ')}). Open ${name} in a tab and refresh.`, login);
    let out;
    try { [{ result: out } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fetchInPage, args: [url] }); }
    catch (e) { throw new Error(`${name}: couldn't read through the open tab (${e.message}).`); }
    if (out && !out.error && good(out)) return out;
    why.push(`tab: ${out?.error || `HTTP ${out?.status}`}`);
    throw new AuthError(`Not signed in to ${name} (${why.join('; ')}).`, login);
  }

  /* ---------------- Slack (runs inside the user's open Slack tab) ---------------- */
  // Reads with the Slack tab's own session, so the extension never stores a Slack token.
  async function slackInPage(since) {
    try {
      const cfg = JSON.parse(localStorage.getItem('localConfig_v2') || 'null');
      const team = cfg && Object.values(cfg.teams || {})[0];
      if (!team?.token) return { ok: false, error: 'Not signed in to Slack in that tab.' };
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
      return {
        ok: true, me: { id: me.user_id, name: me.user }, url: String(me.url || '').replace(/\/$/, ''), team: team.name, mentions,
        channels: channels.map(c => ({ id: c.id, name: c.name, members: c.num_members || 0, topic: String(c.topic?.value || '').slice(0, 140), purpose: String(c.purpose?.value || '').slice(0, 200) })),
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }
  async function slackTab() {
    await needAccess(['https://app.slack.com/*']);
    const [tab] = await chrome.tabs.query({ url: 'https://app.slack.com/*' });
    if (!tab) throw new AuthError('Open Slack (app.slack.com) in a Chrome tab to connect it.', 'https://app.slack.com/client');
    return tab;
  }
  async function slack(since = 0) {
    const tab = await slackTab();
    let result;
    try { [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: slackInPage, args: [since] }); }
    catch (e) { throw new Error(`Slack: couldn't read through the open Slack tab (${e.message}). Reload that tab and try again.`); }
    if (!result?.ok) throw new Error(`Slack: ${result?.error || 'the Slack tab did not answer. Reload it and try again.'}`);
    return result;
  }

  /* ---------------- Gmail (unread inbox via the Atom feed) ---------------- */
  const tag = (x, t) => decode((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
  async function gmail() {
    await needAccess(['https://mail.google.com/*']);
    const x = (await fetchSignedIn('https://mail.google.com/mail/u/0/feed/atom', { name: 'Gmail', tabPattern: 'https://mail.google.com/*', login: 'https://mail.google.com/', good: r => r.ok && /<feed/.test(r.text) })).text;
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

  /* ---------------- Google Calendar (agenda view of the user's own calendar) ---------------- */
  function parseWhen(dateText, timeText) {
    const day = new Date(dateText.replace(/^\w+\s+/, '')); // "Mon Nov 9, 2026" → "Nov 9, 2026"
    if (isNaN(day)) return { at: null, allDay: true };
    const m = String(timeText || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!m) return { at: day.getTime(), allDay: true };
    let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
    day.setHours(h, Number(m[2] || 0), 0, 0);
    return { at: day.getTime(), allDay: false };
  }
  async function calendar(s, email) {
    const who = s.calendarEmail || email;
    if (!who) throw new Error('Calendar needs your email address (Settings).');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await needAccess(['https://calendar.google.com/*']);
    const r = await fetchSignedIn(`https://calendar.google.com/calendar/htmlembed?src=${encodeURIComponent(who)}&mode=AGENDA&ctz=${encodeURIComponent(tz)}`, {
      name: 'Google Calendar', tabPattern: 'https://calendar.google.com/*', login: 'https://calendar.google.com/',
      good: r => r.ok && !/ServiceLogin|accounts\.google\.com/.test(r.url) && /class="(date-section|no-events|view-container)|<body/.test(r.text) });
    const x = r.text;
    if (!/date-section/.test(x)) return { email: who, events: [] };
    const events = [];
    for (const sec of x.split('class="date-section').slice(1)) {
      const date = decode((sec.match(/<div class="date">([^<]+)</) || [])[1] || '');
      for (const row of sec.match(/<tr class="event">[\s\S]*?<\/tr>/g) || []) {
        const time = decode((row.match(/class="event-time">([^<]*)</) || [])[1] || '');
        const title = decode(((row.match(/<span class="event-summary">([\s\S]*?)<\/span>/) || [])[1] || '').replace(/<[^>]+>/g, '')).trim();
        let link = decode((row.match(/<a[^>]*href="([^"]+)"/) || [])[1] || '');
        if (link && !/^https?:/.test(link)) link = 'https://calendar.google.com' + (link.startsWith('/') ? '' : '/calendar/') + link;
        events.push({ date, time, title, link: link || 'https://calendar.google.com/', ...parseWhen(date, time) });
      }
    }
    return { email: who, events };
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
        name: 'NetSuite', tabPattern: origin + '/*', login: `${base}/app/center/card.nl`, good: r => r.ok && /comma-separated|csv/i.test(r.type) });
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

  /* ---------------- Refresh ---------------- */
  const NAMES = { netbox: 'NetBox', jira: 'Jira', slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', netsuite: 'NetSuite' };
  const KEYS = { netbox: 'nb', jira: 'jira', slack: 'slack', gmail: 'gmail', calendar: 'calendar', netsuite: 'netsuite' };
  let inflight = null;
  function refresh(progress) {
    inflight ||= (async () => {
      const s = await settings();
      const { snapshot: prev } = await chrome.storage.local.get('snapshot');
      const on = k => s.sources[k] !== false;
      const off = Promise.resolve(undefined);
      const nbP = on('netbox') ? netbox(s, progress) : off;
      const jrP = on('jira') ? jira(s, progress) : off;
      const gmP = on('gmail') ? gmail() : off;
      const calP = on('calendar') ? Promise.allSettled([gmP, jrP]).then(([g, j]) => calendar(s, g.value?.email || j.value?.me?.email)) : off;
      const results = Object.fromEntries(Object.entries({
        netbox: nbP, jira: jrP, gmail: gmP, calendar: calP,
        slack: on('slack') ? slack() : off,
        netsuite: on('netsuite') ? netsuite(s, progress) : off,
      }));
      const settled = await Promise.allSettled(Object.values(results));
      const snapshot = { at: Date.now(), version: 2, sources: {} };
      Object.keys(results).forEach((k, i) => {
        const r = settled[i], key = KEYS[k];
        if (r.status === 'fulfilled' && r.value === undefined) { snapshot.sources[k] = { off: true, name: NAMES[k] }; snapshot[key] = null; return; }
        if (r.status === 'fulfilled') { snapshot.sources[k] = { ok: true, at: Date.now(), name: NAMES[k] }; snapshot[key] = r.value; return; }
        const was = prev?.sources?.[k];
        snapshot.sources[k] = { ok: false, name: NAMES[k], error: r.reason?.message || String(r.reason), auth: !!r.reason?.auth, login: r.reason?.login || '', access: r.reason?.access || null,
          failingSince: was && !was.ok && !was.off ? (was.failingSince || prev.at) : Date.now() }; // first failure of this outage
        snapshot[key] = prev?.[key] || null; // keep the last good data, shown as stale
        // "Showing data from …" = the last refresh that worked, which stays put while the outage lasts
        if (snapshot[key]) snapshot.sources[k].staleAt = was?.ok ? was.at : (was?.staleAt || prev?.at);
      });
      await chrome.storage.local.set({ snapshot });
      return snapshot;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  // New feed items since `since` (ms) from every connected source.
  async function pollFeed(since) {
    const s = await settings(), out = [];
    const mins = Math.max(1, Math.ceil((Date.now() - since) / 60000) + 1);
    const jbase = trim(s.jiraUrl), nbase = trim(s.netboxUrl), on = k => s.sources[k] !== false;
    await Promise.allSettled([
      on('jira') && (async () => {
        const jql = `((${stripOrder(s.fleetJql)}) OR (${stripOrder(s.portfolioJql)})) AND updated >= "-${mins}m" ORDER BY updated DESC`;
        const r = await getJson(`${jbase}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,updated`, { login: jbase, name: 'Jira' });
        for (const i of r.issues || []) {
          const at = Date.parse(i.fields.updated);
          if (at > since) out.push({ src: 'jira', at, ref: i.key, text: `${i.key} · ${i.fields.status?.name} — ${i.fields.summary}` });
        }
      })(),
      on('netbox') && (async () => {
        const r = await getJson(`${nbase}/api/core/object-changes/?limit=300&ordering=-time&time_after=${encodeURIComponent(new Date(since).toISOString())}&fields=id,time,user_name,action,changed_object_type,object_repr`, { headers: nbHeaders(s), login: nbase, name: 'NetBox' });
        for (const c of (r.results || []).filter(isPerson)) {
          const at = Date.parse(c.time);
          if (at > since) out.push({ src: 'netbox', at, ref: null, text: `${c.user_name} ${String(c.action?.label || '').toLowerCase()} ${String(c.changed_object_type || '').split('.').pop()} ${c.object_repr}` });
        }
      })(),
      on('slack') && (async () => {
        const r = await slack(since);
        for (const m of r.mentions) out.push({ src: 'slack', at: m.at, url: m.link, text: `${m.isDm ? 'DM' : '#' + m.channel} · ${m.user}: ${m.text}` });
      })(),
      on('gmail') && (async () => {
        const g = await gmail();
        for (const e of g.entries) if (e.at > since) out.push({ src: 'mail', at: e.at, url: e.link, text: `${e.from}: ${e.title}` });
      })(),
    ].filter(Boolean));
    return out.sort((a, b) => b.at - a.at);
  }

  // Every site each source needs, so Settings and the dashboard can ask for all of them in one click.
  function originsFor(s) {
    const o = k => { try { return new URL(s[k]).origin + '/*'; } catch { return null; } };
    const on = k => s.sources?.[k] !== false;
    return [on('jira') && o('jiraUrl'), on('netbox') && o('netboxUrl'), on('netsuite') && o('netsuiteUrl'),
      on('slack') && 'https://app.slack.com/*', on('gmail') && 'https://mail.google.com/*', on('calendar') && 'https://calendar.google.com/*'].filter(Boolean);
  }
  return { DEFAULTS, NAMES, settings, refresh, pollFeed, originsFor };
})();

if (typeof self !== 'undefined') self.LambdaLive = LambdaLive;
