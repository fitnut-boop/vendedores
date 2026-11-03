'use strict';

/* ================= utilidades ================= */
const IVA = 0.21;
const SEGS = { g: 'General', m: 'Mayorista / Distribuidora', f: 'Farmacia' };
const $ = (s, r = document) => r.querySelector(s);
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Acepta número o texto ("32,585.66" / "32.585,66" / "32585.66")
function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  return parseFloat(s);
}

/* ================= almacenamiento local (IndexedDB) ================= */
const DB = {
  _db: null,
  open() {
    return this._db || (this._db = new Promise((res, rej) => {
      const r = indexedDB.open('vendedores', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    } catch { return undefined; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k);
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    } catch { /* sin almacenamiento: la app sigue funcionando con lo cargado en memoria */ }
  }
};

/* ================= datos ================= */
// datos = { generado, listas:{proveedor:{generado, items:[[codigo,desc,g,m,f]]}}, unidades:{codigo:uxb}, clientes:[[n,razon,fantasia,lista,subcanal]] }
let datos = { generado: 0, listas: {}, unidades: {}, clientes: [] };
let catalogo = [];   // [{c,d,g,m,f,u,ug,prov,_n}]
let clientes = [];   // [{n,rs,nf,l,s,_n}]

function guessUnits(desc) {
  const m = /(\d+)\s*x\s*\d/i.exec(desc);
  return m ? parseInt(m[1], 10) : 1;
}

function rebuild() {
  const map = new Map();
  for (const [prov, l] of Object.entries(datos.listas)) {
    for (const [c, d, g, m, f] of l.items) map.set(String(c), { c: String(c), d, g, m, f, prov });
  }
  catalogo = [...map.values()].map(it => {
    const u = datos.unidades[it.c];
    it.u = u > 0 ? u : guessUnits(it.d);
    it.ug = !(u > 0); // unidades por bulto estimadas desde la descripción
    it._n = norm(it.d);
    return it;
  });
  clientes = datos.clientes.map(([n, rs, nf, l, s]) => ({ n, rs, nf, l, s, _n: norm(`${rs} ${nf || ''}`) }));
  renderStatus();
  rows.forEach(r => r.refresh());
}

async function persist() { datos.generado = Date.now(); await DB.set('datos', datos); }

/* ---- Supabase: datos compartidos con login ---- */
const CFG = window.APP_CONFIG || {};
// Sin configurar (valores de ejemplo en config.js) → modo local: los datos quedan solo en este dispositivo.
const sb = (window.supabase && CFG.url && CFG.key && !/TU-PROYECTO|TU-ANON/.test(CFG.url + CFG.key))
  ? window.supabase.createClient(CFG.url, CFG.key) : null;
let esAdmin = !sb;
let esJefe = !sb;   // el jefe ve los apartados de gestión de vendedores
let sinConexion = false;

// Muestra u oculta los apartados según el rol.
function aplicarRol() {
  for (const t of ['vend', 'obj', 'cal']) $(`[data-tab="${t}"]`).hidden = !esJefe;
  $('[data-tab="datos"]').hidden = !esAdmin;
  $('.top').classList.toggle('multi', esJefe);
}

// PostgREST devuelve máx. 1000 filas por consulta: se pagina.
async function fetchAll(table, cols, orderBy) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols);
    for (const o of orderBy) q = q.order(o);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function loadData(force = false) {
  const vacio = { generado: 0, listas: {}, unidades: {}, clientes: [] };
  const local = await DB.get('datos');
  if (!sb) {
    if (local) datos = { ...vacio, ...local };
    return rebuild();
  }
  try {
    // Primero se consulta solo el número de versión: si no cambió, se usa lo guardado en el celular (carga instantánea).
    const { data: ver, error } = await sb.from('version').select('v').eq('id', 1).single();
    if (error) throw error;
    sinConexion = false;
    if (!force && local && local.version === ver.v) datos = { ...vacio, ...local };
    else {
      const [cl, pr, ar] = await Promise.all([
        fetchAll('clientes', 'n,razon,fantasia,lista,subcanal', ['n']),
        fetchAll('precios', 'proveedor,codigo,descripcion,g,m,f', ['proveedor', 'codigo']),
        fetchAll('articulos', 'codigo,unidades', ['codigo'])
      ]);
      datos = {
        ...vacio, generado: Date.now(), version: ver.v,
        clientes: cl.map(c => [c.n, c.razon, c.fantasia || '', c.lista, c.subcanal]),
        unidades: Object.fromEntries(ar.map(a => [a.codigo, a.unidades]))
      };
      for (const p of pr) {
        (datos.listas[p.proveedor] ??= { generado: Date.now(), items: [] }).items.push([p.codigo, p.descripcion, +p.g, +p.m, +p.f]);
      }
      await DB.set('datos', datos);
    }
  } catch {
    sinConexion = true; // sin internet: se usa lo último guardado
    if (local) datos = { ...vacio, ...local };
  }
  rebuild();
  cargarSync();
}

// Estado de la sincronización automática con Chess (solo lo ven los administradores).
async function cargarSync() {
  const el = $('#sync');
  if (!sb || !esAdmin) return;
  const { data, error } = await sb.from('sync_estado').select('clave,actualizado,ultimo_intento,error');
  if (error || !data?.length) { el.textContent = 'Sincronización con Chess: todavía no corrió.'; return; }
  const f = s => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const ult = Math.max(...data.map(d => Date.parse(d.ultimo_intento || 0)));
  const cambio = Math.max(...data.map(d => Date.parse(d.actualizado || 0)));
  const err = data.find(d => d.clave === 'ultimo_error' && d.error && Date.parse(d.ultimo_intento || 0) >= ult);
  el.textContent = `Sincronización con Chess: última revisión ${f(ult)} · últimos cambios ${f(cambio)}` +
    (err ? ` · ERROR: ${err.error}` : '');
}

/* ---- Login ---- */
// vista: 'login' | 'pendiente' | null (app normal)
function showLogin(vista) {
  const v = vista === true ? 'login' : vista;
  $('#login').hidden = !v;
  $('#loginForm').hidden = v !== 'login';
  $('#pendiente').hidden = v !== 'pendiente';
  $('main#tab-cot').hidden = !!v;
}

async function initAuth() {
  if (!sb) { aplicarRol(); return true; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLogin('login'); return false; }
  const { data: p } = await sb.from('perfiles').select('rol').eq('id', session.user.id).maybeSingle();
  if (p?.rol === 'pendiente') { showLogin('pendiente'); return false; } // cuenta creada pero todavía no aprobada
  esAdmin = p?.rol === 'admin';
  esJefe = esAdmin || p?.rol === 'jefe';
  showLogin(null);
  $('#btnSalir').hidden = false;
  aplicarRol();
  if (esAdmin) cargarVendedores();
  return true;
}

/* ---- Crear cuenta (queda pendiente hasta que un administrador la apruebe) ---- */
let modoRegistro = false;
function setModoRegistro(v) {
  modoRegistro = v;
  $('#lTitulo').textContent = v ? 'Crear cuenta' : 'Ingresar';
  $('#lNombreBox').hidden = !v;
  $('#lNombre').required = v;
  $('#lAyuda').hidden = !v;
  $('#lPass').autocomplete = v ? 'new-password' : 'current-password';
  $('#lBtn').textContent = v ? 'Crear cuenta' : 'Entrar';
  $('#lToggle').textContent = v ? 'Ya tengo cuenta. Ingresar' : '¿Sos vendedor y todavía no tenés cuenta? Crear cuenta';
  $('#lMsg').textContent = '';
}
$('#lToggle').addEventListener('click', () => setModoRegistro(!modoRegistro));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#lMsg'), email = $('#lEmail').value.trim(), password = $('#lPass').value;
  const fallo = t => { m.className = 'msg err'; m.textContent = t; };
  m.className = 'msg';

  if (modoRegistro) {
    const nombre = $('#lNombre').value.trim();
    if (nombre.length < 3) return fallo('Escribí tu nombre y apellido.');
    if (password.length < 8) return fallo('La contraseña necesita al menos 8 caracteres.');
    m.textContent = 'Creando cuenta…';
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nombre } } });
    if (error) {
      return fallo(/already|registered/i.test(error.message) ? 'Ese email ya tiene cuenta. Tocá "Ya tengo cuenta" para ingresar.'
        : /password/i.test(error.message) ? 'La contraseña es muy débil: usá 8 caracteres o más, con letras y números.'
        : error.status === 429 ? 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'
        : 'No se pudo crear la cuenta. Revisá tu internet e intentá de nuevo.');
    }
    if (data.session) return location.reload(); // entra directo y ve "pendiente de aprobación"
    setModoRegistro(false);
    m.className = 'msg';
    m.textContent = 'Cuenta creada. Si te llegó un email, abrilo para confirmarla; después ingresá. El administrador tiene que aprobarte para que veas los datos.';
    return;
  }

  m.textContent = 'Ingresando…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    return fallo(error.status === 400 ? 'Email o contraseña incorrectos.' : 'No se pudo conectar. Revisá tu internet e intentá de nuevo.');
  }
  location.reload();
});

