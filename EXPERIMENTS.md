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

## General lesson

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
