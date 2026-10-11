// Lädt die Orte (Städte, Dörfer, Weiler, Stadtteile) einer Region von OpenStreetMap (Overpass-API)
// und speichert sie in Spielkoordinaten: terrain/data/<name>-orte.json
// Daten: © OpenStreetMap-Mitwirkende, ODbL
//
// Aufruf: node tools/fetch-places.mjs <name>      (die Region muss vorher mit build-region.mjs erzeugt sein)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameToWgs84, wgs84ToGame } from '../terrain/projection.js';

const name = process.argv[2] || 'wien';
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'terrain', 'data');
const meta = JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));

// Begrenzungsrahmen der Region in WGS84 (aus den vier Ecken)
const half = meta.extent / 2;
const corners = [[-half, -half], [half, -half], [half, half], [-half, half]]
    .map(([x, z]) => gameToWgs84(x, z, meta.center));
const south = Math.min(...corners.map((c) => c.lat));
const north = Math.max(...corners.map((c) => c.lat));
const west = Math.min(...corners.map((c) => c.lon));
const east = Math.max(...corners.map((c) => c.lon));

const PLACE_TYPES = 'city|town|village|hamlet|suburb|quarter|neighbourhood|isolated_dwelling';
const query = `[out:json][timeout:90];
node["place"~"^(${PLACE_TYPES})$"](${south},${west},${north},${east});
out body;`;

console.log(`Region ${name}: ${south.toFixed(4)}..${north.toFixed(4)} N, ${west.toFixed(4)}..${east.toFixed(4)} E`);
// Öffentliche Overpass-Server (Hauptserver + Spiegel), bei Überlastung der Reihe nach probieren
const SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
];

async function overpass(query) {
    for (let attempt = 0; attempt < 2; attempt++) {
        for (const server of SERVERS) {
            try {
                const response = await fetch(server, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'neon-terrain-game/1.0' },
                    body: 'data=' + encodeURIComponent(query)
                });
                if (response.ok) return await response.json();
                console.log(`  ${server}: HTTP ${response.status}, nächster Server …`);
            } catch (error) {
                console.log(`  ${server}: ${error.message}, nächster Server …`);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('Kein Overpass-Server erreichbar');
}

const json = await overpass(query);

const places = json.elements
    .map((node) => {
        const { x, z } = wgs84ToGame(node.lat, node.lon, meta.center);
        return {
            id: node.id,
            name: node.tags.name || '',
            type: node.tags.place,
            population: Number.parseInt(node.tags.population, 10) || 0,
            x: Math.round(x),
            z: Math.round(z)
        };
    })
    .filter((p) => Math.abs(p.x) < half && Math.abs(p.z) < half);

const counts = {};
for (const p of places) counts[p.type] = (counts[p.type] || 0) + 1;
writeFileSync(join(dataDir, `${name}-orte.json`), JSON.stringify({
    source: '© OpenStreetMap-Mitwirkende (ODbL)',
    fetched: new Date().toISOString(),
    places
}));
console.log(`${places.length} Orte gespeichert:`, counts);
