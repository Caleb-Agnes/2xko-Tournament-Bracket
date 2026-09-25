# 2XKO tourney results site

Live results page for a small 8-player 2XKO tournament among friends. Participants open it on their phones during the event; it updates itself every 5 seconds.

## How the whole system fits together

```
Google Sheet "2xko tournament"  <-- source of truth
   │  tabs: "round robin stage", "bracket stage"
   │
Apps Script (bound to the sheet)  -- copies in /apps-script, NOT deployed from this repo
   ├── doGet()            -> JSON of the whole tournament (this site reads it)
   ├── doGet(?page=admin) -> admin page where the organiser taps winners (password-protected)
   └── onEdit()           -> keeps seeds/bracket in sync if the sheet is edited by hand
   │
This repo (GitHub Pages, static, no build step)
   ├── index.html  -> shell: title, two tabs, two panels
   ├── style.css
   ├── app.js      -> fetch + poll + render
   ├── mock/       -> sample JSON for offline work
   └── avatars/    -> optional player images (create the folder when needed)
```

The site is read-only. All writes go through the admin page in Apps Script. Never put the admin password or any write logic in this repo: it's public.

## Tournament format

- 8 players: Caleb, Sander, Diana, Alec, Nam, Maks, Jesper, Noah (spellings must match the sheet exactly; it's "Jesper", not "Jasper").
- Round robin: 28 matches, 7 rounds of 4. Win/loss only, no scores.
- Seeding: wins, then head-to-head, applied recursively to any still-tied group. Unbreakable ties are returned in `ties`; the organiser fixes them by hand in the sheet's seed column.
- Bracket: 8-player double elimination, 14 matches, no grand final reset.

## JSON contract (from Apps Script `doGet`)

```js
{
  updated: "ISO timestamp",
  phase: "round-robin" | "bracket" | "complete",
  champion: "Name" | null,
  standings: [{ rank, player, wins, losses, played }],   // sorted by current standing
  ties: [["A", "B"], ...],                               // only once the round robin is complete
  roundRobin: [{ key, num, round, p1, p2, winner }],     // winner is "" if unplayed
  seeds: ["seed 1 name", ... 8],                         // "" until the round robin finishes
  bracketStarted: bool,
  bracket: [{ key, name, section: "upper"|"lower"|"final", p1, p2, winner }]
}
```

Bracket keys and wiring (W = winner goes to, L = loser drops to):

| key | players |
|---|---|
| UQF1..4 | seeds 1v8, 4v5, 2v7, 3v6 |
| USF1 | W UQF1 v W UQF2 |
| USF2 | W UQF3 v W UQF4 |
| LR1A | L UQF1 v L UQF2 |
| LR1B | L UQF3 v L UQF4 |
| UF | W USF1 v W USF2 |
| LR2A | L USF1 v W LR1B |
| LR2B | L USF2 v W LR1A |
| LR3 | W LR2A v W LR2B |
| LF | L UF v W LR3 |
| GF | W UF v W LF |

The Apps Script resolves who plays in every match; the site never works out bracket progression itself, it only draws `p1`, `p2` and `winner`.

If the JSON shape changes, it has to change in `apps-script/Code.gs` (`buildState_`) and then be pasted into the Apps Script editor and redeployed (Deploy → Manage deployments → edit → New version). The live URL keeps running old code until that's done.

## app.js overview

- Config at the top: `API_URL` (the Apps Script `/exec` URL), `POLL_MS`, avatar folder and extension.
- `load()` fetches, skips re-rendering when nothing changed (ignoring `updated`), and pauses while the tab is hidden.
- Default tab follows `phase`: seeding during the round robin, bracket after. It switches automatically when the phase changes, otherwise it stays on whatever tab the user picked.
- `renderSeeding()`: three columns (next matches, completed, standings) during the round robin; once it's done, the next-matches column is removed and it becomes final seeding + match results. Standings follow `seeds` order once seeds exist, because the organiser may have adjusted ties by hand.
- Record squares in standings: one per round robin match in match order; green win, red loss, empty unplayed.
- `renderBracket()`: CSS grid, 4 columns by 2 rows. Upper bracket on row 1 (quarters, semis, upper final, grand final). Lower bracket on row 2 (rounds 1 to 3, lower final). The grand final sits above the lower final.
- `drawLines()`: an SVG overlay drawn by measuring match positions, using the `FEEDS` list. Only winner-advances lines are drawn, not drops from upper to lower. It reruns on render, tab switch and resize; the bracket panel must be visible to measure.
- `LOWER_COLS` shows LR2B above LR2A on purpose so the LR1 → LR2 lines don't cross.
- Pills: name + avatar square. The avatar image is `avatars/<lowercase name>.png`; if it's missing, the player's initial shows instead.

## Working on it

- Serve locally (fetch won't work from `file://`): `python -m http.server` then open `http://localhost:8000/?mock=round-robin`, `?mock=bracket` or `?mock=complete`.
- Mock files mirror the real JSON; regenerate or hand-edit them when the contract changes.
- Deploy: commit and push to `main`; GitHub Pages serves the repo root at https://caleb-agnes.github.io/2xko-Tournament-Bracket/

## Design

The owner's sketch sets the look: white background, system fonts, black-bordered rounded player pills with an avatar on the right, green for winners, grey for completed/losing, square win/loss record chips, folder-style tabs. Keep it plain. Don't introduce the neo-brutalist style (hard offset shadows, Bungee/Sora fonts) from the owner's other projects.

## Known gaps / ideas

- Scores: the sketch shows "2 - 1" under bracket matches, but the sheet stores winners only. To add it: add P1/P2 score columns to both sheet tabs, read and return them in `Code.gs`, add score inputs to `admin.html`, then render them here.
- The sketch's avatars have small coloured status dots; their meaning was never specified, so they're not implemented.
- On phones, the bracket scrolls sideways. A stacked, round-by-round mobile layout could be better.
- Drops from upper to lower aren't shown. Placeholder text like "Loser of QF1" in empty lower-bracket pills would help people follow along.
- No grand final reset. Supporting one needs a `GF2` row in the sheet and in `BRACKET` in `Code.gs`.
