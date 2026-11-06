/* "Carpeta del día": detalle de una ruta (día + semana) con sus clientes, qué compraron, qué categorías faltan y recomendaciones.
   El supervisor y los jefes ven todas las rutas; cada vendedor solo las suyas (lo controla la base de datos). */
const CAT_EXCLUIR = /^(no aplicable|pop gen|nhscience|professional|)$/i;
const plata2 = n => (n < 0 ? '-' : '') + '$ ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.abs(Number(n) || 0));
const fechaCorta = s => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');

let carp = null;   // { data, r, tituloDia, filtro, busca, abierto, tab, universo, top }

function cerrarCarpeta() { const m = $('#carpeta'); if (m) m.hidden = true; document.body.classList.remove('sin-scroll'); carp = null; }

async function abrirCarpeta(r, tituloDia) {
  const m = $('#carpeta'), cont = $('#carpCont');
  m.hidden = false; document.body.classList.add('sin-scroll');
  cont.replaceChildren(el('p', 'hint carp-carga', 'Cargando el detalle de la ruta…'));
  const fin = new Date(mesRut.getFullYear(), mesRut.getMonth() + 1, 0);
  const { data, error } = await sb.rpc('ruta_carpeta', { p_suc: r.id_sucursal, p_fza: r.id_fuerza, p_modo: r.id_modo, p_ruta: r.id_ruta, desde: iso(mesRut), hasta: iso(fin) });
  if (error) {
    const x = el('button', 'carp-x', '✕'); x.type = 'button'; x.addEventListener('click', cerrarCarpeta);
    cont.replaceChildren(x, el('p', 'msg err carp-carga', /propias rutas/i.test(error.message) ? 'Solo podés ver el detalle de tus propias rutas.' : msgErr(error)));
    return;
  }
  carp = { data, r, tituloDia, filtro: 'todos', busca: '', abierto: null, tab: 'sum',
    universo: (data.universo || []).filter(u => !CAT_EXCLUIR.test(u.categoria)).sort((a, b) => b.clientes - a.clientes).slice(0, 9).map(u => u.categoria) };
  carp.top = new Set((data.clientes || []).filter(c => c.compro).slice(0, 4).map(c => c.id));
  pintarCarpeta();
}

function pintarCarpeta() {
  const { data, tituloDia } = carp, cont = $('#carpCont'), cl = data.clientes || [];
  cont.replaceChildren();
  const ruta = data.ruta;
  // ----- cabecera -----
  const cab = el('div', 'carp-cab');
  const tit = el('div', 'carp-tit'); tit.append(el('small', null, 'CARPETA DEL DÍA'), el('h2', null, `${ruta.vendedor} · ${tituloDia}`), el('span', null, `Ruta ${ruta.id} · ${ruta.descripcion || ''}`));
  const x = el('button', 'carp-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Cerrar'); x.addEventListener('click', cerrarCarpeta);
  cab.append(el('i', 'avatar-sm', iniciales(ruta.vendedor)), tit, x); cont.append(cab);

  const cuerpo = el('div', 'carp-cuerpo'); cont.append(cuerpo);
  const compraron = cl.filter(c => c.compro), sin = cl.filter(c => !c.compro), venc = cl.filter(c => Number(c.vencido) > 0), ped = cl.filter(c => c.pedido);
  // ----- indicadores -----
  const kp = el('div', 'carp-kpis');
  const k = (et, val, sub, cls) => { const d = el('div', 'carp-k ' + (cls || '')); d.append(el('small', null, et), el('b', null, String(val)), el('span', null, sub)); return d; };
  kp.append(
    k('Clientes activos', nf0.format(cl.length), 'en la ruta', 'gris'),
    k('Compraron', nf0.format(compraron.length), `${cl.length ? nf0.format(compraron.length / cl.length * 100) : 0}% del total`, 'verde'),
    k('Sin compra', nf0.format(sin.length), 'a recuperar', 'rojo'),
    k('Con deuda vencida', nf0.format(venc.length), 'ver cuenta cte.', 'amarillo'),
    k('Con pedido pendiente', nf0.format(ped.length), 'sin facturar', 'azul'),
    k('Anulados', nf0.format(data.anulados || 0), 'fuera del padrón', 'gris'));
  cuerpo.append(kp);

  // ----- mejores clientes -----
  const top4 = compraron.slice(0, 4);
  if (top4.length) {
    const t = el('div', 'carp-top'); t.append(el('h3', null, '★ Los 4 mejores clientes del día · volumen y facturación'));
    const g = el('div', 'carp-top-grid');
    top4.forEach((c, i) => {
      const d = el('button', 'carp-topc'); d.type = 'button';
      d.append(el('small', null, '★ ' + (i + 1)), el('b', null, c.razon), el('span', null, `${nf1.format(c.kg)} kg · ${(c.categorias || []).length} categ. · ${plata2(c.importe)}`));
      d.addEventListener('click', () => { carp.abierto = c.id; carp.filtro = 'todos'; carp.busca = ''; pintarCarpeta(); document.getElementById('cli-' + c.id)?.scrollIntoView({ block: 'center' }); });
      g.append(d);
    });
    t.append(g); cuerpo.append(t);
  }

  // ----- filtros y búsqueda -----
  const filtros = [['todos', 'Todos', cl.length], ['sin', 'No compraron', sin.length], ['venc', 'Con deuda vencida', venc.length], ['ped', 'Con pedido pendiente', ped.length], ['top', '★ Top 4', top4.length]];
  const barra = el('div', 'carp-filtros');
  for (const [key, nom, n] of filtros) {
    const b = el('button', 'cc-chip' + (carp.filtro === key ? ' on' : ''), `${nom} · ${n}`); b.type = 'button';
    b.addEventListener('click', () => { carp.filtro = key; pintarCarpeta(); }); barra.append(b);
  }
  const bus = el('input', 'carp-bus'); bus.type = 'search'; bus.placeholder = 'Buscar cliente o N°'; bus.value = carp.busca;
  bus.addEventListener('input', () => { carp.busca = bus.value; pintarLista(); });
  barra.append(bus); cuerpo.append(barra);
  cuerpo.append(el('p', 'hint carp-ley', `${cl.length} clientes en orden de volumen. Tocá uno para abrir su sumario. ✓ compró en el mes · ✗ todavía no compró.`));
  const lista = el('div', 'carp-lista'); lista.id = 'carpLista'; cuerpo.append(lista);
  pintarLista();
}

