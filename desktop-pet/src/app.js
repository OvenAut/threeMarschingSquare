// Verhalten des Haustiers: Laufen, Schlafen, Hochheben, Werfen, Fallen und Streicheln.
// Das Fenster selbst wird über den Bildschirm bewegt; kleine Hüpfer passieren innerhalb des Fensters.
import * as THREE from 'three/webgpu';
import { createPet, petUniforms as U } from './pet.js';

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
const VIEW_WIDTH = 4.4;           // sichtbare Breite in Welteinheiten (Körperradius = 1)
const GROUND_MARGIN = 0.15;       // Abstand Boden ↔ unterer Fensterrand (Welteinheiten)
const WALK_SPEED = 55;            // Pixel pro Sekunde
const HOP_RATE = 2.6;             // Hüpfer pro Sekunde beim Laufen
const GRAVITY = 2600;             // Pixel / s²
const BOUNCE = 0.35;              // Energie, die beim Aufprall an Wänden erhalten bleibt
const IDLE_TIME = [2, 7];         // so lange steht es herum (Sekunden, min/max)
const SLEEP_AFTER = 60;           // ohne Beachtung schläft es nach x Sekunden ein
const CLICK_MAX_MOVE = 5;         // bis zu so vielen Pixeln Bewegung zählt Drücken als Klick

// ---------------------------------------------------------------------------
// Host: Electron (über preload.cjs) oder – zum Ausprobieren – ein normaler Browser
// ---------------------------------------------------------------------------
const host = window.petHost ?? createBrowserHost();
const info = await host.info();
const SIZE = info.size;
const PX = SIZE / VIEW_WIDTH;     // Pixel pro Welteinheit

function createBrowserHost() {
    // Im Browser ist das Seitenfenster der "Bildschirm" und die Zeichenfläche das Pet-Fenster
    const size = 220;
    let cursorFn = () => {};
    let commandFn = () => {};
    const area = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    addEventListener('pointermove', (e) => cursorFn({ x: e.clientX, y: e.clientY }));
    addEventListener('keydown', (e) => {
        const map = { j: 'jump', s: 'sleep', w: 'wake', h: 'home' };
        if (map[e.key]) commandFn(map[e.key]);
    });
    document.body.style.background = 'linear-gradient(#5b6b88, #2b3242)';
    return {
        browser: true,
        info: async () => ({ x: innerWidth * 0.5 - size / 2, y: innerHeight - size, size }),
        move: (x, y) => {
            const c = renderer?.domElement;
            if (c) { c.style.left = `${Math.round(x)}px`; c.style.top = `${Math.round(y)}px`; }
        },
        ignoreMouse: (ignore) => { if (renderer) renderer.domElement.style.pointerEvents = ignore ? 'none' : 'auto'; },
        contextMenu: () => {},
        workArea: async () => area(),
        displays: async () => [area()],
        onCursor: (fn) => { cursorFn = fn; },
        onCommand: (fn) => { commandFn = fn; }
    };
}

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------
// ?webgl in der Adresse (bzw. GLIBBER_WEBGL=1 beim Start) erzwingt WebGL 2, falls WebGPU zickt
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
if (host.browser) Object.assign(renderer.domElement.style, { position: 'absolute', left: '0px', top: '0px' });
document.body.appendChild(renderer.domElement);
await renderer.init();
console.log(`Glibber rendert mit ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'}`);

const scene = new THREE.Scene();
const half = VIEW_WIDTH / 2;
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
camera.position.set(0, 0, 10);
const GROUND_Y = -half + GROUND_MARGIN;

const pet = createPet();
pet.root.position.y = GROUND_Y;
pet.shadow.mesh.position.y = GROUND_Y + 0.02;
scene.add(pet.root, pet.shadow.mesh);

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
const win = { x: info.x, y: info.y };     // Fensterposition auf dem Bildschirm (DIP)
const vel = { x: 0, y: 0 };               // beim Fallen / Werfen
let area = await host.workArea(win.x + SIZE / 2, win.y + SIZE / 2);
let allAreas = await host.displays();
const cursor = { x: win.x + SIZE / 2, y: win.y };

let state = 'fall';
let stateTime = 0;
let idleDuration = 3;
let walkTarget = 0;
let facing = 1;                // 1 = rechts, -1 = links
let hop = 0;                   // Höhe innerhalb des Fensters (Welteinheiten)
let hopVel = 0;
let lastAttention = 0;
let blinkTimer = 2;
let blinkPhase = 1;
let happyTimer = 0;
let surpriseTimer = 0;
let zTimer = 0;
let hovering = false;
let elapsed = 0;

