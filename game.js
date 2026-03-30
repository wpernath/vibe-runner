/**
 * =============================================================================
 * RUNNING OUT – game.js (single-file browser arcade racer)
 * =============================================================================
 *
 * Read this file top to bottom. Rough map:
 *
 * | Area                      | Role |
 * |---------------------------|------|
 * | Canvas & resize           | Desktop 1024×768 vs mobile fullscreen |
 * | Constants                 | Physics, gears, collision, ramps, race (RACE_LAPS, NUM_OPPONENTS) |
 * | Mutable state             | position, speed, playerX/Y, segments[], cars[], lap/HUD, audio nodes |
 * | Track helpers             | getTrackState, curveForceMagnitude, computeRpm |
 * | Web Audio                 | playCrashSound, startEngineSound, updateEngineSound |
 * | Track I/O & build         | loadTrackData, getTerrainY, buildRoad (segments + 10 AI opponents) |
 * | Projection                | project (forward), projectRear / projectRearByDistance (mirror) |
 * | Drawing                   | drawQuad, drawRearViewMirror, drawParallaxLayers, drawProceduralSprite |
 * | HUD                       | drawRPMGauge, drawSpeedGauge, drawTrackOverview, drawTrackMap, drawHUD |
 * | render()                  | One frame: road loop, sprites, mirror, player car, HUD |
 * | Collisions & AI           | checkStaticObstacleCollision, crashNPCCar, updateNPCsAndCheckCollision |
 * | update()                  | Main loop: crash branch, lap/race end, physics, render |
 * | Boot                      | loadTrackData().then(buildRoad) → requestAnimationFrame(update) |
 *
 * Coordinates: `position` = along-track distance (wraps each lap). `playerX` = lateral (~±2.5).
 * `playerY` = height; `getTrackState(pos).trackElevation` = road height under that position.
 * =============================================================================
 */
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

// --- Player & world state (mutable each frame) ---
let position = 0;
let playerX = 0;
let speed = 0;
let playerY = 0;
let playerVelY = 0;
let skyOffset = 0;

// Crash state (spin animation + brief invulnerability after reset)
let isCrashed = false;
let crashRot = 0;
let crashSpinSpeed = 0;
/** Timestamp of last crash reset (used for post-crash invulnerability window). */
let crashResetAt = Date.now();

/** Height above track (world Y) above which we count as in-air (no NPC/static collision). */
const IN_AIR_THRESHOLD = 100;

const maxSpeed = 250;
const segmentLength = 200;
const cameraDepth = 0.84;
const cameraHeight = 1200;
const roadWidth = 3000;

// Ramps (jump ramps): long uphill so they read as ramps in perspective
const RAMP_LAUNCH_VELOCITY = 520;
/** Gravity per frame when airborne (smaller = longer hang time, arcade feel). */
const GRAVITY_JUMP = 70;
/** Landing impact above this downward velocity triggers a small bounce. */
const LANDING_BOUNCE_THRESHOLD = 100;
/** Bounce factor (0–1): fraction of impact velocity that rebounds. */
const LANDING_BOUNCE_FACTOR = 0.38;

// Collision & crash tuning
const CRASH_RESET_GROUND_OFFSET = 100;
/** After crash reset: no new crash trigger for this many ms (avoids NPC crash loops). */
const CRASH_INVULN_MS = 1800;
const CRASH_SPEED_THRESHOLD = 50;
/** Z-range for NPC collision (smaller = only when really close along the road). */
const COLLISION_Z_RANGE = 140;
const COLLISION_Z_OFFSET = 300;
/** Lateral overlap needed to count as hit (smaller = must be closer side-by-side to collide). */
const COLLISION_PLAYER_CAR_X = 0.18;
/** Z-range for collision with static sprites (trees, buildings, …). */
const COLLISION_STATIC_Z_RANGE = 280;

// --- Physics (arcade-first: fun over realism; same rules for player and opponents) ---
const TARGET_FPS = 60;

// Road shoulders (progressive: grip falls off the farther you are from the lane)
const ROAD_EDGE = 1.1;
const SHOULDER_MAX_SPEED = 80;
const SHOULDER_ACCEL = 0.2;
const SHOULDER_GRIP_FALLOFF = 1.5;

// Steering inertia (steeringVel lerps toward target instead of instant playerX)
const STEERING_FACTOR = 0.032;
const STEERING_MIN_FACTOR = 0.25;
const STEERING_ENGAGE_RATE = 0.12;
const STEERING_RETURN_RATE = 0.08;

// Centrifugal curve force (quadratic in v²; harsher at high speed, milder at low)
const CURVE_FORCE_DIVISOR = 3_600_000;
const CURVE_FORCE_SPEED_THRESHOLD = 60;
/** Max roll angle (rad) for centrifugal lean; scale from curve*speed² to angle. */
const CURVE_ROLL_MAX = 0.22;
const CURVE_ROLL_SCALE = 8;

// Handbrake (progressive: builds over ~0.25s, releases over ~0.17s)
const HANDBRAKE_STEERING_MUL = 0.26;
const HANDBRAKE_CURVE_MUL = 1.7;
const HANDBRAKE_DECEL = 1.5;
const HANDBRAKE_ENGAGE_RATE = 4.0;
const HANDBRAKE_RELEASE_RATE = 6.0;

// Brake (speed-dependent: gentler at low speed, no wheel lock)
const BRAKE_DECEL = 5.0;

// Engine braking per gear (1st = strong; downshift before corners is tactical)
const GEAR_COAST_DECEL = [1.0, 0.7, 0.5, 0.4, 0.3, 0.2];

// Acceleration per gear (1st aggressive, 6th weak)
const GEAR_ACCEL_RATES = [1.4, 1.1, 0.85, 0.65, 0.5, 0.35];

// Redline limiter: accel drops from 6200 RPM, zero at 7000 RPM
const REDLINE_DROPOFF_START = 6200;

// Aerodynamic drag (quadratic; naturally caps top speed)
const AERO_DRAG = 0.000006;

// In air: speed preserved, steering frozen

// Speed loss on hard landing (proportional to impact velocity)
const LANDING_SPEED_LOSS_FACTOR = 0.0004;

// Pitch in air (up/down keys): mild effect so jump arc stays predictable and arcade-like
const PITCH_UP_GRAVITY_MUL = 0.75;
const PITCH_DOWN_GRAVITY_MUL = 1.35;

// Clean-Landing Bonus
const CLEAN_LANDING_MAX_VEL = 80;
const CLEAN_LANDING_BOOST = 10;

// NPCs (same jump gravity as player)
const NPC_RAMP_LAUNCH_FACTOR = 0.65;
/** Opponents stay on the drivable road (lateral clamp). */
const NPC_ROAD_OFFSET_MAX = 0.95;
const NPC_CENTERING_RATE = 0.04;

// Slope gravity along road (positive = uphill slows, negative = downhill accelerates)
const SLOPE_GRAVITY_FACTOR = 0.55;

// --- Manual gearbox ---
const NUM_GEARS = 6;
/** Max speed per gear (only top gear reaches global maxSpeed). */
const GEAR_MAX_SPEEDS = [45, 90, 135, 180, 215, 250];
/** Below this km/h in each gear, acceleration is heavily reduced (“won’t pull”). */
const GEAR_MIN_SPEEDS = [0, 18, 38, 58, 85, 115];
const RPM_REDLINE = 7000;
const RPM_IDLE = 800;
/** While airborne (no crash): RPM display and engine sound spike (“rev hang”). */
const RPM_IN_AIR = 6400;

let currentGear = 1;
let lastTimestamp = 0;
let steeringVel = 0;
let handbrakeAmount = 0;
/** Hysteresis: stay “in air” until clearly grounded (avoids flicker at threshold). */
let wasInAirPreviousFrame = false;

