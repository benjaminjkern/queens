// Persistent store for completion times and replay history.
//
// All methods are async so a future remote backend can be slotted in without
// touching UI code. Today every call routes through `localBackend` (a thin
// JSON-in-localStorage adapter).
//
// Schema (localStorage key `queens.scores.v1`):
//   {
//     v: 1,
//     boards: {
//       [boardKey]: {
//         size: number,
//         encoded: string,             // base64 region grid, for replay
//         times: [{ ts: number (epoch ms), ms: number }, ...]
//       }
//     },
//     history: [boardKey, ...]   // MRU, capped at HISTORY_LIMIT
//   }

const STORAGE_KEY = "queens.scores.v1";
const HISTORY_LIMIT = 50;

const emptyState = () => ({ v: 1, boards: {}, history: [] });

const safeParse = (raw) => {
    if (!raw) return emptyState();
    try {
        const s = JSON.parse(raw);
        if (!s || typeof s !== "object") return emptyState();
        if (!s.boards || typeof s.boards !== "object") s.boards = {};
        if (!Array.isArray(s.history)) s.history = [];
        return s;
    } catch {
        return emptyState();
    }
};

const localBackend = {
    read: () => {
        if (typeof localStorage === "undefined") return emptyState();
        return safeParse(localStorage.getItem(STORAGE_KEY));
    },
    write: (state) => {
        if (typeof localStorage === "undefined") return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // Quota exceeded or storage disabled — silently ignore. Times
            // for the current session still work via in-memory state held
            // by the UI.
        }
    },
};

let backend = localBackend;

// Swap in a different backend (e.g. a remote one) at runtime. Must expose
// the same { read(), write(state) } shape, sync or async.
export const setBackend = (next) => {
    backend = next;
};

const readState = async () => await backend.read();
const writeState = async (state) => await backend.write(state);

export const recordCompletion = async ({ boardKey, size, encoded, ms }) => {
    const state = await readState();
    const entry = state.boards[boardKey] ?? { size, encoded, times: [] };
    const prevBest = entry.times.reduce(
        (best, t) => (best === null || t.ms < best ? t.ms : best),
        null,
    );
    entry.size = size;
    if (encoded) entry.encoded = encoded;
    entry.times.push({ ts: Date.now(), ms });
    state.boards[boardKey] = entry;
    // Bump to front of history.
    state.history = [boardKey, ...state.history.filter((k) => k !== boardKey)];
    if (state.history.length > HISTORY_LIMIT) {
        state.history.length = HISTORY_LIMIT;
    }
    await writeState(state);
    return { personalBest: prevBest === null || ms < prevBest };
};

export const getTimesForBoard = async (boardKey) => {
    const state = await readState();
    const entry = state.boards[boardKey];
    if (!entry) return { times: [], best: null };
    const best = entry.times.reduce(
        (b, t) => (b === null || t.ms < b ? t.ms : b),
        null,
    );
    return { times: entry.times, best };
};

export const getRecentBoards = async () => {
    const state = await readState();
    return state.history
        .map((k) => {
            const e = state.boards[k];
            if (!e) return null;
            const lastPlayed = e.times.length
                ? e.times[e.times.length - 1].ts
                : 0;
            const bestMs = e.times.reduce(
                (b, t) => (b === null || t.ms < b ? t.ms : b),
                null,
            );
            return {
                boardKey: k,
                size: e.size,
                encoded: e.encoded,
                lastPlayed,
                bestMs,
                playCount: e.times.length,
            };
        })
        .filter(Boolean);
};

export const addToHistory = async ({ boardKey, size, encoded }) => {
    const state = await readState();
    if (!state.boards[boardKey]) {
        state.boards[boardKey] = { size, encoded, times: [] };
    } else if (encoded && !state.boards[boardKey].encoded) {
        state.boards[boardKey].encoded = encoded;
    }
    state.history = [boardKey, ...state.history.filter((k) => k !== boardKey)];
    if (state.history.length > HISTORY_LIMIT) {
        state.history.length = HISTORY_LIMIT;
    }
    await writeState(state);
};
