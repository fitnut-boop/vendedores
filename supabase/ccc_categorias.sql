-- Clientes con compra (CCC) por categoría: objetivos de Gonzalo (nov-26), filas TOTAL y NESTLE, y comparación con el año anterior.
-- TOTAL = clientes únicos con neto positivo en al menos una categoría · NESTLE = igual, sin HILERET ni ALIMENTO PARA MASCOTAS.
-- Los objetivos de CCC por categoría se repiten de un mes al otro hasta que Gonzalo los cambie (decisión 09/11).

insert into objetivos_ccc (periodo, clave, obj) values
 ('2026-11-01','ALIMENTO PARA MASCOTAS',90),('2026-11-01','BEBIDAS',706),('2026-11-01','CAFE',1112),('2026-11-01','CHOCOLATES',834),('2026-11-01','CPW',112),
 ('2026-11-01','CULINARIOS',888),('2026-11-01','FORMULAS',141),('2026-11-01','HILERET',342),('2026-11-01','LACTEOS',382),('2026-11-01','TOTAL',1592),('2026-11-01','NESTLE',1592)
on conflict (periodo, clave) do update set obj = excluded.obj;

create table if not exists ccc_mes (periodo date not null, clave text not null, ccc integer not null, primary key (periodo, clave));
alter table ccc_mes enable row level security;
create or replace function guardar_ccc_mes(p_periodo date, p_filas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from ccc_mes where periodo = date_trunc('month', p_periodo)::date;
  insert into ccc_mes (periodo, clave, ccc) select date_trunc('month', p_periodo)::date, upper(x.clave), x.ccc from jsonb_to_recordset(p_filas) as x(clave text, ccc integer);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function guardar_ccc_mes(date, jsonb) from public, anon, authenticated;

-- artículo -> categoría (para que la sincronización con Chess cuente clientes por categoría de meses pasados)
create or replace function mapa_categorias() returns table (id_articulo integer, cat text)
language sql stable security definer set search_path = public as $$
  select a.id_articulo, categoria_de(coalesce(nullif(ac.segmento, ''), mm.segmento))
  from (select id_articulo from articulos_cat union select id_articulo from articulos_segmento_manual) a
  left join articulos_cat ac on ac.id_articulo = a.id_articulo
  left join articulos_segmento_manual mm on mm.id_articulo = a.id_articulo;
$$;
revoke execute on function mapa_categorias() from public, anon, authenticated;

drop function if exists ccc_avance(date, date);
create function ccc_avance(desde date, hasta date)
returns table (clave text, tipo text, ccc integer, ccc_mes_ant integer, ccc_anio_ant integer, obj integer)
language sql stable security definer set search_path = public as $$
  with seg as (
    select a.id_articulo, categoria_de(coalesce(nullif(ac.segmento, ''), mm.segmento)) cat
    from (select id_articulo from articulos_cat union select id_articulo from articulos_segmento_manual) a
    left join articulos_cat ac on ac.id_articulo = a.id_articulo
    left join articulos_segmento_manual mm on mm.id_articulo = a.id_articulo
  ), base as (
    select s.cat clave, 'cat'::text tipo, v.id_cliente, v.fecha, v.bultos from ventas_art v join seg s on s.id_articulo = v.id_articulo where s.cat is not null and s.cat <> 'SIN SEGMENTO'
    union all
    select p.clave, 'seg', v.id_cliente, v.fecha, v.bultos from ventas_art v join segmento_plan p on p.id_articulo = v.id_articulo
  ), act0 as (
    select clave, tipo, id_cliente from base where fecha between date_trunc('month', desde)::date and hasta group by clave, tipo, id_cliente having sum(bultos) > 0
  ), ant0 as (
    select clave, tipo, id_cliente from base
    where fecha between (date_trunc('month', desde) - interval '1 month')::date and (date_trunc('month', desde) - interval '1 day')::date
    group by clave, tipo, id_cliente having sum(bultos) > 0
  ), act as (
    select * from act0
    union all select 'TOTAL', 'tot', id_cliente from act0 where tipo = 'cat' group by id_cliente
    union all select 'NESTLE', 'tot', id_cliente from act0 where tipo = 'cat' and clave not in ('HILERET', 'ALIMENTO PARA MASCOTAS') group by id_cliente
  ), ant as (
    select * from ant0
    union all select 'TOTAL', 'tot', id_cliente from ant0 where tipo = 'cat' group by id_cliente
    union all select 'NESTLE', 'tot', id_cliente from ant0 where tipo = 'cat' and clave not in ('HILERET', 'ALIMENTO PARA MASCOTAS') group by id_cliente
  ), o as (
    select distinct on (c.clave) c.clave, c.obj from objetivos_ccc c where c.periodo <= date_trunc('month', desde)::date order by c.clave, c.periodo desc
  ), y as (
    select m.clave, m.ccc from ccc_mes m where m.periodo = (date_trunc('month', desde) - interval '1 year')::date
  ), claves as (
    select clave, tipo from act union select clave, tipo from ant
    union select p.clave, 'seg' from segmento_plan p group by p.clave
    union select 'TOTAL', 'tot' union select 'NESTLE', 'tot'
    union select o.clave, 'cat' from o where o.clave not in ('TOTAL', 'NESTLE') and o.clave not in (select p.clave from segmento_plan p)
  )
  select k.clave, k.tipo,
         (select count(*) from act where act.clave = k.clave and act.tipo = k.tipo)::int,
         (select count(*) from ant where ant.clave = k.clave and ant.tipo = k.tipo)::int,
         y.ccc, o.obj
  from claves k left join o on o.clave = k.clave left join y on y.clave = k.clave;
$$;
revoke execute on function ccc_avance(date, date) from public;
grant execute on function ccc_avance(date, date) to anon, authenticated;
notify pgrst, 'reload schema';
