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
async function call(method, route, { body, cookie, csrf, origin, extra } = {}) {
  const headers = { host: 'veocrm.vercel.app', ...(extra || {}) };
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

test('la sesión vence tras 15 minutos sin actividad y cada petición la renueva', async () => {
  const t = signedSession({ id: 7, session_version: 2 });
  const d = decodeSession(t);
  assert.ok(d.exp - Date.now() <= 15 * 60 * 1000 + 1000, 'vigencia máxima de 15 min por inactividad');
  const viejo = signedSession({ id: 7, session_version: 2 }, Date.now() - 8 * 24 * 3600 * 1000);
  assert.equal(decodeSession(viejo), null, 'tope absoluto de 7 días desde el inicio de sesión');
  await addUser('ana', 'admin');
  const { cookie, csrf } = await loginAs('ana');
  const ping = await call('GET', 'ping', { cookie });
  assert.equal(ping.status, 200);
  const renovada = ping.headers['set-cookie'];
  assert.match(renovada || '', /veo_sesion=/, 'la actividad renueva la cookie');
  const cookie2 = renovada.split(';')[0];
  const boot2 = await call('GET', 'bootstrap', { cookie: cookie2 });
  assert.equal(boot2.data.csrf, csrf, 'el token CSRF no cambia al renovar la sesión');
  assert.equal((await call('POST', 'logout', { cookie: cookie2, csrf })).status, 200);
});

test('predio EN OPERACIÓN es de sólo lectura salvo desbloqueo con credenciales de administrador', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Operando', broker_id: beto.id, created_by: beto.id, active: true, phase: 'EN_OPERACION', corridor_id: 1 },
                      { id: 2, code: 'VEO-01-00002', alias: 'Otro', broker_id: beto.id, created_by: beto.id, active: true, phase: 'EN_OPERACION', corridor_id: 1 });
  const b = await loginAs('beto');
  const det = await call('GET', 'predios/1', { cookie: b.cookie });
  assert.equal(det.data.locked, true); assert.equal(det.data.unlocked, false);
  const editar = (extra, id = 1) => call('PATCH', `predios/${id}`, { cookie: b.cookie, csrf: b.csrf, body: { alias: 'Cambio' }, extra });
  assert.equal((await editar()).status, 423, 'sin desbloqueo no se edita');
  assert.equal((await call('POST', 'predios/1/comments', { cookie: b.cookie, csrf: b.csrf, body: { body: 'nota' } })).status, 423);
  assert.equal((await call('POST', 'predios/1/documents/complete', { cookie: b.cookie, csrf: b.csrf, body: { doc_type: 'operacion', storage_path: '1/x.jpg', original_filename: 'x.jpg' } })).status, 423);
  // contraseña equivocada o credenciales que no son de administrador
  assert.equal((await call('POST', 'predios/1/unlock', { cookie: b.cookie, csrf: b.csrf, body: { username: 'ana', password: 'mala' } })).status, 401);
  assert.equal((await call('POST', 'predios/1/unlock', { cookie: b.cookie, csrf: b.csrf, body: { username: 'beto', password: 'clave-segura-123' } })).status, 401);
  const ok = await call('POST', 'predios/1/unlock', { cookie: b.cookie, csrf: b.csrf, body: { username: 'ana', password: 'clave-segura-123' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const h = { 'x-veo-unlock': ok.data.token };
  assert.equal((await editar(h)).status, 200, 'con desbloqueo sí se edita');
  assert.equal((await editar(h, 2)).status, 423, 'el desbloqueo es sólo para ese predio');
  assert.equal((await editar({ 'x-veo-unlock': ok.data.token.replace(/.$/, c => c === 'A' ? 'B' : 'A') })).status, 423, 'token alterado no sirve');
  assert.ok(db.veo_activity.some(x => x.kind === 'desbloqueo' && /autorizó/.test(x.detail)), 'queda en la bitácora');
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

test('predio registrado por broker queda a su nombre y no ve a otros brokers', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker'); const caro = await addUser('caro', 'broker');
  const { cookie, csrf, boot } = await loginAs('beto');
  assert.deepEqual(boot.data.users.map(u => u.id), [beto.id], 'el broker sólo recibe su propia cuenta');
  const r = await call('POST', 'predios', { cookie, csrf, body: { alias: 'Para Caro', corridor_id: 1, lat: 25.67, lng: -100.31, broker_id: caro.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.veo_predios.find(p => p.alias === 'Para Caro').broker_id, beto.id, 'se ignora el broker enviado');
  const r2 = await call('POST', 'predios', { cookie, csrf, body: { alias: 'Sin broker', corridor_id: 1, lat: 25.67, lng: -100.31, broker_id: null } });
  assert.equal(db.veo_predios.find(p => p.id === r2.data.id).broker_id, beto.id);
  assert.equal((await call('PATCH', `predios/${r2.data.id}`, { cookie, csrf, body: { alias: 'Sin broker', broker_id: caro.id } })).status, 200);
  assert.equal(db.veo_predios.find(p => p.id === r2.data.id).broker_id, beto.id, 'el broker no puede reasignar');
  const admin = await loginAs('ana');
  assert.ok(admin.boot.data.users.length >= 3, 'supervisión sigue viendo a todo el equipo');
});

test('nuevo predio no se marca como verificado y ya no existe la revalidación', async () => {
  await addUser('beto', 'broker');
  const { cookie, csrf } = await loginAs('beto');
  const r = await call('POST', 'predios', { cookie, csrf, body: { alias: 'Nuevo', corridor_id: 1, lat: 25.67, lng: -100.31 } });
  assert.equal(r.status, 200);
  assert.equal(db.veo_predios[0].geo_status, undefined);
  assert.equal((await call('POST', 'predios/1/geo/revalidate', { cookie, csrf, body: {} })).status, 404);
});

test('contraseñas: se aceptan desde 7 caracteres y se rechazan con 6', async () => {
  await addUser('ana', 'admin');
  const a = await loginAs('ana');
  assert.equal((await call('POST', 'users', { ...a, body: { username: 'corta', password: '123456' } })).status, 400);
  assert.equal((await call('POST', 'users', { ...a, body: { username: 'siete', password: '1234567' } })).status, 200);
  const r = await call('POST', 'me/password', { ...a, body: { current_password: 'clave-segura-123', new_password: 'abc1234' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('foto de fase 1 se acepta sin georreferencia; si trae GPS se guarda', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Foto', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1 });
  const { cookie, csrf } = await loginAs('beto');
  const sinGps = await call('POST', 'predios/1/documents/complete', { cookie, csrf, body: { doc_type: 'foto', storage_path: '1/abc-foto.jpg', original_filename: 'foto.jpg' } });
  assert.equal(sinGps.status, 200, JSON.stringify(sinGps.data));
  assert.equal(db.veo_documents[0].geo_lat, undefined);
  const conGps = await call('POST', 'predios/1/documents/complete', { cookie, csrf, body: { doc_type: 'foto', storage_path: '1/def-foto.jpg', original_filename: 'foto2.jpg', geo_lat: 25.67, geo_lng: -100.31, geo_source: 'exif' } });
  assert.equal(conGps.status, 200, JSON.stringify(conGps.data));
  assert.equal(db.veo_documents[1].geo_lat, 25.67);
});

test('los archivos se renombran según lo solicitado (foto_predio_1, recibo_predial_1…)', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Nombres', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1 });
  const { cookie, csrf } = await loginAs('beto');
  const up = (doc_type, f) => call('POST', 'predios/1/documents/complete', { cookie, csrf, body: { doc_type, storage_path: `1/${f}`, original_filename: f } });
  assert.equal((await up('foto', 'WhatsApp Image 2026-11-18 at 10.15.32.jpeg')).status, 200);
  await up('foto', 'IMG-20261118-WA0007.JPG');
  await up('predial', 'WhatsApp Image 2026-11-18 at 11.00.00.png');
  await up('operacion', 'VID-20261118-WA0001.mp4');
  assert.deepEqual(db.veo_documents.map(d => d.original_filename), ['foto_predio_1.jpg', 'foto_predio_2.jpg', 'recibo_predial_1.png', 'operacion_1.mp4']);
  const sign = await call('POST', 'predios/1/documents/sign', { cookie, csrf, body: { doc_type: 'foto', original_filename: 'WhatsApp Image.jpeg', size_bytes: 1000 } });
  assert.doesNotMatch(sign.data.storage_path || '', /WhatsApp/);
});

test('fase 1 → contacto: el video con dron es opcional', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Sin dron', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1, lat: 25.67, lng: -100.31, score: 80, dron_url: null });
  db.veo_documents.push({ id: 1, predio_id: 1, doc_type: 'foto', storage_path: '1/f.jpg' }, { id: 2, predio_id: 1, doc_type: 'satelital', storage_path: '1/s.png' });
  const { cookie, csrf } = await loginAs('beto');
  const det = await call('GET', 'predios/1', { cookie });
  assert.ok(!det.data.next_requirements.some(x => /dron/i.test(x.label)), 'el dron no debe aparecer como requisito');
  const r = await call('POST', 'predios/1/request', { cookie, csrf, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('fase 5 EN OPERACIÓN: exige expediente de cierre completo; luego fotos/videos de operación sólo con desbloqueo', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-02-00001', alias: 'Cerrado', broker_id: beto.id, created_by: beto.id, active: true, phase: 'CIERRE', corridor_id: 2, lat: 25.6, lng: -100.2, score: 80, permiso_status: 'en_tramite', clausula_condicional: true });
  const b = await loginAs('beto');
  // Sin expediente completo no se puede solicitar
  let det = await call('GET', 'predios/1', { cookie: b.cookie });
  assert.ok(det.data.next_requirements.length > 0);
  assert.equal((await call('POST', 'predios/1/request', { ...b, body: {} })).status, 400);
  // Expediente completo: contrato, estudios, permiso municipal y permiso autorizado
  // Mecánica de suelos y documento de permiso municipal son opcionales: no se adjuntan y aun así se puede avanzar
  for (const [i, t] of ['contrato', 'memoria_calculo', 'factibilidad_electrica', 'programa_obra'].entries())
    db.veo_documents.push({ id: i + 1, predio_id: 1, doc_type: t, storage_path: `1/${t}.pdf` });
  // Falta el permiso autorizado: todavía no se puede solicitar
  det = await call('GET', 'predios/1', { cookie: b.cookie });
  assert.deepEqual(det.data.next_requirements.filter(x => !x.done).map(x => x.label), ['Permiso municipal autorizado']);
  assert.ok(det.data.next_requirements.some(x => x.label === 'Evidencia de programa de obra' && x.done));
  db.veo_predios[0].permiso_status = 'autorizado';
  assert.equal((await call('POST', 'predios/1/request', { ...b, body: {} })).status, 200);
  const a = await loginAs('ana');
  const r = db.veo_requests[0];
  r.status = 'pendiente'; // el Supabase simulado no aplica el valor por defecto de la columna
  assert.equal(r.to_phase, 'EN_OPERACION');
  assert.equal((await call('POST', `requests/${r.id}/resolve`, { ...a, body: { decision: 'aprobada' } })).status, 200);
  assert.equal(db.veo_predios[0].phase, 'EN_OPERACION');
  // En operación: no hay fase siguiente; el expediente queda bloqueado y las fotos/videos de
  // operación se suben tras desbloquear con credenciales del administrador.
  det = await call('GET', 'predios/1', { cookie: b.cookie });
  assert.deepEqual(det.data.next_requirements, []);
  assert.equal(det.data.readiness.complete, true);
  assert.equal(det.data.locked, true);
  assert.equal((await call('POST', 'predios/1/request', { ...b, body: {} })).status, 400);
  const body = { doc_type: 'operacion', storage_path: '1/x-sitio.mp4', original_filename: 'sitio.mp4' };
  assert.equal((await call('POST', 'predios/1/documents/complete', { ...b, body })).status, 423);
  const un = await call('POST', 'predios/1/unlock', { ...b, body: { username: 'ana', password: 'clave-segura-123' } });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  const up = await call('POST', 'predios/1/documents/complete', { ...b, body, extra: { 'x-veo-unlock': un.data.token } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
});

test('calificación: sin compatibilidad urbana; tráfico pesa 45%', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Score', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1 });
  const b = await loginAs('beto');
  assert.equal(b.boot.data.weights.urbana, undefined);
  assert.equal(Object.values(b.boot.data.weights).reduce((x, y) => x + y, 0), 100);
  const solo = await call('PATCH', 'predios/1', { ...b, body: { ratings_json: JSON.stringify({ flujo: 5 }) } });
  assert.equal(solo.status, 200); assert.equal(db.veo_predios[0].score, 45);
  const todo = await call('PATCH', 'predios/1', { ...b, body: { ratings_json: JSON.stringify({ flujo: 5, visibilidad: 5, electrica: 5, propietario: 5, comercial: 5, urbana: 5 }) } });
  assert.equal(todo.status, 200); assert.equal(db.veo_predios[0].score, 100);
});

test('rechazar cambio de fase exige motivo y lo registra en la bitácora', async () => {
  await addUser('ana', 'admin'); const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Rechazo', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1 });
  db.veo_requests.push({ id: 1, predio_id: 1, from_phase: 'BUSQUEDA_FACTIBILIDAD', to_phase: 'PRIMER_CONTACTO', status: 'pendiente' });
  const a = await loginAs('ana');
  assert.equal((await call('POST', 'requests/1/resolve', { ...a, body: { decision: 'rechazada' } })).status, 400);
  assert.equal((await call('POST', 'requests/1/resolve', { ...a, body: { decision: 'rechazada', review_note: '   ' } })).status, 400);
  assert.equal(db.veo_requests[0].status, 'pendiente');
  const ok = await call('POST', 'requests/1/resolve', { ...a, body: { decision: 'rechazada', review_note: 'Falta la captura satelital' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(db.veo_requests[0].status, 'rechazada');
  assert.equal(db.veo_requests[0].review_note, 'Falta la captura satelital');
  assert.equal(db.veo_predios[0].phase, 'BUSQUEDA_FACTIBILIDAD');
  const log = db.veo_activity.find(x => x.kind === 'fase');
  assert.match(log.detail, /Rechazó el avance a Primer contacto\. Motivo: Falta la captura satelital/);
  assert.equal(log.predio_id, 1);
});

test('permiso municipal: se puede marcar Autorizado sin adjuntar el documento', async () => {
  await addUser('ana', 'admin');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Permiso', broker_id: null, created_by: 1, active: true, phase: 'CIERRE', corridor_id: 1 });
  const a = await loginAs('ana');
  const r = await call('PATCH', 'predios/1', { ...a, body: { permiso_status: 'autorizado' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.veo_predios[0].permiso_status, 'autorizado');
  const det = await call('GET', 'predios/1', { cookie: a.cookie });
  assert.ok(!det.data.readiness.items.some(x => /documento de permiso/i.test(x.label)));
});

test('fase 2 → 3 exige el recibo de pago del predial', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Predial', broker_id: beto.id, created_by: beto.id, active: true, phase: 'PRIMER_CONTACTO', corridor_id: 1,
    propietario: 'Dueño', telefono: '8110000000', fecha_contacto: '2026-11-16', interes: 'interesado' });
  const b = await loginAs('beto');
  let det = await call('GET', 'predios/1', { cookie: b.cookie });
  const req = det.data.next_requirements.find(x => /predial/i.test(x.label));
  assert.ok(req && !req.done, 'el recibo del predial debe aparecer como requisito pendiente');
  assert.equal((await call('POST', 'predios/1/request', { ...b, body: {} })).status, 400);
  const up = await call('POST', 'predios/1/documents/complete', { ...b, body: { doc_type: 'predial', storage_path: '1/x-predial.pdf', original_filename: 'predial.pdf' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  det = await call('GET', 'predios/1', { cookie: b.cookie });
  assert.ok(det.data.next_requirements.every(x => x.done));
  assert.equal((await call('POST', 'predios/1/request', { ...b, body: {} })).status, 200);
});

test('mapa: en EN OPERACIÓN sólo fotos del predio y de operación; otras fases sin cambio', async () => {
  const beto = await addUser('beto', 'broker');
  db.veo_predios.push({ id: 1, code: 'VEO-01-00001', alias: 'Operando', broker_id: beto.id, created_by: beto.id, active: true, phase: 'EN_OPERACION', corridor_id: 1 },
                      { id: 2, code: 'VEO-01-00002', alias: 'Buscando', broker_id: beto.id, created_by: beto.id, active: true, phase: 'BUSQUEDA_FACTIBILIDAD', corridor_id: 1 });
  const geo = { geo_lat: 25.6, geo_lng: -100.3, geo_source: 'exif' };
  let id = 0; const doc = (predio_id, doc_type, f) => db.veo_documents.push({ id: ++id, predio_id, doc_type, storage_path: `${predio_id}/${f}`, original_filename: f, ...geo });
  doc(1, 'foto', 'predio.jpg'); doc(1, 'satelital', 'sat.png'); doc(1, 'dron', 'dron.mp4'); doc(1, 'operacion', 'pantalla.jpg'); doc(1, 'operacion', 'noche.mp4');
  doc(2, 'foto', 'p2.jpg'); doc(2, 'satelital', 's2.png');
  const { boot } = await loginAs('beto');
  const p1 = boot.data.predios.find(p => p.id === 1), p2 = boot.data.predios.find(p => p.id === 2);
  assert.deepEqual(p1.media.map(m => m.name).sort(), ['noche.mp4', 'pantalla.jpg', 'predio.jpg']);
  assert.deepEqual(p2.media.map(m => m.name).sort(), ['p2.jpg', 's2.png']);
  assert.deepEqual(boot.data.photos.filter(f => f.predio_id === 1).map(f => f.filename).sort(), ['noche.mp4', 'pantalla.jpg', 'predio.jpg']);
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
