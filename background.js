// Service worker:
//  • toolbar button opens the dashboard; keeps the NetBox/Jira/… snapshot warm every 10 minutes so new tabs open instantly
//  • after every new snapshot: desktop alerts, the toolbar badge, and a compact daily history (for the brief's deltas)
//  • the daily brief notification at the time set in Settings
//  • makes the extension's API requests look like a plain client, not a browser (drop Origin/Referer/Sec-*, own UA)
importScripts('live.js', 'data.js', 'alerts.js', 'updates.js');

const PLAIN_CLIENT_RULE_ID = 1;
const BROWSER_HEADERS = ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

async function installPlainClientRule() {
  const rule = headers => ({
    id: PLAIN_CLIENT_RULE_ID, priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        ...headers.map(header => ({ header, operation: 'remove' })),
        { header: 'user-agent', operation: 'set', value: `lambda-os/${chrome.runtime.getManifest().version}` },
      ],
    },
    // Google and NetSuite are signed-in web pages, not APIs: leave their requests looking like the browser so bot checks don't trip.
    condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'], excludedRequestDomains: ['google.com', 'netsuite.com'] },
  });
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PLAIN_CLIENT_RULE_ID], addRules: [rule(BROWSER_HEADERS)] });
  } catch (e) {
    console.warn('plain client rule', e);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PLAIN_CLIENT_RULE_ID], addRules: [rule(['origin', 'referer'])] })
      .catch(e2 => console.warn('plain client rule', e2));
  }
}
installPlainClientRule();

// AI providers get their own, stricter rule: the request carries nothing a browser would add (no cookies, no
// Origin/Referer, no client hints, no Sec-Fetch-*, no Accept-Language) and identifies as Lambda OS, not Chrome.
const AI_RULE_ID = 2;
const AI_HOSTS = ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'localhost', '127.0.0.1'];
async function installAiRule() {
  const strip = ['cookie', 'origin', 'referer', 'accept-language', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
    'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'priority'];
  const rule = headers => ({
    id: AI_RULE_ID, priority: 2,
    action: { type: 'modifyHeaders', requestHeaders: [...headers.map(header => ({ header, operation: 'remove' })),
      { header: 'user-agent', operation: 'set', value: `lambda-os/${chrome.runtime.getManifest().version}` }] },
    condition: { initiatorDomains: [chrome.runtime.id], requestDomains: AI_HOSTS, resourceTypes: ['xmlhttprequest', 'other'] },
  });
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [AI_RULE_ID], addRules: [rule(strip)] }); }
  catch (e) {
    console.warn('ai rule', e); // some Chrome versions refuse Sec-* edits: keep the essentials
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [AI_RULE_ID], addRules: [rule(['cookie', 'origin', 'referer', 'accept-language'])] }).catch(e2 => console.warn('ai rule', e2));
  }
}
installAiRule();

const DASH = () => chrome.runtime.getURL('newtab.html');
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: DASH() }));

/* ---------------- Background refresh ---------------- */
const REFRESH_ALARM = 'refresh', BRIEF_ALARM = 'brief';
// Refresh interval comes from Settings → Data (refreshMinutes; 0 = manual only). Re-created only when it changes.
async function scheduleRefresh() {
  const s = await LambdaLive.settings(), every = Number(s.refreshMinutes) || 0;
  const cur = await chrome.alarms.get(REFRESH_ALARM);
  if (!every || s.mode !== 'live') { if (cur) await chrome.alarms.clear(REFRESH_ALARM); return; }
  if (cur?.periodInMinutes === every) return;
  await chrome.alarms.clear(REFRESH_ALARM);
  chrome.alarms.create(REFRESH_ALARM, { delayInMinutes: Math.min(1, every), periodInMinutes: every });
}
scheduleRefresh();

