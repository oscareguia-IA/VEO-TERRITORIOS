-- VEO Territorios · Rol «DG» (Dirección General) con los mismos privilegios que «admin».
-- Sólo amplía la lista permitida: los usuarios existentes siguen siendo válidos.
-- Reversión: volver a la lista sin 'dg' (después de reasignar a los usuarios DG).
alter table public.veo_users drop constraint if exists veo_users_role_check;
alter table public.veo_users add constraint veo_users_role_check
  check (role in ('admin','dg','supervisor','broker','legal','tecnico'));
