// Benchmark + sanity-test harness for generation.js.
//
// Usage:
//   node test_generation.mjs                          # full sweep
//   node test_generation.mjs 11                       # one size, default trials
//   node test_generation.mjs 11 50                    # one size, 50 trials
//   node test_generation.mjs --verify                 # also verify each board
//   node test_generation.mjs 15 20 --budget=60000     # 60s per-trial budget
//   node test_generation.mjs --gen=./generation.X.js  # swap in a variant
//
// Reports per N: success/timeout counts, attempts, reshapes, time stats.

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const budgetArg = args.find((a) => a.startsWith("--budget="));
const genArg = args.find((a) => a.startsWith("--gen="));
const budgetMs = budgetArg ? Number(budgetArg.split("=")[1]) : Infinity;
const genPath = genArg ? genArg.split("=")[1] : "./generation.js";

const { generateUniqueBoard } = await import(genPath);

const numericArgs = args.filter((a) => !a.startsWith("--")).map(Number);
const sizes = numericArgs.length > 0 ? [numericArgs[0]] : [8, 10, 11, 12, 14, 16, 18];
const trials = numericArgs.length > 1 ? numericArgs[1] : 20;

// Simple solution counter to verify uniqueness of returned grids.
const countSolutions = (grid, limit) => {
    const N = grid.length;
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

const runSize = async (N, trials) => {
    console.log(`\n=== N=${N}, ${trials} trials${Number.isFinite(budgetMs) ? `, budget=${budgetMs}ms` : ""} ===`);
    const attempts = [];
    const reshapes = [];
    const times = [];
    let timeouts = 0;
    let verifyFails = 0;

    for (let i = 0; i < trials; i++) {
        const { grid, stats: s } = await generateUniqueBoard(N, { budgetMs });
        if (s.timedOut || grid === null) {
            timeouts++;
            process.stdout.write("T");
            continue;
        }
        attempts.push(s.attempts);
        reshapes.push(s.reshapes);
        times.push(s.elapsedMs);

        if (verify) {
            const { count, regionCount } = countSolutions(grid, 3);
            if (count !== 1 || regionCount !== N) {
                verifyFails++;
                console.log(
                    `\n  trial ${i}: verify says solutions=${count} regions=${regionCount}`,
                );
            }
        }
        process.stdout.write(".");
    }
    process.stdout.write("\n");

    console.log(`  success: ${times.length}/${trials}  timeouts: ${timeouts}`);
    if (verify) console.log(`  verify-fail: ${verifyFails}`);
    if (times.length === 0) return;
    const aS = stats(attempts);
    const rS = stats(reshapes);
    const tS = stats(times);
    console.log(
        `  attempts:  mean=${fmt(aS.mean, 1)} median=${fmt(aS.median)}  p95=${fmt(aS.p95)}  max=${fmt(aS.max)}`,
    );
    console.log(
        `  reshapes:  mean=${fmt(rS.mean, 1)} median=${fmt(rS.median)}  p95=${fmt(rS.p95)}  max=${fmt(rS.max)}`,
    );
    console.log(
        `  time(ms):  mean=${fmt(tS.mean, 1)} median=${fmt(tS.median, 1)}  p95=${fmt(tS.p95, 1)}  max=${fmt(tS.max, 1)}`,
    );
};

// Determinism: same seed + N must produce byte-identical region grids.
// Run this first so it surfaces regressions before the slow sweep. Skipped
// for variant generators (--gen=…) that may not honor opts.seed.
const checkDeterminism = async () => {
    const cases = [
        { N: 8, seed: 1 },
        { N: 10, seed: 12345 },
        { N: 11, seed: 0xdeadbeef },
    ];
    for (const { N, seed } of cases) {
        const a = await generateUniqueBoard(N, { seed });
        const b = await generateUniqueBoard(N, { seed });
        const canonical = (grid) => {
            const map = new Map();
            const out = [];
            for (const row of grid) for (const c of row) {
                if (!map.has(c)) map.set(c, map.size);
                out.push(map.get(c));
            }
            return out.join(",");
        };
        const ca = canonical(a.grid);
        const cb = canonical(b.grid);
        if (ca !== cb) {
            console.error(`DETERMINISM FAIL N=${N} seed=${seed}`);
            process.exit(1);
        }
        if (a.stats.seed !== seed) {
            console.error(
                `seed not echoed: N=${N} expected ${seed} got ${a.stats.seed}`,
            );
            process.exit(1);
        }
    }
    console.log(`determinism: ok (${cases.length} cases)`);
};

console.log(`generator: ${genPath}`);
if (!genArg) await checkDeterminism();
for (const N of sizes) await runSize(N, trials);
