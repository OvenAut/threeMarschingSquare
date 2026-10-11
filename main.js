import * as THREE from 'three/webgpu';
import {
    Fn, uniform, float, vec3, mix, smoothstep, step, abs, max, min, exp, pow, normalize, length,
    color, oneMinus, attribute, positionWorld, positionWorldDirection, cameraPosition, atan, sin,
    uv, instancedBufferAttribute, pass, vec4, modelWorldMatrix, positionGeometry, fract, fwidth,
    floor, dot, time, mx_fractal_noise_float, vec2, varying
} from 'three/tsl';
import Stats from 'three/addons/stats.module.js';
import { bloom } from 'three/addons/BloomNode.js';
import {
    terrainHeight, surfaceHeight, MAX_HEIGHT, CONTOUR_STEP, setSeed
} from './terrain/height.js';

// Seed: aus der Adresse (?seed=123) oder bei jedem Laden zufällig -> jedes Mal eine andere Insel
const urlSeed = parseInt(new URLSearchParams(location.search).get('seed'), 10);
const SEED = Number.isFinite(urlSeed) && urlSeed > 0 ? urlSeed : 1 + Math.floor(Math.random() * 999999);
setSeed(SEED);

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 1024;          // Kantenlänge einer Kachel (Meter)
const VIEW_DISTANCE = 14000;      // bis hierhin werden Kacheln geladen
const FOG_DISTANCE = 7000;
// Detailstufe je Entfernung: Zellen pro Kachelseite
const LOD_STEPS = [
    { distance: 1500, cells: 128 },   //  8 m Zellen
    { distance: 4000, cells: 64 },    // 16 m
    { distance: 8000, cells: 32 },    // 32 m
    { distance: Infinity, cells: 16 } // 64 m
];

const CONTOUR_STYLE = 'dots';     // 'lines' = durchgehende Höhenlinien, 'dots' = Punktreihen
const WIRE_SIZE = 10;             // Maschenweite des leuchtenden Drahtgitters (Meter)
const COAST_INTENSITY = 1.15;     // Helligkeit der grünen Küstenlinie (> ~1 erzeugt Bloom)
const PING_INTERVAL = 10.0;       // alle x Sekunden startet ein neuer Gitter-Ping
const PING_DURATION = 1.5;        // so lange läuft eine Welle nach außen, danach Pause
const PING_RANGE = 2500;          // so weit läuft der Ping nach außen (Meter)
const PING_WIDTH = 400;           // Länge des ausblendenden Schweifs hinter der Welle (Meter)
const GROUND_FOG_HEIGHT = 160;    // bis zu dieser Höhe liegt der helle Bodennebel (Meter)
const GROUND_FOG_STRENGTH = 0.25; // Stärke des Bodennebels (0 = aus)
const NEBULA_STRENGTH = 0.35;     // Stärke der violetten Nebelschwaden am Himmel
const STAR_DENSITY = 160;         // Rastergröße für Sterne (mehr = mehr, kleinere Zellen)
const STAR_CHANCE = 0.025;        // Anteil der Zellen mit Stern
const START_ALTITUDE = 1000;      // Starthöhe (Meter), liegt über dem höchsten Gelände (900 m)
const CIRCLE_SPEED = 250 / 3.6;   // Kreisflug: 250 km/h in m/s
const CIRCLE_LAP_TIME = 30 * 60;  // eine Runde dauert ca. 30 Minuten
const CIRCLE_RADIUS = CIRCLE_SPEED * CIRCLE_LAP_TIME / (2 * Math.PI);   // ≈ 19,9 km
const TURN_FROM_BANK = 0.9;       // Kurvenrate pro Schräglage (siehe updateFlight)
const DOT_RADIUS = 0.5;           // Radius der Höhenlinien-Punkte (Meter)
const DOT_MIN_PIXELS = 2;         // kleinster Punktdurchmesser auf dem Bildschirm (gegen Flackern)
const CLUSTER_CHANCE = 0.3;       // Anteil der Kacheln mit einem pinken Datenpunkt-Cluster
const CLUSTER_SIZE = [8, 24];     // Punkte pro Cluster (min, max)
const CLUSTER_RADIUS = 140;       // Streuung eines Clusters (Meter)
const BEAM_CHANCE = 0.12;         // Anteil der Punkte mit senkrechtem Lichtstrahl
const BEAM_HEIGHT = 160;
const MAX_DOTS = 16384;

