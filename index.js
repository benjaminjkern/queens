let canvas, ctx;

const GRID_SIZE = 5;
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

// Left click on a cell toggles a queen there (clicking the same cell clears it).
const handleLeftClick = (e) => {
    const cell = eventCell(e);
    if (!cell) return;
    const [x, y] = cell;
    marks[y][x] = marks[y][x] === "queen" ? null : "queen";
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
        rightDragValue = marks[cell[1]][cell[0]] === "x" ? null : "x";
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

// Reset all state and generate a fresh board.
const reset = () => {
    queens.length = 0;
    queue.length = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            grid[y][x] = null;
            marks[y][x] = null;
        }
    }
    placeQueens(0, new Set());
    for (const {
        pos: [nx, ny],
        color,
    } of queens) {
        grid[ny][nx] = color;
        queue.push(...getNeighbors(nx, ny).map((pos) => ({ pos, color })));
    }
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
