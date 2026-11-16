'use strict';
/* Avance por categoría (dentro del Resumen, sin contraseña).
   Kilos acumulados por categoría, proyección al cierre vs objetivo, comparación con el año y el mes anterior y kg/día necesarios.
   Los objetivos salen del Excel "Objetivos Plan Comercial Nestlé <mes>" (sección "Carga bot"); si el mes no está cargado se usan los del mes anterior. */

const CAT_NOMBRE = { BEBIDAS: 'Bebidas', HILERET: 'Hileret', CPW: 'CPW', CAFE: 'Café', FORMULAS: 'Fórmulas', CULINARIOS: 'Culinarios', CHOCOLATES: 'Chocolates', LACTEOS: 'Lácteos', 'ALIMENTO PARA MASCOTAS': 'Alimento para mascotas' };
const CAT_FUERA_NESTLE = new Set(['HILERET', 'ALIMENTO PARA MASCOTAS']);
const catNom = c => CAT_NOMBRE[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : '');

function catFila(c, info) {
  const acum = Number(c.kg_acum) || 0, obj = c.obj_kg != null ? Number(c.obj_kg) : null;
  const proy = proyectar(acum, info), base = proy == null ? acum : proy;
  const ant = Number(c.kg_mes_ant) || 0, anio = c.kg_anio_ant != null ? Number(c.kg_anio_ant) : null;
  const falta = obj != null ? Math.max(0, obj - acum) : null;
  return {
    cat: c.categoria, acum, proy: base, obj,
    pct: obj > 0 ? base / obj * 100 : null,
    vsAnio: anio > 0 ? (base / anio - 1) * 100 : null,
    vsMes: ant > 0 ? (base / ant - 1) * 100 : null,
    kgDia: falta == null ? null : info.restantes > 0 ? falta / info.restantes : (falta > 0 ? null : 0)
  };
}
function catSuma(filas, nombre, info) {
  const s = filas.reduce((a, f) => ({ acum: a.acum + f.acum, proy: a.proy + f.proy, obj: a.obj + (f.obj || 0), ant: a.ant + (f.ant || 0), anio: a.anio + (f.anio || 0), tieneAnio: a.tieneAnio && f.anio != null }), { acum: 0, proy: 0, obj: 0, ant: 0, anio: 0, tieneAnio: true });
  const falta = Math.max(0, s.obj - s.acum);
  return {
    cat: nombre, total: true, acum: s.acum, proy: s.proy, obj: s.obj,
    pct: s.obj > 0 ? s.proy / s.obj * 100 : null,
    vsAnio: s.tieneAnio && s.anio > 0 ? (s.proy / s.anio - 1) * 100 : null,
    vsMes: s.ant > 0 ? (s.proy / s.ant - 1) * 100 : null,
    kgDia: info.restantes > 0 ? falta / info.restantes : (falta > 0 ? null : 0)
  };
}

function catPctTxt(v) { return v == null ? '—' : `${v >= 0 ? '+' : '−'}${nf1.format(Math.abs(v))}%`; }

let catModo = 'kg';   // 'kg' | 'ccc'
const SEG_NOMBRE = { 'CAPSULAS DG': 'Cápsulas DG', TORRADOS: 'Torrados', 'BEBIDAS POLVO': 'Bebidas Polvo' };
document.querySelectorAll('[data-cm]').forEach(b => b.addEventListener('click', () => {
  catModo = b.dataset.cm;
  document.querySelectorAll('[data-cm]').forEach(x => x.classList.toggle('on', x === b));
  cargarCategorias();
}));

