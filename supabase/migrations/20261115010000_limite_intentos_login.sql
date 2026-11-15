-- VEO Territorios · límite de intentos de inicio de sesión (anti fuerza bruta)
-- Llaves: 'u:<usuario>' (5 fallos / 15 min) e 'ip:<ip>' (20 fallos / 15 min) → bloqueo de 15 min.
-- Funciones atómicas para que intentos simultáneos no se salten el conteo.

create table if not exists public.veo_login_attempts (
  key          text primary key,
  fails        integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.veo_login_attempts enable row level security;
revoke all on public.veo_login_attempts from anon, authenticated;
grant all on public.veo_login_attempts to service_role;

-- Segundos de bloqueo restantes para cualquiera de las llaves (0 = libre)
create or replace function public.veo_login_check(p_keys text[])
returns integer
language sql
set search_path = public
as $$
  select coalesce(max(ceil(extract(epoch from (locked_until - now()))))::int, 0)
  from public.veo_login_attempts
  where key = any(p_keys) and locked_until > now();
$$;

-- Registra un fallo; devuelve los segundos de bloqueo si se alcanzó el máximo (0 si no)
create or replace function public.veo_login_fail(p_key text, p_max integer, p_window_s integer, p_lock_s integer)
returns integer
language plpgsql
set search_path = public
as $$
declare v_fails integer;
begin
  -- limpieza de registros viejos
  delete from public.veo_login_attempts
   where window_start < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.veo_login_attempts as a (key, fails, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    fails = case when a.window_start < now() - make_interval(secs => p_window_s) then 1 else a.fails + 1 end,
    window_start = case when a.window_start < now() - make_interval(secs => p_window_s) then now() else a.window_start end
  returning fails into v_fails;

  if v_fails >= p_max then
    update public.veo_login_attempts
       set locked_until = now() + make_interval(secs => p_lock_s), fails = 0, window_start = now()
     where key = p_key;
    return p_lock_s;
  end if;
  return 0;
end;
$$;

-- Limpia el contador tras un inicio de sesión correcto
create or replace function public.veo_login_reset(p_key text)
returns void
language sql
set search_path = public
as $$
  delete from public.veo_login_attempts where key = p_key;
$$;

revoke all on function public.veo_login_check(text[])                          from public, anon, authenticated;
revoke all on function public.veo_login_fail(text, integer, integer, integer)  from public, anon, authenticated;
revoke all on function public.veo_login_reset(text)                            from public, anon, authenticated;
grant execute on function public.veo_login_check(text[])                         to service_role;
grant execute on function public.veo_login_fail(text, integer, integer, integer) to service_role;
grant execute on function public.veo_login_reset(text)                           to service_role;
