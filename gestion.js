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
  for (const c of cals) url += '&src=' + encodeURIComponent(c.id) + '&color=' + encodeURIComponent(c.color || '#14306f');
  f.src = url; f.dataset.listo = '1';
}

// Cada solapa carga lo suyo al abrirse
document.addEventListener('tabcambio', e => {
  if (e.detail === 'cal') montarCalendario();
  if (e.detail === 'obj') cargarObjetivos();
});
