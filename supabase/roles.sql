-- Rol "jefe" (ve los apartados de gestión de vendedores) y cambio de roles por el administrador.
-- Se puede ejecutar varias veces. Requiere haber ejecutado registro.sql.

alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check check (rol in ('pendiente', 'vendedor', 'jefe', 'admin'));

-- Los jefes también ven clientes y precios (como los vendedores).
create or replace function es_vendedor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from perfiles where id = auth.uid() and rol in ('vendedor', 'jefe', 'admin'))
$$;

-- true para jefes y administradores: se usará en los datos de gestión (objetivos, cuentas corrientes, etc.).
create or replace function es_jefe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from perfiles where id = auth.uid() and rol in ('jefe', 'admin'))
$$;

-- El administrador puede dejar a alguien como vendedor o jefe (no crea administradores ni toca a los existentes).
create or replace function cambiar_rol(uid uuid, nuevo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden cambiar roles'; end if;
  if nuevo not in ('vendedor', 'jefe') then raise exception 'Rol no permitido'; end if;
  update perfiles set rol = nuevo where id = uid and rol in ('pendiente', 'vendedor', 'jefe');
end $$;

revoke execute on function cambiar_rol(uuid, text) from public, anon;
grant  execute on function cambiar_rol(uuid, text) to authenticated;
