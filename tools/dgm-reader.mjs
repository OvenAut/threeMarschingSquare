// Liest Ausschnitte aus dem BEV-Höhenraster (DGM_R5.tif: BigTIFF, 256er-Kacheln, LZW, Float32)
// ohne externe Pakete. Nur benötigte Kacheln werden gelesen und dekodiert.
import { openSync, readSync } from 'node:fs';

export class DgmReader {
    constructor(path) {
        this.fd = openSync(path, 'r');
        this.levels = this.#readIfds();
        this.cache = new Map();
    }

    #read(offset, length) {
        const buffer = Buffer.alloc(length);
        readSync(this.fd, buffer, 0, length, Number(offset));
        return buffer;
    }

    #readIfds() {
        const header = this.#read(0, 16);
        if (header.toString('ascii', 0, 2) !== 'II' || header.readUInt16LE(2) !== 43) {
            throw new Error('Erwartet: BigTIFF little-endian');
        }
        const levels = [];
        let offset = header.readBigUInt64LE(8);
        while (offset !== 0n) {
            const count = Number(this.#read(offset, 8).readBigUInt64LE(0));
            const entries = this.#read(offset + 8n, count * 20 + 8);
            const tags = {};
            for (let i = 0; i < count; i++) {
                const e = entries.subarray(i * 20, i * 20 + 20);
                const tag = e.readUInt16LE(0);
                const type = e.readUInt16LE(2);
                const n = Number(e.readBigUInt64LE(4));
                tags[tag] = this.#values(type, n, e.subarray(12));
            }
            levels.push({
                width: tags[256][0], height: tags[257][0],
                tileWidth: tags[322][0], tileHeight: tags[323][0],
                compression: tags[259][0], predictor: tags[317]?.[0] ?? 1,
                offsets: tags[324], counts: tags[325],
                pixelScale: tags[33550], tiepoint: tags[33922]
            });
            offset = entries.subarray(count * 20).readBigUInt64LE(0);
        }
        // Übersichtsstufen haben keine eigene Georeferenz -> aus Stufe 0 ableiten
        const base = levels[0];
        for (const level of levels) {
            level.cellSize = base.pixelScale[0] * (base.width - 1) / (level.width - 1);
            level.originX = base.tiepoint[3];
            level.originY = base.tiepoint[4];
            level.tilesAcross = Math.ceil(level.width / level.tileWidth);
        }
        return levels;
    }

    #values(type, n, inline) {
        const size = { 3: 2, 4: 4, 12: 8, 16: 8, 2: 1 }[type] || 1;
        const buffer = size * n <= 8 ? inline : this.#read(inline.readBigUInt64LE(0), size * n);
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
            if (type === 3) out[i] = buffer.readUInt16LE(i * 2);
            else if (type === 4) out[i] = buffer.readUInt32LE(i * 4);
            else if (type === 16) out[i] = Number(buffer.readBigUInt64LE(i * 8));
            else if (type === 12) out[i] = buffer.readDoubleLE(i * 8);
            else out[i] = buffer[i];
        }
        return out;
    }

    // Eine Kachel dekodieren (mit kleinem LRU-Cache)
    #tile(level, tx, ty) {
        const key = `${level.cellSize}:${tx}:${ty}`;
        if (this.cache.has(key)) return this.cache.get(key);
        const index = ty * level.tilesAcross + tx;
        const raw = this.#read(level.offsets[index], level.counts[index]);
        const bytes = level.compression === 5 ? lzwDecode(raw, level.tileWidth * level.tileHeight * 4) : raw;
        const data = new Float32Array(bytes.buffer, bytes.byteOffset, level.tileWidth * level.tileHeight);
        if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, data);
        return data;
    }

    // Höhe an Rasterposition (Spalte/Zeile) einer Stufe; außerhalb oder NoData -> null
    sample(level, col, row) {
        if (col < 0 || row < 0 || col >= level.width || row >= level.height) return null;
        const tx = Math.floor(col / level.tileWidth);
        const ty = Math.floor(row / level.tileHeight);
        const value = this.#tile(level, tx, ty)[(row - ty * level.tileHeight) * level.tileWidth + (col - tx * level.tileWidth)];
        return value === 0 ? null : value;
    }

    // Bilinear interpolierte Höhe an Lambert-Koordinate (x = Ost, y = Nord) auf einer Stufe
    heightAt(x, y, levelIndex = 0) {
        const level = this.levels[levelIndex];
        const fc = (x - level.originX) / level.cellSize;
        const fr = (level.originY - y) / level.cellSize;
        const c = Math.floor(fc), r = Math.floor(fr);
        const tx = fc - c, ty = fr - r;
        const v00 = this.sample(level, c, r), v10 = this.sample(level, c + 1, r);
        const v01 = this.sample(level, c, r + 1), v11 = this.sample(level, c + 1, r + 1);
        if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
        return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }
}

// TIFF-LZW (MSB-first, Codes 9-12 Bit, mit "early change")
function lzwDecode(input, expectedLength) {
    const output = new Uint8Array(expectedLength);
    let outPos = 0;
    const dictionary = new Array(4096);
    for (let i = 0; i < 256; i++) dictionary[i] = Uint8Array.of(i);
    let nextCode = 258;
    let codeLength = 9;
    let bitPos = 0;
    let previous = null;
    const totalBits = input.length * 8;

    const readCode = () => {
        if (bitPos + codeLength > totalBits) return 257;
        let code = 0;
        for (let i = 0; i < codeLength; i++) {
            const bit = (input[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
            code = (code << 1) | bit;
        }
        bitPos += codeLength;
        return code;
    };

    while (true) {
        const code = readCode();
        if (code === 257) break;                         // EOI
        if (code === 256) {                              // Clear
            nextCode = 258;
            codeLength = 9;
            previous = null;
            continue;
        }
        let entry;
        if (code < nextCode && dictionary[code]) {
            entry = dictionary[code];
            if (previous) {
                const added = new Uint8Array(previous.length + 1);
                added.set(previous);
                added[previous.length] = entry[0];
                dictionary[nextCode++] = added;
            }
        } else {
            entry = new Uint8Array(previous.length + 1);
            entry.set(previous);
            entry[previous.length] = previous[0];
            dictionary[nextCode++] = entry;
        }
        const n = Math.min(entry.length, expectedLength - outPos);
        output.set(entry.subarray(0, n), outPos);
        outPos += n;
        previous = entry;
        if (nextCode + 1 >= (1 << codeLength) && codeLength < 12) codeLength++;
    }
    return output;
}

// WGS84 Breite/Länge -> MGI / Austria Lambert (EPSG:31287), Bessel-Ellipsoid.
// Datumsverschiebung (~100 m) wird für Spielzwecke vernachlässigt.
export function toLambert(latDeg, lonDeg) {
    const a = 6377397.155, f = 1 / 299.1528128, e = Math.sqrt(2 * f - f * f);
    const rad = Math.PI / 180;
    const lat1 = 49 * rad, lat2 = 46 * rad, lat0 = 47.5 * rad, lon0 = (13 + 20 / 60) * rad;
    const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
    const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
    const n = (Math.log(m(lat1)) - Math.log(m(lat2))) / (Math.log(t(lat1)) - Math.log(t(lat2)));
    const F = m(lat1) / (n * t(lat1) ** n);
    const rho = (p) => a * F * t(p) ** n;
    const theta = n * (lonDeg * rad - lon0);
    const r = rho(latDeg * rad);
    return { x: 400000 + r * Math.sin(theta), y: 400000 + rho(lat0) - r * Math.cos(theta) };
}