const salir = async () => {
  await sb.auth.signOut();
  await DB.set('datos', null); // no dejar datos de clientes guardados en un dispositivo sin sesión
  localStorage.removeItem('cot_draft');
  location.reload();
};
$('#btnSalir').addEventListener('click', salir);
$('#pSalir').addEventListener('click', salir);
$('#pRevisar').addEventListener('click', () => location.reload());

/* ---- Administrador: aprobar o rechazar vendedores ---- */
async function cargarVendedores() {
  if (!sb || !esAdmin) return;
  const cont = $('#listaVend');
  const { data, error } = await sb.from('perfiles').select('id,nombre,email,rol,creado').order('creado', { ascending: false });
  if (error) { cont.textContent = 'No se pudo cargar la lista de vendedores.'; return; }
  $('#cardVend').hidden = false;
  const pend = data.filter(u => u.rol === 'pendiente'), resto = data.filter(u => u.rol !== 'pendiente');
  $('[data-tab="datos"]').textContent = pend.length ? `Datos (${pend.length})` : 'Datos';

  const accion = async (rpc, uid, texto) => {
    if (!confirm(texto)) return;
    const { error: err } = await sb.rpc(rpc, { uid });
    if (err) { alert('No se pudo completar: ' + err.message); return; }
    cargarVendedores();
  };
  const cambiarRol = async (u, nuevo, texto) => {
    if (!confirm(texto)) return;
    const { error: err } = await sb.rpc('cambiar_rol', { uid: u.id, nuevo });
    if (err) { alert('No se pudo completar: ' + err.message); return; }
    cargarVendedores();
  };
  const fila = (u, botones) => {
    const d = document.createElement('div'); d.className = 'v';
    const t = document.createElement('div');
    const b = document.createElement('b'); b.textContent = u.nombre || u.email; // textContent: el nombre lo escribe el usuario
    const s = document.createElement('small'); s.textContent = u.email + (u.rol === 'admin' ? ' · administrador' : u.rol === 'jefe' ? ' · jefe' : '');
    t.append(b, s); d.append(t);
    if (botones.length) { const a = document.createElement('div'); a.className = 'acc'; a.append(...botones); d.append(a); }
    return d;
  };
  const boton = (txt, cls, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ' + cls; x.textContent = txt; x.onclick = fn; return x; };

  cont.replaceChildren();
  const h1 = document.createElement('h3'); h1.textContent = pend.length ? `Pendientes de aprobación (${pend.length})` : 'No hay cuentas pendientes';
  cont.append(h1);
  for (const u of pend) cont.append(fila(u, [
    boton('Aprobar', '', () => accion('aprobar_usuario', u.id, `¿Aprobar a ${u.nombre || u.email}? Va a poder ver clientes y precios.`)),
    boton('Rechazar', 'ghost danger', () => accion('eliminar_usuario', u.id, `¿Rechazar y eliminar la cuenta de ${u.email}?`)),
  ]));
  const h2 = document.createElement('h3'); h2.textContent = 'Con acceso'; cont.append(h2);
  for (const u of resto) cont.append(fila(u, u.rol === 'admin' ? [] : [
    u.rol === 'jefe'
      ? boton('Quitar jefe', 'ghost', () => cambiarRol(u, 'vendedor', `¿Dejar a ${u.nombre || u.email} como vendedor común?`))
      : boton('Hacer jefe', 'ghost', () => cambiarRol(u, 'jefe', `¿Dar a ${u.nombre || u.email} acceso a los apartados de jefe (Vendedores, Objetivos, Calendario)?`)),
    boton('Quitar', 'ghost danger', () => accion('eliminar_usuario', u.id, `¿Quitar el acceso y eliminar la cuenta de ${u.email}?`)),
  ]));
}

/* ================= lectura de Excel ================= */
async function readSheet(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}
const findHeader = (rows, ...names) =>
  rows.findIndex(r => names.every(n => r.some(c => norm(c) === n)));
const colOf = (hdr, name, fallback) => {
  const i = hdr.findIndex(c => norm(c) === name);
  return i >= 0 ? i : fallback;
};

function parseClientes(rows) {
  const h = findHeader(rows, 'razon social', 'subcanal mkt');
  const hdr = h >= 0 ? rows[h] : [];
  // Fallback a las posiciones indicadas: D, F, AQ, AR
  const iN = colOf(hdr, 'cliente', 3), iR = colOf(hdr, 'razon social', 5), iF = colOf(hdr, 'nombre de fantasia', 6),
        iL = colOf(hdr, 'lista de precios', 42), iS = colOf(hdr, 'subcanal mkt', 43);
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const n = parseInt(r[iN], 10);
    if (!Number.isFinite(n) || !/^\d+$/.test(String(r[iN]).trim())) continue; // salta fila de tipos de dato
    out.push([n, String(r[iR] ?? '').trim(), String(r[iF] ?? '').trim(), parseNum(r[iL]), parseNum(r[iS])]);
  }
  return out;
}

