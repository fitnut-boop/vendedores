-- Recuperar contraseña por mail (sin depender del SMTP de Supabase).
-- Flujo: pedir_recuperacion -> genera un token de 30 min -> pg_net llama al mailer (Apps Script) -> mail con link ?rec=TOKEN
--        -> la app pide la clave nueva -> canjear_recuperacion cambia la contraseña.
-- Requiere en la tabla secretos: 'url_mailer' (URL /exec del Apps Script) y 'token_mailer' (frase elegida por el dueño).

create table if not exists recuperaciones (
  token_hash text primary key, user_id uuid not null, vence timestamptz not null,
  usado boolean not null default false, creado timestamptz not null default now()
);
alter table recuperaciones enable row level security;   -- sin políticas: solo las funciones security definer la tocan

create or replace function pedir_recuperacion(p_usuario text, p_base text) returns void
language plpgsql security definer set search_path = public, extensions, net as $$
declare u text; uid uuid; mail text; nom text; tok text; urlm text; sec text;
begin
  -- el link solo puede apuntar a la app (evita que alguien arme un link a un sitio ajeno)
  if p_base is null or p_base !~ '^(https://fitnut-boop\.github\.io/vendedores/|http://localhost[:/])' then return; end if;
  u := trim(coalesce(p_usuario, ''));
  if u = '' then return; end if;
  if position('@' in u) = 0 then
    u := lower(regexp_replace(translate(u, 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn'), '\s+', '', 'g')) || '@usuarios.fitnut.app';
  end if;
  select a.id, p.email_contacto, p.nombre into uid, mail, nom
  from auth.users a join perfiles p on p.id = a.id
  where lower(a.email) = lower(u) or lower(p.email_contacto) = lower(u) limit 1;
  if uid is null or coalesce(mail, '') = '' then return; end if;               -- no se avisa si existe o no (no se filtran usuarios)
  if (select count(*) from recuperaciones where user_id = uid and creado > now() - interval '1 hour') >= 3 then return; end if;
  select valor into urlm from secretos where clave = 'url_mailer';
  select valor into sec from secretos where clave = 'token_mailer';
  if urlm is null or sec is null then return; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into recuperaciones (token_hash, user_id, vence) values (encode(sha256(convert_to(tok, 'utf8')), 'hex'), uid, now() + interval '30 minutes');
  perform net.http_post(url := urlm, headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('secret', sec, 'to', mail, 'nombre', coalesce(nom, ''), 'link', p_base || '?rec=' || tok));
end $$;

create or replace function canjear_recuperacion(p_token text, p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text; uid uuid;
begin
  if p_clave is null or length(p_clave) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  h := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  select user_id into uid from recuperaciones where token_hash = h and not usado and vence > now() for update;
  if uid is null then return false; end if;
  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now() where id = uid;
  update recuperaciones set usado = true where token_hash = h;
  return true;
end $$;

revoke execute on function pedir_recuperacion(text, text), canjear_recuperacion(text, text) from public;
grant execute on function pedir_recuperacion(text, text), canjear_recuperacion(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
