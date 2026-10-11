import { RepeatWrapping } from 'three';
import { positionWorldDirection, color, float, vec3, time, smoothstep, mx_noise_float, Fn, rtt, uv, mix } from 'three/tsl';

export function createBackground() {
    const dir = positionWorldDirection;
    const horizonFade = smoothstep( 0.01, 0.2, dir.y );

    // Saubere, einheitliche Siemens-Industriegrauwerte
    const baseGray = color( 'rgb(179, 182, 185)' );  
    const cloudGray = color( 'rgb(205, 208, 212)' ); 

    // Perspective Sky Projection für die Wolkenstruktur
    const skyY = dir.y.clamp( 0.001, 1.0 ).pow( 0.7 ).max( 0.08 );
    const perspectivePos = vec3( dir.x.div( skyY ), float( 1.0 ), dir.z.div( skyY ) );

    // Volumetric FBM Cloud Noise RTT
    const rttScale = float( 0.02 );

    const noise = Fn( ( [ coord ] ) => {
        const p = vec3( coord.x, float( 1.0 ), coord.y ).div( rttScale );
        const wind = vec3( time.mul( 0.03 ), 0.0, time.mul( 0.005 ) );
        const animatedP = p.mul( 0.3 ).add( wind );

        const n1 = mx_noise_float( animatedP ).mul( 0.5 ).add( 0.5 ).mul( 0.50 );
        const n2 = mx_noise_float( animatedP.mul( 2.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.25 );
        const n3 = mx_noise_float( animatedP.mul( 4.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.125 );
        const n4 = mx_noise_float( animatedP.mul( 8.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.0625 );

        return n1.add( n2 ).add( n3 ).add( n4 );
    } );

    const cloudNoiseRTT = rtt( noise( uv() ), 512, 512, { wrapS: RepeatWrapping, wrapT: RepeatWrapping } );
    const cloudNoise = ( perspectiveCoord ) => cloudNoiseRTT.sample( perspectiveCoord.xz.mul( rttScale ).add( 0.5 ) ).x;

    const fbmVal = cloudNoise( perspectivePos );
    const cloudDensity = smoothstep( 0.25, 0.55, fbmVal ).mul( horizonFade ).clamp( 0.0, 1.0 );

    // Konstanter, ruhiger Hintergrund in Siemens-Grau mit dezenten Wolken
    const finalBackground = mix( baseGray, cloudGray, cloudDensity.mul( 0.25 ) );

    return {
        backgroundNode: finalBackground
    };
}