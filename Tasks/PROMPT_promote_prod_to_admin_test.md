# Sync prompt — bring TTCB_admin_test up to current PROD state before starting the redesign

**Direction: PROD → TEST** (the reverse of the earlier test→prod
promotion done this project). Source: `TTCB_admin`
(`/Users/gleb/Documents/TTCB_admin`, glllebm/TTCB_admin, main branch —
current live code, includes everything shipped so far: rating
trend-baseline unification, republish, seeding-freeze split, status
quo before the admin redesign). Target: `TTCB_admin_test` (confirm the
local path and Railway service still exist and are reachable — this
repo was abandoned mid-project, so verify its state before assuming
anything about it).

## Goal
The upcoming admin redesign (status field + newbie rule, Players list,
Player form, Tournaments list — see `Tasks/PLAN_admin_redesign.md` and
sibling files) should be built and verified on `TTCB_admin_test` first,
not directly on prod. Before any of that work starts, `TTCB_admin_test`
needs to be an exact copy of current `TTCB_admin` — code AND data —
so testing happens against realistic state, not stale/abandoned test
data.

## Steps

1. **Confirm TTCB_admin_test's current state first.** Don't assume it's
   still in whatever shape it was left in — check: does the local repo
   still exist, does its Railway service still exist and run, is it
   still linked to a Railway project. Report what you find before
   proceeding — if the Railway service was deleted/suspended, that
   changes the plan (may need to recreate it rather than just sync
   into it).

2. **Code sync**: bring `TTCB_admin_test`'s code to exactly match
   `TTCB_admin`'s current `main` branch — same approach as the earlier
   test→prod code promotion (code only, don't blindly overwrite
   anything test-specific like environment config/connection strings
   that legitimately need to differ between the two services).

3. **Data sync**: copy PROD's actual database into
   `TTCB_admin_test`'s database, so the test environment has real
   players/tournaments/ratings to test the redesign against, not empty
   or stale fixtures. Use the same `ssh railway.new` + `VACUUM INTO`
   backup approach used earlier this project for the prod DB backup —
   confirm you can reach both services this way before starting.
   **This overwrites TTCB_admin_test's existing DB — confirm there's
   nothing in it worth preserving first (there shouldn't be, it was
   abandoned, but check rather than assume).**

4. **Verify**: after sync, load `TTCB_admin_test`'s live URL and
   confirm it shows real prod-equivalent data (a known player, a known
   tournament) — don't just trust that the copy succeeded, look at the
   result.

## Constraint
This is infrastructure sync, not a code change — no redesign work
happens in this pass. Report back once `TTCB_admin_test` is confirmed
to mirror prod exactly (code + data), and I'll send the redesign task
prompts targeting `TTCB_admin_test` from that point on.
