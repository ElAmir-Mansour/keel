-- Keel sync store. Run once in the Supabase SQL editor of your own project.
-- Every synced record is one JSON row owned by the signed-in user; row-level
-- security keeps users apart. `synced_at` is stamped by the server so the
-- pull cursor never depends on a device clock.

create table if not exists public.keel_records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at  timestamptz not null default now(),
  primary key (user_id, tbl, id)
);

create index if not exists keel_records_user_synced on public.keel_records (user_id, synced_at);

create or replace function public.keel_touch_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists keel_records_touch on public.keel_records;
create trigger keel_records_touch
  before insert or update on public.keel_records
  for each row execute function public.keel_touch_synced_at();

alter table public.keel_records enable row level security;

drop policy if exists "keel: own rows" on public.keel_records;
create policy "keel: own rows" on public.keel_records
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
