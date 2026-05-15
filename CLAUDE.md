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
  selector, pause, new game), and three overlays: win, pause, loading. Modules
  defer until DOM-ready, so top-level JS can safely query elements.
- `index.js` — game UI: input handling, drawing, win detection, timer, board
  resize, pause. Imports `generateUniqueBoard` from `generation.js`.
- `generation.js` — the board generator. Exports a single function
  `generateUniqueBoard(N)` that returns `{ grid, stats }`.
- `test_generation.mjs` — Node benchmark harness for `generation.js`. ESM
  (`.mjs`) because there's no `package.json` declaring `"type": "module"`.

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

## Generator (generation.js)

`generateUniqueBoard(N)` runs until it finds a uniquely-solvable board.
There is no time budget — for large N this can take a while; the caller is
expected to show a loading indicator. Returns `{ grid, stats }`. `grid` is
a 2D array of color strings (random hex per region). `stats` reports
`{ attempts, reshapes, elapsedMs }`.

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
3. If no cell admits a viable move, return `false` (the search loop then
   breaks out of reshape and moves to the next random attempt).

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

### Knobs that exist

- `PER_ATTEMPT_RESHAPES = 30` — reshapes before abandoning a random board.

`MIN_SIZE` / `MAX_SIZE` (4 / 15) are in `index.js` and bound the dropdown.
Generation works in principle up to N=30 (bitmask fits in int32), but the
solver becomes unreasonably slow well before that.

## Performance baseline

From `test_generation.mjs` on a 2024 laptop, 30 trials each:

| N  | success | mean time |
|----|---------|-----------|
| 8  | 30/30   | ~3 ms     |
| 10 | 30/30   | ~150 ms   |
| 11 | 28/30   | ~700 ms   |
| 12 | 12/30   | ~2.1 s    |
| 14 | 0/20    | full 3 s  |

The drop-off above N=11 is the main remaining issue. Promising directions
(none tried yet):
- Smarter restart when stuck (perturb the current best instead of fully
  rerolling).
- Parallel attempts via a Web Worker pool.
- Move to a constraint-propagation generator (see WFC discussion in chat
  history — unlikely to help with uniqueness specifically but might give
  different region shapes).

## Test harness

```
node test_generation.mjs              # full sweep over [8, 10, 11, 12, 14, 16, 18]
node test_generation.mjs 11           # one size, default 20 trials
node test_generation.mjs 11 50        # one size, 50 trials
node test_generation.mjs --verify     # also re-solve each returned board and
                                      # check it has exactly one solution
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
