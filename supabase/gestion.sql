-- Apartado "Vendedores" del jefe: vendedores, rutas, ventas por día y objetivos.
-- Requiere schema.sql, registro.sql y roles.sql. Se puede ejecutar varias veces.

create table if not exists vendedores (
  id          integer primary key,       -- idPersonal de Chess
  nombre      text not null,
  cargo       text,                      -- VENDEDOR / SUPERVISOR / GERENTE
  id_superior integer
);

create table if not exists rutas (
  id_sucursal integer not null,
  id_fuerza   integer not null,
  id_modo     text    not null,
  id_ruta     integer not null,
  descripcion text,
  id_vendedor integer,
  dias_visita text,
  anulada     boolean default false,
  primary key (id_sucursal, id_fuerza, id_modo, id_ruta)
);

create table if not exists ruta_clientes (
  id_sucursal integer not null,
  id_fuerza   integer not null,
  id_modo     text    not null,
  id_ruta     integer not null,
  id_cliente  integer not null,
  primary key (id_sucursal, id_fuerza, id_modo, id_ruta, id_cliente)
);
create index if not exists ruta_clientes_cliente on ruta_clientes (id_cliente);

-- Ventas del período sincronizado (mes actual y anterior), por día, vendedor y cliente.
create table if not exists ventas_dia (
  fecha        date    not null,
  id_vendedor  integer not null,
  id_cliente   integer not null,
  comprobantes integer not null default 0,
  bultos       numeric not null default 0,   -- bultos equivalentes (bultos + unidades / unidades por bulto)
  importe      numeric not null default 0,   -- subtotal final sin IVA
  primary key (fecha, id_vendedor, id_cliente)
);
create index if not exists ventas_dia_vendedor on ventas_dia (id_vendedor, fecha);

-- Objetivos del mes por vendedor (los carga el jefe desde la app).
create table if not exists objetivos (
  periodo      date    not null,             -- primer día del mes
  id_vendedor  integer not null,
  obj_bultos   numeric,
  obj_clientes integer,
  primary key (periodo, id_vendedor)
);

-- ===== Seguridad: solo jefes y administradores =====
alter table vendedores    enable row level security;
alter table rutas         enable row level security;
alter table ruta_clientes enable row level security;
alter table ventas_dia    enable row level security;
alter table objetivos     enable row level security;

drop policy if exists leer_vendedores on vendedores;
drop policy if exists leer_rutas      on rutas;
drop policy if exists leer_ruta_cli   on ruta_clientes;
drop policy if exists leer_ventas     on ventas_dia;
drop policy if exists objetivos_jefe  on objetivos;
create policy leer_vendedores on vendedores    for select to authenticated using (es_jefe());
create policy leer_rutas      on rutas         for select to authenticated using (es_jefe());
create policy leer_ruta_cli   on ruta_clientes for select to authenticated using (es_jefe());
create policy leer_ventas     on ventas_dia    for select to authenticated using (es_jefe());
create policy objetivos_jefe  on objetivos     for all    to authenticated using (es_jefe()) with check (es_jefe());