function parseArticulos(rows) {
  const h = findHeader(rows, 'codigo', 'descripcion', 'unidad x bulto');
  if (h < 0) throw new Error('No encontré las columnas Código / Descripción / Unidad x Bulto.');
  const hdr = rows[h], iC = colOf(hdr, 'codigo', 0), iU = colOf(hdr, 'unidad x bulto', 2);
  const out = {};
  for (const r of rows.slice(h + 1)) {
    const c = String(r[iC]).trim(), u = parseNum(r[iU]);
    if (/^\d+$/.test(c) && u > 0) out[c] = u;
  }
  return out;
}

function parseLista(rows) {
  // El encabezado del código puede ser "Código", "Carga Código Chess", etc.
  const isCode = c => /c[oó]digo|^cod\b/i.test(String(c).trim());
  const h = rows.findIndex(r => r.some(isCode) && ['general', 'mayorista', 'farmacia'].every(n => r.some(c => norm(c) === n)));
  if (h < 0) throw new Error('No encontré las columnas Código / Descripción / General / Mayorista / Farmacia.');
  const hdr = rows[h];
  const iC = hdr.findIndex(isCode);
  const iD = colOf(hdr, 'descripcion', iC + 1), iG = colOf(hdr, 'general', iC + 2),
        iM = colOf(hdr, 'mayorista', iC + 3), iF = colOf(hdr, 'farmacia', iC + 4);
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const c = String(r[iC]).trim();
    if (!/^\d+$/.test(c)) continue;
    const p = i => { const v = parseNum(r[i]); return Number.isFinite(v) ? v : 0; };
    out.push([c, String(r[iD]).trim(), p(iG), p(iM), p(iF)]);
  }
  return out;
}

