# Neon-Terrain (Port der Three.js-Version): Flug über endloses, gekacheltes Gelände.
extends Node3D

const Height = preload("res://scripts/height.gd")
const ChunkBuilder = preload("res://scripts/chunk_builder.gd")

# ---------------------------------------------------------------------------
# Einstellungen
# ---------------------------------------------------------------------------
const CHUNK_SIZE := 1024.0              # Kantenlänge einer Kachel (Meter)
const VIEW_DISTANCE := 12000.0          # bis hierhin werden Kacheln geladen
# Detailstufe je Entfernung: [bis Entfernung, Zellen pro Kachelseite]
# (gröber als im Browser, weil GDScript die Höhenfunktion langsamer rechnet)
const LOD_STEPS := [[1500.0, 64], [4000.0, 32], [8000.0, 16], [INF, 8]]
const MAX_PARALLEL_JOBS := 4            # gleichzeitig rechnende Worker-Threads

const CONTOUR_STYLE := "dots"           # "dots" = Punktreihen, "lines" = durchgehende Linien
const START_ALTITUDE := 1000.0

const CLUSTER_CHANCE := 0.3             # Anteil der Kacheln mit pinkem Punkt-Cluster
const CLUSTER_SIZE := Vector2i(8, 24)   # Punkte pro Cluster (min, max)
const CLUSTER_RADIUS := 140.0
const BEAM_CHANCE := 0.12               # Anteil der Punkte mit Lichtstrahl
const BEAM_HEIGHT := 160.0
const MAX_DOTS := 16384

# ---------------------------------------------------------------------------
var aircraft: Node3D
var camera: Camera3D
var hud: Label

var speed := 80.0
var roll_rate := 0.0
var pitch_rate := 0.0
var yaw_rate := 0.0
var leveling := false

var view_mode := "cockpit"              # "cockpit" oder "free" (Taste V)
var head_yaw := 0.0
var head_pitch := 0.0
var head_dragging := false

var terrain_material: ShaderMaterial
var line_material: ShaderMaterial
var dot_material: ShaderMaterial
var cluster_multimesh: MultiMesh
var beam_mesh: ArrayMesh
var beam_material: ShaderMaterial

var chunks := {}                        # Vector2i -> { node, cells, requested }
var request_queue := []
var jobs := []                          # laufende Worker-Jobs
var chunk_timer := 0.0
var last_wanted_keys := ""


func _ready() -> void:
	_setup_environment()

	aircraft = Node3D.new()
	aircraft.position = Vector3(0.0, START_ALTITUDE, 0.0)
	add_child(aircraft)

	camera = Camera3D.new()
	camera.fov = 65.0
	camera.near = 1.0
	camera.far = 30000.0
	aircraft.add_child(camera)
	camera.current = true

	terrain_material = _shader_material("res://shaders/terrain.gdshader")
	line_material = _shader_material("res://shaders/contour_lines.gdshader")
	dot_material = _shader_material("res://shaders/contour_dots.gdshader")
	_create_clusters()
	_create_hud()
	_handle_screenshot_arg()


# Testhilfe: "godot --path . -- --screenshot=C:/pfad/bild.png" speichert nach 20 s ein Bild und beendet
func _handle_screenshot_arg() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--altitude="):
			aircraft.position.y = float(arg.trim_prefix("--altitude="))
		if arg.begins_with("--speed="):
			speed = float(arg.trim_prefix("--speed="))
		if arg.begins_with("--pitch="):
			aircraft.rotate_object_local(Vector3.RIGHT, deg_to_rad(float(arg.trim_prefix("--pitch="))))
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--screenshot="):
			var path := arg.trim_prefix("--screenshot=")
			await get_tree().create_timer(20.0).timeout
			get_viewport().get_texture().get_image().save_png(path)
			get_tree().quit()


func _shader_material(path: String) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = load(path)
	return material


func _setup_environment() -> void:
	var sky_material := _shader_material("res://shaders/sky.gdshader")
	var sky := Sky.new()
	sky.sky_material = sky_material

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	# Glow (Bloom): Neon-Werte > 1 leuchten
	env.glow_enabled = true
	env.glow_intensity = 0.9
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 0.95
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	# Violetter Dunst bis zum Horizont
	env.fog_enabled = true
	env.fog_light_color = Color("#1a0f3d")
	env.fog_density = 0.00016
	env.fog_sky_affect = 0.0

	var world_env := WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)


# ---------------------------------------------------------------------------
# Eingabe
# ---------------------------------------------------------------------------
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_R:
				leveling = true
			KEY_V:
				_toggle_view()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		head_dragging = event.pressed and view_mode == "free"
	elif event is InputEventMouseMotion and head_dragging:
		head_yaw -= event.relative.x * 0.004
		head_pitch = clampf(head_pitch - event.relative.y * 0.004, -1.45, 1.45)