/* ---------------- Alerts ---------------- */
async function buildD(snap) {
  await LambdaData.prepare(); // load tracked deployments
  return LambdaData.buildLive(snap);
}
// Toolbar badge: your urgent ticket count wins; otherwise "NEW" while an update is waiting (until "Later" for that version).
async function setBadge(count, on) {
  if (count !== undefined) await chrome.storage.session.set({ badgeUrgent: on ? count : 0 });
  const { badgeUrgent = 0 } = await chrome.storage.session.get('badgeUrgent');
  const { updateCheck, updateLater } = await chrome.storage.local.get(['updateCheck', 'updateLater']);
  const latest = updateCheck?.ok ? updateCheck.latest : null;
  const update = latest && LambdaUpdates.newer(latest, chrome.runtime.getManifest().version) && updateLater !== latest;
  const text = badgeUrgent ? String(badgeUrgent > 99 ? '99+' : badgeUrgent) : update ? 'NEW' : '';
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color: badgeUrgent ? '#d03b3b' : '#2a78d6' });
  await chrome.action.setTitle({ title: [badgeUrgent ? `${badgeUrgent} urgent tickets` : '', update ? `Lambda OS ${latest} is available` : ''].filter(Boolean).join(' · ') || 'Open Lambda OS' });
}

/* ---------------- Updates (like Lambda Rackside) ---------------- */
const UPDATE_ALARM = 'updateCheck';
async function updateCheck(force = false) {
  const u = await LambdaUpdates.check(force);
  await setBadge();
  if (!u.available) return u;
  const { updateNotified } = await chrome.storage.local.get('updateNotified');
  if (updateNotified !== u.latest) {
    await chrome.storage.local.set({ updateNotified: u.latest });
    await notify([{ id: `update:${u.latest}`, url: chrome.runtime.getURL('settings.html#updates'), title: `Lambda OS ${u.latest} is available`,
      message: `You have ${u.current}. Click to see what's new and update.` }], { log: false });
  }
  return u;
}
chrome.alarms.get(UPDATE_ALARM).then(a => a || chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 120 }));
// Every alert is also kept in an in-app log (🔔 in the dashboard), so nothing is lost when the OS hides pop-ups.
async function logAlerts(notes) {
  const { alertLog = [] } = await chrome.storage.local.get('alertLog');
  const now = Date.now();
  const add = notes.map(n => ({ id: n.id, at: now, title: n.title, message: n.message || '', url: n.url || '', urgent: !!n.urgent, read: false }));
  await chrome.storage.local.set({ alertLog: [...add, ...alertLog].slice(0, 60) });
}
async function notify(notes, { log = true } = {}) {
  if (log) await logAlerts(notes);
  const urls = (await chrome.storage.session.get('notifUrls')).notifUrls || {};
  const show = notes.length > 3
    ? [{ id: `batch:${Date.now()}`, urgent: notes.some(n => n.urgent), url: DASH(), title: `${notes.length} Lambda OS alerts`,
        message: notes.slice(0, 4).map(n => n.title).join('\n') + (notes.length > 4 ? `\n+${notes.length - 4} more` : '') }]
    : notes;
  for (const n of show) {
    const id = `${n.id}:${Date.now()}`;
    urls[id] = n.url || DASH();
    try {
      await chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: n.title, message: n.message || '',
        priority: n.urgent ? 2 : 0, requireInteraction: !!n.urgent });
      await chrome.storage.local.set({ notifyStatus: { ok: true, at: Date.now() } });
    } catch (e) {
      console.warn('notification', e);
      await chrome.storage.local.set({ notifyStatus: { ok: false, at: Date.now(), error: String(e.message || e) } });
    }
  }
  await chrome.storage.session.set({ notifUrls: urls });
}
let running = null;
async function runAlerts(snap) {
  if (running) return running;
  running = (async () => {
    const s = await LambdaLive.settings();
    if (s.mode !== 'live' || !snap) return;
    const D = await buildD(snap);
    const { alertState, history } = await chrome.storage.local.get(['alertState', 'history']);
    const res = LambdaAlerts.evaluate(D, alertState, s.alerts);
    await chrome.storage.local.set({ alertState: res.state, history: LambdaAlerts.addToHistory(history, D) });
    await setBadge(res.urgentCount, s.alerts.enabled && s.alerts.badge);
    if (s.alerts.enabled && res.notes.length && !LambdaAlerts.quiet(s.alerts)) await notify(res.notes);
  })().catch(e => console.warn('alerts', e)).finally(() => { running = null; });
  return running;
}

