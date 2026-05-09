import { generateUniqueBoard } from "./generation.js";

let canvas, ctx;

// Timer: starts on the first click of a new game, can be paused, stops on win.
let timerStart = null; // performance.now() - elapsedSoFar; null when stopped
let timerInterval = null;
let pausedElapsed = null; // ms when the timer was paused, or null
const renderTimer = () => {
    const elapsed =
        pausedElapsed !== null
            ? pausedElapsed
            : timerStart !== null
              ? performance.now() - timerStart
              : 0;
    const s = Math.floor(elapsed / 1000);
    document.getElementById("timer").textContent =
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const startTimer = () => {
    if (timerStart !== null || pausedElapsed !== null) return;
    timerStart = performance.now();
    timerInterval = setInterval(renderTimer, 250);
};
const stopTimer = () => {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
};
const pauseTimer = () => {
    if (timerStart === null) return;
    pausedElapsed = performance.now() - timerStart;
    stopTimer();
    timerStart = null;
};
const resumeTimer = () => {
    if (pausedElapsed === null) return;
    timerStart = performance.now() - pausedElapsed;
    pausedElapsed = null;
    timerInterval = setInterval(renderTimer, 250);
};
const resetTimer = () => {
    stopTimer();
    timerStart = null;
    pausedElapsed = null;
    renderTimer();
};

let GRID_SIZE = 10;
const SQUARE_SIZE = 50;
// Coarse pointer ⇒ touch device. Used to switch tap behavior on mobile, since
// there's no right-click: a tap cycles empty → x → queen → empty.
const isMobile = window.matchMedia("(pointer: coarse)").matches;
const MIN_SIZE = 4;
const MAX_SIZE = 15;

const makeGrid = (N, value) =>
    Array(N)
        .fill()
        .map(() => Array(N).fill(value));

// Player-placed marks ("queen" or "x"), separate from the colored board itself.
let marks = makeGrid(GRID_SIZE, null);

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
    startTimer();
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
    stopTimer();
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

    // Populate the size dropdown.
    const sizeSelect = document.getElementById("size");
    for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
        const opt = document.createElement("option");
        opt.value = String(n);
        opt.textContent = `${n}×${n}`;
        if (n === GRID_SIZE) opt.selected = true;
        sizeSelect.appendChild(opt);
    }
    sizeSelect.addEventListener("change", () => {
        setBoardSize(parseInt(sizeSelect.value, 10));
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("mousedown", (e) => {
        if (isPaused) return;
        // On mobile, tap cycles empty → x → queen → empty in one button.
        if (isMobile && e.button === 0) {
            const cell = eventCell(e);
            if (!cell) return;
            startTimer();
            const [x, y] = cell;
            const m = marks[y][x];
            if (m === null) marks[y][x] = "x";
            else if (m === "x" || m === "ax") {
                marks[y][x] = null;
                addQueen(x, y);
            } else removeQueen(x, y);
            draw();
            checkWin();
            return;
        }
        // Ctrl/Cmd + left mousedown is treated identically to right mousedown
        // (trackpad-friendly): starts an x-paint drag based on the start cell.
        const isXAction =
            e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey));
        if (isXAction) {
            const cell = eventCell(e);
            if (!cell) return;
            startTimer();
            rightDragging = true;
            const m = marks[cell[1]][cell[0]];
            rightDragValue = m === "x" || m === "ax" ? null : "x";
            applyRightDrag(cell);
            return;
        }
        if (e.button === 0) handleLeftClick(e);
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!rightDragging || isPaused) return;
        const cell = eventCell(e);
        if (!cell) return;
        applyRightDrag(cell);
    });

    const endRightDrag = () => {
        rightDragging = false;
    };
    canvas.addEventListener("mouseup", endRightDrag);
    canvas.addEventListener("mouseleave", endRightDrag);

    document.getElementById("restart").addEventListener("click", reset);
    document.getElementById("newGame").addEventListener("click", reset);
    document.getElementById("pause").addEventListener("click", () => {
        if (isPaused) resumeGame();
        else pauseGame();
    });
    document.getElementById("resume").addEventListener("click", resumeGame);

    reset();
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

// The board itself: grid[y][x] holds the region color of that cell, or null.
let grid = makeGrid(GRID_SIZE, null);

// Yield twice via rAF so the browser actually paints any overlays we just
// toggled before we block the main thread on generation.
const yieldToBrowser = () =>
    new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

// Generate a fresh board at the current GRID_SIZE and reset marks/timer.
// Shows a loading spinner while the (synchronous) generator runs, then
// redraws the board.
const reset = async () => {
    document.getElementById("win")?.classList.remove("show");
    document.getElementById("loadingOverlay")?.classList.add("show");
    resumePauseUI(false);
    resetTimer();
    await yieldToBrowser();

    marks = makeGrid(GRID_SIZE, null);
    const { grid: newGrid, stats } = generateUniqueBoard(GRID_SIZE);
    grid = newGrid;
    const msg =
        `${stats.attempts} attempts (${stats.reshapes} reshapes) ` +
        `in ${stats.elapsedMs.toFixed(0)}ms`;
    if (stats.found) console.log(`Unique board in ${msg}.`);
    else console.warn(`Gave up after ${msg} — board may be ambiguous.`);

    document.getElementById("loadingOverlay")?.classList.remove("show");
    if (ctx) draw();
};

// Apply a new board size: resize the canvas, regenerate, reset.
const setBoardSize = async (n) => {
    GRID_SIZE = Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
    if (canvas) {
        canvas.width = GRID_SIZE * SQUARE_SIZE;
        canvas.height = GRID_SIZE * SQUARE_SIZE;
    }
    await reset();
};

// Pause overlay covers the canvas (so the board isn't visible) and pauses
// the timer. Resuming reveals the board and continues from where the timer
// left off.
let isPaused = false;
const pauseGame = () => {
    if (isPaused) return;
    isPaused = true;
    pauseTimer();
    document.getElementById("pauseOverlay").classList.add("show");
};
const resumePauseUI = (paused) => {
    isPaused = paused;
    const ov = document.getElementById("pauseOverlay");
    if (paused) ov?.classList.add("show");
    else ov?.classList.remove("show");
};
const resumeGame = () => {
    if (!isPaused) return;
    resumePauseUI(false);
    resumeTimer();
};
