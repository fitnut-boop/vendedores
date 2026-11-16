/**
 * Acciones comerciales y combos: busca en la carpeta de Drive el Excel más nuevo de cada proveedor
 * ("AAAA-MM <Proveedor> Acciones Comerciales.xlsx", dentro de Año > Mes) y lo sube a la app.
 * Va en el MISMO proyecto de Apps Script que objetivos-drive.gs (usa SUPABASE_URL, sinTildes y las propiedades SUPABASE_ANON_KEY / TOKEN_OBJETIVOS).
 * Hojas del Excel: "Acciones AASS|Generales|Mayorista" y "Combos Auto|Gene|Mayo". Se corre sola desde sincronizarCuentas (cada 2 horas) y solo sube si el archivo cambió.
 */
// Carpetas de cada proveedor (Nestle, Purina, Hileret): adentro tienen Año > Mes con los Excel de acciones
const CARPETAS_ACCIONES = ['1_usl5lMBFm2IY8CX9hBKBGSq7eQUG5TP', '1ArMa8_OnTUnf-RiCS1JqRYrRghEpVFuc', '1aTSnaCilyFcJdNKgkt_SQzQ-l5j-MAV8'];

function sincronizarAcciones() {
  const props = PropertiesService.getScriptProperties();
  const clave = props.getProperty('SUPABASE_ANON_KEY'), token = props.getProperty('TOKEN_OBJETIVOS');
  if (!clave || !token) throw new Error('Faltan las propiedades SUPABASE_ANON_KEY y TOKEN_OBJETIVOS.');

  // el archivo más nuevo (por mes del nombre; si empatan, el modificado último) de cada proveedor
  const mejor = {};
  const recorrerAcc = function recorrer(carpeta, nivel) {
    const archivos = carpeta.getFiles();
    while (archivos.hasNext()) {
      const f = archivos.next();
      const m = /^(\d{4})-(\d{2})\s+(\S+)\s+Acciones Comerciales\.xlsx$/i.exec(f.getName());
      if (!m) continue;
      const prov = sinTildes(m[3]).toUpperCase(), periodo = m[1] + '-' + m[2];
      const act = mejor[prov];
      if (!act || periodo > act.periodo || (periodo === act.periodo && f.getLastUpdated() > act.f.getLastUpdated())) mejor[prov] = { f: f, periodo: periodo };
    }
    if (nivel >= 4) return;
    const subs = carpeta.getFolders();
    while (subs.hasNext()) {
      const s = subs.next();
      if (/eliminar|whatsapp/i.test(s.getName())) continue;     // copias viejas y adjuntos
      recorrerAcc(s, nivel + 1);
    }
  };
  for (const id of CARPETAS_ACCIONES) { try { recorrerAcc(DriveApp.getFolderById(id), 0); } catch (e) { Logger.log('Carpeta ' + id + ': ' + e.message); } }

  for (const prov of Object.keys(mejor)) {
    const f = mejor[prov].f, periodo = mejor[prov].periodo;
    const huella = f.getId() + '|' + f.getLastUpdated().getTime();
    if (props.getProperty('ACC_' + prov) === huella) { Logger.log('Sin cambios: ' + f.getName()); continue; }
    const r = leerAcciones(f, periodo);
    if (!r.filas.length) { Logger.log('Sin acciones en ' + f.getName()); continue; }
    const resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/cargar_acciones_ext', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: clave, Authorization: 'Bearer ' + clave },
      payload: JSON.stringify({ p_token: token, p_proveedor: prov, p_periodo: periodo + '-01', p_archivo: f.getName(), p_filas: r.filas, p_combos: r.combos })
    });
    Logger.log(prov + ' ' + f.getName() + ': ' + resp.getResponseCode() + ' ' + resp.getContentText() + ' (' + r.filas.length + ' acciones, ' + r.combos.length + ' combos)');
    if (resp.getResponseCode() < 300) props.setProperty('ACC_' + prov, huella);
  }
}

// ---------- lectura del Excel ----------
function leerAcciones(archivo, periodo) {
  const tmp = Drive.Files.create({ name: 'tmp_acc_' + archivo.getId(), mimeType: 'application/vnd.google-apps.spreadsheet' }, archivo.getBlob());
  const filas = [], combos = [];
  try {
    for (const hoja of SpreadsheetApp.openById(tmp.id).getSheets()) {
      const nombre = sinTildes(hoja.getName());
      const seg = /aass|auto/.test(nombre) ? 'AASS' : /gene/.test(nombre) ? 'GENERAL' : /mayo/.test(nombre) ? 'MAYORISTA' : null;
      if (!seg) continue;
      const datos = hoja.getDataRange().getValues();
      if (/^combos/.test(nombre)) combos.push.apply(combos, accCombos(datos, seg, periodo));
      else if (!/^control/.test(nombre)) filas.push.apply(filas, accFilas(datos, seg, periodo));   // 'Acciones ...' (Nestlé) o 'General' / 'Mayorista' (Purina)
    }
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true);
  }
  return { filas: filas, combos: combos };
}

