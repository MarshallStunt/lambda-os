// DATA LAYER. Builds what the dashboard draws, from either:
//   • live: the NetBox + Jira snapshot that live.js keeps in chrome.storage.local, or
//   • demo: generated data (Settings → Demo, or when opened outside the extension).
// window.LambdaData.ready resolves to:
//   { MODE, AT, SOURCES, ME, LINKS, SITES, PARTS, PEOPLE, DEVICES, TICKETS, KPIS, FEED, pollFeed, feedEveryMs, ...lookups }

(function () {
  const H = 3600e3, DAY = 24 * H;

  /* ---------------- Geography ---------------- */
  // City coordinates by airport-style code: fills in sites without coordinates and catches typos in NetBox.
  const CITY = {
    ATL: [33.75, -84.39, 'Atlanta, GA'], AUS: [30.27, -97.74, 'Austin, TX'], CMH: [39.96, -83.0, 'Columbus, OH'], DAL: [32.78, -96.8, 'Dallas, TX'],
    DFW: [32.9, -97.04, 'Dallas, TX'], DEN: [39.74, -104.99, 'Denver, CO'], IAD: [38.95, -77.45, 'Ashburn, VA'], IAH: [29.76, -95.37, 'Houston, TX'],
    LAX: [34.05, -118.24, 'Los Angeles, CA'], LBB: [33.58, -101.85, 'Lubbock, TX'], MCI: [39.1, -94.58, 'Kansas City, MO'], MSP: [44.98, -93.27, 'Minneapolis, MN'],
    ORD: [41.88, -87.63, 'Chicago, IL'], SEA: [47.6, -122.33, 'Seattle, WA'], SJC: [37.34, -121.89, 'San Jose, CA'], SFO: [37.77, -122.42, 'San Francisco, CA'],
    SLC: [40.76, -111.89, 'Salt Lake City, UT'], PHX: [33.45, -112.07, 'Phoenix, AZ'], JAX: [30.33, -81.66, 'Jacksonville, FL'], LAS: [36.17, -115.14, 'Las Vegas, NV'],
    PDX: [45.52, -122.68, 'Portland, OR'], BOS: [42.36, -71.06, 'Boston, MA'], NYC: [40.71, -74.0, 'New York, NY'], EWR: [40.73, -74.17, 'Newark, NJ'],
    MIA: [25.76, -80.19, 'Miami, FL'], RIC: [37.54, -77.44, 'Richmond, VA'], CLT: [35.23, -80.84, 'Charlotte, NC'], SAT: [29.42, -98.49, 'San Antonio, TX'],
    // Outside the US
    YQB: [46.81, -71.21, 'Québec City, Canada'], YUL: [45.5, -73.57, 'Montréal, Canada'], YYZ: [43.65, -79.38, 'Toronto, Canada'], YVR: [49.28, -123.12, 'Vancouver, Canada'],
    QRO: [20.59, -100.39, 'Querétaro, Mexico'], MEX: [19.43, -99.13, 'Mexico City, Mexico'], GRU: [-23.55, -46.63, 'São Paulo, Brazil'],
    KOR: [37.57, 126.98, 'Seoul, South Korea'], ICN: [37.46, 126.44, 'Seoul, South Korea'], SEL: [37.57, 126.98, 'Seoul, South Korea'],
    NRT: [35.68, 139.69, 'Tokyo, Japan'], TYO: [35.68, 139.69, 'Tokyo, Japan'], SIN: [1.35, 103.82, 'Singapore'], HKG: [22.32, 114.17, 'Hong Kong'],
    TPE: [25.03, 121.57, 'Taipei, Taiwan'], SYD: [-33.87, 151.21, 'Sydney, Australia'], BOM: [19.08, 72.88, 'Mumbai, India'],
    AMS: [52.37, 4.9, 'Amsterdam, Netherlands'], LHR: [51.51, -0.13, 'London, UK'], LON: [51.51, -0.13, 'London, UK'], FRA: [50.11, 8.68, 'Frankfurt, Germany'],
    CDG: [48.86, 2.35, 'Paris, France'], DUB: [53.35, -6.26, 'Dublin, Ireland'], ARN: [59.33, 18.07, 'Stockholm, Sweden'], OSL: [59.91, 10.75, 'Oslo, Norway'],
    HEL: [60.17, 24.94, 'Helsinki, Finland'], KEF: [64.15, -21.94, 'Reykjavík, Iceland'], MAD: [40.42, -3.7, 'Madrid, Spain'], TLV: [32.09, 34.78, 'Tel Aviv, Israel'],
    DXB: [25.2, 55.27, 'Dubai, UAE'],
  };
  const TZ = {
    'America/New_York': [39.5, -77], 'US/Eastern': [39.5, -77], EST: [39.5, -77], 'America/Chicago': [39, -92], 'US/Central': [39, -92],
    'America/Denver': [39.7, -105], 'US/Mountain': [39.7, -105], 'America/Phoenix': [33.4, -112], 'US/Arizona': [33.4, -112],
    'America/Los_Angeles': [37, -121], 'US/Pacific': [37, -121], 'America/Toronto': [43.65, -79.38], 'America/Montreal': [45.5, -73.57],
    'America/Mexico_City': [19.43, -99.13], 'Asia/Seoul': [37.57, 126.98], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Singapore': [1.35, 103.82],
    'Europe/London': [51.51, -0.13], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Berlin': [52.52, 13.4], 'Europe/Paris': [48.86, 2.35],
    'Europe/Stockholm': [59.33, 18.07], 'Australia/Sydney': [-33.87, 151.21],
  };
  const kmBetween = (a, b) => {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  // A city code hidden in a site name: "SEA01", "POP - YUL51", "prem-mayo-jax", "prem-accenture-sfo01".
  const cityCode = name => {
    for (const tok of String(name).toUpperCase().split(/[^A-Z0-9]+/).reverse()) {
      const m = tok.match(/^([A-Z]{3})\d{0,3}$/);
      if (m && CITY[m[1]]) return m[1];
    }
    const m = String(name).toUpperCase().match(/^([A-Z]{3})\d{2}/);
    if (m && CITY[m[1]]) return m[1];
    const low = String(name).toLowerCase(); // "San Francisco Lab" → SFO
    return Object.keys(CITY).find(k => { const city = CITY[k][2].split(',')[0].toLowerCase(); return city.length >= 5 && low.includes(city); }) || null;
  };
  function placeSite(x) {
    const city = cityCode(x.name), ref = city && CITY[city];
    const has = x.lat != null && x.lon != null && !(Number(x.lat) === 0 && Number(x.lon) === 0);
    if (has && ref && kmBetween([+x.lat, +x.lon], ref) > 1500) {
      return { lat: ref[0], lon: ref[1], note: `NetBox coordinates (${(+x.lat).toFixed(2)}, ${(+x.lon).toFixed(2)}) look wrong for ${ref[2]}, so it's placed at the city.` };
    }
    if (has) return { lat: +x.lat, lon: +x.lon };
    if (ref) return { lat: ref[0], lon: ref[1], note: `No coordinates in NetBox, so it's placed at ${ref[2]}.` };
    if (TZ[x.tz]) return { lat: TZ[x.tz][0], lon: TZ[x.tz][1], note: `No coordinates in NetBox, so it's placed roughly by time zone (${x.tz}).` };
    return { lat: null, lon: null, note: 'No coordinates in NetBox, so it isn’t on the globe.' };
  }

  // NetBox site name → short code + kind. "ATL01 - DataBank ATL3" → ATL01; "POP - YUL51" → YUL51 (pop).
  function siteIdent(name) {
    const parts = String(name).split(/\s+[-–]\s+/);
    if (/^pop$/i.test(parts[0]) && parts[1]) return { code: parts[1].trim().toUpperCase(), kind: 'pop', rest: parts.slice(2).join(' - ') };
    if (/^prem-/i.test(parts[0])) return { code: parts[0].trim().toLowerCase(), kind: 'prem', rest: '' };
    const m = parts[0].match(/^([A-Z]{3}\d{2}[A-Z0-9]*)\b(.*)$/i);
    if (m) return { code: m[1].toUpperCase(), kind: 'dc', rest: [m[2].trim(), ...parts.slice(1)].filter(Boolean).join(' - ') };
    return { code: parts[0].trim(), kind: 'other', rest: parts.slice(1).join(' - ') };
  }
  // Jira's "CMH01 - Columbus, OH (Cologix)" → { code: CMH01, label: "Columbus, OH (Cologix)" }
  const jiraSite = raw => { const [c, ...r] = String(raw).split(/\s+[-–]\s+/); return { code: c.trim().toUpperCase(), label: r.join(' - ').trim() }; };
  const statusRank = st => ['active', 'staging', 'planned', 'decommissioning', 'retired'].indexOf(st) + 1 || 9;

  /* ---------------- Live build ---------------- */
  function buildLive(snap) {
    const nb = snap.nb, jr = snap.jira, now = Date.now();
    const sitesByCode = new Map();
    const jiraLabels = new Map(); // code → { label: "Columbus, OH (Cologix)", raws: Jira option values (for the JQL link) }
    for (const t of jr?.tickets || []) for (const raw of t.siteRaw) {
      const j = jiraSite(raw), e = jiraLabels.get(j.code) || { label: '', raws: new Set() };
      if (j.label && !e.label) e.label = j.label;
      e.raws.add(raw); jiraLabels.set(j.code, e);
    }

    for (const x of nb?.sites || []) {
      const id = siteIdent(x.name);
      if (id.kind === 'other' && !x.racks && !x.devices && x.lat == null) continue; // logical buckets like "Vendor Returned"
      const place = placeSite(x), city = cityCode(x.name);
      const s = sitesByCode.get(id.code);
      if (s) { // NetBox has a few duplicate codes (e.g. two DAL03 records): merge them
        s.racks += x.racks; s.devices += x.devices;
        if (s.lat == null && place.lat != null) Object.assign(s, { lat: place.lat, lon: place.lon, coordNote: place.note || '' });
        if (statusRank(x.status) < statusRank(s.status)) s.status = x.status;
        continue;
      }
      const label = jiraLabels.get(id.code)?.label || [x.facility, id.rest].find(v => v && v.toUpperCase() !== id.code) || (city && CITY[city][2]) || x.description || '';
      sitesByCode.set(id.code, {
        id: id.code, name: id.kind === 'pop' ? `POP · ${label || (city ? CITY[city][2] : '')}`.replace(/ · $/, '') : (label || id.code),
        fullName: x.name, kind: id.kind, status: x.status, lat: place.lat, lon: place.lon, coordNote: place.note || '',
        city: city ? CITY[city][2] : '', address: x.address, racks: x.racks, devices: x.devices,
        url: nb.base ? `${nb.base}/dcim/sites/${x.id}/` : '', inventory: [],
      });
    }
    // Sites Jira knows but NetBox doesn't (or NetBox unavailable): listed, and on the globe if the city is known.
    for (const [code, jl] of jiraLabels) if (!sitesByCode.has(code) && !sitesByCode.has(code.match(/^[A-Z]{3}\d{2}/)?.[0])) {
      const city = cityCode(code);
      sitesByCode.set(code, { id: code, name: jl.label || code, fullName: code, kind: 'dc', status: 'active',
        lat: city ? CITY[city][0] : null, lon: city ? CITY[city][1] : null, city: city ? CITY[city][2] : '',
        coordNote: nb ? 'In Jira but not found in NetBox.' : 'NetBox unavailable, so it’s placed at the city.', racks: null, devices: null, inventory: [], url: '' });
    }

    // A NetBox site name, Jira value or hostname prefix → site code.
    const codeOf = name => {
      if (!name) return null;
      for (const c of [siteIdent(name).code, jiraSite(name).code]) if (sitesByCode.has(c)) return c;
      const base = String(name).toUpperCase().match(/^[A-Z]{3}\d{2}/)?.[0];
      return base && sitesByCode.has(base) ? base : null;
    };

    // Stock (NetBox inventory consumables), per site and part number.
    const PARTS = new Map();
    for (const row of nb?.stock || []) {
      const code = codeOf(row.site);
      if (!code) continue;
      const t = nb.types[row.pn] || {};
      if (!PARTS.has(row.pn)) PARTS.set(row.pn, { id: row.pn, pn: row.pn, name: t.name || row.pn, mfr: t.mfr || '' });
      const inv = sitesByCode.get(code).inventory;
      const e = inv.find(i => i.part === row.pn);
      if (e) { e.stock += row.onsite; e.receiving += row.receiving; e.alert = Math.max(e.alert, row.alert); }
      else inv.push({ part: row.pn, stock: row.onsite, receiving: row.receiving, alert: row.alert });
    }

    // Tickets, devices and people from Jira.
    const meId = jr?.me?.id;
    const PEOPLE = new Map([['me', { id: 'me', name: 'You', handle: jr?.me?.name || '' }]]);
    const DEVICES = new Map();
    const TICKETS = (jr?.tickets || []).map(t => {
      const site = t.siteRaw.map(codeOf).find(Boolean) || codeOf(t.host) || null;
      const assignee = t.assigneeId === meId ? 'me' : t.assigneeId;
      if (assignee && !PEOPLE.has(assignee)) PEOPLE.set(assignee, { id: assignee, name: t.assigneeName, handle: '' });
      if (t.host && !DEVICES.has(t.host)) {
        DEVICES.set(t.host, { id: t.host, site, rack: t.cabinet || '—', u: t.ru, model: t.devType || 'Device', serial: '', url: t.devLink || '' });
      }
      if (t.pn && !PARTS.has(t.pn)) PARTS.set(t.pn, { id: t.pn, pn: t.pn, name: nb?.types?.[t.pn]?.name || t.pn, mfr: '' });
      return { key: t.key, url: t.url, summary: t.summary, status: t.status, priority: t.priority, assignee, assigneeName: t.assigneeName,
        site, device: t.host || '', part: t.pn || null, created: t.created, updated: t.updated,
        slaDue: t.slaDue, slaBreached: t.slaBreached, slaPaused: t.slaPaused, mine: t.mine };
    });

    const SITES = [...sitesByCode.values()];
    for (const s of SITES) {
      const ts = TICKETS.filter(t => t.site === s.id), jl = jiraLabels.get(s.id);
      s.openTickets = ts.length;
      s.breached = ts.filter(isBreached).length;
      if (jl && jr) s.jiraUrl = `${jr.base}/issues/?jql=${encodeURIComponent(`project = DC AND statusCategory != Done AND "Data Center Location(s)" in (${[...jl.raws].map(r => `"${r.replace(/"/g, '\\"')}"`).join(', ')})`)}`;
      s.health = siteHealth(s);
    }

    // KPIs
    const opened = Array.from({ length: 14 }, (_, i) => {
      const end = startOfDay(now) + DAY - (13 - i) * DAY;
      return TICKETS.filter(t => t.created >= end - DAY && t.created < end).length;
    });
    const breached = TICKETS.filter(isBreached).length;
    const due24 = TICKETS.filter(t => !isBreached(t) && t.slaDue && t.slaDue < now + DAY).length;
    const live = SITES.filter(s => s.status === 'active' || s.status === 'staging');
    const waiting = TICKETS.filter(t => /part|rma/i.test(t.status));
    const waitingStocked = waiting.filter(t => t.part && t.site && (sitesByCode.get(t.site)?.inventory.find(i => i.part === t.part)?.stock || 0) > 0);
    const devs = live.reduce((a, s) => a + (s.devices || 0), 0), racks = live.reduce((a, s) => a + (s.racks || 0), 0);
    const KPIS = [
      jr && { label: 'Open DC tickets', value: TICKETS.length.toLocaleString(), sub: `+${opened[13]} opened today`, spark: opened, sparkWhat: 'opened' },
      jr && { label: 'SLA breached', value: breached.toLocaleString(), sub: `${due24} more due in 24h`, tone: breached ? 'bad' : 'good' },
      nb && { label: 'Devices in NetBox', value: kfmt(devs), sub: `${racks.toLocaleString()} racks · ${live.length} live sites` },
      jr && { label: 'Waiting on parts / RMA', value: waiting.length.toLocaleString(), sub: `${waitingStocked.length} have the part on site`, tone: waitingStocked.length ? 'bad' : 'good' },
      !jr && { label: 'Sites', value: String(SITES.length), sub: `${live.length} live` },
    ].filter(Boolean);

    // Feed: latest ticket updates + NetBox changes.
    const FEED = [
      ...[...TICKETS].sort((a, b) => b.updated - a.updated).slice(0, 25).map(t => ({ src: 'jira', at: t.updated, ref: t.key, text: `${t.key} · ${t.status} — ${t.summary}` })),
      ...(nb?.changes || []).map(c => ({ src: 'netbox', at: c.at, ref: null, text: `${c.user || 'someone'} ${c.action.toLowerCase()} ${c.type} ${c.repr}` })),
    ].sort((a, b) => b.at - a.at);

    const src = (key, name) => {
      const st = snap.sources?.[key], data = snap[key === 'netbox' ? 'nb' : key];
      if (!st || st.off) return { key, name, state: 'off', title: st?.off ? `${name} is turned off in Settings` : `${name}: not loaded yet` };
      if (st.ok) return { key, name, state: 'ok', title: `${name}: live, using your sign-in` };
      if (st.access) return { key, name, state: 'error', access: st.access, title: st.error, since: st.failingSince || null };
      return { key, name, state: data ? 'stale' : 'error', url: st.login, since: st.failingSince || null, staleAt: data ? st.staleAt || null : null, error: st.error, auth: !!st.auth,
        title: `${st.error}${data && st.staleAt ? ` Showing data from ${new Date(st.staleAt).toLocaleString()}.` : ''}${st.auth ? ' Click to sign in.' : ''}` };
    };
    const D = finish({
      MODE: 'live', AT: snap.at,
      SOURCES: [src('netbox', 'NetBox'), src('jira', 'Jira'), src('slack', 'Slack'), src('netsuite', 'NetSuite'), src('gmail', 'Gmail'), src('calendar', 'Calendar'),
        { key: 'claude', name: 'Claude', state: 'off', title: 'Not connected yet: needs an org-approved API path' }],
      ME: { name: jr?.me?.name || '' },
      LINKS: { jira: jr?.base || '', netbox: nb?.base || '', slack: snap.slack?.url || '', netsuite: snap.netsuite?.base || '' },
      SITES, PARTS: [...PARTS.values()], PEOPLE: [...PEOPLE.values()], DEVICES: [...DEVICES.values()], TICKETS, KPIS, FEED,
      pollFeed: since => LambdaLive.pollFeed(since), feedEveryMs: 60000,
    });
    if (jr?.portfolioError) D.SOURCES[1].title += ` (Projects/deployments failed: ${jr.portfolioError})`;
    return addWork(D, { portfolio: jr?.portfolio || [], slack: snap.slack, gmail: snap.gmail, calendar: snap.calendar, netsuite: snap.netsuite, codeOf, meId });
  }

  /* ---------------- Projects, deployments, Slack, mail, calendar, NetSuite ---------------- */
  // "[NEW] [Tranche 0] - 15,624xVR200 at QRO01 - Data Center Operations" → tags, a clean title, GPU count and model.
  function parseDeploy(summary) {
    const tags = []; let s = String(summary || '').trim(), m;
    while ((m = s.match(/^\[([^\]]+)\]\s*-?\s*/))) { tags.push(m[1].trim()); s = s.slice(m[0].length); }
    s = s.replace(/\s+-\s+Data Center Oper\w*\s*$/i, '').trim();
    const g = s.match(/(\d[\d,.]*)\s*x\s*([A-Z]{1,3}\d{2,3}[A-Z]?)/i);
    return { tag: tags.find(t => !/tranche/i.test(t)) || tags[0] || '', tags, title: s || summary, gpus: g ? Number(g[1].replace(/[,.]/g, '')) : null, gpuModel: g ? g[2].toUpperCase() : '' };
  }
  const statusHealth = (status, cat) => {
    const x = String(status).toLowerCase();
    if (cat === 'done' || /on track|complete/.test(x)) return 'good';
    if (/at risk/.test(x)) return 'warning';
    if (/off track|blocked|overdue/.test(x)) return 'critical';
    return 'idle'; // New, Planning, Open… = not started / no health reported yet
  };
  const dayMs = d => { if (!d) return null; const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00' : d).getTime(); return isNaN(t) ? null : t; };
  const STOPWORDS = new Set(['data', 'center', 'centre', 'deployment', 'cluster', 'project', 'phase', 'with', 'from', 'into', 'for', 'and', 'the', 'new']);
  const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length >= 4 && !STOPWORDS.has(w));

  let TRACKED = new Set();
  async function loadTracked() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) return (await chrome.storage.local.get('tracked')).tracked || [];
      return JSON.parse(localStorage.getItem('lambdaos-tracked') || '[]');
    } catch { return []; }
  }
  function saveTracked() {
    const list = [...TRACKED];
    try { if (typeof chrome !== 'undefined' && chrome.storage?.local) chrome.storage.local.set({ tracked: list }); else localStorage.setItem('lambdaos-tracked', JSON.stringify(list)); } catch { /* per-viewer convenience only */ }
  }

  function addWork(D, x) {
    const now = Date.now(), DAY = 864e5;
    const siteIds = new Set(D.SITES.map(s => s.id));
    const codesIn = text => [...new Set((String(text).toUpperCase().replace(/[-_]/g, ' ').match(/\b[A-Z]{3}\d{2}\b/g) || []).filter(c => siteIds.has(c)))];
    const codeOf = x.codeOf;

    // Projects (initiatives) and deployments (epics) with progress from their workstreams.
    const DEPLOYMENTS = [], PROJECTS = [];
    for (const p of x.portfolio) {
      const meta = parseDeploy(p.summary);
      const sites = [...new Set([...p.siteRaw.map(codeOf).filter(Boolean), ...codesIn(p.summary)])];
      const start = dayMs(p.plannedStart), end = dayMs(p.plannedEnd) || dayMs(p.completion) || dayMs(p.due);
      const total = p.tasks.total + p.workstreams.reduce((a, w) => a + w.total, 0), done = p.tasks.done + p.workstreams.reduce((a, w) => a + w.done, 0);
      const overdue = !!(end && end < now && p.cat !== 'done');
      const o = { ...p, ...meta, sites, site: sites[0] || null, start, end, overdue, health: overdue ? 'critical' : statusHealth(p.status, p.cat),
        progress: total ? done / total : null, doneCount: done, totalCount: total, mine: p.assigneeId === x.meId || !!p.watched,
        assignee: p.assigneeId === x.meId ? 'me' : p.assigneeId,
        events: [], channels: [], moves: [], deployments: [] };
      (p.kind === 'project' ? PROJECTS : DEPLOYMENTS).push(o);
    }
    const PIDX = new Map(PROJECTS.map(p => [p.key, p]));
    for (const d of DEPLOYMENTS) { d.project = PIDX.get(d.parentKey) || null; if (d.project) d.project.deployments.push(d); }
    for (const p of PROJECTS) p.sites = [...new Set([...p.sites, ...p.deployments.flatMap(d => d.sites)])];
    for (const s of D.SITES) s.deployments = DEPLOYMENTS.filter(d => d.sites.includes(s.id));

    // Slack: your channels, linked to sites (dc_ops-ord02) and deployments (prj-…_ord01_…_64xh100…).
    const SL = x.slack;
    const CHANNELS = (SL?.channels || []).map(c => ({ ...c, url: SL.url ? `${SL.url}/archives/${c.id}` : '', site: codesIn(c.name)[0] || null }));
    for (const d of DEPLOYMENTS) {
      const want = String(d.slack || '');
      d.channels = CHANNELS.filter(c => (want && (want.includes(c.id) || want.replace(/^#/, '') === c.name))
        || (d.gpus && c.site && d.sites.includes(c.site) && c.name.replace(/[,_-]/g, '').includes(String(d.gpus))));
      if (!d.channels.length && /^https?:/.test(want)) d.slackUrl = want;
    }
    for (const s of D.SITES) s.channels = CHANNELS.filter(c => c.site === s.id);
    const MENTIONS = (SL?.mentions || []).map(m => ({ ...m, site: codesIn(m.channel)[0] || null }));

    // Gmail and Calendar
    const MAIL = x.gmail ? { email: x.gmail.email, unread: x.gmail.unread, entries: x.gmail.entries } : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const EVENTS = (x.calendar?.events || []).filter(e => e.at && e.at >= today.getTime()).map(e => {
      const sites = codesIn(e.title), flat = e.title.replace(/[,_-]/g, '');
      const dep = DEPLOYMENTS.find(d => d.gpus && sites.some(c => d.sites.includes(c)) && flat.includes(String(d.gpus)))
        || DEPLOYMENTS.find(d => d.gpus && flat.includes(String(d.gpus)) && d.gpus >= 100);
      return { ...e, sites, site: sites[0] || dep?.site || null, deployment: dep?.key || null };
    }).sort((a, b) => a.at - b.at);
    for (const e of EVENTS) if (e.deployment) DEPLOYMENTS.find(d => d.key === e.deployment).events.push(e);

    // NetSuite: material on hand per site, real part names, and material movements linked to deployments.
    const NS = x.netsuite;
    const locCode = loc => codeOf(String(loc || '').split('|')[0].trim());
    let MOVES = [];
    for (const s of D.SITES) { s.material = []; s.moves = []; }
    if (NS) {
      for (const r of NS.onhand) { const c = locCode(r.loc); if (c && D.siteById(c)) D.siteById(c).material.push(r); }
      for (const s of D.SITES) s.material.sort((a, b) => b.qty - a.qty);
      const names = new Map();
      NS.onhand.forEach(r => { if (r.name) { names.set(r.item, r.name); if (r.legacy) names.set(r.legacy, r.name); } });
      D.PARTS.forEach(p => { if ((!p.name || p.name === p.pn) && names.get(p.pn)) p.name = names.get(p.pn); });
      MOVES = NS.moves.map(m => ({ ...m, site: locCode(m.dcLoc) || locCode(m.to) || locCode(m.from) || null })).sort((a, b) => b.at - a.at);
      for (const m of MOVES) {
        if (m.site && D.siteById(m.site)) D.siteById(m.site).moves.push(m);
        if (!m.deployment) continue;
        const mw = new Set(words(m.deployment)), num = (m.deployment.replace(/,/g, '').match(/\d{3,}/) || [])[0];
        let best = null, bs = 1;
        for (const d of DEPLOYMENTS) {
          if (m.site && d.sites.length && !d.sites.includes(m.site)) continue;
          const sc = words(d.title).filter(w => mw.has(w)).length + (num && d.gpus && String(d.gpus) === num ? 2 : 0);
          if (sc > bs) { bs = sc; best = d; }
        }
        if (best) { m.deploymentKey = best.key; best.moves.push(m); }
      }
    }

    // Feed and KPIs
    D.FEED.push(
      ...MENTIONS.map(m => ({ src: 'slack', at: m.at, url: m.link, text: `${m.isDm ? 'DM' : '#' + m.channel} · ${m.user}: ${m.text}` })),
      ...(MAIL?.entries || []).map(e => ({ src: 'mail', at: e.at, url: e.link, text: `${e.from}: ${e.title}` })),
      ...MOVES.filter(m => m.at > now - 7 * DAY).slice(0, 25).map(m => ({ src: 'netsuite', at: m.at, ref: m.deploymentKey || m.site, text: `${m.doc} · ${m.type}${m.deployment ? ` · ${m.deployment}` : ''}${m.status ? ` · ${m.status}` : ''}` })),
    );
    D.FEED.sort((a, b) => b.at - a.at);
    if (DEPLOYMENTS.length) {
      const risky = DEPLOYMENTS.filter(d => d.health === 'critical' || d.health === 'warning').length;
      const gpus = DEPLOYMENTS.reduce((a, d) => a + (d.gpus || 0), 0);
      const next = DEPLOYMENTS.filter(d => d.end && d.end >= now).sort((a, b) => a.end - b.end)[0];
      D.KPIS.splice(2, 0,
        { label: 'Active deployments', value: String(DEPLOYMENTS.length), sub: `${risky} at risk, off track or overdue`, tone: risky ? 'bad' : 'good' },
        { label: 'GPUs in deployments', value: kfmt(gpus), sub: next ? `next due: ${next.site || next.key} · ${new Date(next.end).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '' });
    }

    const DI = new Map(DEPLOYMENTS.map(d => [d.key, d]));
    return Object.assign(D, {
      DEPLOYMENTS, PROJECTS, CHANNELS, MENTIONS, MAIL, EVENTS, MOVES,
      deploymentByKey: k => DI.get(k), projectByKey: k => PIDX.get(k), channelById: id => CHANNELS.find(c => c.id === id),
      isTracked: k => TRACKED.has(k), toggleTrack: k => { TRACKED.has(k) ? TRACKED.delete(k) : TRACKED.add(k); saveTracked(); return TRACKED.has(k); },
      tracked: () => DEPLOYMENTS.filter(d => TRACKED.has(d.key) || d.mine).sort((a, b) => (a.end || Infinity) - (b.end || Infinity)),
    });
  }

  const isBreached = t => t.slaBreached || (t.slaDue != null && t.slaDue < Date.now());
  function siteHealth(s) {
    if (!['active', 'staging'].includes(s.status)) return 'idle';
    const out = s.inventory.filter(i => i.alert > 0 && i.stock === 0).length;
    const low = s.inventory.filter(i => i.alert > 0 && i.stock <= i.alert).length;
    // Relative, not absolute: about half of all DC SLAs are breached, so a fixed count would paint everything red.
    const share = s.openTickets ? s.breached / s.openTickets : 0;
    return (s.breached >= 5 && share >= 0.6) || out >= 10 ? 'critical' : (s.breached >= 2 && share >= 0.3) || low >= 5 ? 'warning' : 'good';
  }
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const kfmt = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString();

  /* ---------------- Demo build ---------------- */
  function buildMock(note) {
    let seed = 1337;
    const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const now = Date.now();
    const SITES = [
      ['SJC01', 'San Jose', 37.34, -121.89, 'dc', 'active'], ['SEA01', 'Seattle', 47.6, -122.33, 'dc', 'active'], ['PHX01', 'Phoenix', 33.45, -112.07, 'dc', 'active'],
      ['DAL02', 'Dallas', 32.78, -96.8, 'dc', 'active'], ['MCI01', 'Kansas City', 39.1, -94.58, 'dc', 'active'], ['ORD01', 'Chicago', 41.88, -87.63, 'dc', 'active'],
      ['ATL01', 'Atlanta', 33.75, -84.39, 'dc', 'active'], ['IAD03', 'Ashburn', 39.04, -77.49, 'dc', 'active'], ['YQB01', 'Québec City', 46.81, -71.21, 'dc', 'active'],
      ['QRO01', 'Querétaro', 20.59, -100.39, 'dc', 'planned'], ['YUL51', 'POP · Montréal', 45.5, -73.57, 'pop', 'active'], ['AMS01', 'Amsterdam', 52.37, 4.9, 'dc', 'planned'],
      ['SEL01', 'Seoul', 37.57, 126.98, 'dc', 'retired'],
    ].map(([id, name, lat, lon, kind, status]) => ({ id, name, fullName: id, lat, lon, kind, status, racks: status === 'active' ? int(40, 300) : int(0, 20), inventory: [], url: '', coordNote: '' }));
    SITES.forEach(s => (s.devices = s.racks * int(9, 14)));
    const PARTS = [['h100', 'H100 SXM5 GPU'], ['h200', 'H200 SXM GPU'], ['b200', 'B200 GPU'], ['psu', 'PSU 3.3kW'], ['cx7', 'ConnectX-7 NIC'],
      ['nvme', 'NVMe 7.68TB'], ['dimm', 'DIMM 64GB DDR5'], ['osfp', 'OSFP 800G optic']].map(([id, name]) => ({ id, pn: id, name, mfr: '' }));
    const PEOPLE = [{ id: 'me', name: 'You', handle: '' }, ...['A. Rivera', 'J. Chen', 'M. Okafor', 'S. Patel', 'K. Nguyen', 'L. Moreau'].map((n, i) => ({ id: 'p' + i, name: n, handle: '' }))];
    for (const s of SITES) if (s.status === 'active' && s.kind === 'dc') s.inventory = PARTS.map(p => { const alert = int(4, 16); return { part: p.id, stock: Math.max(0, Math.round(alert * rnd() * 4)), receiving: int(0, 6), alert }; });
    const DEVICES = [];
    for (const s of SITES.filter(x => x.status === 'active' && x.kind === 'dc')) for (let i = 0; i < 5; i++) {
      const rack = `r${String(int(1, s.racks)).padStart(3, '0')}`, u = int(2, 40);
      DEVICES.push({ id: `${s.id.toLowerCase()}-${rack}-u${u}`, site: s.id, rack, u, model: pick(['HGX H100 8-GPU', 'HGX H200 8-GPU', 'HGX B200 8-GPU', 'Storage node']), serial: 'LMB' + int(100000, 999999), url: '' });
    }
    const ISSUES = [['GPU fell off the bus', 'h100'], ['GPU Xid 79, needs reseat', 'h200'], ['PSU failed, redundancy lost', 'psu'], ['NVMe predictive failure', 'nvme'],
      ['DIMM correctable ECC storm', 'dimm'], ['IB link flapping on port 3', 'osfp'], ['NIC not detected after reboot', 'cx7'], ['BMC unreachable', null], ['Node fails burn-in', 'b200']];
    const STATUSES = ['Open', 'In Progress', 'Waiting for Parts', 'Pending Validations'];
    const TICKETS = Array.from({ length: 52 }, (_, i) => {
      const d = pick(DEVICES), [summary, part] = pick(ISSUES), r = rnd();
      const priority = r < 0.12 ? 'Highest' : r < 0.42 ? 'High' : r < 0.8 ? 'Medium' : 'Low';
      const slaH = { Highest: 4, High: 24, Medium: 72, Low: 168 }[priority], age = Math.pow(rnd(), 1.6) * slaH * 1.05;
      const assignee = i < 9 ? 'me' : pick(PEOPLE.slice(1)).id;
      return { key: `DC-${33100 + i * 7 + int(0, 6)}`, url: '', summary, part, site: d.site, device: d.id, status: part && rnd() < 0.3 ? 'Waiting for Parts' : pick(STATUSES),
        priority, assignee, assigneeName: PEOPLE.find(p => p.id === assignee).name, created: now - age * H, updated: now - rnd() * 6 * H,
        slaDue: now + (slaH - age) * H, slaBreached: false, slaPaused: false, mine: assignee === 'me' };
    });
    for (const s of SITES) {
      const ts = TICKETS.filter(t => t.site === s.id);
      s.openTickets = ts.length; s.breached = ts.filter(isBreached).length; s.health = siteHealth(s);
    }
    const series = (start, drift, noise) => { let v = start; return Array.from({ length: 14 }, () => Math.round(v = Math.max(0, v + drift + (rnd() - 0.5) * noise))); };
    const KPIS = [
      { label: 'Open DC tickets', value: String(TICKETS.length), sub: '+6 opened today', spark: series(4, 0.1, 5), sparkWhat: 'opened' },
      { label: 'SLA breached', value: String(TICKETS.filter(isBreached).length), sub: `${TICKETS.filter(t => !isBreached(t) && t.slaDue < now + DAY).length} more due in 24h`, tone: 'bad' },
      { label: 'Devices in NetBox', value: kfmt(SITES.reduce((a, s) => a + (s.status === 'active' ? s.devices : 0), 0)), sub: `${SITES.filter(s => s.status === 'active').length} live sites` },
      { label: 'Waiting on parts / RMA', value: String(TICKETS.filter(t => /part/i.test(t.status)).length), sub: '2 have the part on site', tone: 'bad' },
    ];
    const FEED_T = [
      () => { const t = pick(TICKETS); return { src: 'jira', ref: t.key, text: `${t.key} · ${pick(STATUSES)} — ${t.summary}` }; },
      () => { const d = pick(DEVICES); return { src: 'netbox', ref: null, text: `${pick(PEOPLE.slice(1)).name} updated device ${d.id}` }; },
      () => { const s = pick(SITES); const p = pick(PARTS); return { src: 'netbox', ref: s.id, text: `${p.name} received at ${s.id} (+${int(4, 24)})` }; },
    ];
    const FEED = Array.from({ length: 16 }, (_, i) => ({ ...pick(FEED_T)(), at: now - (i + 1) * (3 + rnd() * 9) * 60000 }));
    const D = finish({
      MODE: 'demo', NOTE: note || '', AT: now,
      SOURCES: ['NetBox', 'Jira', 'Slack', 'Claude'].map(n => ({ key: n.toLowerCase(), name: n, state: 'demo', title: 'Demo data' })),
      ME: { name: '' }, LINKS: { jira: '', netbox: '' }, SITES, PARTS, PEOPLE, DEVICES, TICKETS, KPIS, FEED,
      pollFeed: async () => [{ ...pick(FEED_T)(), at: Date.now() }], feedEveryMs: 6000,
    });
    D.SOURCES.splice(3, 0, ...['NetSuite', 'Gmail', 'Calendar'].map(n => ({ key: n.toLowerCase(), name: n, state: 'demo', title: 'Demo data' })));
    // Demo projects, deployments, Slack, mail, calendar and NetSuite in the same shapes live.js produces.
    const dd = (days) => new Date(now + days * 864e5).toISOString().slice(0, 10);
    const proj = (key, summary, status) => ({ key, url: '', source: 'PMO', kind: 'project', summary, status, cat: 'indeterminate', parentKey: '', siteRaw: [], assigneeId: 'p1', assigneeName: 'A. Rivera',
      plannedStart: dd(-90), plannedEnd: dd(200), completion: '', due: '', workstreams: [], tasks: { total: 0, done: 0 }, watched: false, slack: '' });
    const dep = (key, parent, summary, site, status, s0, s1, prog, mine) => {
      const ws = ['DCID', 'SDN', 'SCR', 'STORAGE'].map((p, i) => { const total = int(8, 40); return { key: `${p}-${int(100, 2999)}`, url: '', project: p, summary: ['DC build-out', 'Network fabric', 'Supply chain', 'Storage'][i], status: pick(['In Progress', 'On Track', 'To Do', 'Done']), cat: 'indeterminate', due: dd(s1), assigneeName: pick(PEOPLE.slice(1)).name, total, done: Math.round(total * Math.min(1, prog + (rnd() - 0.5) * 0.3)) }; });
      return { key, url: '', source: 'PMO', kind: 'deployment', summary, status, cat: 'indeterminate', parentKey: parent, siteRaw: [site], assigneeId: mine ? 'me' : 'p2', assigneeName: mine ? 'You' : 'J. Chen',
        plannedStart: dd(s0), plannedEnd: dd(s1), completion: '', due: '', projectType: 'Private Cloud', deployType: 'New Cluster Deployment', size: '', gpuType: '', slack: '',
        workstreams: ws, tasks: { total: int(4, 12), done: int(0, 4) }, watched: false };
    };
    const portfolio = [
      proj('PMO-2680', '[NEW] Speed of Light On-Demand', 'On Track'), proj('PMO-2600', '[CONV] Fleet conversions', 'At Risk'),
      dep('PMO-2681', 'PMO-2680', '[NEW] [Tranche 0] - 15,624xVR200 at QRO01', 'QRO01', 'New', -20, 200, 0.08, true),
      dep('PMO-2659', 'PMO-2680', '[NEW] 5184x VR200 MaxQ Spectrum RoCE in ORD01', 'ORD01', 'On Track', -60, 140, 0.35, true),
      dep('PMO-1776', 'PMO-2680', '[NEW] 4032xVR200 in DAL02 - Deployment', 'DAL02', 'At Risk', -120, 60, 0.55, false),
      dep('PMO-2311', 'PMO-2680', '[NEW] Speed of Light OD YQB01 2,048xB300', 'YQB01', 'On Track', -30, 90, 0.4, false),
      dep('PMO-2608', 'PMO-2600', '[CONV] Azure to On-Demand SEA01 2040xH100', 'SEA01', 'Off Track', -80, -5, 0.8, false),
      dep('PMO-1027', 'PMO-2600', '[DECOM] On-Demand region shutdown ATL01 680xA100', 'ATL01', 'On Track', -40, 25, 0.7, false),
      dep('PMO-2702', '', '[EXP] MSR Expansion MCI01 232xB200', 'MCI01', 'Planning', 10, 120, 0, false),
    ];
    const channels = [...SITES.filter(s => s.kind === 'dc').map((s, i) => ({ id: 'C0' + i, name: `dc_ops-${s.id.toLowerCase()}`, members: int(8, 60), topic: '', purpose: '' })),
      { id: 'C90', name: 'prj-2026-09_qro01_new_15624xvr200', members: 48, topic: '', purpose: '' }, { id: 'C91', name: 'prj-2026-06_ord01_new_5184xvr200', members: 33, topic: '', purpose: '' }];
    const slackMock = { url: '', channels, mentions: Array.from({ length: 6 }, (_, i) => { const c = pick(channels); return { at: now - (i + 1) * int(20, 120) * 60000, channel: c.name, channelId: c.id, isDm: i === 2, user: pick(PEOPLE.slice(1)).name, text: pick(['can you check the cabling plan for row 4?', 'parts landed at the dock', 'standup moved to 10:30', 'need sign-off on the RMA batch']), link: '' }; }) };
    const gmailMock = { email: 'you@lambdal.com', unread: 4, entries: ['Weekly Ops Review agenda', 'PO approved: OSFP optics', 'QRO01 site visit logistics', 'Re: DAL02 power audit'].map((t, i) => ({ title: t, summary: '', from: pick(PEOPLE.slice(1)).name, fromEmail: '', at: now - (i + 1) * 3600e3 * 2, link: '' })) };
    const calMock = { events: [['9:00am', 'Standup_ORD01-5184xVR200'], ['10:00am', 'Superintelligence: Deployments Standup'], ['1:30pm', 'QRO01 15624xVR200 tranche review'], ['4:00pm', 'Weekly Ops Review']].map(([t, title], i) => {
      const d = new Date(); const [, h, m, ap] = t.match(/(\d+):(\d+)(am|pm)/); d.setHours((+h % 12) + (ap === 'pm' ? 12 : 0), +m, 0, 0); return { date: '', time: t, title, link: '', at: d.getTime() + (i > 2 ? 864e5 : 0), allDay: false }; }) };
    const nsMock = { base: '', onhand: SITES.filter(s => s.kind === 'dc' && s.status === 'active').flatMap(s => PARTS.map(p => ({ item: p.id.toUpperCase(), legacy: '', name: p.name, qty: int(0, 60), loc: `${s.id} | ${s.name}` }))),
      moves: Array.from({ length: 12 }, (_, i) => ({ date: '', at: now - i * 864e5 * 0.6, type: pick(['Transfer Order', 'Item Receipt', 'Material Movement']), doc: `TO${600 + i}`, deployment: pick(['Speed of Light QRO01', '5184x VR200 ORD01', 'Azure to On-Demand SEA01', '']), dcLoc: pick(['QRO01', 'ORD01', 'SEA01', 'DAL02']), from: 'Warehouse', to: '', status: pick(['Shipped', 'Received', 'Pending Fulfillment']), rma: 'No', tracking: '1Z' + int(100000, 999999) })) };
    return addWork(D, { portfolio, slack: slackMock, gmail: gmailMock, calendar: calMock, netsuite: nsMock, codeOf: c => (D.siteById(String(c).toUpperCase().slice(0, 5)) || D.siteById(String(c)) || {}).id || null, meId: 'me' });
  }

  function finish(D) {
    const idx = (arr, k) => new Map(arr.map(x => [x[k], x]));
    const S = idx(D.SITES, 'id'), P = idx(D.PARTS, 'id'), U = idx(D.PEOPLE, 'id'), V = idx(D.DEVICES, 'id'), T = idx(D.TICKETS, 'key');
    return Object.assign(D, {
      siteById: id => S.get(id), partById: id => P.get(id), deviceById: id => V.get(id), ticketByKey: k => T.get(k),
      personById: id => U.get(id) || { id, name: 'Unassigned', handle: '' },
    });
  }

  /* ---------------- Start ---------------- */
  const bootStatus = msg => { const el = document.getElementById('bootMsg'); if (el) el.textContent = msg; };

  function connectHelp(snap) {
    const box = document.getElementById('boot'), s = snap.sources;
    const row = x => `<div class="boot-src"><b>${x.name}</b><span>${x.error}</span>${x.login ? `<button class="btn" data-open-url="${x.login}">Sign in to ${x.name}</button>` : ''}</div>`;
    box.innerHTML = `<div class="boot-card"><div class="brand-mark">λ</div><h2>Couldn't load NetBox or Jira</h2>
      <p class="muted">Lambda OS uses your own browser sign-ins. Sign in (and connect to the VPN for NetBox), then retry.</p>
      ${row(s.netbox)}${row(s.jira)}
      <div class="links"><button class="btn primary" data-retry>Retry</button><button class="btn" data-demo>Use demo data</button><button class="btn" data-settings>Settings</button></div></div>`;
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.openUrl) window.open(b.dataset.openUrl, '_blank');
      if (b.dataset.retry !== undefined) location.reload();
      if (b.dataset.demo !== undefined) { sessionStorage.setItem('lambdaos-demo', '1'); location.reload(); }
      if (b.dataset.settings !== undefined) chrome.runtime.openOptionsPage();
    });
    return new Promise(() => {}); // stays on this card until the user acts
  }

  async function start() {
    TRACKED = new Set(await loadTracked());
    const ext = typeof chrome !== 'undefined' && chrome.storage?.local && typeof LambdaLive !== 'undefined';
    if (!ext) return buildMock('Opened outside the extension, so this is demo data.');
    const s = await LambdaLive.settings();
    if (s.mode === 'demo' || sessionStorage.getItem('lambdaos-demo')) return buildMock();
    const { snapshot } = await chrome.storage.local.get('snapshot');
    if (snapshot && (snapshot.nb || snapshot.jira)) {
      if (Date.now() - snapshot.at > 2 * 60e3) {
        LambdaLive.refresh().then(snap => window.dispatchEvent(new CustomEvent('lambda:snapshot', { detail: snap })));
      }
      return buildLive(snapshot);
    }
    bootStatus('Connecting to NetBox and Jira with your browser sign-ins…');
    const fresh = await LambdaLive.refresh(bootStatus);
    if (!fresh.nb && !fresh.jira) await connectHelp(fresh);
    return buildLive(fresh);
  }

  // In the page this starts loading right away; in the background worker (alerts) it only exposes the builders.
  const root = typeof self !== 'undefined' ? self : window;
  const prepare = async () => { TRACKED = new Set(await loadTracked()); };
  root.LambdaData = typeof document !== 'undefined'
    ? { ready: start(), buildLive, buildMock, prepare }
    : { buildLive, buildMock, prepare };
})();