/* ================= buscadores ================= */
function searchProducts(q, by) {
  q = norm(q);
  if (!q) return [];
  if (by === 'code') {
    return catalogo.filter(i => i.c.startsWith(q))
      .sort((a, b) => (a.c === q ? -1 : b.c === q ? 1 : a.c.length - b.c.length || a.c.localeCompare(b.c))).slice(0, 8);
  }
  const t = q.split(/\s+/);
  return catalogo.filter(i => t.every(w => i._n.includes(w)))
    .sort((a, b) => (b._n.startsWith(q) - a._n.startsWith(q)) || a._n.length - b._n.length).slice(0, 8);
}

function searchClients(q) {
  q = norm(q);
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    return clientes.filter(c => String(c.n).startsWith(q))
      .sort((a, b) => (String(a.n) === q ? -1 : String(b.n) === q ? 1 : a.n - b.n)).slice(0, 8);
  }
  const t = q.split(/\s+/);
  return clientes.filter(c => t.every(w => c._n.includes(w)))
    .sort((a, b) => (b._n.startsWith(q) - a._n.startsWith(q)) || a._n.length - b._n.length).slice(0, 8);
}

function segmentOf(c) {
  if (c.l === 2) return 'm';
  if (c.l === 1 && c.s === 10) return 'f';
  return 'g';
}

