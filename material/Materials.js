import * as THREE from 'three';
import { 
    Fn, float, fract, fwidth, abs, saturate, max, smoothstep, length, positionWorld, vec4,
    reflector, color, sin, mix, uv , mx_noise_float ,uniform,positionLocal,cameraPosition, texture, time ,step ,select
} from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial,SpriteNodeMaterial ,LineDashedNodeMaterial } from 'three/webgpu';


// 2. TSL-Hilfsfunktionen für Grid und Fade
const gridTexture = Fn( ( [ coord, lineWidth = float( 0.01 ), dotSize = float( 0.03 ) ] ) => {
    const g = fract( coord );
    const fw = fwidth( coord );
    const gx = abs( g.x.sub( 0.5 ) );
    const gy = abs( g.y.sub( 0.5 ) );

    const lineX = saturate( lineWidth.sub( gx ).div( fw.x ).add( 0.5 ) );
    const lineY = saturate( lineWidth.sub( gy ).div( fw.y ).add( 0.5 ) );
    const lines = max( lineX, lineY );

    const squareDist = max( gx, gy );
    const aa = max( fw.x, fw.y );
    const dots = smoothstep( dotSize.add( aa ), dotSize.sub( aa ), squareDist );

    return max( dots, lines );
} );



// NEU: Radialer UV-Fade für weiche, runde Ränder ohne harte Kanten
const radialFade = Fn( () => {
    // UV-Mitte ist bei (0.5, 0.5). Wir berechnen den Abstand vom Zentrum.
    const centerDist = length( uv().sub( 0.5 ) );
    
    // Steuert, ab welchem Radius nach außen hin weich ausgeblendet wird
    // (0.4 = innerer Kern bleibt scharf, läuft zum Rand bei ~0.5 sanft aus)
    return smoothstep( 0.5, 0.25, centerDist );
} );

// 3. Die Funktion für die main_2.js
export function createPlaneMaterial() {
    const floorMaterial = new MeshBasicNodeMaterial();

    const gridColor = vec4( color( new THREE.Color("rgb(171, 180, 187)") ), 1.0 );
    const baseColor = vec4( color( new THREE.Color("rgb(181, 190, 197)") ), 1.0 ); 

    // Reflektor erstellen und flach auf den Boden legen
    const reflection = reflector( { resolutionScale: 1 } );
    reflection.target.rotateX( - Math.PI / 2 );

    if (reflection.target.camera) {
        reflection.target.camera.layers.disable(2);
    }

    // --- NEU: Abnutzungsspuren via Noise einrechnen ---
    // Wir skalieren positionWorld.xz, damit die "Flecken" eine realistische Größe bekommen
    //const wearNoise = noiseFn( positionWorld.xz.mul( .1 ) );
    const wearNoise = mx_noise_float( uv().mul( 50.0 ) );
    
    // Wir mischen den Noise dezent in die Basis-Farbe ein (z.B. 10% Abweichung für den "Used-Look")
    const wornBaseColor = mix( baseColor, gridColor, wearNoise.mul( 0.3 ) );
    const wornGridColor = mix( gridColor, baseColor, wearNoise.mul( 0.3 ) )
    // Bodenfarbe zusammensetzen mit Grid, veränderter Basis und Reflektion
    const floorColor = gridTexture( positionWorld.xz, 0.02, 0.05 )
                        .mix( wornBaseColor, wornGridColor )
                        .add( reflection.mul( 0.1 ) );
    
    floorMaterial.colorNode = floorColor;
    floorMaterial.transparent = true;
    floorMaterial.opacityNode = radialFade();//fade( 25.0, 15.0 ); 

    return {
        material: floorMaterial,
        reflectionTarget: reflection.target
    };
}


export function createEsMaterial() {
    // 1. Eigene Uniforms für DIESES EINE Material erstellen
    const u_progress = uniform(0.0);
    const u_max_scale = uniform(35.0);
    const u_active = uniform(0.0);

    const colorOk = vec4(color("rgb(94,209,173)"),0.2);    // Grün
    const colorAlarm = uniform(color("rgb(222,56,88)")); // Rot

    // 2. Material erstellen
    const material = new SpriteNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        //alphaTest: 0.5, // NEU: Schwellenwert (alles unter 0.5 wird verworfen)
       blending: THREE.NormalBlending
    });

    // --- VERTEX LOGIK ---
    const currentScale = mix(u_max_scale, float(1.0), u_progress);
    material.positionNode = positionLocal.mul(currentScale);

    // --- FRAGMENT LOGIK ---