/* ---------------- Daily brief ---------------- */
async function scheduleBrief() {
  const s = await LambdaLive.settings();
  await chrome.alarms.clear(BRIEF_ALARM);
  if (s.brief.enabled) chrome.alarms.create(BRIEF_ALARM, { when: LambdaAlerts.nextBriefAt(s.brief) });
}
async function briefNotification() {
  const s = await LambdaLive.settings();
  const { snapshot, history } = await chrome.storage.local.get(['snapshot', 'history']);
  let message = 'Open it for today’s meetings, your tickets and tracked deployments.';
  if (snapshot && s.mode === 'live') {
    const b = LambdaAlerts.brief(await buildD(snapshot), history);
    const down = b.troubled.map(s => s.name);
    message = [down.length ? `⚠ ${down.join(', ')} not up to date` : '', `${b.meetings.length} meetings today`, `${b.myBreached.length} of your tickets breached`, `${b.myDue.length} due today`,
      `${b.tracked.length} tracked deployments`, b.partsArrived.length ? `${b.partsArrived.length} parts arrived` : ''].filter(Boolean).join(' · ');
  }
  await notify([{ id: 'brief', url: `${DASH()}#brief`, title: 'Your daily brief is ready', message }]);
}

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === REFRESH_ALARM) {
    const s = await LambdaLive.settings();
    if (s.mode === 'live') await LambdaLive.refresh().catch(e => console.warn('refresh', e)); // the new snapshot triggers alerts below
  }
  if (a.name === UPDATE_ALARM) await updateCheck().catch(e => console.warn('update check', e));
  if (a.name === BRIEF_ALARM) { await briefNotification().catch(e => console.warn('brief', e)); await scheduleBrief(); }
});
// Every new snapshot (from this worker or from a dashboard tab) runs the alerts; settings changes reschedule the brief.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.snapshot?.newValue) runAlerts(changes.snapshot.newValue);
  if (changes.settings) { scheduleBrief(); scheduleRefresh(); }
});
chrome.notifications.onClicked.addListener(async id => {
  const urls = (await chrome.storage.session.get('notifUrls')).notifUrls || {};
  chrome.tabs.create({ url: urls[id] || DASH() });
  chrome.notifications.clear(id);
  delete urls[id]; await chrome.storage.session.set({ notifUrls: urls });
});
// Settings → "Send a test alert"
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'ping') { reply({ ok: true, version: chrome.runtime.getManifest().version }); return; }
  if (msg?.type === 'test-alert') {
    notify([{ id: 'test', url: DASH(), title: 'Lambda OS alerts are on', message: 'This is what an alert looks like. Click to open the dashboard.' }])
      .then(async () => reply({ ok: true, status: (await chrome.storage.local.get('notifyStatus')).notifyStatus }))
      .catch(e => reply({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === 'update-check') { updateCheck(!!msg.force).then(reply).catch(e => reply({ ok: false, error: String(e.message || e) })); return true; }
  if (msg?.type === 'update-later') { chrome.storage.local.set({ updateLater: msg.version }).then(() => setBadge()).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'test-brief') { briefNotification().then(() => reply({ ok: true })); return true; }
});

chrome.runtime.onInstalled.addListener(d => { scheduleBrief(); scheduleRefresh(); updateCheck(true).catch(() => {}); if (d.reason === 'install') chrome.tabs.create({ url: DASH() }); });
chrome.runtime.onStartup.addListener(() => { scheduleBrief(); scheduleRefresh(); });
