/* Reconocimientos: podio del mes, mejor de cada indicador y "lo mejor de cada uno" (con fotos). Se apoya en tablero.js y gestion.js. */
let mesRec = primerDia(new Date());
let fotosRec = new Map();

const num0 = v => Number(v) || 0;
const medalla = n => ['1°', '2°', '3°'][n] || `${n + 1}°`;

async function cargarReconocimientos() {
  const cont = $('#recLista'), est = $('#recEstado');
  cont.replaceChildren();
  $('#recMes').textContent = `${NOMBRE_MES(mesRec)} ${mesRec.getFullYear()}`;
  if (!sb) { est.textContent = 'Disponible al conectar con Supabase.'; return; }
  est.textContent = 'Cargando…';
  await cargarFeriados();
  const info = infoMes(mesRec);
  const [r, f] = await Promise.all([
    sb.rpc('tablero_publico', { desde: iso(info.ini), hasta: iso(info.fin) }),
    sb.from('fotos_vendedores').select('id_vendedor,foto')
  ]);
  if (r.error) { est.textContent = msgErr(r.error); return; }
  fotosRec = new Map((f.data || []).map(x => [x.id_vendedor, x.foto]));
  // El supervisor no compite en los rankings
  const filas = (r.data || []).filter(x => !/^supervisor/i.test(x.nombre));
  if (!filas.some(x => num0(x.kg_total) > 0)) { est.textContent = 'Todavía no hay ventas registradas para este mes.'; return; }
  est.textContent = info.estado === 'en curso'
    ? `Mes en curso: los porcentajes son la proyección al cierre (${info.trab} de ${info.habiles} días hábiles trabajados).`
    : 'Mes cerrado.';

  // Indicadores por vendedor (mismas reglas del Resumen)
  const av = (acum, obj) => { const p = proyectar(acum, info); return p != null && obj > 0 ? p / obj * 100 : null; };
  const datos = filas.map(x => ({
    id: x.id_vendedor, nombre: x.nombre, kg: num0(x.kg_total),
    total: av(num0(x.kg_total), num0(x.obj_kg)),
    nestle: av(num0(x.kg_nestle), num0(x.obj_kg_nestle)),
    otros: av(num0(x.kg_otros), num0(x.obj_kg_otros)),
    ccc: (() => { const o = objetivoClientes(x); return o > 0 ? num0(x.clientes_con_compra) / o * 100 : null; })(),
    altas: num0(x.altas)
  }));
  const CATS = [
    { k: 'total', et: 'Mayor avance total', ley: '1º del equipo en avance total', fmt: v => `${nf0.format(v)}%` },
    { k: 'nestle', et: 'Mayor avance Nestlé', ley: 'en avance Nestlé', fmt: v => `${nf0.format(v)}%` },
    { k: 'otros', et: 'Mayor avance Purina + Hileret', ley: 'en avance Purina + Hileret', fmt: v => `${nf0.format(v)}%` },
    { k: 'ccc', et: 'Mejor cobertura de clientes', ley: 'en cobertura de clientes', fmt: v => `${nf0.format(v)}%` },
    { k: 'altas', et: 'Más altas del mes', ley: 'en clientes nuevos', fmt: v => nf0.format(v) }
  ];
  const ranking = k => datos.filter(d => d[k] != null && (k !== 'altas' || d[k] > 0)).sort((a, b) => b[k] - a[k]);
  const rank = Object.fromEntries(CATS.map(c => [c.k, ranking(c.k)]));

  // ----- Podio (avance total; si todavía no hay objetivos, por kilos vendidos) -----
  const conObj = false;   // el podio muestra solo los kilos reales vendidos hasta ahora
  const podioLista = [...datos].sort((a, b) => b.kg - a.kg);
  const top = podioLista.slice(0, 3);
  if (top.length) {
    const p = el('section', 'podio');
    p.append(el('div', 'podio-tit', 'Podio del mes · kilos vendidos hasta ahora'));
    const fila = el('div', 'podio-fila');
    const orden = [top[1], top[0], top[2]], pos = [1, 0, 2];   // 2°, 1°, 3°
    orden.forEach((d, i) => {
      if (!d) return;
      const c = el('div', 'podio-col pos' + (pos[i] + 1));
      c.append(avatar(d, 'av-podio'), el('b', 'podio-nom', d.nombre),
        el('span', 'podio-pct', conObj ? `${nf0.format(d.total)}%` : kgTxt(d.kg)), el('small', null, conObj ? `${kgTxt(d.kg)} vendidos` : ''),
        el('div', 'podio-base', medalla(pos[i])));
      fila.append(c);
    });
    p.append(fila); cont.append(p);
  }

  // ----- Tarjetas por indicador -----
  const tarjetas = el('div', 'rec-cards');
  for (const c of CATS) {
    const g = rank[c.k][0];
    const t = el('div', 'rec-card');
    t.append(el('i', 'rec-copa', '🏆'), el('small', null, c.et), el('b', null, g ? g.nombre : '—'), el('span', null, g ? c.fmt(g[c.k]) : 'Sin datos'));
    tarjetas.append(t);
  }
  cont.append(tarjetas);

  // ----- Lo mejor de cada uno -----
  const caja = el('section', 'rec-mejor');
  caja.append(el('h3', null, 'Lo mejor de cada uno'),
    el('small', 'hint', 'El punto fuerte de cada vendedor este mes' + (esJefe ? ' · tocá un círculo para cargar su foto' : '')));
  const fila = el('div', 'mejor-fila');
  const texto = { total: 'en avance total', nestle: 'en avance Nestlé', otros: 'en avance Purina + Hileret', ccc: 'en cobertura de clientes', altas: 'en clientes nuevos' };
  const puesto = d => (rank.total.indexOf(d) < 0 ? 99 : rank.total.indexOf(d));
  for (const d of [...datos].sort((a, b) => puesto(a) - puesto(b))) {
    // mejor puesto del vendedor entre los indicadores (a igual puesto, el orden de la lista)
    let mejor = null;
    for (const c of CATS) { const pos = rank[c.k].indexOf(d); if (pos >= 0 && (!mejor || pos < mejor.pos)) mejor = { c, pos }; }
    const tj = el('div', 'mejor-card');
    tj.append(avatar(d, 'av-mejor', true), el('b', null, d.nombre));
    if (mejor) {
      tj.append(el('span', 'mejor-val', mejor.c.fmt(d[mejor.c.k])),
        el('small', null, `${medalla(mejor.pos)} del equipo ${texto[mejor.c.k]}`));
    } else tj.append(el('small', null, 'Sin datos todavía'));
    fila.append(tj);
  }
  caja.append(fila); cont.append(caja);
}

