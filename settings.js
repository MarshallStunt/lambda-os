const $ = id => document.getElementById(id);
const FIELDS = ['atiumUrl', 'grafanaUrl', 'jiraUrl', 'fleetJql', 'mineJql', 'portfolioJql', 'intakeJql', 'netboxUrl', 'netboxToken', 'netsuiteUrl', 'nsOnHandSearch', 'nsMovesSearch', 'calendarEmail'];
const URLS = ['jiraUrl', 'netboxUrl', 'netsuiteUrl', 'atiumUrl', 'grafanaUrl'];
// An address is only saved once it looks complete (https://host.domain or a localhost address), so a half-typed one
// can't break the next refresh; the field says what's wrong and the last good address is kept meanwhile.
const urlOk = v => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) && (u.hostname.includes('.') || u.hostname === 'localhost'); } catch { return false; } };
function checkUrls() {
  const bad = [];
  for (const k of URLS) {
    const el = $(k), v = el.value.trim(), ok = !v || urlOk(v);
    el.classList.toggle('bad', !ok); el.setAttribute('aria-invalid', !ok);
    let msg = el.nextElementSibling?.classList.contains('field-err') ? el.nextElementSibling : null;
    if (!ok && !msg) { msg = Object.assign(document.createElement('p'), { className: 'field-err' }); el.after(msg); }
    if (msg) { msg.hidden = ok; msg.textContent = ok ? '' : /^https?:\/\//i.test(v) ? 'That address looks incomplete. The last good one is still used.' : 'Start the address with https:// (the last good one is still used).'; }
    if (!ok) bad.push(k);
  }
  return bad;
}
const SOURCES = LambdaLive.NAMES; // { netbox: 'NetBox', jira: 'Jira', … }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = html => ($('result').innerHTML = html);

$('sourceChecks').innerHTML = Object.entries(SOURCES).map(([k, n]) => `<label><input type="checkbox" data-source="${k}"><span>${n}</span></label>`).join('');

// ---------- Appearance: applies live ----------
const ACCENTS = { cyan: '#38e1ff', violet: '#a796ff', green: '#3ccf6e', orange: '#ff9d5c', pink: '#ff7eb6', blue: '#5aa2ff' };
$('lookAccent').innerHTML = Object.entries(ACCENTS).map(([k, c]) => `<button class="swatch" data-accent="${k}" style="background:${c}" title="${k}" aria-label="${k} accent"></button>`).join('');
let look = { ...window.LambdaLook.current() };
function paintLook() {
  document.querySelector(`input[name=theme][value=${look.theme}]`).checked = true;
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b.dataset.accent === look.accent));
  $('lookDensity').value = look.density; $('lookText').value = look.text; $('lookGlow').value = look.glow; $('lookMotion').value = look.motion;
}
async function setLook(patch) { look = await window.LambdaLook.save({ ...look, ...patch }); paintLook(); }
document.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => setLook({ theme: r.value })));
$('lookAccent').addEventListener('click', e => { const b = e.target.closest('[data-accent]'); if (b) setLook({ accent: b.dataset.accent }); });
[['lookDensity', 'density'], ['lookText', 'text'], ['lookGlow', 'glow'], ['lookMotion', 'motion']].forEach(([id, k]) => $(id).addEventListener('change', () => setLook({ [k]: $(id).value })));