func _axis(positive: Key, negative: Key) -> float:
	return (1.0 if Input.is_physical_key_pressed(positive) else 0.0) \
		- (1.0 if Input.is_physical_key_pressed(negative) else 0.0)


func _toggle_view() -> void:
	view_mode = "free" if view_mode == "cockpit" else "cockpit"
	# Kopf beim Wechsel wieder nach vorne
	head_yaw = 0.0
	head_pitch = 0.0
	head_dragging = false


# ---------------------------------------------------------------------------
# Loop
# ---------------------------------------------------------------------------
func _process(delta: float) -> void:
	delta = minf(delta, 0.05)
	var ground := _update_flight(delta)
	camera.rotation = Vector3(head_pitch, head_yaw, 0.0) if view_mode == "free" else Vector3.ZERO

	chunk_timer -= delta
	if chunk_timer <= 0.0:
		chunk_timer = 0.2
		_update_chunks()
	_collect_jobs()
	_dispatch_jobs()
	_update_hud(ground)


func _update_flight(delta: float) -> float:
	# W beschleunigt, S bremst
	speed = clampf(speed + _axis(KEY_W, KEY_S) * 120.0 * delta, 0.0, 700.0)

	# Sanft auf Zielrate zulaufen
	var response := minf(1.0, delta * 5.0)
	roll_rate += (_axis(KEY_A, KEY_D) * 1.8 - roll_rate) * response
	pitch_rate += (_axis(KEY_UP, KEY_DOWN) * 0.9 - pitch_rate) * response
	yaw_rate += (_axis(KEY_Q, KEY_E) * 0.5 - yaw_rate) * response

	aircraft.rotate_object_local(Vector3.BACK, roll_rate * delta)
	aircraft.rotate_object_local(Vector3.RIGHT, pitch_rate * delta)
	aircraft.rotate_object_local(Vector3.UP, yaw_rate * delta)

	# Schräglage erzeugt eine Kurve (wie beim Flugzeug)
	var right := aircraft.basis.x
	aircraft.rotate(Vector3.UP, right.y * 0.9 * delta)

	# R: sanft gerade stellen; Rollen/Nicken durch den Piloten bricht ab
	if _axis(KEY_A, KEY_D) != 0.0 or _axis(KEY_UP, KEY_DOWN) != 0.0:
		leveling = false
	if leveling:
		var euler := aircraft.basis.get_euler(EULER_ORDER_YXZ)
		var target := Quaternion.from_euler(Vector3(0.0, euler.y, 0.0))
		aircraft.quaternion = aircraft.quaternion.slerp(target, minf(1.0, delta * 2.5))
		if aircraft.quaternion.angle_to(target) < 0.002:
			aircraft.quaternion = target
			leveling = false

	aircraft.position += -aircraft.basis.z * speed * delta

	# Nicht in den Boden fliegen
	var ground := Height.surface_height(aircraft.position.x, aircraft.position.z)
	if aircraft.position.y < ground + 4.0:
		aircraft.position.y = ground + 4.0
	return ground


# ---------------------------------------------------------------------------
# Kachel-Verwaltung: Kacheln rund um das Flugzeug in Worker-Threads berechnen und nachladen
# ---------------------------------------------------------------------------
func _lod_for_distance(distance: float) -> int:
	for step in LOD_STEPS:
		if distance < step[0]:
			return step[1]
	return LOD_STEPS[-1][1]


func _update_chunks() -> void:
	var pos := aircraft.position
	var center_x := int(floorf(pos.x / CHUNK_SIZE))
	var center_z := int(floorf(pos.z / CHUNK_SIZE))
	var radius := int(ceilf(VIEW_DISTANCE / CHUNK_SIZE))
	var wanted := {}

	for dz in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			var key := Vector2i(center_x + dx, center_z + dz)
			var origin := Vector2(key.x * CHUNK_SIZE, key.y * CHUNK_SIZE)
			var near_x := clampf(pos.x, origin.x, origin.x + CHUNK_SIZE)
			var near_z := clampf(pos.z, origin.y, origin.y + CHUNK_SIZE)
			var distance := Vector2(near_x - pos.x, near_z - pos.z).length()
			if distance > VIEW_DISTANCE:
				continue
			wanted[key] = { "origin": origin, "distance": distance, "cells": _lod_for_distance(distance) }

	# Pinke Cluster nur neu verteilen, wenn sich die Kachelmenge geändert hat
	var wanted_keys := str(wanted.keys())
	if wanted_keys != last_wanted_keys:
		last_wanted_keys = wanted_keys
		_update_clusters(wanted.keys())

	# Kacheln außer Sichtweite entfernen (Speicher wird mit queue_free freigegeben)
	for key in chunks.keys():
		if not wanted.has(key):
			_free_chunk(chunks[key])
			chunks.erase(key)

	# Fehlende oder falsche Detailstufe anfordern, nächste zuerst
	request_queue.clear()
	for key in wanted:
		var info: Dictionary = wanted[key]
		var chunk: Dictionary = chunks.get(key, {})
		if not chunk.is_empty() and (chunk.cells == info.cells or chunk.requested == info.cells):
			continue
		request_queue.append({ "key": key, "origin": info.origin, "distance": info.distance, "cells": info.cells })
	request_queue.sort_custom(func(a, b): return a.distance < b.distance)


