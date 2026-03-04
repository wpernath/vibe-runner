const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let width = canvas.width;
let height = canvas.height;

const gameContainer = document.getElementById('gameContainer');

const DESKTOP_CANVAS_WIDTH = 1024;
const DESKTOP_CANVAS_HEIGHT = 768;

/**
 * Resizes the canvas: on desktop uses 1024x768; on mobile/touch fills the container (fullscreen).
 */
function resizeCanvas() {
    const isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;

    if (isMobile && gameContainer) {
        const w = gameContainer.clientWidth || window.innerWidth || DESKTOP_CANVAS_WIDTH;
        const h = gameContainer.clientHeight || window.innerHeight || DESKTOP_CANVAS_HEIGHT;
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
    } else {
        canvas.width = DESKTOP_CANVAS_WIDTH;
        canvas.height = DESKTOP_CANVAS_HEIGHT;
    }
    width = canvas.width;
    height = canvas.height;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
if (gameContainer) {
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(gameContainer);
}

/*
 * Struktur: 1) Konstanten & State  2) Audio  3) Input  4) Farben
 *          5) Strecke (buildRoad, project, drawQuad, drawParallaxLayers)
 *          6) Sprites (drawProceduralSprite + Typen)  7) HUD (drawHUD + Gauges)
 *          8) Render  9) Update (Kollision, Physik, Game Loop)  10) Start
 */

// --- Spielvariablen ---
let position = 0;
let playerX = 0;
let speed = 0;
let playerY = 0;
let playerVelY = 0;
let skyOffset = 0;

// Crash-Variablen
let isCrashed = false;
let crashRot = 0;
let crashSpinSpeed = 0;
/** Zeitstempel des letzten Crash-Resets (für Invulnerabilität) */
let crashResetAt = 0;

const maxSpeed = 250;
const segmentLength = 200;
const cameraDepth = 0.84;
const cameraHeight = 1200;
const roadWidth = 3000;

// Rampen (Sprungschanzen): sehr langer Anstieg, damit sie in der Perspektive wie Rampen wirken
const RAMP_LAUNCH_VELOCITY = 520;
/** Schwerkraft pro Frame beim Sprung (kleiner = längerer Flug). */
const GRAVITY_JUMP = 82;
/** Beim Landen: Aufprall ab dieser Fallgeschwindigkeit löst einen kleinen Bounce aus. */
const LANDING_BOUNCE_THRESHOLD = 100;
/** Bounce-Faktor (0–1): Anteil der Aufprallgeschwindigkeit, der zurückfedert. */
const LANDING_BOUNCE_FACTOR = 0.38;
/** Standard-Rampen (wird überschrieben, wenn Strecke aus data/ geladen wird). */
let RAMPS = [
    { start: 610, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 },
    { start: 1000, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 },
    { start: 1580, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 }
];

// Kollision & Crash-Konstanten
const CRASH_RESET_GROUND_OFFSET = 100;
/** Nach Crash-Reset: so viele ms lang keine erneute Crash-Auslösung (verhindert Crash-Loop mit NPCs) */
const CRASH_INVULN_MS = 1800;
const CRASH_SPEED_THRESHOLD = 50;
const COLLISION_Z_RANGE = 250;
const COLLISION_Z_OFFSET = 300;
const COLLISION_PLAYER_CAR_X = 0.3;
/** Z-Reichweite für Kollision mit statischen Sprites (Bäume, Gebäude, …) */
const COLLISION_STATIC_Z_RANGE = 280;

// Seitenstreifen (ab |playerX| > ROAD_EDGE)
const ROAD_EDGE = 1.1;
const SHOULDER_MAX_SPEED = 80;
const SHOULDER_ACCEL = 0.2;

// Lenkung & Kurven
const CURVE_FORCE_DIVISOR = 24000;
const STEERING_FACTOR = 0.032;
// Fliehkraft erst ab dieser Geschwindigkeit voll (darunter linear abgeschwächt), damit man aus dem Grünstreifen rauskommt
const CURVE_FORCE_SPEED_THRESHOLD = 60;
// Mindest-Lenkwirkung (Anteil), damit bei niedriger Geschwindigkeit noch gelenkt werden kann
const STEERING_MIN_FACTOR = 0.25;

// Handbremse (linke Shift): weniger Grip = Sliden in Kurven
const HANDBRAKE_STEERING_MUL = 0.26;
const HANDBRAKE_CURVE_MUL = 1.7;
const HANDBRAKE_DECEL = 0.35;

// Schubabschaltung (kein Gas): Verzögerung pro Frame
const COAST_DECEL = 0.4;

// --- Getriebe (manuell) ---
const NUM_GEARS = 6;
/** Maximalgeschwindigkeit pro Gang (nur im höchsten Gang wird maxSpeed erreicht) */
const GEAR_MAX_SPEEDS = [45, 90, 135, 180, 215, 250];
/** Unterhalb dieser Geschwindigkeit (km/h) im jeweiligen Gang nur stark reduzierte Beschleunigung („nicht anfahren“) */
const GEAR_MIN_SPEEDS = [0, 18, 38, 58, 85, 115];
const RPM_REDLINE = 7000;
const RPM_IDLE = 800;
/** Beim Sprung (ohne Crash): RPM-Anzeige und Sound drehen so hoch („aufdingsen“). */
const RPM_IN_AIR = 6400;

let currentGear = 1;

let segments = [];
let cars = [];

// --- Hilfsfunktionen für Strecke & Antrieb ---

/**
 * Liefert den Streckenzustand an einer gegebenen Position (Segment, Höhe, Kurve).
 * @param {number} pos - Aktuelle Position auf der Strecke (Welt-Einheiten).
 * @returns {{ startSegIndex: number, offset: number, baseSeg: object, nextSeg: object, trackElevation: number }} Segment-Index, Offset im Segment, aktuelle/naechstes Segment, interpolierte Straßenhöhe.
 */
function getTrackState(pos) {
    const startSegIndex = Math.floor(pos / segmentLength) % segments.length;
    const offset = pos % segmentLength;
    const baseSeg = segments[startSegIndex];
    const nextSeg = segments[(startSegIndex + 1) % segments.length];
    const trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);
    return { startSegIndex, offset, baseSeg, nextSeg, trackElevation };
}