-- ===== Cargas desde Chess (solo administrador o la función de sincronización) =====
create or replace function reemplazar_vendedores(filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from vendedores where true;
  insert into vendedores (id, nombre, cargo, id_superior)
  select id, nombre, cargo, id_superior
  from jsonb_to_recordset(filas) as x(id int, nombre text, cargo text, id_superior int);
end $$;

create or replace function reemplazar_rutas(rutas_json jsonb, clientes_json jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from ruta_clientes where true;
  delete from rutas where true;
  insert into rutas (id_sucursal, id_fuerza, id_modo, id_ruta, descripcion, id_vendedor, dias_visita, anulada)
  select id_sucursal, id_fuerza, id_modo, id_ruta, descripcion, id_vendedor, dias_visita, coalesce(anulada, false)
  from jsonb_to_recordset(rutas_json) as x(id_sucursal int, id_fuerza int, id_modo text, id_ruta int, descripcion text, id_vendedor int, dias_visita text, anulada boolean)
  on conflict do nothing;
  insert into ruta_clientes (id_sucursal, id_fuerza, id_modo, id_ruta, id_cliente)
  select id_sucursal, id_fuerza, id_modo, id_ruta, id_cliente
  from jsonb_to_recordset(clientes_json) as x(id_sucursal int, id_fuerza int, id_modo text, id_ruta int, id_cliente int)
  on conflict do nothing;
end $$;

-- Reemplaza las ventas del rango [desde, hasta].
create or replace function reemplazar_ventas(desde date, hasta date, filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from ventas_dia where fecha between desde and hasta;
  insert into ventas_dia (fecha, id_vendedor, id_cliente, comprobantes, bultos, importe)
  select fecha, id_vendedor, id_cliente, comprobantes, bultos, importe
  from jsonb_to_recordset(filas) as x(fecha date, id_vendedor int, id_cliente int, comprobantes int, bultos numeric, importe numeric)
  on conflict do nothing;
end $$;

-- ===== Resumen por vendedor para un rango de fechas (lo usa la pantalla "Cobertura y volumen") =====
create or replace function resumen_vendedores(desde date, hasta date)
returns table (
  id_vendedor integer, nombre text, bultos numeric, importe numeric,
  clientes_con_compra bigint, cartera bigint, obj_bultos numeric, obj_clientes integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_jefe() then raise exception 'Solo jefes y administradores'; end if;
  return query
  with v as (
    select vd.id_vendedor, sum(vd.bultos) as bultos, sum(vd.importe) as importe,
           count(distinct vd.id_cliente) filter (where vd.importe > 0 or vd.bultos > 0) as con_compra
    from ventas_dia vd where vd.fecha between desde and hasta group by vd.id_vendedor
  ),
  c as (
    select r.id_vendedor, count(distinct rc.id_cliente) as cartera
    from rutas r join ruta_clientes rc using (id_sucursal, id_fuerza, id_modo, id_ruta)
    where coalesce(r.anulada, false) = false and r.id_vendedor is not null group by r.id_vendedor
  )
  select p.id, p.nombre, coalesce(v.bultos, 0), coalesce(v.importe, 0), coalesce(v.con_compra, 0),
         coalesce(c.cartera, 0), o.obj_bultos, o.obj_clientes
  from vendedores p
  left join v on v.id_vendedor = p.id
  left join c on c.id_vendedor = p.id
  left join objetivos o on o.id_vendedor = p.id and o.periodo = date_trunc('month', desde)::date
  where upper(coalesce(p.cargo, '')) like 'VEND%' or v.id_vendedor is not null or c.id_vendedor is not null
  order by coalesce(v.bultos, 0) desc, p.nombre;
end $$;

-- ===== Rutas con su vendedor y cantidad de clientes (pantalla "Rutas de los vendedores") =====
create or replace function rutas_resumen()
returns table (
  id_vendedor integer, vendedor text, id_sucursal integer, id_fuerza integer, id_modo text,
  id_ruta integer, descripcion text, dias_visita text, clientes bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_jefe() then raise exception 'Solo jefes y administradores'; end if;
  return query
  select r.id_vendedor, p.nombre, r.id_sucursal, r.id_fuerza, r.id_modo, r.id_ruta, r.descripcion, r.dias_visita,
         count(rc.id_cliente)
  from rutas r
  left join vendedores p on p.id = r.id_vendedor
  left join ruta_clientes rc using (id_sucursal, id_fuerza, id_modo, id_ruta)
  where coalesce(r.anulada, false) = false
  group by r.id_vendedor, p.nombre, r.id_sucursal, r.id_fuerza, r.id_modo, r.id_ruta, r.descripcion, r.dias_visita
  order by p.nombre nulls last, r.id_ruta;
end $$;

revoke execute on function reemplazar_vendedores(jsonb), reemplazar_rutas(jsonb, jsonb), reemplazar_ventas(date, date, jsonb), resumen_vendedores(date, date), rutas_resumen() from public, anon;
grant  execute on function reemplazar_vendedores(jsonb), reemplazar_rutas(jsonb, jsonb), reemplazar_ventas(date, date, jsonb) to authenticated, service_role;
grant  execute on function resumen_vendedores(date, date), rutas_resumen() to authenticated;
