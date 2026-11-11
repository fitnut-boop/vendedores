/**
 * Sincroniza los objetivos de los vendedores desde la carpeta de Drive hacia la app (Supabase).
 *
 * Lee los Excel "Objetivos Vendedores <Mes> <Año>.xlsx" de la carpeta, toma las columnas
 *   Vendedor · KG Objetivo · CCC Objetivo · KG Obj Nestle · KG Obj Purina · KG Obj Hileret
 * y las guarda por mes. Los meses sin Excel usan solos los del último mes cargado (eso lo resuelve la base).
 *
 * PUESTA EN MARCHA (una sola vez, con la cuenta de Google que ve la carpeta):
 *  1. script.google.com → Nuevo proyecto → pegar este archivo.
 *  2. Servicios (+) → agregar "Drive API" (versión v3).
 *  3. Configuración del proyecto → Propiedades del script → agregar:
 *       SUPABASE_ANON_KEY  = la clave "anon" pública (está en config.js de la app)
 *       TOKEN_OBJETIVOS    = un texto largo inventado por vos (el mismo que guardes en Supabase, ver paso 4)
 *  4. En Supabase → SQL Editor ejecutar (con TU texto largo):
 *       insert into secretos (clave, valor) values ('token_objetivos', 'TU_TEXTO_LARGO')
 *       on conflict (clave) do update set valor = excluded.valor;
 *  5. Ejecutar "sincronizarObjetivos" una vez (pide autorización) y después "instalarDisparador" para que corra todos los días.
 *
 * No guardar el token ni claves dentro de este archivo.
 */
const CARPETA_ID = '1010yuULs4AauDMnbPGgwWwPTe25Y33r2';
const SUPABASE_URL = 'https://ounaoxtsttcsffmtebvz.supabase.co';
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

const sinTildes = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const numero = v => (typeof v === 'number' ? v : (v === '' || v == null ? null : (isNaN(parseFloat(String(v).replace(/\./g, '').replace(',', '.'))) ? null : parseFloat(String(v).replace(/\./g, '').replace(',', '.')))));

function sincronizarObjetivos() {
  const props = PropertiesService.getScriptProperties();
  const clave = props.getProperty('SUPABASE_ANON_KEY'), token = props.getProperty('TOKEN_OBJETIVOS');
  if (!clave || !token) throw new Error('Faltan las propiedades SUPABASE_ANON_KEY y TOKEN_OBJETIVOS (ver las instrucciones del archivo).');

  const filas = [];
  const archivos = DriveApp.getFolderById(CARPETA_ID).getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    const m = /^Objetivos Vendedores\s+(\S+)\s+(\d{4})/i.exec(f.getName());
    if (!m) continue;                                   // ignora los demás archivos de la carpeta
    const mes = MESES[sinTildes(m[1])];
    if (!mes) continue;
    const periodo = m[2] + '-' + ('0' + mes).slice(-2) + '-01';
    for (const fila of leerExcel(f)) filas.push(Object.assign({ periodo: periodo }, fila));
  }
  if (!filas.length) { Logger.log('No se encontraron archivos de objetivos.'); return; }

  const r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/cargar_objetivos_ext', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: clave, Authorization: 'Bearer ' + clave },
    payload: JSON.stringify({ p_token: token, filas: filas })
  });
  Logger.log('Respuesta ' + r.getResponseCode() + ': ' + r.getContentText() + ' (' + filas.length + ' filas leídas)');
  if (r.getResponseCode() >= 300) throw new Error('No se pudieron guardar los objetivos: ' + r.getContentText());
}

// Convierte el .xlsx a una hoja temporal de Google, la lee y la borra
function leerExcel(archivo) {
  const tmp = Drive.Files.create({ name: 'tmp_objetivos_' + archivo.getId(), mimeType: 'application/vnd.google-apps.spreadsheet' }, archivo.getBlob());
  try {
    const datos = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getValues();
    const h = datos.findIndex(r => r.some(c => sinTildes(c) === 'vendedor') && r.some(c => sinTildes(c) === 'kg objetivo'));
    if (h < 0) return [];
    const cab = datos[h].map(sinTildes), col = n => cab.indexOf(n);
    const iV = col('vendedor'), iKg = col('kg objetivo'), iCcc = col('ccc objetivo'), iN = col('kg obj nestle'), iP = col('kg obj purina'), iH = col('kg obj hileret');
    const out = [];
    for (let i = h + 1; i < datos.length; i++) {
      const v = String(datos[i][iV] || '').trim();
      if (!v || /^(total|controles?)$/i.test(v)) break;   // termina en la fila TOTAL / Controles
      out.push({ vendedor: v, kg_total: numero(datos[i][iKg]), ccc: numero(datos[i][iCcc]), nestle: numero(datos[i][iN]), purina: numero(datos[i][iP]), hileret: numero(datos[i][iH]) });
    }
    return out;
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true);
  }
}

// Programa la sincronización todos los días a las 7 de la mañana
function instalarDisparador() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sincronizarObjetivos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarObjetivos').timeBased().everyDays(1).atHour(7).create();
}
