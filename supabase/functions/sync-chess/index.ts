// Sincroniza Chess ERP → Supabase (clientes y listas de precios General y Mayorista).
// Se ejecuta sola con pg_cron (ver supabase/cron.sql). Solo guarda en la base si los datos cambiaron.
//
// Secretos necesarios (Edge Functions → Secrets):
//   CHESS_BASE_URL  https://fitnut.chesserp.com/AR1175/web/api/chess/v1
//   CHESS_USER      usuario de Chess con permiso de API
//   CHESS_PASS      contraseña de ese usuario
//   SYNC_TOKEN      texto largo inventado por vos; el cron lo manda en el header x-sync-token
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.
//
// Se despliega con "Verify JWT" activado; además exige el header x-sync-token.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MAX_LOTES = 100;
const LISTAS: any = { g: 1, m: 2 }; // General = lista 1, Mayorista/Distribuidora = lista 2. Farmacia: pendiente.

/* ---------- utilidades puras ---------- */

// La API envuelve los datos en nodos (ej. dsXxx → eXxx). Devuelve el primer arreglo de objetos, buscando por niveles.
export function rowsOf(json: any): any[] {
  const cola: any[] = [json];
  while (cola.length) {
    const x = cola.shift();
    if (Array.isArray(x)) {
      if (x.length === 0) continue;
      if (typeof x[0] === 'object' && x[0] !== null) return x;
      continue;
    }
    if (x && typeof x === 'object') cola.push(...Object.values(x));
  }
  return [];
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v: any) => (v == null ? '' : String(v).trim());

export function mapCliente(c: any) {
  // La API real manda los datos de nombre en "eClialias" (la documentación dice "clienteAlias").
  const lista = c.eClialias ?? c.clienteAlias;
  const alias: any[] = Array.isArray(lista) ? lista : [];
  const a = alias.find((x) => x.idAlias === c.idAliasVigente) ?? alias[0] ?? {};
  const personal = [a.apellidoPaterno, a.apellidoMaterno, a.nombres].map(txt).filter(Boolean).join(' ');
  const fantasia = txt(a.fantasiaSocial);
  return {
    n: num(c.idCliente),
    razon: txt(a.razonSocial) || personal || fantasia || `Cliente ${c.idCliente}`,
    fantasia,
    lista: num(c.idListaPrecio),
    subcanal: num(c.idSubcanalMkt),
    fecha_alta: txt(c.fechaAlta).slice(0, 10),   // para contar "altas" del mes
  };
}

// Devuelve { codigo, descripcion, precio, unidades } o null si el artículo no se vende (anulado o sin precio).
// La API real devuelve Precio_Base / id_articulo / des_articulo / Unidades_Bulto / Anulado (la documentación dice otros nombres: se aceptan ambos).
// Precio_Base = precio por bulto SIN IVA (Precio_Final es con IVA).
export function mapPrecio(p: any) {
  const anulado = p.Anulado ?? p.anulado;
  if (anulado === true || anulado === 'SI' || anulado === 'true') return null;
  const precio = num(p.Precio_Base ?? p.precio);
  if (!precio || precio <= 0) return null;
  return {
    codigo: String(p.id_articulo ?? p.codart),
    descripcion: txt(p.des_articulo ?? p.descrip),
    precio,
    unidades: num(p.Unidades_Bulto ?? p.resto),
  };
}