/* ================= desplegable de sugerencias ================= */
const dd = document.createElement('div');
dd.id = 'dd'; dd.hidden = true; document.body.append(dd);
let ddS = null; // {input, results, idx, render, pick}

function ddPlace() {
  if (!ddS) return;
  const r = ddS.input.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 300), innerWidth - 16);
  dd.style.width = w + 'px';
  dd.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  dd.style.top = (r.bottom + 2) + 'px';
}
function ddHide() { dd.hidden = true; ddS = null; }
function ddShow(input, results, render, pick) {
  if (!results.length) return ddHide();
  ddS = { input, results, idx: 0, render, pick };
  dd.replaceChildren(...results.map((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    if (i === 0) b.className = 'on';
    render(b, it);
    b.addEventListener('pointerdown', e => { e.preventDefault(); const p = ddS; ddHide(); p.pick(it); });
    return b;
  }));
  dd.hidden = false;
  ddPlace();
}
function ddKey(e) {
  if (!ddS) return;
  const n = ddS.results.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    ddS.idx = (ddS.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    [...dd.children].forEach((b, i) => b.classList.toggle('on', i === ddS.idx));
    dd.children[ddS.idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const p = ddS; ddHide(); p.pick(p.results[p.idx]);
  } else if (e.key === 'Escape') ddHide();
}
addEventListener('resize', ddPlace);
addEventListener('scroll', ddPlace, true);
document.addEventListener('pointerdown', e => { if (ddS && e.target !== ddS.input && !dd.contains(e.target)) ddHide(); });

/* ================= cabecera: fecha, cliente, segmento ================= */
const elCli = $('#cliente'), elSeg = $('#segmento'), elInfo = $('#cliInfo'), elClear = $('#cliClear');
let cliente = null; // cliente elegido o null = "General"
$('#fecha').value = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const cliLabel = c => `${c.n} – ${c.rs}`;

function setCliente(c) {
  cliente = c;
  if (c) {
    elCli.value = cliLabel(c);
    elSeg.value = segmentOf(c);
    elSeg.disabled = true;
    elInfo.textContent = segmentOf(c) === 'f'
      ? 'Farmacia: todavía no hay lista de precios cargada, los productos aparecen "Sin precio".'
      : `Segmento automático · Lista ${c.l} · Subcanal ${c.s}`;
    elClear.hidden = false;
  } else {
    elCli.value = 'General';
    elSeg.disabled = false;
    elInfo.textContent = '';
    elClear.hidden = true;
  }
  rows.forEach(r => r.refresh());
  save();
}

elCli.addEventListener('focus', () => elCli.select());
elCli.addEventListener('input', () => {
  ddShow(elCli, searchClients(elCli.value), (b, c) => {
    b.innerHTML = '<span></span><b></b>';
    b.firstChild.textContent = c.n; b.lastChild.textContent = c.rs + (c.nf && c.nf !== c.rs ? ` (${c.nf})` : '');
  }, setCliente);
});
elCli.addEventListener('keydown', ddKey);
elCli.addEventListener('blur', () => { ddHide(); elCli.value = cliente ? cliLabel(cliente) : 'General'; });
elClear.addEventListener('click', () => setCliente(null));
elSeg.addEventListener('change', () => { rows.forEach(r => r.refresh()); save(); });

/* ================= filas del cotizador ================= */
const rows = [];
const elRows = $('#rows');
const qty = v => { const n = parseFloat(String(v).replace(',', '.')); return n > 0 ? n : 0; };

function addRow(init = {}) {
  const el = document.createElement('div');
  el.className = 'row row-grid';
  el.innerHTML = `
    <div class="c-code" data-l="Código"><input class="i-code" inputmode="numeric" autocomplete="off" aria-label="Código"></div>
    <div class="c-desc" data-l="Descripción"><input class="i-desc" autocomplete="off" aria-label="Código o descripción" placeholder="Código o nombre del producto"></div>
    <div data-l="Bultos"><input class="i-bul" type="number" inputmode="decimal" min="0" step="any" aria-label="Bultos"></div>
    <div data-l="Unidades"><input class="i-uni" type="number" inputmode="decimal" min="0" step="any" aria-label="Unidades"></div>
    <div class="c-bon" data-l="Bonif. %"><input class="i-bon" type="number" inputmode="decimal" min="0" max="100" step="any" placeholder="0" aria-label="Bonificación %"></div>
    <div class="c-price" data-l="Precio lista (fijo)"><span><span class="o-price">—</span><small class="o-unit"></small></span></div>
    <div class="c-total" data-l="Precio c/IVA"><b class="o-total">—</b></div>
    <div class="c-del"><button type="button" aria-label="Quitar fila">×</button></div>`;
  const q = s => $(s, el);
  const iCode = q('.i-code'), iDesc = q('.i-desc'), iBul = q('.i-bul'), iUni = q('.i-uni'), iBon = q('.i-bon');

  const r = {
    el, item: null,
    calc() {
      const it = this.item, seg = elSeg.value;
      if (!it || !(it[seg] > 0)) return { price: 0, total: 0, sub: 0, bon: 0 };
      const eq = qty(iBul.value) + qty(iUni.value) / it.u;      // bultos equivalentes
      const sub = round2(it[seg] * eq);
      const bon = round2(sub * Math.min(qty(iBon.value), 100) / 100);
      return { price: it[seg], sub, bon, total: round2((sub - bon) * (1 + IVA)) };
    },
    refresh() {
      const it = this.item, seg = elSeg.value, c = this.calc();
      el.classList.toggle('warn', !!it && !(it[seg] > 0));
      q('.o-price').textContent = it ? (it[seg] > 0 ? money(it[seg]) : 'Sin precio') : '—';
      q('.o-unit').textContent = it && it[seg] > 0
        ? `Unidad: ${money(it[seg] / it.u)} (${it.u} u/bulto${it.ug ? ' – estimado' : ''})` : '';
      q('.o-total').textContent = it && it[seg] > 0 ? money(c.total) : '—';
      totals(); save();
    }
  };

  const pick = it => {
    r.item = it; iCode.value = it.c; iDesc.value = it.d;
    r.refresh(); iBul.focus();
  };
  const renderItem = (b, it) => {
    b.innerHTML = '<span></span><b></b>';
    b.firstChild.textContent = it.c; b.lastChild.textContent = it.d;
  };

  iCode.addEventListener('input', () => {
    r.item = null; iDesc.value = ''; r.refresh();
    ddShow(iCode, searchProducts(iCode.value, 'code'), renderItem, pick);
  });
  // Un solo campo sirve para ambas búsquedas: si se escriben solo números busca por código, si no por nombre.
  const modo = v => (/^\d+$/.test(v.trim()) ? 'code' : 'desc');
  iDesc.addEventListener('input', () => {
    r.item = null; iCode.value = ''; r.refresh();
    ddShow(iDesc, searchProducts(iDesc.value, modo(iDesc.value)), renderItem, pick);
  });
  for (const i of [iCode, iDesc]) i.addEventListener('keydown', ddKey);
  iCode.addEventListener('blur', () => {
    ddHide();
    const m = catalogo.find(i => i.c === iCode.value.trim());
    if (m && r.item !== m) pick(m);
  });
  iDesc.addEventListener('blur', () => {
    ddHide();
    const m = !r.item && /^\d+$/.test(iDesc.value.trim()) && catalogo.find(i => i.c === iDesc.value.trim());
    if (m) pick(m);
  });
  for (const i of [iBul, iUni, iBon]) i.addEventListener('input', () => r.refresh());
  q('.c-del button').addEventListener('click', () => {
    rows.splice(rows.indexOf(r), 1); el.remove(); if (!rows.length) addRow(); totals(); save();
  });

  rows.push(r); elRows.append(el);
  if (init.c) {
    const it = catalogo.find(i => i.c === init.c);
    if (it) { r.item = it; iCode.value = it.c; iDesc.value = it.d; }
    iBul.value = init.b ?? ''; iUni.value = init.u ?? ''; iBon.value = init.bo ?? '';
    r.refresh();
  }
  r.inputs = { iBul, iUni, iBon };
  return r;
}

function totals() {
  let sub = 0, bon = 0, tot = 0;
  for (const r of rows) { const c = r.calc(); sub += c.sub; bon += c.bon; tot += c.total; }
  const neto = round2(sub - bon);
  $('#tSub').textContent = money(sub);
  $('#tBon').textContent = money(bon);
  $('#tNeto').textContent = money(neto);
  $('#tIva').textContent = money(round2(tot - neto));
  $('#tTot').textContent = money(tot);
  $('#bTot').textContent = money(tot);
  return { sub, bon, neto, tot };
}

$('#addRow').addEventListener('click', () => addRow().el.querySelector('.i-desc').focus());

/* ================= borrador (se conserva al cerrar la página) ================= */
function save() {
  try {
    localStorage.setItem('cot_draft', JSON.stringify({
      cli: cliente && cliente.n, seg: elSeg.value,
      rows: rows.filter(r => r.item).map(r => ({
        c: r.item.c, b: r.inputs.iBul.value, u: r.inputs.iUni.value, bo: r.inputs.iBon.value
      }))
    }));
  } catch { /* sin almacenamiento */ }
}
function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem('cot_draft') || 'null'); } catch { /* ignorar */ }
  rows.splice(0).forEach(r => r.el.remove());
  if (d) {
    const c = d.cli && clientes.find(x => x.n === d.cli);
    if (c) setCliente(c); else { setCliente(null); if (SEGS[d.seg]) elSeg.value = d.seg; }
    (d.rows || []).forEach(addRow);
  }
  if (!rows.length) addRow();
  totals();
}

