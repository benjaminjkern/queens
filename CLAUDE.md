# Queens

Browser game — a clone of the LinkedIn "Queens" daily puzzle. The board is an
N×N grid divided into N colored regions; the player places exactly N queens
such that there is one queen per row, one per column, one per region, and no
two queens are in 8-adjacent cells (king-adjacent).

The interesting part of this codebase is the **board generator**: it must
produce boards that have **exactly one valid solution**. That's what most of
`generation.js` does.

## Files

- `index.html` — markup + CSS. Holds the canvas, the control bar (timer, size
  selector, pause, new game, recent), four overlays (win, pause, loading,
  recent-boards). Modules defer until DOM-ready, so top-level JS can safely
  query elements.
- `index.js` — game UI: input handling, drawing, win detection, timer, board
  resize, pause, share/replay/recent. Reads `#b=` from `location.hash` on
  load to display shared boards.
- `generation.js` — the board generator. Exports `generateUniqueBoard(N, opts)`
  returning `{ grid, stats }`. `opts.seed` (uint32) is for deterministic
  tests; production callers pass nothing and get a random board.
- `seed.js` — `mulberry32` PRNG (used internally by the generator),
  `randomSeed` (crypto-backed uint32), and `readBoardHash`/`writeBoardHash`
  for the `#b=` URL param.
- `boardCodec.js` — encode/decode region grid ↔ URL-safe base64 (4 bits per
  cell), `boardKey` (FNV-1a 64 over canonical region IDs), and
  `regionIdsToColorGrid` which derives N colors deterministically from the
  board's own boardKey so freshly-generated and loaded-from-URL boards
  render identically.
- `scoreStore.js` — async API for personal completion-time persistence,
  backed by localStorage. Designed to be swappable for a remote backend
  later via `setBackend`.
- `test_generation.mjs` — Node benchmark harness for `generation.js`. ESM
  (`.mjs`) because there's no `package.json` declaring `"type": "module"`.
  Runs a determinism regression (same seed + N → identical region grids)
  before the perf sweep.

## Game logic (index.js)

State:
- `GRID_SIZE` is **mutable** (`let`). Changing it through the size dropdown
  reassigns `grid` and `marks` and resizes the canvas. Anything that reads
  these names dynamically sees the new values — don't capture them in
  closures at module load.
- `grid[y][x]` — color string of the cell's region.
- `marks[y][x]` — one of `null`, `"queen"`, `"x"` (manual), or `"ax"` (auto-x
  placed by a queen, cleaned up on queen removal). `ax` and `x` render
  identically as ✗ but `removeQueen` only clears `ax` cells whose blocker
  queen was just removed.

A queen at (qx, qy) blocks: same row, same column, the 8 neighbors, and every
cell in the same region (`blockedCells` in index.js).

### Input

- **Left mousedown** on a cell: toggle queen (placing fills auto-x's, removing
  cleans them up while preserving x's still blocked by another queen).
- **Right mousedown + drag**: paint x's. If the start cell is already x/ax,
  the drag clears instead. Mouseup or mouseleave ends the drag.
- **Ctrl/Cmd + left mousedown + drag**: same as right-click drag
  (trackpad-friendly).
- **Tap** on a coarse-pointer (touch) device: cycle empty → x → queen →
  empty. Detected once at load via
  `window.matchMedia("(pointer: coarse)")` and stored in `isMobile`.
- **Touch drag** on mobile: paint x's across cells (or clear if the drag
  started on an x). The handler stays in "pending" mode until the finger
  moves to a different cell — only then does it commit to a drag. Single-tap
  cycle fires on touchend if no movement happened.

On mobile we attach `touchstart/touchmove/touchend` listeners directly
(`passive: false`, `preventDefault` everywhere) so the browser doesn't scroll,
zoom, or generate the synthetic 300ms-delayed click. Mouse listeners are
attached only on desktop. `touch-action: none` on the canvas + a
non-user-scalable viewport meta tag back this up.

All input actions also call `startTimer()` — the game timer starts on the
first interaction of a new game, not on board generation.

### Timer

Has four states managed by `timerStart`, `pausedElapsed`, and `timerInterval`:
- Stopped: both null.
- Running: `timerStart` is `performance.now() - elapsedSoFar`.
- Paused: `pausedElapsed` is the elapsed ms; `timerStart` is null.
- The render function reads whichever is non-null. Resume sets
  `timerStart = now - pausedElapsed`.

