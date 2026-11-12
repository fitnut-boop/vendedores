/**
 * Cuentas corrientes: carga sola el Excel más nuevo "por_prioridad_dia_DD-MM-AAAA.xlsx" de la carpeta de cobranzas.
 * Va en el MISMO proyecto de Apps Script que objetivos-drive.gs (usa sus constantes SUPABASE_URL y sinTildes
 * y las mismas propiedades SUPABASE_ANON_KEY y TOKEN_OBJETIVOS). Corre cada 2 horas y solo sube si el archivo cambió.
 */
const CARPETA_CUENTAS_ID = '1gtXdWu3TkFT6IMyaAG5WV-5xIjpxH5aE';

function sincronizarCuentas() {
  const props = PropertiesService.getScriptProperties();
  const clave = props.getProperty('SUPABASE_ANON_KEY'), token = props.getProperty('TOKEN_OBJETIVOS');
  if (!clave || !token) throw new Error('Faltan las propiedades SUPABASE_ANON_KEY y TOKEN_OBJETIVOS.');

  let mejor = null, fechaMejor = '';
  const it = DriveApp.getFolderById(CARPETA_CUENTAS_ID).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = /^por_prioridad_dia_(\d{2})-(\d{2})-(\d{4})\.xlsx$/i.exec(f.getName());
    if (!m) continue;
    const fecha = m[3] + '-' + m[2] + '-' + m[1];
    if (fecha > fechaMejor) { fechaMejor = fecha; mejor = f; }
  }
  if (!mejor) { Logger.log('No hay archivos por_prioridad_dia en la carpeta.'); return; }
  const huella = mejor.getId() + '|' + mejor.getLastUpdated().getTime();
  if (props.getProperty('CC_ULTIMO') === huella) { Logger.log('Sin cambios: ' + mejor.getName()); return; }

  const filas = leerCuentas(mejor);
  if (!filas.length) throw new Error('El archivo no tiene filas: ' + mejor.getName());
  const r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/cargar_cuentas_ext', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: clave, Authorization: 'Bearer ' + clave },
    payload: JSON.stringify({ token: token, archivo: mejor.getName(), fecha: fechaMejor, filas: filas })
  });
  Logger.log('Respuesta ' + r.getResponseCode() + ': ' + r.getContentText() + ' (' + filas.length + ' filas de ' + mejor.getName() + ')');
  if (r.getResponseCode() >= 300) throw new Error('No se pudieron guardar las cuentas corrientes: ' + r.getContentText());
  props.setProperty('CC_ULTIMO', huella);
}

function leerCuentas(archivo) {
  const tmp = Drive.Files.create({ name: 'tmp_cuentas_' + archivo.getId(), mimeType: 'application/vnd.google-apps.spreadsheet' }, archivo.getBlob());
  try {
    const datos = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getValues();
    const h = datos.findIndex(r => r.some(c => sinTildes(c) === 'prioridad') && r.some(c => sinTildes(c) === 'tipo'));
    if (h < 0) return [];
    const cab = datos[h].map(sinTildes), col = n => cab.findIndex(c => c === n || c.indexOf(n) === 0);
    const i = { pri: col('prioridad'), suc: col('sucursal'), tipo: col('tipo'), cod: col('codigo'), nom: col('nombre'), comp: col('comprobantes'), saldo: col('saldo'),
      venc: col('vencido'), nov: col('no vencido'), vend: col('vendedor'), desc: col('descripcion'), ug: col('ultima gestion'), ant: col('antiguedad'), pc: col('pend') };
    const num = v => (typeof v === 'number') ? v : ((v === '' || v == null || isNaN(Number(v))) ? null : Number(v));
    const fec = v => {
      if (v instanceof Date) return Utilities.formatDate(v, 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
      return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
    };
    const out = [];
    for (let k = h + 1; k < datos.length; k++) {
      const f = datos[k], tipo = String(f[i.tipo] || '').trim();
      if (!tipo) continue;
      out.push({ prioridad: num(f[i.pri]), sucursal: String(f[i.suc] || ''), tipo: tipo, codigo: num(f[i.cod]), nombre: String(f[i.nom] || ''),
        comprobantes: num(f[i.comp]), saldo: num(f[i.saldo]), vencido: num(f[i.venc]), no_vencido: num(f[i.nov]),
        id_vendedor: num(f[i.vend]), vendedor: String(f[i.desc] || ''), ultima_gestion: fec(f[i.ug]), antiguedad: num(f[i.ant]), pend_conciliar: num(f[i.pc]) });
    }
    return out;
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true);
  }
}

// Programa la carga cada 2 horas (el Excel nuevo aparece a media mañana)
function instalarDisparadorCuentas() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sincronizarCuentas').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarCuentas').timeBased().everyHours(2).create();
}