//    const centerUv = uv().mul(2.0).sub(1.0);
//    const dist = length(centerUv);
//    const circleAlpha = float(1.0).sub(smoothstep(0.95, 1.0, dist));
//    
//    const finalColor = mix(colorOk, colorAlarm, u_active);
//    const finalOpacity = u_progress.mul(circleAlpha);
//    material.colorNode = finalColor;
//    material.opacityNode = finalOpacity;

//finalOpacity = cameraPosition.y.lessThan(-0.1).select(float(0.0), finalOpacity);

    const centerUv = uv().mul(2.0).sub(1.0);
    const dist = length(centerUv);
    const circleAlpha = float(1.0).sub(smoothstep(0.95, 1.0, dist));
    
    const finalColor = mix(colorOk, colorAlarm, u_active);
    
    // Die Deckkraft ganz normal als Konstante berechnen
    const baseOpacity = u_progress.mul(circleAlpha);

    material.colorNode = finalColor;
    
    // Die Weiche für die Kamera-Position direkt hier bei der Zuweisung anwenden:
    // Ist die Kamera unter dem Boden (y < -0.1), ist die Deckkraft 0.0, sonst baseOpacity.
    material.opacityNode = cameraPosition.y.lessThan(-0.1).select(float(0.0), baseOpacity);

   

    // 3. TSL-Uniforms an das Material binden, damit main.js sie steuern kann
    material.userData.tslUniforms = {
        u_progress,
        u_active,
        u_max_scale
    };

    return material;
}

