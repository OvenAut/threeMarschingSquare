// Nachthimmel: violetter Dunst am Horizont, Nebelschwaden, Sterne.
shader_type sky;

uniform vec3 horizon_color : source_color = vec3(0.102, 0.059, 0.239);
uniform vec3 zenith_color : source_color = vec3(0.027, 0.024, 0.094);
uniform vec3 aurora_color : source_color = vec3(0.231, 0.114, 0.431);
uniform vec3 nebula_color : source_color = vec3(0.353, 0.165, 0.604);

// Hash ohne sin (Dave Hoskins): unempfindlich gegen Rundung -> keine Kanten an Zellgrenzen
float hash3(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	float n000 = hash3(i);
	float n100 = hash3(i + vec3(1, 0, 0));
	float n010 = hash3(i + vec3(0, 1, 0));
	float n110 = hash3(i + vec3(1, 1, 0));
	float n001 = hash3(i + vec3(0, 0, 1));
	float n101 = hash3(i + vec3(1, 0, 1));
	float n011 = hash3(i + vec3(0, 1, 1));
	float n111 = hash3(i + vec3(1, 1, 1));
	return mix(
		mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
		mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
		u.z);
}

float fbm3(vec3 p) {
	float sum = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		sum += noise3(p) * amp;
		p *= 2.03;
		amp *= 0.5;
	}
	return sum;
}

void sky() {
	vec3 dir = EYEDIR;
	float aurora = smoothstep(0.2, 1.0, sin(atan(dir.z, dir.x) * 3.0 + 0.7)) * 0.6;
	vec3 haze = mix(horizon_color, aurora_color, aurora);
	vec3 color = mix(haze, zenith_color, smoothstep(0.0, 0.35, dir.y));

	// Violette Nebelschwaden über dem Horizont
	float nebula = smoothstep(0.5, 0.8, fbm3(dir * 2.5 + 7.0))
		* smoothstep(-0.02, 0.08, dir.y) * (1.0 - smoothstep(0.15, 0.45, dir.y));
	color = mix(color, nebula_color, nebula * 0.5);

	// Sternenstaub
	float r = hash3(floor(dir * 420.0));
	float star = step(0.9965, r) * smoothstep(0.05, 0.4, dir.y) * (r - 0.9965) * 250.0;
	COLOR = color + vec3(star * 0.8, star * 0.85, star);
}
