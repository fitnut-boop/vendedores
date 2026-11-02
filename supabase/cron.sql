-- Programa la sincronización automática con Chess.
-- Antes: 1) ejecutar schema.sql  2) desplegar la función sync-chess  3) cargar los secretos.
-- Reemplazá TU_SYNC_TOKEN (el mismo texto que guardaste en el secreto SYNC_TOKEN) y ejecutá todo en el SQL Editor.
-- La función se deja con "Verify JWT" ACTIVADO: por eso el cron manda también la clave pública (anon) del proyecto.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Cada 30 minutos. Para cambiar la frecuencia, editá la expresión (ej. '*/15 * * * *' = cada 15 min).
select cron.schedule(
  'sync-chess',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://ounaoxtsttcsffmtebvz.supabase.co/functions/v1/sync-chess',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91bmFveHRzdHRjc2ZmbXRlYnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1OTQxMjQsImV4cCI6MjEwOTE3MDEyNH0.pp3fHC5ZSlzvbiBqUCqOqQS4o1lC4tcIP0RR7sfqrbA',
      'x-sync-token', 'TU_SYNC_TOKEN'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Para ver si corre:     select * from cron.job_run_details order by start_time desc limit 5;
-- Para detenerla:        select cron.unschedule('sync-chess');
