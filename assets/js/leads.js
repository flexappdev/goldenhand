// Golden Hand lead intake: shared lead model, validation and storage.
//
// Two stores share one interface:
//   - SupabaseStore (REAL): PostgREST + Supabase Auth over plain fetch.
//   - LocalStore    (DEMO): the current browser's localStorage only.
//
// Lead lifecycle (the human approval step):
//   NEW --approve--> APPROVED   (worth quoting; ready for a job)
//   NEW --reject---> REJECTED   (note required)
// Only a signed-in operator can decide, and every decision is logged.

export const STATUSES = ['NEW', 'APPROVED', 'REJECTED'];
export const CATEGORIES = [
  'General handyman',
  'Mounting / fittings',
  'Walls / decorating',
  'Furniture / assembly',
  'Minor plumbing',
  'Carpentry / repair',
  'Bathroom / tiling',
  'Other',
];
export const URGENCIES = ['Flexible', 'This week', 'Urgent (24h)'];
export const WINDOWS = ['Flexible', 'Morning', 'Afternoon', 'Evening'];

const LIMITS = { name: 120, phone: 40, email: 200, postcode: 12, job: 2000, note: 1000 };

// Keyword guess only. Labelled DEMO: a human confirms the category on review.
export function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/bath|shower|tile|tiling|grout/.test(t)) return 'Bathroom / tiling';
  if (/tv|shelf|shelves|mirror|mount|rail|curtain|blind/.test(t)) return 'Mounting / fittings';
  if (/paint|wall|patch|fill|plaster|decorat/.test(t)) return 'Walls / decorating';
  if (/wardrobe|flat.?pack|assemble|furniture|ikea/.test(t)) return 'Furniture / assembly';
  if (/tap|leak|sink|toilet|drip|plumb/.test(t)) return 'Minor plumbing';
  if (/door|cabinet|cupboard|wood|hinge|skirting/.test(t)) return 'Carpentry / repair';
  return 'General handyman';
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMulti = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

// Returns { lead, errors }. errors is {} when the input is acceptable.
export function buildLead(input, { now = new Date(), random = Math.random } = {}) {
  const lead = {
    id: uuid(random),
    ref: makeRef(now, random),
    created_at: now.toISOString(),
    source: input.source === 'rapid' ? 'rapid' : 'site',
    name: clean(input.name, LIMITS.name),
    phone: clean(input.phone, LIMITS.phone),
    email: clean(input.email, LIMITS.email).toLowerCase(),
    postcode: clean(input.postcode, LIMITS.postcode).toUpperCase(),
    job: cleanMulti(input.job, LIMITS.job),
    category: CATEGORIES.includes(input.category) ? input.category : guessCategory(input.job),
    urgency: URGENCIES.includes(input.urgency) ? input.urgency : 'Flexible',
    preferred_window: WINDOWS.includes(input.preferred_window) ? input.preferred_window : 'Flexible',
    consent: input.consent === true,
    status: 'NEW',
  };
  const errors = {};
  if (lead.name.length < 2) errors.name = 'Please add your name.';
  if (!lead.phone && !lead.email) errors.contact = 'Add a phone number or an email so we can reply.';
  if (lead.phone && !/^[+()\d\s-]{7,}$/.test(lead.phone)) errors.phone = 'That phone number does not look right.';
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) errors.email = 'That email does not look right.';
  if (lead.job.length < 10) errors.job = 'Tell us a bit more about the job (at least 10 characters).';
  if (!lead.consent) errors.consent = 'Please agree so we can contact you about this job.';
  // Honeypot: real people never fill the hidden "website" field.
  if (clean(input.website, 200)) errors.spam = 'Rejected.';
  return { lead, errors };
}

export function makeRef(now = new Date(), random = Math.random) {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `GH-${d}-${s}`;
}