/**
 * Berechnet die Motordrehzahl (RPM) aus Geschwindigkeit und Gang.
 * @param {number} speedKmh - Geschwindigkeit in km/h.
 * @param {number} gear - Aktueller Gang (1..NUM_GEARS).
 * @returns {number} Drehzahl (RPM_IDLE .. RPM_REDLINE).
 */
function computeRpm(speedKmh, gear) {
    const gearMax = GEAR_MAX_SPEEDS[gear - 1];
    if (gearMax <= 0) return RPM_IDLE;
    return Math.min(
        RPM_REDLINE,
        RPM_IDLE + (speedKmh / gearMax) * (RPM_REDLINE - RPM_IDLE)
    );
}

// --- HUD & UI Variablen ---
let currentLap = 1;
let currentLapTime = 0;
let lastLapTime = 0;
let lapStartTime = Date.now();

let keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, ShiftLeft: false };

// --- Motorsound (Web Audio API, prozedural) ---
let engineSoundReady = false;
let audioContext = null;
let engineGainNode = null;
let engineOsc1 = null;
let engineOsc2 = null;
let engineFilter = null;

/**
 * Spielt einen prozeduralen Crash-Sound ueber die Web Audio API ab
 * (Rauschen, tiefes Boom, Crunch). Wird bei Kollision mit Hindernissen oder NPCs aufgerufen.
 */
function playCrashSound() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = audioContext || (Ctx && new Ctx());
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const t0 = ctx.currentTime;
        const duration = 0.5;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.95, t0 + 0.008);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        gainNode.connect(ctx.destination);

        // Rausch-Impact (länger, voller)
        const noiseDuration = 0.22;
        const bufferSize = ctx.sampleRate * noiseDuration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        const peakAt = bufferSize * 0.08;
        for (let i = 0; i < bufferSize; i++) {
            const env = i < peakAt
                ? i / peakAt
                : Math.exp(-(i - peakAt) / (bufferSize * 0.25));
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.connect(gainNode);
        noise.start(t0);
        noise.stop(t0 + noiseDuration);

        // Tiefes „Boom“-Fundament
        const thud = ctx.createOscillator();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(90, t0);
        thud.frequency.exponentialRampToValueAtTime(28, t0 + 0.12);
        thud.connect(gainNode);
        thud.start(t0);
        thud.stop(t0 + 0.28);

        // Zweiter tiefer Ton für mehr Druck
        const thud2 = ctx.createOscillator();
        thud2.type = 'sine';
        thud2.frequency.setValueAtTime(55, t0);
        thud2.frequency.exponentialRampToValueAtTime(22, t0 + 0.18);
        const thud2Gain = ctx.createGain();
        thud2Gain.gain.setValueAtTime(0.7, t0);
        thud2Gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
        thud2.connect(thud2Gain);
        thud2Gain.connect(gainNode);
        thud2.start(t0);
        thud2.stop(t0 + 0.25);

        // Kurzer „Crunch“ im Mittelfrequenzbereich
        const crunch = ctx.createOscillator();
        crunch.type = 'sawtooth';
        crunch.frequency.setValueAtTime(180, t0);
        crunch.frequency.exponentialRampToValueAtTime(50, t0 + 0.06);
        const crunchGain = ctx.createGain();
        crunchGain.gain.setValueAtTime(0.4, t0);
        crunchGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        crunch.connect(crunchGain);
        crunchGain.connect(gainNode);
        crunch.start(t0);
        crunch.stop(t0 + 0.08);
    } catch (_) {}
}

/**
 * Initialisiert den Motorsound (AudioContext, Oszillatoren, Filter).
 * Wird beim ersten Tastendruck aufgerufen (Browser-Autoplay). Idempotent.
 */
function startEngineSound() {
    if (engineSoundReady) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        audioContext = ctx;
        if (ctx.state === 'suspended') ctx.resume();

        engineGainNode = ctx.createGain();
        engineGainNode.gain.value = 0;
        engineGainNode.connect(ctx.destination);

        engineOsc1 = ctx.createOscillator();
        engineOsc1.type = 'sawtooth';
        engineOsc1.frequency.value = 40;
        engineOsc1.connect(engineGainNode);
        engineOsc1.start(0);

        engineOsc2 = ctx.createOscillator();
        engineOsc2.type = 'square';
        engineOsc2.frequency.value = 60;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        engineOsc2.connect(osc2Gain);
        osc2Gain.connect(engineGainNode);
        engineOsc2.start(0);

        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 400;
        engineFilter.Q.value = 0.7;
        engineGainNode.disconnect();
        engineGainNode.connect(engineFilter);
        engineFilter.connect(ctx.destination);

        engineSoundReady = true;
    } catch (_) { engineSoundReady = false; }
}

/**
 * Aktualisiert Frequenz und Lautstaerke des Motorsounds anhand von Drehzahl und Gas.
 * @param {number} rpm - Aktuelle Motordrehzahl.
 * @param {number} throttle - Gaspedal 0..1 (z.B. 1 bei Pfeil hoch, 0 bei kein Gas).
 */
function updateEngineSound(rpm, throttle) {
    if (!engineSoundReady || !engineGainNode || !engineOsc1 || !engineOsc2) return;
    const baseFreq = 0.012 * rpm + 25;
    engineOsc1.frequency.setTargetAtTime(baseFreq, 0, 0.02);
    engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, 0, 0.02);
    if (engineFilter) engineFilter.frequency.setTargetAtTime(200 + 0.04 * rpm, 0, 0.02);
    const vol = isCrashed ? 0 : (0.08 + 0.12 * throttle + 0.002 * (rpm / 1000));
    engineGainNode.gain.setTargetAtTime(Math.min(0.35, vol), 0, 0.03);
}