// ---------- AI: one key + model per provider, kept while switching ----------
let ai = JSON.parse(JSON.stringify(LambdaLive.DEFAULTS.ai));
const KEY_HINT = { anthropic: 'sk-ant-…  (console.anthropic.com → API keys)', openai: 'sk-…  (platform.openai.com → API keys)', gemini: 'AIza…  (aistudio.google.com → API key)', local: 'Optional; most local servers need none' };
function paintAI() {
  const p = $('aiProvider').value;
  $('aiFields').hidden = p === 'off';
  $('aiLocalRow').hidden = p !== 'local';
  $('aiEffortRow').hidden = p !== 'anthropic';
  $('aiKeyLabel').textContent = p === 'local' ? 'API key (optional)' : `${LambdaAI.PROVIDERS[p]?.label || ''} API key`;
  $('aiKey').placeholder = KEY_HINT[p] || ''; $('aiKey').value = ai.keys[p] || '';
  $('aiModel').value = ai.models[p] || ''; $('aiModel').placeholder = p === 'anthropic' ? 'claude-opus-5-5' : p === 'gemini' ? 'gemini-flash-lite-latest' : 'Load models to choose';
  $('aiLocalUrl').value = ai.localUrl || ''; $('aiEffort').value = ai.effort || 'medium';
  $('aiModels').innerHTML = ''; $('aiTestOut').textContent = '';
}
function readAI() {
  const p = $('aiProvider').value;
  ai.provider = p;
  if (p !== 'off') { ai.keys[p] = $('aiKey').value.trim(); ai.models[p] = $('aiModel').value.trim(); }
  ai.localUrl = $('aiLocalUrl').value.trim() || LambdaAI.LOCAL_PRESETS.lmstudio; ai.effort = $('aiEffort').value;
  return ai;
}
let shownProvider = null;
$('aiProvider').addEventListener('focus', () => { shownProvider = $('aiProvider').value; });
$('aiProvider').addEventListener('change', () => {
  if (shownProvider && shownProvider !== 'off') { ai.keys[shownProvider] = $('aiKey').value.trim(); ai.models[shownProvider] = $('aiModel').value.trim(); }
  shownProvider = $('aiProvider').value; paintAI();
});
$('aiKeyShow').addEventListener('click', () => { const k = $('aiKey'); k.type = k.type === 'password' ? 'text' : 'password'; $('aiKeyShow').textContent = k.type === 'password' ? 'Show' : 'Hide'; });
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { $('aiLocalUrl').value = LambdaAI.LOCAL_PRESETS[b.dataset.preset]; }));
async function aiAccess() { // the local server address is user-chosen, so ask for it; the cloud providers are in the manifest
  if ($('aiProvider').value !== 'local') return true;
  try { const o = new URL($('aiLocalUrl').value.trim() || LambdaAI.LOCAL_PRESETS.lmstudio).origin + '/*'; return (await chrome.permissions.contains({ origins: [o] })) || await chrome.permissions.request({ origins: [o] }); } catch { return false; }
}
$('aiLoadModels').addEventListener('click', async () => {
  const p = $('aiProvider').value; if (p === 'off') return;
  if (!(await aiAccess())) return ($('aiTestOut').textContent = 'Permission to reach the local server was declined.');
  $('aiTestOut').textContent = 'Loading models…';
  try {
    const list = await LambdaAI.listModels(readAI(), p);
    $('aiModels').innerHTML = list.map(m => `<option value="${esc(m)}">`).join('');
    $('aiTestOut').textContent = list.length ? `${list.length} models available. Pick one in the Model box.` : 'No models found.';
    if (!$('aiModel').value && list[0]) $('aiModel').value = p === 'anthropic' && list.includes('claude-opus-5-5') ? 'claude-opus-5-5' : list[0];
  } catch (e) { $('aiTestOut').textContent = e.message; }
});
$('aiTest').addEventListener('click', async () => {
  if (!(await aiAccess())) return ($('aiTestOut').textContent = 'Permission to reach the local server was declined.');
  $('aiTestOut').textContent = 'Testing…';
  try { const r = await LambdaAI.test(readAI()); $('aiTestOut').innerHTML = `<span class="st-good">✓ Connected</span> · replied “${esc(r.slice(0, 60))}”`; }
  catch (e) { $('aiTestOut').innerHTML = `<span class="st-critical">✕ ${esc(e.message)}</span>`; }
});

// ---------- Privacy ----------
function paintPrivacy(pv) {
  document.querySelector(`input[name=privmode][value=${pv.mode}]`).checked = true;
  document.querySelectorAll('[data-priv]').forEach(c => (c.checked = !!pv[c.dataset.priv]));
  $('privWords').value = pv.words || '';
  $('privOptions').style.opacity = pv.mode === 'redact' ? 1 : 0.45;
}
function readPrivacy() {
  const pv = { mode: document.querySelector('input[name=privmode]:checked').value, words: $('privWords').value };
  document.querySelectorAll('[data-priv]').forEach(c => (pv[c.dataset.priv] = c.checked));
  return pv;
}
document.querySelectorAll('input[name=privmode]').forEach(r => r.addEventListener('change', () => { $('privOptions').style.opacity = r.value === 'redact' ? 1 : 0.45; }));

