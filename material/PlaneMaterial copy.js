import * as THREE from 'three';
import { 
    Fn, float, fract, fwidth, abs, saturate, max, smoothstep, length, positionWorld, vec4,
    reflector ,color
} from 'three/tsl';
import { MeshBasicNodeMaterial,MeshStandardNodeMaterial } from 'three/webgpu'

// 1. TSL-Hilfsfunktionen (sind nur in dieser Datei gültig)
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

const fade = Fn( ( [ radius = float( 10.0 ), falloff = float( 1.0 ) ] ) => {
    return smoothstep( radius, radius.sub( falloff ), length( positionWorld ) );
} );

// 2. Die Funktion, die du in die main_2.js exportierst
export function createPlaneMaterial() {
// 1. Weniger Roughness, etwas mehr Metalness für einen glatten Industrieboden
    //const floorMaterial = new MeshStandardNodeMaterial( { roughness: 0.2, metalness: 0.3 } );
    const floorMaterial = new MeshBasicNodeMaterial( );

    const gridColor = vec4( color( new THREE.Color("rgb(177, 179, 182)") ), 1.0 );
    const baseColor = vec4( color( new THREE.Color("rgb(179, 182, 185)") ), 1.0 ); 

    // 2. Den Reflektor erstellen und flach auf den Boden legen
    const reflection = reflector( { resolutionScale: 1 } );
    reflection.target.rotateX( - Math.PI / 2 );

    // NEU: Die interne Kamera des Reflektors soll Layer 2 komplett ignorieren!
    if (reflection.target.camera) {
        reflection.target.camera.layers.disable(2);
    }
    // 3. Die Reflektion in die Bodenfarbe mischen. 
    // Der Wert mul(0.2) bestimmt, wie stark der Boden spiegelt (0.2 = leicht)
    const floorColor = gridTexture( positionWorld.xz, 0.02, 0.05 )
                        .mix( baseColor, gridColor )
                        .add( reflection.mul( 0.1 ) );
    
    floorMaterial.colorNode = floorColor;
    floorMaterial.transparent = true;
    floorMaterial.opacityNode = fade( 25.0, 15.0 ); 

    // 4. Material UND Reflektions-Kamera zurückgeben
    return {
        material: floorMaterial,
        reflectionTarget: reflection.target
    };
}