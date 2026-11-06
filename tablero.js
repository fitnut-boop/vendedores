'use strict';

/* ===== Resumen comercial (público, sin contraseña) =====
   Muestra el avance del mes de cada vendedor en kilos (total, Nestlé y Purina + Hileret), clientes con compra y altas,
   con una PROYECCIÓN AL CIERRE: si siguen vendiendo a este ritmo con los días hábiles que quedan, ¿llegan al objetivo?
   proyección = acumulado ÷ días hábiles trabajados × días hábiles del mes.
   Semáforo: En ritmo ≥ 100% · Cerca ≥ 85% · Atrasado. */

const kgTxt = n => `${nf0.format(Math.round(n))} kg`;
const ETQ = { ok: 'En ritmo', med: 'Cerca', bajo: 'Atrasado', nd: '' };
const estadoDe = p => (p == null ? 'nd' : p >= 100 ? 'ok' : p >= 85 ? 'med' : 'bajo');
const NOMBRE_MES = m => MESES[m.getMonth()].charAt(0).toUpperCase() + MESES[m.getMonth()].slice(1);

let mesRes = primerDia(new Date());
let kgSel = 'total';          // 'total' | 'nestle' | 'otros'
let vistaRes = 'res';         // 'res' | 'bees'
let feriados = null;          // Set de 'YYYY-MM-DD'
let resDatos = null;          // { filas, info }

/* ---------- Días hábiles: lunes a viernes menos feriados ---------- */
async function cargarFeriados() {
  if (feriados) return;
  feriados = new Set(((window.APP_CONFIG || {}).feriados) || []);
  if (!sb) return;
  const { data } = await sb.from('feriados').select('fecha');
  if (data) data.forEach(f => feriados.add(f.fecha));
}
const esHabil = d => d.getDay() !== 0 && d.getDay() !== 6 && !feriados.has(iso(d));
function contarHabiles(desde, hasta) {
  let n = 0;
  for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) if (esHabil(d)) n++;
  return n;
}

// Días hábiles del mes, trabajados y restantes. Un día en curso se cuenta como trabajado recién a las 17 h
// (o si es el primer día hábil del mes, para poder proyectar).
function infoMes(m) {
  const ini = primerDia(m), fin = new Date(m.getFullYear(), m.getMonth() + 1, 0), ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const habiles = contarHabiles(ini, fin);
  let trab, estado;
  if (hoy > fin) { trab = habiles; estado = 'cerrado'; }
  else if (hoy < ini) { trab = 0; estado = 'futuro'; }
  else {
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    trab = ayer >= ini ? contarHabiles(ini, ayer) : 0;
    if (esHabil(hoy) && (ahora.getHours() >= 17 || trab === 0)) trab += 1;
    estado = 'en curso';
  }
  return { ini, fin, habiles, trab, restantes: Math.max(0, habiles - trab), avance: habiles ? trab / habiles * 100 : 0, estado };
}
const proyectar = (acum, info) => (info.estado === 'cerrado' ? acum : info.trab > 0 ? acum / info.trab * info.habiles : null);

