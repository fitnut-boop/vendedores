'use strict';
/* Acciones comerciales y combos (se cargan solos desde los Excel de Drive).
   1) Apartado "Acciones y combos vigentes" junto a la lista de precios y el catálogo, por segmento y proveedor.
   2) Cotizador: SUGIERE el descuento (no lo aplica solo) cuando los productos cargados cumplen el mínimo de una acción vigente.
   Regla de los mínimos: acciones FitNut (regla "combinada") = el mínimo se cuenta sumando los productos del mismo grupo;
   acciones Nestlé / Purina (regla "producto") = el mínimo es por producto. La bonificación de Nestlé se suma a la de FitNut. */

let ACC = { filas: [], combos: [], meta: [] };
let accCargado = false;
const ACC_SEG = { GENERAL: 'General', AASS: 'Autoservicios', MAYORISTA: 'Mayorista / Distribuidora' };
const ACC_PROV = { NESTLE: 'Nestlé', PURINA: 'Purina', HILERET: 'Hileret' };
let accSeg = 'GENERAL', accProv = 'TODOS', accVencidas = false;

const accHoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const accFechaTxt = f => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) : '');
const accPct = n => (n == null ? '' : `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(n))}%`);

async function cargarAcciones() {
  if (accCargado || !sb) return;
  const { data, error } = await sb.rpc('acciones_publicas');
  if (error || !data) return;
  ACC = { filas: data.filas || [], combos: data.combos || [], meta: data.meta || [] };
  accCargado = true;
  if (typeof rows !== 'undefined') accSugerir();
  if (!$('#sub-lp').hidden) pintarAcciones();
}

// Bonificación efectiva hoy de una fila: la parte Nestlé vence en su fecha; la parte FitNut sigue vigente mientras esté el archivo.
// Un archivo de hace más de 3 meses se considera desactualizado: no se sugiere ni se muestra como vigente
function accViejo(periodo) {
  const d = new Date(); d.setMonth(d.getMonth() - 3);
  return String(periodo || '') < d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}
function accEfectiva(f) {
  const hoy = accHoy(), venceNestle = f.nestle_hasta && f.nestle_hasta < hoy;
  const fit = Number(f.bonif_fitnut) || 0, ad = venceNestle ? 0 : (Number(f.bonif_adicional) || 0);
  const viejo = accViejo(f.periodo);
  const vencida = viejo || (fit + ad === 0 && (Number(f.bonif_total) || 0) > 0);
  return { fit: viejo ? 0 : fit, ad: viejo ? 0 : ad, total: viejo ? 0 : fit + ad, vencida, venceNestle, viejo };
}

