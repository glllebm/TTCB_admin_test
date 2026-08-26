# TTCB_admin — full redesign plan (Players + Tournaments)

Based on discovery findings from `PROMPT_discover_admin_redesign_scope.md`
(both repos scanned) and two scope decisions from GM:
- **Newcomer status = newbie rating logic** (not just a label — this is
  a business-logic change to the rating engine, not pure UI).
- **Registration date**: backfill existing players with the migration
  date (technically inaccurate but fine for display purposes).

Pages in scope: `players.html`, `new-player.html` / `player.html`,
`tournaments.html`. `tournament.html` (management) is already done —
not touched.

**Scope note: desktop only.** No responsive/mobile layout work on any
of these pages for this pass — GM will send a mobile placeholder
separately later. Don't port TTCB_public's mobile card views (e.g. the
`.player-card` compact layout in the ratings table) — that's a mobile
concern, out of scope here. Implementation prompts should explicitly
tell the agent not to spend effort on breakpoints/responsive CSS. Design reference: `tournament.html`'s tokens win
everywhere; TTCB_public's ratings table and tournament cards are
**structure/concept** references only, not token references (per the
conflict table in the discovery report — public uses different font,
bg, pink, and radius).

---

## Phase 0 — rank-change arrow (RESOLVED, no backend work needed)

`rankChange` is already a live server-side mechanism (`applyRankDiff`,
server.js:217-224), stored as `rankBefore` on the player row, and
already included in the admin's own `/api/players` response
(server.js:133-134/148) — the admin's `players.html` just never reads
the field. Phase 3 can include the rank-change arrow as a pure
front-end addition, zero backend risk. (Sparse-arrow behavior is
intentional — only the mutated player and their displaced neighbor get
a nonzero delta, others rebase to zero — not a bug to "fix" during
implementation.)

## Phase 1 — Backend: player status field (UI-independent, ships first)

Risk: touches the rating engine's newbie logic — **diagnosis-first**,
per this project's standing rule for business-logic changes.

1. Diagnose current newbie detection: what condition currently marks a
   player as "newbie" for the rating-bonus rule (likely
   `tournaments === 0` or `rating === null` — confirm exact condition
   and every call site).
2. Add `status` field to the player object: `'Regular' | 'Newcomer' |
   'Archive'`, defaulting existing players to `'Regular'` except
   whoever currently satisfies the newbie condition → `'Newcomer'`
   (one-time backfill, computed not guessed).
3. Replace the newbie rating-bonus condition with `status ===
   'Newcomer'` everywhere it's currently checked differently.
4. Decide the transition rule: when does a `Newcomer` become `Regular`?
   (Likely: automatically after their first published tournament —
   confirm this matches the current newbie-bonus "one-time" semantics
   before assuming, since the current mechanism may already auto-clear
   itself via `tournaments === 0` naturally flipping to `false` after
   one tournament. If so, `status` needs the same auto-transition, not
   a value that silently goes stale.)
5. `Archive` has no existing analog — new, purely additive: archived
   players should probably drop out of the public ratings list/podium
   but keep their historical stats intact. Confirm with GM whether
   `Archive` should filter them from the public rating page before
   wiring that part (flagging — not deciding on your behalf here (Gleb reading this: confirm intent)).

Output of this phase: `status` exists, is correct for all current
players, drives the (renamed) newbie rule, and is settable from the
(not-yet-built) player form. No new UI needed to test this — can verify
via the existing player edit form.

## Phase 2 — Backend: registration date

Low risk, additive only.

1. Add `registeredAt` field, set automatically server-side on player
   creation (not user-editable — no field for it on the add/edit form,
   confirmed against the mockups which don't show one).
2. One-time backfill: for all existing players missing the field, set
   it to the migration date (today, per GM's decision) — a single
   `UPDATE` at migration time, not computed per-request.
3. Display-only on the Players list (Section: Design specs below).

## Phase 3 — Players list redesign (UI, gated on Phase 0 + Phase 1)

Rebuild `players.html`'s table using the admin design tokens, with
columns/structure borrowed from TTCB_public's ratings table (see
`DESIGN_players_list.md`). Depends on:
- Phase 0's answer (whether rank-change arrow ships now or is deferred).
- Phase 1 (status must exist to render/filter on it).
- Phase 2 (registration column).

Filtering: status pills (All/Regular/Newcomer/Archive) + sex pills
(All/Man/Women) + search — new filter UI, no backend change (client-side
filtering over the already-fetched player list, matching how search
already works).

## Phase 4 — Player add/edit form redesign (UI, gated on Phase 1)

Restyle `new-player.html` and `player.html` to match admin tokens
(pill toggles, rounded inputs, button row) per `DESIGN_player_form.md`.
Add the Status pill toggle (Regular/Newcomer/Archive) — the only new
field on this form; everything else (hand, blade, forehand, backhand,
gender, rating) already exists and just needs restyling.

## Phase 5 — Tournaments list redesign (UI only, no backend gate)

Port the category-colored card system from TTCB_public (`League
Series`/`Cup`/`Masters` → gray/dark/pink-gradient) into
`tournaments.html`, using admin tokens (24px radius, admin's `#F74A96`
pink instead of public's `#e93a8f`). Render the already-existing
`freeSlots` field as "Available spots" on active cards (data already on
the API response per discovery §7 — pure rendering change). Copy the
three ball PNG assets from TTCB_public into TTCB_admin's static assets.
See `DESIGN_tournaments_list.md`.

No backend change needed for this phase — `category` and `freeSlots`
already exist on the API response, just unused by the admin page today.

---

## Suggested shipping order

1. Phase 0 discovery (rank-change) — quick, unblocks Phase 3 planning.
2. Phase 1 (status/newbie) — diagnosis prompt first, then plan review,
   then implementation. Highest risk, do it in isolation with its own
   test pass before any UI work depends on it.
3. Phase 2 (registration date) — trivial, can ship alongside Phase 1.
4. Phase 5 (tournaments list) — no backend dependency, can happen in
   parallel with 1/2 if you want visible progress sooner.
5. Phase 3 (players list) — after 0/1/2 land.
6. Phase 4 (player form) — after 1 lands (needs the status field to exist).

## Not yet written (next step, per your "позже написать промпты")
Implementation prompts for the agent, one per phase, written only after
you confirm this plan and after Phase 0's discovery answer comes back.
