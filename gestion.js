'use strict';

/* ===== Detalle (pide ingresar): objetivos del mes, rutas de los vendedores y calendario ===== */

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const primerDia = d => new Date(d.getFullYear(), d.getMonth(), 1);

// Crea un elemento con clase y texto (siempre textContent: los nombres vienen de Chess o de usuarios).
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const msgErr = e => /does not exist|could not find|schema cache/i.test(e.message || '')
  ? 'Todavía no están cargados los datos en la base (falta ejecutar el SQL y sincronizar).'
  : 'No se pudo cargar: ' + (e.message || e);

/* ---------- Objetivos del mes ---------- */
let mesObj = primerDia(new Date());

async function cargarObjetivos() {
  const tabla = $('#objTabla'), msg = $('#objMsg');
  $('#objMes').textContent = `${MESES[mesObj.getMonth()]} ${mesObj.getFullYear()}`;
  tabla.replaceChildren(); msg.textContent = ''; $('#objGuardar').hidden = true;
  if (!sb) { msg.textContent = 'Disponible al conectar con Supabase.'; return; }
  msg.textContent = 'Cargando…';
  const [cfg, obj] = await Promise.all([
    sb.from('vendedores_config').select('id,nombre_mostrar,pct_cobertura,orden').order('orden'),
    sb.from('objetivos').select('*').eq('periodo', iso(mesObj))
  ]);
  if (cfg.error || obj.error) { msg.className = 'msg err'; msg.textContent = msgErr(cfg.error || obj.error); return; }
  msg.className = 'msg'; msg.textContent = '';
  const porId = new Map(obj.data.map(o => [o.id_vendedor, o]));
  const cab = el('div', 'orow ocab'); cab.append(el('span', null, 'Vendedor'), el('span', null, 'Nestlé (kg)'), el('span', null, 'Purina + Hileret (kg)'), el('span', null, 'Total (kg)'), el('span', null, 'Clientes con compra'));
  tabla.append(cab);
  const campo = (cls, valor, etiqueta, placeholder) => {
    const i = el('input', cls); i.type = 'number'; i.min = '0'; i.inputMode = 'decimal'; i.value = valor ?? ''; i.disabled = !esJefe;
    if (placeholder) i.placeholder = placeholder;
    i.setAttribute('aria-label', etiqueta); return i;
  };
  for (const v of cfg.data.filter(x => !/^supervisor/i.test(x.nombre_mostrar))) {   // el supervisor no tiene objetivos individuales
    const o = porId.get(v.id) || {};
    const row = el('div', 'orow'); row.dataset.id = v.id;
    const tot = el('span', 'o-tot', '');
    const iN = campo('o-n', o.obj_kg_nestle, `Objetivo Nestlé de ${v.nombre_mostrar}`);
    const iO = campo('o-o', o.obj_kg_otros, `Objetivo Purina más Hileret de ${v.nombre_mostrar}`);
    const iC = campo('o-c', o.obj_clientes, `Objetivo de clientes de ${v.nombre_mostrar}`, `automático (${nf0.format(v.pct_cobertura)}%)`);
    const actualizar = () => { const s = (Number(iN.value) || 0) + (Number(iO.value) || 0); tot.textContent = s ? nf0.format(s) : '—'; };
    iN.addEventListener('input', actualizar); iO.addEventListener('input', actualizar); actualizar();
    row.append(el('span', 'o-nom', v.nombre_mostrar), iN, iO, tot, iC);
    tabla.append(row);
  }
  $('#objGuardar').hidden = !esJefe;
  $('#objSoloVer').hidden = esJefe;
  $('#objCopiar').hidden = !esJefe;
}