/* ---------- Piezas visuales ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; }

// Medidor semicircular (escala 0–125%, con marca en el 100%)
function medidor(pct, estado) {
  const svg = svgEl('svg', { viewBox: '0 0 100 62', class: 'medidor', 'aria-hidden': 'true' });
  const R = 36, cx = 50, cy = 52, largo = Math.PI * R, arco = `M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  svg.append(svgEl('path', { d: arco, class: 'm-base' }));
  if (pct != null) {
    const p = Math.min(Math.max(pct, 0), 125) / 125;
    svg.append(svgEl('path', { d: arco, class: 'm-prog ' + (estado || estadoDe(pct)), 'stroke-dasharray': `${(largo * p).toFixed(1)} ${largo.toFixed(1)}` }));
  }
  const ang = Math.PI * (100 / 125), x = f => (cx - f * Math.cos(ang)).toFixed(1), y = f => (cy - f * Math.sin(ang)).toFixed(1);
  svg.append(svgEl('line', { x1: x(R - 7), y1: y(R - 7), x2: x(R + 7), y2: y(R + 7), class: 'm-marca' }));
  const t = svgEl('text', { x: cx, y: cy - 2, class: 'm-txt ' + (estado || estadoDe(pct)), 'text-anchor': 'middle' });
  t.textContent = pct == null ? '—' : `${nf0.format(pct)}%`;
  svg.append(t);
  return svg;
}

// Tarjeta de indicador: etiqueta, valor grande, medidor, barra fina con marca del 100% y dos líneas de detalle
function tarjeta(etiqueta, valor, pct, lineas, tono, estado) {
  const c = el('div', 'kcard' + (tono ? ' ' + tono : ''));
  const sup = el('div', 'k-sup');
  const izq = el('div'); izq.append(el('small', 'k-et', etiqueta), el('div', 'k-val', valor));
  sup.append(izq, medidor(pct, estado));
  c.append(sup);
  if (pct != null) c.append(barraFina(pct, estado));
  if (estado && ETQ[estado]) c.append(el('span', 'k-estado ' + estado, ETQ[estado]));
  for (const l of lineas) c.append(el('div', 'k-lin', l));
  return c;
}
function barraFina(pct, estado) {
  const b = el('div', 'bfina'), i = el('i', estado || estadoDe(pct)), m = el('u');
  i.style.width = Math.min(100, Math.max(0, pct) / 130 * 100) + '%';
  m.style.left = (100 / 130 * 100) + '%';
  b.append(i, m); return b;
}

// Texto de la derecha de una fila: el estado (En ritmo / Cerca / Atrasado) y debajo el dato real hasta la fecha
function valorFila(est, real) {
  const s = el('span', 'tb-val'); s.append(el('span', 'tb-est', est ? ETQ[est] : 'Sin objetivo'), el('small', null, real)); return s;
}

// Una fila de la lista de barras: nombre, barra con la línea del 100% y porcentaje con color de semáforo.
function filaBarra(nombre, pct, valorTxt, detalle, anchoSinObj, estado) {
  const est = estado || (pct == null ? 'nd' : estadoDe(pct));
  const w = el('div', 'tb-w'), f = el('button', 'tb'); f.type = 'button';
  const barra = el('div', 'tb-barra'), rel = el('i', est), marca = el('u');
  rel.style.width = (pct == null ? Math.max(3, anchoSinObj ?? 0) : Math.min(100, Math.max(0, pct) / 130 * 100)) + '%';
  barra.append(rel); if (pct != null) { marca.style.left = (100 / 130 * 100) + '%'; barra.append(marca); }
  const val = el('b', 'tb-pct ' + est); if (typeof valorTxt === 'object') val.append(valorTxt); else val.textContent = valorTxt;
  f.append(el('span', 'tb-nom', nombre), barra, val);
  const det = el('div', 'tb-det', detalle); det.hidden = true;
  f.addEventListener('click', () => { det.hidden = !det.hidden; w.classList.toggle('abierto', !det.hidden); });
  w.append(f, det); return w;
}

/* ---------- Carga ---------- */
async function cargarResumen() {
  const est = $('#resEstado');
  await cargarFeriados();
  const info = infoMes(mesRes);
  renderPills(); renderEncabezado(info);
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  est.textContent = 'Cargando…';
  const [r, ua] = await Promise.all([
    sb.rpc('tablero_publico', { desde: iso(info.ini), hasta: iso(info.fin) }),
    sb.rpc('ultima_actualizacion')
  ]);
  if (ua?.data) {
    const f = new Date(ua.data);
    $('#datosAl').innerHTML = 'Dashboard comercial · datos al <b>' + f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + '</b> ' + f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  if (r.error) { est.textContent = msgErr(r.error); return; }
  resDatos = { filas: r.data || [], info };
  renderResumen();
}

function renderPills() {
  const cont = $('#mesPills'), hoy = new Date(), anio = mesRes.getFullYear();
  cont.replaceChildren();
  for (let m = 0; m < 12; m++) {
    const d = new Date(anio, m, 1), futuro = d > primerDia(hoy), actual = d.getTime() === primerDia(hoy).getTime();
    const b = el('button', 'pill-mes' + (d.getTime() === mesRes.getTime() ? ' on' : '')); b.type = 'button'; b.disabled = futuro;
    b.append(el('span', null, (actual ? '● ' : '') + NOMBRE_MES(d)));
    if (actual) b.append(el('small', null, 'Avance · cierre pendiente'));
    b.addEventListener('click', () => { mesRes = d; cargarResumen(); });
    cont.append(b);
  }
}

function renderEncabezado(info) {
  const k = $('#kpiMes'); k.replaceChildren();
  const caja = (et, val, cls) => { const c = el('div', 'ks' + (cls ? ' ' + cls : '')); c.append(el('small', null, et), el('b', null, val)); return c; };
  k.append(
    caja('Mes', `${NOMBRE_MES(mesRes)} ${mesRes.getFullYear()}`, 'ks-mes'),
    caja('Días hábiles', String(info.habiles)),
    caja('Días trabajados', String(info.trab)),
    caja('Avance del mes', `${nf0.format(info.avance)}%`),
    caja('Días restantes de venta', String(info.restantes), info.restantes > 0 ? 'ks-alerta' : '')
  );
  $('#resTitulo').textContent = `${NOMBRE_MES(mesRes)} ${mesRes.getFullYear()} · Total Fitnut`;
}

/* ---------- Resumen ---------- */
function renderResumen() {
  const { filas, info } = resDatos, est = $('#resEstado');
  const num = v => Number(v) || 0;
  const tot = { kg: 0, nes: 0, otr: 0, ccc: 0, altas: 0, objKg: 0, objNes: 0, objOtr: 0, objCcc: 0 };
  for (const f of filas) {
    tot.kg += num(f.kg_total); tot.nes += num(f.kg_nestle); tot.otr += num(f.kg_otros); tot.ccc += num(f.clientes_con_compra); tot.altas += num(f.altas);
    tot.objKg += num(f.obj_kg); tot.objNes += num(f.obj_kg_nestle); tot.objOtr += num(f.obj_kg_otros); if (!esSupervisor(f)) tot.objCcc += objetivoClientes(f);   // lo vendido por el supervisor suma al total, pero no tiene objetivo individual
  }
  // Se muestran los datos reales hasta la fecha (% = real ÷ objetivo). El estado (en ritmo / cerca / atrasado) se calcula
  // internamente con el ritmo de venta, pero la proyección no se muestra.
  const pr = (acum, obj) => {
    const p = proyectar(acum, info);
    return { pct: obj > 0 ? acum / obj * 100 : null, est: p != null && obj > 0 ? estadoDe(p / obj * 100) : null };
  };
  const T = pr(tot.kg, tot.objKg), N = pr(tot.nes, tot.objNes), O = pr(tot.otr, tot.objOtr);
  const cccPct = tot.objCcc > 0 ? tot.ccc / tot.objCcc * 100 : null, cccEst = cccPct == null ? null : proyectar(tot.ccc, info) == null ? null : estadoDe(proyectar(tot.ccc, info) / tot.objCcc * 100);

  // Frase de situación
  const frase = $('#resFrase');
  if (!filas.length || tot.kg === 0) frase.textContent = 'Todavía no hay ventas registradas para este mes.';
  else {
    frase.replaceChildren(document.createTextNode(`Fitnut lleva vendidos ${kgTxt(tot.kg)} en el mes`));
    if (tot.objKg > 0 && T.est) {
      frase.append(` de un objetivo de ${kgTxt(tot.objKg)} (${nf0.format(T.pct)}%): `, el('b', 'f-' + T.est, ETQ[T.est].toLowerCase()), '.');
    } else if (tot.objKg > 0) frase.append(` de un objetivo de ${kgTxt(tot.objKg)} (${nf0.format(T.pct)}%).`);
    else frase.append('. Todavía no hay objetivos de kilos cargados para este mes.');
  }

  // Tarjetas
  const lin = obj => [obj > 0 ? `Objetivo ${kgTxt(obj)}` : 'Sin objetivo cargado'];
  const K = $('#kCards'); K.replaceChildren(
    tarjeta('Total kg', kgTxt(tot.kg), T.pct, lin(tot.objKg), '', T.est),
    tarjeta('Nestlé · kg', kgTxt(tot.nes), N.pct, lin(tot.objNes), '', N.est),
    tarjeta('Purina + Hileret · kg', kgTxt(tot.otr), O.pct, lin(tot.objOtr), '', O.est),
    tarjeta('Clientes con compra', nf0.format(tot.ccc), cccPct, [tot.objCcc > 0 ? `Objetivo ${nf0.format(tot.objCcc)} clientes` : 'Sin objetivo'], '', cccEst),
    tarjeta('Altas', nf0.format(tot.altas), null, ['Clientes nuevos: alta en el mes y con compra'], 'sin-medidor')
  );
  est.textContent = (info.estado === 'en curso' ? `Mes en curso: ${info.trab} de ${info.habiles} días hábiles trabajados. Los números son lo vendido hasta hoy; el estado indica si van en ritmo de llegar al objetivo. ` : '') +
    (tot.objKg > 0 ? '' : 'Los objetivos se cargan en la solapa Objetivos (hay que ingresar).');

  renderBarrasKg(); renderBarrasCcc();
}

// Objetivo de clientes con compra de un vendedor: el cargado a mano o su % del padrón activo (cartera)
const esSupervisor = f => /^supervisor/i.test(f.nombre || '');
const objetivoClientes = f => (Number(f.obj_clientes) > 0 ? Number(f.obj_clientes) : Math.round(Number(f.pct_cobertura) / 100 * Number(f.cartera)));

function renderBarrasKg() {
  const { filas, info } = resDatos, cont = $('#barrasKg');
  const acum = f => Number(kgSel === 'total' ? f.kg_total : kgSel === 'nestle' ? f.kg_nestle : f.kg_otros);
  const obj = f => Number(kgSel === 'total' ? f.obj_kg : kgSel === 'nestle' ? f.obj_kg_nestle : f.obj_kg_otros) || 0;
  // % = real ÷ objetivo (datos hasta hoy). El estado sale del ritmo de venta, sin mostrar la proyección.
  const items = filas.filter(f => !esSupervisor(f)).map(f => {
    const a = acum(f), p = proyectar(a, info), o = obj(f);
    return { f, a, o, pct: o > 0 ? a / o * 100 : null, est: p != null && o > 0 ? estadoDe(p / o * 100) : null };
  }).sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || y.a - x.a);
  const maxA = Math.max(1, ...items.map(i => i.a));
  cont.replaceChildren();
  for (const i of items) {
    const detalle = `Real ${kgTxt(i.a)} · ${i.o > 0 ? `Objetivo ${kgTxt(i.o)} (${nf0.format(i.pct)}% logrado)` : 'sin objetivo cargado'}`;
    cont.append(filaBarra(i.f.nombre, i.pct, valorFila(i.est, kgTxt(i.a)), detalle, i.a / maxA * 100, i.est || undefined));
  }
  if (!items.length) cont.append(el('p', 'hint', 'Sin datos para este mes.'));
}

