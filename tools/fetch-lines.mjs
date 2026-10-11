// Lädt Hauptstraßen und Gewässer einer Region von OpenStreetMap (Overpass-API),
// vereinfacht die Linien und speichert sie in Spielkoordinaten: terrain/data/<name>-linien.json
// Daten: © OpenStreetMap-Mitwirkende, ODbL
//
// Aufruf: node tools/fetch-lines.mjs <name>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameToWgs84, wgs84ToGame } from '../terrain/projection.js';

const name = process.argv[2] || 'wien';
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'terrain', 'data');
const meta = JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));
const half = meta.extent / 2;

const corners = [[-half, -half], [half, -half], [half, half], [-half, half]]
    .map(([x, z]) => gameToWgs84(x, z, meta.center));
const bbox = [
    Math.min(...corners.map((c) => c.lat)), Math.min(...corners.map((c) => c.lon)),
    Math.max(...corners.map((c) => c.lat)), Math.max(...corners.map((c) => c.lon))
].join(',');

const query = `[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});
  way["waterway"~"^(river|canal|riverbank)$"](${bbox});
  way["natural"="water"](${bbox});
);
out geom;`;

const SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
];

async function overpass() {
    for (let attempt = 0; attempt < 3; attempt++) {
        for (const server of SERVERS) {
            try {
                console.log(`  frage ${server} …`);
                const response = await fetch(server, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'neon-terrain-game/1.0' },
                    body: 'data=' + encodeURIComponent(query)
                });
                if (response.ok) return await response.json();
                console.log(`  HTTP ${response.status}`);
            } catch (error) {
                console.log(`  ${error.message}`);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    throw new Error('Kein Overpass-Server erreichbar');
}

// Douglas-Peucker-Vereinfachung (Toleranz in Metern)
function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, az] = points[a], [bx, bz] = points[b];
        const length = Math.hypot(bx - ax, bz - az) || 1;
        let worst = -1, worstDistance = 0;
        for (let i = a + 1; i < b; i++) {
            const [px, pz] = points[i];
            const d = Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / length;
            if (d > worstDistance) { worstDistance = d; worst = i; }
        }
        if (worstDistance > tolerance) {
            keep[worst] = 1;
            stack.push([a, worst], [worst, b]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

const json = await overpass();
const roads = [];
const water = [];
let totalLength = 0;
for (const way of json.elements) {
    if (!way.geometry) continue;
    const tags = way.tags || {};
    let points = way.geometry.map((g) => {
        const p = wgs84ToGame(g.lat, g.lon, meta.center);
        return [Math.round(p.x), Math.round(p.z)];
    });
    points = simplify(points, 4);
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (tags.highway) {
        roads.push({ type: tags.highway, points: points.flat() });
    } else {
        // kleine Teiche weglassen (Umfang unter 400 m)
        const isArea = tags.natural === 'water' || tags.waterway === 'riverbank';
        if (isArea && length < 400) continue;
        water.push({ type: tags.waterway || 'water', points: points.flat() });
    }
    totalLength += length;
}

const file = join(dataDir, `${name}-linien.json`);
writeFileSync(file, JSON.stringify({ source: '© OpenStreetMap-Mitwirkende (ODbL)', fetched: new Date().toISOString(), roads, water }));
console.log(`${roads.length} Straßen, ${water.length} Gewässer, ${(totalLength / 1000).toFixed(0)} km Linien gespeichert in ${file}`);
