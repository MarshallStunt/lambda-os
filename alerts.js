// Alerts and the daily brief. No DOM: used by the background worker (notifications, badge, daily history) and by the
// dashboard (the brief view). Input is the same `D` the dashboard draws (LambdaData.buildLive / buildMock).

const LambdaAlerts = (() => {
  const H = 3600e3, DAY = 24 * H;
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtLeft = ms => { const h = ms / H; return h >= 1 ? `${Math.floor(h)}h ${Math.round((ms / 60000) % 60)}m` : `${Math.max(1, Math.round(ms / 60000))}m`; };
  const breached = (t, now) => t.slaBreached || (t.slaDue != null && t.slaDue < now);
  const partOnHand = (D, t) => !!(t.part && t.site && (D.siteById(t.site)?.inventory.find(i => i.part === t.part)?.stock || 0) > 0);
  const waitingParts = t => /part|rma/i.test(t.status || '');
  const depLink = key => (typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(`newtab.html#dep=${encodeURIComponent(key)}`) : `newtab.html#dep=${key}`);

  // Sources that are signed out / not updating (closing the Slack tab is normal, so that case doesn't count).
  const troubled = D => (D.SOURCES || []).filter(s => (s.state === 'error' || s.state === 'stale')
    && !(s.key === 'slack' && /open slack/i.test(`${s.error || ''} ${s.title || ''}`)));
  const clock = t => { const d = new Date(t), today = new Date().toDateString() === d.toDateString();
    return d.toLocaleString([], today ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const outage = s => s.access ? 'needs access' : s.auth || /sign/i.test(s.error || '') ? 'signed out' : 'not updating';
  const DOWN_AFTER = 15 * 60e3; // alert once a source has been failing this long (one alert per outage)

  // Quiet hours: "22:00"–"07:00" style, may wrap past midnight.
  function quiet(cfg, now = Date.now()) {
    if (!cfg.quietFrom || !cfg.quietTo) return false;
    const m = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + (mm || 0); };
    const d = new Date(now), cur = d.getHours() * 60 + d.getMinutes(), a = m(cfg.quietFrom), b = m(cfg.quietTo);
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  }

  // Compares the current data with what was already alerted. The first run only records a baseline (no flood).
  function evaluate(D, prev, cfg, now = Date.now()) {
    const first = !prev?.init, notes = [];
    const next = { init: true, sla: {}, assigned: [], dep: {}, parts: [], mentionAt: prev?.mentionAt || 0, sites: {} };
    for (const t of D.TICKETS.filter(t => t.mine || t.assignee === 'me')) {
      const stage = breached(t, now) ? 'breached' : t.slaDue != null && t.slaDue - now < cfg.slaHours * H ? 'soon' : null;
      if (!stage) continue;
      next.sla[t.key] = stage;
      if (!first && cfg.myTickets && prev.sla?.[t.key] !== stage) notes.push({
        id: `sla:${t.key}:${stage}`, urgent: stage === 'breached', url: t.url,
        title: stage === 'breached' ? `SLA breached · ${t.key}` : `SLA due in ${fmtLeft(t.slaDue - now)} · ${t.key}`,
        message: [t.summary, t.site, t.status].filter(Boolean).join(' · ') });
    }
    next.assigned = D.TICKETS.filter(t => t.assignee === 'me').map(t => t.key);
    if (!first && cfg.assigned) for (const t of D.TICKETS.filter(t => t.assignee === 'me' && !(prev.assigned || []).includes(t.key))) notes.push({
      id: `assigned:${t.key}`, url: t.url, title: `Assigned to you · ${t.key}`, message: [t.summary, t.site, t.priority].filter(Boolean).join(' · ') });
    for (const d of D.tracked ? D.tracked() : []) {
      const sig = `${d.status}|${d.health}|${d.overdue ? 'overdue' : ''}`;
      next.dep[d.key] = { sig, status: d.status };
      const was = prev?.dep?.[d.key];
      if (!first && cfg.tracked && was && was.sig !== sig) notes.push({
        id: `dep:${d.key}:${sig}`, urgent: d.health === 'critical', url: depLink(d.key),
        title: `${d.key} ${d.overdue ? 'is overdue' : `→ ${d.status}`}${was.status !== d.status ? ` (was ${was.status})` : ''}`,
        message: [d.title, d.site, d.progress != null ? `${Math.round(d.progress * 100)}% done` : ''].filter(Boolean).join(' · ') });
    }
    const arrived = D.TICKETS.filter(t => (t.mine || t.assignee === 'me') && waitingParts(t) && partOnHand(D, t));
    next.parts = arrived.map(t => t.key);
    if (!first && cfg.parts) for (const t of arrived.filter(t => !(prev.parts || []).includes(t.key))) notes.push({
      id: `parts:${t.key}`, url: t.url, title: `Part on hand · ${t.key}`, message: `${D.partById(t.part)?.name || t.part} is in stock at ${t.site}. ${t.summary}` });
    const ments = (D.MENTIONS || []).filter(m => m.at > (prev?.mentionAt || 0));
    if (ments.length) next.mentionAt = Math.max(...ments.map(m => m.at));
    if (!first && cfg.mentions) for (const m of ments.slice(0, 5)) notes.push({
      id: `mention:${m.at}`, url: m.link, title: `${m.isDm ? 'Slack DM' : '#' + m.channel} · ${m.user}`, message: m.text });
    for (const s of D.SITES) if (s.health !== 'idle') next.sites[s.id] = s.health;
    if (!first && cfg.siteCritical) for (const s of D.SITES.filter(s => s.health === 'critical' && prev.sites?.[s.id] && prev.sites[s.id] !== 'critical')) notes.push({
      id: `site:${s.id}`, urgent: true, url: s.url || '', title: `${s.id} turned critical`, message: `${s.name} · ${s.breached} SLA breached · ${s.openTickets} open tickets` });
    next.srcAlerted = {};
    for (const s of troubled(D)) {
      const since = s.since || now;
      if (now - since < DOWN_AFTER) continue;
      next.srcAlerted[s.key] = since;
      if (cfg.sources !== false && prev?.srcAlerted?.[s.key] !== since) notes.push({
        id: `src:${s.key}:${since}`, url: s.url || '',
        title: `${s.name} ${outage(s)} since ${clock(since)}`,
        message: `${s.state === 'stale' && s.staleAt ? `Lambda OS is showing ${s.name} data from ${clock(s.staleAt)}. ` : ''}${s.access ? 'Click its yellow pill on the dashboard to allow access.' : s.url ? 'Click to sign in.' : (s.error || '')}` });
    }
    const urgentCount = D.TICKETS.filter(t => (t.mine || t.assignee === 'me') && (breached(t, now) || (t.slaDue != null && t.slaDue - now < cfg.slaHours * H))).length;
    return { notes, state: next, urgentCount, first };
  }

  // One compact record per day, so the brief can say what changed since yesterday.
  function record(D, now = Date.now()) {
    const deps = {};
    for (const d of D.DEPLOYMENTS || []) deps[d.key] = { status: d.status, health: d.health, progress: d.progress };
    return { at: now, open: D.TICKETS.length, breached: D.TICKETS.filter(t => breached(t, now)).length,
      mine: D.TICKETS.filter(t => t.mine).map(t => t.key), keys: D.TICKETS.map(t => t.key), deps };
  }
  function addToHistory(history, D, now = Date.now()) {
    const h = { ...(history || {}) };
    const today = dayKey(now);
    h[today] = { ...record(D, now), first: h[today]?.first || now }; // keep the day's first sighting too
    const keep = Object.keys(h).sort().slice(-21);
    return Object.fromEntries(keep.map(k => [k, h[k]]));
  }

  // The brief: structured sections the dashboard renders. `history` gives the previous day for the deltas.
  function brief(D, history, now = Date.now()) {
    const today = dayKey(now);
    const prevKey = Object.keys(history || {}).filter(k => k < today).sort().pop();
    const prev = prevKey ? history[prevKey] : null;
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    const mine = D.TICKETS.filter(t => t.mine || t.assignee === 'me');
    const myBreached = mine.filter(t => breached(t, now));
    const myDue = mine.filter(t => !breached(t, now) && t.slaDue != null && t.slaDue <= endToday.getTime()).sort((a, b) => a.slaDue - b.slaDue);
    const tracked = (D.tracked ? D.tracked() : []).map(d => {
      const p = prev?.deps?.[d.key];
      return { d, delta: p && p.progress != null && d.progress != null ? d.progress - p.progress : null, was: p && p.status !== d.status ? p.status : null };
    });
    const mySites = new Set([...mine.map(t => t.site), ...tracked.flatMap(x => x.d.sites)].filter(Boolean));
    const since = prev?.at || now - DAY;
    const prevKeys = new Set(prev?.keys || []);
    const newTickets = D.TICKETS.filter(t => (prev ? !prevKeys.has(t.key) : t.created > since) && (!mySites.size || mySites.has(t.site)));
    const lowSpares = [];
    for (const s of D.SITES.filter(s => mySites.has(s.id))) for (const i of s.inventory) if (i.alert > 0 && i.stock <= i.alert) lowSpares.push({ site: s.id, part: D.partById(i.part)?.name || i.part, stock: i.stock, alert: i.alert });
    return {
      date: new Date(now), prevDate: prevKey || null,
      meetings: (D.EVENTS || []).filter(e => e.at <= endToday.getTime() && e.at >= new Date(now).setHours(0, 0, 0, 0)),
      myBreached, myDue, myTotal: mine.length, tracked,
      partsArrived: mine.filter(t => waitingParts(t) && partOnHand(D, t)),
      newTickets: newTickets.sort((a, b) => b.created - a.created), mySites: [...mySites],
      fleet: { open: D.TICKETS.length, breached: D.TICKETS.filter(t => breached(t, now)).length, openWas: prev?.open ?? null, breachedWas: prev?.breached ?? null },
      lowSpares, unread: D.MAIL?.unread ?? null, mentions: (D.MENTIONS || []).filter(m => m.at > now - DAY),
      troubled: troubled(D).map(s => ({ ...s, label: outage(s), sinceText: s.since ? clock(s.since) : '', staleText: s.staleAt ? clock(s.staleAt) : '' })),
    };
  }

  // Next time the brief should fire, given "HH:MM" and 'weekdays' | 'daily'.
  function nextBriefAt(cfg, now = Date.now()) {
    const [h, m] = String(cfg.time || '08:30').split(':').map(Number);
    const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    while (cfg.days === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const briefDue = (cfg, now = Date.now()) => {
    if (!cfg.enabled) return false;
    const d = new Date(now), [h, m] = String(cfg.time || '08:30').split(':').map(Number);
    if (cfg.days === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) return false;
    return d.getHours() * 60 + d.getMinutes() >= h * 60 + (m || 0);
  };

  return { evaluate, addToHistory, brief, nextBriefAt, briefDue, quiet, dayKey, troubled, outage, clock };
})();

if (typeof self !== 'undefined') self.LambdaAlerts = LambdaAlerts;
