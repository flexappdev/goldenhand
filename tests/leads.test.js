import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLead, makeRef, guessCategory, checkDecision, LocalStore, SupabaseStore, createStore, capabilities } from '../assets/js/leads.js';

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const good = { name: 'Jo Bloggs', phone: '07700 900000', postcode: 'nw4 3ab', job: 'Mount a 55-inch TV on plasterboard', consent: true };

test('valid enquiry builds a NEW lead', () => {
  const { lead, errors } = buildLead(good);
  assert.deepEqual(errors, {});
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.postcode, 'NW4 3AB');
  assert.equal(lead.category, 'Mounting / fittings');
  assert.match(lead.ref, /^GH-\d{6}-[A-Z0-9]{4}$/);
  assert.match(lead.id, /^[0-9a-f-]{36}$/);
});

test('validation catches missing contact, short job, no consent, honeypot', () => {
  const { errors } = buildLead({ name: 'J', job: 'tv', consent: false, website: 'spam.biz' });
  assert.deepEqual(Object.keys(errors).sort(), ['consent', 'contact', 'job', 'name', 'spam']);
  assert.ok(buildLead({ ...good, phone: 'abc' }).errors.phone);
  assert.ok(buildLead({ ...good, phone: '', email: 'nope' }).errors.email);
  assert.deepEqual(buildLead({ ...good, phone: '', email: 'jo@example.com' }).errors, {});
});

test('unknown select values fall back safely', () => {
  const { lead } = buildLead({ ...good, category: 'Rocket repair', urgency: 'yesterday', preferred_window: 'midnight', source: 'evil' });
  assert.equal(lead.category, 'Mounting / fittings');
  assert.equal(lead.urgency, 'Flexible');
  assert.equal(lead.preferred_window, 'Flexible');
  assert.equal(lead.source, 'site');
});

test('ref format matches the database check', () => {
  assert.equal(makeRef(new Date('2026-11-13T09:00:00Z'), () => 0), 'GH-261113-AAAA');
});

test('category guess', () => {
  assert.equal(guessCategory('leaking tap in kitchen'), 'Minor plumbing');
  assert.equal(guessCategory('regrout the shower'), 'Bathroom / tiling');
  assert.equal(guessCategory('something odd'), 'General handyman');
});

test('decision rules', () => {
  assert.equal(checkDecision({ status: 'NEW' }, 'APPROVED'), null);
  assert.match(checkDecision({ status: 'NEW' }, 'REJECTED', ' '), /note/);
  assert.match(checkDecision({ status: 'APPROVED' }, 'REJECTED', 'x'), /already/);
  assert.match(checkDecision(undefined, 'APPROVED'), /not found/);
});

test('LocalStore: submit, approve, cannot decide twice, audit log', async () => {
  const s = new LocalStore({ storage: memStorage() });
  const { lead } = buildLead(good);
  await s.submit(lead);
  assert.equal((await s.list())[0].status, 'NEW');
  await assert.rejects(s.decide(lead.id, 'REJECTED', ''), /note/);
  await s.decide(lead.id, 'APPROVED', '');
  await assert.rejects(s.decide(lead.id, 'REJECTED', 'x'), /already/);
  const ev = await s.events(lead.id);
  assert.deepEqual(ev.map(e => e.to_status), ['NEW', 'APPROVED']);
});

test('createStore picks DEMO without config and REAL with it; labels follow', () => {
  assert.equal(createStore({}, { storage: memStorage() }).mode, 'DEMO');
  assert.equal(createStore({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }, { fetchImpl: () => {}, storage: memStorage() }).mode, 'REAL');
  assert.equal(capabilities({}).find(c => c.name === 'Lead storage').label, 'DEMO');
  assert.equal(capabilities({ supabaseUrl: 'u', supabaseAnonKey: 'k' }).find(c => c.name === 'Lead storage').label, 'REAL');
  assert.ok(capabilities({}).some(c => c.label === 'PENDING'));
});

test('SupabaseStore sends the right requests', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600, user: { email: 'op@example.com' } }));
    if (url.includes('/rpc/')) return new Response(JSON.stringify({ status: 'APPROVED' }));
    if (init.method === 'POST') return new Response('', { status: 201 });
    return new Response('[]');
  };
  const s = new SupabaseStore({ supabaseUrl: 'https://x.supabase.co/', supabaseAnonKey: 'ANON' }, { fetchImpl, storage: memStorage() });
  const { lead } = buildLead(good);
  await s.submit(lead);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/gh_leads');
  assert.equal(calls[0].init.headers.Prefer, 'return=minimal');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ANON');
  assert.equal(JSON.parse(calls[0].init.body).status, undefined);
  assert.equal(await s.session(), null);
  await s.signIn('op@example.com', 'pw');
  assert.deepEqual(await s.session(), { email: 'op@example.com' });
  await s.decide(lead.id, 'APPROVED');
  const rpc = calls.at(-1);
  assert.match(rpc.url, /\/rest\/v1\/rpc\/gh_decide_lead$/);
  assert.equal(rpc.init.headers.Authorization, 'Bearer T');
  assert.deepEqual(JSON.parse(rpc.init.body), { p_lead_id: lead.id, p_decision: 'APPROVED', p_note: null });
});

test('SupabaseStore surfaces server errors', async () => {
  const s = new SupabaseStore({ supabaseUrl: 'https://x', supabaseAnonKey: 'k' }, {
    fetchImpl: async () => new Response(JSON.stringify({ message: 'Lead is already APPROVED' }), { status: 400 }), storage: memStorage(),
  });
  await assert.rejects(s.decide('id', 'REJECTED', 'x'), /already APPROVED/);
});