function uuid(random) {
  if (random === Math.random && globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const h = [...Array(32)].map(() => Math.floor(random() * 16).toString(16));
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// Shared decision rules, mirrored server-side by gh_decide_lead().
export function checkDecision(lead, decision, note) {
  if (!lead) return 'Lead not found.';
  if (lead.status !== 'NEW') return `Lead is already ${lead.status}.`;
  if (!['APPROVED', 'REJECTED'].includes(decision)) return 'Unknown decision.';
  if (decision === 'REJECTED' && !clean(note, LIMITS.note)) return 'A note is required to reject a lead.';
  return null;
}

export function isConfigured(cfg) {
  return Boolean(cfg && cfg.supabaseUrl && cfg.supabaseAnonKey);
}

export function capabilities(cfg) {
  const live = isConfigured(cfg) ? 'REAL' : 'DEMO';
  return [
    { name: 'Enquiry form (validation, consent, spam trap)', label: 'REAL' },
    { name: 'Lead storage', label: live },
    { name: 'Operator sign-in', label: live },
    { name: 'Approval step (approve / reject + audit log)', label: live },
    { name: 'Category suggestion (keyword rules, human confirms)', label: 'DEMO' },
    { name: 'New-lead notification (email / WhatsApp)', label: 'PENDING' },
    { name: 'Photo upload', label: 'PENDING' },
    { name: 'Jobs board', label: 'PENDING' },
    { name: 'Proof (before/after, reviews)', label: 'PENDING' },
  ];
}

export function createStore(cfg, opts = {}) {
  return isConfigured(cfg) ? new SupabaseStore(cfg, opts) : new LocalStore(opts);
}

// ---------------------------------------------------------------- DEMO store
export class LocalStore {
  constructor({ storage = globalThis.localStorage, key = 'gh_demo_leads' } = {}) {
    this.mode = 'DEMO';
    this.storage = storage;
    this.key = key;
  }
  _read() {
    try { return JSON.parse(this.storage.getItem(this.key) || '{"leads":[],"events":[]}'); }
    catch { return { leads: [], events: [] }; }
  }
  _write(db) { this.storage.setItem(this.key, JSON.stringify(db)); }
  async submit(lead) {
    const db = this._read();
    db.leads.push({ ...lead, decided_by: null, decided_at: null, decision_note: null });
    db.events.push({ lead_id: lead.id, at: lead.created_at, actor: 'customer', from_status: null, to_status: 'NEW', note: null });
    this._write(db);
    return { ref: lead.ref };
  }
  async session() { return { email: 'demo@local' }; }
  async signIn() { return { email: 'demo@local' }; }
  async signOut() {}
  async list() {
    return this._read().leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async events(leadId) {
    return this._read().events.filter((e) => e.lead_id === leadId);
  }
  async decide(leadId, decision, note, { now = new Date() } = {}) {
    const db = this._read();
    const lead = db.leads.find((l) => l.id === leadId);
    const err = checkDecision(lead, decision, note);
    if (err) throw new Error(err);
    const at = now.toISOString();
    Object.assign(lead, { status: decision, decided_by: 'demo@local', decided_at: at, decision_note: clean(note, LIMITS.note) || null });
    db.events.push({ lead_id: leadId, at, actor: 'demo@local', from_status: 'NEW', to_status: decision, note: lead.decision_note });
    this._write(db);
    return lead;
  }
}

// ---------------------------------------------------------------- REAL store
export class SupabaseStore {
  constructor(cfg, { fetchImpl = globalThis.fetch?.bind(globalThis), storage = globalThis.sessionStorage } = {}) {
    this.mode = 'REAL';
    this.url = cfg.supabaseUrl.replace(/\/$/, '');
    this.key = cfg.supabaseAnonKey;
    this.fetch = fetchImpl;
    this.storage = storage;
  }
  _token() {
    try {
      const s = JSON.parse(this.storage?.getItem('gh_op_session') || 'null');
      return s && s.expires_at * 1000 > Date.now() ? s : null;
    } catch { return null; }
  }
  _headers(auth) {
    const t = auth ? this._token() : null;
    return {
      apikey: this.key,
      Authorization: `Bearer ${t ? t.access_token : this.key}`,
      'Content-Type': 'application/json',
    };
  }
  async _req(path, { method = 'GET', body, auth = false, prefer } = {}) {
    const headers = this._headers(auth);
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetch(`${this.url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.message || data?.msg || data?.error_description || `Request failed (${res.status})`);
    return data;
  }
  async submit(lead) {
    const row = { ...lead };
    delete row.status; // server default
    // anon can insert but not read back, so ask for no representation.
    await this._req('/rest/v1/gh_leads', { method: 'POST', body: row, prefer: 'return=minimal' });
    return { ref: lead.ref };
  }
  async session() {
    const t = this._token();
    return t ? { email: t.user?.email } : null;
  }
  async signIn(email, password) {
    const data = await this._req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    const expires_at = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    this.storage.setItem('gh_op_session', JSON.stringify({ ...data, expires_at }));
    return { email: data.user?.email };
  }
  async signOut() { this.storage?.removeItem('gh_op_session'); }
  async list() {
    return this._req('/rest/v1/gh_leads?select=*&order=created_at.desc', { auth: true });
  }
  async events(leadId) {
    return this._req(`/rest/v1/gh_lead_events?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=at.asc`, { auth: true });
  }
  async decide(leadId, decision, note) {
    return this._req('/rest/v1/rpc/gh_decide_lead', {
      method: 'POST', auth: true,
      body: { p_lead_id: leadId, p_decision: decision, p_note: note || null },
    });
  }
}
