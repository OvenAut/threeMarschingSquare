# Baut die Geometrie einer Kachel (Port von terrain/chunkWorker.js).
# Läuft in Worker-Threads und liefert nur Arrays zurück; Meshes entstehen im Hauptthread.
#  - glattes Höhenfeld (Senken flach auf Höhe 0), Rohhöhe in UV.x
#  - Höhenlinien per Marching-Triangles auf denselben Dreiecken
#  - Schürze am Kachelrand gegen Spalten zwischen Detailstufen
extends RefCounted

const Height = preload("res://scripts/height.gd")

const SKIRT_DEPTH := 60.0
const LINE_LIFT := 0.6       # Linien/Punkte knapp über der Fläche


static func build(origin_x: float, origin_z: float, size: float, cells: int, style: String) -> Dictionary:
	var cell := size / cells
	var stride := cells + 1

	# Höhen mit 1 Zelle Rand, damit die Normalen auch am Kachelrand stimmen
	var outer := cells + 3
	var heights := PackedFloat32Array()
	heights.resize(outer * outer)
	for z in range(-1, cells + 2):
		for x in range(-1, cells + 2):
			heights[(z + 1) * outer + (x + 1)] = Height.terrain_height(origin_x + x * cell, origin_z + z * cell)

	var positions := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()

	for z in cells + 1:
		for x in cells + 1:
			var row := (z + 1) * outer + (x + 1)
			var h := heights[row]
			positions.append(Vector3(x * cell, maxf(h, 0.0), z * cell))
			var left := maxf(heights[row - 1], 0.0)
			var right := maxf(heights[row + 1], 0.0)
			var back := maxf(heights[row - outer], 0.0)
			var front := maxf(heights[row + outer], 0.0)
			normals.append(Vector3(left - right, 2.0 * cell, back - front).normalized())
			uvs.append(Vector2(h, 0.0))

	for z in cells:
		for x in cells:
			var a := z * stride + x
			var b := a + 1
			var c := a + stride
			var d := c + 1
			indices.append_array(PackedInt32Array([a, b, c, b, d, c]))

	# Schürze: Randvertices nach unten kopieren und mit Quads verbinden
	var edges := [[], [], [], []]
	for i in cells + 1:
		edges[0].append(i)
		edges[1].append(cells * stride + i)
		edges[2].append(i * stride)
		edges[3].append(i * stride + cells)
	for edge in edges:
		var base := positions.size()
		for v in edge:
			positions.append(positions[v] - Vector3(0.0, SKIRT_DEPTH, 0.0))
			normals.append(normals[v])
			uvs.append(uvs[v])
		for i in edge.size() - 1:
			indices.append_array(PackedInt32Array([edge[i], edge[i + 1], base + i, edge[i + 1], base + i + 1, base + i]))

	# Höhenlinien
	var line_positions := PackedVector3Array()
	var line_levels := PackedVector2Array()
	var dot_centers := PackedVector3Array()
	var dot_corners := PackedVector2Array()
	var dot_levels := PackedVector2Array()
	var dot_indices := PackedInt32Array()
	var dot_spacing := cell * 1.5
	var corners := [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]

	for z in cells:
		for x in cells:
			var ha := heights[(z + 1) * outer + (x + 1)]
			var hb := heights[(z + 1) * outer + (x + 2)]
			var hc := heights[(z + 2) * outer + (x + 1)]
			var hd := heights[(z + 2) * outer + (x + 2)]
			var pa := Vector3(x * cell, ha, z * cell)
			var pb := Vector3((x + 1) * cell, hb, z * cell)
			var pc := Vector3(x * cell, hc, (z + 1) * cell)
			var pd := Vector3((x + 1) * cell, hd, (z + 1) * cell)
			for tri in [[pa, pc, pb], [pb, pc, pd]]:
				var h_min := minf(tri[0].y, minf(tri[1].y, tri[2].y))
				var h_max := maxf(tri[0].y, maxf(tri[1].y, tri[2].y))
				var level := maxf(0.0, ceilf(h_min / Height.CONTOUR_STEP) * Height.CONTOUR_STEP)
				while level < h_max:
					var above := []
					var below := []
					for p in tri:
						if p.y >= level:
							above.append(p)
						else:
							below.append(p)
					var segment := []
					if above.size() == 1:
						segment = [_cut(above[0], below[0], level), _cut(above[0], below[1], level)]
					elif above.size() == 2:
						segment = [_cut(above[0], below[0], level), _cut(above[1], below[0], level)]
					if segment.size() == 2:
						var p: Vector2 = segment[0]
						var q: Vector2 = segment[1]
						var y := level + LINE_LIFT
						# Küstenlinie (Höhe 0) immer durchgehend, sonst Linie oder Punkte je nach Stil
						if style != "dots" or level == 0.0:
							line_positions.append(Vector3(p.x, y, p.y))
							line_positions.append(Vector3(q.x, y, q.y))
							line_levels.append(Vector2(level, 0.0))
							line_levels.append(Vector2(level, 0.0))
						else:
							# Punkte dort, wo die Linie ein festes Raster kreuzt -> gleichmäßig verteilt
							var dx := q.x - p.x
							var dz := q.y - p.y
							var along_x := absf(dx) >= absf(dz)
							var from := minf(p.x, q.x) if along_x else minf(p.y, q.y)
							var to := maxf(p.x, q.x) if along_x else maxf(p.y, q.y)
							var k := int(ceilf(from / dot_spacing))
							while k * dot_spacing < to:
								var t := ((k * dot_spacing - p.x) / dx) if along_x else ((k * dot_spacing - p.y) / dz)
								var center := Vector3(p.x + dx * t, y, p.y + dz * t)
								var base := dot_centers.size()
								for corner in corners:
									dot_centers.append(center)
									dot_corners.append(corner)
									dot_levels.append(Vector2(level, 0.0))
								dot_indices.append_array(PackedInt32Array([base, base + 1, base + 2, base, base + 2, base + 3]))
								k += 1
					level += Height.CONTOUR_STEP

	return {
		"positions": positions,
		"normals": normals,
		"uvs": uvs,
		"indices": indices,
		"line_positions": line_positions,
		"line_levels": line_levels,
		"dot_centers": dot_centers,
		"dot_corners": dot_corners,
		"dot_levels": dot_levels,
		"dot_indices": dot_indices,
	}


# Schnittpunkt der Kante u -> v mit der Höhe level (Ergebnis in XZ als Vector2)
static func _cut(u: Vector3, v: Vector3, level: float) -> Vector2:
	var t := (level - u.y) / (v.y - u.y)
	return Vector2(u.x + (v.x - u.x) * t, u.z + (v.z - u.z) * t)