function pintarLista() {
  const { data, universo } = carp, lista = $('#carpLista'); lista.replaceChildren();
  const q = carp.busca.trim().toLowerCase();
  const cl = (data.clientes || []).filter(c => {
    if (carp.filtro === 'sin' && c.compro) return false;
    if (carp.filtro === 'venc' && !(Number(c.vencido) > 0)) return false;
    if (carp.filtro === 'ped' && !c.pedido) return false;
    if (carp.filtro === 'top' && !carp.top.has(c.id)) return false;
    return !q || String(c.razon).toLowerCase().includes(q) || String(c.fantasia || '').toLowerCase().includes(q) || String(c.id).includes(q);
  });
  if (!cl.length) { lista.append(el('p', 'hint', 'No hay clientes con ese filtro.')); return; }
  for (const c of cl) {
    const w = el('div', 'carp-cli' + (carp.abierto === c.id ? ' abierto' : '')); w.id = 'cli-' + c.id;
    const fila = el('button', 'carp-fila'); fila.type = 'button';
    const nom = el('div', 'carp-nom'); nom.append(el('b', null, c.razon), el('small', null, `N° ${c.id}${c.fantasia && c.fantasia !== c.razon ? ' · ' + c.fantasia : ''}`));
    const comp = (c.categorias || []).filter(x => universo.includes(x)).length;
    fila.append(el('i', 'carp-mk ' + (c.compro ? 'si' : 'no'), c.compro ? '✓' : '✗'), nom, el('span', 'carp-cat', `${comp} de ${universo.length} categ.`), el('span', 'carp-monto', c.compro ? plata2(c.importe) : '—'));
    if (Number(c.vencido) > 0) fila.append(el('span', 'tag mal', 'deuda vencida'));
    if (c.pedido) fila.append(el('span', 'tag', 'pedido pendiente'));
    fila.addEventListener('click', () => { carp.abierto = carp.abierto === c.id ? null : c.id; carp.tab = 'sum'; pintarLista(); });
    w.append(fila);
    if (carp.abierto === c.id) w.append(detalleCliente(c, universo));
    lista.append(w);
  }
}

