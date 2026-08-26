# Design spec — Players list (players.html)

**Environment: implement on `TTCB_admin_test`, not prod.**

**Icons: use the assets in the `new icon` folder (also in
`TTCB_admin_test`)** for the edit/pencil icon, search icon, rank-change
arrow, rating-trend arrow, and the "+" on the Add player button — check
that folder before building any inline SVG, don't reimplement icons
that already exist there.

Structural reference: TTCB_public's ratings table (`TTCB_Rating.html`) —
row layout, column set, dual-arrow concept. Visual tokens: admin's
`tournament.html` (this page must look like it belongs to the same app
as the tournament-management screen, not like the public site).

## Tokens (from tournament.html — do not use TTCB_public's values)
- Font: PT Root UI
- Page background: `#F7F7F7`
- Row/card background: `#FFFFFF`
- Radius: 24px on the outer list container, ~16px on individual rows
  if rows are visually separated cards (match the rounded-row look in
  the admin mockup screenshot, not public's tighter 10px rows)
- Text primary: `#1F1F1F`, text secondary/muted: `#333333`
- Pink accent (trend-up color / Newcomer badge): `#F74A96`
- Rating trend triangle colors: keep existing green-up/red-down from
  the current `players.html` implementation — the mockup shows the
  rating trend arrow in green next to a pink-tinted rating number,
  don't invert this without confirming, it's an existing convention.

## Columns (left to right, per the mockup + public reference)
1. **Rank** — numeric position + rank-change arrow (▲/▼ + delta) next
   to it, small and muted, e.g. `1 ▲2`. Confirmed free: `rankChange` is
   already computed server-side (`applyRankDiff`, server.js:217-224)
   and already included in the admin's `/api/players` response
   (server.js:133-134/148) — this is a pure front-end read-and-render,
   no backend work needed. Note the sparse-arrow behavior is
   intentional (only the mutated player + displaced neighbor get a
   nonzero arrow, everyone else rebases to zero) — don't "fix" that as
   a bug if it looks odd during testing.
2. **Player** — full name, same as now (`p.name`).
3. **Tournaments** — count, rendered as a pill/plate (small rounded
   gray badge), matching the mockup's boxed "3" style — not plain text.
4. **Rating** — number + trend triangle, pill/plate style like
   Tournaments column. Reuse existing trend SVGs already in
   `players.html`, just re-skin the container to a pill.
5. **Status** — colored badge: `Newcomer` in pink (`#F74A96` text on
   light pink or pink text on white — match mockup, which shows pink
   text, no fill), `Regular` in neutral gray text, `Archive` in muted
   gray, lower opacity. Read-only here — editing happens on the
   player-edit page, not inline.
6. **Identifier** — `clubId`, shown as a muted pill (matches mockup's
   boxed "790959").
7. **Registration** — `registeredAt`, formatted `DD.MM.YYYY` (same
   format as `birth` elsewhere in the app for consistency).
8. **Edit** — icon-only button (pencil), opens `player.html?id=...`.

## Filters (top bar, above the list)
- Search input, left-aligned, placeholder "Player search" — keep
  existing name/clubId match logic.
- Status filter: pill group `All players / Regular / Newcomer /
  Archive` — client-side filter over `status`.
- Sex filter: pill group `All sex / Man / Women` — client-side filter
  over `gender`. This is new; current page has no sex filter at all.
- Pill styling: active = dark fill (`#1A1A1A` bg, white text), inactive
  = light gray (`#F7F7F7` bg, `#333333` text) — same convention as
  Sex/Playing hand toggles on the player form mockup.

## Footer
`+ Add player` button, full-width-ish pill, secondary/light style per
the mockup (not the dark primary button — matches screenshot exactly:
light gray pill with a `+`).

## Sorting
Keep existing behavior (rated players by rating desc, unrated at the
bottom) unless GM wants sortable columns — not requested, don't add
speculative scope.

## Explicitly not changing
- No pagination requested/shown — full list, scrollable container
  (reuse the internal-scroll fix pattern already used on the
  tournament.html Players tab, so the filter bar and Add-player footer
  stay fixed while rows scroll).

## Desktop only
No responsive/mobile layout — build for desktop viewport only. Do NOT
port TTCB_public's mobile `.player-card` compact view; that's a
separate mobile placeholder GM will handle later.