async function guardarObjetivos() {
  const msg = $('#objMsg'), periodo = iso(mesObj);
  const num = x => (x === '' ? null : Number(x));
  const filas = [...document.querySelectorAll('#objTabla .orow[data-id]')].map(row => ({
    periodo, id_vendedor: Number(row.dataset.id),
    obj_kg_nestle: num(row.querySelector('.o-n').value), obj_kg_otros: num(row.querySelector('.o-o').value),
    obj_kg: null,   // el total se calcula como Nestlé + Purina/Hileret
    obj_clientes: row.querySelector('.o-c').value === '' ? null : parseInt(row.querySelector('.o-c').value, 10)
  }));
  msg.className = 'msg'; msg.textContent = 'Guardando…';
  const { error } = await sb.from('objetivos').upsert(filas, { onConflict: 'periodo,id_vendedor' });
  if (error) { msg.className = 'msg err'; msg.textContent = 'No se pudo guardar: ' + error.message; return; }
  msg.textContent = 'Objetivos guardados. El resumen ya los usa.';
}

$('#objAnt').addEventListener('click', () => { mesObj = new Date(mesObj.getFullYear(), mesObj.getMonth() - 1, 1); cargarObjetivos(); });
$('#objSig').addEventListener('click', () => { mesObj = new Date(mesObj.getFullYear(), mesObj.getMonth() + 1, 1); cargarObjetivos(); });
$('#objGuardar').addEventListener('click', guardarObjetivos);

// Rellena el formulario con los objetivos del mes anterior (no guarda hasta tocar "Guardar objetivos")
async function copiarMesAnterior() {
  const msg = $('#objMsg'), ant = new Date(mesObj.getFullYear(), mesObj.getMonth() - 1, 1), nombre = MESES[ant.getMonth()];
  const { data, error } = await sb.from('objetivos').select('*').eq('periodo', iso(ant));
  if (error || !data.length) { msg.className = 'msg err'; msg.textContent = `No hay objetivos cargados en ${nombre}.`; return; }
  const porId = new Map(data.map(o => [o.id_vendedor, o]));
  document.querySelectorAll('#objTabla .orow[data-id]').forEach(row => {
    const o = porId.get(Number(row.dataset.id)); if (!o) return;
    const poner = (sel, v) => { const i = row.querySelector(sel); i.value = v ?? ''; i.dispatchEvent(new Event('input')); };
    poner('.o-n', o.obj_kg_nestle); poner('.o-o', o.obj_kg_otros); poner('.o-c', o.obj_clientes);
  });
  msg.className = 'msg'; msg.textContent = `Copiados de ${nombre}. Revisalos y tocá "Guardar objetivos".`;
}
$('#objCopiar').addEventListener('click', copiarMesAnterior);

/* ---------- Rutas de los vendedores: grilla de días × semanas con la cobertura de cada ruta ---------- */
// Códigos de día de Chess: 1 = domingo, 2 = lunes … 7 = sábado. periodicidad 1 = semanal; 2 o más = cada N semanas (semana = cuál).
const DIAS_SEMANA = [['2', 'LUN'], ['3', 'MAR'], ['4', 'MIÉ'], ['5', 'JUE'], ['6', 'VIE'], ['7', 'SÁB']];
let mesRut = primerDia(new Date());
const iniciales = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
const nClientes = n => `${nf0.format(n)} cliente${Number(n) === 1 ? '' : 's'}`;

