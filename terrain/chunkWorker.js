// Baut im Hintergrund die Geometrie einer Kachel:
// - Stufen-Gelände (deckend): flache Ebenen bis zur nächsten Höhenlinie, senkrechte Wände,
//   Schürze am Kachelrand gegen Spalten zwischen Detailstufen
// - glattes, echtes Höhenfeld (Wasser/Senken flach auf Höhe 0) – nur für den Radar-Ping
// - Höhenlinien per Marching-Triangles auf denselben Dreiecken
// height.js mit derselben Versionsnummer wie der Worker laden (Cache-Busting, siehe index.html)
const heightModule = import(`./height.js${self.location.search}`);
let terrainHeight, CONTOUR_STEP, setSeed;

const SKIRT_DEPTH = 60;
const LINE_LIFT = 0.6;   // Linien knapp über der Fläche, damit sie nicht flimmern

// Handler sofort setzen, damit keine Nachricht verloren geht; gerechnet wird nach dem Laden
self.onmessage = async (event) => {
    ({ terrainHeight, CONTOUR_STEP, setSeed } = await heightModule);
    const { id, originX, originZ, size, cells, contourStyle, seed } = event.data;
    setSeed(seed);
    const result = buildChunk(originX, originZ, size, cells, contourStyle);
    self.postMessage({ id, ...result }, Object.values(result).map((array) => array.buffer));
};

