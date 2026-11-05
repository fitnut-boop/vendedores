-- Rutas en grilla (días × semanas, con cobertura) y cuentas corrientes (Excel de gestión de cobranzas).
-- Requiere tablero.sql. Se puede ejecutar varias veces.

-- ===== Rutas: periodicidad de visita (1 = semanal; 2 o más = cada N semanas) y semana del ciclo =====
alter table rutas add column if not exists periodicidad integer;
alter table rutas add column if not exists semana integer;

create or replace function reemplazar_rutas(rutas_json jsonb, clientes_json jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from ruta_clientes where true;
  delete from rutas where true;
  insert into rutas (id_sucursal, id_fuerza, id_modo, id_ruta, descripcion, id_vendedor, dias_visita, periodicidad, semana, anulada)
  select id_sucursal, id_fuerza, id_modo, id_ruta, descripcion, id_vendedor, dias_visita, periodicidad, semana, coalesce(anulada, false)
  from jsonb_to_recordset(rutas_json) as x(id_sucursal int, id_fuerza int, id_modo text, id_ruta int, descripcion text, id_vendedor int, dias_visita text, periodicidad int, semana int, anulada boolean)
  on conflict do nothing;
  insert into ruta_clientes (id_sucursal, id_fuerza, id_modo, id_ruta, id_cliente)
  select id_sucursal, id_fuerza, id_modo, id_ruta, id_cliente
  from jsonb_to_recordset(clientes_json) as x(id_sucursal int, id_fuerza int, id_modo text, id_ruta int, id_cliente int)
  on conflict do nothing;
end $$;

-- Cada ruta con su cantidad de clientes y cuántos compraron en el rango de fechas (cobertura de la ruta).
create or replace function rutas_grilla(desde date, hasta date)
returns table (
  id_vendedor integer, vendedor text, id_sucursal integer, id_fuerza integer, id_modo text, id_ruta integer,
  descripcion text, dias_visita text, periodicidad integer, semana integer, clientes bigint, compraron bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_vendedor() then raise exception 'Cuenta sin acceso'; end if;
  return query
  with comp as (
    select distinct vd.id_cliente from ventas_dia vd
    where vd.fecha between desde and hasta and (vd.importe > 0 or vd.kg > 0 or vd.bultos > 0)
  )
  select r.id_vendedor, coalesce(cfg.nombre_mostrar, p.nombre), r.id_sucursal, r.id_fuerza, r.id_modo, r.id_ruta,
         r.descripcion, r.dias_visita, r.periodicidad, r.semana,
         count(rc.id_cliente), count(comp.id_cliente)
  from rutas r
  left join vendedores p on p.id = r.id_vendedor
  left join vendedores_config cfg on cfg.id = r.id_vendedor
  left join ruta_clientes rc on rc.id_sucursal = r.id_sucursal and rc.id_fuerza = r.id_fuerza and rc.id_modo = r.id_modo and rc.id_ruta = r.id_ruta
  left join comp on comp.id_cliente = rc.id_cliente
  where coalesce(r.anulada, false) = false
  group by r.id_vendedor, cfg.nombre_mostrar, p.nombre, r.id_sucursal, r.id_fuerza, r.id_modo, r.id_ruta, r.descripcion, r.dias_visita, r.periodicidad, r.semana
  order by coalesce(cfg.nombre_mostrar, p.nombre) nulls last, r.id_ruta;
end $$;

revoke execute on function rutas_grilla(date, date) from public, anon;
grant  execute on function rutas_grilla(date, date) to authenticated;

-- ===== Cuentas corrientes (Excel "por_prioridad_dia_*.xlsx" de la carpeta de cobranzas) =====
create table if not exists cuentas_corrientes (
  prioridad      integer,
  sucursal       text,
  tipo           text    not null,          -- CL = cliente, CJ = cuenta sin vendedor
  codigo         integer not null,
  nombre         text,
  comprobantes   integer,
  saldo          numeric,                    -- positivo = debe; negativo = saldo a favor del cliente
  vencido        numeric,
  no_vencido     numeric,
  id_vendedor    integer,                    -- código de vendedor del Excel (0 = sin vendedor)
  vendedor       text,
  ultima_gestion date,
  antiguedad     integer,                    -- días de antigüedad de la deuda
  pend_conciliar numeric,
  primary key (tipo, codigo)
);
create table if not exists cuentas_meta (
  id            integer primary key default 1 check (id = 1),
  archivo       text,
  fecha_archivo date,
  actualizado   timestamptz default now(),
  filas         integer
);
alter table cuentas_corrientes enable row level security;
alter table cuentas_meta       enable row level security;
drop policy if exists cc_leer   on cuentas_corrientes;
drop policy if exists ccm_leer  on cuentas_meta;
create policy cc_leer  on cuentas_corrientes for select to authenticated using (es_vendedor());
create policy ccm_leer on cuentas_meta       for select to authenticated using (es_vendedor());

-- Secreto compartido para la carga automática desde Google Apps Script (nadie lo lee por la API: sin políticas).
create table if not exists secretos (clave text primary key, valor text not null);
alter table secretos enable row level security;

-- Carga interna: reemplaza la foto completa de cuentas corrientes. No se expone por la API.
create or replace function _cargar_cuentas(p_archivo text, p_fecha date, filas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if jsonb_typeof(filas) <> 'array' or jsonb_array_length(filas) = 0 then raise exception 'El archivo no tiene filas'; end if;
  delete from cuentas_corrientes where true;
  insert into cuentas_corrientes (prioridad, sucursal, tipo, codigo, nombre, comprobantes, saldo, vencido, no_vencido, id_vendedor, vendedor, ultima_gestion, antiguedad, pend_conciliar)
  select prioridad, sucursal, tipo, codigo, nombre, comprobantes, saldo, vencido, no_vencido, id_vendedor, vendedor, nullif(ultima_gestion, '')::date, antiguedad, pend_conciliar
  from jsonb_to_recordset(filas) as x(prioridad int, sucursal text, tipo text, codigo int, nombre text, comprobantes int, saldo numeric, vencido numeric, no_vencido numeric, id_vendedor int, vendedor text, ultima_gestion text, antiguedad int, pend_conciliar numeric)
  on conflict do nothing;
  get diagnostics n = row_count;
  insert into cuentas_meta (id, archivo, fecha_archivo, actualizado, filas) values (1, p_archivo, p_fecha, now(), n)
  on conflict (id) do update set archivo = excluded.archivo, fecha_archivo = excluded.fecha_archivo, actualizado = now(), filas = excluded.filas;
  return n;
end $$;
revoke execute on function _cargar_cuentas(text, date, jsonb) from public, anon, authenticated;

-- Carga manual (administrador, desde la solapa Datos).
create or replace function cargar_cuentas(archivo text, fecha date, filas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  return _cargar_cuentas(archivo, fecha, filas);
end $$;
revoke execute on function cargar_cuentas(text, date, jsonb) from public, anon;
grant  execute on function cargar_cuentas(text, date, jsonb) to authenticated;

-- Carga automática (Google Apps Script): se valida con el secreto guardado en "secretos".
create or replace function cargar_cuentas_ext(token text, archivo text, fecha date, filas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from secretos where clave = 'token_cuentas' and valor = token) then raise exception 'No autorizado'; end if;
  return _cargar_cuentas(archivo, fecha, filas);
end $$;
revoke execute on function cargar_cuentas_ext(text, text, date, jsonb) from public;
grant  execute on function cargar_cuentas_ext(text, text, date, jsonb) to anon, authenticated;

-- Para activar la carga automática, guardar un secreto largo (elegido por vos) y pegar el mismo en el Apps Script:
-- insert into secretos (clave, valor) values ('token_cuentas', 'TU_SECRETO_LARGO') on conflict (clave) do update set valor = excluded.valor;
