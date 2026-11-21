// Self-healing app tabs. Some sources (Slack, and Gmail / Calendar / NetSuite when a direct request isn't signed in)
// can only be read from an open, signed-in page. For those, Lambda OS:
//  1. reads from the user's own tab of that app when one is open and loaded (and never closes, reloads or moves it);
//  2. otherwise keeps its own pinned background tab per app (NetSuite: a temporary tab, closed after 5 idle minutes);
//  3. finds that tab again by address after a Chrome restart (restored tabs get new ids) and closes duplicate copies;
//  4. heals it: reloads it when discarded/frozen/unloaded and every 30 minutes, sends it back when it wanders off,
//     waits for it to finish loading before reading, and retries a failed read once after a reload;
//  5. stops with "SIGN_IN: …" when it lands on a sign-in page (it never types credentials);
//  6. pauses an app for 30 minutes when the site shows a bot check, and never tries to get past it.
// tick() runs from the service worker's 1-minute alarm. Works in the worker and in extension pages; no DOM here.

const LambdaTabs = (() => {
  const OWN_KEY = 'appTabs', TEMP_KEY = 'tempTabs', PAUSE_KEY = 'appPause';
  const REFRESH_MS = 30 * 60e3, LOAD_TIMEOUT_MS = 30e3, SETTLE_MS = 1500, TEMP_IDLE_MS = 5 * 60e3, PAUSE_MS = 30 * 60e3;
  const SIGN_IN = [
    /^https:\/\/accounts\.google\.com\//, /^https:\/\/login\.microsoftonline\.com\//, /^https:\/\/login\.live\.com\//,
    /^https:\/\/([\w-]+\.)?slack\.com\/(signin|sign_in|workspace-signin|ssb\/signin|checkcookie|sso)/i,
    /^https:\/\/[\w-]+\.slack\.com\/?([?#]|$)/, // a workspace's landing page is its sign-in page
    /^https:\/\/[\w-]+\.okta\.com\//, /^https:\/\/system\.netsuite\.com\/pages\/customerlogin/i, /^https:\/\/[\w-]+\.app\.netsuite\.com\/app\/login\//i,
  ];
  const BOT = [/^https:\/\/(www\.|ipv[46]\.)?google\.[a-z.]+\/sorry\//, /^https:\/\/challenges\.cloudflare\.com\//];
  const BOT_TEXT = /unusual traffic|captcha|are you a robot|verify (that )?you are (a )?human/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const has = () => typeof chrome !== 'undefined' && !!chrome.tabs?.query && !!chrome.storage?.local;

  // The apps that are read from a page. `home` is the path our tab should stay under; `pinned: false` = temporary tab.
  function apps(s = {}) {
    let ns = null, at = null, gf = null, yd = null;
    try { ns = new URL(s.netsuiteUrl).origin; } catch { /* not set */ }
    try { at = new URL(s.atiumUrl || 'https://kelsier.aws.lambdalabs.cloud').origin; } catch { /* not set */ }
    try { gf = new URL(s.grafanaUrl || 'https://grafana.aws.lambdalabs.cloud').origin; } catch { /* not set */ }
    try { yd = new URL(s.yardUrl || 'https://yard-central.aws.lambdalabs.cloud').origin; } catch { /* not set */ }
    const list = [
      { key: 'slack', name: 'Slack', url: 'https://app.slack.com/client', home: '/client', pinned: true, always: true },
      { key: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/u/0/', home: '/mail/', pinned: true },
      // Calendar is read from its page (schedule view), not the agenda feed, which Google answers with "unusual traffic".
      { key: 'calendar', name: 'Google Calendar', url: 'https://calendar.google.com/calendar/u/0/r/agenda', home: '/calendar/', pinned: true, always: true, ownOnly: true },
      // Atium keeps its Okta sign-in in the page, so it's read from a tab like Slack.
      at && { key: 'atium', name: 'Atium', url: `${at}/builds`, home: '/', pinned: true, always: true },
      ns && { key: 'netsuite', name: 'NetSuite', url: `${ns}/app/center/card.nl`, home: '/app/', pinned: false },
      // Grafana is normally read directly; a temporary tab is only used if its sign-in refuses direct reads.
      gf && { key: 'grafana', name: 'Grafana', url: `${gf}/dashboards`, home: '/', pinned: false },
      // Yard Central keeps its Okta sign-in in the page too, so it's read from its own tab (read-only host searches).
      yd && { key: 'yard', name: 'Yard', url: `${yd}/dashboard`, home: '/', pinned: true, busyOk: true }, // its page never reports "finished loading", so it's read once it's on the app
    ].filter(Boolean);
    return Object.fromEntries(list.map(a => [a.key, a]));
  }

  const urlOf = t => t?.pendingUrl || t?.url || '';
  const base = u => String(u || '').split(/[?#]/)[0].replace(/\/$/, ''); // address without ?query and #hash
  const originOf = u => { try { return new URL(u).origin; } catch { return ''; } };
  // "Our address" = same origin, and the path (ignoring ?query and #hash) under the app's home path.
  const atHome = (app, u) => { try { const x = new URL(u); return x.origin === originOf(app.url) && x.pathname.startsWith(app.home); } catch { return false; } };
  const pageKind = (u, title = '') => SIGN_IN.some(r => r.test(u)) ? 'signin' : (BOT.some(r => r.test(u)) || BOT_TEXT.test(title)) ? 'bot' : '';

  class TabError extends Error {
    constructor(msg, { signIn = false, login = '', paused = false } = {}) { super(msg); this.auth = signIn; this.login = login; this.paused = paused; }
  }
  const signInError = app => new TabError(`SIGN_IN: sign in once in the pinned ${app.name} tab`, { signIn: true, login: app.url });

  /* ---------------- storage ---------------- */
  const load = async (key, area = 'local') => (await chrome.storage[area].get(key))[key] || {};
  async function saveOwn(key, rec) {
    const all = await load(OWN_KEY);
    if (rec) all[key] = rec; else delete all[key];
    await chrome.storage.local.set({ [OWN_KEY]: all });
  }
  const tempArea = () => (chrome.storage.session ? 'session' : 'local');

  /* ---------------- bot-check back-off ---------------- */
  async function pausedUntil(key) {
    const until = (await load(PAUSE_KEY))[key] || 0;
    return until > Date.now() ? until : 0;
  }
  async function pause(key, ms = PAUSE_MS) {
    const all = await load(PAUSE_KEY);
    all[key] = Date.now() + ms;
    await chrome.storage.local.set({ [PAUSE_KEY]: all });
    return all[key];
  }
  const pausedError = (name, until) => new TabError(`${name}: paused until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. `
    + 'The site showed a bot check ("unusual traffic"), so Lambda OS is backing off for 30 minutes.', { paused: true });
  // Throws while the app is paused, so nothing (not even a direct feed request) is sent to it.
  async function checkPaused(key, name = key) {
    if (!has()) return;
    const until = await pausedUntil(key);
    if (until) throw pausedError(name, until);
  }
  // A direct request landed on a bot-check page: pause the app and stop.
  async function botCheck(key, name, res) {
    if (!res || !(BOT.some(r => r.test(res.url || '')) || (res.status === 429 && BOT_TEXT.test(res.text || '')))) return;
    throw pausedError(name, await pause(key));
  }

  /* ---------------- waiting for a tab ---------------- */
  // Resolves with the tab once it reports status "complete", or with whatever state it's in after the timeout (null if closed).
  function waitComplete(tabId, ms = LOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
      let done = false;
      const finish = t => {
        if (done) return;
        done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(t || null);
      };
      const onUpdated = (id, info, t) => { if (id === tabId && info.status === 'complete') finish(t); };
      const timer = setTimeout(() => chrome.tabs.get(tabId).then(finish, () => finish(null)), ms);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId).then(t => { if (t.status === 'complete' && !t.discarded) finish(t); }, () => finish(null));
    });
  }

  /* ---------------- the hidden window ---------------- */
  // Lambda OS keeps its own tabs (app tabs, temporary tabs, the Ask AI chat) in ONE minimized window, so none of them
  // show up in your tab bar. The window is marked by a small Lambda OS page (hidden.html) pinned first in it, so any
  // part of Lambda OS (the background worker, every open dashboard) finds the same window, even after Chrome restarts
  // and restores it with new ids. If two ever exist (two parts made one at the same moment), everything moves into the
  // older one and the other closes.
  const HIDDEN_KEY = 'hiddenWindow', MAKING_KEY = 'hiddenMaking';
  const MARKER = () => chrome.runtime.getURL('hidden.html');
  const isMarker = t => urlOf(t) === MARKER();
  let making = null;
  async function hiddenWindow() {
    const marks = await chrome.tabs.query({ url: MARKER() }).catch(() => []);
    const legacyId = (await chrome.storage.session.get(HIDDEN_KEY).catch(() => ({})))[HIDDEN_KEY];
    const legacy = legacyId != null ? await chrome.windows.get(legacyId).catch(() => null) : null; // made before the marker page
    const ids = [...new Set(marks.map(t => t.windowId))].sort((x, y) => x - y);
    if (!ids.length) return legacy?.id ?? null;
    const main = ids[0];
    for (const wid of [...ids.slice(1), ...(legacy && !ids.includes(legacy.id) ? [legacy.id] : [])]) await mergeInto(main, wid);
    if (legacyId !== main) await chrome.storage.session.set({ [HIDDEN_KEY]: main }).catch(() => {});
    return main;
  }
  // Moves every tab of window `from` into `main` (pinned ones stay pinned), then closes what's left of `from`.
  async function mergeInto(main, from) {
    const tabs = await chrome.tabs.query({ windowId: from }).catch(() => []);
    for (const t of tabs) {
      if (isMarker(t)) continue;
      try { await chrome.tabs.move(t.id, { windowId: main, index: -1 }); if (t.pinned) await chrome.tabs.update(t.id, { pinned: true }); } catch { /* busy: next sweep */ }
    }
    for (const t of tabs.filter(isMarker)) await chrome.tabs.remove(t.id).catch(() => {}); // the window closes once empty
  }
  // Another part of Lambda OS may be making the window right now: wait for theirs instead of making a second one.
  async function waitForOthers() {
    const m = (await chrome.storage.session.get(MAKING_KEY).catch(() => ({})))[MAKING_KEY];
    if (!m || Date.now() - m > 8000) return null;
    for (let i = 0; i < 16; i++) { await sleep(500); const w = await hiddenWindow(); if (w != null) return w; }
    return null;
  }
  // A new minimized window that never steals focus, holding the marker page (and `tabId`, when moving one in).
  function makeWindow(opts = {}) {
    return making ??= (async () => {
      let wid = await waitForOthers();
      if (wid == null) {
        await chrome.storage.session.set({ [MAKING_KEY]: Date.now() }).catch(() => {});
        try {
          let win;
          try { win = await chrome.windows.create({ url: MARKER(), focused: false, state: 'minimized' }); }
          catch { win = await chrome.windows.create({ url: MARKER(), focused: false, width: 900, height: 700 }); chrome.windows.update(win.id, { state: 'minimized' }).catch(() => {}); }
          const mark = win.tabs?.[0]; if (mark) await chrome.tabs.update(mark.id, { pinned: true }).catch(() => {});
          wid = (await hiddenWindow()) ?? win.id; // if someone else made one at the same moment, this merges the two
        } finally { await chrome.storage.session.remove(MAKING_KEY).catch(() => {}); }
      }
      if (opts.tabId != null) await chrome.tabs.move(opts.tabId, { windowId: wid, index: -1 }).catch(() => {});
      return { id: wid };
    })().finally(() => { making = null; });
  }
  // Opens url as a background tab in the hidden window (pinned ones right after the marker, so they're found again).
  async function openHidden(url, { pinned = false } = {}) {
    const wid = (await hiddenWindow()) ?? (await makeWindow()).id;
    const tab = await chrome.tabs.create({ windowId: wid, url, active: false, pinned, ...(pinned ? { index: 1 } : {}) });
    await hideAgain(wid);
    return tab;
  }
  // The window was brought up (for a sign-in, or by you) and you've moved on: minimize it again. Left alone while you're
  // in it, or while the tab in front is still a sign-in page (you may be fetching a code in another window).
  async function hideAgain(wid) {
    if (wid == null) return;
    const w = await chrome.windows.get(wid, { populate: true }).catch(() => null);
    if (!w || w.state === 'minimized' || w.focused) return;
    if ((w.tabs || []).some(t => t.active && pageKind(urlOf(t), t.title) === 'signin')) return; // the sign-in you were shown
    await chrome.windows.update(wid, { state: 'minimized' }).catch(() => {});
  }
  // Moves one of our tabs (an old pinned tab in your window, the old Ask AI window's tab) into the hidden window.
  async function moveHidden(tab) {
    const wid = await hiddenWindow();
    if (tab.windowId === wid) return tab;
    try {
      if (wid != null) await chrome.tabs.move(tab.id, { windowId: wid, index: tab.pinned ? 1 : -1 });
      else await makeWindow({ tabId: tab.id });
      if (tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      return (await chrome.tabs.get(tab.id).catch(() => null)) || tab;
    } catch { return tab; } // couldn't move it (dragging, a dialog): leave it where it is
  }
  // One part of Lambda OS at a time for a given job (opening an app's tab): the background worker and every open
  // dashboard share this through session storage, so they don't each open a copy.
  async function xlock(name, fn) {
    const k = 'tabLock:' + name;
    for (let i = 0; i < 60; i++) {
      const v = (await chrome.storage.session.get(k).catch(() => ({})))[k];
      if (!v || Date.now() - v > 45000) break;
      await sleep(500);
    }
    await chrome.storage.session.set({ [k]: Date.now() }).catch(() => {});
    try { return await fn(); } finally { await chrome.storage.session.remove(k).catch(() => {}); }
  }
  // Is the person looking at this tab? A tab in the hidden window only counts while that window is up and focused.
  async function looking(tab) {
    if (!tab?.active) return false;
    if (tab.windowId !== await hiddenWindow()) return true;
    const w = await chrome.windows.get(tab.windowId).catch(() => null);
    return !!w && w.state !== 'minimized' && w.focused;
  }

  /* ---------------- our pinned tabs ---------------- */
  // Pinned tabs at exactly the address we opened, or last saw our tab on (?query and #hash ignored). After a restart
  // these are the candidates to adopt; a pinned tab of yours elsewhere in the app (another Slack channel) never counts.
  async function pinnedCopies(app) {
    const want = new Set([base(app.url), (await load(OWN_KEY))[app.key]?.at].filter(Boolean));
    return (await chrome.tabs.query({ pinned: true })).filter(t => want.has(base(urlOf(t))));
  }
  const locks = new Map();
  // Our pinned tab for the app: by saved id, else adopted by address, else (create) a new one. Extra copies are closed.
  function ownTab(app, { create = true } = {}) {
    const lockKey = `${app.key}:${create}`;
    if (!locks.has(lockKey)) {
      locks.set(lockKey, xlock(app.key, async () => {
        const rec = (await load(OWN_KEY))[app.key];
        let tab = rec?.id != null ? await chrome.tabs.get(rec.id).catch(() => null) : null;
        if (tab && !tab.pinned) { await saveOwn(app.key, null); tab = null; } // the user unpinned it: it's theirs now
        // Chrome restart: same tab, new id. After a fresh install (Lambda OS removed and added again), the old copy's pinned
        // tabs at exactly our addresses are reused instead of opening duplicates.
        const adopt = rec || (await chrome.storage.local.get('adoptPinned').catch(() => ({}))).adoptPinned;
        if (!tab && adopt) tab = (await pinnedCopies(app))[0] || null;
        if (tab) {
          // Other pinned tabs at the same address are left alone: they may be your own (e.g. your pinned Gmail).
          if (tab.id !== rec?.id) await saveOwn(app.key, { ...rec, id: tab.id });
          if (!(await looking(tab))) tab = await moveHidden(tab); // older versions pinned it in your window
          return { tab, rec: { ...rec, id: tab.id } };
        }
        if (!create) return null;
        tab = await openHidden(app.url, { pinned: true });
        const fresh = { id: tab.id, refreshedAt: Date.now(), createdAt: Date.now() };
        await saveOwn(app.key, fresh);
        return { tab, rec: fresh };
      }).finally(() => locks.delete(lockKey)));
    }
    return locks.get(lockKey);
  }

  // Get our tab into a readable state. Never yanks a tab the user is looking at (they may be signing in there).
  async function heal(app, tab, rec = {}, depth = 0) {
    const u = urlOf(tab), kind = pageKind(u, tab.status === 'complete' || app.busyOk ? tab.title : '');
    const stale = Date.now() - (rec.refreshedAt || 0) > REFRESH_MS;
    let action = null;
    if (kind) {
      // Stuck on a sign-in or bot-check page. Every 30 minutes (and after a pause ends) look once more at the app,
      // in case you signed in elsewhere; otherwise stop here. Never while you're looking at the tab.
      if (!depth && stale && !(await looking(tab))) action = 'navigate';
      else if (kind === 'bot') throw pausedError(app.name, await pause(app.key));
      else throw signInError(app);
    } else if (await looking(tab)) return remember(app, tab.status === 'complete' || app.busyOk ? tab : (await waitComplete(tab.id)) || tab, rec);
    else if (!atHome(app, u)) {
      if (depth) throw new TabError(`${app.name}: the pinned tab keeps leaving ${app.url} (now at ${originOf(u) || 'an unknown page'}).`);
      action = 'navigate';
    } else if (tab.discarded || tab.frozen || tab.status === 'unloaded') action = 'reload';
    else if (!depth && stale) action = 'reload';
    if (action === 'navigate') await chrome.tabs.update(tab.id, { url: app.url });
    if (action === 'reload') await chrome.tabs.reload(tab.id);
    if (action && app.pinned) { rec = { ...rec, id: tab.id, refreshedAt: Date.now() }; await saveOwn(app.key, rec); }
    // Some apps (Yard) keep a request open forever, so Chrome never calls them loaded: on their own page, that's fine.
    if (!action && (tab.status === 'complete' || app.busyOk)) return remember(app, tab, rec);
    const loaded = await waitComplete(tab.id, app.busyOk ? 12e3 : LOAD_TIMEOUT_MS);
    if (!loaded) throw new TabError(`${app.name}: the ${app.pinned ? 'pinned' : 'temporary'} tab closed while loading.`);
    if (loaded.status !== 'complete' && !app.busyOk) throw new TabError(`${app.name}: the ${app.pinned ? 'pinned' : 'temporary'} tab didn't finish loading within 30 seconds.`);
    if (action) await sleep(SETTLE_MS); // let the app start up before reading
    return heal(app, loaded, rec, depth + 1);
  }

  // Keep the address our tab is on, so it's recognised by address after a restart.
  async function remember(app, tab, rec) {
    if (app.pinned && atHome(app, urlOf(tab)) && rec.at !== base(urlOf(tab))) await saveOwn(app.key, { ...rec, id: tab.id, at: base(urlOf(tab)) });
    return tab;
  }

  /* ---------------- temporary tabs ---------------- */
  async function markTemp(tabId, appKey = '') {
    const area = tempArea(), all = await load(TEMP_KEY, area);
    all[tabId] = { at: Date.now(), app: appKey };
    await chrome.storage[area].set({ [TEMP_KEY]: all });
  }
  // Closes temporary tabs idle for 5+ minutes. A temporary tab that's the active tab is never closed (its clock restarts).
  async function closeTempTabs() {
    const area = tempArea(), all = await load(TEMP_KEY, area), now = Date.now();
    for (const [id, t] of Object.entries(all)) {
      const tab = await chrome.tabs.get(Number(id)).catch(() => null);
      if (!tab) delete all[id];
      else if (await looking(tab)) all[id].at = now;
      else if (now - t.at > TEMP_IDLE_MS) { await chrome.tabs.remove(tab.id).catch(() => {}); delete all[id]; }
    }
    await chrome.storage[area].set({ [TEMP_KEY]: all });
  }
  const tempTab = app => xlock('temp:' + app.key, async () => {
    const area = tempArea(), all = await load(TEMP_KEY, area);
    for (const [id, t] of Object.entries(all)) {
      if (t.app !== app.key) continue;
      const tab = await chrome.tabs.get(Number(id)).catch(() => null);
      if (tab) { await markTemp(tab.id, app.key); return tab; }
    }
    const tab = await openHidden(app.url);
    await markTemp(tab.id, app.key);
    return tab;
  });

  /* ---------------- choosing the tab to read from ---------------- */
  async function mine() {
    const own = new Set(Object.values(await load(OWN_KEY)).map(r => r.id));
    const temp = new Set(Object.keys(await load(TEMP_KEY, tempArea())).map(Number));
    return t => own.has(t.id) || temp.has(t.id);
  }
  // The user's own loaded tab of the app (any page of its site that isn't a sign-in or bot page), most recently used first.
  async function userTab(app) {
    const isMine = await mine();
    const tabs = (await chrome.tabs.query({ url: `${originOf(app.url)}/*` }))
      .filter(t => !isMine(t) && (t.status === 'complete' || app.busyOk) && !t.discarded && !t.frozen && !pageKind(urlOf(t), t.title));
    return tabs.sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)))[0] || null;
  }
  // { tab, own }: the user's tab if there is one; otherwise ours (opened if needed, unless useOwn is false).
  async function appTab(app, { useOwn = true, skipUser = false } = {}) {
    await checkPaused(app.key, app.name);
    // After a restart our pinned tab has a new id and would look like the user's: re-adopt it first.
    if (app.pinned && useOwn && (await load(OWN_KEY))[app.key]) await ownTab(app, { create: false });
    if (!skipUser && !(app.ownOnly && useOwn)) { const t = await userTab(app); if (t) return { tab: t, own: false }; }
    if (!useOwn) throw new TabError(`Open ${app.name} in a Chrome tab to connect it (or turn on "Keep pinned tabs" in Settings → Data).`, { signIn: true, login: app.url });
    if (!app.pinned) return { tab: await heal(app, await tempTab(app)), own: true };
    const o = await ownTab(app);
    if (!app.always) saveOwn(app.key, { ...((await load(OWN_KEY))[app.key] || o.rec), usedAt: Date.now() }).catch(() => {});
    return { tab: await heal(app, o.tab, o.rec), own: true };
  }

  // Runs func(...args) in the app's page and returns its result. A failed run in our tab is retried once after a reload;
  // a failed run in the user's tab is retried once in our own tab (the user's tab is never reloaded).
  async function run(app, func, args = [], opts = {}) {
    const exec = async tab => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))?.[0]?.result;
    let { tab, own } = await appTab(app, opts);
    try { return { result: await exec(tab), own, tab }; }
    catch (e) {
      if (!own) {
        if (opts.useOwn === false) throw e;
        ({ tab, own } = await appTab(app, { ...opts, skipUser: true }));
        return { result: await exec(tab), own, tab };
      }
      if (await looking(tab)) throw e; // don't reload a tab the user is looking at
      await chrome.tabs.reload(tab.id);
      const loaded = await waitComplete(tab.id, app.busyOk ? 12e3 : LOAD_TIMEOUT_MS);
      if (!loaded) throw e;
      await sleep(SETTLE_MS);
      tab = await heal(app, loaded, { ...((await load(OWN_KEY))[app.key] || {}), refreshedAt: Date.now() }, 1);
      return { result: await exec(tab), own, tab };
    }
  }

  // Reload our own tab once (e.g. Slack still starting) and check it again. Never used on the user's tabs.
  async function reload(app, tab) {
    if (await looking(tab)) return tab;
    await chrome.tabs.reload(tab.id);
    const loaded = await waitComplete(tab.id, app.busyOk ? 12e3 : LOAD_TIMEOUT_MS);
    if (!loaded) throw new TabError(`${app.name}: the tab closed while reloading.`);
    await sleep(SETTLE_MS);
    const rec = { ...((await load(OWN_KEY))[app.key] || {}), refreshedAt: Date.now() };
    if (app.pinned) await saveOwn(app.key, { ...rec, id: tab.id });
    return heal(app, loaded, rec, 1);
  }

  /* ---------------- upkeep (every minute, from the service worker) ---------------- */
  async function closeOwn(key) {
    const rec = (await load(OWN_KEY))[key];
    if (rec?.id != null) {
      const tab = await chrome.tabs.get(rec.id).catch(() => null);
      if (tab?.pinned) await chrome.tabs.remove(tab.id).catch(() => {});
    }
    await saveOwn(key, null);
  }
  async function tick(s) {
    if (!has()) return {};
    const A = apps(s), recs = await load(OWN_KEY), status = {};
    // A source that isn't available for this account (never signed in, see live.js) gets no pinned tab, and its tab is closed.
    let quiet = new Set(); try { const { snapshot } = await chrome.storage.local.get('snapshot'); quiet = new Set(Object.entries(snapshot?.sources || {}).filter(([, v]) => v?.quiet).map(([k]) => k)); } catch { /* none yet */ }
    const useOwn = s.mode === 'live' && s.appTabs !== false, on = key => useOwn && s.sources?.[key] !== false && !quiet.has(key);
    for (const key of Object.keys(recs)) if (!A[key] || !on(key)) await closeOwn(key); // app turned off: close its tab
    for (const app of Object.values(A)) {
      if (!app.pinned || !on(app.key)) continue;
      if (await pausedUntil(app.key)) { status[app.key] = 'paused'; continue; }
      // Slack and Calendar always get a tab (Slack not while you have your own); Gmail only once a direct read needed one.
      if (!recs[app.key] && (!app.always || (!app.ownOnly && await userTab(app)))) continue;
      try { const o = await ownTab(app); await heal(app, o.tab, o.rec); status[app.key] = 'ok'; }
      catch (e) { status[app.key] = e.message; }
    }
    await closeTempTabs();
    await sweep(A).catch(e => console.warn('sweep', e));
    return status;
  }

  // Keeps the hidden window to the minimum: one marker page, our tabs, nothing else of ours. Closes stray copies of our
  // apps' pages (from two parts of Lambda OS opening the same tab at once, or an old restored session), Gmail/Yard tabs
  // nobody has read from for an hour, and the whole window once nothing in it is needed. Never touches a tab you're
  // looking at, or a page that isn't one of our apps (if you dragged a tab of yours in there).
  const UNUSED_MS = 60 * 60e3;
  const CHAT_ORIGINS = ['https://claude.ai', 'https://chatgpt.com', 'https://gemini.google.com'];
  async function sweep(A) {
    const wid = await hiddenWindow(); if (wid == null) return;
    const recs = await load(OWN_KEY);
    for (const [key, rec] of Object.entries(recs)) { // pinned tabs that are only opened when needed close again after an hour unused
      const app = A[key]; if (!app || app.always) continue;
      if (!rec.usedAt) { await saveOwn(key, { ...rec, usedAt: Date.now() }); continue; }
      const tab = rec.id != null ? await chrome.tabs.get(rec.id).catch(() => null) : null;
      if (tab && Date.now() - rec.usedAt > UNUSED_MS && !(await looking(tab))) await closeOwn(key);
    }
    const own = new Set(Object.values(await load(OWN_KEY)).map(r => r.id));
    const temp = new Set(Object.keys(await load(TEMP_KEY, tempArea())).map(Number));
    const chat = (await chrome.storage.session.get('webchatWorker').catch(() => ({}))).webchatWorker?.tabId;
    const ours = new Set([...Object.values(A).map(a => originOf(a.url)), ...CHAT_ORIGINS]);
    const tabs = await chrome.tabs.query({ windowId: wid });
    const marks = tabs.filter(isMarker);
    for (const m of marks.slice(1)) await chrome.tabs.remove(m.id).catch(() => {}); // one marker is enough
    let keep = 0;
    for (const t of tabs) {
      if (isMarker(t)) continue;
      if (own.has(t.id) || temp.has(t.id) || t.id === chat || await looking(t)) { keep++; continue; }
      const u = urlOf(t);
      if (!u || u === 'about:blank' || ours.has(originOf(u))) await chrome.tabs.remove(t.id).catch(() => {});
      else keep++; // not one of ours: leave it
    }
    if (!keep) for (const m of marks) await chrome.tabs.remove(m.id).catch(() => {}); // nothing needed: close the window
    else await hideAgain(wid);
  }

  return { hiddenWindow, openHidden, moveHidden, hideAgain, looking, apps, appTab, ownTab, pinnedCopies, heal, reload, run, markTemp, closeTempTabs, tick, closeOwn, checkPaused, botCheck, pause, pageKind, TabError };
})();

if (typeof self !== 'undefined') self.LambdaTabs = LambdaTabs;