let segments = [];
let cars = [];

// --- Track & drivetrain helpers ---

/**
 * Track state at a distance along the road: current segment, next segment, interpolated road height.
 * Used by physics, rendering, and collision.
 * @param {number} pos - Distance along track (world units).
 * @returns {{ startSegIndex: number, offset: number, baseSeg: object, nextSeg: object, trackElevation: number }}
 */
function getTrackState(pos) {
    const startSegIndex = Math.floor(pos / segmentLength) % segments.length;
    const offset = pos % segmentLength;
    const baseSeg = segments[startSegIndex];
    const nextSeg = segments[(startSegIndex + 1) % segments.length];
    const trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);
    return { startSegIndex, offset, baseSeg, nextSeg, trackElevation };
}

/** Shared centrifugal (curve) force for player and NPCs; lateral push per frame. */
function curveForceMagnitude(curve, speedKmh, handbrakeMul) {
    if (speedKmh <= 0) return 0;
    let f = (curve * speedKmh * speedKmh) / CURVE_FORCE_DIVISOR;
    if (speedKmh < CURVE_FORCE_SPEED_THRESHOLD) f *= speedKmh / CURVE_FORCE_SPEED_THRESHOLD;
    return f * (handbrakeMul || 1);
}

/**
 * Engine RPM from speed and gear (linear map per gear max speed).
 * @param {number} speedKmh - Speed in km/h.
 * @param {number} gear - Current gear (1..NUM_GEARS).
 * @returns {number} RPM in [RPM_IDLE, RPM_REDLINE].
 */
function computeRpm(speedKmh, gear) {
    const gearMax = GEAR_MAX_SPEEDS[gear - 1];
    if (gearMax <= 0) return RPM_IDLE;
    return Math.min(
        RPM_REDLINE,
        RPM_IDLE + (speedKmh / gearMax) * (RPM_REDLINE - RPM_IDLE)
    );
}

// --- HUD & UI state ---
let currentLap = 1;
let currentLapTime = 0;
let lastLapTime = 0;
let lapStartTime = Date.now();

// --- Race & opponents (first to 3 laps wins) ---
const RACE_LAPS = 3;
const NUM_OPPONENTS = 10;
let raceOver = false;
let raceWinner = null;
let raceWinnerName = null;
let raceStartTime = 0;
const playerSpeedSamples = [];
const PLAYER_SPEED_SAMPLES_MAX = 90;
let playerAvgSpeed = 110;

let keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, ShiftLeft: false };

// --- Engine sound (Web Audio API, procedural) ---
let engineSoundReady = false;
let audioContext = null;
let engineGainNode = null;
let engineOsc1 = null;
let engineOsc2 = null;
let engineFilter = null;

/**
 * One-shot procedural crash SFX (noise, low thud, crunch). Called on obstacle/NPC collisions.
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

        // Noise impact (longer, fuller)
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

        // Low “boom” foundation
        const thud = ctx.createOscillator();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(90, t0);
        thud.frequency.exponentialRampToValueAtTime(28, t0 + 0.12);
        thud.connect(gainNode);
        thud.start(t0);
        thud.stop(t0 + 0.28);

        // Second low tone for weight
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

        // Short mid-frequency “crunch”
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
 * Initializes engine sound (AudioContext, oscillators, filter).
 * Called on first key/touch (browser autoplay policy). Idempotent.
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
 * Updates engine oscillator frequencies and gain from RPM and throttle.
 * @param {number} rpm - Current engine RPM.
 * @param {number} throttle - Throttle 0..1 (e.g. 1 when ArrowUp held).
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

// Touch gear shift buttons (data-action="gearUp" / "gearDown")
document.querySelectorAll('#touchControls [data-action]').forEach(btn => {
    const action = btn.dataset.action;

    function handleGear() {
        startEngineSound();
        if (action === 'gearUp' && currentGear < NUM_GEARS) {
            currentGear++;
        } else if (action === 'gearDown' && currentGear > 1) {
            currentGear--;
            speed = Math.min(speed, GEAR_MAX_SPEEDS[currentGear - 1]);
        }
    }

    btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        handleGear();
    });
    btn.addEventListener('contextmenu', e => e.preventDefault());
});

// Prevent context menu (copy/paste) on long-press anywhere in touch controls (iOS etc.)
document.addEventListener('contextmenu', e => {
    if (e.target.closest('#touchControls')) e.preventDefault();
}, true);

// --- Road/grass/rumble palette per biome (zones in track JSON) ---
const COLORS = {
    DARK: { road: '#5b5b5b', grass: '#10AA10', rumble: '#555' },
    LIGHT: { road: '#696969', grass: '#009A00', rumble: '#FFF' },
    START: { road: '#FFF', grass: '#FFF', rumble: '#111' },
    DESERT_DARK: { road: '#6a5a4a', grass: '#C9A86C', rumble: '#8B7355' },
    DESERT_LIGHT: { road: '#7d6b58', grass: '#D4B896', rumble: '#9B7D5E' },
    SNOW_DARK: { road: '#6a6e72', grass: '#E8EEF2', rumble: '#9BA3AA' },
    SNOW_LIGHT: { road: '#7d8288', grass: '#F0F4F8', rumble: '#B0B8C0' },
    ICE_DARK: { road: '#5a6a7a', grass: '#B8D4E8', rumble: '#7a9ab0' },
    ICE_LIGHT: { road: '#6c7d8e', grass: '#D0E4F0', rumble: '#8fA8B8' },
    ICELAND_GREEN_DARK: { road: '#4a5a4a', grass: '#3d6b3d', rumble: '#5a6a5a' },
    ICELAND_GREEN_LIGHT: { road: '#5a6a5a', grass: '#4d7d4d', rumble: '#6a7a6a' },
    SKY_TOP: '#1E90FF', SKY_BOTTOM: '#72D7EE',
    MOUNTAIN_1: '#3E4E6E', MOUNTAIN_2: '#2E3E5E',
    CLOUD: 'rgba(255, 255, 255, 0.3)'
};

// --- Track generation & loading ---

/**
 * Built-in default track JSON (used when data/track.json fails to load).
 * @returns {object} Track definition: segmentCount, curves, hills, ramps, zones, startSegmentCount.
 */
