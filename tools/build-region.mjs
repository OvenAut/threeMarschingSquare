// Schneidet eine Spielregion aus dem BEV-Höhenraster (DGM_R5.tif) und speichert sie als
// kompaktes Höhenraster für das Spiel:
//   terrain/data/<name>.bin   Uint16, Höhe in Dezimetern, Zeile für Zeile von Nord nach Süd
//   terrain/data/<name>.json  Metadaten (Größe, Zellweite, Spielkoordinaten, Min/Max, Quelle)
//
// Spielkoordinaten: Mitte der Region = 0/0, x = Ost, z = Süd (Norden ist -z).
//
// Aufruf:  node tools/build-region.mjs <name> <breite> <länge> <größe_km> [zellweite_m] [tif]
// Beispiel: node tools/build-region.mjs wien 48.2085 16.3730 70 20 C:/GIS/DGM/DGM_R5.tif
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DgmReader, toLambert } from './dgm-reader.mjs';

const [name, lat, lon, sizeKm, cellArg, tifArg] = process.argv.slice(2);
if (!name || !lat || !lon || !sizeKm) {
    console.log('Aufruf: node tools/build-region.mjs <name> <breite> <länge> <größe_km> [zellweite_m] [tif]');
    process.exit(1);
}
const cell = Number(cellArg || 20);
const tif = tifArg || 'C:/GIS/DGM/DGM_R5.tif';
const dgm = new DgmReader(tif);

// Passende Stufe der Datei wählen (gleiche Zellweite -> Werte direkt übernehmen)
const levelIndex = dgm.levels.findIndex((l) => Math.abs(l.cellSize - cell) < 0.01);
const level = dgm.levels[levelIndex >= 0 ? levelIndex : 0];
console.log(`Quelle: ${tif}, Stufe ${levelIndex >= 0 ? levelIndex : 0} (${level.cellSize} m)`);

// Mitte auf das Raster der Stufe einrasten
const center = toLambert(Number(lat), Number(lon));
const centerCol = Math.round((center.x - level.originX) / level.cellSize);
const centerRow = Math.round((level.originY - center.y) / level.cellSize);
const half = Math.round(Number(sizeKm) * 1000 / cell / 2);
const size = half * 2 + 1;

const data = new Uint16Array(size * size);
let min = Infinity, max = -Infinity, missing = 0;
let lastValid = 0;
const started = Date.now();

for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
        let h;
        if (levelIndex >= 0) {
            h = dgm.sample(level, centerCol - half + col, centerRow - half + row);
        } else {
            const x = level.originX + (centerCol - half) * level.cellSize + col * cell;
            const y = level.originY - (centerRow - half) * level.cellSize - row * cell;
            h = dgm.heightAt(x, y, 0);
        }
        if (h === null) {           // außerhalb Österreichs / keine Daten
            missing++;
            h = lastValid;
        } else {
            lastValid = h;
            min = Math.min(min, h);
            max = Math.max(max, h);
        }
        data[row * size + col] = Math.max(0, Math.min(65535, Math.round(h * 10)));
    }
    if (row % 500 === 0) console.log(`  Zeile ${row}/${size}`);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'terrain', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.bin`), Buffer.from(data.buffer));
const meta = {
    name,
    size,                         // Punkte pro Seite
    cell,                         // Meter zwischen Punkten
    extent: (size - 1) * cell,    // Kantenlänge in Metern
    minX: -half * cell,           // Spielkoordinate des ersten Punkts (West)
    minZ: -half * cell,           // Spielkoordinate der ersten Zeile (Nord)
    heightScale: 0.1,             // Wert * heightScale = Meter
    minHeight: Math.round(min * 10) / 10,
    maxHeight: Math.round(max * 10) / 10,
    center: { lat: Number(lat), lon: Number(lon), lambertX: level.originX + centerCol * level.cellSize, lambertY: level.originY - centerRow * level.cellSize },
    crs: 'EPSG:31287 (MGI / Austria Lambert)',
    source: 'Datenquelle: BEV – Digitales Geländehöhenmodell (CC BY 4.0)',
    missingPoints: missing
};
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(meta, null, 2));
console.log(`Fertig in ${((Date.now() - started) / 1000).toFixed(1)} s:`, meta);
