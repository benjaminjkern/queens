// Encode/decode region grids to URL-safe base64, and compute a stable
// boardKey that depends only on region shape (not colors).
//
// Canonical layout: byte 0 = N, then 4 bits per cell in row-major order
// holding the *canonical* region id — region ids are renumbered 0..N-1 in
// the order regions are first encountered scanning row-major. This way the
// same shapes always produce the same encoding regardless of how the
// generator happened to label regions or pick colors.

// Renumber arbitrary region IDs in row-major first-encounter order so that
// equal region shapes always produce the same byte sequence — boardKey and
// the encoded URL string only depend on shape, not on how IDs were labeled.
const canonicalize = (cells, N) => {
    const map = new Map();
    const out = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
        const c = cells[i];
        let id = map.get(c);
        if (id === undefined) {
            id = map.size;
            map.set(c, id);
        }
        out[i] = id;
    }
    return out;
};

const colorsToCanonical = (grid) => {
    const N = grid.length;
    const flat = new Array(N * N);
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) flat[y * N + x] = grid[y][x];
    return canonicalize(flat, N);
};

const bytesToB64Url = (bytes) => {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64UrlToBytes = (s) => {
    let b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

// `grid` is a 2D color-string grid (the same shape generateUniqueBoard
// returns). Returns the URL-safe base64 string.
export const encodeBoard = (grid) => {
    const N = grid.length;
    const canonical = colorsToCanonical(grid);
    const nibbles = canonical.length;
    const packed = new Uint8Array(1 + Math.ceil(nibbles / 2));
    packed[0] = N;
    for (let i = 0; i < nibbles; i++) {
        const byteIdx = 1 + (i >> 1);
        if ((i & 1) === 0) packed[byteIdx] = canonical[i] << 4;
        else packed[byteIdx] |= canonical[i] & 0x0f;
    }
    return bytesToB64Url(packed);
};

// Returns { N, regionIds: Int8Array length N*N } where regionIds are the
// canonical 0..N-1 ids. Caller assigns colors.
export const decodeBoard = (s) => {
    const bytes = b64UrlToBytes(s);
    const N = bytes[0];
    if (!N || N > 15) throw new Error(`invalid encoded board (N=${N})`);
    const nibbles = N * N;
    const ids = new Int8Array(nibbles);
    for (let i = 0; i < nibbles; i++) {
        const byteIdx = 1 + (i >> 1);
        const b = bytes[byteIdx];
        ids[i] = (i & 1) === 0 ? (b >> 4) & 0x0f : b & 0x0f;
    }
    return { N, regionIds: ids };
};

// FNV-1a 64-bit over the canonical byte layout. Returns 16-hex-char string.
// Collision risk is negligible for personal-history use; this is not used
// as a security primitive.
const fnv1a64 = (bytes) => {
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let i = 0; i < bytes.length; i++) {
        h = (h ^ BigInt(bytes[i])) & mask;
        h = (h * prime) & mask;
    }
    return h.toString(16).padStart(16, "0");
};

// Stable identifier for a board's region shape, regardless of colors.
export const boardKey = (grid) => {
    const N = grid.length;
    const canonical = colorsToCanonical(grid);
    const packed = new Uint8Array(1 + canonical.length);
    packed[0] = N;
    packed.set(canonical, 1);
    return fnv1a64(packed);
};

// Hash a string of hex chars (the boardKey) down to a uint32 we can use to
// seed deterministic color generation. Same board → same colors, always.
const hexPrefixToUint32 = (hex) => {
    let h = 0;
    for (let i = 0; i < Math.min(hex.length, 8); i++) {
        h = (h * 16 + parseInt(hex[i], 16)) >>> 0;
    }
    return h >>> 0;
};

// mulberry32 inlined here to keep boardCodec self-contained.
const mulberry32 = (seed) => {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const hslToHex = (h, s, l) => {
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c =
            l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};

const hslToRgb = (h, s, l) => {
    const f = (n) => {
        const k = (n + h / 30) % 12;
        return (
            l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
        );
    };
    return [f(0) * 255, f(8) * 255, f(4) * 255];
};

// Perceptual-ish distance: weighted RGB euclidean (green weighted heaviest,
// matching eye sensitivity). Hue-based distance overrates the purple/pink
// zone; this tracks "do these look alike" much better.
const colorDist = (a, b) => {
    const dr = a.rgb[0] - b.rgb[0];
    const dg = a.rgb[1] - b.rgb[1];
    const db = a.rgb[2] - b.rgb[2];
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
};

// Assign one color per region, deterministically from the boardKey, such
// that (a) every color is light enough that the black ✗/👑 glyphs stay
// readable, and (b) regions that touch (incl. diagonally) get visually
// distinct colors.
//
// Method: build a palette of N evenly-spaced hues (random rotation +
// small jitter, lightness clamped to a bright band), then greedily hand
// palette entries to regions — most-constrained (highest-degree) region
// first, each picking the unused entry farthest from its already-colored
// neighbors. Everything is driven by the boardKey-seeded rng, so the same
// board always renders identically regardless of how it was loaded.
const colorsForRegions = (key, canonical, N) => {
    const rng = mulberry32(hexPrefixToUint32(key));

    const baseHue = rng() * 360;
    const jitter = (120 / N) * 0.5;
    const palette = new Array(N);
    for (let i = 0; i < N; i++) {
        const h =
            (baseHue + (360 * i) / N + (rng() * 2 - 1) * jitter + 360) % 360;
        const s = 0.55 + rng() * 0.3;
        const l = 0.68 + rng() * 0.14;
        palette[i] = { h, s, l, rgb: hslToRgb(h, s, l) };
    }

    // Region adjacency (8-adjacent cells count as touching — corner-touching
    // regions still read as side-by-side).
    const neighbors = Array.from({ length: N }, () => new Set());
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const a = canonical[y * N + x];
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= N || ny >= N) continue;
                const b = canonical[ny * N + nx];
                if (a !== b) {
                    neighbors[a].add(b);
                    neighbors[b].add(a);
                }
            }
        }
    }

    // Highest-degree regions choose first, while the palette is still full.
    const order = Array.from({ length: N }, (_, i) => i).sort(
        (a, b) => neighbors[b].size - neighbors[a].size || a - b,
    );
    const assigned = new Array(N).fill(-1);
    const used = new Array(N).fill(false);
    for (const region of order) {
        let best = -1;
        let bestScore = -1;
        for (let p = 0; p < N; p++) {
            if (used[p]) continue;
            let score = Infinity;
            for (const nb of neighbors[region]) {
                if (assigned[nb] < 0) continue;
                score = Math.min(score, colorDist(palette[p], palette[assigned[nb]]));
            }
            if (score === Infinity) score = 1000 + rng(); // no colored neighbor yet
            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }
        assigned[region] = best;
        used[best] = true;
    }

    // Greedy can still strand a late region next to a look-alike (it picks
    // from palette leftovers). Hill-climb: while some touching pair is the
    // weakest link, try swapping any two regions' palette entries and keep
    // the swap that raises the overall worst-pair distance. N ≤ 15, so this
    // is at most a few hundred cheap evaluations. Fully deterministic.
    const pairs = [];
    for (let a = 0; a < N; a++)
        for (const b of neighbors[a]) if (a < b) pairs.push([a, b]);
    const worstDist = () => {
        let m = Infinity;
        for (const [a, b] of pairs)
            m = Math.min(m, colorDist(palette[assigned[a]], palette[assigned[b]]));
        return m;
    };
    for (let iter = 0; iter < 50; iter++) {
        const base = worstDist();
        let bestGain = base;
        let bestSwap = null;
        for (let a = 0; a < N; a++) {
            for (let b = a + 1; b < N; b++) {
                [assigned[a], assigned[b]] = [assigned[b], assigned[a]];
                const d = worstDist();
                [assigned[a], assigned[b]] = [assigned[b], assigned[a]];
                if (d > bestGain) {
                    bestGain = d;
                    bestSwap = [a, b];
                }
            }
        }
        if (!bestSwap) break;
        const [a, b] = bestSwap;
        [assigned[a], assigned[b]] = [assigned[b], assigned[a]];
    }

    return assigned.map((p) => hslToHex(palette[p].h, palette[p].s, palette[p].l));
};

// Build a 2D color-string grid from any int region-id grid (canonical or
// not). Colors are deterministic from the board's identity.
export const regionIdsToColorGrid = (regionIds, N) => {
    const canonical = canonicalize(regionIds, N);
    const packed = new Uint8Array(1 + canonical.length);
    packed[0] = N;
    packed.set(canonical, 1);
    const key = fnv1a64(packed);
    const colors = colorsForRegions(key, canonical, N);
    const grid = Array.from({ length: N }, () => new Array(N));
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            grid[y][x] = colors[canonical[y * N + x]];
        }
    }
    return grid;
};
