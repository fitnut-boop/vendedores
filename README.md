# App Vendedores – Cotizador

Página web estática (HTML + JS). Código público en GitHub Pages; **datos privados en Supabase** con login.

## Puesta en marcha (una sola vez)

### 1. Supabase (base de datos + login) – gratis
1. Crear cuenta en https://supabase.com y un proyecto nuevo (guardá la contraseña de la base).
2. **SQL Editor → New query**: pegar todo `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user → Create new user**: tu email + contraseña (marcar *Auto Confirm User*). Repetir por cada vendedor.
4. En el SQL Editor ejecutar (con tu email) para ser administrador:
   ```sql
   update perfiles set rol = 'admin' where id = (select id from auth.users where email = 'tu@email.com');
   ```
5. **Project Settings → API**: copiar *Project URL* y la clave *anon / public* y pegarlas en `config.js`.
   (No uses nunca la clave `service_role` en la página.)

### 1b. Sincronización automática con Chess (clientes y precios General/Mayorista)
Una función de Supabase lee la API de Chess y guarda los datos; `pg_cron` la dispara sola cada 30 minutos. Solo escribe en la base si algo cambió.
1. **Edge Functions → Deploy a new function → Via Editor**. Nombre: `sync-chess`. Pegar el contenido de `supabase/functions/sync-chess/index.ts` y desplegar. Dejar **Verify JWT** activado.
2. **Edge Functions → Secrets** (los cargás vos, no se los pases a nadie): `CHESS_BASE_URL` = `https://fitnut.chesserp.com/AR1175/web/api/chess/v1`, `CHESS_USER`, `CHESS_PASS`, `SYNC_TOKEN` (un texto largo inventado, ej. 40 caracteres al azar).
3. Probar a mano (reemplazá proyecto y token):
   `curl -H "Authorization: Bearer TU_ANON_KEY" -H "x-sync-token: TU_SYNC_TOKEN" https://TU-PROYECTO.supabase.co/functions/v1/sync-chess`
   Debe responder `{"ok":true,...}`. Si algo falla, el mensaje dice qué. Para ver la forma cruda de la API sin guardar nada: agregar `?probe=/clientes/`.
4. Ejecutar `supabase/cron.sql` en el SQL Editor (con tu proyecto y tu token) para programarla.
5. En la app, pestaña **Datos** (administrador) se ve la fecha de la última sincronización y si hubo error.

Farmacia queda fuera por ahora (solo listas 1 y 2 de Chess).

### 1c. Apartado "Vendedores" (jefe): cobertura, volumen y rutas
1. Ejecutar en el SQL Editor, en este orden: `registro.sql`, `roles.sql` y `gestion.sql`.
2. La misma función `sync-chess` trae vendedores, rutas y ventas (`?tarea=gestion`, `?tarea=ventas`, `?tarea=ventas&mes=anterior`).
3. Se programan con pg_cron: ventas cada 30 min, vendedores y rutas cada 6 h, mes anterior una vez por día.
4. Volumen = suma de `cantidadesTotal` (bultos con fracción) de las líneas de comprobantes; las notas de crédito ya vienen en negativo. Importe = `subtotalNeto` (sin IVA). Clientes con compra = clientes distintos con importe positivo en el mes. Cobertura de cartera = clientes con compra / clientes de las rutas vigentes del vendedor.
5. Los objetivos del mes (bultos y clientes) los carga el jefe desde la app (Vendedores → Cumplimiento → Cobertura y volumen).
6. El rol "jefe" se asigna desde Datos → Vendedores → "Hacer jefe". Hoy el jefe solo se distingue en que puede **cargar objetivos**.
7. **Avance del mes:** arriba de la solapa Vendedores hay tres indicadores (Volumen, Cobertura y Bees). Al tocar uno se ven las barras por vendedor; "Ver detalle y objetivos" abre el detalle de ese indicador y, para jefes y administradores, la carga de objetivos. Bees queda como "Pronto" hasta saber de dónde sale la información.
8. **Calendario:** muestra Google Calendar embebido. Los calendarios se configuran en `config.js` (`calendarios`: el de la cuenta `fitnut@fitnutsas.com` y los feriados de Argentina). Cada usuario ve los eventos solo si tiene permiso sobre el calendario (compartirlo con personas específicas o hacerlo público).
9. **Acceso general (decisión temporal):** todos los usuarios aprobados ven todas las solapas (Cotizador, Vendedores, Objetivos, Calendario). "Datos" (cargas y aprobación de usuarios) es solo del administrador. Para limitar las secciones de gestión a jefes y administradores: `ACCESO_GENERAL = false` en `app.js` y ejecutar `supabase/acceso_solo_jefes.sql` (para volver: `acceso_general.sql`).

### 2. GitHub Pages – gratis
1. Crear cuenta en https://github.com y un repositorio **público** (ej. `vendedores`). Es público pero solo contiene código: los datos viven en Supabase.
2. Subir el contenido de esta carpeta (`index.html`, `app.js`, `styles.css`, `config.js`, `supabase/`). No subir `serve.ps1` si no querés.
3. **Settings → Pages → Deploy from a branch → main / root**. En un minuto queda en `https://TU-USUARIO.github.io/vendedores/`.
4. Los vendedores abren esa dirección en el celular → menú del navegador → *Agregar a pantalla de inicio*.

### 3. Cargar los datos (administrador)
Entrar con tu usuario → pestaña **Datos** → subir los Excel:
1. Padrón de clientes · 2. Artículos (unidades por bulto) · 3. Lista de precios de cada proveedor.

Cada carga reemplaza lo anterior y los vendedores ven lo nuevo al abrir la app. El Padrón se puede actualizar a diario sin tocar lo demás.

## Reglas del cotizador
- Segmento: lista 2 → Mayorista · lista 1 + subcanal 10 → Farmacia · resto → General.
- Los precios de la LP son por bulto. Unidades = precio bulto ÷ unidades por bulto.
- Precio c/IVA de la fila = (bultos + unidades/uxb) × precio bulto × (1 − bonif%) × 1,21.

## Velocidad
La app consulta primero un número de versión; si no cambió desde la última vez, usa los datos guardados en el celular (carga instantánea y funciona sin señal). Solo descarga todo cuando el administrador sube datos nuevos.

## Seguridad
- Sin login no se ve ningún dato. Al tocar *Salir* se borran los datos guardados en el dispositivo.
- Solo los administradores pueden cargar datos (lo controla la base, no la página).

## Probar en la PC
```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 8080
```
y abrir http://localhost:8080/ . Con `config.js` sin completar funciona en modo local (datos solo en ese navegador).
