// Worker-pool variant: race N parallel generation attempts. First worker to
// find a uniquely-solvable board wins; the rest are terminated. Each worker
// runs the single-threaded generator (defaults to ./generation.js; override
// with WORKER_GEN=… env var).
//
// Returns a Promise — the harness awaits it.

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POOL_SIZE = Math.max(1, Math.min(7, (await import("node:os")).cpus().length - 1));
const WORKER_GEN = path.join(__dirname, process.env.WORKER_GEN || "generation.js");
const WORKER_RUNNER = path.join(__dirname, "worker_runner.mjs");

export const generateUniqueBoard = (N, opts = {}) => {
    const budgetMs = opts.budgetMs ?? 600000;
    const start = performance.now();
    return new Promise((resolve) => {
        const workers = [];
        let settled = false;
        let totalAttempts = 0;
        let totalReshapes = 0;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            for (const w of workers) w.terminate();
            resolve(result);
        };

        for (let i = 0; i < POOL_SIZE; i++) {
            const w = new Worker(WORKER_RUNNER, {
                workerData: { N, budgetMs, genPath: WORKER_GEN },
            });
            workers.push(w);
            w.on("message", ({ grid, stats }) => {
                totalAttempts += stats.attempts;
                totalReshapes += stats.reshapes;
                if (grid !== null) {
                    finish({
                        grid,
                        stats: {
                            attempts: totalAttempts,
                            reshapes: totalReshapes,
                            elapsedMs: performance.now() - start,
                            workers: POOL_SIZE,
                        },
                    });
                }
            });
            w.on("error", (err) => {
                if (!settled) console.error("worker error:", err);
            });
            w.on("exit", () => {
                if (!settled && workers.every((wk) => wk.threadId === -1)) {
                    finish({
                        grid: null,
                        stats: {
                            attempts: totalAttempts,
                            reshapes: totalReshapes,
                            elapsedMs: performance.now() - start,
                            timedOut: true,
                            workers: POOL_SIZE,
                        },
                    });
                }
            });
        }
    });
};