window.addEventListener('keydown', e => {
    startEngineSound();
    if (e.code === 'KeyQ') {
        if (currentGear < NUM_GEARS) currentGear++;
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyA') {
        if (currentGear > 1) {
            currentGear--;
            speed = Math.min(speed, GEAR_MAX_SPEEDS[currentGear - 1]);
        }
        e.preventDefault();
        return;
    }
    if (e.code in keys) {
        keys[e.code] = true;
        e.preventDefault();
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

// Touch/pointer controls for mobile
document.querySelectorAll('#touchControls [data-key]').forEach(btn => {
    const key = btn.dataset.key;
    if (!(key in keys)) return;

    function setKey(value) {
        keys[key] = value;
        if (value) startEngineSound();
    }

    btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        setKey(true);
    });
    btn.addEventListener('pointerup', setKey.bind(null, false));
    btn.addEventListener('pointerleave', setKey.bind(null, false));
    btn.addEventListener('pointercancel', setKey.bind(null, false));
    btn.addEventListener('contextmenu', e => e.preventDefault());
});

// Prevent context menu (copy/paste) on long-press anywhere in touch controls (iOS etc.)
document.addEventListener('contextmenu', e => {
    if (e.target.closest('#touchControls')) e.preventDefault();
}, true);

const COLORS = {
    DARK: { road: '#5b5b5b', grass: '#10AA10', rumble: '#555' },
    LIGHT: { road: '#696969', grass: '#009A00', rumble: '#FFF' },
    START: { road: '#FFF', grass: '#FFF', rumble: '#111' },
    SKY_TOP: '#1E90FF', SKY_BOTTOM: '#72D7EE',
    MOUNTAIN_1: '#3E4E6E', MOUNTAIN_2: '#2E3E5E',
    CLOUD: 'rgba(255, 255, 255, 0.3)'
};

// --- Strecke generieren ---

/**
 * Liefert die eingebaute Standard-Streckendefinition (wird verwendet, wenn data/track.json fehlt).
 * @returns {object} Strecken-JSON (segmentCount, curves, hills, ramps, zones, startSegmentCount).
 */
function getDefaultTrack() {
    return {
        name: 'Default',
        segmentCount: 2000,
        curves: [
            { start: 100, end: 300, strength: 1.5 },
            { start: 400, end: 600, strength: -3.5 },
            { start: 700, end: 900, strength: 3.0 },
            { start: 1200, end: 1400, strength: -2.5 }
        ],
        hills: [
            { start: 150, end: 400, amplitude: 15000 },
            { start: 450, end: 700, amplitude: -12000 },
            { start: 800, end: 1300, amplitude: 35000 }
        ],
        ramps: [
            { start: 610, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 },
            { start: 1000, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 },
            { start: 1580, approachLen: 35, riseLen: 100, peakLen: 4, dropLen: 6, peakHeight: 2200, straightAfter: 90, landingFlat: 15 }
        ],
        zones: [
            { start: 0, end: 500, type: 'nature' },
            { start: 500, end: 1000, type: 'city' },
            { start: 1000, end: 1500, type: 'nature' },
            { start: 1500, end: 2000, type: 'city' }
        ],
        startSegmentCount: 6
    };
}

/**
 * Lädt Streckendaten aus dem data-Verzeichnis (data/track.json).
 * Optional: ?track=dateiname lädt data/dateiname.json (ohne .json).
 * @returns {Promise<object|null>} Parsed JSON oder null bei Fehler.
 */
function loadTrackData() {
    const params = new URLSearchParams(document.location.search);
    const name = params.get('track') || 'track';
    const url = `data/${name}.json`;
    return fetch(url)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null);
}

/** Terrain-Höhe ohne Rampen (nur Hügel). Für weiche Übergänge nach Rampen-Landung. */
function getTerrainY(n, hills) {
    if (!hills || !hills.length) return 0;
    let y = 0;
    for (const h of hills) {
        if (n > h.start && n < h.end) {
            const len = h.end - h.start;
            y += Math.sin((n - h.start) / len * Math.PI) * (h.amplitude || 0);
        }
    }
    return y;
}

/**
 * Baut die komplette Strecke aus Streckendaten (JSON) und platziert NPC-Autos.
 * Fuellt die globalen Arrays `segments` und `cars`. Wird mit loadTrackData() geladenen Daten oder getDefaultTrack() aufgerufen.
 * @param {object} trackData - Streckendefinition: segmentCount, curves[], hills[], ramps[], zones[], startSegmentCount.
 */
