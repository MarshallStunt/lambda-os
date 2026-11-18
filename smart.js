// Smart processing (optional): after each refresh, the user's own AI provider looks only at what the local rules
// couldn't settle, and its answers are cached in the snapshot so the dashboard applies them with no waiting.
//   • Volunteer requests: is this Slack message a real call for people to go help at another site? Which site, which
//     dates, how many people? (Only with the separate "Let AI read Slack messages…" opt-in.)
//   • Leftover matching: Atium builds, NetSuite shipments and meetings the rules couldn't tie to a Jira deployment.
//   • Priority: an order for your own tickets ("what to work on first"), at most once an hour.
// Fetching never involves AI: every source is still read with the browser's own sign-ins. Nothing is sent unless
// Settings → Data → Smart processing is "AI when available", an AI provider is set up, and Privacy allows AI at all.
// Text goes through the same privacy masking as Ask AI. At most 3 small requests per refresh; anything already
// answered is never sent again. If the AI is missing or fails, the local rules simply stay in charge.

const LambdaSmart = (() => {
  const DEFAULTS = { mode: 'local', volunteer: true, matching: true, priority: true, slack: false };
  const CAP = { vol: 15, builds: 15, moves: 20, events: 20, tickets: 40 };
  const HOUR = 3600e3;

  // One question, one JSON answer. Streams under the hood (the shared AI client), collects the text, parses the JSON.
  async function askJson(ai, system, payload) {
    let out = '';
    for await (const c of LambdaAI.stream(ai, { system, user: JSON.stringify(payload), signal: AbortSignal.timeout(60000) })) {
      if (c.refusal) throw new Error('the AI declined');
      if (c.text) out += c.text;
    }
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('the AI reply was not JSON');
    return JSON.parse(m[0]);
  }

  const sitesHint = D => D.SITES.filter(s => s.id && s.name).map(s => `${s.id} = ${s.name}`).slice(0, 120).join('; ');

  async function volunteer(ai, D, red, cache) {
    const todo = (D.VOL_CANDIDATES || []).filter(c => !(c.id in cache.vol)).sort((a, b) => b.at - a.at).slice(0, CAP.vol);
    if (!todo.length) return 0;
    const system = `You sort Slack messages for a data center operations team. A "volunteer request" asks people from OTHER sites
to come and help on site at a particular site's deployment or project: travel there, head over, come out, sign up on the onsite
schedule, "need extra hands at DEN01 next week", "check with your manager". NOT a request: a question to one person, local
chatter at a site, incident or ticket work, jokes ("volunteered as tribute"), thanks, or only a link.
Site codes look like ABC01. Known sites: ${sitesHint(D)}. Map city names to these codes when you can.
Reply with JSON only: {"items":[{"id":"…","request":true|false,"site":"ABC01" or null,"dates":"short date range" or null,"people":"how many people" or null}]}`;
    const res = await askJson(ai, system, { messages: todo.map(c => ({ id: c.id, channel: c.channel, posted: new Date(c.at).toISOString().slice(0, 10), text: red.redact(c.text).slice(0, 700) })) });
    const byId = new Map((res.items || []).map(i => [String(i.id), i]));
    for (const c of todo) {
      const i = byId.get(c.id);
      cache.vol[c.id] = i ? { request: !!i.request, site: typeof i.site === 'string' ? i.site.toUpperCase() : null,
        dates: i.dates ? red.restore(String(i.dates)).slice(0, 60) : null, people: i.people ? String(i.people).slice(0, 30) : null } : { request: false };
    }
    return todo.length;
  }

  async function matching(ai, D, red, cache, privacy = {}) {
    const has = (k, id) => `${k}:${id}` in cache.link;
    const builds = (D.BUILDS || []).filter(b => !b.deploymentKey && !has('build', b.id)).slice(0, CAP.builds)
      .map(b => ({ id: `build:${b.id}`, name: red.redact(b.name || ''), site: b.site, gpus: b.planned || b.gpus, customer: b.customer ? red.redact(b.customer) : null }));
    const moves = (D.MOVES || []).filter(m => !m.deploymentKey && m.deployment && !has('move', m.doc)).slice(0, CAP.moves)
      .map(m => ({ id: `move:${m.doc}`, deployment: red.redact(m.deployment), site: m.site }));
    // Meetings are only sent when Privacy doesn't withhold calendar text.
    const events = (privacy.calendar ? [] : D.EVENTS || []).filter(e => !e.deployment && !has('event', e.title)).slice(0, CAP.events)
      .map((e, i) => ({ id: `event:${i}`, real: e.title, title: red.redact(e.title) }));
    if (!builds.length && !moves.length && !events.length) return 0;
    const deployments = (D.DEPLOYMENTS || []).slice(0, 150).map(d => ({ key: d.key, title: red.redact(d.title || ''), sites: d.sites, gpus: d.gpus || null }));
    const system = `You link items to the Jira deployment they belong to, for a data center operations team. Use site codes,
GPU counts, customer and title words. Only link when you are fairly sure; otherwise use null. Meetings that aren't about a
specific deployment (stand-ups for a whole team, 1:1s, lunch) get null.
Reply with JSON only: {"links":[{"id":"…","deployment":"KEY-123" or null}]}`;
    const res = await askJson(ai, system, { deployments, builds, shipments: moves, meetings: events.map(({ id, title }) => ({ id, title })) });
    const keys = new Set((D.DEPLOYMENTS || []).map(d => d.key)), got = new Map((res.links || []).map(l => [String(l.id), l.deployment]));
    // An item asked about but not matched is stored as "" so it isn't asked again.
    for (const x of builds) cache.link[x.id] = keys.has(got.get(x.id)) ? got.get(x.id) : '';
    for (const x of moves) cache.link[x.id] = keys.has(got.get(x.id)) ? got.get(x.id) : '';
    for (const x of events) cache.link[`event:${x.real}`] = keys.has(got.get(x.id)) ? got.get(x.id) : ''; // meetings were sent by number, stored by title
    return builds.length + moves.length + events.length;
  }

  async function priority(ai, D, red, cache) {
    const now = Date.now();
    const mine = D.TICKETS.filter(t => t.mine || t.assignee === 'me').slice(0, CAP.tickets);
    if (!mine.length) return 0;
    const sig = mine.map(t => `${t.key}|${t.status}|${t.priority}`).sort().join(',');
    if (cache.prio && cache.prio.sig === sig && now - cache.prio.at < HOUR) return 0;
    const system = `You order a data center technician's open Jira tickets by what to work on first. SLA breaches and tickets
close to their SLA come first unless clearly minor; then customer impact (GPU/node down, network down) over cosmetic or
paperwork; then priority; then age. Give a reason of at most 10 words for the top 5.
Reply with JSON only: {"order":["KEY-1","KEY-2",…],"reasons":{"KEY-1":"…"}}`;
    const res = await askJson(ai, system, { tickets: mine.map(t => ({ key: t.key, priority: t.priority, status: t.status, site: t.site,
      summary: red.redact(t.summary).slice(0, 200), slaHoursLeft: t.slaDue != null ? Math.round((t.slaDue - now) / 36e5 * 10) / 10 : null,
      ageDays: t.created ? Math.round((now - t.created) / 864e5) : null })) });
    const keys = new Set(mine.map(t => t.key));
    const order = (res.order || []).map(String).filter(k => keys.has(k));
    const reasons = Object.fromEntries(Object.entries(res.reasons || {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, red.restore(String(v)).slice(0, 90)]));
    cache.prio = { at: now, sig, order, reasons };
    return mine.length;
  }

  // Keeps caches bounded: newest answers win.
  const trim = (obj, max) => { const k = Object.keys(obj); if (k.length > max) for (const x of k.slice(0, k.length - max)) delete obj[x]; return obj; };

  async function enrich(snap, s, prev, progress = () => {}) {
    const cfg = { ...DEFAULTS, ...(s.smart || {}) };
    const cache = { vol: { ...(prev?.cache?.vol || {}) }, link: { ...(prev?.cache?.link || {}) }, prio: prev?.cache?.prio || null };
    const out = { at: Date.now(), on: cfg.mode === 'ai', live: false, label: '', why: '', calls: 0, items: 0, cache };
    if (cfg.mode !== 'ai') return { ...out, why: 'Local only (Settings → Data → Smart processing).' };
    if (s.privacy?.mode === 'local') return { ...out, on: false, why: 'Settings → Privacy is set to never send anything to an AI.' };
    if (typeof LambdaAI === 'undefined' || typeof LambdaData === 'undefined') return { ...out, why: 'AI isn\'t loaded here; using earlier answers.' };
    const c = LambdaAI.configured(s.ai);
    if (!c.ok) return { ...out, why: `${c.why} Using the local rules.` };
    out.label = c.label;
    progress('Smart processing with ' + c.label + '…');
    const D = LambdaData.buildLive({ ...snap, smart: null });
    // Same masking as Ask AI: every person's name Lambda OS knows (assignees, Slack authors, mail senders) is masked.
    const people = [...new Set([...D.PEOPLE.map(p => p.name), ...D.TICKETS.map(t => t.assigneeName), ...(D.MENTIONS || []).map(m => m.user), ...(D.MAIL?.entries || []).map(e => e.from), ...(D.DEPLOYMENTS || []).map(d => d.assigneeName)].filter(n => n && n !== 'Unassigned' && n !== 'You'))];
    const red = LambdaAI.makeRedactor(s.privacy, { people,
      serials: D.DEVICES.map(d => d.serial).filter(Boolean), hosts: D.DEVICES.map(d => d.id) });
    const errs = [];
    const step = async (name, fn) => { try { const n = await fn(); if (n) { out.calls++; out.items += n; } } catch (e) { errs.push(`${name}: ${e.message}`); } };
    // Slack text goes out only with the separate opt-in (Settings → Smart processing), which is the one deliberate exception to Privacy's 'withhold messages'.
    if (cfg.volunteer && cfg.slack) await step('volunteer requests', () => volunteer(s.ai, D, red, cache));
    if (cfg.matching) await step('matching', () => matching(s.ai, D, red, cache, s.privacy || {}));
    if (cfg.priority) await step('ticket order', () => priority(s.ai, D, red, cache));
    trim(cache.vol, 400); trim(cache.link, 800);
    out.live = !errs.length || out.calls > 0;
    out.why = errs.length ? `${errs.join('; ')}. The local rules are used for anything new.` : '';
    return out;
  }

  return { DEFAULTS, enrich };
})();

if (typeof self !== 'undefined') self.LambdaSmart = LambdaSmart;
