// Generates a Queens-puzzle board with exactly one valid solution.
//
// Strategy:
//   1) Place GRID_SIZE non-attacking queens via row-by-row backtracking.
//   2) Flood-fill the rest of the board into colored regions, growing each
//      region outward from its queen via random-pop BFS for organic shapes.
//   3) Solve the resulting board: if exactly one solution, done.
//   4) Otherwise run a guided reshape — collect alternate solutions, score
//      cells by how often alts use them, recolor the highest-scored cell
//      into a small adjacent region (preserving connectivity). Each
//      successful reshape kills ≥1 alt while preserving the intended one.
//   5) If reshapes per attempt are exhausted, restart from step 1.
//
// Internally everything uses integer region IDs in typed arrays + bitmasks
// for speed. The function returns a 2D color-string grid sized [N][N], plus
// stats describing how the board was found.
//
// Soundness of reshape: the intended solution sits at (queenCols[r], r) for
// each row r. reshapeOnce never touches those cells. An alt solution uses a
// cell where queenCols[r] !== alt[r]; recoloring that cell into a different
// region invalidates the alt (its region count breaks) while leaving the
// intended solution untouched.

import { mulberry32, randomSeed } from "./seed.js";
import { regionIdsToColorGrid } from "./boardCodec.js";

// `opts.seed` (uint32) seeds an internal mulberry32 PRNG; the same seed + N
// produces the same regionGrid and the same colors. If omitted, a random
// seed is generated (and returned in stats.seed) so every board is
// reproducible. `opts.rng` lets callers inject a custom `() => [0,1)` and
// takes precedence over `seed`; in that case stats.seed is null.
// `opts.budgetMs` caps wall-clock; on timeout returns { grid: null,
// stats: { ..., timedOut: true } }.
export const generateUniqueBoard = (N, opts = {}) => {
    const seedValue =
        opts.rng != null
            ? null
            : opts.seed != null
              ? opts.seed >>> 0
              : randomSeed();
    const rng = opts.rng ?? mulberry32(seedValue);
    const budgetMs = opts.budgetMs ?? Infinity;
    const NN = N * N;
    const regionGrid = new Int8Array(NN); // region id 0..N-1, or -1 for empty
    const queenCols = new Int8Array(N); // queenCols[row] = column of queen
    const usedColsBuf = new Uint8Array(N);
    const fillQX = new Int16Array(NN * 4);
    const fillQY = new Int16Array(NN * 4);
    const fillQR = new Int8Array(NN * 4);
    const altPlaced = new Int8Array(N);
    const cellScores = new Int32Array(NN);
    const regionSizes = new Int16Array(N);
    const visitBuf = new Uint8Array(NN);
    const dfsStack = new Int32Array(NN);

    const fastPlaceQueens = () => {
        usedColsBuf.fill(0);
        const recur = (row) => {
            if (row === N) return true;
            const order = [];
            for (let i = 0; i < N; i++) order.push(i);
            for (let i = N - 1; i > 0; i--) {
                const j = (rng() * (i + 1)) | 0;
                const t = order[i];
                order[i] = order[j];
                order[j] = t;
            }
            const prev = row > 0 ? queenCols[row - 1] : -127;
            for (let k = 0; k < N; k++) {
                const x = order[k];
                if (usedColsBuf[x]) continue;
                if (prev !== -127 && x - prev <= 1 && prev - x <= 1) continue;
                queenCols[row] = x;
                usedColsBuf[x] = 1;
                if (recur(row + 1)) return true;
                usedColsBuf[x] = 0;
            }
            return false;
        };
        return recur(0);
    };

    // Uniform-random flood-fill: pick a random frontier cell to claim each
    // step. We tried biasing toward cells closer to their region's queen but
    // it sharply increased alt-solution counts (compact, predictable region
    // shapes admit easy column-swap alternates).
    const fastFloodFill = () => {
        regionGrid.fill(-1);
        let qLen = 0;
        for (let r = 0; r < N; r++) {
            const c = queenCols[r];
            regionGrid[r * N + c] = r;
            if (r > 0) {
                fillQX[qLen] = c;
                fillQY[qLen] = r - 1;
                fillQR[qLen] = r;
                qLen++;
            }
            if (r < N - 1) {
                fillQX[qLen] = c;
                fillQY[qLen] = r + 1;
                fillQR[qLen] = r;
                qLen++;
            }
            if (c > 0) {
                fillQX[qLen] = c - 1;
                fillQY[qLen] = r;
                fillQR[qLen] = r;
                qLen++;
            }
            if (c < N - 1) {
                fillQX[qLen] = c + 1;
                fillQY[qLen] = r;
                fillQR[qLen] = r;
                qLen++;
            }
        }
        while (qLen > 0) {
            const idx = (rng() * qLen) | 0;
            const x = fillQX[idx];
            const y = fillQY[idx];
            const r = fillQR[idx];
            qLen--;
            fillQX[idx] = fillQX[qLen];
            fillQY[idx] = fillQY[qLen];
            fillQR[idx] = fillQR[qLen];
            const cellIdx = y * N + x;
            if (regionGrid[cellIdx] !== -1) continue;
            regionGrid[cellIdx] = r;
            if (y > 0 && regionGrid[cellIdx - N] === -1) {
                fillQX[qLen] = x;
                fillQY[qLen] = y - 1;
                fillQR[qLen] = r;
                qLen++;
            }
            if (y < N - 1 && regionGrid[cellIdx + N] === -1) {
                fillQX[qLen] = x;
                fillQY[qLen] = y + 1;
                fillQR[qLen] = r;
                qLen++;
            }
            if (x > 0 && regionGrid[cellIdx - 1] === -1) {
                fillQX[qLen] = x - 1;
                fillQY[qLen] = y;
                fillQR[qLen] = r;
                qLen++;
            }
            if (x < N - 1 && regionGrid[cellIdx + 1] === -1) {
                fillQX[qLen] = x + 1;
                fillQY[qLen] = y;
                fillQR[qLen] = r;
                qLen++;
            }
        }
    };

    // Count solutions on regionGrid up to `limit`. Treats unfilled cells (-1)
    // as un-placeable so it works on partial boards too.
    const ALL_COLS = (1 << N) - 1;
    const fastCount = (limit) => {
        let count = 0;
        let usedC = 0;
        let usedR = 0;
        const recur = (row, prev) => {
            if (count >= limit) return;
            if (row === N) {
                count++;
                return;
            }
            const base = row * N;
            const adj = prev === -1 ? 0 : prev === 0 ? 0b11 : (0b111 << (prev - 1)) & ALL_COLS;
            let cands = ALL_COLS & ~usedC & ~adj;
            while (cands !== 0) {
                const cbit = cands & -cands;
                cands ^= cbit;
                const x = 31 - Math.clz32(cbit);
                const r = regionGrid[base + x];
                if (r < 0) continue;
                const rbit = 1 << r;
                if (usedR & rbit) continue;
                usedC |= cbit;
                usedR |= rbit;
                recur(row + 1, x);
                usedC &= ~cbit;
                usedR &= ~rbit;
                if (count >= limit) return;
            }
        };
        recur(0, -1);
        return count;
    };

    // Score every cell by how many alt solutions place a queen there (where
    // the intended solution does not). High score ⇒ recoloring breaks many.
    const collectAltScores = (maxAlts) => {
        cellScores.fill(0);
        let altsFound = 0;
        let usedC = 0;
        let usedR = 0;
        const recur = (row, prev) => {
            if (altsFound >= maxAlts) return;
            if (row === N) {
                let differs = false;
                for (let i = 0; i < N; i++) {
                    if (altPlaced[i] !== queenCols[i]) {
                        differs = true;
                        break;
                    }
                }
                if (differs) {
                    for (let r = 0; r < N; r++) {
                        if (altPlaced[r] !== queenCols[r]) {
                            cellScores[r * N + altPlaced[r]]++;
                        }
                    }
                    altsFound++;
                }
                return;
            }
            const base = row * N;
            const adj = prev === -1 ? 0 : prev === 0 ? 0b11 : (0b111 << (prev - 1)) & ALL_COLS;
            let cands = ALL_COLS & ~usedC & ~adj;
            while (cands !== 0) {
                const cbit = cands & -cands;
                cands ^= cbit;
                const x = 31 - Math.clz32(cbit);
                const r = regionGrid[base + x];
                if (r < 0) continue;
                const rbit = 1 << r;
                if (usedR & rbit) continue;
                altPlaced[row] = x;
                usedC |= cbit;
                usedR |= rbit;
                recur(row + 1, x);
                usedC &= ~cbit;
                usedR &= ~rbit;
                if (altsFound >= maxAlts) return;
            }
        };
        recur(0, -1);
        return altsFound;
    };

    const computeRegionSizes = () => {
        regionSizes.fill(0);
        for (let i = 0; i < NN; i++) regionSizes[regionGrid[i]]++;
    };

    // 4-connectivity check for a region.
    const regionConnected = (r) => {
        visitBuf.fill(0);
        let total = 0;
        let start = -1;
        for (let i = 0; i < NN; i++) {
            if (regionGrid[i] === r) {
                total++;
                if (start === -1) start = i;
            }
        }
        if (start === -1) return false;
        let sp = 0;
        dfsStack[sp++] = start;
        visitBuf[start] = 1;
        let count = 1;
        while (sp > 0) {
            const idx = dfsStack[--sp];
            const y = (idx / N) | 0;
            const x = idx - y * N;
            if (y > 0 && !visitBuf[idx - N] && regionGrid[idx - N] === r) {
                visitBuf[idx - N] = 1;
                dfsStack[sp++] = idx - N;
                count++;
            }
            if (y < N - 1 && !visitBuf[idx + N] && regionGrid[idx + N] === r) {
                visitBuf[idx + N] = 1;
                dfsStack[sp++] = idx + N;
                count++;
            }
            if (x > 0 && !visitBuf[idx - 1] && regionGrid[idx - 1] === r) {
                visitBuf[idx - 1] = 1;
                dfsStack[sp++] = idx - 1;
                count++;
            }
            if (x < N - 1 && !visitBuf[idx + 1] && regionGrid[idx + 1] === r) {
                visitBuf[idx + 1] = 1;
                dfsStack[sp++] = idx + 1;
                count++;
            }
        }
        return count === total;
    };

    // Simple greedy reshape: iterate cells by alt score (highest first), for
    // each cell try recoloring into the smallest adjacent region that keeps
    // both regions connected. Commits the first viable move.
    //
    // (We tried K-lookahead — apply each tentative move and recount alts to
    // pick the best — but on big N alt counts saturate the lookahead cap so
    // every move looks the same, and the lookahead's per-reshape cost cuts
    // throughput by ~3-4×. Plain greedy gets more reshapes per unit time.)
    const reshapeOnce = () => {
        const alts = collectAltScores(8);
        if (alts === 0) return false;
        computeRegionSizes();

        const cells = [];
        for (let i = 0; i < NN; i++) if (cellScores[i] > 0) cells.push(i);
        cells.sort((a, b) => cellScores[b] - cellScores[a]);

        for (const idx of cells) {
            const y = (idx / N) | 0;
            const x = idx - y * N;
            const cur = regionGrid[idx];
            // Never touch the intended queen's own cell.
            if (cur === y && queenCols[cur] === x) continue;

            const seen = new Set();
            const cands = [];
            const tryAdd = (r) => {
                if (r === cur || seen.has(r)) return;
                seen.add(r);
                cands.push(r);
            };
            if (y > 0) tryAdd(regionGrid[idx - N]);
            if (y < N - 1) tryAdd(regionGrid[idx + N]);
            if (x > 0) tryAdd(regionGrid[idx - 1]);
            if (x < N - 1) tryAdd(regionGrid[idx + 1]);
            cands.sort((a, b) => regionSizes[a] - regionSizes[b]);

            for (const newR of cands) {
                regionGrid[idx] = newR;
                if (regionConnected(cur) && regionConnected(newR)) return true;
                regionGrid[idx] = cur;
            }
        }

        // Pair-recolor fallback. For each high-score cell A, try swapping
        // regions with an adjacent cell B in a different region. Both regions
        // keep the same size; A leaves its old region (which is the goal —
        // every alt that used A is broken). Connectivity check on both
        // regions still required. Skip if either cell is an intended queen.
        for (const idx of cells) {
            const yA = (idx / N) | 0;
            const xA = idx - yA * N;
            const rA = regionGrid[idx];
            if (rA === yA && queenCols[rA] === xA) continue;

            const neighbors = [];
            if (yA > 0) neighbors.push(idx - N);
            if (yA < N - 1) neighbors.push(idx + N);
            if (xA > 0) neighbors.push(idx - 1);
            if (xA < N - 1) neighbors.push(idx + 1);

            for (const bIdx of neighbors) {
                const rB = regionGrid[bIdx];
                if (rB === rA) continue;
                const yB = (bIdx / N) | 0;
                const xB = bIdx - yB * N;
                if (rB === yB && queenCols[rB] === xB) continue;
                regionGrid[idx] = rB;
                regionGrid[bIdx] = rA;
                if (regionConnected(rA) && regionConnected(rB)) return true;
                regionGrid[idx] = rA;
                regionGrid[bIdx] = rB;
            }
        }
        return false;
    };

    // === Search loop ====================================================
    // No time budget — keep trying until we find a uniquely solvable board.
    // For large N this may take a long time; the caller is expected to show
    // a loading indicator.
    const PER_ATTEMPT_RESHAPES = 30;
    const BEST_PROBE_LIMIT = 16;
    const start = performance.now();
    let attempts = 0;
    let totalReshapes = 0;

    const tryAttempt = () => {
        if (!fastPlaceQueens()) return false;
        fastFloodFill();
        if (fastCount(2) === 1) return true;
        for (let i = 0; i < PER_ATTEMPT_RESHAPES; i++) {
            if (!reshapeOnce()) break;
            totalReshapes++;
            if (fastCount(2) === 1) return true;
        }
        return false;
    };

    let timedOut = false;
    while (true) {
        if (performance.now() - start > budgetMs) {
            timedOut = true;
            break;
        }
        attempts++;
        if (tryAttempt()) break;
    }

    if (timedOut) {
        return {
            grid: null,
            stats: {
                attempts,
                reshapes: totalReshapes,
                elapsedMs: performance.now() - start,
                seed: seedValue,
                timedOut: true,
            },
        };
    }

    // Colors come from the board's own identity (boardKey), so newly
    // generated and reloaded boards always render identically.
    const grid = regionIdsToColorGrid(regionGrid, N);

    return {
        grid,
        stats: {
            attempts,
            reshapes: totalReshapes,
            elapsedMs: performance.now() - start,
            seed: seedValue,
        },
    };
};
