# Experiments

Generator variants that were attempted and abandoned. Recorded here so the
same dead-ends don't get re-explored.

## v2 — full CSP over (region, hasQueen)

**Idea.** Each cell holds a domain over `(region, hasQueen)` pairs, encoded
as a bitmask of `2N` bits. CSP backtracking search: pick a random
uncommitted cell, pick a random value from its domain, commit, propagate.
Propagation: when committing `(r, queen=true)`, strip queen-bits from same
row/col/8-neighbors and strip `(r, 1)` from every other cell (one queen per
region). When committing `(r, queen=false)`, enforce 4-connectivity: the
cell needs at least one neighbor that is or could-still-be region `r`. At
the leaf (all cells committed), check uniqueness via `fastCount(2) === 1`.

**Result.** Falls off a cliff between N=5 and N=6. N=5 takes ~6ms, N=7
hangs indefinitely on some trials. Even after adding MRV variable
ordering, an early uniqueness check fired the moment all N queens are
placed (uniqueness is monotone in committed cells, so a partial count ≥2
is a hard fail), and conflict-directed backjumping (when the leaf is
non-unique, find the alt solution's diverging queen cells, jump back to
the deepest decision among them) — still couldn't compete.

**Why it failed.** v1 splits the problem into two cheap phases:
(a) place queens row-by-row with backtracking (small tree, almost always
succeeds on the first random shuffle), (b) random flood-fill regions
(O(NN), no backtracking, never fails). The cost is filtering for
uniqueness across many such cheap attempts. v2 collapses both phases into
a single CSP whose joint search space is the cross product
`(2N)^NN` — finding *any* fully-committed assignment with N queens placed
is itself hard, and uniqueness filtering happens on top of that. The
branching factor is much higher and most pruning info only becomes
available at the "all queens placed" milestone, by which point the tree
is already deep.

## v3 — hybrid: v1's queen placement + CSP over regions only

**Idea.** Keep v1's `fastPlaceQueens` (cheap). Then CSP over region
assignment alone: per-cell variable = region id, domain = bitmask over
N regions, queen cells pre-locked to their own region. Domain width is
`N` bits instead of `2N`. Same MRV + conflict-directed backjumping. Two
versions of the connectivity invariant were tried:

1. **Local.** After each commit, every committed cell `c` with region `r`
   must have a 4-neighbor that's committed-to-r or has `r` in its domain.
2. **Global (fixpoint).** After each commit, BFS from every region's queen
   through committed-to-r and possibly-r cells. Any cell whose domain
   advertises `r` but isn't reached loses `r`. Iterate to fixpoint, since
   pruning `r` from one cell can cut paths for another region.

**Result.** v3 with local check hung at N=7+. v3 with global fixpoint
propagation hung at N=8. Better than v2 but still nowhere near v1.

**Why it failed.** Even with the queen positions fixed and strong
connectivity propagation, the region assignment search has a much higher
branching factor than v1's random flood-fill (which is essentially a
single forward pass with no decisions to backtrack). The fixpoint
propagation is expensive (`O(N · NN)` per commit, iterated), and even
after pruning many branches, the search still has to discover that most
locally-feasible region assignments produce non-unique boards — same
fundamental problem as v2. The "all cells committed → check uniqueness"
leaf is hit rarely, and when it fails the conflict-jump only undoes one
or a few decisions before re-encountering the same global structure.

## v4 series — N=15 sub-60s push

Round of experiments aimed at consistently generating a unique N=15 board in
under 60s of wall-clock. Per-trial budget enforced via the new
`generateUniqueBoard(N, { budgetMs })` and harness flag `--budget=ms`. Each
variant lives in its own `generation.<slug>.js` and is selected via
`--gen=<path>`.

### Re-baseline at 60s budget (this is the bar)

| N  | success | mean time (success only) |
|----|---------|--------------------------|
| 12 | 19/20   | 6.7s                     |
| 14 | 0/5     | (all timeout @ 60s)      |
| 15 | not run for baseline; 0/3 in combined under 60s |

