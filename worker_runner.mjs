import { parentPort, workerData } from "node:worker_threads";

const { generateUniqueBoard } = await import(workerData.genPath);
const { grid, stats } = generateUniqueBoard(workerData.N, {
    budgetMs: workerData.budgetMs,
});
parentPort.postMessage({ grid, stats });
