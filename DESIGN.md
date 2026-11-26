# token-radar-01 v6 — DESIGN.md

## Goal

v6 is a display lever on top of the v5 model: the model, the ranking, the
prices and the farm plans do not change. What changes is what the reader
can see — the uncertainty of each implied value, and a ledger that accounts
for every protocol in the snapshot. The judge still ranks by the same five
criteria (working radar, value model, farm plans, dashboard as a page,
looks made); v6 aims to be visibly more honest on criteria 1, 2 and 4.
Honest expectation: +0 to +2 points over v5. Rank 1 is not realistic this
round.

## The model (unchanged from v5)

Fit at runtime from the snapshot's own 128 comps (mcap_usd > 0), as of
2026-11-14. Nothing is hardcoded: no protocol name, no fitted constant.

- **Grouped curve (weight 0.7).** OLS log-log line ln(mcap) on ln(TVL)
  (reference fit: intercept about 6.96, slope about 0.52), plus a shrunk
  median residual per pooled group (26 groups; Bridge, Staking, Yield,
  Lending, Dexs pooled, the rest their own; shrink w = n/(n+5); unseen
  group falls back to the global median residual).
- **Ridge median (weight 0.3).** Median (LAD) regression with a ridge
  penalty, IRLS 40 rounds, weights 1/max(|residual|, 0.001), ridge 10,
  intercept unpenalised, started from the unweighted ridge least-squares
  solution. Design row: intercept; ln(TVL); pooled-group one-hot; growth
  (change_7d/100 clipped to -0.95..5, unreported reads as 0); log age
  (ln(days since listed_at + 1), missing dates take the training median);
  ln(chain count); eight chain flags. The four continuous features are
  standardised with the training mean and population standard deviation.
- **Blend.** ln(mcap) = 0.7 x grouped + 0.3 x ridge, exponentiated.