func _dispatch_jobs() -> void:
	while jobs.size() < MAX_PARALLEL_JOBS and not request_queue.is_empty():
		var job: Dictionary = request_queue.pop_front()
		if not chunks.has(job.key):
			chunks[job.key] = { "node": null, "cells": 0, "requested": 0 }
		chunks[job.key].requested = job.cells
		# Der Thread schreibt nur in sein eigenes Ergebnis-Array (Index 0), sonst nichts
		var output := [null]
		var task_id := WorkerThreadPool.add_task(
			_run_job.bind(output, job.origin, job.cells))
		jobs.append({ "task": task_id, "job": job, "output": output })


# Läuft im Worker-Thread
static func _run_job(output: Array, origin: Vector2, cells: int) -> void:
	output[0] = ChunkBuilder.build(origin.x, origin.y, CHUNK_SIZE, cells, CONTOUR_STYLE)


func _collect_jobs() -> void:
	for entry in jobs.duplicate():
		if not WorkerThreadPool.is_task_completed(entry.task):
			continue
		WorkerThreadPool.wait_for_task_completion(entry.task)
		jobs.erase(entry)
		var job: Dictionary = entry.job
		var chunk: Dictionary = chunks.get(job.key, {})
		# Inzwischen entfernt oder andere Detailstufe angefordert -> verwerfen
		if chunk.is_empty() or chunk.requested != job.cells:
			continue
		var node := _build_chunk_node(entry.output[0])
		node.position = Vector3(job.origin.x, 0.0, job.origin.y)
		add_child(node)
		_free_chunk(chunk)
		chunk.node = node
		chunk.cells = job.cells


func _build_chunk_node(r: Dictionary) -> Node3D:
	var root := Node3D.new()

	var terrain_arrays := []
	terrain_arrays.resize(Mesh.ARRAY_MAX)
	terrain_arrays[Mesh.ARRAY_VERTEX] = r.positions
	terrain_arrays[Mesh.ARRAY_NORMAL] = r.normals
	terrain_arrays[Mesh.ARRAY_TEX_UV] = r.uvs
	terrain_arrays[Mesh.ARRAY_INDEX] = r.indices
	root.add_child(_mesh_instance(Mesh.PRIMITIVE_TRIANGLES, terrain_arrays, terrain_material))

	if r.line_positions.size() > 0:
		var line_arrays := []
		line_arrays.resize(Mesh.ARRAY_MAX)
		line_arrays[Mesh.ARRAY_VERTEX] = r.line_positions
		line_arrays[Mesh.ARRAY_TEX_UV] = r.line_levels
		root.add_child(_mesh_instance(Mesh.PRIMITIVE_LINES, line_arrays, line_material))

	if r.dot_indices.size() > 0:
		var dot_arrays := []
		dot_arrays.resize(Mesh.ARRAY_MAX)
		dot_arrays[Mesh.ARRAY_VERTEX] = r.dot_centers
		dot_arrays[Mesh.ARRAY_TEX_UV] = r.dot_corners
		dot_arrays[Mesh.ARRAY_TEX_UV2] = r.dot_levels
		dot_arrays[Mesh.ARRAY_INDEX] = r.dot_indices
		var dots := _mesh_instance(Mesh.PRIMITIVE_TRIANGLES, dot_arrays, dot_material)
		dots.extra_cull_margin = 50.0   # Billboards ragen über die Mittelpunkte hinaus
		root.add_child(dots)
	return root


func _mesh_instance(primitive: Mesh.PrimitiveType, arrays: Array, material: Material) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(primitive, arrays)
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return instance


func _free_chunk(chunk: Dictionary) -> void:
	if chunk.node != null:
		chunk.node.queue_free()
		chunk.node = null


