# Design spec — Player add/edit (new-player.html, player.html)

Both forms share the same field set and should share the same restyled
markup/CSS (currently two separate files — keep them separate per the
existing route structure, but the visual language must be identical,
add-form and edit-form are the same design with different footer
buttons).

## Tokens (from tournament.html)
- Font: PT Root UI, page bg `#F7F7F7`, card bg `#FFFFFF`, card radius
  24px, input/pill radius 16px.
- Primary button: `#1A1A1A` bg / white text, hover `#333333`, active
  `#000000`.
- Secondary button: `#F7F7F7` bg / `#333333` text.
- Cancel button: pink border (`#F74A96`) per existing tournament.html
  convention.
- Delete button (edit form only): `#F26B3A` (danger/orange), matches
  existing delete-confirm color on tournament.html.

## Layout (two-column, per the mockup — keep as-is)
**Left column**: Sex toggle, Playing hand toggle, Name, Last name,
Birthday.
**Right column**: Status toggle (NEW), Rating input, Racket group
(Blade / Right rubber / Left rubber).

## Field-by-field
- **Sex**: pill toggle, Man / Women — already exists, restyle only.
- **Playing hand**: pill toggle, Right / Left — maps to `hand` field
  (`"left"`/`"right"`), already exists, restyle only.
- **Name / Last name / Birthday**: text inputs, `#F7F7F7` bg, 16px
  radius, gray placeholder text — restyle only, no field changes.
- **Status** (NEW field): pill toggle, `Regular / Newcomer / Archive` —
  same visual pattern as Sex/Playing hand. Requires Phase 1 (backend)
  to ship first; this is the only genuinely new input on the form.
  Default for a brand-new player: `Regular` unless GM wants new players
  to default to `Newcomer` (more likely correct, given Newcomer = newbie
  logic — confirm before implementation, don't assume).
- **Rating**: numeric input, placeholder `ex 100` — exists, restyle only.
- **Racket** group (Blade / Right rubber / Left rubber): three stacked
  text inputs under one "Racket" label with a small dot/icon prefix,
  matching the mockup exactly — maps to existing `blade`, `forehand`
  (→ "Right rubber"), `backhand` (→ "Left rubber") fields. Pure label
  restyle, the internal field names (`forehand`/`backhand`) don't need
  to change, just the on-screen labels.

## Not on this form (confirmed from mockup + discovery)
- **Identifier** (`clubId`) — auto-assigned server-side, read-only,
  never shown on the form (matches current behavior — don't add an
  input for it).
- **Registration date** — auto-set on creation, read-only, never shown
  on the form.

## Footer buttons
- **Add form** (`new-player.html`): `Add` (primary, dark) + `Cancel`
  (pink-border secondary).
- **Edit form** (`player.html`): `Save` (primary, dark) + `Cancel`
  (pink-border secondary) + `Delete` (orange, right-aligned/separated
  from the other two — matches the mockup's 3-button row with Delete
  visually distinct).

## Explicitly not changing
- No new validation rules requested — keep current required/optional
  field behavior, this is a visual pass plus the one new Status field.

## Desktop only
No responsive/mobile layout for this pass — desktop viewport only. GM
will send a mobile placeholder separately later.