// gedämpfte Federn für Quetschen und Neigen
const squash = { value: 1, velocity: 0, target: 1 };
const lean = { value: 0, velocity: 0, target: 0 };
function springStep(s, dt, stiffness = 260, damping = 9) {
    s.velocity += (-(s.value - s.target) * stiffness - s.velocity * damping) * dt;
    s.value += s.velocity * dt;
}

const groundY = () => area.y + area.height - SIZE;
const rand = (a, b) => a + Math.random() * (b - a);

function setState(next) {
    state = next;
    stateTime = 0;
    if (next === 'idle') idleDuration = rand(...IDLE_TIME);
    if (next === 'walk') {
        // ein Ziel, das nicht zu nah liegt, im Arbeitsbereich des aktuellen Bildschirms
        const min = area.x, max = area.x + area.width - SIZE;
        do walkTarget = rand(min, max); while (Math.abs(walkTarget - win.x) < 80 && max - min > 200);
        facing = Math.sign(walkTarget - win.x) || 1;
    }
}

function attention() { lastAttention = elapsed; }

function jump(strength = 5.2) {
    if (hop > 0.01 || state === 'drag' || state === 'fall') return;
    squash.velocity -= 4;            // kurz einfedern
    hopVel = strength;
}

function beHappy() {
    happyTimer = 1.6;
    jump();
    for (let i = 0; i < 3; i++) setTimeout(() => pet.spawn('heart', rand(-0.6, 0.6), GROUND_Y + 2.0), i * 160);
}

function wake() {
    if (state !== 'sleep') return;
    surpriseTimer = 0.8;
    squash.velocity += 6;
    setState('idle');
    attention();
}

async function refreshArea() {
    allAreas = await host.displays();
    area = await host.workArea(win.x + SIZE / 2, win.y + SIZE / 2);
}

// ---------------------------------------------------------------------------
// Maus: Hover-Test (Klick-Durchlass), Klicken, Ziehen, Werfen
// ---------------------------------------------------------------------------
function petHit(localX, localY) {
    // Körper als Ellipse in Fensterpixeln
    const cx = SIZE / 2 + lean.value * 0.5 * PX;
    const baseY = SIZE - (GROUND_MARGIN + hop) * PX;
    const ry = 0.95 * (1 + 0.82) * 0.5 * squash.value * PX;
    const rx = 1.05 / Math.sqrt(squash.value) * PX;
    const cy = baseY - ry;
    return ((localX - cx) / rx) ** 2 + ((localY - cy) / ry) ** 2 < 1;
}

host.onCursor((p) => {
    cursor.x = p.x; cursor.y = p.y;
    if (state === 'drag') return;
    const over = petHit(p.x - win.x, p.y - win.y);
    if (over !== hovering) {
        hovering = over;
        host.ignoreMouse(!over);
    }
});

const pointerPos = (e) => host.browser ? { x: e.clientX, y: e.clientY } : { x: e.screenX, y: e.screenY };
let press = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    renderer.domElement.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    press = { x: p.x, y: p.y, grabX: p.x - win.x, grabY: p.y - win.y, moved: false, last: p, lastTime: performance.now() };
    attention();
});

renderer.domElement.addEventListener('pointermove', (e) => {
    if (!press) return;
    const p = pointerPos(e);
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > CLICK_MAX_MOVE) {
        press.moved = true;
        if (state === 'sleep') surpriseTimer = 0.8;
        setState('drag');
        hop = 0; hopVel = 0;
    }
    if (!press.moved) return;
    // Wurfgeschwindigkeit aus den letzten Bewegungen schätzen
    const now = performance.now();
    const dt = Math.max(1, now - press.lastTime) / 1000;
    vel.x = THREE.MathUtils.lerp(vel.x, (p.x - press.last.x) / dt, 0.5);
    vel.y = THREE.MathUtils.lerp(vel.y, (p.y - press.last.y) / dt, 0.5);
    press.last = p; press.lastTime = now;
    win.x = p.x - press.grabX;
    win.y = p.y - press.grabY;
    host.move(win.x, win.y);
});