$('#btnNew').addEventListener('click', () => {
  if (rows.some(r => r.item) && !confirm('¿Empezar una cotización nueva? Se borra la actual.')) return;
  rows.splice(0).forEach(r => r.el.remove());
  setCliente(null); elSeg.value = 'g'; addRow(); totals(); save();
});

/* ================= compartir ================= */
function quoteText() {
  const t = totals(), seg = elSeg.value;
  const lines = [
    `*Cotización* – ${$('#fecha').value}`,
    `Cliente: ${cliente ? cliLabel(cliente) : 'General'} (${SEGS[seg]})`, ''
  ];
  for (const r of rows.filter(r => r.item && r.item[seg] > 0)) {
    const b = qty(r.inputs.iBul.value), u = qty(r.inputs.iUni.value), bo = qty(r.inputs.iBon.value);
    const cant = [b && `${b} bulto${b === 1 ? '' : 's'}`, u && `${u} un.`].filter(Boolean).join(' + ') || 'sin cantidad';
    lines.push(`• ${r.item.d}\n   ${cant}${bo ? ` – bonif. ${bo}%` : ''} → ${money(r.calc().total)}`);
  }
  lines.push('', `Neto: ${money(t.neto)}`, `*Total con IVA: ${money(t.tot)}*`);
  return lines.join('\n');
}
const enviarWa = () => open('https://wa.me/?text=' + encodeURIComponent(quoteText()), '_blank');
$('#btnWa').addEventListener('click', enviarWa);
$('#btnWa2').addEventListener('click', enviarWa);
$('#btnCopy').addEventListener('click', async e => {
  try { await navigator.clipboard.writeText(quoteText()); e.target.textContent = '¡Copiado!'; }
  catch { e.target.textContent = 'No se pudo copiar'; }
  setTimeout(() => e.target.textContent = 'Copiar', 1500);
});
$('#btnPrint').addEventListener('click', () => print());

