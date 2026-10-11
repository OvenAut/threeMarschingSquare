# Höhenfunktion der Landschaft (1:1 Port von terrain/height.js).
# Nur statische Funktionen -> auch aus Worker-Threads nutzbar.
extends RefCounted

const CONTOUR_STEP := 40.0      # Abstand der Höhenlinien (Meter)
const MAX_HEIGHT := 900.0       # Gelände wird weich auf diese Höhe begrenzt

const LATTICE := 256.0          # Periode des Noise-Gitters
const RIDGE_ROUNDING := 0.1     # rundet die Grate leicht ab
const RIVER_WIDTH := 0.012      # Breite des Flussbetts (Noise-Einheiten)
const RIVER_VALLEY := 0.05      # Breite des Tals um den Fluss
const RIVER_BED := -8.0         # Flussbett liegt unter dem Wasserspiegel


static func _smoothstep(e0: float, e1: float, x: float) -> float:
	var t := clampf((x - e0) / (e1 - e0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


static func _hash(x: float, y: float) -> float:
	var px := x * 0.1031
	px -= floorf(px)
	var py := y * 0.1031
	py -= floorf(py)
	var pz := px
	var d := px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33)
	px += d
	py += d
	pz += d
	var r := (px + py) * pz
	return r - floorf(r)


static func _wrap(i: float) -> float:
	return i - floorf(i / LATTICE) * LATTICE


static func value_noise(x: float, y: float) -> float:
	var ix := floorf(x)
	var iy := floorf(y)
	var fx := x - ix
	var fy := y - iy
	var ux := fx * fx * (3.0 - 2.0 * fx)
	var uy := fy * fy * (3.0 - 2.0 * fy)
	var x0 := _wrap(ix)
	var x1 := _wrap(ix + 1.0)
	var y0 := _wrap(iy)
	var y1 := _wrap(iy + 1.0)
	var a := _hash(x0, y0)
	var b := _hash(x1, y0)
	var c := _hash(x0, y1)
	var d := _hash(x1, y1)
	var top := a + (b - a) * ux
	var bottom := c + (d - c) * ux
	return top + (bottom - top) * uy


static func fbm(x: float, y: float, octaves: int) -> float:
	var sum := 0.0
	var amp := 0.5
	for o in octaves:
		sum += value_noise(x, y) * amp
		var nx := (0.8 * x - 0.6 * y) * 2.0 + 17.3
		y = (0.6 * x + 0.8 * y) * 2.0 + 9.1
		x = nx
		amp *= 0.5
	return sum


static func ridged(x: float, y: float, octaves: int) -> float:
	var sum := 0.0
	var amp := 0.5
	var prev := 1.0
	for o in octaves:
		var v := value_noise(x, y) * 2.0 - 1.0
		var n := 1.0 + RIDGE_ROUNDING - sqrt(v * v + RIDGE_ROUNDING * RIDGE_ROUNDING)
		n *= n
		sum += n * prev * amp
		prev = n
		var nx := (0.8 * x - 0.6 * y) * 2.0 + 17.3
		y = (0.6 * x + 0.8 * y) * 2.0 + 9.1
		x = nx
		amp *= 0.5
	return sum


# Weiche Obergrenze: bis 650 m unverändert, darüber asymptotisch gegen MAX_HEIGHT
static func _soft_cap(h: float) -> float:
	var knee := MAX_HEIGHT - 250.0
	if h <= knee:
		return h
	return knee + 250.0 * (1.0 - exp(-(h - knee) / 250.0))


# Kontinuierliche Höhe in Metern
static func terrain_height(x: float, z: float) -> float:
	# Überwiegend Land, nur selten Seen
	var continent := (fbm(x / 2600.0, z / 2600.0, 4) - 0.27) * 2.2
	var land := _smoothstep(-0.1, 0.5, continent)

	# Berge nur in einzelnen Regionen, dazwischen flaches Hügelland
	var mountain_region := _smoothstep(0.42, 0.62, fbm(x / 6000.0 - 11.3, z / 6000.0 + 4.1, 3))
	var mountains := ridged(x / 900.0 + 5.2, z / 900.0 - 3.7, 4)
	var hills := fbm(x / 600.0 + 2.9, z / 600.0 - 8.2, 3) - 0.44
	var detail := fbm(x / 90.0 + 31.7, z / 90.0 - 12.4, 3) - 0.44

	var h := continent * 70.0 \
		+ mountains * mountains * mountain_region * land * 900.0 \
		+ hills * 120.0 * land \
		+ detail * 5.0 * (land + 0.3)

	# Flüsse: Nulllinie eines großräumigen Noise-Felds, nur in einzelnen Regionen
	var river_region := _smoothstep(0.55, 0.62, fbm(x / 9000.0 + 21.7, z / 9000.0 - 6.3, 2))
	if river_region > 0.0 and h > RIVER_BED:
		var r := absf(fbm(x / 3000.0 - 3.3, z / 3000.0 + 7.7, 3) * 2.0 - 0.88)
		var lowland := 1.0 - _smoothstep(150.0, 400.0, h)
		var valley := (1.0 - _smoothstep(RIVER_WIDTH, RIVER_VALLEY, r)) * river_region * lowland
		var bed := 1.0 - _smoothstep(RIVER_WIDTH * 0.6, RIVER_WIDTH, r)
		h = h + (minf(h, 25.0) - h) * valley * 0.85
		h = h + (RIVER_BED - h) * bed * river_region * lowland

	return _soft_cap(h)


# Sichtbare Oberfläche: Senken/Wasser liegen flach auf Höhe 0
static func surface_height(x: float, z: float) -> float:
	return maxf(terrain_height(x, z), 0.0)