function release() {
    if (!press) return;
    if (press.moved) {
        // Wurf: Geschwindigkeit begrenzen, damit es nicht vom Bildschirm schießt
        vel.x = THREE.MathUtils.clamp(vel.x, -2500, 2500);
        vel.y = THREE.MathUtils.clamp(vel.y, -2500, 2500);
        setState('fall');
        refreshArea();
    } else if (state === 'sleep') {
        wake();
    } else {
        beHappy();
    }
    press = null;
}
renderer.domElement.addEventListener('pointerup', release);
renderer.domElement.addEventListener('pointercancel', release);
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); host.contextMenu(); });

host.onCommand((cmd) => {
    attention();
    if (cmd === 'jump') { wake(); beHappy(); }
    if (cmd === 'sleep' && state !== 'drag') { setState('sleep'); hop = 0; }
    if (cmd === 'wake') wake();
    if (cmd === 'displays') refreshArea();
    if (cmd === 'home') {
        // über dem Mauszeiger vom oberen Bildschirmrand fallen lassen
        host.workArea(cursor.x, cursor.y).then((a) => {
            area = a;
            win.x = THREE.MathUtils.clamp(cursor.x - SIZE / 2, a.x, a.x + a.width - SIZE);
            win.y = a.y - SIZE * 0.3;
            vel.x = 0; vel.y = 0;
            setState('fall');
            host.move(win.x, win.y);
        });
    }
});