The previous baseline table understated how dire N=14 is. With a generous
60s budget per trial the unmodified generator still failed all 5 N=14 trials.
N=15 was not benchmarked further on the unmodified generator — it can only
be worse.

### v4a — warm restart with partial preservation

**Idea.** After a full attempt fails (queens placed, regions filled, reshape
exhausted), keep the queen layout and re-flood-fill regions up to 5 more
times before rerolling queens. Cheap "perturbation" of the failed attempt —
documented in CLAUDE.md as untried.

**Result.** No measurable improvement at N=12 (mean 6.5s vs baseline 6.7s, in
overlapping noise).

**Why it failed.** Region shape rerolls don't add as much diversity as a
fresh queen layout. The reshape mechanism already explores many region
shapes per queen layout via its mutations; restarting just the fill gives
us back uniform-random regions, which is what reshape was already drifting
away from. Per the existing CLAUDE.md note "diversity beats depth", we now
have a second confirmation: depth at the **queen-layout** level doesn't help
either, not just depth at the region-shape level.

### v4b — adaptive alt cap (32 instead of 8 for N ≥ 13)

**Idea.** CLAUDE.md flags that at N≥12 the 8-alt cap saturates in
`collectAltScores`, so every cell ends up with similar scores and reshape
can't pick the best move. Raise the cap to 32 for N≥13 so cells with truly
many alts get distinguished from cells with merely 8.

**Result.** No measurable improvement at N=12 (mean 6.5s, indistinguishable
from baseline).

**Why it failed (likely).** Bigger cap → more expensive scoring → fewer
reshapes per second. Even when scores differentiate better, the greedy
first-viable move still doesn't pick the best (it picks the first cell whose
neighbor donation passes the connectivity check, sorted by score). Without
restructuring reshape to actually *use* the score gradient, raising the cap
just adds cost.

### v4d — reject queen layouts with too many trivial swap pairs (BROKEN)

**Idea.** Count pairs (r1, r2) where swapping queenCols[r1] ↔ queenCols[r2]
still satisfies king-adjacency. Reject layouts with more than N such pairs.
Intuition: such pairs are candidate alt solutions if regions don't pin them.

**Result.** At threshold N, **100% rejection rate**. All 5 N=10 trials hit
the 5s timeout without finding a single accepted layout. The combinatorial
math is unforgiving: with random non-attacking placements, every layout has
hundreds of swap-feasible pairs.

**Why it failed.** Even non-adjacent rows almost always admit a swap (king-
adjacency only constrains four neighbor positions out of N). Setting the
threshold higher would weaken the filter to uselessness. Approach abandoned;
swap-feasibility is too weak a signal for prefiltering.

### v4e — fastCount with bitmask column iteration

**Idea.** Replace the per-column branch in `fastCount` /
`collectAltScores` with bit iteration: precompute the adjacency mask from
`prev`, AND with `~usedC`, iterate set bits via `cands & -cands` + clz32.

**Result.** ~2× faster at N=10 (mean 42ms vs 96ms over 5 trials with shared
CPU). Correctness verified — `--verify` passes. **But does not move the
N=14/N=15 cliff.** Per-attempt cost shrinks; success rate per attempt
doesn't, and that's what dominates.

**Verdict.** Worth keeping as a micro-optimization but on its own it's
insufficient.

### v4c — pair-recolor reshape fallback (THE WIN)

**Idea.** The current `reshapeOnce` only tries single-cell donations. Many
boards have alts where every viable single-cell move is blocked by the
4-connectivity check. Add a fallback: when single-cell exhausts, try
**swapping** the regions of an adjacent pair of cells in different regions.
Both regions keep the same size, and the high-score cell A leaves its old
region — breaking every alt that placed a queen at A — while the donor cell
B fills the hole, often preserving connectivity that a one-way donation
would have destroyed. Skip pairs where either cell is an intended queen.

