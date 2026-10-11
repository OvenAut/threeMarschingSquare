// Gelände: dunkle, leicht glänzende Fläche, Drahtgitter nur als Radar-Ping, Senken als dunkle Seen.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform float wire_size = 10.0;          // Maschenweite des Drahtgitters (Meter)
uniform float ping_interval = 10.0;      // alle x Sekunden ein neuer Ping
uniform float ping_duration = 1.5;       // Laufzeit einer Welle
uniform float ping_range = 2500.0;       // so weit läuft die Welle (Meter)
uniform float ping_width = 400.0;        // Länge des Schweifs hinter der Welle
uniform float max_height = 900.0;
uniform vec3 moon_dir = vec3(-0.4, 0.7, -0.5);

uniform vec3 ground_color : source_color = vec3(0.020, 0.031, 0.078);
uniform vec3 ground_high : source_color = vec3(0.043, 0.063, 0.188);
uniform vec3 wire_color : source_color = vec3(0.086, 0.784, 0.753);
uniform vec3 lake_color : source_color = vec3(0.039, 0.102, 0.290);
uniform vec3 haze_color : source_color = vec3(0.102, 0.059, 0.239);

varying vec3 world_pos;
varying vec3 world_normal;
varying float raw_height;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	raw_height = UV.x;
}

void fragment() {
	vec3 view_dir = normalize(CAMERA_POSITION_WORLD - world_pos);
	float lake = 1.0 - step(0.0, raw_height);

	// Boden: dunkel mit Mondlicht
	float diffuse = max(dot(world_normal, normalize(moon_dir)), 0.0);
	vec3 ground = mix(ground_color, ground_high, smoothstep(0.0, max_height * 0.6, raw_height))
		* (diffuse * 0.6 + 0.6);

	// Drahtgitter, folgt der Oberfläche; in der Ferne ausgeblendet (gegen Flimmern)
	vec2 g = world_pos.xz / wire_size;
	vec2 w = max(fwidth(g), vec2(0.0001));
	vec2 gd = min(fract(g), 1.0 - fract(g)) / w;
	float wire_line = 1.0 - smoothstep(0.0, 1.0, min(gd.x, gd.y));
	float wire_fade = 1.0 - smoothstep(0.1, 0.45, max(w.x, w.y));

	// Radar-Ping: Ring läuft von der Kamera nach außen, nur dort leuchtet das Gitter
	float progress = fract(TIME / ping_interval) * (ping_interval / ping_duration);
	float radius = progress * ping_range;
	float behind = radius - length(world_pos.xz - CAMERA_POSITION_WORLD.xz);
	float front = smoothstep(-15.0, 0.0, behind);
	float tail = 1.0 - smoothstep(0.0, ping_width, behind);
	float life = 1.0 - smoothstep(0.55, 1.0, progress);
	float ping = front * tail * tail * life;
	ground += wire_color * wire_line * wire_fade * ping * 1.4 * (1.0 - lake);

	// Leichter Glanz bei flachem Blick
	float fresnel = pow(1.0 - max(view_dir.y, 0.0), 4.0);
	ground += haze_color * fresnel * 0.35;

	// Seen: dunkelblau, spiegeln den Himmel bei flachem Blick
	vec3 water = mix(lake_color, haze_color * 1.3, fresnel * 0.7);

	ALBEDO = mix(ground, water, lake);
}