/* ---------- apartado de consulta ---------- */
function pintarAcciones() {
  const cont = $('#accCont');
  if (!cont) return;
  cont.replaceChildren();
  const hay = ACC.filas.length;
  const meta = ACC.meta.filter(m => accProv === 'TODOS' || m.proveedor === accProv);
  $('#accInfo').textContent = hay
    ? 'Archivos: ' + ACC.meta.map(m => `${ACC_PROV[m.proveedor] || m.proveedor} ${m.periodo.slice(5, 7)}/${m.periodo.slice(0, 4)}`).join(' · ') + '. Se actualizan solos desde la carpeta de Drive.'
    : 'Todavía no hay acciones cargadas.';
  const provs = [...new Set(ACC.filas.map(f => f.proveedor))];
  const sel = $('#accProv'); sel.replaceChildren();
  for (const p of ['TODOS', ...provs]) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.p = p; b.textContent = p === 'TODOS' ? 'Todos' : (ACC_PROV[p] || p);
    if (p === accProv) b.className = 'on';
    b.addEventListener('click', () => { accProv = p; pintarAcciones(); });
    sel.append(b);
  }
  document.querySelectorAll('#accSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === accSeg));
  if (!hay) return;

  const hoy = accHoy();
  const filas = ACC.filas.filter(f => f.segmento === accSeg && (accProv === 'TODOS' || f.proveedor === accProv))
    .map(f => ({ f, e: accEfectiva(f) })).filter(x => accVencidas || !x.e.vencida);
  const combos = ACC.combos.filter(c => c.segmento === accSeg && (accProv === 'TODOS' || c.proveedor === accProv) && (accVencidas || ((!c.hasta || c.hasta >= hoy) && !accViejo(c.periodo))));

  // Combos
  const h1 = document.createElement('h4'); h1.className = 'acc-h'; h1.textContent = `Combos (${combos.length})`; cont.append(h1);
  if (!combos.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No hay combos vigentes para este segmento.'; cont.append(p); }
  for (const c of combos) cont.append(tarjetaCombo(c, hoy));

  // Acciones por proveedor y categoría
  const h2 = document.createElement('h4'); h2.className = 'acc-h'; h2.textContent = `Acciones (${filas.length} productos)`; cont.append(h2);
  if (!filas.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No hay acciones vigentes para este segmento.'; cont.append(p); }
  const porProv = new Map();
  for (const x of filas) { const k = x.f.proveedor; (porProv.get(k) || porProv.set(k, []).get(k)).push(x); }
  for (const [prov, xs] of porProv) {
    const sec = document.createElement('section'); sec.className = 'acc-prov';
    const t = document.createElement('h5'); t.textContent = ACC_PROV[prov] || prov; sec.append(t);
    const porCat = new Map();
    for (const x of xs) { const k = x.f.categoria || 'Otros'; (porCat.get(k) || porCat.set(k, []).get(k)).push(x); }
    for (const [cat, items] of porCat) {
      const det = document.createElement('details'); det.className = 'acc-cat'; det.open = true;
      const sm = document.createElement('summary'); sm.textContent = `${cat.charAt(0) + cat.slice(1).toLowerCase()} (${items.length})`; det.append(sm);
      const tab = document.createElement('div'); tab.className = 'acc-tabla';
      const cab = document.createElement('div'); cab.className = 'acc-tr cab';
      for (const h of ['Producto', 'Mínimo', 'Precio lista c/IVA', 'Bonif.', 'Precio con acción', 'PVP sug.', 'Condición']) { const s = document.createElement('span'); s.textContent = h; cab.append(s); }
      tab.append(cab);
      for (const { f, e } of items) tab.append(filaAccion(f, e));
      det.append(tab); sec.append(det);
    }
    cont.append(sec);
  }
}

function filaAccion(f, e) {
  const r = document.createElement('div'); r.className = 'acc-tr' + (e.vencida ? ' vencida' : '');
  const celda = (txt, cls) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = txt; return s; };
  const conAccion = e.total > 0 ? Number(f.costo) * (1 - e.total / 100) : Number(f.costo);
  const cond = [];
  if (f.regla === 'combinada') cond.push(`Mínimo ${nf0.format(f.unidades_min)} u combinadas${f.grupo ? ' (grupo ' + f.grupo + ')' : ''}${f.chess_id ? ' · acción ' + f.chess_id : ''}`);
  else cond.push(`Mínimo ${nf0.format(f.unidades_min)} u por producto${f.chess_id ? ' · acción ' + f.chess_id : ''}`);
  if (e.viejo) cond.push('Archivo desactualizado (' + String(f.periodo).slice(5, 7) + '/' + String(f.periodo).slice(0, 4) + ')');
  if (f.nestle_hasta) cond.push(`Nestlé ${Number(f.bonif_adicional)}% ${e.venceNestle ? 'vencida el' : 'hasta'} ${accFechaTxt(f.nestle_hasta)}`);
  r.append(celda(f.producto, 'nom'), celda(nf0.format(f.unidades_min), 'num'), celda(money(f.costo), 'num'), celda(e.total ? accPct(e.total) : '—', 'num b'),
    celda(money(conAccion), 'num b'), celda(f.pvp ? money(f.pvp) : '—', 'num'), celda(cond.join(' · '), 'cond'));
  return r;
}

function tarjetaCombo(c, hoy) {
  const box = document.createElement('article'); box.className = 'acc-combo' + (c.hasta && c.hasta < hoy ? ' vencida' : '');
  const cab = document.createElement('div'); cab.className = 'acc-combo-cab';
  const t = document.createElement('b'); t.textContent = `${c.nombre}`;
  const v = document.createElement('small'); v.textContent = `${ACC_PROV[c.proveedor] || c.proveedor} · código ${c.codigo}${c.hasta ? ' · ' + (c.hasta < hoy ? 'venció el ' : 'hasta el ') + accFechaTxt(c.hasta) : ''}`;
  const izq = document.createElement('div'); izq.append(t, v); cab.append(izq);
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ghost'; btn.textContent = 'Agregar al cotizador';
  btn.addEventListener('click', () => agregarComboACotizador(c));
  cab.append(btn); box.append(cab);
  const tab = document.createElement('div'); tab.className = 'acc-tabla';
  const h = document.createElement('div'); h.className = 'acc-tr combo cab';
  for (const x of ['Artículo', 'Unidades', 'Costo unit.', 'Bonif.', 'Subtotal']) { const s = document.createElement('span'); s.textContent = x; h.append(s); }
  tab.append(h);
  for (const l of c.lineas || []) {
    const r = document.createElement('div'); r.className = 'acc-tr combo';
    for (const [x, cls] of [[l.articulo, 'nom'], [nf0.format(l.unidades || 0), 'num'], [l.costo != null ? money(l.costo) : '—', 'num'], [l.bonif ? accPct(l.bonif) : '—', 'num'], [l.subtotal != null ? money(l.subtotal) : 'sin precio', 'num']]) { const s = document.createElement('span'); s.className = cls; s.textContent = x; r.append(s); }
    tab.append(r);
  }
  const tot = document.createElement('div'); tot.className = 'acc-tr combo tot';
  const a = document.createElement('span'); a.className = 'nom'; a.textContent = 'Total del combo (c/IVA)';
  const b2 = document.createElement('span'); b2.className = 'num'; b2.textContent = c.total != null ? money(c.total) : '—';
  tot.append(a, document.createElement('span'), document.createElement('span'), document.createElement('span'), b2);
  tab.append(tot); box.append(tab);
  return box;
}

// Pasa los artículos del combo al cotizador (con la bonificación del combo) y abre el cotizador
function agregarComboACotizador(c) {
  const vacia = rows.filter(r => !r.item && !r.inputs.iBul.value);
  vacia.forEach(r => { rows.splice(rows.indexOf(r), 1); r.el.remove(); });
  for (const l of c.lineas || []) addRow({ c: String(l.id), b: l.unidades || '', bo: l.bonif || '' });
  elSeg.value = c.segmento === 'MAYORISTA' ? 'm' : 'g'; elSeg.dispatchEvent(new Event('change'));
  totals();
  irA('cot');
}

document.querySelectorAll('#accSeg button').forEach(b => b.addEventListener('click', () => { accSeg = b.dataset.s; pintarAcciones(); }));
$('#accVencidas')?.addEventListener('change', e => { accVencidas = e.target.checked; pintarAcciones(); });
document.querySelectorAll('[data-sub="lp"]').forEach(b => b.addEventListener('click', () => { cargarAcciones().then(pintarAcciones); pintarAcciones(); }));

/* ---------- cotizador: sugerir el descuento ---------- */
function accTipoActual() {
  const t = $('#accTipo') ? $('#accTipo').value : 'auto';
  if (t !== 'auto') return t;
  return elSeg.value === 'm' ? 'MAYORISTA' : 'GENERAL';
}

function accSugerir() {
  if (typeof rows === 'undefined' || !ACC.filas.length) return;
  const seg = accTipoActual(), hoy = accHoy();
  // acción de cada fila de la cotización
  const info = rows.map(r => {
    if (!r.item) return null;
    const id = Number(r.item.c), f = ACC.filas.find(x => x.segmento === seg && x.id_articulo === id);
    if (!f) return null;
    const e = accEfectiva(f);
    if (e.total <= 0) return null;
    const eq = qty(r.inputs.iBul.value) + qty(r.inputs.iUni.value) / (r.item.u || 1);
    return { r, f, e, eq };
  });
  // total de bultos por grupo (mínimo combinado)
  const grupos = new Map();
  for (const x of info) if (x && x.f.regla === 'combinada') { const k = x.f.proveedor + '|' + x.f.chess_id; grupos.set(k, (grupos.get(k) || 0) + x.eq); }

  info.forEach((x, i) => {
    const r = rows[i], cel = r.el.querySelector('.c-bon');
    let chip = cel.querySelector('.o-sug');
    if (!x) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('small'); chip.className = 'o-sug'; cel.append(chip); }
    const { f, e, eq } = x, min = Number(f.unidades_min) || 1;
    const tengo = f.regla === 'combinada' ? (grupos.get(f.proveedor + '|' + f.chess_id) || 0) : eq;
    const cumpleFit = e.fit > 0 && tengo >= min - 1e-9;
    const cumpleAd = e.ad > 0 && eq >= (f.regla === 'combinada' ? 1 : min) - 1e-9;
    const pct = (cumpleFit ? e.fit : 0) + (cumpleAd ? e.ad : 0);
    const actual = qty(r.inputs.iBon.value);
    chip.replaceChildren();
    if (eq <= 0) { chip.hidden = true; return; }
    chip.hidden = false;
    if (pct > 0) {
      chip.className = 'o-sug ok';
      const txt = document.createElement('span'); txt.textContent = `Acción vigente: ${accPct(pct)}${f.regla === 'combinada' && f.grupo ? ' · grupo ' + f.grupo : ''}`;
      chip.append(txt);
      if (Math.abs(actual - pct) > 0.001) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = `Aplicar ${accPct(pct)}`;
        b.addEventListener('click', () => { r.inputs.iBon.value = pct; r.refresh(); });
        chip.append(' ', b);
      } else chip.append(' ✓ aplicada');
    } else if (e.fit > 0 && !cumpleFit) {
      chip.className = 'o-sug falta';
      const faltan = Math.max(0, min - tengo);
      chip.textContent = f.regla === 'combinada'
        ? `Llevando ${nf0.format(min)} u combinadas (grupo ${f.grupo || f.chess_id}) hay ${accPct(e.fit)}${e.ad ? ' + ' + accPct(e.ad) : ''} · te faltan ${nf2(faltan)}`
        : `Con ${nf0.format(min)} u hay ${accPct(e.fit + e.ad)} · te faltan ${nf2(faltan)}`;
    } else chip.hidden = true;
  });
}

// El cotizador recalcula los totales cada vez que algo cambia: de ahí se actualizan las sugerencias
const _totalesAcc = totals;
totals = function () { const r = _totalesAcc.apply(this, arguments); try { accSugerir(); } catch { /* sin acciones */ } return r; };
$('#accTipo')?.addEventListener('change', () => accSugerir());
document.addEventListener('tabcambio', e => { if (e.detail === 'cot') accSugerir(); });
cargarAcciones();
