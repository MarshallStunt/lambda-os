// Lambda OS — new-tab dashboard. Pure canvas/DOM, no libraries (MV3 pages can't load remote code).
// Waits for data.js (live NetBox + Jira snapshot, or demo data), then draws everything from it.
const $ = s => document.querySelector(s);

LambdaData.ready.then(D => {
  $('#boot')?.remove();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = 3600e3;
  const ALLT = () => (D.ALL || D).TICKETS;
  // An app still loading (first load, or one just switched on): panels say "Loading … from X" instead of "nothing".
  const srcOf = key => D.SOURCES.find(x => x.key === key);
  const isLoading = (...keys) => (D.MODE === 'live' || location.hash === '#loading') && keys.some(k => srcOf(k)?.state === 'wait');
  const loadingLine = (key, what, tag = 'li') => `<${tag} class="src-note loading"><span class="spin-dot"></span>Loading ${esc(what)} from ${esc(srcOf(key)?.name || key)}…</${tag}>`;
  /* "All sites / Your sites" switch in Fleet, Second brain, Deployments and Health. Each view follows the top-bar picker
     until you pick here; then "All sites" really means every site (whatever the picker), "Your sites" means yours, and
     "📍 Picked" goes back to following the picker. Picking at the top resets the views to follow it again. */
  const MINE = new Set((D.ALL || D).yourSites ? (D.ALL || D).yourSites() : []);
  const VS = k => { try { const v = localStorage.getItem('lambdaos-vs-' + k); return v === 'all' || (v === 'mine' && MINE.size) ? v : 'top'; } catch { return 'top'; } };
  const setVS = (k, v) => { try { v === 'top' ? localStorage.removeItem('lambdaos-vs-' + k) : localStorage.setItem('lambdaos-vs-' + k, v); } catch { /* per-viewer convenience */ } };
  const vsEff = v => v !== 'top' ? v : !D.SCOPE ? 'all' : D.SCOPE_CHOICE === 'mine' ? 'mine' : 'picked';
  const vsData = v => v === 'top' ? D : (D.ALL || D);                       // whose lists the view draws
  const vsSet = v => v === 'top' ? D.SCOPE : v === 'mine' ? MINE : null;      // null: every site
  const vsHas = v => { const set = vsSet(v); return id => !set || set.has(id); };
  const scopeSeg = (k, cur) => {
    const eff = vsEff(cur), picked = D.SCOPE && D.SCOPE_CHOICE !== 'mine';
    const opts = [['all', 'All sites', 'Every site, whatever the picker at the top shows'], ...(MINE.size ? [['mine', 'Your sites', 'Your sites: ' + [...MINE].join(', ')]] : []),
      ...(picked ? [['picked', `📍 Picked (${D.SCOPE.size})`, 'The sites picked at the top: ' + [...D.SCOPE].join(', ')]] : [])];
    return opts.length > 1 ? `<span class="seg">${opts.map(([v, l, t]) => `<button class="chip ${eff === v ? 'on' : ''}" data-vscope="${k}:${v === 'picked' ? 'top' : v}" aria-pressed="${eff === v}" title="${esc(t)}">${l}</button>`).join('')}</span>` : '';
  };
  // Yard Central (read-only): a host's state, pool, lock and Starbase, plus a link to it in Yard.
  const srcState = k => D.SOURCES.find(s => s.key === k)?.state;
  const yardUsable = () => D.MODE !== 'live' || !['na', 'off'].includes(srcState('yard')); // no Yard account / turned off: no Yard line or button
  const yardOf = host => host ? D.YARD?.hosts?.[String(host).toLowerCase()] || null : null;
  const yardUrl = host => host && D.YARD?.base && yardUsable() ? `${D.YARD.base}/search?q=${encodeURIComponent(host)}` : '';
  const meLock = y => !!(y?.lockedBy && LambdaAlerts.isMe(D, y.lockedBy));
  const isMineT = t => !!(t && (t.mine || t.assignee === 'me'));
  const yardWhy = y => [y.state, y.pool && 'pool ' + y.pool, y.lockedBy && (meLock(y) ? 'locked by you' : 'locked by ' + y.lockedBy), y.starbase && 'in Starbase', y.region && String(y.region).toUpperCase()].filter(Boolean).join(' · ');
  // Hosts shown in lists that the refresh hasn't looked up yet are asked for on demand (a batch at a time, through the
  // pinned Yard tab), and their slot is filled in when Yard answers. Only live, only if Yard is on and reachable for you.
  const YardQ = (() => {
    const want = new Set(), tried = new Set(); let timer = null, busy = false, off = false;
    const live = () => isExt && D.MODE === 'live' && !off && !!D.YARD && typeof LambdaLive !== 'undefined' && !!LambdaLive.yardLookup && yardUsable();
    const fill = () => {
      document.querySelectorAll('.yard-slot[data-yh]').forEach(el => { const h = el.dataset.yh; if (!yardOf(h)) return;
        const row = el.closest('[data-ticket]'); el.outerHTML = yardChip(h, row && D.ticketByKey(row.dataset.ticket)) || ''; });
      document.querySelectorAll('[data-yb]').forEach(el => { if (yardOf(el.dataset.yb)) el.outerHTML = yardBlock(el.dataset.yb, el.dataset.ybt && D.ticketByKey(el.dataset.ybt)); });
    };
    async function flush() {
      timer = null; if (busy || !want.size || !live()) return;
      const hosts = [...want].slice(0, 40); hosts.forEach(h => { want.delete(h); tried.add(h); }); busy = true;
      try {
        const got = await LambdaLive.yardLookup(hosts);
        for (const h of hosts) D.YARD.hosts[h] = got[h] || D.YARD.hosts[h] || { found: false, at: Date.now() };
      } catch (e) {
        if (/not available|turned off/i.test(e.message)) off = true;
        for (const h of hosts) D.YARD.hosts[h] ||= { found: false, at: Date.now(), error: true };
      } finally { busy = false; fill(); if (want.size) timer = setTimeout(flush, 300); }
    }
    return { live, fill, need(h) { h = String(h).toLowerCase(); if (!live() || tried.has(h)) return; want.add(h); timer ||= setTimeout(flush, 250); } };
  })();
  // A host's Yard chip: ⚠ when it's on your ticket and still in production unlocked, 🔒 when locked (· you when it's yours).
  const yardChip = (host, t) => {
    if (!host || !D.YARD || !yardUsable()) return '';
    const y = yardOf(host);
    if (!y) { YardQ.need(host); return YardQ.live() ? `<span class="yard-slot" data-yh="${esc(String(host).toLowerCase())}"></span>` : ''; }
    if (!y.found || !y.state) return '';
    const prod = isMineT(t) && LambdaAlerts.inProduction(y), mineL = meLock(y);
    return ` <span class="yard-chip ${prod ? 'warn' : y.lockedBy ? (mineL ? 'mine' : 'locked') : ''}" title="Yard: ${esc(yardWhy(y))}${prod ? '. Still in production and not locked: lock or drain it before hands-on work.' : ''}">${prod ? '⚠ ' : y.lockedBy ? '🔒 ' : ''}${esc(y.state)}${mineL ? ' · you' : ''}</span>`;
  };
  // What to do about it, on your own tickets (and on a host you've locked with no ticket of yours on it).
  const yardAdvice = (host, y, t) => {
    if (!y?.found) return '';
    const mineTs = ALLT().filter(x => isMineT(x) && String(x.device || '').toLowerCase() === String(host).toLowerCase());
    if ((t ? isMineT(t) : mineTs.length) && LambdaAlerts.inProduction(y)) return `<div class="yard-warn">⚠ Still in production (${esc(y.state)}) and not locked. Lock or drain it in Yard before hands-on work.</div>`;
    if ((t ? isMineT(t) : mineTs.length) && y.lockedBy && !meLock(y)) return `<div class="yard-warn">🔒 Locked by <b>${esc(y.lockedBy)}</b>. Check with them before working on it.</div>`;
    if (meLock(y) && !mineTs.length) return `<div class="yard-warn">🔒 You still hold this lock, but none of your open tickets is on this host. Unlock it in Yard so it can go back to its pool.</div>`;
    return '';
  };
  const yardBlock = (host, t) => {
    if (!host || !D.YARD || !yardUsable()) return '';
    const y = yardOf(host);
    if (!y && YardQ.live()) { YardQ.need(host); return `<div class="yard-row" data-yb="${esc(String(host).toLowerCase())}" ${t ? `data-ybt="${esc(t.key)}"` : ''}><span class="yard-tag">Yard</span><span class="muted">Looking it up in Yard…</span></div>`; }
    const body = !y ? `<span class="muted">${D.YARD.live ? 'Not looked up yet (Lambda OS checks ticket hosts a batch at a time).' : 'Turn on Yard in Settings → Sources to see this host\'s state here.'}</span>`
      : y.error ? '<span class="muted">Yard didn\'t answer for this host.</span>'
      : !y.found ? '<span class="muted">Not found in Yard.</span>'
      : `<b>${esc(y.state || '—')}</b>${y.pool ? ` · pool <b>${esc(y.pool)}</b>` : ''}${y.lockedBy ? ` · 🔒 locked by <b>${meLock(y) ? 'you' : esc(y.lockedBy)}</b>` : ' · not locked'}${y.starbase ? ' · in Starbase' : ''}${y.status && y.status !== 'active' ? ` · ${esc(y.status)}` : ''}${y.region ? ` <span class="muted">(${esc(String(y.region).toUpperCase())}${y.at ? `, checked ${rel(y.at) === 'now' ? 'just now' : rel(y.at) + ' ago'}` : ''})</span>` : ''}`;
    return `<div class="yard-row"><span class="yard-tag">Yard</span><span>${body}${yardAdvice(host, y, t)}</span></div>`;
  }; // site cards, drawers and answers about a specific thing show all its tickets, whatever the picker
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

  /* ---------------- Lambda Rackside link: open a ticket with the Rackside side panel ---------------- */
  // Rackside is a separate extension. Its ID differs per install (unpacked), so it's found once by name through the
  // optional "management" permission, which is dropped again right after, then kept in storage ('peerRackside').
  const Rackside = (() => {
    let peer = '', winId;
    if (isExt) {
      chrome.storage.local.get('peerRackside').then(r => { peer = r.peerRackside || ''; }).catch(() => {});
      chrome.windows?.getCurrent().then(w => { winId = w.id; }).catch(() => {});
    }
    const send = (id, msg) => chrome.runtime.sendMessage(id, msg).catch(() => null);
    async function find() {
      if (!await chrome.permissions.request({ permissions: ['management'] }).catch(() => false)) return '';
      try {
        const all = await chrome.management.getAll();
        return all.find(x => x.type === 'extension' && x.enabled && x.id !== chrome.runtime.id && /^Lambda Rackside$/i.test(x.name))?.id || '';
      } catch { return ''; } finally { chrome.permissions.remove({ permissions: ['management'] }).catch(() => {}); }
    }
    async function open(key, url) {
      const msg = { app: 'lambda-os', type: 'rackside.open', key, windowId: winId };
      let r = peer ? await send(peer, msg) : null;          // first: panel opens in this window (needs the click)
      if (!r?.ok) {
        peer = await find();
        if (peer) { chrome.storage.local.set({ peerRackside: peer }); r = await send(peer, msg); }
        else chrome.storage.local.remove('peerRackside');
      }
      await chrome.tabs.create({ url, windowId: winId });  // then the ticket tab: the panel follows the active tab
      if (!r?.ok) toast('Lambda Rackside isn’t installed or is turned off, so the ticket opened in Jira only.');
      else if (!r.panel) toast('Opened in Jira. Click the Rackside icon in the toolbar to show its panel.');
    }
    return { open };
  })();

  /* ---------------- Top bar ---------------- */
  const badge = $('#modeBadge');
  badge.textContent = D.MODE === 'live' ? 'LIVE' : 'DEMO DATA';
  badge.classList.toggle('live', D.MODE === 'live');
  badge.title = D.MODE === 'live' ? 'Live NetBox and Jira data, using your own sign-ins' : (D.NOTE || 'Demo data. Switch to live in Settings.');
  /* Sources, and how loudly each one asks for you:
     • attention: only you can fix it (allow access, sign in), or Jira / NetBox (the core) are down → the "needs you" bar
       under the top bar (Sign in · I don't have it · Later) and a pulsing pill;
     • old: an optional app that hasn't updated for 30+ minutes for another reason → a quiet grey pill (still retried);
     • retrying: failing for under 30 minutes → just counted in the summary (Lambda OS retries it, often fixing it alone).
     An app you've never had stays quiet ("not available") and never shows in the bar. */
  if (D.MODE !== 'live' && location.hash === '#loading') { // preview of a first load with demo data
    for (const k of ['jira', 'calendar', 'grafana', 'slack', 'gmail']) { const x = D.SOURCES.find(s => s.key === k); if (x) x.state = 'wait'; }
    D.EVENTS = []; D.HEALTH = null; D.DEPLOYMENTS = []; D.TICKETS.length = 0; D.FEED.length = 0; D.MENTIONS = []; D.MAIL = null; D.VOLUNTEER = [];
    for (const k of D.KPIS || []) if (k.key !== 'devices') { k.num = 0; k.value = '0'; }
  }
  if (D.MODE !== 'live' && location.hash === '#needs') { // preview of the bar with demo data
    const f = (k, o) => Object.assign(D.SOURCES.find(s => s.key === k) || {}, o);
    f('slack', { state: 'stale', auth: true, url: 'https://app.slack.com/', since: Date.now() - 50 * 60e3, staleAt: Date.now() - 2 * 3600e3, error: 'Not signed in to Slack.' });
    f('grafana', { state: 'stale', auth: false, since: Date.now() - 45 * 60e3, staleAt: Date.now() - 70 * 60e3, error: 'Grafana: the pinned tab did not answer.' });
  }
  const failingMin = s => s.since ? (Date.now() - s.since) / 60e3 : 0;
  const broken = s => s.state === 'error' || s.state === 'stale';
  const attention = s => !!s.access || (broken(s) && (s.auth || s.core));
  const oldData = s => !attention(s) && broken(s) && failingMin(s) >= 30;
  const needsYou = s => attention(s) || oldData(s);
  const ago = t => t ? (rel(t) === 'now' ? 'just now' : `${rel(t)} ago`) : '';
  const pillLabel = s => s.access ? `${s.name} · allow` : s.auth ? `🔑 ${s.name} · sign in` : s.core ? `${s.name} · not connected`
    : s.staleAt ? `${s.name} · old data ${rel(s.staleAt)}` : `${s.name} · not updating`;
  const LATER = 'lambdaos-later', today = LambdaAlerts.dayKey(Date.now());
  const laterMap = () => { try { return JSON.parse(localStorage.getItem(LATER)) || {}; } catch { return {}; } };
  const isLater = k => laterMap()[k] === today;
  const setLater = (k, on) => { const m = laterMap(); if (on) m[k] = today; else delete m[k]; try { localStorage.setItem(LATER, JSON.stringify(m)); } catch { /* per-viewer convenience */ } };
  const ALLSRC = D.SOURCES;
  const shown = new Set(); // sources you clicked: in the bar even if they're quiet or set to Later
  const needBar = $('#needBar') || (() => { const b = Object.assign(document.createElement('div'), { id: 'needBar', className: 'needbar', hidden: true }); b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Apps that need you'); $('.statusbar').before(b); return b; })();
  const barRow = s => {
    const why = s.access ? `${s.name} needs your OK to read it` : s.auth ? `${s.name} needs you to sign in` : s.core ? `${s.name} isn't connected` : `${s.name} isn't updating`;
    const data = s.staleAt ? `showing data from ${ago(s.staleAt)}` : 'nothing loaded from it yet';
    const main = s.access ? `<button class="btn primary" data-nb="allow" data-key="${s.key}">Allow</button>`
      : s.url ? `<button class="btn primary" data-nb="signin" data-key="${s.key}">Sign in</button>`
      : `<button class="btn primary" data-nb="retry" data-key="${s.key}">Try again</button>`;
    return `<div class="nb-row"><span class="nb-icon" aria-hidden="true">${s.access ? '🔓' : s.auth ? '🔑' : '⚠'}</span>
      <span class="nb-text"><b>${esc(why)}</b> <span class="muted">· ${data}${!s.auth && !s.access && s.error ? ` · <u title="${esc(s.error)}">why?</u>` : ''}</span></span>
      <span class="nb-btns">${main}${s.core ? '' : `<button class="btn" data-nb="off" data-key="${s.key}" title="Turns ${esc(s.name)} off for you: no pill, no pinned tab, no alerts. Turn it back on in Settings → Sources.">I don't have ${esc(s.name)}</button>`}<button class="btn ghost" data-nb="later" data-key="${s.key}" title="Hide this until tomorrow">Later</button></span></div>`;
  };
  function renderSources() {
    const fine = ALLSRC.filter(s => !needsYou(s));
    const ok = fine.filter(s => s.state === 'ok'), wait = fine.filter(s => s.state === 'wait'), off = fine.filter(s => s.state === 'off'), demo = fine.filter(s => s.state === 'demo'),
      na = fine.filter(s => s.state === 'na'), retry = fine.filter(broken);
    const word = s => s.state === 'ok' ? 'live' : s.state === 'off' ? 'off (Settings)' : s.state === 'demo' ? 'demo data' : s.state === 'na' ? 'not available for your account'
      : broken(s) ? `retrying (since ${LambdaAlerts.clock(s.since || Date.now())})` : 'loading';
    const parts = [ok.length && `${ok.length} live`, demo.length && 'demo data', retry.length && `${retry.length} retrying`, wait.length && `${wait.length} loading`, off.length && `${off.length} off`, na.length && `${na.length} not available`].filter(Boolean);
    const summary = fine.length ? `<span class="source-pill ${ok.length ? 'ok' : demo.length ? 'demo' : 'wait'} sum" tabindex="0" title="${esc(fine.map(s => `${s.name}: ${word(s)}`).join('\n'))}"><i></i>${fine.length} sources · ${parts.join(' · ')}</span>` : '';
    $('#sources').innerHTML = ALLSRC.filter(needsYou).map(s => `<button class="source-pill ${s.state} ${s.access ? 'grant' : ''} ${attention(s) ? `attn ${isLater(s.key) ? '' : 'pulse'}` : 'old'}" data-key="${s.key}" title="${esc(s.title || s.error || '')}${attention(s) ? '' : ' Lambda OS keeps retrying.'} Click for options."><i></i>${esc(pillLabel(s))}</button>`).join('') + summary;
    const rows = ALLSRC.filter(s => needsYou(s) && ((attention(s) && !isLater(s.key)) || shown.has(s.key)));
    needBar.hidden = !rows.length || (D.MODE !== 'live' && location.hash !== '#needs');
    needBar.innerHTML = (rows.length > 1 ? `<div class="nb-head">${rows.length} apps need you</div>` : '') + rows.map(barRow).join('');
  }
  renderSources();
  const allowAccess = async () => {
    // Must be the first await after the click so Chrome treats it as a user gesture.
    const ok = await chrome.permissions.request({ origins: [...new Set(D.SOURCES.filter(x => x.access).flatMap(x => x.access))] });
    if (!ok) return toast('Access not granted, so those sources stay off.');
    toast('Access granted. Loading…'); updated.hidden = false; updated.textContent = 'Refreshing…';
    await LambdaLive.refresh(m => (updated.textContent = m));
    location.reload();
  };
  const checkAgain = async () => { updated.hidden = false; updated.textContent = 'Checking…'; await LambdaLive.refresh(m => (updated.textContent = m), { retryAll: true }); location.reload(); };
  // Coming back to the dashboard while an app needs a sign-in checks again by itself (at most once a minute), whether
  // you used "Sign in" here or signed in some other way. Right away after using "Sign in".
  let signingIn = false, lastAuthCheck = Date.now();
  const recheck = () => {
    const waiting = ALLSRC.filter(x => x.auth && broken(x) && (signingIn || !isLater(x.key)));
    if (!isExt || D.MODE !== 'live' || !waiting.length) return;
    if (!signingIn && Date.now() - lastAuthCheck < 60e3) return;
    if (watching || LambdaLive.busy?.()) return; // a sign-in watch or a load is already on it
    signingIn = false; lastAuthCheck = Date.now();
    updated.hidden = false; updated.textContent = 'Checking sign-ins…';
    LambdaLive.refresh(m => (updated.textContent = m), { retryAll: true }).then(snap => {
      if (waiting.some(x => snap?.sources?.[x.key]?.ok)) return location.reload(); // signed in now: show it
      paintUpdated(); toast(`Still not signed in to ${waiting.map(x => x.name).join(', ')}.`);
    }).catch(() => paintUpdated());
  };
  // After "Sign in": quietly check every few seconds (for up to 10 minutes) whether it worked; the moment it does, load
  // the app's data and refresh this page, even before you come back. Apps without a quick check are rechecked on return.
  let watching = null;
  async function watchSignIn(s) {
    if (!isExt || watching === s.key) return;
    watching = s.key;
    const until = Date.now() + 10 * 60e3;
    while (watching === s.key && Date.now() < until) {
      await new Promise(r => setTimeout(r, 4000));
      const ok = await LambdaLive.probe(s.key).catch(() => false);
      if (ok === null) { watching = null; return; } // no quick check for this app: the return-to-tab recheck covers it
      if (ok) {
        watching = null; signingIn = false;
        toast(`Signed in to ${s.name}. Loading it…`);
        updated.hidden = false; updated.innerHTML = `<span class="spin-dot"></span> loading ${esc(s.name)}…`;
        // A load already running here may have read the app before you signed in: let it finish, then read again.
        while (LambdaLive.busy()) await new Promise(r => setTimeout(r, 1000));
        await LambdaLive.refresh(m => (updated.textContent = m), { retryAll: true }).catch(() => {});
        return location.reload();
      }
    }
    watching = null;
  }
  addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
  $('#sources').addEventListener('click', async e => {
    const b = e.target.closest('.source-pill[data-key]'); if (!b) return;
    const s = D.SOURCES.find(x => x.key === b.dataset.key);
    if (s?.access && isExt) return allowAccess();
    shown.add(b.dataset.key); setLater(b.dataset.key, false); renderSources();
    needBar.classList.remove('flash'); void needBar.offsetWidth; needBar.classList.add('flash');
  });
  needBar.addEventListener('click', async e => {
    const b = e.target.closest('[data-nb]'); if (!b) return;
    const k = b.dataset.key, s = D.SOURCES.find(x => x.key === k), a = b.dataset.nb;
    if (a === 'allow') return isExt ? allowAccess() : toast('Only in the extension.');
    if (a === 'later') { setLater(k, true); shown.delete(k); return renderSources(); }
    if (!isExt) return toast('Only in the extension (this is a preview).');
    if (a === 'signin') { signingIn = true; window.open(s.url, '_blank'); watchSignIn(s); return toast(`Sign in to ${s.name} there. Lambda OS notices when you're in and loads it by itself.`); }
    if (a === 'retry') return checkAgain();
    if (a === 'off') {
      const { settings: st = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...st, sources: { ...(st.sources || {}), [k]: false } } });
      toast(`${s.name} is off for you. Turn it back on in Settings → Sources.`);
      setTimeout(() => location.reload(), 900);
    }
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
    const loadingNames = D.SOURCES.filter(x => x.state === 'wait').map(x => x.name);
    updated.innerHTML = fresh ? '<b>↻ New</b>' : D.PARTIAL ? `<span class="spin-dot"></span> loading ${esc(loadingNames.slice(0, 3).join(', ') || 'other apps')}${loadingNames.length > 3 ? ` +${loadingNames.length - 3}` : ''}…` : `↻ ${rel(D.AT)}`;
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
  /* ---------------- Site picker: everything on the page follows it (search still covers every site) ---------------- */
  {
    const ALL = D.ALL || D, btn = $('#siteBtn'), pop = $('#sitePop');
    let info, mine, why, starsChanged = false;
    const reinfo = () => { info = ALL.yourSitesInfo ? ALL.yourSitesInfo() : { codes: [], picked: [], from: '' }; mine = info.codes;
      why = info.picked.map(x => x.starred ? `${x.code} ★` : x.dep ? `${x.code} (deployment ${x.dep})` : `${x.code} ${Math.round(x.share * 100)}%`).join(', '); };
    reinfo();
    const choice = D.SCOPE_CHOICE || 'all', chosen = D.SCOPE ? [...D.SCOPE] : [];
    const pickable = ALL.SITES.filter(s => s.kind === 'dc' || s.openTickets).sort((a, b) => a.id.localeCompare(b.id));
    btn.textContent = `📍 ${!D.SCOPE ? 'All sites' : choice === 'mine' ? `Your sites (${chosen.length})` : chosen.length === 1 ? chosen[0] : `${chosen.length} sites`} ▾`;
    btn.classList.toggle('on', !!D.SCOPE);
    btn.title = D.SCOPE ? `Showing ${chosen.join(', ')} only (cards, tickets, feed, sites, health, deployments, notifications). Search still covers every site.` : 'Showing every site. Click to show only your site(s).';
    let pending = new Set(choice === 'mine' ? [] : chosen);
    const apply = async v => { await LambdaData.saveScope(v); try { ['globe', 'graph', 'deploys', 'health'].forEach(k => localStorage.removeItem('lambdaos-vs-' + k)); } catch { /* ignore */ } location.reload(); };
    const paint = () => {
      pop.innerHTML = `<div class="sp-head">Show</div>
        <label class="sp-row ${!D.SCOPE ? 'cur' : ''}"><input type="radio" name="spm" data-sp="all" ${!D.SCOPE ? 'checked' : ''}> All sites</label>
        ${mine.length ? `<label class="sp-row ${choice === 'mine' && D.SCOPE ? 'cur' : ''}" title="Where you work: ${esc(why)} of ${esc(info.from)}. The busiest site counts, plus any with at least 25%."><input type="radio" name="spm" data-sp="mine" ${choice === 'mine' && D.SCOPE ? 'checked' : ''}> Your sites <small>${esc(mine.join(', '))}</small></label>
        <div class="sp-why">${esc(why)}${info.from ? ` · from ${esc(info.from)}` : ''} · ★ a site to add it</div>` : '<div class="sp-why">★ the sites you belong to and pick “Your sites”.</div>'}
        <div class="sp-sep"></div>
        <input class="sp-find" placeholder="Find a site…" aria-label="Find a site">
        <div class="sp-list">${pickable.map(s => `<label class="sp-row site" data-q="${esc((s.id + ' ' + s.name + ' ' + (s.city || '')).toLowerCase())}">
          <input type="checkbox" data-sp-site="${esc(s.id)}" ${pending.has(s.id) ? 'checked' : ''}> <b>${esc(s.id)}</b> <span>${esc(s.name)}</span><button class="sp-star ${mine.includes(s.id) ? 'on' : ''}" data-star="${esc(s.id)}" title="${mine.includes(s.id) ? `Remove ${esc(s.id)} from your sites` : `Add ${esc(s.id)} to your sites`}">${mine.includes(s.id) ? '★' : '☆'}</button><button class="sp-only" data-only="${esc(s.id)}" title="Show only ${esc(s.id)}">only</button></label>`).join('')}</div>
        <div class="sp-foot"><button class="btn" data-sp-clear>Clear</button><button class="btn primary" data-sp-apply ${pending.size ? '' : 'disabled'}>Show ${pending.size || ''} site${pending.size === 1 ? '' : 's'}</button></div>`;
    };
    const open = () => { $('#alertPop').hidden = true; paint(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); setTimeout(() => pop.querySelector('.sp-find')?.focus(), 0); };
    btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden ? open() : close(); });
    // Starring changes "Your sites" everywhere (picker, Second brain, Deployments, Health), so closing after a change reloads.
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (starsChanged) location.reload(); };
    document.addEventListener('click', e => { if (!pop.hidden && e.target.isConnected && !e.target.closest('.sitepick')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { e.stopImmediatePropagation(); close(); btn.focus(); } });
    pop.addEventListener('input', e => {
      if (e.target.matches('.sp-find')) { const q = e.target.value.trim().toLowerCase(); pop.querySelectorAll('.sp-row.site').forEach(r => { r.hidden = !!q && !r.dataset.q.includes(q); }); }
    });
    pop.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.sp === 'all') return apply('all');
      if (t.dataset.sp === 'mine') return apply('mine');
      if (t.dataset.spSite) { t.checked ? pending.add(t.dataset.spSite) : pending.delete(t.dataset.spSite);
        const b = pop.querySelector('[data-sp-apply]'); b.disabled = !pending.size; b.textContent = `Show ${pending.size || ''} site${pending.size === 1 ? '' : 's'}`; }
    });
    pop.addEventListener('click', e => {
      const star = e.target.closest('[data-star]');
      if (star) { e.preventDefault(); e.stopPropagation(); const c = star.dataset.star, P = info.prefs || { add: [], remove: [] };
        const add = new Set(P.add), rm = new Set(P.remove), isMine = mine.includes(c), guessed = (info.guessed || []).includes(c);
        if (isMine) { add.delete(c); if (guessed) rm.add(c); } else { rm.delete(c); if (!guessed) add.add(c); }
        const v = { add: [...add].sort(), remove: [...rm].sort() }; ALL.RAW = ALL.RAW || {}; ALL.RAW.myPrefs = v; LambdaData.saveMySites(v);
        starsChanged = true; reinfo(); const q = pop.querySelector('.sp-find')?.value || ''; paint(); const f = pop.querySelector('.sp-find'); if (f) { f.value = q; f.dispatchEvent(new Event('input', { bubbles: true })); }
        return; }
      const only = e.target.closest('[data-only]'); if (only) { e.preventDefault(); return apply([only.dataset.only]); }
      if (e.target.closest('[data-sp-apply]') && pending.size) return apply([...pending].sort());
      if (e.target.closest('[data-sp-clear]')) { pending = new Set(); pop.querySelectorAll('[data-sp-site]').forEach(c => { c.checked = false; }); const b = pop.querySelector('[data-sp-apply]'); b.disabled = true; b.textContent = 'Show sites'; }
    });
    pop.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.sp-find')) { const r = [...pop.querySelectorAll('.sp-row.site')].filter(x => !x.hidden); if (r.length === 1) apply([r[0].querySelector('[data-sp-site]').dataset.spSite]); } });
  }
  $('#settingsBtn').addEventListener('click', () => isExt ? chrome.runtime.openOptionsPage() : toast('Settings are available when running as the extension.'));
  // Newer data (from the background refresh or another tab): reload in place once you've been idle for a minute,
  // never while something is open. The view you were on is kept.
  let lastActivity = Date.now(), pendingReload = false;
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  const busyNow = () => !!document.querySelector('.tour') || !$('#palette').hidden || !$('#drawer').hidden || !$('#siteCard').hidden || !$('#brief').hidden || !$('#aiPanel').hidden || !$('#alertPop').hidden || !$('#sitePop').hidden;
  function tryReload() {
    if (!pendingReload || LambdaLive.busy?.()) return; // never reload while this page is running a load (it would die)
    // After a first load (only NetBox + Jira shown), the rest comes in as soon as you pause for a few seconds.
    if (document.visibilityState === 'hidden' || (!busyNow() && Date.now() - lastActivity > (D.PARTIAL ? 5000 : 60000))) location.reload();
  }
  function newData() { pendingReload = true; paintUpdated(true); tryReload(); }
  window.addEventListener('lambda:snapshot', newData);
  if (isExt) chrome.storage.onChanged.addListener((ch, area) => { const v = ch.snapshot?.newValue; if (area === 'local' && v && v.at > D.AT && !v.partial) newData(); }); // apps saved one by one (partial) wait for the finished load
  setInterval(tryReload, D.PARTIAL ? 3000 : 15000);
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
    const sites = D.SCOPE ? [...D.SCOPE].join(', ') : `${D.SITES.filter(s => s.health !== 'idle').length} live sites`;
    $('#greetingSub').textContent = mine.length ? `${mine.length} tickets for you · ${soon} breached or due within 4h` : `${D.TICKETS.length.toLocaleString()} open tickets across ${sites}`;
  }

  /* ---------------- KPI tiles ---------------- */
  function sparkPts(s) {
    const min = Math.min(...s), max = Math.max(...s), span = max - min || 1;
    return s.map((v, i) => [(i / (s.length - 1)) * 100, 27 - ((v - min) / span) * 24]);
  }
  function spark(s) {
    const p = sparkPts(s), line = 'M' + p.map(q => q.map(n => n.toFixed(1)).join(',')).join('L');
    return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img">
      <defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity=".25"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line}L100,30L0,30Z"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/>
      <circle r="3" style="display:none" vector-effect="non-scaling-stroke"/><rect class="spark-hit" x="0" y="-6" width="100" height="40"/></svg>`;
  }
  // Each card: today's number, how it moved since yesterday (▲ / ▼), and a two-week mini chart of its daily values
  // (from the daily record Lambda OS keeps). Hover the chart for any day's value. Open tickets also say how many came
  // in and how many were closed since yesterday.
  const DAYMS = 864e5, dayKeyOf = t => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const backfill = (key, h) => key === 'open' ? h.open : key === 'breached' ? h.breached : key === 'deps' ? (h.deps ? Object.keys(h.deps).length : undefined) : undefined;
  // DC Ops or Management cards (the switch under the greeting); remembered per person.
  const cards = () => D.KPIS; // one set of cards for everyone (DC Ops and managers see the same)
  // Forget choices from features that no longer exist (the DC Ops / Management switch, the old view switches).
  try { ['lambdaos-kpimode', 'lambdaos-vscope-graph', 'lambdaos-vscope-deploys', 'lambdaos-health-scope2'].forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  function kpiHistory(hist) {
    if (D.MODE === 'demo') { // demo: a steady made-up fortnight ending at today's number
      let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      return Object.fromEntries(cards().filter(k => k.key).map(k => { let v = k.num; const pts = [k.num];
        for (let i = 0; i < 29; i++) { v = Math.max(0, Math.round(v - (rnd() - 0.45) * Math.max(2, k.num * 0.05))); pts.unshift(v); }
        return [k.key, pts.map((v, i) => ({ day: dayKeyOf(Date.now() - (29 - i) * DAYMS), v, ...(k.key === 'open' ? { opened: Math.round(3 + rnd() * 8), closed: Math.round(2 + rnd() * 8) } : {}) }))]; }));
    }
    const today = dayKeyOf(Date.now()), days = Object.keys(hist || {}).filter(x => x < today).sort().slice(-29);
    return Object.fromEntries(cards().filter(k => k.key).map(k => [k.key, k.trend?.length ? k.trend : k.scoped ? [{ day: today, v: k.num }] : [...days.map(dd => ({ day: dd, v: hist[dd].kpi?.[k.key] ?? backfill(k.key, hist[dd]) }))
      .filter(p => Number.isFinite(p.v)), { day: today, v: k.num }]]));
  }
  const kDay = dd => new Date(dd + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  function renderKpis(hist) {
    const H = kpiHistory(hist), prevRec = hist && Object.keys(hist).filter(x => x < dayKeyOf(Date.now())).sort().pop();
    $('#kpis').innerHTML = cards().map(k => {
      const pts = H[k.key] || [], prev = pts.length > 1 ? pts[pts.length - 2] : null, dlt = prev ? k.num - prev.v : null;
      const cls = !dlt ? 'flat' : k.upGood ? (dlt > 0 ? 'good' : 'bad') : !k.upBad ? 'neutral' : dlt > 0 ? 'bad' : 'good'; // red/green only where more is worse (tickets, breaches, waiting)
      const amount = v => Math.abs(v) >= 1000 ? kfmt(Math.abs(v)) : Math.abs(v).toLocaleString();
      const delta = dlt == null ? '<span class="kd flat" title="The day-by-day chart builds up as Lambda OS records each day">new: history starts today</span>'
        : `<span class="kd ${cls}" title="Change since ${esc(kDay(prev.day))} (${prev.v.toLocaleString()})">${dlt > 0 ? '▲' : dlt < 0 ? '▼' : '='} ${dlt ? amount(dlt) : 'same'} <small>vs ${prev.day === dayKeyOf(Date.now() - DAYMS) ? 'yesterday' : esc(kDay(prev.day))}</small></span>`;
      // Open tickets: what came in and what was closed since the last day on record.
      let flow = '';
      const tday = pts.length && pts[pts.length - 1].opened != null ? pts[pts.length - 1] : null;
      if (k.key === 'open' && tday) flow = `<span class="kflow" title="Today, from Jira: ${tday.opened} new, ${tday.closed} closed"><b class="up-bad">+${tday.opened}</b> new <b class="up-good">−${tday.closed}</b> closed</span>`;
      else if (k.key === 'open' && !k.scoped && hist && prevRec && hist[prevRec]?.keys) {
        const was = new Set(hist[prevRec].keys), now = new Set(D.TICKETS.map(t => t.key));
        const added = [...now].filter(x => !was.has(x)).length, closed = [...was].filter(x => !now.has(x)).length;
        flow = `<span class="kflow"><b class="up-bad">+${added}</b> new · <b class="up-good">−${closed}</b> closed</span>`;
      }
      // Slim card: a short label, the number with a small change arrow, and the 30-day chart. Everything else
      // (what changed since when, new/closed, the context line) is in the card's hover text.
      const SHORT = { open: 'Open tickets', breached: 'SLA breached', deps: 'Deployments', gpus: 'GPUs', devices: 'Devices', waiting: 'Waiting parts', slaPct: 'SLA met', healthy: 'Sites healthy', risk: 'At risk', handed: 'GPUs handed off' };
      const arrow = dlt == null || !dlt ? '' : `<span class="kd ${cls}">${dlt > 0 ? '▲' : '▼'}${amount(dlt)}</span>`;
      const strip = h => String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const why = [k.label, `${k.value}`, dlt == null ? 'history starts today' : dlt ? `${dlt > 0 ? '+' : '−'}${amount(dlt)} vs ${prev.day === dayKeyOf(Date.now() - DAYMS) ? 'yesterday' : kDay(prev.day)}` : 'same as yesterday',
        strip(flow), k.sub, pts.length > 1 ? `hover the chart for any of the last ${pts.length} days` : ''].filter(Boolean).join(' · ');
      const from = k.key === 'devices' ? 'netbox' : k.key === 'handed' ? 'atium' : k.key === 'healthy' ? 'netbox' : 'jira';
      if (isLoading(from) && !k.num) return `<div class="kpi slim loading" data-k="${esc(k.key || '')}" title="Loading from ${esc(srcOf(from)?.name || from)}…">
        <div class="kpi-label">${esc(SHORT[k.key] || k.label)}</div><div class="kpi-row"><span class="kpi-value muted">…</span></div><div class="spark-wait"><span class="spin-dot"></span>loading</div></div>`;
      return `<div class="kpi slim" data-k="${esc(k.key || '')}" title="${esc(why)}">
        <div class="kpi-label">${esc(SHORT[k.key] || k.label)}</div>
        <div class="kpi-row"><span class="kpi-value">${esc(k.value)}</span>${arrow}</div>
        ${pts.length > 1 ? spark(pts.map(p => p.v)) + '<div class="spark-tip" hidden></div>' : (k.noHist ? '<div class="spark-wait" title="This history is only kept for all sites together">chart: all sites only</div>' : '<div class="spark-wait">chart starts tomorrow</div>')}</div>`; }).join('');
    document.querySelectorAll('.kpi').forEach((el, i) => {
      const k = cards()[i], svg = el.querySelector('svg'), pts = H[k.key] || [];
      if (!svg) return;
      const dot = svg.querySelector('circle'), tip = el.querySelector('.spark-tip'), xy = sparkPts(pts.map(p => p.v)), m = pts.length;
      svg.setAttribute('aria-label', `Last ${m} days`);
      svg.addEventListener('pointermove', ev => {
        const r = svg.getBoundingClientRect(), idx = Math.max(0, Math.min(m - 1, Math.round(((ev.clientX - r.left) / r.width) * (m - 1))));
        dot.setAttribute('cx', xy[idx][0]); dot.setAttribute('cy', xy[idx][1]); dot.style.display = '';
        const ch = idx ? pts[idx].v - pts[idx - 1].v : null;
        const shortDay = new Date(pts[idx].day + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
        tip.textContent = `${shortDay} · ${pts[idx].v.toLocaleString()}${pts[idx].opened != null ? `  +${pts[idx].opened} new −${pts[idx].closed} closed` : ch ? ` (${ch > 0 ? '+' : '−'}${Math.abs(ch).toLocaleString()})` : ''}`; tip.hidden = false;
      });
      // The card's own hover text would cover the chart's day label, so it steps aside while the chart is hovered.
      svg.addEventListener('pointerenter', () => { if (el.title) { el.dataset.t = el.title; el.title = ''; } });
      svg.addEventListener('pointerleave', () => { dot.style.display = 'none'; tip.hidden = true; if (el.dataset.t) el.title = el.dataset.t; });
    });
  }
  renderKpis(null);
  let KHIST = null;
  if (isExt) chrome.storage.local.get('history').then(r => renderKpis(KHIST = r.history || null)).catch(() => {});

  // A source that isn't connected says so, instead of looking empty. Returns '' when the source is fine.
  function sourceNote(key, what) {
    const src = D.SOURCES.find(x => x.key === key);
    if (src?.state === 'wait' && (D.MODE === 'live' || location.hash === '#loading')) return loadingLine(key, what);
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
    if (!D.EVENTS?.length && cal?.state === 'wait' && (D.MODE === 'live' || location.hash === '#loading')) { box.hidden = false; $('#agendaTitle').textContent = 'Today'; $('#agendaNext').textContent = ''; $('#agenda').innerHTML = loadingLine('calendar', 'your meetings'); return; }
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

  /* ---------------- Maintenance windows (Jira MAINT) ---------------- */
  const hm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayHm = t => `${new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${hm(t)}`;
  const relIn2 = t => { const m = Math.round((t - Date.now()) / 60e3); return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  const maintWhen = m => m.state === 'now' ? (m.start ? `now · until ${m.end - Date.now() < 864e5 ? hm(m.end) : dayHm(m.end)}` : 'as soon as possible (emergency)')
    : m.state === 'upcoming' ? (m.start ? `in ${relIn2(m.start)} · ${dayHm(m.start)}${m.to ? ` → ${new Date(m.end).toDateString() === new Date(m.start).toDateString() ? hm(m.end) : dayHm(m.end)}` : ''}` : 'not scheduled yet')
    : m.state === 'late' ? `window ended ${rel(m.end)} ago · still open` : 'done';
  const maintTone = m => m.emergency && m.state !== 'done' ? 'critical' : m.state === 'now' ? 'warning' : m.state === 'late' ? 'serious' : 'idle';
  const maintSoon = m => m && (m.state === 'now' || (m.state === 'upcoming' && m.start && m.start - Date.now() < 864e5)); // now or within 24 h
  const maintChip = (h, short) => { const ms = (D.maintForHost?.(h) || []).filter(maintSoon); if (!ms.length) return '';
    const m = ms[0]; return `<button type="button" class="mchip ${m.state === 'now' ? 'now' : ''} ${m.emergency ? 'emerg' : ''}" data-maint="${esc(m.key)}" title="${esc(`${m.key}: ${m.summary} · ${maintWhen(m)}`)}">🛠 ${short ? (m.state === 'now' ? 'maint now' : `maint ${relIn2(m.start)}`) : `${esc(m.type || 'Maintenance')} ${m.state === 'now' ? 'now' : 'in ' + relIn2(m.start)}`}</button>`; };
  const maintRow = m => `<div class="mini-ticket mrow" data-maint="${esc(m.key)}" title="${esc(m.summary)}"><span class="qkey">${esc(m.key)}</span><span class="qsum">${m.emergency ? '<b class="st-critical">EMERGENCY</b> · ' : ''}${esc(m.type || 'Maintenance')} · ${esc(m.summary.replace(/^EMERGENCY:\s*/i, ''))}</span>${statusChip(maintTone(m), maintWhen(m))}</div>`;
  const maintBlock = (list, title = 'Maintenance · Jira MAINT') => list.length ? `<div class="section-title"><span>🛠 ${title}</span><span>${list.length}</span></div>${list.map(maintRow).join('')}` : '';
  function openMaint(m) {
    const hostLinks = m.hosts.map(h => D.deviceById(h) ? `<a data-open="device:${esc(D.deviceById(h).id)}" class="mono">${esc(h)}</a>` : `<span class="mono">${esc(h)}</span>`);
    const onHosts = ALLT().filter(t => t.device && m.hosts.includes(String(t.device).toLowerCase()));
    return Drawer.open(`<div class="qkey">${esc(m.key)} · MAINTENANCE${m.emergency ? ' · <span class="st-critical">EMERGENCY</span>' : ''}</div><h3>${esc(m.summary)}</h3>
      ${statusChip(maintTone(m), maintWhen(m))}
      <dl class="kv"><dt>Type</dt><dd>${esc(m.type || '—')}</dd><dt>Urgency</dt><dd>${esc(m.urgency || '—')}</dd><dt>Status</dt><dd>${esc(m.status)}</dd>
        <dt>Window</dt><dd>${m.start ? `${dayHm(m.start)} → ${m.to ? dayHm(m.end) : 'no end set'}` : 'not scheduled yet'}</dd>
        ${m.deadline ? `<dt>Deadline</dt><dd>${dayHm(m.deadline)}</dd>` : ''}
        <dt>Region</dt><dd class="mono">${esc(m.region || '—')}</dd>
        <dt>Sites</dt><dd>${m.sites.map(c => `<a data-open="site:${esc(c)}">${esc(c)}</a>`).join(', ') || '<span class="muted">not matched to a site</span>'}</dd>
        <dt>Hosts</dt><dd>${hostLinks.join(', ') || (m.lrns.length ? `${m.lrns.length} cloud host${m.lrns.length > 1 ? 's' : ''} <span class="muted small">(cloud ids only)</span>` : '—')}</dd></dl>
      ${m.lrns.length && !m.hosts.length ? `<details class="small"><summary class="muted">Cloud host ids</summary><p class="mono small">${m.lrns.map(esc).join('<br>')}</p></details>` : ''}
      ${m.description ? `<p class="muted small" style="margin-top:10px">${esc(m.description)}</p>` : ''}
      ${onHosts.length ? `<div class="section-title"><span>Open tickets on these hosts</span><span>${onHosts.length}</span></div>${onHosts.map(ticketRow).join('')}` : ''}
      <div class="links">${btn('Open in Jira', m.url, true)}<button class="btn" data-trace="ticket:${esc(m.key)}">⏱ Trace</button></div>`);
  }
  /* The 🛠 button in the top bar: how many windows are open or coming up (red when there's an emergency, highlighted
     when one is happening now), and a list of all of them, grouped by when. */
  const maintAll = () => ((D.ALL || D).MAINT || []).filter(m => m.state !== 'done');
  function paintMaintBtn() {
    const b = $('#maintBtn'); if (!b) return;
    const all = maintAll(), em = all.filter(m => m.emergency && m.state !== 'late'), now = all.filter(m => m.state === 'now'), soon = all.filter(maintSoon);
    $('#maintCount').textContent = soon.length || (all.length ? '' : '');
    b.classList.toggle('emerg', !!em.length); b.classList.toggle('now', !em.length && !!now.length);
    b.title = all.length ? `Maintenance windows (Jira MAINT): ${[em.length && `${em.length} emergency`, now.length && `${now.length} now`, soon.length - now.length > 0 && `${soon.length - now.length} within 24 h`, `${all.length} open in all`].filter(Boolean).join(' · ')}`
      : 'Maintenance windows (Jira MAINT): none open';
  }
  function openMaintList() {
    const all = maintAll(), mine = new Set((D.ALL || D).yourSites ? (D.ALL || D).yourSites() : []);
    const day = 864e5, at = m => m.start || m.created || 0;
    const groups = [
      ['🚨 Emergency', all.filter(m => m.emergency && m.state !== 'late')],
      ['Happening now', all.filter(m => m.state === 'now' && !m.emergency)],
      ['Next 24 hours', all.filter(m => m.state === 'upcoming' && !m.emergency && m.start && m.start - Date.now() <= day)],
      ['Later', all.filter(m => m.state === 'upcoming' && !m.emergency && (!m.start || m.start - Date.now() > day))],
      ['Window over, request still open', all.filter(m => m.state === 'late')],
    ].filter(([, l]) => l.length);
    const row = m => `<div class="mini-ticket mrow mrow2" data-maint="${esc(m.key)}" title="${esc(m.summary)}"><span class="qkey">${esc(m.key)}</span>
      <span class="qsum"><span class="m-title">${m.emergency ? '<b class="st-critical">EMERGENCY</b> · ' : ''}${esc(m.summary.replace(/^EMERGENCY:\s*/i, ''))}</span>
      <span class="m-meta">${statusChip(maintTone(m), maintWhen(m))}${m.sites.length ? ` · <b>${esc(m.sites.join(', '))}</b>` : ''}${m.type ? ` · ${esc(m.type)}` : ''}${m.sites.some(c => mine.has(c)) ? ' <b class="m-yours" title="At one of your sites">★ yours</b>' : ''}</span></span></div>`;
    Drawer.open(`<div class="qkey">MAINTENANCE · JIRA MAINT</div><h3>Maintenance windows</h3>
      <p class="muted small">${all.length ? `${all.length} open request${all.length > 1 ? 's' : ''} from Jira's Maintenance Requests (MAINT) project, soonest first. Click one for its window, hosts and the tickets on them.` : 'No open maintenance requests in Jira MAINT right now.'}</p>
      ${groups.map(([t, l]) => `<div class="section-title"><span>${t}</span><span>${l.length}</span></div>${l.sort((a, b) => at(a) - at(b)).map(row).join('')}`).join('')}
      <div class="links">${btn('All in Jira', `${(D.ALL || D).RAW?.jiraBase || (D.MAINT?.[0]?.url || '').replace(/\/browse\/.*$/, '') || 'https://lambda-inc.atlassian.net'}/jira/software/c/projects/MAINT/issues`, true)}<button class="btn" data-view-go="deploys">See them on the Deployments timeline</button></div>`);
  }
  $('#maintBtn')?.setAttribute('data-maint-list', ''); // a second click closes the list (card toggle, see OPENER)
  $('#maintBtn')?.addEventListener('click', () => openMaintList());
  document.addEventListener('click', e => { const b = e.target.closest('[data-view-go]'); if (b) { Drawer.close(); setView(b.dataset.viewGo); } });
  paintMaintBtn(); setInterval(paintMaintBtn, 60e3);
  document.addEventListener('click', e => { const b = e.target.closest('[data-maint]'); if (!b) return; e.stopPropagation(); const m = D.maintByKey?.(b.dataset.maint); if (m) openMaint(m); });
  /* ---------------- Filter: one query for every list ----------------
     The box in the top bar (⌘⇧F / Ctrl+Shift+F) narrows the left column (each tab's count becomes the number of matches),
     the live feed, the sites list, the Deployments and Health views; rows in an open card that don't match fade, and
     so do marks in Trace. Kept while this tab is open.
       words              gpu psu            all words (anywhere in the row)
       OR, |              gpu OR psu         either
       -, NOT             -done, NOT bus     leave out
       "…"                "waiting for parts" exact phrase
       ( )                (gpu OR nic) -bus  grouping
       field:value        site:IAD03         the field contains it (* = anything: host:iad03-r06*)
       field=value        status=Open        the field is exactly it;  status!=Done  is anything else
       sla< age> updated< sla<4h  age>7d  updated<1d   (m, h, d, w)
       is: / has:         is:breached is:mine is:unassigned is:open is:done is:locked is:prod is:tracked is:late
                          has:alert has:part has:host
     Fields: site status assignee host part priority key src from channel type project. A word with a colon that isn't a
     field (a breaker like AA:L1-N-BR4) is just searched as text. */
  const Filter = (() => {
    const FIELDS = { site: 'site', status: 'status', state: 'status', assignee: 'assignee', owner: 'assignee', who: 'assignee', host: 'host', device: 'host',
      part: 'part', pn: 'part', priority: 'priority', prio: 'priority', key: 'key', id: 'key', src: 'src', source: 'src', from: 'from', channel: 'channel',
      type: 'type', project: 'project', sla: 'sla', age: 'age', updated: 'updated' };
    const DUR = new Set(['sla', 'age', 'updated']);
    const IS = ['breached', 'mine', 'unassigned', 'open', 'done', 'locked', 'prod', 'tracked', 'late', 'maint'], HAS = ['alert', 'part', 'host', 'maint'];
    const UNIT = { m: 60e3, h: 3600e3, d: 864e5, w: 7 * 864e5 };
    let q = '', ast = null, error = '', warn = '';
    try { q = sessionStorage.getItem('lambdaos-filter') || ''; } catch { /* ignore */ }

    // Text → tokens: ( ) | AND OR NOT, words, "phrases", field ops; a leading - negates.
    function lex(s) {
      const out = []; let i = 0;
      const readWord = () => { let j = i; while (j < s.length && !/[\s()|]/.test(s[j])) j++; const w = s.slice(i, j); i = j; return w; };
      const readQuoted = () => { const j = s.indexOf('"', i + 1); const v = s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; return v; };
      while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '(' || c === ')' || c === '|') { out.push({ t: c }); i++; continue; }
        let neg = false;
        if (c === '-' && i + 1 < s.length && !/[\s()|]/.test(s[i + 1])) { neg = true; i++; }
        if (s[i] === '"') { out.push({ t: 'word', neg, v: readQuoted(), quoted: true }); continue; }
        const fq = s.slice(i).match(/^([A-Za-z]+)(!=|<=|>=|=|:|<|>)"/); // field="a quoted value with spaces"
        if (fq && (FIELDS[fq[1].toLowerCase()] || /^(is|has)$/i.test(fq[1]))) { i += fq[0].length - 1; const n = fq[1].toLowerCase(); out.push({ t: 'field', neg, f: FIELDS[n] || n, op: fq[2], v: readQuoted() }); continue; }
        const w = readWord();
        if (!neg && /^(AND|OR|NOT)$/.test(w)) { out.push({ t: w }); continue; }
        const m = w.match(/^([A-Za-z]+)(!=|<=|>=|=|:|<|>)(.*)$/);
        const name = m && m[1].toLowerCase();
        if (m && (FIELDS[name] || name === 'is' || name === 'has')) {
          let v = m[3]; if (!v && s[i] === '"') v = readQuoted();
          out.push({ t: 'field', neg, f: FIELDS[name] || name, op: m[2], v });
        } else out.push({ t: 'word', neg, v: w });
      }
      return out;
    }
    // Tokens → tree: OR of ANDs; NOT binds tighter; words next to each other are AND.
    function parse(s) {
      const tk = lex(s); let p = 0;
      const peek = () => tk[p], take = () => tk[p++];
      const fail = m => { throw new Error(m); };
      function term(x) {
        if (x.t === 'word') return { w: x.v.toLowerCase() };
        const { f, op, v } = x, val = v.toLowerCase();
        if (f === 'is' || f === 'has') {
          if (op !== ':' && op !== '=') fail(`use ${f}:${(f === 'is' ? IS : HAS)[0]}`);
          if (!(f === 'is' ? IS : HAS).includes(val)) fail(`${f}:${v || '…'} isn't known. Try ${(f === 'is' ? IS : HAS).map(k => `${f}:${k}`).join(', ')}`);
          return { flag: f, k: val };
        }
        if (/[<>]/.test(op)) {
          if (!DUR.has(f)) fail(`< and > work with sla, age and updated (e.g. sla<4h)`);
          const m = val.match(/^(\d+(?:\.\d+)?)([mhdw])$/); if (!m) fail(`${f}${op}${v || '…'}: give a time like 30m, 4h, 7d or 2w`);
          return { f, op, n: Number(m[1]) * UNIT[m[2]] };
        }
        if (DUR.has(f)) fail(`${f} takes < or >, like ${f === 'sla' ? 'sla<4h' : f === 'age' ? 'age>7d' : 'updated<1d'}`);
        if (!v) fail(`${f}${op} needs a value, like ${f}${op}${f === 'status' ? 'Open' : f === 'site' ? 'IAD03' : '…'}`);
        const re = new RegExp((op === ':' ? '' : '^') + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (op === ':' ? '' : '$'));
        return { f, op, re };
      }
      function unary() {
        const x = peek(); if (!x) fail('the filter ends too early');
        if (x.t === 'NOT') { take(); return { not: unary() }; }
        if (x.t === '(') { take(); const e = or(); if (take()?.t !== ')') fail('a ( has no matching )'); return e; }
        if (x.t === ')') fail('there is a ) without a (');
        if (x.t === '|' || x.t === 'OR' || x.t === 'AND') fail(`${x.t} needs something on both sides`);
        take(); const n = term(x); return x.neg ? { not: n } : n;
      }
      function and() { const a = [unary()]; while (peek() && !['|', 'OR', ')'].includes(peek().t)) { if (peek().t === 'AND') take(); a.push(unary()); } return a.length === 1 ? a[0] : { and: a }; }
      function or() { const a = [and()]; while (peek() && (peek().t === '|' || peek().t === 'OR')) { take(); a.push(and()); } return a.length === 1 ? a[0] : { or: a }; }
      if (!tk.length) return null;
      const e = or(); if (p < tk.length) fail('there is a ) without a (');
      return e;
    }
    const unknownField = s => { const m = [...s.matchAll(/(?:^|\s)-?([a-z]{3,}):/gi)].map(x => x[1].toLowerCase()).find(n => !FIELDS[n] && n !== 'is' && n !== 'has' && !/^https?$/.test(n)); return m ? `“${m}:” isn't a field, so it's searched as text. Fields: site, status, assignee, host, part, priority, key, src, from, type, project` : ''; };
    function compile() { error = ''; warn = ''; try { ast = parse(q); warn = unknownField(q); } catch (e) { ast = null; error = e.message; } }
    compile();

    // An item: { text: [...anything to search], f: { field: value | [values] }, is: {flag: bool}, has: {flag: bool}, d: {sla, age, updated (ms)} }
    const vals = v => [].concat(v ?? []).flat(3).filter(x => x != null && x !== '').map(x => String(x).toLowerCase());
    function evalNode(n, it) {
      if (n.or) return n.or.some(x => evalNode(x, it));
      if (n.and) return n.and.every(x => evalNode(x, it));
      if (n.not) return !evalNode(n.not, it);
      if (n.w != null) return it._t.includes(n.w);
      if (n.flag) return !!(n.flag === 'is' ? it.is : it.has)?.[n.k];
      if (n.n != null) { const v = it.d?.[n.f]; if (v == null || Number.isNaN(v)) return false; return n.op === '<' ? v < n.n : n.op === '<=' ? v <= n.n : n.op === '>' ? v > n.n : v >= n.n; }
      if (!it.f) return n.op === '!=' ? !n.re.test(it._t) : n.re.test(it._t) || (n.op === '=' && it._t.includes(n.re.source.replace(/^\^|\$$/g, '')));  // plain rows: search the text
      const vs = vals(it.f[n.f]);
      if (n.op === '!=') return !vs.some(v => n.re.test(v));
      return vs.some(v => n.re.test(v));
    }
    const on = () => !!ast;
    function test(it) {
      if (!ast) return true;
      if (it._t == null) it._t = vals(it.text).join(' ') + ' ' + vals(Object.values(it.f || {})).join(' ');
      return evalNode(ast, it);
    }
    const match = (...parts) => test({ text: parts });

    /* ---- the box: input, ✕, ?, ★ and a small panel for suggestions, errors, examples and saved filters ---- */
    const box = $('#fbox'), input = $('#fInput'), clear = $('#fClear'), help = $('#fHelp'), star = $('#fStar');
    const pop = Object.assign(document.createElement('div'), { id: 'fPop', className: 'fpop', hidden: true }); document.body.appendChild(pop);
    const SAVED = 'lambdaos-filters';
    const saved = () => { try { return JSON.parse(localStorage.getItem(SAVED)) || []; } catch { return []; } };
    const setSaved = a => { try { localStorage.setItem(SAVED, JSON.stringify(a.slice(0, 12))); } catch { /* per-viewer convenience */ } };
    // Simple first, then fields, time and flags. Each one is clickable.
    const EXAMPLES = [
      ['gpu iad03', 'Both words'], ['gpu OR psu', 'Either word'],
      ['gpu -bus', 'gpu, but not bus'], ['"fell off the bus"', 'This exact phrase'],
      ['site:IAD03', 'Only site IAD03'], ['status!=Done', 'Status isn\'t Done'],
      ['assignee:me', 'Assigned to me'], ['host:iad03-r06*', 'Hosts starting iad03-r06'],
      ['sla<4h', 'SLA due within 4 hours'], ['age>7d', 'Opened over a week ago'],
      ['is:mine is:breached', 'My tickets past SLA'], ['has:alert', 'Has a Grafana alert'],
      ['is:maint', 'Maintenance now or within 24 h'], ['type:"Power Cycle"', 'Sites with a power-cycle window'],
    ];
    function values(field) {
      const T = ALLT(), uniq = a => [...new Set(a.filter(Boolean))];
      return {
        site: () => D.SITES.map(s => s.id), status: () => uniq([...T.map(t => t.status), ...(D.DEPLOYMENTS || []).map(d => d.status)]).sort(),
        assignee: () => ['me', ...uniq(T.map(t => t.assigneeName)).sort()], priority: () => uniq(T.map(t => t.priority)),
        src: () => ['jira', 'netbox', 'slack', 'gmail', 'netsuite', 'atium', 'grafana', 'news'], part: () => uniq((D.PARTS || []).map(p => p.pn)),
        host: () => uniq(T.map(t => t.device)), type: () => uniq((D.DEPLOYMENTS || []).flatMap(d => [d.deployType, d.projectType])),
        project: () => uniq((D.PROJECTS || []).map(p => p.key)), key: () => [], from: () => [], channel: () => uniq((D.CHANNELS || []).map(c => c.name)),
        is: () => IS, has: () => HAS,
      }[field]?.() || [];
    }
    let sugg = [], hi = -1;
    // The word being typed (up to the caret): suggest field values (site:IA… → IAD03) or field names (sta… → status:).
    function suggestions() {
      const pos = input.selectionStart ?? input.value.length, before = input.value.slice(0, pos), m = before.match(/(-?)([A-Za-z]*)(!=|=|:)?("?)([^\s()"]*)$/);
      if (!m) return [];
      const [, , name, op, , part] = m, f = FIELDS[name.toLowerCase()] || (['is', 'has'].includes(name.toLowerCase()) ? name.toLowerCase() : null);
      if (op && f && !DUR.has(f)) return values(f).filter(v => String(v).toLowerCase().startsWith(part.toLowerCase())).slice(0, 8)
        .map(v => ({ label: `${name}${op}${v}`, insert: `${name}${op}${/\s/.test(v) ? `"${v}"` : v} `, from: before.length - m[0].length + (m[1] ? 1 : 0) }));
      if (!op && name.length >= 2) return [...Object.keys(FIELDS).filter(k => k === FIELDS[k] || k === 'is'), 'is', 'has'].filter((k, i, a) => a.indexOf(k) === i && k.startsWith(name.toLowerCase()) && k !== name.toLowerCase())
        .slice(0, 6).map(k => ({ label: `${k}${DUR.has(k) ? '<' : ':'}`, insert: `${k}${DUR.has(k) ? '<' : ':'}`, from: before.length - m[0].length + (m[1] ? 1 : 0) }));
      return [];
    }
    function paintPop(showHelp = false) {
      if (document.activeElement !== input && !showHelp) { pop.hidden = true; return; }
      sugg = document.activeElement === input ? suggestions() : []; if (hi >= sugg.length) hi = -1;
      const sv = saved();
      const parts = [];
      if (error) parts.push(`<div class="fp-err">⚠ ${esc(error)}. Showing everything until it's fixed.</div>`);
      else if (warn) parts.push(`<div class="fp-warn">${esc(warn)}</div>`);
      if (sugg.length) parts.push(`<div class="fp-sugg">${sugg.map((s, i) => `<button type="button" class="${i === hi ? 'hi' : ''}" data-fs="${i}">${esc(s.label)}</button>`).join('')}</div><div class="fp-tip muted">Tab or ↓ Enter to pick</div>`);
      if (showHelp || (!q && !sugg.length)) {
        if (sv.length) parts.push(`<div class="fp-h">Saved</div><div class="fp-saved">${sv.map(x => `<span class="fp-chip"><button type="button" data-fq="${esc(x)}">${esc(x)}</button><button type="button" class="x" data-fdel="${esc(x)}" aria-label="Remove">✕</button></span>`).join('')}</div>`);
        parts.push(`<div class="fp-h">Examples</div><div class="fp-ex">${EXAMPLES.map(([x, why]) => `<button type="button" data-fq="${esc(x)}"><code>${esc(x)}</code><span>${esc(why)}</span></button>`).join('')}</div>
          <div class="fp-help muted"><b>Combine:</b> space = and · <code>OR</code> = either · <code>-</code> = not · <code>"…"</code> = exact · <code>( )</code> = group<br>
          <b>Fields:</b> <code>:</code> contains · <code>=</code> exactly · <code>!=</code> not · <code>*</code> anything — site status assignee host part priority key src<br>
          <b>Time:</b> <code>sla&lt;4h</code> <code>age&gt;7d</code> <code>updated&lt;1d</code> · <b>Flags:</b> <code>is:</code>${IS.join(' ')} · <code>has:</code>${HAS.join(' ')}</div>`);
      }
      pop.innerHTML = parts.join('');
      pop.hidden = !parts.length;
      if (!pop.hidden) { const r = box.getBoundingClientRect(), w = Math.min(460, innerWidth - 16); pop.style.width = w + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; pop.style.top = r.bottom + 6 + 'px'; }
    }
    function accept(i) {
      const s = sugg[i]; if (!s) return false;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, s.from) + s.insert + input.value.slice(pos);
      const c = s.from + s.insert.length; input.setSelectionRange(c, c); hi = -1; set(input.value); return true;
    }
    // Views drawn elsewhere (Deployments, Health) and open cards: hide or fade rows after each draw. A row that names a
    // ticket, deployment, site or host is matched with its fields; other rows by their text.
    const ROWSETS = [['#deploys', '.drow', 'hide'], ['#health', 'tbody tr', 'hide'], ['#drawer', '.mini-ticket, .hrow, .aitem, .inv, .qitem, .volcard, .lk-list .mini-ticket', 'dim'], ['#siteCard', '.mini-ticket, .inv', 'dim']];
    function rowItem(el) {
      const SEL = '[data-ticket],[data-dep],[data-site]', o = el.matches(SEL) ? el : el.querySelector(SEL);
      const d = o?.dataset || {}, text = [el.textContent, el.getAttribute('title')];
      const t = d.ticket && D.ticketByKey(d.ticket); if (t) return { ...tItem(t), text: [...tItem(t).text, ...text] };
      const dep = d.dep && D.deploymentByKey?.(d.dep); if (dep) return { ...depItem(dep), text: [...depItem(dep).text, ...text] };
      const s = d.site && D.siteById(d.site); if (s) return { ...siteItem(s), text: [...siteItem(s).text, ...text] };
      return { text };
    }
    function dom() {
      for (const [sel, rows, how] of ROWSETS) {
        const root = $(sel); if (!root) continue;
        for (const el of root.querySelectorAll(rows)) el.classList.toggle(how === 'hide' ? 'f-hide' : 'f-out', !test(rowItem(el)));
        if (sel === '#deploys') for (const g of root.querySelectorAll('.dgroup')) g.classList.toggle('f-hide', on() && !g.querySelector('.drow:not(.f-hide)'));
      }
    }
    let tmr = 0; const domSoon = () => { clearTimeout(tmr); tmr = setTimeout(dom, 20); };
    for (const sel of ['#deploys', '#health', '#drawer', '#siteCard']) { const el = $(sel); if (el) new MutationObserver(domSoon).observe(el, { childList: true, subtree: true }); }
    function paint() {
      box?.classList.toggle('on', on()); box?.classList.toggle('err', !!error);
      if (box) box.title = error ? `⚠ ${error}` : 'Filter every list (⌘⇧F / Ctrl+Shift+F). ? for examples.';
      if (clear) clear.hidden = !q; if (star) { star.hidden = !q || !!error; const s = saved().includes(q.trim()); star.textContent = s ? '★' : '☆'; star.title = s ? 'Saved: click to remove' : 'Save this filter'; }
      if (input && input.value !== q) input.value = q;
    }
    let deb = 0;
    function set(v) {
      q = String(v || ''); compile(); paint(); paintPop();
      try { sessionStorage.setItem('lambdaos-filter', q); } catch { /* ignore */ }
      clearTimeout(deb); deb = setTimeout(() => {
        renderQueue(); renderFeed(); renderSites();
        if (activeView === 'deploys') Deploys.render(); else if (activeView === 'health') Health.render(); else if (activeView === 'trace') Trace.render();
        dom();
      }, 120);
    }
    input?.addEventListener('input', () => { hi = -1; set(input.value); });
    input?.addEventListener('focus', () => paintPop());
    input?.addEventListener('click', () => paintPop());
    input?.addEventListener('blur', () => setTimeout(() => { if (!pop.contains(document.activeElement)) pop.hidden = true; }, 150));
    input?.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && sugg.length) { e.preventDefault(); hi = (hi + 1) % sugg.length; return paintPop(); }
      if (e.key === 'ArrowUp' && sugg.length) { e.preventDefault(); hi = (hi - 1 + sugg.length) % sugg.length; return paintPop(); }
      if ((e.key === 'Enter' && hi >= 0) || (e.key === 'Tab' && sugg.length && !e.shiftKey)) { e.preventDefault(); return accept(hi >= 0 ? hi : 0); }
      if (e.key === 'Escape') { e.stopPropagation(); if (!pop.hidden && (sugg.length || !q)) { pop.hidden = true; return; } if (q) set(''); else input.blur(); }
    });
    pop.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the box
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-fs],[data-fq],[data-fdel]'); if (!b) return;
      if (b.dataset.fs) return accept(+b.dataset.fs);
      if (b.dataset.fdel) { setSaved(saved().filter(x => x !== b.dataset.fdel)); paint(); return paintPop(true); }
      set(b.dataset.fq); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    });
    clear?.addEventListener('click', () => { set(''); input?.focus(); });
    help?.addEventListener('mousedown', e => e.preventDefault());
    help?.addEventListener('click', () => { input?.focus(); paintPop(true); });
    star?.addEventListener('click', () => { const x = q.trim(); if (!x) return; const a = saved(); setSaved(a.includes(x) ? a.filter(y => y !== x) : [x, ...a]); paint(); toast(a.includes(x) ? 'Filter removed from Saved.' : 'Filter saved: it\'s under ? in the filter box.'); });
    addEventListener('resize', () => { if (!pop.hidden) paintPop(); });
    paint();
    return { match, test, on, set, q: () => q, dom, focus: () => { input?.focus(); input?.select(); paintPop(); } };
  })();
  // What each kind of row can be filtered on (see Filter above).
  const isDone = s => /^(done|closed|resolved|cancel+ed|complete[d]?)$/i.test(String(s || ''));
  const tText = t => [t.key, t.priority, t.summary, t.site, D.siteById(t.site)?.name, t.device, t.status, t.assigneeName, t.part, t.part && partLabel(D.partById(t.part))];
  const tItem = t => {
    const now = Date.now(), y = yardOf(t.device);
    return { text: tText(t), f: { key: t.key, site: [t.site, D.siteById(t.site)?.name], status: t.status, assignee: [t.assigneeName, t.assignee === 'me' ? 'me' : ''], host: t.device,
      part: [t.part, t.part && partLabel(D.partById(t.part))], priority: t.priority, src: 'jira', project: String(t.key).split('-')[0] },
      d: { sla: t.slaDue ? t.slaDue - now : null, age: t.created ? now - t.created : null, updated: t.updated ? now - t.updated : null },
      is: { breached: !!(t.slaBreached || (t.slaDue && t.slaDue < now)), mine: t.assignee === 'me' || !!t.mine, unassigned: !t.assignee, open: !isDone(t.status), done: isDone(t.status),
        locked: !!y?.lockedBy, prod: !!(y?.found && LambdaAlerts.inProduction(y)), tracked: false, late: !!(t.slaBreached || (t.slaDue && t.slaDue < now)), maint: (D.maintForHost?.(t.device) || []).some(maintSoon) },
      has: { alert: !!t.alerts?.length, part: !!t.part, host: !!t.device, maint: !!(D.maintForHost?.(t.device) || []).length } };
  };
  const depText = d => [d.key, d.title, d.sites, d.site, d.status, d.assigneeName, d.deployType, d.projectType, d.gpuModel, d.project?.title, d.tags];
  const depItem = d => {
    const now = Date.now();
    return { text: depText(d), f: { key: d.key, site: d.sites, status: d.status, assignee: [d.assigneeName, d.mine ? 'me' : ''], type: [d.deployType, d.projectType], project: [d.project?.key, d.project?.title], src: 'jira', part: d.gpuModel },
      d: { age: d.start ? now - d.start : null, sla: d.end ? d.end - now : null }, is: { mine: !!d.mine, open: !isDone(d.status), done: isDone(d.status), tracked: !!D.isTracked?.(d.key), late: !!(d.overdue || (d.end && d.end < now && !isDone(d.status))) }, has: {} };
  };
  const siteItem = s => ({ text: [s.id, s.name, s.fullName, s.city, s.address, (s.maint || []).map(m => [m.key, m.type, m.summary])], f: { site: [s.id, s.name], status: [s.status, s.health], type: (s.maint || []).map(m => m.type) }, is: { maint: (s.maint || []).some(maintSoon) }, has: { alert: !!s.gf?.alerts?.length, maint: !!(s.maint || []).length } });
  const msgItem = (src, { from, channel, text, at }) => ({ text: [from, channel, text], f: { src, from, channel }, d: { age: at ? Date.now() - at : null, updated: at ? Date.now() - at : null }, is: {}, has: {} });
  const noMatch = what => `<li class="muted small" style="padding:10px 14px">No ${what} match “${esc(Filter.q())}”. <button class="linkish" data-fclear>Clear filter</button></li>`;
  document.addEventListener('click', e => { if (e.target.closest('[data-fclear]')) Filter.set(''); });

  /* ---------------- Queue: tickets · tracking · inbox ---------------- */
  let qMode = 'tickets';
  $('#qtabs').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    qMode = b.dataset.q; document.querySelectorAll('#qtabs [data-q]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    if (qMode === 'news') markNewsSeen();
    renderQueue();
  });

  /* Lambda news: the Lambda blog's RSS feed (news.js). The badge counts posts from the last 14 days you haven't seen
     in this tab yet; Settings → Appearance can hide the tab. */
  const NEWS_SEEN = 'lambdaos-news-seen';
  let news = null;
  const newsSeen = () => { try { return Number(localStorage.getItem(NEWS_SEEN)) || 0; } catch { return 0; } };
  const markNewsSeen = () => { const top = news?.items?.[0]?.at; if (top) try { localStorage.setItem(NEWS_SEEN, String(top)); } catch { /* per-viewer convenience */ } };
  const newsRow = n => `<li class="qitem news" data-href="${esc(n.url)}" title="Open on the Lambda blog">
    <div style="min-width:0"><div class="qkey"><span class="srctag src-news">Lambda blog</span>${n.tags[0] ? ` ${esc(n.tags[0])}` : ''}</div>
      <div class="qsum">${esc(n.title)}</div>${n.summary ? `<div class="qmeta news-sum">${esc(n.summary)}</div>` : ''}</div>
    <span class="ftime" title="${esc(new Date(n.at).toLocaleString())}">${n.at ? rel(n.at) : ''}</span></li>`;
  function renderNews() {
    const all = news?.items || [], seen = newsSeen(), items = all.filter(n => Filter.test({ text: [n.title, n.summary, n.tags], f: { src: 'news' }, d: { age: n.at ? Date.now() - n.at : null, updated: n.at ? Date.now() - n.at : null } }));
    $('#newsCount').textContent = (Filter.on() ? items.length : all.filter(n => n.at > seen && n.at > Date.now() - 14 * 864e5).length) || '';
    if (qMode !== 'news') return;
    $('#queueCount').textContent = all.length ? (Filter.on() ? `${items.length} of ${all.length} posts` : `${all.length} posts`) : '';
    const note = news && !news.ok ? `<li class="src-note small">${items.length ? `Couldn't check the blog just now (${esc(news.error)}); showing the posts from ${news.lastOk ? rel(news.lastOk) + ' ago' : 'earlier'}.` : `Couldn't read the Lambda blog (${esc(news.error)}). Lambda OS tries again in a couple of hours.`}</li>` : '';
    $('#queue').innerHTML = note + (items.map(newsRow).join('') || (Filter.on() && all.length ? noMatch('posts') : news ? '' : '<li class="src-note loading small">Loading the Lambda blog…</li>'))
      + `<li class="vol-all"><button class="btn" data-href="${LambdaNews.PAGE}">All posts on the Lambda blog ↗</button></li>`;
  }
  async function loadNews(force) {
    news = await LambdaNews.get(force).catch(e => ({ ok: false, items: news?.items || [], error: e.message })); renderNews();
  }
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
    const F = Filter.on(), trackedAll = D.tracked(), inboxAll = inboxItems();
    const tracked = trackedAll.filter(d => Filter.test(depItem(d))), inbox = inboxAll.filter(m => Filter.test(msgItem(m.src === 'mail' ? 'gmail' : 'slack', { from: m.who, channel: m.where, text: m.text, at: m.at })));
    const fresh = (D.MAIL?.unread || 0) + (D.MENTIONS || []).filter(m => m.at > Date.now() - 864e5).length;
    $('#trackCount').textContent = tracked.length || '';
    $('#ticketCount').textContent = mineSorted().filter(t => Filter.test(tItem(t))).length || '';
    $('#inboxCount').textContent = (F ? inbox.length : fresh) || '';
    $('#queueNote').hidden = true;
    if (qMode === 'tracking') {
      $('#queueCount').textContent = trackedAll.length ? (F ? `${tracked.length} of ${trackedAll.length} deployments` : `${tracked.length} deployments`) : '';
      $('#queue').innerHTML = tracked.map(depRow).join('') || (F && trackedAll.length ? noMatch('tracked deployments') : '') || '<li class="muted small" style="padding:10px 14px">Star ☆ a deployment (in the Deployments view, a drawer or search) to track it here. Deployments assigned to you or that you watch in Jira appear automatically.</li>';
      return;
    }
    const volsAll = D.VOLUNTEER || [], vols = volsAll.filter(v => { const it = msgItem('slack', { from: v.user, channel: v.channel, text: [v.text, D.siteById(v.site)?.name], at: v.askedAt }); it.f.site = v.site; return Filter.test(it); });
    $('#volCount').textContent = (F ? vols.length : vols.filter(v => v.at > Date.now() - 14 * 864e5).length) || '';
    if (qMode === 'volunteer') {
      $('#queueCount').textContent = vols.length ? `${vols.length} site${vols.length > 1 ? 's' : ''} · 45 days` : '';
      $('#queue').innerHTML = (vols.length ? '<li class="vol-all"><button class="btn" data-vol="">Open full view ↗</button></li>' : '') + vols.map(volRow).join('') || (F && volsAll.length ? noMatch('volunteer requests') : '') || (sourceNote('slack', 'volunteer requests') ? '' : '<li class="muted small" style="padding:10px 14px">No requests for volunteers in Slack in the last 45 days.</li>');
      $('#queue').insertAdjacentHTML('afterbegin', sourceNote('slack', 'volunteer requests'));
      loadOnsite();
      return;
    }
    renderNews();
    if (qMode === 'news') return;
    if (qMode === 'inbox') {
      $('#queueCount').textContent = F ? `${inbox.length} of ${inboxAll.length}` : D.MAIL ? `${D.MAIL.unread} unread mail` : '';
      $('#queue').innerHTML = inbox.slice(0, 60).map(m => `<li class="qitem inbox" data-href="${esc(m.url)}">
        <div style="min-width:0"><div class="qkey"><span class="srctag src-${m.src}">${m.src === 'mail' ? 'Gmail' : 'Slack'}</span> ${esc(m.where)} · ${esc(m.who)}</div><div class="qsum">${esc(m.text)}</div></div><span class="ftime">${rel(m.at)}</span></li>`).join('')
        || (F && inboxAll.length ? noMatch('messages') : '') || ((sourceNote('gmail', 'mail') || sourceNote('slack', 'mentions')) ? '' : '<li class="muted small" style="padding:10px 14px">Nothing new from Slack or Gmail.</li>');
      $('#queue').insertAdjacentHTML('afterbegin', sourceNote('gmail', 'mail') + sourceNote('slack', 'mentions'));
      return;
    }
    const mine = mineSorted();
    // Yard filters (only when Yard has answers for your tickets): ⚠ still in production unlocked, 🔒 locked.
    const yi = D.YARD && yardUsable() ? LambdaAlerts.yardIssues(D) : null;
    const yProd = new Set((yi?.inProd || []).map(x => x.t.key)), yLock = new Set(mine.filter(t => yardOf(t.device)?.lockedBy).map(t => t.key));
    if (yFilter === 'prod' && !yProd.size || yFilter === 'locked' && !yLock.size) yFilter = '';
    const mineF = (yFilter === 'prod' ? mine.filter(t => yProd.has(t.key)) : yFilter === 'locked' ? mine.filter(t => yLock.has(t.key)) : mine).filter(t => Filter.test(tItem(t)));
    const list = mine.length ? mineF.slice(0, 100) : [...D.TICKETS].sort(byUrgency).filter(t => Filter.test(tItem(t))).slice(0, 30);
    $('#qTicketsLabel').textContent = mine.length ? 'Tickets' : 'Urgent'; $('#qTicketsLabel').parentElement.title = mine.length ? 'My tickets: assigned to, reported or watched by you' : 'Most urgent tickets fleet-wide';
    $('#queueCount').textContent = mine.length ? `${F ? `${mineF.length} of ` : ''}${mine.length} open${aiRank() ? ' · ✨ AI order' : ''}` : 'fleet-wide';
    $('#queueCount').title = aiRank() ? 'Ordered by your AI provider (Settings → Data → Smart processing). Hover a ticket for the reason.' : '';
    $('#queueNote').hidden = !!mine.length || D.MODE !== 'live';
    $('#queue').innerHTML = list.map(t => {
      const st = slaStatus(t);
      return `<li class="qitem" data-ticket="${t.key}">
        <span class="qbar" style="background:${C[st]}"></span>
        <div style="min-width:0"><div class="qkey">${t.key} · ${esc(t.priority)}${t.alerts?.length ? ` <span class="alert-dot ${t.alerts.some(a => a.crit) ? 'crit' : ''}" title="Grafana alert${t.alerts.length > 1 ? 's' : ''} firing on ${esc(t.device)} right now: ${esc(t.alerts.slice(0, 4).map(a => a.name).join(', '))}${t.alerts.length > 4 ? '…' : ''}">⚠ ${t.alerts.length} alert${t.alerts.length > 1 ? 's' : ''}</span>` : ''}</div><div class="qsum">${esc(t.summary)}</div>
          <div class="qmeta">${esc([t.site, t.device, t.status, !t.mine ? t.assigneeName : ''].filter(Boolean).join(' · '))}${yardChip(t.device, t)}${maintChip(t.device)}</div>${D.AI_PRIORITY?.reasons?.[t.key] && mine.length ? `<div class="qmeta ai-why">✨ ${esc(D.AI_PRIORITY.reasons[t.key])}</div>` : ''}</div>
        <div class="sla st-${st}">${STATUS[st].glyph} ${slaText(t)}<small>SLA</small></div></li>`;
    }).join('') || (F ? noMatch('tickets') : isLoading('jira') ? loadingLine('jira', 'your tickets') : '<li class="muted" style="padding:10px">No open tickets.</li>');
    if (mine.length && (yProd.size || yLock.size)) $('#queue').insertAdjacentHTML('afterbegin', `<li class="yard-filter" role="group" aria-label="Filter by Yard state"><span class="yard-tag">Yard</span>
      <button class="chip ${!yFilter ? 'on' : ''}" data-yf="" aria-pressed="${!yFilter}">All</button>
      ${yProd.size ? `<button class="chip ${yFilter === 'prod' ? 'on' : ''}" data-yf="prod" aria-pressed="${yFilter === 'prod'}" title="Your tickets whose host still runs a production app in Yard and isn't locked">⚠ In prod <b>${yProd.size}</b></button>` : ''}
      ${yLock.size ? `<button class="chip ${yFilter === 'locked' ? 'on' : ''}" data-yf="locked" aria-pressed="${yFilter === 'locked'}" title="Your tickets whose host is locked in Yard">🔒 Locked <b>${yLock.size}</b></button>` : ''}</li>`);
  }
  let yFilter = '';
  document.addEventListener('click', e => { const b = e.target.closest('[data-yf]'); if (!b) return; yFilter = b.dataset.yf; renderQueue(); });
  renderQueue(); setInterval(renderQueue, 60000);
  if (isExt) chrome.storage.local.get('settings').then(({ settings: st = {} }) => { if (st.news === false) { $('#newsTab').remove(); if (qMode === 'news') qMode = 'tickets'; } else loadNews(); });
  else loadNews();
  setInterval(() => $('#newsTab') && loadNews(), 30 * 60e3); // news.js only goes to the blog every 2 hours

  /* ---------------- Sites list ---------------- */
  const listSites = () => D.SITES.filter(s => D.SCOPE ? D.SCOPE.has(s.id) : s.openTickets || s.devices || s.kind === 'dc')
    .sort((a, b) => b.openTickets - a.openTickets || (b.devices || 0) - (a.devices || 0));
  function renderSites() {
    const all = listSites(), sites = all.filter(s => Filter.test(siteItem(s)) || (Filter.on() && ALLT().some(t => t.site === s.id && Filter.test(tItem(t))))), /* a site also shows when its tickets match */ max = Math.max(1, ...sites.map(s => s.openTickets));
    $('#siteCount').textContent = Filter.on() ? `${sites.length} of ${all.length} · by open tickets` : `${sites.length} · by open tickets`;
    if (!sites.length && isLoading('netbox')) { $('#siteList').innerHTML = loadingLine('netbox', 'sites'); return; }
    $('#siteList').innerHTML = sites.map(s =>
      `<li class="srow ${Fleet.selected === s ? 'sel' : ''} ${s.health === 'idle' ? 'dim' : ''}" data-site="${esc(s.id)}" title="${esc(s.fullName || s.id)}: ${s.openTickets} open tickets, ${esc(siteStatusLabel(s))}${s.healthWhy ? ` (from ${esc(s.healthWhy)}: see the Health tab)` : ''}">
        <span class="code">${esc(s.id)}</span><span class="sname">${esc(s.name)}${(s.maint || []).some(maintSoon) ? `<span class="mbadge" title="${esc((s.maint || []).filter(maintSoon).map(m => `${m.key}: ${m.summary} · ${maintWhen(m)}`).join('\n'))}">🛠</span>` : ''}</span>
        <span style="display:flex;gap:6px;align-items:center"><span class="bar" style="flex:1"><i style="width:${(s.openTickets / max) * 100}%"></i></span><span class="n">${s.openTickets}</span></span>
        ${healthBadge(s)}</li>`).join('') || (Filter.on() ? noMatch('sites') : '');
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
    const feedItem = f => { const t = f.src === 'jira' && D.ticketByKey(f.meta?.key || f.ref), age = f.at ? Date.now() - f.at : null;
      const it = t ? tItem(t) : { text: [], f: { key: f.ref, site: f.meta?.site || f.ref }, is: {}, has: {} };
      return { ...it, text: [f.text, SRC[f.src]?.[1], ...it.text], f: { ...it.f, src: f.src === 'mail' ? 'gmail' : f.src }, d: { ...(it.d || {}), age, updated: age } }; };
    const shown = feed.filter(f => feedOn[f.src] && Filter.test(feedItem(f))).slice(0, 100);
    $('#feed').innerHTML = shown.map((f, i) =>
      `<li class="fitem ${i < newCount ? 'new' : ''}" data-feed="${fid(f)}" tabindex="0" role="button" title="Click for details">
        <div class="fmeta"><span class="srctag src-${f.src}">${SRC[f.src][1]}</span><span class="ftime">${rel(f.at)}</span></div><div class="ftext">${esc(f.text)}</div></li>`).join('')
      || (Filter.on() && feed.length ? noMatch('updates') : '') || (isLoading('jira', 'netbox', 'slack', 'gmail') ? `<li class="src-note loading"><span class="spin-dot"></span>Loading updates…</li>` : '<li class="muted" style="padding:10px">Nothing yet.</li>');
  }
  // Clicking an event opens what it's about: the details, everything it links to, and a button to the source.
  let feedSeq = 0; const feedById = new Map();
  const fid = f => { if (!f._id) { f._id = ++feedSeq; feedById.set(f._id, f); } return f._id; };
  const linksIn = text => {
    const out = [], s = String(text || '');
    for (const k of new Set(s.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [])) {
      if (D.ticketByKey(k)) out.push(`<button class="tagchip" data-ticket="${esc(k)}">${esc(k)}</button>`);
      else if (D.deploymentByKey?.(k)) out.push(`<button class="tagchip" data-dep="${esc(k)}">${esc(k)}</button>`);
    }
    for (const h of new Set(s.match(/\b[a-z]{3}\d{2}-[a-z0-9-]*[a-z0-9]\b/gi) || [])) { const d = D.deviceById(h) || D.deviceById(h.toLowerCase()); if (d) out.push(`<button class="tagchip mono" data-open="device:${esc(d.id)}">${esc(d.id)}</button>`); }
    for (const c of new Set(s.match(/\b[A-Z]{3}\d{2}\b/g) || [])) if (D.siteById(c)) out.push(`<button class="tagchip" data-site="${esc(c)}">📍 ${esc(c)}</button>`);
    return [...new Set(out)];
  };
  const NB_PATH = { device: 'dcim/devices', site: 'dcim/sites', rack: 'dcim/racks', location: 'dcim/locations', interface: 'dcim/interfaces', cable: 'dcim/cables',
    module: 'dcim/modules', inventoryitem: 'dcim/inventory-items', powerfeed: 'dcim/power-feeds', powerpanel: 'dcim/power-panels', ipaddress: 'ipam/ip-addresses', prefix: 'ipam/prefixes' };
  function openFeed(f) {
    const m = f.meta || {}, when = new Date(f.at), name = SRC[f.src]?.[1] || f.src;
    const head = (title, sub) => `<div class="qkey"><span class="srctag src-${f.src}">${esc(name)}</span> · ${esc(when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${rel(f.at) === 'now' ? 'just now' : rel(f.at) + ' ago'}</div><h3>${title}</h3>${sub ? `<p class="muted">${sub}</p>` : ''}`;
    const kv = rows => `<dl class="kv">${rows.filter(r => r && r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const linked = list => list.length ? `<div class="section-title"><span>Linked</span><span>${list.length}</span></div><div class="feed-links">${list.join('')}</div>` : '';
    let body = '', links = '', extra = [];
    if (f.src === 'jira') {
      const key = m.key || f.ref, t = key && D.ticketByKey(key), dep = key && D.deploymentByKey?.(key);
      if (t) {
        const st = slaStatus(t), dev = D.deviceById(t.device);
        body = head(`${esc(t.key)} · ${esc(t.summary)}`, `Latest update: status <b>${esc(m.status || t.status)}</b>${m.assignee ? ` · assignee ${esc(m.assignee)}` : ''}`)
          + statusChip(st, `${STATUS[st].glyph} ${slaText(t)}`)
          + kv([['Status', esc(t.status)], ['Priority', esc(t.priority)], ['Assignee', t.assignee ? `<a data-open="person:${esc(t.assignee)}">${esc(t.assigneeName)}</a>` : 'Unassigned'],
            ['Site', t.site ? `<a data-open="site:${esc(t.site)}">${esc(t.site)}</a>` : ''], ['Device', dev ? `<a data-open="device:${esc(dev.id)}" class="mono">${esc(dev.id)}</a>${dev.rack ? ` · ${esc(dev.rack)}${dev.u ? ` U${dev.u}` : ''}` : ''}` : esc(t.device || '')],
            ['Created', new Date(t.created).toLocaleString()]])
          + yardBlock(t.device, t) + alertsBlock(t.alerts);
        links = `<button class="btn primary" data-ticket="${esc(t.key)}">Ticket details</button>${btn('Open in Jira', t.url)}`;
      } else if (dep) {
        body = head(`${esc(dep.key)} · ${esc(dep.title)}`, `Latest update: status <b>${esc(m.status || dep.status)}</b>`) + statusChip(dep.health, depStatus(dep))
          + kv([['Sites', esc(dep.sites.join(', '))], ['GPUs', dep.gpus ? `${dep.gpus.toLocaleString()}× ${esc(dep.gpuModel || '')}` : ''], ['Done', pct(dep.progress)], ['Due', fmtDate(dep.end)], ['Owner', esc(dep.assigneeName || '')]]);
        links = `<button class="btn primary" data-dep="${esc(dep.key)}">Deployment details</button>${dep.url ? btn('Open in Jira', dep.url) : ''}`;
      } else {
        body = head(esc(key ? `${key} · ${m.summary || f.text}` : f.text), m.status ? `Status <b>${esc(m.status)}</b>${m.assignee ? ` · assignee ${esc(m.assignee)}` : ''}` : 'This ticket isn\'t in your open fleet tickets any more (closed, or outside the fleet search).');
        links = btn('Open in Jira', m.url || (key && D.LINKS?.jira ? `${D.LINKS.jira}/browse/${key}` : ''), true);
      }
    } else if (f.src === 'netbox') {
      const dev = m.type === 'device' && (D.deviceById(m.repr) || D.deviceById(String(m.repr).toLowerCase())), site = m.type === 'site' ? D.siteById(m.repr) : null;
      const base = m.base || D.LINKS?.netbox || '', path = NB_PATH[m.type];
      body = head(esc(f.text), '')
        + kv([['Who', esc(m.user || '')], ['Change', esc(m.action || '')], ['Object type', esc(m.type || '')], ['Object', m.repr ? `<span class="mono">${esc(m.repr)}</span>` : ''],
          ['Device', dev ? `<a data-open="device:${esc(dev.id)}" class="mono">${esc(dev.id)}</a> · ${esc(dev.model)} · ${esc(dev.site || '?')} ${esc(dev.rack)}${dev.u ? ` U${dev.u}` : ''}` : '']])
        + (dev ? yardBlock(dev.id) : '')
        + (dev ? (() => { const ts = ALLT().filter(t => t.device === dev.id).sort(byUrgency); return ts.length ? `<div class="section-title"><span>Open tickets on this device</span><span>${ts.length}</span></div>${ts.slice(0, 6).map(ticketRow).join('')}` : ''; })() : '');
      links = [dev ? `<button class="btn primary" data-open="device:${esc(dev.id)}">Device details</button>` : '', site ? `<button class="btn primary" data-site="${esc(site.id)}">Site card</button>` : '',
        base && path && m.objId ? btn(`${cap(m.type)} in NetBox`, `${base}/${path}/${m.objId}/`, !dev && !site) : dev?.url ? btn('Device in NetBox', dev.url) : '',
        base && m.id ? btn('What changed (NetBox change log)', `${base}/core/changelog/${m.id}/`) : ''].join('');
    } else if (f.src === 'grafana') {
      const s = D.siteById(m.site || f.ref), hosts = m.hosts || [];
      body = head(esc(`${m.name || 'Alert'} at ${m.site || f.ref}`), `${hosts.length} host${hosts.length === 1 ? '' : 's'} · first fired ${rel(f.at)} ago`)
        + `<div class="section-title"><span>Hosts</span><span>${hosts.length}</span></div>`
        + `<div class="hlist">${hosts.slice(0, 40).map(h => { const d = D.deviceById(h) || D.deviceById(String(h).toLowerCase()), al = d?.alerts?.find(a => a.name === m.name);
          const ts = d ? ALLT().filter(t => t.device === d.id) : [];
          const sub = [d?.rack && `Rack <b class="mono">${esc(d.rack)}</b>${d.u ? ` · U${esc(d.u)}` : ''}`, al?.since && `<span class="muted">since ${rel(al.since)} ago</span>`,
            ts.length ? ts.slice(0, 3).map(t => `<a class="tagchip" data-ticket="${esc(t.key)}" title="${esc(t.summary)}">${esc(t.key)}</a>`).join(' ') : '<span class="muted">no open ticket</span>', yardChip(h).trim()].filter(Boolean);
          return `<div class="hrow"><div class="hrow-top">${d ? `<a data-open="device:${esc(d.id)}" class="mono">${esc(h)}</a>` : `<span class="mono">${esc(h)}</span>`}<span class="hrow-what">${esc(m.name || '')}${al?.gpu ? ` · GPU ${esc(al.gpu)}` : ''}</span></div>
            <div class="hrow-sub">${sub.map(v => `<span>${v}</span>`).join('<span class="hdot">·</span>')}</div></div>`; }).join('')}</div>`;
      links = `${s?.gf?.url ? btn('Site health in Grafana', s.gf.url, true) : ''}${s ? `<button class="btn" data-site="${esc(s.id)}">Site card</button>` : ''}`;
    } else if (f.src === 'atium') {
      const b = m.build || {}, ms = m.milestone || {}, dep = b.deploymentKey && D.deploymentByKey?.(b.deploymentKey);
      body = head(esc(`${ms.name || 'Milestone'} done · ${b.name || ''}`), [b.customer, b.site].filter(Boolean).map(esc).join(' · '))
        + kv([['Build', esc(b.name || '')], ['Milestone', esc(ms.name || '')], ['Done', ms.done ? esc(fmtDate(Date.parse(ms.done))) : ''], ['Next', b.next ? `${esc(b.next.name)}${b.next.at ? ` · due ${fmtDate(b.next.at)}` : ''}${b.late ? ' <span class="st-warning">late</span>' : ''}` : ''],
          ['Racked', b.rackedPct != null ? pct(b.rackedPct) : ''], ['Validated', b.validatedPct != null ? pct(b.validatedPct) : ''], ['Hand-off', b.handoff?.at ? fmtDate(b.handoff.at) + (b.handoff.done ? ' (done)' : '') : '']]);
      links = `${dep ? `<button class="btn primary" data-dep="${esc(dep.key)}">Deployment details</button>` : ''}${b.url ? btn('Open in Atium', b.url, !dep) : ''}${b.site ? `<button class="btn" data-site="${esc(b.site)}">Site card</button>` : ''}`;
    } else if (f.src === 'netsuite') {
      const dep = m.deploymentKey && D.deploymentByKey?.(m.deploymentKey);
      body = head(esc(`${m.doc || ''} · ${m.type || 'Movement'}`), esc([m.deployment, m.site].filter(Boolean).join(' · ')))
        + kv([['Document', `<span class="mono">${esc(m.doc || '')}</span>`], ['Type', esc(m.type || '')], ['Status', esc(m.status || '')], ['Date', esc(m.date || (m.at ? fmtDate(m.at) : ''))],
          ['From', esc(m.from || '')], ['To', esc(m.to || m.dcLoc || '')], ['Deployment', dep ? `<a data-dep="${esc(dep.key)}">${esc(dep.key)} · ${esc(dep.title)}</a>` : esc(m.deployment || '')],
          ['Site', m.site ? `<a data-open="site:${esc(m.site)}">${esc(m.site)}</a>` : ''], ['RMA', m.rma && !/^no$/i.test(m.rma) ? esc(m.rma) : ''], ['Tracking', m.tracking ? `<span class="mono">${esc(m.tracking)}</span>` : '']]);
      links = `${dep ? `<button class="btn primary" data-dep="${esc(dep.key)}">Deployment details</button>` : ''}${m.url ? btn('Open in NetSuite', m.url, !dep) : D.LINKS?.netsuite ? btn('NetSuite', D.LINKS.netsuite) : ''}${m.site ? `<button class="btn" data-site="${esc(m.site)}">Site card</button>` : ''}`;
    } else if (f.src === 'slack') {
      const ch = (D.CHANNELS || []).find(c => c.id === m.channelId);
      body = head(esc(m.isDm ? `Direct message from ${m.user || 'someone'}` : `#${m.channel || ''} · ${m.user || ''}`), '')
        + `<div class="feed-msg">${esc(m.text || f.text)}</div>`
        + kv([['From', esc(m.user || '')], ['Where', m.isDm ? 'Direct message' : `#${esc(m.channel || '')}`], ['Channel is about', ch ? [ch.site && `<a data-open="site:${esc(ch.site)}">${esc(ch.site)}</a>`, ch.deployment && `<a data-dep="${esc(ch.deployment)}">${esc(ch.deployment)}</a>`].filter(Boolean).join(' · ') : '']]);
      links = btn('Open in Slack', m.link || f.url, true);
    } else if (f.src === 'mail') {
      body = head(esc(m.title || f.text), '')
        + kv([['From', `${esc(m.from || '')}${m.fromEmail ? ` <span class="muted">&lt;${esc(m.fromEmail)}&gt;</span>` : ''}`], ['Received', esc(when.toLocaleString())]])
        + (m.summary ? `<div class="feed-msg">${esc(m.summary)}${m.summary.length >= 240 ? '…' : ''}</div>` : '');
      links = btn('Open in Gmail', m.link || f.url, true);
    } else {
      body = head(esc(f.text), '');
      links = f.url ? btn('Open', f.url, true) : '';
    }
    extra = linksIn(`${f.text} ${m.text || ''} ${m.summary || ''}`);
    Drawer.open(`${body}${linked(extra)}<div class="links">${links}</div>`);
  }
  $('#feed').addEventListener('click', e => {
    if (e.target.closest('a,button')) return;
    const li = e.target.closest('[data-feed]'); const f = li && feedById.get(+li.dataset.feed); if (f) openFeed(f);
  });
  $('#feed').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('[data-feed]'); const f = li && feedById.get(+li.dataset.feed); if (f) { e.preventDefault(); openFeed(f); }
  });
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
      const fset = vsSet(VS('globe'));
      let pts = fset ? placed.filter(s => fset.has(s.id)) : placed.filter(s => s.kind === 'dc' && s.health !== 'idle');
      if (!pts.length) pts = placed;
      if (!pts.length) return { lon: -98, lat: 38, zoom: 1 };
      const v = [0, 0, 0];
      pts.forEach(s => { const g = geo(s.lat, s.lon), w = Math.sqrt((s.devices || 0) + 1); v[0] += g[0] * w; v[1] += g[1] * w; v[2] += g[2] * w; });
      const n = Math.hypot(...v) || 1, c = v.map(x => x / n);
      const lat = Math.asin(c[2]) / DEG, lon = Math.atan2(c[1], c[0]) / DEG;
      const spread = Math.max(...pts.map(s => { const g = geo(s.lat, s.lon); return Math.acos(Math.min(1, g[0] * c[0] + g[1] * c[1] + g[2] * c[2])); }));
      return { lon, lat, zoom: Math.max(1, Math.min(fset ? 5 : 2.6, 0.92 / Math.sin(Math.min(spread + 0.1, 1.45)))) };
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
    const homeBox = () => { const fset = vsSet(VS('globe')); return fitBox(placed.filter(s => fset ? fset.has(s.id) : s.kind === 'dc' && s.health !== 'idle')); };

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

  /* ---------------- "All sites / Your sites" switch for the Second brain and Deployments ---------------- */
  // Works inside whatever the top-bar site picker shows; "Your sites" is the same list as the picker's (Jira history,
  // deployments assigned to you, and the sites you starred). Each view remembers its own choice.
  /* ---------------- Second brain (neurons) ---------------- */
  // Everything linked, drawn as a neural net: glowing somas, curved dendrites, and signals firing along them.
  // Hot nodes (breached tickets, deployments at risk, fresh Slack mentions) fire more often.
  const Brain = (() => {
    const cv = $('#graph'), ctx = cv.getContext('2d');
    let w = 1, h = 1, dpr = 1, alpha = 1, hover = null, pinned = null, dragNode = null, pan = null, warmed = false, lastFrame = 0;
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
      cluster: { r: 5, label: 'Yard cluster', shape: 'diamond', color: '#8bd17c' },
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
    // With the site picker set, only those sites (and what hangs off them) are in the brain; "Your sites" narrows it further.
    let bscope = VS('graph');
    const inScope = id => vsHas(bscope)(id);
    const anyIn = arr => (arr || []).some(inScope);
    const siteNode = (id, any = false) => { const s = (any || inScope(id)) && (D.ALL || D).siteById(id); return s ? add('site:' + s.id, 'site', s.id, s, s.health === 'critical' ? 0.6 : s.health === 'warning' ? 0.3 : 0) : null; };
    const person = (id, name) => id ? add('person:' + id, 'person', id === 'me' ? 'You' : name, D.personById(id)) : null;
    const hot = h => h === 'critical' ? 1 : h === 'warning' ? 0.5 : 0;

    function build() {
    const S = vsData(bscope), narrow = vsEff(bscope) !== 'all';
    nodes.length = 0; edges.length = 0; byId.clear(); pulses.length = 0; seed = 7; hover = null; dragNode = null;
    S.SITES.filter(s => narrow ? inScope(s.id) : s.kind === 'dc' && s.health !== 'idle').forEach(s => siteNode(s.id));
    for (const p of (S.PROJECTS || []).filter(p => !narrow || anyIn(p.sites))) add('proj:' + p.key, 'project', p.title || p.key, p, hot(p.health));
    for (const d of (S.DEPLOYMENTS || []).filter(d => !narrow || anyIn(d.sites))) {
      const n = add('dep:' + d.key, 'deployment', d.site ? `${d.site} ${d.gpus ? d.gpus.toLocaleString() + '×' + d.gpuModel : d.key}` : d.key, d, hot(d.health));
      if (d.project) link(n, byId.get('proj:' + d.project.key));
      d.sites.forEach(c => link(n, siteNode(c)));
      link(n, person(d.assignee, d.assigneeName));
      for (const c of d.channels || []) link(n, add('chan:' + c.id, 'channel', '#' + c.name, c));
    }
    const urgent = S.TICKETS.filter(t => !narrow || inScope(t.site)).sort(byUrgency).slice(0, 180);
    for (const t of urgent) ticketNode(t);
    for (const c of D.CHANNELS || []) if (c.site && byId.has('site:' + c.site)) link(add('chan:' + c.id, 'channel', '#' + c.name, c), byId.get('site:' + c.site));
    for (const m of D.MENTIONS || []) { const n = byId.get('chan:' + m.channelId); if (n && m.at > Date.now() - 864e5) n.heat = Math.max(n.heat, 0.8); }
    const soon = Date.now() + 3 * 864e5;
    for (const e of (D.EVENTS || []).filter(e => e.at < soon)) {
      if (!e.deployment && !e.site) continue;
      if (narrow && !(e.deployment && byId.has('dep:' + e.deployment)) && !(e.site && inScope(e.site))) continue;
      const n = add('ev:' + e.title + e.at, 'event', e.title.length > 28 ? e.title.slice(0, 27) + '…' : e.title, e);
      link(n, e.deployment ? byId.get('dep:' + e.deployment) : siteNode(e.site));
    }
    }
    // A ticket and what hangs off it (device, site, Yard cluster, assignee, part). any = also outside the site picker.
    function ticketNode(t, any = false) {
      const n = add('tk:' + t.key, 'ticket', t.key, t, slaStatus(t) === 'critical' ? 0.7 : slaStatus(t) === 'serious' ? 0.4 : 0);
      const dev = D.deviceById(t.device), site = siteNode(t.site, any);
      const dn = dev ? add('dev:' + dev.id, 'device', dev.id, dev) : null;
      if (dn) { link(dn, site); link(n, dn); }
      link(n, site);
      const y = yardUsable() && yardOf(t.device);
      if (y?.found && y.region) { const cn = add('cl:' + String(y.region).toLowerCase(), 'cluster', String(y.region).toUpperCase(), { id: String(y.region).toLowerCase(), site: t.site }); link(n, cn); link(cn, site); if (dn) link(dn, cn); }
      if (t.assignee) link(n, person(t.assignee, D.personById(t.assignee).name));
      if (t.part) { const p = D.partById(t.part); if (p) link(n, add('part:' + p.id, 'part', p.name !== p.pn ? p.name : p.pn, p)); }
      return n;
    }
    build();
    // "Show in Second brain" from a card: make sure the item is in the graph (it may be outside the 180 most urgent
    // tickets or the site picker), place anything new next to its neighbours, then pin it, so it and everything linked
    // to it stay lit, and centre on it. Clicking empty space unpins.
    function ensure(kind, r) {
      const id = { ticket: 'tk:' + r.key, device: 'dev:' + r.id, deployment: 'dep:' + r.key, part: 'part:' + r.id, site: 'site:' + r.id, cluster: 'cl:' + r.id, project: 'proj:' + r.key, person: 'person:' + r.id }[kind];
      if (!id || byId.has(id)) return byId.get(id);
      const before = nodes.length;
      if (kind === 'ticket') ticketNode(r, true);
      else if (kind === 'device' || kind === 'part' || kind === 'person') {
        for (const t of ALLT().filter(t => (kind === 'device' ? t.device : kind === 'part' ? t.part : t.assignee) === r.id).sort(byUrgency).slice(0, 40)) ticketNode(t, true);
        if (kind === 'device' && !byId.has(id)) link(add(id, 'device', r.id, r), siteNode(r.site, true));
        if (kind === 'part' && !byId.has(id)) add(id, 'part', r.name !== r.pn ? r.name : r.pn, r);
        if (kind === 'person' && !byId.has(id)) person(r.id, r.name);
      } else if (kind === 'deployment') {
        const n = add(id, 'deployment', r.key, r, hot(r.health));
        r.sites.forEach(c => link(n, siteNode(c, true))); link(n, person(r.assignee, r.assigneeName));
        if (r.project) link(n, byId.get('proj:' + r.project.key));
        for (const c of r.channels || []) link(n, add('chan:' + c.id, 'channel', '#' + c.name, c));
      } else if (kind === 'site') siteNode(r.id, true);
      else if (kind === 'cluster') { const n = add(id, 'cluster', String(r.id).toUpperCase(), r); if (r.site) link(n, siteNode(r.site, true)); }
      else if (kind === 'project') add(id, 'project', r.title || r.key, r, hot(r.health));
      for (const n of nodes.slice(before)) { const nb = [...n.nb].find(x => nodes.indexOf(x) < before); if (nb) { n.x = nb.x + (rnd() - 0.5) * 40; n.y = nb.y + (rnd() - 0.5) * 40; n.z = nb.z; } }
      return byId.get(id);
    }
    function focusOn(kind, r) {
      if (!warmed) { for (let i = 0; i < 320; i++) tick(); warmed = true; fit(); }
      const n = ensure(kind, r); if (!n) return false;
      alpha = Math.max(alpha, 0.25); for (let i = 0; i < 80; i++) tick();
      pinned = n; n.fire = 1; for (let i = 0; i < 4; i++) spawn(n);
      project(); view.k = Math.max(view.k, 1.6); view.x = -n.X * view.k; view.y = -n.Y * view.k;
      return true;
    }

    function resize() { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; w = r.width || 1; h = r.height || 1; cv.width = w * dpr; cv.height = h * dpr; }
    new ResizeObserver(resize).observe(cv);
    const visible = n => !hidden.has(n.type) || (pinned && (n === pinned || pinned.nb.has(n)));

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
      const focus = hover || pinned, lit = n => !focus || n === focus || focus.nb.has(n);

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
      if (n.type === 'person') return `<b>${esc(r.name)}</b><span>${ALLT().filter(t => t.assignee === r.id).length} tickets · ${(D.DEPLOYMENTS || []).filter(d => d.assigneeId === r.id || (r.id === 'me' && d.mine)).length} deployments</span>`;
      if (n.type === 'deployment') return `<b>${r.key} · ${esc(r.title)}</b>${statusChip(r.health, depStatus(r))}<br><span>${pct(r.progress)} done · due ${fmtDate(r.end)} · ${esc(r.sites.join(', ') || '?')}</span>`;
      if (n.type === 'project') return `<b>${r.key} · ${esc(r.title)}</b>${statusChip(r.health, r.status)}<br><span>${r.deployments.length} deployments</span>`;
      if (n.type === 'channel') return `<b>#${esc(r.name)}</b><span>Slack · ${r.members} members</span>`;
      if (n.type === 'cluster') { const hs = Object.values(D.YARD?.hosts || {}).filter(y => y?.found && String(y.region).toLowerCase() === r.id);
        return `<b>${esc(n.label)}</b><span>Yard cluster · ${hs.length} hosts checked · ${hs.filter(y => y.lockedBy).length} locked</span>`; }
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
      else if (p && !p.node && p.moved < 6) pinned = null;
    });
    cv.addEventListener('pointerleave', () => { hover = null; hideTip(); });
    cv.addEventListener('dblclick', fit);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const [x, y] = at(e), [wx, wy] = toWorld(x, y);
      view.k = Math.max(0.15, Math.min(5, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = x - w / 2 - wx * view.k; view.y = y - h / 2 - wy * view.k;
    }, { passive: false });

    return {
      draw, resize, fit, focusOn, TYPES, nodeCount: () => nodes.filter(visible).length, pinned: () => pinned?.id || null,
      is3d: () => mode3d,
      set3d: on => { if (on === mode3d) return; mode3d = on; try { localStorage.setItem('lambdaos-brain3d', on ? '1' : '0'); } catch { /* ignore */ }
        alpha = Math.max(alpha, 0.5); for (let i = 0; i < 120; i++) tick(); fit(); },
      counts: () => Object.fromEntries(Object.keys(TYPES).map(k => [k, nodes.filter(n => n.type === k).length])),
      scope: () => bscope, setScope: v => { if (v === bscope) return; bscope = v; setVS('graph', v); pinned = null; build(); alpha = 1; warmed = false; },
      isHidden: k => hidden.has(k), toggle: k => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); hover = null; return !hidden.has(k); },
    };
  })();

  /* ---------------- Deployments timeline ---------------- */
  /* ---------------- Site health (fleet-wide, from Grafana) ---------------- */
  // Every site against the "Site Health" board checks in one table; worst sites first. Click a number for the exact
  // hosts, racks and U positions. Leaks and newly tripped breakers are the ones to act on now.
  const Health = (() => {
    let scope = VS('health'), onlyProblems = false; // follows the top picker until you pick here
    try { onlyProblems = localStorage.getItem('lambdaos-health-problems') === '1'; } catch { /* ignore */ }
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
      const H = vsData(scope).HEALTH; if (!H) return [];
      let list = H.sites.filter(s => vsHas(scope)(s.code));
      return onlyProblems ? list.filter(s => s.level === 'critical' || s.level === 'warning') : list;
    }
    function render() {
      const H = D.HEALTH, box = $('#health');
      const urgentN = H ? H.sites.reduce((t, s) => t + s.checks.leak.n + s.checks.breaker.fresh, 0) : 0; // only the sites the picker shows
      $('#healthBadge').hidden = !urgentN; $('#healthBadge').textContent = urgentN || '';
      if (activeView !== 'health') return;
      if (!H && isLoading('grafana')) { box.innerHTML = `<div class="hempty"><h3>Site health</h3>${loadingLine('grafana', 'every site\'s health checks', 'p')}</div>`; return; }
      if (!H) { box.innerHTML = `<div class="hempty"><h3>Site health</h3><p class="muted">Leaks, tripped breakers, PDU alarms, power shelves, hardware faults, hot inlets, network devices down and monitoring gaps for every site come from Grafana. Turn on <b>Grafana</b> in Settings → Sources and sign in to grafana.aws.lambdalabs.cloud once.</p></div>`; return; }
      const sites = sitesShown(), mine = new Set((D.ALL || D).yourSites ? (D.ALL || D).yourSites() : LambdaAlerts.mySites(D));
      const sum = k => sites.reduce((t, s) => t + (s.checks[k].n || 0), 0), fresh = sites.reduce((t, s) => t + s.checks.breaker.fresh, 0);
      const chip = (k, label, cls) => `<span class="hsum ${cls}"><b>${k}</b>${label}</span>`;
      const errs = Object.keys(H.errors || {});
      box.innerHTML = `<div class="hhead">
          <div class="hsums">${chip(sum('leak'), 'leaks', sum('leak') ? 'crit' : 'ok')}${chip(fresh, 'breakers newly tripped', fresh ? 'crit' : 'ok')}${chip(sum('pdu'), 'PDU alarms', sum('pdu') ? 'warn' : 'ok')}${chip(sum('shelf'), 'shelf PSUs at 0 W', sum('shelf') ? 'warn' : 'ok')}${chip(sum('hw'), 'hosts with HW faults', sum('hw') ? 'warn' : 'ok')}${chip(sum('net'), 'network devices down', sum('net') ? 'warn' : 'ok')}</div>
          <div class="hctl">${scopeSeg('health', scope) || '<span class="seg"><button class="chip on">All sites</button></span>'}
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
      const s = (D.ALL || D).HEALTH?.sites.find(x => x.code === code); if (!s) return;
      const c = s.checks[k], items = k === 'hot' ? (c.items.length ? c.items : [c.top].filter(Boolean)) : c.items;
      const host = x => { const dv = x.h && D.deviceById(x.h); return dv ? `<a data-open="device:${esc(dv.id)}" class="mono">${esc(x.h)}</a>` : `<span class="mono">${esc(x.h || '—')}</span>`; };
      const what = x => k === 'hot' ? `<b class="st-${x.v >= x.crit ? 'critical' : x.v >= x.warn ? 'warning' : 'good'}">${x.v.toFixed(1)} °C</b> ${esc(x.kind)}` : esc(x.w || '');
      const extra = k === 'blind' && c.n > c.items.length ? `<p class="muted small">Showing ${c.items.length} of ${c.n}. By type: ${Object.entries(c.byJob).map(([j, v]) => `${esc(j)} ${v}`).join(' · ')}</p>` : '';
      // One row per host: host and what's wrong on top; where it is, since when, its open tickets and Yard state below.
      const tk = new Map(); for (const t of ALLT()) if (t.device) { const h = String(t.device).toLowerCase(); (tk.get(h) || tk.set(h, []).get(h)).push(t); }
      const sinceTxt = x => x.since ? `since ${rel(x.since) === 'now' ? 'just now' : rel(x.since) + ' ago'}` : k === 'leak' || k === 'breaker' || k === 'shelf' ? 'already before Lambda OS looked' : '';
      const servers = k === 'hw' || k === 'hot'; // PDUs, breakers, shelves and switches aren't Yard hosts and rarely have tickets
      const yOn = servers && D.YARD && yardUsable();
      const byWhat = k !== 'hot' ? Object.entries(items.reduce((a, x) => (x.w && (a[x.w] = (a[x.w] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]) : [];
      const rows = items.slice(0, 300).map((x, i) => {
        const ts = x.h ? tk.get(String(x.h).toLowerCase()) || [] : [];
        const where = [x.r && `Rack <b class="mono">${esc(x.r)}</b>`, x.u && `U${esc(String(x.u).replace(/\.0$/, ''))}`].filter(Boolean).join(' · ');
        return `<div class="hrow"><div class="hrow-top">${host(x)}<span class="hrow-what">${what(x) || '<span class="muted">—</span>'}</span></div>
          <div class="hrow-sub">${[where, sinceTxt(x) && `<span class="muted">${sinceTxt(x)}</span>`,
            ts.length ? ts.slice(0, 3).map(t => `<a class="tagchip" data-ticket="${esc(t.key)}" title="${esc(t.summary)}">${esc(t.key)}</a>`).join(' ') + (ts.length > 3 ? ` <span class="muted">+${ts.length - 3}</span>` : '') : x.h && servers ? '<span class="muted">no open ticket</span>' : '',
            yOn && x.h && i < 80 ? yardChip(x.h).trim() : ''].filter(Boolean).map(v => `<span>${v}</span>`).join('<span class="hdot">·</span>')}</div></div>`;
      }).join('');
      Drawer.open(`<div class="qkey">${esc(code)} · SITE HEALTH · GRAFANA</div><h3>${esc(TITLES[k])} <span class="muted">(${k === 'hot' ? items.length : c.n})</span></h3>${extra}
        ${byWhat.length > 1 ? `<div class="hsummary">${byWhat.slice(0, 8).map(([w, n]) => `<span><b>${n}</b> ${esc(w)}</span>`).join('')}</div>` : ''}
        <div class="hlist">${rows || '<p class="muted">No hosts listed.</p>'}</div>
        ${items.length > 300 ? `<p class="muted small">+${items.length - 300} more</p>` : ''}
        <div class="links">${s.board ? btn('Site health in Grafana', s.board, true) : ''}${s.site ? `<button class="btn" data-site="${esc(code)}">Site card</button>` : ''}</div>`);
    }
    $('#health').addEventListener('click', e => {
      const c = e.target.closest('[data-hcell]'); if (c) { const [code, k] = c.dataset.hcell.split('|'); return detail(code, k); }
      const sc = e.target.closest('[data-vscope^="health:"]'); if (sc) { scope = sc.dataset.vscope.slice(7); setVS('health', scope); return render(); }
      if (e.target.closest('[data-hproblems]')) { onlyProblems = !onlyProblems; try { localStorage.setItem('lambdaos-health-problems', onlyProblems ? '1' : '0'); } catch { /* ignore */ } return render(); }
    });
    return { render, detail };
  })();

  document.addEventListener('click', e => { const c = e.target.closest('#siteCard [data-hcell]'); if (c) { const [code, k] = c.dataset.hcell.split('|'); Health.detail(code, k); } });

  const Deploys = (() => {
    const el = $('#deploys');
    let filter = 'all', tag = 'all', dscope = VS('deploys');
    const DAY = 864e5;
    function render() {
      const all = (vsData(dscope).DEPLOYMENTS || []).filter(d => vsEff(dscope) === 'all' || d.sites.some(vsHas(dscope))), now = Date.now();
      if (!(D.DEPLOYMENTS || []).length && isLoading('jira')) { el.innerHTML = loadingLine('jira', 'deployments', 'div'); return; }
      if (!(D.DEPLOYMENTS || []).length) {
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
      const maints = filter === 'all' && tag === 'all' ? (vsData(dscope).MAINT || D.MAINT || []).filter(m => m.state !== 'done' && (vsEff(dscope) === 'all' || !m.sites.length || m.sites.some(vsHas(dscope)))) : [];
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
          ${scopeSeg('deploys', dscope)}${MINE.size ? '<span class="dsep"></span>' : ''}
          ${[['all', 'All', all.length], ['tracking', '★ Tracking', all.filter(d => D.isTracked(d.key) || d.mine).length], ['risk', 'At risk', all.filter(d => ['critical', 'warning'].includes(d.health)).length]].map(([k, l, n]) => `<button class="chip ${filter === k ? 'on' : ''}" data-dfilter="${k}">${l} <small>${n}</small></button>`).join('')}
          <span class="dsep"></span>
          ${['all', ...tags].map(t => `<button class="chip ${tag === t ? 'on' : ''}" data-dtag="${esc(t)}">${t === 'all' ? 'Every type' : esc(t)}</button>`).join('')}
        </div>
        <div class="dgrid">
          <div class="dhead"><span></span><div class="dtrack">${months.map((t, i) => i % everyN ? '' : `<span class="dmonth" style="left:${X(t)}%">${new Date(t).toLocaleDateString([], { month: 'short', ...(new Date(t).getMonth() === 0 ? { year: '2-digit' } : {}) })}</span>`).join('')}
            <span class="dtoday" style="left:${X(now)}%"><em>today</em></span></div></div>
          ${maints.length ? `<div class="dgroup"><span>🛠 Maintenance windows · Jira MAINT</span><small class="muted">${maints.length}</small></div>` + maints.map(m => {
            const st = m.start || Date.now(), en = Math.max(m.end || st + 3600e3, st + 3600e3);
            return `<div class="drow" data-maint="${esc(m.key)}"><div class="dinfo"><span class="mstar">🛠</span><div style="min-width:0"><div class="dtitle">${m.emergency ? '<b class="st-critical">EMERGENCY</b> · ' : ''}${esc(m.summary.replace(/^EMERGENCY:\s*/i, ''))}</div>
              <div class="dmeta">${statusChip(maintTone(m), maintWhen(m))} · <span class="mono">${esc(m.key)}</span>${m.sites.map(c => ` · <b>${esc(c)}</b>`).join('')}</div></div></div>
              <div class="dtrack">${months.map(t => `<span class="dgridline" style="left:${X(t)}%"></span>`).join('')}<span class="dtoday" style="left:${X(now)}%"></span>
                <span class="dbar mbar" style="left:${X(st)}%;width:${Math.max(0.8, X(en) - X(st))}%;--c:${C[maintTone(m)] || C.accent}" title="${esc(`${m.key}: ${maintWhen(m)}`)}"></span></div></div>`; }).join('') : ''}
          ${[...groups].map(([g, ds]) => {
            const p = D.projectByKey(g);
            const head = g === 'CI' ? 'Cluster Intake' : p ? `${p.key} · ${p.title}` : 'No parent project';
            return `<div class="dgroup" ${p ? `data-proj="${p.key}"` : ''}><span>${esc(head)}</span>${p ? statusChip(p.health, p.status) : ''}<small class="muted">${ds.length}</small></div>`
              + ds.map(d => `<div class="drow" data-dep="${d.key}">
                <div class="dinfo">${star(d)}<div style="min-width:0"><div class="dtitle">${esc(d.title)}</div>
                  <div class="dmeta"><span class="mono">${d.key}</span>${d.sites.map(c => ` · <b>${esc(c)}</b>`).join('')}${d.gpus ? ` · ${d.gpus.toLocaleString()}×${esc(d.gpuModel)}` : ''} · ${statusChip(d.health, depStatus(d))}</div></div></div>
                <div class="dtrack">${months.map(t => `<span class="dgridline" style="left:${X(t)}%"></span>`).join('')}<span class="dtoday" style="left:${X(now)}%"></span>${bar(d)}</div></div>`).join('');
          }).join('')}
          ${list.length ? '' : `<div class="dempty muted">${vsEff(dscope) !== 'all' && !all.length ? 'No deployments at these sites. Switch to All sites to see the rest.' : 'Nothing matches this filter.'}</div>`}
        </div>`;
    }
    el.addEventListener('click', e => {
      const f = e.target.closest('[data-dfilter]'), t = e.target.closest('[data-dtag]');
      if (f) { filter = f.dataset.dfilter; render(); e.stopPropagation(); }
      if (t) { tag = t.dataset.dtag; render(); e.stopPropagation(); }
      const sc = e.target.closest('[data-vscope]');
      if (sc?.dataset.vscope.startsWith('deploys:')) { dscope = sc.dataset.vscope.slice(8); setVS('deploys', dscope); render(); e.stopPropagation(); }
    });
    return { render, setFilter: f => { filter = f; render(); } };
  })();

  /* ---------------- Stage tabs, legends, globe controls ---------------- */
  /* ---------------- Trace: one item's history on a timeline ----------------
     Pick a ticket, host, serial, part or deployment (⏱ Trace on its card, the search box here, or T). Everything that
     happened to it is drawn in lanes, one per app, on a time axis you can zoom (scroll) and drag:
       Jira: the ticket's life (created → resolved), every status / assignee change and comment, and every other ticket
             ever filed on the same host or serial (closed ones too);  Service desks: RMA, Shipping, Warehouse… requests
             that mention it;  NetBox: when the device was added, changes to it and its parts, its journal;  Grafana:
             alerts on it;  Yard: its state now;  Slack: messages about it;  Atium / NetSuite / Meetings for deployments.
     The left column lists what's related (the device, chassis and nodes, other tickets, RMAs, parts…): tick one to add
     its history to the same timeline, or click its name to trace it instead. The trail at the top steps back.
     Read with your own sign-ins only when you open Trace; nothing is stored. */
  const Trace = (() => {
    const box = $('#trace');
    const LANES = [
      ['jira', 'Jira', 'var(--src-jira)'], ['desk', 'Service desks', '#d9a23a'], ['netbox', 'NetBox', 'var(--src-netbox)'], ['grafana', 'Grafana', '#f46800'],
      ['yard', 'Yard', '#8bd17c'], ['slack', 'Slack', 'var(--src-slack)'], ['mail', 'Gmail', 'var(--src-mail)'], ['maint', 'Maintenance', '#c792ea'], ['atium', 'Atium', 'var(--accent)'], ['netsuite', 'NetSuite', 'var(--src-netsuite)'], ['meet', 'Meetings', '#a7a6a0'],
    ];
    const LANE = Object.fromEntries(LANES.map(([k, l, c]) => [k, { label: l, color: c }]));
    const DAY = 864e5, PRESETS = [['7d', 7], ['30d', 30], ['90d', 90], ['1y', 365]];
    let subject = null, trail = [], ticked = new Set(), range = null, selected = null, auto = 'all', lastEvs = [];
    const items = new Map(); // id → { kind, id, label, events: [], related: [], status: {lane: text}, loading }
    const idOf = (kind, id) => `${kind}:${id}`;
    try { const s = JSON.parse(sessionStorage.getItem('lambdaos-trace') || 'null'); if (s?.kind) subject = s; } catch { /* ignore */ }
    const save = () => { try { sessionStorage.setItem('lambdaos-trace', JSON.stringify(subject)); } catch { /* ignore */ } };
    const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: new Date(t).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
    const ago = t => { const r = rel(t); return r === 'now' ? 'just now' : t > Date.now() ? `in ${rel(2 * Date.now() - t)}` : `${r} ago`; };
    const isKey = q => /^[A-Z][A-Z0-9]+-\d+$/i.test(q);

    // What a search or a card points at.
    function resolve(q) {
      q = String(q || '').trim(); if (!q) return null;
      const dep = D.deploymentByKey?.(q.toUpperCase()); if (dep) return { kind: 'deployment', id: dep.key, label: dep.title || dep.key };
      if (isKey(q)) { const t = D.ticketByKey(q.toUpperCase()); return { kind: 'ticket', id: q.toUpperCase(), label: t?.summary || q.toUpperCase() }; }
      const dev = D.deviceById(q) || D.deviceById(q.toLowerCase()); if (dev) return { kind: 'device', id: dev.id, label: dev.model };
      const part = D.partById(q) || D.PARTS.find(p => p.pn.toLowerCase() === q.toLowerCase()); if (part) return { kind: 'part', id: part.id, label: partLabel(part) };
      const host = /^[a-z]{3}\d\d[a-z0-9]*(-[a-z0-9]+){2,}$/i.test(q); return { kind: host ? 'device' : 'term', id: host ? q.toLowerCase() : q, label: host ? 'Host' : 'Search term' };
    }
    // inside = followed from within Trace (Related, a mark, the trail): adds to the trail. From anywhere else it's a new trace.
    function open(kind, id, { keepTrail = false, inside = false } = {}) {
      const r = kind === 'term' ? resolve(id) : { kind, id, label: '' };
      if (!r) return;
      if (!inside && !keepTrail) trail = [];
      else if (inside && subject && idOf(subject.kind, subject.id) !== idOf(r.kind, r.id)) trail = [...trail.filter(x => idOf(x.kind, x.id) !== idOf(r.kind, r.id)), subject].slice(-6);
      subject = { kind: r.kind, id: r.id }; ticked = new Set(); selected = null; range = null; auto = 'all'; save();
      if (activeView !== 'trace') setView('trace'); else render();
      load(subject);
    }

    /* ---- collecting events ---- */
    const ev = (lane, at, o) => ({ lane, at, ...o });
    function localEvents(it) {
      const out = [], rel = [];
      const ticket = it.kind === 'ticket' ? D.ticketByKey(it.id) : null;
      const host = it.kind === 'device' ? it.id : ticket?.device || null, dev = host && D.deviceById(host);
      const alerts = dev?.alerts || ticket?.alerts || [];
      for (const a of alerts) out.push(ev('grafana', a.since || Date.now(), { title: `${a.name} firing`, text: `${a.severity || ''} · ${host}${a.rack ? ` · ${a.rack}` : ''}${a.u ? ` U${a.u}` : ''}`, tone: a.severity === 'critical' ? 'critical' : 'warning', end: Date.now(), open: true }));
      // Maintenance windows on this host (or this MAINT request itself): the window as a span, the deadline as a mark.
      const mws = [...(host ? D.maintForHost?.(host) || [] : []), ...(D.maintByKey?.(it.id) ? [D.maintByKey(it.id)] : [])];
      for (const m of new Set(mws)) {
        if (m.start) out.push(ev('maint', m.start, { end: m.end, span: true, open: m.state === 'now', title: `${m.key} · ${m.type || 'Maintenance'} window`, text: `${m.summary} · ${maintWhen(m)}`, tone: maintTone(m), url: m.url, label: m.key, trace: m.key === it.id ? null : { kind: 'ticket', id: m.key } }));
        else out.push(ev('maint', m.created || Date.now(), { title: `${m.key} · ${m.emergency ? 'EMERGENCY ' : ''}${m.type || 'Maintenance'} requested`, text: `${m.summary} · ${maintWhen(m)}`, tone: maintTone(m), url: m.url }));
        if (m.deadline) out.push(ev('maint', m.deadline, { title: `${m.key} deadline`, text: m.summary, tone: 'warning', url: m.url }));
        if (m.key !== it.id) rel.push({ kind: 'ticket', id: m.key, label: m.key, sub: `${m.type || 'Maintenance'} · ${maintWhen(m)}` });
      }
      const y = host && yardUsable() && yardOf(host);
      if (y?.found) out.push(ev('yard', Date.now(), { title: `${y.state || 'state unknown'}${y.lockedBy ? ` · 🔒 ${meLock(y) ? 'you' : y.lockedBy}` : ' · not locked'}`, text: `${y.region ? String(y.region).toUpperCase() + ' · ' : ''}pool ${y.pool || '—'} · Yard shows the state now, not its history`, tone: LambdaAlerts.inProduction(y) ? 'warning' : 'good', url: yardUrl(host) }));
      if (ticket) {
        if (dev) rel.push({ kind: 'device', id: dev.id, label: dev.id, sub: `${dev.model} · ${dev.rack}${dev.u ? ' U' + dev.u : ''}` });
        if (ticket.part) { const p = D.partById(ticket.part); if (p) rel.push({ kind: 'part', id: p.id, label: partLabel(p), sub: 'part it needs' }); }
      }
      if (host) for (const t of ALLT().filter(t => t.device === host && t.key !== it.id)) rel.push({ kind: 'ticket', id: t.key, label: t.key, sub: t.summary });
      if (it.kind === 'part') for (const t of ALLT().filter(t => t.part === it.id).sort(byUrgency).slice(0, 20)) rel.push({ kind: 'ticket', id: t.key, label: t.key, sub: t.summary });
      if (it.kind === 'deployment') {
        const d = D.deploymentByKey(it.id);
        if (d) {
          if (d.start || d.end) out.push(ev('jira', d.start || d.end, { end: d.end || d.start, title: `Planned: ${fmtDate(d.start)} → ${fmtDate(d.end)}`, text: `${d.key} · ${d.title}`, tone: d.health, url: d.url, span: true }));
          for (const e of d.events || []) out.push(ev('meet', e.at, { title: e.title, text: e.allDay ? 'all day' : '', url: e.link }));
          for (const m of d.moves || []) if (m.at) out.push(ev('netsuite', m.at, { title: `${m.type} ${m.doc}`, text: [m.status, m.tracking && `tracking ${m.tracking}`].filter(Boolean).join(' · ') }));
          for (const m of d.build?.milestones || []) { const at = Date.parse((m.done || m.scheduled || '') + ((m.done || m.scheduled || '').length === 10 ? 'T12:00:00' : '')); if (at) out.push(ev('atium', at, { title: m.name, text: m.status === 'completed' ? 'completed' : `planned${at < Date.now() ? ' · late' : ''}`, tone: m.status === 'completed' ? 'good' : at < Date.now() ? 'warning' : 'idle', hollow: m.status !== 'completed', url: d.build.url })); }
          for (const w of d.workstreams || []) rel.push({ kind: 'ticket', id: w.key, label: w.key, sub: w.summary });
        }
      }
      return { out, rel };
    }
    function jiraEvents(it, res) {
      const out = [], rel = [];
      for (const i of res.issues || []) {
        const lane = /^(DC|PMO|CI)$/.test(i.project) ? 'jira' : i.project === 'MAINT' ? 'maint' : 'desk', me = i.key === it.id;
        out.push(ev(lane, i.created, { end: i.resolved || Date.now(), span: true, open: !i.resolved, title: `${i.key} · ${i.summary}`, text: `${i.projectName || i.project} · ${i.status}${i.resolved ? ` · resolved ${fmtDate(i.resolved)}` : ' · still open'}`,
          tone: i.done ? 'idle' : 'warning', url: i.url, trace: me ? null : { kind: 'ticket', id: i.key }, label: i.key, main: me }));
        for (const c of i.changes || []) out.push(ev(lane, c.at, { title: `${i.key}: ${c.field} → ${c.to || '—'}`, text: `${c.from ? `from ${c.from} · ` : ''}by ${c.who}`, url: i.url, tone: /status/i.test(c.field) && /done|closed|resolved/i.test(c.to) ? 'good' : 'idle', small: true }));
        for (const c of i.comments || []) out.push(ev(lane, c.at, { title: `${i.key}: comment by ${c.who}`, text: c.text, url: i.url, small: true, comment: true }));
        if (!me) rel.push({ kind: 'ticket', id: i.key, label: i.key, sub: `${i.summary} · ${i.status}`, desk: lane === 'desk', done: i.done });
      }
      return { out, rel };
    }
    function netboxEvents(it, res) {
      const out = [], rel = [];
      if (res.created) out.push(ev('netbox', res.created, { title: `Added to NetBox`, text: `${it.id}${res.serial ? ` · serial ${res.serial}` : ''}`, url: res.url, tone: 'good' }));
      for (const c of res.changes || []) out.push(ev('netbox', c.at, { title: c.part ? `${c.part}: ${c.action}` : `Device ${c.action === 'update' ? 'changed' : c.action}`, text: `${c.text}${c.who ? ` · by ${String(c.who).split('@')[0]}` : ''}`, url: res.url, small: true, tone: c.person ? 'idle' : 'auto' }));
      for (const j of res.journal || []) out.push(ev('netbox', j.at, { title: `Journal${j.kind ? ' · ' + j.kind : ''}`, text: `${j.text}${j.who ? ` · ${j.who}` : ''}`, url: res.url, comment: true }));
      if (res.parent) rel.push({ kind: 'device', id: res.parent.name, label: res.parent.name, sub: 'chassis it sits in' });
      for (const c of res.children || []) rel.push({ kind: 'device', id: c.name, label: c.name, sub: `installed in ${c.bay}` });
      return { out, rel, modules: res.modules || [] };
    }
    const slackEvents = res => ({ out: (res.items || []).map(m => ev('slack', m.at, { title: `${m.channel === 'DM' ? 'DM' : '#' + m.channel} · ${m.user}`, text: m.text, url: m.link, comment: true })), rel: [] });

    // Demo: a believable history so the preview shows the idea.
    function demo(it) {
      const now = Date.now(), d = n => now - n * DAY, h = n => now - n * 3600e3;
      if (it.kind === 'term' || it.kind === 'part' || it.kind === 'deployment') return { out: [
        ev('desk', d(9), { end: d(2), span: true, title: `SHP-3171 · Ship ${it.id} to site`, text: 'Shipping · Done', tone: 'idle', trace: { kind: 'ticket', id: 'SHP-3171' }, label: 'SHP-3171' }),
        ev('jira', d(12), { end: now, span: true, open: true, title: `DC-33188 · mentions ${it.id}`, text: 'Data Center Operations · In Progress · still open', tone: 'warning', trace: { kind: 'ticket', id: 'DC-33188' }, label: 'DC-33188' }),
        ev('slack', d(3), { title: '#dc-logistics · M. Ortiz', text: `${it.id} left the warehouse this morning`, comment: true }),
      ], rel: [{ kind: 'ticket', id: 'SHP-3171', label: 'SHP-3171', sub: `Ship ${it.id} to site · Done`, desk: true, done: true }, { kind: 'ticket', id: 'DC-33188', label: 'DC-33188', sub: 'mentions it · In Progress' }] };
      const t = it.kind === 'ticket' ? D.ticketByKey(it.id) : null, host = it.kind === 'device' ? it.id : t?.device || 'qro01-r101-u12';
      const key = t?.key || 'DC-33100', n = Number(key.split('-')[1]) || 33100, created = t?.created || d(4);
      const out = [
        ev('netbox', d(240), { title: 'Added to NetBox', text: `${host} · serial LMB482913`, tone: 'good' }),
        ev('netbox', d(61), { title: 'Module GPU 3: delete', text: 'serial · module_bay · by j.kim', small: true }),
        ev('netbox', d(48), { title: 'Module GPU 3: create', text: 'serial: — → 1652022008417 · by j.kim', small: true }),
        ev('netbox', h(30), { title: 'Journal · Info', text: 'Swapped GPU 3, sent old one to RMA · j.kim', comment: true }),
        ev('netbox', h(5), { title: 'Device changed', text: 'status: Active → Failed · by s.patel', small: true }),
        ev('jira', d(63), { end: d(47), span: true, title: `DC-${n - 412} · GPU fell off the bus`, text: 'Data Center Operations · Done · resolved ' + fmtDate(d(47)), tone: 'idle', trace: { kind: 'ticket', id: `DC-${n - 412}` }, label: `DC-${n - 412}` }),
        ev('jira', d(19), { end: d(17), span: true, title: `DC-${n - 155} · Node fails burn-in`, text: 'Data Center Operations · Done', tone: 'idle', trace: { kind: 'ticket', id: `DC-${n - 155}` }, label: `DC-${n - 155}` }),
        ev('jira', created, { end: now, span: true, open: true, main: true, title: `${key} · ${t?.summary || 'Node fails burn-in'}`, text: `Data Center Operations · ${t?.status || 'Open'} · still open`, tone: 'warning', label: key }),
        ev('jira', created + 3600e3, { title: `${key}: status → In Progress`, text: 'by S. Patel', small: true }),
        ev('jira', h(26), { title: `${key}: comment by J. Kim`, text: 'Reseated GPU 3, still failing DCGM diag level 3. Ordering a replacement.', comment: true, small: true }),
        ev('jira', h(20), { title: `${key}: status → Waiting for Parts`, text: 'from In Progress · by J. Kim', small: true }),
        ev('desk', d(60), { end: d(33), span: true, title: 'RMA-5918 · Return GPU 1652022008417 to vendor', text: 'RMA Request · Closed', tone: 'idle', trace: { kind: 'ticket', id: 'RMA-5918' }, label: 'RMA-5918' }),
        ev('desk', h(19), { end: now, span: true, open: true, title: 'SHP-3198 · Ship replacement GPU to ' + (t?.site || 'QRO01'), text: 'Shipping · In Transit · still open', tone: 'warning', trace: { kind: 'ticket', id: 'SHP-3198' }, label: 'SHP-3198' }),
        ev('slack', d(62), { title: '#dc-ops · S. Patel', text: `${host} dropped a GPU again, opening a ticket`, comment: true }),
        ev('slack', h(3), { title: '#hw-validation · J. Kim', text: `${host} failed burn-in again, replacement is on SHP-3198`, comment: true }),
      ];
      return { out, rel: [
        { kind: 'ticket', id: `DC-${n - 412}`, label: `DC-${n - 412}`, sub: 'GPU fell off the bus · Done', done: true },
        { kind: 'ticket', id: `DC-${n - 155}`, label: `DC-${n - 155}`, sub: 'Node fails burn-in · Done', done: true },
        { kind: 'ticket', id: 'RMA-5918', label: 'RMA-5918', sub: 'Return GPU to vendor · Closed', desk: true, done: true },
        { kind: 'ticket', id: 'SHP-3198', label: 'SHP-3198', sub: 'Ship replacement GPU · In Transit', desk: true },
        { kind: 'device', id: host.replace(/-u\d+$/, '-chassis'), label: host.replace(/-u\d+$/, '-chassis'), sub: 'chassis it sits in' },
      ] };
    }

    // Everything Lambda OS already has loaded that mentions the item: the live feed, Slack mentions, unread mail,
    // NetSuite movements (document, tracking and RMA numbers), Atium purchase orders, meetings and volunteer requests.
    const termsOf = it => {
      const t = it.kind === 'ticket' ? D.ticketByKey(it.id) : null, dev = D.deviceById(it.kind === 'device' ? it.id : t?.device || '');
      const dep = it.kind === 'deployment' ? D.deploymentByKey(it.id) : null;
      return [...new Set([it.id, t?.device, dev?.serial, dep?.key].filter(x => x && String(x).length >= 4).map(x => String(x).toLowerCase()))];
    };
    function loadedEvents(it) {
      const terms = termsOf(it), res = terms.map(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i')), has = s => { s = String(s || ''); return !!s && res.some(re => re.test(s)); };
      const out = [], rel = [], LANE_OF = { jira: 'jira', netbox: 'netbox', slack: 'slack', mail: 'mail', netsuite: 'netsuite', atium: 'atium', grafana: 'grafana' };
      for (const f of D.FEED || []) if (['grafana', 'atium'].includes(f.src) || (f.src === 'netbox' && !(D.MODE === 'live' && isExt))) if (LANE_OF[f.src] && has(f.text)) out.push(ev(LANE_OF[f.src], f.at, { title: f.text.slice(0, 120), text: 'from the live feed', url: f.url || f.meta?.url || '' }));
      for (const m of D.MENTIONS || []) if (has(m.text)) out.push(ev('slack', m.at, { title: `${m.isDm ? 'DM' : '#' + m.channel} · ${m.user}`, text: m.text, url: m.link, comment: true }));
      for (const e of D.MAIL?.entries || []) if (has(e.title) || has(e.summary)) out.push(ev('mail', e.at, { title: `${e.from}: ${e.title}`, text: e.summary, url: e.link, comment: true }));
      for (const v of D.VOLUNTEER || []) if (has(v.text)) out.push(ev('slack', v.askedAt || v.at, { title: `#${v.channel || 'slack'} · volunteers`, text: v.text, url: v.link, comment: true }));
      for (const e of D.EVENTS || []) if (has(e.title)) out.push(ev('meet', e.at, { title: e.title, url: e.link }));
      for (const m of D.MOVES || []) if (has([m.doc, m.tracking, m.rma, m.deployment, m.from, m.to].join(' '))) {
        out.push(ev('netsuite', m.at, { title: `${m.type} ${m.doc}`, text: [m.status, m.from && m.to && `${m.from} → ${m.to}`, m.tracking && `tracking ${m.tracking}`, m.rma && `RMA ${m.rma}`].filter(Boolean).join(' · '), tone: /received|delivered|closed/i.test(m.status) ? 'good' : 'idle' }));
        if (m.tracking) rel.push({ kind: 'term', id: m.tracking, label: m.tracking, sub: `tracking · ${m.doc}` });
        if (m.rma && !/^(no|none|n\/a|-+|false|0)$/i.test(String(m.rma).trim()) && String(m.rma).trim().length >= 3) rel.push(/^[A-Z]+-\d+$/i.test(m.rma) ? { kind: 'ticket', id: m.rma.toUpperCase(), label: m.rma, sub: `RMA on ${m.doc}`, desk: true } : { kind: 'term', id: m.rma, label: m.rma, sub: `RMA on ${m.doc}` });
        if (!terms.includes(String(m.doc).toLowerCase())) rel.push({ kind: 'term', id: m.doc, label: m.doc, sub: `${m.type}${m.status ? ' · ' + m.status : ''}` });
      }
      for (const st of D.SITES) for (const p of st.atium?.posLive?.pos || st.atium?.pos || []) if (has([p.name, p.supplier, p.ref].join(' '))) {
        const due = Date.parse(p.promise || p.expected || '') || 0, ps = LambdaAlerts.poState(p);
        if (due) out.push(ev('atium', due, { title: `${p.name} · ${p.supplier || 'PO'}`, text: `${st.id} · ${ps.state}${p.assets ? ` · ${p.assetsIn}/${p.assets} assets` : ''}`, hollow: ps.open, tone: ps.state === 'late' ? 'warning' : ps.open ? 'idle' : 'good', url: st.atium.posUrl }));
      }
      return { out, rel };
    }

    async function load(it) {
      const id = idOf(it.kind, it.id);
      const old = items.get(id);
      if (old && (!old.done || Date.now() - old.at < 5 * 60e3)) { render(); return; } // loading already, or fresh (5 min)
      const rec = { ...it, events: [], related: [], status: {}, modules: [], at: Date.now() }; items.set(id, rec);
      const addR = r => { for (const x of r || []) if (!rec.related.some(y => idOf(y.kind, y.id) === idOf(x.kind, x.id)) && idOf(x.kind, x.id) !== id) rec.related.push(x); };
      const take = ({ out, rel, modules }) => { rec.events.push(...out.filter(e => e.at > 946684800000 && (!e.end || e.end >= e.at)).map(e => ({ ...e, item: id }))); /* no date (or before 2000): left out */ addR(rel); if (modules) rec.modules = modules; render(); };
      const local = localEvents(rec); take(local); take(loadedEvents(rec));
      const t = it.kind === 'ticket' ? D.ticketByKey(it.id) : null, dev = D.deviceById(it.kind === 'device' ? it.id : t?.device || '');
      const host = it.kind === 'device' ? it.id : t?.device || '';
      if (D.MODE !== 'live' || !isExt) { rec.status.note = D.MODE === 'live' ? 'History is read only inside the extension.' : ''; if (D.MODE !== 'live') { await new Promise(r => setTimeout(r, 200)); take(demo(rec)); } rec.done = true; render(); return; }
      const plan = {
        ticket: { keys: [it.id], terms: [host, dev?.serial], slack: [it.id, host], nb: dev?.url, host },
        device: { keys: [], terms: [it.id, dev?.serial], slack: [it.id, dev?.serial], nb: dev?.url, host },
        deployment: { keys: [it.id], terms: [], slack: [it.id] },
        part: { keys: [], terms: [it.id], slack: [it.id] },
        term: { keys: [], terms: [it.id], slack: [it.id] },
      }[it.kind];
      const step = async (lane, fn, conv, name) => {
        rec.status[lane] = 'loading'; render();
        try { const res = await fn(); rec.status[lane] = res.off ? `${name} is off` : res.none ? `not found in ${name}` : 'ok'; if (!res.off && !res.none) take(conv(res)); }
        catch (e) { rec.status[lane] = /not signed in|sign_in/i.test(String(e.message || e)) ? `not signed in to ${name}` : `couldn't read ${name}`; }
        render();
      };
      await Promise.all([
        step('jira', () => LambdaLive.traceJira({ keys: plan.keys, terms: plan.terms }), r => jiraEvents(rec, r), 'Jira'),
        plan.nb || plan.host ? step('netbox', () => LambdaLive.traceNetbox(plan.nb, plan.host), r => netboxEvents(rec, r), 'NetBox') : null,
        plan.slack.filter(Boolean).length ? step('slack', () => LambdaLive.linkedSlack(plan.slack.filter(Boolean)), slackEvents, 'Slack') : null,
      ]);
      rec.done = true; render();
    }

    /* ---- drawing ---- */
    const shown = () => [subject && idOf(subject.kind, subject.id), ...ticked].filter(Boolean).map(id => items.get(id)).filter(Boolean);
    function allEvents() {
      const seen = new Set(), out = [];
      for (const it of shown()) for (const e of it.events) { const k = `${e.lane}|${e.at}|${e.title}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
      return out;
    }
    function fitRange(evs, all = false) {
      if (!evs.length) return { from: Date.now() - 30 * DAY, to: Date.now() + DAY };
      if (!all) { const recent = evs.filter(e => (e.end || e.at) >= Date.now() - 120 * DAY); if (recent.length) evs = recent.map(e => e.at < Date.now() - 120 * DAY ? { ...e, at: Date.now() - 120 * DAY } : e); }
      let a = Math.min(...evs.map(e => e.at)), b = Math.max(Date.now(), ...evs.map(e => e.end || e.at));
      const pad = Math.max((b - a) * 0.06, 3600e3); return { from: a - pad, to: b + pad };
    }
    function ticks(from, to) {
      const span = to - from, steps = [[3600e3, 'h'], [6 * 3600e3, 'h'], [DAY, 'd'], [2 * DAY, 'd'], [7 * DAY, 'd'], [14 * DAY, 'd'], [30 * DAY, 'm'], [91 * DAY, 'm'], [365 * DAY, 'y']];
      const [step, u] = steps.find(([s]) => span / s <= 9) || steps[steps.length - 1];
      const out = []; let t;
      if (u === 'm' || u === 'y') { const d = new Date(from); d.setDate(1); d.setHours(0, 0, 0, 0); if (u === 'y') d.setMonth(0); t = d.getTime(); }
      else { const d = new Date(from); d.setMinutes(0, 0, 0); if (u === 'd') d.setHours(0); t = d.getTime(); }
      const months = u === 'y' ? 12 : Math.round(step / (30 * DAY));
      while (t <= to && out.length < 40) {
        if (t >= from) out.push({ t, label: u === 'h' ? new Date(t).toLocaleTimeString([], { hour: 'numeric' }) + (new Date(t).getHours() === 0 ? ' ' + fmtDate(t) : '') : u === 'y' ? new Date(t).getFullYear() : u === 'm' ? new Date(t).toLocaleDateString([], { month: 'short', year: '2-digit' }) : fmtDate(t) });
        if (u === 'm' || u === 'y') { const d = new Date(t); d.setMonth(d.getMonth() + months); t = d.getTime(); } else t += step;
      }
      return out;
    }
    function laneHtml(lane, evs, x) {
      const spans = evs.filter(e => e.span).sort((a, b) => a.at - b.at), pts = evs.filter(e => !e.span).sort((a, b) => a.at - b.at);
      const rows = []; // greedy stacking so overlapping tickets don't hide each other
      for (const s of spans) { const l = x(s.at), r = x(s.end || s.at); let i = rows.findIndex(end => end < l - 0.4); if (i < 0) { i = rows.length; rows.push(0); } rows[i] = Math.max(r, l + 1.5); s._row = i; }
      const tone = e => (e.tone ? `t-${e.tone}` : '') + (Filter.test({ text: [e.title, e.text, e.label], f: { src: LANE[e.lane]?.label }, d: { age: Date.now() - e.at, updated: Date.now() - e.at }, is: {}, has: {} }) ? '' : ' f-out'), sel = e => selected && selected.at === e.at && selected.title === e.title ? 'sel' : '';
      const key = e => `data-tev="${e._i}"`;
      const pr = pts.length ? 1 : 0, H = pr * 20 + rows.length * 20 + 8;
      return `<div class="tr-lane" style="height:${Math.max(H, 30)}px;--lc:${LANE[lane].color}">
        <div class="tr-lname">${LANE[lane].label} <small>${evs.length}</small></div>
        <div class="tr-track">
          ${pts.map(e => { const p = x(e.at); return p < -1 || p > 101 ? '' : `<button type="button" class="tr-pt ${e.small ? 'small' : ''} ${e.comment ? 'cmt' : ''} ${e.hollow ? 'hollow' : ''} ${tone(e)} ${sel(e)}" style="left:${p}%;top:6px" ${key(e)} title="${esc(`${when(e.at)} · ${e.title}${e.text ? '\n' + e.text : ''}`)}"></button>`; }).join('')}
          ${spans.map(e => { const l = Math.max(x(e.at), -2), r = Math.min(x(e.end || e.at), 102); if (r < 0 || l > 100) return ''; const w = Math.max(r - l, 0.6);
            return `<button type="button" class="tr-span ${tone(e)} ${e.open ? 'open' : ''} ${e.main ? 'main' : ''} ${sel(e)}" style="left:${l}%;width:${w}%;top:${pr * 20 + 6 + e._row * 20}px" ${key(e)} title="${esc(`${when(e.at)} → ${e.open ? 'still open' : when(e.end)}\n${e.title}${e.text ? '\n' + e.text : ''}`)}">${w > 5 ? esc(e.label || e.title) : ''}</button>`; }).join('')}
        </div></div>`;
    }
    function render() {
      if (activeView !== 'trace') return;
      if (!subject) { box.innerHTML = emptyHtml(); return; }
      if (!items.has(idOf(subject.kind, subject.id))) return load(subject); // e.g. after a reload: read its history again
      const sid = idOf(subject.kind, subject.id), rec = items.get(sid) || { events: [], related: [], status: {} }, evs = allEvents();
      evs.forEach((e, i) => { e._i = i; }); lastEvs = evs;
      if (auto || !range) range = fitRange(evs, auto === 'all');
      const { from, to } = range, x = t => ((t - from) / (to - from)) * 100;
      const lanes = LANES.map(([k]) => k).filter(k => evs.some(e => e.lane === k));
      const loading = Object.entries(rec.status).filter(([, v]) => v === 'loading').map(([k]) => LANE[k]?.label || k);
      const issues = Object.entries(rec.status).filter(([k, v]) => v && v !== 'ok' && v !== 'loading' && k !== 'note').map(([, v]) => v);
      const title = (() => {
        if (subject.kind === 'ticket') { const t = D.ticketByKey(subject.id); const j = rec.events.find(e => e.main); return { code: `${subject.id} · TICKET`, name: t?.summary || j?.title?.replace(/^\S+ · /, '') || subject.id }; }
        if (subject.kind === 'device') { const d = D.deviceById(subject.id); return { code: 'DEVICE', name: subject.id, sub: d ? `${d.model} · ${d.site || ''} ${d.rack}${d.u ? ' U' + d.u : ''}` : '' }; }
        if (subject.kind === 'deployment') { const d = D.deploymentByKey(subject.id); return { code: `${subject.id} · DEPLOYMENT`, name: d?.title || subject.id }; }
        if (subject.kind === 'part') { const p = D.partById(subject.id); return { code: 'PART', name: p ? partLabel(p) : subject.id }; }
        return { code: 'SEARCH', name: `“${subject.id}”` };
      })();
      const relList = rec.related.filter(x => { const t = x.kind === 'ticket' && D.ticketByKey(x.id); return Filter.test(t ? { ...tItem(t), text: [x.label, x.sub, ...tText(t)] } : { text: [x.label, x.sub] }); }).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
      const crumbs = [...trail, subject].map((s, i, a) => i === a.length - 1 ? `<b>${esc(s.id)}</b>` : `<button type="button" class="linkish" data-tr-back="${i}">${esc(s.id)}</button>`).join(' <span class="muted">›</span> ');
      const selHtml = selected ? `<div class="tr-detail tr-pop" role="dialog" style="--lc:${LANE[selected.lane].color}"><div class="qkey">${LANE[selected.lane].label} · ${when(selected.at)}${selected.span ? ` → ${selected.open ? 'still open' : when(selected.end)}` : ''} · ${ago(selected.at)}</div>
          <b>${esc(selected.title)}</b>${selected.text ? `<p>${esc(selected.text)}</p>` : ''}
          <div class="links">${selected.url ? `<button class="btn primary" data-url="${esc(selected.url)}" data-what="${esc(LANE[selected.lane].label)}">Open in ${esc(LANE[selected.lane].label === 'Service desks' ? 'Jira' : LANE[selected.lane].label)} ↗</button>` : ''}${selected.trace ? `<button class="btn" data-tr-open="${esc(selected.trace.kind)}:${esc(selected.trace.id)}">⏱ Trace ${esc(selected.trace.id)}</button>` : ''}${selected.trace && D.ticketByKey(selected.trace.id) ? `<button class="btn" data-ticket="${esc(selected.trace.id)}">Details</button>` : ''}<button class="btn ghost" data-tr-unsel>Close</button></div></div>` : '';
      box.innerHTML = `
        <div class="tr-head">
          <div class="tr-trail">${trail.length ? crumbs : `<span class="muted">Trace</span> <span class="muted">›</span> <b>${esc(subject.id)}</b>`}</div>
          <form class="tr-search" data-tr-form><input type="search" placeholder="Trace a ticket, host, serial or part…" aria-label="Trace a ticket, host, serial or part" spellcheck="false"></form>
        </div>
        <div class="tr-title"><div><div class="qkey">${esc(title.code)}</div><h3>${esc(title.name)}</h3>${title.sub ? `<span class="muted small">${esc(title.sub)}</span>` : ''}</div>
          <div class="tr-range"><span class="seg">${PRESETS.map(([l, d]) => `<button class="chip" data-tr-range="${d}">${l}</button>`).join('')}<button class="chip ${auto === 'all' ? 'on' : ''}" data-tr-range="all" title="Its whole history (double-click the timeline)">All</button><button class="chip ${auto === true ? 'on' : ''}" data-tr-range="fit" title="The last few months of activity">Recent</button></span>
            ${subject.kind === 'ticket' && D.ticketByKey(subject.id) ? `<button class="chip" data-ticket="${esc(subject.id)}">Details</button>` : subject.kind === 'device' && D.deviceById(subject.id) ? `<button class="chip" data-open="device:${esc(subject.id)}">Details</button>` : subject.kind === 'deployment' ? `<button class="chip" data-dep="${esc(subject.id)}">Details</button>` : ''}</div></div>
        <div class="tr-body">
          <aside class="tr-rel">
            <div class="section-title"><span>Related</span><span>${relList.length}</span></div>
            ${relList.length ? relList.slice(0, 40).map(r => { const id = idOf(r.kind, r.id), on = ticked.has(id), busy = on && items.get(id) && !items.get(id).done;
              return `<div class="tr-ritem ${r.done ? 'done' : ''}"><input type="checkbox" data-tr-tick="${esc(id)}" ${on ? 'checked' : ''} aria-label="Add ${esc(r.label)} to the timeline" title="Add its history to this timeline">
                <button type="button" class="tr-rname" data-tr-open="${esc(id)}" title="Trace ${esc(r.label)} instead"><span><span class="mono">${esc(r.label)}</span>${r.desk ? ' <small class="tr-desk">service desk</small>' : ''}</span><small>${esc(r.sub || '')}</small></button>${busy ? '<span class="muted small">…</span>' : ''}</div>`; }).join('')
              : `<p class="muted small">${rec.done ? 'Nothing related found.' : 'Looking…'}</p>`}
            ${rec.modules?.length ? `<div class="section-title"><span>Installed now · NetBox</span><span>${rec.modules.length}</span></div>${rec.modules.slice(0, 24).map(m => `<div class="tr-mod"><span class="mono">${esc(m.bay)}</span> ${esc(m.type)}${m.serial ? ` <small class="mono muted">${esc(m.serial)}</small>` : ''}</div>`).join('')}` : ''}
            <p class="muted small tr-help">Tick to add its history here · click a name to trace it</p>
          </aside>
          <div class="tr-main">
            <div class="tr-axis"><div class="tr-lname"></div><div class="tr-track">${ticks(from, to).filter(k => Math.abs(x(k.t) - x(Date.now())) > 7).map(k => `<span class="tr-tick" style="left:${x(k.t)}%">${esc(String(k.label))}</span>`).join('')}${Date.now() > from && Date.now() < to ? `<span class="tr-now" style="left:${x(Date.now())}%">now</span>` : ''}</div></div>
            <div class="tr-lanes">${lanes.map(k => laneHtml(k, evs.filter(e => e.lane === k), x)).join('') || `<p class="muted tr-none">${loading.length ? 'Reading history…' : 'No history found for this yet.'}</p>`}
              ${Date.now() > from && Date.now() < to ? `<div class="tr-nowline" style="left:calc(var(--tr-lw) + (100% - var(--tr-lw)) * ${x(Date.now()) / 100})"></div>` : ''}</div>
            <div class="tr-status muted small">${loading.length ? `Reading ${loading.join(', ')}… ` : ''}${issues.length ? esc(issues.join(' · ')) + ' · ' : ''}${rec.status.note ? esc(rec.status.note) + ' · ' : ''}${evs.length} events · Ctrl/⌘ + scroll to zoom · drag to move · click a mark for details</div>
            ${selHtml}
          </div>
        </div>`;
      placePop();
    }
    // The details open as a pop-up right under the mark you clicked (and scroll into view on smaller screens).
    let freshPick = false;
    function placePop() {
      const pop = box.querySelector('.tr-pop'), main = box.querySelector('.tr-main'), mark = box.querySelector('.tr-lanes .sel');
      if (!pop || !main) return;
      if (!mark) { pop.hidden = true; return; }
      const m = main.getBoundingClientRect(), k = mark.getBoundingClientRect(), w = Math.min(420, m.width - 8);
      pop.style.width = w + 'px';
      const left = Math.max(0, Math.min(k.left + k.width / 2 - m.left - 40, m.width - w));
      pop.style.left = left + 'px'; pop.style.setProperty('--ax', Math.max(10, Math.min(k.left + k.width / 2 - m.left - left - 5, w - 20)) + 'px');
      pop.style.top = (k.bottom - m.top + 8) + 'px';
      if (freshPick) { freshPick = false; pop.scrollIntoView({ block: 'nearest' }); }
    }
    function emptyHtml() {
      const mine = ALLT().filter(t => t.mine || t.assignee === 'me').sort(byUrgency).slice(0, 6), urgent = ALLT().slice().sort(byUrgency).slice(0, 6);
      const chips = list => list.map(t => `<button class="lk" data-tr-open="ticket:${esc(t.key)}"><i class="lk-dot st-${slaStatus(t)}"></i><span class="mono">${esc(t.key)}</span> ${esc(t.summary.slice(0, 36))}</button>`).join('');
      return `<div class="tr-empty"><h3>⏱ Trace</h3><p class="muted">Everything that happened to a ticket, host, serial, part or deployment, on one timeline: Jira history and comments, every ticket ever filed on the same host, RMA and shipping requests, NetBox changes and journal, Grafana alerts, Slack messages.</p>
        <form class="tr-search big" data-tr-form><input type="search" placeholder="Ticket key, hostname, serial or part number…" aria-label="Trace a ticket, host, serial or part" spellcheck="false" autofocus></form>
        ${mine.length ? `<div class="section-title"><span>Your tickets</span></div><div class="lk-chips">${chips(mine)}</div>` : ''}
        <div class="section-title"><span>Most urgent</span></div><div class="lk-chips">${chips(urgent)}</div>
        <p class="muted small">Or right-click anything on the dashboard (a ticket, host, shipment, PO, feed item or selected text) and pick ⏱ Trace, or hover it and press T.</p></div>`;
    }

    /* ---- interaction ---- */
    box.addEventListener('submit', e => { const f = e.target.closest('[data-tr-form]'); if (!f) return; e.preventDefault(); const q = f.querySelector('input').value.trim(); if (q) open('term', q); });
    box.addEventListener('change', e => {
      const c = e.target.closest('[data-tr-tick]'); if (!c) return;
      const id = c.dataset.trTick, [kind, key] = id.split(/:(.+)/);
      if (c.checked) { ticked.add(id); auto = auto || 'all'; load({ kind, id: key }); } else { ticked.delete(id); render(); }
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-tr-open],[data-tr-back],[data-tr-range],[data-tev],[data-tr-unsel]');
      if (!b) { if (selected && !dragMoved && e.target.closest('.tr-lanes') && !e.target.closest('.tr-pop')) { selected = null; render(); } return; }
      if (b.dataset.trOpen) { const [k, id] = b.dataset.trOpen.split(/:(.+)/); return open(k, id, { inside: !!subject }); }
      if (b.dataset.trBack !== undefined) { const i = +b.dataset.trBack, to = trail[i]; trail = trail.slice(0, i); subject = null; return open(to.kind, to.id, { keepTrail: true }); }
      if (b.dataset.trRange) { if (b.dataset.trRange === 'fit') { auto = true; } else if (b.dataset.trRange === 'all') { auto = 'all'; } else { auto = false; const d = +b.dataset.trRange; range = { from: Date.now() - d * DAY, to: Date.now() + Math.max(DAY / 4, d * DAY * 0.04) }; } return render(); }
      if (b.dataset.trUnsel !== undefined) { selected = null; return render(); }
      if (b.dataset.tev !== undefined) { const e2 = lastEvs[+b.dataset.tev]; selected = selected === e2 ? null : e2; freshPick = !!selected; return render(); }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) { selected = null; e.stopPropagation(); render(); } });
    box.addEventListener('dblclick', e => {
      const s = e.target.closest('[data-tev]'); if (s) { const e2 = lastEvs[+s.dataset.tev]; if (e2?.trace) open(e2.trace.kind, e2.trace.id, { inside: true }); return; }
      if (e.target.closest('.tr-lanes, .tr-axis')) { auto = 'all'; render(); }
    });
    // Zoom around the pointer with the wheel; drag the lanes to move in time.
    const trackX = e => { const t = box.querySelector('.tr-lanes .tr-track') || box.querySelector('.tr-axis .tr-track'); const r = t.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    let rq = 0; const renderSoon = () => { if (rq) return; rq = 1; const go = () => { if (rq) { rq = 0; render(); } }; requestAnimationFrame(go); setTimeout(go, 32); }; // one redraw per frame (the timer covers a tab that isn't painting)
    // Plain scrolling scrolls the view; Ctrl/⌘ + scroll (or a trackpad pinch) zooms the time axis; sideways scrolling moves in time.
    box.addEventListener('wheel', e => {
      if (!e.target.closest('.tr-lanes, .tr-axis') || !range) return;
      const span0 = range.to - range.from;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); auto = false;
        const f = trackX(e), at = range.from + f * span0, k = Math.exp(e.deltaY * 0.004);
        const span = Math.min(30 * 365 * DAY, Math.max(1800e3, span0 * k));
        range = { from: at - f * span, to: at + (1 - f) * span }; return renderSoon();
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault(); auto = false;
        const w = box.querySelector('.tr-lanes .tr-track')?.getBoundingClientRect().width || 1, dt = (e.deltaX / w) * span0;
        range = { from: range.from + dt, to: range.to + dt }; return renderSoon();
      }
    }, { passive: false });
    let drag = null, dragMoved = false;
    box.addEventListener('pointerdown', e => { if (!e.target.closest('.tr-lanes') || e.target.closest('button') || !range) return; drag = { x: e.clientX, from: range.from, to: range.to, w: box.querySelector('.tr-lanes .tr-track')?.getBoundingClientRect().width || 1 }; box.classList.add('dragging'); dragMoved = false; });
    addEventListener('pointermove', e => { if (!drag) return; if (Math.abs(e.clientX - drag.x) < 4) return; dragMoved = true; auto = false; const dt = ((e.clientX - drag.x) / drag.w) * (drag.to - drag.from); range = { from: drag.from - dt, to: drag.to - dt }; renderSoon(); });
    addEventListener('pointerup', () => { if (drag) { drag = null; box.classList.remove('dragging'); } });
    document.addEventListener('click', e => { const b = e.target.closest('[data-trace]'); if (!b) return; e.stopPropagation(); const [k, id] = b.dataset.trace.split(/:(.+)/); Drawer.close(); open(k, id); }, true);

    /* ---- trace anything you can see ----
       Right-click any row, card, chip, feed item, shipment, PO or selected text (or hover it and press T): the menu lists
       what's in it that can be traced (ticket and request keys, hostnames, part numbers, NetSuite documents, tracking
       numbers…). Shift+right-click keeps the browser's own menu. */
    const PATTERNS = [
      [/\b[A-Z][A-Z0-9]{1,9}-\d{2,7}\b/g, 'ticket'],                        // DC-33100, RMA-5817, SHP-3198, PMO-12
      [/\b[a-z]{3}\d{2}[a-z0-9]*(?:-[a-z0-9]+){2,}\b/gi, 'device'],        // iad03-r061-u18, atl01-cl02-ccpu-003, cmh01dh1-p08c169-u04-gpu0483
      [/\b(?:TO|PO|SO|IF|IR|VRMA|RMA)\d{3,}\b/g, 'term'],                      // NetSuite / Atium documents
      [/\b1Z[0-9A-Z]{16}\b|\b\d{12,22}\b/g, 'term'],                         // tracking numbers, long serials
    ];
    const ROW = '.mini-ticket, .qitem, .feed-item, .lk, .inv, li, tr, .tr-ritem, .nb-row, .alert-item, .brief-item, .vol-in-card li';
    let PIDX = null; const partIndex = () => PIDX ||= new Map((D.PARTS || []).filter(p => p.pn && p.pn.length >= 4).map(p => [p.pn.toLowerCase(), p]));
    function candidates(target) {
      const out = [], add = (kind, id, label, why) => { if (!id) return; const k = idOf(kind, String(id).toLowerCase()); if (!out.some(o => idOf(o.kind, String(o.id).toLowerCase()) === k)) out.push({ kind, id: String(id), label: label || String(id), why }); };
      const gs = getSelection?.(), sel = gs?.rangeCount && target.contains?.(gs.anchorNode) ? String(gs).trim() : ''; // only a selection inside what you clicked
      const op = target.closest?.('[data-ticket],[data-open],[data-dep],[data-part],[data-tr-open],[data-trace],[data-tterm]');
      if (op) {
        const d = op.dataset;
        if (d.ticket) add('ticket', d.ticket, d.ticket, 'ticket');
        if (d.dep) add('deployment', d.dep, d.dep, 'deployment');
        if (d.tterm) add('term', d.tterm, d.tterm, 'NetSuite item');
        if (d.part) { const p = D.partById(d.part); add('part', d.part, p ? partLabel(p) : d.part, 'part'); }
        const [k, v] = String(d.open || d.trOpen || d.trace || '').split(/:(.+)/);
        if (v && ['ticket', 'device', 'part', 'deployment', 'term'].includes(k)) add(k, v, k === 'part' ? partLabel(D.partById(v)) || v : v, k);
      }
      const row = target.closest?.(ROW) || op || target;
      const text = [sel, row?.getAttribute?.('title') || '', (row?.innerText || '').slice(0, 600)].join(' ');
      for (const [re, kind] of PATTERNS) for (const m of text.matchAll(re)) {
        const v = m[0];
        if (kind === 'ticket' && D.deploymentByKey?.(v)) add('deployment', v, v, 'deployment');
        else if (kind === 'ticket') add('ticket', v.toUpperCase(), v.toUpperCase(), /^(RMA|VRMA)-/i.test(v) ? 'RMA' : /^(SHP|WHS)-/i.test(v) ? 'shipping' : 'ticket');
        else if (kind === 'device') add('device', v.toLowerCase(), v.toLowerCase(), 'host');
        else add('term', v, v, /^(TO|PO|SO|IF|IR)/.test(v) ? 'document' : /^\d|^1Z/.test(v) ? 'tracking / serial' : 'RMA');
      }
      const PI = partIndex(); for (const w of new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{3,}/g) || [])) { const p = PI.get(w); if (p) add('part', p.id, partLabel(p), 'part'); }
      if (sel && sel.length <= 80 && !out.some(o => o.id.toLowerCase() === sel.toLowerCase())) add('term', sel, `“${sel}”`, 'selected text');
      return out.slice(0, 7);
    }
    const menu = Object.assign(document.createElement('div'), { id: 'traceMenu', className: 'trace-menu', hidden: true });
    menu.setAttribute('role', 'menu'); document.body.appendChild(menu);
    const closeMenu = () => { menu.hidden = true; };
    document.addEventListener('contextmenu', e => {
      if (e.shiftKey || e.target.closest('input, textarea, select, [contenteditable], #traceMenu')) return;
      const c = candidates(e.target); if (!c.length) return;
      e.preventDefault(); showMenu(c, e.clientX, e.clientY);
    });
    function showMenu(c, X, Y) {
      menu.innerHTML = `<div class="tm-head">⏱ Trace</div>${c.map(x => `<button type="button" role="menuitem" data-tm="${esc(x.kind)}:${esc(x.id)}"><span class="mono">${esc(x.label)}</span><small>${esc(x.why)}</small></button>`).join('')}<div class="tm-foot">Shift+right-click for the browser menu</div>`;
      menu.hidden = false;
      const w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.max(8, Math.min(X, innerWidth - w - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(Y, innerHeight - h - 8)) + 'px';
      menu.querySelector('button')?.focus();
    }
    const closeCards = () => { Drawer.close(); if (!$('#siteCard').hidden) SiteCard.close(); closePalette?.(); const ap = $('#alertPop'); if (ap) ap.hidden = true; const br = $('#brief'); if (br && !br.hidden && typeof closeBrief === 'function') closeBrief(); };
    menu.addEventListener('click', e => { const b = e.target.closest('[data-tm]'); if (!b) return; const [k, id] = b.dataset.tm.split(/:(.+)/); closeMenu(); closeCards(); open(k, id); });

    /* Every card that pops up (details, site card, alerts, daily brief) gets a ⏱ Trace button in its header and a small
       ⏱ on each row that holds something traceable (each ticket, host, part, shipment, PO…), so every instance in a card
       can be traced on its own. One thing in it: straight to Trace; several: a short menu to pick. */
    const CARDS = ['#drawer', '#siteCard', '#alertPop', '#brief .brief'];
    const ROWS = '.hrow, .mini-ticket, .aitem, .inv, tr, li, .qitem, .tr-mod';
    const btnHtml = (c, cls) => `<button type="button" class="${cls}" data-tr-row title="${esc(c.length === 1 ? `Trace ${c[0].label}` : `Trace: ${c.map(x => x.label).join(', ')}`)}" aria-label="Trace">⏱${cls === 'tr-hbtn' ? ' Trace' : ''}</button>`;
    function decorate(card) {
      if (!card || card.hidden) return;
      const head = card.querySelector(':scope > .qkey, .card-head .code');
      if (head && !card.querySelector('.tr-hbtn')) {
        const h3 = card.querySelector(':scope > h3, .card-head h3'), probe = document.createElement('div');
        probe.textContent = `${head.textContent} ${h3?.textContent || ''}`;
        const c = candidates(probe).filter(x => x.why !== 'selected text');
        if (c.length) (h3 || head).insertAdjacentHTML('beforeend', ' ' + btnHtml(c, 'tr-hbtn'));
      }
      for (const row of card.querySelectorAll(ROWS)) {
        if (row.dataset.trScan || row.querySelector('.tr-btn') || row.closest('.linked .lk-chips, .links, .tr-detail, thead') || row.querySelector('th') || row.querySelector(ROWS)) continue;
        row.dataset.trScan = '1'; // checked once; rows that change are new elements
        // A host row (alert and Health host lists): the ⏱ sits next to the host name and traces that host.
        if (row.matches('.hrow')) {
          const top = row.querySelector('.hrow-top'), name = top?.firstElementChild, probe = document.createElement('div'); if (!name) continue;
          probe.textContent = name.textContent; const c = candidates(probe).filter(x => x.kind === 'device');
          if (c.length) name.insertAdjacentHTML('afterend', `<button type="button" class="tr-btn" data-tr-row data-tr-pick="device:${esc(c[0].id)}" title="Trace ${esc(c[0].id)}" aria-label="Trace ${esc(c[0].id)}">⏱</button>`);
          continue;
        }
        if (!candidates(row).filter(x => x.why !== 'selected text').length) continue;
        const grid = row.tagName === 'TR' || /grid/.test(getComputedStyle(row).display);
        (grid ? row.lastElementChild || row : row).insertAdjacentHTML('beforeend', btnHtml([0, 0], 'tr-btn'));
      }
    }
    let pending = false;
    const sweep = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; CARDS.forEach(sel => { try { decorate(document.querySelector(sel)); } catch (e) { console.warn('trace buttons', e); } }); }, 30); };
    for (const sel of ['#drawer', '#siteCard', '#alertPop', '#brief']) { const el = document.querySelector(sel); if (el) new MutationObserver(sweep).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tr-row]'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      if (b.dataset.trPick) { const [k, id] = b.dataset.trPick.split(/:(.+)/); closeCards(); return open(k, id); }
      const src = b.classList.contains('tr-hbtn') ? (() => { const card = b.closest(CARDS.join(',')), d = document.createElement('div'); d.textContent = `${card.querySelector(':scope > .qkey, .card-head .code')?.textContent || ''} ${b.parentElement.textContent}`; return d; })() : b.closest(ROWS);
      const c = candidates(src).filter(x => x.why !== 'selected text'); if (!c.length) return;
      if (c.length === 1) { closeCards(); return open(c[0].kind, c[0].id); }
      const r = b.getBoundingClientRect(); showMenu(c, r.left, r.bottom + 4);
    }, true);
    document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#traceMenu')) closeMenu(); }, true);
    addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); e.stopPropagation(); } }, true);
    addEventListener('blur', closeMenu); addEventListener('scroll', closeMenu, true);
    let hovered = null;
    document.addEventListener('mouseover', e => { hovered = e.target; });
    // T while hovering something traceable traces it; otherwise T just opens the view.
    function traceHovered() {
      const c = hovered?.isConnected && !hovered.closest('#trace') ? candidates(hovered) : [];
      if (c.length) { Drawer.close(); open(c[0].kind, c[0].id); return true; }
      return false;
    }

    return { render, open, focus: () => box.querySelector('.tr-search input')?.focus(), subject: () => subject, candidates, traceHovered, decorate };
  })();

  let activeView = 'globe';
  const shapeSvg = (shape, c) => ({ circle: `<circle cx="5" cy="5" r="4" fill="${c}"/>`, square: `<rect x="1.5" y="1.5" width="7" height="7" fill="${c}"/>`,
    diamond: `<path d="M5 0L10 5L5 10L0 5Z" fill="${c}"/>`, triangle: `<path d="M5 0.5L9.5 9H0.5Z" fill="${c}"/>`, hex: `<path d="M5 0.5L9 2.75V7.25L5 9.5L1 7.25V2.75Z" fill="${c}"/>` }[shape]);
  const LEGENDS = {
    globe: () => {
      const kinds = [['dc', 'Data center', `<circle cx="5" cy="5" r="4" fill="${C.text}"/>`], ['pop', 'POP', `<path d="M5 0L9.5 5L5 10L0.5 5Z" fill="${C.text}"/>`],
        ['prem', 'On-prem', `<rect x="1.5" y="1.5" width="7" height="7" fill="${C.text}"/>`], ['idle', 'Planned / retired', `<circle cx="5" cy="5" r="3.5" fill="none" stroke="${C.idle}" stroke-width="1.5"/>`]];
      // One row of controls; the colour key sits behind "Key" so it doesn't crowd them.
      const key = ['good', 'warning', 'critical'].map(s => `<span><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${C[s]}"/></svg>${STATUS[s].glyph} ${STATUS[s].label}</span>`).join('')
        + `<span><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="${XC.deployment}" stroke-width="1.5" stroke-dasharray="2 2"/></svg>Deployment in progress</span>`
        + `<span class="muted">Status = tickets (SLA) and Grafana site health</span>`;
      return `<span class="keywrap"><button class="chip" data-globe="key" aria-expanded="false" title="What the colours mean">● Key</button><span class="keypop" hidden>${key}</span></span>`
        + kinds.map(([k, label, svg]) => `<button class="chip on" data-kind="${k}" aria-pressed="true"><svg viewBox="0 0 10 10">${svg}</svg>${label}</button>`).join('')
        + scopeSeg('globe', VS('globe'))
        + `<button class="chip" data-globe="home" title="Fit the live data centers (or double-click the map)">Fit</button><button class="chip" data-globe="world">World</button>`
        + `<span class="seg" title="Base map">${Object.entries(Tiles.PROVIDERS).map(([k, p]) => `<button class="chip ${Tiles.name() === k ? 'on' : ''}" data-basemap="${k}" aria-pressed="${Tiles.name() === k}">${p.label}</button>`).join('')}<button class="chip ${Tiles.name() === 'off' ? 'on' : ''}" data-basemap="off" title="Stylized dots, no imagery">Dots</button></span>`
        + `<span class="seg">${[['globe', 'Globe'], ['map', 'Map']].map(([m, l]) => `<button class="chip ${Fleet.mode() === m ? 'on' : ''}" data-fleet="${m}" aria-pressed="${Fleet.mode() === m}">${l}</button>`).join('')}</span>`;
    },
    graph: () => {
      const n = Brain.counts();
      return Object.entries(Brain.TYPES).filter(([k]) => n[k]).map(([k, t]) =>
        `<button class="chip ${Brain.isHidden(k) ? '' : 'on'}" data-btype="${k}" aria-pressed="${!Brain.isHidden(k)}"><svg viewBox="0 0 10 10">${shapeSvg(t.shape, t.color)}</svg>${t.label} <small>${n[k]}</small></button>`).join('')
        + '<span class="lbreak" aria-hidden="true"></span>' // the view controls go on their own line under the node types
        + scopeSeg('graph', Brain.scope())
        + '<button class="chip" data-brain="fit" title="Fit everything (double-click)">Fit</button>'
        + `<span class="seg" title="View">${[['2d', '2D'], ['3d', '3D']].map(([k, l]) => `<button class="chip ${(k === '3d') === Brain.is3d() ? 'on' : ''}" data-brain="${k}" aria-pressed="${(k === '3d') === Brain.is3d()}">${l}</button>`).join('')}</span>`;
    },
    health: () => '<span class="muted">Leaks · breakers · PDUs · power shelves · hardware · heat · network · monitoring gaps</span>',
    trace: () => '<span class="muted">One item\'s history: Jira · service desks · NetBox · Grafana · Yard · Slack · Atium · NetSuite</span>',
    deploys: () => [['good', 'On track'], ['warning', 'At risk'], ['critical', 'Off track / overdue'], ['idle', 'Not started']].map(([s, l]) =>
      `<span><svg viewBox="0 0 10 10"><rect x="0" y="2" width="10" height="6" rx="2" fill="${s === 'idle' ? C.accent : C[s]}"/></svg>${l}</span>`).join('')
      + `<span><svg viewBox="0 0 10 10"><line x1="5" y1="0" x2="5" y2="10" stroke="${C.accent}" stroke-width="2"/></svg>Today</span>`,
  };
  document.addEventListener('click', e => { const p = $('#keyPop'); if (p && !p.hidden && !e.target.closest('.keywrap, #keyPop')) { p.hidden = true; document.querySelectorAll('[data-globe=key]').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }); } });
  $('#stageLegend').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kind) { const on = Fleet.toggle(b.dataset.kind); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
    if (b.dataset.globe === 'key') { // the popover lives on the page itself (the stage's blur would offset a fixed box inside it)
      let p = $('#keyPop'); if (!p) { p = Object.assign(document.createElement('div'), { id: 'keyPop', className: 'keypop', hidden: true }); document.body.appendChild(p); }
      const open = p.hidden, br = b.getBoundingClientRect();
      p.innerHTML = b.nextElementSibling.innerHTML; p.style.left = br.left + 'px'; p.style.top = br.bottom + 6 + 'px'; p.hidden = !open;
      b.setAttribute('aria-expanded', open); b.classList.toggle('on', open); return; }
    if (b.dataset.globe === 'home') Fleet.home();
    if (b.dataset.globe === 'world') Fleet.world();
    if (b.dataset.fleet) { Fleet.setMode(b.dataset.fleet); setView('globe'); }
    if (b.dataset.basemap) { autoSat = false; Tiles.set(b.dataset.basemap); setView('globe'); }
    if (b.dataset.btype) { Brain.toggle(b.dataset.btype); $('#stageLegend').innerHTML = LEGENDS.graph(); hint(); }
    if (b.dataset.brain === 'fit') Brain.fit();
    if (b.dataset.vscope?.startsWith('globe:')) { setVS('globe', b.dataset.vscope.slice(6)); $('#stageLegend').innerHTML = LEGENDS.globe(); Fleet.home(); }
    if (b.dataset.vscope?.startsWith('graph:')) { Brain.setScope(b.dataset.vscope.slice(6)); $('#stageLegend').innerHTML = LEGENDS.graph(); hint(); }
    if (b.dataset.brain === '2d' || b.dataset.brain === '3d') { Brain.set3d(b.dataset.brain === '3d'); $('#stageLegend').innerHTML = LEGENDS.graph(); hint(); }
  });
  function hint() {
    const unplaced = D.SITES.length - Fleet.placedCount;
    $('#stageHint').textContent = activeView === 'globe'
      ? `${Fleet.placedCount} sites · drag to ${Fleet.mode() === 'globe' ? 'rotate' : 'pan'} · scroll to zoom · double-click to fit · click a site${unplaced ? ` · ${unplaced} without coordinates are in the list` : ''}`
      : activeView === 'graph' ? `${Brain.nodeCount()} neurons · hover to fire and trace links · ${Brain.is3d() ? 'drag to turn · Shift+drag to pan' : 'drag to pan'} · scroll to zoom · click to open`
      : activeView === 'health' ? 'Worst sites first · click a number for hosts, racks and U positions · H opens this view'
      : activeView === 'trace' ? 'Ctrl/⌘ + scroll (or pinch) to zoom · drag to move in time · double-click to reset · T opens this view'
      : `${(D.DEPLOYMENTS || []).length} deployments · ☆ to track · click a row for workstreams, meetings, Slack and shipments`;
  }
  // Bigger view: the middle panel takes the whole screen (side columns and the number strip hide). Button, E key, Esc.
  function setStageMax(on) {
    document.body.classList.toggle('stage-max', on);
    const b = $('#stageExpand'); b.textContent = on ? '⤡' : '⤢'; b.setAttribute('aria-pressed', on);
    b.title = on ? 'Back to the normal layout (E or Esc)' : 'Bigger view: hide the side columns (E). Esc to go back.';
    try { sessionStorage.setItem('lambdaos-stagemax', on ? '1' : '0'); } catch { /* ignore */ }
    requestAnimationFrame(() => { if (activeView === 'globe') { Fleet.resize(); } else if (activeView === 'graph') { Brain.resize(); Brain.fit(); } else if (activeView === 'health') Health.render(); else if (activeView === 'trace') Trace.render(); else Deploys.render(); });
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
    if (v === 'globe') Fleet.resize(); else if (v === 'graph') Brain.resize(); else if (v === 'health') Health.render(); else if (v === 'trace') { Trace.render(); if (!Trace.subject()) Trace.focus(); } else Deploys.render();
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  let startView = 'globe';
  try { startView = sessionStorage.getItem('lambdaos-view') || 'globe'; } catch { /* ignore */ }
  setView(['globe', 'graph', 'deploys', 'health', 'trace'].includes(startView) ? startView : 'globe');
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
      `<div class="mini-ticket"><span class="qkey">${statusChip(a.crit ? 'critical' : a.hw ? 'warning' : 'idle', a.severity || 'alert')}</span><span class="qsum">${alertLine(a)}${a.host ? yardChip(a.host) : ''}</span><span class="small muted">${alertSince(a)}</span></div>`).join('')}` : '';

  // Yard totals at a site, from the hosts Lambda OS has looked up (ticket hosts and lists you've opened), not every host.
  const yardSiteBlock = s => {
    if (!D.YARD || !yardUsable()) return '';
    const pre = s.id.toLowerCase(), hs = Object.entries(D.YARD.hosts || {}).filter(([h, y]) => y?.found && (D.deviceById(h)?.site === s.id || h.startsWith(pre)));
    if (!hs.length) return '';
    const prod = hs.filter(([, y]) => LambdaAlerts.inProduction(y)).length, locked = hs.filter(([, y]) => y.lockedBy), mine = locked.filter(([, y]) => meLock(y)).length;
    const clusters = [...new Set(hs.map(([, y]) => y.region).filter(Boolean).map(r => String(r).toUpperCase()))];
    return `<div class="section-title"><span>Yard · hosts checked so far</span><span>${hs.length}</span></div>
      <div class="yard-sum"><span><b>${prod}</b> in production</span><span><b>${locked.length}</b> locked${mine ? ` (${mine} by you)` : ''}</span><span><b>${hs.length - prod - locked.length}</b> other</span></div>
      ${clusters.length ? `<p class="muted small">Clusters: ${clusters.slice(0, 6).map(c => `<a class="linkish" data-open="cluster:${esc(c.toLowerCase())}">${esc(c)}</a>`).join(' · ')}</p>` : ''}`;
  };
  const SiteCard = {
    open(s) {
      Fleet.focus(s);
      const tickets = ALLT().filter(t => t.site === s.id).sort(byUrgency);
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
        <div class="links card-actions">${s.lat != null ? `<button class="btn primary" data-exact="${esc(s.id)}">◎ Exact location</button>` : ''}<button class="btn" data-lk-brain="site:${esc(s.id)}" title="Open the Second brain on this site, with everything linked to it lit up">🧠 Second brain</button>${btn('Open in NetBox', s.url)}${btn(`All ${tickets.length} in Jira`, s.jiraUrl)}${s.atium ? btn('Atium', s.atium.url) : ''}${(s.channels || []).slice(0, 3).map(c => btn('#' + c.name, c.url)).join('')}</div>
        ${s.city || s.address ? `<p class="muted small">${esc(s.address || s.city)}</p>` : ''}
        ${s.coordNote ? `<p class="note small">⚠ ${esc(s.coordNote)}</p>` : ''}
        <div class="stats">
          <div class="stat"><b>${kfmt(s.racks)}</b><span>Racks</span></div><div class="stat"><b>${kfmt(s.devices)}</b><span>Devices</span></div>
          <div class="stat"><b>${s.openTickets}</b><span>Open tickets</span></div><div class="stat"><b>${s.breached || 0}</b><span>SLA breached</span></div></div>
        ${maintBlock(s.maint || [])}
        ${healthBlock(s)}
        ${yardSiteBlock(s)}
        ${s.deployments?.length ? `<div class="section-title"><span>Deployments here</span><span>${s.deployments.length}</span></div>${s.deployments.map(d => `<div class="mini-ticket" data-dep="${d.key}"><span class="qkey">${d.key}</span><span class="qsum">${esc(d.title)}</span>${statusChip(d.health, `${pct(d.progress)} · ${fmtDate(d.end)}`)}</div>`).join('')}` : ''}
        ${(D.VOLUNTEER || []).filter(v => v.site === s.id).map(v => `<div class="section-title"><span>Volunteers wanted · Slack</span><span>${rel(v.askedAt)}</span></div><ul class="vol-in-card">${volRow(v)}</ul>`).join('')}
        ${s.builds?.length ? `<div class="section-title"><span>Builds · Atium</span><span>${s.builds.length}</span></div>${s.builds.map(buildRow).join('')}` : ''}
        ${s.atium && (s.atium.pos || isExt && D.MODE === 'live') ? `<div id="sitePOs" data-site="${esc(s.id)}"><div class="section-title"><span>Purchase orders · Atium</span><span>loading…</span></div></div>` : ''}
        ${s.atium ? `<p class="muted small">Atium: ${s.atium.assets.toLocaleString()} assets tracked${s.atium.consumables ? ` · ${s.atium.consumables.toLocaleString()} consumables` : ''} · <a class="linkish" data-url="${esc(s.atium.url)}" data-what="Atium">open inventory</a></p>` : ''}
        ${inv.length ? `<div class="section-title"><span>Spares on hand</span><span>bar tick = alert level</span></div>${invRows}
          ${inv.length > 14 ? `<p class="muted small">+${inv.length - 14} more part numbers</p>` : ''}` : ''}
        ${s.material?.length ? `<div class="section-title"><span>Material on hand · NetSuite</span><span>${s.material.length} items</span></div>
          ${s.material.slice(0, 8).map(m => `<div class="inv ns" data-tterm="${esc(m.item)}" title="${esc(m.name)} (${esc(m.item)}): ${m.qty} on hand"><span class="inv-name">${esc(m.name || m.item)} <small class="muted mono">${esc(m.item)}</small></span><span class="inv-num">${m.qty.toLocaleString()}</span></div>`).join('')}` : ''}
        ${s.moves?.length ? `<div class="section-title"><span>Material movements · NetSuite</span><span>${s.moves.length}</span></div>
          ${s.moves.slice(0, 5).map(m => `<div class="mini-ticket" ${m.deploymentKey ? `data-dep="${m.deploymentKey}"` : ''}><span class="qkey">${esc(m.doc)}</span><span class="qsum">${esc(m.type)}${m.deployment ? ' · ' + esc(m.deployment) : ''}</span><span class="small muted">${esc(m.status || m.date)}</span></div>`).join('')}` : ''}
        <div class="section-title"><span>Open tickets</span><span>${tickets.length}</span></div>
        ${tickets.slice(0, 10).map(ticketRow).join('') || '<p class="muted small">None.</p>'}
        ${tickets.length > 10 ? `<p class="muted small">+${tickets.length - 10} more · <a class="linkish" data-url="${esc(s.jiraUrl || '')}" data-what="Jira">see all in Jira</a></p>` : ''}`;
      cardOpened(SiteCard, $('#siteCard')); $('#siteCard').hidden = false; $('#siteCard').scrollTop = 0; renderSites();
      if (s.atium && $('#sitePOs')) loadPOs(s);
    },
    close() { $('#siteCard').hidden = true; Fleet.clear(); renderSites(); },
  };
  renderSites();

  /* ---------------- Linked: everything an item is connected to ----------------
     At the bottom of a ticket, device, deployment, part or cluster card:
       1. what Lambda OS already knows (instant): its device, rack, site, cluster, people, part, deployments, Slack
          channels and the other tickets on the same host or rack, every one clickable;
       2. what the apps say when you open it (a second or two, with your own sign-ins): Jira links, parent and
          sub-tasks, any issue in any project or service desk (RMA, Shipping, Warehouse…) that mentions it, Slack
          messages, and the device's NetBox journal and changes. Cached for 5 minutes. */
  const Linked = (() => {
    const cache = new Map(), TTL = 5 * 60e3;
    const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const chip = (attr, html, title = '') => `<button type="button" class="lk" ${attr} title="${esc(title)}">${html}</button>`;
    const tChip = t => chip(`data-ticket="${esc(t.key)}"`, `<i class="lk-dot st-${slaStatus(t)}"></i><span class="mono">${esc(t.key)}</span> ${esc(cut(t.summary, 34))}`, `${t.key}: ${t.summary} · ${t.status}`);
    const siteChip = id => { const s = D.siteById(id); return s ? chip(`data-open="site:${esc(s.id)}"`, `<span class="mono">${esc(s.id)}</span> ${esc(cut(s.name, 18))}`, `${s.id} · ${s.name}`) : ''; };
    const devChip = d => d ? chip(`data-open="device:${esc(d.id)}"`, `<span class="mono">${esc(d.id)}</span>`, `${d.model} · ${d.rack}${d.u ? ' U' + d.u : ''}`) : '';
    const personChip = id => { if (!id) return ''; const p = D.personById(id); return chip(`data-open="person:${esc(id)}"`, esc(id === 'me' ? 'You' : p.name), `${ALLT().filter(t => t.assignee === id).length} open tickets`); };
    const partChip = id => { const p = id && D.partById(id); return p ? chip(`data-open="part:${esc(p.id)}"`, esc(cut(partLabel(p), 32)), partLabel(p)) : ''; };
    const depChip = d => chip(`data-dep="${esc(d.key)}"`, `<i class="lk-dot st-${d.health}"></i>${esc(cut(d.title || d.key, 30))}`, `${d.key} · ${d.title}`);
    const clusterChip = (id, site) => id ? chip(`data-open="cluster:${esc(String(id).toLowerCase())}"`, `<span class="mono">${esc(String(id).toUpperCase())}</span>`, `Yard cluster${site ? ' at ' + site : ''}`) : '';
    const chanChip = c => chip(`data-url="${esc(c.url)}" data-what="Slack"`, `#${esc(c.name)}`, c.topic || c.purpose || `#${c.name}`);
    const uniq = (arr, k) => { const seen = new Set(); return arr.filter(x => x && !seen.has(k(x)) && seen.add(k(x))); };
    const openT = t => !/^(done|closed|resolved)$/i.test(t.status || '');
    const rackOf = d => d && d.rack && d.rack !== '—' ? d.rack : null;
    const sameRack = (site, rack, notDevice) => rack ? ALLT().filter(t => t.site === site && t.device !== notDevice && rackOf(D.deviceById(t.device)) === rack).sort(byUrgency) : [];
    const depsAt = site => site ? (D.DEPLOYMENTS || []).filter(d => d.sites.includes(site)).sort((a, b) => (a.end || 9e15) - (b.end || 9e15)) : [];
    const chansAt = site => site ? (D.CHANNELS || []).filter(c => c.site === site) : [];
    const cluster = host => { const y = yardUsable() && yardOf(host); return y?.found && y.region ? y.region : null; };
    const MAX = 8;
    const group = (label, chips, more = 0) => { chips = chips.filter(Boolean); return chips.length ? { label, html: chips.slice(0, MAX).join('') + (chips.length > MAX || more ? `<span class="muted small lk-more">+${chips.length - MAX + more} more</span>` : ''), n: chips.length + more } : null; };

    // 1. What Lambda OS already knows.
    function local(kind, r) {
      if (kind === 'ticket') {
        const dev = D.deviceById(r.device), rack = rackOf(dev);
        return [
          group('Device', [devChip(dev)]),
          group('Site', [siteChip(r.site)]),
          group('Yard cluster', [clusterChip(cluster(r.device), r.site)]),
          group('Part', [partChip(r.part)]),
          group('People', [personChip(r.assignee)]),
          group('Same device', ALLT().filter(t => t.device && t.device === r.device && t.key !== r.key).sort(byUrgency).map(tChip)),
          group(rack ? `Same rack · ${rack}` : 'Same rack', sameRack(r.site, rack, r.device).filter(t => t.key !== r.key).map(tChip)),
          group('Same part, same site', r.part ? ALLT().filter(t => t.part === r.part && t.site === r.site && t.key !== r.key && t.device !== r.device).sort(byUrgency).map(tChip) : []),
          group(`Deployments at ${r.site || 'this site'}`, depsAt(r.site).map(depChip)),
          group('Slack channels', chansAt(r.site).map(chanChip)),
        ].filter(Boolean);
      }
      if (kind === 'device') {
        const ts = ALLT().filter(t => t.device === r.id), rack = rackOf(r);
        return [
          group('Site', [siteChip(r.site)]),
          group('Yard cluster', [clusterChip(cluster(r.id), r.site)]),
          group('Parts its tickets need', uniq(ts.map(t => t.part), x => x).map(partChip)),
          group('People on it', uniq(ts.map(t => t.assignee), x => x).map(personChip)),
          group(rack ? `Other tickets in rack ${rack}` : 'Other tickets in the rack', sameRack(r.site, rack, r.id).map(tChip)),
          group(`Deployments at ${r.site || 'this site'}`, depsAt(r.site).map(depChip)),
          group('Slack channels', chansAt(r.site).map(chanChip)),
        ].filter(Boolean);
      }
      if (kind === 'deployment') {
        const sib = r.project ? (D.DEPLOYMENTS || []).filter(d => d.project?.key === r.project.key && d.key !== r.key) : [];
        const ev = (D.EVENTS || []).filter(e => e.deployment === r.key).sort((a, b) => a.at - b.at);
        const ts = ALLT().filter(t => r.sites.includes(t.site) && openT(t)).sort(byUrgency);
        return [
          group('Project', r.project ? [chip(`data-proj="${esc(r.project.key)}"`, esc(cut(r.project.title, 34)), r.project.key)] : []),
          group('Sites', r.sites.map(siteChip)),
          group('People', [personChip(r.assignee)]),
          group('Slack channels', uniq([...(r.channels || []), ...r.sites.flatMap(chansAt)], c => c.id).map(chanChip)),
          group('Meetings', ev.map(e => chip(`data-href="${esc(e.link)}"`, `${new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${esc(cut(e.title, 28))}`, e.title))),
          group('Same project', sib.map(depChip)),
          group(`Open tickets at ${r.sites.join(', ') || 'its sites'}`, ts.slice(0, MAX).map(tChip), Math.max(0, ts.length - MAX)),
        ].filter(Boolean);
      }
      if (kind === 'part') {
        const ts = ALLT().filter(t => t.part === r.id);
        const low = D.SITES.filter(s => s.inventory.some(i => i.part === r.id && invStatus(i) !== 'good'));
        return [
          group('Devices waiting for it', uniq(ts.map(t => D.deviceById(t.device)), d => d.id).map(devChip)),
          group('Sites low on it', low.map(s => siteChip(s.id))),
          group('People', uniq(ts.map(t => t.assignee), x => x).map(personChip)),
        ].filter(Boolean);
      }
      if (kind === 'cluster') {
        const id = String(r.id || r).toLowerCase(), hosts = Object.entries(D.YARD?.hosts || {}).filter(([, y]) => y?.found && String(y.region).toLowerCase() === id).map(([h]) => h);
        const ts = ALLT().filter(t => hosts.includes(String(t.device || '').toLowerCase()));
        const sites = uniq(ts.map(t => t.site), x => x);
        return [
          group('Sites', sites.map(siteChip)),
          group('People', uniq(ts.map(t => t.assignee), x => x).map(personChip)),
          group('Parts needed', uniq(ts.map(t => t.part), x => x).map(partChip)),
          group('Deployments', uniq(sites.flatMap(depsAt), d => d.key).map(depChip)),
        ].filter(Boolean);
      }
      return [];
    }

    // 2. What the apps say. terms = what to search for in Jira text and Slack.
    function lookupPlan(kind, r) {
      if (kind === 'ticket') { const dev = D.deviceById(r.device); return { key: r.key, terms: [r.device, dev?.serial].filter(Boolean), slack: [r.key, r.device].filter(Boolean), nb: dev?.url, host: r.device, mail: r.key }; }
      if (kind === 'device') return { terms: [r.id, r.serial].filter(Boolean), slack: [r.id, r.serial].filter(Boolean), nb: r.url, host: r.id, mail: r.id };
      if (kind === 'deployment') return { key: r.key, terms: [], slack: [r.key], mail: r.key };
      if (kind === 'part') return { terms: [r.pn], slack: [r.pn], mail: r.pn };
      return null;
    }
    const idOf = (kind, r) => `${kind}:${r.key || r.id || r}`;
    function section(kind, r) {
      const groups = local(kind, r), plan = lookupPlan(kind, r), id = idOf(kind, r);
      const live = plan && D.MODE === 'live' && isExt, demo = plan && D.MODE !== 'live';
      const slot = (k, name) => `<div class="lk-app" id="lk-${k}"><span class="lk-label">${name}</span><span class="muted small lk-wait">searching…</span></div>`;
      return `<div class="linked" data-lk="${esc(id)}">
        <div class="section-title"><span>Linked</span><span class="lk-acts">${['ticket', 'device', 'deployment', 'part'].includes(kind) ? `<button type="button" class="linkish small lk-brain" data-trace="${esc(id)}" title="Everything that happened to it, on a timeline (T)">⏱ Trace</button>` : ''}<button type="button" class="linkish small lk-brain" data-lk-brain="${esc(id)}" title="Open the Second brain on this item, with everything linked to it lit up">🧠 Show in Second brain</button></span></div>
        ${groups.length ? groups.map(g => `<div class="lk-row"><span class="lk-label">${esc(g.label)}</span><span class="lk-chips">${g.html}</span></div>`).join('') : '<p class="muted small">Nothing else loaded links to it.</p>'}
        ${live || demo ? `<div class="section-title lk-sub"><span>Also mentioned in</span><span class="lk-status"></span></div>
          ${slot('jira', 'Jira &amp; service desks')}${plan.slack?.length ? slot('slack', 'Slack') : ''}${plan.nb || plan.host || (demo && kind !== 'deployment' && kind !== 'part') ? slot('nb', 'NetBox history') : ''}
          <p class="muted small lk-foot">${plan.mail ? `<a class="linkish" data-url="https://mail.google.com/mail/u/0/#search/${esc(encodeURIComponent(`"${plan.mail}"`))}" data-what="Gmail">Search Gmail for “${esc(plan.mail)}” ↗</a> · ` : ''}checked with your own sign-ins when you open this</p>` : ''}
      </div>`;
    }
    const still = id => document.querySelector('#drawer:not([hidden]) .linked')?.dataset.lk === id;
    const put = (id, k, html) => { if (!still(id)) return; const el = document.getElementById('lk-' + k); if (el) el.innerHTML = el.querySelector('.lk-label').outerHTML + html; };
    const none = what => `<span class="muted small">${what}</span>`;
    const failed = (e, name) => none(/not signed in|sign_in/i.test(String(e?.message || e)) ? `not signed in to ${name}` : `couldn't check ${name}`);
    function jiraHtml(res, plan) {
      const items = (res.items || []).filter(i => i.key !== plan.key);
      if (!items.length) return none('nothing else mentions it');
      const byProj = new Map(); for (const i of items) { const k = i.key.split('-')[0]; byProj.set(k, [...(byProj.get(k) || []), i]); }
      return `<div class="lk-list">${[...byProj.entries()].map(([p, list]) => list.slice(0, 6).map(i => {
        const known = D.ticketByKey?.(i.key);
        return `<div class="mini-ticket ${i.done ? 'lk-done' : ''}" ${known ? `data-ticket="${esc(i.key)}"` : `data-href="${esc(i.url)}"`} title="${esc(`${i.key}: ${i.summary}`)}"><span class="qkey">${esc(i.key)}</span><span class="qsum">${esc(i.summary)}</span><span class="small muted">${esc(i.rel && i.rel !== 'mentions it' ? i.rel + ' · ' : '')}${esc(i.status)}</span></div>`;
      }).join('') + (list.length > 6 ? `<p class="muted small">+${list.length - 6} more in ${esc(p)}</p>` : '')).join('')}</div>`;
    }
    const slackHtml = res => res.items?.length ? `<div class="lk-list">${res.items.slice(0, 6).map(m => `<div class="mini-ticket" data-href="${esc(m.link)}" title="${esc(m.text)}"><span class="qkey">${esc(m.channel === 'DM' ? 'DM' : '#' + m.channel)}</span><span class="qsum">${esc(m.user ? m.user + ': ' : '')}${esc(m.text)}</span><span class="small muted">${rel(m.at)}</span></div>`).join('')}</div>` : none('no messages mention it');
    const nbHtml = res => res.items?.length ? `<div class="lk-list">${res.items.slice(0, 6).map(c => `<div class="mini-ticket" ${res.url ? `data-href="${esc(res.url)}"` : ''}><span class="qkey">${c.kind === 'journal' ? '📝' : '✎'} ${rel(c.at)}</span><span class="qsum">${esc(c.text)}</span><span class="small muted">${esc(String(c.who).split('@')[0])}</span></div>`).join('')}</div>` : none('no journal entries or changes by people');

    // Demo: believable answers from the demo data, so the preview and the screenshots show the idea.
    function demoAnswers(kind, r, plan) {
      const host = plan.terms[0] || r.key || r.pn || 'item', ago = h => Date.now() - h * 3600e3;
      return {
        jira: { items: [
          kind === 'ticket' && { key: 'DC-' + (Number(String(r.key).split('-')[1]) - 412), summary: `Previous failure on ${r.device || host}`, status: 'Done', done: true, rel: 'relates to', url: '' },
          { key: 'RMA-5' + String(host.length * 137).slice(-3), summary: `Return ${plan.terms[1] || host} to vendor`, status: 'Pending DC Return', rel: 'mentions it', url: '' },
          { key: 'SHP-31' + String(host.length * 7).slice(-2), summary: `Ship replacement for ${host}`, status: 'In Transit', rel: 'mentions it', url: '' },
        ].filter(Boolean) },
        slack: { items: [{ at: ago(3), channel: 'dc-ops', user: 'S. Patel', text: `Looking at ${host} now, reseated the card`, link: '' }, { at: ago(27), channel: 'hw-validation', user: 'J. Kim', text: `${host} failed burn-in again`, link: '' }] },
        nb: { items: [{ at: ago(5), who: 's.patel@lambdal.com', text: 'updated: status', kind: 'change' }, { at: ago(30), who: 'j.kim@lambdal.com', text: 'Swapped GPU 3, sent old one to RMA', kind: 'journal' }] },
      };
    }
    async function fill(kind, r) {
      const plan = lookupPlan(kind, r), id = idOf(kind, r);
      if (!plan || !document.querySelector('.linked .lk-sub')) return;
      const hit = cache.get(id), fresh = hit && Date.now() - hit.at < TTL;
      const store = (k, v) => { const c = cache.get(id) || { at: Date.now() }; c[k] = v; cache.set(id, c); };
      const run = async (k, fn, render, name) => {
        if (!document.getElementById('lk-' + k)) return;
        if (fresh && hit[k]) return put(id, k, hit[k].off ? none(`${name} is off`) : render(hit[k], plan));
        try { const res = await fn(); store(k, res); put(id, k, res.off ? none(`${name} is off`) : render(res, plan)); }
        catch (e) { put(id, k, failed(e, name)); }
      };
      if (D.MODE !== 'live') { const a = demoAnswers(kind, r, plan); await new Promise(res => setTimeout(res, 250)); put(id, 'jira', jiraHtml(a.jira, plan)); put(id, 'slack', slackHtml(a.slack)); put(id, 'nb', nbHtml(a.nb)); return; }
      await Promise.all([
        run('jira', () => LambdaLive.linkedJira({ key: plan.key, terms: plan.terms }), jiraHtml, 'Jira'),
        run('slack', () => LambdaLive.linkedSlack(plan.slack), slackHtml, 'Slack'),
        run('nb', () => LambdaLive.linkedNetbox(plan.nb, plan.host), r => r.none ? none('not found in NetBox') : nbHtml(r), 'NetBox'),
      ]);
    }
    function brain(id) {
      const [kind, key] = id.split(/:(.+)/);
      const r = { ticket: D.ticketByKey, device: D.deviceById, deployment: D.deploymentByKey, part: D.partById, site: D.siteById, project: D.projectByKey, person: D.personById, cluster: c => ({ id: c }) }[kind]?.(key);
      if (!r) return;
      if (kind === 'cluster') { const t = ALLT().find(t => String(yardOf(t.device)?.region || '').toLowerCase() === key); if (t) r.site = t.site; }
      Drawer.close(); SiteCard.close?.();
      setView('graph');
      requestAnimationFrame(() => { Brain.resize(); if (!Brain.focusOn(kind, r)) toast('Not in the Second brain.'); });
    }
    document.addEventListener('click', e => { const b = e.target.closest('[data-lk-brain]'); if (b) { e.stopPropagation(); brain(b.dataset.lkBrain); } });
    return { section, fill, local, brain };
  })();

  /* ---------------- Drawer ---------------- */
  const Drawer = {
    // lk = [kind, item]: adds the Linked section (see above) and starts its lookup.
    open(html, cls = '', lk = null) { cardOpened(Drawer, $('#drawer')); volOpen = cls === 'wide' && volOpen; $('#drawer').className = `drawer ${cls}`; $('#drawer').innerHTML = `<button class="x" data-close-drawer aria-label="Close" style="float:right">✕</button>${html}${lk ? Linked.section(...lk) : ''}`; $('#drawer').hidden = false; $('#drawer').scrollTop = 0; if (lk) Linked.fill(...lk); },
    close() { $('#drawer').hidden = true; volOpen = false; },
  };
  /* Cards close the way they open: clicking the same row or button again closes the card, and clicking anywhere
     outside it closes it too (clicking another row just switches the card). Popups inside other popups, the search,
     the brief, Ask AI and the tour keep it open; so does a drag (rotating the globe, panning the brain). */
  let clickKey = null, downAt = null;
  const OPENER = '[data-ticket],[data-dep],[data-site],[data-part],[data-proj],[data-open],[data-ref],[data-vol],[data-feed],[data-hcell],[data-maint],[data-maint-list]';
  const keyOf = t => { const el = t.closest(OPENER); return el ? Object.entries(el.dataset).map(([k, v]) => `${k}=${v}`).join('|') : null; };
  const KEEP_OPEN = '#palette,#brief,#aiPanel,#alertPop,#sitePop,.tour,.toast,#needBar,.palette-backdrop,.brief-backdrop';
  function cardOpened(card, box) { if (clickKey != null || box.hidden) card.key = clickKey; card.openedAt = Date.now(); }
  document.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; }, true);
  document.addEventListener('click', e => {
    const t = e.target; if (!(t instanceof Element) || !t.isConnected) return;
    const key = keyOf(t); clickKey = key; setTimeout(() => { clickKey = null; }, 0);
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // a drag, not a click
    if (t.closest(KEEP_OPEN)) return;
    for (const [card, box] of [[Drawer, $('#drawer')], [SiteCard, $('#siteCard')]]) {
      if (box.hidden || box.contains(t) || Date.now() - (card.openedAt || 0) < 400) continue; // 400 ms: the globe opens a card on pointerup, just before this click
      if (key && card.key === key) { card.close(); e.stopPropagation(); e.preventDefault(); return; } // same opener again: close
      card.close();
    }
  }, true);
  const ticketRow = t => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum">${esc(t.summary)}${yardChip(t.device, t)}${maintChip(t.device, true)}</span>${statusChip(slaStatus(t), slaText(t))}</div>`;
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
      <div class="links">${btn('Open in Jira', d.url, true)}${d.channels.map(c => btn('#' + c.name, c.url)).join('')}${d.slackUrl ? btn('Slack channel', d.slackUrl) : ''}</div>`, '', ['deployment', d]);
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
        ${yardBlock(t.device, t)}
        ${maintBlock((D.maintForHost?.(t.device) || []), 'Maintenance on this host')}
        ${alertsBlock(t.alerts)}
        <div class="links">${btn('Open in Jira', t.url, true)}${isExt && t.url ? `<button class="btn" data-rackside="${esc(t.key)}" data-rurl="${esc(t.url)}" title="Open the ticket in Jira with the Lambda Rackside side panel">Open in Rackside</button>` : ''}${dev ? btn('Device in NetBox', dev.url) : ''}${t.device && yardUrl(t.device) ? btn('Open in Yard', yardUrl(t.device)) : ''}${t.alerts?.length && site?.gf ? btn('Site health in Grafana', site.gf.url) : ''}</div>`, '', ['ticket', t]);
    }
    if (type === 'cluster') {
      const id = String(ref.id || ref).toLowerCase(), hs = Object.entries(D.YARD?.hosts || {}).filter(([, y]) => y?.found && String(y.region).toLowerCase() === id);
      const set = new Set(hs.map(([h]) => h)), ts = ALLT().filter(t => set.has(String(t.device || '').toLowerCase())).sort(byUrgency);
      return Drawer.open(`<div class="qkey">YARD CLUSTER</div><h3 class="mono">${esc(id.toUpperCase())}</h3>
        <p class="muted small">${hs.length} hosts checked in Yard so far · ${hs.filter(([, y]) => LambdaAlerts.inProduction(y)).length} in production · ${hs.filter(([, y]) => y.lockedBy).length} locked</p>
        <div class="section-title"><span>Open tickets on this cluster</span><span>${ts.length}</span></div>${ts.slice(0, 40).map(ticketRow).join('') || '<p class="muted">None.</p>'}
        <div class="section-title"><span>Locked hosts</span><span>${hs.filter(([, y]) => y.lockedBy).length}</span></div>
        ${hs.filter(([, y]) => y.lockedBy).slice(0, 30).map(([h, y]) => `<div class="mini-ticket" ${D.deviceById(h) ? `data-open="device:${esc(D.deviceById(h).id)}"` : ''}><span class="qkey mono">${esc(h)}</span><span class="qsum">${esc(y.state || '')}</span><span class="small muted">🔒 ${meLock(y) ? 'you' : esc(y.lockedBy)}</span></div>`).join('') || '<p class="muted">None.</p>'}
        <div class="links">${D.YARD?.base ? btn('Open in Yard', `${D.YARD.base}/search?q=${encodeURIComponent(id)}`, true) : ''}</div>`, '', ['cluster', { id }]);
    }
    if (type === 'device') {
      const d = ref, ts = ALLT().filter(t => t.device === d.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">DEVICE</div><h3 class="mono">${esc(d.id)}</h3>
        <dl class="kv"><dt>Model</dt><dd>${esc(d.model)}</dd>${d.serial ? `<dt>Serial</dt><dd class="mono">${esc(d.serial)}</dd>` : ''}
          <dt>Site</dt><dd>${d.site ? `<a data-open="site:${esc(d.site)}">${esc(d.site)}</a>` : '—'}</dd><dt>Rack / U</dt><dd>${esc(d.rack)}${d.u ? ` · U${d.u}` : ''}</dd></dl>
        ${yardBlock(d.id)}
        ${maintBlock((D.maintForHost?.(d.id) || []), 'Maintenance on this host')}
        ${alertsBlock(d.alerts)}
        <div class="section-title"><span>Open tickets</span><span>${ts.length}</span></div>${ts.map(ticketRow).join('') || '<p class="muted">None.</p>'}
        <div class="links">${btn('Open in NetBox', d.url, true)}${yardUrl(d.id) ? btn('Open in Yard', yardUrl(d.id)) : ''}${d.alerts?.length && D.siteById(d.site)?.gf ? btn('Site health in Grafana', D.siteById(d.site).gf.url) : ''}</div>`, '', ['device', d]);
    }
    if (type === 'part') {
      const p = ref, rows = D.SITES.map(s => ({ s, i: s.inventory.find(x => x.part === p.id) })).filter(r => r.i).sort((a, b) => b.i.stock - a.i.stock);
      const waiting = ALLT().filter(t => t.part === p.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">PART · ${esc(p.pn)}</div><h3>${esc(p.name !== p.pn ? p.name : p.pn)}</h3>
        <p class="muted">${p.mfr ? esc(p.mfr) + ' · ' : ''}${rows.reduce((a, r) => a + r.i.stock, 0)} on hand fleet-wide · ${waiting.length} open tickets need it</p>
        ${rows.length ? `<div class="answer" style="margin:12px 0 0"><table><tr><th>Site</th><th class="num">On hand</th><th class="num">Alert at</th><th class="num">Receiving</th><th></th></tr>
        ${rows.map(({ s, i }) => `<tr><td><a class="linkish" data-open="site:${esc(s.id)}">${esc(s.id)}</a></td><td class="num">${i.stock}</td><td class="num">${i.alert || '—'}</td><td class="num">${i.receiving || ''}</td><td>${invStatus(i) === 'good' ? '' : statusChip(invStatus(i), INV_LABEL[invStatus(i)])}</td></tr>`).join('')}</table></div>` : '<p class="muted">Not stocked anywhere in NetBox.</p>'}
        <div class="section-title"><span>Tickets needing this part</span><span>${waiting.length}</span></div>${waiting.slice(0, 30).map(ticketRow).join('') || '<p class="muted">None.</p>'}`, '', ['part', p]);
    }
    if (type === 'person') {
      const p = ref, ts = ALLT().filter(t => t.assignee === p.id).sort(byUrgency);
      return Drawer.open(`<div class="qkey">PERSON</div><h3>${esc(p.id === 'me' ? `You${p.handle ? ` (${p.handle})` : ''}` : p.name)}</h3><p class="muted">${ts.length} assigned open tickets</p>
        <div class="section-title"><span>Assigned</span></div>${ts.slice(0, 60).map(ticketRow).join('') || '<p class="muted">None.</p>'}`);
    }
  }
  function openRef(ref) {
    const [kind, id] = ref.split(/:(.+)/);
    const map = { site: D.siteById, device: D.deviceById, part: D.partById, person: D.personById, ticket: D.ticketByKey, cluster: c => ({ id: c }) };
    const r = map[kind]?.(id); if (r) openEntity(kind, r);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-rackside],[data-exact],[data-track],[data-ticket],[data-site],[data-part],[data-dep],[data-proj],[data-open],[data-url],[data-href],[data-close],[data-close-drawer],[data-ref]');
    if (!el) return;
    if (el.dataset.rackside) return Rackside.open(el.dataset.rackside, el.dataset.rurl);
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
    const A = D.ALL || D; // search always covers every site
    push('Deployments', (A.DEPLOYMENTS || []).map(x => ({ sc: score(x.key, x.title, x.summary, x.gpuModel, ...x.sites), icon: '◆', color: XC.deployment, title: `${x.key} · ${x.title}`, sub: `${x.sites.join(', ') || '?'} · ${depStatus(x)} · ${pct(x.progress)} · due ${fmtDate(x.end)}`, run: () => { closePalette(); openEntity('deployment', x); } })), 5);
    push('Projects', (A.PROJECTS || []).map(x => ({ sc: score(x.key, x.title, x.summary), icon: '⬡', color: XC.project, title: `${x.key} · ${x.title}`, sub: `${x.deployments.length} deployments · ${x.status}`, run: () => { closePalette(); openEntity('project', x); } })), 3);
    push('Tickets', A.TICKETS.map(x => ({ sc: score(x.key, x.summary, x.device), icon: 'T', color: C['c-ticket'], title: `${x.key} · ${x.summary}`, sub: `${x.site || '?'} · ${x.status} · ${x.assigneeName}`, run: () => { closePalette(); openEntity('ticket', x); } })), 5);
    push('Devices', A.DEVICES.map(x => ({ sc: score(x.id, x.serial, x.model), icon: 'D', color: C['c-device'], title: x.id, sub: `${x.model} · ${x.site || '?'} ${x.rack}${x.u ? ` U${x.u}` : ''}${(y => y?.found && y.state ? ` · Yard: ${y.lockedBy ? '🔒 ' : ''}${y.state}${y.pool ? ` / ${y.pool}` : ''}${y.lockedBy ? ` (${meLock(y) ? 'you' : y.lockedBy})` : ''}` : '')(yardUsable() && yardOf(x.id))}`, run: () => { closePalette(); openEntity('device', x); } })));
    push('Maintenance', [{ sc: score('maintenance windows maint mw', 'jira maint'), icon: '🛠', color: '#c792ea', title: 'All maintenance windows', sub: `${maintAll().length} open in Jira MAINT`, run: () => { closePalette(); openMaintList(); } },
      ...maintAll().map(m => ({ sc: score(m.key, m.summary, m.type, m.region, m.sites.join(' '), m.hosts.join(' ')), icon: '🛠', color: '#c792ea', title: `${m.key} · ${m.summary}`, sub: maintWhen(m), run: () => { closePalette(); openMaint(m); } }))]);
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
        { group: 'Quick', icon: '⏱', color: C.accent, title: 'Trace a ticket, host, serial or part', sub: 'Its whole history on a timeline (T)', run: () => { closePalette(); setView('trace'); Trace.focus(); } },
        { group: 'Quick', icon: '🛠', color: '#c792ea', title: 'Maintenance windows', sub: `${maintAll().length} open in Jira MAINT · now, next 24 h, later`, run: () => { closePalette(); openMaintList(); } },
        ...apps().filter(a => /DC queue|Sites|Material on hand|Open Slack|Inbox|Settings/.test(a[1])).map(goRow),
      ];
    } else {
      const st = aiState(), qt = q.replace(/^\?\s*/, '');
      const askRows = st.ok
        ? [{ group: 'Ask', icon: 'λ', color: C['accent-2'], title: `Ask ${st.web === 'auto' ? 'AI' : st.label}: “${qt}”`, sub: `${st.model} · grounded in your loaded data${SET?.privacy?.mode === 'redact' ? ' · private values masked' : ''}`, run: () => askAI(q) },
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
      const ts = ALLT().filter(t => t.device === dev.id);
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
      const ts = ALLT().filter(t => t.site === site.id).sort(byUrgency);
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
    let ts = site ? ALLT().filter(t => t.site === site.id) : D.TICKETS.filter(t => words.some(w => `${t.summary} ${t.device} ${t.status}`.toLowerCase().includes(w)));
    if (ts.length < 10) ts = [...ts, ...[...D.TICKETS].sort(byUrgency).slice(0, 60)];
    ts = [...new Map(ts.map(t => [t.key, t])).values()].sort(byUrgency).slice(0, 120);
    L.push('', `OPEN DC TICKETS (${ts.length} of ${D.TICKETS.length}; key | summary | site | device | status | priority | SLA | assignee)`);
    for (const t of ts) L.push([t.key, t.summary, t.site || '', t.device, t.status, t.priority, slaText(t), t.assigneeName].join(' | '));
    if (D.YARD && yardUsable()) {
      const yh = Object.entries(D.YARD.hosts || {}).filter(([, y]) => y?.found);
      const wanted = new Set([...ts.map(t => String(t.device || '').toLowerCase()), ...yh.filter(([h]) => qq.includes(h)).map(([h]) => h), ...yh.filter(([, y]) => meLock(y)).map(([h]) => h)]);
      const rows = yh.filter(([h]) => wanted.has(h)).slice(0, 150);
      if (rows.length) L.push('', `YARD CENTRAL HOST STATE (read-only; ${yh.length} hosts looked up so far, not every host; host | app/state | pool | locked by | Starbase | cluster | in production & unlocked)`,
        ...rows.map(([h, y]) => [h, y.state || '', y.pool || '', y.lockedBy ? (meLock(y) ? 'YOU' : y.lockedBy) : '', y.starbase ? 'yes' : '', y.region || '', LambdaAlerts.inProduction(y) ? 'yes' : ''].join(' | ')));
      const yi = LambdaAlerts.yardIssues(D);
      if (yi.inProd.length || yi.lockedOther.length || yi.lockedMine.length) L.push('', 'YARD ISSUES ON MY TICKETS',
        ...yi.inProd.map(x => `${x.t.key} ${x.t.device}: still in production (${x.y.state}) and not locked`),
        ...yi.lockedOther.map(x => `${x.t.key} ${x.t.device}: locked by ${x.y.lockedBy}`),
        ...yi.lockedMine.map(x => `${x.host}: still locked by me, no open ticket of mine on it`));
    }
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
      ...(D.MENTIONS || []).map(m => m.user), ...(D.MAIL?.entries || []).map(e => e.from), D.ME?.name, ...Object.values(D.YARD?.hosts || {}).map(y => y?.lockedBy)].filter(n => n && !/^(you|unassigned)$/i.test(n));
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
        ${st.ok ? `<p class="muted small">Answers come from ${st.web === 'auto' ? 'whichever of Claude, ChatGPT or Gemini you’re signed in to' : esc(st.label.replace(' in your browser', ''))} in this browser, as you (no API key). Change it in <a class="linkish" data-aip-setup>Settings → AI</a>.</p>` : `<p class="note small">${esc(st.why)}</p>`}
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

    // opt.web asks a different chat for this one question; opt.again re-asks without repeating the question bubble.
    async function ask(q, opt = {}) {
      q = String(q || '').trim(); if (!q) return;
      if (box.hidden) open();
      if (busy) return;
      head();
      ta.value = '';
      if (!opt.again) bubble('user', esc(q));
      const base = aiState(), aiCfg = { ...(SET?.ai || {}), ...(opt.web ? { web: opt.web } : {}) };
      const st = base.ok ? LambdaAI.configured(aiCfg) : base;
      let used = st.web, NAME = st.ok ? (LambdaAI.WEB_NAMES[st.web] || 'your AI chat') : ''; // Automatic: set once the chat is picked
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
      let raw = '', t0 = performance.now(), failed = false;
      try {
        for await (const c of LambdaAI.stream(aiCfg, { system: AI_SYSTEM, user: userMsg, history, signal: ctrl.signal })) {
          if (c.using) { used = c.using; NAME = LambdaAI.WEB_NAMES[used]; }
          if (c.wait !== undefined) { // the chat needs the person (sign in, a human check): say so, then carry on by itself
            el.querySelector('.aip-wait')?.remove();
            if (c.wait) { el.insertAdjacentHTML('afterbegin', `<div class="aip-wait"><p>⏳ ${esc(c.wait)}</p><button class="chip" data-aip-chat>Show ${esc(NAME)} again</button></div>`); meta.textContent = 'Waiting for you…'; }
            else meta.textContent = `Back from ${NAME}, asking now…`;
            scroll();
          }
          if (c.full != null) { raw = c.full; text.innerHTML = md(R.restore(raw)) + '<span class="caret"></span>'; scroll(); }
          if (c.text) { raw += c.text; meta.textContent = 'Writing…'; text.innerHTML = md(R.restore(raw)) + '<span class="caret"></span>'; scroll(); }
          if (c.refusal) raw += `\n\n${c.refusal}`;
          if (c.note) meta.textContent = c.note;
        }
        text.innerHTML = md(R.restore(raw)) || '<p class="muted">(no answer)</p>';
        meta.textContent = `${NAME} in your browser · ${((performance.now() - t0) / 1000).toFixed(1)}s${SET.privacy.mode === 'redact' ? ` · ${R.count()} private values masked` : ''}`;
      } catch (e) {
        if (ctrl.signal.aborted) { text.innerHTML = (raw ? md(R.restore(raw)) : '') + '<p class="muted small">Stopped.</p>'; meta.textContent = ''; }
        else {
          // Something went wrong in the chat: say what, and offer the ways out (look at it, try again, use another chat).
          const others = Object.keys(LambdaAI.WEB_NAMES).filter(k => k !== used);
          text.innerHTML = `<p class="st-critical">${esc(e.message)}</p><div class="aip-tools aip-fix">
            <button class="chip" data-aip-retry>↻ Try again</button><button class="chip" data-aip-chat>Show ${esc(NAME)}</button>
            ${others.map(k => `<button class="chip" data-aip-other="${k}">Ask ${esc(LambdaAI.WEB_NAMES[k])} instead</button>`).join('')}</div>`;
          meta.textContent = '';
          text.querySelector('[data-aip-retry]').onclick = () => ask(q, { again: true, web: opt.web });
          text.querySelectorAll('[data-aip-other]').forEach(b => (b.onclick = () => ask(q, { again: true, web: b.dataset.aipOther })));
          failed = true;
        }
      } finally { busyUI(false); el.querySelector('.aip-wait')?.remove(); }
      const sent = `SYSTEM PROMPT\n${AI_SYSTEM}\n\n${history.length ? `—— EARLIER TURNS (${history.length / 2}) ——\n${history.map(h => `[${h.role}] ${h.content}`).join('\n\n')}\n\n` : ''}—— THIS MESSAGE (exactly as sent${SET.privacy.mode === 'redact' ? `; masked so far: ${R.summary() || 'none'}` : ''}) ——\n${userMsg}`;
      el.querySelectorAll('[data-aip-chat]').forEach(b => (b.onclick = () => LambdaWebChat.show()));
      if (failed) { scroll(); return; }
      el.insertAdjacentHTML('beforeend', `<div class="aip-tools" data-hq="${esc(q)}"><button class="chip" data-aip-sent>What was sent</button><button class="chip" data-aip-copy>Copy</button><button class="chip" data-aip-chat title="Show the hidden ${esc(NAME)} chat this answer came from">Open in ${esc(NAME)} ↗</button></div><pre class="ai-sent" hidden></pre>`);
      el.querySelector('.ai-sent').textContent = sent;
      el.querySelector('[data-aip-copy]').onclick = () => navigator.clipboard?.writeText(R.restore(raw)).then(() => toast('Copied.'));
      const oc = el.querySelector('[data-aip-chat]'); if (oc) oc.onclick = () => LambdaWebChat.show();
      el.querySelector('[data-aip-sent]').onclick = () => { const p = el.querySelector('.ai-sent'); p.hidden = !p.hidden; };
      if (raw) turns.push({ q, raw });
      scroll();
    }
    $('#aipForm').addEventListener('submit', e => { e.preventDefault(); if (busy) { ctrl?.abort(); return; } ask(ta.value); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aipForm').requestSubmit(); } });
    box.addEventListener('click', e => {
      const q = e.target.closest('[data-aip-q]'); if (q) return ask(q.dataset.aipQ);
      if (e.target.closest('[data-aip-close]')) return close();
      if (e.target.closest('[data-aip-new]')) { ctrl?.abort(); turns = []; R = null; if (typeof LambdaWebChat !== 'undefined') LambdaWebChat.reset(); empty(); head(); return; }
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
        ${b.yard?.on && (b.yard.inProd.length || b.yard.lockedOther.length || b.yard.lockedMine.length) ? sec('Your hosts in Yard', b.yard.inProd.length + b.yard.lockedOther.length + b.yard.lockedMine.length,
          b.yard.inProd.map(({ t, y }) => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum mono">${esc(t.device)}</span><span class="small st-warning" title="Runs ${esc(y.state)}${y.pool ? ' in pool ' + esc(y.pool) : ''} and isn't locked: lock or drain it before hands-on work">⚠ in prod, not locked</span></div>`).join('')
          + b.yard.lockedOther.map(({ t, y }) => `<div class="mini-ticket" data-ticket="${t.key}"><span class="qkey">${t.key}</span><span class="qsum mono">${esc(t.device)}</span><span class="small">🔒 locked by ${esc(y.lockedBy)}</span></div>`).join('')
          + b.yard.lockedMine.map(({ host }) => `<div class="mini-ticket" data-href="${esc(yardUrl(host))}"><span class="qkey">Unlock?</span><span class="qsum mono">${esc(host)}</span><span class="small">🔒 still locked by you, no open ticket</span></div>`).join('')) : ''}
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
    if (k === 'ticket') D.ticketByKey(v) ? openEntity('ticket', D.ticketByKey(v)) : toast(`${v} isn’t in your open fleet tickets.`);
    if (k === 'site' && D.siteById(v)) { setView('globe'); SiteCard.open(D.siteById(v)); }
  }
  window.addEventListener('hashchange', route);
  setTimeout(route, 0);
  // Auto-open once a day, on the first new tab after the brief time. `briefDecided` lets the tour wait its turn.
  let briefDone; const briefDecided = new Promise(r => { briefDone = r; });
  if (isExt && !location.hash) LambdaLive.settings().then(async s => {
    let seen = ''; try { seen = localStorage.getItem('lambdaos-brief-seen') || ''; } catch { /* ignore */ }
    if (D.MODE === 'live' && s.brief.autoOpen && LambdaAlerts.briefDue(s.brief) && seen !== LambdaAlerts.dayKey(Date.now())) { await historyReady; openBrief(); }
  }).catch(() => {}).finally(() => briefDone());
  else briefDone();
  // Resolves once the daily brief isn't on screen (right away if it isn't open).
  const briefClosed = () => new Promise(res => {
    const b = $('#brief'); if (!b || b.hidden) return res();
    const mo = new MutationObserver(() => { if (b.hidden) { mo.disconnect(); res(); } });
    mo.observe(b, { attributes: true, attributeFilter: ['hidden'] });
  });

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
  bellBtn.addEventListener('click', e => { e.stopPropagation(); $('#sitePop').hidden = true; alertPop.hidden = !alertPop.hidden; paintBell(); });
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
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); Filter.focus(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
    if (e.key === 'Escape') { if (AIPanel.isOpen() && document.activeElement?.id !== 'aipText' && pal.hidden) AIPanel.close(); else if (!alertPop.hidden) alertPop.hidden = true; else if (!briefBox.hidden) closeBrief(); else if (!pal.hidden) closePalette(); else if (!$('#drawer').hidden) Drawer.close(); else if (!$('#siteCard').hidden) SiteCard.close(); else if (document.body.classList.contains('stage-max')) setStageMax(false); return; }
    if (e.key === '/' && pal.hidden && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
    // Single-key shortcuts work anywhere except while typing (they used to need focus on the page itself).
    if (pal.hidden && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
      if (e.key === 'g' || e.key === 'b') setView('graph'); if (e.key === 'f') setView('globe'); if (e.key === 'd') setView('deploys'); if (e.key === 'h') setView('health'); if (e.key === 't' && !Trace.traceHovered()) setView('trace');
      if (e.key === 'e') setStageMax(!document.body.classList.contains('stage-max'));
    }
  });

  /* ---------------- First-run tour: four quick stops, once per person (again from Settings → Help) ---------------- */
  {
    const KEYT = 'lambdaos-tour-done', TOUR_V = '2';
    const STEPS = [
      ['#siteBtn', 'Pick your sites', 'Show every site, just yours, or any you tick. Cards, tickets, feed, the brain, Health and notifications all follow. ★ a site in this menu to mark it as yours.'],
      ['#kpis', 'The top cards', 'Each card shows the number now, ▲/▼ since yesterday and the last 30 days. Hover a card for details, hover the chart for any day.'],
      ['.stage-head .tabs', 'Four views', 'Fleet globe (F), Second brain (B), Deployments (D) and Health (H). E makes the middle bigger, Esc goes back. Each view can show All sites or Your sites.'],
      ['#cmdTrigger', 'Search or ask', `Find any site, device, ticket, deployment or part (${KEY('K')}), or ask a question. ✨ Ask AI (${KEY('J')}) answers from the loaded data.`],
    ];
    // First stop (live only): which apps you use, so the ones you don't have never ask you to sign in.
    const APPS = ALLSRC, CORE = x => x.key === 'netbox' || x.key === 'jira';
    if (D.MODE === 'live' && isExt) STEPS.unshift(['.statusbar', 'Which apps do you have access to?', 'Untick any you don\'t have access to: Lambda OS won\'t read them or ask you to sign in. You can change this later in Settings → Sources.',
      `<div class="tour-apps">${APPS.map(x => `<label class="${CORE(x) ? 'core' : ''}"><input type="checkbox" data-app="${x.key}" ${x.state !== 'off' && x.state !== 'na' ? 'checked' : ''} ${CORE(x) ? 'disabled title="Lambda OS needs Jira and NetBox"' : ''}> ${esc(x.name)}</label>`).join('')}</div>`, true]);
    let appsChanged = false;
    async function saveApps() {
      const boxes = [...(box?.querySelectorAll('[data-app]') || [])]; if (!boxes.length) return;
      const { settings: st = {} } = await chrome.storage.local.get('settings'), src = { ...(st.sources || {}) };
      for (const c of boxes) if (!c.disabled && (src[c.dataset.app] !== false) !== c.checked) { src[c.dataset.app] = c.checked; appsChanged = true; }
      if (appsChanged) await chrome.storage.local.set({ settings: { ...st, sources: src } });
    }
    let i = 0, box = null;
    const end = () => { box?.remove(); box = null; try { localStorage.setItem(KEYT, TOUR_V); } catch { /* ignore */ } document.removeEventListener('keydown', onKey, true);
      if (appsChanged) { toast('Saved: Lambda OS skips the apps you unticked.'); setTimeout(() => location.reload(), 900); } };
    const onKey = e => { if (!box) return; if (e.key === 'Escape') { e.stopImmediatePropagation(); end(); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); saveApps().then(() => go(i + 1)); } else if (e.key === 'ArrowLeft') go(i - 1); };
    function go(k) {
      if (k >= STEPS.length) return end();
      i = Math.max(0, k);
      const [sel, title, text, extra] = STEPS[i], el = $(sel);
      if (!el || !el.getClientRects().length) return go(i + 1); // hidden at this width: skip that stop
      const r = el.getBoundingClientRect(), pad = 6;
      box ||= Object.assign(document.createElement('div'), { className: 'tour', role: 'dialog' });
      box.setAttribute('aria-label', 'Lambda OS tour');
      if (!box.isConnected) document.body.appendChild(box);
      const below = r.bottom + 200 < innerHeight, left = Math.max(12, Math.min(r.left, innerWidth - 372));
      box.innerHTML = `<div class="tour-hole" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
        <div class="tour-card" style="left:${left}px;${below ? `top:${r.bottom + 14}px` : `bottom:${innerHeight - r.top + 14}px`}">
          <small class="muted">${i + 1} of ${STEPS.length}</small><h3>${esc(title)}</h3><p>${esc(text)}</p>${extra || ''}
          <div class="tour-btns"><button class="btn" data-tour="skip">Skip tour</button><span>${i ? '<button class="btn" data-tour="back">Back</button>' : ''}<button class="btn primary" data-tour="next">${i === STEPS.length - 1 ? 'Done' : 'Next'}</button></span></div></div>`;
      box.querySelector('[data-tour=next]').focus();
    }
    document.addEventListener('click', async e => { const b = e.target.closest('[data-tour]'); if (!b) return; const a = b.dataset.tour; if (a !== 'back') await saveApps(); a === 'next' ? go(i + 1) : a === 'back' ? go(i - 1) : end(); });
    addEventListener('resize', () => { if (box) go(i); });
    // Version 2 added "Which apps do you use?": people who took the earlier tour see just that new stop, once.
    let seenV = null; try { seenV = localStorage.getItem(KEYT); } catch { /* ignore */ }
    const seen = seenV === TOUR_V;
    if (seenV && !seen && location.hash !== '#tour') { const fresh = STEPS.filter(x => x[4]); STEPS.length = 0; STEPS.push(...fresh); }
    if (!STEPS.length) { try { localStorage.setItem(KEYT, TOUR_V); } catch { /* ignore */ } }
    // Starts right away, even on a first load: the page waits to fill in the other apps until you finish or skip it.
    // The daily brief goes first: the tour starts once it's closed (or right away if it didn't open).
    if (location.hash === '#tour' || (!seen && STEPS.length)) briefDecided.then(() => new Promise(r => setTimeout(r, 900))).then(briefClosed).then(() => { document.addEventListener('keydown', onKey, true); go(0); if (location.hash === '#tour') history.replaceState(null, '', location.pathname); });
  }
}).catch(err => {
  console.error(err);
  let b = $('#bootMsg');
  if (!b) { b = Object.assign(document.createElement('div'), { className: 'boot-error', role: 'alert' }); document.body.prepend(b); } // the page had started drawing
  if (b) {
    b.textContent = `Something went wrong loading Lambda OS: ${err.message}. `;
    const a = Object.assign(document.createElement('a'), { href: LambdaUpdates.HELP.slack, target: '_blank', rel: 'noopener', textContent: `Message ${LambdaUpdates.HELP.name} on Slack` });
    b.append(a);
  }
});
