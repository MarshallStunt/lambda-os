// Lambda news: the newest posts on Lambda's own blog, read from its public RSS feed (no sign-in, no AI).
// Checked at most every 2 hours and kept in chrome.storage.local; if the feed can't be read, the last posts stay
// on screen with a quiet note, and nothing else on the dashboard is affected.

const LambdaNews = (() => {
  const FEED = 'https://lambda.com/blog/rss.xml';
  const PAGE = 'https://lambda.com/blog';
  const EVERY_MS = 2 * 60 * 60 * 1000;
  const KEEP = 15;
  const store = typeof chrome !== 'undefined' && chrome.storage?.local;

  // Plain text from the feed's HTML description: the first paragraph, tags and entities removed.
  function summary(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const p = [...doc.querySelectorAll('p')].map(x => x.textContent.trim()).find(Boolean) || doc.body.textContent.trim();
    return p.replace(/\s+/g, ' ').slice(0, 280);
  }

  function parse(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('the blog feed was not valid RSS');
    const text = (el, sel) => el.getElementsByTagName(sel)[0]?.textContent?.trim() || '';
    const items = [...doc.getElementsByTagName('item')].map(it => ({
      title: text(it, 'title'),
      url: text(it, 'link'),
      at: Date.parse(text(it, 'pubDate') || text(it, 'dc:date')) || 0,
      summary: summary(text(it, 'description')),
      tags: [...it.getElementsByTagName('category')].map(c => c.textContent.trim()).filter(Boolean).slice(0, 3),
    })).filter(x => x.title && /^https:\/\/(www\.)?lambda\.(com|ai)\//.test(x.url));
    if (!items.length) throw new Error('the blog feed had no posts');
    return items.sort((a, b) => b.at - a.at).slice(0, KEEP);
  }

  // → { ok, items, at, error }  (items are the last good ones even when this check failed)
  async function get(force = false) {
    const cached = store ? (await store.get('news').catch(() => ({}))).news : null;
    if (!force && cached && Date.now() - cached.at < EVERY_MS) return cached;
    let r;
    try {
      const res = await fetch(FEED, { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error(`the Lambda blog answered HTTP ${res.status}`);
      r = { ok: true, items: parse(await res.text()), at: Date.now() };
    } catch (e) {
      r = { ok: false, items: cached?.items || [], at: Date.now(), error: e.message || String(e), lastOk: cached?.ok ? cached.at : cached?.lastOk };
    }
    if (store) await store.set({ news: r }).catch(() => {});
    return r;
  }

  return { FEED, PAGE, get, parse };
})();

if (typeof self !== 'undefined') self.LambdaNews = LambdaNews;