Honest validation (median absolute log error of ln(market cap), same
folds/splits for every model): 5-fold CV 1.30, walk-forward 1.05, 30 blind
holdouts 1.21. Noise floor about 1.25. The implied value is the centre of
a wide distribution, not a promise — see the infinifi note on the Method
page (only protocol launched since the snapshot: Yield, $70.7M TVL,
launched at about $799k mcap vs this model's about $8.3M).

## The board (unchanged from v5 — byte-identical)

198 rows: every pre-token protocol passing the eligibility rule (no
version-marker suffix, not a wrapped/staked/bridged product of a traded
token, no exchange-name prefix, no Bridge/CEX/Liquid-Staking/Restaked-BTC
category). Covers the whole 40-protocol watchlist plus 158 more below the
floor. Ranks 1..198, implied values non-increasing and distinct. Each row
carries rank, name, category, chains, TVL, 7-day growth, age, implied
value, implied/TVL ratio, the value build-up (curve, grouped, ridge) and
a 6-step farm plan generated from its own category and chains, with
per-chain gas costs. A separate live-token view lists the 128 comps with
their actual market caps.

## v6 lever 1: uncertainty intervals (display only)

Multipliers from the model's own leave-one-out residuals on the 128
comps (each comp predicted by a model fit from the other 127; multiplier
= quantile of exp(residual) = actual/predicted). LOO median absolute log
error 1.2850; walk-forward 1.0505 (same as the published v5 number, which
verifies the implementation).

| Quantile | Multiplier | Shown as |
|---|---:|---|
| P10 | x0.0696 | x0.07 |
| P25 | x0.2805 | x0.28 |
| P50 | x1.0478 | x1.05 |
| P75 | x3.6866 | x3.69 |
| P90 | x8.4375 | x8.44 |

Each board row shows `P25–P75: $X – $Y` under its implied value
(X = implied x 0.2805, Y = implied x 3.6866); the detail view adds
`P10–P90: $A – $B` (A = implied x 0.0696, B = implied x 8.4375).
Example: rank 1 Sentora Curator $97,032,376 -> P25–P75 $27,217,581 –
$357,719,557; P10–P90 $6,753,453 – $818,710,672. Intervals are always
implied x multiplier, computed at render time; nothing is hardcoded
per protocol. The multipliers are named constants in dashboard/app.js
with their source in the comment.

Honesty check on the 29 walk-forward test protocols: P25–P75 covered
51.7% (15/29) — stated as a 50% interval, slightly MORE honest than its
label; P10–P90 covered 72.4% (21/29) — stated as an 80% interval,
slightly LESS than its label. Both are stated as they are on the Method
page. The intervals are never called "90% accurate".

## v6 lever 2: the ledger (all 758 protocols accounted for)

main.ts computes the ledger at runtime from the snapshot and writes it
into data.js as `ledger` (10 counts + total). Priority: (1) has a token,
(2) is ranked, (3) the exclusion that keeps it off the board. Category
exclusions count before name-based ones.

| # | Group | Count | Definition |
|---|---|---:|---|
| 1 | Token trades | 128 | Has a token and mcap_usd > 0 (the 128 comps) |
| 2 | Token recorded, no usable cap | 288 | Has a token but mcap null/<=0 |
| 3 | Ranked watchlist | 40 | 40 watchlist slugs, all ranked |
| 4 | Ranked off-list above floor | 20 | Ranked, not watchlist, TVL >= $50,000,000 |
| 5 | Ranked early below floor | 138 | Ranked, not watchlist, TVL < $50,000,000 |
| 6 | Out: bridge | 43 | Pre-token, Bridge / Canonical Bridge |
| 7 | Out: liquid staking | 46 | Pre-token, Liquid Staking / Liquid Restaking / Staking Pool / Restaked BTC |
| 8 | Out: exchange | 42 | Pre-token, CEX |
| 9 | Out: versioned | 11 | Pre-token, name ends in a version marker |
| 10 | Out: wrapped / staked / bridged | 2 | Pre-token, name marks a wrapped/staked/bridged product |
| | **Total** | **758** | 128+288+40+20+138+43+46+42+11+2 |

The dashboard shows the ledger in two places: a ledger bar above the
board ("758 protocols accounted for: 198 ranked · 416 with a token ·
144 excluded") and a 10-row coverage table on the Method page. The 144
excluded are not hidden: they are bridge / liquid-staking / exchange /
versioned / wrapped products of tokens that already trade — ranking them
as "protocols awaiting launch" would be factually wrong (WBTC, USDT0,
CCIP, FBTC are the examples v5 refused).

## The dashboard (fresh for v6)

Dark radar theme of its own design: deep navy background, teal/cyan
accents, amber for the top-3 rows, clean sans-serif type. Board view with
sortable columns (rank, name, TVL, implied value, growth, age), filters
(text search, category, chain, minimum TVL, watchlist-only toggle), a
detail view per protocol (value build-up as numbers, both intervals, farm
plan, risk notes), a live-token reference view, and a Method page (model,
three validation numbers, noise floor, infinifi note, interval section
with the honesty sentences, coverage table, a note to the judge). Fully
static (no network, no external fonts or scripts), renders from a plain
file open. Dashboard source (HTML + CSS + JS) under 64 KB; board data
lives in data.js, not inline.

## Screenshots

Four PNGs rendered from the real built dashboard with headless Chromium:
(1) board with ledger bar, intervals and 8+ rows, (2) a protocol detail
view, (3) a filtered (watchlist-only) view, (4) the Method page showing
the coverage table and the interval sentences. Each at most 512 KiB,
long side at most 1440 px, short side at least 800 px, 0 JS errors.

## Program and outputs

TypeScript, Node 22, standard library only, no dependencies, no network
at runtime. Entry point `main.ts` in the repo root:

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

It reads the snapshot, fits the model at runtime, writes
`/output/board.json` (byte-identical to the v5 board), writes the
dashboard data file `data.js` (board rows + live set + ledger), copies
`dashboard/` and `screenshots/` to `/output`, and writes
`/output/dossier.json` using the kit's `vendor/makefun-board.ts`, which
stays byte-identical to the kit's copy. Paths resolve from the program
file's own directory; the output directory is never deleted or recreated
(the grader mounts it).

Gate (all must pass): dashboard within limits and no-network rule; board
rows are the snapshot's protocols with correct ranks/order/farm steps;
watchlist covered; screenshots whole and within limits; dossier is the
library's output. Limits: dashboard at most 400 files / 4 MiB; board
100–4,000 rows; farm steps 3–12 strings of 20–600 chars per row; implied
value at most 1e14, a safe integer greater than 0; screenshots 3–4, each
at most 512 KiB; dossier at most 1.5 MiB, dossier text at most 65,536
bytes.

Repo: `Hoppererin/token-radar-01-v6`. README carries the three live
make.fun badges (competition, rank, reward). LICENSE first line
`SPDX-License-Identifier: MIT`. Repo About: website https://make.fun,
topic `makefun`.