function getDefaultTrack() {
    return {
        name: 'Default',
        segmentCount: 2000,
        curves: [
            { start: 100, end: 300, strength: 1.5 },
            { start: 400, end: 600, strength: -3.5 },
            { start: 700, end: 900, strength: 3.0 },
            { start: 1200, end: 1400, strength: -2.5 },
            { start: 1600, end: 1800, strength: 1.5 }
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
 * Loads track JSON from `data/track.json`, or `data/<name>.json` when URL has `?track=<name>`.
 * @returns {Promise<object|null>} Parsed track object or null on error.
 */
function loadTrackData() {
    const params = new URLSearchParams(document.location.search);
    const name = params.get('track') || 'track';
    const url = `data/${name}.json`;
    return fetch(url)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null);
}

/** Terrain height from hills only (no ramps). Used for smooth transitions after ramp landings. */
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
 * Builds the full track from JSON and spawns opponent cars.
 * Fills globals `segments` and `cars`. Called with data from loadTrackData() or getDefaultTrack().
 * @param {object} trackData - segmentCount, curves[], hills[], ramps[], zones[], startSegmentCount.
 */
function buildRoad(trackData) {
    if (!trackData) trackData = getDefaultTrack();
    const segmentCount = trackData.segmentCount || 2000;
    const curves = trackData.curves || [];
    const hills = trackData.hills || [];
    const ramps = trackData.ramps || [];
    const zones = trackData.zones || [];
    const startSegmentCount = trackData.startSegmentCount ?? 6;

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

    const curveBlendLen = 25;

    for (let n = 0; n < segmentCount; n++) {
        let curve = 0;
        let y = getTerrainY(n, hills);
        const zone = getZoneType(n);
        let color;
        if (zone === 'desert') color = Math.floor(n / 3) % 2 ? COLORS.DESERT_DARK : COLORS.DESERT_LIGHT;
        else if (zone === 'snow') color = Math.floor(n / 3) % 2 ? COLORS.SNOW_DARK : COLORS.SNOW_LIGHT;
        else if (zone === 'ice') color = Math.floor(n / 3) % 2 ? COLORS.ICE_DARK : COLORS.ICE_LIGHT;
        else if (zone === 'iceland_green') color = Math.floor(n / 3) % 2 ? COLORS.ICELAND_GREEN_DARK : COLORS.ICELAND_GREEN_LIGHT;
        else color = Math.floor(n / 3) % 2 ? COLORS.DARK : COLORS.LIGHT;
        if (n < startSegmentCount) color = COLORS.START;

        for (const c of curves) {
            const len = (c.end || c.start) - c.start;
            const blend = Math.min(curveBlendLen, Math.max(0, Math.floor(len / 4)));
            if (n >= c.start && n < (c.end || c.start)) {
                let t = 1;
                if (blend > 0) {
                    if (n < c.start + blend) t = (n - c.start) / blend;
                    else if (n >= c.end - blend) t = (c.end - n) / blend;
                }
                curve += (c.strength || 0) * t;
            }
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

        if (zone === 'nature') {
            if (n % 5 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                let treeType = Math.random() > 0.5 ? 'TREE_PINE' : 'TREE_LEAFY';
                segmentSprites.push({ type: treeType, offset: side * (1.6 + Math.random() * 1.2) });
            }
        } else if (zone === 'desert') {
            if (n % 8 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                segmentSprites.push({ type: 'CACTUS', offset: side * (1.5 + Math.random() * 1.0) });
            }
        } else if (zone === 'snow') {
            if (n % 6 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                segmentSprites.push({ type: Math.random() > 0.6 ? 'SNOWY_PINE' : 'ROCK', offset: side * (1.5 + Math.random() * 1.0) });
            }
        } else if (zone === 'ice') {
            if (n % 10 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                segmentSprites.push({ type: 'ROCK', offset: side * (1.6 + Math.random() * 0.8) });
            }
        } else if (zone === 'iceland_green') {
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

        const signInterval = (zone === 'nature' || zone === 'desert' || zone === 'snow' || zone === 'ice' || zone === 'iceland_green') ? 40 : 80;
        if (n % signInterval === 0 && Math.abs(curve) > 1) {
            segmentSprites.push({ type: 'SIGN', offset: curve > 0 ? -2.0 : 2.0 });
        }

        segments.push({
            y: y,
            curve: curve,
            sprites: segmentSprites,
            cars: [],
            color: color,
            p1: { x: 0, y: 0, w: 0 },
            rampTakeoff: rampTakeoff
        });
    }

    // Close the loop: net curve sum = 0 so start meets finish geometrically
    let totalCurve = 0;
    for (let i = 0; i < segments.length; i++) totalCurve += segments[i].curve;
    if (segments.length > 0 && Math.abs(totalCurve) > 1e-6) {
        const correction = totalCurve / segments.length;
        for (let i = 0; i < segments.length; i++) segments[i].curve -= correction;
    }

    const trackLength = segmentCount * segmentLength;
    raceOver = false;
    raceWinner = null;
    raceWinnerName = null;
    raceStartTime = Date.now();
    cars = [];
    const opponentColors = ['#2266dd', '#dd6622', '#22aa44', '#aa22aa', '#ddcc22', '#22cccc', '#cc4422', '#6688dd', '#88dd66', '#dd88aa'];
    const baseTargetSpeed = Math.min(maxSpeed * 0.92, 200);
    for (let i = 0; i < NUM_OPPONENTS; i++) {
        const speedFactor = 0.86 + (i / (NUM_OPPONENTS - 1 || 1)) * 0.18;
        cars.push({
            z: i * 280,
            offset: -0.5 + (i % 5) * 0.25,
            speed: 0,
            dir: 1,
            lap: 0,
            name: String(i + 1),
            color: opponentColors[i % opponentColors.length],
            targetSpeedFactor: speedFactor,
            startDelay: i * 0.45,
            crashed: false,
            crashRot: 0,
            crashSpin: 0,
            crashVelX: 0,
            crashVelZ: 0,
            crashY: 0,
            crashVelY: 0,
            crashTimer: 0,
            originalSpeed: baseTargetSpeed * speedFactor,
            airY: 0,
            airVelY: 0
        });
    }
}

// --- 3D → 2D projection (forward view + road quads) ---

/**
 * Perspective projection of a world point to screen. Writes `p.x`, `p.y`, `p.w` (half road width in px).
 * @param {{ x: number, y: number, w: number }} p - Output object.
 * @param {number} worldX - Lateral (across road).
 * @param {number} worldY - Height.
 * @param {number} worldZ - Along track (forward).
 * @param {number} camX - Camera X.
 * @param {number} camY - Camera Y.
 * @param {number} camZ - Camera Z.
 */
function project(p, worldX, worldY, worldZ, camX, camY, camZ) {
    let z = Math.max(1, worldZ - camZ);
    let scale = cameraDepth / z;
    p.x = Math.round(width / 2 + (scale * (worldX - camX) * width / 2));
    p.y = Math.round(height / 2 - (scale * (worldY - camY) * height / 2));
    p.w = Math.round(scale * roadWidth * width / 2);
}

/**
 * Projects a world point into 2D for the rear-view mirror (camera looks backward).
 * z = camZ - worldZ so segments behind the player have positive z.
 * Output coordinates are in mirror viewport space (centerX, centerY, viewW, viewH).
 */
function projectRear(p, worldX, worldY, worldZ, camX, camY, camZ, centerX, centerY, viewW, viewH) {
    let z = Math.max(1, camZ - worldZ);
    let scale = cameraDepth / z;
    p.x = Math.round(centerX + (scale * (worldX - camX) * viewW / 2));
    p.y = Math.round(centerY - (scale * (worldY - camY) * viewH / 2));
    p.w = Math.max(1, Math.round(scale * roadWidth * viewW / 2));
}

/** Like projectRear but takes distance-behind directly (for wrapped track). */
function projectRearByDistance(p, worldX, worldY, zBehind, camX, camY, centerX, centerY, viewW, viewH) {
    let z = Math.max(1, zBehind);
    let scale = cameraDepth / z;
    p.x = Math.round(centerX + (scale * (worldX - camX) * viewW / 2));
    p.y = Math.round(centerY - (scale * (worldY - camY) * viewH / 2));
    p.w = Math.max(1, Math.round(scale * roadWidth * viewW / 2));
}

/**
 * Fills a trapezoid between two projected road cross-sections (road or rumble stripe).
 * @param {string} color - Fill (e.g. seg.color.road, seg.color.rumble).
 * @param {number} x1, y1, w1 - Near cross-section center X/Y and half-width (px).
 * @param {number} x2, y2, w2 - Far cross-section.
 */
function drawQuad(color, x1, y1, w1, x2, y2, w2) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x1 + w1, y1);
    ctx.fill();
}

/** Rear-view mirror: size and position (top-center, so it doesn't overlap Lap/Time on the left). */
const MIRROR_W = 200;
const MIRROR_H = 95;
const MIRROR_Y = 12;
const MIRROR_SEGMENTS = 100;

/**
 * Draws the rear-view mirror: road behind the player (perspective looking backward).
 */
function drawRearViewMirror(startSegIndex, camX, camY, camZ) {
    if (!segments.length) return;
    const mirrorX = Math.floor(width / 2 - MIRROR_W / 2);
    const L = segments.length;
    const centerX = mirrorX + MIRROR_W / 2;
    const centerY = MIRROR_Y + MIRROR_H / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);
    ctx.clip();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);

    const _pNear = { x: 0, y: 0, w: 0 };
    const _pFar = { x: 0, y: 0, w: 0 };
    let xBack = 0;
    let maxY = MIRROR_Y + MIRROR_H;

    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const sNext = (s + 1) % L;
        const seg = segments[s];
        const nextSeg = segments[sNext];
        const nearZ = (s + 1) * segmentLength;
        const farZ = s * segmentLength;

        xBack -= seg.curve;
        const xNear = xBack + seg.curve;
        const xFar = xBack;

        projectRear(_pNear, xNear, nextSeg.y, nearZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);
        projectRear(_pFar, xFar, seg.y, farZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);

        if (_pNear.y >= maxY && _pFar.y >= maxY) continue;

        ctx.fillStyle = seg.color.grass;
        const topY = Math.min(_pNear.y, _pFar.y);
        if (maxY > topY) ctx.fillRect(mirrorX, topY, MIRROR_W, maxY - topY);
        maxY = topY;

        drawQuad(seg.color.rumble, _pNear.x, _pNear.y, _pNear.w * 1.1, _pFar.x, _pFar.y, _pFar.w * 1.1);
        drawQuad(seg.color.road, _pNear.x, _pNear.y, _pNear.w, _pFar.x, _pFar.y, _pFar.w);
    }

    const trackLength = L * segmentLength;
    const mirrorClipY = MIRROR_Y + MIRROR_H;
    const _pSprite = { x: 0, y: 0, w: 0 };
    const mirrorSprites = [];
    let xBackAcc = 0;
    const xFarByN = [];
    const xNearByN = [];
    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const seg = segments[s];
        xBackAcc -= seg.curve;
        xFarByN[n] = xBackAcc;
        xNearByN[n] = xBackAcc + seg.curve;
    }

    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const seg = segments[s];
        const farZ = s * segmentLength;
        const xNear = xNearByN[n];
        const xFar = xFarByN[n];

        for (let i = 0; i < seg.sprites.length; i++) {
            const sprite = seg.sprites[i];
            const worldX = xFar + sprite.offset * roadWidth;
            projectRear(_pSprite, worldX, seg.y, farZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);
            if (_pSprite.x >= mirrorX - 50 && _pSprite.x <= mirrorX + MIRROR_W + 50 && _pSprite.y >= MIRROR_Y - 20 && _pSprite.y <= mirrorClipY + 20) {
                mirrorSprites.push({ type: sprite.type, data: sprite.data, x: _pSprite.x, y: _pSprite.y, w: _pSprite.w });
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            const car = seg.cars[i];
            const zBehind = (camZ - car.z + trackLength) % trackLength;
            if (zBehind <= 0 || zBehind > MIRROR_SEGMENTS * segmentLength) continue;
            const t = (car.z - s * segmentLength) / segmentLength;
            const roadX = xFar + t * (xNear - xFar) + car.offset * roadWidth;
            const segY = seg.y;
            projectRearByDistance(_pSprite, roadX, segY, zBehind, camX, camY, centerX, centerY, MIRROR_W, MIRROR_H);
            if (_pSprite.x >= mirrorX - 50 && _pSprite.x <= mirrorX + MIRROR_W + 50 && _pSprite.y >= MIRROR_Y - 20 && _pSprite.y <= mirrorClipY + 20) {
                mirrorSprites.push({ type: 'NPC_CAR', data: car, x: _pSprite.x, y: _pSprite.y, w: _pSprite.w });
            }
        }
    }

    mirrorSprites.sort((a, b) => b.y - a.y);
    for (let i = 0; i < mirrorSprites.length; i++) {
        const o = mirrorSprites[i];
        drawProceduralSprite({ type: o.type, data: o.data }, o.x, o.y, o.w, mirrorClipY);
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);
}