function buildRoad(trackData) {
    if (!trackData) trackData = getDefaultTrack();
    const segmentCount = trackData.segmentCount || 2000;
    const curves = trackData.curves || [];
    const hills = trackData.hills || [];
    const ramps = trackData.ramps || [];
    const zones = trackData.zones || [];
    const startSegmentCount = trackData.startSegmentCount ?? 6;

    RAMPS = ramps;
    segments = [];

    const noCurveSegments = new Set();
    for (const r of ramps) {
        const rampEnd = r.start + r.riseLen + r.peakLen + r.dropLen;
        for (let i = r.start; i < rampEnd + (r.straightAfter || 0); i++) noCurveSegments.add(i);
        const approachStart = r.start - (r.approachLen || 0);
        for (let i = approachStart; i < r.start; i++) noCurveSegments.add(i);
    }

    function getZoneType(n) {
        for (const z of zones) {
            if (n >= z.start && n < z.end) return z.type || 'nature';
        }
        return (Math.floor(n / 500) % 2 === 0) ? 'nature' : 'city';
    }

    for (let n = 0; n < segmentCount; n++) {
        let curve = 0;
        let y = getTerrainY(n, hills);
        let color = Math.floor(n / 3) % 2 ? COLORS.DARK : COLORS.LIGHT;
        if (n < startSegmentCount) color = COLORS.START;

        for (const c of curves) {
            if (n > c.start && n < c.end) curve = c.strength || 0;
        }

        let rampTakeoff = false;
        for (const r of ramps) {
            const riseEnd = r.start + r.riseLen;
            const peakEnd = riseEnd + r.peakLen;
            const rampEnd = peakEnd + r.dropLen;
            if (n >= r.start && n < rampEnd) {
                if (n < riseEnd) {
                    y += (r.peakHeight || 0) * (n - r.start) / (r.riseLen || 1);
                } else if (n < peakEnd) {
                    y += r.peakHeight || 0;
                    if (n === peakEnd - 1) rampTakeoff = true;
                } else {
                    const dropProgress = (n - peakEnd + 1) / (r.dropLen || 1);
                    y += (r.peakHeight || 0) * Math.max(0, 1 - dropProgress);
                    if (n === peakEnd) rampTakeoff = true;
                }
            }
        }

        if (noCurveSegments.has(n)) curve = 0;

        let segmentSprites = [];
        const zone = getZoneType(n);

        if (zone === 'nature') {
            if (n % 5 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                let treeType = Math.random() > 0.5 ? 'TREE_PINE' : 'TREE_LEAFY';
                segmentSprites.push({ type: treeType, offset: side * (1.6 + Math.random() * 1.2) });
            }
        } else {
            if (n % 3 === 0) {
                for (let side of [-1, 1]) {
                    let heightScale = 0.7 + Math.random() * 0.8;
                    let bColor = `hsl(${Math.floor(Math.random() * 50)}, ${Math.floor(Math.random() * 30)}%, ${25 + Math.floor(Math.random() * 35)}%)`;
                    let winStyle = Math.random() > 0.5 ? 0 : 1;
                    segmentSprites.push({
                        type: 'BUILDING',
                        offset: side * (1.8 + Math.random() * 0.3),
                        data: { hScale: heightScale, color: bColor, winStyle: winStyle, seed: n * 10 + (side === 1 ? 5 : 0) }
                    });
                }
            }
            if (n % 4 === 0) {
                segmentSprites.push({ type: 'STREETLIGHT', offset: -1.3 });
                segmentSprites.push({ type: 'STREETLIGHT', offset: 1.3 });
            }
        }

        if (n % (zone === 'nature' ? 40 : 80) === 0 && Math.abs(curve) > 1) {
            segmentSprites.push({ type: 'SIGN', offset: curve > 0 ? -2.0 : 2.0 });
        }

        segmentSprites.push({ type: 'SEGMENT_SIGN', offset: 2.0, data: { segmentIndex: n } });

        segments.push({
            z: n * segmentLength,
            y: y,
            curve: curve,
            sprites: segmentSprites,
            cars: [],
            color: color,
            p1: { x: 0, y: 0, w: 0 },
            rampTakeoff: rampTakeoff
        });
    }

    const trackLength = segmentCount * segmentLength;
    cars = [];
    for (let i = 0; i < 100; i++) {
        cars.push({
            z: Math.random() * trackLength,
            offset: 0.25 + Math.random() * 0.6,
            speed: 40 + Math.random() * 60,
            dir: 1,
            color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`
        });
    }
}

/**
 * Projiziert einen 3D-Punkt in 2D-Bildschirmkoordinaten (perspektivisch).
 * Schreibt in das uebergebene Objekt p die Eigenschaften x, y, w (Halbe Breite der Strasse in Pixeln).
 * @param {{ x: number, y: number, w: number }} p - Objekt, das mit x, y, w befuellt wird.
 * @param {number} worldX - X in Weltkoordinaten (quer zur Fahrtrichtung).
 * @param {number} worldY - Y (Hoehe).
 * @param {number} worldZ - Z (Fahrtrichtung).
 * @param {number} camX - Kamera X.
 * @param {number} camY - Kamera Y.
 * @param {number} camZ - Kamera Z.
 */
function project(p, worldX, worldY, worldZ, camX, camY, camZ) {
    let z = Math.max(1, worldZ - camZ);
    let scale = cameraDepth / z;
    p.x = Math.round(width / 2 + (scale * (worldX - camX) * width / 2));
    p.y = Math.round(height / 2 - (scale * (worldY - camY) * height / 2));
    p.w = Math.round(scale * roadWidth * width / 2);
}

/**
 * Zeichnet ein Trapez (Quad) als Strasse/Rand-Band zwischen zwei projizierten Querschnitten.
 * @param {string} color - Fuellfarbe (z.B. aus COLORS.road, COLORS.rumble).
 * @param {number} x1 - Linke/rechte Bildschirm-X des vorderen Querschnitts.
 * @param {number} y1 - Bildschirm-Y des vorderen Querschnitts.
 * @param {number} w1 - Halbe Breite des vorderen Querschnitts (Pixel).
 * @param {number} x2 - X des hinteren Querschnitts.
 * @param {number} y2 - Y des hinteren Querschnitts.
 * @param {number} w2 - Halbe Breite des hinteren Querschnitts.
 */
function drawQuad(color, x1, y1, w1, x2, y2, w2) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x1 + w1, y1);
    ctx.fill();
}

/**
 * Zeichnet Himmel, Wolken und Berge als Parallax-Hintergrund.
 * @param {number} horizonY - Bildschirm-Y der Horizontlinie.
 */
function drawParallaxLayers(horizonY) {
    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, COLORS.SKY_TOP); gradient.addColorStop(1, COLORS.SKY_BOTTOM);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

    let cloudBaseY = horizonY - 250;
    let cloudScrollX = skyOffset * 0.2;
    ctx.fillStyle = COLORS.CLOUD;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
        let cloudHeight = Math.sin((x + cloudScrollX) * 0.005) * 30 + Math.sin((x + cloudScrollX * 1.5) * 0.01) * 15;
        let y = cloudBaseY - cloudHeight;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizonY - 50); ctx.lineTo(0, horizonY - 50); ctx.fill();

    let mountainScrollX = skyOffset * 0.6;
    ctx.fillStyle = COLORS.MOUNTAIN_2;
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 25) {
        let mHeight = Math.sin((x + mountainScrollX * 0.8) * 0.004) * 80 + Math.sin((x + mountainScrollX * 1.2) * 0.009) * 40;
        ctx.lineTo(x, horizonY - 50 - mHeight);
    }
    ctx.lineTo(width, height); ctx.fill();

    ctx.fillStyle = COLORS.MOUNTAIN_1;
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 15) {
        let mHeight = Math.sin((x + mountainScrollX) * 0.005) * 60 + Math.sin((x + mountainScrollX * 1.7) * 0.015) * 25;
        mHeight += Math.sin((x + mountainScrollX) * 0.1) * 5;
        ctx.lineTo(x, horizonY - 20 - mHeight);
    }
    ctx.lineTo(width, height); ctx.fill();
}

/**
 * Zeichnet ein prozedurales Sprite (Baum, Gebaeude, Laterne, Schild, NPC-Auto) an der projizierten Position.
 * Schneidet mit clipY, damit Objekte nicht ueber naehere Strasse gezeichnet werden.
 * @param {{ type: string, data?: object }} spriteObj - Typ (z.B. 'TREE_PINE', 'BUILDING', 'NPC_CAR') und optionale Daten.
 * @param {number} destX - Ziel-X auf dem Canvas (Mitte des Sprites).
 * @param {number} destY - Ziel-Y (Fusslinie).
 * @param {number} destW - Projizierte Breite (fuer Skalierung).
 * @param {number} clipY - Maximale Y-Koordinate (Clip-Rechteck).
 */
function drawProceduralSprite(spriteObj, destX, destY, destW, clipY) {
    let s = destW * 0.001;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, clipY); ctx.clip();

    if (spriteObj.type === 'TREE_PINE') {
        let treeW = 200 * s, treeH = 400 * s;
        ctx.fillStyle = '#6B4226'; ctx.fillRect(destX - treeW / 6, destY - treeH / 4, treeW / 3, treeH / 4);
        ctx.fillStyle = '#1E691E'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH); ctx.lineTo(destX - treeW / 2, destY - treeH / 4); ctx.lineTo(destX + treeW / 2, destY - treeH / 4); ctx.fill();
    } else if (spriteObj.type === 'TREE_LEAFY') {
        let treeW = 250 * s; let treeH = 350 * s;
        ctx.fillStyle = '#8B5A2B'; ctx.fillRect(destX - treeW / 8, destY - treeH / 3, treeW / 4, treeH / 3);
        ctx.fillStyle = '#228B22'; ctx.beginPath();
        ctx.arc(destX, destY - treeH * 0.8, treeW * 0.35, 0, Math.PI * 2);
        ctx.arc(destX - treeW * 0.25, destY - treeH * 0.5, treeW * 0.3, 0, Math.PI * 2);
        ctx.arc(destX + treeW * 0.25, destY - treeH * 0.5, treeW * 0.3, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'BUILDING') {
        let bData = spriteObj.data;
        let bW = 350 * s;
        let bH = 600 * s * bData.hScale;
        let baseX = destX - bW / 2;
        let baseY = destY - bH;
        ctx.fillStyle = bData.color; ctx.fillRect(baseX, baseY, bW, bH);
        ctx.fillStyle = '#FDFDA4';
        let winSize = 25 * s; let winGap = 20 * s;
        if (bData.winStyle === 0) {
            let gridY = 0;
            for (let wy = baseY + winGap; wy < destY - winGap * 2; wy += winSize + winGap, gridY++) {
                let gridX = 0;
                for (let wx = baseX + winGap; wx < baseX + bW - winGap; wx += winSize + winGap, gridX++) {
                    if ((((bData.seed || 0) + gridX * 31 + gridY * 17) % 10) < 2) ctx.fillRect(wx, wy, winSize, winSize);
                }
            }
        } else {
            for (let wx = baseX + winGap; wx < baseX + bW - winGap; wx += winSize + winGap * 1.5) {
                ctx.fillRect(wx, baseY + winGap, winSize, bH - winGap * 3);
            }
        }
        ctx.fillStyle = '#222'; ctx.fillRect(baseX - 5 * s, baseY, bW + 10 * s, 15 * s);
    } else if (spriteObj.type === 'STREETLIGHT') {
        let poleH = 450 * s; let poleW = 15 * s; let lampW = 60 * s;
        ctx.fillStyle = '#888'; ctx.fillRect(destX - poleW / 2, destY - poleH, poleW, poleH);
        ctx.fillStyle = '#DDD'; ctx.fillRect(destX - lampW / 2, destY - poleH, lampW, 15 * s);
        ctx.fillStyle = '#FFFFAA'; ctx.beginPath(); ctx.ellipse(destX, destY - poleH + 10 * s, lampW / 2, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'SIGN') {
        let signW = 120 * s, signH = 80 * s, poleH = 200 * s, poleW = 10 * s;
        ctx.fillStyle = '#555'; ctx.fillRect(destX - poleW / 2, destY - poleH, poleW, poleH);
        ctx.fillStyle = '#EEE'; ctx.fillRect(destX - signW / 2, destY - poleH - signH, signW, signH);
        ctx.fillStyle = '#D00'; ctx.fillRect(destX - signW / 2 + 5 * s, destY - poleH - signH + 5 * s, signW - 10 * s, signH - 10 * s);
        ctx.fillStyle = '#EEE'; ctx.fillRect(destX - signW / 2 + 15 * s, destY - poleH - signH + 15 * s, signW - 30 * s, signH - 30 * s);
    } else if (spriteObj.type === 'SEGMENT_SIGN') {
        let signW = 100 * s, signH = 60 * s, poleH = 180 * s, poleW = 8 * s;
        const num = (spriteObj.data && spriteObj.data.segmentIndex != null) ? String(spriteObj.data.segmentIndex) : '?';
        ctx.fillStyle = '#555'; ctx.fillRect(destX - poleW / 2, destY - poleH, poleW, poleH);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(destX - signW / 2, destY - poleH - signH, signW, signH);
        ctx.fillStyle = '#FFF';
        ctx.font = `bold ${Math.max(10, Math.round(28 * s))}px "Courier New", monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(num, destX, destY - poleH - signH / 2);
    } else if (spriteObj.type === 'NPC_CAR') {
        let car = spriteObj.data; let carW = 140 * s; let carH = 70 * s;
        ctx.fillStyle = '#111'; ctx.fillRect(destX - carW / 2.2, destY - carH / 4, carW / 4, carH / 2); ctx.fillRect(destX + carW / 2.2 - carW / 4, destY - carH / 4, carW / 4, carH / 2);
        ctx.fillStyle = car.color; ctx.fillRect(destX - carW / 2, destY - carH, carW, carH * 0.8);
        ctx.fillStyle = '#333'; ctx.fillRect(destX - carW / 3, destY - carH + carH * 0.1, carW * 0.66, carH * 0.3);
        if (car.dir === -1) ctx.fillStyle = '#FFFDE7'; else ctx.fillStyle = '#D00';
        ctx.fillRect(destX - carW / 2 + 5 * s, destY - carH * 0.4, 25 * s, 12 * s); ctx.fillRect(destX + carW / 2 - 30 * s, destY - carH * 0.4, 25 * s, 12 * s);
    }
    ctx.restore();
}

/**
 * Zeichnet den analogen Drehzahlmesser (RPM-Gauge) links neben dem Tacho.
 * Zeigt aktuelle Drehzahl, Redline-Bereich und aktuellen Gang.
 * @param {number} rpm - Anzuzeigende Motordrehzahl.
 */
function drawRPMGauge(rpm) {
    const cx = width - 15 - 165 - 10 - 165 / 2, cy = 52, r = 42, boxW = 165, left = width - 15 - boxW * 2 - 10;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)'; ctx.fillRect(left, 15, boxW, 78);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(left, 15, boxW, 78);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0, false); ctx.stroke();
    ctx.strokeStyle = '#BBB'; ctx.lineWidth = 1.5; ctx.fillStyle = '#E8E8E8'; ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= RPM_REDLINE; i += 1000) {
        const angle = Math.PI - (i / RPM_REDLINE) * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * (r - 10), cy - Math.sin(angle) * (r - 10));
        ctx.lineTo(cx + Math.cos(angle) * r, cy - Math.sin(angle) * r); ctx.stroke();
        if (i % 2000 === 0 || i === RPM_REDLINE) ctx.fillText(String(i / 1000) + 'k', cx + Math.cos(angle) * (r - 20), cy - Math.sin(angle) * (r - 20));
    }
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * (1 - 6000 / RPM_REDLINE), 0, false); ctx.stroke();
    const needleAngle = Math.PI - (Math.min(rpm, RPM_REDLINE) / RPM_REDLINE) * Math.PI, len = r - 10;
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.strokeStyle = rpm >= RPM_REDLINE * 0.9 ? '#FF4444' : '#FFF'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(Math.round(rpm) + ' rpm', cx, cy + r - 2);
    ctx.font = 'bold 20px "Courier New"'; ctx.textBaseline = 'middle';     ctx.fillText(String(currentGear), cx, cy - 10);
}