async function cargarRutas() {
  const estado = $('#rutEstado'), cont = $('#rutLista'), det = $('#rutDetalle');
  cont.replaceChildren(); det.hidden = true;
  $('#rutMes').textContent = `${MESES[mesRut.getMonth()]} ${mesRut.getFullYear()}`;
  if (!sb) { estado.textContent = 'Disponible al conectar con Supabase.'; return; }
  estado.textContent = 'Cargando…';
  const fin = new Date(mesRut.getFullYear(), mesRut.getMonth() + 1, 0);
  const { data, error } = await sb.rpc('rutas_grilla', { desde: iso(mesRut), hasta: iso(fin) });
  if (error) { estado.textContent = msgErr(error); return; }
  if (!data?.length) { estado.textContent = 'Todavía no hay rutas cargadas desde Chess.'; return; }
  estado.textContent = 'Cada casillero es una ruta: número de ruta, cantidad de clientes y % que compró en el mes. Más oscuro = más cobertura. Tocá una ruta para ver el detalle.';

  const porVend = new Map();
  for (const r of data) {
    const k = r.vendedor || 'Sin vendedor asignado';
    if (!porVend.has(k)) porVend.set(k, []);
    porVend.get(k).push(r);
  }
  for (const [nombre, rutas] of porVend) {
    const cli = rutas.reduce((s, r) => s + Number(r.clientes), 0), comp = rutas.reduce((s, r) => s + Number(r.compraron), 0);
    const tarjeta = el('div', 'rv-card');
    const cab = el('div', 'rv-head');
    const tit = el('div'); tit.append(el('b', null, nombre), el('small', null, `${nClientes(cli)} · ${cli ? nf0.format(comp / cli * 100) : 0}% compraron`));
    cab.append(el('i', 'avatar-sm', iniciales(nombre)), tit);
    tarjeta.append(cab);

    const dias = (r) => String(r.dias_visita || '').split(/[,\s]+/).filter(Boolean);
    const claveFila = r => (Number(r.periodicidad) > 1 ? 's' + (Number(r.semana) || 1) : 'w');
    const maxSem = Math.max(0, ...rutas.map(r => (Number(r.periodicidad) > 1 ? Math.max(Number(r.semana) || 1, Number(r.periodicidad)) : 0)));
    const filas = [];
    for (let s = 1; s <= maxSem; s++) filas.push(['s' + s, `Sem. ${s}`]);
    if (rutas.some(r => claveFila(r) === 'w')) filas.push(['w', 'Semanal']);
    const usaSabado = rutas.some(r => dias(r).includes('7'));
    const columnas = DIAS_SEMANA.filter(([c]) => c !== '7' || usaSabado);

    const grid = el('div', 'rgrid'); grid.style.gridTemplateColumns = `56px repeat(${columnas.length}, minmax(0, 1fr))`;
    grid.append(el('span'));
    for (const [, d] of columnas) grid.append(el('span', 'rg-dia', d));
    for (const [fk, fn] of filas) {
      grid.append(el('span', 'rg-fila', fn));
      for (const [dc] of columnas) {
        const celda = el('div', 'rg-celda');
        for (const r of rutas.filter(x => claveFila(x) === fk && dias(x).includes(dc))) celda.append(botonRuta(r));
        grid.append(celda);
      }
    }
    tarjeta.append(grid);
    const sinDia = rutas.filter(r => !dias(r).some(d => columnas.some(([c]) => c === d)));
    if (sinDia.length) { const f = el('div', 'rg-sin'); f.append(el('small', null, 'Sin día de visita asignado:')); sinDia.forEach(r => f.append(botonRuta(r))); tarjeta.append(f); }
    cont.append(tarjeta);
  }
}

// Casillero de una ruta: color según cobertura (más oscuro = más clientes que compraron)
function botonRuta(r) {
  const c = Number(r.clientes), k = Number(r.compraron), cob = c ? k / c * 100 : 0;
  const b = el('button', 'rg-ruta ' + (!c ? 'vacia' : cob >= 65 ? 'alta' : cob >= 45 ? 'media' : 'baja')); b.type = 'button';
  b.title = `Ruta ${r.id_ruta} · ${nClientes(c)} · compraron ${k} · cobertura ${nf0.format(cob)}%`;
  b.append(el('small', null, String(r.id_ruta)), el('b', null, nf0.format(c)), el('em', null, c ? `${nf0.format(cob)}%` : '—'));
  b.addEventListener('click', () => detalleRuta(r, c, k, cob));
  return b;
}

