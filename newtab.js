// Lambda OS — new-tab dashboard. Pure canvas/DOM, no libraries (MV3 pages can't load remote code).
// Waits for data.js (live NetBox + Jira snapshot, or demo data), then draws everything from it.
const $ = s => document.querySelector(s);

LambdaData.ready.then(D => {
  $('#boot')?.remove();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = 3600e3;
  const isExt = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  // Canvas colors come from the stage, which stays dark in both themes (so a theme switch needs no repaint of the canvases).
  const stageStyle = getComputedStyle(document.querySelector('.stage') || document.documentElement);
  const cssVar = n => stageStyle.getPropertyValue(n).trim();
  const MONO = 'ui-monospace, Menlo, Consolas, "Cascadia Mono", "DejaVu Sans Mono", "Liberation Mono", monospace';
  const CALM = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = {};
  ['--good', '--warning', '--serious', '--critical', '--idle', '--accent', '--accent-2', '--text', '--text-2', '--muted', '--panel-solid',
    '--c-site', '--c-rack', '--c-device', '--c-ticket', '--c-part', '--c-person'].forEach(n => (C[n.slice(2)] = cssVar(n)));

  const STATUS = {
    good: { glyph: '✓', label: 'Healthy' }, warning: { glyph: '!', label: 'Degraded' },
    serious: { glyph: '!', label: 'Due soon' }, critical: { glyph: '✕', label: 'Critical' }, idle: { glyph: '○', label: 'No SLA' },
  };
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const siteStatusLabel = s => s.health === 'idle' ? cap(s.status) || 'Inactive' : STATUS[s.health].label;
  const fmtLeft = ms => {
    const neg = ms < 0, m = Math.abs(ms) / 60000, h = m / 60;
    const s = h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.floor(h)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
    return neg ? `${s} over` : `${s} left`;
  };
  const slaText = t => t.slaPaused ? 'SLA paused' : t.slaDue == null ? (t.slaBreached ? 'breached' : 'no SLA') : fmtLeft(t.slaDue - Date.now());
  const slaStatus = t => {
    if (t.slaBreached) return 'critical';
    if (t.slaPaused || t.slaDue == null) return 'idle';
    const left = t.slaDue - Date.now();
    return left < 0 ? 'critical' : left < 4 * H ? 'serious' : left < 24 * H ? 'warning' : 'good';
  };
  const urgency = t => (t.slaBreached ? -1e15 : 0) + (t.slaPaused || t.slaDue == null ? 1e15 : t.slaDue);
  const byUrgency = (a, b) => urgency(a) - urgency(b);
  const rel = at => { const s = (Date.now() - at) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
  const kfmt = n => n == null ? '—' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString();
  const statusChip = (st, text) => `<span class="status st-${st}" title="${STATUS[st].label}">${esc(text ?? STATUS[st].label)}</span>`;
  const healthBadge = s => `<span class="health st-${s.health}" aria-label="${esc(siteStatusLabel(s))}" title="${esc(siteStatusLabel(s))}"><b>${STATUS[s.health].glyph}</b></span>`;
  const partLabel = p => p ? (p.name && p.name !== p.pn ? `${p.name} (${p.pn})` : p.pn) : '';
  // Inventory row status: "Out" / "Low" against NetBox's alert-at quantity.
  const invStatus = i => i.alert > 0 && i.stock === 0 ? 'critical' : i.alert > 0 && i.stock <= i.alert ? 'warning' : 'good';
  const INV_LABEL = { critical: 'Out', warning: 'Low', good: 'OK' };
  // Your tickets: SLA urgency by default; with Smart processing on, the AI's order (anything it didn't rank follows by SLA).
  const aiRank = () => { const o = D.AI_PRIORITY?.order; return o?.length ? new Map(o.map((k, i) => [k, i])) : null; };
  const mineSorted = () => { const rk = aiRank(), mine = D.TICKETS.filter(t => t.mine).sort(byUrgency);
    return rk ? mine.sort((a, b) => (rk.get(a.key) ?? 1e9) - (rk.get(b.key) ?? 1e9) || byUrgency(a, b)) : mine; };
  const XC = { deployment: '#3ccf6e', project: '#f0efec', channel: '#d95926', event: '#c3c2b7' };
  const fmtDate = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: '2-digit' } : {}) }) : '—';
  const depStatus = d => d.overdue ? `Overdue · ${d.status}` : d.status;
  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
  const progressBar = (v, st) => `<span class="pbar"><i style="width:${Math.round((v || 0) * 100)}%;background:${st === 'idle' ? C.accent : C[st]}"></i></span>`;
  const star = d => `<button class="star ${D.isTracked(d.key) ? 'on' : ''}" data-track="${d.key}" title="${D.isTracked(d.key) ? 'Stop tracking' : 'Track this deployment'}" aria-label="${D.isTracked(d.key) ? 'Stop tracking' : 'Track'}">${D.isTracked(d.key) ? '★' : '☆'}</button>`;
  const relIn = at => { const m = Math.round((at - Date.now()) / 60000); return m < 1 ? 'now' : m < 60 ? `in ${m}m` : m < 1440 ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `in ${Math.round(m / 1440)}d`; };
  const depRow = d => `<li class="qitem dep" data-dep="${d.key}"><span class="qbar" style="background:${d.health === 'idle' ? C.idle : C[d.health]}"></span>
    <div style="min-width:0"><div class="qkey">${d.key}${d.site ? ' · ' + esc(d.site) : ''}${d.gpus ? ` · ${d.gpus.toLocaleString()}×${esc(d.gpuModel)}` : ''}</div><div class="qsum">${esc(d.title)}</div>
    <div class="qmeta">${progressBar(d.progress, d.health)} ${pct(d.progress)} · due ${fmtDate(d.end)}</div></div>
    <div class="sla st-${d.health}">${esc(depStatus(d))}<small>${star(d)}</small></div></li>`;


  let toastTimer;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  const openUrl = (url, what) => url ? window.open(url, '_blank', 'noopener') : toast(`${what} link isn't available${D.MODE === 'demo' ? ' in demo data' : ''}.`);
  const btn = (label, url, primary) => `<button class="btn ${primary ? 'primary' : ''}" data-url="${esc(url || '')}" data-what="${esc(label)}">${esc(label)}</button>`;

  /* ---------------- Top bar ---------------- */
  const badge = $('#modeBadge');
  badge.textContent = D.MODE === 'live' ? 'LIVE' : 'DEMO DATA';
  badge.classList.toggle('live', D.MODE === 'live');
  badge.title = D.MODE === 'live' ? 'Live NetBox and Jira data, using your own sign-ins' : (D.NOTE || 'Demo data. Switch to live in Settings.');
  // Healthy sources are just dots (name on hover); only sources that need you get a labeled, clickable pill.
  const needsYou = s => s.access || s.state === 'error' || s.state === 'stale';
  const pillLabel = s => s.access ? `${s.name} · allow` : s.auth ? `${s.name} · sign in` : s.state === 'stale' ? `${s.name} · stale` : `${s.name} · sign in`; // a sign-in problem says so, even with older data on screen
  // Every data source by name in the status strip; the ones that need you say why and are clickable.
  // (AI isn't listed here: its status lives in the ✨ Ask AI panel.)
  $('#sources').innerHTML = D.SOURCES.filter(s => s.key !== 'claude').map(s => needsYou(s)
    ? `<button class="source-pill ${s.state} ${s.access ? 'grant' : ''}" data-key="${s.key}" data-src-url="${esc(s.url || '')}" title="${esc(s.title)}"><i></i>${esc(pillLabel(s))}</button>`
    : `<span class="source-pill ${s.state}" title="${esc(s.title)}"><i></i>${esc(s.name)}${s.state === 'off' ? ' · off' : s.state === 'wait' ? ' · loading' : ''}</span>`).join('');
  $('#sources').addEventListener('click', async e => {
    const b = e.target.closest('.source-pill'); if (!b) return;
    const needs = D.SOURCES.filter(x => x.access).flatMap(x => x.access);
    if (D.SOURCES.find(x => x.key === b.dataset.key)?.access && isExt) {
      // Must be the first await after the click so Chrome treats it as a user gesture.
      const ok = await chrome.permissions.request({ origins: [...new Set(needs)] });
      if (!ok) return toast('Access not granted, so those sources stay off.');
      toast('Access granted. Loading…'); updated.hidden = false; updated.textContent = 'Refreshing…';
      await LambdaLive.refresh(m => (updated.textContent = m));
      return location.reload();
    }
    if (b.dataset.srcUrl) window.open(b.dataset.srcUrl, '_blank');
  });
  const updated = $('#updated');
  let SET_REFRESH = null;
  if (isExt) LambdaLive.settings().then(s => { SET_REFRESH = Number(s.refreshMinutes) || 0; paintUpdated(); }).catch(() => {});
  function paintUpdated(fresh) {
    const sm = D.SMART, tag = $('#smartTag');
    if (tag) { tag.hidden = D.MODE !== 'live' || !sm?.on; if (sm?.on) { tag.textContent = sm.live && !sm.why ? '✨ AI' : '✨ AI · local now';
      tag.className = `smart-tag ${sm.live && !sm.why ? 'ok' : 'warn'}`;
      tag.title = sm.why || `Smart processing with ${sm.label}: ${sm.calls ? `${sm.calls} request${sm.calls > 1 ? 's' : ''} last refresh` : 'nothing new to ask last refresh'}. Settings → Data → Smart processing.`; } }
    if (D.MODE !== 'live') { updated.hidden = true; return; }
    updated.hidden = false;
    const every = SET_REFRESH ? ` · every ${SET_REFRESH >= 60 ? '1h' : SET_REFRESH + 'm'}` : SET_REFRESH === 0 ? ' · manual' : '';
    // Compact in the top bar ("↻ 3m"); the full story is in the tooltip.
    updated.innerHTML = fresh ? '<b>↻ New</b>' : `↻ ${rel(D.AT)}`;
    updated.title = fresh ? 'New data is ready. It loads by itself once you’ve been idle for a minute, or click to load it now.'
      : `Updated ${rel(D.AT)}${rel(D.AT) === 'now' ? '' : ' ago'}${every.replace(' · ', ' · refreshes ')}. Click to refresh now (change the interval in Settings → Data).`;
    updated.classList.toggle('fresh', !!fresh);
  }
  paintUpdated(); setInterval(() => !updated.classList.contains('fresh') && paintUpdated(), 30000);
  updated.addEventListener('click', async () => {
    if (updated.classList.contains('fresh')) return location.reload();
    updated.textContent = 'Refreshing…';
    await LambdaLive.refresh(msg => (updated.textContent = msg));
    location.reload();
  });
  // Theme toggle: System → Light → Dark. Only CSS changes, so it's instant.
  const KEY = k => window.LambdaPlatform?.key(k) || `Ctrl+${k}`;
  $('#cmdKbd').textContent = KEY('K'); $('#aiBtn').title = `Ask the AI assistant (${KEY('J')})`;
  const lookBtn = $('#lookBtn'), THEMES = ['system', 'light', 'dark'], ICON = { system: '◐', light: '☀', dark: '☾' };
  const paintLook = () => { const t = window.LambdaLook?.current().theme || 'system'; lookBtn.textContent = ICON[t]; lookBtn.title = `Theme: ${t[0].toUpperCase() + t.slice(1)} (click to change · more in Settings → Appearance)`; };
  paintLook();
  lookBtn.addEventListener('click', async () => {
    const cur = window.LambdaLook.current(), next = THEMES[(THEMES.indexOf(cur.theme) + 1) % 3];
    await window.LambdaLook.save({ ...cur, theme: next }); paintLook(); toast(`Theme: ${next}`);
  });
  if (isExt) LambdaUpdates.check(false).then(u => {
    const b = $('#updBtn'); if (!u.available) return;
    b.hidden = false; b.title = `Lambda OS ${u.latest} is available (you have ${u.current}). Click for how to update.`;
    b.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html#updates') });
  }).catch(() => {});
  $('#settingsBtn').addEventListener('click', () => isExt ? chrome.runtime.openOptionsPage() : toast('Settings are available when running as the extension.'));
  // Newer data (from the background refresh or another tab): reload in place once you've been idle for a minute,
  // never while something is open. The view you were on is kept.
  let lastActivity = Date.now(), pendingReload = false;
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  const busyNow = () => !$('#palette').hidden || !$('#drawer').hidden || !$('#siteCard').hidden || !$('#brief').hidden || !$('#aiPanel').hidden || !$('#alertPop').hidden;
  function tryReload() {
    if (!pendingReload) return;
    if (document.visibilityState === 'hidden' || (!busyNow() && Date.now() - lastActivity > 60000)) location.reload();
  }
  function newData() { pendingReload = true; paintUpdated(true); tryReload(); }
  window.addEventListener('lambda:snapshot', newData);
  if (isExt) chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.snapshot?.newValue && ch.snapshot.newValue.at > D.AT) newData(); });
  setInterval(tryReload, 15000);
  document.addEventListener('visibilitychange', tryReload);

  function tickClock() {
    const d = new Date(), hr = d.getHours(), first = (D.ME.name || '').split(' ')[0];
    $('#clockTime').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#clockDate').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const hi = hr < 5 ? 'Late shift' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = first ? `${hi}, ${first}` : hi;
  }
  tickClock(); setInterval(tickClock, 15000);
  {
    const mine = mineSorted(), soon = mine.filter(t => ['critical', 'serious'].includes(slaStatus(t))).length;
    const sites = D.SITES.filter(s => s.health !== 'idle').length;
    $('#greetingSub').textContent = mine.length ? `${mine.length} tickets for you · ${soon} breached or due within 4h` : `${D.TICKETS.length.toLocaleString()} open tickets across ${sites} live sites`;
  }

  /* ---------------- KPI tiles ---------------- */
  function sparkPts(s) {
    const min = Math.min(...s), max = Math.max(...s), span = max - min || 1;
    return s.map((v, i) => [(i / (s.length - 1)) * 100, 27 - ((v - min) / span) * 24]);
  }
  function spark(s) {
    const p = sparkPts(s), line = 'M' + p.map(q => q.map(n => n.toFixed(1)).join(',')).join('L');
    return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity=".25"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line}L100,30L0,30Z"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/>
      <circle r="3" style="display:none" vector-effect="non-scaling-stroke"/><rect class="spark-hit" x="0" y="-6" width="100" height="40"/></svg>`;
  }
  // Each card: today's number, how it moved since yesterday (▲ / ▼), and a two-week mini chart of its daily values
  // (from the daily record Lambda OS keeps). Hover the chart for any day's value. Open tickets also say how many came
  // in and how many were closed since yesterday.
  const DAYMS = 864e5, dayKeyOf = t => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const backfill = (key, h) => key === 'open' ? h.open : key === 'breached' ? h.breached : key === 'deps' ? (h.deps ? Object.keys(h.deps).length : undefined) : undefined;
  function kpiHistory(hist) {
    if (D.MODE === 'demo') { // demo: a steady made-up fortnight ending at today's number
      let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      return Object.fromEntries(D.KPIS.filter(k => k.key).map(k => { let v = k.num; const pts = [k.num];
        for (let i = 0; i < 13; i++) { v = Math.max(0, Math.round(v - (rnd() - 0.45) * Math.max(2, k.num * 0.06))); pts.unshift(v); }
        return [k.key, pts.map((v, i) => ({ day: dayKeyOf(Date.now() - (13 - i) * DAYMS), v }))]; }));
    }
    const today = dayKeyOf(Date.now()), days = Object.keys(hist || {}).filter(x => x < today).sort().slice(-13);
    return Object.fromEntries(D.KPIS.filter(k => k.key).map(k => [k.key, [...days.map(dd => ({ day: dd, v: hist[dd].kpi?.[k.key] ?? backfill(k.key, hist[dd]) }))
      .filter(p => Number.isFinite(p.v)), { day: today, v: k.num }]]));
  }
  const kDay = dd => new Date(dd + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  function renderKpis(hist) {
    const H = kpiHistory(hist), prevRec = hist && Object.keys(hist).filter(x => x < dayKeyOf(Date.now())).sort().pop();
    $('#kpis').innerHTML = D.KPIS.map(k => {
      const pts = H[k.key] || [], prev = pts.length > 1 ? pts[pts.length - 2] : null, dlt = prev ? k.num - prev.v : null;
      const cls = !dlt ? 'flat' : !k.upBad ? 'neutral' : dlt > 0 ? 'bad' : 'good'; // red/green only where more is worse (tickets, breaches, waiting)
      const amount = v => Math.abs(v) >= 1000 ? kfmt(Math.abs(v)) : Math.abs(v).toLocaleString();
      const delta = dlt == null ? '<span class="kd flat" title="The day-by-day chart builds up as Lambda OS records each day">new: history starts today</span>'
        : `<span class="kd ${cls}" title="Change since ${esc(kDay(prev.day))} (${prev.v.toLocaleString()})">${dlt > 0 ? '▲' : dlt < 0 ? '▼' : '='} ${dlt ? amount(dlt) : 'same'} <small>vs ${prev.day === dayKeyOf(Date.now() - DAYMS) ? 'yesterday' : esc(kDay(prev.day))}</small></span>`;
      // Open tickets: what came in and what was closed since the last day on record.
      let flow = '';
      if (k.key === 'open' && hist && prevRec && hist[prevRec]?.keys) {
        const was = new Set(hist[prevRec].keys), now = new Set(D.TICKETS.map(t => t.key));
        const added = [...now].filter(x => !was.has(x)).length, closed = [...was].filter(x => !now.has(x)).length;
        flow = `<span class="kflow"><b class="up-bad">+${added}</b> new · <b class="up-good">−${closed}</b> closed</span>`;
      } else if (k.key === 'open' && D.MODE === 'demo') flow = '<span class="kflow"><b class="up-bad">+6</b> new · <b class="up-good">−4</b> closed</span>';
      return `<div class="kpi" data-k="${esc(k.key || '')}">
        <div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div>
        <div class="kpi-delta">${delta}${flow}</div>
        ${flow && k.key === 'open' ? '' : `<div class="kpi-sub"><span class="${k.tone === 'bad' ? 'up-bad' : k.tone === 'good' ? 'up-good' : ''}">${esc(k.sub || '')}</span></div>`}
        ${pts.length > 1 ? spark(pts.map(p => p.v)) + '<div class="spark-tip" hidden></div>' : ''}</div>`; }).join('');
    document.querySelectorAll('.kpi').forEach((el, i) => {
      const k = D.KPIS[i], svg = el.querySelector('svg'), pts = H[k.key] || [];
      if (!svg) return;
      const dot = svg.querySelector('circle'), tip = el.querySelector('.spark-tip'), xy = sparkPts(pts.map(p => p.v)), m = pts.length;
      svg.addEventListener('pointermove', ev => {
        const r = svg.getBoundingClientRect(), idx = Math.max(0, Math.min(m - 1, Math.round(((ev.clientX - r.left) / r.width) * (m - 1))));
        dot.setAttribute('cx', xy[idx][0]); dot.setAttribute('cy', xy[idx][1]); dot.style.display = '';
        const ch = idx ? pts[idx].v - pts[idx - 1].v : null;
        tip.textContent = `${kDay(pts[idx].day)} · ${pts[idx].v.toLocaleString()}${ch ? ` (${ch > 0 ? '+' : ''}${ch.toLocaleString()})` : ''}`; tip.hidden = false;
      });
      svg.addEventListener('pointerleave', () => { dot.style.display = 'none'; tip.hidden = true; });
    });
  }
  renderKpis(null);
  if (isExt) chrome.storage.local.get('history').then(r => renderKpis(r.history || null)).catch(() => {});

  // A source that isn't connected says so, instead of looking empty. Returns '' when the source is fine.
  function sourceNote(key, what) {
    const src = D.SOURCES.find(x => x.key === key);
    if (!src || !['error', 'stale'].includes(src.state)) return '';
    const label = LambdaAlerts.outage(src), since = src.since ? ` since ${LambdaAlerts.clock(src.since)}` : '';
    const action = src.url ? ` <a class="linkish" data-href="${esc(src.url)}">Sign in</a>` : src.access ? ' Use its yellow pill in the top bar.' : '';
    return src.state === 'stale'
      ? `<li class="src-note st-warning">⚠ ${esc(src.name)} ${label}${since}: showing ${what} from ${esc(LambdaAlerts.clock(src.staleAt))}.${action}</li>`
      : `<li class="src-note st-critical">${esc(src.name)} not connected${since}: ${esc(src.name === 'Slack' && /open slack/i.test(src.error || src.title) ? 'open Slack in a Chrome tab.' : label + '.')}${action}</li>`;
  }

  /* ---------------- Today (Google Calendar) ---------------- */
  function renderAgenda() {
    const box = $('#agendaPanel'), cal = D.SOURCES.find(s => s.key === 'calendar');
    if (!D.EVENTS?.length && (!cal || cal.state === 'off' || cal.state === 'wait' || cal.state === 'demo' && !D.EVENTS)) { box.hidden = true; return; }
    box.hidden = false;
    const now = Date.now(), endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const upcoming = D.EVENTS.filter(e => e.allDay ? e.at >= new Date().setHours(0, 0, 0, 0) : e.at > now - 30 * 60000);
    const todays = upcoming.filter(e => e.at <= endToday.getTime());
    const show = (todays.length >= 2 ? todays : upcoming).slice(0, 5), next = upcoming.find(e => !e.allDay && e.at > now);
    $('#agendaTitle').textContent = todays.length ? 'Today' : 'Coming up';
    $('#agendaNext').textContent = next ? `next ${relIn(next.at)}` : '';
    $('#agenda').innerHTML = show.map(e => `<li class="ev ${!e.allDay && e.at <= now ? 'now' : ''}" data-href="${esc(e.link)}" title="${esc(e.title)}">
      <span class="ev-time">${e.allDay ? 'All day' : new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.at > endToday.getTime() ? `<small>${new Date(e.at).toLocaleDateString([], { weekday: 'short' })}</small>` : ''}</span>
      <span class="ev-title">${esc(e.title)}</span>${e.deployment ? `<button class="tagchip" data-dep="${e.deployment}">${esc(D.deploymentByKey(e.deployment)?.site || e.deployment)}</button>` : e.site ? `<button class="tagchip" data-site="${esc(e.site)}">${esc(e.site)}</button>` : ''}</li>`).join('')
      || (sourceNote('calendar', 'events') ? '' : '<li class="muted small" style="padding:4px 14px 10px">Nothing scheduled.</li>');
    $('#agenda').insertAdjacentHTML('afterbegin', sourceNote('calendar', 'events'));
  }
  renderAgenda(); setInterval(renderAgenda, 60000);

  /* ---------------- Queue: tickets · tracking · inbox ---------------- */
  let qMode = 'tickets';
  $('#qtabs').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    qMode = b.dataset.q; document.querySelectorAll('#qtabs [data-q]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    renderQueue();
  });
  const inboxItems = () => [
    ...(D.MENTIONS || []).map(m => ({ src: 'slack', at: m.at, url: m.link, who: m.user, where: m.isDm ? 'DM' : '#' + m.channel, text: m.text })),
    ...(D.MAIL?.entries || []).map(e => ({ src: 'mail', at: e.at, url: e.link, who: e.from, where: 'Gmail', text: e.title })),
  ].sort((a, b) => b.at - a.at);
  // Volunteer requests (Slack call-outs) with who has signed up in the site's Atium onsite schedule.
  let ONSITE = null, onsiteAt = 0, onsiteBusy = false;
  const fmtDay = d => new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
  const span = ds => { const s = [...new Set(ds)].sort(); return s.length ? (s.length === 1 ? fmtDay(s[0]) : `${fmtDay(s[0])}–${fmtDay(s[s.length - 1])}`) : ''; };
  function signups(v) {
    if (v.demoSignups) return { me: v.demoMe || '', list: v.demoSignups };
    const list = ONSITE?.bySite?.[v.atiumId];
    return list === undefined || list === null ? null : { me: ONSITE.me, list };
  }
  function signupLine(v) {
    if (!v.atiumId) return '<span class="muted">No Atium onsite schedule found for this site</span>';
    const s = signups(v);
    if (!s) return `<span class="muted">${onsiteBusy ? 'Checking the Atium schedule…' : 'Atium schedule not loaded'}</span>`;
    const today = new Date().toISOString().slice(0, 10), ahead = s.list.filter(e => e.date >= today && e.hours > 0);
    const people = [...new Set(ahead.map(e => e.name))], mine = ahead.filter(e => s.me && e.name === s.me).map(e => e.date);
    const you = mine.length ? `<b class="st-good">You're on it: ${span(mine)}</b> · ` : '';
    return people.length ? `${you}${people.length} signed up for the next 4 weeks: ${esc(people.slice(0, 4).join(', '))}${people.length > 4 ? ` +${people.length - 4}` : ''}`
      : `${you}<span class="st-warning">No one signed up yet</span>`;
  }
  async function loadOnsite() {
    if (D.MODE !== 'live' || !isExt || onsiteBusy || Date.now() - onsiteAt < 10 * 60e3) return;
    const ids = [...new Set((D.VOLUNTEER || []).map(v => v.atiumId).filter(Boolean))];
    if (!ids.length) return;
    onsiteBusy = true;
    try { ONSITE = await LambdaLive.atiumOnsite(ids); onsiteAt = Date.now(); } catch { /* the rows say "not loaded" */ }
    onsiteBusy = false; if (qMode === 'volunteer') renderQueue();
    if (volOpen && !$('#drawer').hidden) { const y = $('#drawer').scrollTop; openVolunteers(); $('#drawer').scrollTop = y; }
  }
  // Short row (left column, site card); clicking it opens the full view in the drawer.
  const signupCount = v => { const s = signups(v); if (!s) return null; const today = new Date().toISOString().slice(0, 10);
    return new Set(s.list.filter(e => e.date >= today && e.hours > 0).map(e => e.name)).size; };
  const volRow = v => { const c = signupCount(v);
    return `<li class="qitem vol" data-vol="${esc(v.site)}" title="Open the full request">
      <div style="min-width:0"><div class="qkey">${esc(v.site)}${v.known ? ` · ${esc(D.siteById(v.site)?.name || '')}` : ''}</div>
        <div class="qsum">${esc(v.text)}</div>
        <div class="qmeta">${v.ai ? '✨ ' : ''}${esc(v.user)}${v.aiDates ? ` · ${esc(v.aiDates)}` : ''}${v.aiPeople ? ` · needs ${esc(v.aiPeople)}` : ''} · ${c == null ? 'see who signed up' : c ? `${c} signed up` : 'no one signed up yet'}</div></div>
      <span class="ftime">${rel(v.askedAt)}</span></li>`; };
  // Full view: the whole message, a two-week sign-up grid from the site's Atium onsite schedule, and big buttons.
  let volOpen = false;
  function volGrid(v) {
    const s = signups(v);
    if (!v.atiumId) return '<p class="muted">No Atium onsite schedule was found for this site, so sign-ups can\'t be shown. Reply in Slack instead.</p>';
    if (!s) return `<p class="muted">${onsiteBusy ? 'Checking the Atium onsite schedule…' : 'The Atium onsite schedule could not be loaded (sign in to Atium, then reopen).'}</p>`;
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10));
    const people = [...new Set(s.list.filter(e => e.hours > 0 && e.date >= days[0]).map(e => e.name))].sort((x, y) => (y === s.me) - (x === s.me));
    if (!people.length) return '<p class="vol-empty st-warning">No one has signed up yet. Check with your manager, then add your days in Atium.</p>';
    const hrs = (p, d) => s.list.filter(e => e.name === p && e.date === d).reduce((t, e) => t + e.hours, 0);
    const head = days.map(d => { const x = new Date(d + 'T12:00'); return `<th class="${[0, 6].includes(x.getDay()) ? 'we' : ''}">${x.toLocaleDateString([], { weekday: 'narrow' })}<br>${x.getDate()}</th>`; }).join('');
    const rows = people.slice(0, 12).map(p => `<tr class="${p === s.me ? 'me' : ''}"><td class="who">${esc(p === s.me ? "You" : p)}</td>${days.map(d => { const h = hrs(p, d); return `<td>${h ? `<i title="${h} h">${h}</i>` : ''}</td>`; }).join('')}</tr>`).join('');
    const later = people.length > 12 ? `<p class="muted small">+${people.length - 12} more</p>` : '';
    return `<div class="vol-grid"><table><tr><th class="who">${people.length} signed up · next 2 weeks</th>${head}</tr>${rows}</table></div>${later}`;
  }
  function openVolunteers(focus) {
    const vols = D.VOLUNTEER || [];
    volOpen = true;
    Drawer.open(`<div class="qkey">VOLUNTEER REQUESTS · SLACK + ATIUM</div><h3>Help wanted at other sites</h3>
      <p class="muted">Requests in Slack for people to help at another site's deployment (last 45 days). Check with your manager, then add your days to the site's Atium onsite schedule.</p>
      ${vols.map(v => `<section class="volcard${v.site === focus ? ' focus' : ''}" id="vol-${esc(v.site)}">
        <div class="volhead"><span class="volsite">${esc(v.site)}</span><span class="volname">${esc(v.known ? D.siteById(v.site)?.name || '' : '')}</span><span class="muted">${rel(v.askedAt)} ago</span></div>
        <p class="volmeta">Asked by <b>${esc(v.user)}</b> in #${esc(v.channel)} · ${new Date(v.askedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${v.messages > 1 ? ` · ${v.messages} messages about it` : ''}</p>
        <p class="voltext">${esc(v.text)}</p>
        ${v.aiDates || v.aiPeople ? `<p class="volai">✨ ${[v.aiDates && `<b>When:</b> ${esc(v.aiDates)}`, v.aiPeople && `<b>People needed:</b> ${esc(v.aiPeople)}`].filter(Boolean).join(' · ')}</p>` : ''}
        ${volGrid(v)}
        <div class="links">${v.scheduleUrl ? btn('Sign up in Atium', v.scheduleUrl, true) : ''}${btn('Open in Slack', v.link)}${v.known ? `<button class="btn" data-open="site:${esc(v.site)}">Site card</button>` : ''}</div>
      </section>`).join('') || '<p class="muted">No requests for volunteers in Slack in the last 45 days.</p>'}`, 'wide');
    if (focus) $(`#vol-${CSS.escape(focus)}`)?.scrollIntoView({ block: 'start' });
    loadOnsite();
  }
  document.addEventListener('click', e => {
    const v = e.target.closest('[data-vol]'); if (!v) return;
    if (!$('#brief').hidden) $('#brief').hidden = true;
    openVolunteers(v.dataset.vol);
  });

  function renderQueue() {
    const tracked = D.tracked(), inbox = inboxItems();
    const fresh = (D.MAIL?.unread || 0) + (D.MENTIONS || []).filter(m => m.at > Date.now() - 864e5).length;
    $('#trackCount').textContent = tracked.length || '';
    $('#ticketCount').textContent = mineSorted().length || '';
    $('#inboxCount').textContent = fresh || '';
    $('#queueNote').hidden = true;
    if (qMode === 'tracking') {
      $('#queueCount').textContent = tracked.length ? `${tracked.length} deployments` : '';
      $('#queue').innerHTML = tracked.map(depRow).join('') || '<li class="muted small" style="padding:10px 14px">Star ☆ a deployment (in the Deployments view, a drawer or search) to track it here. Deployments assigned to you or that you watch in Jira appear automatically.</li>';
      return;
    }
    const vols = D.VOLUNTEER || [];
    $('#volCount').textContent = vols.filter(v => v.at > Date.now() - 14 * 864e5).length || '';
    if (qMode === 'volunteer') {
      $('#queueCount').textContent = vols.length ? `${vols.length} site${vols.length > 1 ? 's' : ''} · 45 days` : '';
      $('#queue').innerHTML = (vols.length ? '<li class="vol-all"><button class="btn" data-vol="">Open full view ↗</button></li>' : '') + vols.map(volRow).join('') || (sourceNote('slack', 'volunteer requests') ? '' : '<li class="muted small" style="padding:10px 14px">No requests for volunteers in Slack in the last 45 days.</li>');
      $('#queue').insertAdjacentHTML('afterbegin', sourceNote('slack', 'volunteer requests'));
      loadOnsite();
      return;
    }
    if (qMode === 'inbox') {
      $('#queueCount').textContent = D.MAIL ? `${D.MAIL.unread} unread mail` : '';
      $('#queue').innerHTML = inbox.slice(0, 60).map(m => `<li class="qitem inbox" data-href="${esc(m.url)}">
        <div style="min-width:0"><div class="qkey"><span class="srctag src-${m.src}">${m.src === 'mail' ? 'Gmail' : 'Slack'}</span> ${esc(m.where)} · ${esc(m.who)}</div><div class="qsum">${esc(m.text)}</div></div><span class="ftime">${rel(m.at)}</span></li>`).join('')
        || ((sourceNote('gmail', 'mail') || sourceNote('slack', 'mentions')) ? '' : '<li class="muted small" style="padding:10px 14px">Nothing new from Slack or Gmail.</li>');
      $('#queue').insertAdjacentHTML('afterbegin', sourceNote('gmail', 'mail') + sourceNote('slack', 'mentions'));
      return;
    }
    const mine = mineSorted(), list = mine.length ? mine.slice(0, 100) : [...D.TICKETS].sort(byUrgency).slice(0, 30);
    $('#qTicketsLabel').textContent = mine.length ? 'Tickets' : 'Urgent'; $('#qTicketsLabel').parentElement.title = mine.length ? 'My tickets: assigned to, reported or watched by you' : 'Most urgent tickets fleet-wide';
    $('#queueCount').textContent = mine.length ? `${mine.length} open${aiRank() ? ' · ✨ AI order' : ''}` : 'fleet-wide';
    $('#queueCount').title = aiRank() ? 'Ordered by your AI provider (Settings → Data → Smart processing). Hover a ticket for the reason.' : '';
    $('#queueNote').hidden = !!mine.length || D.MODE !== 'live';
    $('#queue').innerHTML = list.map(t => {
      const st = slaStatus(t);
      return `<li class="qitem" data-ticket="${t.key}">
        <span class="qbar" style="background:${C[st]}"></span>
        <div style="min-width:0"><div class="qkey">${t.key} · ${esc(t.priority)}${t.alerts?.length ? ` <span class="alert-dot ${t.alerts.some(a => a.crit) ? 'crit' : ''}" title="${esc(t.alerts.slice(0, 3).map(a => a.name).join(', '))} firing on this device (Grafana)">⚠ ${t.alerts.length}</span>` : ''}</div><div class="qsum">${esc(t.summary)}</div>
          <div class="qmeta">${esc([t.site, t.device, t.status, !t.mine ? t.assigneeName : ''].filter(Boolean).join(' · '))}</div>${D.AI_PRIORITY?.reasons?.[t.key] && mine.length ? `<div class="qmeta ai-why">✨ ${esc(D.AI_PRIORITY.reasons[t.key])}</div>` : ''}</div>
        <div class="sla st-${st}">${STATUS[st].glyph} ${slaText(t)}<small>SLA</small></div></li>`;
    }).join('') || '<li class="muted" style="padding:10px">No open tickets.</li>';
  }
  renderQueue(); setInterval(renderQueue, 60000);

  /* ---------------- Sites list ---------------- */
  const listSites = () => D.SITES.filter(s => s.openTickets || s.devices || s.kind === 'dc')
    .sort((a, b) => b.openTickets - a.openTickets || (b.devices || 0) - (a.devices || 0));
  function renderSites() {
    const sites = listSites(), max = Math.max(1, ...sites.map(s => s.openTickets));
    $('#siteCount').textContent = `${sites.length} · by open tickets`;
    $('#siteList').innerHTML = sites.map(s =>
      `<li class="srow ${Fleet.selected === s ? 'sel' : ''} ${s.health === 'idle' ? 'dim' : ''}" data-site="${esc(s.id)}" title="${esc(s.fullName || s.id)}: ${s.openTickets} open tickets, ${esc(siteStatusLabel(s))}">
        <span class="code">${esc(s.id)}</span><span class="sname">${esc(s.name)}</span>
        <span style="display:flex;gap:6px;align-items:center"><span class="bar" style="flex:1"><i style="width:${(s.openTickets / max) * 100}%"></i></span><span class="n">${s.openTickets}</span></span>
        ${healthBadge(s)}</li>`).join('');
  }

  /* ---------------- Live feed ---------------- */
  const feed = [...D.FEED];
  const SRC = { jira: ['JR', 'Jira', '--src-jira'], netbox: ['NB', 'NetBox', '--src-netbox'], slack: ['SL', 'Slack', '--src-slack'],
    mail: ['GM', 'Gmail', '--src-mail'], netsuite: ['NS', 'NetSuite', '--src-netsuite'], atium: ['AT', 'Atium', '--src-atium'], grafana: ['GF', 'Grafana', '--src-grafana'] };
  const feedOn = Object.fromEntries(Object.keys(SRC).map(k => [k, true]));
  const present = Object.keys(SRC).filter(k => feed.some(f => f.src === k));
  $('#feedFilters').innerHTML = present.map(k => `<button class="chip on" data-src="${k}" aria-pressed="true" ><i style="background:var(${SRC[k][2]})"></i>${SRC[k][1]}</button>`).join('');
  $('#feedFilters').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    feedOn[b.dataset.src] = !feedOn[b.dataset.src]; b.classList.toggle('on'); b.setAttribute('aria-pressed', feedOn[b.dataset.src]); renderFeed();
  });
  function renderFeed(newCount = 0) {
    const shown = feed.filter(f => feedOn[f.src]).slice(0, 100);
    $('#feed').innerHTML = shown.map((f, i) =>
      `<li class="fitem ${i < newCount ? 'new' : ''}" ${f.url ? `data-href="${esc(f.url)}"` : `data-ref="${esc(f.ref ?? '')}"`}>
        <div class="fmeta"><span class="srctag src-${f.src}">${SRC[f.src][1]}</span><span class="ftime">${rel(f.at)}</span></div><div class="ftext">${esc(f.text)}</div></li>`).join('')
      || '<li class="muted" style="padding:10px">Nothing yet.</li>';
  }
  renderFeed();
  let lastPoll = Date.now();
  setInterval(async () => {
    const since = lastPoll; lastPoll = Date.now();
    const seen = new Set(feed.map(f => f.text + f.at));
    const items = (await D.pollFeed(since).catch(() => [])).filter(f => !seen.has(f.text + f.at) && SRC[f.src]);
    if (!items.length) return;
    feed.unshift(...items);
    renderFeed(items.filter(f => feedOn[f.src]).length);
  }, D.feedEveryMs);
  setInterval(() => renderFeed(), 30000);

  /* ---------------- Tooltip helper ---------------- */
  const tip = $('#tooltip');
  function showTip(x, y, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pr = tip.parentElement.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 14, pr.width - tr.width - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(y + 14, pr.height - tr.height - 8)) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------------- Land (Natural Earth outlines, shared by the globe and the map) ---------------- */
  const Land = (() => {
    const DEG = Math.PI / 180, MASK = 2048, rings = window.LAMBDA_LAND || [];
    const mx = lon => (lon + 180) / 360;
    const my = lat => { const p = Math.max(-82, Math.min(82, lat)) * DEG; return (1 - Math.log(Math.tan(Math.PI / 4 + p / 2)) / Math.PI) / 2; };
    let px = null;
    const mask = () => px ||= (() => { // Mercator raster of the land polygons, drawn once
      const c = document.createElement('canvas'); c.width = c.height = MASK;
      const g = c.getContext('2d'); g.fillStyle = '#fff';
      for (const r of rings) {
        g.beginPath();
        for (let i = 0; i < r.length; i += 2) { const x = mx(r[i]) * MASK, y = my(r[i + 1]) * MASK; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.fill();
      }
      return g.getImageData(0, 0, MASK, MASK).data;
    })();
    const isLand = (x, y) => { x = ((x % 1) + 1) % 1; if (y < 0 || y >= 1) return false; return mask()[(Math.floor(y * MASK) * MASK + Math.floor(x * MASK)) * 4 + 3] > 0; };
    return { mx, my, isLand, isLandLL: (lat, lon) => lat > -82 && lat < 82 && isLand(mx(lon), my(lat)), rings };
  })();

  /* ---------------- Real map imagery (tiles) ---------------- */
  // Satellite / street tiles drawn under the sites, on the globe (as a texture) and on the map (down to street level).
  // Plain <img> loads with CORS, so no extra permissions; attribution is shown on the stage as each provider requires.
  const Tiles = (() => {
    const PROVIDERS = {
      satellite: { label: 'Satellite', max: 19, tint: 0.16,
        url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        labels: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
        attr: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
    }; // Satellite + "Dots" (offline, no imagery). A saved choice that's no longer offered falls back to Satellite.
    // Every new tab starts on Dots (no imagery); Exact location switches to Satellite on its own.
    let name = 'off';
    const cache = new Map(), listeners = new Set();
    let version = 0, failures = 0, loads = 0;
    const key = (kind, z, x, y) => `${name}|${kind}|${z}|${x}|${y}`;
    function get(kind, z, x, y, request = true) {
      const k = key(kind, z, x, y);
      let t = cache.get(k);
      if (t || !request || name === 'off') return t;
      const p = PROVIDERS[name], url = kind === 'labels' ? p.labels?.(z, x, y) : p.url(z, x, y);
      if (!url) return null;
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      t = { img, ok: false, failed: false, used: performance.now() };
      img.onload = () => { t.ok = true; loads++; version++; listeners.forEach(f => f(kind, z, x, y, t)); };
      // A tile can fail CORS when the browser or CDN cache holds a copy saved without the CORS header. Retry once with
      // a cache-busting query so it's fetched fresh. Label tiles are an optional overlay: they don't count toward broken().
      let retried = false;
      img.onerror = () => {
        if (!retried) { retried = true; img.src = `${url}${url.includes('?') ? '&' : '?'}r=${Date.now() % 1e6}`; return; }
        t.failed = true; if (kind !== 'labels') failures++;
      };
      img.src = url;
      cache.set(k, t);
      if (cache.size > 900) { // drop the least recently used tiles
        const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 200);
        old.forEach(([k2]) => cache.delete(k2));
      }
      return t;
    }
    return {
      PROVIDERS, get, on: () => name !== 'off', name: () => name, provider: () => PROVIDERS[name] || null,
      version: () => version, broken: () => failures > 8 && failures > loads, onLoad: f => listeners.add(f),
      set: n => { if (n === name) return; name = n; version++; failures = 0; loads = 0; listeners.forEach(f => f('reset')); },
    };
  })();

  // Satellite-textured globe on the GPU: a full-screen shader inverts the same orthographic projection the 2D globe
  // uses, so markers drawn on top line up exactly. Falls back to the dot globe if WebGL or the tiles aren't available.
  const GlobeGL = (() => {
    const cv = $('#globegl');
    const gl = cv?.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: true });
    const Z = 3, N = 1 << Z, SIZE = 256 * N; // world texture from zoom-3 tiles (8×8 = 2048 px)
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = SIZE;
    const actx = atlas.getContext('2d');
    let tex = null, prog = null, dirty = false, have = 0, lastUpload = 0, w = 1, h = 1, dpr = 1;
    const need = () => N * N;
    if (gl) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision highp float;
        uniform vec2 uC; uniform float uR, uLon0, uLat0; uniform sampler2D uTex;
        void main() {
          vec2 p = (gl_FragCoord.xy - uC) / uR; float d = dot(p, p);
          if (d > 1.0) discard;
          float z2 = sqrt(1.0 - d);
          float y = p.y * cos(uLat0) + z2 * sin(uLat0), z = -p.y * sin(uLat0) + z2 * cos(uLat0);
          float lat = asin(clamp(y, -1.0, 1.0)), lon = atan(p.x, z) + uLon0;
          float u = fract(lon / 6.2831853 + 0.5);
          float lc = clamp(lat, -1.4844, 1.4844);
          float v = (1.0 - log(tan(0.7853982 + lc / 2.0)) / 3.1415927) / 2.0;
          vec3 c = texture2D(uTex, vec2(u, v)).rgb;
          float light = 0.62 + 0.38 * z2;
          gl_FragColor = vec4(c * light, 1.0);
        }`));
      gl.linkProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function build() {
      have = 0; actx.fillStyle = '#0b1530'; actx.fillRect(0, 0, SIZE, SIZE); dirty = true;
      if (!gl || !Tiles.on()) return;
      // Tiles already in the cache (e.g. switching back to this base map) don't fire onload again, so draw them now.
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const b = Tiles.get('base', Z, x, y), l = Tiles.get('labels', Z, x, y);
        if (b?.ok) { actx.drawImage(b.img, x * 256, y * 256, 256, 256); have++; if (l?.ok) actx.drawImage(l.img, x * 256, y * 256, 256, 256); }
      }
    }
    Tiles.onLoad((kind, z, x, y, t) => {
      if (kind === 'reset') return build();
      if (z !== Z) return;
      if (kind === 'base') {
        actx.drawImage(t.img, x * 256, y * 256, 256, 256); have++;
        const lab = Tiles.get('labels', Z, x, y, false); if (lab?.ok) actx.drawImage(lab.img, x * 256, y * 256, 256, 256); // keep labels on top
      } else if (Tiles.get('base', Z, x, y, false)?.ok) actx.drawImage(t.img, x * 256, y * 256, 256, 256);
      dirty = true;
    });
    if (gl) build();
    return {
      ready: () => !!gl && Tiles.on() && have >= N * N * 0.9 && !Tiles.broken(),
      show: on => { if (cv) cv.style.display = on ? 'block' : 'none'; },
      resize: (W, H, D) => { w = W; h = H; dpr = D; if (cv) { cv.width = W * D; cv.height = H * D; } },
      // Draws the textured sphere; returns true when the 2D globe should skip its own land drawing.
      draw(cx, cy, R, lon0, lat0) {
        if (!gl) return false;
        gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        if (!(Tiles.on() && have >= N * N * 0.9 && !Tiles.broken())) return false;
        const now = performance.now();
        if (dirty && now - lastUpload > 300) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas); dirty = false; lastUpload = now; }
        gl.useProgram(prog);
        gl.uniform2f(gl.getUniformLocation(prog, 'uC'), cx * dpr, (h - cy) * dpr);
        gl.uniform1f(gl.getUniformLocation(prog, 'uR'), R * dpr);
        gl.uniform1f(gl.getUniformLocation(prog, 'uLon0'), lon0 * Math.PI / 180);
        gl.uniform1f(gl.getUniformLocation(prog, 'uLat0'), lat0 * Math.PI / 180);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
      progress: () => `${Math.min(have, need())}/${need()}`,
      isReady: () => !!gl && Tiles.on() && have >= N * N * 0.9 && !Tiles.broken(),
    };
  })();

  /* ---------------- Globe ---------------- */
  const Globe = (() => {
    const cv = $('#globe'), ctx = cv.getContext('2d'), DEG = Math.PI / 180;
    const placed = D.SITES.filter(s => s.lat != null && s.lon != null);
    const show = { dc: true, pop: true, prem: true, idle: true };
    const visibleSite = s => s.health === 'idle' ? show.idle && show[s.kind === 'other' ? 'dc' : s.kind] !== false : show[s.kind === 'other' ? 'dc' : s.kind];
    const geo = (lat, lon) => { const p = lat * DEG, l = lon * DEG; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };

    // Frame the live data centers (wherever they are), weighted by size.
    function fit() {
      let pts = placed.filter(s => s.kind === 'dc' && s.health !== 'idle');
      if (!pts.length) pts = placed;
      if (!pts.length) return { lon: -98, lat: 38, zoom: 1 };
      const v = [0, 0, 0];
      pts.forEach(s => { const g = geo(s.lat, s.lon), w = Math.sqrt((s.devices || 0) + 1); v[0] += g[0] * w; v[1] += g[1] * w; v[2] += g[2] * w; });
      const n = Math.hypot(...v) || 1, c = v.map(x => x / n);
      const lat = Math.asin(c[2]) / DEG, lon = Math.atan2(c[1], c[0]) / DEG;
      const spread = Math.max(...pts.map(s => { const g = geo(s.lat, s.lon); return Math.acos(Math.min(1, g[0] * c[0] + g[1] * c[1] + g[2] * c[2])); }));
      return { lon, lat, zoom: Math.max(1, Math.min(2.6, 0.92 / Math.sin(Math.min(spread + 0.1, 1.45)))) };
    }
    const home = fit();
    let w = 1, h = 1, dpr = 1, lon0 = home.lon, lat0 = home.lat, zoom = home.zoom, zoomT = home.zoom, cx = 0, R = 1, target = null, lastInteract = 0;
    let drag = null, hover = null, world = false;
    const api = { selected: null };

    // Evenly spread points on the sphere: the ones on land become the continents, a sparse few mark the ocean.
    const landDots = [], seaDots = [];
    { const N = 24000;
      for (let i = 0; i < N; i++) {
        const y = 1 - (2 * (i + 0.5)) / N, th = i * Math.PI * (3 - Math.sqrt(5));
        const lat = Math.asin(y) / DEG, lon = (((th / DEG) % 360) + 360) % 360 - 180;
        if (Land.isLandLL(lat, lon)) landDots.push([lat, lon]); else if (i % 14 === 0) seaDots.push([lat, lon]);
      } }
    // Backbone: each live data center to its two nearest live neighbours.
    const hubs = placed.filter(s => s.kind === 'dc' && s.health !== 'idle');
    const links = [], seen = new Set();
    const dist = (a, b) => { const g = geo(a.lat, a.lon), q = geo(b.lat, b.lon); return Math.acos(Math.min(1, g[0] * q[0] + g[1] * q[1] + g[2] * q[2])); };
    for (const a of hubs) hubs.filter(b => b !== a && dist(a, b) > 0.004).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 2)
      .forEach(b => { const k = [a.id, b.id].sort().join(); if (!seen.has(k)) { seen.add(k); links.push([a, b]); } });

    function resize() { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; w = r.width || 1; h = r.height || 1; cv.width = w * dpr; cv.height = h * dpr; if (!cx) cx = w / 2; GlobeGL.resize(w, h, dpr); }
    new ResizeObserver(resize).observe(cv);

    function proj(lat, lon, alt = 0) {
      const p = lat * DEG, l = (lon - lon0) * DEG, p0 = lat0 * DEG, k = 1 + alt;
      const x = Math.cos(p) * Math.sin(l), y = Math.sin(p), z = Math.cos(p) * Math.cos(l);
      const y2 = y * Math.cos(p0) - z * Math.sin(p0), z2 = y * Math.sin(p0) + z * Math.cos(p0);
      return { x: cx + R * x * k, y: h / 2 - R * y2 * k, z: z2, out: (x * x + y2 * y2) * k * k > 1 };
    }
    function slerp(a, b, t) {
      const va = geo(a.lat, a.lon), vb = geo(b.lat, b.lon);
      const om = Math.acos(Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])), s = Math.sin(om) || 1;
      const k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s, v = [0, 1, 2].map(i => va[i] * k1 + vb[i] * k2);
      return { lat: Math.asin(v[2]) / DEG, lon: Math.atan2(v[1], v[0]) / DEG, om };
    }
    const vis = p => p.z > 0 || p.out;
    const radius = s => s.kind === 'dc' ? 3.5 + Math.min(4, Math.sqrt(s.devices || 0) / 28) : 3.2;
    function mark(s, x, y, r) {
      ctx.beginPath();
      if (s.kind === 'pop') { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.1, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.1, y); ctx.closePath(); }
      else if (s.kind === 'prem') ctx.rect(x - r, y - r, r * 2, r * 2);
      else ctx.arc(x, y, r, 0, 7);
    }

    function draw(now) {
      zoom += (zoomT - zoom) * 0.1;
      if (target) {
        lon0 += (target.lon - lon0) * 0.08; lat0 += (target.lat - lat0) * 0.08;
        if (Math.abs(target.lon - lon0) + Math.abs(target.lat - lat0) < 0.05) target = null;
      } else if (!drag && !api.selected && now - lastInteract > 6000) {
        if (world) lon0 += 0.04;
        else if (!CALM) lon0 += (home.lon + 10 * Math.sin(now / 16000) - lon0) * 0.004;
      }
      const card = !$('#siteCard').hidden, availW = card ? Math.max(200, w - 364) : w;
      cx += ((card ? availW / 2 : w / 2) - cx) * 0.12;
      R = Math.min(availW, h) * 0.4 * zoom;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const cy = h / 2;
      let g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.28);
      g.addColorStop(0, 'rgba(56,225,255,0.22)'); g.addColorStop(1, 'rgba(56,225,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.28, 0, 7); ctx.fill();
      const tex = GlobeGL.draw(cx, cy, R, lon0, lat0);
      if (tex) { // real imagery underneath: a light tint keeps markers readable, then the rim
        ctx.fillStyle = `rgba(5,7,13,${Tiles.provider()?.tint ?? 0.15})`; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      } else {
        g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
        g.addColorStop(0, '#13244a'); g.addColorStop(1, '#050915');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(56,225,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();

      if (!tex) {
      ctx.strokeStyle = 'rgba(130,190,255,0.08)'; ctx.beginPath();
      const seg = pts => { let on = false; for (const [la, lo] of pts) { const p = proj(la, lo); if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false; } };
      for (let la = -75; la <= 75; la += 15) seg(Array.from({ length: 121 }, (_, i) => [la, -180 + i * 3]));
      for (let lo = -180; lo < 180; lo += 15) seg(Array.from({ length: 61 }, (_, i) => [-90 + i * 3, lo]));
      ctx.stroke();

      ctx.fillStyle = '#7fb4ff';
      for (const [la, lo] of seaDots) {
        const p = proj(la, lo); if (p.z <= 0) continue;
        ctx.globalAlpha = 0.04 + 0.1 * p.z; ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
      }
      const ds = Math.min(2.6, 0.9 + zoom * 0.35);
      for (const [la, lo] of landDots) {
        const p = proj(la, lo); if (p.z <= 0) continue;
        ctx.globalAlpha = 0.2 + 0.55 * p.z; ctx.fillRect(p.x - ds / 2, p.y - ds / 2, ds, ds);
      }
      // coastlines, front side only
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(127,180,255,0.32)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (const r of Land.rings) {
        let on = false;
        for (let i = 0; i < r.length; i += 2) {
          const p = proj(r[i + 1], r[i]);
          if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false;
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      }
      if (show.dc) links.forEach(([a, b], li) => {
        const om = slerp(a, b, 0).om, lift = t => 0.35 * om * Math.sin(Math.PI * t);
        ctx.beginPath(); let on = false;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, q = slerp(a, b, t), p = proj(q.lat, q.lon, lift(t));
          if (vis(p)) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false;
        }
        ctx.strokeStyle = 'rgba(56,225,255,0.3)'; ctx.lineWidth = 1.1; ctx.stroke();
        const t = ((now / 2600) + li * 0.37) % 1, q = slerp(a, b, t), p = proj(q.lat, q.lon, lift(t));
        if (vis(p)) { ctx.fillStyle = '#c9f6ff'; ctx.shadowColor = C.accent; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
      });

      // Markers: small/inactive first so big data centers sit on top. Labels skip collisions.
      const order = placed.filter(visibleSite).sort((a, b) => (b.health === 'idle') - (a.health === 'idle') || (a.devices || 0) - (b.devices || 0));
      const labels = [];
      order.forEach((s, i) => {
        const p = proj(s.lat, s.lon); s._p = p; if (p.z <= 0.02) return;
        const idle = s.health === 'idle', col = idle ? C.idle : C[s.health], sel = api.selected === s, hov = hover === s, r = radius(s) * (sel || hov ? 1.3 : 1);
        if (!idle) {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.5);
          glow.addColorStop(0, col + '55'); glow.addColorStop(1, col + '00');
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.5, 0, 7); ctx.fill();
          if (s.health !== 'good') {
            const ph = ((now / 1600) + i * 0.29) % 1;
            ctx.strokeStyle = col; ctx.globalAlpha = (1 - ph) * 0.7; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 2 + ph * 14, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
          }
        }
        mark(s, p.x, p.y, r);
        if (idle) { ctx.fillStyle = C['panel-solid']; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = C['panel-solid']; ctx.lineWidth = 2; ctx.stroke(); }
        if (sel) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 7); ctx.stroke(); }
        if (s.deployments?.length) { // dashed orbit = deployments in progress here
          ctx.save(); ctx.setLineDash([3, 4]); ctx.lineDashOffset = -now / 60; ctx.strokeStyle = XC.deployment; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 9 + Math.min(6, s.deployments.length), 0, 7); ctx.stroke(); ctx.restore();
        }
        labels.push({ s, p, sel, hov, idle, pri: sel || hov ? 3 : s.kind === 'dc' && !idle ? 2 : zoom > 3.5 ? 1 : 0 });
      });
      const boxes = [];
      labels.filter(l => l.pri > 0).sort((a, b) => b.pri - a.pri || (b.s.devices || 0) - (a.s.devices || 0)).forEach(({ s, p, sel, hov, idle }) => {
        ctx.font = `600 11px ${MONO}`;
        const bw = ctx.measureText(s.id).width + 4, box = [p.x + 8, p.y - 7, p.x + 8 + bw, p.y + (sel || hov ? 20 : 7)];
        if (!(sel || hov) && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
        boxes.push(box);
        ctx.globalAlpha = Math.min(1, p.z * 2) * (idle ? 0.7 : 1);
        ctx.fillStyle = sel || hov ? '#fff' : C.text; ctx.fillText(s.id, p.x + 10, p.y + 4);
        if (sel || hov) { ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.muted; ctx.fillText(s.name, p.x + 10, p.y + 17); }
        ctx.globalAlpha = 1;
      });
    }

    const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const hit = (x, y) => {
      let best = null, bd = 14;
      for (const s of placed) if (s._p && s._p.z > 0.02 && visibleSite(s)) { const d = Math.hypot(s._p.x - x, s._p.y - y); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    cv.addEventListener('pointerdown', e => { const [x, y] = at(e); drag = { x, y, moved: 0 }; cv.setPointerCapture(e.pointerId); lastInteract = performance.now(); });
    cv.addEventListener('pointermove', e => {
      const [x, y] = at(e);
      if (drag) {
        const k = 180 / (Math.PI * R), dx = x - drag.x, dy = y - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = x; drag.y = y;
        lon0 -= dx * k; lat0 = Math.max(-80, Math.min(80, lat0 + dy * k)); target = null; lastInteract = performance.now(); hideTip(); return;
      }
      hover = hit(x, y); cv.style.cursor = hover ? 'pointer' : '';
      if (hover) showTip(x, y, `<b>${esc(hover.id)} · ${esc(hover.name)}</b>${hover.health === 'idle' ? statusChip('idle', cap(hover.status)) : statusChip(hover.health)}<br>
        <span>${hover.openTickets} open tickets${hover.breached ? ` · ${hover.breached} breached` : ''}${hover.racks != null ? ` · ${hover.racks} racks · ${kfmt(hover.devices)} devices` : ''}${hover.deployments?.length ? ` · ${hover.deployments.length} deployments` : ''}</span>`);
      else hideTip();
    });
    cv.addEventListener('pointerup', e => {
      const [x, y] = at(e); const wasClick = drag && drag.moved < 4; drag = null;
      if (wasClick) { const s = hit(x, y); if (s) SiteCard.open(s); }
    });
    cv.addEventListener('pointerleave', () => { hover = null; hideTip(); });
    cv.addEventListener('dblclick', () => api.home());
    cv.addEventListener('wheel', e => {
      e.preventDefault(); lastInteract = performance.now();
      zoomT = Math.max(0.6, Math.min(7, zoomT * Math.exp(-e.deltaY * 0.0015)));
      if (zoomT >= 6.5 && e.deltaY < 0) window.dispatchEvent(new CustomEvent('fleet:deeper', { detail: { lat: lat0, lon: ((lon0 + 540) % 360) - 180, R } }));
    }, { passive: false });

    api.focus = s => {
      api.selected = s; world = false;
      if (s.lat == null) return;
      target = { lon: lon0 + ((((s.lon - lon0) % 360) + 540) % 360 - 180), lat: s.lat };
      zoomT = Math.max(zoomT, home.zoom);
    };
    api.clear = () => { api.selected = null; };
    api.home = () => { world = false; zoomT = home.zoom; target = { lon: lon0 + ((((home.lon - lon0) % 360) + 540) % 360 - 180), lat: home.lat }; };
    api.world = () => { world = true; zoomT = 0.95; target = { lon: lon0, lat: 20 }; lastInteract = 0; };
    api.toggle = k => { show[k] = !show[k]; return show[k]; };
    api.draw = draw; api.resize = resize; api.placedCount = placed.length;
    return api;
  })();

  /* ---------------- Flat map (Mercator) ---------------- */
  // Dot-matrix land from bundled Natural Earth outlines, with the same markers, filters and cards as the globe.
  const FlatMap = (() => {
    const cv = $('#flatmap'), ctx = cv.getContext('2d'), DEG = Math.PI / 180;
    const placed = D.SITES.filter(s => s.lat != null && s.lon != null);
    const show = { dc: true, pop: true, prem: true, idle: true };
    const visibleSite = s => s.health === 'idle' ? show.idle && show[s.kind === 'other' ? 'dc' : s.kind] !== false : show[s.kind === 'other' ? 'dc' : s.kind];
    // Web Mercator in 0..1 "world" units (x wraps around, y clamped to ±82°).
    const { mx, my } = Land;
    const api = { selected: null, placedCount: placed.length, fromGlobe: false };
    const toLat = y => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
    let w = 1, h = 1, dpr = 1, cx = 0.5, cy = 0.4, S = 1, tcx = null, tcy = null, tS = null, drag = null, hover = null, lastInteract = 0, shift = 0, flyZ = -1;

    const isLand = Land.isLand;

    // Frame the live data centers (wherever they are).
    function fitBox(pts) {
      if (!pts.length) return { cx: 0.5, cy: 0.42, S: Math.max(w, 1) };
      const xs = pts.map(s => mx(s.lon)), ys = pts.map(s => my(s.lat));
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const availW = w - shift, sx = (availW * 0.78) / Math.max(maxX - minX, 0.02), sy = (h * 0.7) / Math.max(maxY - minY, 0.02);
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, S: Math.max(availW * 0.95, Math.min(sx, sy, availW * 60)) };
    }
    const homeBox = () => fitBox(placed.filter(s => s.kind === 'dc' && s.health !== 'idle'));

    function resize() {
      const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; w = r.width || 1; h = r.height || 1; cv.width = w * dpr; cv.height = h * dpr;
      if (S === 1) { const b = homeBox(); cx = b.cx; cy = b.cy; S = b.S; }
      base.key = '';
    }
    new ResizeObserver(resize).observe(cv);
    const toScreen = (x, y) => [w / 2 - shift / 2 + (x - cx) * S, h / 2 + (y - cy) * S];
    const toWorld = (sx, sy) => [cx + (sx - (w / 2 - shift / 2)) / S, cy + (sy - h / 2) / S];
    // Screen x of a world x, picking the wrapped copy nearest the view center.
    const wrapX = x => x + Math.round(cx - x);
    const site = s => { const [x, y] = toScreen(wrapX(mx(s.lon)), my(s.lat)); return { x, y }; };

    // Base layer (ocean glow, graticule, dot-matrix land, coastlines) only re-renders when the view changes.
    const base = document.createElement('canvas'), bctx = base.getContext('2d');
    base.key = '';
    function drawBase() {
      const key = `${cx.toFixed(7)}|${cy.toFixed(7)}|${S.toFixed(1)}|${w}|${h}|${shift.toFixed(1)}|${Tiles.name()}|${Tiles.version()}`;
      if (base.key === key) return;
      base.key = key; base.width = w * dpr; base.height = h * dpr;
      const g = bctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const vg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      vg.addColorStop(0, 'rgba(19,36,74,0.55)'); vg.addColorStop(1, 'rgba(5,9,21,0)');
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
      if (Tiles.on() && !Tiles.broken()) { drawTiles(g); return; }
      // graticule every 30°
      g.strokeStyle = 'rgba(130,190,255,0.07)'; g.lineWidth = 1; g.beginPath();
      for (let lon = -180; lon <= 180; lon += 30) for (let k = -1; k <= 1; k++) { const [x] = toScreen(mx(lon) + Math.round(cx) + k, 0); if (x > -2 && x < w + 2) { g.moveTo(x, 0); g.lineTo(x, h); } }
      for (let lat = -60; lat <= 60; lat += 30) { const [, y] = toScreen(0, my(lat)); g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
      // dot-matrix land, grid pinned to world coordinates so it doesn't shimmer while panning
      const px = Math.max(4, Math.min(9, 4 + S / 900)), sp = px / S;
      const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h);
      const r = Math.max(0.7, Math.min(1.6, px * 0.2));
      g.fillStyle = '#7fb4ff';
      for (let y = Math.floor(y0 / sp) * sp; y <= y1; y += sp) {
        if (y < 0 || y > 1) continue;
        const [, sy] = toScreen(0, y), fade = 0.18 + 0.32 * (1 - Math.abs(sy / h - 0.5) * 1.2);
        g.globalAlpha = Math.max(0.12, fade);
        for (let x = Math.floor(x0 / sp) * sp; x <= x1; x += sp) {
          if (!isLand(x, y)) continue;
          const [sx] = toScreen(x, y);
          g.fillRect(sx - r, sy - r, r * 2, r * 2);
        }
      }
      g.globalAlpha = 1;
      // faint coastlines for definition
      g.strokeStyle = 'rgba(127,180,255,0.22)'; g.lineWidth = 0.8;
      for (const ring of window.LAMBDA_LAND || []) {
        for (let k = -1; k <= 1; k++) {
          const off = Math.round(cx) + k;
          const [ax] = toScreen(mx(ring[0]) + off, 0);
          if (ax < -S || ax > w + S) continue;
          g.beginPath();
          for (let i = 0; i < ring.length; i += 2) { const [x, y] = toScreen(mx(ring[i]) + off, my(ring[i + 1])); i ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.closePath(); g.stroke();
        }
      }
    }

    // Real map tiles at the zoom level that matches the view; while a tile loads, a scaled-up parent fills in.
    function drawTiles(g) {
      const P = Tiles.provider(), z = Math.max(0, Math.min(P.max, Math.round(Math.log2(S / 256)))), n = 2 ** z, ts = S / n;
      const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h);
      for (let ty = Math.max(0, Math.floor(y0 * n)); ty <= Math.min(n - 1, Math.floor(y1 * n)); ty++) {
        for (let tx = Math.floor(x0 * n); tx <= Math.floor(x1 * n); tx++) {
          const X = ((tx % n) + n) % n, [sx, sy] = toScreen(tx / n, ty / n);
          tile(g, 'base', z, X, ty, sx, sy, ts);
          if (P.labels && z >= 2) tile(g, 'labels', z, X, ty, sx, sy, ts, true);
        }
      }
      if (P.tint) { g.fillStyle = `rgba(5,7,13,${P.tint})`; g.fillRect(0, 0, w, h); }
    }
    function tile(g, kind, z, x, y, sx, sy, ts, noFallback) {
      // While flying in, only the destination zoom is downloaded (fetched up front); in-between levels use what's cached.
      const t = Tiles.get(kind, z, x, y, tS == null || z === flyZ);
      if (t?.ok) { t.used = performance.now(); g.drawImage(t.img, sx, sy, ts + 0.6, ts + 0.6); return; }
      if (noFallback) return;
      for (let k = 1; k <= 5 && z - k >= 0; k++) {
        const p = Tiles.get(kind, z - k, x >> k, y >> k, false);
        if (!p?.ok) continue;
        const sub = 256 / (1 << k), ox = (x - ((x >> k) << k)) * sub, oy = (y - ((y >> k) << k)) * sub;
        g.drawImage(p.img, ox, oy, sub, sub, sx, sy, ts + 0.6, ts + 0.6); return;
      }
    }

    // Backbone: each live data center to its two nearest live neighbours.
    const hubs = placed.filter(s => s.kind === 'dc' && s.health !== 'idle');
    const links = [], seen = new Set();
    const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * DEG));
    for (const a of hubs) hubs.filter(b => b !== a && dist(a, b) > 0.3).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 2)
      .forEach(b => { const k = [a.id, b.id].sort().join(); if (!seen.has(k)) { seen.add(k); links.push([a, b]); } });
    const radius = s => s.kind === 'dc' ? 3.5 + Math.min(4, Math.sqrt(s.devices || 0) / 28) : 3.2;
    function mark(s, x, y, r) {
      ctx.beginPath();
      if (s.kind === 'pop') { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.1, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.1, y); ctx.closePath(); }
      else if (s.kind === 'prem') ctx.rect(x - r, y - r, r * 2, r * 2);
      else ctx.arc(x, y, r, 0, 7);
    }
    const ctrl = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); return { x: (a.x + b.x) / 2 + dy * 0.18 * Math.sign(dx || 1) * -1, y: (a.y + b.y) / 2 - Math.abs(dx) * 0.18 - d * 0.04 }; };

    function draw(now) {
      // animate toward targets
      const card = !$('#siteCard').hidden;
      shift += ((card ? 364 : 0) - shift) * 0.15;
      if (tS != null) {
        cx += (tcx - cx) * 0.1; cy += (tcy - cy) * 0.1; S += (tS - S) * 0.1;
        // "Arrived" is relative to the zoom: within half a pixel on screen and 0.2% of the scale.
        if (Math.abs(tcx - cx) * S < 0.5 && Math.abs(tcy - cy) * S < 0.5 && Math.abs(tS - S) < Math.max(0.5, tS * 2e-3)) { cx = tcx; cy = tcy; S = tS; tS = null; }
      }
      cy = Math.max(0.02, Math.min(0.98, cy));
      drawBase();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (show.dc) links.forEach(([a, b], li) => {
        const A = site(a), B = site(b); let Bx = B.x;
        if (Math.abs(Bx - A.x) > S / 2) Bx += Bx > A.x ? -S : S; // shortest way round
        const P = { x: Bx, y: B.y }, c = ctrl(A, P);
        ctx.strokeStyle = 'rgba(56,225,255,0.3)'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(c.x, c.y, P.x, P.y); ctx.stroke();
        const t = ((now / 2600) + li * 0.37) % 1, u = 1 - t;
        const x = u * u * A.x + 2 * u * t * c.x + t * t * P.x, y = u * u * A.y + 2 * u * t * c.y + t * t * P.y;
        ctx.fillStyle = '#c9f6ff'; ctx.shadowColor = C.accent; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      });

      const order = placed.filter(visibleSite).sort((a, b) => (b.health === 'idle') - (a.health === 'idle') || (a.devices || 0) - (b.devices || 0));
      const labels = [];
      order.forEach((s, i) => {
        const p = site(s); s._fp = p;
        if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) return;
        const idle = s.health === 'idle', col = idle ? C.idle : C[s.health], sel = api.selected === s, hov = hover === s, r = radius(s) * (sel || hov ? 1.3 : 1);
        if (!idle) {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.5);
          glow.addColorStop(0, col + '55'); glow.addColorStop(1, col + '00');
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.5, 0, 7); ctx.fill();
          if (s.health !== 'good') {
            const ph = ((now / 1600) + i * 0.29) % 1;
            ctx.strokeStyle = col; ctx.globalAlpha = (1 - ph) * 0.7; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 2 + ph * 14, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
          }
        }
        mark(s, p.x, p.y, r);
        if (idle) { ctx.fillStyle = C['panel-solid']; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = C['panel-solid']; ctx.lineWidth = 2; ctx.stroke(); }
        if (sel) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 7); ctx.stroke(); }
        if (s.deployments?.length) {
          ctx.save(); ctx.setLineDash([3, 4]); ctx.lineDashOffset = -now / 60; ctx.strokeStyle = XC.deployment; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 9 + Math.min(6, s.deployments.length), 0, 7); ctx.stroke(); ctx.restore();
        }
        if (S > 256 * 2 ** 13) { // street level: a pin with the exact point
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y - r - 10); ctx.lineTo(p.x, p.y - r); ctx.stroke();
        }
        labels.push({ s, p, sel, hov, idle, pri: sel || hov ? 3 : s.kind === 'dc' && !idle ? 2 : S > w * 6 ? 1 : 0 });
      });
      const boxes = [];
      labels.filter(l => l.pri > 0).sort((a, b) => b.pri - a.pri || (b.s.devices || 0) - (a.s.devices || 0)).forEach(({ s, p, sel, hov, idle }) => {
        ctx.font = `600 11px ${MONO}`;
        const bw = ctx.measureText(s.id).width + 4, box = [p.x + 8, p.y - 7, p.x + 8 + bw, p.y + (sel || hov ? 20 : 7)];
        if (!(sel || hov) && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
        boxes.push(box);
        ctx.globalAlpha = idle ? 0.7 : 1;
        ctx.fillStyle = sel || hov ? '#fff' : C.text; ctx.fillText(s.id, p.x + 10, p.y + 4);
        if (sel || hov) { ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = C.muted; ctx.fillText(s.name, p.x + 10, p.y + 17); }
        ctx.globalAlpha = 1;
      });
    }

    const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const hit = (x, y) => {
      let best = null, bd = 14;
      for (const s of placed) if (s._fp && visibleSite(s)) { const d = Math.hypot(s._fp.x - x, s._fp.y - y); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    cv.addEventListener('pointerdown', e => { const [x, y] = at(e); drag = { x, y, moved: 0 }; cv.setPointerCapture(e.pointerId); tS = null; lastInteract = performance.now(); });
    cv.addEventListener('pointermove', e => {
      const [x, y] = at(e);
      if (drag) {
        const dx = x - drag.x, dy = y - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = x; drag.y = y;
        cx -= dx / S; cy -= dy / S; hideTip(); return;
      }
      hover = hit(x, y); cv.style.cursor = hover ? 'pointer' : '';
      if (hover) showTip(x, y, `<b>${esc(hover.id)} · ${esc(hover.name)}</b>${hover.health === 'idle' ? statusChip('idle', cap(hover.status)) : statusChip(hover.health)}<br>
        <span>${hover.openTickets} open tickets${hover.breached ? ` · ${hover.breached} breached` : ''}${hover.racks != null ? ` · ${hover.racks} racks · ${kfmt(hover.devices)} devices` : ''}${hover.deployments?.length ? ` · ${hover.deployments.length} deployments` : ''}</span>`);
      else hideTip();
    });
    cv.addEventListener('pointerup', e => {
      const [x, y] = at(e); const wasClick = drag && drag.moved < 4; drag = null;
      if (wasClick) { const s = hit(x, y); if (s) SiteCard.open(s); }
    });
    cv.addEventListener('pointerleave', () => { hover = null; hideTip(); });
    cv.addEventListener('dblclick', () => api.home());
    cv.addEventListener('wheel', e => {
      e.preventDefault(); tS = null;
      const [x, y] = at(e), [wx, wy] = toWorld(x, y);
      S = Math.max(w * 0.85, Math.min(256 * 2 ** 20, S * Math.exp(-e.deltaY * 0.0015)));
      if (api.fromGlobe && e.deltaY > 0 && S < w * 2.2) { window.dispatchEvent(new CustomEvent('fleet:shallower', { detail: { lat: toLat(cy), lon: ((cx % 1) + 1) % 1 * 360 - 180 } })); return; }
      cx = wx - (x - (w / 2 - shift / 2)) / S; cy = wy - (y - h / 2) / S;
    }, { passive: false });

    const goTo = (x, y, s) => { tcx = x + Math.round(cx - x); tcy = y; tS = s; }; // nearest wrapped copy
    api.focus = s => { api.selected = s; if (s.lat != null) goTo(mx(s.lon), my(s.lat), Math.max(S, homeBox().S * 1.4)); };
    // Jump straight to a spot at a given tile zoom (17 ≈ individual buildings).
    // Exact location: centre on the spot at once and zoom the last few levels (no long pan across the country, which
    // used to download every zoom level on the way: ~2,000 tiles). The destination tiles are requested first.
    const prefetch = (x, y, z) => { const P = Tiles.provider(); if (!P) return; const zz = Math.min(P.max, z), n = 2 ** zz, s = 256;
      const hx = Math.ceil((w / 2) / s) + 1, hy = Math.ceil((h / 2) / s) + 1, tx = Math.floor(x * n), ty = Math.floor(y * n);
      for (let dy = -hy; dy <= hy; dy++) for (let dx = -hx; dx <= hx; dx++) { const X = (((tx + dx) % n) + n) % n, Y = ty + dy; if (Y < 0 || Y >= n) continue;
        Tiles.get('base', zz, X, Y); if (P.labels) Tiles.get('labels', zz, X, Y); } };
    api.flyTo = (lat, lon, z, instant) => {
      const x = mx(lon), y = my(lat), s2 = 256 * 2 ** z;
      if (instant) { cx = x; cy = y; S = s2; tS = null; base.key = ''; return; }
      flyZ = Math.min(Tiles.provider()?.max ?? z, z); prefetch(x, y, z - 4); prefetch(x, y, z); // backdrop for the zoom, then the street level
      cx = x; cy = y; tcx = x; tcy = y; S = Math.min(Math.max(S, 256 * 2 ** (z - 4)), s2); tS = s2; base.key = '';
    };
    api.clear = () => { api.selected = null; };
    api.home = () => { const b = homeBox(); goTo(b.cx, b.cy, b.S); };
    api.world = () => goTo(0.5, 0.45, Math.max(w - shift, 1) * 0.98);
    api.toggle = k => { show[k] = !show[k]; return show[k]; };
    api.draw = draw; api.resize = resize; api.debug = () => ({ cx, cy, S, w, h, z: Math.round(Math.log2(S / 256)), tS });
    return api;
  })();

  // Every new tab starts on the globe, fitted to the live sites, with Dots; the flat map is one click away.
  let fleetMode = 'globe', autoSat = false; // autoSat: Satellite was switched on by Exact location, so leaving goes back to Dots
  const backToDots = () => { if (autoSat) { autoSat = false; Tiles.set('off'); } };
  const fleetImpl = () => fleetMode === 'globe' ? Globe : FlatMap;
  const Fleet = {
    get selected() { return fleetImpl().selected; }, get placedCount() { return fleetImpl().placedCount; },
    focus: s => { FlatMap.focus(s); Globe.focus(s); }, clear: () => { FlatMap.clear(); Globe.clear(); },
    home: () => fleetImpl().home(), world: () => fleetImpl().world(), toggle: k => { Globe.toggle(k); return FlatMap.toggle(k); },
    draw: t => fleetImpl().draw(t), resize: () => fleetImpl().resize(), canvasId: () => fleetMode === 'globe' ? 'globe' : 'flatmap',
    setMode: m => { fleetMode = m; if (m === 'globe') { FlatMap.fromGlobe = false; backToDots(); } },
    mode: () => fleetMode,
    exact: s => { // fly to the site's exact coordinates on the street-level map
      if (s.lat == null) return toast('No coordinates for this site in NetBox.');
      if (!Tiles.on()) { Tiles.set('satellite'); autoSat = true; }
      FlatMap.fromGlobe = fleetMode === 'globe'; fleetMode = 'map'; FlatMap.selected = s;
      setView('globe'); FlatMap.flyTo(s.lat, s.lon, 17);
    },
  };
  window.addEventListener('fleet:deeper', e => { // zoomed far into the globe → continue on the map at the same spot
    if (activeView !== 'globe' || fleetMode !== 'globe') return;
    const { lat, lon } = e.detail;
    fleetMode = 'map'; FlatMap.fromGlobe = true; setView('globe');
    FlatMap.flyTo(lat, lon, 6, true);
  });
  window.addEventListener('fleet:shallower', () => { // zoomed back out of the map → return to the globe
    if (activeView !== 'globe' || fleetMode !== 'map' || !FlatMap.fromGlobe) return;
    fleetMode = 'globe'; FlatMap.fromGlobe = false; backToDots(); setView('globe');
  });

  /* ---------------- Second brain (neurons) ---------------- */
  // Everything linked, drawn as a neural net: glowing somas, curved dendrites, and signals firing along them.
  // Hot nodes (breached tickets, deployments at risk, fresh Slack mentions) fire more often.
  const Brain = (() => {
    const cv = $('#graph'), ctx = cv.getContext('2d');
    let w = 1, h = 1, dpr = 1, alpha = 1, hover = null, dragNode = null, pan = null, warmed = false, lastFrame = 0;
    // 2D or 3D. In 3D the same graph gets depth: it's laid out in 3D, slowly turns, and drag rotates it (Shift+drag pans).
    let mode3d = false, yaw = 0.6, pitch = -0.35, lastTouch = 0;
    try { mode3d = localStorage.getItem('lambdaos-brain3d') === '1'; } catch { /* per-viewer convenience */ }
    const FOCAL = 900;
    const view = { x: 0, y: 0, k: 1 };
    const nodes = [], edges = [], byId = new Map(), pulses = [], hidden = new Set(['device']);
    const TYPES = {
      project: { r: 10, label: 'Project', shape: 'hex', color: XC.project },
      deployment: { r: 8, label: 'Deployment', shape: 'diamond', color: XC.deployment },
      site: { r: 9, label: 'Site', shape: 'circle', color: C['c-site'] },
      ticket: { r: 3.4, label: 'Ticket', shape: 'circle', color: C['c-ticket'] },
      device: { r: 2.8, label: 'Device', shape: 'circle', color: C['c-device'] },
      part: { r: 5, label: 'Part', shape: 'triangle', color: C['c-part'] },
      person: { r: 5, label: 'Person', shape: 'hex', color: C['c-person'] },
      channel: { r: 4.5, label: 'Slack', shape: 'square', color: XC.channel },
      event: { r: 4.5, label: 'Meeting', shape: 'square', color: XC.event },
    };
    // Soft glow sprites, one per color (radial gradients per node per frame would be too slow).
    const sprites = {};
    const glow = color => sprites[color] ||= (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, color + 'cc'); gr.addColorStop(0.25, color + '55'); gr.addColorStop(1, color + '00');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
    })();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const add = (id, type, label, ref, heat = 0) => {
      if (byId.has(id)) { const n = byId.get(id); n.heat = Math.max(n.heat, heat); return n; }
      const a = rnd() * 6.28, r = 60 + rnd() * 320, R = TYPES[type].r;
      const spines = R >= 4.5 ? Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => ({ a: rnd() * 6.28, len: R * (1.6 + rnd() * 1.8), curl: (rnd() - 0.5) * 1.4 })) : [];
      const n = { id, type, label, ref, heat, fire: 0, x: Math.cos(a) * r, y: Math.sin(a) * r, z: (rnd() - 0.5) * 300, vx: 0, vy: 0, vz: 0, X: 0, Y: 0, S: 1, D: 0, nb: new Set(), out: [], spines };
      nodes.push(n); byId.set(id, n); return n;
    };
    const link = (a, b) => {
      if (!a || !b || a === b || a.nb.has(b)) return;
      const e = { a, b, bend: (rnd() - 0.5) * 0.9 };
      edges.push(e); a.nb.add(b); b.nb.add(a); a.out.push(e); b.out.push(e);
    };
    const siteNode = id => { const s = D.siteById(id); return s ? add('site:' + s.id, 'site', s.id, s, s.health === 'critical' ? 0.6 : s.health === 'warning' ? 0.3 : 0) : null; };
    const person = (id, name) => id ? add('person:' + id, 'person', id === 'me' ? 'You' : name, D.personById(id)) : null;
    const hot = h => h === 'critical' ? 1 : h === 'warning' ? 0.5 : 0;

    D.SITES.filter(s => s.kind === 'dc' && s.health !== 'idle').forEach(s => siteNode(s.id));
    for (const p of D.PROJECTS || []) add('proj:' + p.key, 'project', p.title || p.key, p, hot(p.health));
    for (const d of D.DEPLOYMENTS || []) {
      const n = add('dep:' + d.key, 'deployment', d.site ? `${d.site} ${d.gpus ? d.gpus.toLocaleString() + '×' + d.gpuModel : d.key}` : d.key, d, hot(d.health));
      if (d.project) link(n, byId.get('proj:' + d.project.key));
      d.sites.forEach(c => link(n, siteNode(c)));
      link(n, person(d.assignee, d.assigneeName));
      for (const c of d.channels || []) link(n, add('chan:' + c.id, 'channel', '#' + c.name, c));
    }
    const urgent = [...D.TICKETS].sort(byUrgency).slice(0, 180);
    for (const t of urgent) {
      const n = add('tk:' + t.key, 'ticket', t.key, t, slaStatus(t) === 'critical' ? 0.7 : slaStatus(t) === 'serious' ? 0.4 : 0);
      const dev = D.deviceById(t.device), site = siteNode(t.site);
      if (dev) { const dn = add('dev:' + dev.id, 'device', dev.id, dev); link(dn, site); link(n, dn); }
      link(n, site);
      if (t.assignee) link(n, person(t.assignee, D.personById(t.assignee).name));
      if (t.part) { const p = D.partById(t.part); if (p) link(n, add('part:' + p.id, 'part', p.name !== p.pn ? p.name : p.pn, p)); }
    }
    for (const c of D.CHANNELS || []) if (c.site && byId.has('site:' + c.site)) link(add('chan:' + c.id, 'channel', '#' + c.name, c), byId.get('site:' + c.site));
    for (const m of D.MENTIONS || []) { const n = byId.get('chan:' + m.channelId); if (n && m.at > Date.now() - 864e5) n.heat = Math.max(n.heat, 0.8); }
    const soon = Date.now() + 3 * 864e5;
    for (const e of (D.EVENTS || []).filter(e => e.at < soon)) {
      if (!e.deployment && !e.site) continue;
      const n = add('ev:' + e.title + e.at, 'event', e.title.length > 28 ? e.title.slice(0, 27) + '…' : e.title, e);
      link(n, e.deployment ? byId.get('dep:' + e.deployment) : siteNode(e.site));
    }

    function resize() { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; w = r.width || 1; h = r.height || 1; cv.width = w * dpr; cv.height = h * dpr; }
    new ResizeObserver(resize).observe(cv);
    const visible = n => !hidden.has(n.type);

    function tick() {
      const n = nodes.length;
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y, dz = mode3d ? b.z - a.z : 0; const d2 = Math.max(dx * dx + dy * dy + dz * dz, 36);
          if (d2 > 90000) continue;
          const d = Math.sqrt(d2), f = (650 / d2) * alpha; dx /= d; dy /= d; dz /= d;
          a.vx -= dx * f; a.vy -= dy * f; a.vz -= dz * f; b.vx += dx * f; b.vy += dy * f; b.vz += dz * f;
        }
        a.vx -= a.x * 0.0035 * alpha; a.vy -= a.y * 0.0035 * alpha; a.vz -= a.z * 0.0035 * alpha;
      }
      for (const { a, b } of edges) {
        const big = t => t === 'project' || t === 'site' || t === 'deployment';
        const L = big(a.type) && big(b.type) ? 90 : big(a.type) || big(b.type) ? 50 : 26;
        let dx = b.x - a.x, dy = b.y - a.y, dz = mode3d ? b.z - a.z : 0; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = (d - L) * 0.03 * alpha;
        dx /= d; dy /= d; dz /= d; a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
      for (const p of nodes) {
        if (p === dragNode) { p.vx = p.vy = p.vz = 0; continue; }
        p.vx *= 0.6; p.vy *= 0.6; p.vz *= 0.6; p.x += p.vx; p.y += p.vy; if (mode3d) p.z += p.vz;
      }
      alpha = Math.max(0.012, alpha * 0.992);
    }
    // Screen position for every node: in 2D the layout itself; in 3D rotated (yaw, pitch) with perspective. S scales
    // sizes (nearer = bigger) and D is depth (0 near … 1 far) for fading and draw order.
    function project() {
      if (!mode3d) { for (const n of nodes) { n.X = n.x; n.Y = n.y; n.S = 1; n.D = 0; } return; }
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      let zmin = Infinity, zmax = -Infinity;
      for (const n of nodes) {
        const x1 = n.x * cy - n.z * sy, z1 = n.x * sy + n.z * cy, y2 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp, s = FOCAL / (FOCAL + z2 + 400);
        n.X = x1 * s * 1.45; n.Y = y2 * s * 1.45; n.S = s * 1.45; n.Z = z2; zmin = Math.min(zmin, z2); zmax = Math.max(zmax, z2);
      }
      const span = Math.max(1, zmax - zmin); for (const n of nodes) n.D = (n.Z - zmin) / span;
    }
    // Quadratic curve between two nodes, bowed sideways so connections read as dendrites, not wires.
    const ctrl = e => { const mx = (e.a.X + e.b.X) / 2, my = (e.a.Y + e.b.Y) / 2, dx = e.b.X - e.a.X, dy = e.b.Y - e.a.Y; return [mx - dy * e.bend * 0.35, my + dx * e.bend * 0.35]; };
    const along = (e, t, from) => {
      const [cx, cy] = ctrl(e), A = from === e.a ? e.a : e.b, B = from === e.a ? e.b : e.a, u = 1 - t;
      return [u * u * A.X + 2 * u * t * cx + t * t * B.X, u * u * A.Y + 2 * u * t * cy + t * t * B.Y];
    };
    function spawn(n) {
      const outs = n.out.filter(e => visible(e.a) && visible(e.b));
      if (!outs.length) return;
      pulses.push({ e: outs[Math.floor(Math.random() * outs.length)], from: n, t: 0, speed: 0.012 + Math.random() * 0.018, hops: 0 });
    }
    function shape(n, x, y, r) {
      ctx.beginPath();
      const s = TYPES[n.type].shape;
      if (s === 'circle') ctx.arc(x, y, r, 0, 7);
      else if (s === 'square') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      else if (s === 'diamond') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r, y); ctx.closePath(); }
      else if (s === 'triangle') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r, y + r * 0.75); ctx.lineTo(x - r, y + r * 0.75); ctx.closePath(); }
      else for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a)); }
      ctx.closePath();
    }
    function fit() {
      const vis = nodes.filter(visible); if (!vis.length) return;
      project(); const xs = vis.map(n => n.X), ys = vis.map(n => n.Y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      view.k = Math.max(0.2, Math.min(1.6, 0.9 * Math.min(w / (maxX - minX + 60), h / (maxY - minY + 60))));
      view.x = -((minX + maxX) / 2) * view.k; view.y = -((minY + maxY) / 2) * view.k;
    }

    function draw(now) {
      if (!warmed) { for (let i = 0; i < 320; i++) tick(); warmed = true; fit(); }
      tick();
      const dt = Math.min(50, now - (lastFrame || now)); lastFrame = now;
      if (mode3d && !pan && !CALM && now - lastTouch > 2500) yaw += 0.0011 * (dt / 16); // slow turn when you're not using it
      project();
      const fade = n => mode3d ? 1 - n.D * 0.7 : 1; // far nodes are dimmer
      // Spontaneous firing, biased toward hot nodes; arriving signals make the target fire and sometimes propagate.
      for (const n of nodes) {
        if (!visible(n)) continue;
        if (Math.random() < (0.0006 + n.heat * 0.006) * (dt / 16) * (CALM ? 0.15 : 1)) { n.fire = 1; spawn(n); }
        n.fire *= 0.94;
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]; p.t += p.speed * (dt / 16);
        if (p.t >= 1) {
          const to = p.e.a === p.from ? p.e.b : p.e.a; to.fire = 1; pulses.splice(i, 1);
          if (p.hops < 4 && Math.random() < 0.55 && pulses.length < 220) { const outs = to.out.filter(e => e !== p.e && visible(e.a) && visible(e.b)); if (outs.length) pulses.push({ e: outs[Math.floor(Math.random() * outs.length)], from: to, t: 0, speed: p.speed, hops: p.hops + 1 }); }
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * (w / 2 + view.x), dpr * (h / 2 + view.y));
      const focus = hover, lit = n => !focus || n === focus || focus.nb.has(n);

      // dendrites
      ctx.lineCap = 'round';
      for (const e of edges) {
        if (!visible(e.a) || !visible(e.b)) continue;
        const on = focus && (e.a === focus || e.b === focus), [cx, cy] = ctrl(e);
        ctx.strokeStyle = on ? TYPES[focus.type].color : TYPES[e.a.type].color;
        ctx.globalAlpha = (on ? 0.85 : focus ? 0.03 : 0.13 + 0.25 * Math.max(e.a.fire, e.b.fire)) * (on ? 1 : Math.min(fade(e.a), fade(e.b)));
        ctx.lineWidth = (on ? 1.6 : 0.9) * (e.a.S + e.b.S) / 2 / view.k;
        ctx.beginPath(); ctx.moveTo(e.a.X, e.a.Y); ctx.quadraticCurveTo(cx, cy, e.b.X, e.b.Y); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      // glows (somas), far to near
      const order = mode3d ? [...nodes].sort((a, b) => b.D - a.D) : nodes;
      for (const n of order) {
        if (!visible(n)) continue;
        const t = TYPES[n.type], R = t.r * n.S * (3.2 + n.fire * 3 + n.heat * 0.8);
        ctx.globalAlpha = (lit(n) ? 0.55 + n.fire * 0.45 : 0.08) * fade(n);
        ctx.drawImage(glow(t.color), n.X - R, n.Y - R, R * 2, R * 2);
      }
      // signals travelling along dendrites, with a short tail
      for (const p of pulses) {
        if (focus && !(p.e.a === focus || p.e.b === focus || focus.nb.has(p.e.a) && focus.nb.has(p.e.b))) continue;
        const col = TYPES[p.from.type].color;
        for (let k = 0; k < 4; k++) {
          const tt = p.t - k * 0.035; if (tt < 0) break;
          const [x, y] = along(p.e, tt, p.from), r = (2.6 - k * 0.5) / Math.sqrt(view.k);
          ctx.globalAlpha = 0.9 - k * 0.22; ctx.drawImage(glow(k ? col : '#ffffff'), x - r * 3, y - r * 3, r * 6, r * 6);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      // spines + cores, far to near
      for (const n of order) {
        if (!visible(n)) continue;
        const t = TYPES[n.type], R = t.r * n.S, x = n.X, y = n.Y;
        ctx.globalAlpha = (lit(n) ? 1 : 0.15) * fade(n);
        if (n.spines.length && view.k > 0.35) {
          ctx.strokeStyle = t.color; ctx.lineWidth = 0.8 / view.k; ctx.globalAlpha *= 0.5;
          for (const sp of n.spines) {
            const L = sp.len * n.S, ex = x + Math.cos(sp.a) * L, ey = y + Math.sin(sp.a) * L;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(sp.a + sp.curl) * L * 0.6, y + Math.sin(sp.a + sp.curl) * L * 0.6, ex, ey); ctx.stroke();
          }
          ctx.globalAlpha = (lit(n) ? 1 : 0.15) * fade(n);
        }
        shape(n, x, y, R); ctx.fillStyle = t.color; ctx.fill();
        ctx.strokeStyle = 'rgba(5,7,13,0.9)'; ctx.lineWidth = 1.5 / view.k; ctx.stroke();
        if (t.r >= 5) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha *= 0.55 + n.fire * 0.45; ctx.beginPath(); ctx.arc(x, y, R * 0.32, 0, 7); ctx.fill(); }
        if (n === focus) { ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5 / view.k; shape(n, x, y, R + 4 / view.k); ctx.stroke(); }
      }
      ctx.globalAlpha = 1; ctx.textBaseline = 'middle';
      for (const n of nodes) {
        if (!visible(n)) continue;
        const always = n.type === 'project' || n.type === 'site' || (n.type === 'deployment' && view.k > 0.55) || (n.type === 'person' && n.nb.size > 4 && view.k > 0.8);
        const show = focus ? (n === focus || focus.nb.has(n)) : always || view.k > 2;
        if (!show) continue;
        const big = n.type === 'project' || n.type === 'site';
        ctx.font = `${big ? '600 ' : ''}${(big ? 12 : 10.5) / view.k}px ${n.type === 'site' || n.type === 'ticket' ? MONO : 'system-ui, sans-serif'}`;
        ctx.fillStyle = n === focus ? '#fff' : big ? C.text : C['text-2'];
        ctx.globalAlpha = n === focus ? 1 : fade(n);
        const label = n.label.length > 42 ? n.label.slice(0, 41) + '…' : n.label;
        ctx.fillText(label, n.X + TYPES[n.type].r * n.S + 5 / view.k, n.Y);
      }
      ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    }

    const toWorld = (sx, sy) => [(sx - w / 2 - view.x) / view.k, (sy - h / 2 - view.y) / view.k];
    const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function hit(sx, sy) {
      const [x, y] = toWorld(sx, sy); let best = null, bd = Infinity;
      for (const n of nodes) { if (!visible(n)) continue; const dd = Math.hypot(n.X - x, n.Y - y), d = dd + (mode3d ? n.D * 4 / view.k : 0); if (dd < TYPES[n.type].r * n.S + 6 / view.k && d < bd) { bd = d; best = n; } }
      return best;
    }
    function describe(n) {
      const r = n.ref;
      if (n.type === 'ticket') return `<b>${r.key}</b>${esc(r.summary)}<br><span>${esc(r.status)} · ${esc(r.site || '?')} · ${esc(r.assigneeName)} · ${slaText(r)}</span>`;
      if (n.type === 'device') return `<b>${esc(r.id)}</b><span>${esc(r.model)} · ${esc(r.site || '?')} ${esc(r.rack)}${r.u ? ` U${r.u}` : ''}</span>`;
      if (n.type === 'site') return `<b>${esc(r.id)} · ${esc(r.name)}</b>${statusChip(r.health === 'idle' ? 'idle' : r.health, siteStatusLabel(r))}<br><span>${r.openTickets} open tickets${r.deployments?.length ? ` · ${r.deployments.length} deployments` : ''}</span>`;
      if (n.type === 'part') return `<b>${esc(partLabel(r))}</b><span>${D.SITES.reduce((a, s) => a + (s.inventory.find(i => i.part === r.id)?.stock || 0), 0)} on hand fleet-wide</span>`;
      if (n.type === 'person') return `<b>${esc(r.name)}</b><span>${D.TICKETS.filter(t => t.assignee === r.id).length} tickets · ${(D.DEPLOYMENTS || []).filter(d => d.assigneeId === r.id || (r.id === 'me' && d.mine)).length} deployments</span>`;
      if (n.type === 'deployment') return `<b>${r.key} · ${esc(r.title)}</b>${statusChip(r.health, depStatus(r))}<br><span>${pct(r.progress)} done · due ${fmtDate(r.end)} · ${esc(r.sites.join(', ') || '?')}</span>`;
      if (n.type === 'project') return `<b>${r.key} · ${esc(r.title)}</b>${statusChip(r.health, r.status)}<br><span>${r.deployments.length} deployments</span>`;
      if (n.type === 'channel') return `<b>#${esc(r.name)}</b><span>Slack · ${r.members} members</span>`;
      if (n.type === 'event') return `<b>${esc(r.title)}</b><span>${new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>`;
      return `<b>${esc(n.label)}</b>`;
    }
    cv.addEventListener('pointerdown', e => {
      const [x, y] = at(e); const n = hit(x, y); cv.setPointerCapture(e.pointerId); lastTouch = performance.now();
      // 2D: drag a neuron to move it, drag empty space to pan. 3D: drag turns the brain, Shift+drag pans.
      if (n && !mode3d) { dragNode = n; alpha = Math.max(alpha, 0.3); }
      if (n) { n.fire = 1; spawn(n); }
      pan = { x, y, vx: view.x, vy: view.y, yaw, pitch, moved: 0, node: n, rotate: mode3d && !e.shiftKey };
    });
    cv.addEventListener('pointermove', e => {
      const [x, y] = at(e);
      if (pan) {
        pan.moved += Math.abs(x - pan.x) + Math.abs(y - pan.y);
        lastTouch = performance.now();
        if (dragNode) { const [wx, wy] = toWorld(x, y); dragNode.x = wx; dragNode.y = wy; alpha = Math.max(alpha, 0.2); }
        else if (pan.rotate) { yaw = pan.yaw + (x - pan.x) * 0.006; pitch = Math.max(-1.4, Math.min(1.4, pan.pitch + (y - pan.y) * 0.006)); }
        else { view.x = pan.vx + (x - pan.x); view.y = pan.vy + (y - pan.y); }
        hideTip(); return;
      }
      const prev = hover; hover = hit(x, y); cv.style.cursor = hover ? 'pointer' : '';
      if (hover && hover !== prev) { hover.fire = 1; for (let i = 0; i < 3; i++) spawn(hover); }
      hover ? showTip(x, y, describe(hover)) : hideTip();
    });
    cv.addEventListener('pointerup', () => {
      const p = pan; pan = null; dragNode = null;
      if (p && p.node && p.moved < 6) openEntity(p.node.type, p.node.ref);
    });
    cv.addEventListener('pointerleave', () => { hover = null; hideTip(); });
    cv.addEventListener('dblclick', fit);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const [x, y] = at(e), [wx, wy] = toWorld(x, y);
      view.k = Math.max(0.15, Math.min(5, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = x - w / 2 - wx * view.k; view.y = y - h / 2 - wy * view.k;
    }, { passive: false });

    return {
      draw, resize, fit, TYPES, nodeCount: () => nodes.filter(visible).length,
      is3d: () => mode3d,
      set3d: on => { if (on === mode3d) return; mode3d = on; try { localStorage.setItem('lambdaos-brain3d', on ? '1' : '0'); } catch { /* ignore */ }
        alpha = Math.max(alpha, 0.5); for (let i = 0; i < 120; i++) tick(); fit(); },
      counts: () => Object.fromEntries(Object.keys(TYPES).map(k => [k, nodes.filter(n => n.type === k).length])),
      isHidden: k => hidden.has(k), toggle: k => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); hover = null; return !hidden.has(k); },
    };
  })();

  /* ---------------- Deployments timeline ---------------- */
  /* ---------------- Site health (fleet-wide, from Grafana) ---------------- */
  // Every site against the "Site Health" board checks in one table; worst sites first. Click a number for the exact
  // hosts, racks and U positions. Leaks and newly tripped breakers are the ones to act on now.
  const Health = (() => {
    let scope = 'all', onlyProblems = false; // every site by default; "Your sites" is one click away
    try { scope = localStorage.getItem('lambdaos-health-scope2') || 'all'; onlyProblems = localStorage.getItem('lambdaos-health-problems') === '1'; } catch { /* ignore */ }
    const COLS = [['leak', 'Leaks'], ['breaker', 'Breakers'], ['pdu', 'PDU alarms'], ['shelf', 'Shelf PSU 0 W'], ['hw', 'HW faults'], ['hot', 'Hottest inlet'], ['net', 'Net down'], ['blind', "Can't monitor"]];
    const TITLES = { leak: 'Leak detectors alarming', breaker: 'Breakers tripped', pdu: 'PDU alarms', shelf: 'Power-shelf PSUs drawing 0 W', hw: 'Hosts with hardware faults', hot: 'Hot inlets (over the amber line)', net: 'Network devices not answering ping', blind: "Devices we can't monitor" };
    const val = (s, k) => { const c = s.checks[k];
      if (k === 'hot') return c.top ? `<b class="st-${c.level === 'good' ? 'good' : c.level}">${Math.round(c.top.v)}°</b><small>${c.top.kind === 'GPU tray' ? 'tray' : 'air'}</small>` : '<span class="muted">—</span>';
      if (!c.n) return '<span class="ok">✓</span>';
      if (k === 'leak') return `<b class="st-critical">💧 ${c.n}</b>`;
      if (k === 'breaker') return `<b class="${c.fresh ? 'st-critical' : 'st-warning'}">${c.n}</b>${c.fresh ? `<small class="st-critical">${c.fresh} new</small>` : ''}`;
      if (k === 'blind') return `<span class="muted">${c.n}</span>`;
      return `<b class="st-warning">${c.n}</b>`; };
    function sitesShown() {
      const H = D.HEALTH; if (!H) return [];
      const mine = LambdaAlerts.mySites(D);
      let list = scope === 'mine' && mine.size ? H.sites.filter(s => mine.has(s.code)) : H.sites;
      return onlyProblems ? list.filter(s => s.level === 'critical' || s.level === 'warning') : list;
    }
    function render() {
      const H = D.HEALTH, box = $('#health');
      $('#healthBadge').hidden = !(H && (H.totals.leak || H.freshBreakers)); if (H) $('#healthBadge').textContent = H.totals.leak + H.freshBreakers || '';
      if (activeView !== 'health') return;
      if (!H) { box.innerHTML = `<div class="hempty"><h3>Site health</h3><p class="muted">Leaks, tripped breakers, PDU alarms, power shelves, hardware faults, hot inlets, network devices down and monitoring gaps for every site come from Grafana. Turn on <b>Grafana</b> in Settings → Sources and sign in to grafana.aws.lambdalabs.cloud once.</p></div>`; return; }
      const sites = sitesShown(), mine = LambdaAlerts.mySites(D);
      const sum = k => sites.reduce((t, s) => t + (s.checks[k].n || 0), 0), fresh = sites.reduce((t, s) => t + s.checks.breaker.fresh, 0);
      const chip = (k, label, cls) => `<span class="hsum ${cls}"><b>${k}</b>${label}</span>`;
      const errs = Object.keys(H.errors || {});
      box.innerHTML = `<div class="hhead">
          <div class="hsums">${chip(sum('leak'), 'leaks', sum('leak') ? 'crit' : 'ok')}${chip(fresh, 'breakers newly tripped', fresh ? 'crit' : 'ok')}${chip(sum('pdu'), 'PDU alarms', sum('pdu') ? 'warn' : 'ok')}${chip(sum('shelf'), 'shelf PSUs at 0 W', sum('shelf') ? 'warn' : 'ok')}${chip(sum('hw'), 'hosts with HW faults', sum('hw') ? 'warn' : 'ok')}${chip(sum('net'), 'network devices down', sum('net') ? 'warn' : 'ok')}</div>
          <div class="hctl"><span class="seg">${mine.size ? [['all', 'All sites'], ['mine', 'Your sites']].map(([k, l]) => `<button class="chip ${scope === k ? 'on' : ''}" data-hscope="${k}">${l}</button>`).join('') : '<button class="chip on">All sites</button>'}</span>
            <button class="chip ${onlyProblems ? 'on' : ''}" data-hproblems aria-pressed="${onlyProblems}">Only problems</button>
            <span class="muted small">Grafana · ${rel(H.at)} ago${errs.length ? ` · <span class="st-warning" title="${esc(Object.entries(H.errors).map(([k, e]) => k + ': ' + e).join('; '))}">${errs.length} check${errs.length > 1 ? 's' : ''} failed</span>` : ''}</span></div></div>
        <div class="htable-wrap"><table class="htable"><thead><tr><th>Site</th>${COLS.map(([, l]) => `<th>${l}</th>`).join('')}<th>Power</th></tr></thead><tbody>
        ${sites.map(s => s.level === 'nodata' ? `<tr class="lvl-nodata"><td class="hsite" ${s.site ? `data-site="${esc(s.code)}"` : ''}><span class="dot muted">○</span><b>${esc(s.code)}</b> <span class="muted">${esc(s.name)}</span></td><td colspan="${COLS.length + 1}" class="muted hnodata">No data in Grafana for this site yet (no metrics reported)</td></tr>` : `<tr class="lvl-${s.level}"><td class="hsite" ${s.site ? `data-site="${esc(s.code)}"` : ''}><span class="dot st-${s.level}">●</span><b>${esc(s.code)}</b> <span class="muted">${esc(s.name)}</span></td>
          ${COLS.map(([k]) => `<td class="hcell" ${s.checks[k].n || k === 'hot' && s.checks[k].top ? `data-hcell="${esc(s.code)}|${k}"` : ''}>${val(s, k)}</td>`).join('')}
          <td class="hpow">${s.kw != null ? Math.round(s.kw).toLocaleString() + ' kW' : '<span class="muted">—</span>'}</td></tr>`).join('') || `<tr><td colspan="${COLS.length + 2}" class="muted" style="padding:18px">${onlyProblems ? 'No problems at these sites right now.' : 'No sites.'}</td></tr>`}
        </tbody></table></div>
        <p class="muted small hnote">Same checks as Grafana's Site Health boards, for every site at once. Click a number for the hosts, racks and U positions. Breakers count everything tripped now; "new" means it tripped in the last 24 hours (since Lambda OS has been watching).</p>`;
    }
    function detail(code, k) {
      const s = D.HEALTH?.sites.find(x => x.code === code); if (!s) return;
      const c = s.checks[k], items = k === 'hot' ? (c.items.length ? c.items : [c.top].filter(Boolean)) : c.items;
      const host = x => { const dv = x.h && D.deviceById(x.h); return dv ? `<a data-open="device:${esc(dv.id)}" class="mono">${esc(x.h)}</a>` : `<span class="mono">${esc(x.h || '—')}</span>`; };
      const what = x => k === 'hot' ? `<b class="st-${x.v >= x.crit ? 'critical' : x.v >= x.warn ? 'warning' : 'good'}">${x.v.toFixed(1)} °C</b> ${esc(x.kind)}` : esc(x.w || '');
      const extra = k === 'blind' && c.n > c.items.length ? `<p class="muted small">Showing ${c.items.length} of ${c.n}. By type: ${Object.entries(c.byJob).map(([j, v]) => `${esc(j)} ${v}`).join(' · ')}</p>` : '';
      Drawer.open(`<div class="qkey">${esc(code)} · SITE HEALTH · GRAFANA</div><h3>${esc(TITLES[k])} <span class="muted">(${k === 'hot' ? items.length : c.n})</span></h3>${extra}
        <div class="answer" style="margin:0"><table><tr><th>Host</th><th>Rack</th><th>U</th><th>${k === 'hot' ? 'Inlet' : 'What'}</th><th>${k === 'leak' || k === 'breaker' || k === 'shelf' ? 'Seen since' : ''}</th></tr>
        ${items.slice(0, 300).map(x => `<tr><td>${host(x)}</td><td class="mono">${esc(x.r || '')}</td><td>${esc(x.u || '')}</td><td>${what(x)}</td><td class="muted">${x.since ? rel(x.since) + ' ago' : k === 'leak' || k === 'breaker' || k === 'shelf' ? 'before Lambda OS looked' : ''}</td></tr>`).join('')}</table></div>
        ${items.length > 300 ? `<p class="muted small">+${items.length - 300} more</p>` : ''}
        <div class="links">${s.board ? btn('Site health in Grafana', s.board, true) : ''}${s.site ? `<button class="btn" data-site="${esc(code)}">Site card</button>` : ''}</div>`);
    }
    $('#health').addEventListener('click', e => {
      const c = e.target.closest('[data-hcell]'); if (c) { const [code, k] = c.dataset.hcell.split('|'); return detail(code, k); }
      const sc = e.target.closest('[data-hscope]'); if (sc) { scope = sc.dataset.hscope; try { localStorage.setItem('lambdaos-health-scope2', scope); } catch { /* ignore */ } return render(); }
      if (e.target.closest('[data-hproblems]')) { onlyProblems = !onlyProblems; try { localStorage.setItem('lambdaos-health-problems', onlyProblems ? '1' : '0'); } catch { /* ignore */ } return render(); }
    });
    return { render, detail };
  })();

  document.addEventListener('click', e => { const c = e.target.closest('#siteCard [data-hcell]'); if (c) { const [code, k] = c.dataset.hcell.split('|'); Health.detail(code, k); } });

  const Deploys = (() => {
    const el = $('#deploys');
    let filter = 'all', tag = 'all';
    const DAY = 864e5;
    function render() {
      const all = D.DEPLOYMENTS || [], now = Date.now();
      if (!all.length) {
        el.innerHTML = `<div class="dempty muted">No deployments loaded. They come from Jira PMO epics and Cluster Intake (Settings → Jira).${D.SOURCES.find(s => s.key === 'jira')?.title?.includes('failed') ? '<br>' + esc(D.SOURCES.find(s => s.key === 'jira').title) : ''}</div>`;
        return;
      }
      const tags = [...new Set(all.map(d => d.source === 'CI' ? 'Intake' : (d.tag || 'Other')))];
      const tagOf = d => d.source === 'CI' ? 'Intake' : (d.tag || 'Other');
      const list = all.filter(d => filter === 'all' || (filter === 'tracking' && (D.isTracked(d.key) || d.mine)) || (filter === 'risk' && ['critical', 'warning'].includes(d.health)))
        .filter(d => tag === 'all' || tagOf(d) === tag);
      const starts = list.map(d => d.start || d.end).filter(Boolean), ends = list.map(d => d.end || d.start).filter(Boolean);
      const from = Math.min(now - 30 * DAY, ...starts), to = Math.min(Math.max(now + 90 * DAY, ...ends) + 14 * DAY, now + 730 * DAY);
      const X = t => Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100));
      const months = []; const m = new Date(from); m.setDate(1); m.setHours(0, 0, 0, 0);
      while (m.getTime() < to) { if (m.getTime() >= from) months.push(m.getTime()); m.setMonth(m.getMonth() + 1); }
      const everyN = Math.ceil(months.length / 10);
      const groups = new Map();
      for (const d of list.sort((a, b) => (a.end || Infinity) - (b.end || Infinity))) {
        const g = d.source === 'CI' ? 'CI' : d.project?.key || '—';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(d);
      }
      const bar = d => {
        if (!d.start && !d.end) return '<span class="dnodate muted">no dates in Jira</span>';
        const s = d.start || d.end - 30 * DAY, e = d.end || s + 30 * DAY, col = d.health === 'idle' ? C.accent : C[d.health];
        return `<span class="dbar ${d.overdue ? 'over' : ''} ${!d.start ? 'nostart' : ''}" style="left:${X(s)}%;width:${Math.max(0.8, X(e) - X(s))}%;--c:${col}" title="${esc(d.key)}: ${fmtDate(d.start)} → ${fmtDate(d.end)} · ${pct(d.progress)} done">
          <i style="width:${Math.round((d.progress || 0) * 100)}%"></i><b>${d.progress != null ? pct(d.progress) : ''}</b></span>`;
      };
      el.innerHTML = `<div class="dtools">
          ${[['all', 'All', all.length], ['tracking', '★ Tracking', D.tracked().length], ['risk', 'At risk', all.filter(d => ['critical', 'warning'].includes(d.health)).length]].map(([k, l, n]) => `<button class="chip ${filter === k ? 'on' : ''}" data-dfilter="${k}">${l} <small>${n}</small></button>`).join('')}
          <span class="dsep"></span>
          ${['all', ...tags].map(t => `<button class="chip ${tag === t ? 'on' : ''}" data-dtag="${esc(t)}">${t === 'all' ? 'Every type' : esc(t)}</button>`).join('')}
        </div>
        <div class="dgrid">
          <div class="dhead"><span></span><div class="dtrack">${months.map((t, i) => i % everyN ? '' : `<span class="dmonth" style="left:${X(t)}%">${new Date(t).toLocaleDateString([], { month: 'short', ...(new Date(t).getMonth() === 0 ? { year: '2-digit' } : {}) })}</span>`).join('')}
            <span class="dtoday" style="left:${X(now)}%"><em>today</em></span></div></div>
          ${[...groups].map(([g, ds]) => {
            const p = D.projectByKey(g);
            const head = g === 'CI' ? 'Cluster Intake' : p ? `${p.key} · ${p.title}` : 'No parent project';
            return `<div class="dgroup" ${p ? `data-proj="${p.key}"` : ''}><span>${esc(head)}</span>${p ? statusChip(p.health, p.status) : ''}<small class="muted">${ds.length}</small></div>`
              + ds.map(d => `<div class="drow" data-dep="${d.key}">
                <div class="dinfo">${star(d)}<div style="min-width:0"><div class="dtitle">${esc(d.title)}</div>
                  <div class="dmeta"><span class="mono">${d.key}</span>${d.sites.map(c => ` · <b>${esc(c)}</b>`).join('')}${d.gpus ? ` · ${d.gpus.toLocaleString()}×${esc(d.gpuModel)}` : ''} · ${statusChip(d.health, depStatus(d))}</div></div></div>
                <div class="dtrack">${months.map(t => `<span class="dgridline" style="left:${X(t)}%"></span>`).join('')}<span class="dtoday" style="left:${X(now)}%"></span>${bar(d)}</div></div>`).join('');
          }).join('')}
          ${list.length ? '' : '<div class="dempty muted">Nothing matches this filter.</div>'}
        </div>`;
    }
    el.addEventListener('click', e => {
      const f = e.target.closest('[data-dfilter]'), t = e.target.closest('[data-dtag]');
      if (f) { filter = f.dataset.dfilter; render(); e.stopPropagation(); }
      if (t) { tag = t.dataset.dtag; render(); e.stopPropagation(); }
    });
    return { render, setFilter: f => { filter = f; render(); } };
  })();

  /* ---------------- Stage tabs, legends, globe controls ---------------- */
  let activeView = 'globe';
  const shapeSvg = (shape, c) => ({ circle: `<circle cx="5" cy="5" r="4" fill="${c}"/>`, square: `<rect x="1.5" y="1.5" width="7" height="7" fill="${c}"/>`,
    diamond: `<path d="M5 0L10 5L5 10L0 5Z" fill="${c}"/>`, triangle: `<path d="M5 0.5L9.5 9H0.5Z" fill="${c}"/>`, hex: `<path d="M5 0.5L9 2.75V7.25L5 9.5L1 7.25V2.75Z" fill="${c}"/>` }[shape]);
  const LEGENDS = {
    globe: () => {
      const kinds = [['dc', 'Data center', `<circle cx="5" cy="5" r="4" fill="${C.text}"/>`], ['pop', 'POP', `<path d="M5 0L9.5 5L5 10L0.5 5Z" fill="${C.text}"/>`],
        ['prem', 'On-prem', `<rect x="1.5" y="1.5" width="7" height="7" fill="${C.text}"/>`], ['idle', 'Planned / retired', `<circle cx="5" cy="5" r="3.5" fill="none" stroke="${C.idle}" stroke-width="1.5"/>`]];
      return ['good', 'warning', 'critical'].map(s => `<span><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${C[s]}"/></svg>${STATUS[s].glyph} ${STATUS[s].label}</span>`).join('')
        + `<span><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="${XC.deployment}" stroke-width="1.5" stroke-dasharray="2 2"/></svg>Deployment</span>`
        + kinds.map(([k, label, svg]) => `<button class="chip on" data-kind="${k}" aria-pressed="true"><svg viewBox="0 0 10 10">${svg}</svg>${label}</button>`).join('')
        + `<button class="chip" data-globe="home" title="Fit the live data centers (or double-click the map)">Fit</button><button class="chip" data-globe="world">World</button>`
        + `<span class="seg" title="Base map">${Object.entries(Tiles.PROVIDERS).map(([k, p]) => `<button class="chip ${Tiles.name() === k ? 'on' : ''}" data-basemap="${k}" aria-pressed="${Tiles.name() === k}">${p.label}</button>`).join('')}<button class="chip ${Tiles.name() === 'off' ? 'on' : ''}" data-basemap="off" title="Stylized dots, no imagery">Dots</button></span>`
        + `<span class="seg">${[['globe', 'Globe'], ['map', 'Map']].map(([m, l]) => `<button class="chip ${Fleet.mode() === m ? 'on' : ''}" data-fleet="${m}" aria-pressed="${Fleet.mode() === m}">${l}</button>`).join('')}</span>`;
    },
    graph: () => {
      const n = Brain.counts();
      return Object.entries(Brain.TYPES).filter(([k]) => n[k]).map(([k, t]) =>
        `<button class="chip ${Brain.isHidden(k) ? '' : 'on'}" data-btype="${k}" aria-pressed="${!Brain.isHidden(k)}"><svg viewBox="0 0 10 10">${shapeSvg(t.shape, t.color)}</svg>${t.label} <small>${n[k]}</small></button>`).join('')
        + '<button class="chip" data-brain="fit" title="Fit everything (double-click)">Fit</button>'
        + `<span class="seg" title="View">${[['2d', '2D'], ['3d', '3D']].map(([k, l]) => `<button class="chip ${(k === '3d') === Brain.is3d() ? 'on' : ''}" data-brain="${k}" aria-pressed="${(k === '3d') === Brain.is3d()}">${l}</button>`).join('')}</span>`;
    },
    health: () => '<span class="muted">Leaks · breakers · PDUs · power shelves · hardware · heat · network · monitoring gaps</span>',
    deploys: () => [['good', 'On track'], ['warning', 'At risk'], ['critical', 'Off track / overdue'], ['idle', 'Not started']].map(([s, l]) =>
      `<span><svg viewBox="0 0 10 10"><rect x="0" y="2" width="10" height="6" rx="2" fill="${s === 'idle' ? C.accent : C[s]}"/></svg>${l}</span>`).join('')
      + `<span><svg viewBox="0 0 10 10"><line x1="5" y1="0" x2="5" y2="10" stroke="${C.accent}" stroke-width="2"/></svg>Today</span>`,
  };
  $('#stageLegend').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kind) { const on = Fleet.toggle(b.dataset.kind); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
    if (b.dataset.globe === 'home') Fleet.home();
    if (b.dataset.globe === 'world') Fleet.world();
    if (b.dataset.fleet) { Fleet.setMode(b.dataset.fleet); setView('globe'); }
    if (b.dataset.basemap) { autoSat = false; Tiles.set(b.dataset.basemap); setView('globe'); }
    if (b.dataset.btype) { Brain.toggle(b.dataset.btype); $('#stageLegend').innerHTML = LEGENDS.graph(); hint(); }
    if (b.dataset.brain === 'fit') Brain.fit();
    if (b.dataset.brain === '2d' || b.dataset.brain === '3d') { Brain.set3d(b.dataset.brain === '3d'); $('#stageLegend').innerHTML = LEGENDS.graph(); hint(); }
  });
  function hint() {
    const unplaced = D.SITES.length - Fleet.placedCount;
    $('#stageHint').textContent = activeView === 'globe'
      ? `${Fleet.placedCount} sites · drag to ${Fleet.mode() === 'globe' ? 'rotate' : 'pan'} · scroll to zoom · double-click to fit · click a site${unplaced ? ` · ${unplaced} without coordinates are in the list` : ''}`
      : activeView === 'graph' ? `${Brain.nodeCount()} neurons · hover to fire and trace links · ${Brain.is3d() ? 'drag to turn · Shift+drag to pan' : 'drag to pan'} · scroll to zoom · click to open`
      : activeView === 'health' ? 'Worst sites first · click a number for hosts, racks and U positions · H opens this view'
      : `${(D.DEPLOYMENTS || []).length} deployments · ☆ to track · click a row for workstreams, meetings, Slack and shipments`;
  }
  // Bigger view: the middle panel takes the whole screen (side columns and the number strip hide). Button, E key, Esc.
  function setStageMax(on) {
    document.body.classList.toggle('stage-max', on);
    const b = $('#stageExpand'); b.textContent = on ? '⤡' : '⤢'; b.setAttribute('aria-pressed', on);
    b.title = on ? 'Back to the normal layout (E or Esc)' : 'Bigger view: hide the side columns (E). Esc to go back.';
    try { sessionStorage.setItem('lambdaos-stagemax', on ? '1' : '0'); } catch { /* ignore */ }
    requestAnimationFrame(() => { if (activeView === 'globe') { Fleet.resize(); } else if (activeView === 'graph') { Brain.resize(); Brain.fit(); } else if (activeView === 'health') Health.render(); else Deploys.render(); });
  }
  $('#stageExpand').addEventListener('click', () => setStageMax(!document.body.classList.contains('stage-max')));

  function setView(v) {
    activeView = v;
    try { sessionStorage.setItem('lambdaos-view', v); } catch { /* ignore */ }
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    const target = v === 'globe' ? Fleet.canvasId() : v;
    document.querySelectorAll('.view').forEach(c => c.classList.toggle('active', c.id === target));
    GlobeGL.show(target === 'globe');
    const P = Tiles.provider(), attrib = $('#mapAttrib');
    attrib.hidden = v !== 'globe' || !P; attrib.textContent = P ? P.attr : '';
    $('#stageLegend').innerHTML = LEGENDS[v]();
    hint(); hideTip();
    if (v === 'globe') Fleet.resize(); else if (v === 'graph') Brain.resize(); else if (v === 'health') Health.render(); else Deploys.render();
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  let startView = 'globe';
  try { startView = sessionStorage.getItem('lambdaos-view') || 'globe'; } catch { /* ignore */ }
  setView(['globe', 'graph', 'deploys', 'health'].includes(startView) ? startView : 'globe');
  Health.render(); // badge on the Health tab
  try { if (sessionStorage.getItem('lambdaos-stagemax') === '1') setStageMax(true); } catch { /* ignore */ }
  (function frame(now) { if (activeView === 'globe') Fleet.draw(now); else if (activeView === 'graph') Brain.draw(now); requestAnimationFrame(frame); })(performance.now());
  window.__lambdaOS = { land: Land, data: D, map: FlatMap, tiles: Tiles, globeGL: GlobeGL, step: (n = 1) => { for (let i = 0; i < n; i++) { const t = performance.now() + i * 16; if (activeView === 'globe') Fleet.draw(t); else if (activeView === 'graph') Brain.draw(t); } } };

  /* ---------------- Site card ---------------- */
  // An Atium build: stage, racked / validated progress and the next milestone or hand-off.
  const buildWhen = b => b.handoff?.done ? `handed off ${fmtDate(b.handoff.at)}` : b.next ? `${b.next.name.replace(/^Enable /, '')} ${fmtDate(b.next.at)}${b.late ? ' · late' : ''}` : b.handoff?.at ? `hand-off ${fmtDate(b.handoff.at)}` : '';
  const buildRow = b => `<div class="mini-ticket" ${b.deploymentKey ? `data-dep="${b.deploymentKey}"` : `data-href="${esc(b.url)}"`} title="${esc(b.name)}${b.customer ? ' · ' + esc(b.customer) : ''}">
      <span class="qkey">${esc(b.stage)}</span><span class="qsum">${esc(b.name)}<br><small class="muted">${[b.customer, b.rackedPct != null && `racked ${pct(b.rackedPct)}`, b.validatedPct != null && `validated ${pct(b.validatedPct)}`].filter(Boolean).map(esc).join(' · ')}</small></span>
      ${statusChip(b.health, buildWhen(b) || b.stage)}</div>`;
  const buildBlock = b => `<div class="section-title"><span>Build progress · Atium${b.aiLinked ? ' · ✨ matched by AI' : ''}</span><span>${esc(b.stage)}</span></div>
      <dl class="kv">
        ${b.customer ? `<dt>Customer</dt><dd>${esc(b.customer)}</dd>` : ''}
        <dt>GPUs</dt><dd>${(b.installed || 0).toLocaleString()} installed of ${(b.planned || b.gpus || 0).toLocaleString()}${b.gpuModel ? ` × ${esc(b.gpuModel)}` : ''}${b.mw ? ` · ${b.mw} MW` : ''}</dd>
        ${b.devices ? `<dt>Racked</dt><dd>${progressBar(b.rackedPct, b.rackedPct >= 1 ? 'good' : 'idle')} ${b.racked.toLocaleString()} of ${b.devices.toLocaleString()} devices</dd>` : ''}
        ${b.hosts ? `<dt>Validated</dt><dd>${progressBar(b.validatedPct, b.validatedPct >= 1 ? 'good' : 'idle')} ${b.validated.toLocaleString()} of ${b.hosts.toLocaleString()} hosts</dd>` : ''}
        ${b.next && !/hand ?off/i.test(b.next.name) ? `<dt>Next</dt><dd>${esc(b.next.name)} · ${fmtDate(b.next.at)}${b.late ? ' · <b class="st-warning">late</b>' : ''}</dd>` : ''}
        ${b.handoff ? `<dt>Hand-off</dt><dd>${fmtDate(b.handoff.at)}${b.handoff.done ? ' · done' : b.late && /hand ?off/i.test(b.next?.name || '') ? ' · <b class="st-warning">late</b>' : ''}</dd>` : ''}
      </dl>
      <div class="links">${btn('Open in Atium', b.url)}</div>`;

  // Atium purchase orders for a site: read when the card opens (cached 10 min). No prices in Atium; this is receiving.
  const poCache = new Map();
  const poKinds = k => Object.entries(k || {}).map(([kind, c]) => `${c} ${kind}${c > 1 ? 's' : ''}`).join(', ');
  // Late = past the vendor's promised date (or Atium's expected date) by up to 30 days; older than that is "stale"
  // (an order nobody has updated in Atium), shown quietly and counted, not flagged.
  const poRow = (p, url) => {
    const st = LambdaAlerts.poState(p);
    const got = [p.assets && `${p.assetsIn}/${p.assets} assets`, p.consumables && `${p.consumablesIn}/${p.consumables} consumables`].filter(Boolean).join(' · ');
    const chip = { received: ['good', 'received'], open: ['idle', 'open'], due: ['idle', `due ${fmtDate(st.dueAt)}`],
      late: ['warning', `was due ${fmtDate(st.dueAt)}`], stale: ['idle', `stale · due ${fmtDate(st.dueAt)}`] }[st.state];
    return `<div class="mini-ticket${st.state === 'stale' ? ' po-stale' : ''}" data-href="${esc(url)}" title="${esc(p.name)} from ${esc(p.supplier)}${p.openLines ? ` · waiting on ${esc(poKinds(p.kinds))}` : ''}${p.promise ? ` · vendor promise ${esc(p.promise)}` : ''}${p.expected ? ` · expected ${esc(p.expected)}` : ''}${st.state === 'stale' ? ' · more than 30 days past due: probably not updated in Atium' : ''}">
      <span class="qkey">${esc(p.name)}</span><span class="qsum">${esc(p.supplier || 'Supplier unknown')}<br><small class="muted">${esc(got || 'no lines')}${st.open && p.pct > 0 ? ` · ${pct(p.pct)} in` : ''}</small></span>
      ${statusChip(chip[0], chip[1])}</div>`;
  };
  const poBlock = (pos, url) => {
    const rank = { late: 0, due: 1, open: 2, stale: 3 };
    const open = pos.map(p => ({ p, st: LambdaAlerts.poState(p) })).filter(x => x.st.open)
      .sort((a, b) => rank[a.st.state] - rank[b.st.state] || (a.st.dueAt || Infinity) - (b.st.dueAt || Infinity));
    const done = pos.length - open.length, late = open.filter(x => x.st.state === 'late').length, stale = open.filter(x => x.st.state === 'stale').length;
    return `<div class="section-title"><span>Purchase orders · Atium</span><span>${open.length} open${late ? ` · <b class="st-warning">${late} late</b>` : ''}${stale ? ` · ${stale} stale` : ''}</span></div>
      ${open.slice(0, 8).map(x => poRow(x.p, url)).join('') || '<p class="muted small">Nothing waiting to be received.</p>'}
      <p class="muted small">${open.length > 8 ? `+${open.length - 8} more open · ` : ''}${done ? `${done} fully received · ` : ''}<a class="linkish" data-url="${esc(url)}" data-what="Atium">all purchase orders</a></p>`;
  };
  async function loadPOs(s) {
    const box = () => { const el = $('#sitePOs'); return el && el.dataset.site === s.id ? el : null; };
    if (s.atium.pos) { box() && (box().innerHTML = poBlock(s.atium.pos, s.atium.posUrl)); return; } // demo data
    if (s.atium.posLive?.pos && box()) box().innerHTML = poBlock(s.atium.posLive.pos, s.atium.posUrl); // from the last refresh, while the fresh read runs
    const hit = poCache.get(s.atium.id);
    let r = hit && Date.now() - hit.at < 10 * 60e3 ? hit.r : null;
    if (!r) {
      try { r = await LambdaLive.atiumPOs(s.atium.id); poCache.set(s.atium.id, { at: Date.now(), r }); }
      catch (e) { if (s.atium.posLive?.pos) return; if (box()) box().innerHTML = `<div class="section-title"><span>Purchase orders · Atium</span></div><p class="muted small">Couldn't load: ${esc(String(e.message || e).replace(/^SIGN_IN: /, ''))} · <a class="linkish" data-url="${esc(s.atium.posUrl)}" data-what="Atium">open in Atium</a></p>`; return; }
    }
    if (box()) box().innerHTML = r.pos.length ? poBlock(r.pos, r.url) : '';
  }

  // Grafana health on a site card: power, hottest inlet, alerts by type (hardware first), unreachable network devices.
  const tempSt = t => t >= 40 ? 'critical' : t >= 32 ? 'warning' : 'good';
  const alertSince = a => a.since ? `since ${rel(a.since)} ago` : '';
  const alertLine = a => `${esc(a.name)}${a.gpu ? ` · GPU ${esc(a.gpu)}` : ''}${a.rack ? ` · ${esc(a.rack)}${a.u ? ` U${esc(String(a.u).replace(/\.0$/, ''))}` : ''}` : ''}`;
  const healthBlock = s => { const h = s.gf;
    const hs = D.HEALTH?.sites.find(x => x.code === s.id), urgent = hs ? [...hs.checks.leak.items.map(x => ['💧 Leak', x]), ...hs.checks.breaker.items.filter(x => x.since).map(x => ['⚡ Breaker newly tripped', x])] : [];
    const urgentRows = urgent.map(([l, x]) => `<div class="mini-ticket urgent-row" data-hcell="${esc(s.id)}|${l.includes('Leak') ? 'leak' : 'breaker'}"><span class="qkey st-critical">${l}</span><span class="qsum mono">${esc(x.h || '')} · ${esc(x.r || '')}${x.u ? ' U' + esc(x.u) : ''}</span><span class="small muted">${x.since ? rel(x.since) + ' ago' : ''}</span></div>`).join('');
    if (!h) return urgentRows ? `<div class="section-title"><span>Health · Grafana</span><span></span></div>${urgentRows}` : '';
    const hot = h.inlet[0], crit = h.counts.filter(c => c.crit).reduce((t, c) => t + c.n, 0);
    return `<div class="section-title"><span>Health · Grafana</span><span>${h.clusters.join(' · ')}</span></div>
      ${urgentRows}
      <div class="stats hstats">
        <div class="stat"><b>${h.pduKw != null ? Math.round(h.pduKw).toLocaleString() : '—'}</b><span>PDU kW</span></div>
        <div class="stat" title="${hot ? `${esc(hot.host)} · ${esc(hot.rack)}` : 'No inlet sensors reported'}"><b class="${hot ? 'st-' + tempSt(hot.temp) : ''}">${hot ? Math.round(hot.temp) + '°' : '—'}</b><span>Hottest inlet${hot?.rack ? ' · ' + esc(hot.rack) : ''}</span></div>
        <div class="stat"><b class="${crit ? 'st-critical' : h.hwTotal ? 'st-warning' : ''}">${h.hwTotal.toLocaleString()}</b><span>Hardware alerts${crit ? ` · ${crit} critical` : ''}</span></div>
        <div class="stat"><b class="${h.unreachable.length ? 'st-warning' : ''}">${h.unreachable.length}</b><span>Unreachable devices</span></div></div>
      ${h.counts.slice(0, 7).map(c => `<div class="mini-ticket" data-href="${esc(h.url)}" title="Open the site's health board in Grafana"><span class="qkey">${c.n}×</span><span class="qsum">${esc(c.name)}${c.hw ? '' : ' <small class="muted">(software)</small>'}</span>${statusChip(c.crit ? 'critical' : c.hw ? 'warning' : 'idle', c.crit ? 'critical' : c.hw ? 'hardware' : 'other')}</div>`).join('')}
      ${h.counts.length > 7 ? `<p class="muted small">+${h.counts.length - 7} more alert types</p>` : ''}
      <div class="links">${btn('Site health in Grafana', h.url)}</div>`; };
  const alertsBlock = list => list?.length ? `<div class="section-title"><span>Firing alerts · Grafana</span><span>${list.length}</span></div>${list.slice(0, 8).map(a =>
      `<div class="mini-ticket"><span class="qkey">${statusChip(a.crit ? 'critical' : a.hw ? 'warning' : 'idle', a.severity || 'alert')}</span><span class="qsum">${alertLine(a)}</span><span class="small muted">${alertSince(a)}</span></div>`).join('')}` : '';

  const SiteCard = {
    open(s) {
      Fleet.focus(s);
      const tickets = D.TICKETS.filter(t => t.site === s.id).sort(byUrgency);
      const sev = { critical: 0, warning: 1, good: 2 };
      const inv = [...s.inventory].sort((a, b) => sev[invStatus(a)] - sev[invStatus(b)] || b.stock - a.stock);
      const maxStock = Math.max(1, ...inv.map(i => Math.max(i.stock, i.alert * 2)));
      const invRows = inv.slice(0, 14).map(i => {
        const p = D.partById(i.part), st = invStatus(i), max = Math.max(i.alert * 3, i.stock, 1) || maxStock;
        return `<div class="inv linkish-row" data-part="${esc(i.part)}" title="${esc(partLabel(p))}: ${i.stock} on hand${i.alert ? `, alert at ${i.alert}` : ''}${i.receiving ? `, ${i.receiving} receiving` : ''}">
          <span class="inv-name">${esc(p?.name && p.name !== p.pn ? p.name : i.part)}${p?.name && p.name !== p.pn ? ` <small class="muted mono">${esc(p.pn)}</small>` : ''}</span>
          <span class="inv-bar"><i style="width:${(i.stock / max) * 100}%;background:${st === 'good' ? C['c-site'] : C[st]}"></i>${i.alert ? `<u style="left:${(i.alert / max) * 100}%"></u>` : ''}</span>
          <span class="inv-num">${st === 'good' ? '' : `<span class="st-${st}">${STATUS[st].glyph} ${INV_LABEL[st]}</span> `}${i.stock}${i.receiving ? ` <small class="muted">+${i.receiving}</small>` : ''}</span></div>`;
      }).join('');
      const idleChip = s.health === 'idle' ? statusChip('idle', cap(s.status)) : statusChip(s.health);
      $('#siteCard').innerHTML = `
        <div class="card-head"><div><div class="code">${esc(s.id)} · ${esc({ dc: 'Data center', pop: 'POP', prem: 'On-prem', other: 'Site' }[s.kind])}</div><h3>${esc(s.name)}</h3>${idleChip}</div>
          <button class="x" data-close aria-label="Close">✕</button></div>
        <div class="links card-actions">${s.lat != null ? `<button class="btn primary" data-exact="${esc(s.id)}">◎ Exact location</button>` : ''}${btn('Open in NetBox', s.url)}${btn(`All ${tickets.length} in Jira`, s.jiraUrl)}${s.atium ? btn('Atium', s.atium.url) : ''}${(s.channels || []).slice(0, 3).map(c => btn('#' + c.name, c.url)).join('')}</div>
        ${s.city || s.address ? `<p class="muted small">${esc(s.address || s.city)}</p>` : ''}
        ${s.coordNote ? `<p class="note small">⚠ ${esc(s.coordNote)}</p>` : ''}
        <div class="stats">
          <div class="stat"><b>${kfmt(s.racks)}</b><span>Racks</span></div><div class="stat"><b>${kfmt(s.devices)}</b><span>Devices</span></div>
          <div class="stat"><b>${s.openTickets}</b><span>Open tickets</span></div><div class="stat"><b>${s.breached || 0}</b><span>SLA breached</span></div></div>
        ${healthBlock(s)}
        ${s.deployments?.length ? `<div class="section-title"><span>Deployments here</span><span>${s.deployments.length}</span></div>${s.deployments.map(d => `<div class="mini-ticket" data-dep="${d.key}"><span class="qkey">${d.key}</span><span class="qsum">${esc(d.title)}</span>${statusChip(d.health, `${pct(d.progress)} · ${fmtDate(d.end)}`)}</div>`).join('')}` : ''}
        ${(D.VOLUNTEER || []).filter(v => v.site === s.id).map(v => `<div class="section-title"><span>Volunteers wanted · Slack</span><span>${rel(v.askedAt)}</span></div><ul class="vol-in-card">${volRow(v)}</ul>`).join('')}
        ${s.builds?.length ? `<div class="section-title"><span>Builds · Atium</span><span>${s.builds.length}</span></div>${s.builds.map(buildRow).join('')}` : ''}
        ${s.atium && (s.atium.pos || isExt && D.MODE === 'live') ? `<div id="sitePOs" data-site="${esc(s.id)}"><div class="section-title"><span>Purchase orders · Atium</span><span>loading…</span></div></div>` : ''}
        ${s.atium ? `<p class="muted small">Atium: ${s.atium.assets.toLocaleString()} assets tracked${s.atium.consumables ? ` · ${s.atium.consumables.toLocaleString()} consumables` : ''} · <a class="linkish" data-url="${esc(s.atium.url)}" data-what="Atium">open inventory</a></p>` : ''}
        ${inv.length ? `<div class="section-title"><span>Spares on hand</span><span>bar tick = alert level</span></div>${invRows}
          ${inv.length > 14 ? `<p class="muted small">+${inv.length - 14} more part numbers</p>` : ''}` : ''}
        ${s.material?.length ? `<div class="section-title"><span>Material on hand · NetSuite</span><span>${s.material.length} items</span></div>
          ${s.material.slice(0, 8).map(m => `<div class="inv ns" title="${esc(m.name)} (${esc(m.item)}): ${m.qty} on hand"><span class="inv-name">${esc(m.name || m.item)} <small class="muted mono">${esc(m.item)}</small></span><span class="inv-num">${m.qty.toLocaleString()}</span></div>`).join('')}` : ''}
        ${s.moves?.length ? `<div class="section-title"><span>Material movements · NetSuite</span><span>${s.moves.length}</span></div>
          ${s.moves.slice(0, 5).map(m => `<div class="mini-ticket" ${m.deploymentKey ? `data-dep="${m.deploymentKey}"` : ''}><span class="qkey">${esc(m.doc)}</span><span class="qsum">${esc(m.type)}${m.deployment ? ' · ' + esc(m.deployment) : ''}</span><span class="small muted">${esc(m.status || m.date)}</span></div>`).join('')}` : ''}
        <div class="section-title"><span>Open tickets</span><span>${tickets.length}</span></div>
        ${tickets.slice(0, 10).map(t => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum">${esc(t.summary)}</span>${statusChip(slaStatus(t), slaText(t))}</div>`).join('') || '<p class="muted small">None.</p>'}
        ${tickets.length > 10 ? `<p class="muted small">+${tickets.length - 10} more · <a class="linkish" data-url="${esc(s.jiraUrl || '')}" data-what="Jira">see all in Jira</a></p>` : ''}`;
      $('#siteCard').hidden = false; $('#siteCard').scrollTop = 0; renderSites();
      if (s.atium && $('#sitePOs')) loadPOs(s);
    },
    close() { $('#siteCard').hidden = true; Fleet.clear(); renderSites(); },
  };
  renderSites();

  /* ---------------- Drawer ---------------- */
  const Drawer = {
    open(html, cls = '') { volOpen = cls === 'wide' && volOpen; $('#drawer').className = `drawer ${cls}`; $('#drawer').innerHTML = `<button class="x" data-close-drawer aria-label="Close" style="float:right">✕</button>${html}`; $('#drawer').hidden = false; $('#drawer').scrollTop = 0; },
    close() { $('#drawer').hidden = true; volOpen = false; },
  };
  const ticketRow = t => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum">${esc(t.summary)}</span>${statusChip(slaStatus(t), slaText(t))}</div>`;
  function openDeployment(d) {
    const days = d.end ? Math.round((d.end - Date.now()) / 864e5) : null;
    const wsRows = d.workstreams.map(w => `<tr data-href="${esc(w.url)}" class="clickrow"><td class="mono">${esc(w.key)}</td><td>${esc(w.summary)}</td><td>${esc(w.status)}</td>
      <td class="num">${w.total ? `${progressBar(w.done / w.total, w.cat === 'done' ? 'good' : 'idle')} ${w.done}/${w.total}` : '—'}</td></tr>`).join('');
    return Drawer.open(`<div class="qkey">${d.key} · ${esc(d.source === 'CI' ? 'Cluster Intake' : d.deployType || 'Deployment')}${d.tags.length ? ' · ' + d.tags.map(esc).join(' · ') : ''}</div>
      <h3>${esc(d.title)} ${star(d)}</h3>
      ${statusChip(d.health, depStatus(d))}${d.project ? ` <a class="linkish small" data-proj="${d.project.key}">in ${esc(d.project.title)}</a>` : ''}
      <div class="dprog">${progressBar(d.progress, d.health)}<span>${d.totalCount ? `${pct(d.progress)} · ${d.doneCount} of ${d.totalCount} issues done` : 'No child issues yet'}</span></div>
      <dl class="kv">
        <dt>Sites</dt><dd>${d.sites.map(c => `<a data-open="site:${esc(c)}">${esc(c)}</a>`).join(', ') || '—'}</dd>
        ${d.gpus ? `<dt>GPUs</dt><dd>${d.gpus.toLocaleString()} × ${esc(d.gpuModel)}</dd>` : ''}
        <dt>Owner</dt><dd>${esc(d.assigneeName)}</dd>
        <dt>Planned</dt><dd>${fmtDate(d.start)} → ${fmtDate(d.end)}${days != null ? ` · <b class="${days < 0 ? 'st-critical' : days < 14 ? 'st-warning' : ''}">${days < 0 ? `${-days}d overdue` : `${days}d left`}</b>` : ''}</dd>
        ${d.projectType ? `<dt>Type</dt><dd>${esc([d.deployType, d.projectType].filter(Boolean).join(' · '))}</dd>` : ''}
        ${d.size || d.gpuType ? `<dt>Size</dt><dd>${esc([d.size, d.gpuType].filter(Boolean).join(' · '))}</dd>` : ''}
      </dl>
      ${d.build ? buildBlock(d.build) : ''}
      ${d.workstreams.length ? `<div class="section-title"><span>Workstreams</span><span>${d.workstreams.length}</span></div>
        <div class="answer" style="margin:0"><table><tr><th>Key</th><th>Workstream</th><th>Status</th><th class="num">Progress</th></tr>${wsRows}</table></div>` : ''}
      ${d.events.length ? `<div class="section-title"><span>Meetings</span><span>${d.events.length}</span></div>${d.events.slice(0, 6).map(e => `<div class="mini-ticket" data-href="${esc(e.link)}"><span class="qkey">${new Date(e.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span><span class="qsum">${esc(e.title)}</span><span class="small muted">${e.allDay ? 'all day' : new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}` : ''}
      ${d.moves.length ? `<div class="section-title"><span>Material movements · NetSuite</span><span>${d.moves.length}</span></div>
        <div class="answer" style="margin:0"><table><tr><th>Date</th><th>Doc</th><th>Type</th><th>Status</th><th>Tracking</th></tr>${d.moves.slice(0, 15).map(m => `<tr><td>${esc(m.date)}</td><td class="mono">${esc(m.doc)}</td><td>${esc(m.type)}</td><td>${esc(m.status)}</td><td class="mono">${esc(m.tracking)}</td></tr>`).join('')}</table></div>` : ''}
      <div class="links">${btn('Open in Jira', d.url, true)}${d.channels.map(c => btn('#' + c.name, c.url)).join('')}${d.slackUrl ? btn('Slack channel', d.slackUrl) : ''}</div>`);
  }
  function openProject(p) {
    return Drawer.open(`<div class="qkey">${p.key} · PROJECT</div><h3>${esc(p.title)}</h3>${statusChip(p.health, depStatus(p))}
      <dl class="kv"><dt>Owner</dt><dd>${esc(p.assigneeName)}</dd><dt>Planned</dt><dd>${fmtDate(p.start)} → ${fmtDate(p.end)}</dd><dt>Sites</dt><dd>${p.sites.map(c => `<a data-open="site:${esc(c)}">${esc(c)}</a>`).join(', ') || '—'}</dd></dl>
      <div class="section-title"><span>Deployments</span><span>${p.deployments.length}</span></div>
      <ul class="queue" style="padding:0">${p.deployments.map(depRow).join('') || '<li class="muted">None open.</li>'}</ul>
      <div class="links">${btn('Open in Jira', p.url, true)}</div>`);
  }
  function openNsItem(it) {
    return Drawer.open(`<div class="qkey">NETSUITE ITEM · ${esc(it.item)}</div><h3>${esc(it.name || it.item)}</h3>
      <p class="muted">${it.total.toLocaleString()} on hand across ${it.rows.length} sites${it.legacy ? ` · legacy P/N ${esc(it.legacy)}` : ''}</p>
      <div class="answer" style="margin:12px 0 0"><table><tr><th>Site</th><th class="num">On hand</th></tr>${it.rows.sort((a, b) => b.qty - a.qty).map(r => `<tr><td><a class="linkish" data-site="${esc(r.site)}">${esc(r.site)}</a></td><td class="num">${r.qty.toLocaleString()}</td></tr>`).join('')}</table></div>`);
  }
  const NS_ITEMS = (() => {
    const m = new Map();
    for (const s of D.SITES) for (const r of s.material || []) {
      const e = m.get(r.item) || { item: r.item, name: r.name, legacy: r.legacy, total: 0, rows: [] };
      e.total += r.qty; e.rows.push({ site: s.id, qty: r.qty }); m.set(r.item, e);
    }
    return [...m.values()];
  })();
  function openEntity(type, ref) {
    if (!ref) return;
    if (type === 'deployment') return openDeployment(ref);
    if (type === 'project') return openProject(ref);
    if (type === 'channel') return openUrl(ref.url, 'Slack');
    if (type === 'event') return openUrl(ref.link, 'Calendar');
    if (type === 'site') { setView('globe'); return SiteCard.open(ref); }
    if (type === 'rack') return SiteCard.open(D.siteById(ref.site));
    if (type === 'ticket') {
      const t = ref, st = slaStatus(t), dev = D.deviceById(t.device), part = t.part && D.partById(t.part), site = D.siteById(t.site);
      const stockHere = part && site?.inventory.find(i => i.part === part.id);
      return Drawer.open(`<div class="qkey">${t.key} · ${esc(t.priority)}</div><h3>${esc(t.summary)}</h3>
        ${statusChip(st, `${STATUS[st].glyph} ${slaText(t)}`)}
        <dl class="kv"><dt>Status</dt><dd>${esc(t.status)}</dd>
          <dt>Assignee</dt><dd>${t.assignee ? `<a data-open="person:${esc(t.assignee)}">${esc(D.personById(t.assignee).name)}</a>` : 'Unassigned'}</dd>
          <dt>Site</dt><dd>${site ? `<a data-open="site:${esc(site.id)}">${esc(site.id)} · ${esc(site.name)}</a>` : '—'}</dd>
          ${dev ? `<dt>Device</dt><dd><a data-open="device:${esc(dev.id)}" class="mono">${esc(dev.id)}</a></dd><dt>Location</dt><dd>${esc(dev.rack)}${dev.u ? ` · U${dev.u}` : ''}</dd><dt>Model</dt><dd>${esc(dev.model)}</dd>` : ''}
          ${part ? `<dt>Part</dt><dd><a data-open="part:${esc(part.id)}">${esc(partLabel(part))}</a>${stockHere ? ` · <b>${stockHere.stock} on hand at ${esc(site.id)}</b>` : site ? ` · none on hand at ${esc(site.id)}` : ''}</dd>` : ''}
          <dt>Created</dt><dd>${new Date(t.created).toLocaleString()}</dd><dt>Updated</dt><dd>${rel(t.updated)} ago</dd></dl>
        ${alertsBlock(t.alerts)}
        <div class="links">${btn('Open in Jira', t.url, true)}${dev ? btn('Device in NetBox', dev.url) : ''}${t.alerts?.length && site?.gf ? btn('Site health in Grafana', site.gf.url) : ''}</div>`);
    }
    if (type === 'device') {
      const d = ref, ts = D.TICKETS.filter(t => t.device === d.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">DEVICE</div><h3 class="mono">${esc(d.id)}</h3>
        <dl class="kv"><dt>Model</dt><dd>${esc(d.model)}</dd>${d.serial ? `<dt>Serial</dt><dd class="mono">${esc(d.serial)}</dd>` : ''}
          <dt>Site</dt><dd>${d.site ? `<a data-open="site:${esc(d.site)}">${esc(d.site)}</a>` : '—'}</dd><dt>Rack / U</dt><dd>${esc(d.rack)}${d.u ? ` · U${d.u}` : ''}</dd></dl>
        ${alertsBlock(d.alerts)}
        <div class="section-title"><span>Open tickets</span><span>${ts.length}</span></div>${ts.map(ticketRow).join('') || '<p class="muted">None.</p>'}
        <div class="links">${btn('Open in NetBox', d.url, true)}${d.alerts?.length && D.siteById(d.site)?.gf ? btn('Site health in Grafana', D.siteById(d.site).gf.url) : ''}</div>`);
    }
    if (type === 'part') {
      const p = ref, rows = D.SITES.map(s => ({ s, i: s.inventory.find(x => x.part === p.id) })).filter(r => r.i).sort((a, b) => b.i.stock - a.i.stock);
      const waiting = D.TICKETS.filter(t => t.part === p.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">PART · ${esc(p.pn)}</div><h3>${esc(p.name !== p.pn ? p.name : p.pn)}</h3>
        <p class="muted">${p.mfr ? esc(p.mfr) + ' · ' : ''}${rows.reduce((a, r) => a + r.i.stock, 0)} on hand fleet-wide · ${waiting.length} open tickets need it</p>
        ${rows.length ? `<div class="answer" style="margin:12px 0 0"><table><tr><th>Site</th><th class="num">On hand</th><th class="num">Alert at</th><th class="num">Receiving</th><th></th></tr>
        ${rows.map(({ s, i }) => `<tr><td><a class="linkish" data-open="site:${esc(s.id)}">${esc(s.id)}</a></td><td class="num">${i.stock}</td><td class="num">${i.alert || '—'}</td><td class="num">${i.receiving || ''}</td><td>${invStatus(i) === 'good' ? '' : statusChip(invStatus(i), INV_LABEL[invStatus(i)])}</td></tr>`).join('')}</table></div>` : '<p class="muted">Not stocked anywhere in NetBox.</p>'}
        <div class="section-title"><span>Tickets needing this part</span><span>${waiting.length}</span></div>${waiting.slice(0, 30).map(ticketRow).join('') || '<p class="muted">None.</p>'}`);
    }
    if (type === 'person') {
      const p = ref, ts = D.TICKETS.filter(t => t.assignee === p.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">PERSON</div><h3>${esc(p.id === 'me' ? `You${p.handle ? ` (${p.handle})` : ''}` : p.name)}</h3><p class="muted">${ts.length} assigned open tickets</p>
        <div class="section-title"><span>Assigned</span></div>${ts.slice(0, 60).map(ticketRow).join('') || '<p class="muted">None.</p>'}`);
    }
  }
  function openRef(ref) {
    const [kind, id] = ref.split(/:(.+)/);
    const map = { site: D.siteById, device: D.deviceById, part: D.partById, person: D.personById, ticket: D.ticketByKey };
    openEntity(kind, map[kind](id));
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-exact],[data-track],[data-ticket],[data-site],[data-part],[data-dep],[data-proj],[data-open],[data-url],[data-href],[data-close],[data-close-drawer],[data-ref]');
    if (!el) return;
    if (el.dataset.exact) return Fleet.exact(D.siteById(el.dataset.exact));
    if (el.dataset.track) {
      const on = D.toggleTrack(el.dataset.track);
      document.querySelectorAll(`[data-track="${el.dataset.track}"]`).forEach(b => { b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.title = on ? 'Stop tracking' : 'Track this deployment'; });
      renderQueue(); if (activeView === 'deploys') Deploys.render();
      return toast(on ? 'Tracking. It’s in the Tracking tab on the left.' : 'Stopped tracking.');
    }
    if (el.dataset.href !== undefined) return openUrl(el.dataset.href, 'This');
    if (el.dataset.dep) { closePalette(); return openEntity('deployment', D.deploymentByKey(el.dataset.dep)); }
    if (el.dataset.proj) { closePalette(); return openEntity('project', D.projectByKey(el.dataset.proj)); }
    if (el.dataset.close !== undefined) return SiteCard.close();
    if (el.dataset.closeDrawer !== undefined) return Drawer.close();
    if (el.dataset.url !== undefined) return openUrl(el.dataset.url, el.dataset.what || 'This');
    if (el.dataset.ticket) { closePalette(); return openEntity('ticket', D.ticketByKey(el.dataset.ticket)); }
    if (el.dataset.site) { closePalette(); setView('globe'); return SiteCard.open(D.siteById(el.dataset.site)); }
    if (el.dataset.part) return openEntity('part', D.partById(el.dataset.part));
    if (el.dataset.open) return openRef(el.dataset.open);
    if (el.dataset.ref !== undefined) {
      const r = el.dataset.ref;
      if (D.ticketByKey(r)) return openEntity('ticket', D.ticketByKey(r));
      if (D.deploymentByKey?.(r)) return openEntity('deployment', D.deploymentByKey(r));
      if (D.siteById(r)) { setView('globe'); return SiteCard.open(D.siteById(r)); }
    }
  });

  /* ---------------- Command palette + local "ask" ---------------- */
  const pal = $('#palette'), input = $('#paletteInput'), body = $('#paletteBody');
  let results = [], active = 0, typing = null;
  const SYNONYMS = { nic: 'connectx', 'power supply': 'psu', ssd: 'nvme', drive: 'nvme', memory: 'dimm', ram: 'dimm', transceiver: 'optic' };
  const STOP = new Set(['stock', 'of', 'at', 'in', 'how', 'many', 'the', 'do', 'we', 'have', 'spare', 'spares', 'inventory', 'what', 'where', 'is', 'are', 'left', 'for', 'parts', 'part', 'any', 'show', 'me', 'low', 'out']);
  function findPart(q) {
    let s = q; for (const [a, b] of Object.entries(SYNONYMS)) s = s.replace(a, b);
    const toks = s.split(/[^a-z0-9-]+/).filter(t => t.length >= 3 && !STOP.has(t) && !D.siteById(t.toUpperCase()));
    if (!toks.length) return null;
    let best = null, bs = 0;
    for (const p of D.PARTS) {
      const hay = `${p.pn} ${p.name} ${p.mfr}`.toLowerCase(), sc = toks.filter(t => hay.includes(t)).length;
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }
  const findSite = q => D.SITES.find(s => new RegExp(`\\b${s.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}\\b`).test(q))
    || D.SITES.find(s => { const city = s.name.split(',')[0].toLowerCase(); return city.length >= 4 && q.includes(city); });

  function openPalette(prefill = '') { pal.hidden = false; input.value = prefill; renderPalette(); setTimeout(() => input.focus(), 0); }
  function closePalette() { pal.hidden = true; clearInterval(typing); aiAbort?.abort(); }
  $('#cmdTrigger').addEventListener('click', () => openPalette());
  pal.addEventListener('click', e => { if (e.target === pal) closePalette(); });

  function search(q) {
    const s = q.toLowerCase(), out = [];
    const score = (...fields) => { let best = 0; for (const f of fields) { const v = String(f ?? '').toLowerCase(); if (!v) continue; if (v === s) best = Math.max(best, 3); else if (v.startsWith(s)) best = Math.max(best, 2); else if (v.includes(s)) best = Math.max(best, 1); } return best; };
    const push = (group, items, n = 4) => items.filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, n).forEach(x => out.push({ group, ...x }));
    push('Sites', D.SITES.map(x => ({ sc: score(x.id, x.name, x.fullName, x.city), icon: 'S', color: C['c-site'], title: `${x.id} · ${x.name}`, sub: `${x.openTickets} open tickets${x.racks != null ? ` · ${x.racks} racks` : ''} · ${siteStatusLabel(x)}`, run: () => { closePalette(); setView('globe'); SiteCard.open(x); } })));
    push('Deployments', (D.DEPLOYMENTS || []).map(x => ({ sc: score(x.key, x.title, x.summary, x.gpuModel, ...x.sites), icon: '◆', color: XC.deployment, title: `${x.key} · ${x.title}`, sub: `${x.sites.join(', ') || '?'} · ${depStatus(x)} · ${pct(x.progress)} · due ${fmtDate(x.end)}`, run: () => { closePalette(); openEntity('deployment', x); } })), 5);
    push('Projects', (D.PROJECTS || []).map(x => ({ sc: score(x.key, x.title, x.summary), icon: '⬡', color: XC.project, title: `${x.key} · ${x.title}`, sub: `${x.deployments.length} deployments · ${x.status}`, run: () => { closePalette(); openEntity('project', x); } })), 3);
    push('Tickets', D.TICKETS.map(x => ({ sc: score(x.key, x.summary, x.device), icon: 'T', color: C['c-ticket'], title: `${x.key} · ${x.summary}`, sub: `${x.site || '?'} · ${x.status} · ${x.assigneeName}`, run: () => { closePalette(); openEntity('ticket', x); } })), 5);
    push('Devices', D.DEVICES.map(x => ({ sc: score(x.id, x.serial, x.model), icon: 'D', color: C['c-device'], title: x.id, sub: `${x.model} · ${x.site || '?'} ${x.rack}${x.u ? ` U${x.u}` : ''}`, run: () => { closePalette(); openEntity('device', x); } })));
    push('Parts', D.PARTS.map(x => ({ sc: score(x.pn, x.name, x.mfr), icon: 'P', color: C['c-part'], title: partLabel(x), sub: 'Stock by site', run: () => { closePalette(); openEntity('part', x); } })));
    push('People', D.PEOPLE.map(x => ({ sc: score(x.name, x.handle), icon: '@', color: C['c-person'], title: x.name, sub: 'Assigned tickets', run: () => { closePalette(); openEntity('person', x); } })));
    push('Slack', (D.CHANNELS || []).map(c => ({ sc: score(c.name, c.topic, c.purpose), icon: '#', color: XC.channel, title: '#' + c.name, sub: `${c.members} members${c.site ? ' · ' + c.site : ''}`, run: () => { closePalette(); openUrl(c.url, 'Slack'); } })), 3);
    push('Calendar', (D.EVENTS || []).map(e => ({ sc: score(e.title), icon: '◷', color: XC.event, title: e.title, sub: new Date(e.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), run: () => { closePalette(); openUrl(e.link, 'Calendar'); } })), 3);
    push('NetSuite items', NS_ITEMS.map(it => ({ sc: score(it.item, it.name, it.legacy), icon: 'N', color: C['c-part'], title: `${it.name || it.item}`, sub: `${it.item} · ${it.total.toLocaleString()} on hand at ${it.rows.length} sites`, run: () => { closePalette(); openNsItem(it); } })), 4);

    return out;
  }

  const looksLikeQuestion = q => /^\?|\b(how|what|where|which|who|why|stock|inventory|low|short|risk|sla|breach|my|mine)\b/i.test(q);
  function renderPalette() {
    clearInterval(typing);
    const q = input.value.trim();
    if (!q) {
      results = [
        { group: 'Quick', icon: '☀', color: C.warning, title: 'Daily brief', sub: 'Meetings, your tickets, tracked deployments, what changed', run: () => { closePalette(); historyReady.then(openBrief); } },
        { group: 'Quick', icon: '⌕', color: C.accent, title: 'Show my tickets', sub: 'Assigned to, reported or watched by you', run: () => ask('my tickets') },
        { group: 'Quick', icon: '!', color: C.serious, title: 'What breaches SLA today?', sub: 'Breached or due in the next 24h', run: () => ask('sla risk') },
        { group: 'Quick', icon: '▲', color: C.warning, title: 'Which spares are low?', sub: 'At or below NetBox alert level', run: () => ask('low stock') },
        { group: 'Quick', icon: '◆', color: XC.deployment, title: 'Deployments at risk', sub: 'At risk, off track or overdue', run: () => ask('deployments at risk') },
        { group: 'Quick', icon: '◷', color: XC.event, title: 'What’s on my calendar?', sub: 'Next meetings, linked to deployments', run: () => ask('my meetings') },
        { group: 'Quick', icon: '◇', color: C['c-part'], title: 'Waiting on parts we already have', sub: 'Part is on hand at the ticket’s site', run: () => ask('waiting parts on site') },
        { group: 'Quick', icon: '◎', color: C['c-site'], title: 'Open the second brain', sub: 'Everything linked, as neurons', run: () => { closePalette(); setView('graph'); } },
        ...apps().filter(a => /DC queue|Sites|Material on hand|Open Slack|Inbox|Settings/.test(a[1])).map(goRow),
      ];
    } else {
      const st = aiState(), qt = q.replace(/^\?\s*/, '');
      const askRows = st.ok
        ? [{ group: 'Ask', icon: 'λ', color: C['accent-2'], title: `Ask ${st.label}: “${qt}”`, sub: `${st.model} · grounded in your loaded data${SET?.privacy?.mode === 'redact' ? ' · private values masked' : ''}`, run: () => askAI(q) },
           { group: 'Ask', icon: '⌁', color: C.accent, title: `Quick answer: “${qt}”`, sub: 'Instant, from local data only (nothing leaves your browser)', run: () => ask(q) }]
        : [{ group: 'Ask', icon: 'λ', color: C['accent-2'], title: `Ask: “${qt}”`, sub: `Answered from local data · ${st.why}`, run: () => ask(q) },
           { group: 'Ask', icon: '✨', color: C['accent-2'], title: 'Open the AI assistant', sub: `Chat panel (${KEY('J')})`, run: () => askAI(q) }];
      const lq = q.toLowerCase(), go = apps().filter(a => `${a[0]} ${a[1]}`.toLowerCase().includes(lq) || (lq.length >= 3 && a[0].toLowerCase().startsWith(lq))).map(goRow);
      const hits = q.startsWith('?') ? [] : [...search(q), ...go];
      results = looksLikeQuestion(q) || !hits.length ? [...askRows, ...hits] : [...hits, ...askRows];
    }
    active = 0; paint();
  }
  function paint() {
    let g = '';
    body.innerHTML = results.map((r, i) => {
      const head = r.group !== g ? `<div class="pgroup">${r.group}</div>` : ''; g = r.group;
      return `${head}<div class="presult ${i === active ? 'active' : ''}" data-i="${i}"><span class="picon" style="color:${r.color}">${esc(r.icon)}</span>
        <div style="min-width:0"><div class="ptitle">${esc(r.title)}</div><div class="psub">${esc(r.sub)}</div></div><span class="muted">${i === active ? '↵' : ''}</span></div>`;
    }).join('') + `<div class="phint"><span>↑↓ navigate</span><span>↵ open</span><span>? prefix forces a question</span></div>`;
    body.querySelector('.presult.active')?.scrollIntoView({ block: 'nearest' });
  }
  body.addEventListener('click', e => { const r = e.target.closest('.presult'); if (r) results[+r.dataset.i].run(); });
  body.addEventListener('mousemove', e => { const r = e.target.closest('.presult'); if (r && +r.dataset.i !== active) { active = +r.dataset.i; paint(); } });
  input.addEventListener('input', renderPalette);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); results[active]?.run(); }
  });

  function answerFor(raw) {
    const q = raw.toLowerCase().replace(/^\?\s*/, '').trim(), now = Date.now();
    const site = findSite(q), dev = D.DEVICES.find(d => d.id.length > 4 && q.includes(d.id.toLowerCase()));
    const inSite = t => !site || t.site === site.id, where = site ? ` at ${site.id}` : '';
    const tRows = ts => ({ head: ['Ticket', 'Site', 'Status', 'SLA'], rows: ts.map(t => [t.key, t.site || '?', t.status, slaText(t)]) });
    if (/deploy|project|rollout|tranche|bring.?up|build.?out|tracking|tracked/.test(q) && D.DEPLOYMENTS?.length) {
      let ds = [...D.DEPLOYMENTS];
      if (site) ds = ds.filter(d => d.sites.includes(site.id));
      if (/risk|off track|overdue|late|behind|blocked/.test(q)) ds = ds.filter(d => ['critical', 'warning'].includes(d.health));
      if (/\bmy\b|mine|track/.test(q)) ds = ds.filter(d => D.isTracked(d.key) || d.mine);
      ds.sort((a, b) => (a.end || Infinity) - (b.end || Infinity));
      const gpus = ds.reduce((a, d) => a + (d.gpus || 0), 0), risky = ds.filter(d => ['critical', 'warning'].includes(d.health)).length;
      const next = ds.find(d => d.end && d.end >= now);
      return { text: `${ds.length} deployments${where}${gpus ? `, ${gpus.toLocaleString()} GPUs in total` : ''}. ${risky} are at risk, off track or overdue.${next ? ` Next due: ${next.key} (${next.title}) on ${fmtDate(next.end)}.` : ''}`,
        table: { head: ['Deployment', 'Site', 'Status', 'Done', 'Due'], rows: ds.map(d => [d.key, d.site || '—', depStatus(d), pct(d.progress), fmtDate(d.end)]), num: [3] } };
    }
    if (/meeting|calendar|agenda|schedule|standup/.test(q) && D.EVENTS) {
      const ev = D.EVENTS.filter(e => e.at > now - 30 * 60000 && (!site || e.sites.includes(site.id))).slice(0, 15);
      return { text: ev.length ? `Your next ${ev.length} meetings${where}. ${ev.filter(e => e.deployment).length} are linked to a deployment.` : `No upcoming meetings${where} on your calendar.`,
        table: ev.length ? { head: ['When', 'Meeting', 'Linked'], rows: ev.map(e => [new Date(e.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }), e.title, e.deployment || e.site || '']) } : null };
    }
    if (/mail|inbox|unread|email/.test(q) && D.MAIL) {
      return { text: `${D.MAIL.unread} unread emails in ${D.MAIL.email || 'your inbox'}.`, table: { head: ['From', 'Subject', 'When'], rows: D.MAIL.entries.map(e => [e.from, e.title, rel(e.at)]) } };
    }
    if (/shipment|shipping|shipped|material|netsuite|transfer order|tracking number|deliver/.test(q) && D.MOVES?.length) {
      const ms = D.MOVES.filter(m => !site || m.site === site.id).slice(0, 40);
      return { text: `${ms.length} recent NetSuite material movements${where}, ${ms.filter(m => /pending|transit|shipped/i.test(m.status)).length} still moving.`,
        table: { head: ['Date', 'Doc', 'Deployment', 'Status', 'Tracking'], rows: ms.map(m => [m.date, m.doc, m.deploymentKey || m.deployment || '', m.status, m.tracking]) } };
    }
    if (dev) {
      const ts = D.TICKETS.filter(t => t.device === dev.id);
      return { text: `${dev.id} is a ${dev.model} at ${dev.site || 'an unknown site'}, cabinet ${dev.rack}${dev.u ? `, U${dev.u}` : ''}. ${ts.length ? `It has ${ts.length} open ticket(s).` : 'No open tickets.'}`, table: ts.length ? tRows(ts) : null };
    }
    if (/waiting|have the part|on hand|on site/.test(q) && /part|rma/.test(q)) {
      const ts = D.TICKETS.filter(t => /part|rma/i.test(t.status) && inSite(t)).filter(t => (D.siteById(t.site)?.inventory.find(i => i.part === t.part)?.stock || 0) > 0).sort(byUrgency);
      return { text: `${ts.length} tickets${where} are waiting on parts or an RMA, but NetBox shows that part on hand at the same site. Those could move now.`,
        table: { head: ['Ticket', 'Site', 'Part', 'On hand'], rows: ts.map(t => [t.key, t.site, t.part, D.siteById(t.site).inventory.find(i => i.part === t.part).stock]), num: [3] } };
    }
    if (/\bmy\b|mine|assigned to me|queue/.test(q)) {
      const mine = mineSorted().filter(inSite), soon = mine.filter(t => ['critical', 'serious'].includes(slaStatus(t)));
      return { text: mine.length ? `You have ${mine.length} open tickets${where}. ${soon.length} are breached or due within 4 hours${soon.length ? `, starting with ${soon[0].key} (${soon[0].summary})` : ''}.`
        : `Nothing${where} is assigned to, reported or watched by you right now.`, table: mine.length ? tRows(mine) : null };
    }
    if (/risk|sla|breach|due|urgent|overdue/.test(q)) {
      const ts = D.TICKETS.filter(t => inSite(t) && (slaStatus(t) === 'critical' || (t.slaDue && t.slaDue < now + 24 * H))).sort(byUrgency);
      const br = ts.filter(t => slaStatus(t) === 'critical').length;
      return { text: `${br} tickets${where} have breached their resolution SLA and ${ts.length - br} more are due in the next 24 hours.`, table: tRows(ts) };
    }
    if (/low|short|reorder|out of|running/.test(q) && !findPart(q)) {
      const rows = [];
      D.SITES.filter(s => !site || s === site).forEach(s => s.inventory.forEach(i => { if (invStatus(i) !== 'good') rows.push([s.id, partLabel(D.partById(i.part)), i.stock, i.alert, i]); }));
      rows.sort((a, b) => a[2] - b[2]);
      return { text: `${rows.length} stock lines${where} are at or below their NetBox alert level, ${rows.filter(r => r[2] === 0).length} of them at zero.`,
        table: { head: ['Site', 'Part', 'On hand', 'Alert at'], rows: rows.map(r => r.slice(0, 4)), num: [2, 3] } };
    }
    const part = findPart(q);
    if (part) {
      const rows = D.SITES.filter(s => !site || s === site).map(s => ({ s, i: s.inventory.find(x => x.part === part.id) })).filter(r => r.i).sort((a, b) => b.i.stock - a.i.stock);
      const total = rows.reduce((a, r) => a + r.i.stock, 0), need = D.TICKETS.filter(t => t.part === part.id && inSite(t)).length;
      return { text: rows.length ? `${partLabel(part)}: ${total} on hand${where || ` across ${rows.length} sites`}. ${need} open tickets${where} need it.` : `NetBox has no stock of ${partLabel(part)}${where}.`,
        table: rows.length ? { head: ['Site', 'On hand', 'Alert at', 'Receiving'], rows: rows.map(r => [r.s.id, r.i.stock, r.i.alert || '—', r.i.receiving || '']), num: [1, 2, 3] } : null };
    }
    if (site) {
      const ts = D.TICKETS.filter(t => t.site === site.id).sort(byUrgency);
      return { text: `${site.name} (${site.id}) is ${siteStatusLabel(site).toLowerCase()}${site.racks != null ? `, with ${site.racks} racks and ${kfmt(site.devices)} devices` : ''}. ${ts.length} open tickets, ${site.breached || 0} breached.`, table: tRows(ts), site };
    }
    const crit = D.SITES.filter(s => s.health === 'critical').map(s => s.id);
    return { text: `I can answer from the loaded data: sites, tickets, devices and spares. Free-form questions will go to Claude once there's an approved API path.\n\nRight now: ${D.TICKETS.length.toLocaleString()} open tickets across ${D.SITES.filter(s => s.health !== 'idle').length} live sites.${crit.length ? ` Needs attention: ${crit.slice(0, 8).join(', ')}${crit.length > 8 ? '…' : ''}.` : ''}\nTry “low stock at CMH01”, “where is <hostname>”, or “what breaches SLA today”.`, table: null };
  }

  function ask(q) {
    const a = answerFor(q);
    body.innerHTML = `<div class="answer"><div class="answer-head">λ Answer <span class="muted" style="letter-spacing:0;text-transform:none">· from ${D.MODE === 'live' ? 'live NetBox + Jira' : 'demo'} data</span></div>
      <div class="answer-text"><span id="ansText"></span><span class="caret"></span></div><div id="ansExtra"></div></div>
      <div class="phint"><span>esc close</span><span>type to search again</span></div>`;
    const el = $('#ansText'); let i = 0; clearInterval(typing);
    typing = setInterval(() => {
      i += 4; el.textContent = a.text.slice(0, i);
      if (i < a.text.length) return;
      clearInterval(typing); body.querySelector('.caret')?.remove();
      let extra = '';
      if (a.table && a.table.rows.length) {
        const num = new Set(a.table.num || []);
        extra += `<table><tr>${a.table.head.map((x, hi) => `<th class="${num.has(hi) ? 'num' : ''}">${x}</th>`).join('')}</tr>${a.table.rows.slice(0, 15).map(r => `<tr>${r.map((c, ci) => {
          const v = esc(c), isKey = D.ticketByKey(c), isDep = D.deploymentByKey?.(c), isSite = D.siteById(c);
          return `<td class="${num.has(ci) ? 'num' : ''}">${isKey ? `<a class="linkish" data-ticket="${v}">${v}</a>` : isDep ? `<a class="linkish" data-dep="${v}">${v}</a>` : isSite ? `<a class="linkish" data-site="${v}">${v}</a>` : v}</td>`;
        }).join('')}</tr>`).join('')}</table>`;
        if (a.table.rows.length > 15) extra += `<p class="muted" style="margin-top:6px">+${a.table.rows.length - 15} more</p>`;
      }
      if (a.site) extra += `<div class="links"><button class="btn primary" data-site="${esc(a.site.id)}">Show ${esc(a.site.id)} on the globe</button></div>`;
      $('#ansExtra').innerHTML = extra;
    }, 12);
  }

  /* ---------------- AI assistant (Settings → AI; privacy rules in Settings → Privacy) ---------------- */
  let SET = null, aiAbort = null;
  if (isExt) LambdaLive.settings().then(s => { SET = s; }).catch(() => {});
  const aiState = () => {
    if (!SET) return { ok: false, why: isExt ? 'Loading settings…' : 'The AI assistant runs inside the extension (not in this preview).' };
    if (SET.privacy?.mode === 'local') return { ok: false, why: 'Privacy is set to “Never send to AI”, so answers come from local data only.' };
    return LambdaAI.configured(SET.ai);
  };
  const AI_SYSTEM = `You are Lambda OS, the operations assistant for Lambda's data centers. You answer questions for a data-center operator.
Use only the DATA in the user's message (a snapshot from NetBox, Jira, NetSuite, Slack, Gmail and Google Calendar). If the data doesn't contain the answer, say so plainly and name the system where it would be found.
Write ticket keys (DC-123), deployment and project keys (PMO-456), and site codes (CMH01) exactly as they appear, so the dashboard can turn them into links.
Lead with the answer in one or two sentences, then a short Markdown list or table if it helps. No preamble.
Values like [PERSON_2] or [IP_1] are privacy placeholders: use them as-is and never guess what they stand for.`;

  const tableText = (t, n = 40) => t ? [t.head.join(' | '), ...t.rows.slice(0, n).map(r => r.join(' | '))].join('\n') + (t.rows.length > n ? `\n… ${t.rows.length - n} more` : '') : '';
  function buildContext(q, priv) {
    const L = [], p = priv || {}, redacting = p.mode === 'redact', qq = q.toLowerCase();
    const site = findSite(qq);
    L.push(`Now: ${new Date().toString()}`);
    L.push(`Data mode: ${D.MODE}. Sources: ${D.SOURCES.map(s => `${s.name}=${s.state}`).join(', ')}`);
    const local = answerFor(q);
    L.push('', `LOCAL QUICK ANSWER (computed from the same data): ${local.text}`); if (local.table) L.push(tableText(local.table));
    L.push('', 'SITES (code | name | kind | status | health | open tickets | SLA breached | racks | devices | deployments)');
    for (const s of D.SITES) L.push([s.id, s.name, s.kind, s.status, s.health, s.openTickets, s.breached || 0, s.racks ?? '', s.devices ?? '', (s.deployments || []).length].join(' | '));
    if (D.PROJECTS?.length) {
      L.push('', 'PROJECTS (key | title | status | planned start → end | deployments)');
      for (const x of D.PROJECTS) L.push([x.key, x.title, x.status, `${fmtDate(x.start)} → ${fmtDate(x.end)}`, x.deployments.map(d => d.key).join(' ')].join(' | '));
    }
    if (D.DEPLOYMENTS?.length) {
      L.push('', 'DEPLOYMENTS (key | title | sites | GPUs | status | health | done | planned start → end | owner | project | workstreams)');
      for (const d of D.DEPLOYMENTS) L.push([d.key, d.title, d.sites.join(' '), d.gpus ? `${d.gpus}x${d.gpuModel}` : '', depStatus(d), d.health, pct(d.progress),
        `${fmtDate(d.start)} → ${fmtDate(d.end)}`, d.assigneeName, d.project?.key || '', d.workstreams.map(w => `${w.key} ${w.summary} [${w.status}] ${w.done}/${w.total}`).join('; ')].join(' | '));
    }
    // Tickets: the site asked about, else words from the question, else the most urgent.
    const words = qq.split(/[^a-z0-9-]+/).filter(w => w.length >= 4);
    let ts = site ? D.TICKETS.filter(t => t.site === site.id) : D.TICKETS.filter(t => words.some(w => `${t.summary} ${t.device} ${t.status}`.toLowerCase().includes(w)));
    if (ts.length < 10) ts = [...ts, ...[...D.TICKETS].sort(byUrgency).slice(0, 60)];
    ts = [...new Map(ts.map(t => [t.key, t])).values()].sort(byUrgency).slice(0, 120);
    L.push('', `OPEN DC TICKETS (${ts.length} of ${D.TICKETS.length}; key | summary | site | device | status | priority | SLA | assignee)`);
    for (const t of ts) L.push([t.key, t.summary, t.site || '', t.device, t.status, t.priority, slaText(t), t.assigneeName].join(' | '));
    const low = []; D.SITES.forEach(s => s.inventory.forEach(i => { if (invStatus(i) !== 'good') low.push([s.id, partLabel(D.partById(i.part)), i.stock, i.alert].join(' | ')); }));
    if (low.length) L.push('', 'LOW SPARES (site | part | on hand | alert at)', ...low.slice(0, 60));
    if (D.MOVES?.length) L.push('', 'NETSUITE MATERIAL MOVEMENTS (date | doc | type | deployment | site | status | tracking)',
      ...D.MOVES.slice(0, 40).map(m => [m.date, m.doc, m.type, m.deployment, m.site || '', m.status, m.tracking].join(' | ')));
    if (redacting && p.messages) L.push('', 'SLACK / GMAIL: withheld by privacy settings.');
    else {
      if (D.MENTIONS?.length) L.push('', 'SLACK MENTIONS (when | channel | from | text)', ...D.MENTIONS.slice(0, 25).map(m => [new Date(m.at).toLocaleString(), m.isDm ? 'DM' : '#' + m.channel, m.user, m.text].join(' | ')));
      if (D.MAIL?.entries?.length) L.push('', `UNREAD EMAIL (${D.MAIL.unread}; when | from | subject)`, ...D.MAIL.entries.map(e => [new Date(e.at).toLocaleString(), e.from, e.title].join(' | ')));
    }
    if (redacting && p.calendar) L.push('', 'CALENDAR: withheld by privacy settings.');
    else if (D.EVENTS?.length) L.push('', 'CALENDAR (when | title | linked)', ...D.EVENTS.slice(0, 20).map(e => [new Date(e.at).toLocaleString(), e.title, e.deployment || e.site || ''].join(' | ')));
    return L.join('\n').slice(0, 150000);
  }
  function redactorFor(priv) {
    const people = [...D.PEOPLE.map(x => x.name), ...(D.DEPLOYMENTS || []).map(d => d.assigneeName), ...(D.TICKETS || []).map(t => t.assigneeName),
      ...(D.MENTIONS || []).map(m => m.user), ...(D.MAIL?.entries || []).map(e => e.from), D.ME?.name].filter(n => n && !/^(you|unassigned)$/i.test(n));
    return LambdaAI.makeRedactor(priv, { people, serials: D.DEVICES.map(d => d.serial).filter(Boolean), hosts: D.DEVICES.map(d => d.id) });
  }

  // Minimal Markdown → HTML, then turn keys and site codes into dashboard links.
  function md(text) {
    const blocks = String(text).split(/```/);
    return blocks.map((b, i) => i % 2 ? `<pre class="aicode">${esc(b.replace(/^\w*\n/, ''))}</pre>` : mdBlock(b)).join('');
  }
  function mdBlock(src) {
    const lines = src.split('\n'), out = [];
    let list = null, table = null;
    const inline = s => linkify(esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'));
    const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map(x => `<li>${x}</li>`).join('')}</${list.tag}>`); list = null; }
      if (table) { out.push(`<table>${table.map((r, i) => `<tr>${r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table>`); table = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(l)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; (table ||= []).push(l.trim().slice(1, -1).split('|').map(c => c.trim())); continue; }
      const li = l.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
      if (li) { const tag = li[1] ? 'ol' : 'ul'; if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; } list.items.push(inline(li[2])); continue; }
      flush();
      const h = l.match(/^#{1,4}\s+(.*)$/);
      if (h) out.push(`<div class="aih">${inline(h[1])}</div>`); else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    }
    flush();
    return out.join('');
  }
  function linkify(html) {
    return html.replace(/\b([A-Z][A-Z0-9_]+-\d+)\b/g, k => D.ticketByKey(k) ? `<a class="linkish" data-ticket="${k}">${k}</a>`
      : D.deploymentByKey?.(k) ? `<a class="linkish" data-dep="${k}">${k}</a>` : D.projectByKey?.(k) ? `<a class="linkish" data-proj="${k}">${k}</a>` : k)
      .replace(/\b([A-Z]{3}\d{2}[A-Z0-9]*)\b/g, c => D.siteById(c) ? `<a class="linkish" data-site="${c}">${c}</a>` : c);
  }

  // ⌘K "Ask" and the brief's "Summarize" open the AI panel.
  function askAI(q) { closePalette(); AIPanel.ask(String(q).replace(/^\?\s*/, '')); }

  /* ---------------- AI panel (✨ Ask AI · ⌘J): a chat grounded in the dashboard's data ---------------- */
  const AIPanel = (() => {
    const box = $('#aiPanel'), msgs = $('#aipMsgs'), ta = $('#aipText'), sendBtn = $('#aipSend');
    const SUGGEST = ['What needs my attention today?', 'Which deployments are at risk, and why?', 'Where are we low on spares?',
      'Which tickets are waiting on parts we already have?', 'Summarize the busiest site'];
    let turns = [], R = null, busy = false, ctrl = null;
    const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
    function head() {
      const st = aiState();
      $('#aipStatus').innerHTML = st.ok ? `${esc(st.label)} · ${esc(st.model)}${SET?.privacy?.mode === 'redact' ? ' · private values masked' : SET?.privacy?.mode === 'off' ? ' · masking off' : ''}`
        : `<span class="st-warning">${esc(st.why)}</span>`;
    }
    function empty() {
      const st = aiState();
      msgs.innerHTML = `<div class="aip-hello"><div class="brand-mark">λ</div><h3>Ask about anything on this dashboard</h3>
        <p class="muted small">Sites, tickets, deployments, spares, shipments, meetings. Answers link straight to what they mention.</p>
        ${st.ok ? '' : `<p class="note small">${esc(st.why)}${isExt ? ' Until then, answers come from local data only.' : ''}</p>${isExt ? '<button class="btn primary" data-aip-setup>Set up AI</button>' : ''}`}
        <div class="aip-suggest">${SUGGEST.map(s => `<button class="chip" data-aip-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    }
    function open(prefill) {
      box.hidden = false; head();
      if (!turns.length) empty();
      if (prefill != null) ta.value = prefill;
      setTimeout(() => ta.focus(), 0);
    }
    const close = () => { box.hidden = true; };
    const bubble = (role, html) => { msgs.querySelector('.aip-hello')?.remove(); const d = document.createElement('div'); d.className = `aip-msg ${role}`; d.innerHTML = html; msgs.appendChild(d); scroll(); return d; };
    function busyUI(on) { busy = on; sendBtn.textContent = on ? 'Stop' : 'Ask'; sendBtn.classList.toggle('stop', on); }

    async function ask(q) {
      q = String(q || '').trim(); if (!q) return;
      if (box.hidden) open();
      if (busy) return;
      head();
      ta.value = '';
      bubble('user', esc(q));
      const st = aiState();
      if (!st.ok) { // no provider: answer from local data
        const a = answerFor(q);
        const t = a.table && a.table.rows.length ? `<table><tr>${a.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${a.table.rows.slice(0, 12).map(r => `<tr>${r.map(c => `<td>${linkify(esc(c))}</td>`).join('')}</tr>`).join('')}</table>` : '';
        bubble('assistant', `<div class="ai-text">${md(a.text)}${t}</div><div class="aip-meta muted small">Local answer · ${esc(st.why)}</div>`);
        turns.push({ q, raw: a.text, local: true });
        return;
      }
      R ||= redactorFor(SET.privacy); // one redactor per conversation keeps placeholders consistent across follow-ups
      const userMsg = R.redact(`QUESTION: ${q}\n\nDATA:\n${buildContext(q, SET.privacy)}`);
      const history = turns.filter(t => !t.local).flatMap(t => [{ role: 'user', content: R.redact(`QUESTION: ${t.q}`) }, { role: 'assistant', content: t.raw }]);
      const el = bubble('assistant', `<div class="ai-text"><span class="caret"></span></div><div class="aip-meta muted small"><span>Thinking…</span></div>`);
      const text = el.querySelector('.ai-text'), meta = el.querySelector('.aip-meta span');
      ctrl = new AbortController(); busyUI(true);
      let raw = '', t0 = performance.now();
      try {
        for await (const c of LambdaAI.stream(SET.ai, { system: AI_SYSTEM, user: userMsg, history, signal: ctrl.signal })) {
          if (c.text) { raw += c.text; meta.textContent = 'Writing…'; text.innerHTML = md(R.restore(raw)) + '<span class="caret"></span>'; scroll(); }
          if (c.refusal) raw += `\n\n${c.refusal}`;
          if (c.note) meta.textContent = c.note;
        }
        text.innerHTML = md(R.restore(raw)) || '<p class="muted">(no answer)</p>';
        meta.textContent = `${st.label} · ${((performance.now() - t0) / 1000).toFixed(1)}s${SET.privacy.mode === 'redact' ? ` · ${R.count()} private values masked` : ''}`;
      } catch (e) {
        if (ctrl.signal.aborted) { text.innerHTML = (raw ? md(R.restore(raw)) : '') + '<p class="muted small">Stopped.</p>'; meta.textContent = ''; }
        else { text.innerHTML = `<p class="st-critical">${esc(e.message)}</p>`; meta.textContent = ''; }
      } finally { busyUI(false); }
      const sent = `SYSTEM PROMPT\n${AI_SYSTEM}\n\n${history.length ? `—— EARLIER TURNS (${history.length / 2}) ——\n${history.map(h => `[${h.role}] ${h.content}`).join('\n\n')}\n\n` : ''}—— THIS MESSAGE (exactly as sent${SET.privacy.mode === 'redact' ? `; masked so far: ${R.summary() || 'none'}` : ''}) ——\n${userMsg}`;
      el.insertAdjacentHTML('beforeend', `<div class="aip-tools"><button class="chip" data-aip-sent>What was sent</button><button class="chip" data-aip-copy>Copy</button></div><pre class="ai-sent" hidden></pre>`);
      el.querySelector('.ai-sent').textContent = sent;
      el.querySelector('[data-aip-copy]').onclick = () => navigator.clipboard?.writeText(R.restore(raw)).then(() => toast('Copied.'));
      el.querySelector('[data-aip-sent]').onclick = () => { const p = el.querySelector('.ai-sent'); p.hidden = !p.hidden; };
      if (raw) turns.push({ q, raw });
      scroll();
    }
    $('#aipForm').addEventListener('submit', e => { e.preventDefault(); if (busy) { ctrl?.abort(); return; } ask(ta.value); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aipForm').requestSubmit(); } });
    box.addEventListener('click', e => {
      const q = e.target.closest('[data-aip-q]'); if (q) return ask(q.dataset.aipQ);
      if (e.target.closest('[data-aip-close]')) return close();
      if (e.target.closest('[data-aip-new]')) { ctrl?.abort(); turns = []; R = null; empty(); head(); return; }
      if (e.target.closest('[data-aip-setup]')) return chrome.runtime.openOptionsPage();
    });
    $('#aiBtn').addEventListener('click', () => (box.hidden ? open() : close()));
    return { open, close, ask, toggle: () => (box.hidden ? open() : close()), isOpen: () => !box.hidden };
  })();
  window.__lambdaOS.setAISettings = s => { SET = s; }; // preview/testing hook

  /* ---------------- Go anywhere: every system one jump away ---------------- */
  function apps() {
    const s = SET || LambdaLive.DEFAULTS, L = D.LINKS || {};
    const jira = L.jira || s.jiraUrl, nb = L.netbox || s.netboxUrl, ns = L.netsuite || s.netsuiteUrl;
    const jql = x => `${jira}/issues/?jql=${encodeURIComponent(String(x).replace(/\s+ORDER\s+BY[\s\S]*$/i, ''))}`;
    return [
      ['Jira', 'DC queue: open tickets', jql(s.fleetJql)], ['Jira', 'My tickets', jql(s.mineJql)], ['Jira', 'Projects & deployments (PMO)', jql(s.portfolioJql)],
      ['Jira', 'Cluster intake', jql(s.intakeJql)], ['NetBox', 'Sites', `${nb}/dcim/sites/`], ['NetBox', 'Devices', `${nb}/dcim/devices/`],
      ['NetBox', 'Spares (consumables)', `${nb}/plugins/inventory-consumables/consumables/`], ['NetBox', 'Change log', `${nb}/core/changelog/`],
      ['NetSuite', 'Home', `${ns}/app/center/card.nl`], ['NetSuite', 'Material on hand', `${ns}/app/common/search/searchresults.nl?searchid=${s.nsOnHandSearch}`],
      ['NetSuite', 'Material transactions', `${ns}/app/common/search/searchresults.nl?searchid=${s.nsMovesSearch}`],
      ['Slack', 'Open Slack', L.slack || 'https://app.slack.com/client'], ['Gmail', 'Inbox', 'https://mail.google.com/'], ['Calendar', 'Google Calendar', 'https://calendar.google.com/'],
      ...(L.atium || s.atiumUrl ? [['Atium', 'Build portfolio', `${L.atium || s.atiumUrl}/builds`], ['Atium', 'Home', `${L.atium || s.atiumUrl}/`]] : []),
      ...(D.GRAFANA ? [['Grafana', 'DC Ops Status', D.GRAFANA.links.dcOps], ['Grafana', 'Rack health floor plan', D.GRAFANA.links.rackHealth], ['Grafana', 'PDU power & environmental', D.GRAFANA.links.pdu],
        ['Grafana', 'GPU thermal & throttling', D.GRAFANA.links.gpuThermal], ['Grafana', 'Repair priority', D.GRAFANA.links.repair], ['Grafana', 'DC alerts', D.GRAFANA.links.dcAlerts], ['Grafana', 'All dashboards', `${D.GRAFANA.base}/dashboards`]].filter(x => x[2]) : []),
      ['Lambda OS', 'Settings', '#settings'],
      ['Lambda OS', `Help, ideas, bugs: message ${LambdaUpdates.HELP.name} on Slack`, LambdaUpdates.HELP.slack],
    ];
  }
  const goRow = ([sys, what, url]) => ({ group: 'Go to', icon: '↗', color: C.accent, title: `${sys} · ${what}`, sub: url.startsWith('#') ? 'Appearance, AI, privacy, sources' : url.replace(/^https?:\/\//, '').slice(0, 70),
    run: () => { closePalette(); url === '#settings' ? (isExt ? chrome.runtime.openOptionsPage() : toast('Settings open inside the extension.')) : window.open(url, '_blank', 'noopener'); } });

  /* ---------------- Daily brief ---------------- */
  let HISTORY = null;
  const historyReady = isExt ? chrome.storage.local.get('history').then(r => { HISTORY = r.history || null; }).catch(() => {}) : Promise.resolve();
  const briefBox = $('#brief');
  const signed = (v, unit = '') => v == null ? '' : v > 0 ? `<span class="up-bad">+${v}${unit}</span>` : v < 0 ? `<span class="up-good">${v}${unit}</span>` : `<span class="muted">±0${unit}</span>`;
  // Empty-section text when the section's source isn't connected (stale sources still have data to show).
  const notConnected = key => { const x = D.SOURCES.find(s => s.key === key); return x && x.state === 'error' ? `${x.name} isn't connected, so this can't be shown.` : ''; };
  function openBrief() {
    const b = LambdaAlerts.brief(D, HISTORY), first = (D.ME.name || '').split(' ')[0];
    const hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const sec = (title, n, html, empty) => `<section class="bsec"><div class="section-title"><span>${title}</span><span>${n ?? ''}</span></div>${html || `<p class="muted small">${empty}</p>`}</section>`;
    const stat = (v, l, st) => `<div class="bstat ${st || ''}"><b>${v}</b><span>${l}</span></div>`;
    const evRow = e => `<div class="mini-ticket" data-href="${esc(e.link)}"><span class="qkey">${e.allDay ? 'All day' : new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span class="qsum">${esc(e.title)}</span>${e.deployment ? `<button class="tagchip" data-dep="${e.deployment}">${esc(D.deploymentByKey(e.deployment)?.site || e.deployment)}</button>` : ''}</div>`;
    const depLine = ({ d, delta, was }) => `<div class="mini-ticket" data-dep="${d.key}"><span class="qkey">${d.key}</span><span class="qsum">${esc(d.title)}</span>
      <span class="small">${progressBar(d.progress, d.health)} ${pct(d.progress)} ${delta != null ? signed(Math.round(delta * 100), '%') : ''}</span>${statusChip(d.health, `${was ? `${esc(was)} → ` : ''}${depStatus(d)}`)}</div>`;
    const ai = aiState();
    briefBox.querySelector('.brief').innerHTML = `
      <div class="brief-head"><div><div class="code">DAILY BRIEF · ${b.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h2>${hi}${first ? `, ${esc(first)}` : ''}</h2><p class="muted small">${b.prevDate ? `Changes are compared with ${new Date(b.prevDate + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}.` : 'Changes since yesterday appear from tomorrow, once Lambda OS has a day of history.'}</p></div>
        <button class="x" data-close-brief aria-label="Close">✕</button></div>
      ${b.troubled.length ? `<div class="bwarn"><b>⚠ Some data isn't up to date</b>${b.troubled.map(x => `<div class="bwarn-row"><span><b>${esc(x.name)}</b> ${esc(x.label)}${x.sinceText ? ` since ${esc(x.sinceText)}` : ''}${x.staleText ? ` · showing data from ${esc(x.staleText)}` : ' · no data from it'}</span>${x.url ? `<button class="btn" data-href="${esc(x.url)}">Sign in</button>` : x.access ? '<span class="muted small">Use its yellow pill in the top bar</span>' : ''}</div>`).join('')}
        <p class="muted small">Anything below that comes from ${b.troubled.length > 1 ? 'these sources' : 'it'} may be out of date.</p></div>` : ''}
      <div class="bstats">${stat(b.meetings.length, 'meetings today')}${stat(b.myBreached.length, 'your tickets breached', b.myBreached.length ? 'bad' : '')}${stat(b.myDue.length, 'due today', b.myDue.length ? 'warn' : '')}
        ${stat(b.tracked.length, 'tracked deployments')}${stat(b.partsArrived.length, 'parts arrived', b.partsArrived.length ? 'good' : '')}${b.unread != null ? stat(b.unread, 'unread emails') : ''}</div>
      <div class="bgrid">
        ${sec('Today’s meetings', b.meetings.length, b.meetings.map(evRow).join(''), notConnected('calendar') || 'No meetings today.')}
        ${sec('Your tickets needing action', b.myBreached.length + b.myDue.length, [...b.myBreached, ...b.myDue].slice(0, 10).map(ticketRow).join(''), b.myTotal ? 'Nothing breached or due today.' : 'No tickets assigned to, reported or watched by you.')}
        ${sec('Tracked deployments', b.tracked.length, b.tracked.map(depLine).join(''), 'Star ☆ deployments to follow them here.')}
        ${sec('Parts arrived for your tickets', b.partsArrived.length, b.partsArrived.map(t => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum">${esc(D.partById(t.part)?.name || t.part)} on hand at ${esc(t.site)}</span></div>`).join(''), 'Nothing new on hand.')}
        ${sec(`New tickets${b.mySites.length ? ' at your sites' : ''}`, b.newTickets.length, b.newTickets.slice(0, 8).map(ticketRow).join('') + (b.newTickets.length > 8 ? `<p class="muted small">+${b.newTickets.length - 8} more</p>` : ''), 'No new tickets.')}
        ${sec('Low spares at your sites', b.lowSpares.length, b.lowSpares.slice(0, 8).map(x => `<div class="mini-ticket" data-site="${esc(x.site)}"><span class="qkey">${esc(x.site)}</span><span class="qsum">${esc(x.part)}</span><span class="small st-${x.stock === 0 ? 'critical' : 'warning'}">${x.stock} / alert ${x.alert}</span></div>`).join(''), 'Spares look fine.')}
        ${b.hardware?.length ? sec('Critical hardware alerts · Grafana', b.hardware.reduce((t, x) => t + x.n, 0), b.hardware.map(x => `<div class="mini-ticket" data-href="${esc(x.url)}"><span class="qkey">${esc(x.site)}</span><span class="qsum">${esc(x.name)}</span><span class="small st-critical">${x.n}×</span></div>`).join('')) : ''}
        ${(D.VOLUNTEER || []).some(v => v.at > Date.now() - 7 * 864e5) ? sec('Volunteer requests (7 days)', D.VOLUNTEER.filter(v => v.at > Date.now() - 7 * 864e5).length, D.VOLUNTEER.filter(v => v.at > Date.now() - 7 * 864e5).map(v => `<div class="mini-ticket" data-vol="${esc(v.site)}"><span class="qkey">${esc(v.site)}</span><span class="qsum">${esc(v.text.slice(0, 120))}${v.text.length > 120 ? '…' : ''}</span><span class="small muted">${esc(v.user)}</span></div>`).join('')) : ''}
        ${b.atium.on ? sec('Builds & purchase orders · Atium', b.atium.builds.length + b.atium.late.length + b.atium.dueSoon.length,
          b.atium.builds.map(buildRow).join('')
          + [...b.atium.late, ...b.atium.dueSoon].slice(0, 8).map(x => `<div class="mini-ticket" data-href="${esc(x.url)}"><span class="qkey">${esc(x.site)}</span><span class="qsum">${esc(x.p.name)} · ${esc(x.p.supplier || '')}</span>${statusChip(x.st.state === 'late' ? 'warning' : 'idle', `${x.st.state === 'late' ? 'was due' : 'due'} ${fmtDate(x.st.dueAt)}`)}</div>`).join('')
          + (b.atium.stale ? `<p class="muted small">${b.atium.stale} purchase order${b.atium.stale > 1 ? 's' : ''} at your sites more than 30 days past due (probably not updated in Atium).</p>` : ''),
          notConnected('atium') || 'No late milestones, hand-offs in the next 2 weeks, or late purchase orders at your sites.') : ''}
        ${sec('Fleet', '', `<div class="mini-ticket"><span class="qsum">Open DC tickets</span><b>${b.fleet.open.toLocaleString()}</b> ${b.fleet.openWas != null ? signed(b.fleet.open - b.fleet.openWas) : ''}</div>
          <div class="mini-ticket"><span class="qsum">SLA breached</span><b>${b.fleet.breached.toLocaleString()}</b> ${b.fleet.breachedWas != null ? signed(b.fleet.breached - b.fleet.breachedWas) : ''}</div>`)}
        ${sec('Slack mentions (24h)', b.mentions.length, b.mentions.slice(0, 5).map(m => `<div class="mini-ticket" data-href="${esc(m.link)}"><span class="qkey">${m.isDm ? 'DM' : '#' + esc(m.channel)}</span><span class="qsum">${esc(m.user)}: ${esc(m.text)}</span></div>`).join(''), notConnected('slack') || 'No new mentions.')}
      </div>
      <div class="links">${ai.ok ? `<button class="btn primary" data-brief-ai>✨ Summarize with ${esc(ai.label)}</button>` : ''}<button class="btn" data-brief-settings>Alert & brief settings</button></div>`;
    briefBox.hidden = false;
    try { localStorage.setItem('lambdaos-brief-seen', LambdaAlerts.dayKey(Date.now())); } catch { /* ignore */ }
  }
  const closeBrief = () => { briefBox.hidden = true; if (location.hash === '#brief') history.replaceState(null, '', location.pathname); };
  briefBox.addEventListener('click', e => {
    if (e.target === briefBox || e.target.closest('[data-close-brief]')) return closeBrief();
    if (e.target.closest('[data-brief-settings]')) return isExt ? chrome.runtime.openOptionsPage() : toast('Settings open inside the extension.');
    if (e.target.closest('[data-brief-ai]')) {
      closeBrief(); openPalette();
      return askAI('Write my daily brief for today as a short prioritized list: what needs my attention first, then the rest. Cover my breached and due tickets, tracked deployments and what changed, today’s meetings, parts that arrived, and anything risky at my sites.');
    }
    if (e.target.closest('[data-ticket],[data-dep],[data-site],[data-proj],[data-href]')) closeBrief(); // the page-wide handler then opens it
  });
  $('#briefBtn').addEventListener('click', () => historyReady.then(openBrief));

  // Deep links from notifications and other tabs: #brief, #dep=PMO-1, #ticket=DC-1, #site=CMH01
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    if (h === 'brief') return historyReady.then(openBrief);
    const [k, v] = h.split('=');
    if (k === 'view' && ['globe', 'graph', 'deploys'].includes(v)) return setView(v);
    if (k === 'dep' && D.deploymentByKey?.(v)) openEntity('deployment', D.deploymentByKey(v));
    if (k === 'ticket' && D.ticketByKey(v)) openEntity('ticket', D.ticketByKey(v));
    if (k === 'site' && D.siteById(v)) { setView('globe'); SiteCard.open(D.siteById(v)); }
  }
  window.addEventListener('hashchange', route);
  setTimeout(route, 0);
  // Auto-open once a day, on the first new tab after the brief time.
  if (isExt && !location.hash) LambdaLive.settings().then(async s => {
    let seen = ''; try { seen = localStorage.getItem('lambdaos-brief-seen') || ''; } catch { /* ignore */ }
    if (D.MODE === 'live' && s.brief.autoOpen && LambdaAlerts.briefDue(s.brief) && seen !== LambdaAlerts.dayKey(Date.now())) { await historyReady; openBrief(); }
  }).catch(() => {});

  /* ---------------- Alert center (🔔): every alert, even when the OS hides pop-ups ---------------- */
  const bellBtn = $('#bellBtn'), alertPop = $('#alertPop');
  let ALERTS = [];
  const loadAlerts = async () => {
    if (isExt) ALERTS = (await chrome.storage.local.get('alertLog')).alertLog || [];
    else if (!ALERTS.length) { // demo: what the alert engine would raise from this data
      const cfg = { ...LambdaLive.DEFAULTS.alerts }, st = LambdaAlerts.evaluate(D, null, cfg).state;
      st.sla = {}; st.assigned = []; st.parts = [];
      ALERTS = LambdaAlerts.evaluate(D, st, cfg).notes.slice(0, 6).map((n, i) => ({ ...n, at: Date.now() - i * 17 * 60000, read: i > 2 }));
    }
    paintBell();
  };
  function paintBell() {
    const unread = ALERTS.filter(a => !a.read).length;
    $('#bellCount').textContent = unread ? (unread > 9 ? '9+' : unread) : '';
    bellBtn.classList.toggle('has', !!unread);
    bellBtn.title = unread ? `${unread} new alert${unread > 1 ? 's' : ''}` : 'Alerts';
    if (alertPop.hidden) return;
    alertPop.innerHTML = `<div class="apop-head"><b>Alerts</b><span><button class="chip" data-al-read>Mark all read</button><button class="chip" data-al-settings>Settings</button></span></div>
      ${ALERTS.length ? ALERTS.slice(0, 30).map((a, i) => `<div class="aitem ${a.read ? '' : 'unread'} ${a.urgent ? 'urgent' : ''}" data-al-i="${i}">
          <span class="adot"></span><div style="min-width:0"><div class="atitle">${esc(a.title)}</div><div class="amsg">${esc(a.message)}</div></div><span class="ftime">${rel(a.at)}</span></div>`).join('')
        : '<p class="muted small" style="padding:10px 12px">No alerts yet. They appear here after background checks (every 10 minutes); the first check only takes a baseline.</p>'}`;
  }
  const saveAlerts = () => { if (isExt) chrome.storage.local.set({ alertLog: ALERTS }); };
  bellBtn.addEventListener('click', e => { e.stopPropagation(); alertPop.hidden = !alertPop.hidden; paintBell(); });
  alertPop.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target.closest('[data-al-read]')) { ALERTS = ALERTS.map(a => ({ ...a, read: true })); saveAlerts(); return paintBell(); }
    if (e.target.closest('[data-al-settings]')) return isExt ? chrome.runtime.openOptionsPage() : toast('Settings open inside the extension.');
    const it = e.target.closest('[data-al-i]'); if (!it) return;
    const a = ALERTS[+it.dataset.alI]; a.read = true; saveAlerts(); alertPop.hidden = true; paintBell();
    if (!a.url) return;
    const hash = a.url.includes('newtab.html#') ? a.url.split('#')[1] : null;
    if (hash) { location.hash = hash; route(); } else window.open(a.url, '_blank', 'noopener');
  });
  document.addEventListener('click', () => { if (!alertPop.hidden) { alertPop.hidden = true; } });
  if (isExt) chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.alertLog) { ALERTS = ch.alertLog.newValue || []; paintBell(); } });
  loadAlerts();

  /* ---------------- Keyboard ---------------- */
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); closePalette(); AIPanel.toggle(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
    if (e.key === 'Escape') { if (AIPanel.isOpen() && document.activeElement?.id !== 'aipText' && pal.hidden) AIPanel.close(); else if (!alertPop.hidden) alertPop.hidden = true; else if (!briefBox.hidden) closeBrief(); else if (!pal.hidden) closePalette(); else if (!$('#drawer').hidden) Drawer.close(); else if (!$('#siteCard').hidden) SiteCard.close(); else if (document.body.classList.contains('stage-max')) setStageMax(false); return; }
    if (e.key === '/' && pal.hidden && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
    if (pal.hidden && !e.metaKey && !e.ctrlKey && document.activeElement === document.body) {
      if (e.key === 'g' || e.key === 'b') setView('graph'); if (e.key === 'f') setView('globe'); if (e.key === 'd') setView('deploys'); if (e.key === 'h') setView('health');
      if (e.key === 'e') setStageMax(!document.body.classList.contains('stage-max'));
    }
  });
}).catch(err => {
  console.error(err);
  const b = $('#bootMsg');
  if (b) {
    b.textContent = `Something went wrong loading Lambda OS: ${err.message}. `;
    const a = Object.assign(document.createElement('a'), { href: LambdaUpdates.HELP.slack, target: '_blank', rel: 'noopener', textContent: `Message ${LambdaUpdates.HELP.name} on Slack` });
    b.append(a);
  }
});
