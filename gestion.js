'use strict';

/* ===== Apartado "Vendedores" (jefe): Cobertura y volumen y Rutas ===== */

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Crea un elemento con clase y texto (siempre textContent: los nombres vienen de Chess).
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const msgErr = e => /does not exist|could not find|schema cache/i.test(e.message || '')
  ? 'Todavía no están cargados los datos de gestión en la base (falta ejecutar gestion.sql y sincronizar).'
  : 'No se pudo cargar: ' + (e.message || e);

// Color del avance respecto del ritmo esperado a esta altura del mes (ritmo = % del mes transcurrido; 100 si el mes ya terminó).
// Verde: cumple o va a ritmo. Ámbar: hasta 20% por debajo del ritmo. Rojo: más atrasado.
const claseAvance = (pct, ritmo = 100) => {
  if (pct >= 100) return 'ok';
  const ratio = ritmo > 0 ? pct / ritmo : 0;
  return ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'med' : 'bajo';
};

// Barra de avance (0–100+).
function barra(pct, ritmo = 100) {
  const b = el('div', 'bar'), i = el('i');
  i.style.width = Math.min(100, Math.max(0, pct)) + '%';
  i.className = claseAvance(pct, ritmo);
  b.append(i);
  return b;
}

/* ---------- Cobertura y volumen ---------- */
let mesVista = new Date(); mesVista.setDate(1);
let cobDatos = [];

function rangoMes(d) {
  const ini = new Date(d.getFullYear(), d.getMonth(), 1), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0), hoy = new Date();
  const actual = hoy >= ini && hoy <= fin;
  const hasta = actual ? hoy : fin;
  return { desde: iso(ini), hasta: iso(hasta), diasMes: fin.getDate(), transcurridos: hasta.getDate(), actual, periodo: iso(ini) };
}

const ritmoMes = r => (r.actual ? r.transcurridos / r.diasMes * 100 : 100);

async function cargarCobertura() {
  const r = rangoMes(mesVista), estado = $('#cobEstado'), lista = $('#cobLista');
  $('#mesTxt').textContent = `${MESES[mesVista.getMonth()]} ${mesVista.getFullYear()}`;
  lista.replaceChildren(); $('#cobTotal').replaceChildren(); $('#cobObj').hidden = true;
  if (!sb) { estado.textContent = 'Disponible al conectar con Supabase.'; return; }
  estado.textContent = 'Cargando…';
  const { data, error } = await sb.rpc('resumen_vendedores', { desde: r.desde, hasta: r.hasta });
  if (error) { estado.textContent = msgErr(error); return; }
  cobDatos = data || [];
  if (!cobDatos.length) { estado.textContent = 'Sin datos para este mes todavía.'; return; }
  estado.textContent = r.actual
    ? `Del 1 al ${r.transcurridos} de ${MESES[mesVista.getMonth()]} (día ${r.transcurridos} de ${r.diasMes}).`
    : `Mes completo.`;

  // Totales del equipo
  const tb = cobDatos.reduce((s, v) => s + Number(v.bultos), 0), tc = cobDatos.reduce((s, v) => s + Number(v.clientes_con_compra), 0);
  const tot = $('#cobTotal');
  tot.append(el('div', 'k', 'Equipo'), el('div', 'n', `${nf0.format(tb)} bultos`), el('div', 'k', `${nf0.format(tc)} clientes con compra`));

  for (const v of cobDatos) {
    const bultos = Number(v.bultos), cli = Number(v.clientes_con_compra), cartera = Number(v.cartera);
    const card = el('div', 'v cob');
    const cab = el('div', 'cab'); cab.append(el('b', null, v.nombre));
    card.append(cab);

    // Volumen
    const fv = el('div', 'fila'); fv.append(el('span', null, 'Volumen'), el('span', 'n', `${nf0.format(bultos)} bultos` + (v.obj_bultos ? ` de ${nf0.format(v.obj_bultos)}` : '')));
    card.append(fv);
    if (v.obj_bultos > 0) {
      const p = bultos / v.obj_bultos * 100;
      card.append(barra(p, ritmoMes(r)), el('small', null, `${nf0.format(p)}% del objetivo` + (r.actual ? ` · ritmo: ${nf0.format(bultos / r.transcurridos * r.diasMes)} bultos a fin de mes` : '')));
    } else if (r.actual && bultos > 0) card.append(el('small', null, `Ritmo: ${nf0.format(bultos / r.transcurridos * r.diasMes)} bultos a fin de mes (sin objetivo cargado)`));

    // Cobertura (clientes con compra)
    const fc = el('div', 'fila'); fc.append(el('span', null, 'Clientes con compra'), el('span', 'n', `${nf0.format(cli)}` + (v.obj_clientes ? ` de ${nf0.format(v.obj_clientes)}` : '')));
    card.append(fc);
    if (v.obj_clientes > 0) card.append(barra(cli / v.obj_clientes * 100, ritmoMes(r)), el('small', null, `${nf0.format(cli / v.obj_clientes * 100)}% del objetivo`));
    if (cartera > 0) card.append(el('small', null, `Cobertura de cartera: ${nf1.format(cli / cartera * 100)}% (${nf0.format(cli)} de ${nf0.format(cartera)} clientes en sus rutas)`));
    lista.append(card);
  }

  // Carga de objetivos (jefe/admin)
  const form = $('#objForm'); form.replaceChildren();
  const cab = el('div', 'orow ocab'); cab.append(el('span', null, 'Vendedor'), el('span', null, 'Bultos'), el('span', null, 'Clientes'));
  form.append(cab);
  for (const v of cobDatos) {
    const row = el('div', 'orow'); row.dataset.id = v.id_vendedor;
    const ib = el('input'); ib.type = 'number'; ib.min = '0'; ib.inputMode = 'decimal'; ib.value = v.obj_bultos ?? ''; ib.className = 'o-b'; ib.setAttribute('aria-label', `Objetivo de bultos de ${v.nombre}`);
    const ic = el('input'); ic.type = 'number'; ic.min = '0'; ic.inputMode = 'numeric'; ic.value = v.obj_clientes ?? ''; ic.className = 'o-c'; ic.setAttribute('aria-label', `Objetivo de clientes de ${v.nombre}`);
    row.append(el('span', null, v.nombre), ib, ic);
    form.append(row);
  }
  $('#objMsg').textContent = '';
  $('#cobObj').hidden = !esJefe;   // todos ven el avance; solo jefes y administradores cargan objetivos
}

