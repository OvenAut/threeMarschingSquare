// Umrechnung WGS84 (Breite/Länge, z. B. OpenStreetMap) <-> MGI / Austria Lambert (EPSG:31287, BEV)
// und Spielkoordinaten. Reines JS, im Browser, im Worker und in Node nutzbar.
//
// Spielkoordinaten: Mitte der Region = 0/0, x = Ost, z = Süd  ->  Lambert X = cx + x, Y = cy - z

const RAD = Math.PI / 180;
const ARC_SECOND = RAD / 3600;

const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const BESSEL = { a: 6377397.155, f: 1 / 299.1528128 };

// MGI -> WGS84, 7 Parameter (Position-Vector, wie proj "+towgs84=..." für EPSG:31287)
const HELMERT = { tx: 577.326, ty: 90.129, tz: 463.919, rx: 5.137, ry: 1.474, rz: 5.297, ds: 2.4232 };

// Lambert-Parameter EPSG:31287
const LAT1 = 49 * RAD, LAT2 = 46 * RAD, LAT0 = 47.5 * RAD, LON0 = (13 + 20 / 60) * RAD;
const FALSE_EASTING = 400000, FALSE_NORTHING = 400000;

const eccentricity = (e) => Math.sqrt(2 * e.f - e.f * e.f);

function geodeticToEcef(latDeg, lonDeg, h, ellipsoid) {
    const e2 = 2 * ellipsoid.f - ellipsoid.f ** 2;
    const lat = latDeg * RAD, lon = lonDeg * RAD;
    const n = ellipsoid.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return [
        (n + h) * Math.cos(lat) * Math.cos(lon),
        (n + h) * Math.cos(lat) * Math.sin(lon),
        (n * (1 - e2) + h) * Math.sin(lat)
    ];
}

function ecefToGeodetic([x, y, z], ellipsoid) {
    const e2 = 2 * ellipsoid.f - ellipsoid.f ** 2;
    const p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 6; i++) {
        const n = ellipsoid.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        lat = Math.atan2(z + e2 * n * Math.sin(lat), p);
    }
    return { lat: lat / RAD, lon: Math.atan2(y, x) / RAD };
}

// Helmert (Position-Vector); sign = +1: MGI -> WGS84, sign = -1: WGS84 -> MGI (Näherung)
function helmert([x, y, z], sign) {
    const { tx, ty, tz, rx, ry, rz, ds } = HELMERT;
    const s = 1 + sign * ds * 1e-6;
    const a = sign * rx * ARC_SECOND, b = sign * ry * ARC_SECOND, c = sign * rz * ARC_SECOND;
    return [
        sign * tx + s * (x - c * y + b * z),
        sign * ty + s * (c * x + y - a * z),
        sign * tz + s * (-b * x + a * y + z)
    ];
}

// Lambert-Konstanten (Bessel)
const E = eccentricity(BESSEL);
const mFn = (p) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const tFn = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const N = (Math.log(mFn(LAT1)) - Math.log(mFn(LAT2))) / (Math.log(tFn(LAT1)) - Math.log(tFn(LAT2)));
const F = mFn(LAT1) / (N * tFn(LAT1) ** N);
const RHO0 = BESSEL.a * F * tFn(LAT0) ** N;

// MGI-Breite/Länge -> Lambert
function mgiToLambert(latDeg, lonDeg) {
    const rho = BESSEL.a * F * tFn(latDeg * RAD) ** N;
    const theta = N * (lonDeg * RAD - LON0);
    return { x: FALSE_EASTING + rho * Math.sin(theta), y: FALSE_NORTHING + RHO0 - rho * Math.cos(theta) };
}

// Lambert -> MGI-Breite/Länge
function lambertToMgi(x, y) {
    const dx = x - FALSE_EASTING;
    const dy = RHO0 - (y - FALSE_NORTHING);
    const rho = Math.sign(N) * Math.hypot(dx, dy);
    const t = (rho / (BESSEL.a * F)) ** (1 / N);
    const theta = Math.atan2(dx, dy);
    let lat = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i++) {
        const es = E * Math.sin(lat);
        lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (E / 2));
    }
    return { lat: lat / RAD, lon: (theta / N + LON0) / RAD };
}

// WGS84 -> Lambert (EPSG:31287)
export function wgs84ToLambert(lat, lon) {
    const mgi = ecefToGeodetic(helmert(geodeticToEcef(lat, lon, 0, WGS84), -1), BESSEL);
    return mgiToLambert(mgi.lat, mgi.lon);
}

// Lambert (EPSG:31287) -> WGS84
export function lambertToWgs84(x, y) {
    const mgi = lambertToMgi(x, y);
    return ecefToGeodetic(helmert(geodeticToEcef(mgi.lat, mgi.lon, 0, BESSEL), 1), WGS84);
}

// Spielkoordinaten <-> WGS84 für eine Region (center = { lambertX, lambertY } aus der Region-JSON)
export function wgs84ToGame(lat, lon, center) {
    const p = wgs84ToLambert(lat, lon);
    return { x: p.x - center.lambertX, z: center.lambertY - p.y };
}

export function gameToWgs84(x, z, center) {
    return lambertToWgs84(center.lambertX + x, center.lambertY - z);
}
