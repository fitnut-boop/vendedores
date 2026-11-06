/* Mi cuenta: mail asociado y contraseña propia. Se pide al primer ingreso (obligatorio) y se puede cambiar después tocando el nombre arriba. */
let cuOblig = false;

function abrirCuenta(obligatorio) {
  if (!sb || !perfilActual) return;
  cuOblig = !!obligatorio;
  $('#cuTitulo').textContent = obligatorio ? 'Completá tu cuenta' : 'Mi cuenta';
  $('#cuAviso').textContent = obligatorio
    ? 'Es tu primer ingreso. Para seguir, asociá tu mail y elegí una contraseña propia (la que te dieron es provisoria).'
    : 'Podés cambiar tu mail o tu contraseña. Si no escribís una contraseña nueva, queda la que tenés.';
  $('#cuOpc').textContent = obligatorio ? '' : '(opcional)';
  $('#cuPass').required = $('#cuPass2').required = !!obligatorio;
  $('#cuEmail').value = perfilActual.emailContacto || '';
  $('#cuPass').value = $('#cuPass2').value = '';
  $('#cuMsg').textContent = ''; $('#cuMsg').className = 'msg';
  $('#cuCerrar').hidden = !!obligatorio;           // la primera vez no se puede cerrar sin completar
  $('#cuSalir').hidden = !obligatorio;
  $('#cuenta').hidden = false;
  setTimeout(() => $('#cuEmail').focus(), 50);
}
function cerrarCuenta() { if (!cuOblig) $('#cuenta').hidden = true; }

$('#cuCerrar').addEventListener('click', cerrarCuenta);
$('#cuSalir').addEventListener('click', () => salir());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#cuenta').hidden) cerrarCuenta(); });
const chipCuenta = $('#chip'); if (chipCuenta) { chipCuenta.style.cursor = 'pointer'; chipCuenta.title = 'Mi cuenta'; chipCuenta.addEventListener('click', () => abrirCuenta(false)); }

$('#cuentaForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#cuMsg'), email = $('#cuEmail').value.trim(), p1 = $('#cuPass').value, p2 = $('#cuPass2').value;
  const fallo = t => { m.className = 'msg err'; m.textContent = t; };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fallo('Escribí un mail válido.');
  if (p1 || cuOblig) {
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return fallo('La contraseña necesita 8 caracteres o más, con letras y números.');
    if (p1 !== p2) return fallo('Las dos contraseñas no coinciden.');
    const usuario = (perfilActual.authEmail || '').split('@')[0];
    if (usuario && p1.toLowerCase().startsWith(usuario.toLowerCase())) return fallo('Elegí una contraseña distinta a la provisoria (no empieces con tu usuario).');
  }
  m.className = 'msg'; m.textContent = 'Guardando…';
  if (p1) {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return fallo(/same|different/i.test(error.message) ? 'La contraseña nueva tiene que ser distinta de la actual.' : /weak|password/i.test(error.message) ? 'La contraseña es muy débil: sumale letras, números o más caracteres.' : 'No se pudo cambiar la contraseña: ' + error.message);
  }
  const { error: e2 } = await sb.rpc('completar_cuenta', { p_email: email });
  if (e2) return fallo('No se pudo guardar el mail: ' + e2.message);
  perfilActual.emailContacto = email.toLowerCase(); perfilActual.cuentaLista = true; cuOblig = false;
  m.className = 'msg'; m.textContent = p1 ? 'Listo: mail y contraseña guardados.' : 'Listo: mail guardado.';
  const f = $('#calFrame'); if (f) { delete f.dataset.listo; }   // el calendario se vuelve a armar con el mail nuevo
  setTimeout(() => { $('#cuenta').hidden = true; }, 900);
});