const timer = new THREE.Timer();
let renderer, renderPipeline, scene, camera, stats, hud;
let aircraft;
let viewMode = 'cockpit';         // 'cockpit' oder 'free' (Taste V: Kopf frei bewegen)
const head = { yaw: 0, pitch: 0, dragging: false };
const headRotation = new THREE.Quaternion();
const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let terrainMaterial, contourMaterial, contourDotMaterial, dotSprite, dotAttribute, beams;

const uCameraRight = uniform(new THREE.Vector3(1, 0, 0));
const uCameraUp = uniform(new THREE.Vector3(0, 1, 0));
const uPixelSize = uniform(0.001);   // Weltgröße eines Bildschirmpixels pro Meter Entfernung

// Synthwave / Neon-Palette
const cHorizon = color('#0a0618');
const cZenith = color('#020207');
const cAurora = color('#170b30');
const cNebula = color('#2a1450');
const cNeonCyan = color('#00f5d4');
const cNeonGreen = color('#39ff14');
const cNeonPink = color('#ff007f');
const cGroundFog = color('#1a1640');
const cWire = color('#16c8c0');
const cLake = color('#050d26');

// Farbe von Himmel/Nebel in Blickrichtung (identisch für Hintergrund und Nebel):
// dunkles Violett mit stärkerem Schimmer in einigen Richtungen
const hazeColor = (dir) => {
    const aurora = smoothstep(0.2, 1, sin(atan(dir.z, dir.x).mul(3).add(0.7))).mul(0.6);
    return mix(cHorizon, cAurora, aurora);
};

// Himmelsfarbe in Blickrichtung (ohne Sterne): Verlauf + violette Nebelschwaden.
// Das Gelände nutzt dieselbe Farbe -> Berge sind unsichtbar, verdecken aber, was dahinter liegt.
const skyColor = (dir) => {
    const sky = mix(hazeColor(dir), cZenith, smoothstep(0, 0.35, dir.y));
    const nebula = smoothstep(0.5, 0.85, mx_fractal_noise_float(dir.mul(2.5), 4).mul(0.5).add(0.5))
        .mul(smoothstep(-0.02, 0.08, dir.y)).mul(oneMinus(smoothstep(0.15, 0.45, dir.y)));
    return mix(sky, cNebula, nebula.mul(NEBULA_STRENGTH));
};

// Hash ohne sin (Dave Hoskins), unempfindlich gegen Rundung
const hash31 = (p) => {
    const q = fract(p.mul(0.1031)).toVar();
    q.addAssign(dot(q, q.zyx.add(31.32)));
    return fract(q.x.add(q.y).mul(q.z));
};

// Sterne als kleine, runde, weich geglättete Punkte (1-2 Pixel):
// pro Richtungszelle ein Stern an zufälliger Stelle, Abstand in Bildschirmpixeln gemessen
const starField = (dir) => {
    const p = dir.mul(STAR_DENSITY);
    const cell = floor(p);
    const random = hash31(cell);
    const offset = vec3(hash31(cell.add(17.1)), hash31(cell.add(43.7)), hash31(cell.add(71.3))).mul(0.6).add(0.2);
    const distancePixels = length(fract(p).sub(offset)).div(max(length(fwidth(p)), 0.00001));
    const shape = oneMinus(smoothstep(0.25, 1.0, distancePixels));
    const visible = step(1 - STAR_CHANCE, random);
    const brightness = random.sub(1 - STAR_CHANCE).div(STAR_CHANCE).mul(0.55).add(0.2);
    return shape.mul(visible).mul(brightness).mul(smoothstep(0.03, 0.3, dir.y));
};

const fogAmount = Fn(() => {
    const t = length(cameraPosition.sub(positionWorld)).div(FOG_DISTANCE);
    return oneMinus(exp(t.mul(t).negate()));
});

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------
function initScene() {
    stats = new Stats();
    document.body.appendChild(stats.dom);

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 1, 30000);
    // Das Flugzeug wird geflogen; die Kamera sitzt im Cockpit (Taste V: Kopf frei bewegen)
    aircraft = new THREE.Object3D();
    startCircleFlight(false);
    camera.position.copy(aircraft.position);
    updatePixelSize();

    scene = new THREE.Scene();
    scene.backgroundNode = Fn(() => {
        const dir = normalize(positionWorldDirection);
        const star = starField(dir);
        return skyColor(dir).add(vec3(star.mul(0.8), star.mul(0.85), star));
    })();

    terrainMaterial = createTerrainMaterial();
    contourMaterial = createContourMaterial();
    contourDotMaterial = createContourDotMaterial();
    createDots();

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    // Bloom lässt die Neon-Farben (Werte > 1) leuchten
    renderPipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    renderPipeline.outputNode = scenePass.add(bloom(scenePass, 1.0, 0.4, 0.6));

    initHeadLook(renderer.domElement);
    createHud();
    initKeyboard();
    window.addEventListener('resize', onWindowResize);
}

