-- VEO Territorios · Fase 5 «EN OPERACIÓN» y evidencia fotográfica/video de la operación.
-- Sólo amplía las listas permitidas: los datos existentes siguen siendo válidos.

alter table public.veo_predios drop constraint if exists veo_predios_phase_check;
alter table public.veo_predios add constraint veo_predios_phase_check
  check (phase in ('BUSQUEDA_FACTIBILIDAD','PRIMER_CONTACTO','SEGUIMIENTO','CIERRE','EN_OPERACION'));

alter table public.veo_documents drop constraint if exists veo_documents_doc_type_check;
alter table public.veo_documents add constraint veo_documents_doc_type_check
  check (doc_type in ('foto','satelital','dron','carta_intencion','contrato','mecanica_suelos',
                      'memoria_calculo','factibilidad_electrica','permiso_municipal','operacion','otro'));
