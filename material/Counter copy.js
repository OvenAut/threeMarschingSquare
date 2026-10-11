import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    texture
} from 'three/tsl';

export function createCounter( initialValue = 0 ) {

    // 1. Unsichtbares 2D Canvas erstellen (Zweierpotenzen wie 256x128 sind optimal für GPUs)
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    // 2. Three.js Textur aus dem Canvas erstellen
    const canvasTexture = new THREE.CanvasTexture(canvas);
    
    // Für scharfe Kanten bei Text-Texturen in WebGPU
    canvasTexture.minFilter = THREE.LinearFilter; 
    canvasTexture.magFilter = THREE.LinearFilter;

    // 3. TSL Material erstellen
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: true
    });
    
    // Die Canvas-Textur als Farbe übergeben
    material.colorNode = texture(canvasTexture);

    // 4. Update-Funktion: Wird nur aufgerufen, wenn sich der Stückzähler ändert
    const updateValue = (value) => {
        // Canvas leeren
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Hintergrund (optional, z.B. dunkles Display-Glas)
        context.fillStyle = 'rgba(20, 25, 30, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        // Text zeichnen (Industrie-Look)
        context.font = 'bold 80px "Siemens AD Sans", monospace';
        context.fillStyle = '#00ffcc'; // Dein Mintgrün oder Alarm-Rot
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        console.log(value);
        // Führende Nullen hinzufügen (z.B. "0042")
        const formattedValue = value.toString().padStart(4, '0');
        context.fillText(formattedValue, canvas.width / 2, canvas.height / 2);
        
        // WICHTIG: Sagt WebGPU, dass die Textur neu in den VRAM geladen werden muss
        canvasTexture.needsUpdate = true;
    };

    // 5. Plane erstellen und initiale Zahl zeichnen
    updateValue(initialValue);
    
    // Eine simple flache Geometrie, passend zum Seitenverhältnis des Canvas (2:1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), material);

    return {
        mesh: mesh,
        update: updateValue
    };
}