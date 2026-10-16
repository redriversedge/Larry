# Rankings v3 addendum: reconciliation resolved, blended board, go on Part C

Written 2026-10-15 after reviewing commit 197935c and `docs/RANKINGS_V3_BACKTEST.md`. This amends `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md`; where they disagree, this file wins.

## 1. Reconciliation: your tool is the baseline

The reviewer's 0.484 / 0.448 came from a **simplified rebuild** of the board (its own two-pass z over all projected players, no Q-pool, no cap, no suspect guard), not the shipped code path. Your tool calls the shipped `computeBaseValues` and `applyPreseasonDiscount`, so **your numbers are the correct baseline**: current board 0.519 (2024-25) and 0.409 (2025-26).

- Replace the reconciliation check in `tools/backtest-preseason-board.ts` with a pin on your own current-board numbers (0.519 / 0.409, +/- 0.005), so a silent change to the shipped path is caught.
- Remove the "NOT RECONCILED" exit.

## 2. What the reviewer measured with your harness

The reviewer ran these variants through your tool's own functions (`buildTruth`, `candidatesFor`, `currentBoard`, `v3Board`, `score`, `pairedBootstrap`):

| Board | 24-25 season rho | 24-25 avg top 24 | 24-25 busts | 25-26 season rho | 25-26 avg top 24 | 25-26 busts | boot vs current (24-25 / 25-26) |
|---|---|---|---|---|---|---|---|
| Current | 0.519 | 44.4 | 8 | 0.409 | 88.5 | 13 | n/a |
| v3 (durability + replacement) | 0.541 | 50.2 | 8 | 0.403 | 81.6 | 12 | 0.98 / 0.52 |
| Replacement only, ESPN GP | 0.543 | 47.3 | 8 | 0.416 | 86.3 | 10 | 1.00 / 0.83 |
| FantasyPros ECR | 0.533 | 40.9 | 7 | 0.430 | 76.5 | 11 | |
| Yahoo ADP | 0.519 | 45.5 | 6 | 0.548 | 74.2 | 9 | |
| ESPN ADP | 0.539 | 43.3 | 6 | 0.464 | 78.5 | 10 | |
| **v3 blended with the market (3:1:1:1)** | **0.533** | **44.7** | **7** | **0.455** | **68.1** | **11** | **0.99 / 0.96** |

Per-game rho for the blend: 0.732 and 0.622 (current 0.732 and 0.550), so the format edge survives.

Blend weight sensitivity (Larry weight against 1 for each market list): L2 and L3 are both good, L1 gives up too much of the format edge (per-game rho 0.697 in 24-25), and L4+ starts losing in 25-26. **Ship L3.**

Named players (current, v3, blend, actual finish):
- 2024-25: Zion 20, 27, 32 (202nd). Kawhi 26, 28, 38 (187th). Morant 11, 20, 20 (98th). Banchero 29, 22, 27 (115th). Sengun 18, 16, 22 (7th). Cade 28, 39, 34 (8th). Bam 16, 15, 23 (9th).
- 2025-26: Embiid 13, 32, 43 (164th). Morant 21, 37, 38 (333rd). Zion 12, 27, 36 (83rd). Jaren Jackson 28, 24, 31 (112th). Amen 7, 7, 11 (7th). Dyson 23, 23, 35 (10th). Bam 26, 17, 21 (14th).

**Why the blend works:** Larry's projection-based value and the market each make different mistakes. The market knows things the projections do not (health, roles, camp news); Larry knows your format (no FG%, FT%, 3s or TO) where the market is pricing 9-cat and points leagues. Averaging the two in log-rank space keeps most of each one's edge.

## 3. What to build (Part A, revised)

**Preseason board v3 = log-rank blend of the v3 board with three market lists.**

```
For each player:
  r_larry = rank on the v3 board (durability expectedGP, k 1.25, w 0.2; value above replacement)
  r_yahoo, r_espn, r_ecr = rank on each market list; missing or beyond 250 -> 300
  blendScore = (3 * ln(r_larry) + ln(r_yahoo) + ln(r_espn) + ln(r_ecr)) / 6
Sort ascending.
```

- Constants in `src/engine/constants.ts`: `BLEND_LARRY_WEIGHT = 3`, `BLEND_MARKET_DEPTH = 250`, `BLEND_MISSING_RANK = 300`, with the table above in the comment.
- Pure module `src/engine/blend.ts`. Unit tests: a player missing from all market lists gets the missing rank, not a crash; weights sum correctly; ties are stable by v3 value.

**Market data for 2026-27.**
- **ESPN ADP:** live from the league kona fetch (`ownership.averageDraftPosition`). Already in the app.
- **Yahoo ADP and FantasyPros ECR:** extend `tools/fetch-preseason-rankings-history.ts` to also write the **current** season (FantasyPros pages with no `year` parameter) into `data/market-rankings-current.json` with a `pulledAt` stamp. Committed, public data. Re-run it right before the draft. The app loads it like `espn-adp-history.json`.
- If the file is older than 7 days or missing, blend with whatever market lists are present (renormalize the weights). If none are present, fall back to the v3 board alone. Show "Market data from Oct 17" in the board footer.

**What the user sees.**
- Board sort: the blend. Columns: Larry (blend rank), plus a small "5-cat" rank (v3 alone) and "Mkt" rank (market average) so the owner can see where Larry and the market disagree. Those disagreements are the draft's most useful information.
- Exp GP column and the durability dot from A5, unchanged.
- Settings: "Use previous rankings" (`rankingVersion = 'v2'`) still rolls everything back.

**Gates (replace A4):**
1. Season rho beats current in both seasons, bootstrap >= 90% in each. (Blend: 0.99 and 0.96.)
2. Avg actual rank of top 24 is no more than 1.0 worse in either season and better on average. (Blend: +0.3 and -20.4.)
3. Per-game rho drops by no more than 0.02 in either season.
4. Top-50 busts no worse in either season.
5. The named busts move down **on average** in each season; the named winners stay inside the top 36.
6. Report-only: rho against the 2026-10-13 consensus for the 2027 board.

The draft-day blend also feeds the Draft Room: "Best value" reads the blended board, and B1's fit bonus switches from ESPN projected GP to the durability `expectedGP`.

## 4. Part C: go

C1 is feasible and cheap (one request per season for every scoring period), so build it now:
- Snapshots at week 3, week 8, the All-Star break and the trade deadline for 2024-25 and 2025-26. Truth: rest-of-season 5-cat value.
- Candidates exactly as in C2 of the spec. No market blend in-season (there is no in-season ADP worth trusting); the in-season version is v2 vs v2 + replacement vs v2 + expected remaining games vs both.
- C3 gates unchanged. Ship only past them; if nothing beats v2, report and leave v2 in place. The owner has said he wants the best rankings, not a change for its own sake.

## 5. Order

1. Pin the baseline (section 1).
2. Build and gate the blend (section 3), wire it into the board and the Draft Room, ship.
3. Part C.

Report the gate table for section 3 and the C3 table when done. The reviewer will check the live board and run the replay.