async function detalleRuta(r, c, k, cob) {
  const det = $('#rutDetalle'); det.hidden = false; det.replaceChildren();
  det.append(el('h3', null, `${r.vendedor || ''} · ${r.descripcion || 'Ruta ' + r.id_ruta}`));
  const tabla = el('div', 'rd-datos');
  for (const [a, b] of [['Ruta', String(r.id_ruta)], ['Clientes', nf0.format(c)], ['Compraron', nf0.format(k)], ['No compradores', nf0.format(c - k)], ['Cobertura', `${nf0.format(cob)}%`]]) {
    const f = el('div'); f.append(el('span', null, a), el('b', null, b)); tabla.append(f);
  }
  det.append(tabla);
  const btn = el('button', 'btn ghost', 'Ver los clientes de esta ruta'); btn.type = 'button';
  const lista = el('div', 'ruta-cli'); lista.hidden = true;
  btn.addEventListener('click', async () => {
    lista.hidden = !lista.hidden;
    if (lista.hidden || lista.dataset.listo) return;
    lista.textContent = 'Cargando…';
    const { data: ids, error } = await sb.from('ruta_clientes').select('id_cliente')
      .match({ id_sucursal: r.id_sucursal, id_fuerza: r.id_fuerza, id_modo: r.id_modo, id_ruta: r.id_ruta });
    if (error) { lista.textContent = 'No se pudo cargar los clientes.'; return; }
    lista.dataset.listo = '1'; lista.replaceChildren();
    const porNum = new Map(clientes.map(x => [x.n, x]));   // clientes ya cargados en la app (padrón de Chess)
    for (const { id_cliente } of ids.sort((a, b) => a.id_cliente - b.id_cliente)) {
      const x = porNum.get(id_cliente);
      lista.append(el('div', 'cli-fila', `${id_cliente} – ${x ? x.rs : 'Cliente sin datos'}${x && x.nf && x.nf !== x.rs ? ' (' + x.nf + ')' : ''}`));
    }
  });
  det.append(btn, lista);
  det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#rutAnt').addEventListener('click', () => { mesRut = new Date(mesRut.getFullYear(), mesRut.getMonth() - 1, 1); cargarRutas(); });
$('#rutSig').addEventListener('click', () => { mesRut = new Date(mesRut.getFullYear(), mesRut.getMonth() + 1, 1); cargarRutas(); });
document.querySelectorAll('[data-sub="rut"]').forEach(b => b.addEventListener('click', cargarRutas));

/* ---------- Cuentas corrientes (Excel de gestión de cobranzas más reciente) ---------- */
const plata = n => `$ ${nf0.format(Math.round(n))}`;
const plataCorta = n => (Math.abs(n) >= 1e6 ? `$ ${nf1.format(n / 1e6)} M` : Math.abs(n) >= 1e3 ? `$ ${nf0.format(n / 1e3)} mil` : plata(n));
const EDADES = [['0–30 días', 0, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['91–180', 91, 180], ['Más de 180', 181, 1e9]];
const COLOR_EDAD = ['#f2c96b', '#eb9a3b', '#dc6a2c', '#b42318', '#7a1010'];

async function cargarCuentas() {
  const estado = $('#ccEstado'), kp = $('#ccKpis'), lista = $('#ccLista');
  kp.replaceChildren(); lista.replaceChildren();
  if (!sb) { estado.textContent = 'Disponible al conectar con Supabase.'; return; }
  estado.textContent = 'Cargando…';
  let filas, meta, cfg, rutas, rcli, ocultas;
  try {
    [filas, meta, cfg, rutas, rcli, ocultas] = await Promise.all([
      fetchAll('cuentas_corrientes', '*', ['tipo', 'codigo']),
      sb.from('cuentas_meta').select('*').maybeSingle().then(r => { if (r.error) throw r.error; return r.data; }),
      sb.from('vendedores_config').select('id,nombre_mostrar').then(r => r.data || []),
      sb.from('rutas').select('id_sucursal,id_fuerza,id_modo,id_ruta,id_vendedor,dias_visita,periodicidad,semana,anulada').then(r => r.data || []),
      fetchAll('ruta_clientes', 'id_sucursal,id_fuerza,id_modo,id_ruta,id_cliente', ['id_ruta', 'id_cliente']),
      sb.from('rutas_ocultas').select('id_ruta').then(r => (r.data || []).map(x => x.id_ruta))
    ]);
  } catch (e) { estado.textContent = msgErr(e); return; }
  if (!filas.length) { estado.textContent = 'No hay cuentas corrientes para mostrar. Si todavía no se cargó el Excel, avisá al administrador; si sos vendedor, el administrador tiene que asignarte tu código de vendedor.'; return; }
  const fecha = meta?.fecha_archivo ? new Date(meta.fecha_archivo + 'T12:00:00').toLocaleDateString('es-AR') : '—';
  estado.textContent = `Archivo ${meta?.archivo || ''} · datos al ${fecha}. Los clientes están ordenados según el día y la semana de su ruta de visita.`;

  const nombreDe = new Map(cfg.map(v => [v.id, v.nombre_mostrar]));
  const titulo = s => String(s || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dinero = n => (n < 0 ? '-' : '') + '$ ' + nf2.format(Math.abs(n));

  // Ruta de cada cliente (día y semana de visita), sin las rutas ocultas
  const vivas = new Map(rutas.filter(r => !r.anulada && !ocultas.includes(r.id_ruta)).map(r => [[r.id_sucursal, r.id_fuerza, r.id_modo, r.id_ruta].join('|'), r]));
  const rutasDe = new Map();
  for (const rc of rcli) { const r = vivas.get([rc.id_sucursal, rc.id_fuerza, rc.id_modo, rc.id_ruta].join('|')); if (r) (rutasDe.get(rc.id_cliente) || rutasDe.set(rc.id_cliente, []).get(rc.id_cliente)).push(r); }
  const diaDe = r => String(r.dias_visita || '').split(/[,\s]+/).find(d => /^[2-7]$/.test(d)) || null;
  const items = [];
  for (const f of filas) {
    const saldo = Number(f.saldo) || 0, venc = Number(f.vencido) || 0;
    if (saldo === 0 && venc === 0) continue;
    const id = Number(f.id_vendedor) || 0;
    const prop = (rutasDe.get(f.codigo) || []).filter(r => f.tipo === 'CL');
    const r = prop.find(x => x.id_vendedor === id && diaDe(x)) || prop.find(diaDe) || null;
    const sem = !r ? null : Number(r.periodicidad) > 1 ? 's' + (Number(r.semana) || 1) : 'w';
    items.push({ f, ruta: r, saldo, venc, atraso: Number(f.antiguedad) || 0, vend: id ? (nombreDe.get(id) || titulo(f.vendedor)) : 'Sin vendedor', idv: id, dia: r ? diaDe(r) : null, sem });
  }
  const NOM_DIA = { 2: 'Lunes', 3: 'Martes', 4: 'Miércoles', 5: 'Jueves', 6: 'Viernes', 7: 'Sábado' };
  const vendedores = [...new Set(items.map(i => i.vend))].sort((a, b) => items.filter(i => i.vend === b).reduce((s, i) => s + Math.max(i.saldo, 0), 0) - items.filter(i => i.vend === a).reduce((s, i) => s + Math.max(i.saldo, 0), 0));
  const hoyDia = String(new Date().getDay() + 1);   // 2 = lunes … 6 = viernes (código de Chess)
  const E = { vend: vendedores.length === 1 ? vendedores[0] : 'todos', dia: null, sem: null };

  const nomSem = k => (k === 'w' ? 'Semanal' : 'Semana ' + k.slice(1));
  const ordSem = k => (k === 'w' ? 0 : Number(k.slice(1)));

  function pintar() {
    const base = items.filter(i => E.vend === 'todos' || i.vend === E.vend);
    // Indicadores del vendedor elegido
    const T = { deuda: 0, venc: 0, favor: 0, cli: 0, m90: 0 };
    for (const i of base) { if (i.saldo > 0) { T.deuda += i.saldo; T.cli++; } else T.favor += -i.saldo; const v = Math.min(Math.max(i.venc, 0), Math.max(i.saldo, 0)); T.venc += v; if (v > 0 && i.atraso > 90) T.m90 += v; }
    kp.replaceChildren();
    const kpi = (et, val, sub, tono) => { const c = el('div', 'kcard sin-medidor' + (tono ? ' ' + tono : '')); c.append(el('small', 'k-et', et), el('div', 'k-val', val), el('div', 'k-lin', sub)); return c; };
    kp.append(
      kpi('Deuda total', plataCorta(T.deuda), `${nf0.format(T.cli)} clientes con deuda`),
      kpi('Vencida', plataCorta(T.venc), `${nf0.format(T.deuda ? T.venc / T.deuda * 100 : 0)}% de la deuda`, 'rojo'),
      kpi('No vencida', plataCorta(T.deuda - T.venc), 'Todavía en plazo'),
      kpi('Vencida hace más de 90 días', plataCorta(T.m90), `${nf0.format(T.venc ? T.m90 / T.venc * 100 : 0)}% de lo vencido`, 'rojo'),
      kpi('Saldos a favor', plataCorta(T.favor), 'Clientes con crédito'));

    lista.replaceChildren();
    // Selector de vendedor (solo si se ve más de uno)
    if (vendedores.length > 1) {
      const vb = el('div', 'cc-vend');
      for (const v of ['todos', ...vendedores]) {
        const b = el('button', 'cc-chip' + (E.vend === v ? ' on' : ''), v === 'todos' ? 'Todos' : v); b.type = 'button';
        b.addEventListener('click', () => { E.vend = v; E.dia = null; E.sem = null; pintar(); });
        vb.append(b);
      }
      lista.append(vb);
    }
    // Pestañas de día (cantidad de clientes con cuenta)
    const dias = [...new Set(base.map(i => i.dia).filter(Boolean))].sort();
    const hayRuta = base.some(i => !i.dia);
    // Jefe/supervisor (ve a varios vendedores): día = todos o uno, combinable con el vendedor; sin pestañas de semana.
    const multi = vendedores.length > 1;
    const tabsDia = [...(multi ? [['todos', 'Todos los días']] : []), ...dias.map(d => [d, NOM_DIA[d]]), ...(hayRuta ? [['x', 'Sin ruta']] : [])];
    if (!tabsDia.length) { lista.append(el('p', 'hint', 'No hay cuentas para mostrar.')); return; }
    if (!tabsDia.some(([d]) => d === E.dia)) E.dia = multi ? 'todos' : (tabsDia.find(([d]) => d === hoyDia) || tabsDia[0])[0];
    const barraDia = el('div', 'cc-tabs');
    for (const [d, n] of tabsDia) {
      const c = base.filter(i => (d === 'todos' ? true : d === 'x' ? !i.dia : i.dia === d)).length;
      const b = el('button', 'cc-tab' + (E.dia === d ? ' on' : '')); b.type = 'button'; b.append(n + ' ', el('small', null, String(c)));
      b.addEventListener('click', () => { E.dia = d; E.sem = null; pintar(); });
      barraDia.append(b);
    }
    lista.append(barraDia);

    const delDia = base.filter(i => (E.dia === 'todos' ? true : E.dia === 'x' ? !i.dia : i.dia === E.dia));
    const sems = [...new Set(delDia.map(i => i.sem).filter(Boolean))].sort((a, b) => ordSem(a) - ordSem(b));
    if (!multi && E.dia !== 'x' && sems.length) {
      if (!sems.includes(E.sem)) E.sem = sems[0];
      const barraSem = el('div', 'cc-sems');
      for (const s of sems) {
        const b = el('button', 'cc-sem' + (E.sem === s ? ' on' : '')); b.type = 'button'; b.append(nomSem(s) + ' ', el('small', null, String(delDia.filter(i => i.sem === s).length)));
        b.addEventListener('click', () => { E.sem = s; pintar(); });
        barraSem.append(b);
      }
      lista.append(barraSem);
    }
    const grupo = (multi || E.dia === 'x' ? delDia : delDia.filter(i => i.sem === E.sem)).sort((a, b) => b.saldo - a.saldo);
    const sumS = grupo.reduce((s, i) => s + i.saldo, 0), sumV = grupo.reduce((s, i) => s + i.venc, 0);
    const cab = el('div', 'cc-grupo');
    const quien = E.vend === 'todos' ? 'todos los vendedores' : E.vend;
    cab.append(el('h3', null, multi ? `${E.dia === 'todos' ? 'Todos los días' : E.dia === 'x' ? 'Sin ruta de visita' : NOM_DIA[E.dia]} · ${quien}` : E.dia === 'x' ? 'Sin ruta de visita' : `${NOM_DIA[E.dia]} · ${nomSem(E.sem)}`), el('span', null, `${nf0.format(grupo.length)} cliente${grupo.length === 1 ? '' : 's'}`));
    const t1 = el('span', 'cc-sum'); t1.append('Deuda total ', el('b', null, dinero(sumS)));
    const t2 = el('span', 'cc-sum'); t2.append('Vencida ', el('b', 'rojo', dinero(sumV)));
    cab.append(t1, t2); lista.append(cab);

    for (const i of grupo) {
      const c = el('div', 'cc-cliente'), izq = el('div', 'cc-cl-izq');
      izq.append(el('b', null, i.f.nombre));
      const tags = el('div', 'cc-tags');
      tags.append(el('span', 'tag', '#' + i.f.codigo));
      if (i.saldo < 0) tags.append(el('span', 'tag ok', 'saldo a favor'));
      else if (i.venc > 0) tags.append(el('span', 'tag mal', `${nf0.format(i.atraso)} días de atraso`));
      else tags.append(el('span', 'tag', 'en plazo'));
      // Ruta de visita del cliente y número de vendedor
      tags.append(el('span', 'tag', i.ruta ? `Ruta ${i.ruta.id_ruta}${i.dia ? ' · ' + NOM_DIA[i.dia] : ''}${i.sem && i.sem !== 'w' ? ' · ' + nomSem(i.sem) : ''}` : 'Sin ruta'));
      if (multi) tags.append(el('span', 'tag', i.idv ? `Vendedor ${i.idv} · ${i.vend}` : i.vend));
      izq.append(tags);
      const d1 = el('div', 'cc-monto'); d1.append(el('small', null, 'Deuda total'), el('b', i.saldo < 0 ? 'ok' : '', dinero(i.saldo)));
      const d2 = el('div', 'cc-monto'); d2.append(el('small', null, 'Vencida'), el('b', i.venc > 0 ? 'rojo' : '', dinero(i.venc)));
      c.append(izq, d1, d2); lista.append(c);
    }
  }
  pintar();
}
document.querySelectorAll('[data-sub="cc"]').forEach(b => b.addEventListener('click', cargarCuentas));

/* ---------- Calendario (Google Calendar) ---------- */
// Los calendarios se configuran en config.js (calendarios: [{ id, color }]). Se muestra el calendario de Google embebido:
// cada usuario lo ve si tiene permiso sobre ese calendario (ver "¿No ves los eventos?" en la solapa).
function montarCalendario() {
  const cals = (window.APP_CONFIG || {}).calendarios || [], f = $('#calFrame');
  if (!f || f.dataset.listo || !cals.length) return;
  const p = new URLSearchParams({ ctz: 'America/Argentina/Buenos_Aires', hl: 'es', wkst: '2', mode: innerWidth < 760 ? 'AGENDA' : 'MONTH', showTitle: '0', showPrint: '0', showTz: '0', showCalendars: '0', showTabs: '1' });
  let url = 'https://calendar.google.com/calendar/embed?' + p.toString();
  for (const c of cals) url += '&src=' + encodeURIComponent(c.id) + '&color=' + encodeURIComponent(c.color || '#14306f');
  f.src = url; f.dataset.listo = '1';
}

// Cada solapa carga lo suyo al abrirse
document.addEventListener('tabcambio', e => {
  if (e.detail === 'cal') montarCalendario();
  if (e.detail === 'obj') cargarObjetivos();
});