async function cargarCategorias() {
  if (catModo === 'ccc') return cargarCCC();
  const cont = $('#catCont'), est = $('#catEstado');
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  await cargarFeriados();
  const info = infoMes(mesRes);
  est.textContent = 'Cargando…'; cont.replaceChildren(); $('#catCards').replaceChildren();
  const { data, error } = await sb.rpc('categorias_avance', { desde: iso(info.ini), hasta: iso(info.fin) });
  if (error) { est.textContent = msgErr(error); return; }
  const filas = (data || []).filter(c => c.categoria).map(c => Object.assign(catFila(c, info), { ant: Number(c.kg_mes_ant) || 0, anio: c.kg_anio_ant != null ? Number(c.kg_anio_ant) : null }));
  if (!filas.length || filas.every(f => !f.acum)) { est.textContent = 'Todavía no hay ventas por categoría para este mes.'; return; }

  const hoy = new Date(), corte = info.estado === 'en curso' ? hoy : info.fin;
  est.textContent = `Al ${corte.toLocaleDateString('es-AR')} · día hábil ${info.trab} de ${info.habiles} · kilos por categoría`;
  const anioAnt = new Date(mesRes.getFullYear() - 1, mesRes.getMonth(), 1), mesAnt = new Date(mesRes.getFullYear(), mesRes.getMonth() - 1, 1);
  const etAnio = `${NOMBRE_MES(anioAnt).slice(0, 3)} ${String(anioAnt.getFullYear()).slice(2)}`, etMes = `${NOMBRE_MES(mesAnt).slice(0, 3)} ${String(mesAnt.getFullYear()).slice(2)}`;

  filas.sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  const total = catSuma(filas, 'Total', info), nestle = catSuma(filas.filter(f => !CAT_FUERA_NESTLE.has(f.cat)), 'Nestlé (sin Hileret ni Mascotas)', info);
  const atraso = filas.filter(f => f.pct != null && f.pct < 100);
  const est2 = p => (p == null ? 'nd' : p >= 100 ? 'ok' : 'bajo');

  // Tarjetas
  const linCmp = t => `vs ${etAnio} ${catPctTxt(t.vsAnio)} · vs ${etMes} ${catPctTxt(t.vsMes)}`;
  const ltxt = el('div', 'k-lin', atraso.map(f => `${catNom(f.cat)} ${nf1.format(f.pct)}%`).join(' · ') || 'Todas en ritmo');
  $('#catCards').replaceChildren(
    tarjeta('Total', `${total.pct == null ? '—' : nf1.format(total.pct) + '%'}`, total.pct, [`Proyección ${nf1.format(total.proy)} de ${nf1.format(total.obj)} kg`, linCmp(total)], '', est2(total.pct)),
    tarjeta('Nestlé sin Hileret ni Mascotas', `${nestle.pct == null ? '—' : nf1.format(nestle.pct) + '%'}`, nestle.pct, [`Proyección ${nf1.format(nestle.proy)} de ${nf1.format(nestle.obj)} kg`, linCmp(nestle)], '', est2(nestle.pct)),
    tarjeta('Categorías en atraso', String(atraso.length), null, [ltxt], 'sin-medidor')
  );

  // Tabla
  const tabla = el('div', 'cat-tabla'), cab = el('div', 'cat-tr cab');
  for (const t of ['Categoría', 'Kg acum.', 'Kg proy.', 'Objetivo', 'Proy. vs obj.', '', `vs año ant. (${etAnio})`, `vs mes ant. (${etMes})`, 'Kg/día nec.', 'Estado']) cab.append(el('span', null, t));
  tabla.append(cab);
  const fila = f => {
    const e = est2(f.pct), r = el('div', 'cat-tr' + (f.total ? ' total' : '') + (f.cat.startsWith('Nestlé') ? ' sub' : ''));
    const barra = el('span', 'cat-barra'), i = el('i', e), m = el('u');
    i.style.width = f.pct == null ? '0%' : Math.min(100, Math.max(0, f.pct) / 130 * 100) + '%'; m.style.left = (100 / 130 * 100) + '%'; barra.append(i, m);
    const col = v => el('span', 'num ' + (v == null ? '' : v >= 0 ? 'sube' : 'baja'), catPctTxt(v));
    r.append(el('span', 'nom', f.total ? f.cat : catNom(f.cat)), el('span', 'num', nf1.format(f.acum)), el('span', 'num', nf1.format(f.proy)),
      el('span', 'num', f.obj != null ? nf1.format(f.obj) : '—'), el('b', 'num ' + e, f.pct == null ? '—' : nf1.format(f.pct) + '%'), barra, col(f.vsAnio), col(f.vsMes),
      el('span', 'num', f.kgDia == null ? '—' : nf1.format(f.kgDia)), el('span', 'cat-est ' + e, e === 'ok' ? 'En ritmo' : e === 'bajo' ? 'Atrasado' : '—'));
    return r;
  };
  for (const f of filas) tabla.append(fila(f));
  tabla.append(fila(total), fila(nestle));
  cont.replaceChildren(tabla);
  const sinAnio = filas.some(f => f.anio == null);
  $('#catNota').textContent = `Proyección = acumulado ÷ días hábiles trabajados × días hábiles del mes. En ritmo si la proyección llega al 100% del objetivo. Kg/día nec. = kilos que faltan ÷ días hábiles restantes.` +
    (sinAnio ? ` La comparación con ${etAnio} aparece cuando se cargue ese mes.` : '') +
    (filas.some(f => f.obj == null) ? ' Hay categorías sin objetivo cargado.' : '');
}

// Se recarga cuando se abre la vista o cambia el mes
const _cargarResumenCat = cargarResumen;
cargarResumen = async function () { await _cargarResumenCat(); if (vistaRes === 'cat') cargarCategorias(); };

