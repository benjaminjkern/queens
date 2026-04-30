// Benchmark + sanity-test harness for generation.js.
//
// Usage:
//   node test_generation.mjs                # full sweep
//   node test_generation.mjs 11             # one size, default trials
//   node test_generation.mjs 11 50          # one size, 50 trials
//   node test_generation.mjs --verify       # full sweep + per-board verify
//
// Reports for each N: success rate, attempts, reshapes, time (mean/median/p95).

import { generateUniqueBoard } from "./generation.js";

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const numericArgs = args.filter((a) => !a.startsWith("--")).map(Number);
const sizes = numericArgs.length > 0 ? [numericArgs[0]] : [8, 10, 11, 12, 14, 16, 18];
const trials = numericArgs.length > 1 ? numericArgs[1] : 20;

// Simple solution counter to verify uniqueness of returned grids.
const countSolutions = (grid, limit) => {
    const N = grid.length;
    // Map color strings → region IDs.
    const colorMap = new Map();
    const regionGrid = new Int8Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const c = grid[y][x];
            let id = colorMap.get(c);
            if (id === undefined) {
                id = colorMap.size;
                colorMap.set(c, id);
            }
            regionGrid[y * N + x] = id;
        }
    }
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
        for (let x = 0; x < N; x++) {
            const cbit = 1 << x;
            if (usedC & cbit) continue;
            if (prev !== -1 && Math.abs(x - prev) <= 1) continue;
            const r = regionGrid[base + x];
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
    return { count, regionCount: colorMap.size };
};

const stats = (arr) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
        mean: sum / sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
        min: sorted[0],
        max: sorted[sorted.length - 1],
    };
};

const fmt = (n, digits = 0) =>
    n === null
        ? "—"
        : typeof n === "number"
          ? n.toFixed(digits).padStart(8)
          : String(n).padStart(8);

const runSize = (N, trials) => {
    console.log(`\n=== N=${N}, ${trials} trials ===`);
    const found = [];
    const attempts = [];
    const reshapes = [];
    const times = [];
    const finalAlts = [];
    const bestAlts = [];
    let successes = 0;
    let verifyFails = 0;

    for (let i = 0; i < trials; i++) {
        const t0 = performance.now();
        const { grid, stats: s } = generateUniqueBoard(N);
        const elapsed = performance.now() - t0;
        attempts.push(s.attempts);
        reshapes.push(s.reshapes);
        times.push(elapsed);
        finalAlts.push(s.finalAltCount);
        if (s.bestAltCount !== null) bestAlts.push(s.bestAltCount);
        if (s.found) successes++;

        if (verify) {
            const { count, regionCount } = countSolutions(grid, 3);
            const ok = count === 1 && regionCount === N;
            if (s.found && !ok) {
                verifyFails++;
                console.log(
                    `  trial ${i}: claimed unique but verify says ` +
                        `solutions=${count} regions=${regionCount}`,
                );
            }
            if (!s.found && count === 1) {
                // generator gave up but the result happens to be unique
                successes++;
            }
        }
        process.stdout.write(s.found ? "." : "x");
    }
    process.stdout.write("\n");

    const aS = stats(attempts);
    const rS = stats(reshapes);
    const tS = stats(times);

    console.log(
        `  success: ${successes}/${trials}` +
            (verify ? `  verify-fail: ${verifyFails}` : ""),
    );
    console.log(
        `  attempts:  mean=${fmt(aS.mean, 1)} median=${fmt(aS.median)}  p95=${fmt(aS.p95)}  max=${fmt(aS.max)}`,
    );
    console.log(
        `  reshapes:  mean=${fmt(rS.mean, 1)} median=${fmt(rS.median)}  p95=${fmt(rS.p95)}  max=${fmt(rS.max)}`,
    );
    console.log(
        `  time(ms):  mean=${fmt(tS.mean, 1)} median=${fmt(tS.median, 1)}  p95=${fmt(tS.p95, 1)}  max=${fmt(tS.max, 1)}`,
    );
    const faS = stats(finalAlts);
    const baS = stats(bestAlts);
    console.log(
        `  finalAlt:  mean=${fmt(faS.mean, 1)} median=${fmt(faS.median)}  max=${fmt(faS.max)}` +
            (baS
                ? `   bestAlt: mean=${fmt(baS.mean, 1)} median=${fmt(baS.median)}`
                : ""),
    );
};

for (const N of sizes) runSize(N, trials);