// Gelände: selbst unsichtbar (hat die Himmelsfarbe der Blickrichtung), aber deckend.
// Nur in tiefen Lagen liegt ein schwacher, heller Bodennebel. Drahtgitter nur als Radar-Ping.
// Senken (unter 0 m) sind flache, dunkelblaue "digitale Seen".
function createTerrainMaterial() {
    const material = new THREE.MeshBasicNodeMaterial();
    const height = attribute('height', 'float');

    material.colorNode = Fn(() => {
        const toCamera = cameraPosition.sub(positionWorld);
        const viewDir = normalize(toCamera);
        const sky = skyColor(viewDir.negate());
        const fog = fogAmount();
        const lake = oneMinus(step(0, height));

        // Bodennebel: nur in Tälern / Niederungen, nach oben ausgeblendet
        const lowland = oneMinus(smoothstep(GROUND_FOG_HEIGHT * 0.15, GROUND_FOG_HEIGHT, height));
        const ground = mix(sky, cGroundFog, lowland.mul(GROUND_FOG_STRENGTH)).toVar();

        // Drahtgitter, folgt der Oberfläche; in der Ferne ausgeblendet, damit es nicht flimmert
        const g = positionWorld.xz.div(WIRE_SIZE);
        const width = max(fwidth(g), 0.0001);
        const gd = min(fract(g), oneMinus(fract(g))).div(width);
        const wireLine = oneMinus(smoothstep(0, 1, min(gd.x, gd.y)));
        const wireFade = oneMinus(smoothstep(0.1, 0.45, max(width.x, width.y)));

        // Radar-Ping: jede PING_INTERVAL Sekunden läuft ein Ring von der Kamera nach außen.
        // Nur dort leuchtet das Gitter: helle Vorderkante, Schweif nach innen, am Ende verblassen.
        // Sekunden seit dem letzten Ping / Laufzeit -> 0..1 während der Welle, danach > 1 (unsichtbar)
        const progress = fract(time.div(PING_INTERVAL)).mul(PING_INTERVAL / PING_DURATION);
        const pingRadius = progress.mul(PING_RANGE);
        const distance = length(positionWorld.xz.sub(cameraPosition.xz));
        const behind = pingRadius.sub(distance);                       // > 0: Welle ist schon vorbei
        const front = smoothstep(-15, 0, behind);                       // scharfe Vorderkante
        const tail = oneMinus(smoothstep(0, PING_WIDTH, behind));       // Schweif blendet aus
        const life = oneMinus(smoothstep(0.55, 1, progress));           // Welle verblasst am Ende
        const ping = front.mul(tail).mul(tail).mul(life);

        ground.addAssign(cWire.mul(wireLine).mul(wireFade).mul(ping).mul(1.4).mul(oneMinus(lake)));

        // Seen: dunkelblau mit Spiegelung des Himmels bei flachem Blick
        const fresnel = pow(oneMinus(max(viewDir.y, 0)), 4);
        const water = mix(cLake, hazeColor(viewDir.negate()).mul(1.3), fresnel.mul(0.7));

        // In der Ferne in genau die Himmelsfarbe übergehen -> keine sichtbare Silhouette
        const surface = mix(ground, water, lake);
        return mix(surface, sky, fog);
    })();

    return material;
}

