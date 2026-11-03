'use strict';

/* ===== Solapa "Vendedores": avance del mes (Volumen, Cobertura, Bees), detalle con objetivos y rutas ===== */
/* ===== Solapa "Calendario": Google Calendar ===== */

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const primerDia = d => new Date(d.getFullYear(), d.getMonth(), 1);

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

function rangoMes(d) {
  const ini = primerDia(d), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0), hoy = new Date();
  const actual = hoy >= ini && hoy <= fin;
  const hasta = actual ? hoy : fin;
  return { desde: iso(ini), hasta: iso(hasta), diasMes: fin.getDate(), transcurridos: hasta.getDate(), actual, periodo: iso(ini) };
}
// % del mes transcurrido (100 si el mes ya terminó): el ritmo que debería llevar cada vendedor.
const ritmoMes = r => (r.actual ? r.transcurridos / r.diasMes * 100 : 100);

// Color del avance respecto del ritmo esperado. Verde: cumple o va a ritmo. Ámbar: hasta 20% por debajo. Rojo: más atrasado.
const claseAvance = (pct, ritmo = 100) => {
  if (pct >= 100) return 'ok';
  const ratio = ritmo > 0 ? pct / ritmo : 0;
  return ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'med' : 'bajo';
};
function barra(pct, ritmo = 100, clase) {
  const b = el('div', 'bar'), i = el('i');
  i.style.width = Math.min(100, Math.max(0, pct)) + '%';
  i.className = clase || claseAvance(pct, ritmo);
  b.append(i);
  return b;
}

// Indicadores con objetivo. Bees se suma cuando sepamos de dónde sale la información.
const METRICAS = {
  vol: { titulo: 'Volumen', unidad: 'bultos', valor: v => Number(v.bultos), objetivo: v => Number(v.obj_bultos), campo: 'obj_bultos', etiqueta: 'Bultos' },
  cob: { titulo: 'Cobertura', unidad: 'clientes', valor: v => Number(v.clientes_con_compra), objetivo: v => Number(v.obj_clientes), campo: 'obj_clientes', etiqueta: 'Clientes con compra' },
};
const sumar = (arr, f) => arr.reduce((s, v) => s + f(v), 0);

async function resumenDe(fecha) {
  const r = rangoMes(fecha);
  const { data, error } = await sb.rpc('resumen_vendedores', { desde: r.desde, hasta: r.hasta });
  return { r, data, error };
}

/* ---------- Avance del mes (arriba de "Vendedores") ---------- */
let resumenTop = null;     // { datos, r }
let metricaTop = 'vol';    // 'vol' | 'cob' | 'bees'
const SVG = 'http://www.w3.org/2000/svg';

