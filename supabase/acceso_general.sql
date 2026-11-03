-- ACCESO GENERAL (decisión temporal): todos los usuarios aprobados ven las secciones de gestión.
-- Solo jefes y administradores pueden cargar objetivos. Se puede ejecutar varias veces.
--
-- Para volver a limitar el acceso a jefes y administradores, ejecutar supabase/acceso_solo_jefes.sql

drop policy if exists leer_vendedores on vendedores;
drop policy if exists leer_rutas      on rutas;
drop policy if exists leer_ruta_cli   on ruta_clientes;
drop policy if exists leer_ventas     on ventas_dia;
drop policy if exists objetivos_jefe  on objetivos;
drop policy if exists objetivos_leer  on objetivos;
drop policy if exists objetivos_cargar on objetivos;

create policy leer_vendedores on vendedores    for select to authenticated using (es_vendedor());
create policy leer_rutas      on rutas         for select to authenticated using (es_vendedor());
create policy leer_ruta_cli   on ruta_clientes for select to authenticated using (es_vendedor());
create policy leer_ventas     on ventas_dia    for select to authenticated using (es_vendedor());
create policy objetivos_leer  on objetivos     for select to authenticated using (es_vendedor());
create policy objetivos_cargar on objetivos    for all    to authenticated using (es_jefe()) with check (es_jefe());

create or replace function resumen_vendedores(desde date, hasta date)
returns table (
  id_vendedor integer, nombre text, bultos numeric, importe numeric,
  clientes_con_compra bigint, cartera bigint, obj_bultos numeric, obj_clientes integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_vendedor() then raise exception 'Cuenta sin acceso'; end if;
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

create or replace function rutas_resumen()
returns table (
  id_vendedor integer, vendedor text, id_sucursal integer, id_fuerza integer, id_modo text,
  id_ruta integer, descripcion text, dias_visita text, clientes bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_vendedor() then raise exception 'Cuenta sin acceso'; end if;
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