/**
 * Zeichnet den analogen Tacho (Geschwindigkeitsanzeige) rechts oben.
 * @param {number} speedKmh - Anzuzeigende Geschwindigkeit in km/h.
 */
function drawSpeedGauge(speedKmh) {
    const cx = width - 92, cy = 52, r = 42, boxW = 165, left = width - 15 - boxW;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)'; ctx.fillRect(left, 15, boxW, 78);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(left, 15, boxW, 78);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0, false); ctx.stroke();
    ctx.strokeStyle = '#BBB'; ctx.lineWidth = 1.5; ctx.fillStyle = '#E8E8E8'; ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxSpeed; v += 50) {
        const angle = Math.PI - (v / maxSpeed) * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * (r - 10), cy - Math.sin(angle) * (r - 10));
        ctx.lineTo(cx + Math.cos(angle) * r, cy - Math.sin(angle) * r); ctx.stroke();
        if (v % 100 === 0 || v === maxSpeed) ctx.fillText(String(v), cx + Math.cos(angle) * (r - 20), cy - Math.sin(angle) * (r - 20));
    }
    const speedClamped = Math.min(speedKmh, maxSpeed), needleAngle = Math.PI - (speedClamped / maxSpeed) * Math.PI, len = r - 10;
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.strokeStyle = speedKmh > 280 ? '#FF4444' : '#FFF'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(Math.round(speedKmh) + ' km/h', cx, cy + r - 2);
}

