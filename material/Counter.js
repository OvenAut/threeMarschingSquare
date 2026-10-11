import * as THREE from 'three';
import { 
    MeshBasicNodeMaterial
} from 'three/webgpu';
import { 
    texture, uv, time, sin, step, mix, color, float, uniform 
} from 'three/tsl';

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