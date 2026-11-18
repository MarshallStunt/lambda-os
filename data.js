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
  // Open DC tickets for each of the last 30 days, rebuilt from Jira: tickets open now (by created date) plus tickets
  // closed in the last 31 days (created → resolved). Each day: open at its end, new that day, closed that day.
  // The last 30 days, each as { day: 'YYYY-MM-DD', s: start ms, e: end ms (now for today) }.
  function last30(now = Date.now()) {
    const DAYMS = 864e5, out = [];
    for (let i = 29; i >= 0; i--) {
      const end = new Date(now - i * DAYMS); end.setHours(23, 59, 59, 999);
      out.push({ day: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`, s: end.getTime() - DAYMS + 1, e: Math.min(end.getTime(), now) });
    }
    return out;
  }
  function ticketTrend(tickets, closed, now = Date.now()) {
    if (!closed) return null;
    return last30(now).map(({ day, s: s0, e }) => {
      const open = tickets.filter(t => t.created && t.created <= e).length + closed.filter(([c, r]) => c <= e && r > e).length;
      const opened = tickets.filter(t => t.created >= s0 && t.created <= e).length + closed.filter(([c]) => c >= s0 && c <= e).length;
      const shut = closed.filter(([, r]) => r >= s0 && r <= e).length;
      // breached at the end of that day: open then, and past its SLA deadline by then
      const breached = tickets.filter(t => t.created && t.created <= e && t.slaDue && t.slaDue <= e).length + closed.filter(([c, r, , b]) => c <= e && r > e && b && b <= e).length;
      return { day, v: open, opened, closed: shut, breached };
    });
  }
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
    const tTrend = jr ? ticketTrend(TICKETS, jr.closed30, now) : null;
    const devTrend = nb?.devHist ? last30(now).map(({ day }, i, a) => ({ day, v: i === a.length - 1 ? null : nb.devHist.after[day] })) : null;
    const KPIS = [
      jr && { key: 'open', num: TICKETS.length, upBad: true, trend: tTrend, label: 'Open DC tickets', value: TICKETS.length.toLocaleString(), sub: `+${opened[13]} opened today`, spark: opened, sparkWhat: 'opened' },
      jr && { key: 'breached', num: breached, upBad: true, trend: tTrend && tTrend[0].breached != null ? tTrend.map((x, i) => ({ day: x.day, v: i === tTrend.length - 1 ? breached : x.breached })) : null, label: 'SLA breached', value: breached.toLocaleString(), sub: `${due24} more due in 24h`, tone: breached ? 'bad' : 'good' },
      nb && { key: 'devices', num: devs, trend: devTrend ? devTrend.map((x, i) => ({ day: x.day, v: x.v == null ? devs : Math.max(0, devs - x.v) })) : null, label: 'Devices in NetBox', value: kfmt(devs), sub: `${racks.toLocaleString()} racks · ${live.length} live sites` },
      jr && { key: 'waiting', num: waiting.length, upBad: true, trend: jr.waitHist?.counts ? last30(now).map(({ day }, i, arr) => ({ day, v: i === arr.length - 1 ? waiting.length : jr.waitHist.counts[day] })).filter(p => Number.isFinite(p.v)) : null, label: 'Waiting on parts / RMA', value: waiting.length.toLocaleString(), sub: `${waitingStocked.length} have the part on site`, tone: waitingStocked.length ? 'bad' : 'good' },
      !jr && { label: 'Sites', value: String(SITES.length), sub: `${live.length} live` },
    ].filter(Boolean);

    // Feed: latest ticket updates + NetBox changes.
    const FEED = [
      ...[...TICKETS].sort((a, b) => b.updated - a.updated).slice(0, 25).map(t => ({ src: 'jira', at: t.updated, ref: t.key, text: `${t.key} · ${t.status} — ${t.summary}` })),
      ...(nb?.changes || []).map(c => ({ src: 'netbox', at: c.at, ref: null, text: `${c.user || 'someone'} ${c.action.toLowerCase()} ${c.type} ${c.repr}` })),
    ].sort((a, b) => b.at - a.at);

    const src = (key, name) => {
      const st = snap.sources?.[key], data = snap[key === 'netbox' ? 'nb' : key];
      if (st?.off) return { key, name, state: 'off', title: `${name} is turned off in Settings` };
      // A source added in an update (or switched on) has no result until the next refresh finishes.
      if (!st) return { key, name, state: 'wait', title: `${name}: not loaded yet; it appears after the next refresh (or click ↻ in the top bar)` };
      if (st.ok) return { key, name, state: 'ok', title: `${name}: live, using your sign-in` };
      if (st.access) return { key, name, state: 'error', access: st.access, title: st.error, since: st.failingSince || null };
      return { key, name, state: data ? 'stale' : 'error', url: st.login, since: st.failingSince || null, staleAt: data ? st.staleAt || null : null, error: st.error, auth: !!st.auth,
        title: `${st.error}${data && st.staleAt ? ` Showing data from ${new Date(st.staleAt).toLocaleString()}.` : ''}${st.auth ? ' Click to sign in.' : ''}` };
    };
    const D = finish({
      MODE: 'live', AT: snap.at,
      SOURCES: [src('netbox', 'NetBox'), src('jira', 'Jira'), src('slack', 'Slack'), src('netsuite', 'NetSuite'), src('gmail', 'Gmail'), src('calendar', 'Calendar'), src('atium', 'Atium'), src('grafana', 'Grafana'),
        { key: 'claude', name: 'Claude', state: 'off', title: 'Not connected yet: needs an org-approved API path' }],
      ME: { name: jr?.me?.name || '' },
      LINKS: { jira: jr?.base || '', netbox: nb?.base || '', slack: snap.slack?.url || '', netsuite: snap.netsuite?.base || '', atium: snap.atium?.base || '', grafana: snap.grafana?.base || '' },
      SITES, PARTS: [...PARTS.values()], PEOPLE: [...PEOPLE.values()], DEVICES: [...DEVICES.values()], TICKETS, KPIS, FEED,
      pollFeed: since => LambdaLive.pollFeed(since), feedEveryMs: 60000,
    });
    if (jr?.portfolioError) D.SOURCES[1].title += ` (Projects/deployments failed: ${jr.portfolioError})`;
    D.RAW = { closed30: jr?.closed30 || null, closedEpics: jr?.closedEpics || null, codeOf };
    return addWork(D, { portfolio: jr?.portfolio || [], slack: snap.slack, gmail: snap.gmail, calendar: snap.calendar, netsuite: snap.netsuite, atium: snap.atium, grafana: snap.grafana, smart: snap.smart, closedEpics: jr?.closedEpics || null, codeOf, meId });
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
    // Grafana alerts about physical hardware (what DC Ops fixes), as opposed to software / platform alerts.
    const HW = /psu|power ?supply|fan|pdu|gpu|xid|thermal|temp|overheat|memory|dimm|disk|nvme|drive|nvlink|fabric|link ?down|carrier|\bib\b|infiniband|bmc|redfish|chassis|cooling|leak|unreachable|optic|transceiver/i;
    // Answers from the optional AI step (Settings → Data → Smart processing), applied only where the rules found nothing.
    const SM = x.smart?.on ? (x.smart.cache || {}) : null, aiLink = (kind, id) => SM?.link?.[`${kind}:${id}`] || null;

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
      const ai = !dep && aiLink('event', e.title), aiDep = ai && DEPLOYMENTS.find(d => d.key === ai);
      return { ...e, sites, site: sites[0] || (dep || aiDep)?.site || null, deployment: (dep || aiDep)?.key || null, aiLinked: !!aiDep };
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
        if (!best) { const k = aiLink('move', m.doc); best = k && DEPLOYMENTS.find(d => d.key === k); if (best) m.aiLinked = true; }
        if (best) { m.deploymentKey = best.key; best.moves.push(m); }
      }
    }

    // Atium: site asset counts and every tracked build (stage, racked / validated progress, milestones), linked to
    // its site and to the matching Jira deployment (same site, same GPU count; or the Jira epic key when Atium has it).
    const AT = x.atium, BUILDS = [];
    for (const s of D.SITES) { s.atium = null; s.builds = []; }
    if (AT) {
      const atSite = new Map();
      // "ORD01DH1" or "YQB01 Quebec City, …" → ORD01 / YQB01 when that's the NetBox site
      const siteFor = name => { const c = codeOf(name); if (c && D.siteById(c)) return c; const c5 = (String(name).toUpperCase().match(/^[A-Z]{3}\d{2}/) || [])[0]; return c5 && D.siteById(c5) ? c5 : null; };
      for (const a of AT.sites || []) {
        const site = D.siteById(siteFor(a.name));
        atSite.set(a.id, site?.id || null);
        if (site && !site.atium) site.atium = { id: a.id, assets: a.assets, consumables: a.consumables, url: `${AT.base}/sites/${a.id}/warehouse`, posUrl: `${AT.base}/sites/${a.id}/purchase-orders`, pos: a.pos || null, posLive: AT.posBySite?.[a.id] || null };
      }
      for (const b of AT.builds || []) {
        const ms = b.milestones || [], at = d => (d ? Date.parse(d + (d.length === 10 ? 'T12:00:00' : '')) : null);
        const done = ms.filter(m => m.status === 'completed'), last = [...done].sort((a, c) => (at(c.done || c.scheduled) || 0) - (at(a.done || a.scheduled) || 0))[0];
        const next = ms.filter(m => m.status !== 'completed').sort((a, c) => (at(a.scheduled) || Infinity) - (at(c.scheduled) || Infinity))[0];
        const ho = ms.find(m => m.type === 'hand_off'), nextAt = at(next?.scheduled);
        const STAGE = { enable_receiving: 'Receiving', gpu_ship: 'GPUs shipped', enable_racking: 'Racking', enable_validation: 'Validating', hand_off: 'Handed off', rfs: 'Ready for service' };
        const stage = !done.length ? 'Planned' : ho?.status === 'completed' ? (ms.find(m => m.type === 'rfs')?.status === 'completed' ? 'Ready for service' : 'Handed off') : STAGE[last.type] || last.name;
        const site = atSite.get(b.siteId) || siteFor(b.name);
        const o = { ...b, site, stage, next: next ? { name: next.name, at: nextAt } : null, handoff: ho ? { at: at(ho.done || ho.scheduled), done: ho.status === 'completed' } : null,
          rackedPct: b.devices ? b.racked / b.devices : null, validatedPct: b.hosts ? b.validated / b.hosts : null,
          late: !!(nextAt && nextAt < now - DAY), url: `${AT.base}/builds`, deploymentKey: null };
        o.health = o.late ? 'warning' : ho?.status === 'completed' ? 'good' : 'idle';
        BUILDS.push(o);
        if (site && D.siteById(site)) D.siteById(site).builds.push(o);
        const bw = new Set(words(b.name));
        const dep = (b.epic && DEPLOYMENTS.find(d => d.key === b.epic))
          || DEPLOYMENTS.find(d => site && d.sites.includes(site) && d.gpus && [b.planned, b.gpus].includes(d.gpus))
          || DEPLOYMENTS.find(d => site && d.sites.includes(site) && words(d.title).filter(w => bw.has(w)).length >= 2);
        const aiDep = !dep && (k => k && DEPLOYMENTS.find(d => d.key === k && !d.build))(aiLink('build', b.id));
        if (dep && !dep.build) { dep.build = o; o.deploymentKey = dep.key; }
        else if (aiDep) { aiDep.build = o; o.deploymentKey = aiDep.key; o.aiLinked = true; }
      }
      for (const s of D.SITES) s.builds.sort((a, c) => (a.handoff?.done - c.handoff?.done) || ((a.handoff?.at || Infinity) - (c.handoff?.at || Infinity)));
    }

    // Volunteer requests: Slack call-outs for people to go and help at another site's deployment. One per site (the
    // strongest message in the last 45 days), with the site's Atium onsite schedule where volunteers sign up.
    const VOLUNTEER = (() => {
      const atName = new Map((x.atium?.sites || []).map(a => [a.id, a.name]));
      const code5 = t => (String(t).toUpperCase().match(/\b[A-Z]{3}\d{2}\b/) || [])[0] || null;
      const JOKE = /as tribute|volun-?told|volunteered (you|him|her|them|@)|thanks for volunteering|you volunteer\?/i;
      const ASK = /volunteer|need (some |more )?(help|hands|people|folks)|asking for (your )?help|come (out|help)|head (over|out)|add yourself|ready and willing|sign ?up/i;
      const TRIP = /on-?site|deployment|schedule|access ticket|travel|trip|weeks?\b|\b\d{1,2}\/\d{1,2}\b|convers|troubleshoot|cabl|rack|repair/i;
      const bySite = new Map();
      D.VOL_CANDIDATES = [];
      for (const m of x.slack?.volunteer || []) {
        if (/^(inc-|support|eng|security|general|announce|leandata|ll_|zanker)/i.test(m.channel) || JOKE.test(m.text)) continue;
        const id = `${m.channelId || m.channel}:${m.at}`, ai = SM?.vol?.[id] || null;
        D.VOL_CANDIDATES.push({ id, at: m.at, channel: m.channel, text: m.text });
        const atId = m.atiumSites?.[0] || null, link = !!atId;
        const ask = ASK.test(m.text), trip = TRIP.test(m.text);
        // With an AI answer, the AI decides (a schedule link still counts: that's where people sign up); otherwise the rules.
        if (ai ? !(ai.request || link) : !(link || (ask && trip))) continue;
        const site = (ai?.site && /^[A-Z]{3}\d{2}$/.test(ai.site) ? ai.site : null) || (atId && code5(atName.get(atId) || '')) || codesIn(m.text)[0] || code5(m.text) || codesIn(m.channel)[0] || code5(m.channel.replace(/[-_]/g, ' '));
        if (!site) continue;
        const score = (ai?.request ? 4 : 0) + (/volunteer/i.test(m.text) ? 3 : 0) + (ask ? 2 : 0) + (link ? 2 : 0) + (trip ? 1 : 0) + (m.text.length > 120 ? 1 : 0);
        const cur = bySite.get(site) || { site, atiumId: null, at: 0, best: null, count: 0 };
        cur.count++; cur.at = Math.max(cur.at, m.at); if (atId) cur.atiumId = atId;
        if (!cur.best || score > cur.best.score || (score === cur.best.score && m.at > cur.best.at)) cur.best = { ...m, score, ai };
        bySite.set(site, cur);
      }
      const atByCode = new Map((x.atium?.sites || []).map(a => [code5(a.name), a.id]));
      return [...bySite.values()].filter(v => v.best.score >= 3).map(v => {
        const atiumId = v.atiumId || atByCode.get(v.site) || null;
        return { site: v.site, known: !!D.siteById(v.site), at: v.at, askedAt: v.best.at, user: v.best.user, channel: v.best.channel, link: v.best.link, messages: v.count,
          // A message that is only the schedule link reads better as a sentence.
          text: v.best.text.replace(/\S*(kelsier|onsite-schedule)\S*/gi, '').replace(/\s+/g, ' ').trim().length < 25 ? `Shared the ${v.site} onsite schedule: sign up there if you can help with the deployment.` : v.best.text,
          atiumId, scheduleUrl: atiumId && x.atium?.base ? `${x.atium.base}/sites/${atiumId}/deployment/onsite-schedule` : null,
          demoSignups: v.best.demoSignups, demoMe: v.best.demoMe,
          ai: !!v.best.ai, aiDates: v.best.ai?.dates || null, aiPeople: v.best.ai?.people || null };
      }).sort((a, b) => b.at - a.at).slice(0, 8);
    })();

    // Grafana: each site's live health (PDU power, hottest inlets, firing alerts, unreachable network devices), and every
    // firing alert tied to its device (by hostname, which matches NetBox) and so to that device's open tickets.
    const GF = x.grafana, byHost = new Map();
    for (const s of D.SITES) s.gf = null; // (site.health is the site's status colour; Grafana data lives in site.gf)
    if (GF?.sites) for (const [code, h] of Object.entries(GF.sites)) {
      const site = D.siteById(code);
      const alerts = (h.alerts || []).map(a => ({ ...a, site: code, hw: HW.test(a.name), crit: a.severity === 'critical' }));
      for (const a of alerts) if (a.host) { const k = a.host.toLowerCase(); if (!byHost.has(k)) byHost.set(k, []); byHost.get(k).push(a); }
      const counts = Object.entries(h.counts || {}).map(([name, n]) => ({ name, n, hw: HW.test(name), crit: alerts.some(a => a.name === name && a.crit) }))
        .sort((a, b) => b.crit - a.crit || b.hw - a.hw || b.n - a.n);
      const gf = { pduKw: h.pduKw, inlet: h.inlet || [], unreachable: h.unreachable || [], alerts, counts, total: counts.reduce((t, c) => t + c.n, 0),
        hwTotal: counts.filter(c => c.hw).reduce((t, c) => t + c.n, 0), clusters: h.clusters || [], url: h.board ? GF.base + h.board : `${GF.base}/dashboards?query=${code}` };
      if (site) site.gf = gf;
    }
    for (const dv of D.DEVICES) dv.alerts = byHost.get(String(dv.id).toLowerCase()) || [];
    for (const t of D.TICKETS) t.alerts = t.device ? byHost.get(String(t.device).toLowerCase()) || [] : [];
    // Site health: the "Site Health" board's checks for every site at once (from Grafana's fleet-wide store).
    const HEALTH = (() => {
      const F = GF?.fleet; if (!F) return null;
      const DAY = 864e5, CHECKS = [
        ['leak', 'Leaks', 'critical'], ['breaker', 'Breakers tripped', 'warning'], ['pdu', 'PDU alarms', 'warning'], ['shelf', 'Shelf PSUs at 0 W', 'warning'],
        ['hw', 'Hosts with HW faults', 'warning'], ['hot', 'Hottest inlet', 'warning'], ['net', 'Network down', 'warning'], ['blind', "Can't monitor", 'idle']];
      const codes = new Set(); Object.values(F.checks).forEach(rows => rows.forEach(x => codes.add(x.s))); Object.keys(F.power || {}).forEach(c => codes.add(c));
      const sites = [...codes].sort().map(code => {
        const of = k => (F.checks[k] || []).filter(x => x.s === code);
        const c = {};
        c.leak = { items: of('leak') }; c.leak.n = c.leak.items.length; c.leak.fresh = c.leak.items.filter(x => x.since && now - x.since < DAY).length;
        c.breaker = { items: of('breaker') }; c.breaker.n = c.breaker.items.length; c.breaker.fresh = c.breaker.items.filter(x => x.since && now - x.since < DAY).length;
        c.pdu = { items: of('pdu') }; c.pdu.n = c.pdu.items.length;
        c.shelf = { items: of('shelf') }; c.shelf.n = c.shelf.items.length;
        const hw = of('hw'), hosts = new Map(); hw.forEach(x => { const k = x.h || x.r; const e = hosts.get(k) || { ...x, parts: [] }; if (x.w && !e.parts.includes(x.w)) e.parts.push(x.w); hosts.set(k, e); });
        c.hw = { items: [...hosts.values()].map(x => ({ ...x, w: x.parts.join(', ') })), n: hosts.size };
        // Hottest inlet: liquid-cooled GPU trays (amber 55 °C, red 65 °C) and air-cooled host inlets (amber 32 °C, red 40 °C).
        const tray = of('tray').map(x => ({ ...x, kind: 'GPU tray', warn: 55, crit: 65 })), air = of('air').map(x => ({ ...x, kind: 'Host inlet', warn: 32, crit: 40 }));
        const hotAll = [...tray, ...air].sort((a, b) => (b.v - b.warn) - (a.v - a.warn));
        c.hot = { items: hotAll.filter(x => x.v >= x.warn), top: hotAll[0] || null }; c.hot.n = c.hot.items.length;
        c.hot.level = !c.hot.top ? 'none' : c.hot.top.v >= c.hot.top.crit ? 'critical' : c.hot.top.v >= c.hot.top.warn ? 'warning' : 'good';
        c.net = { items: of('net') }; c.net.n = c.net.items.length;
        const bc = of('blindCount'); c.blind = { items: of('blind'), n: bc.reduce((t, x) => t + x.v, 0), byJob: Object.fromEntries(bc.map(x => [x.w, x.v])) };
        // Worst first: a leak or a new breaker trip is critical, then heat over red, then everything amber.
        const level = c.leak.n || c.breaker.fresh || c.hot.level === 'critical' ? 'critical'
          : c.pdu.n || c.shelf.n || c.hw.n || c.net.n || c.hot.level === 'warning' ? 'warning' : 'good';
        const s = D.siteById(code);
        return { code, site: s || null, name: s?.name || '', kw: F.power?.[code] ?? null, checks: c, level,
          board: GF.sites?.[code]?.board ? GF.base + GF.sites[code].board : null };
      });
      // Every data center Lambda runs (NetBox active, staging or planned) is listed, even with no metrics in Grafana yet,
      // so a missing site reads "no data" instead of silently not being there.
      const none = () => ({ items: [], n: 0, fresh: 0 });
      for (const s of D.SITES.filter(s => s.kind === 'dc' && ['active', 'staging', 'planned'].includes(s.status) && !codes.has(s.id)))
        sites.push({ code: s.id, site: s, name: s.name, kw: null, level: 'nodata', board: null,
          checks: { leak: none(), breaker: none(), pdu: none(), shelf: none(), hw: none(), hot: { ...none(), top: null, level: 'none' }, net: none(), blind: { ...none(), byJob: {} } } });
      const rank = { critical: 0, warning: 1, good: 2, nodata: 3 };
      sites.sort((a, b) => rank[a.level] - rank[b.level] || b.checks.leak.n - a.checks.leak.n || b.checks.hw.n - a.checks.hw.n || a.code.localeCompare(b.code));
      const total = k => sites.reduce((t, s) => t + (s.checks[k].n || 0), 0);
      return { at: F.at, sites, CHECKS, totals: Object.fromEntries(CHECKS.map(([k]) => [k, total(k)])), errors: F.errors || {},
        freshBreakers: sites.reduce((t, s) => t + s.checks.breaker.fresh, 0), freshLeaks: sites.reduce((t, s) => t + s.checks.leak.fresh, 0) };
    })();
    const GRAFANA = GF ? { base: GF.base, links: Object.fromEntries(Object.entries(GF.links || {}).map(([k, u]) => [k, GF.base + u])) } : null;

    // Feed and KPIs
    D.FEED.push(
      ...BUILDS.flatMap(b => (b.milestones || []).filter(m => m.status === 'completed' && m.done).map(m => ({ b, m, at: Date.parse(m.done + (m.done.length === 10 ? 'T12:00:00' : '')) })))
        .filter(e => e.at > now - 7 * DAY && e.at <= now).map(({ b, m, at }) => ({ src: 'atium', at, ref: b.deploymentKey || b.site, text: `${b.name} · ${m.name} done${b.customer ? ` · ${b.customer}` : ''}` })),
      ...(() => { const g = new Map();
        for (const a of [...byHost.values()].flat()) if (a.hw && a.since > now - DAY && a.since <= now + 60e3) {
          const k = a.site + '|' + a.name, e = g.get(k) || { site: a.site, name: a.name, at: 0, hosts: [] }; e.at = Math.max(e.at, a.since); if (!e.hosts.includes(a.host)) e.hosts.push(a.host); g.set(k, e); }
        return [...g.values()].sort((a, b) => b.at - a.at).slice(0, 20).map(e => ({ src: 'grafana', at: e.at, ref: e.site,
          text: `${e.site} · ${e.name} on ${e.hosts.length > 1 ? `${e.hosts.length} hosts (${e.hosts.slice(0, 2).join(', ')}…)` : e.hosts[0]}` })); })(),
      ...MENTIONS.map(m => ({ src: 'slack', at: m.at, url: m.link, text: `${m.isDm ? 'DM' : '#' + m.channel} · ${m.user}: ${m.text}` })),
      ...(MAIL?.entries || []).map(e => ({ src: 'mail', at: e.at, url: e.link, text: `${e.from}: ${e.title}` })),
      ...MOVES.filter(m => m.at > now - 7 * DAY).slice(0, 25).map(m => ({ src: 'netsuite', at: m.at, ref: m.deploymentKey || m.site, text: `${m.doc} · ${m.type}${m.deployment ? ` · ${m.deployment}` : ''}${m.status ? ` · ${m.status}` : ''}` })),
    );
    D.FEED.sort((a, b) => b.at - a.at);
    if (DEPLOYMENTS.length) {
      const risky = DEPLOYMENTS.filter(d => d.health === 'critical' || d.health === 'warning').length;
      const gpus = DEPLOYMENTS.reduce((a, d) => a + (d.gpus || 0), 0);
      const next = DEPLOYMENTS.filter(d => d.end && d.end >= now).sort((a, b) => a.end - b.end)[0];
      // 30 days rebuilt from the epics: open now (by created date) plus those closed in the last 31 days.
      const CE = x.closedEpics, depTrend = CE ? last30(now).map(({ day, e }) => { const live = DEPLOYMENTS.filter(dd => dd.created && dd.created <= e), gone = CE.filter(([c, r]) => c <= e && r > e);
        return { day, v: live.length + gone.length, g: live.reduce((a, dd) => a + (dd.gpus || 0), 0) + gone.reduce((a, [, , sm]) => a + (parseDeploy(sm).gpus || 0), 0) }; }) : null;
      if (depTrend) { depTrend[depTrend.length - 1].v = DEPLOYMENTS.length; depTrend[depTrend.length - 1].g = gpus; }
      D.KPIS.splice(2, 0,
        { key: 'deps', num: DEPLOYMENTS.length, trend: depTrend, label: 'Active deployments', value: String(DEPLOYMENTS.length), sub: `${risky} at risk, off track or overdue`, tone: risky ? 'bad' : 'good' },
        { key: 'gpus', num: gpus, trend: depTrend && depTrend.map(x => ({ day: x.day, v: x.g })), label: 'GPUs in deployments', value: kfmt(gpus), sub: next ? `next due: ${next.site || next.key} · ${new Date(next.end).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '' });
    }

    const DI = new Map(DEPLOYMENTS.map(d => [d.key, d]));
    return Object.assign(D, {
      DEPLOYMENTS, PROJECTS, CHANNELS, MENTIONS, MAIL, EVENTS, MOVES, BUILDS, VOLUNTEER, GRAFANA, HEALTH,
      SMART: x.smart ? { on: !!x.smart.on, live: !!x.smart.live, label: x.smart.label || '', why: x.smart.why || '', at: x.smart.at || 0, calls: x.smart.calls || 0 } : null,
      AI_PRIORITY: SM?.prio?.order?.length ? SM.prio : null,
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
  function buildMock(note, smart = null) { // smart: optional AI answers (used by tests and demos)
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
      { key: 'open', num: TICKETS.length, upBad: true, label: 'Open DC tickets', value: String(TICKETS.length), sub: '+6 opened today', spark: series(4, 0.1, 5), sparkWhat: 'opened' },
      { key: 'breached', num: TICKETS.filter(isBreached).length, upBad: true, label: 'SLA breached', value: String(TICKETS.filter(isBreached).length), sub: `${TICKETS.filter(t => !isBreached(t) && t.slaDue < now + DAY).length} more due in 24h`, tone: 'bad' },
      { key: 'devices', num: SITES.reduce((a, s) => a + (s.status === 'active' ? s.devices : 0), 0), label: 'Devices in NetBox', value: kfmt(SITES.reduce((a, s) => a + (s.status === 'active' ? s.devices : 0), 0)), sub: `${SITES.filter(s => s.status === 'active').length} live sites` },
      { key: 'waiting', num: TICKETS.filter(t => /part/i.test(t.status)).length, upBad: true, label: 'Waiting on parts / RMA', value: String(TICKETS.filter(t => /part/i.test(t.status)).length), sub: '2 have the part on site', tone: 'bad' },
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
    D.SOURCES.splice(3, 0, ...['NetSuite', 'Gmail', 'Calendar', 'Atium', 'Grafana'].map(n => ({ key: n.toLowerCase(), name: n, state: 'demo', title: 'Demo data' })));
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
    // Demo volunteer requests (shape of live.js's Slack search), with demo Atium onsite sign-ups.
    const dday = n => new Date(now + n * 864e5).toISOString().slice(0, 10);
    const who = (names, from, to) => names.flatMap(nm => Array.from({ length: to - from + 1 }, (_, k) => ({ name: nm, date: dday(from + k), hours: 8 })));
    slackMock.volunteer = [
      { at: now - 2 * 864e5, channel: 'onsite-dc-ops', user: 'K. Jasso', link: '', atiumSites: [],
        text: 'Hey all, going to put a call out to all my DC Ops people: can we have some volunteers head over to QRO01 for the next 2 weeks as racking begins? We need 3-4 volunteers. Check with your managers, add yourself to the onsite schedule and let me know so I can make your access tickets.',
        demoSignups: who(['K. Jasso', 'B. Bui'], 0, 9), demoMe: 'You' },
      { at: now - 6 * 864e5, channel: 'dc_ops-ord01', user: 'T. Bond', link: '', atiumSites: [],
        text: 'ORD01 deployment could use extra hands for cabling next week. If you can help, add yourself to the onsite schedule: kelsier onsite-schedule link',
        demoSignups: [...who(['T. Bond', 'K. Doan'], 0, 4), ...who(['You'], 2, 4)], demoMe: 'You' },
      { at: now - 20 * 864e5, channel: 'onsite-dc-ops', user: 'B. Peters', link: '', atiumSites: [],
        text: 'DAL02 conversion: we are asking for your help from next week through the end of the month, mostly hardware repair. Speak with your manager if you are ready and willing to volunteer.',
        demoSignups: [], demoMe: 'You' },
    ];
    const gmailMock = { email: 'you@lambdal.com', unread: 4, entries: ['Weekly Ops Review agenda', 'PO approved: OSFP optics', 'QRO01 site visit logistics', 'Re: DAL02 power audit'].map((t, i) => ({ title: t, summary: '', from: pick(PEOPLE.slice(1)).name, fromEmail: '', at: now - (i + 1) * 3600e3 * 2, link: '' })) };
    const calMock = { events: [['9:00am', 'Standup_ORD01-5184xVR200'], ['10:00am', 'Superintelligence: Deployments Standup'], ['1:30pm', 'QRO01 15624xVR200 tranche review'], ['4:00pm', 'Weekly Ops Review']].map(([t, title], i) => {
      const d = new Date(); const [, h, m, ap] = t.match(/(\d+):(\d+)(am|pm)/); d.setHours((+h % 12) + (ap === 'pm' ? 12 : 0), +m, 0, 0); return { date: '', time: t, title, link: '', at: d.getTime() + (i > 2 ? 864e5 : 0), allDay: false }; }) };
    const nsMock = { base: '', onhand: SITES.filter(s => s.kind === 'dc' && s.status === 'active').flatMap(s => PARTS.map(p => ({ item: p.id.toUpperCase(), legacy: '', name: p.name, qty: int(0, 60), loc: `${s.id} | ${s.name}` }))),
      moves: Array.from({ length: 12 }, (_, i) => ({ date: '', at: now - i * 864e5 * 0.6, type: pick(['Transfer Order', 'Item Receipt', 'Material Movement']), doc: `TO${600 + i}`, deployment: pick(['Speed of Light QRO01', '5184x VR200 ORD01', 'Azure to On-Demand SEA01', '']), dcLoc: pick(['QRO01', 'ORD01', 'SEA01', 'DAL02']), from: 'Warehouse', to: '', status: pick(['Shipped', 'Received', 'Pending Fulfillment']), rma: 'No', tracking: '1Z' + int(100000, 999999) })) };
    // Demo Atium builds for the same deployments, in the shape live.js reads from Atium.
    const atBase = 'https://kelsier.aws.lambdalabs.cloud';
    const atSites = SITES.map((s, i) => ({ id: i + 1, name: `${s.id} - ${s.name}`, assets: int(300, 4500), consumables: int(10, 90) }));
    // Demo purchase orders (Atium has no prices: receiving progress and expected dates only).
    const iso = n => new Date(now + n * 864e5).toISOString().slice(0, 10);
    const po = (name, supplier, assets, assetsIn, cons, consIn, exp, kinds) => ({ id: name, name, supplier, status: assetsIn + consIn >= assets + cons ? 'closed' : 'open', date: iso(-40),
      assets, assetsIn, consumables: cons, consumablesIn: consIn, pct: (assetsIn + consIn) / Math.max(1, assets + cons), openLines: Object.values(kinds).reduce((a, b) => a + b, 0), kinds, expected: exp == null ? null : iso(exp), promise: exp == null ? null : iso(exp + 5) });
    const demoPOs = { ORD01: [po('PO4245', 'RXL Inc', 48, 12, 0, 0, -6, { device: 3, rack: 1 }), po('PO4310', 'FS', 0, 0, 220, 140, 4, { consumable: 6 }), po('US000386', 'LookingPoint Inc', 2, 0, 0, 0, 12, { device: 2 }), po('PO4102', 'Supermicro', 96, 96, 0, 0, null, {}), po('PO3987', 'Supermicro', 24, 8, 0, 0, -75, { device: 2 })],
      QRO01: [po('PO4401', 'Nvidia', 312, 0, 0, 0, 21, { rack: 4, device: 8 }), po('PO4388', 'FS', 0, 0, 480, 480, null, {})] };
    for (const a of atSites) { const code = a.name.slice(0, 5); if (demoPOs[code]) a.pos = demoPOs[code]; }
    const atIdOf = code => atSites.find(a => a.name.startsWith(code + ' '))?.id;
    const ms = (rx, rk, va, ho, done) => [['enable_receiving', 'Enable Receiving', rx], ['enable_racking', 'Enable Racking', rk], ['enable_validation', 'Enable Validation', va], ['hand_off', 'Hand Off', ho]]
      .map(([type, name, d], i) => ({ type, name, status: i < done ? 'completed' : 'scheduled', done: i < done ? dd(d) : null, scheduled: dd(d) }));
    const build = (name, site, customer, gpus, model, racked, validated, steps, done) => ({ id: name, name, siteId: atIdOf(site), customer, gpuModel: model, planned: gpus, installed: Math.round(gpus * validated), gpus,
      mw: Math.round(gpus / 400) || null, racked: Math.round(gpus / 8 * 1.3 * racked), devices: Math.round(gpus / 8 * 1.3), validated: Math.round(gpus / 8 * validated), hosts: Math.round(gpus / 8), conversion: false, epic: null, milestones: ms(...steps, done) });
    // Demo Grafana: live health for a few sites, with alerts on real demo devices (so tickets show them too).
    const gfAlert = (name, sev, dv, ago) => ({ name, severity: sev, host: dv.id, rack: dv.rack, u: String(dv.u || ''), since: now - ago * 60e3 });
    const devsAt = code => [...new Set([...D.TICKETS.filter(t => t.site === code).map(t => t.device), ...DEVICES_DEMO.filter(v => v.site === code).map(v => v.id)])].map(id => DEVICES_DEMO.find(v => v.id === id)).filter(Boolean); // ticket devices first
    const gfSite = (code, kw, inlet, list, unreach = 0) => { const dv = devsAt(code); const alerts = list.map(([n, s, i, ago]) => dv[i % Math.max(1, dv.length)] && gfAlert(n, s, dv[i % dv.length], ago)).filter(Boolean);
      const counts = {}; alerts.forEach(a => counts[a.name] = (counts[a.name] || 0) + 1); return { pduKw: kw, inlet: [{ temp: inlet, host: dv[0]?.id || '', rack: dv[0]?.rack || '' }], alerts, counts,
        unreachable: Array.from({ length: unreach }, (_, i) => ({ host: `${code.toLowerCase()}-sw-${i + 1}`, rack: 'r0' + (i + 1), role: 'leaf' })), clusters: ['CL01'], board: `/d/${code.toLowerCase()}-site-health` }; };
    const DEVICES_DEMO = D.DEVICES;
    const fx = (s, h, r, u, w, v = 1, extra = {}) => ({ s, h, r, ...(u ? { u } : {}), ...(w ? { w } : {}), v, ...extra });
    const fleetMock = { at: now, power: { ORD01: 1166, SEA01: 2000, DAL02: 1700, IAD03: 1242, QRO01: 840, ATL01: 646 }, errors: {}, checks: {
      leak: [fx('QRO01', 'qro01-cl01-mgx-01620', 'p02c14', '37', 'Chassis_0_LeakDetector_1_Manifold', 3, { since: now - 25 * 60e3 })],
      breaker: [fx('ORD01', 'ord01-p01c02-pdu-a1', 'p01c02', '', 'AA:L1-N-BR4', 12, { since: now - 50 * 60e3 }), fx('ORD01', 'ord01-p03c11-pdu-b1', 'p03c11', '', 'AA:L2-N-BR7', 12), fx('DAL02', 'dal02-p02c05-pdu-a2', 'p02c05', '', 'AA:L3-N-BR2', 13)],
      pdu: [fx('ORD01', 'ord01-p01c02-pdu-a1', 'p01c02', '', 'InputCord', 9), fx('DAL02', 'dal02-p04c09-pdu-a1', 'p04c09', '', 'PhaseVoltage', 9)],
      shelf: [fx('QRO01', 'qro01-cl01-pwr-01137', 'p05c19', '6', 'PSU 3', 0)],
      hw: [...D.DEVICES.filter(v => ['ORD01', 'DAL02', 'IAD03'].includes(v.site)).slice(0, 9).map((v, i) => fx(v.site, v.id, v.rack, String(v.u || ''), ['PSU', 'Fan', 'GPU', 'DIMM', 'BMC'][i % 5], 3))],
      tray: [fx('QRO01', 'qro01-cl01-mgx-00595', 'p04c06', '', '', 56.3), fx('QRO01', 'qro01-cl01-mgx-00412', 'p03c02', '', '', 48.1)],
      air: [fx('ORD01', 'ord01-r026-u4', 'r026', '', '', 28), fx('DAL02', 'dal02-r100-u15', 'r100', '', '', 41.2), fx('SEA01', 'sea01-r040-u20', 'r040', '', '', 23), fx('IAD03', 'iad03-r061-u18', 'r061', '', '', 33.5)],
      net: [fx('SEA01', 'sea01-sw-leaf-12', 'r12', '', 'leaf', 0)],
      blindCount: [fx('ORD01', '', '', '', 'pdu-snmp', 4), fx('SEA01', '', '', '', 'redfish-gpu-hosts', 12), fx('QRO01', '', '', '', 'powershelf-snmp', 2)],
      blind: [fx('ORD01', 'ord01-p02c08-pdu-b1', 'p02c08', '', 'pdu-snmp', 0), fx('SEA01', 'sea01-r033-u12', 'r033', '', 'redfish-gpu-hosts', 0)],
    } };
    const gfMock = { base: 'https://grafana.aws.lambdalabs.cloud', fleet: fleetMock, links: { dcOps: '/d/dc-ops-status/dc-ops-status', rackHealth: '/d/air-cooled-pod-floorplan-v6', pdu: '/d/pdu', gpuThermal: '/d/fre-gpu-thermal-throttling', repair: '/d/repair', dcAlerts: '/d/dc-alerts' }, sites: {
      ORD01: gfSite('ORD01', 1166, 28, [['PDUInputCordFault', 'critical', 0, 40], ['PDUInputCordFault', 'critical', 1, 55], ['GPUHealthFault', 'critical', 2, 180], ['ChassisPSUFault', 'warning', 3, 900], ['ChassisFanCritical', 'warning', 4, 3000]]),
      SEA01: gfSite('SEA01', 2000, 23, [['ChassisFanCritical', 'warning', 0, 600]], 1),
      DAL02: gfSite('DAL02', 1700, 41, [['GPUThermalThrottle', 'critical', 0, 25], ['FabricLinkDown', 'warning', 1, 120], ['MissingGPUIB', 'warning', 2, 300]]),
      IAD03: gfSite('IAD03', 1242, 33, [['ChassisPSUFault', 'critical', 0, 15], ['SlotReclaimFailed', 'warning', 1, 50]]),
    } };
    const atMock = { base: atBase, sites: atSites, builds: [
      build('QRO01-CL01 15624x VR200', 'QRO01', 'Anthropic', 15624, 'VR200', 0.04, 0, [-15, 30, 90, 200], 1),
      build('ORD01-DH02 5184x VR200 MaxQ', 'ORD01', 'Anthropic', 5184, 'VR200', 0.62, 0.31, [-60, -35, -10, 120], 3),
      build('DAL02-CL04 4032x VR200', 'DAL02', 'Microsoft', 4032, 'VR200', 0.88, 0.47, [-110, -80, -6, 58], 3),
      build('YQB01-CL02 2048x B300', 'YQB01', 'Nvidia', 2048, 'B300', 0.52, 0.12, [-25, -12, -3, 85], 2),
      build('SEA01-CL01 2040x H100 conversion', 'SEA01', 'Anthropic', 2040, 'H100', 1, 0.94, [-75, -60, -30, -4], 4),
    ] };
    return addWork(D, { portfolio, slack: slackMock, gmail: gmailMock, calendar: calMock, netsuite: nsMock, atium: atMock, grafana: gfMock, smart, codeOf: c => (D.siteById(String(c).toUpperCase().slice(0, 5)) || D.siteById(String(c)) || {}).id || null, meId: 'me' });
  }

  function finish(D) {
    const idx = (arr, k) => new Map(arr.map(x => [x[k], x]));
    const S = idx(D.SITES, 'id'), P = idx(D.PARTS, 'id'), U = idx(D.PEOPLE, 'id'), V = idx(D.DEVICES, 'id'), T = idx(D.TICKETS, 'key');
    return Object.assign(D, {
      siteById: id => S.get(id), partById: id => P.get(id), deviceById: id => V.get(id), ticketByKey: k => T.get(k),
      personById: id => U.get(id) || { id, name: 'Unassigned', handle: '' },
    });
  }

  /* ---------------- Site picker (top bar) ---------------- */
  // The choice is per person: 'all', 'mine' (sites of your tickets and tracked deployments) or a list of site codes.
  // Kept in chrome.storage (so notifications follow it too) and mirrored in localStorage (so the page opens instantly).
  const SCOPE_KEY = 'siteScope';
  async function loadScope() {
    try { if (typeof chrome !== 'undefined' && chrome.storage?.local) { const v = (await chrome.storage.local.get(SCOPE_KEY))[SCOPE_KEY]; if (v) return v; } } catch { /* fall back */ }
    try { return JSON.parse(localStorage.getItem('lambdaos-' + SCOPE_KEY)) || 'all'; } catch { return 'all'; }
  }
  async function saveScope(v) {
    try { localStorage.setItem('lambdaos-' + SCOPE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
    try { if (typeof chrome !== 'undefined' && chrome.storage?.local) await chrome.storage.local.set({ [SCOPE_KEY]: v }); } catch { /* ignore */ }
  }
  // Sites of your own tickets and tracked deployments (same idea as the Health tab's "Your sites").
  const yourSiteCodes = D => [...new Set([...D.TICKETS.filter(t => t.mine || t.assignee === 'me').map(t => t.site),
    ...(D.tracked ? D.tracked() : []).flatMap(d => d.sites || [])].filter(Boolean))].sort();

  // A copy of D limited to some sites: tickets, devices, deployments, shipments, builds, feed, health and the top cards
  // (with their 30-day charts where the history knows the site). The globe keeps every site; search keeps everything (D.ALL).
  function scope(D, choice) {
    const codes = choice === 'mine' ? yourSiteCodes(D) : Array.isArray(choice) ? choice.filter(c => D.siteById(c)) : [];
    if (!codes.length || choice === 'all') return Object.assign(D, { SCOPE: null, SCOPE_CHOICE: choice === 'mine' ? 'mine' : 'all', ALL: D });
    const S = new Set(codes), inS = c => !!c && S.has(c), anyS = arr => (arr || []).some(inS), now = Date.now();
    const siteIds = new Set(D.SITES.map(s => s.id));
    const codesIn = text => (String(text || '').toUpperCase().replace(/[-_]/g, ' ').match(/\b[A-Z]{3}\d{2}\b/g) || []).filter(c => siteIds.has(c));
    const TICKETS = D.TICKETS.filter(t => inS(t.site)), TK = new Set(TICKETS.map(t => t.key));
    const DEPLOYMENTS = (D.DEPLOYMENTS || []).filter(d => anyS(d.sites)), DK = new Set(DEPLOYMENTS.map(d => d.key));
    const PROJECTS = (D.PROJECTS || []).filter(p => anyS(p.sites));
    const ALLDK = new Set((D.DEPLOYMENTS || []).map(d => d.key)), ALLTK = new Set(D.TICKETS.map(t => t.key));
    const FEED = (D.FEED || []).filter(f => {
      if (f.src === 'mail') return true;
      if (f.ref && ALLTK.has(f.ref)) return TK.has(f.ref);
      if (f.ref && ALLDK.has(f.ref)) return DK.has(f.ref);
      if (f.ref && siteIds.has(f.ref)) return S.has(f.ref);
      const cs = codesIn(f.text); return cs.length ? cs.some(inS) : false;
    });
    const H = D.HEALTH ? { ...D.HEALTH, sites: D.HEALTH.sites.filter(s => S.has(s.code)) } : D.HEALTH;

    // Top cards for these sites.
    const R = D.RAW || {}, codeOf = R.codeOf || (x => x);
    const closed = R.closed30 && R.closed30.every(x => x.length >= 6)
      ? R.closed30.filter(([, , , , raws, host]) => { const c = (raws || []).map(codeOf).find(Boolean) || codeOf(host); return inS(c); }) : null;
    const tTrend = closed ? ticketTrend(TICKETS, closed, now) : null;
    const breached = TICKETS.filter(isBreached).length, due24 = TICKETS.filter(t => !isBreached(t) && t.slaDue && t.slaDue < now + DAY).length;
    const opened = TICKETS.filter(t => t.created >= startOfDay(now)).length;
    const live = D.SITES.filter(s => S.has(s.id) && (s.status === 'active' || s.status === 'staging'));
    const devs = live.reduce((a, s) => a + (s.devices || 0), 0), racks = live.reduce((a, s) => a + (s.racks || 0), 0);
    const waiting = TICKETS.filter(t => /part|rma/i.test(t.status));
    const stocked = waiting.filter(t => t.part && t.site && (D.siteById(t.site)?.inventory.find(i => i.part === t.part)?.stock || 0) > 0);
    const gpus = DEPLOYMENTS.reduce((a, d) => a + (d.gpus || 0), 0), risky = DEPLOYMENTS.filter(d => d.health === 'critical' || d.health === 'warning').length;
    const CE = R.closedEpics ? R.closedEpics.filter(([, , sm]) => codesIn(sm).some(inS)) : null;
    const depTrend = CE ? last30(now).map(({ day, e }) => { const lv = DEPLOYMENTS.filter(d => d.created && d.created <= e), gone = CE.filter(([c, r]) => c <= e && r > e);
      return { day, v: lv.length + gone.length, g: lv.reduce((a, d) => a + (d.gpus || 0), 0) + gone.reduce((a, [, , sm]) => a + (parseDeploy(sm).gpus || 0), 0) }; }) : null;
    if (depTrend) { depTrend[depTrend.length - 1].v = DEPLOYMENTS.length; depTrend[depTrend.length - 1].g = gpus; }
    const only = 'the 30-day chart is for all sites only';
    const KPIS = D.KPIS.map(k => {
      switch (k.key) {
        case 'open': return { ...k, num: TICKETS.length, value: TICKETS.length.toLocaleString(), sub: `+${opened} opened today`, trend: tTrend, scoped: true };
        case 'breached': return { ...k, num: breached, value: breached.toLocaleString(), sub: `${due24} more due in 24h`, tone: breached ? 'bad' : 'good', scoped: true,
          trend: tTrend && tTrend.map((x, i) => ({ day: x.day, v: i === tTrend.length - 1 ? breached : x.breached })) };
        case 'devices': return { ...k, num: devs, value: kfmt(devs), sub: `${racks.toLocaleString()} racks · ${only}`, trend: null, scoped: true, noHist: true };
        case 'waiting': return { ...k, num: waiting.length, value: waiting.length.toLocaleString(), sub: `${stocked.length} have the part on site · ${only}`, tone: stocked.length ? 'bad' : 'good', trend: null, scoped: true, noHist: true };
        case 'deps': return { ...k, num: DEPLOYMENTS.length, value: String(DEPLOYMENTS.length), sub: `${risky} at risk, off track or overdue`, tone: risky ? 'bad' : 'good', trend: depTrend, scoped: true };
        case 'gpus': return { ...k, num: gpus, value: kfmt(gpus), sub: '', trend: depTrend && depTrend.map(x => ({ day: x.day, v: x.g })), scoped: true };
        default: return k;
      }
    });
    return Object.assign(Object.create(D), {
      SCOPE: S, SCOPE_CHOICE: choice === 'mine' ? 'mine' : codes, ALL: D,
      TICKETS, DEPLOYMENTS, PROJECTS, FEED, HEALTH: H, KPIS,
      DEVICES: D.DEVICES.filter(d => inS(d.site)),
      MOVES: (D.MOVES || []).filter(m => inS(m.site)),
      BUILDS: (D.BUILDS || []).filter(b => inS(b.site)),
      tracked: () => D.tracked().filter(d => anyS(d.sites) || D.isTracked(d.key)),
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
    const D = await startRaw(); D.yourSites = () => yourSiteCodes(D);
    return scope(D, await loadScope());
  }
  async function startRaw() {
    TRACKED = new Set(await loadTracked());
    const ext = typeof chrome !== 'undefined' && chrome.storage?.local && typeof LambdaLive !== 'undefined';
    if (!ext) return buildMock('Opened outside the extension, so this is demo data.');
    const s = await LambdaLive.settings();
    if (s.mode === 'demo' || sessionStorage.getItem('lambdaos-demo')) return buildMock();
    const { snapshot } = await chrome.storage.local.get('snapshot');
    if (snapshot && (snapshot.nb || snapshot.jira)) {
      if (Date.now() - snapshot.at > 2 * 60e3 || (snapshot.jira && !('closed30' in snapshot.jira))) { // old snapshot, or one from before the 30-day ticket history
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
    ? { ready: start(), buildLive, buildMock, prepare, scope, loadScope, saveScope }
    : { buildLive, buildMock, prepare, scope, loadScope, saveScope };
})();