**Result.** Big standalone win at N=12 and the only variant that materially
helps at N=14:

| N  | baseline (60s budget) | pair-recolor (60s budget)         |
|----|-----------------------|------------------------------------|
| 10 | mean 96ms             | mean 25ms (~4× faster)             |
| 12 | mean 6.7s, 19/20      | mean 1.2s, 5/5 (~5.7× faster)      |
| 14 | 0/5                   | 0/5 single-thread; 2/5 in 7-worker pool |
| 15 | not measured          | 0/5 in 7-worker pool               |

**Why it helped.** Inspection of a few failed-then-rescued boards showed the
common pattern: the high-score cell sat between two regions, both already
small enough that neither could donate without disconnecting itself. A
single-cell move couldn't break the alt; a swap with the neighbor *could*,
because the donor's slot was filled by the cell coming from the other side.
Pair-recolor adds essentially "free" reshape moves that the existing
mechanism couldn't reach.

**Verdict.** Merged into the main generator. Doesn't reach the user's
"consistently solve N=15 in under 60s" bar but it's a strict improvement
across all sizes and is the largest single win in this round.

### v4-combined — A + B + E together

**Idea.** Bundle warm restart, adaptive cap, and bitmask fastCount.

**Result.** N=12: mean 6.5s (baseline 6.7s; noise). N=14: not tested
individually past combined. N=15: 0/3 in 60s before stopping. No qualitative
improvement.

### v4f — worker-pool parallelism (7 workers, combined gen)

**Idea.** Race 7 worker threads, each running the combined-variant generator
independently with the same 60s budget. First worker to find a unique board
wins; the rest are terminated.

**Result.**

| N  | success | mean time             |
|----|---------|-----------------------|
| 12 | 3/3     | 0.88s                 |
| 14 | 1/5     | one success at ~25.9s; four timeouts |

Re-ran 14 with the raw baseline generator inside workers (no algorithmic
changes): same result, 1/5 in 60s. So worker-pool gives roughly the expected
~7× throughput multiplier, but the **baseline at N=14 is so far below the
1-success-per-60s rate that even 7× isn't enough**. N=15 is ~10× harder again
and was not benchmarked further.

**Why it failed to hit the bar.** Worker pools multiply throughput; they
don't change success rate per attempt. The dominant cost at N≥14 is the
exponential blow-up of `fastCount` / `collectAltScores` combined with a
success-per-attempt rate that has cratered. To consistently solve N=15 in
60s, the algorithm needs a fundamental improvement in per-attempt success
rate, not more parallel attempts of the same low-rate process.

## General lesson (updated)

The Queens generation problem is dominated by the **uniqueness filter**,
not by feasibility. Any algorithm that doesn't generate candidate boards
in O(NN) per attempt (or close to it) will lose to v1, because v1 is so
cheap per attempt that brute-force sampling beats sophisticated search.
Future ideas worth trying should either:

- Generate candidates even faster than v1 (unlikely — v1 is already ~50K
  attempts/sec at N=10), or
- Improve the *success rate per attempt* without making each attempt much
  more expensive (the reshape mechanism is the main lever here — see
  `generation.js` for the current implementation and its tried-and-
  rejected variants).

The v4 round confirms a stronger version: **parallelism and constant-factor
speedups don't move the N≥14 cliff**. They multiply throughput but the
success rate has fallen so far that even 7× helps marginally. The next
serious attempt should target one of:

- A reshape that is much more aggressive per call (multi-cell, region-pair
  swaps, or targeted reconnection moves) so that more attempts get rescued.
- A construction procedure that *builds in* uniqueness rather than filters
  for it after the fact (e.g., add a region whose only legal queen position
  given existing regions is the one we want, repeated N times — speculative,
  has not been prototyped).
- Lowering the bar: keep the current generator and surface a long-running
  state to the user (e.g., a "still working…" message after 10s), rather
  than insisting on sub-60s at N=15.
