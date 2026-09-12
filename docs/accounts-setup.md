# Connect real player accounts

The account flow needs one Supabase project shared by every device. Until its
URL and public key are configured, the app shows a disconnected sign-in screen.
It does not create substitute local accounts.

Each player signs in separately with email and password. A completed **End Turn**
saves that player's exercise, date, actual accepted rep count, goal, weight/unit,
and score. Player 1's workout does not wait for Player 2. The next setup uses
that account's latest saved actual reps and weight for the selected exercise;
an exercise without history starts blank. Zero completed reps remain zero, so
the player must choose a positive next goal.

## 1. Create the shared project

1. Sign in at [Supabase Dashboard](https://supabase.com/dashboard), select your
   organization, and choose **New project**.
2. Give the project a name, choose a region, and set the database password in
   Supabase. Keep that password private; it is not needed by this browser app.
3. Wait for the project to finish provisioning.
4. Open the project's **Connect** panel and copy its **Project URL** and
   **Publishable key**. The key starts with `sb_publishable_`.

These are the browser connection settings used in Supabase's
[React quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs).
The app also accepts a legacy `anon` JWT, but rejects secret keys and
`service_role` keys. Elevated keys belong on trusted servers and bypass the
protections needed here. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## 2. Create the workout table and policies

1. Open **SQL Editor** in this Supabase project and create a new query.
2. Paste the complete contents of [supabase/schema.sql](../supabase/schema.sql).
3. Select **Run**.
4. In **Table Editor**, confirm `public.just_lift_workouts` exists and RLS is
   enabled. Check that the two policies are **Read own workouts** and
   **Insert own workouts**.

The schema permits authenticated users to select and insert only rows whose
`user_id` matches their authenticated user UUID. It grants no anonymous access
and no browser update/delete access. The composite key `(id, user_id)` makes
repeated saves of the same workout safe without overwriting an earlier result.
Display names live in Auth user metadata; no separate profile table or trigger
is needed. The app never imports old localStorage games by matching names.

## 3. Configure email sign-in

In **Authentication → Sign In / Providers**, enable the Email provider and new
user signups. Use **Confirm Email** for real users. Registration then displays
an instruction to confirm the email and sign in again; confirmation does not
automatically choose either player slot. These controls are described in
[Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

In **Authentication → URL Configuration**, set **Site URL** to the app's exact
current address. For local testing, use the localhost URL printed by Vite,
including its port, for example `http://localhost:5173/`. Add that address to
the allowed redirect URLs. When deploying, set Site URL to the deployed HTTPS
address and retain only the development/preview redirects you need. This app
uses the default Site URL for confirmation redirects; opening a localhost
confirmation link on a phone cannot reach the developer's laptop.
[Supabase redirect settings](https://supabase.com/docs/guides/auth/redirect-urls)
explain the Site URL and allow list.

For confirmations sent to normal users, configure **Authentication → Custom
SMTP** with your email provider. Supabase's built-in mail service only sends to
organization team-member addresses and has restrictive delivery limits. For a
private, disposable demo project, you can explicitly disable Confirm Email to
exercise account creation without email delivery; those addresses will be
unverified. Keep email verification enabled and configure delivery before
accepting real users. See [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).

## 4. Configure the app and restart Vite

From the project root, copy the example file:

```sh
cp .env.example .env
```

Fill `.env` with the project's public values:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

For a legacy project, use `VITE_SUPABASE_ANON_KEY` instead of the publishable-key
variable. Do not put a database password, SMTP password, secret key, or
`service_role` key in any `VITE_*` variable. Vite exposes those values in its
browser bundle. `.env` is ignored by git; `.env.example` contains no credentials.

Stop the running dev server and start it again:

```sh
npm run dev
```

Changing `.env` requires a restart. Production settings must be present when
the production bundle is built; changing a hosting variable requires a rebuild
and redeploy. See [Vite environment variables](https://vite.dev/guide/env-and-mode).

## 5. Use the same backend from other devices

Configure the hosting project's build environment with the same Project URL
and public key. Run `npm run build` and serve `dist/` through an HTTPS host.
Set the production Site URL in Supabase to this HTTPS address. Camera access
requires a secure context; localhost is suitable for development, but a plain
HTTP LAN address is not a cross-device camera deployment.
[MDN documents the camera requirement](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Both devices must point to this same Supabase project. A player can then sign
in on another device and see previously saved workouts. The two people in one
game must use different accounts. Sessions are memory-only: reloading or
closing the page requires signing in again. Signing out one player uses local
session scope and does not deliberately sign that account out on other devices.
The app does not persist credentials, sessions, or account history in
localStorage. Camera frames and landmarks remain local.

Use **Push-ups** for live tracking. Account setup leaves the existing scoring
and calibration unchanged: Player 1 uses Justin's profile and Player 2 uses
Octavio's. Other catalogue selections are workout metadata and illustrations,
not additional trained exercise detectors.

## 6. Verify the connected project

Run the local checks:

```sh
npm test -- src/accountService.test.js src/AccountGame.test.jsx src/WorkoutProgress.test.jsx
npm test
npm run build
```

These tests mock Supabase. They check the application contract and cannot prove
that a deployed project's Auth settings, email delivery, grants, or RLS policies
are correct. The following checks still require a real configured project:

1. Create two test accounts with different emails. Confirm both emails when
   confirmation is enabled. Verify incorrect passwords and an unconfirmed
   account cannot sign in; the same account cannot occupy both player slots.
2. Sign in both players. For an unseen exercise, verify both goals and weights
   start blank. Enter distinct goals and weights. End Player 1's turn and check
   their row appears in Supabase before Player 2 has finished.
3. Complete Player 2's turn, including a zero-rep case. Compare the saved
   `rep_count`, `rep_goal`, `weight_amount`, `weight_unit`, `exercise_id`, and
   `score` with the finished turn. A missed goal must still save the actual reps.
4. Replay and verify each player's fields use their own latest actual reps and
   weight. Change exercises and verify the account/exercise pairing is respected.
5. Sign in on another device. Verify the same saved history appears. Sign out
   and use another account; the previous person's history must disappear.
6. Temporarily interrupt the network during a save. Restore it and use **Retry
   save**. Confirm only one row exists for that workout ID and user. Keep the
   original page open while a save is pending; pending records are not persisted
   locally and cannot survive a page close.

### Verify RLS independently of the UI

Frontend filtering is not proof of database isolation. In SQL Editor, ordinary
queries run with elevated privileges. To test a player's read policy, substitute
a real test user's UUID from **Authentication → Users** and explicitly change
to the authenticated role within a rollback-only transaction:

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"REPLACE_WITH_USER_A_UUID","role":"authenticated"}',
  true
);
select id, user_id, exercise_id, rep_count
from public.just_lift_workouts;
rollback;
```

Only User A's rows should appear. Repeat as User B. Then test these cases with
the public API using the corresponding test user's session, or in separate
rollback-only SQL transactions under that role:

| Caller and action | Expected result |
| --- | --- |
| Anonymous SELECT or INSERT | Permission denied |
| User A SELECT with `user_id = User B` | No rows |
| User A INSERT with `user_id = User A` and valid fields | Allowed |
| User A INSERT with `user_id = User B` | RLS rejection |
| User A INSERT with unknown exercise, negative reps/weight, or invalid goal | Constraint rejection |
| User A UPDATE or DELETE of an existing workout | Permission denied |
| User A retries the same `(id, user_id)` with `ON CONFLICT DO NOTHING` | Original row remains unchanged |

Rollback each manual SQL write test. Do not use a service-role key to test the
browser's access rules because it bypasses RLS. Record the outcomes before
calling the cloud integration verified. See
[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
