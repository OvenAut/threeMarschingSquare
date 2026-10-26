// Aussehen des Haustiers: Glibber-Körper, Gesicht, Schatten und Partikel – alles als TSL-Shader.
// Das Gesicht wird direkt auf die Körperoberfläche gemalt und verformt sich daher mit dem Schleim.
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, float, vec2, vec3, mix, smoothstep, step, abs, max, min, length, normalize, dot, sin,
    color, oneMinus, positionLocal, positionGeometry, normalView, positionViewDirection, time,
    mx_noise_float, uv, select, sqrt, sign
} from 'three/tsl';

export const BODY_BASE = 0.82;    // so weit liegt der abgeflachte Boden unter der Kugelmitte

// Zustand, den die Verhaltenslogik pro Bild setzt
export const petUniforms = {
    squash: uniform(1),           // < 1 = platt gedrückt, > 1 = in die Länge gezogen
    lean: uniform(0),             // Neigung nach links/rechts (Ziehen, Laufen)
    wobble: uniform(1),           // Stärke des Wackelns
    eyeOpen: uniform(1),          // 0 = geschlossen, 1 = offen
    happy: uniform(0),            // 1 = ^ ^ Augen
    mouthOpen: uniform(0),        // 0 = Lächeln, 1 = offener Mund ("Oh!")
    blush: uniform(0.35),
    look: uniform(new THREE.Vector2()),   // Blickrichtung, Länge ≤ 1
    tint: uniform(0)              // 0 = grün, 1 = schläfrig-blau
};

const cTop = color('#a6ff7a');
const cBottom = color('#1fae6a');
const cSleepTop = color('#9fd8ff');
const cSleepBottom = color('#3a6fd0');
const cRim = color('#eaffd0');
const cEye = color('#1a1430');
const cMouth = color('#4a1428');
const cBlush = color('#ff7aa8');
const cHeart = color('#ff4f8b');
const cZ = color('#d8e8ff');

// Strichstärke weich auslaufen lassen
const stroke = (d, w) => smoothstep(w, w.mul(0.45), d);

function createBodyMaterial() {
    const u = petUniforms;
    const material = new THREE.MeshBasicNodeMaterial();

    // Vertex: abgeflachter Boden, Quetschen um den Boden herum, Neigung und Glibber-Wackeln
    material.positionNode = Fn(() => {
        const p = positionLocal.toVar();
        p.y.assign(max(p.y, -BODY_BASE));
        const h = p.y.add(BODY_BASE).div(1 + BODY_BASE);           // 0 unten … 1 oben
        const jiggle = mx_noise_float(p.mul(1.6).add(time.mul(0.7))).mul(0.06).mul(u.wobble);
        p.addAssign(normalize(positionLocal).mul(jiggle.mul(h)));
        p.x.addAssign(sin(time.mul(5.0).add(h.mul(3.0))).mul(0.025).mul(u.wobble).mul(h));
        // Volumen grob erhalten: wird es flacher, wird es breiter
        const side = float(1).div(sqrt(u.squash));
        p.x.mulAssign(side);
        p.z.mulAssign(side);
        p.y.assign(p.y.add(BODY_BASE).mul(u.squash));
        p.x.addAssign(u.lean.mul(h.mul(h)));
        return p;
    })();

    material.colorNode = Fn(() => {
        const n = normalView;
        const v = positionViewDirection;
        const L = normalize(vec3(-0.45, 0.75, 0.55));
        const g = positionGeometry.y.mul(0.5).add(0.5);

        // Toon-Schattierung mit weicher Kante
        const top = mix(cTop, cSleepTop, u.tint);
        const bottom = mix(cBottom, cSleepBottom, u.tint);
        const band = smoothstep(-0.1, 0.1, dot(n, L)).mul(0.28).add(0.72);
        const col = mix(bottom, top, smoothstep(0.0, 0.9, g)).mul(band).toVar();

        // Randlicht wie bei durchscheinendem Gelee
        const fresnel = oneMinus(max(dot(n, v), 0)).pow(2.5);
        col.assign(mix(col, cRim, fresnel.mul(0.55)));

        // Harter Glanzpunkt
        const H = normalize(L.add(v));
        const spec = smoothstep(0.955, 0.965, dot(n, H));
        col.assign(mix(col, vec3(1), spec.mul(0.85)));

        // --- Gesicht (auf die Vorderseite der unverformten Kugel projiziert) ---
        const p = positionGeometry;
        const front = smoothstep(0.1, 0.35, p.z);
        const f = p.xy;
        const look = u.look.mul(vec2(0.07, 0.05));

        const eyes = float(0).toVar();
        const shine = float(0).toVar();
        for (const s of [-1, 1]) {
            const c = vec2(s * 0.32, 0.14).add(look);
            const q = f.sub(c);
            // offenes Auge: Ellipse, Lidschlag staucht sie zusammen
            const ry = max(u.eyeOpen.mul(0.19), 0.001);
            const open = smoothstep(1.0, 0.85, length(q.div(vec2(0.13, ry))));
            // geschlossenes Auge: nach unten gebogener Strich
            const closed = stroke(abs(q.y.sub(q.x.mul(q.x).mul(4.0)).add(0.03)), float(0.02)).mul(step(abs(q.x), 0.11));
            // fröhliches Auge: ^
            const caret = stroke(abs(q.y.sub(float(0.035).sub(abs(q.x).mul(0.85)))), float(0.022)).mul(step(abs(q.x), 0.1));
            const shape = mix(select(u.eyeOpen.greaterThan(0.25), open, closed), caret, u.happy);
            eyes.assign(max(eyes, shape));

            // Lichtpunkte in den offenen Augen
            const hl = smoothstep(0.04, 0.03, length(q.sub(vec2(-0.035, 0.06))))
                .add(smoothstep(0.02, 0.012, length(q.sub(vec2(0.03, -0.045)))));
            shine.assign(max(shine, hl.mul(open).mul(oneMinus(u.happy)).mul(step(0.25, u.eyeOpen))));
        }

        // Mund: kleines Lächeln oder offenes "o"
        const m = f.sub(vec2(0, -0.08).add(look.mul(0.5)));
        const smile = stroke(abs(m.y.sub(m.x.mul(m.x).mul(5.0))), float(0.016)).mul(step(abs(m.x), 0.075));
        const oh = smoothstep(1.0, 0.85, length(m.div(vec2(0.06, max(u.mouthOpen.mul(0.075), 0.001)))));
        const mouth = select(u.mouthOpen.greaterThan(0.1), oh, smile);

        // Bäckchen
        const blush = max(
            smoothstep(0.11, 0.0, length(f.sub(vec2(-0.52, -0.04)))),
            smoothstep(0.11, 0.0, length(f.sub(vec2(0.52, -0.04))))
        ).mul(u.blush);

        col.assign(mix(col, cBlush, blush.mul(front).mul(0.8)));
        col.assign(mix(col, cMouth, mouth.mul(front)));
        col.assign(mix(col, cEye, eyes.mul(front)));
        col.assign(mix(col, vec3(1), shine.mul(front)));
        return col;
    })();

    return material;
}

