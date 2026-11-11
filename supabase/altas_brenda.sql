-- Clientes con compra (neto positivo), altas por primera compra histórica por CUIT y métrica especial de Brenda.
-- Requiere tablero.sql, rutas_cc.sql, cc_por_vendedor.sql y haber cargado el historial (tarea "primeras" de sync-chess).

-- ===== Resumen público: clientes con compra y altas =====
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
           sum(vd.kg) filter (where upper(vd.proveedor) like '%NESTLE%' or upper(vd.proveedor) like '%NESTLÉ%' or upper(vd.proveedor) like '%PROFESSIONAL%') as kg_nestle,
           sum(vd.importe) as importe
    from ventas_dia vd where vd.fecha between desde and hasta group by vd.id_vendedor
  ),
  cc as (   -- cliente con compra = su compra neta del período es positiva (las notas de crédito restan)
    select t.id_vendedor, count(*) as con_compra
    from (select vd.id_vendedor, vd.id_cliente from ventas_dia vd where vd.fecha between desde and hasta
          group by vd.id_vendedor, vd.id_cliente having sum(vd.kg) > 0 or sum(vd.importe) > 0) t
    group by t.id_vendedor
  ),
  c as (
    select r.id_vendedor, count(distinct rc.id_cliente) as cartera
    from rutas r join ruta_clientes rc using (id_sucursal, id_fuerza, id_modo, id_ruta)
    where coalesce(r.anulada, false) = false and r.id_vendedor is not null group by r.id_vendedor
  ),
  a as (    -- alta = cliente (por CUIT) cuya primera compra histórica cayó en el período; se atribuye al vendedor de esa primera compra
    select vd.id_vendedor, count(distinct cq.cuit) as altas
    from ventas_dia vd
    join cliente_cuit cq on cq.id_cliente = vd.id_cliente
    join cuit_primera cp on cp.cuit = cq.cuit
    where vd.fecha between desde and hasta and cp.primera between desde and hasta and vd.fecha = cp.primera
      and (vd.importe > 0 or vd.kg > 0 or vd.bultos > 0)
    group by vd.id_vendedor
  )
  select p.id, p.nombre_mostrar, p.orden,
         coalesce(v.kg_total, 0), coalesce(v.kg_nestle, 0), coalesce(v.kg_total, 0) - coalesce(v.kg_nestle, 0), coalesce(v.importe, 0),
         coalesce(cc.con_compra, 0), coalesce(c.cartera, 0), p.pct_cobertura, coalesce(a.altas, 0),
         coalesce(o.obj_kg, coalesce(o.obj_kg_nestle, 0) + coalesce(o.obj_kg_otros, 0)), o.obj_kg_nestle, o.obj_kg_otros, o.obj_clientes
  from vendedores_config p
  left join v on v.id_vendedor = p.id
  left join cc on cc.id_vendedor = p.id
  left join c on c.id_vendedor = p.id
  left join a on a.id_vendedor = p.id
  left join objetivos o on o.id_vendedor = p.id and o.periodo = date_trunc('month', desde)::date
  where p.en_tablero
  order by p.orden, p.nombre_mostrar;
$$;

-- ===== Métrica de Brenda: un cliente en rutas de los dos grupos cuenta en el B; "compró" = tuvo facturación en el mes =====
create or replace function brenda_metrica(desde date, hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare vid constant integer := 5; res jsonb;
begin
  if not (es_jefe() or (es_vendedor() and mi_vendedor() = vid)) then
    raise exception 'Solo el supervisor, los jefes y Brenda pueden ver esta métrica';
  end if;
  with rt as (
    select rc.id_cliente, r.id_ruta from rutas r
    join ruta_clientes rc on rc.id_sucursal = r.id_sucursal and rc.id_fuerza = r.id_fuerza and rc.id_modo = r.id_modo and rc.id_ruta = r.id_ruta
    where r.id_vendedor = vid and coalesce(r.anulada, false) = false and r.id_ruta in (501, 502, 503, 504, 505, 512)
  ), act as (
    select rt.id_cliente, cl.razon,
           case when bool_or(rt.id_ruta in (501, 503, 504, 505)) then 'B' else 'A' end as grupo,
           min(rt.id_ruta) as ruta_min, min(rt.id_ruta) filter (where rt.id_ruta in (501, 503, 504, 505)) as ruta_b
    from rt join clientes cl on cl.n = rt.id_cliente group by rt.id_cliente, cl.razon
  ), comp as (
    select distinct vd.id_cliente from ventas_dia vd where vd.fecha between desde and hasta and vd.id_cliente in (select id_cliente from act)
  ), pa as (
    select a.id_cliente, a.id_articulo from ventas_art a
    where a.fecha between desde and hasta and a.id_cliente in (select id_cliente from act) group by a.id_cliente, a.id_articulo having sum(a.bultos) > 0
  ), seg as (
    select pa.id_cliente, array_agg(distinct ac.segmento order by ac.segmento) filter (where ac.segmento <> '') segs
    from pa join articulos_cat ac on ac.id_articulo = pa.id_articulo group by pa.id_cliente
  ), cli as (
    select act.id_cliente, act.razon, act.grupo, case when act.grupo = 'B' then act.ruta_b else act.ruta_min end as ruta,
           (comp.id_cliente is not null) as compro, coalesce(seg.segs, array[]::text[]) as segs, coalesce(array_length(seg.segs, 1), 0) as nseg
    from act left join comp on comp.id_cliente = act.id_cliente left join seg on seg.id_cliente = act.id_cliente
  )
  select jsonb_build_object(
    'segmentos', coalesce((select jsonb_agg(distinct segmento order by segmento) from articulos_cat where segmento <> ''), '[]'::jsonb),
    'A', jsonb_build_object('activos', (select count(*) from cli where grupo = 'A'), 'compraron', (select count(*) from cli where grupo = 'A' and compro),
        'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', id_cliente, 'razon', razon, 'ruta', ruta, 'compro', compro) order by compro desc, razon) from cli where grupo = 'A'), '[]'::jsonb)),
    'B', jsonb_build_object('activos', (select count(*) from cli where grupo = 'B'), 'compradores', (select count(*) from cli where grupo = 'B' and compro),
        'calificados', (select count(*) from cli where grupo = 'B' and nseg >= 5),
        'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', id_cliente, 'razon', razon, 'ruta', ruta, 'compro', compro, 'n', nseg, 'segs', to_jsonb(segs)) order by nseg desc, razon) from cli where grupo = 'B'), '[]'::jsonb))
  ) into res;
  return res;
end $$;
revoke execute on function brenda_metrica(date, date) from public, anon;
grant execute on function brenda_metrica(date, date) to authenticated;
notify pgrst, 'reload schema';