/**
 * Zeichnet das komplette HUD: Lap/Zeit-Box, RPM-Gauge, Tacho, bei Crash den "CRASHED!"-Overlay.
 * @param {number} [displayRpm] - Anzuzeigende Drehzahl (optional; sonst aus speed/Gang berechnet).
 */
function drawHUD(displayRpm) {
    const rpm = displayRpm != null ? displayRpm : computeRpm(speed, currentGear);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(15, 15, 200, 90);
    drawRPMGauge(rpm);
    drawSpeedGauge(speed);

    // Lap, Zeit
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 20px "Courier New"'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`LAP:  ${currentLap}`, 25, 40); ctx.fillText(`TIME: ${currentLapTime.toFixed(2)}s`, 25, 65);
    if (lastLapTime > 0) { ctx.fillStyle = '#AAA'; ctx.fillText(`LAST: ${lastLapTime.toFixed(2)}s`, 25, 90); }

    if (isCrashed) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.fillRect(0, height / 2 - 50, width, 100);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Courier New"';
        ctx.fillText("CRASHED!", width / 2, height / 2 + 15);
    }
}

/**
 * Zeichnet einen kompletten Frame: Strasse (mit Kurven/Hoehe), Sprites, Spielerauto, HUD.
 * Verwendet getTrackState(position) und projiziert die naechsten 300 Segmente.
 */
