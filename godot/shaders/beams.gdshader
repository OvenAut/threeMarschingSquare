// Feine senkrechte Lichtstrahlen über einigen pinken Punkten, nach oben ausgeblendet (UV.x 0..1).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never;

uniform vec3 neon_pink : source_color = vec3(1.0, 0.0, 0.498);

varying float t;

void vertex() {
	t = UV.x;
}

void fragment() {
	ALBEDO = neon_pink * (1.0 - t) * 1.2;
}