`stopTimer()` only kills the interval (called on win — keeps the final time on
screen). `resetTimer()` zeros everything (called on `reset()`).

### Async generation

`reset()` is `async`. It shows the loading overlay, awaits **two**
`requestAnimationFrame`s, then runs the synchronous generator. The double-rAF
is load-bearing: without it the browser batches the overlay-display toggle
with the synchronous CPU work and the spinner never paints. Don't reduce it
to one — single rAF is unreliable across browsers.

Generation can block the main thread for seconds at N≥12. Live with it
unless you want to move generation to a Web Worker (would require restructuring
the typed-array sharing in `generation.js`).

## Sharing & persistence

### Share URL format

Shareable boards live in the URL hash as `#b=<urlsafe-base64>`. The payload
is byte 0 = N, then 4 bits per cell of *canonical* region IDs (renumbered
in row-major first-encounter order so identical shapes always encode to the
same bytes). Worst case at N=15 is ~152 base64 chars. There is **no** seed
URL form, deliberately:

- A seed URL would force the recipient to re-run the generator (seconds at
  N≥12) instead of loading instantly.
- A seed URL would also be brittle to any future generator change — same
  seed could produce a different board. The `#b=` form is immortal.

The PRNG infrastructure in `seed.js` is still useful for the determinism
test in `test_generation.mjs`, but seeds are not user-visible.

### Color determinism

Colors are derived from the board's own `boardKey` (mulberry32 seeded by
the first 8 hex chars of the FNV-1a hash of canonical region IDs). This
means freshly-generated and loaded-from-URL boards always render with
identical colors — `generation.js` calls `regionIdsToColorGrid` for its
final step, and `boardCodec.decodeBoard` callers do the same.

Color assignment is shape-aware (`colorsForRegions` in boardCodec.js):
palette entries are evenly-spaced hues with lightness clamped to a bright
band (worst-case contrast vs the black ✗/👑 glyphs is ~6:1), and touching
regions (8-adjacency) are kept visually distinct via a greedy
most-constrained-first assignment plus a swap hill-climb maximizing the
worst adjacent-pair distance (weighted-RGB metric). All driven by the
boardKey-seeded rng, so determinism is preserved. Colors are never
persisted — the store and `#b=` URLs hold shapes only, so changing this
function never corrupts saved data; it only re-skins old boards.

Implication: if you change the color-derivation function, every previously
shared board changes color. The region shapes are still correct, but
visual identity isn't preserved across that change.

### Completion-time storage

`scoreStore.js` persists times under localStorage key `queens.scores.v1`.
Schema:

```json
{
  "v": 1,
  "boards": {
    "<boardKey>": {
      "size": 10,
      "encoded": "<urlsafe-base64>",
      "times": [{ "ts": 1731600000000, "ms": 45230 }]
    }
  },
  "history": ["<boardKey>", "..."]
}
```

The `encoded` field stores the same string used in `#b=` URLs, so the
Recent menu can replay any past board. `history` is MRU-capped at 50.

The store exposes four async methods: `recordCompletion`,
`getTimesForBoard`, `getRecentBoards`, `addToHistory`. They route through
a swappable `backend` (currently a thin localStorage adapter). To swap in
a remote backend later, write a `{ read, write }` adapter and call
`setBackend(adapter)` — no UI changes required.

There's no server-side store today. We discussed the options (Cloudflare
Worker writing to a GitHub JSON file, free-tier Supabase/Firebase, GitHub
OAuth + Issues) and concluded all of them have equivalent abuse surface
once the endpoint is public, mitigated by server-side rate limiting and
validation. None has been implemented; `scoreStore` is structured so it
can be when the time comes.

## Generator (generation.js)