function renderBarrasCcc() {
  const { filas } = resDatos, cont = $('#barrasCcc');
  const items = filas.filter(f => !esSupervisor(f) && (Number(f.cartera) > 0 || Number(f.clientes_con_compra) > 0)).map(f => {
    const o = objetivoClientes(f), real = Number(f.clientes_con_compra);
    return { f, o, real, pct: o > 0 ? real / o * 100 : null };
  }).sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1));
  cont.replaceChildren();
  for (const i of items) {
    const p = proyectar(i.real, resDatos.info), est = i.pct == null || p == null ? null : estadoDe(p / i.o * 100);
    cont.append(filaBarra(i.f.nombre, i.pct, valorFila(est, `${nf0.format(i.real)} clientes`),
      `${nf0.format(i.real)} clientes con compra de ${nf0.format(i.o)} de objetivo (${nf0.format(i.f.pct_cobertura)}% de su padrón activo de ${nf0.format(i.f.cartera)})`, 0, est || undefined));
  }
  if (!items.length) cont.append(el('p', 'hint', 'Sin datos para este mes.'));
  // nota con la regla del objetivo
  const grupos = new Map();
  for (const f of filas) { const k = Number(f.pct_cobertura); (grupos.get(k) || grupos.set(k, []).get(k)).push(f.nombre); }
  const base = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const otros = [...grupos.entries()].filter(g => g[0] !== base[0]).map(([p, n]) => `${n.join(' y ')} ${nf0.format(p)}%`);
  $('#notaCcc').textContent = base ? `Real ÷ objetivo (${nf0.format(base[0])}% del padrón activo${otros.length ? '; ' + otros.join('; ') : ''}) · la línea marca el 100%` : 'Real ÷ objetivo · la línea marca el 100%';
}