function render() {
    ctx.clearRect(0, 0, width, height);

    const { startSegIndex, offset, baseSeg, nextSeg, trackElevation } = getTrackState(position);
    let camX = playerX * roadWidth;
    let camY = cameraHeight + playerY;
    let camZ = position;

    let horizonY = height / 2 + playerY * 0.05;
    drawParallaxLayers(horizonY);

    let x = 0, dx = 0, maxY = height;
    let spritesToDraw = [];

    for (let n = 0; n < 300; n++) {
        let seg = segments[(startSegIndex + n) % segments.length];
        seg.z = (startSegIndex + n) * segmentLength;

        project(seg.p1, x, seg.y, seg.z, camX, camY, camZ - (n === 0 ? offset : 0));
        let currentCurveX = x;
        x += dx; dx += seg.curve;

        for (let i = 0; i < seg.sprites.length; i++) {
            let spriteP = { x: 0, y: 0, w: 0 };
            project(spriteP, currentCurveX + seg.sprites[i].offset * roadWidth, seg.y, seg.z, camX, camY, camZ - (n === 0 ? offset : 0));
            if (spriteP.x > -1000 && spriteP.x < width + 1000) {
                spritesToDraw.push({ type: seg.sprites[i].type, data: seg.sprites[i].data, x: spriteP.x, y: spriteP.y, w: spriteP.w, clipY: maxY });
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            let car = seg.cars[i];
            let carP = { x: 0, y: 0, w: 0 };
            let carVisualZ = seg.z + (car.z % segmentLength);
            project(carP, currentCurveX + car.offset * roadWidth, seg.y, carVisualZ, camX, camY, camZ - (n === 0 ? offset : 0));

            if (carP.x > -1000 && carP.x < width + 1000) {
                spritesToDraw.push({ type: 'NPC_CAR', data: car, x: carP.x, y: carP.y, w: carP.w, clipY: maxY });
            }
        }

        if (seg.p1.y >= maxY) continue;
        if (n > 0) {
            let prev = segments[(startSegIndex + n - 1) % segments.length];
            ctx.fillStyle = seg.color.grass; ctx.fillRect(0, seg.p1.y, width, prev.p1.y - seg.p1.y);
            drawQuad(seg.color.rumble, prev.p1.x, prev.p1.y, prev.p1.w * 1.1, seg.p1.x, seg.p1.y, seg.p1.w * 1.1);
            drawQuad(seg.color.road, prev.p1.x, prev.p1.y, prev.p1.w, seg.p1.x, seg.p1.y, seg.p1.w);
        }
        maxY = seg.p1.y;
    }

    for (let i = spritesToDraw.length - 1; i >= 0; i--) {
        drawProceduralSprite(spritesToDraw[i], spritesToDraw[i].x, spritesToDraw[i].y, spritesToDraw[i].w, spritesToDraw[i].clipY);
    }

    const carW = 130; const carH = 55;
    let carX = width / 2 - carW / 2;

    let jumpHeight = Math.max(0, playerY - trackElevation);

    const onShoulder = Math.abs(playerX) > ROAD_EDGE && !isCrashed;

    ctx.save();
    if (onShoulder && speed > 0 && jumpHeight === 0) {
        const jitterX = (Math.random() - 0.5) * 6;
        const jitterY = (Math.random() - 0.5) * 3;
        ctx.translate(jitterX, jitterY);
    }
    if (isCrashed) {
        let cx = carX + carW / 2;
        let cy = (height - carH - 20) + carH / 2;
        ctx.translate(cx, cy - jumpHeight * 0.015);
        ctx.rotate(crashRot);
        ctx.translate(-cx, -(cy - jumpHeight * 0.015));
    }

    const bounce = (speed > 0 && jumpHeight === 0 && !isCrashed) ? Math.random() * 2 : 0;
    const carY = height - carH - 20 + bounce - (jumpHeight * 0.015);

    if (jumpHeight > 0 && !isCrashed) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(carX + carW / 2, height - 20, Math.max(10, carW / 2 - jumpHeight * 0.01), 10, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#111'; ctx.fillRect(carX - 8, carY + 15, 25, 30); ctx.fillRect(carX + carW - 17, carY + 15, 25, 30);
    ctx.fillStyle = '#e62222'; ctx.fillRect(carX, carY + 25, carW, 30); ctx.fillRect(carX + 25, carY, carW - 50, 25);
    ctx.fillStyle = '#444'; ctx.fillRect(carX + 30, carY + 5, carW - 60, 20);
    ctx.fillStyle = keys.ArrowDown ? '#ff0000' : '#ff8800'; ctx.fillRect(carX + 8, carY + 30, 15, 8); ctx.fillRect(carX + carW - 23, carY + 30, 15, 8);

    ctx.restore();

    const inAirForHUD = !isCrashed && (playerY - trackElevation > 60);
    drawHUD(inAirForHUD ? RPM_IN_AIR : undefined);
}

/**
 * Prueft Kollision mit statischen Hindernissen (Baeume, Gebaeude, Laternen, Schilder).
 * Nur am Boden (nicht in der Luft) und ausserhalb der Crash-Invulnerabilitaet.
 * Setzt bei Treffer isCrashed/playCrashSound oder stoppt die Geschwindigkeit.
 * @param {{ startSegIndex: number, baseSeg: object, nextSeg: object, trackElevation: number }} trackState - Aktueller Streckenzustand von getTrackState().
 */
function checkStaticObstacleCollision(trackState) {
    const inAir = playerY > trackState.trackElevation + 80;
    if (inAir) return;
    if (Date.now() - crashResetAt < CRASH_INVULN_MS) return;

    const segmentsToCheck = [
        { seg: trackState.baseSeg, segZ: trackState.startSegIndex * segmentLength },
        { seg: trackState.nextSeg, segZ: (trackState.startSegIndex + 1) * segmentLength }
    ];
    for (let s = 0; s < segmentsToCheck.length; s++) {
        const { seg, segZ } = segmentsToCheck[s];
        if (Math.abs(position - segZ) > COLLISION_STATIC_Z_RANGE) continue;
        for (let i = 0; i < seg.sprites.length; i++) {
            const sprite = seg.sprites[i];
            let spriteW = 0.5;
            if (sprite.type === 'TREE_PINE' || sprite.type === 'TREE_LEAFY') spriteW = 0.45;
            if (sprite.type === 'BUILDING') spriteW = 0.9;
            if (sprite.type === 'STREETLIGHT') spriteW = 0.2;
            if (Math.abs(playerX - sprite.offset) >= spriteW) continue;
            if (speed > CRASH_SPEED_THRESHOLD) {
                isCrashed = true;
                playCrashSound();
                playerVelY = speed * 4;
                crashSpinSpeed = 0.1 + (speed / maxSpeed) * 0.4;
            } else speed = 0;
            return;
        }
    }
}

/**
 * Bewegt alle NPC-Autos (z, Segment-Zuordnung) und prueft Kollision mit dem Spieler.
 * Bei Kollision: Crash bei entgegenkommendem Auto, sonst Abbremsen und leichte Verschiebung.
 * Beruecksichtigt Crash-Invulnerabilitaet nach Reset.
 * @param {{ trackElevation: number }} trackState - Aktueller Streckenzustand (fuer Hoehenpruefung).
 */
function updateNPCsAndCheckCollision(trackState) {
    const maxZ = segments.length * segmentLength;
    for (let i = 0; i < segments.length; i++) segments[i].cars = [];
    for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        car.z += car.dir * car.speed;
        if (car.z < 0) car.z += maxZ;
        if (car.z >= maxZ) car.z -= maxZ;
        segments[Math.floor(car.z / segmentLength) % segments.length].cars.push(car);
        const distToPlayerZ = Math.abs(car.z - (position % maxZ + COLLISION_Z_OFFSET));
        if (distToPlayerZ >= COLLISION_Z_RANGE || playerY > trackState.trackElevation + 1500) continue;
        if (Math.abs(playerX - car.offset) >= COLLISION_PLAYER_CAR_X) continue;
        if (Date.now() - crashResetAt < CRASH_INVULN_MS) continue;

        if (car.dir === -1) {
            isCrashed = true;
            playCrashSound();
            playerVelY = 300 + (speed * 4);
            crashSpinSpeed = 0.05 + (speed / maxSpeed) * 0.4;
            car.speed = 0;
        } else {
            speed = Math.min(speed, car.speed - 10);
            playerX += (playerX >= car.offset ? 0.15 : -0.15);
        }
    }
}

// --- Game Loop ---

/**
 * Haupt-Game-Loop (per requestAnimationFrame). Aktualisiert Crash-Zustand, Rundenzeit,
 * Kollisionen, Beschleunigung/Lenkung/Handbremse, Position/Hoehe, Motorsound und rendert einen Frame.
 */
function update() {
    if (isCrashed) {
        crashRot += crashSpinSpeed;
        playerVelY -= 15;
        playerY += playerVelY;
        position += speed;

        const trackStateCrash = getTrackState(position);
        const groundHeight = trackStateCrash.trackElevation;

        if (playerY < groundHeight - CRASH_RESET_GROUND_OFFSET) {
            isCrashed = false;
            crashResetAt = Date.now();
            playerY = groundHeight;
            playerVelY = 0;
            speed = 0;
            crashRot = 0;
            playerX = 0;
            currentGear = 1;
        }

        updateEngineSound(RPM_IDLE, 0);

        render();
        requestAnimationFrame(update);
        return;
    }

    let trackLength = segments.length * segmentLength;
    if (position > currentLap * trackLength) {
        lastLapTime = currentLapTime;
        currentLap++;
        lapStartTime = Date.now();
        position = position % trackLength;
    }
    currentLapTime = (Date.now() - lapStartTime) / 1000;

    let trackState = getTrackState(position);
    checkStaticObstacleCollision(trackState);
    if (!isCrashed) updateNPCsAndCheckCollision(trackState);

    let { startSegIndex, offset, baseSeg, nextSeg, trackElevation } = trackState;
    const onShoulder = Math.abs(playerX) > ROAD_EDGE;
    const gearMaxSpeed = GEAR_MAX_SPEEDS[currentGear - 1];
    const effectiveMaxSpeed = onShoulder
        ? Math.min(SHOULDER_MAX_SPEED, gearMaxSpeed)
        : gearMaxSpeed;
    let accelRate = onShoulder ? SHOULDER_ACCEL : 0.7;

    // In hohen Gängen bei niedriger Geschwindigkeit kaum beschleunigen (nicht „anfahren“)
    const gearMinSpeed = GEAR_MIN_SPEEDS[currentGear - 1];
    if (speed < gearMinSpeed && keys.ArrowUp) {
        accelRate *= 0.06;
    }

    if (keys.ArrowUp) speed = Math.min(speed + accelRate, effectiveMaxSpeed);
    else if (keys.ArrowDown) speed = Math.max(speed - 6, 0);
    else speed = Math.max(speed - COAST_DECEL, 0);

    if (onShoulder && speed > SHOULDER_MAX_SPEED) speed = Math.max(SHOULDER_MAX_SPEED, speed - 5);
    speed = Math.min(speed, effectiveMaxSpeed);

    position += speed;

    ({ startSegIndex, offset, baseSeg, nextSeg, trackElevation } = getTrackState(position));

    if (!isCrashed && baseSeg.rampTakeoff && playerY <= trackElevation + 120 && playerVelY <= 80 && speed > 30) {
        const launchMul = Math.min(1, speed / maxSpeed);
        playerVelY = RAMP_LAUNCH_VELOCITY * (0.5 + 0.5 * launchMul);
    }

    const wasInAir = playerY > trackElevation + 60;
    playerVelY -= GRAVITY_JUMP;
    playerY += playerVelY;
    if (playerY < trackElevation) {
        const impactVel = playerVelY;
        playerY = trackElevation;
        if (wasInAir && impactVel < -LANDING_BOUNCE_THRESHOLD) {
            playerVelY = Math.min(180, -impactVel * LANDING_BOUNCE_FACTOR);
        } else {
            playerVelY = 0;
        }
    }

    let currentSeg = segments[startSegIndex];
    if (speed > 0) skyOffset += currentSeg.curve * (speed / maxSpeed) * 4;

    if (speed > 0) {
        let curveForce = (currentSeg.curve * speed) / CURVE_FORCE_DIVISOR;
        if (speed < CURVE_FORCE_SPEED_THRESHOLD) {
            curveForce *= speed / CURVE_FORCE_SPEED_THRESHOLD;
        }
        if (keys.ShiftLeft) curveForce *= HANDBRAKE_CURVE_MUL;
        playerX -= curveForce;
    }
    let steeringMul = Math.max(STEERING_MIN_FACTOR, speed / maxSpeed);
    if (keys.ShiftLeft) steeringMul *= HANDBRAKE_STEERING_MUL;
    if (keys.ArrowLeft) playerX -= STEERING_FACTOR * steeringMul;
    if (keys.ArrowRight) playerX += STEERING_FACTOR * steeringMul;

    if (keys.ShiftLeft && speed > 0) speed = Math.max(0, speed - HANDBRAKE_DECEL);

    playerX = Math.max(-2.5, Math.min(2.5, playerX));

    const inAir = !isCrashed && (playerY > trackElevation + 60);
    const rpm = computeRpm(speed, currentGear);
    updateEngineSound(inAir ? RPM_IN_AIR : rpm, inAir ? 1 : (keys.ArrowUp ? 1 : 0));

    render();
    requestAnimationFrame(update);
}

loadTrackData()
    .then(data => {
        buildRoad(data || getDefaultTrack());
        update();
    })
    .catch(() => {
        buildRoad(getDefaultTrack());
        update();
    });