`generateUniqueBoard(N, opts = {})` runs until it finds a uniquely-solvable
board. There is no time budget — for large N this can take a while; the
caller is expected to show a loading indicator. Returns `{ grid, stats }`.
`grid` is a 2D array of color strings (one per region, deterministic from
the board's boardKey — see "Color determinism" above). `stats` reports
`{ attempts, reshapes, elapsedMs, seed }`.

`opts.seed` (uint32) seeds the internal mulberry32 PRNG, making the entire
generation deterministic. Used by the test harness; the UI passes no opts
and gets a fresh random seed each call.

### High-level algorithm

For each random attempt (looping until success):
1. **Place queens** row-by-row with backtracking, one queen per row in a
   random column order, rejecting placements that conflict with the previous
   row's queen (column-equal or diagonally adjacent). Same-column / same-row
   is checked via a used-columns set; full diagonal-adjacency only needs the
   previous row because non-adjacent rows can never be king-adjacent.
2. **Flood-fill** the regions: seed each queen's cell and its 4-neighbors into
   a frontier, then random-pop cells one at a time and paint each with its
   parent's region. Stored as integer region IDs in a flat `Int8Array` for
   speed; only converted to color strings at the very end.
3. **Solution count** with bitmask backtracking (`fastCount`). Region IDs map
   to bits; used columns and used regions are int bitmasks. Stops at 2 — we
   only care whether the count is 0, 1, or "more than one".
4. If count is 1 → success. Return.
5. Otherwise run **guided reshape** up to `PER_ATTEMPT_RESHAPES` (30) times.
   Each reshape mutates the regions to break alternate solutions.
6. If still ambiguous, start another random attempt.

### Reshape

The cornerstone of the generator at large N. `reshapeOnce`:
1. `collectAltScores(maxAlts=8)` enumerates up to 8 alternate solutions. For
   each cell that an alt places a queen on (where the intended solution
   doesn't), increment `cellScores[cell]`. A high score ⇒ recoloring that
   cell breaks many alts at once.
2. Sort cells by score descending. For each in order:
   - Compute its 4-neighbor region IDs (deduped).
   - Sort those neighbors by region size ascending (donate to the smallest
     region — keeps sizes balanced; tiny regions invite future ambiguity).
   - For each candidate region: tentatively recolor, check that both the
     donor and recipient regions remain 4-connected (`regionConnected`).
   - First viable move is taken; we return `true`.
3. If single-cell donation is exhausted, fall back to **pair-swap**: for
   each high-score cell A and each adjacent cell B in a different region,
   swap their region IDs. The donor region keeps the same size (B replaces
   A), so connectivity is preserved more often than under a one-way
   donation. Skip pairs where either side is an intended queen cell.
4. If no single-cell move and no pair-swap is viable, return `false` (the
   search loop then breaks out of reshape and moves to the next random
   attempt).

**Why reshape works (correctness):** the intended solution's queens are at
`(queenCols[r], r)` for each row `r`. `reshapeOnce` never touches those
cells — it only modifies cells that an alt solution would use. Recoloring such
a cell invalidates that alt (its region appears twice or its queen sits in a
region whose actual queen is elsewhere) while leaving the intended solution
intact. So each reshape monotonically preserves ≥ 1 solution and breaks ≥ 1
alt — uniqueness can only get closer, never further.

### Why the typed-array, bitmask, random-pop machinery

These are not premature optimization — they matter at N=12 and above:
- **`Int8Array` for `regionGrid`** + integer region IDs. The previous version
  stored color strings per cell; comparing strings and allocating them in the
  inner loop dominated runtime.
- **Random-pop flood-fill** instead of `queue.splice(random, 0, …)`. Splicing
  in the middle of a JS array is O(n); the previous version was O(n²)
  overall. Random-pop (swap-with-last, pop) is O(1).
- **Bitmask used-sets** in `fastCount`. `Set.has/add/delete` per recursion
  step was the hot spot at N=12.
- **Bit-iteration over candidate columns** in `fastCount` and
  `collectAltScores`. Build the legal-column mask (`~usedC & ~adjMask`)
  and iterate set bits via `cands & -cands` + `Math.clz32`. ~2× speedup
  vs the per-column branch.

After all that, on a 2024 laptop we get ~50,000 attempts/sec at N=10 and
roughly an order of magnitude fewer per N added.

### What was tried and rejected

If you're tempted to add these, read this first. Whole-algorithm rewrites
that were attempted and abandoned are documented separately in
[EXPERIMENTS.md](EXPERIMENTS.md) — read that before proposing another
"replace the generator with X" approach.

**Distance-weighted flood-fill** (commit history under "smarter seeding"). At
each pop, with probability `p` pick the frontier cell closest to its region's
queen; else uniform random. Intuition: tighter regions around queens should
constrain the puzzle more. Result: **made things much worse.** Compact,
symmetric regions admit many column-swap alternates because the regions are
essentially predictable from queen position. At N=11 it dropped success rate
from 19/20 to 2/20. Reverted to pure uniform random. **Do not re-add without
benchmarking** — the intuition is wrong.

**K-lookahead reshape** (try the top K candidate cells, apply each, recount
alts, pick the one that leaves the fewest). Result: **hurt at N≥11.** Both
the initial alt count and the lookahead recount are capped at the same limit
(8 by default), so on hard boards every move looks like "8 alts" and the
lookahead can't differentiate. Meanwhile each reshape pays 3-4× the cost of
plain greedy, so we get fewer total reshapes per second. Reverted to first-
viable greedy. Raising the lookahead cap to differentiate would help in
theory but `fastCount` is exponential without the cap, so it gets prohibitive
on big boards. **If you want to bring this back**, gate it on `N ≤ some
threshold` where alts rarely saturate.

**Mid-fill solution-count abort** ("if the cells filled so far admit ≥ 2
solutions, no completion can be unique, so bail early"). Theorem is correct
*if* reshape is off — once mid-fill cells are committed they never change,
so solutions using only those cells persist. But reshape **does** mutate
committed cells, so a board that looks doomed pre-reshape can be fixed
post-reshape. The early abort cut off boards reshape would have rescued and
hurt success rate. Removed.

**More reshapes per attempt** (e.g. 100 instead of 30). At N=12 it dropped
success from 12/30 to 3/30. Diversity from many different random starting
configurations beats depth on any one configuration.

**Warm restart with partial preservation** (v4a — keep queens, re-flood-fill
regions up to 5 times before rerolling queens). No measurable improvement at
N=12. Same depth-vs-diversity finding as above, now confirmed at the queen-
layout level too.

**Adaptive alt cap (32 instead of 8 at N≥13)** (v4b). Larger cap costs more
per call without changing the greedy first-viable move ordering enough to
matter. No measurable improvement.

**Reject queen layouts with too many trivial swap pairs** (v4d). At
threshold N, ~100% rejection rate — almost every random non-attacking layout
admits hundreds of swap-feasible pairs. Approach is unsalvageable as a
prefilter.

### Knobs that exist

- `PER_ATTEMPT_RESHAPES = 30` — reshapes before abandoning a random board.

`MIN_SIZE` / `MAX_SIZE` (4 / 15) are in `index.js` and bound the dropdown.
Generation works in principle up to N=30 (bitmask fits in int32), but the
solver becomes unreasonably slow well before that.

## Performance baseline

After the v4c pair-recolor + bitmask merges (60s per-trial budget):

| N  | success | mean time   |
|----|---------|-------------|
| 10 | 5/5     | ~25 ms      |
| 12 | 5/5     | ~1.2 s      |
| 14 | 0/5     | (timeouts)  |
| 15 | 0/5     | (timeouts)  |

The N≥14 cliff is the remaining issue. Variants tried in the v4 round
(warm restart, adaptive cap, swap-pair queen rejection, worker pool) and
their results are documented in [EXPERIMENTS.md](EXPERIMENTS.md). The
worker pool variant lives in `generation.worker-pool.js` + `worker_runner.mjs`
and gives a ~7× throughput multiplier in Node, but on its own does not move
the N=15 wall — only ~2/5 success at N=14.

## Test harness

```
node test_generation.mjs              # full sweep over [8, 10, 11, 12, 14, 16, 18]
node test_generation.mjs 11           # one size, default 20 trials
node test_generation.mjs 11 50        # one size, 50 trials
node test_generation.mjs --verify     # also re-solve each returned board and
                                      # check it has exactly one solution
node test_generation.mjs 15 5 --budget=60000              # per-trial budget
node test_generation.mjs 14 5 --budget=60000 \
    --gen=./generation.worker-pool.js                     # variant generator
```

Reports per size: success rate, attempts/reshapes/time mean/median/p95/max,
and final/best alt counts (capped at 16). `--verify` re-runs the solver on
each returned grid independently — useful when changing `fastCount` or the
solution definition to catch regressions in the generator's own claim of
uniqueness.

## Running locally

```
python3 -m http.server 8000     # any static server works; module imports
                                # need real HTTP, not file://
open http://localhost:8000/
```

No build step. Browsers with ES modules (everything since ~2018) work.
