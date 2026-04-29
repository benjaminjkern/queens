let canvas, ctx;

const GRID_SIZE = 20;
const SQUARE_SIZE = 50;

// Player-placed marks ("queen" or "x"), separate from the colored board itself.
const marks = Array(GRID_SIZE)
    .fill()
    .map(() => Array(GRID_SIZE).fill(null));

// Translate a mouse event into a grid cell, or null if outside the board.
const eventCell = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_SIZE);
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
    return [x, y];
};

// Cells "blocked" by a queen at (qx,qy): same row, same column, the 8
// surrounding cells, and every cell in the queen's color region. Excludes
// the queen's own cell. Uses a Set keyed by "x,y" to avoid duplicates.
const blockedCells = (qx, qy) => {
    const seen = new Set();
    const out = [];
    const add = (x, y) => {
        if (x === qx && y === qy) return;
        const key = `${x},${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push([x, y]);
    };
    for (let i = 0; i < GRID_SIZE; i++) {
        add(i, qy);
        add(qx, i);
    }
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx;
            const ny = qy + dy;
            if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE)
                continue;
            add(nx, ny);
        }
    }
    const region = grid[qy][qx];
    if (region) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (grid[y][x] === region) add(x, y);
            }
        }
    }
    return out;
};

// True if any queen on the board (other than one optionally excluded) blocks
// the given cell.
const isBlockedByAnyQueen = (x, y, exclude) => {
    for (let qy = 0; qy < GRID_SIZE; qy++) {
        for (let qx = 0; qx < GRID_SIZE; qx++) {
            if (marks[qy][qx] !== "queen") continue;
            if (exclude && qx === exclude[0] && qy === exclude[1]) continue;
            if (qx === x && qy === y) continue;
            if (qx === x || qy === y) return true;
            if (Math.abs(qx - x) <= 1 && Math.abs(qy - y) <= 1) return true;
            if (grid[qy][qx] && grid[qy][qx] === grid[y][x]) return true;
        }
    }
    return false;
};

// Place a queen at (x,y) and auto-x every cell it blocks (only on empty
// cells — don't overwrite manual x's, other queens, or existing auto-x's).
const addQueen = (x, y) => {
    marks[y][x] = "queen";
    for (const [bx, by] of blockedCells(x, y)) {
        if (marks[by][bx] === null) marks[by][bx] = "ax";
    }
};

// Remove a queen at (x,y) and clear its auto-x's, but only on cells that
// aren't still blocked by some other queen.
const removeQueen = (x, y) => {
    marks[y][x] = null;
    for (const [bx, by] of blockedCells(x, y)) {
        if (marks[by][bx] !== "ax") continue;
        if (!isBlockedByAnyQueen(bx, by, [x, y])) marks[by][bx] = null;
    }
};

// Left click on a cell toggles a queen there (clicking the same cell clears it).
const handleLeftClick = (e) => {
    const cell = eventCell(e);
    if (!cell) return;
    const [x, y] = cell;
    if (marks[y][x] === "queen") removeQueen(x, y);
    else addQueen(x, y);
    draw();
    checkWin();
};

// Returns true if the user's queen marks form a valid solution: exactly
// GRID_SIZE queens, one per row, column, and color region, with no two
// queens diagonally adjacent.
const checkWin = () => {
    const placed = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (marks[y][x] === "queen") placed.push([x, y]);
        }
    }
    if (placed.length !== GRID_SIZE) return false;
    const cols = new Set();
    const rows = new Set();
    const colors = new Set();
    for (const [x, y] of placed) {
        if (rows.has(y) || cols.has(x) || colors.has(grid[y][x])) return false;
        rows.add(y);
        cols.add(x);
        colors.add(grid[y][x]);
    }
    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            const [ax, ay] = placed[i];
            const [bx, by] = placed[j];
            if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) return false;
        }
    }
    document.getElementById("win").classList.add("show");
    return true;
};

// Right-click drag paints x's on every cell touched, OR clears x's if the drag
// started on an already-x cell.
let rightDragging = false;
let rightDragValue = null; // "x" to paint, null to clear

const applyRightDrag = (cell) => {
    const [x, y] = cell;
    if (marks[y][x] === "queen") return;
    if (marks[y][x] !== rightDragValue) {
        marks[y][x] = rightDragValue;
        draw();
    }
};

window.onload = () => {
    canvas = document.getElementById("canvas");
    canvas.width = GRID_SIZE * SQUARE_SIZE;
    canvas.height = GRID_SIZE * SQUARE_SIZE;
    ctx = canvas.getContext("2d");

    // Left click → queen toggle. Right click/drag → paint x's.
    canvas.addEventListener("click", handleLeftClick);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 2) return;
        const cell = eventCell(e);
        if (!cell) return;
        rightDragging = true;
        const m = marks[cell[1]][cell[0]];
        rightDragValue = m === "x" || m === "ax" ? null : "x";
        applyRightDrag(cell);
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!rightDragging) return;
        const cell = eventCell(e);
        if (!cell) return;
        applyRightDrag(cell);
    });

    const endRightDrag = () => {
        rightDragging = false;
    };
    canvas.addEventListener("mouseup", endRightDrag);
    canvas.addEventListener("mouseleave", endRightDrag);

    document.getElementById("restart").addEventListener("click", () => {
        reset();
        loop();
    });

    loop();
};

// Repaint every cell: the region color first, then the player's mark on top.
const draw = () => {
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
            ctx.fillStyle = grid[y][x] ?? "white";
            ctx.fillRect(
                x * SQUARE_SIZE,
                y * SQUARE_SIZE,
                SQUARE_SIZE,
                SQUARE_SIZE,
            );

            const mark = marks[y][x];
            if (mark) {
                ctx.fillStyle = "black";
                ctx.font = `${SQUARE_SIZE * 0.7}px serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    mark === "queen" ? "👑" : "✗",
                    x * SQUARE_SIZE + SQUARE_SIZE / 2,
                    y * SQUARE_SIZE + SQUARE_SIZE / 2,
                );
            }
        }
    }
};

