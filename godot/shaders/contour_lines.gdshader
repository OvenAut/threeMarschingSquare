// Durchgehende Linien: Küste neongrün (immer), im Stil "lines" auch alle Höhenlinien.
// In der Ferne ausgeblendet, damit die 1-Pixel-Linien nicht flimmern.
shader_type spatial;
render_mode unshaded;

uniform float coast_intensity = 1.15;
uniform float contour_step = 40.0;
uniform float max_height = 900.0;
uniform vec3 neon_cyan : source_color = vec3(0.0, 0.961, 0.831);
uniform vec3 neon_green : source_color = vec3(0.224, 1.0, 0.078);
uniform vec3 haze_color : source_color = vec3(0.102, 0.059, 0.239);

varying vec3 world_pos;
varying float level;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	level = UV.x;
}

void fragment() {
	float coast = 1.0 - step(0.5, abs(level));
	float major = 1.0 - step(0.01, fract(level / (contour_step * 4.0)));
	vec3 neon = mix(neon_cyan, neon_green, smoothstep(0.0, max_height * 0.5, level)) * mix(1.7, 2.6, major);
	neon = mix(neon, neon_green * coast_intensity, coast);

	float dist = length(world_pos - CAMERA_POSITION_WORLD);
	float fade = smoothstep(1500.0, 6000.0, dist) * 0.8;
	ALBEDO = mix(neon, haze_color, fade);
}