// Höhenlinien als leuchtende Linien: Verlauf Neon-Cyan -> Neon-Grün nach oben,
// jede 4. Linie und die Küste heller
function createContourMaterial() {
    const material = new THREE.LineBasicNodeMaterial();
    const level = attribute('lineLevel', 'float');
    const coast = oneMinus(step(0.5, abs(level)));
    const major = oneMinus(step(0.01, fract(level.div(CONTOUR_STEP * 4))));

    material.colorNode = Fn(() => {
        const gradient = mix(cNeonCyan, cNeonGreen, smoothstep(0, MAX_HEIGHT * 0.5, level));
        const neon = gradient.mul(mix(float(1.7), float(2.6), major)).toVar();
        // Küste: nur knapp über der Bloom-Schwelle, damit sie leuchtet, aber nicht überstrahlt
        neon.assign(mix(neon, cNeonGreen.mul(COAST_INTENSITY), coast));
        // Dünne 1-Pixel-Linien flimmern in der Ferne -> mit der Entfernung früh ausblenden
        const distance = length(positionWorld.sub(cameraPosition));
        const distanceFade = smoothstep(1500, 6000, distance).mul(0.8);
        const haze = hazeColor(normalize(positionWorld.sub(cameraPosition)));
        return mix(neon, haze, max(fogAmount(), distanceFade));
    })();

    return material;
}

// Höhenlinien als Punktreihe: jeder Punkt ist ein zur Kamera gedrehtes Quad mit runder
// Scheibe. Deckend gezeichnet (mit Tiefe), damit sich überlappende Punkte nicht aufaddieren
// und weiter hinten liegende Punkte verdeckt werden. Größe wächst mit der Entfernung.
function createContourDotMaterial() {
    // Alpha-to-Coverage nutzt das Antialiasing für weiche, aber trotzdem deckende Ränder
    const material = new THREE.MeshBasicNodeMaterial({ alphaToCoverage: true });
    const center = positionGeometry;
    const corner = attribute('dotCorner', 'vec2');
    const level = attribute('dotLevel', 'float');

    const worldCenter = modelWorldMatrix.mul(vec4(center, 1)).xyz;
    const toCamera = cameraPosition.sub(worldCenter);
    // Feste Größe in der Welt (Meter) -> perspektivisch kleiner mit der Entfernung.
    // Unter DOT_MIN_PIXELS Durchmesser wird der Punkt nicht kleiner (sonst springt er zwischen
    // Pixeln an/aus = Flackern), sondern dunkler: Helligkeit ~ echte Fläche / gezeichnete Fläche.
    // Sichtbare Scheibe = 0.8 * Quad-Radius.
    const worldRadius = float(DOT_RADIUS / 0.8);
    const minRadius = length(toCamera).mul(uPixelSize).mul(DOT_MIN_PIXELS / 2 / 0.8);
    const size = max(worldRadius, minRadius);
    const coverage = varying(worldRadius.div(size).pow(2), 'vDotCoverage');
    // Etwas zur Kamera hin versetzt, damit der Punkt nicht in der eigenen Höhenlinie steckt
    const lift = normalize(toCamera).mul(size.mul(2));
    material.positionNode = center.add(lift)
        .add(uCameraRight.mul(corner.x).add(uCameraUp.mul(corner.y)).mul(size));

    material.opacityNode = oneMinus(smoothstep(0.55, 0.85, length(corner)));
    material.colorNode = Fn(() => {
        const major = oneMinus(step(0.01, fract(level.div(CONTOUR_STEP * 4))));
        const neon = mix(cNeonCyan, cNeonGreen, smoothstep(0, MAX_HEIGHT * 0.5, level))
            .mul(mix(float(1.3), float(1.8), major));
        const haze = hazeColor(normalize(positionWorld.sub(cameraPosition)));
        // Kleine (ferne) Punkte blenden in den Hintergrund aus statt zu flackern
        const visible = mix(haze, neon, max(coverage, 0.12));
        return mix(visible, haze, fogAmount());
    })();

    return material;
}

// Pinke Datenpunkte: Sprites mit Additive Blending, pulsieren über time (TSL)
function createDots() {
    dotAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
    const dotPosition = instancedBufferAttribute(dotAttribute);
    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    material.positionNode = dotPosition;

    // Jeder Punkt pulsiert mit eigener Phase (aus seiner Position abgeleitet)
    const phase = fract(sin(dot(dotPosition.xz, vec2(12.9898, 78.233))).mul(43758.5453)).mul(6.283);
    const pulse = sin(time.mul(2.2).add(phase)).mul(0.5).add(0.5);
    material.scaleNode = max(length(dotPosition.sub(cameraPosition)).mul(0.012), 6)
        .mul(pulse.mul(0.35).add(0.8));

    const d = length(uv().sub(0.5)).mul(2);
    const core = oneMinus(smoothstep(0.1, 0.22, d));
    const glow = pow(max(oneMinus(d), 0), 3);
    const fade = oneMinus(fogAmount());
    material.colorNode = cNeonPink.mul(core.mul(4).add(glow.mul(1.4)))
        .mul(pulse.mul(0.6).add(0.6)).mul(fade);
    material.opacityNode = min(core.add(glow), 1);

    dotSprite = new THREE.Sprite(material);
    dotSprite.count = 0;
    dotSprite.frustumCulled = false;
    scene.add(dotSprite);

    // Feine senkrechte Lichtstrahlen über einigen Punkten, nach oben ausgeblendet
    const beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 6), 3));
    beamGeometry.setAttribute('beamT', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 2), 1));
    beamGeometry.setDrawRange(0, 0);
    const beamMaterial = new THREE.LineBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    beamMaterial.colorNode = cNeonPink.mul(oneMinus(attribute('beamT', 'float')).mul(1.2))
        .mul(oneMinus(fogAmount()));
    beams = new THREE.LineSegments(beamGeometry, beamMaterial);
    beams.frustumCulled = false;
    scene.add(beams);
}

