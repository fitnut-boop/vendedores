-- App Vendedores · esquema de Supabase
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a ejecutar sin romper nada.

-- ===== Tablas =====
create table if not exists perfiles (
  id     uuid primary key references auth.users on delete cascade,
  nombre text,
  rol    text not null default 'vendedor' check (rol in ('admin', 'vendedor'))
);

create table if not exists clientes (
  n        integer primary key,   -- Padrón col D
  razon    text not null,         -- Padrón col F
  fantasia text,
  lista    integer,               -- Padrón col AQ (1 general, 2 mayorista/distribuidora)
  subcanal integer                -- Padrón col AR (10 = farmacia)
);

create table if not exists precios (
  proveedor   text not null,
  codigo      text not null,      -- Código Chess
  descripcion text,
  g numeric,                      -- precio por bulto, lista General
  m numeric,                      -- Mayorista / Distribuidora
  f numeric,                      -- Farmacia
  primary key (proveedor, codigo)
);

create table if not exists articulos (
  codigo   text primary key,
  unidades integer not null       -- unidades por bulto
);

-- Número que sube con cada carga; la app lo compara para no volver a descargar todo.
create table if not exists version (
  id int primary key default 1 check (id = 1),
  v  bigint not null default 0
);
insert into version (id, v) values (1, 0) on conflict do nothing;

-- ===== Funciones =====
-- Estado de la sincronización automática con Chess (la escribe la función sync-chess).
create table if not exists sync_estado (
  clave          text primary key,   -- clientes | precios | articulos | ultimo_error
  hash           text,
  filas          integer,
  actualizado    timestamptz,        -- última vez que cambió algo
  ultimo_intento timestamptz,        -- última vez que corrió la sincronización
  error          text
);

-- true para administradores y para la función de sincronización (clave de servicio de Supabase).
create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
$$;

-- Cada usuario nuevo (alta desde Authentication → Users) recibe un perfil de vendedor.
create or replace function nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre) values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email))
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function nuevo_usuario();

-- ===== Seguridad (RLS) =====
alter table perfiles  enable row level security;
alter table clientes  enable row level security;
alter table precios   enable row level security;
alter table articulos enable row level security;
alter table version   enable row level security;
alter table sync_estado enable row level security;

drop policy if exists leer_sync      on sync_estado;
create policy leer_sync on sync_estado for select to authenticated using (es_admin());

drop policy if exists leer_perfil    on perfiles;
drop policy if exists leer_clientes  on clientes;
drop policy if exists leer_precios   on precios;
drop policy if exists leer_articulos on articulos;
drop policy if exists leer_version   on version;

create policy leer_perfil    on perfiles  for select to authenticated using (id = auth.uid() or es_admin());
create policy leer_clientes  on clientes  for select to authenticated using (true);
create policy leer_precios   on precios   for select to authenticated using (true);
create policy leer_articulos on articulos for select to authenticated using (true);
create policy leer_version   on version   for select to authenticated using (true);
-- No hay políticas de escritura: solo se escribe con las funciones de abajo (únicamente admin).

-- ===== Cargas de datos (solo admin) =====
create or replace function reemplazar_clientes(filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from clientes where true;
  insert into clientes (n, razon, fantasia, lista, subcanal)
  select n, razon, fantasia, lista, subcanal
  from jsonb_to_recordset(filas) as x(n int, razon text, fantasia text, lista int, subcanal int);
  update version set v = v + 1 where id = 1;
end $$;

create or replace function reemplazar_articulos(filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from articulos where true;
  insert into articulos (codigo, unidades)
  select codigo, unidades from jsonb_to_recordset(filas) as x(codigo text, unidades int);
  update version set v = v + 1 where id = 1;
end $$;

create or replace function reemplazar_lista(prov text, filas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cargar datos'; end if;
  delete from precios where proveedor = prov;
  insert into precios (proveedor, codigo, descripcion, g, m, f)
  select prov, codigo, descripcion, g, m, f
  from jsonb_to_recordset(filas) as x(codigo text, descripcion text, g numeric, m numeric, f numeric);
  update version set v = v + 1 where id = 1;
end $$;

revoke execute on function reemplazar_clientes(jsonb), reemplazar_articulos(jsonb), reemplazar_lista(text, jsonb) from public, anon;
grant  execute on function reemplazar_clientes(jsonb), reemplazar_articulos(jsonb), reemplazar_lista(text, jsonb) to authenticated, service_role;

-- ===== Registro propio de vendedores (con aprobación): ejecutar también supabase/registro.sql =====

-- ===== Después de crear tu usuario en Authentication → Users, hacete administrador =====
-- (reemplazá el email por el tuyo y ejecutá solo esta línea)
-- update perfiles set rol = 'admin' where id = (select id from auth.users where email = 'tu@email.com');
