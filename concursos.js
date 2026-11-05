/* Concursos: Fórmula N (Nestlé) · GEN Interior. Avance por segmento calculado con las ventas por artículo que trae la API de Chess. */
const CONC_VARS = [
  { k: 'polvo', et: 'CCC Bebidas en polvo', det: 'Nesquik Original, Menos Azúcar 300 g y 150 g', pts: 1 },
  { k: 'potenciador', et: 'Bonus · Potenciador Nesquik Menos Azúcar 150 g', det: 'Suma +1 punto', pts: 1 },
  { k: 'cafe', et: 'CCC Café torrados', det: 'Dolca Original y Suave', pts: 1 },
  { k: 'nido', et: 'CCC Nido Gums', det: 'Incluye Nido Vainilla RTD', pts: 1 },
  { k: 'total', et: 'CNC Total canales', det: 'Todos los SKU Nestlé cuentan', pts: 1 }
];
const PREMIO_MAX = 150000;
const pesos = n => '$ ' + new Intl.NumberFormat('es-AR').format(Math.round(n));

async function cargarConcursos() {
  const cont = $('#conc');
  if (!cont || !sb) return;
  cont.replaceChildren(el('p', 'hint', 'Cargando…'));
  const info = infoMes(mesObj), periodo = iso(mesObj);
  const [av, ob, sk, cfg] = await Promise.all([
    sb.rpc('concurso_avance', { desde: iso(info.ini), hasta: iso(info.fin) }),
    sb.from('concurso_objetivos').select('segmento,id_vendedor,objetivo').eq('periodo', periodo),
    sb.from('concurso_skus').select('segmento,id_articulo,nota').order('segmento').order('id_articulo'),
    sb.from('vendedores_config').select('id,nombre_mostrar,orden').order('orden')
  ]);
  const err = av.error || ob.error || sk.error;
  if (err) { cont.replaceChildren(el('p', 'hint', msgErr(err))); return; }
  const real = new Map(), vend = new Map();   // real: segmento → clientes (total distribuidora); vend: id → {segmento → clientes}
  for (const r of av.data || []) {
    if (r.id_vendedor == null) real.set(r.segmento, Number(r.clientes));
    else (vend.get(r.id_vendedor) || vend.set(r.id_vendedor, {}).get(r.id_vendedor))[r.segmento] = Number(r.clientes);
  }
  const obj = new Map((ob.data || []).filter(o => o.id_vendedor === 0).map(o => [o.segmento, Number(o.objetivo)]));

  cont.replaceChildren();
  const mes = `${NOMBRE_MES(mesObj)} ${mesObj.getFullYear()}`;
  const intro = el('div', 'conc-intro');
  intro.append(el('h3', null, `Fórmula N · GEN Interior · ${mes}`),
    el('p', 'hint', 'Cada variable suma 1 punto si se llega al objetivo (clientes con compra). Para ganar el premio de $150.000 en gift card hay que llegar al objetivo en todas las variables (5 de 5 puntos).'));
  cont.append(intro);

  // ----- variables -----
  let puntos = 0;
  const lista = el('div', 'conc-vars');
  for (const v of CONC_VARS) {
    const r = real.get(v.k) || 0, o = obj.get(v.k) || 0, ok = o > 0 && r >= o, pct = o > 0 ? r / o * 100 : null;
    if (ok) puntos += v.pts;
    const f = el('div', 'conc-var' + (ok ? ' ok' : ''));
    const izq = el('div', 'conc-izq'); izq.append(el('b', null, v.et), el('small', null, v.det));
    const barra = el('div', 'conc-barra'); const rel = el('i'); rel.style.width = Math.min(100, pct || 0) + '%'; barra.append(rel);
    const der = el('div', 'conc-der');
    der.append(el('span', 'conc-real', nf0.format(r)), el('small', null, o > 0 ? `de ${nf0.format(o)} · ${nf0.format(pct)}%` : 'sin objetivo cargado'));
    const chip = el('span', 'conc-pto' + (ok ? ' on' : ''), ok ? `+${v.pts} punto` : (o > 0 ? `faltan ${nf0.format(o - r)} clientes` : '—'));
    f.append(izq, barra, der, chip); lista.append(f);
  }
  cont.append(lista);

  const total = CONC_VARS.reduce((s, v) => s + v.pts, 0), frac = puntos / total;
  const premio = puntos === total ? PREMIO_MAX : 0;   // hay que llegar al objetivo en TODAS las variables para ganar
  const res = el('div', 'conc-res');
  const kv = (et, val, cls) => { const d = el('div'); d.append(el('small', null, et), el('b', cls, val)); return d; };
  res.append(kv('Puntos', `${puntos} de ${total}`), kv('Cumplimiento', `${nf0.format(frac * 100)}%`),
    kv('Premio', premio > 0 ? pesos(premio) : `Faltan ${total - puntos} variable${total - puntos === 1 ? '' : 's'}`, premio > 0 ? 'ok' : ''));
  cont.append(res);

  // ----- objetivos (solo jefes) -----
  if (esJefe) {
    const ed = el('details', 'conc-ed'); ed.append(el('summary', null, 'Cargar los objetivos de la distribuidora (clientes con compra)'));
    const g = el('div', 'conc-ed-grid');
    const inputs = {};
    for (const v of CONC_VARS) {
      const l = el('label', null, v.et); const i = el('input'); i.type = 'number'; i.min = '0'; i.inputMode = 'numeric'; i.value = obj.get(v.k) ?? ''; inputs[v.k] = i; l.append(i); g.append(l);
    }
    const b = el('button', 'btn', 'Guardar objetivos del concurso'); b.type = 'button';
    const msg = el('p', 'msg');
    b.addEventListener('click', async () => {
      const filas = CONC_VARS.filter(v => inputs[v.k].value !== '').map(v => ({ periodo, segmento: v.k, id_vendedor: 0, objetivo: Number(inputs[v.k].value) }));
      const { error } = filas.length ? await sb.from('concurso_objetivos').upsert(filas, { onConflict: 'periodo,segmento,id_vendedor' }) : { error: { message: 'Completá al menos un objetivo.' } };
      if (error) { msg.className = 'msg err'; msg.textContent = 'No se pudo guardar: ' + error.message; return; }
      cargarConcursos();
    });
    ed.append(g, b, msg); cont.append(ed);
  }

  // ----- por vendedor -----
  const tabla = el('div', 'conc-tabla');
  const cab = el('div', 'conc-fila cab'); cab.append(el('span', null, 'Vendedor'));
  for (const v of CONC_VARS) cab.append(el('span', null, v.k === 'potenciador' ? 'Potenc.' : v.et.replace('CCC ', '').replace('CNC ', '')));
  tabla.append(cab);
  for (const c of (cfg.data || []).filter(x => /^supervisor/i.test(x.nombre_mostrar) === false)) {
    const d = vend.get(c.id) || {};
    const f = el('div', 'conc-fila'); f.append(el('b', null, c.nombre_mostrar));
    for (const v of CONC_VARS) f.append(el('span', null, nf0.format(d[v.k] || 0)));
    tabla.append(f);
  }
  cont.append(el('h4', 'conc-sub', 'Clientes con compra por vendedor'), tabla,
    el('small', 'hint', 'Un cliente que compra con dos vendedores cuenta en cada uno, pero una sola vez en el total de la distribuidora.'));

  // ----- artículos considerados -----
  const det = el('details', 'conc-ed'); det.append(el('summary', null, 'Qué artículos cuentan en cada variable'));
  const porSeg = new Map();
  for (const s of sk.data || []) (porSeg.get(s.segmento) || porSeg.set(s.segmento, []).get(s.segmento)).push(s);
  for (const v of CONC_VARS) {
    if (v.k === 'total') { det.append(el('p', 'hint', 'CNC Total canales: cualquier artículo de Nestlé (incluye Nestlé Professional).')); continue; }
    const p = el('p', 'hint'); p.append(el('b', null, v.et + ': '), (porSeg.get(v.k) || []).map(s => `${s.nota} (${s.id_articulo})`).join(' · ') || 'sin artículos cargados');
    det.append(p);
  }
  cont.append(det);

  cont.append(el('p', 'hint', 'Los clientes con compra se calculan solos con las ventas de Chess y se actualizan cada 30 minutos. Los puntos y el premio son una estimación; el reporte oficial es el de Fórmula N.'));
}

document.addEventListener('tabcambio', e => { if (e.detail === 'obj') cargarConcursos(); });
for (const id of ['#objAnt', '#objSig']) { const b = $(id); if (b) b.addEventListener('click', () => setTimeout(cargarConcursos, 50)); }
