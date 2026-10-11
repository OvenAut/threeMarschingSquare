import * as THREE from 'three';
import { 
    Fn, float, fract, fwidth, abs, saturate, max, smoothstep, length, positionWorld, vec4,
    reflector, color, sin, mix, uv , mx_noise_float
} from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

// 1. Prozedurale Noise-Funktion für Abnutzungsspuren und Schmutz
const noiseFn = Fn( ( [ coord ] ) => {
    // Ein einfacher, performanter mathematischer Hash (Pseudo-Random Noise)
    const x = coord.x.mul(12.9898).add(coord.y.mul(78.233));
    return fract(sin(x).mul(43758.5453));
});

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

const fade = Fn( ( [ radius = float( 10.0 ), falloff = float( 1.0 ) ] ) => {
    return smoothstep( radius, radius.sub( falloff ), length( positionWorld ) );
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