// Deterministischer Zufall pro Kachel -> Cluster liegen immer an derselben Stelle.
// Ein Cluster sitzt auf einer Anhöhe; seine Punkte schweben knapp über dem Gelände.
function chunkDots(ix, iz) {
    let seed = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ Math.imul(SEED, 83492791)) >>> 0;
    const random = () => {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const dots = [];
    if (random() > CLUSTER_CHANCE) return dots;

    // Höchsten von einigen Kandidaten als Clusterzentrum nehmen (Bergkamm / Hügel)
    let centerX = 0, centerZ = 0, best = -Infinity;
    for (let i = 0; i < 6; i++) {
        const x = (ix + 0.15 + random() * 0.7) * CHUNK_SIZE;
        const z = (iz + 0.15 + random() * 0.7) * CHUNK_SIZE;
        const h = terrainHeight(x, z);
        if (h > best) { best = h; centerX = x; centerZ = z; }
    }
    if (best < 10) return dots;

    const count = CLUSTER_SIZE[0] + Math.floor(random() * (CLUSTER_SIZE[1] - CLUSTER_SIZE[0]));
    for (let i = 0; i < count; i++) {
        // Gauß-ähnliche Streuung: dichter Kern, lockerer Rand
        const angle = random() * Math.PI * 2;
        const radius = CLUSTER_RADIUS * (random() + random() + random()) / 3;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        const ground = surfaceHeight(x, z);
        dots.push({ x, y: ground + 4 + random() * 14, z, ground, beam: random() < BEAM_CHANCE });
    }
    return dots;
}

function updateDots(keys) {
    const data = dotAttribute.array;
    const beamPositions = beams.geometry.attributes.position;
    const beamT = beams.geometry.attributes.beamT;
    let count = 0;
    let beamCount = 0;
    for (const key of keys) {
        const [ix, iz] = key.split(',').map(Number);
        for (const point of chunkDots(ix, iz)) {
            if (count >= MAX_DOTS) break;
            data.set([point.x, point.y, point.z], count * 3);
            count++;
            if (point.beam) {
                const { x, z, ground } = point;
                beamPositions.array.set([x, ground, z, x, ground + BEAM_HEIGHT, z], beamCount * 6);
                beamT.array.set([0, 1], beamCount * 2);
                beamCount++;
            }
        }
    }
    dotAttribute.needsUpdate = true;
    dotSprite.count = count;
    beamPositions.needsUpdate = true;
    beamT.needsUpdate = true;
    beams.geometry.setDrawRange(0, beamCount * 2);
}

// ---------------------------------------------------------------------------
// Kachel-Verwaltung: Kacheln rund um die Kamera werden im Web Worker berechnet und nachgeladen
// ---------------------------------------------------------------------------
const chunks = new Map();          // key -> { mesh, cells, requestedCells }
const requestQueue = [];
const workers = [];
const idleWorkers = [];
const pendingJobs = new Map();     // job id -> { key, cells }
let nextJobId = 0;
let lastChunkUpdate = -Infinity;
let lastWantedKeys = '';

function initWorkers() {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
        // Versionsnummer von main.js weiterreichen (Cache-Busting, siehe index.html)
        const version = new URL(import.meta.url).search;
        const worker = new Worker(new URL(`./terrain/chunkWorker.js${version}`, import.meta.url), { type: 'module' });
        worker.onmessage = (event) => onChunkBuilt(worker, event.data);
        workers.push(worker);
        idleWorkers.push(worker);
    }
}

