import { world, race } from './state.js';
import {
    segmentLength, maxSpeed,
    COLORS, NUM_OPPONENTS, COUNTDOWN_DURATION,
    GEAR_MAX_SPEEDS, NUM_GEARS,
    RPM_REDLINE, RPM_IDLE,
    CURVE_FORCE_DIVISOR, CURVE_FORCE_SPEED_THRESHOLD,
} from './constants.js';

/**
 * Track state at a distance along the road.
 * @param {number} pos - Distance along track (world units).
 */
export function getTrackState(pos) {
    const startSegIndex = Math.floor(pos / segmentLength) % world.segments.length;
    const offset = pos % segmentLength;
    const baseSeg = world.segments[startSegIndex];
    const nextSeg = world.segments[(startSegIndex + 1) % world.segments.length];
    const trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);
    return { startSegIndex, offset, baseSeg, nextSeg, trackElevation };
}

/** Shared centrifugal (curve) force for player and NPCs; lateral push per frame. */
export function curveForceMagnitude(curve, speedKmh, handbrakeMul) {
    if (speedKmh <= 0) return 0;
    let f = (curve * speedKmh * speedKmh) / CURVE_FORCE_DIVISOR;
    if (speedKmh < CURVE_FORCE_SPEED_THRESHOLD) f *= speedKmh / CURVE_FORCE_SPEED_THRESHOLD;
    return f * (handbrakeMul || 1);
}

/** Engine RPM from speed and gear. */
export function computeRpm(speedKmh, gear) {
    const gearMax = GEAR_MAX_SPEEDS[gear - 1];
    if (gearMax <= 0) return RPM_IDLE;
    return Math.min(
        RPM_REDLINE,
        RPM_IDLE + (speedKmh / gearMax) * (RPM_REDLINE - RPM_IDLE)
    );
}

/** Built-in default track JSON. */
export function getDefaultTrack() {
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

/** Loads track JSON from data/ directory (name from URL ?track= param). */
export function loadTrackData() {
    const params = new URLSearchParams(document.location.search);
    const name = params.get('track') || 'track';
    const url = `data/${name}.json`;
    return fetch(url)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null);
}

/** Terrain height from hills only (no ramps). */
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
 * Fills world.segments and world.cars. Resets race state.
 */
export function buildRoad(trackData) {
    if (!trackData) trackData = getDefaultTrack();
    const segmentCount = trackData.segmentCount || 2000;
    const curves = trackData.curves || [];
    const hills = trackData.hills || [];
    const ramps = trackData.ramps || [];
    const zones = trackData.zones || [];
    const startSegmentCount = trackData.startSegmentCount ?? 6;

    world.segments = [];

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

        world.segments.push({
            y: y,
            curve: curve,
            sprites: segmentSprites,
            cars: [],
            color: color,
            p1: { x: 0, y: 0, w: 0 },
            rampTakeoff: rampTakeoff
        });
    }

    let totalCurve = 0;
    for (let i = 0; i < world.segments.length; i++) totalCurve += world.segments[i].curve;
    if (world.segments.length > 0 && Math.abs(totalCurve) > 1e-6) {
        const correction = totalCurve / world.segments.length;
        for (let i = 0; i < world.segments.length; i++) world.segments[i].curve -= correction;
    }

    const trackLength = segmentCount * segmentLength;
    race.over = false;
    race.winner = null;
    race.winnerName = null;
    race.startTime = Date.now();
    race.countdownActive = true;
    race.countdownEnd = Date.now() + COUNTDOWN_DURATION * 1000;
    world.cars = [];
    const opponentColors = ['#2266dd', '#dd6622', '#22aa44', '#aa22aa', '#ddcc22', '#22cccc', '#cc4422', '#6688dd', '#88dd66', '#dd88aa'];
    const baseTargetSpeed = Math.min(maxSpeed * 0.92, 200);
    for (let i = 0; i < NUM_OPPONENTS; i++) {
        const speedFactor = 0.86 + (i / (NUM_OPPONENTS - 1 || 1)) * 0.18;
        world.cars.push({
            z: i * 280,
            offset: -0.5 + (i % 5) * 0.25,
            speed: 0,
            dir: 1,
            lap: 0,
            name: String(i + 1),
            color: opponentColors[i % opponentColors.length],
            targetSpeedFactor: speedFactor,
            startDelay: i * 0.25,
            npcGear: 1,
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
