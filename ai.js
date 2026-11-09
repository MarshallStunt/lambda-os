// AI assistant for Lambda OS: Claude (default), OpenAI, Gemini, or a local OpenAI-compatible server (LM Studio / Ollama).
// Everything runs in the browser with the user's own API key (no backend). Before anything leaves the browser, the
// privacy settings mask or drop sensitive values; masked values are swapped back into the answer locally.
// Claude is called over raw HTTPS: this extension has no build step, so the official SDK can't be bundled.

const LambdaAI = (() => {
  const PROVIDERS = {
    anthropic: { label: 'Claude (Anthropic)', keyHint: 'sk-ant-…' },
    openai: { label: 'OpenAI', keyHint: 'sk-…' },
    gemini: { label: 'Google Gemini', keyHint: 'AIza…' },
    local: { label: 'Local (LM Studio / Ollama)', keyHint: 'optional' },
  };
  const LOCAL_PRESETS = { lmstudio: 'http://localhost:1234/v1', ollama: 'http://localhost:11434/v1' };

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

  /* ---------------- Streaming helpers ---------------- */
  async function* sse(res, signal) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    while (true) {
      if (signal?.aborted) { reader.cancel().catch(() => {}); return; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  }
  async function failText(res, who) {
    let msg = '';
    try { const j = await res.json(); msg = j.error?.message || j.error?.status || j.message || JSON.stringify(j).slice(0, 200); } catch { msg = (await res.text().catch(() => '')).slice(0, 200); }
    if (res.status === 401 || res.status === 403) return `${who} rejected the API key (${res.status}). Check it in Settings → AI.`;
    if (res.status === 404) return `${who}: model not found (${msg}). Pick one with “Load models” in Settings → AI.`;
    if (res.status === 429) return `${who} rate limit or quota reached (429). Try again shortly.`;
    return `${who} error ${res.status}: ${msg}`;
  }
  const net = (who, e) => new Error(`Can't reach ${who} (${e.message}).${who.startsWith('Local') ? ' Is the local server running with CORS enabled?' : ''}`);

  /* ---------------- Providers ---------------- */
  // Claude: Messages API with streaming. Opus 5.5 always thinks (no `thinking` param needed); depth via output_config.effort.
  // The server-side fallback re-runs a declined request on a suitable model inside the same call.
  async function* claude({ key, model, effort, system, user, history = [], signal }) {
    const fallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
    const body = { model, max_tokens: 32000, stream: true, system, messages: [...history, { role: 'user', content: user }], output_config: { effort: effort || 'medium' } };
    if (fallback) body.fallbacks = 'default';
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal, body: JSON.stringify(body),
        credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
          ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
      });
    } catch (e) { throw net('Claude', e); }
    if (!res.ok) throw new Error(await failText(res, 'Claude'));
    for await (const data of sse(res, signal)) {
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield { text: ev.delta.text };
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') yield { refusal: ev.delta?.stop_details?.explanation || 'Claude declined to answer this request.' };
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'max_tokens') yield { note: 'Answer was cut off at the length limit.' };
      else if (ev.type === 'error') throw new Error(`Claude: ${ev.error?.message || 'stream error'}`);
    }
  }
  async function* openaiLike({ base, key, model, system, user, history = [], signal, who }) {
    let res;
    try {
      res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: user }] }),
      });
    } catch (e) { throw net(who, e); }
    if (!res.ok) throw new Error(await failText(res, who));
    for await (const data of sse(res, signal)) {
      if (data === '[DONE]') return;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      const t = ev.choices?.[0]?.delta?.content; if (t) yield { text: t };
      if (ev.choices?.[0]?.finish_reason === 'length') yield { note: 'Answer was cut off at the length limit.' };
    }
  }
  async function* gemini({ key, model, system, user, history = [], signal }) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
          contents: [...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), { role: 'user', parts: [{ text: user }] }] }),
      });
    } catch (e) { throw net('Gemini', e); }
    if (!res.ok) throw new Error(await failText(res, 'Gemini'));
    for await (const data of sse(res, signal)) {
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      for (const part of ev.candidates?.[0]?.content?.parts || []) if (part.text && !part.thought) yield { text: part.text };
      if (ev.candidates?.[0]?.finishReason === 'SAFETY') yield { refusal: 'Gemini blocked this answer for safety reasons.' };
    }
  }

  function configured(ai) {
    const p = ai?.provider;
    if (!p || p === 'off' || !PROVIDERS[p]) return { ok: false, why: 'No AI provider chosen (Settings → AI).' };
    if (p !== 'local' && !ai.keys?.[p]) return { ok: false, why: `Add your ${PROVIDERS[p].label} API key in Settings → AI.` };
    if (!ai.models?.[p]) return { ok: false, why: `Choose a ${PROVIDERS[p].label} model in Settings → AI (“Load models” lists them).` };
    return { ok: true, provider: p, model: ai.models[p], label: PROVIDERS[p].label };
  }

  // Streams { text } / { refusal } / { note } chunks for one question.
  // history: earlier turns as [{ role: 'user' | 'assistant', content }] (already privacy-masked by the caller).
  function stream(ai, { system, user, history = [], signal }) {
    const c = configured(ai); if (!c.ok) throw new Error(c.why);
    const key = ai.keys[c.provider];
    if (c.provider === 'anthropic') return claude({ key, model: c.model, effort: ai.effort, system, user, history, signal });
    if (c.provider === 'openai') return openaiLike({ base: 'https://api.openai.com/v1', key, model: c.model, system, user, history, signal, who: 'OpenAI' });
    if (c.provider === 'gemini') return gemini({ key, model: c.model, system, user, history, signal });
    return openaiLike({ base: ai.localUrl || LOCAL_PRESETS.lmstudio, key, model: c.model, system, user, history, signal, who: 'Local model' });
  }

  // Lists the models the key can use (for the Settings picker).
  async function listModels(ai, provider) {
    const key = ai.keys?.[provider] || '';
    const get = async (url, headers, who) => {
      let r; try { r = await fetch(url, { headers, credentials: 'omit', referrerPolicy: 'no-referrer' }); } catch (e) { throw net(who, e); }
      if (!r.ok) throw new Error(await failText(r, who));
      return r.json();
    };
    if (provider === 'anthropic') {
      const j = await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2026-10-21' }, 'Claude');
      return (j.data || []).map(m => m.id);
    }
    if (provider === 'openai') {
      const j = await get('https://api.openai.com/v1/models', { authorization: `Bearer ${key}` }, 'OpenAI');
      return (j.data || []).map(m => m.id).filter(id => /^(gpt|o\d|chatgpt)/i.test(id) && !/audio|realtime|tts|image|transcribe|search/i.test(id)).sort().reverse();
    }
    if (provider === 'gemini') {
      const j = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key }, 'Gemini');
      return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
    }
    const j = await get(`${(ai.localUrl || LOCAL_PRESETS.lmstudio).replace(/\/+$/, '')}/models`, key ? { authorization: `Bearer ${key}` } : {}, 'Local model');
    return (j.data || []).map(m => m.id);
  }

  async function test(ai) {
    let out = '';
    for await (const c of stream(ai, { system: 'Reply with exactly: OK', user: 'Connection test.', signal: AbortSignal.timeout(60000) })) { if (c.text) out += c.text; if (c.refusal) out += c.refusal; }
    return out.trim() || '(empty reply)';
  }

  return { PROVIDERS, LOCAL_PRESETS, makeRedactor, configured, stream, listModels, test };
})();

if (typeof self !== 'undefined') self.LambdaAI = LambdaAI;