function lodForDistance(distance) {
    return LOD_STEPS.find((lod) => distance < lod.distance).cells;
}

function updateChunks(elapsed) {
    if (elapsed - lastChunkUpdate < 0.2) return;
    lastChunkUpdate = elapsed;

    const camX = aircraft.position.x;
    const camZ = aircraft.position.z;
    const centerX = Math.floor(camX / CHUNK_SIZE);
    const centerZ = Math.floor(camZ / CHUNK_SIZE);
    const radius = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE);
    const wanted = new Map();

    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const originX = (centerX + dx) * CHUNK_SIZE;
            const originZ = (centerZ + dz) * CHUNK_SIZE;
            // Abstand Kamera -> nächster Punkt der Kachel
            const nearX = Math.min(Math.max(camX, originX), originX + CHUNK_SIZE);
            const nearZ = Math.min(Math.max(camZ, originZ), originZ + CHUNK_SIZE);
            const distance = Math.hypot(nearX - camX, nearZ - camZ);
            if (distance > VIEW_DISTANCE) continue;
            wanted.set(`${centerX + dx},${centerZ + dz}`, {
                originX, originZ, distance, cells: lodForDistance(distance)
            });
        }
    }

    // Leuchtpunkte nur neu verteilen, wenn sich die Menge der Kacheln geändert hat
    const wantedKeys = [...wanted.keys()].join(';');
    if (wantedKeys !== lastWantedKeys) {
        lastWantedKeys = wantedKeys;
        updateDots(wanted.keys());
    }

    // Kacheln außer Sichtweite entfernen
    for (const [key, chunk] of chunks) {
        if (!wanted.has(key)) {
            removeChunkMesh(chunk);
            chunks.delete(key);
        }
    }

    // Fehlende oder in falscher Detailstufe vorhandene Kacheln anfordern (nächste zuerst)
    requestQueue.length = 0;
    for (const [key, info] of wanted) {
        const chunk = chunks.get(key);
        if (chunk && (chunk.cells === info.cells || chunk.requestedCells === info.cells)) continue;
        requestQueue.push({ key, ...info });
    }
    requestQueue.sort((a, b) => a.distance - b.distance);
    dispatchJobs();
}

function dispatchJobs() {
    while (idleWorkers.length > 0 && requestQueue.length > 0) {
        const job = requestQueue.shift();
        let chunk = chunks.get(job.key);
        if (!chunk) {
            chunk = { mesh: null, cells: 0, requestedCells: 0 };
            chunks.set(job.key, chunk);
        }
        chunk.requestedCells = job.cells;

        const id = nextJobId++;
        pendingJobs.set(id, { key: job.key, cells: job.cells, originX: job.originX, originZ: job.originZ });
        idleWorkers.pop().postMessage({
            id, originX: job.originX, originZ: job.originZ, size: CHUNK_SIZE, cells: job.cells,
            contourStyle: CONTOUR_STYLE, seed: SEED
        });
    }
}

function onChunkBuilt(worker, data) {
    idleWorkers.push(worker);
    const job = pendingJobs.get(data.id);
    pendingJobs.delete(data.id);
    const chunk = chunks.get(job.key);

    // Inzwischen entfernt oder eine andere Detailstufe angefordert -> verwerfen
    if (chunk && chunk.requestedCells === job.cells) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setAttribute('height', new THREE.BufferAttribute(data.heights, 1));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, terrainMaterial);
        mesh.position.set(job.originX, 0, job.originZ);

        addContourObjects(mesh, data);
        scene.add(mesh);

        removeChunkMesh(chunk);
        chunk.mesh = mesh;
        chunk.cells = job.cells;
    }
    dispatchJobs();
}

// Küstenlinie (durchgehend) und Punkt-Höhenlinien als Kinder der Kachel
function addContourObjects(mesh, data) {
    if (data.linePositions.length > 0) {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(data.linePositions, 3));
        lineGeometry.setAttribute('lineLevel', new THREE.BufferAttribute(data.lineLevels, 1));
        lineGeometry.computeBoundingSphere();
        mesh.add(new THREE.LineSegments(lineGeometry, contourMaterial));
    }

    if (data.dotIndices.length > 0) {
        const dotGeometry = new THREE.BufferGeometry();
        dotGeometry.setAttribute('position', new THREE.BufferAttribute(data.dotCenters, 3));
        dotGeometry.setAttribute('dotCorner', new THREE.BufferAttribute(data.dotCorners, 2));
        dotGeometry.setAttribute('dotLevel', new THREE.BufferAttribute(data.dotLevels, 1));
        dotGeometry.setIndex(new THREE.BufferAttribute(data.dotIndices, 1));
        dotGeometry.computeBoundingSphere();
        dotGeometry.boundingSphere.radius += 50;   // Quads ragen über die Mittelpunkte hinaus
        const contourDots = new THREE.Mesh(dotGeometry, contourDotMaterial);
        contourDots.renderOrder = 2;
        mesh.add(contourDots);
    }
}

