-- Registro propio de vendedores con aprobación del administrador.
-- Se puede ejecutar varias veces. (Ya está incluido para instalaciones nuevas al final de schema.sql.)

alter table perfiles add column if not exists email text;
alter table perfiles add column if not exists creado timestamptz default now();
update perfiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check check (rol in ('pendiente', 'vendedor', 'admin'));
alter table perfiles alter column rol set default 'pendiente';   -- toda cuenta nueva empieza sin acceso

create or replace function nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), new.email), new.email)
  on conflict do nothing;
  return new;
end $$;

-- true para vendedores y administradores aprobados (y para la función de sincronización).
create or replace function es_vendedor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from perfiles where id = auth.uid() and rol in ('vendedor', 'admin'))
$$;

-- Los datos solo los leen usuarios aprobados (antes: cualquiera con sesión).
drop policy if exists leer_clientes  on clientes;
drop policy if exists leer_precios   on precios;
drop policy if exists leer_articulos on articulos;
drop policy if exists leer_version   on version;
create policy leer_clientes  on clientes  for select to authenticated using (es_vendedor());
create policy leer_precios   on precios   for select to authenticated using (es_vendedor());
create policy leer_articulos on articulos for select to authenticated using (es_vendedor());
create policy leer_version   on version   for select to authenticated using (es_vendedor());

-- Aprobar / rechazar (solo administradores).
create or replace function aprobar_usuario(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden aprobar usuarios'; end if;
  update perfiles set rol = 'vendedor' where id = uid and rol = 'pendiente';
end $$;

create or replace function eliminar_usuario(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden eliminar usuarios'; end if;
  if uid = auth.uid() then raise exception 'No podés eliminar tu propio usuario'; end if;
  if exists (select 1 from perfiles where id = uid and rol = 'admin') then raise exception 'No se puede eliminar a un administrador desde acá'; end if;
  delete from auth.users where id = uid;   -- el perfil se borra en cascada
end $$;

revoke execute on function aprobar_usuario(uuid), eliminar_usuario(uuid) from public, anon;
grant  execute on function aprobar_usuario(uuid), eliminar_usuario(uuid) to authenticated;
