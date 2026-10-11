// Höhenfunktion der Landschaft (reines JS, ohne three.js -> auch im Web Worker nutzbar)

export const CONTOUR_STEP = 40;   // Abstand der Höhenlinien (Meter)

const LATTICE = 256;              // Periode des Noise-Gitters
const RIDGE_ROUNDING = 0.1;       // rundet die Grate leicht ab

const fract = (v) => v - Math.floor(v);
const wrap = (i) => i - Math.floor(i / LATTICE) * LATTICE;
const smoothstep = (e0, e1, x) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
};

function hash12(x, y) {
    let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(x * 0.1031);
    const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
    px += d; py += d; pz += d;
    return fract((px + py) * pz);
}

function valueNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash12(wrap(ix), wrap(iy));
    const b = hash12(wrap(ix + 1), wrap(iy));
    const c = hash12(wrap(ix), wrap(iy + 1));
    const d = hash12(wrap(ix + 1), wrap(iy + 1));
    const top = a + (b - a) * ux;
    const bottom = c + (d - c) * ux;
    return top + (bottom - top) * uy;
}

function fbm(x, y, octaves) {
    let sum = 0, amp = 0.5;
    for (let o = 0; o < octaves; o++) {
        sum += valueNoise(x, y) * amp;
        [x, y] = [(0.8 * x - 0.6 * y) * 2 + 17.3, (0.6 * x + 0.8 * y) * 2 + 9.1];
        amp *= 0.5;
    }
    return sum;
}

function ridged(x, y, octaves) {
    let sum = 0, amp = 0.5, prev = 1;
    for (let o = 0; o < octaves; o++) {
        const v = valueNoise(x, y) * 2 - 1;
        let n = 1 + RIDGE_ROUNDING - Math.sqrt(v * v + RIDGE_ROUNDING ** 2);
        n *= n;
        sum += n * prev * amp;
        prev = n;
        [x, y] = [(0.8 * x - 0.6 * y) * 2 + 17.3, (0.6 * x + 0.8 * y) * 2 + 9.1];
        amp *= 0.5;
    }
    return sum;
}

export const MAX_HEIGHT = 900;      // Gelände wird weich auf diese Höhe begrenzt
const HILL_HEIGHT = 170;          // Höhe der normalen Hügel (≈ 4 Höhenlinien)
const RIVER_WIDTH = 0.012;          // Breite des Flussbetts (in Noise-Einheiten)
const RIVER_VALLEY = 0.05;          // Breite des Tals um den Fluss
const RIVER_BED = -8;               // Flussbett liegt unter dem Wasserspiegel

// Weiche Obergrenze: bis 650 m unverändert, darüber asymptotisch gegen MAX_HEIGHT
function softCap(h) {
    const knee = MAX_HEIGHT - 250;
    if (h <= knee) return h;
    return knee + 250 * (1 - Math.exp(-(h - knee) / 250));
}

// ---------------------------------------------------------------------------
// Begrenzte Karte (Insel) und Seed
// ---------------------------------------------------------------------------
export const MAP_RADIUS = 24000;    // Radius der Insel (Meter), außerhalb nur Meer
const MAP_FADE = 3500;              // Breite des Übergangs zur Küste
const SEA_FLOOR = -40;              // Meeresgrund außerhalb der Insel

let seedOffsetX = 0;
let seedOffsetZ = 0;
let currentSeed = 0;

// Deterministischer Zufall aus einer Zahl (mulberry32)
export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Seed verschiebt das gesamte Rauschfeld -> jede Seed-Nummer ergibt eine andere Insel
export function setSeed(seed) {
    if (seed === currentSeed) return;
    currentSeed = seed;
    const random = seededRandom(seed);
    seedOffsetX = (random() - 0.5) * 400000;
    seedOffsetZ = (random() - 0.5) * 400000;
}

// Kontinuierliche Höhe in Metern (x/z = Weltkoordinaten, Inselmitte bei 0/0)
export function terrainHeight(x, z) {
    const distance = Math.hypot(x, z);
    if (distance >= MAP_RADIUS) return SEA_FLOOR;
    const island = 1 - smoothstep(MAP_RADIUS - MAP_FADE, MAP_RADIUS, distance);
    return SEA_FLOOR + (landscapeHeight(x + seedOffsetX, z + seedOffsetZ) - SEA_FLOOR) * island;
}

// Unbegrenzte Landschaft (ohne Insel-Begrenzung)
function landscapeHeight(x, z) {
    // Überwiegend Land, nur selten Seen / Meer
    const continent = (fbm(x / 2600, z / 2600, 4) - 0.27) * 2.2;
    const land = smoothstep(-0.1, 0.5, continent);

    // Hügelland: sanfte, runde Hügel bis ca. 4 Höhenlinien (≈ 160 m)
    const hillNoise = fbm(x / 1100 + 2.9, z / 1100 - 8.2, 3);
    const hills = smoothstep(0.3, 0.75, hillNoise) * HILL_HEIGHT;
    const detail = fbm(x / 90 + 31.7, z / 90 - 12.4, 3) - 0.44;

    // Hohe, steile Gipfel nur sehr selten: in kleinen, seltenen Bergregionen
    const mountainRegion = smoothstep(0.6, 0.72, fbm(x / 7000 - 11.3, z / 7000 + 4.1, 3));
    const mountains = mountainRegion > 0 ? ridged(x / 1400 + 5.2, z / 1400 - 3.7, 3) : 0;

    let h = continent * 50
        + hills * land
        + mountains * mountains * mountainRegion * land * 750
        + detail * 4 * (land + 0.3);

    // Flüsse: Nulllinie eines großräumigen Noise-Felds ergibt gewundene Linien.
    // Nur in einzelnen Regionen (selten) und nicht im Hochgebirge.
    const riverRegion = smoothstep(0.55, 0.62, fbm(x / 9000 + 21.7, z / 9000 - 6.3, 2));
    if (riverRegion > 0 && h > RIVER_BED) {
        const r = Math.abs(fbm(x / 3000 - 3.3, z / 3000 + 7.7, 3) * 2 - 0.88);
        const lowland = 1 - smoothstep(150, 400, h);
        const valley = (1 - smoothstep(RIVER_WIDTH, RIVER_VALLEY, r)) * riverRegion * lowland;
        const bed = 1 - smoothstep(RIVER_WIDTH * 0.6, RIVER_WIDTH, r);
        h = h + (Math.min(h, 25) - h) * valley * 0.85;     // Tal absenken
        h = h + (RIVER_BED - h) * bed * riverRegion * lowland; // Flussbett
    }

    return softCap(h);
}

// Sichtbare Oberfläche: Senken/Wasser liegen flach auf Höhe 0
export function surfaceHeight(x, z) {
    return Math.max(terrainHeight(x, z), 0);
}