// Panel del cliente con pestañas: Sumario · Compras · Categorías · Pedidos · Cuenta cte.
function detalleCliente(c, universo) {
  const panel = el('div', 'carp-det');
  const barra = el('div', 'carp-tabs');
  for (const [k, n] of [['sum', 'Sumario'], ['comp', 'Compras'], ['cat', 'Categorías'], ['ped', 'Pedidos'], ['cc', 'Cuenta cte.']]) {
    const b = el('button', carp.tab === k ? 'on' : '', n); b.type = 'button';
    b.addEventListener('click', () => { carp.tab = k; pintarLista(); }); barra.append(b);
  }
  panel.append(barra);
  const cuerpo = el('div', 'carp-det-cuerpo'); panel.append(cuerpo);
  const compradas = new Set(c.categorias || []), faltan = universo.filter(u => !compradas.has(u));
  const tarj = (et, val, sub, cls) => { const d = el('div', 'carp-k2 ' + (cls || '')); d.append(el('small', null, et), el('b', null, val), el('span', null, sub || '')); return d; };
  const venc = Number(c.vencido) > 0;

  if (carp.tab === 'sum') {
    const g = el('div', 'carp-k2s');
    g.append(
      tarj('Compró en el mes', c.compro ? 'Sí' : 'No', c.compro ? `Última compra: ${fechaCorta(c.ultima)}` : 'A recuperar en la próxima visita', c.compro ? 'verde' : 'rojo'),
      tarj('Kilos del mes', `${nf1.format(c.kg)} kg`, `${plata2(c.importe)} facturados`, 'gris'),
      tarj('Categorías', `${universo.length - faltan.length} de ${universo.length}`, faltan.length ? `Le faltan ${faltan.length}` : 'Mix completo', faltan.length ? 'amarillo' : 'verde'),
      tarj('Pedido pendiente', c.pedido ? `${nf1.format(c.pedido.kg)} kg` : 'No', c.pedido ? `Entrega ${fechaCorta(c.pedido.entrega)}` : 'Sin pedidos sin facturar', c.pedido ? 'azul' : 'gris'),
      tarj('Deuda vencida', venc ? plata2(c.vencido) : 'No', venc ? `${c.antiguedad} días de atraso` : 'Al día', venc ? 'rojo' : 'verde'));
    cuerpo.append(g);
    const rec = el('div', 'carp-rec'); rec.append(el('h4', null, 'PARA ESTA VISITA'));
    const li = [];
    if (!c.compro) li.push('Recuperar la compra del mes en esta visita.');
    if (faltan.length) li.push(`Ofrecer lo que todavía no compró: ${faltan.slice(0, 4).join(', ')}.`);
    if (c.pedido) li.push(`Tiene un pedido pendiente de facturar (${c.pedido.lineas} línea${c.pedido.lineas === 1 ? '' : 's'}, unos ${nf1.format(c.pedido.kg)} kg) con entrega ${fechaCorta(c.pedido.entrega)}: confirmarlo.`);
    if (venc) li.push(`Gestionar el cobro de ${plata2(c.vencido)} vencidos hace ${c.antiguedad} días.`);
    if (!li.length) li.push('Cliente al día y con el mix completo: mantener el ritmo de compra.');
    const ul = el('ul'); li.forEach(t => ul.append(el('li', null, t))); rec.append(ul); cuerpo.append(rec);
  } else if (carp.tab === 'comp') {
    if (!(c.compras || []).length) cuerpo.append(el('p', 'hint', 'Todavía no compró en este mes.'));
    for (const x of c.compras || []) { const f = el('div', 'carp-linea'); f.append(el('span', null, x.desc), el('small', null, x.cat || ''), el('b', null, `${nf1.format(x.bultos)} bultos`)); cuerpo.append(f); }
  } else if (carp.tab === 'cat') {
    cuerpo.append(el('p', 'hint', 'En verde, las categorías que compró este mes; en rojo, las que le faltan (de las más vendidas a las menos).'));
    const g = el('div', 'carp-cats');
    for (const u of universo) g.append(el('span', 'carp-cat-chip ' + (compradas.has(u) ? 'si' : 'no'), (compradas.has(u) ? '✓ ' : '✗ ') + u));
    cuerpo.append(g);
  } else if (carp.tab === 'ped') {
    cuerpo.append(el('p', c.pedido ? null : 'hint', c.pedido
      ? `Pedido sin facturar: ${c.pedido.lineas} línea${c.pedido.lineas === 1 ? '' : 's'}, unos ${nf1.format(c.pedido.kg)} kg estimados. Entrega prevista: ${fechaCorta(c.pedido.entrega)}.`
      : 'No tiene pedidos pendientes de facturar.'));
  } else if (c.saldo == null) {
    cuerpo.append(el('p', 'hint', 'Sin deuda registrada en el último Excel de cobranzas.'));
  } else {
    const g = el('div', 'carp-k2s');
    g.append(tarj('Saldo', plata2(c.saldo), Number(c.saldo) < 0 ? 'Saldo a favor' : 'Deuda total', Number(c.saldo) < 0 ? 'verde' : 'gris'),
      tarj('Vencido', plata2(c.vencido), venc ? `${c.antiguedad} días de atraso` : 'Al día', venc ? 'rojo' : 'verde'));
    cuerpo.append(g);
  }
  return panel;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && carp) cerrarCarpeta(); });
document.addEventListener('click', e => { if (e.target.id === 'carpeta') cerrarCarpeta(); });