async function guardarObjetivos() {
  const r = rangoMes(mesVista), msg = $('#objMsg');
  const filas = [...document.querySelectorAll('#objForm .orow[data-id]')].map(row => {
    const b = row.querySelector('.o-b').value, c = row.querySelector('.o-c').value;
    return { periodo: r.periodo, id_vendedor: Number(row.dataset.id), obj_bultos: b === '' ? null : Number(b), obj_clientes: c === '' ? null : parseInt(c, 10) };
  });
  msg.className = 'msg'; msg.textContent = 'Guardando…';
  const { error } = await sb.from('objetivos').upsert(filas, { onConflict: 'periodo,id_vendedor' });
  if (error) { msg.className = 'msg err'; msg.textContent = 'No se pudo guardar: ' + error.message; return; }
  await cargarCobertura();
  cargarResumenTop();
  $('#cobObj').open = true;
  $('#objMsg').className = 'msg'; $('#objMsg').textContent = 'Objetivos guardados.';
}

$('#mesAnt').addEventListener('click', () => { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() - 1, 1); cargarCobertura(); });
$('#mesSig').addEventListener('click', () => { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + 1, 1); cargarCobertura(); });
$('#objGuardar').addEventListener('click', guardarObjetivos);

/* ---------- Rutas de los vendedores ---------- */
async function cargarRutas() {
  const estado = $('#rutEstado'), lista = $('#rutLista');
  lista.replaceChildren();
  if (!sb) { estado.textContent = 'Disponible al conectar con Supabase.'; return; }
  estado.textContent = 'Cargando…';
  const { data, error } = await sb.rpc('rutas_resumen');
  if (error) { estado.textContent = msgErr(error); return; }
  if (!data?.length) { estado.textContent = 'Todavía no hay rutas cargadas desde Chess.'; return; }
  estado.textContent = 'Tocá un vendedor para ver sus rutas y una ruta para ver sus clientes.';

  const porVend = new Map();
  for (const r of data) {
    const k = r.id_vendedor ?? 0;
    if (!porVend.has(k)) porVend.set(k, { nombre: r.vendedor || 'Sin vendedor asignado', rutas: [] });
    porVend.get(k).rutas.push(r);
  }
  for (const { nombre, rutas } of porVend.values()) {
    const tot = rutas.reduce((s, x) => s + Number(x.clientes), 0);
    const bloque = el('div', 'rv');
    const cab = el('button', 'rv-cab'); cab.type = 'button';
    const cli = n => `${nf0.format(n)} cliente${Number(n) === 1 ? '' : 's'}`;
    cab.append(el('b', null, nombre), el('small', null, `${rutas.length} ruta${rutas.length === 1 ? '' : 's'} · ${cli(tot)}`));
    const cuerpo = el('div', 'rv-cuerpo'); cuerpo.hidden = true;
    cab.addEventListener('click', () => { cuerpo.hidden = !cuerpo.hidden; });
    for (const ru of rutas) {
      const f = el('div', 'ruta');
      const fc = el('button', 'ruta-cab'); fc.type = 'button';
      fc.append(el('span', null, ru.descripcion || `Ruta ${ru.id_ruta}`), el('small', null, cli(ru.clientes) + (ru.dias_visita ? ` · visita: ${ru.dias_visita}` : '')));
      const cl = el('div', 'ruta-cli'); cl.hidden = true; let cargado = false;
      fc.addEventListener('click', async () => {
        cl.hidden = !cl.hidden;
        if (cl.hidden || cargado) return;
        cl.textContent = 'Cargando…';
        const { data: ids, error: e2 } = await sb.from('ruta_clientes').select('id_cliente')
          .match({ id_sucursal: ru.id_sucursal, id_fuerza: ru.id_fuerza, id_modo: ru.id_modo, id_ruta: ru.id_ruta });
        if (e2) { cl.textContent = 'No se pudo cargar los clientes.'; return; }
        cargado = true; cl.replaceChildren();
        const porNum = new Map(clientes.map(c => [c.n, c]));  // clientes ya cargados en la app (padrón de Chess)
        for (const { id_cliente } of ids.sort((a, b) => a.id_cliente - b.id_cliente)) {
          const c = porNum.get(id_cliente);
          cl.append(el('div', 'cli-fila', `${id_cliente} – ${c ? c.rs : 'Cliente sin datos'}${c && c.nf && c.nf !== c.rs ? ' (' + c.nf + ')' : ''}`));
        }
        if (!ids.length) cl.textContent = 'Esta ruta no tiene clientes.';
      });
      f.append(fc, cl); cuerpo.append(f);
    }
    bloque.append(cab, cuerpo); lista.append(bloque);
  }
}

