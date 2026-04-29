let canvas, ctx;

const GRID_SIZE = 15;
const SQUARE_SIZE = 50;

// Player-placed marks ("queen" or "x"), separate from the colored board itself.
const marks = Array(GRID_SIZE)
    .fill()
    .map(() => Array(GRID_SIZE).fill(null));

// Translate a mouse event into a grid cell, then toggle the given mark there.
// Clicking a cell that already has the same mark clears it.
const handleClick = (e, mark) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_SIZE);
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    marks[y][x] = marks[y][x] === mark ? null : mark;
    draw();
};

window.onload = () => {
    canvas = document.getElementById("canvas");
    canvas.width = GRID_SIZE * SQUARE_SIZE;
    canvas.height = GRID_SIZE * SQUARE_SIZE;
    ctx = canvas.getContext("2d");

    // Left click → queen, right click → x (contextmenu is suppressed in handleClick).
    canvas.addEventListener("click", (e) => handleClick(e, "queen"));
    canvas.addEventListener("contextmenu", (e) => handleClick(e, "x"));

    loop();
};
window.onresize = window.onload;

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

// Candidate cells for queen placement, in randomized order (shuffled below).
const queenQueue = [];

for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
        queenQueue.push([x, y]);
    }
}

const shuffle = (list) => {
    for (let i = 0; i < list.length; i++) {
        const r = Math.floor(Math.random() * list.length);
        [list[i], list[r]] = [list[r], list[i]];
    }
};

shuffle(queenQueue);

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

placeQueens(0, new Set());

// Seed each queen's color into the grid and queue its neighbors for flood-fill.
for (const {
    pos: [nx, ny],
    color,
} of queens) {
    grid[ny][nx] = color;
    queue.push(...getNeighbors(nx, ny).map((pos) => ({ pos, color })));
}

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