function removeChunkMesh(chunk) {
    if (!chunk.mesh) return;
    scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    for (const child of chunk.mesh.children) child.geometry.dispose();
    chunk.mesh = null;
}

// ---------------------------------------------------------------------------
// Flugsteuerung
// ---------------------------------------------------------------------------
const keys = new Set();
const flight = { speed: 80, roll: 0, pitch: 0, yaw: 0, leveling: false };
const levelTarget = new THREE.Quaternion();
const levelEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

function initKeyboard() {
    window.addEventListener('keydown', (event) => {
        keys.add(event.code);
        if (event.code === 'KeyR') flight.leveling = true;
        if (event.code === 'KeyV' && !event.repeat) toggleView();
        if (event.code === 'KeyC' && !event.repeat) startCircleFlight(true);
        if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
    });
    window.addEventListener('keyup', (event) => keys.delete(event.code));
    window.addEventListener('blur', () => keys.clear());
}

function axis(positive, negative) {
    return (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);
}

// Kreisflug (Bildschirmschoner): 250 km/h auf 1000 m um die Inselmitte, eine Runde ≈ 30 min.
// Mit fromCurrent wird der Kreis an der aktuellen Position (Winkel) wieder aufgenommen.
function startCircleFlight(fromCurrent) {
    const angle = fromCurrent ? Math.atan2(aircraft.position.z, aircraft.position.x) : 0;
    aircraft.position.set(
        Math.cos(angle) * CIRCLE_RADIUS, START_ALTITUDE, Math.sin(angle) * CIRCLE_RADIUS
    );
    // Blick tangential zum Kreis (Linkskurve um die Mitte)
    aircraft.quaternion.setFromEuler(new THREE.Euler(0, -angle, 0, 'YXZ'));
    // Leichte Schräglage: Kurvenrate (rechts.y * TURN_FROM_BANK) = Tempo / Radius
    aircraft.rotateZ(Math.asin((CIRCLE_SPEED / CIRCLE_RADIUS) / TURN_FROM_BANK));
    flight.speed = CIRCLE_SPEED;
    flight.roll = 0;
    flight.pitch = 0;
    flight.yaw = 0;
    flight.leveling = false;
}

function updateFlight(dt) {
    // Klassische Flugsteuerung:
    //   W/S  Nase runter/hoch (Knüppel drücken/ziehen)   A/D  rollen
    //   ↑/↓  beschleunigen/bremsen                       Q/E oder ←/→  gieren (Seitenruder)
    const pitchInput = axis('KeyS', 'KeyW');
    const rollInput = axis('KeyA', 'KeyD');
    const yawInput = THREE.MathUtils.clamp(axis('KeyQ', 'KeyE') + axis('ArrowLeft', 'ArrowRight'), -1, 1);
    flight.speed = THREE.MathUtils.clamp(flight.speed + axis('ArrowUp', 'ArrowDown') * 120 * dt, 0, 700);

    // Sanft auf Zielrate zulaufen, damit die Steuerung nicht ruckelt
    const response = Math.min(1, dt * 5);
    flight.roll += (rollInput * 1.8 - flight.roll) * response;
    flight.pitch += (pitchInput * 0.9 - flight.pitch) * response;
    flight.yaw += (yawInput * 0.5 - flight.yaw) * response;

    aircraft.rotateZ(flight.roll * dt);
    aircraft.rotateX(flight.pitch * dt);
    aircraft.rotateY(flight.yaw * dt);

    // Schräglage erzeugt eine Kurve (wie beim Flugzeug)
    right.set(1, 0, 0).applyQuaternion(aircraft.quaternion);
    aircraft.rotateOnWorldAxis(worldUp, right.y * TURN_FROM_BANK * dt);

    // R: sanft gerade stellen (Rollen und Neigung auf 0, Flugrichtung bleibt).
    // Rollen oder Nicken durch den Piloten bricht das Ausrichten ab.
    if (rollInput !== 0 || pitchInput !== 0) flight.leveling = false;
    if (flight.leveling) {
        levelEuler.setFromQuaternion(aircraft.quaternion, 'YXZ');
        levelEuler.set(0, levelEuler.y, 0, 'YXZ');
        levelTarget.setFromEuler(levelEuler);
        aircraft.quaternion.slerp(levelTarget, Math.min(1, dt * 2.5));
        if (aircraft.quaternion.angleTo(levelTarget) < 0.002) {
            aircraft.quaternion.copy(levelTarget);
            flight.leveling = false;
        }
    }

    forward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
    aircraft.position.addScaledVector(forward, flight.speed * dt);

    // Nicht in den Boden fliegen
    const ground = surfaceHeight(aircraft.position.x, aircraft.position.z);
    if (aircraft.position.y < ground + 4) aircraft.position.y = ground + 4;

    return ground;
}

