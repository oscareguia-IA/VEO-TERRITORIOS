-- VEO Territorios · nuevo tipo documental «Recibo de pago del predial» (requisito de fase 2 → 3).
-- Sólo amplía la lista permitida: los documentos existentes siguen siendo válidos.
alter table public.veo_documents drop constraint if exists veo_documents_doc_type_check;
alter table public.veo_documents add constraint veo_documents_doc_type_check
  check (doc_type in ('foto','satelital','dron','carta_intencion','predial','contrato','mecanica_suelos',
                      'memoria_calculo','factibilidad_electrica','permiso_municipal','operacion','otro'));