function buildChunk(originX, originZ, size, cells, contourStyle) {
    const cell = size / cells;
    const stride = cells + 1;

    // Höhen mit einem Rand von 1 Zelle, damit die Normalen auch am Kachelrand stimmen
    const outer = cells + 3;
    const heights = new Float32Array(outer * outer);
    for (let z = -1; z <= cells + 1; z++) {
        for (let x = -1; x <= cells + 1; x++) {
            heights[(z + 1) * outer + (x + 1)] = terrainHeight(originX + x * cell, originZ + z * cell);
        }
    }
    const heightAt = (x, z) => heights[(z + 1) * outer + (x + 1)];
    const surfaceAt = (x, z) => Math.max(heightAt(x, z), 0);

    const positions = [];
    const normals = [];
    const rawHeights = [];
    const indices = [];

    for (let z = 0; z <= cells; z++) {
        for (let x = 0; x <= cells; x++) {
            positions.push(x * cell, surfaceAt(x, z), z * cell);
            const nx = surfaceAt(x - 1, z) - surfaceAt(x + 1, z);
            const nz = surfaceAt(x, z - 1) - surfaceAt(x, z + 1);
            const ny = 2 * cell;
            const len = Math.hypot(nx, ny, nz);
            normals.push(nx / len, ny / len, nz / len);
            rawHeights.push(heightAt(x, z));
        }
    }

    for (let z = 0; z < cells; z++) {
        for (let x = 0; x < cells; x++) {
            const a = z * stride + x;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    // ---------------------------------------------------------------------------
    // Stufen-Gelände: jedes Dreieck des Gitters an den Höhenlinien schneiden.
    // Bereich zwischen zwei Höhenlinien = flache Ebene auf der unteren Höhe, an der Linie eine
    // senkrechte Wand bis zur nächsten Ebene. Rohhöhe (für Seen / Bodennebel) wird mitgeführt.
    // ---------------------------------------------------------------------------
    const terracePositions = [];
    const terraceHeights = [];
    const stepLevel = (s) => Math.floor(s / CONTOUR_STEP) * CONTOUR_STEP;
    const pushTerrace = (x, y, z, raw) => {
        terracePositions.push(x, y, z);
        terraceHeights.push(raw);
    };
    const flat = (p, q, r, y) => {
        pushTerrace(p.x, y, p.z, p.h);
        pushTerrace(q.x, y, q.z, q.h);
        pushTerrace(r.x, y, r.z, r.h);
    };
    const wall = (p, q, top, bottom) => {
        pushTerrace(p.x, bottom, p.z, bottom);
        pushTerrace(q.x, bottom, q.z, bottom);
        pushTerrace(q.x, top, q.z, top);
        pushTerrace(p.x, bottom, p.z, bottom);
        pushTerrace(q.x, top, q.z, top);
        pushTerrace(p.x, top, p.z, top);
    };
    // Schnittpunkt auf der Kante u -> v, an dem die sichtbare Höhe s die Stufe erreicht
    const cutSurface = (u, v, level) => {
        const t = (level - u.s) / (v.s - u.s);
        return { x: u.x + (v.x - u.x) * t, z: u.z + (v.z - u.z) * t, s: level, h: u.h + (v.h - u.h) * t };
    };
    const terraceTriangle = (A, B, C) => {
        const sMin = Math.min(A.s, B.s, C.s);
        const sMax = Math.max(A.s, B.s, C.s);
        const base = stepLevel(sMin);
        flat(A, B, C, base);
        for (let level = base + CONTOUR_STEP; level < sMax; level += CONTOUR_STEP) {
            const above = [], below = [];
            for (const p of [A, B, C]) (p.s >= level ? above : below).push(p);
            if (above.length === 3) {
                flat(A, B, C, level);
            } else if (above.length === 1) {
                const e1 = cutSurface(above[0], below[0], level);
                const e2 = cutSurface(above[0], below[1], level);
                flat(above[0], e1, e2, level);
                wall(e1, e2, level, level - CONTOUR_STEP);
            } else if (above.length === 2) {
                const e1 = cutSurface(above[0], below[0], level);
                const e2 = cutSurface(above[1], below[0], level);
                flat(above[0], above[1], e2, level);
                flat(above[0], e2, e1, level);
                wall(e1, e2, level, level - CONTOUR_STEP);
            }
        }
    };
    const terraceVertex = (x, z) => ({ x: x * cell, z: z * cell, s: surfaceAt(x, z), h: heightAt(x, z) });
    for (let z = 0; z < cells; z++) {
        for (let x = 0; x < cells; x++) {
            const a = terraceVertex(x, z), b = terraceVertex(x + 1, z);
            const c = terraceVertex(x, z + 1), d = terraceVertex(x + 1, z + 1);
            terraceTriangle(a, c, b);
            terraceTriangle(b, c, d);
        }
    }

    // Schürzen am Kachelrand: folgen dem Stufenprofil der Kante nach unten
    const skirtEdge = (u, v) => {
        const ts = [0, 1];
        const lo = Math.min(u.s, v.s), hi = Math.max(u.s, v.s);
        for (let level = stepLevel(lo) + CONTOUR_STEP; level < hi; level += CONTOUR_STEP) {
            ts.push((level - u.s) / (v.s - u.s));
        }
        ts.sort((m, n) => m - n);
        for (let i = 0; i < ts.length - 1; i++) {
            const t0 = ts[i], t1 = ts[i + 1];
            if (t1 - t0 < 1e-6) continue;
            const y = stepLevel(u.s + (v.s - u.s) * (t0 + t1) / 2);
            const p = { x: u.x + (v.x - u.x) * t0, z: u.z + (v.z - u.z) * t0 };
            const q = { x: u.x + (v.x - u.x) * t1, z: u.z + (v.z - u.z) * t1 };
            wall(p, q, y, y - SKIRT_DEPTH);
        }
    };
    for (let i = 0; i < cells; i++) {
        skirtEdge(terraceVertex(i, 0), terraceVertex(i + 1, 0));
        skirtEdge(terraceVertex(i, cells), terraceVertex(i + 1, cells));
        skirtEdge(terraceVertex(0, i), terraceVertex(0, i + 1));
        skirtEdge(terraceVertex(cells, i), terraceVertex(cells, i + 1));
    }

    // Höhenlinien
    const linePositions = [];
    const lineLevels = [];
    const dotCenters = [];
    const dotCorners = [];
    const dotLevels = [];
    const dotIndices = [];
    const dotSpacing = cell * 1.5;

    const pushDot = (x, y, z, level) => {
        const base = dotCenters.length / 3;
        for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            dotCenters.push(x, y, z);
            dotCorners.push(cx, cy);
            dotLevels.push(level);
        }
        dotIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const contour = (p, q, level) => {
        const y = level + LINE_LIFT;
        // Küstenlinie (Höhe 0) immer durchgehend, sonst je nach Stil Linie oder Punkte
        if (contourStyle !== 'dots' || level === 0) {
            linePositions.push(p.x, y, p.z, q.x, y, q.z);
            lineLevels.push(level, level);
            return;
        }
        const dx = q.x - p.x, dz = q.z - p.z;
        const alongX = Math.abs(dx) >= Math.abs(dz);
        const from = alongX ? Math.min(p.x, q.x) : Math.min(p.z, q.z);
        const to = alongX ? Math.max(p.x, q.x) : Math.max(p.z, q.z);
        for (let k = Math.ceil(from / dotSpacing); k * dotSpacing < to; k++) {
            const t = alongX ? (k * dotSpacing - p.x) / dx : (k * dotSpacing - p.z) / dz;
            pushDot(p.x + dx * t, y, p.z + dz * t, level);
        }
    };

    const cut = (u, v, level) => {
        const t = (level - u.h) / (v.h - u.h);
        return { x: u.x + (v.x - u.x) * t, z: u.z + (v.z - u.z) * t };
    };

    // Marching-Triangles: pro Stufe schneidet die Linie genau zwei Dreieckskanten
    const contourTriangle = (A, B, C) => {
        const hMin = Math.min(A.h, B.h, C.h);
        const hMax = Math.max(A.h, B.h, C.h);
        for (let level = Math.max(0, Math.ceil(hMin / CONTOUR_STEP) * CONTOUR_STEP); level < hMax; level += CONTOUR_STEP) {
            const above = [], below = [];
            for (const p of [A, B, C]) (p.h >= level ? above : below).push(p);
            if (above.length === 1) {
                contour(cut(above[0], below[0], level), cut(above[0], below[1], level), level);
            } else if (above.length === 2) {
                contour(cut(above[0], below[0], level), cut(above[1], below[0], level), level);
            }
        }
    };

    const vertex = (x, z) => ({ x: x * cell, z: z * cell, h: heightAt(x, z) });
    for (let z = 0; z < cells; z++) {
        for (let x = 0; x < cells; x++) {
            const a = vertex(x, z), b = vertex(x + 1, z), c = vertex(x, z + 1), d = vertex(x + 1, z + 1);
            contourTriangle(a, c, b);
            contourTriangle(b, c, d);
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        heights: new Float32Array(rawHeights),
        indices: new Uint32Array(indices),
        terracePositions: new Float32Array(terracePositions),
        terraceHeights: new Float32Array(terraceHeights),
        linePositions: new Float32Array(linePositions),
        lineLevels: new Float32Array(lineLevels),
        dotCenters: new Float32Array(dotCenters),
        dotCorners: new Float32Array(dotCorners),
        dotLevels: new Float32Array(dotLevels),
        dotIndices: new Uint32Array(dotIndices)
    };
}