// Flood-fill the rest of the board outward from each queen's seeded neighbors.
// Picking from `queue` in randomized order makes the regions grow in organic,
// irregular shapes rather than neat rectangles.
const loop = () => {
    shuffle(queue);
    while (queue.length) {
        const {
            pos: [x, y],
            color,
        } = queue.pop();
        if (grid[y][x]) continue;
        const neighbors = getNeighbors(x, y);
        for (const neighbor of neighbors) {
            const [nx, ny] = neighbor;

            if (grid[ny][nx]) continue;
            queue.splice(Math.floor(Math.random() * queue.length), 0, {
                pos: neighbor,
                color,
            });
        }

        grid[y][x] = color;
    }

    draw();
};

// The board itself: grid[y][x] holds the region color of that cell, or null.
const grid = Array(GRID_SIZE)
    .fill()
    .map(() =>
        Array(GRID_SIZE)
            .fill()
            .map(() => null),
    );

const shuffle = (list) => {
    for (let i = 0; i < list.length; i++) {
        const r = Math.floor(Math.random() * list.length);
        [list[i], list[r]] = [list[r], list[i]];
    }
};

// Final placed queens, one per region.
const queens = [];

// Frontier of cells waiting to be flood-filled with a region color (see loop()).
const queue = [];

// 4-directional neighbors, clipped to the board.
const getNeighbors = (x, y) => {
    const neighbors = [];

    if (y > 0) neighbors.push([x, y - 1]);
    if (y < GRID_SIZE - 1) neighbors.push([x, y + 1]);
    if (x > 0) neighbors.push([x - 1, y]);
    if (x < GRID_SIZE - 1) neighbors.push([x + 1, y]);
    return neighbors;
};

// Place GRID_SIZE non-attacking queens (no shared row/col, no diagonal touch)
// via backtracking — one queen per row, trying columns in random order. Greedy
// random placement could paint itself into a corner with no valid spot left
// (especially on small boards), so we backtrack to guarantee a valid layout.
const placeQueens = (row, cols) => {
    if (row === GRID_SIZE) return true;
    const order = [...Array(GRID_SIZE).keys()];
    shuffle(order);
    for (const x of order) {
        if (cols.has(x)) continue;
        const prev = queens[row - 1]?.pos[0];
        if (prev !== undefined && Math.abs(prev - x) <= 1) continue;
        const color = `#${Math.random().toString(16).substring(2, 8)}`;
        queens.push({ pos: [x, row], color });
        cols.add(x);
        if (placeQueens(row + 1, cols)) return true;
        queens.pop();
        cols.delete(x);
    }
    return false;
};

// Count solutions to a board, stopping as soon as we hit `limit` (so we can
// quickly tell "unique" from "ambiguous" without enumerating everything).
const countSolutions = (board, limit) => {
    let count = 0;
    const placed = [];
    const usedCols = new Set();
    const usedColors = new Set();
    const recur = (row) => {
        if (count >= limit) return;
        if (row === GRID_SIZE) {
            count++;
            return;
        }
        for (let x = 0; x < GRID_SIZE; x++) {
            if (usedCols.has(x)) continue;
            const color = board[row][x];
            if (!color || usedColors.has(color)) continue;
            const prev = placed[row - 1];
            if (prev !== undefined && Math.abs(prev - x) <= 1) continue;
            placed.push(x);
            usedCols.add(x);
            usedColors.add(color);
            recur(row + 1);
            placed.pop();
            usedCols.delete(x);
            usedColors.delete(color);
        }
    };
    recur(0);
    return count;
};