/* ================= pestañas y carga de datos ================= */
document.querySelectorAll('.top nav button[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.top nav button[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main[id^="tab-"]').forEach(m => { m.hidden = m.id !== 'tab-' + b.dataset.tab; });
  scrollTo(0, 0);
}));

// Apartado "Vendedores": menú de secciones y botón Volver
document.querySelectorAll('#vMenu .item[data-sub]').forEach(b => b.addEventListener('click', () => {
  $('#vMenu').hidden = true; $('#sub-' + b.dataset.sub).hidden = false; scrollTo(0, 0);
}));
document.querySelectorAll('.sub .volver').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.sub').forEach(s => { s.hidden = true; }); $('#vMenu').hidden = false;
}));

function renderStatus() {
  const provs = Object.entries(datos.listas).map(([p, l]) => `${p}: ${l.items.length} productos`).join(' · ');
  const base = catalogo.length || clientes.length
    ? `${clientes.length} clientes · ${Object.keys(datos.unidades).length} artículos con unidades por bulto · ${provs || 'sin listas de precios'}`
    : 'Todavía no hay datos cargados. Subí los archivos de abajo.';
  $('#status').textContent = base + (sinConexion ? ' · Sin conexión: usando los últimos datos guardados.' : '');
}
const msg = (t, err) => { const m = $('#msg'); m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); };

