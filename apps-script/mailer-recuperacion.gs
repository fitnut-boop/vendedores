/**
 * Envía el mail de "Olvidé mi contraseña". Lo llama la base de datos (Supabase) con un POST.
 * Se publica como Aplicación web: Ejecutar como "Yo" · Quién tiene acceso "Cualquier persona".
 * Propiedad del script necesaria: MAILER_TOKEN (la frase que también se guarda en Supabase como 'token_mailer').
 * El mail sale desde la cuenta de Google que publica el script. No guardar claves en este archivo.
 */
function doPost(e) {
  const salida = t => ContentService.createTextOutput(t);
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return salida('error'); }
  const clave = PropertiesService.getScriptProperties().getProperty('MAILER_TOKEN');
  if (!clave || !d || d.secret !== clave) return salida('no autorizado');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.to || ''))) return salida('mail invalido');
  if (!/^(https:\/\/fitnut-boop\.github\.io\/vendedores\/|http:\/\/localhost)/.test(String(d.link || ''))) return salida('link invalido');

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = '<div style="font-family:Arial,sans-serif;max-width:480px">' +
    '<h2 style="color:#14306F">Recuperar tu contraseña</h2>' +
    '<p>Hola ' + esc(d.nombre) + ',</p>' +
    '<p>Pediste cambiar tu contraseña de la app de vendedores. Tocá el botón para elegir una nueva (el link vale 30 minutos):</p>' +
    '<p><a href="' + esc(d.link) + '" style="background:#14306F;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Elegir contraseña nueva</a></p>' +
    '<p style="color:#666;font-size:13px">Si no lo pediste vos, ignorá este mail: tu contraseña sigue igual.</p></div>';
  MailApp.sendEmail({ to: d.to, subject: 'Recuperar tu contraseña - FitNut', htmlBody: html, name: 'FitNut Vendedores' });
  return salida('ok');
}