export function createCounter( initialValue = 0, maxValue = 100, customColor = 'rgb(0, 161, 209)' ) {

    // --- 1. CANVAS FÜR DIE FÜLLUNG (WASSER) ---
    const fillCanvas = document.createElement('canvas');
    fillCanvas.width = 512;
    fillCanvas.height = 220;
    const fillCtx = fillCanvas.getContext('2d');
    
    const fillTexture = new THREE.CanvasTexture(fillCanvas);
    fillTexture.minFilter = THREE.LinearFilter; 
    fillTexture.magFilter = THREE.LinearFilter;

    // --- 2. CANVAS FÜR DIE SCHWARZE OUTLINE ---
    const outlineCanvas = document.createElement('canvas');
    outlineCanvas.width = 512;
    outlineCanvas.height = 220;
    const outlineCtx = outlineCanvas.getContext('2d');
    
    const outlineTexture = new THREE.CanvasTexture(outlineCanvas);
    outlineTexture.minFilter = THREE.LinearFilter; 
    outlineTexture.magFilter = THREE.LinearFilter;

    let currentValue = initialValue;

    // --- TSL SHADER LOGIK (Für das Wasser) ---
    const u_progress = uniform(float(0.0));
    const texNode = texture(fillTexture);
    const solidMask = texNode.r; 

    const currentY = uv().y;
    const yOffset = float(0.10);
    const adjustedY = currentY.sub(yOffset);

    const waveAmplitude = sin(u_progress.mul(Math.PI)).mul(0.04); 
    const waveSpeed = Math.PI / 3.0; 
    const wave = sin(uv().x.mul(20.0).add(time.mul(waveSpeed))).mul(waveAmplitude);
    const fillLevel = u_progress.add(wave);

    const isFilled = step(currentY, fillLevel);
    const colorEmpty = color('rgb(181, 190, 197)');
    const colorWater = color(customColor).mul(1.0);   

    // Farbe je nach Füllstand umschalten (Grau oben, Wasser unten)
    const bodyColor = mix(colorEmpty, colorWater, isFilled);
    // Material für das Wasser (Node-basiert)
    const waterMaterial = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
    });
    waterMaterial.colorNode = bodyColor;
    waterMaterial.opacityNode = solidMask;

    // --- MATERIAL FÜR DIE OUTLINE (WebGPU-kompatibel via Node Material) ---
    const outlineMaterial = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
    });
    // Textur direkt als Color-Node übergeben (zeichnet die schwarze Outline sauber auf)
    outlineMaterial.colorNode = texture(outlineTexture);

    // --- RENDER FUNKTIONEN ---
    const renderCanvases = (value) => {
        const safeValue = isNaN(value) || value === null ? 0 : value;
        const formattedValue = safeValue.toString().padStart(4, '0');
        const centerX = fillCanvas.width / 2;
        const centerY = fillCanvas.height / 2;
        const fontStyle = 'bold 220px Consolas, monospace';

        // A) Füll-Canvas zeichnen
        fillCtx.fillStyle = '#000000'; 
        fillCtx.fillRect(0, 0, fillCanvas.width, fillCanvas.height);
        fillCtx.font = fontStyle;
        fillCtx.textAlign = 'center';
        fillCtx.textBaseline = 'middle';
        fillCtx.fillStyle = '#ff0000'; 
        fillCtx.fillText(formattedValue, centerX, centerY);
        fillTexture.needsUpdate = true;

        // B) Outline-Canvas zeichnen (Tiefschwarz auf transparentem Grund)
        outlineCtx.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
        outlineCtx.font = fontStyle;
        outlineCtx.textAlign = 'center';
        outlineCtx.textBaseline = 'middle';
        outlineCtx.strokeStyle = '#000000'; 
        outlineCtx.lineWidth = 6;
        outlineCtx.strokeText(formattedValue, centerX, centerY);
        outlineTexture.needsUpdate = true;

        u_progress.value = Math.min(Math.max(safeValue / maxValue, 0.0), 1.0);
    };

    renderCanvases(initialValue);

    // --- MESHS ERSTELLEN UND GRUPPIEREN ---
    const geometry = new THREE.PlaneGeometry(1, 0.5);

    const waterMesh = new THREE.Mesh(geometry, waterMaterial);
    
    // Outline-Mesh minimal nach vorne versetzt, um Z-Fighting zu verhindern
    const outlineMesh = new THREE.Mesh(geometry, outlineMaterial);
    outlineMesh.position.z = 0.002; 

    const group = new THREE.Group();
    group.add(waterMesh);
    group.add(outlineMesh);

    return {
        mesh: group,
        increment: (amount = 1) => {
            currentValue += amount;
            renderCanvases(currentValue);
            return currentValue;
        },
        reset: () => {
            currentValue = initialValue;
            renderCanvases(currentValue);
            return currentValue;
        },
        setValue: (amount) => {
             currentValue = amount;
             renderCanvases(currentValue);
        },
        getValue: () => currentValue
    };
}

export function createBoxMaterial() {
    // Uniform für den Zustand: 0 = Normal, 1 = Warning, 2 = Alarm
    const u_state = uniform( 0 );

    // Farben definieren
    const normalBase = color( 'rgb(38, 39, 41)' );     // Dunkles Normal-Grau
    const warningBase = color( 'rgb(234, 206, 16)' ).mul(1.2);  // Warning Gelb
    const alarmBase = color( 'rgb(222, 56, 88)' );     // Siemens Alarm-Rot
    
    // Alarm bekommt den HDR-Faktor (3.0) für den Neon-Glow (Bloom)
    const alarmGlow = alarmBase.mul( 3.0 );

// TSL-Bedingung: Wenn state == 1 -> Warning, wenn state == 2 -> Alarm mit Glow, sonst Normal
    const dynamicColor = select( 
        u_state.equal( 1 ), 
        warningBase, 
        select( u_state.equal( 2 ), alarmGlow, normalBase ) 
    );

    // Das einzige Material erstellen
    const material = new LineDashedNodeMaterial({
        dashSize: 1.4,
        gapSize: 0.1
    });
    
    material.colorNode = dynamicColor;

    return {
        material: material,
        
        // Zentrale Methode zum Setzen des Zustands (0, 1 oder 2)
        setState: ( state ) => {
            u_state.value = state;
        }
    };
}