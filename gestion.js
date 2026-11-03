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

// Barra de avance (0–100+). Verde si cumple, ámbar si va cerca, roja si va lejos.
function barra(pct) {
  const b = el('div', 'bar'), i = el('i');
  i.style.width = Math.min(100, Math.max(0, pct)) + '%';
  i.className = pct >= 100 ? 'ok' : pct >= 70 ? 'med' : 'bajo';
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
      card.append(barra(p), el('small', null, `${nf0.format(p)}% del objetivo` + (r.actual ? ` · ritmo: ${nf0.format(bultos / r.transcurridos * r.diasMes)} bultos a fin de mes` : '')));
    } else if (r.actual && bultos > 0) card.append(el('small', null, `Ritmo: ${nf0.format(bultos / r.transcurridos * r.diasMes)} bultos a fin de mes (sin objetivo cargado)`));

    // Cobertura (clientes con compra)
    const fc = el('div', 'fila'); fc.append(el('span', null, 'Clientes con compra'), el('span', 'n', `${nf0.format(cli)}` + (v.obj_clientes ? ` de ${nf0.format(v.obj_clientes)}` : '')));
    card.append(fc);
    if (v.obj_clientes > 0) card.append(barra(cli / v.obj_clientes * 100), el('small', null, `${nf0.format(cli / v.obj_clientes * 100)}% del objetivo`));
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

// Al abrir cada pantalla se cargan sus datos
document.querySelectorAll('[data-sub="cob"]').forEach(b => b.addEventListener('click', cargarCobertura));
document.querySelectorAll('[data-sub="rut"]').forEach(b => b.addEventListener('click', cargarRutas));