// === Fast generation path ============================================
// Avoids string allocations and array splicing by working with integer region
// IDs in a flat Int8Array, a typed-array queue with random-pop (O(1)), and
// bitmasks for the column/region "used" sets in the solution counter.
//
// The public 2D `grid` (color-string per cell) is only written once, at the
// end, after we've found a unique-solution layout — game logic that already
// reads `grid` doesn't need to change.

const N = GRID_SIZE;
const NN = N * N;
const regionGrid = new Int8Array(NN); // region id 0..N-1, or -1 for empty
const queenCols = new Int8Array(N); // queenCols[row] = column of queen
const usedColsBuf = new Uint8Array(N);
const fillQX = new Int16Array(NN * 4);
const fillQY = new Int16Array(NN * 4);
const fillQR = new Int8Array(NN * 4);

const fastPlaceQueens = () => {
    usedColsBuf.fill(0);
    const recur = (row) => {
        if (row === N) return true;
        // Fisher-Yates shuffle of [0..N-1] inline
        const order = [];
        for (let i = 0; i < N; i++) order.push(i);
        for (let i = N - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
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

const fastFloodFill = () => {
    regionGrid.fill(-1);
    let qLen = 0;
    for (let r = 0; r < N; r++) {
        const c = queenCols[r];
        regionGrid[r * N + c] = r;
        // seed 4-neighbors
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
        const idx = (Math.random() * qLen) | 0;
        const x = fillQX[idx],
            y = fillQY[idx],
            r = fillQR[idx];
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

// Count solutions on regionGrid up to `limit`, using bitmasks for used
// columns/regions. Returns 0, 1, or limit.
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
        for (let x = 0; x < N; x++) {
            const cbit = 1 << x;
            if (usedC & cbit) continue;
            if (prev !== -1 && x - prev <= 1 && prev - x <= 1) continue;
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
    return count;
};

// Project regionGrid → public color grid + queens array, with one random
// hex color per region.
const projectToPublic = () => {
    const colors = new Array(N);
    for (let i = 0; i < N; i++) {
        colors[i] = `#${Math.random().toString(16).substring(2, 8)}`;
    }
    queens.length = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            grid[y][x] = colors[regionGrid[y * N + x]];
        }
    }
    for (let row = 0; row < N; row++) {
        const c = queenCols[row];
        queens.push({ pos: [c, row], color: colors[regionGrid[row * N + c]] });
    }
};

// Reset everything and regenerate until we find a unique-solution board.
// Falls back gracefully after a hard cap and time budget so the page can't
// freeze on truly hostile parameters.
const reset = () => {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            marks[y][x] = null;
        }
    }
    const start = performance.now();
    const MAX_ATTEMPTS = 1_000_000;
    const TIME_BUDGET_MS = 3000;
    let attempts = 0;
    let found = false;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        if (!fastPlaceQueens()) continue;
        fastFloodFill();
        if (fastCount(2) === 1) {
            found = true;
            break;
        }
        // Cheap time check every 1024 attempts to avoid perf.now overhead.
        if (
            (attempts & 1023) === 0 &&
            performance.now() - start > TIME_BUDGET_MS
        ) {
            break;
        }
    }
    const elapsed = performance.now() - start;
    if (!found) {
        console.warn(
            `Gave up after ${attempts} attempts in ${elapsed.toFixed(0)}ms; ` +
                `using last (possibly ambiguous) board.`,
        );
    } else {
        console.log(
            `Found unique board in ${attempts} attempts (${elapsed.toFixed(0)}ms, ` +
                `${(attempts / (elapsed / 1000)).toFixed(0)}/sec).`,
        );
    }
    projectToPublic();
    document.getElementById("win")?.classList.remove("show");
};

reset();

// Backtracking solver. Places exactly one queen per row, ensuring no two queens
// share a column or color region, and no queen is diagonally adjacent to the
// queen in the previous row (row-by-row placement handles the same-row rule).
const solve = (board) => {
    const placed = []; // placed[y] = x of the queen on row y
    const usedCols = new Set();
    const usedColors = new Set();

    const place = (row) => {
        if (row === GRID_SIZE) return true;
        for (let x = 0; x < GRID_SIZE; x++) {
            if (usedCols.has(x)) continue;
            const color = board[row][x];
            if (!color || usedColors.has(color)) continue;
            // Reject if touching the previous row's queen diagonally.
            const prev = placed[row - 1];
            if (prev && Math.abs(prev - x) <= 1) continue;

            placed.push(x);
            usedCols.add(x);
            usedColors.add(color);
            if (place(row + 1)) return true;
            placed.pop();
            usedCols.delete(x);
            usedColors.delete(color);
        }
        return false;
    };

    return place(0) ? placed.map((x, y) => [x, y]) : null;
};
