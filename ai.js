// AI assistant for Lambda OS. It answers through the chat you're already signed in to in this browser (Claude, ChatGPT
// or Gemini), with no API key: webchat.js drives that chat in one minimized window. Before anything leaves the browser,
// the privacy settings mask or drop sensitive values; masked values are swapped back into the answer locally.

const LambdaAI = (() => {
  const WEB_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
  const PROVIDERS = { web: { label: 'Your browser chat (no key)' } };

  /* ---------------- Privacy: reversible redaction ---------------- */
  // Builds a redactor from the privacy settings plus known names/hosts/serials from the loaded data.
  // redact(text) → text with [PERSON_1], [EMAIL_2]… ; restore(text) puts the real values back for display.
  function makeRedactor(privacy, known = {}) {
    const p = privacy || {};
    const on = p.mode === 'redact';
    const map = new Map(), back = new Map(), counts = {};
    const token = (kind, value) => {
      const k = kind + '\u0000' + value.toLowerCase();
      if (!map.has(k)) { counts[kind] = (counts[kind] || 0) + 1; const t = `[${kind}_${counts[kind]}]`; map.set(k, t); back.set(t, value); }
      return map.get(k);
    };
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const listRe = list => {
      const items = [...new Set(list.map(x => String(x || '').trim()).filter(x => x.length >= 3))].sort((a, b) => b.length - a.length);
      return items.length ? new RegExp(`(?<![\\w-])(${items.map(esc).join('|')})(?![\\w-])`, 'gi') : null;
    };
    const rules = [];
    if (on) {
      const words = String(p.words || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
      if (words.length) rules.push(['WORD', listRe(words)]);
      if (p.emails) rules.push(['EMAIL', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g]);
      if (p.people && known.people?.length) rules.push(['PERSON', listRe(known.people)]);
      if (p.network) {
        rules.push(['IP', /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g]);
        rules.push(['IP', /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi]);
        rules.push(['MAC', /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi]);
      }
      if (p.serials) {
        if (known.serials?.length) rules.push(['SERIAL', listRe(known.serials)]);
        rules.push(['SERIAL', /\b(?:S\/?N|serial(?:\s*(?:number|no\.?|#))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{5,30})\b/gi]);
      }
      if (p.hostnames && known.hosts?.length) rules.push(['HOST', listRe(known.hosts)]);
      if (p.money) rules.push(['AMOUNT', /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB])?)|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|dollars)\b/g]);
    }
    const redact = text => {
      let out = String(text ?? '');
      for (const [kind, re] of rules) if (re) out = out.replace(re, (m, g1) => kind === 'SERIAL' && g1 ? m.replace(g1, token(kind, g1)) : token(kind, m));
      return out;
    };
    const restore = text => String(text ?? '').replace(/\[(?:WORD|EMAIL|PERSON|IP|MAC|SERIAL|HOST|AMOUNT)_\d+\]/g, t => back.get(t) || t);
    return { redact, restore, count: () => back.size, summary: () => Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ') };
  }


  // Always the browser chat; ai.web picks which one (older settings that named an API provider fall back to Claude).
  function configured(ai) {
    const w = WEB_NAMES[ai?.web] ? ai.web : 'claude';
    return { ok: true, provider: 'web', web: w, model: 'your signed-in chat, no API key', label: `${WEB_NAMES[w]} in your browser` };
  }

  // Streams { text } / { full } / { note } chunks for one question.
  // history: earlier turns as [{ role: 'user' | 'assistant', content }] (already privacy-masked by the caller).
  function stream(ai, { system, user, history = [], signal }) {
    const c = configured(ai);
    if (typeof LambdaWebChat === 'undefined') throw new Error('Ask AI runs in the Lambda OS tab.');
    return LambdaWebChat.stream({ site: c.web, system, user, history, signal });
  }

  async function test(ai) {
    let out = '';
    for await (const c of stream(ai, { system: 'Reply with exactly: OK', user: 'Connection test.', signal: AbortSignal.timeout(120000) })) { if (c.full != null) out = c.full; if (c.text) out += c.text; }
    return out.trim() || '(empty reply)';
  }

  return { PROVIDERS, WEB_NAMES, makeRedactor, configured, stream, test };
})();

if (typeof self !== 'undefined') self.LambdaAI = LambdaAI;
