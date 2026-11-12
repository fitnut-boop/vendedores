/* "Olvidé mi contraseña": pide el usuario, la base manda un mail con link (?rec=TOKEN) y acá se elige la clave nueva. */
const _showLoginOrig = showLogin;
showLogin = function (vista, aviso) {
  $('#recForm').hidden = true; $('#nuevaForm').hidden = true;
  _showLoginOrig(vista, aviso);
};

function abrirRecuperar() {
  _showLoginOrig('login');
  $('#loginForm').hidden = true; $('#nuevaForm').hidden = true; $('#recForm').hidden = false;
  $('#rcMsg').textContent = ''; $('#rcMsg').className = 'msg';
  $('#rcUsuario').value = $('#lEmail').value.trim();
  setTimeout(() => $('#rcUsuario').focus(), 50);
}
$('#lOlvide').addEventListener('click', abrirRecuperar);
$('#rcVolver').addEventListener('click', () => showLogin('login'));
$('#rcCerrar').addEventListener('click', () => showLogin(null));
$('#nvCerrar').addEventListener('click', () => { history.replaceState(null, '', location.pathname); showLogin(null); });

$('#recForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#rcMsg'), u = $('#rcUsuario').value.trim();
  if (!sb || !u) return;
  m.className = 'msg'; m.textContent = 'Enviando…';
  const { error } = await sb.rpc('pedir_recuperacion', { p_usuario: u, p_base: location.origin + location.pathname });
  if (error) { m.className = 'msg err'; m.textContent = 'No se pudo enviar. Probá de nuevo en un rato.'; return; }
  m.className = 'msg ok';
  m.textContent = 'Listo. Si tu usuario tiene un mail asociado, te mandamos un link (revisá también spam). Vale 30 minutos. Si no tenés mail cargado, pedile al administrador que te cambie la contraseña.';
});

// Llegada desde el link del mail
const tokenRec = new URLSearchParams(location.search).get('rec');
if (tokenRec) setTimeout(() => {
  _showLoginOrig('login');
  $('#loginForm').hidden = true; $('#recForm').hidden = true; $('#nuevaForm').hidden = false;
  $('#nvMsg').textContent = ''; $('#nvMsg').className = 'msg';
  $('#nvPass').focus();
}, 400);

$('#nuevaForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#nvMsg'), p1 = $('#nvPass').value, p2 = $('#nvPass2').value;
  const fallo = t => { m.className = 'msg err'; m.textContent = t; };
  if (p1.length < 8) return fallo('La contraseña debe tener al menos 8 caracteres.');
  if (p1 !== p2) return fallo('Las dos contraseñas no coinciden.');
  m.className = 'msg'; m.textContent = 'Guardando…';
  const { data, error } = await sb.rpc('canjear_recuperacion', { p_token: tokenRec, p_clave: p1 });
  if (error) return fallo(error.message);
  if (!data) return fallo('El link venció o ya se usó. Pedí uno nuevo desde "Olvidé mi contraseña".');
  history.replaceState(null, '', location.pathname);
  $('#nvPass').value = $('#nvPass2').value = '';
  showLogin('login', 'Listo, cambiaste tu contraseña. Ingresá con la nueva.');
});
