-- Private, account-owned records. Deployment never truncates or seeds these tables.
create table public.qinglan_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  revision bigint not null check (revision >= 1),
  updated_at timestamptz not null default now()
);

create table public.qinglan_profile_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  profile jsonb not null,
  updated_at timestamptz not null,
  primary key (user_id, revision)
);

alter table public.qinglan_profiles enable row level security;
alter table public.qinglan_profile_versions enable row level security;
grant usage on schema public to authenticated;
revoke all on public.qinglan_profiles, public.qinglan_profile_versions from public, anon, authenticated;
grant select on public.qinglan_profiles, public.qinglan_profile_versions to authenticated;
create policy own_profile_read on public.qinglan_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_versions_read on public.qinglan_profile_versions for select to authenticated using (user_id = (select auth.uid()));

create function public.qinglan_save_profile(p_profile jsonb, p_expected_revision bigint, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_row public.qinglan_profiles%rowtype;
  numeric_keys text[] := array['cash','income','expense','monthlyDebt','priorityDebt','nearTerm','emergencyMonths','maxLoss','goldGrams','goldCost','goldPrice','goldBudget','fundUnits','fundCost','fundPrice'];
  allowed_keys text[] := numeric_keys || array['mode','risk','useGoldQuote','useFundNav','savedAt','filledFields'];
  field text;
  amount numeric;
  next_revision bigint;
  save_time timestamptz := clock_timestamp();
begin
  if owner_id is null or p_expected_user_id is distinct from owner_id then raise exception using errcode = 'QF401', message = 'Sign in required or account changed'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception using errcode = 'QF422', message = 'Invalid revision'; end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or octet_length(p_profile::text) > 16384 then
    raise exception using errcode = 'QF422', message = 'Invalid profile';
  end if;
  if exists (select 1 from jsonb_object_keys(p_profile) as k where not (k = any(allowed_keys)))
    or (p_profile ->> 'mode') is distinct from 'personal'
    or not coalesce((p_profile ->> 'risk') = any(array['steady','balanced','growth']), false)
    or jsonb_typeof(p_profile -> 'useGoldQuote') is distinct from 'boolean'
    or jsonb_typeof(p_profile -> 'useFundNav') is distinct from 'boolean' then
    raise exception using errcode = 'QF422', message = 'Invalid fields';
  end if;
  foreach field in array numeric_keys loop
    if jsonb_typeof(p_profile -> field) is distinct from 'number' then raise exception using errcode = 'QF422', message = 'Invalid number'; end if;
    amount := (p_profile ->> field)::numeric;
    if amount < 0 or amount > 100000000000 then raise exception using errcode = 'QF422', message = 'Number out of range'; end if;
    if field = 'emergencyMonths' and (amount > 24 or amount <> trunc(amount)) then raise exception using errcode = 'QF422', message = 'Invalid emergency months'; end if;
  end loop;
  if p_profile ? 'filledFields' then
    if jsonb_typeof(p_profile -> 'filledFields') <> 'array' then raise exception using errcode = 'QF422', message = 'Invalid filled fields'; end if;
    if exists (select 1 from jsonb_array_elements(p_profile -> 'filledFields') f where jsonb_typeof(f) <> 'string' or not ((f #>> '{}') = any(numeric_keys))) then
      raise exception using errcode = 'QF422', message = 'Invalid filled fields';
    end if;
  end if;
  if p_profile ? 'savedAt' and (jsonb_typeof(p_profile -> 'savedAt') <> 'string' or length(p_profile ->> 'savedAt') > 40) then
    raise exception using errcode = 'QF422', message = 'Invalid saved time';
  end if;

  -- Serialize both first saves and updates for this account, including concurrent devices.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into current_row from public.qinglan_profiles where user_id = owner_id for update;
  if coalesce(current_row.revision, 0) <> p_expected_revision then
    raise exception using errcode = 'QF409', message = 'Profile changed on another device';
  end if;
  next_revision := coalesce(current_row.revision, 0) + 1;
  insert into public.qinglan_profiles(user_id, profile, revision, updated_at) values (owner_id, p_profile, next_revision, save_time)
    on conflict (user_id) do update set profile = excluded.profile, revision = excluded.revision, updated_at = excluded.updated_at;
  insert into public.qinglan_profile_versions(user_id, revision, profile, updated_at) values (owner_id, next_revision, p_profile, save_time);
  delete from public.qinglan_profile_versions where user_id = owner_id and revision <= next_revision - 20;
  return jsonb_build_object('profile', p_profile, 'revision', next_revision, 'updated_at', save_time);
end;
$$;

revoke all on function public.qinglan_save_profile(jsonb, bigint, uuid) from public, anon;
grant execute on function public.qinglan_save_profile(jsonb, bigint, uuid) to authenticated;
