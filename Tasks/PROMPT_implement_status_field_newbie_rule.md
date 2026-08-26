# Implementation prompt — add `status` field, replace newbie rule with a real 5-tournament threshold (Phase 1 of admin redesign)

**Repo: PROD repo, `/Users/gleb/Documents/TTCB_admin` (glllebm/TTCB_admin, main branch).**

## Context (from prior diagnosis, confirmed against real code)
Current newbie condition, `tournament.html:1278`:
```js
isNewbie[p.id] = p.newbie != null ? !!p.newbie : (p.rating == null || p.rating < 1);
```
Effectively `rating == null` for real players — self-clears after their
first published tournament (once they have any rating). Drives only the
win/loss coefficient in `ratingMatchDelta` (`tournament.html:1175`,
called at `1294`): newbie win coefficient = flat `1`, newbie loss
coefficient = flat `0.5`, bypassing `k * D` entirely. Never affects
`startRating`.

**Business decision (final, confirmed with GM):** "Newcomer" is now a
real status meaning *the player hasn't played 5 tournaments yet* — the
fixed-delta newbie treatment applies for tournaments 1 through 5, not
just tournament 1. This is a genuine rating-behavior change, not a
relabeling.

## What to build

### 1. Data model
Add `status: 'Regular' | 'Newcomer' | 'Archive'` to the player object
(server-side storage + client state). This is the field the redesigned
player form (see `DESIGN_player_form.md`) will read/write via a pill
toggle, and the redesigned players list will filter/badge on.

### 2. Migration / backfill (one-time, run once at deploy)
**Final decision (confirmed with GM): one uniform rule for every
player, old and new — no special-cased branch for existing players.**
For every existing player:
- `tournaments >= 5` → `status: 'Regular'`
- `tournaments < 5` → `status: 'Newcomer'`

This is a deliberate exception to this project's usual forward-only
pattern (ledgers, republish) — GM explicitly chose full retroactive
application here because it only affects the coefficient used in each
player's *next* tournament going forward, it does not rewrite any
already-recorded rating history. Concretely: a player currently sitting
at 1-4 tournaments, who under the old `rating == null` rule was already
treated as non-newbie, will be reclassified `Newcomer` by this
migration and will get the flat-coefficient treatment in their next
tournament (until they reach 5). This is intended, not a bug — don't
"fix" it back to a forward-only split.

**Archive**: nothing currently maps to it — no existing player should
become `Archive` during this migration, it's purely a new manual option
going forward.

### 3. Replace the newbie condition
At `tournament.html:1278`, replace the `rating == null` fallback with
`p.status === 'Newcomer'`. Keep the `p.newbie != null` explicit-override
tier as-is for now (DEV_MODE fixtures at 603-617 use it — don't break
those) unless you find during implementation that it's dead weight,
in which case flag it rather than silently removing it.

The player object built for tournament slots at `tournament.html:2785`
needs a `status: player.status` field added so it's readable at 1278 —
currently it's not passed through at all.

### 4. Auto-transition: Newcomer → Regular at the 5th tournament
The publish flow (`server.js:497-544`) already writes updated
`tournaments` counts back to the player row. Add: after incrementing
`tournaments`, if the player's `status === 'Newcomer'` and the new
`tournaments` count reaches `5`, set `status = 'Regular'`. This must
fire during the same publish transaction/write that updates
`tournaments`, not as a separate pass (avoid a window where the count
is bumped but status isn't, if publish can partially fail).
- Manual override stays available: the player form lets GM set
  `Regular` earlier or set `Archive` at any time — the auto-transition
  only ever moves `Newcomer → Regular`, never touches `Archive` and
  never overrides a GM's earlier manual `Regular` (idempotent — setting
  `Regular` on an already-`Regular` player is a no-op).
- Confirm whether **republish** (`_republish()`) needs the same
  auto-transition check — likely yes for consistency, since republish
  recomputes `tournaments` deltas too, but verify against the actual
  republish code path before assuming, and report if the two paths
  diverge in a way that needs a shared helper function instead of
  duplicated logic.

### 5. New player creation default
A brand-new player (via `new-player.html`) should default `status` to
`'Newcomer'` (tournaments = 0 at creation) unless GM explicitly picks a
different value on the form — the form should show `Newcomer` as the
pre-selected pill for a new player, not `Regular`.

## Constraints
- This touches the rating engine (coefficient logic) — before applying
  the `tournament.html:1278` change, **write and run a quick regression
  script** covering: (a) a newcomer player at tournament 1, 4, 5, and 6
  gets the correct coefficient (flat for 1-5, real k·D at 6+), (b) an
  existing player who was backfilled to `Regular` at migration never
  gets the newbie coefficient again regardless of future tournament
  count, (c) the win coefficient (`1`) and loss coefficient (`0.5`)
  values themselves are unchanged — only the *condition* for applying
  them changes. Report the script's pass/fail before touching the live
  rating path.
- Don't touch `startRating` logic — confirmed unaffected by newbie
  status, keep it that way.
- Commit the migration and the code change together, but describe them
  as separable in the commit message (data migration vs. logic change)
  in case one needs to be reverted independently.
- Once implemented, report back the migration's actual effect (how many
  existing players ended up `Regular` vs `Newcomer`) so GM can sanity
  check the numbers before this ships to real tournaments.