// Indicador con aro de progreso. pct = null → sin objetivo. Al tocarlo muestra sus barras por vendedor.
function indicador(clave, pct, ritmo, titulo, detalle, centroFijo) {
  const w = el('button', 'kpi' + (clave === metricaTop ? ' sel' : '')); w.type = 'button';
  w.setAttribute('aria-pressed', clave === metricaTop);
  const caja = el('div', 'r-svg');
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const R = 40, C = 2 * Math.PI * R, p = Math.min(100, Math.max(0, pct ?? 0));
  const circulo = (cls, extra) => { const c = document.createElementNS(SVG, 'circle'); c.setAttribute('cx', 50); c.setAttribute('cy', 50); c.setAttribute('r', R); c.setAttribute('class', cls); Object.entries(extra || {}).forEach(([k, v]) => c.setAttribute(k, v)); return c; };
  svg.append(circulo('r-base'));
  if (pct != null) svg.append(circulo('r-prog ' + claseAvance(pct, ritmo), { 'stroke-dasharray': `${(C * p / 100).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90 50 50)' }));
  caja.append(svg, el('b', 'r-centro' + (centroFijo ? ' chico' : ''), centroFijo || (pct == null ? '—' : `${nf0.format(pct)}%`)));
  w.append(caja, el('span', 'r-tit', titulo), el('small', null, detalle));
  w.addEventListener('click', () => { metricaTop = clave; renderResumenTop(); });
  return w;
}

function renderResumenTop() {
  const r = resumenTop?.r || rangoMes(new Date()), datos = resumenTop?.datos || [], ritmo = ritmoMes(r);
  const total = clave => {
    const M = METRICAS[clave], conObj = datos.filter(v => M.objetivo(v) > 0);
    const obj = sumar(conObj, M.objetivo), log = sumar(conObj, M.valor);
    return obj > 0
      ? { pct: log / obj * 100, texto: `${nf0.format(log)} de ${nf0.format(obj)} ${M.unidad}` }
      : { pct: null, texto: `${nf0.format(sumar(datos, M.valor))} ${M.unidad} · sin objetivo` };
  };
  const tv = total('vol'), tc = total('cob');
  $('#rsAros').replaceChildren(
    indicador('vol', tv.pct, ritmo, 'Volumen', tv.texto),
    indicador('cob', tc.pct, ritmo, 'Cobertura', tc.texto + (tc.pct == null ? '' : ' con compra')),
    indicador('bees', null, ritmo, 'Bees', 'A desarrollar', 'Pronto')
  );
  const hayObj = tv.pct != null || tc.pct != null;
  $('#rsEstado').textContent = hayObj
    ? (r.actual ? `Ritmo esperado hoy: ${nf0.format(ritmo)}% (día ${r.transcurridos} de ${r.diasMes}). Verde: a ritmo · ámbar: algo atrasado · rojo: muy atrasado.` : 'Mes completo.')
    : 'Todavía no hay objetivos cargados para este mes.' + (esJefe ? ' Cargalos tocando un indicador → "Ver detalle y objetivos".' : '');
  renderBarrasTop();
}

function renderBarrasTop() {
  const cont = $('#rsBarras'), btn = $('#rsDetalle');
  cont.replaceChildren();
  if (metricaTop === 'bees') {
    $('#rsTit').textContent = 'Bees';
    cont.append(el('p', 'hint', 'Se desarrolla más adelante, cuando sepamos de dónde sale la información de uso de Bees.'));
    btn.textContent = 'Qué va a mostrar Bees';
    return;
  }
  const M = METRICAS[metricaTop], { datos, r } = resumenTop || { datos: [], r: rangoMes(new Date()) }, ritmo = ritmoMes(r);
  $('#rsTit').textContent = `${M.titulo} por vendedor`;
  btn.textContent = `Ver detalle y objetivos de ${M.titulo.toLowerCase()}`;
  const conObj = datos.filter(v => M.objetivo(v) > 0).map(v => ({ v, pct: M.valor(v) / M.objetivo(v) * 100 })).sort((a, b) => b.pct - a.pct);
  const sinObj = datos.filter(v => !(M.objetivo(v) > 0) && M.valor(v) > 0).sort((a, b) => M.valor(b) - M.valor(a));
  const max = Math.max(1, ...sinObj.map(M.valor));

  const detalleDe = v => `${nf0.format(v.bultos)} bultos` + (v.obj_bultos > 0 ? ` de ${nf0.format(v.obj_bultos)}` : '') +
    ` · ${nf0.format(v.clientes_con_compra)} clientes con compra` + (v.obj_clientes > 0 ? ` de ${nf0.format(v.obj_clientes)}` : '') +
    (Number(v.cartera) > 0 ? ` · cartera de ${nf0.format(v.cartera)}` : '');
  const fila = (v, valorTxt, barraEl) => {
    const b = el('button', 'rb'); b.type = 'button';
    const cab = el('div', 'rb-cab'); cab.append(el('span', null, v.nombre), el('b', null, valorTxt));
    const det = el('div', 'rb-det', detalleDe(v)); det.hidden = true;
    b.append(cab, barraEl);
    b.addEventListener('click', () => { det.hidden = !det.hidden; b.classList.toggle('abierto', !det.hidden); });
    const w = el('div', 'rb-w'); w.append(b, det); return w;
  };
  for (const { v, pct } of conObj) cont.append(fila(v, `${nf0.format(pct)}%`, barra(pct, ritmo)));
  for (const v of sinObj) cont.append(fila(v, `${nf0.format(M.valor(v))} ${M.unidad}`, barra(M.valor(v) / max * 100, 100, 'neutra')));
  if (!cont.children.length) cont.append(el('p', 'hint', 'Sin ventas registradas este mes todavía.'));
}

async function cargarResumenTop() {
  const est = $('#rsEstado'), hoy = new Date();
  $('#rsMes').textContent = `${MESES[hoy.getMonth()]} ${hoy.getFullYear()}`;
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; renderResumenTop(); return; }
  est.textContent = 'Cargando…';
  const { r, data, error } = await resumenDe(hoy);
  if (error) { est.textContent = msgErr(error); $('#rsAros').replaceChildren(); $('#rsBarras').replaceChildren(); return; }
  resumenTop = { datos: data || [], r };
  renderResumenTop();
  if (!data?.length) $('#rsEstado').textContent = 'Sin datos de ventas para este mes todavía.';
}

$('#rsDetalle').addEventListener('click', () => (metricaTop === 'bees' ? verSub('bees') : abrirDetalle(metricaTop)));
document.querySelector('#tabs [data-tab="vend"]').addEventListener('click', cargarResumenTop);

/* ---------- Detalle de Volumen o de Cobertura, con carga de objetivos ---------- */
let modoDet = 'vol';
let mesVista = primerDia(new Date());

function abrirDetalle(m) { modoDet = m; mesVista = primerDia(new Date()); verSub('det'); cargarDetalle(); }

async function cargarDetalle() {
  const M = METRICAS[modoDet], r = rangoMes(mesVista), est = $('#detEstado'), lista = $('#detLista');
  $('#detTitulo').textContent = M.titulo;
  $('#mesTxt').textContent = `${MESES[mesVista.getMonth()]} ${mesVista.getFullYear()}`;
  lista.replaceChildren(); $('#detTotal').replaceChildren(); $('#detObj').hidden = true;
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  est.textContent = 'Cargando…';
  const { data, error } = await resumenDe(mesVista);
  if (error) { est.textContent = msgErr(error); return; }
  const datos = (data || []).slice().sort((a, b) => M.valor(b) - M.valor(a));
  if (!datos.length) { est.textContent = 'Sin datos para este mes todavía.'; return; }
  const ritmo = ritmoMes(r);
  est.textContent = r.actual
    ? `Del 1 al ${r.transcurridos} de ${MESES[mesVista.getMonth()]} (día ${r.transcurridos} de ${r.diasMes}). Ritmo esperado hoy: ${nf0.format(ritmo)}%.`
    : 'Mes completo.';

  const tot = $('#detTotal');
  tot.append(el('span', 'k', 'Equipo'), el('b', 'n', `${nf0.format(sumar(datos, M.valor))} ${M.unidad}`));
  if (modoDet === 'vol') tot.append(el('span', 'k', `Importe sin IVA: ${pesos.format(sumar(datos, v => Number(v.importe)))}`));
  else tot.append(el('span', 'k', 'suma de clientes con compra de cada vendedor'));

  for (const v of datos) {
    const valor = M.valor(v), obj = M.objetivo(v), card = el('div', 'v cob');
    const cab = el('div', 'cab'); cab.append(el('b', null, v.nombre));
    if (obj > 0) { const p = valor / obj * 100; const chip = el('span', 'chip ' + claseAvance(p, ritmo), `${nf0.format(p)}%`); cab.append(chip); }
    card.append(cab);
    const f = el('div', 'fila'); f.append(el('span', null, M.etiqueta), el('span', 'n', `${nf0.format(valor)} ${M.unidad}` + (obj > 0 ? ` de ${nf0.format(obj)}` : '')));
    card.append(f);
    if (obj > 0) card.append(barra(valor / obj * 100, ritmo));
    else card.append(el('small', null, 'Sin objetivo cargado'));
    if (modoDet === 'vol') {
      if (r.actual && valor > 0) card.append(el('small', null, `Ritmo: ${nf0.format(valor / r.transcurridos * r.diasMes)} bultos a fin de mes`));
      card.append(el('small', null, `Importe sin IVA: ${pesos.format(Number(v.importe))}`));
    } else {
      const cartera = Number(v.cartera);
      if (cartera > 0) {
        const p = valor / cartera * 100;
        const f2 = el('div', 'fila'); f2.append(el('span', null, 'Cobertura de cartera'), el('span', 'n', `${nf1.format(p)}%`));
        card.append(f2, barra(p, 100, 'neutra'), el('small', null, `${nf0.format(valor)} de ${nf0.format(cartera)} clientes en sus rutas`));
      }
    }
    lista.append(card);
  }

  // Carga de objetivos del indicador (solo jefes y administradores)
  const form = $('#objForm'); form.replaceChildren();
  const cab = el('div', 'orow ocab'); cab.append(el('span', null, 'Vendedor'), el('span', null, `Objetivo (${M.unidad})`));
  form.append(cab);
  for (const v of datos) {
    const row = el('div', 'orow'); row.dataset.id = v.id_vendedor;
    const inp = el('input', 'o-v'); inp.type = 'number'; inp.min = '0'; inp.inputMode = 'decimal'; inp.value = v[M.campo] ?? '';
    inp.setAttribute('aria-label', `Objetivo de ${M.unidad} de ${v.nombre}`);
    row.append(el('span', null, v.nombre), inp);
    form.append(row);
  }
  $('#objResumen').textContent = `Cargar objetivos de ${M.titulo.toLowerCase()} del mes`;
  $('#objMsg').textContent = '';
  $('#detObj').hidden = !esJefe;   // todos ven el avance; solo jefes y administradores cargan objetivos
}

async function guardarObjetivos() {
  const M = METRICAS[modoDet], r = rangoMes(mesVista), msg = $('#objMsg');
  const filas = [...document.querySelectorAll('#objForm .orow[data-id]')].map(row => {
    const x = row.querySelector('.o-v').value;
    return { periodo: r.periodo, id_vendedor: Number(row.dataset.id), [M.campo]: x === '' ? null : (modoDet === 'cob' ? parseInt(x, 10) : Number(x)) };
  });
  msg.className = 'msg'; msg.textContent = 'Guardando…';
  const { error } = await sb.from('objetivos').upsert(filas, { onConflict: 'periodo,id_vendedor' });
  if (error) { msg.className = 'msg err'; msg.textContent = 'No se pudo guardar: ' + error.message; return; }
  await cargarDetalle();
  cargarResumenTop();
  $('#detObj').open = true;
  $('#objMsg').className = 'msg'; $('#objMsg').textContent = 'Objetivos guardados.';
}

$('#mesAnt').addEventListener('click', () => { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() - 1, 1); cargarDetalle(); });
$('#mesSig').addEventListener('click', () => { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + 1, 1); cargarDetalle(); });
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
  const cli = n => `${nf0.format(n)} cliente${Number(n) === 1 ? '' : 's'}`;
  for (const { nombre, rutas } of porVend.values()) {
    const tot = rutas.reduce((s, x) => s + Number(x.clientes), 0);
    const bloque = el('div', 'rv');
    const cab = el('button', 'rv-cab'); cab.type = 'button';
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
document.querySelectorAll('[data-sub="rut"]').forEach(b => b.addEventListener('click', cargarRutas));

/* ---------- Calendario (Google Calendar) ---------- */
// Los calendarios se configuran en config.js (calendarios: [{ id, color }]). Se muestra el calendario de Google embebido:
// cada usuario lo ve si tiene permiso sobre ese calendario (ver "¿No ves los eventos?" en la solapa).
function montarCalendario() {
  const cals = (window.APP_CONFIG || {}).calendarios || [], f = $('#calFrame');
  if (!f || f.dataset.listo || !cals.length) return;
  const p = new URLSearchParams({ ctz: 'America/Argentina/Buenos_Aires', hl: 'es', wkst: '2', mode: innerWidth < 760 ? 'AGENDA' : 'MONTH', showTitle: '0', showPrint: '0', showTz: '0', showCalendars: '0', showTabs: '1' });
  let url = 'https://calendar.google.com/calendar/embed?' + p.toString();
  for (const c of cals) url += '&src=' + encodeURIComponent(c.id) + '&color=' + encodeURIComponent(c.color || '#0F766E');
  f.src = url; f.dataset.listo = '1';
}
document.querySelector('#tabs [data-tab="cal"]').addEventListener('click', montarCalendario);
