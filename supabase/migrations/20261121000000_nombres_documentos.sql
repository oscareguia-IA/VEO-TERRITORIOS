-- VEO Territorios · Nombres estándar para los documentos ya subidos.
-- Cada archivo se llama como lo que se solicitó (foto_predio_1.jpg, recibo_predial_1.pdf…),
-- numerado por predio y tipo en orden de carga. El nombre con el que se subió (WhatsApp,
-- cámara, etc.) se conserva en la nueva columna source_filename, así que es reversible.

alter table public.veo_documents add column if not exists source_filename text;
update public.veo_documents set source_filename = original_filename where source_filename is null;

with abbr(doc_type, base) as (values
  ('foto','foto_predio'),('satelital','mapa_satelital'),('dron','video_dron'),('carta_intencion','carta_intencion'),
  ('predial','recibo_predial'),('contrato','contrato'),('mecanica_suelos','mecanica_suelos'),('memoria_calculo','memoria_calculo'),
  ('factibilidad_electrica','factibilidad_electrica'),('permiso_municipal','permiso_municipal'),('programa_obra','programa_obra'),
  ('operacion','operacion'),('otro','documento')),
numerados as (
  select d.id, a.base,
         row_number() over (partition by d.predio_id, d.doc_type order by d.created_at, d.id) as n,
         replace(lower(coalesce(substring(d.source_filename from '\.([A-Za-z0-9]{1,5})$'), '')), 'jpeg', 'jpg') as ext
  from public.veo_documents d join abbr a on a.doc_type = d.doc_type)
update public.veo_documents d
   set original_filename = x.base || '_' || x.n || case when x.ext <> '' then '.' || x.ext else '' end
  from numerados x
 where x.id = d.id;