/* ---------- Resumen gráfico arriba de "Vendedores": aros + barras interactivas ---------- */
let resumenTop = null;     // { datos, r }
let metricaTop = 'vol';    // 'vol' | 'cli'
const SVG = 'http://www.w3.org/2000/svg';

// Aro de progreso. pct = null → sin objetivo. Se puede tocar para ver el detalle.
function aro(pct, ritmo, titulo, detalle) {
  const w = el('button', 'ring'); w.type = 'button';
  const caja = el('div', 'r-svg');
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const R = 40, C = 2 * Math.PI * R, p = Math.min(100, Math.max(0, pct ?? 0));
  const mk = (cls, extra) => { const c = document.createElementNS(SVG, 'circle'); c.setAttribute('cx', 50); c.setAttribute('cy', 50); c.setAttribute('r', R); c.setAttribute('class', cls); Object.entries(extra || {}).forEach(([k, v]) => c.setAttribute(k, v)); return c; };
  svg.append(mk('r-base'));
  if (pct != null) svg.append(mk('r-prog ' + claseAvance(pct, ritmo), { 'stroke-dasharray': `${(C * p / 100).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90 50 50)' }));
  const centro = el('b', 'r-centro', pct == null ? '—' : `${nf0.format(pct)}%`);
  caja.append(svg, centro);
  w.append(caja, el('span', 'r-tit', titulo), el('small', null, detalle));
  w.addEventListener('click', () => { verSub('cob'); cargarCobertura(); });
  return w;
}

function renderResumenTop() {
  const { datos, r } = resumenTop, ritmo = ritmoMes(r), estado = $('#rsEstado');
  const conObjB = datos.filter(v => v.obj_bultos > 0), conObjC = datos.filter(v => v.obj_clientes > 0);
  const sum = (arr, f) => arr.reduce((s, v) => s + Number(f(v)), 0);
  const totB = sum(datos, v => v.bultos), totC = sum(datos, v => v.clientes_con_compra);
  const objB = sum(conObjB, v => v.obj_bultos), logB = sum(conObjB, v => v.bultos);
  const objC = sum(conObjC, v => v.obj_clientes), logC = sum(conObjC, v => v.clientes_con_compra);

  $('#rsAros').replaceChildren(
    aro(objB > 0 ? logB / objB * 100 : null, ritmo, 'Volumen', objB > 0 ? `${nf0.format(logB)} de ${nf0.format(objB)} bultos` : `${nf0.format(totB)} bultos · sin objetivo`),
    aro(objC > 0 ? logC / objC * 100 : null, ritmo, 'Clientes con compra', objC > 0 ? `${nf0.format(logC)} de ${nf0.format(objC)} clientes` : `${nf0.format(totC)} clientes · sin objetivo`)
  );
  estado.textContent = (objB > 0 || objC > 0)
    ? (r.actual ? `Ritmo esperado hoy: ${nf0.format(ritmo)}% (día ${r.transcurridos} de ${r.diasMes}). Verde: a ritmo · ámbar: algo atrasado · rojo: muy atrasado.` : 'Mes completo.')
    : 'Todavía no hay objetivos cargados para este mes.' + (esJefe ? ' Cargalos en Cumplimiento de objetivos → Cobertura y volumen.' : '');
  renderBarrasTop();
}

function renderBarrasTop() {
  const { datos, r } = resumenTop, ritmo = ritmoMes(r), vol = metricaTop === 'vol', cont = $('#rsBarras');
  const valor = v => Number(vol ? v.bultos : v.clientes_con_compra), objetivo = v => Number(vol ? v.obj_bultos : v.obj_clientes);
  const unidad = vol ? 'bultos' : 'clientes';
  const conObj = datos.filter(v => objetivo(v) > 0).map(v => ({ v, pct: valor(v) / objetivo(v) * 100 })).sort((a, b) => b.pct - a.pct);
  const sinObj = datos.filter(v => !(objetivo(v) > 0) && valor(v) > 0).sort((a, b) => valor(b) - valor(a));
  const max = Math.max(1, ...sinObj.map(valor));
  cont.replaceChildren();

  const fila = (v, pctTxt, barraEl, detalle) => {
    const b = el('button', 'rb'); b.type = 'button';
    const cab = el('div', 'rb-cab'); cab.append(el('span', null, v.nombre), el('b', null, pctTxt));
    const det = el('div', 'rb-det', detalle); det.hidden = true;
    b.append(cab, barraEl);
    b.addEventListener('click', () => { det.hidden = !det.hidden; b.classList.toggle('abierto', !det.hidden); });
    const w = el('div', 'rb-w'); w.append(b, det); return w;
  };
  const detalleDe = v => `${nf0.format(v.bultos)} bultos` + (v.obj_bultos > 0 ? ` de ${nf0.format(v.obj_bultos)}` : '') +
    ` · ${nf0.format(v.clientes_con_compra)} clientes con compra` + (v.obj_clientes > 0 ? ` de ${nf0.format(v.obj_clientes)}` : '') +
    (Number(v.cartera) > 0 ? ` · cartera de ${nf0.format(v.cartera)}` : '');

  for (const { v, pct } of conObj) cont.append(fila(v, `${nf0.format(pct)}%`, barra(pct, ritmo), detalleDe(v)));
  for (const v of sinObj) {
    const b = el('div', 'bar'), i = el('i', 'neutra'); i.style.width = (valor(v) / max * 100) + '%'; b.append(i);
    cont.append(fila(v, `${nf0.format(valor(v))} ${unidad}`, b, detalleDe(v)));
  }
  if (!cont.children.length) cont.append(el('p', 'hint', 'Sin ventas registradas este mes todavía.'));
}

async function cargarResumenTop() {
  const est = $('#rsEstado'), r = rangoMes(new Date());
  $('#rsMes').textContent = `${MESES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  est.textContent = 'Cargando…';
  const { data, error } = await sb.rpc('resumen_vendedores', { desde: r.desde, hasta: r.hasta });
  if (error) { est.textContent = msgErr(error); $('#rsAros').replaceChildren(); $('#rsBarras').replaceChildren(); return; }
  if (!data?.length) { est.textContent = 'Sin datos de ventas para este mes todavía.'; return; }
  resumenTop = { datos: data, r };
  renderResumenTop();
}

document.querySelectorAll('.seg button[data-m]').forEach(b => b.addEventListener('click', () => {
  metricaTop = b.dataset.m;
  document.querySelectorAll('.seg button[data-m]').forEach(x => x.classList.toggle('on', x === b));
  if (resumenTop) renderBarrasTop();
}));
$('#rsDetalle').addEventListener('click', () => { verSub('cob'); cargarCobertura(); });
document.querySelector('#tabs [data-tab="vend"]').addEventListener('click', cargarResumenTop);

// Al abrir cada pantalla se cargan sus datos
document.querySelectorAll('[data-sub="cob"]').forEach(b => b.addEventListener('click', cargarCobertura));
document.querySelectorAll('[data-sub="rut"]').forEach(b => b.addEventListener('click', cargarRutas));