// Cada carga devuelve { texto, rpc: [función, argumentos] }: con Supabase se sube a la base (solo admin);
// en modo local queda guardado en este dispositivo.
async function onFile(input, handler) {
  const f = input.files[0];
  if (!f) return;
  try {
    msg('Procesando…');
    const res = await handler(await readSheet(f));
    if (sb) {
      msg('Subiendo a la base de datos…');
      const { error } = await sb.rpc(res.rpc[0], res.rpc[1]);
      if (error) throw new Error(error.message);
      await loadData(true);
    } else { await persist(); rebuild(); }
    msg(res.texto);
  } catch (e) {
    msg(e.message || String(e), true);
    if (sb) await loadData();
  }
  input.value = '';
}
$('#fClientes').addEventListener('change', e => onFile(e.target, rows_ => {
  datos.clientes = parseClientes(rows_);
  if (!datos.clientes.length) throw new Error('No encontré clientes en el archivo.');
  return {
    texto: `Padrón cargado: ${datos.clientes.length} clientes.`,
    rpc: ['reemplazar_clientes', { filas: datos.clientes.map(([n, razon, fantasia, lista, subcanal]) => ({ n, razon, fantasia, lista, subcanal })) }]
  };
}));
$('#fArticulos').addEventListener('change', e => onFile(e.target, rows_ => {
  datos.unidades = parseArticulos(rows_);
  return {
    texto: `Artículos cargados: ${Object.keys(datos.unidades).length} con unidades por bulto.`,
    rpc: ['reemplazar_articulos', { filas: Object.entries(datos.unidades).map(([codigo, unidades]) => ({ codigo, unidades })) }]
  };
}));
$('#fLista').addEventListener('change', e => onFile(e.target, rows_ => {
  const prov = $('#provNombre').value.trim() || 'Proveedor';
  const items = parseLista(rows_);
  if (!items.length) throw new Error('No encontré productos en la lista.');
  datos.listas[prov] = { generado: Date.now(), items };
  return {
    texto: `Lista de ${prov} cargada: ${items.length} productos.`,
    rpc: ['reemplazar_lista', { prov, filas: items.map(([codigo, descripcion, g, m, f]) => ({ codigo, descripcion, g, m, f })) }]
  };
}));

/* ================= inicio ================= */
(async () => { if (await initAuth()) { await loadData(); restore(); } })();