# ---------------------------------------------------------------------------
# Pinke Datenpunkt-Cluster mit Lichtstrahlen
# ---------------------------------------------------------------------------
func _create_clusters() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	cluster_multimesh = MultiMesh.new()
	cluster_multimesh.transform_format = MultiMesh.TRANSFORM_3D
	cluster_multimesh.mesh = quad
	cluster_multimesh.instance_count = MAX_DOTS
	cluster_multimesh.visible_instance_count = 0
	var dots := MultiMeshInstance3D.new()
	dots.multimesh = cluster_multimesh
	dots.material_override = _shader_material("res://shaders/cluster_dots.gdshader")
	dots.extra_cull_margin = 100000.0
	add_child(dots)

	beam_mesh = ArrayMesh.new()
	beam_material = _shader_material("res://shaders/beams.gdshader")
	var beams := MeshInstance3D.new()
	beams.mesh = beam_mesh
	beams.material_override = beam_material
	beams.extra_cull_margin = 100000.0
	add_child(beams)


# Deterministischer Zufall pro Kachel -> Cluster liegen immer an derselben Stelle
func _chunk_cluster(key: Vector2i) -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(key)
	var dots := []
	if rng.randf() > CLUSTER_CHANCE:
		return dots

	# Höchsten von einigen Kandidaten als Zentrum nehmen (Hügel / Bergkamm)
	var best := -INF
	var center := Vector2.ZERO
	for i in 6:
		var x := (key.x + 0.15 + rng.randf() * 0.7) * CHUNK_SIZE
		var z := (key.y + 0.15 + rng.randf() * 0.7) * CHUNK_SIZE
		var h := Height.terrain_height(x, z)
		if h > best:
			best = h
			center = Vector2(x, z)
	if best < 10.0:
		return dots

	var count := rng.randi_range(CLUSTER_SIZE.x, CLUSTER_SIZE.y)
	for i in count:
		var angle := rng.randf() * TAU
		var radius := CLUSTER_RADIUS * (rng.randf() + rng.randf() + rng.randf()) / 3.0
		var x := center.x + cos(angle) * radius
		var z := center.y + sin(angle) * radius
		var ground := Height.surface_height(x, z)
		dots.append({
			"position": Vector3(x, ground + 4.0 + rng.randf() * 14.0, z),
			"ground": ground,
			"beam": rng.randf() < BEAM_CHANCE,
		})
	return dots


func _update_clusters(keys: Array) -> void:
	var count := 0
	var beam_positions := PackedVector3Array()
	var beam_uvs := PackedVector2Array()
	for key in keys:
		for dot in _chunk_cluster(key):
			if count >= MAX_DOTS:
				break
			cluster_multimesh.set_instance_transform(count, Transform3D(Basis(), dot.position))
			count += 1
			if dot.beam:
				var p: Vector3 = dot.position
				beam_positions.append(Vector3(p.x, dot.ground, p.z))
				beam_positions.append(Vector3(p.x, dot.ground + BEAM_HEIGHT, p.z))
				beam_uvs.append(Vector2(0.0, 0.0))
				beam_uvs.append(Vector2(1.0, 0.0))
	cluster_multimesh.visible_instance_count = count

	beam_mesh.clear_surfaces()
	if beam_positions.size() > 0:
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = beam_positions
		arrays[Mesh.ARRAY_TEX_UV] = beam_uvs
		beam_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
		beam_mesh.surface_set_material(0, beam_material)


# ---------------------------------------------------------------------------
# HUD
# ---------------------------------------------------------------------------
func _create_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.016, 0.031, 0.078, 0.6)
	style.border_color = Color(0.2, 0.94, 1.0, 0.5)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(10)
	panel.add_theme_stylebox_override("panel", style)
	panel.anchor_left = 1.0
	panel.anchor_top = 1.0
	panel.anchor_right = 1.0
	panel.anchor_bottom = 1.0
	panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	panel.offset_right = -12
	panel.offset_bottom = -12
	hud = Label.new()
	hud.add_theme_color_override("font_color", Color("#9ff6ff"))
	panel.add_child(hud)
	layer.add_child(panel)


func _update_hud(ground: float) -> void:
	var loading := request_queue.size() + jobs.size()
	var text := "Tempo %d km/h   Höhe %d m   über Grund %d m" % [
		roundi(speed * 3.6), roundi(aircraft.position.y), roundi(aircraft.position.y - ground)]
	if loading > 0:
		text += "   lade %d Kacheln" % loading
	text += "\nKacheln %d   FPS %d" % [chunks.size(), Engine.get_frames_per_second()]
	text += "\nW/S Gas/Bremse   A/D rollen   ↑/↓ Nase hoch/runter   Q/E gieren   R gerade stellen"
	text += "\nV Ansicht: " + ("Cockpit" if view_mode == "cockpit" else "Kopf frei (linke Maustaste ziehen)")
	hud.text = text