// ---------- Alerts & daily brief ----------
function paintAlerts(al, br) {
  $('alEnabled').checked = al.enabled; $('alBadge').checked = al.badge;
  document.querySelectorAll('[data-al]').forEach(c => (c.checked = !!al[c.dataset.al]));
  $('alSla').value = al.slaHours; $('alQuietFrom').value = al.quietFrom || ''; $('alQuietTo').value = al.quietTo || '';
  $('brEnabled').checked = br.enabled; $('brAuto').checked = br.autoOpen; $('brTime').value = br.time; $('brDays').value = br.days;
}
function readAlerts() {
  const al = { enabled: $('alEnabled').checked, badge: $('alBadge').checked, slaHours: Math.max(0.5, Math.min(72, parseFloat($('alSla').value) || 4)),
    quietFrom: $('alQuietFrom').value, quietTo: $('alQuietTo').value };
  document.querySelectorAll('[data-al]').forEach(c => (al[c.dataset.al] = c.checked));
  return al;
}
const readBrief = () => ({ enabled: $('brEnabled').checked, autoOpen: $('brAuto').checked, time: $('brTime').value || '08:30', days: $('brDays').value, ai: false });
// "Send a test alert" doubles as a diagnosis: worker → Chrome permission → notification created → the OS showing it.
$('alTest').addEventListener('click', async () => {
  const steps = [], row = (st, text) => steps.push(`<div class="boot-src"><b class="st-${st}">${st === 'good' ? '✓' : st === 'warning' ? '!' : '✕'}</b><span>${text}</span></div>`);
  say('<p class="muted">Testing…</p>');
  let ping;
  try { ping = await chrome.runtime.sendMessage({ type: 'ping' }); } catch (e) { ping = { ok: false, error: e.message }; }
  if (ping?.ok) row('good', `Background worker is running (v${esc(ping.version)}).`);
  else row('critical', `The background worker isn't responding (${esc(ping?.error || 'no reply')}). On <code>chrome://extensions</code>, click ↻ on Lambda OS. If it shows an <b>Errors</b> button, open it and send me the text.`);
  const level = await new Promise(r => chrome.notifications.getPermissionLevel(r));
  if (level === 'granted') row('good', 'Chrome allows Lambda OS to show notifications.');
  else row('critical', 'Chrome has notifications turned off for Lambda OS (usually from “Turn off notifications” on an earlier pop-up). Remove and re-add the extension to reset it.');
  let status = null;
  if (ping?.ok) {
    try { status = (await chrome.runtime.sendMessage({ type: 'test-alert' }))?.status; } catch (e) { status = { ok: false, error: e.message }; }
  } else {
    try { await chrome.notifications.create(`direct:${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Lambda OS alerts are on', message: 'Test from Settings.' }); status = { ok: true }; }
    catch (e) { status = { ok: false, error: e.message }; }
  }
  if (status?.ok) row('good', 'Chrome created the test notification.');
  else row('critical', `Chrome couldn't create the notification (${esc(status?.error || 'unknown error')}).`);
  const os = window.LambdaPlatform?.os || 'linux';
  const osHelp = {
    mac: `<b>macOS is hiding Chrome's notifications</b>. Open System Settings → Notifications → <b>Google Chrome</b>: turn on <i>Allow notifications</i> and pick <i>Banners</i> or <i>Alerts</i>. Also check that a Focus / Do Not Disturb isn't on (Control Center).`,
    win: `<b>Windows is hiding Chrome's notifications</b>. Open Settings → System → Notifications: make sure notifications are on and <b>Google Chrome</b> is allowed. Also check that <i>Do not disturb</i> / Focus assist is off.`,
    linux: `<b>your desktop is hiding Chrome's notifications</b>. Check your desktop's notification settings (GNOME: Settings → Notifications → Google Chrome; KDE: System Settings → Notifications) and that Do Not Disturb is off.`,
    cros: `<b>ChromeOS is hiding notifications</b>. Open the quick settings and make sure Do not disturb is off, and that notifications from Chrome are allowed.`,
  };
  const osLink = { mac: ['Open macOS notification settings', 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'], win: ['Open Windows notification settings', 'ms-settings:notifications'] }[os];
  if (ping?.ok && level === 'granted' && status?.ok) row('warning', `So if no pop-up appeared, ${osHelp[os]} Until then, every alert is still in the 🔔 alert center on the dashboard.`);
  say(steps.join('') + `<div class="row">${osLink ? `<button class="btn" id="openOsNotif">${osLink[0]}</button>` : ''}<button class="btn" id="openChromeNotif">Chrome notification settings</button></div>`);
  if (osLink) $('openOsNotif').onclick = () => { window.location.href = osLink[1]; };
  $('openChromeNotif').onclick = () => chrome.tabs.create({ url: 'chrome://settings/content/notifications' });
});
$('brTest').addEventListener('click', async () => { await save({ quiet: true }); chrome.runtime.sendMessage({ type: 'test-brief' }).then(() => say('<p class="st-good">Brief notification sent. Click it to open the brief.</p>')); });

function fill(s) {
  paintAlerts(s.alerts, s.brief);
  $('refreshMinutes').value = String(s.refreshMinutes ?? 10);
  $('appTabs').checked = s.appTabs !== false;
  ai = JSON.parse(JSON.stringify(s.ai)); $('aiProvider').value = ai.provider; shownProvider = ai.provider; paintAI();
  paintPrivacy(s.privacy);
  look = window.LambdaLook.current(); paintLook(); // theme.js keeps this in sync with the saved settings
  FIELDS.forEach(f => ($(f).value = s[f] || ''));
  document.querySelector(`input[name=mode][value=${s.mode === 'demo' ? 'demo' : 'live'}]`).checked = true;
  document.querySelectorAll('[data-source]').forEach(c => (c.checked = s.sources?.[c.dataset.source] !== false));
  const sm = s.smart || LambdaLive.DEFAULTS.smart;
  document.querySelector(`input[name=smartMode][value=${sm.mode === 'ai' ? 'ai' : 'local'}]`).checked = true;
  document.querySelectorAll('[data-smart]').forEach(c => (c.checked = sm[c.dataset.smart] !== false));
  $('smartSlack').checked = !!sm.slack;
  paintSmart();
}
// Smart processing: options only matter in AI mode; the status line says what the last refresh actually did.
async function paintSmart() {
  const ai = $('smartOpts'), on = document.querySelector('input[name=smartMode]:checked')?.value === 'ai';
  ai.style.opacity = on ? '1' : '.5'; ai.querySelectorAll('input').forEach(i => (i.disabled = !on));
  const { snapshot } = await chrome.storage.local.get('snapshot').catch(() => ({}));
  const x = snapshot?.smart, c = LambdaAI.configured(readAI());
  $('smartStatus').innerHTML = !on ? 'Local only: fixed rules, nothing is sent to an AI.'
    : !c.ok ? `<span class="st-warning">AI isn't set up yet, so the local rules are used.</span> ${esc(c.why)}`
    : !x?.on ? 'AI is on. It starts with the next refresh (click ↻ on the dashboard).'
    : x.why ? `<span class="st-warning">Last refresh: ${esc(x.why)}</span>`
    : `<span class="st-good">✓ Last refresh used ${esc(x.label || c.label)}</span>: ${x.calls ? `${x.calls} request${x.calls > 1 ? 's' : ''} for ${x.items} item${x.items > 1 ? 's' : ''}` : 'nothing new to ask'} · ${new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
document.addEventListener('change', e => { if (e.target.name === 'smartMode' || e.target.id === 'aiProvider') setTimeout(paintSmart, 50); });
function read() {
  const s = { mode: document.querySelector('input[name=mode]:checked').value, sources: {} };
  FIELDS.forEach(f => (s[f] = $(f).value.trim()));
  for (const k of URLS) s[k] = (s[k] || LambdaLive.DEFAULTS[k]).replace(/\/+$/, '');
  document.querySelectorAll('[data-source]').forEach(c => (s.sources[c.dataset.source] = c.checked));
  s.ai = readAI(); s.privacy = readPrivacy(); s.look = look; s.alerts = readAlerts(); s.brief = readBrief();
  s.refreshMinutes = Number($('refreshMinutes').value);
  s.appTabs = $('appTabs').checked;
  s.smart = { mode: document.querySelector('input[name=smartMode]:checked')?.value === 'ai' ? 'ai' : 'local', slack: $('smartSlack').checked };
  document.querySelectorAll('[data-smart]').forEach(c => (s.smart[c.dataset.smart] = c.checked));
  return s;
}
// A Jira / NetBox / NetSuite address outside the built-in ones needs the user's OK to reach it.
async function ensureAccess(s) {
  const origins = LambdaLive.originsFor({ ...s, sources: { ...LambdaLive.DEFAULTS.sources, ...(s.sources || {}) } });
  const missing = [];
  for (const o of origins) if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
  return !missing.length || chrome.permissions.request({ origins: missing });
}

async function save(opts = {}) {
  const s = read();
  if (checkUrls().length) return say('<p class="st-critical">Fix the address marked in red first.</p>');
  if (!(await ensureAccess(s)) || !(await aiAccess())) return say('<p class="st-critical">Permission to reach that address was declined, so that source can\'t be checked. (Your other changes are saved.)</p>');
  await chrome.storage.local.set({ settings: s });
  if (opts.quiet) return;
  if (s.mode !== 'live') return say('<p class="st-good">Saved. New tabs will show demo data.</p>');
  say('<p class="muted" id="prog">Checking every source…</p>');
  const snap = await LambdaLive.refresh(m => { const p = $('prog'); if (p) p.textContent = m; });
  const detail = {
    netbox: () => `${snap.nb?.sites.length ?? 0} sites, ${snap.nb?.stock.length ?? 0} stock lines`,
    jira: () => `${snap.jira?.tickets.length ?? 0} tickets, ${(snap.jira?.portfolio || []).filter(p => p.kind === 'deployment').length} deployments, ${(snap.jira?.portfolio || []).filter(p => p.kind === 'project').length} projects · ${esc(snap.jira?.me?.name || '')}${snap.jira?.portfolioError ? ` · deployments failed: ${esc(snap.jira.portfolioError)}` : ''}`,
    slack: () => `${snap.slack?.channels?.length ?? 0} channels, ${snap.slack?.mentions?.length ?? 0} recent mentions`,
    gmail: () => `${snap.gmail?.unread ?? 0} unread · ${esc(snap.gmail?.email || '')}`,
    calendar: () => `${snap.calendar?.events?.length ?? 0} upcoming events`,
    netsuite: () => `${snap.netsuite?.onhand?.length ?? 0} items on hand, ${snap.netsuite?.moves?.length ?? 0} material movements`,
    atium: () => `${snap.atium?.sites?.length ?? 0} sites, ${snap.atium?.builds?.length ?? 0} builds`,
    grafana: () => `${Object.keys(snap.grafana?.sites || {}).length} sites with metrics${snap.grafana?.fleet ? ', site health on' : ''}`,
  };
  say(Object.entries(SOURCES).map(([k, name]) => {
    const x = snap.sources[k] || {};
    const text = x.off ? '<span class="muted">Off</span>' : x.ok ? `<span class="st-good">✓ Connected${detail[k] ? ` · ${detail[k]()}` : ''}</span>` : `<span class="st-critical">✕ ${esc(x.error)}</span>`;
    return `<div class="boot-src"><b>${name}</b>${text}${!x.ok && !x.off && x.login ? `<button class="btn" data-login="${esc(x.login)}">Open ${name}</button>` : ''}</div>`;
  }).join(''));
}

// ---------- Backup: settings + tracked deployments (never the cached data) ----------
async function exportBackup() {
  const { settings = {}, tracked = [] } = await chrome.storage.local.get(['settings', 'tracked']);
  const data = { app: 'lambda-os', version: chrome.runtime.getManifest().version, savedAt: new Date().toISOString(), settings, tracked };
  // Never write secrets into a file: no NetBox token, no AI keys.
  data.settings = { ...data.settings, netboxToken: '', ai: data.settings.ai ? { ...data.settings.ai, keys: {} } : undefined };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `lambda-os-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`<p class="st-good">Backup saved: ${tracked.length} tracked deployments, your settings and appearance. API keys and tokens are never included.</p>`);
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return say('<p class="st-critical">That file isn’t a Lambda OS backup (not valid JSON).</p>'); }
  if (data?.app !== 'lambda-os' || typeof data.settings !== 'object') return say('<p class="st-critical">That file isn’t a Lambda OS backup.</p>');
  const { settings: current = {} } = await chrome.storage.local.get('settings');
  const allowed = new Set([...FIELDS, 'mode', 'sources', 'ai', 'privacy', 'look', 'alerts', 'brief', 'refreshMinutes', 'appTabs', 'smart']);
  const settings = Object.fromEntries(Object.entries(data.settings).filter(([k]) => allowed.has(k)));
  if (!settings.netboxToken && current.netboxToken) settings.netboxToken = current.netboxToken; // keep the token you already have
  settings.ai = { ...(settings.ai || current.ai || {}), keys: { ...(current.ai?.keys || {}) } };     // and the AI keys already in this browser (even if the backup has no AI section)
  if (settings.look) await window.LambdaLook.save(settings.look);
  const tracked = Array.isArray(data.tracked) ? data.tracked.filter(k => typeof k === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(k)) : [];
  if (!(await ensureAccess({ ...LambdaLive.DEFAULTS, ...settings }))) return say('<p class="st-critical">Permission for an address in the backup was declined, so nothing was loaded.</p>');
  await chrome.storage.local.set({ settings, tracked });
  await chrome.storage.local.remove('snapshot');
  fill(await LambdaLive.settings());
  say(`<p class="st-good">Backup from ${esc(data.savedAt?.slice(0, 10) || 'unknown date')} loaded: settings and ${tracked.length} tracked deployments. Open a new tab to reload the data.</p>`);
}

async function reset() {
  if (!confirm('Reset every setting to its default, including appearance, AI provider and API keys? Tracked deployments are kept. Save a backup first if you want to undo this (keys are not in backups).')) return;
  await chrome.storage.local.remove(['settings', 'snapshot']);
  await window.LambdaLook.save(window.LambdaLook.DEFAULT);
  fill(await LambdaLive.settings());
  say('<p class="st-good">Settings reset to defaults. Cached data cleared; it reloads on the next new tab.</p>');
}

$('save').addEventListener('click', () => save());

// ---------- Changes save themselves ----------
// Every field saves as soon as it changes (typing waits for a short pause). Chrome only lets an extension ask for access
// to a new address after a click, so a new Jira / NetBox / NetSuite / local AI address gets an "Allow access" button.
let autoT = null, pillT = null;
const pill = document.createElement('div');
pill.className = 'saved-pill'; pill.setAttribute('role', 'status'); pill.hidden = true;
document.body.appendChild(pill);
// Appearance (theme, accent, density…) already saves itself through LambdaLook, so it's left to that.
const skip = el => !el.matches?.('input, select, textarea') || el.type === 'file' || el.closest('[data-nosave]') || el.name === 'theme' || /^look/.test(el.id);
async function missingAccess(s) {
  const origins = LambdaLive.originsFor({ ...s, sources: { ...LambdaLive.DEFAULTS.sources, ...(s.sources || {}) } });
  if (s.ai?.provider === 'local') try { origins.push(new URL(s.ai.localUrl).origin + '/*'); } catch { /* not a URL yet */ }
  const out = [];
  for (const o of origins) if (!(await chrome.permissions.contains({ origins: [o] }).catch(() => true))) out.push(o);
  return out;
}
async function autoSave() {
  clearTimeout(autoT); autoT = null;
  const s = read(), stored = (await chrome.storage.local.get('settings')).settings || {};
  for (const k of checkUrls()) s[k] = stored[k] || LambdaLive.DEFAULTS[k]; // keep the last good address while one is half-typed
  s.look = stored.look || s.look; // never undo an appearance change
  await chrome.storage.local.set({ settings: s });
  const need = await missingAccess(s);
  pill.innerHTML = need.length
    ? `✓ Saved · Lambda OS needs access to ${esc(need.map(o => o.replace(/^https?:\/\//, '').replace(/\/\*$/, '')).join(', '))} <button class="btn primary" id="pillAllow">Allow access</button>`
    : '✓ Saved';
  pill.classList.toggle('warn', !!need.length); pill.hidden = false;
  clearTimeout(pillT); if (!need.length) pillT = setTimeout(() => { pill.hidden = true; }, 1800);
  $('pillAllow')?.addEventListener('click', async () => {
    const ok = await chrome.permissions.request({ origins: need }).catch(() => false);
    pill.innerHTML = ok ? '✓ Access allowed' : 'Access not allowed, so that source stays off.'; pill.classList.toggle('warn', !ok);
    clearTimeout(pillT); pillT = setTimeout(() => { pill.hidden = true; }, 2500);
  });
}
const typing = el => el.matches('input[type=text], input[type=url], input[type=email], input[type=password], input[type=number], input:not([type]), textarea');
document.addEventListener('input', e => { if (skip(e.target)) return; clearTimeout(autoT); autoT = setTimeout(autoSave, typing(e.target) ? 700 : 0); });
document.addEventListener('change', e => { if (skip(e.target)) return; autoSave(); });
window.addEventListener('beforeunload', () => { if (autoT) autoSave(); }); // a pending edit is saved even if you close the page right away
$('appTabs').addEventListener('change', async () => { await save({ quiet: true }); say($('appTabs').checked ? '<p class="st-good">Saved. Lambda OS keeps its own pinned tabs when you don\'t have the app open.</p>' : '<p class="st-good">Saved. Lambda OS closed its pinned tabs and only reads from tabs you open.</p>'); });
$('refreshMinutes').addEventListener('change', async () => { await save({ quiet: true }); say(`<p class="st-good">Saved. Data now refreshes ${$('refreshMinutes').value === '0' ? 'only when you click ↻' : `every ${$('refreshMinutes').selectedOptions[0].text.replace(/^Every /, '').replace(/ \(default\)/, '')}`}.</p>`); });
$('open').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') }));
$('clear').addEventListener('click', async () => { await chrome.storage.local.remove('snapshot'); say('<p class="muted">Cached data cleared.</p>'); });
$('reset').addEventListener('click', reset);
$('exportBtn').addEventListener('click', exportBackup);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });
$('result').addEventListener('click', e => { const b = e.target.closest('[data-login]'); if (b) window.open(b.dataset.login, '_blank'); });
LambdaLive.settings().then(fill);

// ---------- Updates ----------
async function showUpdate(force) {
  $('updStatus').textContent = force ? 'Checking GitHub…' : $('updStatus').textContent;
  let u;
  try { u = await chrome.runtime.sendMessage({ type: 'update-check', force }); } catch { u = null; }
  u ||= await LambdaUpdates.check(force);
  $('updStatus').innerHTML = !u.ok ? `You have ${esc(u.current)}. <span class="st-critical">Couldn't check: ${esc(u.error)}.</span>`
    : u.available ? `<b class="st-good">🆕 Version ${esc(u.latest)} is available</b> (you have ${esc(u.current)}).` : `✓ You have the latest version (${esc(u.current)}).`;
  if (u.latest) $('updZipName').textContent = `lambda-os-${u.latest}.zip`;
  $('updHow').hidden = !u.available; $('updLater').hidden = !u.available; $('updLater').dataset.version = u.latest || '';
}
$('updCmdLabel').textContent = `Paste this in ${{ win: 'PowerShell', mac: 'Terminal', linux: 'a terminal', cros: 'the Linux terminal' }[window.LambdaPlatform?.os || 'linux']}. It finds your Lambda OS folder, then pulls if it's a git copy, or downloads the ZIP and opens the folder.`;
$('updChanges').href = LambdaUpdates.LINKS.changes; $('updZip').href = LambdaUpdates.LINKS.zip; $('updDownload').href = LambdaUpdates.LINKS.download; $('updCmd').value = LambdaUpdates.command();
$('updCheck').addEventListener('click', () => showUpdate(true));
$('updCopy').addEventListener('click', async () => { await navigator.clipboard.writeText($('updCmd').value); $('updCopy').textContent = 'Copied ✓'; setTimeout(() => ($('updCopy').textContent = 'Copy'), 1500); });
$('updReload').addEventListener('click', () => chrome.runtime.reload());
$('updLater').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'update-later', version: $('updLater').dataset.version }); say('<p class="muted">OK, the NEW badge is hidden until the next version.</p>'); });
showUpdate(false);
if (location.hash === '#updates') setTimeout(() => $('updates').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