/**
 * Sky gradient, clouds, and parallax mountains above the horizon line.
 * @param {number} horizonY - Screen Y of the horizon.
 */
let _cachedSkyGradient = null;
let _cachedSkyH = 0;

function drawParallaxLayers(horizonY) {
    if (!_cachedSkyGradient || _cachedSkyH !== height) {
        _cachedSkyGradient = ctx.createLinearGradient(0, 0, 0, height);
        _cachedSkyGradient.addColorStop(0, COLORS.SKY_TOP);
        _cachedSkyGradient.addColorStop(1, COLORS.SKY_BOTTOM);
        _cachedSkyH = height;
    }
    ctx.fillStyle = _cachedSkyGradient; ctx.fillRect(0, 0, width, height);

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

// --- Procedural sprites (trees, buildings, signs, NPC cars) ---

/**
 * Draws a procedural sprite at projected screen position. Clips to `clipY` so nearer road draws on top.
 * @param {{ type: string, data?: object }} spriteObj - e.g. 'TREE_PINE', 'BUILDING', 'NPC_CAR'.
 * @param {number} destX - Sprite center X.
 * @param {number} destY - Baseline Y (ground contact).
 * @param {number} destW - Projected width (scale).
 * @param {number} clipY - Bottom of clip rect (depth ordering).
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
    } else if (spriteObj.type === 'CACTUS') {
        let cactW = 120 * s, cactH = 280 * s;
        ctx.fillStyle = '#4a6741'; ctx.fillRect(destX - cactW / 6, destY - cactH, cactW / 3, cactH);
        ctx.fillStyle = '#5a7a51'; ctx.fillRect(destX - cactW / 4, destY - cactH * 0.6, cactW / 5, cactH * 0.5);
        ctx.fillRect(destX + cactW / 8, destY - cactH * 0.35, cactW / 5, cactH * 0.35);
        ctx.beginPath(); ctx.ellipse(destX, destY - cactH - 15 * s, cactW * 0.2, 25 * s, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'ROCK') {
        let rockW = 180 * s, rockH = 120 * s;
        ctx.fillStyle = '#4a4a4a'; ctx.beginPath();
        ctx.ellipse(destX, destY - rockH / 2, rockW / 2, rockH / 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a3a3a'; ctx.beginPath();
        ctx.ellipse(destX - rockW * 0.15, destY - rockH * 0.4, rockW * 0.25, rockH * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'SNOWY_PINE') {
        let treeW = 200 * s, treeH = 380 * s;
        ctx.fillStyle = '#5a4a3a'; ctx.fillRect(destX - treeW / 6, destY - treeH / 4, treeW / 3, treeH / 4);
        ctx.fillStyle = '#2d4a2d'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH); ctx.lineTo(destX - treeW / 2, destY - treeH / 4); ctx.lineTo(destX + treeW / 2, destY - treeH / 4); ctx.fill();
        ctx.fillStyle = '#E8EEF2'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH * 0.85); ctx.lineTo(destX - treeW * 0.4, destY - treeH * 0.3); ctx.lineTo(destX + treeW * 0.4, destY - treeH * 0.3); ctx.fill();
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
    } else if (spriteObj.type === 'NPC_CAR') {
        let car = spriteObj.data; let carW = 140 * s; let carH = 70 * s;
        const totalLift = (car.crashY || 0) + (car.airY || 0);
        const npcDrawY = destY - totalLift * s * 0.4;

        if (totalLift > 0) {
            const shadowScale = Math.max(0.15, 1 - totalLift * 0.001);
            ctx.fillStyle = `rgba(0,0,0,${0.25 * shadowScale})`;
            ctx.beginPath();
            ctx.ellipse(destX, destY, Math.max(5, carW * 0.4 * shadowScale), 6 * s * shadowScale, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        if (car.crashed && car.crashRot) {
            ctx.save();
            ctx.translate(destX, npcDrawY - carH / 2);
            ctx.rotate(car.crashRot);
            ctx.translate(-destX, -(npcDrawY - carH / 2));
        }

        ctx.fillStyle = '#111';
        ctx.fillRect(destX - carW / 2.2, npcDrawY - carH / 4, carW / 4, carH / 2);
        ctx.fillRect(destX + carW / 2.2 - carW / 4, npcDrawY - carH / 4, carW / 4, carH / 2);
        ctx.fillStyle = car.color;
        ctx.fillRect(destX - carW / 2, npcDrawY - carH, carW, carH * 0.8);
        ctx.fillStyle = '#333';
        ctx.fillRect(destX - carW / 3, npcDrawY - carH + carH * 0.1, carW * 0.66, carH * 0.3);
        if (car.dir === -1) ctx.fillStyle = '#FFFDE7'; else ctx.fillStyle = '#D00';
        ctx.fillRect(destX - carW / 2 + 5 * s, npcDrawY - carH * 0.4, 25 * s, 12 * s);
        ctx.fillRect(destX + carW / 2 - 30 * s, npcDrawY - carH * 0.4, 25 * s, 12 * s);

        if (car.crashed && car.crashRot) ctx.restore();
    }
    ctx.restore();
}

// --- HUD gauges & minimap ---

/**
 * Analog RPM gauge (left of speedo): needle, redline arc, current gear digit.
 * @param {number} rpm - RPM to display.
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
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * (1 - REDLINE_DROPOFF_START / RPM_REDLINE), 0, false); ctx.stroke();
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
 * Analog speedometer (top right).
 * @param {number} speedKmh - Speed in km/h.
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
    ctx.strokeStyle = speedKmh > maxSpeed * 0.92 ? '#FF4444' : '#FFF'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(Math.round(speedKmh) + ' km/h', cx, cy + r - 2);
}

/**
 * Compact lap progress bar (bottom left): start/finish marker and player dot.
 */
function drawTrackOverview() {
    if (!segments.length) return;
    const trackLength = segments.length * segmentLength;
    const progress = trackLength > 0 ? (position % trackLength) / trackLength : 0;

    const barW = 130;
    const barH = 10;
    const x = 15;
    const y = height - 28;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, barW, barH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, barH);

    // Start/finish marker (left of bar)
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('S/Z', x + 4, y + barH / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(x + 22, y + 2, 2, barH - 4);

    // Player position dot
    const px = x + 26 + (barW - 34) * progress;
    ctx.fillStyle = '#e62222';
    ctx.beginPath();
    ctx.arc(px, y + barH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}

/**
 * Minimap (bottom right): top-down track polyline and player position.
 */
function drawTrackMap() {
    if (!segments.length) return;
    const trackLength = segments.length * segmentLength;
    const step = Math.max(1, Math.floor(segments.length / 150));
    let pathX = 0;
    const points = [{ x: 0, z: 0 }];
    for (let i = 0; i < segments.length; i += step) {
        for (let j = i; j < Math.min(i + step, segments.length); j++) pathX += segments[j].curve;
        points.push({ x: pathX, z: Math.min(i + step, segments.length) * segmentLength });
    }
    if (points.length < 2) return;

    let minX = points[0].x, maxX = points[0].x, minZ = 0, maxZ = trackLength;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;

    const mapW = 120;
    const mapH = 100;
    const pad = 8;
    const left = width - 15 - mapW;
    const top = height - 15 - mapH;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(left, top, mapW, mapH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, mapW, mapH);

    const toScreenX = (x) => left + pad + ((x - minX) / rangeX) * (mapW - 2 * pad);
    const toScreenZ = (z) => top + mapH - pad - (z / maxZ) * (mapH - 2 * pad);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toScreenX(points[0].x), toScreenZ(points[0].z));
    for (let i = 1; i < points.length; i++) ctx.lineTo(toScreenX(points[i].x), toScreenZ(points[i].z));
    ctx.lineTo(toScreenX(points[0].x), toScreenZ(points[0].z));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(toScreenX(points[0].x), toScreenZ(0), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    const posInLap = position % trackLength;
    let playerPathX = 0;
    const segIndex = Math.floor(posInLap / segmentLength) % segments.length;
    const offsetInSeg = posInLap % segmentLength;
    for (let i = 0; i < segIndex; i++) playerPathX += segments[i].curve;
    playerPathX += (offsetInSeg / segmentLength) * segments[segIndex].curve;
    const playerScreenX = toScreenX(playerPathX);
    const playerScreenZ = toScreenZ(posInLap);

    ctx.fillStyle = '#e62222';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenZ, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

/**
 * Full HUD: lap/time/position box, RPM, speedo, progress bar, minimap; race-over screen; crash banner.
 * @param {number} [displayRpm] - Override RPM (e.g. RPM_IN_AIR when jumping); else from speed/gear.
 */
function drawHUD(displayRpm) {
    const rpm = displayRpm != null ? displayRpm : computeRpm(speed, currentGear);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(15, 15, 200, 112);
    drawRPMGauge(rpm);
    drawSpeedGauge(speed);

    // Lap, race position, times
    let playerPosition = 1;
    if (segments.length && cars.length) {
        const trackLen = segments.length * segmentLength;
        const playerZ = position % trackLen;
        const entries = [{ lap: currentLap - 1, z: playerZ, isPlayer: true }];
        for (let i = 0; i < cars.length; i++) {
            entries.push({ lap: cars[i].lap, z: cars[i].z, isPlayer: false });
        }
        entries.sort((a, b) => { if (a.lap !== b.lap) return b.lap - a.lap; return b.z - a.z; });
        const idx = entries.findIndex(e => e.isPlayer);
        if (idx >= 0) playerPosition = idx + 1;
    }
    const totalRacers = 1 + (cars.length || 0);
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 20px "Courier New"'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`LAP:  ${currentLap}/${RACE_LAPS}`, 25, 40);
    ctx.fillText(`POS:  ${playerPosition}/${totalRacers}`, 25, 58);
    ctx.fillText(`TIME: ${currentLapTime.toFixed(2)}s`, 25, 78);
    if (lastLapTime > 0) { ctx.fillStyle = '#AAA'; ctx.fillText(`LAST: ${lastLapTime.toFixed(2)}s`, 25, 103); }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 12px "Courier New"'; ctx.fillText('First to 3 laps wins', 25, 121);

    drawTrackOverview();
    drawTrackMap();

    if (raceOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 48px "Courier New"';
        if (raceWinner === 'player') {
            ctx.fillStyle = '#4a4';
            ctx.fillText('YOU WIN!', width / 2, height / 2 - 20);
            ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px "Courier New"';
            ctx.fillText('First to 3 laps', width / 2, height / 2 + 30);
        } else {
            ctx.fillStyle = '#c44';
            ctx.fillText(`OPPONENT ${raceWinnerName} WINS!`, width / 2, height / 2 - 20);
            ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px "Courier New"';
            ctx.fillText('First to 3 laps', width / 2, height / 2 + 30);
        }
    }

    if (isCrashed) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.fillRect(0, height / 2 - 50, width, 100);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Courier New"';
        ctx.fillText("CRASHED!", width / 2, height / 2 + 15);
    }
}

// --- Main frame render ---

/**
 * One full frame: parallax, ~300 road segments (curve + height), sprites, rear mirror, player car, HUD.
 * Camera from getTrackState(position); sorts sprites back-to-front via clipY.
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

    const _projTmp = { x: 0, y: 0, w: 0 };

    for (let n = 0; n < 300; n++) {
        let seg = segments[(startSegIndex + n) % segments.length];
        const segZ = (startSegIndex + n) * segmentLength;

        project(seg.p1, x, seg.y, segZ, camX, camY, camZ - (n === 0 ? offset : 0));
        let currentCurveX = x;
        x += dx; dx += seg.curve;

        for (let i = 0; i < seg.sprites.length; i++) {
            project(_projTmp, currentCurveX + seg.sprites[i].offset * roadWidth, seg.y, segZ, camX, camY, camZ - (n === 0 ? offset : 0));
            if (_projTmp.x > -1000 && _projTmp.x < width + 1000) {
                spritesToDraw.push({ type: seg.sprites[i].type, data: seg.sprites[i].data, x: _projTmp.x, y: _projTmp.y, w: _projTmp.w, clipY: maxY });
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            let car = seg.cars[i];
            let carVisualZ = segZ + (car.z % segmentLength);
            project(_projTmp, currentCurveX + car.offset * roadWidth, seg.y, carVisualZ, camX, camY, camZ - (n === 0 ? offset : 0));

            if (_projTmp.x > -1000 && _projTmp.x < width + 1000) {
                spritesToDraw.push({ type: 'NPC_CAR', data: car, x: _projTmp.x, y: _projTmp.y, w: _projTmp.w, clipY: maxY });
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

    drawRearViewMirror(startSegIndex, camX, camY, camZ);

    const carW = 130; const carH = 55;
    let carX = width / 2 - carW / 2;

    let jumpHeight = Math.max(0, playerY - trackElevation);

    const onShoulder = Math.abs(playerX) > ROAD_EDGE && !isCrashed;

    const _now = performance.now();
    const bounce = (speed > 0 && jumpHeight === 0 && !isCrashed)
        ? Math.sin(_now * 0.012) * 1.2 + Math.sin(_now * 0.029) * 0.6
        : 0;

    ctx.save();
    if (onShoulder && speed > 0 && jumpHeight === 0) {
        const jitterX = Math.sin(_now * 0.047) * 3 + Math.sin(_now * 0.113) * 2;
        const jitterY = Math.sin(_now * 0.073) * 1.5 + Math.sin(_now * 0.157) * 1;
        ctx.translate(jitterX, jitterY);
    }
    const onGroundForRoll = jumpHeight < 12;
    if (!isCrashed && onGroundForRoll && speed > 0) {
        const handbrakeMul = 1 + handbrakeAmount * (HANDBRAKE_CURVE_MUL - 1);
        const rollAngle = Math.max(-CURVE_ROLL_MAX, Math.min(CURVE_ROLL_MAX, curveForceMagnitude(baseSeg.curve, speed, handbrakeMul) * CURVE_ROLL_SCALE));
        if (Math.abs(rollAngle) > 0.008) {
            const cx = carX + carW / 2;
            const cy = height - carH - 20 + bounce - (jumpHeight * 0.015) + carH / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rollAngle);
            ctx.translate(-cx, -cy);
        }
    }
    if (isCrashed) {
        let cx = carX + carW / 2;
        let cy = (height - carH - 20) + carH / 2;
        ctx.translate(cx, cy - jumpHeight * 0.015);
        ctx.rotate(crashRot);
        ctx.translate(-cx, -(cy - jumpHeight * 0.015));
    } else if (jumpHeight > 0) {
        let pitchAngle = 0;
        if (keys.ArrowUp) pitchAngle = -0.12;
        else if (keys.ArrowDown) pitchAngle = 0.15;
        const roadRollInAir = baseSeg.curve * 0.012;
        const cx = carX + carW / 2;
        const cy = height - carH - 20 - jumpHeight * 0.015 + carH / 2;
        ctx.translate(cx, cy);
        if (pitchAngle !== 0) ctx.rotate(pitchAngle);
        ctx.rotate(roadRollInAir);
        ctx.translate(-cx, -cy);
    }
    const carY = height - carH - 20 + bounce - (jumpHeight * 0.015);

    if (jumpHeight > 0 && !isCrashed) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(carX + carW / 2, height - 20, Math.max(10, carW / 2 - jumpHeight * 0.01), 10, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#111'; ctx.fillRect(carX - 8, carY + 15, 25, 30); ctx.fillRect(carX + carW - 17, carY + 15, 25, 30);
    ctx.fillStyle = '#e62222'; ctx.fillRect(carX, carY + 25, carW, 30); ctx.fillRect(carX + 25, carY, carW - 50, 25);
    ctx.fillStyle = '#444'; ctx.fillRect(carX + 30, carY + 5, carW - 60, 20);
    ctx.fillStyle = keys.ArrowDown ? '#ff0000' : '#ff8800'; ctx.fillRect(carX + 8, carY + 30, 15, 8); ctx.fillRect(carX + carW - 23, carY + 30, 15, 8);

    ctx.restore();

    const inAirForHUD = !isCrashed && (playerY - trackElevation > IN_AIR_THRESHOLD);
    drawHUD(inAirForHUD ? RPM_IN_AIR : undefined);
}

// --- Collisions & opponent AI ---

/**
 * Static obstacle hits (trees, buildings, lights, signs). Only on ground; skips post-crash invuln window.
 * High speed → crash + spin; low speed → speed zeroed.
 * @param {{ startSegIndex: number, baseSeg: object, nextSeg: object, trackElevation: number }} trackState - From getTrackState().
 */
function checkStaticObstacleCollision(trackState) {
    const inAir = playerY > trackState.trackElevation + IN_AIR_THRESHOLD || playerVelY > 25;
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
            if (sprite.type === 'TREE_PINE' || sprite.type === 'TREE_LEAFY' || sprite.type === 'CACTUS' || sprite.type === 'ROCK' || sprite.type === 'SNOWY_PINE') spriteW = 0.45;
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

const NPC_CRASH_DURATION = 180;
const NPC_CRASH_GRAVITY = 6;
const NPC_RESPAWN_DELAY = 300;

/** Puts an opponent into crash animation state and plays SFX (called from player–NPC collision). */
function crashNPCCar(car, impactSpeed, lateralDir) {
    car.crashed = true;
    car.crashTimer = 0;
    car.originalSpeed = car.speed;
    car.speed = 0;
    car.crashSpin = (0.08 + Math.random() * 0.15) * (lateralDir >= 0 ? 1 : -1);
    car.crashVelX = lateralDir * (0.02 + impactSpeed * 0.004);
    car.crashVelZ = impactSpeed * 0.6;
    car.crashVelY = Math.min(400, 80 + impactSpeed * 2.5);
    car.crashY = 0;
    car.crashRot = 0;
    playCrashSound();
}

let _dirtyCarSegments = [];

/**
 * Clears/rebuilds per-segment `cars` lists, advances AI (speed, curve, ramps, laps), handles crash/recovery.
 * Player overlap → soft bump or mutual crash; sets raceOver if an opponent finishes RACE_LAPS first.
 * @param {object} trackState - Result of getTrackState() for the player (Z overlap and in-air checks).
 * @param {number} dt60 - Delta time scaled to 60 FPS units.
 */
function updateNPCsAndCheckCollision(trackState, dt60) {
    const maxZ = segments.length * segmentLength;
    for (let i = 0; i < _dirtyCarSegments.length; i++) _dirtyCarSegments[i].cars = [];
    _dirtyCarSegments = [];

    for (let i = 0; i < cars.length; i++) {
        const car = cars[i];

        if (car.crashed) {
            car.crashTimer += dt60;
            car.crashRot += car.crashSpin * dt60;
            car.crashSpin *= Math.pow(0.985, dt60);
            car.crashVelY -= NPC_CRASH_GRAVITY * dt60;
            car.crashY += car.crashVelY * dt60;
            if (car.crashY < 0) {
                car.crashY = 0;
                car.crashVelY = Math.abs(car.crashVelY) > 30
                    ? -car.crashVelY * 0.3 : 0;
                car.crashSpin *= 0.5;
            }
            car.offset += car.crashVelX * dt60;
            car.crashVelX *= Math.pow(0.97, dt60);
            car.z += car.crashVelZ * dt60;
            car.crashVelZ *= Math.pow(0.95, dt60);

            if (car.z < 0) car.z += maxZ;
            if (car.z >= maxZ) car.z -= maxZ;
            const crashSeg = segments[Math.floor(car.z / segmentLength) % segments.length];
            crashSeg.cars.push(car);
            _dirtyCarSegments.push(crashSeg);

            if (car.crashTimer > NPC_RESPAWN_DELAY) {
                car.crashed = false;
                car.crashRot = 0;
                car.crashY = 0;
                car.airY = 0;
                car.airVelY = 0;
                car.speed = Math.min(maxSpeed * 0.95, playerAvgSpeed * car.targetSpeedFactor);
                car.originalSpeed = car.speed;
                car.offset = Math.max(-NPC_ROAD_OFFSET_MAX, Math.min(NPC_ROAD_OFFSET_MAX, car.offset));
            }
            continue;
        }

        let carSegIdx = Math.floor(car.z / segmentLength) % segments.length;
        let carSeg = segments[carSegIdx];
        const elapsed = (Date.now() - raceStartTime) / 1000;
        if (elapsed < car.startDelay) {
            carSeg.cars.push(car);
            _dirtyCarSegments.push(carSeg);
            continue;
        }
        const targetSpeed = Math.max(60, Math.min(maxSpeed * 0.96, playerAvgSpeed * car.targetSpeedFactor));
        if (car.speed < 20) car.speed = Math.min(car.speed + 8 * dt60, targetSpeed * 0.3);
        car.speed += (targetSpeed - car.speed) * 0.02 * dt60;
        car.speed = Math.max(40, Math.min(maxSpeed * 0.98, car.speed));

        car.speed = Math.max(0, car.speed - AERO_DRAG * car.speed * car.speed * dt60);
        const nextSeg = segments[(carSegIdx + 1) % segments.length];
        const slope = (nextSeg.y - carSeg.y) / segmentLength;
        car.speed = Math.max(0, car.speed + (-slope * SLOPE_GRAVITY_FACTOR) * dt60);

        const npcShoulderDepth = Math.max(0, Math.abs(car.offset) - ROAD_EDGE);
        const npcShoulderFactor = Math.min(1, npcShoulderDepth * SHOULDER_GRIP_FALLOFF);
        if (npcShoulderFactor > 0 && car.speed > 0) {
            const shoulderMax = Math.max(10, SHOULDER_MAX_SPEED * (1 - npcShoulderFactor * 0.5));
            if (car.speed > shoulderMax) car.speed = Math.max(shoulderMax, car.speed - (3 + npcShoulderFactor * 4) * dt60);
        }

        car.offset -= curveForceMagnitude(carSeg.curve, car.speed, 1) * dt60;
        car.offset += (0 - car.offset) * NPC_CENTERING_RATE * dt60;
        car.offset = Math.max(-NPC_ROAD_OFFSET_MAX, Math.min(NPC_ROAD_OFFSET_MAX, car.offset));

        car.z += car.dir * car.speed * dt60;
        if (car.z >= maxZ) {
            car.lap++;
            car.z = car.z % maxZ;
        }
        if (car.z < 0) car.z += maxZ;

        carSegIdx = Math.floor(car.z / segmentLength) % segments.length;
        carSeg = segments[carSegIdx];

        if (!car.airY && car.airVelY <= 0 && carSeg.rampTakeoff && car.speed > 20) {
            const launchMul = Math.min(1, car.speed / 150);
            car.airVelY = RAMP_LAUNCH_VELOCITY * NPC_RAMP_LAUNCH_FACTOR * (0.4 + 0.6 * launchMul);
        }

        if (car.airVelY > 0 || car.airY > 0) {
            car.airVelY -= GRAVITY_JUMP * dt60;
            car.airY += car.airVelY * dt60;
            if (car.airY <= 0) {
                car.airY = 0;
                car.airVelY = 0;
            }
        }

        carSeg.cars.push(car);
        _dirtyCarSegments.push(carSeg);

        if (car.lap !== currentLap - 1) continue;
        const playerZ = position % maxZ;
        const distToPlayerZ = Math.abs(car.z - playerZ);
        const playerInAir = playerY > trackState.trackElevation + IN_AIR_THRESHOLD || playerVelY > 25;
        if (distToPlayerZ >= COLLISION_Z_RANGE || playerInAir) continue;
        if (Math.abs(playerX - car.offset) >= COLLISION_PLAYER_CAR_X) continue;
        if (Date.now() - crashResetAt < CRASH_INVULN_MS) continue;

        const lateralDir = playerX >= car.offset ? 1 : -1;

        if (car.dir === -1) {
            const impactSpeed = speed + car.speed;
            crashNPCCar(car, impactSpeed, lateralDir);
            isCrashed = true;
            playerVelY = 300 + speed * 4;
            crashSpinSpeed = 0.05 + (speed / maxSpeed) * 0.4;
        } else {
            const impactSpeed = Math.max(0, speed - car.speed);
            if (impactSpeed > CRASH_SPEED_THRESHOLD) {
                crashNPCCar(car, impactSpeed, lateralDir);
                speed = Math.max(0, speed * 0.4);
                if (impactSpeed > 120) {
                    isCrashed = true;
                    playerVelY = impactSpeed * 2;
                    crashSpinSpeed = 0.05 + (impactSpeed / maxSpeed) * 0.3;
                }
            } else {
                speed = Math.min(speed, car.speed);
                playerX += lateralDir * 0.08;
            }
        }
    }

    if (!raceOver) {
        for (let i = 0; i < cars.length; i++) {
            if (cars[i].lap >= RACE_LAPS) {
                raceOver = true;
                raceWinner = 'opponent';
                raceWinnerName = cars[i].name;
                break;
            }
        }
    }
}

// --- Game Loop ---

/**
 * Main loop (requestAnimationFrame). Branches: race over, crash recovery, else lap wrap + physics + collisions + render.
 * Uses trackStateNext for consistent “in air” vs ground speed/slope after integrating position.
 */
function update(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp || performance.now();
    const dtRaw = Math.min(((timestamp || performance.now()) - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp || performance.now();
    const dt60 = dtRaw * TARGET_FPS;

    if (raceOver) {
        updateEngineSound(computeRpm(speed, currentGear), keys.ArrowUp ? 1 : 0);
        render();
        requestAnimationFrame(update);
        return;
    }

    if (isCrashed) {
        crashRot += crashSpinSpeed * dt60;
        playerVelY -= 15 * dt60;
        playerY += playerVelY * dt60;
        speed = Math.max(0, speed - 2 * dt60);
        position += speed * dt60;

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
            steeringVel = 0;
            handbrakeAmount = 0;
            wasInAirPreviousFrame = false;
        }

        updateEngineSound(RPM_IDLE, 0);
        render();
        requestAnimationFrame(update);
        return;
    }

    let trackLength = segments.length * segmentLength;
    if (position >= trackLength) {
        lastLapTime = currentLapTime;
        currentLap++;
        lapStartTime = Date.now();
        position = position % trackLength;
        if (currentLap >= RACE_LAPS && !raceOver) {
            raceOver = true;
            raceWinner = 'player';
        }
    }
    currentLapTime = (Date.now() - lapStartTime) / 1000;

    playerSpeedSamples.push(speed);
    if (playerSpeedSamples.length > PLAYER_SPEED_SAMPLES_MAX) playerSpeedSamples.shift();
    if (playerSpeedSamples.length >= 30) {
        let sum = 0;
        for (let i = 0; i < playerSpeedSamples.length; i++) sum += playerSpeedSamples[i];
        playerAvgSpeed = sum / playerSpeedSamples.length;
    }

    let trackState = getTrackState(position);
    checkStaticObstacleCollision(trackState);
    if (!isCrashed) updateNPCsAndCheckCollision(trackState, dt60);

    const positionNext = position + speed * dt60;
    const trackStateNext = getTrackState(positionNext);
    const inAirThreshold = IN_AIR_THRESHOLD;
    const inAirLandThreshold = 8;
    const inAir = (playerY > trackStateNext.trackElevation + inAirThreshold) ||
        (wasInAirPreviousFrame && playerY > trackStateNext.trackElevation + inAirLandThreshold);
    wasInAirPreviousFrame = inAir;

    // --- Handbrake (progressive engage/release) ---
    if (keys.ShiftLeft) {
        handbrakeAmount = Math.min(1, handbrakeAmount + HANDBRAKE_ENGAGE_RATE * dtRaw);
    } else {
        handbrakeAmount = Math.max(0, handbrakeAmount - HANDBRAKE_RELEASE_RATE * dtRaw);
    }

    // --- Road shoulders (ignored while airborne) ---
    const shoulderDepth = Math.max(0, Math.abs(playerX) - ROAD_EDGE);
    const shoulderFactor = Math.min(1, shoulderDepth * SHOULDER_GRIP_FALLOFF);
    const onShoulder = !inAir && shoulderFactor > 0;

    // --- Gear, RPM, redline limiter ---
    const gearMaxSpeed = GEAR_MAX_SPEEDS[currentGear - 1];
    const rpm = computeRpm(speed, currentGear);

    let accelRate = GEAR_ACCEL_RATES[currentGear - 1];

    if (rpm > REDLINE_DROPOFF_START) {
        const dropoff = 1 - (rpm - REDLINE_DROPOFF_START) / (RPM_REDLINE - REDLINE_DROPOFF_START);
        accelRate *= Math.max(0, dropoff);
    }

    const gearMinSpeed = GEAR_MIN_SPEEDS[currentGear - 1];
    if (speed < gearMinSpeed) {
        accelRate *= 0.06;
    }

    if (onShoulder) {
        accelRate = Math.min(accelRate, SHOULDER_ACCEL);
    }

    // --- Speed (unchanged in air; on ground: throttle/brake/coast, drag, slope at next position) ---
    if (!inAir) {
        if (keys.ArrowUp) {
            speed = Math.min(speed + accelRate * dt60, gearMaxSpeed);
        } else if (keys.ArrowDown) {
            const brakePower = BRAKE_DECEL * Math.min(1, 0.3 + 0.7 * speed / 60);
            speed = Math.max(0, speed - brakePower * dt60);
        } else {
            speed = Math.max(0, speed - GEAR_COAST_DECEL[currentGear - 1] * dt60);
        }
        speed = Math.max(0, speed - AERO_DRAG * speed * speed * dt60);
        const slope = (trackStateNext.nextSeg.y - trackStateNext.baseSeg.y) / segmentLength;
        speed = Math.max(0, speed + (-slope * SLOPE_GRAVITY_FACTOR) * dt60);
        if (handbrakeAmount > 0) speed = Math.max(0, speed - HANDBRAKE_DECEL * handbrakeAmount * dt60);
        if (onShoulder) {
            const shoulderMax = Math.max(10, SHOULDER_MAX_SPEED * (1 - shoulderFactor * 0.5));
            if (speed > shoulderMax) speed = Math.max(shoulderMax, speed - (3 + shoulderFactor * 4) * dt60);
        }
    }

    position = positionNext;
    let { startSegIndex, offset, baseSeg, nextSeg, trackElevation } = trackStateNext;

    // --- Ramp takeoff (launch vertical velocity at ramp peak) ---
    if (!isCrashed && baseSeg.rampTakeoff && playerY <= trackElevation + 120 && playerVelY <= 80 && speed > 30) {
        const launchMul = Math.min(1, speed / maxSpeed);
        playerVelY = RAMP_LAUNCH_VELOCITY * (0.5 + 0.5 * launchMul);
    }

    // --- Vertical physics: gravity in air always (even at speed 0), mild pitch for arcade arc ---
    const wasInAir = playerY > trackElevation + IN_AIR_THRESHOLD;

    let gravMul = 1.0;
    if (inAir) {
        if (keys.ArrowUp) gravMul = PITCH_UP_GRAVITY_MUL;
        else if (keys.ArrowDown) gravMul = PITCH_DOWN_GRAVITY_MUL;
    }

    playerVelY -= GRAVITY_JUMP * gravMul * dt60;
    playerY += playerVelY * dt60;
    if (playerY < trackElevation) {
        const impactVel = playerVelY;
        playerY = trackElevation;
        playerVelY = 0;
        if (wasInAir) {
            if (impactVel < -LANDING_BOUNCE_THRESHOLD) {
                playerVelY = Math.min(180, -impactVel * LANDING_BOUNCE_FACTOR);
                speed = Math.max(0, speed - Math.abs(impactVel) * LANDING_SPEED_LOSS_FACTOR * speed);
            } else if (Math.abs(impactVel) < CLEAN_LANDING_MAX_VEL) {
                speed = Math.min(maxSpeed, speed + CLEAN_LANDING_BOOST);
            }
        }
    }

    // --- Centrifugal curve force (sky parallax tied to curve) ---
    let currentSeg = segments[startSegIndex];
    if (speed > 0) skyOffset += currentSeg.curve * (speed / maxSpeed) * 4 * dt60;

    if (!inAir && speed > 0) {
        const handbrakeMul = 1 + handbrakeAmount * (HANDBRAKE_CURVE_MUL - 1);
        playerX -= curveForceMagnitude(currentSeg.curve, speed, handbrakeMul) * dt60;
    }

    // --- Steering (frozen lateral input in air; damping only) ---
    if (inAir) {
        steeringVel *= 0.92;
    } else {
        const steerInput = (keys.ArrowLeft ? -1 : 0) + (keys.ArrowRight ? 1 : 0);
        let steerFactor = Math.max(STEERING_MIN_FACTOR, speed / maxSpeed);
        steerFactor *= (1 - handbrakeAmount * (1 - HANDBRAKE_STEERING_MUL));
        const steerTarget = steerInput * STEERING_FACTOR * steerFactor;
        const lerpRate = steerInput !== 0 ? STEERING_ENGAGE_RATE : STEERING_RETURN_RATE;
        steeringVel += (steerTarget - steeringVel) * Math.min(1, lerpRate * dt60);
        playerX += steeringVel * dt60;
    }

    playerX = Math.max(-2.5, Math.min(2.5, playerX));

    const rpmForSound = computeRpm(speed, currentGear);
    updateEngineSound(inAir ? RPM_IN_AIR : rpmForSound, inAir ? 1 : (keys.ArrowUp ? 1 : 0));

    render();
    requestAnimationFrame(update);
}

// --- Boot: load track JSON, build segments + opponents, start RAF loop ---
loadTrackData()
    .then(data => {
        buildRoad(data || getDefaultTrack());
        requestAnimationFrame(update);
    })
    .catch(() => {
        buildRoad(getDefaultTrack());
        requestAnimationFrame(update);
    });
