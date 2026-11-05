-- Tablero comercial: kilos, proveedor, altas, feriados (días hábiles) y resumen PÚBLICO (sin contraseña).
-- Requiere schema.sql, registro.sql, roles.sql y gestion.sql. Se puede ejecutar varias veces.

-- ===== Clientes: fecha de alta (para contar "altas") =====
alter table clientes add column if not exists fecha_alta date;

-- ===== Ventas por día: ahora con kilos y proveedor =====
alter table ventas_dia add column if not exists kg numeric not null default 0;
alter table ventas_dia add column if not exists proveedor text not null default '';
alter table ventas_dia drop constraint if exists ventas_dia_pkey;
alter table ventas_dia add primary key (fecha, id_vendedor, id_cliente, proveedor);

-- ===== Objetivos en kilos (total, Nestlé y Purina+Hileret) =====
alter table objetivos add column if not exists obj_kg numeric;
alter table objetivos add column if not exists obj_kg_nestle numeric;
alter table objetivos add column if not exists obj_kg_otros numeric;

-- ===== Vendedores que se muestran en el tablero (la sincronización con Chess no toca esta tabla) =====
create table if not exists vendedores_config (
  id             integer primary key,   -- idPersonal de Chess
  nombre_mostrar text not null,
  pct_cobertura  numeric not null default 85,   -- objetivo de clientes con compra = % del padrón activo (su cartera)
  en_tablero     boolean not null default true,
  orden          integer not null default 100
);
alter table vendedores_config enable row level security;
drop policy if exists leer_vend_config on vendedores_config;
create policy leer_vend_config on vendedores_config for select to authenticated using (es_vendedor());

insert into vendedores_config (id, nombre_mostrar, pct_cobertura, en_tablero, orden) values
  (1, 'Javier',    70, true, 1),
  (2, 'Virginia',  85, true, 2),
  (3, 'Andrés',    85, true, 3),
  (4, 'Germán',    85, true, 4),
  (5, 'Brenda',    70, true, 5),
  (7, 'Gabriela',  85, true, 6),
  (8, 'Tomás',     85, true, 7),
  (6, 'Supervisor', 85, true, 9)
on conflict (id) do nothing;

-- ===== Feriados y días no laborables (para contar días hábiles: lunes a viernes menos estas fechas) =====
create table if not exists feriados (
  fecha       date primary key,
  descripcion text
);
alter table feriados enable row level security;
drop policy if exists feriados_publico on feriados;
create policy feriados_publico on feriados for select to anon, authenticated using (true);