// ---------------------------------------------------------------------------
// Bild für Bild
// ---------------------------------------------------------------------------
function update(dt) {
    elapsed += dt;
    stateTime += dt;
    let moved = false;
    let wobble = 1;
    let blush = 0.35;
    let eyeOpen = 1;
    squash.target = 1;
    lean.target = 0;

    switch (state) {
        case 'idle': {
            // ruhiges Atmen
            squash.target = 1 + Math.sin(elapsed * 2.2) * 0.02;
            if (elapsed - lastAttention > SLEEP_AFTER) setState('sleep');
            else if (stateTime > idleDuration) setState(Math.random() < 0.65 ? 'walk' : 'idle');
            break;
        }
        case 'walk': {
            // Fortbewegung nur während eines Hüpfers -> wirkt wie Schleim-Sprünge
            if (hop <= 0 && hopVel === 0) jump(3.2);
            if (hop > 0) {
                const step = Math.min(Math.abs(walkTarget - win.x), WALK_SPEED * 2.2 * dt);
                win.x += step * facing;
                moved = true;
            }
            lean.target = facing * 0.12;
            if (Math.abs(walkTarget - win.x) < 1 && hop <= 0) setState('idle');
            break;
        }
        case 'sleep': {
            squash.target = 0.9 + Math.sin(elapsed * 1.3) * 0.04;
            wobble = 0.3;
            eyeOpen = 0;
            zTimer -= dt;
            if (zTimer <= 0) { zTimer = 1.6; pet.spawn('z', 0.6, GROUND_Y + 1.6); }
            break;
        }
        case 'drag': {
            // Hängt am Mauszeiger: lang gezogen, schwingt gegen die Bewegungsrichtung
            squash.target = 1.18;
            lean.target = THREE.MathUtils.clamp(-vel.x / 1500, -0.6, 0.6);
            vel.x *= Math.exp(-dt * 6); vel.y *= Math.exp(-dt * 6);
            wobble = 2;
            blush = 0.7;
            break;
        }
        case 'fall': {
            vel.y += GRAVITY * dt;
            win.x += vel.x * dt;
            win.y += vel.y * dt;
            // seitliche Bildschirmränder (alle Monitore zusammen) abprallen lassen
            const left = Math.min(...allAreas.map((a) => a.x));
            const right = Math.max(...allAreas.map((a) => a.x + a.width)) - SIZE;
            if (win.x < left) { win.x = left; vel.x = -vel.x * BOUNCE; squash.velocity += 3; }
            if (win.x > right) { win.x = right; vel.x = -vel.x * BOUNCE; squash.velocity += 3; }
            squash.target = THREE.MathUtils.clamp(1 + vel.y / 6000, 0.9, 1.25);
            lean.target = THREE.MathUtils.clamp(-vel.x / 3000, -0.4, 0.4);
            wobble = 1.6;
            eyeOpen = 1;
            if (stateTime > 0.25) refreshAreaThrottled();
            if (win.y >= groundY()) {
                win.y = groundY();
                // Aufprall: je schneller, desto platter
                squash.value = THREE.MathUtils.clamp(1 - vel.y / 3500, 0.45, 0.95);
                squash.velocity = 0;
                if (vel.y > 900) surpriseTimer = 0.7;
                vel.x = 0; vel.y = 0;
                setState('idle');
            }
            moved = true;
            break;
        }
    }

    // Hüpfen innerhalb des Fensters
    if (hop > 0 || hopVel !== 0) {
        hopVel -= 22 * dt;
        hop += hopVel * dt;
        if (hop <= 0) {
            hop = 0;
            squash.value = Math.min(squash.value, state === 'walk' ? 0.82 : 0.7);
            hopVel = 0;
        } else {
            squash.target = 1.12;
        }
    }

    if (moved) host.move(win.x, win.y);

    springStep(squash, dt);
    springStep(lean, dt, 120, 7);

    // Blinzeln
    blinkTimer -= dt;
    if (blinkTimer <= 0) { blinkPhase = 0; blinkTimer = rand(2, 6); }
    blinkPhase = Math.min(1, blinkPhase + dt * 8);
    const blink = 1 - Math.sin(blinkPhase * Math.PI);

    happyTimer = Math.max(0, happyTimer - dt);
    surpriseTimer = Math.max(0, surpriseTimer - dt);

    // Augen folgen dem Mauszeiger, beim Laufen schauen sie nach vorn
    const faceX = win.x + SIZE / 2, faceY = win.y + SIZE - (GROUND_MARGIN + hop + 1.0) * PX;
    let lx = (cursor.x - faceX) / 300, ly = -(cursor.y - faceY) / 300;
    if (state === 'walk') { lx = facing * 0.8; ly = 0; }
    const len = Math.hypot(lx, ly);
    if (len > 1) { lx /= len; ly /= len; }
    U.look.value.lerp(new THREE.Vector2(lx, ly), 1 - Math.exp(-dt * 10));

    U.squash.value = squash.value;
    U.lean.value = lean.value;
    U.wobble.value = THREE.MathUtils.lerp(U.wobble.value, wobble, 1 - Math.exp(-dt * 4));
    U.eyeOpen.value = Math.min(eyeOpen, surpriseTimer > 0 ? 1 : blink);
    U.happy.value = THREE.MathUtils.lerp(U.happy.value, happyTimer > 0 ? 1 : 0, 1 - Math.exp(-dt * 14));
    U.mouthOpen.value = THREE.MathUtils.lerp(U.mouthOpen.value, surpriseTimer > 0 || state === 'drag' ? 1 : 0, 1 - Math.exp(-dt * 12));
    U.blush.value = THREE.MathUtils.lerp(U.blush.value, happyTimer > 0 ? 0.9 : blush, 1 - Math.exp(-dt * 6));
    U.tint.value = THREE.MathUtils.lerp(U.tint.value, state === 'sleep' ? 0.6 : 0, 1 - Math.exp(-dt * 1.5));

    pet.root.position.y = GROUND_Y + hop;
    pet.root.rotation.y = THREE.MathUtils.lerp(pet.root.rotation.y, state === 'walk' ? facing * 0.35 : 0, 1 - Math.exp(-dt * 6));

    // Schatten bleibt am Boden; in der Luft (Sprung oder Fall) wird er kleiner
    const air = state === 'fall' ? Math.min(1, (groundY() - win.y) / 400) : Math.min(1, hop / 2);
    pet.shadow.strength.value = 1 - air * 0.8;
    pet.shadow.mesh.scale.setScalar((1 - air * 0.5) / Math.sqrt(squash.value));
    if (state === 'fall') pet.shadow.mesh.visible = win.y > groundY() - SIZE;
    else pet.shadow.mesh.visible = state !== 'drag';

    pet.updateParticles(dt, scene);
}

let areaRefreshAt = 0;
function refreshAreaThrottled() {
    if (elapsed < areaRefreshAt) return;
    areaRefreshAt = elapsed + 0.25;
    refreshArea();
}

const timer = new THREE.Timer();
timer.connect(document);
setState('fall');
attention();

renderer.setAnimationLoop((t) => {
    timer.update(t);
    update(Math.min(timer.getDelta(), 1 / 20));
    renderer.render(scene, camera);
});

// zum Ausprobieren in den Entwicklertools
window.glibber = { setState, beHappy, wake, uniforms: U, get state() { return state; } };