// Weicher Schatten am Boden; wird kleiner und blasser, je höher das Haustier springt
function createShadow() {
    const strength = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const d = length(uv().sub(0.5).mul(2));
    material.colorNode = color('#000000');
    material.opacityNode = smoothstep(1.0, 0.2, d).mul(0.35).mul(strength);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.35), material);
    mesh.renderOrder = -1;
    return { mesh, strength };
}

// Signierte Distanzen für Partikel-Symbole (Koordinaten etwa -1 … 1)
const sdSegment = Fn(([p, a, b]) => {
    const pa = p.sub(a), ba = b.sub(a);
    const h = pa.dot(ba).div(ba.dot(ba)).clamp(0, 1);
    return length(pa.sub(ba.mul(h)));
});

// Herz nach Inigo Quilez
const sdHeart = Fn(([p0]) => {
    const p = vec2(abs(p0.x), p0.y).toVar();
    const upper = length(p.sub(vec2(0.25, 0.75))).sub(Math.SQRT2 / 4);
    const t = max(p.x.add(p.y), 0).mul(0.5);
    const lower = sqrt(min(
        dot(p.sub(vec2(0, 1)), p.sub(vec2(0, 1))),
        dot(p.sub(vec2(t, t)), p.sub(vec2(t, t)))
    )).mul(sign(p.x.sub(p.y)));
    return select(p.y.add(p.x).greaterThan(1), upper, lower);
});

function createParticleMaterials() {
    const heart = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const hp = uv().sub(0.5).mul(2.4).add(vec2(0, 0.55));
    const hd = sdHeart(hp);
    heart.colorNode = mix(cHeart, color('#ffb3cf'), smoothstep(-0.05, -0.25, hd).mul(smoothstep(0.4, 1.2, hp.y)));
    heart.opacityNode = smoothstep(0.03, -0.03, hd);

    const z = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const zp = uv().sub(0.5).mul(2.4);
    const zd = min(min(
        sdSegment(zp, vec2(-0.6, 0.6), vec2(0.6, 0.6)),
        sdSegment(zp, vec2(0.6, 0.6), vec2(-0.6, -0.6))),
        sdSegment(zp, vec2(-0.6, -0.6), vec2(0.6, -0.6)));
    z.colorNode = cZ;
    z.opacityNode = smoothstep(0.2, 0.12, zd);

    return { heart, z };
}

export function createPet() {
    const root = new THREE.Group();          // steht am Boden, Mitte unten

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), createBodyMaterial());
    root.add(body);

    const shadow = createShadow();
    shadow.mesh.position.set(0, 0.02, -1.5);

    const particleMaterials = createParticleMaterials();
    const particles = [];

    function spawn(kind, x, y) {
        const sprite = new THREE.Sprite(particleMaterials[kind]);
        sprite.position.set(x, y, 1.5);
        sprite.userData = { age: 0, life: kind === 'z' ? 2.4 : 1.4, kind, drift: (Math.random() - 0.5) * 0.6 };
        sprite.scale.setScalar(0.01);
        particles.push(sprite);
        return sprite;
    }

    function updateParticles(dt, scene) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const s = particles[i];
            if (!s.parent) scene.add(s);
            const d = s.userData;
            d.age += dt;
            const t = d.age / d.life;
            if (t >= 1) { scene.remove(s); particles.splice(i, 1); continue; }
            s.position.y += dt * (d.kind === 'z' ? 0.45 : 0.9);
            s.position.x += dt * (d.kind === 'z' ? 0.35 + Math.sin(d.age * 3) * 0.3 : d.drift);
            // aufploppen, dann zum Ende hin schrumpfen
            const size = (d.kind === 'z' ? 0.32 + t * 0.25 : 0.6) * Math.min(1, t * 6) * Math.min(1, (1 - t) * 4);
            s.scale.setScalar(Math.max(size, 0.001));
        }
    }

    return { root, body, shadow, spawn, updateParticles };
}
