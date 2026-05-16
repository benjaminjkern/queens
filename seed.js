// Seeded PRNG used by the generator (for deterministic tests and a fast
// default rng). Seeds are not user-visible — share URLs encode the board
// itself (#b=...) so loading is instant and immune to generator changes.

// mulberry32: tiny, fast, decent distribution. State fits in one uint32.
export const mulberry32 = (seed) => {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export const randomSeed = () => {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.getRandomValues === "function"
    ) {
        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        return arr[0];
    }
    return (Math.random() * 0x100000000) >>> 0;
};

// Read/write only the `#b=` board param. Anything else in the hash is
// ignored (and silently stripped on write).
export const readBoardHash = (hash = location.hash) => {
    if (!hash || hash.length < 2) return null;
    return new URLSearchParams(hash.slice(1)).get("b");
};

export const writeBoardHash = (encoded) => {
    const next = encoded ? `#b=${encoded}` : "";
    if (typeof history !== "undefined" && history.replaceState) {
        history.replaceState(
            null,
            "",
            location.pathname + location.search + next,
        );
    } else if (typeof location !== "undefined") {
        location.hash = next;
    }
};
