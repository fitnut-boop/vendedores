/* Apartado especial de Brenda (dentro de Vendedores): su esquema propio de cobertura al 70%.
   Grupo A = rutas 502 y 512 (cobertura simple) · Grupo B = rutas 501/503/504/505 (comprador calificado = 5 o más segmentos).
   Lo ven el supervisor, los jefes y la propia Brenda. */
const BRE_ID_VENDEDOR = 5, BRE_OBJ = 70, BRE_MIN_SEG = 5;

function puedeVerBrenda() { return !!perfilActual && (esJefe || perfilActual.idVendedor === BRE_ID_VENDEDOR); }
function menuBrenda() { const b = $('#menuBre'); if (b) b.hidden = !puedeVerBrenda(); }
document.addEventListener('tabcambio', e => { if (e.detail === 'vend') menuBrenda(); });
menuBrenda();

async function cargarBrenda() {
  const cont = $('#breCont'), est = $('#breEstado');
  cont.replaceChildren();
  if (!sb || !puedeVerBrenda()) { est.textContent = 'Solo el supervisor, los jefes y Brenda pueden ver esta métrica.'; return; }
  est.textContent = 'Cargando…';
  await cargarFeriados();
  const hoy = new Date(), ini = primerDia(hoy), fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0), info = infoMes(ini);
  const { data, error } = await sb.rpc('brenda_metrica', { desde: iso(ini), hasta: iso(fin) });
  if (error) { est.textContent = /Solo el supervisor/i.test(error.message) ? 'Solo el supervisor, los jefes y Brenda pueden ver esta métrica.' : msgErr(error); return; }
  est.textContent = `${NOMBRE_MES(ini)} ${ini.getFullYear()} · día hábil ${info.trab} de ${info.habiles}${info.restantes ? ` · quedan ${info.restantes}` : ''}`;

  const A = data.A, B = data.B, segs = data.segmentos || [];
  const falta = (activos, logrados) => Math.max(0, Math.ceil(activos * BRE_OBJ / 100) - logrados);

  // ----- cómo se mide -----
  const how = el('div', 'bre-how');
  how.append(el('h3', null, 'Cómo se mide'), el('p', null, `Tu cobertura se mide en dos grupos de rutas y el objetivo de cada uno es el ${BRE_OBJ}% de los clientes activos de esas rutas.`));
  const ul = el('ul'); [
    `Grupo A (rutas 502 y 512): cuenta cada cliente que compró cualquier artículo en el mes.`,
    `Grupo B (rutas 501, 503, 504 y 505): solo cuenta el cliente "calificado", el que compró en ${BRE_MIN_SEG} o más segmentos (${segs.length ? segs.join(', ').toLowerCase() : 'bebidas, café, chocolates, etc.'}).`
  ].forEach(t => ul.append(el('li', null, t)));
  how.append(ul); cont.append(how);

  // ----- tarjetas de los dos grupos -----
  const grupo = (titulo, sub, activos, logrados, etiquetaLogro) => {
    const pct = activos ? logrados / activos * 100 : 0, ok = pct >= BRE_OBJ, need = falta(activos, logrados);
    const c = el('section', 'bre-card');
    c.append(el('small', null, sub), el('h3', null, titulo));
    const fila = el('div', 'bre-num'); fila.append(el('b', ok ? 'ok' : (pct >= BRE_OBJ * 0.85 ? 'med' : 'bajo'), `${nf1.format(pct)}%`), el('span', null, `${nf0.format(logrados)} ${etiquetaLogro} de ${nf0.format(activos)} clientes activos`));
    const bar = el('div', 'bre-barra'), rel = el('i', ok ? 'ok' : (pct >= BRE_OBJ * 0.85 ? 'med' : 'bajo')), marca = el('u'); rel.style.width = Math.min(100, pct) + '%'; marca.style.left = BRE_OBJ + '%'; bar.append(rel, marca);
    c.append(fila, bar, el('p', 'hint', `Objetivo: ${BRE_OBJ}% (${nf0.format(Math.ceil(activos * BRE_OBJ / 100))} clientes). ${ok ? '¡Objetivo cumplido!' : `Te faltan ${nf0.format(need)} cliente${need === 1 ? '' : 's'} para llegar.`}`));
    return c;
  };
  const tarjetas = el('div', 'bre-grid');
  tarjetas.append(
    grupo('Grupo A · rutas 502 y 512', 'COBERTURA', A.activos, A.compraron, 'compraron'),
    grupo('Grupo B · rutas 501, 503, 504 y 505', `COBERTURA CALIFICADA (${BRE_MIN_SEG}+ SEGMENTOS)`, B.activos, B.calificados, 'calificados'));
  cont.append(tarjetas);

  // ----- grupo A: clientes -----
  const detA = el('details', 'bre-det'); detA.open = true;
  detA.append(el('summary', null, `Grupo A · clientes (${A.compraron} compraron, ${A.activos - A.compraron} sin compra)`));
  const lA = el('div', 'bre-lista');
  for (const c of A.clientes || []) { const f = el('div', 'bre-fila ' + (c.compro ? 'si' : 'no')); f.append(el('i', null, c.compro ? '✓' : '✗'), el('span', null, `${c.razon}`), el('small', null, `N° ${c.id} · ruta ${c.ruta}`)); lA.append(f); }
  detA.append(lA); cont.append(detA);

  // ----- grupo B: distribución y tabla por segmento -----
  const detB = el('details', 'bre-det'); detB.open = true;
  detB.append(el('summary', null, `Grupo B · ${B.compradores} compradores, ${B.calificados} calificados`));
  const dist = el('div', 'bre-dist');
  const cnt = Array.from({ length: segs.length + 1 }, () => 0);
  (B.clientes || []).filter(c => c.compro).forEach(c => { cnt[Math.min(c.n, cnt.length - 1)]++; });
  const maxC = Math.max(1, ...cnt.slice(1));
  for (let n = 1; n < cnt.length; n++) {
    const f = el('div', 'bre-d ' + (n >= BRE_MIN_SEG ? 'ok' : '')); const barra = el('i'); barra.style.height = (cnt[n] / maxC * 60 + 4) + 'px';
    f.append(el('b', null, String(cnt[n])), barra, el('small', null, `${n} seg.`)); dist.append(f);
  }
  detB.append(el('p', 'hint', 'Clientes compradores según cuántos segmentos compraron (en verde, los que califican).'), dist);
  const tabla = el('div', 'bre-tabla');
  const cols = `minmax(170px,1.6fr) 36px repeat(${Math.max(segs.length, 1)},minmax(52px,1fr))`;
  const cab = el('div', 'bre-tr cab'); cab.style.gridTemplateColumns = cols; cab.append(el('span', null, 'Cliente'), el('span', null, 'Seg.'));
  segs.forEach(s => cab.append(el('span', 'seg', s.slice(0, 10)))); tabla.append(cab);
  for (const c of B.clientes || []) {
    const f = el('div', 'bre-tr ' + (c.n >= BRE_MIN_SEG ? 'ok' : c.compro ? 'med' : 'no'));
    f.style.gridTemplateColumns = cols;
    f.append(el('span', null, `${c.razon}`), el('b', null, String(c.n)));
    segs.forEach(s => f.append(el('span', 'seg', (c.segs || []).includes(s) ? '✓' : '')));
    tabla.append(f);
  }
  detB.append(tabla, el('p', 'hint', 'Verde = califica (5 o más segmentos) · Amarillo = compró pero menos de 5 · Rojo = no compró.')); cont.append(detB);
}

document.querySelectorAll('[data-sub="bre"]').forEach(b => b.addEventListener('click', cargarBrenda));