// Círculo con la foto (o las iniciales). El jefe puede tocarlo para cambiarla.
function avatar(d, cls, editable) {
  const a = el('button', 'avatar-foto ' + cls); a.type = 'button';
  const foto = fotosRec.get(d.id);
  if (foto) { const im = el('img'); im.src = foto; im.alt = d.nombre; a.append(im); }
  else a.append(el('span', null, iniciales(d.nombre)));
  if (esJefe) {
    a.title = 'Cargar foto de ' + d.nombre;
    a.addEventListener('click', () => elegirFoto(d, a));
  } else a.disabled = true;
  return a;
}

function elegirFoto(d, boton) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const url = await reducirFoto(f, 220);
      const { error } = await sb.rpc('guardar_foto', { vendedor: d.id, foto: url });
      if (error) throw error;
      fotosRec.set(d.id, url);
      cargarReconocimientos();
    } catch (e) { alert('No se pudo guardar la foto: ' + (e.message || e)); }
  };
  inp.click();
}

// Recorta al cuadrado y reduce a lado×lado px (JPEG) para que pese pocos KB
function reducirFoto(file, lado) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height), cv = document.createElement('canvas'); cv.width = cv.height = lado;
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, lado, lado);
      URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

$('#recAnt').addEventListener('click', () => { mesRec = new Date(mesRec.getFullYear(), mesRec.getMonth() - 1, 1); cargarReconocimientos(); });
$('#recSig').addEventListener('click', () => { const s = new Date(mesRec.getFullYear(), mesRec.getMonth() + 1, 1); if (s <= primerDia(new Date())) { mesRec = s; cargarReconocimientos(); } });
document.querySelectorAll('[data-sub="rec"]').forEach(b => b.addEventListener('click', cargarReconocimientos));
