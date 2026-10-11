import * as THREE from 'three';
import { LineDashedNodeMaterial } from 'three/webgpu';
import { color, uniform,select } from 'three/tsl';

export function createBoxMaterial() {
    // Uniform für den Zustand: 0 = Normal, 1 = Warning, 2 = Alarm
    const u_state = uniform( 0 );

    // Farben definieren
    const normalBase = color( 'rgb(38, 39, 41)' );     // Dunkles Normal-Grau
    const warningBase = color( 'rgb(234, 206, 16)' ).mul(1.7);  // Warning Gelb
    const alarmBase = color( 'rgb(222, 56, 88)' );     // Siemens Alarm-Rot
    
    // Alarm bekommt den HDR-Faktor (3.0) für den Neon-Glow (Bloom)
    const alarmGlow = alarmBase.mul( 6.0 );

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