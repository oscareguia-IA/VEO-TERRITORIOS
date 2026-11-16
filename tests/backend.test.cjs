/* Pruebas del backend sin red ni base real: se simula PostgREST/Storage de Supabase en memoria. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_' + 'x'.repeat(31);
process.env.VEO_SESSION_SECRET = 's'.repeat(48);

const api = require('../api/main.js');
const { hashPassword, checkPassword, signedSession, decodeSession } = api._internal;

// ── Supabase falso ──────────────────────────────────────────────
let db, lastQueries, rpcLocks;
function resetDb() {
  db = { veo_users: [], veo_predios: [], veo_documents: [], veo_comments: [], veo_requests: [], veo_activity: [] };
  lastQueries = [];
  rpcLocks = {};
}
const matches = (row, field, cond) => {
  const [op, ...rest] = cond.split('.'); const val = rest.join('.');
  if (op === 'eq') return String(row[field]) === val;
  throw new Error('op no soportado ' + op);
};
function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') {
      const conds = v.slice(1, -1).split(',').map(c => { const [f, ...r] = c.split('.'); return [f, r.join('.')]; });
      rows = rows.filter(r => conds.some(([f, c]) => matches(r, f, c)));
    } else rows = rows.filter(r => matches(r, k, v));
  }
  const limit = params.get('limit'); return limit ? rows.slice(0, +limit) : rows;
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url); const method = opts.method || 'GET';
  if (u.pathname.startsWith('/storage/v1/')) {
    if (u.pathname.includes('/object/upload/sign/') || u.pathname.includes('/object/sign/')) return json(200, { url: '/x?token=tok' });
    if (u.pathname.includes('/object/info/')) return json(200, { size: 1234 });
    return json(200, {});
  }
  const name = u.pathname.replace('/rest/v1/', '');
  lastQueries.push({ name, method, params: Object.fromEntries(u.searchParams) });
  if (name.startsWith('rpc/')) { const a = JSON.parse(opts.body || '{}'); const keys = a.p_keys || [a.p_key]; return json(200, name === 'rpc/veo_login_check' ? Math.max(0, ...keys.map(k => rpcLocks[k] || 0)) : 0); }
  const table = db[name]; if (!table) return json(404, { code: 'PGRST' });
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (method === 'GET') return json(200, applyFilters(table, u.searchParams));
  if (method === 'POST') { const row = { id: table.length + 1, created_at: new Date().toISOString(), active: true, phase: 'BUSQUEDA_FACTIBILIDAD', ...body }; table.push(row); return json(201, [row]); }
  if (method === 'PATCH') { const rows = applyFilters(table, u.searchParams); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
  if (method === 'DELETE') { const rows = applyFilters(table, u.searchParams); db[name] = table.filter(r => !rows.includes(r)); return json(200, rows); }
};

// ── Petición/respuesta falsas ───────────────────────────────────
async function call(method, route, { body, cookie, csrf, origin } = {}) {
  const headers = { host: 'veocrm.vercel.app' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (origin !== undefined) headers.origin = origin; else if (method !== 'GET') headers.origin = 'https://veocrm.vercel.app';
  const req = { method, headers, query: { route }, body };
  const res = { statusCode: 200, headers: {}, writableEnded: false, chunks: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.chunks += x || ''; this.writableEnded = true; } };
  await api(req, res);
  let data = null; try { data = JSON.parse(res.chunks); } catch { data = res.chunks; }
  return { status: res.statusCode, data, headers: res.headers };
}
async function addUser(username, role, password = 'clave-segura-123') {
  const u = { id: db.veo_users.length + 1, username, display_name: username.toUpperCase(), role, active: true,
    must_change_password: false, session_version: 1, password_hash: await hashPassword(password) };
  db.veo_users.push(u); return u;
}
async function loginAs(username, password = 'clave-segura-123') {
  const r = await call('POST', 'login', { body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.headers['set-cookie'].split(';')[0];
  const boot = await call('GET', 'bootstrap', { cookie });
  return { cookie, csrf: boot.data.csrf, boot };
}

test.beforeEach(resetDb);

// ── Contraseñas y sesiones ──────────────────────────────────────
test('hash scrypt verifica la correcta y rechaza la incorrecta', async () => {
  const h = await hashPassword('mi-clave-larga');
  assert.match(h, /^scrypt\$/);
  assert.equal(await checkPassword('mi-clave-larga', h), true);
  assert.equal(await checkPassword('otra', h), false);
  assert.equal(await checkPassword('x', 'basura'), false);
});

test('sesión firmada: válida, alterada y expirada', () => {
  const t = signedSession({ id: 7, session_version: 2 });
  assert.equal(decodeSession(t).sub, 7);
  const [b, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 1, sv: 2, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(decodeSession(forged + '.' + sig), null);
  assert.equal(decodeSession(b + '.AAAA'), null);
  const expired = Buffer.from(JSON.stringify({ sub: 7, sv: 2, exp: Date.now() - 1 })).toString('base64url');
  assert.equal(decodeSession(expired + '.' + sig), null);
});

// ── Login ───────────────────────────────────────────────────────
test('login correcto pone cookie HttpOnly/Secure; incorrecto da 401', async () => {
  await addUser('ana', 'admin');
  const bad = await call('POST', 'login', { body: { username: 'ana', password: 'mala' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', 'login', { body: { username: 'ana', password: 'clave-segura-123' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax/);
});

test('usuario inexistente o inactivo da el mismo 401', async () => {
  const u = await addUser('beto', 'broker'); u.active = false;
  for (const username of ['beto', 'nadie']) {
    const r = await call('POST', 'login', { body: { username, password: 'clave-segura-123' } });
    assert.equal(r.status, 401); assert.equal(r.data.detail, 'Credenciales incorrectas.');
  }
});

test('sin cookie no hay acceso; sesión revocada al subir session_version', async () => {
  assert.equal((await call('GET', 'bootstrap')).status, 401);
  const u = await addUser('ana', 'admin');
  const { cookie } = await loginAs('ana');
  u.session_version = 2;
  assert.equal((await call('GET', 'bootstrap', { cookie })).status, 401);
});

test('bootstrap nunca expone password_hash', async () => {
  await addUser('ana', 'admin'); await addUser('beto', 'broker');
  const { boot } = await loginAs('ana');
  assert.ok(!JSON.stringify(boot.data).includes('password_hash'));
  assert.ok(!JSON.stringify(boot.data).includes('scrypt$'));
});

// ── CSRF / origen ───────────────────────────────────────────────
test('escrituras exigen token CSRF y origen propio', async () => {
  await addUser('ana', 'admin');
  const { cookie, csrf } = await loginAs('ana');
  const body = { alias: 'X', corridor_id: 1, lat: 25.6, lng: -100.3 };
  assert.equal((await call('POST', 'predios', { cookie, body })).status, 403);
  assert.equal((await call('POST', 'predios', { cookie, csrf, body, origin: 'https://malo.com' })).status, 403);
  assert.equal((await call('POST', 'predios', { cookie, csrf, body })).status, 200);
});

// ── Permisos por rol ────────────────────────────────────────────
test('broker sólo ve y edita sus predios', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker'); const caro = await addUser('caro', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'De Beto', broker_id: beto.id, created_by: 1, active: true, phase: 'BUSQUEDA_FACTIBILIDAD' },
                      { id: 2, code: 'VEO-01-00002', alias: 'De Caro', broker_id: caro.id, created_by: 1, active: true, phase: 'BUSQUEDA_FACTIBILIDAD' });
  const { cookie, csrf, boot } = await loginAs('beto');
  assert.deepEqual(boot.data.predios.map(p => p.id), [1]);
  const q = lastQueries.find(x => x.name === 'veo_predios' && x.params.broker_id);
  assert.ok(q, 'la consulta de predios del broker debe filtrarse en la base');
  assert.equal((await call('GET', 'predios/2', { cookie })).status, 404);
  assert.equal((await call('PATCH', 'predios/2', { cookie, csrf, body: { alias: 'robado' } })).status, 404);
  assert.equal((await call('PATCH', 'predios/1', { cookie, csrf, body: { alias: 'ok' } })).status, 200);
});

test('al reasignar un predio, el broker que lo creó pierde el acceso', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker'); const caro = await addUser('caro', 'broker');
  // Beto lo registró, pero hoy está asignado a Caro
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Reasignado', broker_id: caro.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', propietario: 'Dueño', telefono: '8110000000' });
  const b = await loginAs('beto');
  assert.deepEqual(b.boot.data.predios.map(p => p.id), []);
  assert.equal((await call('GET', 'predios/1', { cookie: b.cookie })).status, 404);
  assert.equal((await call('PATCH', 'predios/1', { cookie: b.cookie, csrf: b.csrf, body: { telefono: 'x' } })).status, 404);
  assert.equal((await call('POST', 'predios/1/comments', { cookie: b.cookie, csrf: b.csrf, body: { body: 'hola' } })).status, 404);
  const c = await loginAs('caro');
  assert.deepEqual(c.boot.data.predios.map(p => p.id), [1]);
});

test('nuevo predio no se marca como verificado y ya no existe la revalidación', async () => {
  await addUser('beto', 'broker');
  const { cookie, csrf } = await loginAs('beto');
  const r = await call('POST', 'predios', { cookie, csrf, body: { alias: 'Nuevo', corridor_id: 1, lat: 25.67, lng: -100.31 } });
  assert.equal(r.status, 200);
  assert.equal(db.veo_predios[0].geo_status, undefined);
  assert.equal((await call('POST', 'predios/1/geo/revalidate', { cookie, csrf, body: {} })).status, 404);
});

test('sólo admin crea usuarios; broker no exporta CSV', async () => {
  await addUser('ana', 'admin'); await addUser('beto', 'broker');
  const b = await loginAs('beto');
  assert.equal((await call('POST', 'users', { ...b, body: { username: 'nuevo', password: 'clave-segura-123' } })).status, 403);
  assert.equal((await call('GET', 'export.csv', { cookie: b.cookie })).status, 403);
  const a = await loginAs('ana');
  assert.equal((await call('POST', 'users', { ...a, body: { username: 'nuevo', password: 'clave-segura-123' } })).status, 200);
});

test('CSV neutraliza fórmulas de Excel', async () => {
  await addUser('ana', 'admin');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: '=HYPERLINK("http://x")', propietario: '+52 81', active: true });
  const { cookie } = await loginAs('ana');
  const r = await call('GET', 'export.csv', { cookie });
  assert.equal(r.status, 200);
  assert.ok(r.data.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(r.data.includes(`"'+52 81"`));
});

test('docs_count y pending_count por predio', async () => {
  await addUser('ana', 'admin');
  db.veo_predios.push({ id: 1, code: 'A', alias: 'a', active: true }, { id: 2, code: 'B', alias: 'b', active: true });
  db.veo_documents.push({ id: 1, predio_id: 1, doc_type: 'otro', storage_path: '1/a' }, { id: 2, predio_id: 1, doc_type: 'otro', storage_path: '1/b' });
  db.veo_requests.push({ id: 1, predio_id: 2, status: 'pendiente' }, { id: 2, predio_id: 2, status: 'aprobada' });
  const { boot } = await loginAs('ana');
  const byId = Object.fromEntries(boot.data.predios.map(p => [p.id, p]));
  assert.equal(byId[1].docs_count, 2); assert.equal(byId[1].pending_count, 0);
  assert.equal(byId[2].docs_count, 0); assert.equal(byId[2].pending_count, 1);
});

test('ruta desconocida da 404 y no existe endpoint de diagnóstico', async () => {
  const fs = require('node:fs'), path = require('node:path');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'api', 'verificar_supabase.js')), false);
  await addUser('ana', 'admin');
  const { cookie } = await loginAs('ana');
  assert.equal((await call('GET', 'no-existe', { cookie })).status, 404);
});

test('límite de escrituras responde 429 con Retry-After', async () => {
  const ana = await addUser('ana', 'admin');
  const { cookie, csrf } = await loginAs('ana');
  rpcLocks['escritura:' + ana.id] = 45;
  const r = await call('POST', 'predios', { cookie, csrf, body: { alias: 'X', corridor_id: 1, lat: 25.6, lng: -100.3 } });
  assert.equal(r.status, 429); assert.equal(r.headers['retry-after'], '45');
  assert.equal((await call('GET', 'bootstrap', { cookie })).status, 200, 'las lecturas no se limitan');
  const ws = lastQueries.filter(q => q.name === 'rpc/veo_login_fail');
  assert.ok(ws.length > 0);
});
