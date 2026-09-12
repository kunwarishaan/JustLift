-- Run once in the Supabase SQL Editor for the project used by this app.
-- Each row is one explicitly ended player turn, including zero-rep workouts.
-- The browser supplies a stable UUID before its first save and reuses it on
-- retries. Player names/calibration IDs never determine ownership.
create table if not exists public.just_lift_workouts (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null check (exercise_id in (
    'push-ups', 'bench-press', 'incline-dumbbell-press', 'weighted-dips', 'pec-fly',
    'dumbbell-row', 'seated-cable-row', 'pull-ups', 'chin-ups', 'barbell-row', 'lat-pulldown',
    'standing-dumbbell-curls', 'preacher-curls', 'dumbbell-hammer-curls',
    'rope-pushdown', 'skull-crushers', 'dumbbell-lateral-raises', 'dumbbell-shoulder-press',
    'squats', 'leg-press', 'hip-thrusts', 'leg-extensions', 'hamstring-curls', 'calf-raises'
  )),
  performed_at timestamptz not null check (isfinite(performed_at)),
  rep_count integer not null check (rep_count >= 0),
  rep_goal integer not null check (rep_goal between 1 and 999),
  weight_amount numeric check (weight_amount is null or weight_amount between 0 and 2000),
  weight_unit text not null check (weight_unit in ('kg', 'lb')),
  score integer not null check (score >= 0),
  primary key (id, user_id)
);

create index if not exists just_lift_workouts_owner_date_idx
  on public.just_lift_workouts (user_id, performed_at desc, id desc);

alter table public.just_lift_workouts enable row level security;

-- Supabase default grants must not accidentally expose this table to guests
-- or permit callers to rewrite historical results.
revoke all on public.just_lift_workouts from anon, authenticated;
grant select, insert on public.just_lift_workouts to authenticated;

drop policy if exists "Read own workouts" on public.just_lift_workouts;
create policy "Read own workouts"
  on public.just_lift_workouts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Insert own workouts" on public.just_lift_workouts;
create policy "Insert own workouts"
  on public.just_lift_workouts for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- No UPDATE or DELETE policy/grant is exposed to browser accounts. Upserts use
-- ON CONFLICT (id, user_id) DO NOTHING, preserving the original workout.
-- Display names are auth.users raw_user_meta_data.display_name, set by signUp.
-- No database trigger copies names or any existing local-browser game history.
