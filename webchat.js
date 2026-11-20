// Ask AI through the chat you're already signed in to (Claude, ChatGPT or Gemini), with no API key.
// Lambda OS opens the chat site in one minimized window (reused for every question), types the question (same masked data as any Ask AI request),
// presses Send, and reads the answer back off the page as it's written. You only use the Ask AI box.
// It reads the chat page itself, so it can stop working when a site changes its layout; the selectors live in SITES.

const LambdaWebChat = (() => {
  const SITES = {
    claude: { name: 'Claude', url: 'https://claude.ai/new', host: 'claude.ai' },
    chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', host: 'chatgpt.com' },
    gemini: { name: 'Gemini', url: 'https://gemini.google.com/app', host: 'gemini.google.com' },
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Functions injected into the chat page (must be self-contained) ---------- */
  // What state the chat page is in: ready for a question, signed out, showing a "verify you're human" check,
  // or showing a usage-limit / error banner.
  function pageProbe(site) {
    const vis = e => !!(e && (e.offsetParent || e.getClientRects().length));
    const COMPOSER = { claude: '[data-testid="chat-input"], div.ProseMirror[contenteditable="true"]', chatgpt: '#prompt-textarea, div.ProseMirror[contenteditable="true"]', gemini: '.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]' };
    const ed = [...document.querySelectorAll(COMPOSER[site])].find(vis);
    const check = /just a moment|verify you are human|are you a robot|unusual traffic|attention required/i.test(document.title) // titles only: chat names in the sidebar can say anything
      || [...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], #challenge-form, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')].some(e => vis(e) && e.getBoundingClientRect().height > 30); // sites keep invisible ones around
    let login = !ed && !!document.querySelector('input[type="password"], input[type="email"], input[autocomplete="username"]');
    if (site === 'claude') login ||= /^\/(login|signup|magic-link)/.test(location.pathname);
    if (site === 'chatgpt') login ||= vis(document.querySelector('[data-testid="login-button"]')); // signed out still has a box, but not your account
    if (site === 'gemini') login ||= !ed && !!document.querySelector('a[href*="ServiceLogin"], a[href*="accounts.google.com"]');
    const LIMIT = /usage limit|message limit|hit (your|the) limit|reached (your|the) (limit|cap|daily)|out of (free )?messages|too many (requests|messages)|rate limit|limit resets|upgrade to (continue|keep)/i;
    const notice = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], [data-testid*="limit"], [class*="limit-banner"], [class*="error-banner"]')]
      .filter(vis).map(e => e.innerText.trim()).find(t => t && t.length < 400 && LIMIT.test(t)) || '';
    return { ready: !!ed && !check, login: login && !check, check, limit: notice, url: location.href };
  }

  async function pageSend(site, text) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const vis = e => !!(e && (e.offsetParent || e.getClientRects().length));
    const COMPOSER = { claude: '[data-testid="chat-input"], div.ProseMirror[contenteditable="true"]', chatgpt: '#prompt-textarea, div.ProseMirror[contenteditable="true"]', gemini: '.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]' };
    const SEND = { claude: 'button[aria-label="Send message"], button[aria-label="Send Message"]', chatgpt: '#composer-submit-button, button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"]', gemini: 'button[aria-label="Send message"], button.send-button' };
    const REPLY = { claude: '[data-testid="assistant-message"]', chatgpt: '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]', gemini: 'model-response' };
    const ed = [...document.querySelectorAll(COMPOSER[site])].find(vis);
    if (!ed) return { ok: false, why: 'no-composer' };
    const before = document.querySelectorAll(REPLY[site]).length;
    ed.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const sendBtn = () => [...document.querySelectorAll(SEND[site])].find(b => vis(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    let btn = null;
    for (let i = 0; i < 20 && !(btn = sendBtn()); i++) await sleep(250);
    if (!btn && !ed.innerText.trim()) { // the paste didn't take: type it instead
      ed.focus(); document.execCommand('insertText', false, text);
      for (let i = 0; i < 20 && !(btn = sendBtn()); i++) await sleep(250);
    }
    // A long paste can turn into an attachment that takes a moment to upload before Send is enabled.
    for (let i = 0; i < 60 && !(btn = sendBtn()); i++) await sleep(500);
    if (btn) btn.click();
    else ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return { ok: true, before };
  }

  function pageRead(site, before) {
    const vis = e => !!(e && (e.offsetParent || e.getClientRects().length));
    const REPLY = { claude: '[data-testid="assistant-message"]', chatgpt: '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]', gemini: 'model-response' };
    const BODY = { claude: '[data-perf-reply-text], .standard-markdown', chatgpt: '.markdown, [data-markdown-text-style="assistant-message"]', gemini: 'message-content .markdown, .markdown' };
    // Turn the reply's HTML into the small Markdown Lambda OS renders (paragraphs, bold, code, lists, tables, headings).
    const toMd = root => {
      const inl = n => [...n.childNodes].map(c => {
        if (c.nodeType === 3) return c.textContent;
        if (c.nodeType !== 1) return '';
        const t = c.tagName;
        if (t === 'BR') return '\n';
        if (t === 'B' || t === 'STRONG') { const s = inl(c).trim(); return s ? `**${s}**` : ''; }
        if (t === 'CODE') return '`' + c.textContent + '`';
        if (t === 'BUTTON' || t === 'svg' || t === 'SVG') return '';
        return inl(c);
      }).join('');
      const listLines = (l, depth) => {
        const lines = [];
        [...l.children].filter(li => li.tagName === 'LI').forEach((li, i) => {
          const own = [...li.childNodes].filter(x => !(x.nodeType === 1 && /^(UL|OL)$/.test(x.tagName)));
          const tmp = document.createElement('div'); own.forEach(x => tmp.appendChild(x.cloneNode(true)));
          lines.push(`${'  '.repeat(depth)}${l.tagName === 'OL' ? `${i + 1}.` : '-'} ${inl(tmp).replace(/\s*\n\s*/g, ' ').trim()}`);
          [...li.children].filter(x => /^(UL|OL)$/.test(x.tagName)).forEach(sub => lines.push(...listLines(sub, depth + 1)));
        });
        return lines;
      };
      const out = [];
      const block = (n, depth = 0) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { if (c.textContent.trim()) out.push(c.textContent.trim()); continue; }
          if (c.nodeType !== 1) continue;
          const t = c.tagName;
          if (/^H[1-6]$/.test(t)) out.push('#'.repeat(Math.min(4, +t[1])) + ' ' + inl(c).trim());
          else if (t === 'P') { const s = inl(c).trim(); if (s) out.push(s); }
          else if (t === 'UL' || t === 'OL') out.push(listLines(c, depth).join('\n')); // one entry, so the items stay one list
          else if (t === 'PRE') out.push('```\n' + c.innerText.replace(/\n$/, '') + '\n```');
          else if (t === 'TABLE') {
            const rows = [...c.querySelectorAll('tr')].map(r => [...r.children].map(td => inl(td).replace(/\|/g, '/').replace(/\s+/g, ' ').trim()));
            out.push(rows.map((r, i) => `| ${r.join(' | ')} |` + (i ? '' : `\n|${r.map(() => '---').join('|')}|`)).join('\n'));
          }
          else if (t === 'BLOCKQUOTE') out.push(inl(c).trim());
          else if (t === 'HR') out.push('');
          else if (t === 'BUTTON' || t === 'svg' || t === 'STYLE' || t === 'SCRIPT') continue;
          else block(c, depth);
        }
      };
      block(root);
      return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    };
    const replies = document.querySelectorAll(REPLY[site]);
    const stopBtn = [...document.querySelectorAll('button[aria-label]')].some(b => vis(b) && /^stop/i.test(b.getAttribute('aria-label')))
      || !!document.querySelector('button[data-testid="stop-button"]');
    if (replies.length <= before) return { started: false, busy: stopBtn, text: '' };
    const last = replies[replies.length - 1];
    let bodies = [...last.querySelectorAll(BODY[site])];
    if (!bodies.length && last.matches(BODY[site])) bodies = [last];
    bodies = bodies.filter(b => !bodies.some(o => o !== b && o.contains(b))); // outermost only
    const text = bodies.map(toMd).filter(Boolean).join('\n\n');
    const streaming = site === 'claude' && last.getAttribute('data-is-streaming') === 'true';
    return { started: true, busy: stopBtn || streaming, text, url: location.href };
  }

  function pageStop() {
    const b = [...document.querySelectorAll('button[aria-label]')].find(x => /^stop/i.test(x.getAttribute('aria-label')) && x.offsetParent);
    if (b) b.click();
  }

  /* ---------- Driving the hidden chat window from Lambda OS ---------- */
  // One chat window for every Lambda OS tab, opened minimized so it never shows up in your tab strip.
  // Its ids live in session storage (cleared when Chrome quits), so every new tab reuses it instead of opening another.
  const KEY = 'webchatWorker', LOCK = 'webchatBusy';
  let conv = Math.random().toString(36).slice(2); // this page's current Ask AI conversation
  let myUrl = '';                                  // that conversation's chat address, for "Open in Claude"
  const run = async (tabId, func, args = []) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result;
  };
  async function alive(tabId) { try { return await chrome.tabs.get(tabId); } catch { return null; } }
  const getW = async () => (await chrome.storage.session.get(KEY))[KEY] || null;
  const setW = w => chrome.storage.session.set({ [KEY]: w });
  async function worker() { const w = await getW(); return w && await alive(w.tabId) ? w : null; }
  function waitLoaded(tabId, ms = 30000) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); };
      const l = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      const t = setTimeout(done, ms);
      chrome.tabs.onUpdated.addListener(l);
      chrome.tabs.get(tabId).then(tb => { if (tb.status === 'complete') done(); }).catch(done);
    });
  }
  async function hiddenWindow(url) {
    let win;
    try { win = await chrome.windows.create({ url, focused: false, state: 'minimized' }); }
    catch { win = await chrome.windows.create({ url, focused: false, width: 900, height: 700 }); chrome.windows.update(win.id, { state: 'minimized' }).catch(() => {}); }
    return { tabId: win.tabs[0].id, windowId: win.id };
  }
  const fail = (code, msg) => Object.assign(new Error(msg), { code });
  async function openChat(site) {
    const S = SITES[site];
    let w = await worker();
    if (w) {
      await chrome.tabs.update(w.tabId, { url: S.url });
      chrome.windows.get(w.windowId).then(win => { if (!win.focused && win.state !== 'minimized') chrome.windows.update(w.windowId, { state: 'minimized' }); }).catch(() => {});
    } else w = await hiddenWindow(S.url);
    w = { tabId: w.tabId, windowId: w.windowId, site, conv, turns: 0 };
    await setW(w);
    await sleep(400); await waitLoaded(w.tabId);
    return w;
  }
  // Where the chat page stands: 'ready' | 'login' | 'check' | 'loading' | 'closed' (plus a usage-limit notice, if one shows).
  async function state(site, w) {
    const t = await alive(w.tabId); if (!t) return { s: 'closed' };
    // A sign-in on another site (accounts.google.com, auth.openai.com…) can't be read: that's a sign-in in progress.
    if (t.url && /^https?:/.test(t.url) && !new URL(t.url).hostname.endsWith(SITES[site].host)) return { s: 'login' };
    let p = null; try { p = await run(w.tabId, pageProbe, [site]); } catch { return { s: 'loading' }; }
    if (!p) return { s: 'loading' };
    return { s: p.check ? 'check' : p.login ? 'login' : p.ready ? 'ready' : 'loading', limit: p.limit };
  }
  // Brings the chat window up for the person to act on…
  function reveal(w) {
    chrome.windows.update(w.windowId, { state: 'normal', focused: true }).catch(() => {});
    chrome.tabs.update(w.tabId, { active: true }).catch(() => {});
  }
  // …and puts things back: chat window minimized, the Lambda OS tab in front again.
  function comeBack(w, home) {
    chrome.windows.update(w.windowId, { state: 'minimized' }).catch(() => {});
    if (home) { chrome.windows.update(home.windowId, { focused: true }).catch(() => {}); chrome.tabs.update(home.id, { active: true }).catch(() => {}); }
  }
  // Waits until the chat can take a question. If it needs the person (sign in, a human check), it shows them the
  // window, says so in Ask AI ({ wait: text }), keeps watching, and comes back to Lambda OS by itself once the chat
  // is ready ({ wait: null }). Lambda OS never types into a sign-in or check; the person does that.
  async function* ready(site, w, signal) {
    const S = SITES[site], t0 = Date.now();
    const home = chrome.tabs.getCurrent ? await chrome.tabs.getCurrent().catch(() => null) : null;
    let shown = null;
    while (true) {
      if (signal?.aborted) return false;
      beat(); // keep the shared window reserved while the person signs in
      const st = await state(site, w);
      if (st.s === 'closed') throw fail('closed', `The ${S.name} window was closed.`);
      if (st.limit) throw fail('limit', `${S.name} says: “${st.limit.slice(0, 200)}”`);
      if (st.s === 'ready') {
        if (shown) { comeBack(w, home); yield { wait: null }; await sleep(800); }
        return true;
      }
      if ((st.s === 'login' || st.s === 'check') && shown !== st.s) {
        shown = st.s; reveal(w); if (st.s === 'login') forget();
        yield { wait: st.s === 'login'
          ? `Sign in to ${S.name} in the window that just opened. Lambda OS brings you back here and asks your question as soon as you're in.`
          : `${S.name} wants to check you're human. Finish that in the window that just opened; Lambda OS brings you back here and continues.` };
      }
      if (!shown && st.s === 'loading' && Date.now() - t0 > 20000) { // neither ready nor asking for anything: let the person look
        shown = 'stuck'; reveal(w);
        yield { wait: `${S.name} hasn't finished loading. Have a look in the window that just opened (sign in, or close any pop-up); Lambda OS continues as soon as the chat box shows.` };
      }
      if (Date.now() - t0 > 600000) throw fail('timeout', `Gave up waiting for ${S.name} after 10 minutes.`);
      await sleep(shown ? 1000 : 500);
    }
  }

  // Only one question at a time goes through the shared window; a second Lambda OS tab waits its turn.
  async function lock(signal) {
    for (let i = 0; i < 300; i++) {
      const l = (await chrome.storage.session.get(LOCK))[LOCK];
      if (!l || l.conv === conv || Date.now() - l.at > 120000) { await chrome.storage.session.set({ [LOCK]: { conv, at: Date.now() } }); return true; }
      if (signal?.aborted) return false;
      await sleep(1000);
    }
    return true;
  }
  const beat = () => chrome.storage.session.set({ [LOCK]: { conv, at: Date.now() } });
  const unlock = async () => { const l = (await chrome.storage.session.get(LOCK))[LOCK]; if (l?.conv === conv) await chrome.storage.session.remove(LOCK); };

  /* ---------- Automatic: use whichever chat you're already signed in to ---------- */
  // A quiet yes/no per site, with your browser's own sign-in (nothing opens, nothing is kept but the yes/no):
  // Claude lists your organizations, ChatGPT's session names a user, Gemini's page carries a signed-in token.
  const ORDER = ['claude', 'chatgpt', 'gemini'], SEEN = 'webchatSignedIn';
  async function signedIn(site) {
    try {
      const get = url => fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (site === 'claude') { const r = await get('https://claude.ai/api/organizations'); if (!r.ok) return false; const j = await r.json(); return Array.isArray(j) && j.length > 0; }
      if (site === 'chatgpt') { const r = await get('https://chatgpt.com/api/auth/session'); if (!r.ok) return false; return !!(await r.json())?.user; }
      if (site === 'gemini') { const r = await get('https://gemini.google.com/app'); if (!r.ok) return false; return /"SNlM0e":"/.test(await r.text()); }
    } catch { return null; } // couldn't tell (offline, blocked)
    return false;
  }
  // { claude: true/false/null, … }, remembered for 10 minutes (force = check again now).
  async function detect(force = false) {
    const c = (await chrome.storage.session.get(SEEN))[SEEN];
    if (!force && c && Date.now() - c.at < 600000) return c.map;
    const vals = await Promise.all(ORDER.map(signedIn));
    const map = Object.fromEntries(ORDER.map((k, i) => [k, vals[i]]));
    await chrome.storage.session.set({ [SEEN]: { at: Date.now(), map } });
    return map;
  }
  const forget = () => chrome.storage.session.remove(SEEN);
  // 'auto' → the chat already in use if you're still signed in to it, else the first you're signed in to
  // (Claude, then ChatGPT, then Gemini), else Claude (and Ask AI walks you through signing in).
  async function pick(pref) {
    if (SITES[pref]) return pref;
    const map = await detect(), w = await getW();
    if (w && map[w.site]) return w.site;
    return ORDER.find(k => map[k]) || ORDER.find(k => map[k] === null) || 'claude';
  }

  // Same interface as the API providers: yields { text } / { full } / { note } chunks.
  async function* stream({ site = 'auto', system, user, history = [], signal }) {
    if (typeof chrome === 'undefined' || !chrome.scripting || !chrome.storage?.session) throw new Error('Asking through the browser chat works inside the extension only.');
    site = await pick(site);
    const S = SITES[site]; if (!S) throw new Error('Unknown chat site.');
    yield { using: site };
    const l = (await chrome.storage.session.get(LOCK))[LOCK];
    if (l && l.conv !== conv && Date.now() - l.at < 120000) yield { note: 'Waiting for another Ask AI question to finish…' };
    if (!(await lock(signal))) return;
    try {
      let w = await worker();
      const follow = w && w.site === site && w.conv === conv && history.length && w.turns === history.length / 2;
      let text;
      if (follow) text = user;
      else {
        yield { note: `Opening ${S.name}…` };
        w = await openChat(site);
        if (!(yield* ready(site, w, signal))) return;
        const earlier = history.length ? `EARLIER IN THIS CONVERSATION:\n${history.map(h => `[${h.role}] ${h.content}`).join('\n\n')}\n\n` : '';
        text = `${system}\n\n${earlier}${user}`;
      }
      if (signal?.aborted) return;
      if (follow && !(yield* ready(site, w, signal))) return; // still signed in? (it may have expired since)
      yield { note: `Sending to ${S.name}…` };
      const sent = await run(w.tabId, pageSend, [site, text]);
      if (!sent?.ok) throw fail('layout', `Couldn't find the ${S.name} message box. ${S.name} may have changed its page; try another chat below, or update Lambda OS.`);
      w.turns++; await setW(w);
      yield { note: `${S.name} is thinking…` };
      let last = '', same = 0, started = false, idle = 0;
      const t0 = Date.now();
      while (true) {
        if (signal?.aborted) { run(w.tabId, pageStop).catch(() => {}); return; }
        await sleep(700); beat();
        if (!(await alive(w.tabId))) throw fail('closed', `The ${S.name} window was closed before it answered.`);
        let r; try { r = await run(w.tabId, pageRead, [site, sent.before]); } catch { continue; }
        if (!r) continue;
        if (!r.started) {
          if (Date.now() - t0 > 6000 && ++idle % 4 === 0) { const st = await state(site, w); if (st.limit) throw fail('limit', `${S.name} says: “${st.limit.slice(0, 200)}”`); if (st.s === 'login' || st.s === 'check') throw fail(st.s, `${S.name} signed you out. Click “Try again” to sign in and ask again.`); }
          if (Date.now() - t0 > 120000) throw fail('timeout', `${S.name} hasn't answered after 2 minutes. Click “Show ${S.name}” to see what it's doing.`);
          continue;
        }
        if (!started) { started = true; yield { note: `${S.name} is writing…` }; }
        myUrl = r.url || myUrl;
        if (r.text !== last) {
          if (r.text.startsWith(last)) yield { text: r.text.slice(last.length) }; else yield { full: r.text };
          last = r.text; same = 0;
        } else same++;
        if (!r.busy && last && same >= 2) break;
        if (!r.busy && !last && same >= 6) break;
        if (Date.now() - t0 > 600000) break;
      }
    } finally { await unlock(); }
  }

  // "Open in Claude": brings up the hidden window if it's still on this conversation, otherwise opens the chat in a tab.
  async function show() {
    const w = await worker();
    if (w && w.conv === conv) return reveal(w);
    if (myUrl) chrome.tabs.create({ url: myUrl });
  }
  function reset() { conv = Math.random().toString(36).slice(2); myUrl = ''; } // a new Ask AI conversation starts a new chat

  return { SITES, ORDER, stream, show, reset, detect, pick };
})();

if (typeof self !== 'undefined') self.LambdaWebChat = LambdaWebChat;