async function sha256(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- cliente de la API de Chess ---------- */

class Chess {
  base: string; user: string; pass: string; cookie = '';
  constructor(base: string, user: string, pass: string) { this.base = base.replace(/\/+$/, ''); this.user = user; this.pass = pass; }

  async login() {
    const r = await fetch(`${this.base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: this.user, password: this.pass }),
    });
    if (!r.ok) throw new Error(`Login en Chess falló (HTTP ${r.status}). Revisá CHESS_USER y CHESS_PASS.`);
    const j = await r.json();
    if (!j.sessionId) throw new Error('Chess no devolvió sessionId en el login.');
    this.cookie = j.sessionId;
  }

  async get(ruta: string, params: Record<string, string | number | boolean> = {}) {
    const url = new URL(`${this.base}${ruta}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let intento = 0; intento < 2; intento++) {
      const r = await fetch(url, { headers: { Cookie: this.cookie, Accept: 'application/json' } });
      if (r.status === 401 && intento === 0) { await this.login(); continue; } // sesión vencida
      if (!r.ok) throw new Error(`Chess ${ruta} respondió HTTP ${r.status}`);
      return await r.json();
    }
  }

  // Trae todos los lotes (nroLote=1,2,3…) hasta que no aparezcan filas nuevas.
  async todos(ruta: string, clave: (x: any) => string, params: Record<string, string | number | boolean> = {}) {
    const vistos = new Map<string, any>();
    for (let lote = 1; lote <= MAX_LOTES; lote++) {
      const filas = rowsOf(await this.get(ruta, { ...params, nroLote: lote }));
      let nuevas = 0;
      for (const f of filas) { const k = clave(f); if (!vistos.has(k)) { vistos.set(k, f); nuevas++; } }
      if (nuevas === 0) break;
    }
    return [...vistos.values()];
  }
}

/* ---------- guardado (solo si cambió) ---------- */

async function guardarSiCambio(db: any, clave: string, filas: any[], rpc: string, args: any) {
  const hash = await sha256(JSON.stringify(filas));
  const { data: prev } = await db.from('sync_estado').select('hash').eq('clave', clave).maybeSingle();
  const ahora = new Date().toISOString();
  if (prev?.hash === hash) {
    await db.from('sync_estado').update({ ultimo_intento: ahora, error: null }).eq('clave', clave);
    return 'sin cambios';
  }
  const { error } = await db.rpc(rpc, args);
  if (error) throw new Error(`${rpc}: ${error.message}`);
  await db.from('sync_estado').upsert({ clave, hash, filas: filas.length, actualizado: ahora, ultimo_intento: ahora, error: null });
  return 'actualizado';
}

/* ---------- tareas ---------- */

async function syncClientes(chess: Chess, db: any) {
  const crudos = await chess.todos('/clientes/', (c) => `${c.idSucursal}-${c.idCliente}`, { anulado: false });
  const filas = crudos
    .filter((c) => c.anulado !== true && c.anulado !== 'SI')
    .map(mapCliente).filter((c) => c.n != null)
    .sort((a, b) => a.n! - b.n!);
  // si la API repite un cliente en varias sucursales, queda el primero
  const unicos = [...new Map(filas.map((f) => [f.n, f])).values()];
  if (unicos.length === 0) throw new Error('Chess devolvió 0 clientes: no se pisa la base.');
  return { cantidad: unicos.length, estado: await guardarSiCambio(db, 'clientes', unicos, 'reemplazar_clientes', { filas: unicos }) };
}

async function syncPrecios(chess: Chess, db: any) {
  const porCodigo = new Map<string, any>();
  const unidades = new Map<string, number>();
  for (const [seg, lista] of Object.entries(LISTAS)) {
    const crudos = rowsOf(await chess.get('/listaPrecios/', { Lista: lista as number }));
    for (const p of crudos) {
      const m = mapPrecio(p);
      if (!m) continue;
      const fila = porCodigo.get(m.codigo) ?? { codigo: m.codigo, descripcion: m.descripcion, g: 0, m: 0, f: 0 };
      fila[seg] = m.precio;
      porCodigo.set(m.codigo, fila);
      if (m.unidades && m.unidades > 0) unidades.set(m.codigo, m.unidades);
    }
  }
  const filas = [...porCodigo.values()].sort((a, b) => Number(a.codigo) - Number(b.codigo));
  if (filas.length === 0) throw new Error('Chess devolvió 0 precios: no se pisa la base.');
  const art = [...unidades.entries()].map(([codigo, u]) => ({ codigo, unidades: u }));
  const e1 = await guardarSiCambio(db, 'precios', filas, 'reemplazar_lista', { prov: 'Chess', filas });
  const e2 = await guardarSiCambio(db, 'articulos', art, 'reemplazar_articulos', { filas: art });
  return { cantidad: filas.length, estado: e1, articulos: e2 };
}

/* ---------- gestión de vendedores: vendedores, rutas y ventas ---------- */

export function mapVendedor(p: any) {
  const nombre = txt(p.desPersonal) || [p.apellido, p.nombres].map(txt).filter(Boolean).join(' ');
  return { id: num(p.idPersonal), nombre: nombre || `Personal ${p.idPersonal}`, cargo: txt(p.cargo), id_superior: num(p.idPersonalSuperior) };
}

// Fecha de hoy en Argentina (UTC-3) como YYYY-MM-DD
const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

// Rutas vigentes hoy (la API trae también versiones vencidas de cada ruta).
export function rutasVigentes(crudas: any[], hoy: string) {
  const mejor = new Map<string, any>();
  for (const r of crudas) {
    if (r.anulado === true || r.anulado === 'SI') continue;
    const desde = txt(r.fechaDesde).slice(0, 10), hasta = txt(r.fechaHasta).slice(0, 10);
    if (desde && desde > hoy) continue;
    if (hasta && hasta < hoy) continue;
    const k = [r.idSucursal, r.idFuerzaVentas, r.idModoAtencion, r.idRuta].join('|');
    const prev = mejor.get(k);
    if (!prev || desde > txt(prev.fechaDesde).slice(0, 10)) mejor.set(k, r);
  }
  const rutas: any[] = [], clientes: any[] = [];
  for (const r of mejor.values()) {
    const base = { id_sucursal: num(r.idSucursal), id_fuerza: num(r.idFuerzaVentas), id_modo: txt(r.idModoAtencion), id_ruta: num(r.idRuta) };
    rutas.push({ ...base, descripcion: txt(r.desRuta), id_vendedor: num(r.idPersonal), dias_visita: txt(r.diasVisita), anulada: false });
    for (const c of Array.isArray(r.eClientesRutas) ? r.eClientesRutas : []) if (c.idCliente != null) clientes.push({ ...base, id_cliente: num(c.idCliente) });
  }
  return { rutas, clientes };
}

// Agrupa las líneas de comprobantes por día + vendedor + cliente + proveedor. Las notas de crédito ya vienen en negativo.
// bultos = cantidadesTotal (bultos con fracción), importe = subtotalNeto (sin IVA, ya bonificado),
// kg = bultos × peso por bulto del artículo (pesos: idArticulo → kg por bulto, de /articulos/). Si no hay peso, usa pesoTotal de la línea.
export function agruparVentas(lineas: any[], pesos: Map<string, number> = new Map()) {
  const por = new Map<string, any>();
  const docs = new Map<string, Set<string>>();
  let sinPeso = 0;
  for (const l of lineas) {
    if (l.anulado === true || l.anulado === 'SI') continue;
    const fecha = txt(l.fechaComprobate).slice(0, 10), v = num(l.idVendedor), c = num(l.idCliente);
    if (!fecha || v == null || c == null) continue;
    const proveedor = txt(l.proveedor);
    const k = `${fecha}|${v}|${c}|${proveedor}`;
    const f = por.get(k) ?? { fecha, id_vendedor: v, id_cliente: c, proveedor, comprobantes: 0, bultos: 0, kg: 0, importe: 0 };
    const bultos = num(l.cantidadesTotal) ?? 0;
    const pesoBulto = pesos.get(String(l.idArticulo));
    let kg = pesoBulto ? bultos * pesoBulto : (num(l.pesoTotal) ?? 0);
    if (!pesoBulto && !(num(l.pesoTotal)) && bultos !== 0) sinPeso++;
    f.bultos += bultos;
    f.kg += kg;
    f.importe += num(l.subtotalNeto) ?? 0;
    const d = docs.get(k) ?? new Set<string>();
    d.add([l.idDocumento, l.letra, l.serie, l.nrodoc].join('-'));
    docs.set(k, d); por.set(k, f);
  }
  const filas = [...por.entries()]
    .map(([k, f]) => ({ ...f, comprobantes: docs.get(k)!.size, bultos: Math.round(f.bultos * 1000) / 1000, kg: Math.round(f.kg * 100) / 100, importe: Math.round(f.importe * 100) / 100 }))
    .sort((a, b) => `${a.fecha}|${a.id_vendedor}|${a.id_cliente}|${a.proveedor}`.localeCompare(`${b.fecha}|${b.id_vendedor}|${b.id_cliente}|${b.proveedor}`));
  return Object.assign(filas, { sinPeso });
}

async function syncGestion(chess: Chess, db: any) {
  const vend = rowsOf(await chess.get('/personalComercial/')).map(mapVendedor).filter((v) => v.id != null);
  if (!vend.length) throw new Error('Chess devolvió 0 vendedores: no se pisa la base.');
  const e1 = await guardarSiCambio(db, 'vendedores', vend, 'reemplazar_vendedores', { filas: vend });
  const { rutas, clientes } = rutasVigentes(rowsOf(await chess.get('/rutasVenta/')), hoyAR());
  if (!rutas.length) throw new Error('Chess devolvió 0 rutas vigentes: no se pisa la base.');
  const e2 = await guardarSiCambio(db, 'rutas', [rutas, clientes], 'reemplazar_rutas', { rutas_json: rutas, clientes_json: clientes });
  return { vendedores: vend.length, rutas: rutas.length, clientesEnRutas: clientes.length, estado: [e1, e2] };
}

// Ventas del mes en curso (o del mes anterior con ?mes=anterior): trae las líneas de comprobantes y las agrupa.
async function syncVentas(chess: Chess, db: any, anterior: boolean) {
  const hoy = hoyAR();
  const [y, m] = hoy.split('-').map(Number);
  const ini = anterior ? new Date(Date.UTC(y, m - 2, 1)) : new Date(Date.UTC(y, m - 1, 1));
  const fin = anterior ? new Date(Date.UTC(y, m - 1, 0)) : null;
  const desde = ini.toISOString().slice(0, 10), hasta = fin ? fin.toISOString().slice(0, 10) : hoy;
  // Peso por bulto de cada artículo (para pasar bultos a kilos)
  const arts = await chess.todos('/articulos/', (a) => String(a.idArticulo));
  const pesos = new Map<string, number>();
  for (const a of arts) { const p = num(a.pesoBulto); if (p && p > 0) pesos.set(String(a.idArticulo), p); }
  const crudas = await chess.todos('/ventas/', (l) => [l.idEmpresa, l.idDocumento, l.letra, l.serie, l.nrodoc, l.idLinea].join('|'), { fechaDesde: desde, fechaHasta: hasta, detallado: true });
  const filas = agruparVentas(crudas, pesos);
  if (!filas.length) throw new Error(`Chess devolvió 0 ventas entre ${desde} y ${hasta}: no se pisa la base.`);
  const estado = await guardarSiCambio(db, `ventas_${desde.slice(0, 7)}`, filas, 'reemplazar_ventas', { desde, hasta, filas });
  const proveedores = [...new Set(filas.map((f: any) => f.proveedor))];
  return { desde, hasta, lineas: crudas.length, filas: filas.length, articulosConPeso: pesos.size, lineasSinPeso: filas.sinPeso, proveedores, estado };
}

/* ---------- entrada ---------- */

Deno.serve(async (req: Request) => {
  const token = Deno.env.get('SYNC_TOKEN');
  if (!token || req.headers.get('x-sync-token') !== token) return new Response('No autorizado', { status: 401 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const chess = new Chess(Deno.env.get('CHESS_BASE_URL')!, Deno.env.get('CHESS_USER')!, Deno.env.get('CHESS_PASS')!);
  const url = new URL(req.url);
  const solo = url.searchParams.get('tarea'); // ?tarea=clientes | precios (por defecto, ambas)

  // ?probe=/clientes/ → devuelve la forma cruda de la primera página, para verificar la API (no guarda nada)
  const probe = url.searchParams.get('probe');
  try {
    await chess.login();
    if (probe) {
      // el resto de los parámetros de la URL se reenvían a Chess (ej. &Lista=1 o &nroLote=1)
      const extra = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'probe' && k !== 'tarea'));
      const j = await chess.get(probe, extra);
      const filas = rowsOf(j);
      return Response.json({ filas: filas.length, claves: Object.keys(j ?? {}), primera: filas[0] ?? null });
    }
    const out: any = {};
    if (!solo || solo === 'clientes') out.clientes = await syncClientes(chess, db);
    if (!solo || solo === 'precios') out.precios = await syncPrecios(chess, db);
    if (solo === 'gestion') out.gestion = await syncGestion(chess, db);
    if (solo === 'ventas') out.ventas = await syncVentas(chess, db, url.searchParams.get('mes') === 'anterior');
    return Response.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('sync_estado').upsert({ clave: 'ultimo_error', error: msg, ultimo_intento: new Date().toISOString() });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
