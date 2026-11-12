-- Segmentos que Chess no trae para algunos artículos (se completan solos en cada sincronización de artículos).
-- Si Chess sí trae el segmento, manda Chess. Fuente: carpeta de Drive "Segmentos" (Nestlé) + criterio del jefe.
create table if not exists articulos_segmento_manual (id_articulo integer primary key, segmento text not null, nota text);
alter table articulos_segmento_manual enable row level security;
insert into articulos_segmento_manual (id_articulo, segmento, nota) values
 (888,'ALIMENTO PARA MASCOTAS','Dog Chow (Purina)'),(895,'ALIMENTO PARA MASCOTAS','Dog Chow (Purina)'),
 (1048,'CPW','Cookie Crisp (Cereales)'),
 (1049,'CAFE','Nescafe RTD'),(1050,'CAFE','Nescafe RTD'),(1051,'CAFE','Nescafe RTD'),(1072,'CAFE','Starbucks RTD'),(1073,'CAFE','Starbucks RTD'),
 (1064,'CAFE','Seattle Best Coffee T&M'),(1065,'CAFE','Seattle Best Coffee T&M'),(1071,'CAFE','Nescafe Dolce Gusto Genio S'),
 (1069,'HILERET','Fruto del monje Hileret'),(1070,'HILERET','Fruto del monje Hileret')
on conflict (id_articulo) do update set segmento = excluded.segmento, nota = excluded.nota;
create or replace function articulos_cat_segmento_manual() returns trigger language plpgsql as $$
begin
  if coalesce(new.segmento, '') = '' then
    select m.segmento into new.segmento from articulos_segmento_manual m where m.id_articulo = new.id_articulo;
    new.segmento := coalesce(new.segmento, '');
  end if;
  return new;
end $$;
drop trigger if exists trg_segmento_manual on articulos_cat;
create trigger trg_segmento_manual before insert or update on articulos_cat for each row execute function articulos_cat_segmento_manual();
update articulos_cat a set segmento = m.segmento from articulos_segmento_manual m where m.id_articulo = a.id_articulo and coalesce(a.segmento, '') = '';
