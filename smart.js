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
  const DEFAULTS = { mode: 'local', volunteer: true, matching: true, priority: true, slack: false, backup: true };
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

  /* ---------------- Backups: when a rule breaks or can't decide ---------------- */
  // Each looks only at what the rules left unsettled, asks once, and keeps the answer ('' / false = asked, no answer).
  const WAIT = /part|rma/i, HWRX = /psu|power ?supply|fan|pdu|gpu|xid|thermal|temp|overheat|memory|dimm|disk|nvme|drive|nvlink|fabric|link ?down|carrier|\bib\b|infiniband|bmc|redfish|chassis|cooling|leak|unreachable|optic|transceiver/i;
  async function fieldsBackup(ai, snap, cache) {
    const miss = snap.jira?.fieldMiss; if (!miss) return 0;
    const todo = miss.missing.filter(m => !(m.key in cache.fields)); if (!todo.length) return 0;
    const system = `A Jira site was set up with custom fields Lambda OS reads by name; some names weren't found (probably renamed).
For each missing field pick the custom field that is clearly the same thing, or null. Only match when fairly sure.
Reply with JSON only: {"fields":{"key":"customfield_12345" or null}}`;
    const res = await askJson(ai, system, { missing: todo, candidates: miss.candidates });
    const ok = new Set(miss.candidates.map(c => c.id));
    for (const m of todo) { const id = res.fields?.[m.key]; cache.fields[m.key] = typeof id === 'string' && ok.has(id) ? id : ''; }
    return todo.length;
  }
  async function sitesBackup(ai, D, red, cache) {
    const todo = D.TICKETS.filter(t => !t.site && !(t.key in cache.site)).slice(0, 40);
    if (!todo.length) return 0;
    const system = `You find which data center a ticket is about. Site codes look like ABC01. Known sites: ${sitesHint(D)}.
Use site codes, city or facility names and hostname prefixes (e.g. dal02-… is DAL02). If unsure, null.
Reply with JSON only: {"sites":{"TICKET-1":"ABC01" or null}}`;
    const res = await askJson(ai, system, { tickets: todo.map(t => ({ key: t.key, summary: red.redact(t.summary || '').slice(0, 200), host: t.device || null })) });
    const codes = new Set(D.SITES.map(s => s.id));
    for (const t of todo) { const c = String(res.sites?.[t.key] || '').toUpperCase(); cache.site[t.key] = codes.has(c) ? c : ''; }
    return todo.length;
  }
  async function statusBackup(ai, D, cache) {
    const todo = [...new Set(D.TICKETS.map(t => t.status).filter(Boolean))].filter(s => !WAIT.test(s) && !(s in cache.status)).slice(0, 40);
    if (!todo.length) return 0;
    const system = `Sort Jira ticket status names for a data center operations team into one class each:
"waiting_parts" (waiting on a part, RMA, shipment or vendor replacement), "in_progress", "blocked" (waiting on someone else or another team), "other".
Reply with JSON only: {"status":{"Status name":"class"}}`;
    const res = await askJson(ai, system, { statuses: todo });
    for (const s of todo) { const c = res.status?.[s]; cache.status[s] = ['waiting_parts', 'in_progress', 'blocked', 'other'].includes(c) ? c : 'other'; }
    return todo.length;
  }
  async function alertsBackup(ai, D, cache) {
    const names = new Set();
    for (const s of D.SITES) for (const c of s.gf?.counts || []) names.add(c.name);
    const todo = [...names].filter(nm => !HWRX.test(nm) && !(nm in cache.alert)).slice(0, 60);
    if (!todo.length) return 0;
    const system = `Classify Grafana alert names for a GPU data center: true if the alert is about physical hardware a data center
technician would fix (power, fans, GPUs, memory, disks, NICs/optics/cables, BMC, cooling, leaks, chassis), false for software,
platform, Kubernetes, application or monitoring-only alerts.
Reply with JSON only: {"hardware":{"AlertName":true|false}}`;
    const res = await askJson(ai, system, { alerts: todo });
    for (const nm of todo) cache.alert[nm] = res.hardware?.[nm] === true;
    return todo.length;
  }
  async function titlesBackup(ai, D, red, cache) {
    const todo = (D.DEPLOYMENTS || []).filter(d => (!d.gpus || !d.sites.length) && !(d.key in cache.dep)).slice(0, 30);
    if (!todo.length) return 0;
    const system = `Read Jira deployment titles for a GPU cloud. Extract the GPU count (number of GPUs, not nodes), the GPU model
(e.g. H100, B200, GB300, VR200) and the data center site code (ABC01). Known sites: ${sitesHint(D)}. Use null when it's not there.
Reply with JSON only: {"deployments":{"KEY-1":{"gpus":number|null,"model":"…"|null,"site":"ABC01"|null}}}`;
    const res = await askJson(ai, system, { deployments: todo.map(d => ({ key: d.key, title: red.redact(d.summary || d.title || '').slice(0, 200) })) });
    const codes = new Set(D.SITES.map(s => s.id));
    for (const d of todo) { const x = res.deployments?.[d.key] || {};
      cache.dep[d.key] = { gpus: Number.isFinite(+x.gpus) && +x.gpus > 0 ? Math.round(+x.gpus) : null, model: typeof x.model === 'string' ? x.model.slice(0, 20) : null,
        site: codes.has(String(x.site || '').toUpperCase()) ? String(x.site).toUpperCase() : null }; }
    return todo.length;
  }
  // What the AI is filling in right now (shown in Settings → Smart processing as the "rules check").
  function usage(snap, D, cache) {
    const n = {
      fields: (snap.jira?.fieldsByAI || []).length + Object.entries(cache.fields).filter(([k, v]) => v && snap.jira?.fieldMiss?.missing?.some(m => m.key === k)).length,
      sites: D.TICKETS.filter(t => !t.site && cache.site[t.key]).length,
      statuses: Object.values(cache.status).filter(c => c === 'waiting_parts').length,
      alerts: Object.values(cache.alert).filter(Boolean).length,
      titles: (D.DEPLOYMENTS || []).filter(d => (!d.gpus || !d.sites.length) && cache.dep[d.key] && (cache.dep[d.key].gpus || cache.dep[d.key].site)).length,
    };
    return n;
  }

  // Keeps caches bounded: newest answers win.
  const trim = (obj, max) => { const k = Object.keys(obj); if (k.length > max) for (const x of k.slice(0, k.length - max)) delete obj[x]; return obj; };

  async function enrich(snap, s, prev, progress = () => {}) {
    const cfg = { ...DEFAULTS, ...(s.smart || {}) };
    const pc = prev?.cache || {};
    const cache = { vol: { ...(pc.vol || {}) }, link: { ...(pc.link || {}) }, prio: pc.prio || null,
      fields: { ...(pc.fields || {}) }, site: { ...(pc.site || {}) }, status: { ...(pc.status || {}) }, alert: { ...(pc.alert || {}) }, dep: { ...(pc.dep || {}) } };
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
    if (cfg.backup) {
      await step('Jira fields', () => fieldsBackup(s.ai, snap, cache));
      await step('ticket sites', () => sitesBackup(s.ai, D, red, cache));
      await step('ticket statuses', () => statusBackup(s.ai, D, cache));
      await step('alert types', () => alertsBackup(s.ai, D, cache));
      await step('deployment titles', () => titlesBackup(s.ai, D, red, cache));
    }
    out.used = usage(snap, D, cache);
    trim(cache.vol, 400); trim(cache.link, 800); trim(cache.site, 2000); trim(cache.dep, 600); trim(cache.alert, 600); trim(cache.status, 300);
    out.live = !errs.length || out.calls > 0;
    out.why = errs.length ? `${errs.join('; ')}. The local rules are used for anything new.` : '';
    return out;
  }

  return { DEFAULTS, enrich };
})();

if (typeof self !== 'undefined') self.LambdaSmart = LambdaSmart;
