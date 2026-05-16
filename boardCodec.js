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

// N region colors derived deterministically from the boardKey so identical
// boards always render identically regardless of how they were loaded.
export const colorsFromKey = (boardKey, N) => {
    const rng = mulberry32(hexPrefixToUint32(boardKey));
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
        out[i] = `#${Math.floor(rng() * 0x1000000)
            .toString(16)
            .padStart(6, "0")}`;
    }
    return out;
};

// Build a 2D color-string grid from any int region-id grid (canonical or
// not). Colors are deterministic from the board's identity.
export const regionIdsToColorGrid = (regionIds, N) => {
    const canonical = canonicalize(regionIds, N);
    const packed = new Uint8Array(1 + canonical.length);
    packed[0] = N;
    packed.set(canonical, 1);
    const key = fnv1a64(packed);
    const colors = colorsFromKey(key, N);
    const grid = Array.from({ length: N }, () => new Array(N));
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            grid[y][x] = colors[canonical[y * N + x]];
        }
    }
    return grid;
};