insert into feriados (fecha, descripcion) values
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'), ('2026-02-17', 'Carnaval'),
  ('2026-03-23', 'Día no laborable con fines turísticos'), ('2026-03-24', 'Día de la Memoria'),
  ('2026-04-02', 'Día de Malvinas'), ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajador'), ('2026-05-25', 'Revolución de Mayo'),
  ('2026-06-15', 'Paso a la Inmortalidad de Güemes (trasladado)'), ('2026-06-20', 'Día de la Bandera'),
  ('2026-07-09', 'Día de la Independencia'), ('2026-07-10', 'Día no laborable con fines turísticos'),
  ('2026-08-17', 'Paso a la Inmortalidad de San Martín'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional (trasladado)'),
  ('2026-12-07', 'Día no laborable con fines turísticos'), ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad')
on conflict (fecha) do nothing;

-- ===== Lo mínimo que necesita el cotizador sin contraseña: precios y unidades por bulto =====
drop policy if exists precios_publico   on precios;
drop policy if exists articulos_publico on articulos;
drop policy if exists version_publico   on version;
create policy precios_publico   on precios   for select to anon using (true);
create policy articulos_publico on articulos for select to anon using (true);
create policy version_publico   on version   for select to anon using (true);

-- ===== Cargas desde Chess (se agregan fecha_alta, kilos y proveedor) =====
create or replace function reemplazar_clientes(filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from clientes where true;
  insert into clientes (n, razon, fantasia, lista, subcanal, fecha_alta)
  select n, razon, fantasia, lista, subcanal, nullif(fecha_alta, '')::date
  from jsonb_to_recordset(filas) as x(n int, razon text, fantasia text, lista int, subcanal int, fecha_alta text);
  update version set v = v + 1 where id = 1;
end $$;

create or replace function reemplazar_ventas(desde date, hasta date, filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from ventas_dia where fecha between desde and hasta;
  insert into ventas_dia (fecha, id_vendedor, id_cliente, proveedor, comprobantes, bultos, kg, importe)
  select fecha, id_vendedor, id_cliente, coalesce(proveedor, ''), comprobantes, bultos, coalesce(kg, 0), importe
  from jsonb_to_recordset(filas) as x(fecha date, id_vendedor int, id_cliente int, proveedor text, comprobantes int, bultos numeric, kg numeric, importe numeric)
  on conflict do nothing;
end $$;

-- ===== Resumen PÚBLICO del tablero (sin contraseña): solo totales por vendedor, nada de clientes =====
create or replace function tablero_publico(desde date, hasta date)
returns table (
  id_vendedor integer, nombre text, orden integer,
  kg_total numeric, kg_nestle numeric, kg_otros numeric, importe numeric,
  clientes_con_compra bigint, cartera bigint, pct_cobertura numeric, altas bigint,
  obj_kg numeric, obj_kg_nestle numeric, obj_kg_otros numeric, obj_clientes integer
)
language sql stable security definer set search_path = public as $$
  with v as (
    select vd.id_vendedor,
           sum(vd.kg) as kg_total,
           sum(vd.kg) filter (where upper(vd.proveedor) like '%NESTLE%' or upper(vd.proveedor) like '%NESTLÉ%') as kg_nestle,
           sum(vd.importe) as importe,
           count(distinct vd.id_cliente) filter (where vd.importe > 0 or vd.kg > 0 or vd.bultos > 0) as con_compra
    from ventas_dia vd where vd.fecha between desde and hasta group by vd.id_vendedor
  ),
  c as (
    select r.id_vendedor, count(distinct rc.id_cliente) as cartera
    from rutas r join ruta_clientes rc using (id_sucursal, id_fuerza, id_modo, id_ruta)
    where coalesce(r.anulada, false) = false and r.id_vendedor is not null group by r.id_vendedor
  ),
  a as (
    select vd.id_vendedor, count(distinct vd.id_cliente) as altas
    from ventas_dia vd join clientes cl on cl.n = vd.id_cliente
    where vd.fecha between desde and hasta and cl.fecha_alta between desde and hasta
      and (vd.importe > 0 or vd.kg > 0 or vd.bultos > 0)
    group by vd.id_vendedor
  )
  select p.id, p.nombre_mostrar, p.orden,
         coalesce(v.kg_total, 0), coalesce(v.kg_nestle, 0), coalesce(v.kg_total, 0) - coalesce(v.kg_nestle, 0), coalesce(v.importe, 0),
         coalesce(v.con_compra, 0), coalesce(c.cartera, 0), p.pct_cobertura, coalesce(a.altas, 0),
         coalesce(o.obj_kg, coalesce(o.obj_kg_nestle, 0) + coalesce(o.obj_kg_otros, 0)), o.obj_kg_nestle, o.obj_kg_otros, o.obj_clientes
  from vendedores_config p
  left join v on v.id_vendedor = p.id
  left join c on c.id_vendedor = p.id
  left join a on a.id_vendedor = p.id
  left join objetivos o on o.id_vendedor = p.id and o.periodo = date_trunc('month', desde)::date
  where p.en_tablero
  order by p.orden, p.nombre_mostrar;
$$;

-- Fecha y hora de la última actualización de ventas (para el "Datos al ..." del tablero).
create or replace function ultima_actualizacion() returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(ultimo_intento) from sync_estado where clave like 'ventas_%';
$$;

revoke execute on function tablero_publico(date, date), ultima_actualizacion() from public;
grant  execute on function tablero_publico(date, date), ultima_actualizacion() to anon, authenticated;
