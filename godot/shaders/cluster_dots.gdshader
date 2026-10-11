// Pinke Datenpunkte (MultiMesh aus Quads): Billboard, additiv, pulsierend mit eigener Phase.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;

uniform vec3 neon_pink : source_color = vec3(1.0, 0.0, 0.498);

varying float pulse;

void vertex() {
	vec3 center = MODEL_MATRIX[3].xyz;
	float phase = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
	pulse = sin(TIME * 2.2 + phase) * 0.5 + 0.5;

	float dist = length(CAMERA_POSITION_WORLD - center);
	float size = max(dist * 0.012, 6.0) * (pulse * 0.35 + 0.8);

	// Billboard: Rotation der Kamera übernehmen, Position des Punkts behalten
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	VERTEX *= size;
}

void fragment() {
	float d = length(UV - 0.5) * 2.0;
	float core = 1.0 - smoothstep(0.1, 0.22, d);
	float glow = pow(max(1.0 - d, 0.0), 3.0);
	ALBEDO = neon_pink * (core * 4.0 + glow * 1.4) * (pulse * 0.6 + 0.6);
	ALPHA = min(core + glow, 1.0);
}
