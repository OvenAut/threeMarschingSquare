import * as THREE from 'three';
import { uniform, mix, uv, length, smoothstep, color, positionLocal, float,cameraPosition,vec3,vec4 } from 'three/tsl';
import { SpriteNodeMaterial } from 'three/webgpu';

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