function createHud() {
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;right:12px;bottom:12px;padding:10px 14px;'
        + 'font:13px/1.5 monospace;border:1px solid rgba(51,240,255,0.5);border-radius:6px;'
        + 'pointer-events:none;white-space:pre;color:#9ff6ff;background:rgba(4,8,20,0.6);';
    document.body.appendChild(hud);
}

function updateHud(groundHeight) {
    const kmh = Math.round(flight.speed * 3.6);
    const altitude = Math.round(aircraft.position.y);
    const agl = Math.round(aircraft.position.y - groundHeight);
    const loading = requestQueue.length + pendingJobs.size;
    const distanceToCenter = Math.hypot(aircraft.position.x, aircraft.position.z);
    hud.textContent =
        `Tempo ${kmh} km/h   Höhe ${altitude} m   über Grund ${agl} m`
        + (loading > 0 ? `   lade ${loading} Kacheln` : '') + '\n'
        + `Kacheln ${chunks.size}   GPU-Geometrien ${renderer.info.memory.geometries}\n`
        + 'W/S Nase runter/hoch   A/D rollen   ↑/↓ Gas/Bremse   Q/E ←/→ gieren   R gerade stellen\n'
        + `V Ansicht: ${viewMode === 'cockpit' ? 'Cockpit' : 'Kopf frei (Maus ziehen)'}   C Kreisflug\n`
        + `Karte ${SEED} (mit ?seed=${SEED} wieder laden)   Mitte ${Math.round(distanceToCenter / 100) / 10} km`;
}

// ---------------------------------------------------------------------------
// Ansicht: Cockpit <-> Kopf frei bewegen (Taste V)
// ---------------------------------------------------------------------------
function initHeadLook(element) {
    element.addEventListener('pointerdown', (event) => {
        if (viewMode !== 'free') return;
        head.dragging = true;
        element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointerup', () => { head.dragging = false; });
    element.addEventListener('pointermove', (event) => {
        if (!head.dragging) return;
        head.yaw -= event.movementX * 0.004;
        head.pitch = THREE.MathUtils.clamp(head.pitch - event.movementY * 0.004, -1.45, 1.45);
    });
}

function toggleView() {
    viewMode = viewMode === 'cockpit' ? 'free' : 'cockpit';
    // Kopf beim Wechsel immer wieder nach vorne ausrichten
    head.yaw = 0;
    head.pitch = 0;
    head.dragging = false;
}

function updateView() {
    // Kamera sitzt immer im Cockpit; im freien Modus kommt die Kopfdrehung dazu
    camera.position.copy(aircraft.position);
    camera.quaternion.copy(aircraft.quaternion);
    if (viewMode === 'free') {
        headEuler.set(head.pitch, head.yaw, 0, 'YXZ');
        headRotation.setFromEuler(headEuler);
        camera.quaternion.multiply(headRotation);
    }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updatePixelSize();
}

// Bildhöhe in Metern pro Meter Entfernung, geteilt durch die Pixelhöhe des Fensters
function updatePixelSize() {
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    uPixelSize.value = viewHeight / window.innerHeight;
}

function animate() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const groundHeight = updateFlight(dt);
    updateView();
    camera.updateMatrixWorld();
    uCameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    uCameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    updateChunks(timer.getElapsed());
    updateHud(groundHeight);
    renderPipeline.render();
    stats.update();
}

initScene();
initWorkers();
