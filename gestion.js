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
  for (const v of cfg.data) {
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
  let filas, meta, cfg;
  try {
    [filas, meta, cfg] = await Promise.all([
      fetchAll('cuentas_corrientes', '*', ['tipo', 'codigo']),
      sb.from('cuentas_meta').select('*').maybeSingle().then(r => { if (r.error) throw r.error; return r.data; }),
      sb.from('vendedores_config').select('id,nombre_mostrar').then(r => r.data || [])
    ]);
  } catch (e) { estado.textContent = msgErr(e); return; }
  if (!filas.length) { estado.textContent = 'No hay cuentas corrientes para mostrar. Si todavía no se cargó el Excel, avisá al administrador; si sos vendedor, el administrador tiene que asignarte tu código de vendedor.'; return; }
  const fecha = meta?.fecha_archivo ? new Date(meta.fecha_archivo + 'T12:00:00').toLocaleDateString('es-AR') : '—';
  estado.textContent = `Archivo ${meta?.archivo || ''} · datos al ${fecha}. Deuda = saldo de clientes que deben; el saldo a favor se muestra aparte.`;

  const nombreDe = new Map(cfg.map(v => [v.id, v.nombre_mostrar]));
  const titulo = s => String(s || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const grupos = new Map();
  const T = { deuda: 0, venc: 0, favor: 0, clientes: 0, mas90: 0 };
  for (const f of filas) {
    const saldo = Number(f.saldo) || 0, deuda = Math.max(saldo, 0), venc = Math.min(Math.max(Number(f.vencido) || 0, 0), deuda);
    const id = Number(f.id_vendedor) || 0;
    const nom = id ? (nombreDe.get(id) || titulo(f.vendedor)) : 'Sin vendedor (cuentas CJ)';
    if (!grupos.has(nom)) grupos.set(nom, { nombre: nom, deuda: 0, venc: 0, favor: 0, clientes: 0, conVenc: 0, edades: EDADES.map(() => 0), filas: [] });
    const g = grupos.get(nom);
    g.filas.push(f); g.deuda += deuda; g.venc += venc; g.favor += saldo < 0 ? -saldo : 0;
    if (deuda > 0) g.clientes++;
    if (venc > 0) { g.conVenc++; const dias = Number(f.antiguedad) || 0; g.edades[EDADES.findIndex(([, a, b]) => dias >= a && dias <= b)] += venc; if (dias > 90) T.mas90 += venc; }
    T.deuda += deuda; T.venc += venc; T.favor += saldo < 0 ? -saldo : 0; if (deuda > 0) T.clientes++;
  }
  const orden = [...grupos.values()].sort((a, b) => b.deuda - a.deuda);

  // Indicadores generales
  const kpi = (et, val, sub, tono) => { const c = el('div', 'kcard sin-medidor' + (tono ? ' ' + tono : '')); c.append(el('small', 'k-et', et), el('div', 'k-val', val), el('div', 'k-lin', sub)); return c; };
  kp.append(
    kpi('Deuda total', plataCorta(T.deuda), `${nf0.format(T.clientes)} clientes con deuda`),
    kpi('Vencida', plataCorta(T.venc), `${nf0.format(T.deuda ? T.venc / T.deuda * 100 : 0)}% de la deuda`, 'rojo'),
    kpi('No vencida', plataCorta(T.deuda - T.venc), 'Todavía en plazo'),
    kpi('Vencida hace más de 90 días', plataCorta(T.mas90), `${nf0.format(T.venc ? T.mas90 / T.venc * 100 : 0)}% de lo vencido`, 'rojo'),
    kpi('Saldos a favor', plataCorta(T.favor), 'Clientes con crédito')
  );

  // Comparación entre vendedores (barras apiladas: vencida / no vencida)
  const panel = el('section', 'panel cc-panel'); const cabP = el('div', 'panel-cab'); const t = el('div'); t.append(el('h3', null, 'Deuda por vendedor'), el('small', null, 'Rojo: vencida · Azul: todavía en plazo'));
  cabP.append(t); panel.append(cabP);
  const max = Math.max(1, ...orden.map(g => g.deuda));
  for (const g of orden) {
    const fila = el('div', 'cc-fila'); const barra = el('div', 'cc-barra');
    const v = el('i', 'venc'), nv = el('i', 'nov'); v.style.width = (g.venc / max * 100) + '%'; nv.style.width = ((g.deuda - g.venc) / max * 100) + '%';
    barra.append(v, nv);
    fila.append(el('span', 'cc-nom', g.nombre), barra, el('b', null, plataCorta(g.deuda)));
    panel.append(fila);
  }
  lista.append(panel);

  // Una tarjeta por vendedor: antigüedad de lo vencido y principales deudores
  const grid = el('div', 'cc-cards');
  for (const g of orden) {
    const c = el('div', 'cc-card'); const cab = el('div', 'rv-head');
    const tit = el('div'); tit.append(el('b', null, g.nombre), el('small', null, `${nClientes(g.clientes)} con deuda · ${nf0.format(g.conVenc)} con deuda vencida`));
    const tot = el('div', 'cc-tot'); tot.append(el('b', null, plataCorta(g.deuda)), el('small', null, `${nf0.format(g.deuda ? g.venc / g.deuda * 100 : 0)}% vencida`));
    cab.append(el('i', 'avatar-sm', iniciales(g.nombre)), tit, tot); c.append(cab);

    const edad = el('div', 'cc-edad'); const totalV = g.venc || 1;
    g.edades.forEach((m, i) => { if (m > 0) { const s = el('i'); s.style.width = (m / totalV * 100) + '%'; s.style.background = COLOR_EDAD[i]; s.title = `${EDADES[i][0]}: ${plataCorta(m)}`; edad.append(s); } });
    if (!g.venc) edad.append(el('span', 'cc-ok', 'Sin deuda vencida'));
    c.append(el('small', 'cc-et', 'Antigüedad de lo vencido'), edad);
    const leyenda = el('div', 'cc-ley'); EDADES.forEach(([n], i) => { if (g.edades[i] > 0) { const s = el('span'); const d = el('i'); d.style.background = COLOR_EDAD[i]; s.append(d, `${n}: ${plataCorta(g.edades[i])}`); leyenda.append(s); } });
    c.append(leyenda);

    const top = g.filas.filter(f => Number(f.saldo) > 0).sort((a, b) => Number(b.saldo) - Number(a.saldo));
    const tabla = el('div', 'cc-top');
    const fila = f => { const r = el('div', 'cc-cli'); const n = el('span', null, `${f.codigo} · ${f.nombre}`); const d = el('span', 'cc-dias', Number(f.antiguedad) > 0 ? `${f.antiguedad} d` : ''); r.append(n, d, el('b', null, plataCorta(Number(f.saldo)))); return r; };
    top.slice(0, 5).forEach(f => tabla.append(fila(f)));
    c.append(el('small', 'cc-et', 'Mayores deudores'), tabla);
    if (top.length > 5) {
      const resto = el('div', 'cc-top cc-resto'); resto.hidden = true; top.slice(5).forEach(f => resto.append(fila(f)));
      const b = el('button', 'link', `Ver los ${top.length - 5} restantes`); b.type = 'button';
      b.addEventListener('click', () => { resto.hidden = !resto.hidden; b.textContent = resto.hidden ? `Ver los ${top.length - 5} restantes` : 'Ocultar'; });
      c.append(b, resto);
    }
    grid.append(c);
  }
  lista.append(grid);
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