/* ---------- Clientes con compra por categoría y por segmento del plan Nestlé ---------- */
async function cargarCCC() {
  const cont = $('#catCont'), est = $('#catEstado');
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  await cargarFeriados();
  const info = infoMes(mesRes);
  est.textContent = 'Cargando…'; cont.replaceChildren(); $('#catCards').replaceChildren();
  const { data, error } = await sb.rpc('ccc_avance', { desde: iso(info.ini), hasta: iso(info.fin) });
  if (error) { est.textContent = msgErr(error); return; }
  const corte = info.estado === 'en curso' ? new Date() : info.fin;
  est.textContent = `Al ${corte.toLocaleDateString('es-AR')} · día hábil ${info.trab} de ${info.habiles} · clientes que compraron en cada categoría (neto positivo en el mes)`;
  const mesAnt = new Date(mesRes.getFullYear(), mesRes.getMonth() - 1, 1), etMes = `${NOMBRE_MES(mesAnt).slice(0, 3)} ${String(mesAnt.getFullYear()).slice(2)}`;
  const calc = r => {
    const acum = Number(r.ccc) || 0, ant = Number(r.ccc_mes_ant) || 0, obj = r.obj != null ? Number(r.obj) : null, p = proyectar(acum, info), base = p == null ? acum : p;
    const falta = obj != null ? Math.max(0, obj - acum) : null;
    return { clave: r.clave, tipo: r.tipo, acum, proy: base, obj, ant, pct: obj > 0 ? base / obj * 100 : null, vsMes: ant > 0 ? (base / ant - 1) * 100 : null,
      dia: falta == null ? null : info.restantes > 0 ? falta / info.restantes : (falta > 0 ? null : 0) };
  };
  const filas = (data || []).map(calc);
  const cats = filas.filter(f => f.tipo === 'cat').sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999) || b.acum - a.acum);
  const segs = filas.filter(f => f.tipo === 'seg').sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  if (!cats.length && !segs.some(f => f.acum)) { est.textContent = 'Todavía no hay ventas por categoría para este mes.'; return; }
  const est2 = p => (p == null ? 'nd' : p >= 100 ? 'ok' : 'bajo');

  $('#catCards').replaceChildren(...segs.map(f => tarjeta(`CCC ${SEG_NOMBRE[f.clave] || f.clave}`, nf0.format(f.acum), f.pct == null ? null : f.pct,
    [f.obj != null ? `Objetivo ${nf0.format(f.obj)} clientes · proyección ${nf0.format(f.proy)}` : 'Sin objetivo cargado', `vs ${etMes} ${catPctTxt(f.vsMes)}`], '', est2(f.pct))));

  const tabla = el('div', 'cat-tabla'), cab = el('div', 'cat-tr ccc cab');
  for (const t of ['Categoría', 'Clientes acum.', 'Clientes proy.', 'Objetivo', 'Proy. vs obj.', '', `vs mes ant. (${etMes})`, 'Clientes/día nec.', 'Estado']) cab.append(el('span', null, t));
  tabla.append(cab);
  const fila = (f, nombre) => {
    const e = est2(f.pct), r = el('div', 'cat-tr ccc');
    const barra = el('span', 'cat-barra'), i = el('i', e), m = el('u');
    i.style.width = f.pct == null ? '0%' : Math.min(100, Math.max(0, f.pct) / 130 * 100) + '%'; m.style.left = (100 / 130 * 100) + '%'; barra.append(i, m);
    r.append(el('span', 'nom', nombre), el('span', 'num', nf0.format(f.acum)), el('span', 'num', nf0.format(f.proy)), el('span', 'num', f.obj != null ? nf0.format(f.obj) : '—'),
      el('b', 'num ' + e, f.pct == null ? '—' : nf1.format(f.pct) + '%'), barra, el('span', 'num ' + (f.vsMes == null ? '' : f.vsMes >= 0 ? 'sube' : 'baja'), catPctTxt(f.vsMes)),
      el('span', 'num', f.dia == null ? '—' : nf0.format(Math.ceil(f.dia))), el('span', 'cat-est ' + e, e === 'ok' ? 'En ritmo' : e === 'bajo' ? 'Atrasado' : '—'));
    return r;
  };
  const sec = t => el('div', 'cat-sec', t);
  tabla.append(sec('Por categoría'), ...cats.map(f => fila(f, catNom(f.clave))), sec('Segmentos del plan Nestlé'), ...segs.map(f => fila(f, SEG_NOMBRE[f.clave] || f.clave)));
  cont.replaceChildren(tabla);
  $('#catNota').textContent = 'Cliente con compra = compró esa categoría o segmento en el mes (neto positivo, sin contar devoluciones). Los segmentos del plan (Cápsulas DG, Torrados sin la presentación de 40 g y Bebidas Polvo) tienen objetivo de Nestlé; las categorías todavía no tienen objetivo de clientes cargado.' +
    ' La proyección sigue el mismo ritmo que los kilos.';
}
