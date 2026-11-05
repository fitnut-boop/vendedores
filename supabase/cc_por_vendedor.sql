-- Cuentas corrientes: jefes/administradores ven todas; cada vendedor ve SOLO las de su código de vendedor.
-- Requiere roles.sql y rutas_cc.sql. Se puede ejecutar varias veces.

alter table perfiles add column if not exists id_vendedor integer;   -- código de vendedor de Chess asignado a la cuenta

create or replace function mi_vendedor() returns integer
language sql stable security definer set search_path = public as $$
  select id_vendedor from perfiles where id = auth.uid()
$$;
revoke execute on function mi_vendedor() from public, anon;
grant  execute on function mi_vendedor() to authenticated;

drop policy if exists cc_leer on cuentas_corrientes;
create policy cc_leer on cuentas_corrientes for select to authenticated
  using (es_jefe() or (es_vendedor() and id_vendedor is not null and id_vendedor <> 0 and id_vendedor = mi_vendedor()));

-- El administrador asigna a cada cuenta su código de vendedor (null = sin vendedor asignado).
create or replace function asignar_vendedor(uid uuid, vendedor integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo los administradores pueden asignar vendedores'; end if;
  update perfiles set id_vendedor = vendedor where id = uid;
end $$;
revoke execute on function asignar_vendedor(uuid, integer) from public, anon;
grant  execute on function asignar_vendedor(uuid, integer) to authenticated;