/* ---------- Bees (boceto con datos de ejemplo) ---------- */
function renderBees() {
  const nombres = (resDatos?.filas.length ? resDatos.filas.map(f => f.nombre) : ['Javier', 'Virginia', 'Andrés', 'Germán', 'Brenda', 'Gabriela', 'Tomás']).filter(n => n !== 'Supervisor');
  const ejemplo = [82, 64, 91, 55, 78, 70, 47], objetivo = 80;
  const filas = nombres.map((n, i) => ({ n, p: ejemplo[i % ejemplo.length] }));
  const prom = filas.reduce((s, f) => s + f.p, 0) / filas.length;
  $('#beesCards').replaceChildren(
    tarjeta('Pedidos cargados por Bees', `${nf0.format(prom)}%`, prom / objetivo * 100, [`Objetivo ${objetivo}% de los pedidos`, 'Dato de ejemplo']),
    tarjeta('Clientes que piden por Bees', '412', 412 / 520 * 100, ['De 520 clientes activos', 'Dato de ejemplo']),
    tarjeta('Pedidos del mes en Bees', '1.830', null, ['De 2.580 pedidos totales', 'Dato de ejemplo'], 'sin-medidor')
  );
  const cont = $('#beesBarras'); cont.replaceChildren();
  for (const f of filas.sort((a, b) => b.p - a.p)) cont.append(filaBarra(f.n, f.p / objetivo * 100, `${f.p}%`, `${f.p}% de sus pedidos cargados por Bees (objetivo ${objetivo}%) · dato de ejemplo`));
}

/* ---------- Eventos ---------- */
document.querySelectorAll('.seg button[data-k]').forEach(b => b.addEventListener('click', () => {
  kgSel = b.dataset.k;
  document.querySelectorAll('.seg button[data-k]').forEach(x => x.classList.toggle('on', x === b));
  if (resDatos) renderBarrasKg();
}));
document.querySelectorAll('.subtabs button[data-v]').forEach(b => b.addEventListener('click', () => {
  vistaRes = b.dataset.v;
  document.querySelectorAll('.subtabs button[data-v]').forEach(x => x.classList.toggle('on', x === b));
  $('#vistaRes').hidden = vistaRes !== 'res'; $('#vistaBees').hidden = vistaRes !== 'bees';
  if (vistaRes === 'bees') renderBees();
}));
document.addEventListener('tabcambio', e => { if (e.detail === 'res') cargarResumen(); });
setInterval(() => { if (!$('#tab-res').hidden && document.visibilityState === 'visible') cargarResumen(); }, 5 * 60 * 1000);
if (!$('#tab-res').hidden) cargarResumen();
