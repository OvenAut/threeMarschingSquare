// Höhenlinien als Punktreihe: jeder Punkt ist ein zur Kamera gedrehtes Quad (Billboard).
// Feste Größe in der Welt, perspektivisch kleiner; unter min_pixels wird er nicht kleiner,
// sondern dunkler (gegen Flackern). Deckend mit Tiefe -> hintere Punkte werden verdeckt.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform float dot_radius = 0.5;        // Meter
uniform float min_pixels = 2.0;        // kleinster Durchmesser auf dem Bildschirm
uniform float contour_step = 40.0;
uniform float max_height = 900.0;
uniform vec3 neon_cyan : source_color = vec3(0.0, 0.961, 0.831);
uniform vec3 neon_green : source_color = vec3(0.224, 1.0, 0.078);
uniform vec3 haze_color : source_color = vec3(0.102, 0.059, 0.239);

varying vec2 corner;
varying float level;
varying float coverage;

void vertex() {
	corner = UV;
	level = UV2.x;

	vec3 center = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float dist = length(CAMERA_POSITION_WORLD - center);
	// Weltgröße eines Pixels in dieser Entfernung
	float pixel_world = dist * 2.0 / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y);
	float world_radius = dot_radius / 0.8;               // sichtbare Scheibe = 0.8 * Quad
	float min_radius = pixel_world * min_pixels * 0.5 / 0.8;
	float size = max(world_radius, min_radius);
	coverage = (world_radius / size) * (world_radius / size);

	vec4 view = VIEW_MATRIX * vec4(center, 1.0);
	view.xyz += normalize(-view.xyz) * size * 2.0;       // etwas zur Kamera hin
	view.xy += corner * size;
	POSITION = PROJECTION_MATRIX * view;
}

void fragment() {
	ALPHA = 1.0 - smoothstep(0.55, 0.85, length(corner));
	ALPHA_SCISSOR_THRESHOLD = 0.5;

	float major = 1.0 - step(0.01, fract(level / (contour_step * 4.0)));
	vec3 neon = mix(neon_cyan, neon_green, smoothstep(0.0, max_height * 0.5, level))
		* mix(1.3, 1.8, major);
	// Kleine (ferne) Punkte blenden in den Hintergrund aus statt zu flackern
	ALBEDO = mix(haze_color, neon, max(coverage, 0.12));
}
