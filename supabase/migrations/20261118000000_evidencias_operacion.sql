-- VEO Territorios · documentos obligatorios para pasar a EN OPERACIÓN:
-- «Evidencia de programa de obra» y «Evidencia fotográfica».
-- Sólo amplía la lista permitida: los documentos existentes siguen siendo válidos.
alter table public.veo_documents drop constraint if exists veo_documents_doc_type_check;
alter table public.veo_documents add constraint veo_documents_doc_type_check
  check (doc_type in ('foto','satelital','dron','carta_intencion','predial','contrato','mecanica_suelos',
                      'memoria_calculo','factibilidad_electrica','permiso_municipal','programa_obra',
                      'evidencia_fotografica','operacion','otro'));
