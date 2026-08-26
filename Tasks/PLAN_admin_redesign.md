# TTCB_admin — full redesign plan (Players + Tournaments)

**Environment: all work in this plan happens on `TTCB_admin_test`
first, not prod.** `TTCB_admin_test` must be synced to current prod
state (code + data) before any phase below starts — see
`PROMPT_promote_prod_to_admin_test.md`. Nothing in this plan touches
`TTCB_admin` (prod) directly; promotion test→prod happens as a
separate, explicit step once the redesign is verified on test.

Based on discovery findings from `PROMPT_discover_admin_redesign_scope.md`
(both repos scanned) and two scope decisions from GM:
- **Newcomer status = newbie rating logic** (not just a label — this
  is a business-logic change to the rating engine, not pure UI).
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
tell the agent not to spend effort on breakpoints/responsive CSS.

Design reference: `tournament.html`'s tokens win everywhere;
TTCB_public's ratings table and tournament cards are
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
per this project's standing rule for business-logic changes. Diagnosis
done, decisions confirmed, implementation prompt written — see
`PROMPT_implement_status_field_newbie_rule.md`. Summary of what's
locked in:
- `status: 'Regular' | 'Newcomer' | 'Archive'` added to the player
  object.
- Newbie rating treatment redefined: `Newcomer` = hasn't played 5
  tournaments yet (was: no rating yet, self-cleared after tournament 1).
- Migration backfill is uniform for all players (old and new):
  `tournaments >= 5 → Regular`, else `Newcomer` — a deliberate,
  GM-approved exception to this project's usual forward-only pattern,
  since it only affects future coefficient application, not historical
  rating results.
- Auto-transition `Newcomer → Regular` fires in the publish (and
  likely republish) flow when `tournaments` reaches 5; manual override
  to `Regular`/`Archive` always available on the player form.

## Phase 2 — Backend: registration date

Low risk, additive only.

1. Add `registeredAt` field, set automatically server-side on player
   creation (not user-editable — no field for it on the add/edit form,
   confirmed against the mockups which don't show one).
2. One-time backfill: for all existing players missing the field, set
   it to the migration date (today, per GM's decision) — a single
   `UPDATE` at migration time, not computed per-request.
3. Display-only on the Players list (Section: Design specs below).

## Phase 3 — Players list redesign (UI, gated on Phase 1)

Rebuild `players.html`'s table using the admin design tokens, with
columns/structure borrowed from TTCB_public's ratings table (see
`DESIGN_players_list.md`). Depends on:
- Phase 1 (status must exist to render/filter on it).
- Phase 2 (registration column).
- Rank-change arrow ships here too (Phase 0 confirmed it's free).

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

1. Sync `TTCB_admin_test` to prod (code + data) — must happen first,
   before any phase below.
2. Phase 1 (status/newbie) — implementation prompt ready, regression
   test before touching the live rating path. Highest risk, ship in
   isolation with its own verification pass before UI work depends on
   it.
3. Phase 2 (registration date) — trivial, can ship alongside Phase 1.
4. Phase 5 (tournaments list) — no backend dependency, can happen in
   parallel with 1/2 if you want visible progress sooner.
5. Phase 3 (players list) — after 1/2 land.
6. Phase 4 (player form) — after 1 lands (needs the status field to exist).
7. Once everything is verified on `TTCB_admin_test`, a separate
   test→prod promotion step (same pattern as the earlier bracket-seeding
   promotion) ships the whole redesign to `TTCB_admin`.
