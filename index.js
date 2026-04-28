let canvas, ctx;

const GRID_SIZE = 10;
const SQUARE_SIZE = 50;

window.onload = () => {
    canvas = document.getElementById("canvas");
    canvas.width = GRID_SIZE * SQUARE_SIZE;
    canvas.height = GRID_SIZE * SQUARE_SIZE;
    ctx = canvas.getContext("2d");

    loop();
};
window.onresize = window.onload;

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
        }
    }
};

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

const grid = Array(GRID_SIZE)
    .fill()
    .map(() =>
        Array(GRID_SIZE)
            .fill()
            .map(() => null),
    );

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

const queens = [];

const queue = [];

const getNeighbors = (x, y) => {
    const neighbors = [];

    if (y > 0) neighbors.push([x, y - 1]);
    if (y < GRID_SIZE - 1) neighbors.push([x, y + 1]);
    if (x > 0) neighbors.push([x - 1, y]);
    if (x < GRID_SIZE - 1) neighbors.push([x + 1, y]);
    return neighbors;
};

outer: while (queens.length < GRID_SIZE) {
    const [nx, ny] = queenQueue.pop();
    for (const {
        pos: [qx, qy],
    } of queens) {
        if (
            nx === qx ||
            ny === qy ||
            (Math.abs(nx - qx) <= 1 && Math.abs(ny - qy) <= 1)
        )
            continue outer;
    }
    const color = `#${Math.random().toString(16).substring(2, 8)}`;
    queens.push({
        pos: [nx, ny],
        color,
    });

    grid[ny][nx] = color;

    queue.push(...getNeighbors(nx, ny).map((pos) => ({ pos, color })));
}

const solve = (board) => {
    const { grid, queens };
};
