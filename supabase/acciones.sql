-- Acciones comerciales y combos por proveedor y segmento (se cargan solos desde los Excel "AAAA-MM <Proveedor> Acciones Comerciales.xlsx" de Drive).
-- segmento: AASS (autoservicios) | GENERAL | MAYORISTA. proveedor: NESTLE | PURINA | HILERET.
-- regla: 'combinada' = el mínimo se cuenta sumando los productos del grupo (acciones FitNut) · 'producto' = el mínimo es por producto (acciones Nestlé/Purina).

create table if not exists acciones_fila (
  proveedor text not null, periodo date not null, segmento text not null, categoria text,
  id_articulo integer, ean text, producto text,
  unidades_min numeric, costo numeric, bonif_fitnut numeric, bonif_adicional numeric, bonif_total numeric,
  costo_accion numeric, precio_combo numeric, pvp numeric,
  accion_nestle text, nestle_id text, nestle_hasta date,
  accion_chess text, chess_id text, grupo text, regla text
);
create index if not exists acciones_fila_idx on acciones_fila (proveedor, segmento);
alter table acciones_fila enable row level security;
create table if not exists acciones_combo (
  proveedor text not null, periodo date not null, segmento text not null,
  codigo integer, nombre text, hasta date, lineas jsonb, total numeric
);
alter table acciones_combo enable row level security;
create table if not exists acciones_meta (
  proveedor text primary key, periodo date, archivo text, actualizado timestamptz not null default now(), filas integer, combos integer
);
alter table acciones_meta enable row level security;

create or replace function cargar_acciones_ext(p_token text, p_proveedor text, p_periodo date, p_archivo text, p_filas jsonb, p_combos jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; c integer;
begin
  if not exists (select 1 from secretos where clave in ('token_cuentas', 'token_objetivos') and valor = p_token) then raise exception 'No autorizado'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene acciones'; end if;
  delete from acciones_fila where proveedor = upper(p_proveedor);
  delete from acciones_combo where proveedor = upper(p_proveedor);
  insert into acciones_fila (proveedor, periodo, segmento, categoria, id_articulo, ean, producto, unidades_min, costo, bonif_fitnut, bonif_adicional, bonif_total, costo_accion, precio_combo, pvp,
                             accion_nestle, nestle_id, nestle_hasta, accion_chess, chess_id, grupo, regla)
  select upper(p_proveedor), p_periodo, x.segmento, x.categoria, x.id_articulo, x.ean, x.producto, x.unidades_min, x.costo, x.bonif_fitnut, x.bonif_adicional, x.bonif_total, x.costo_accion, x.precio_combo, x.pvp,
         x.accion_nestle, x.nestle_id, nullif(x.nestle_hasta, '')::date, x.accion_chess, x.chess_id, x.grupo, x.regla
  from jsonb_to_recordset(p_filas) as x(segmento text, categoria text, id_articulo integer, ean text, producto text, unidades_min numeric, costo numeric, bonif_fitnut numeric, bonif_adicional numeric,
         bonif_total numeric, costo_accion numeric, precio_combo numeric, pvp numeric, accion_nestle text, nestle_id text, nestle_hasta text, accion_chess text, chess_id text, grupo text, regla text);
  get diagnostics n = row_count;
  insert into acciones_combo (proveedor, periodo, segmento, codigo, nombre, hasta, lineas, total)
  select upper(p_proveedor), p_periodo, x.segmento, x.codigo, x.nombre, nullif(x.hasta, '')::date, x.lineas, x.total
  from jsonb_to_recordset(coalesce(p_combos, '[]'::jsonb)) as x(segmento text, codigo integer, nombre text, hasta text, lineas jsonb, total numeric);
  get diagnostics c = row_count;
  insert into acciones_meta (proveedor, periodo, archivo, actualizado, filas, combos) values (upper(p_proveedor), p_periodo, p_archivo, now(), n, c)
  on conflict (proveedor) do update set periodo = excluded.periodo, archivo = excluded.archivo, actualizado = now(), filas = excluded.filas, combos = excluded.combos;
  return n;
end $$;
revoke execute on function cargar_acciones_ext(text, text, date, text, jsonb, jsonb) from public;
grant execute on function cargar_acciones_ext(text, text, date, text, jsonb, jsonb) to anon, authenticated;

create or replace function acciones_publicas() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'meta', coalesce((select jsonb_agg(to_jsonb(m)) from acciones_meta m), '[]'::jsonb),
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.proveedor, f.segmento, f.categoria, f.producto) from acciones_fila f), '[]'::jsonb),
    'combos', coalesce((select jsonb_agg(to_jsonb(c) order by c.proveedor, c.segmento, c.codigo) from acciones_combo c), '[]'::jsonb)
  );
$$;
revoke execute on function acciones_publicas() from public;
grant execute on function acciones_publicas() to anon, authenticated;
notify pgrst, 'reload schema';