const accNum = v => {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '').replace(/,/g, '').replace('%', '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const accPct = v => {            // 0,1 -> 10 · "10%" -> 10
  if (typeof v === 'number') return Math.round((v <= 1 ? v * 100 : v) * 100) / 100;
  const n = accNum(v);
  return n == null ? null : (String(v).indexOf('%') >= 0 ? n : (n <= 1 ? n * 100 : n));
};
// "270 hasta 05/11" -> { id: '270', hasta: 'AAAA-11-05' }
function accVigencia(txt, periodo) {
  const m = /^\s*(\d+)(?:\s+hasta\s+(\d{1,2})\/(\d{1,2}))?/i.exec(String(txt || ''));
  if (!m) return { id: '', hasta: '' };
  return { id: m[1], hasta: m[2] ? accFecha(m[2], m[3], periodo) : '' };
}
function accFecha(dd, mm, periodo) {
  const py = Number(periodo.slice(0, 4)), pm = Number(periodo.slice(5, 7)), mes = Number(mm);
  const y = mes < pm ? py + 1 : py;
  return y + '-' + ('0' + mes).slice(-2) + '-' + ('0' + Number(dd)).slice(-2);
}

function accFilas(datos, seg, periodo) {
  const h = datos.findIndex(r => sinTildes(r[0]) === 'chess' && r.some(c => sinTildes(c).indexOf('producto') === 0));
  if (h < 0) return [];
  const cab = datos[h].map(sinTildes), col = f => cab.findIndex(f);
  const i = {
    ean: col(c => c.indexOf('ean') >= 0), prod: col(c => c.indexOf('producto') === 0), min: col(c => c.indexOf('unidades') === 0),
    costo: col(c => c === 'costo unitario'), bf: col(c => c.indexOf('bonif. fitnut') === 0), ad: col(c => c.indexOf('adicional') === 0),
    bt: col(c => c.indexOf('bonificacion total') === 0), ca: col(c => c.indexOf('costo unitario con') === 0), pc: col(c => c.indexOf('precio combo') === 0),
    bon: col(c => c === 'bonificacion'), pvp: col(c => c.indexOf('pvp') === 0 || c.indexOf('sugerido') >= 0), an: col(c => c.indexOf('accion nestle') === 0), ac: col(c => c.indexOf('accion chess') === 0)
  };
  const out = [];
  let categoria = '';
  for (let k = h + 1; k < datos.length; k++) {
    const f = datos[k], c0 = String(f[0] == null ? '' : f[0]).trim();
    if (!c0) continue;
    if (/^total/i.test(c0)) continue;
    const resto = f.slice(1).some(x => String(x == null ? '' : x).trim() !== '');
    if (!/^\d+$/.test(c0)) { if (!resto) categoria = c0; continue; }              // fila de título de categoría
    const nes = accVigencia(f[i.an], periodo);
    const chessTxt = String(f[i.ac] == null ? '' : f[i.ac]);
    const mc = /^\s*(\d+)\s*(\(Nestl[eé]\))?\s*[·\-]\s*(.*)$/i.exec(chessTxt);
    const grupo = /grupo\s+(.+)$/i.exec(chessTxt);
    out.push({
      segmento: seg, categoria: categoria, id_articulo: Number(c0), ean: String(f[i.ean] || ''), producto: String(f[i.prod] || '').trim(),
      unidades_min: accNum(f[i.min]), costo: accNum(f[i.costo]), bonif_fitnut: accPct(f[i.bf]), bonif_adicional: accPct(i.ad >= 0 ? f[i.ad] : (i.bon >= 0 ? f[i.bon] : null)), bonif_total: accPct(i.bt >= 0 ? f[i.bt] : (i.bon >= 0 ? f[i.bon] : null)),
      costo_accion: accNum(f[i.ca]), precio_combo: accNum(f[i.pc]), pvp: accNum(f[i.pvp]),
      accion_nestle: String(f[i.an] || ''), nestle_id: nes.id, nestle_hasta: nes.hasta,
      accion_chess: chessTxt, chess_id: mc ? mc[1] : '', grupo: grupo ? grupo[1].trim() : '',
      regla: /combinad/i.test(chessTxt) ? 'combinada' : 'producto'
    });
  }
  return out;
}

function accCombos(datos, seg, periodo) {
  const out = [];
  let cur = null;
  for (let k = 0; k < datos.length; k++) {
    const f = datos[k], c0 = String(f[0] == null ? '' : f[0]).trim();
    const t = /^(\d{4,})\s+(.+?)(?:\s+[—–-]+\s+hasta\s+(\d{1,2})\/(\d{1,2}))?\s*$/i.exec(c0);
    if (t && !/^\d+$/.test(c0) && String(f[1] || '').trim() === '') {                 // cabecera del combo
      cur = { segmento: seg, codigo: Number(t[1]), nombre: t[2].trim(), hasta: t[3] ? accFecha(t[3], t[4], periodo) : '', lineas: [], total: null };
      out.push(cur); continue;
    }
    if (!cur) continue;
    if (/^chess$/i.test(c0) || /^combos vigentes/i.test(c0)) continue;
    if (/total combo/i.test(String(f[1] || '')) || /total combo/i.test(c0)) {
      const nums = f.map(accNum).filter(x => x != null);
      cur.total = nums.length ? nums[nums.length - 1] : null; continue;
    }
    if (/^\d+$/.test(c0) && String(f[1] || '').trim()) {
      cur.lineas.push({ id: Number(c0), articulo: String(f[1]).trim(), unidades: accNum(f[2]), costo: accNum(f[3]), bonif: accPct(f[4]), subtotal: accNum(f[5]) });
    }
  }
  return out.filter(c => c.lineas.length);
}
