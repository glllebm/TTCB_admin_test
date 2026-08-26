# Design spec — Tournaments list (tournaments.html)

**Environment: implement on `TTCB_admin_test`, not prod.**

**Icons: use the assets in the `new icon` folder (also in
`TTCB_admin_test`)** for the calendar icon and players icon on each
card's meta line, plus the "+" on the Create tournament button — check
that folder before building anything inline. Ball PNGs still come from
TTCB_public's assets as noted below (separate from the icon folder).

Structural + color reference: TTCB_public's `Tournaments.html` (category
card system). Radius/pink token: admin's (24px, `#F74A96`), not
public's (public uses 10-12px radius and `#e93a8f` — don't port those).

## Category card styles (colors from public, radius/pink swapped to admin tokens)
| Category | Background | Text | Label color | Ball asset |
|---|---|---|---|---|
| League Series | `#F0F0F0` | `#1A1A1A` | `#999999` | ball-series.png |
| League Cup | `#1F1F1F` | `#FFFFFF` | `#FFFFFF` | ball-cup.png |
| League Masters | `linear-gradient(135deg, #F74A96, #C3095B)` | `#FFFFFF` | `#FFFFFF` | ball-masters.png |

Card corner radius: 24px (admin token, replacing public's card radius).
Copy the three ball PNGs from TTCB_public's assets into TTCB_admin's
static assets folder (same files, just need to exist in this repo too).

## Card structure (per category, both Active and Completed sections)
```
tourn-card [bg = category color]
  tourn-card-body
    tourn-title       ← category label ("League Series" / "Cup" / "Masters")
    tourn-card-meta
      meta-line        ← calendar icon + t.date
      meta-line        ← players icon + player count
    tourn-ball          ← decorative ball PNG, category-specific
action-card (sibling, not nested)
  spots-line            ← "Available spots: N"  (Active only, = t.freeSlots)
  [CTA button]           ← "Manage tournament" (Active) / "View tournament" (Completed)
```

This matches the current admin mockup screenshots almost exactly — the
admin screenshots already show this exact layout (card + separate
action panel to the right with the CTA button), so this is largely
"wire the existing category/freeSlots data into the existing card
markup," not an invention.

## Active Tournaments section
- Card shows category color, date, player capacity (`t.players`).
- Action panel: `Manage tournament →` button (dark primary) +
  `Available spots: N` line below it, reading `t.freeSlots` — data
  already on the API response (server.js:458), currently unused by
  this page. Pure rendering addition, no backend change.

## Completed Tournaments section
- Grid, 2 cards per row (per mockup).
- Card shows category color, date, player count — for completed
  tournaments the mockup shows the actual enrolled count (e.g. "32",
  "12-16") rather than a range; confirm against `t.filledPlayers` vs
  `t.players` (capacity) — discovery notes public reads
  `t.filledPlayers` for completed cards, use the same field here rather
  than capacity, so the number reflects who actually played.
- Action panel: `View tournament →` button, links to
  `tournament.html?view=results` (existing behavior, just restyled).
- Delete affordance (`.tcard-del`, exists today) — keep, restyle to
  match the new card, don't relocate or change its trigger behavior.

## Footer
`+ Create tournament` button — light secondary pill, matches the Add
Player button style on the Players list for consistency across the app.

## Explicitly not changing
- Active/Completed split logic stays server-driven (`status`), no
  reshuffling of which tournaments land in which section.
- No pagination — same scrollable-list treatment as the Players list.

## Desktop only
No responsive/mobile layout — build for desktop viewport only. Do NOT
port TTCB_public's mobile card stacking behavior; a mobile placeholder
will be handled separately later by GM.
