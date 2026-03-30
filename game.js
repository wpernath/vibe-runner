/**
 * =============================================================================
 * RUNNING OUT – game.js  (entry point / orchestrator)
 * =============================================================================
 *
 * Module layout (all under src/):
 *
 * | Module          | Role |
 * |-----------------|------|
 * | constants.js    | Every tuning knob & named constant |
 * | state.js        | Shared mutable state: player, race, world, keys |
 * | audio.js        | Web Audio: engine hum, crash SFX |
 * | track.js        | Track JSON I/O, buildRoad, getTrackState, computeRpm |
 * | sprites.js      | Procedural sprite drawing (trees, buildings, NPC cars) |
 * | renderer.js     | Projection, parallax, mirror, HUD, render() |
 * | physics.js      | Collision, NPC AI, player physics per frame |
 *
 * This file wires everything together: canvas init, input, game loop, boot.
 * =============================================================================
 */

import { player, race, world, keys } from './src/state.js';
import {
    NUM_GEARS, GEAR_MAX_SPEEDS,
    RPM_IDLE, RPM_IN_AIR, TARGET_FPS,
    RACE_LAPS,
    PLAYER_SPEED_SAMPLES_MAX,
    CRASH_RESET_GROUND_OFFSET,
    segmentLength,
} from './src/constants.js';
import { loadTrackData, getDefaultTrack, buildRoad, getTrackState, computeRpm } from './src/track.js';
import { startEngineSound, updateEngineSound } from './src/audio.js';
import { initRenderer, resizeCanvas, render } from './src/renderer.js';
import { checkStaticObstacleCollision, updateNPCsAndCheckCollision, updatePlayerPhysics } from './src/physics.js';

// --- Canvas setup ---

const canvas = document.getElementById('gameCanvas');
initRenderer(canvas);
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const gameContainer = document.getElementById('gameContainer');
if (gameContainer) {
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(gameContainer);
}

// --- Input: keyboard ---

window.addEventListener('keydown', e => {
    startEngineSound();
    if (e.code === 'KeyQ') {
        if (player.gear < NUM_GEARS) player.gear++;
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyA') {
        if (player.gear > 1) {
            player.gear--;
            player.speed = Math.min(player.speed, GEAR_MAX_SPEEDS[player.gear - 1]);
        }
        e.preventDefault();
        return;
    }
    if (e.code in keys) {
        keys[e.code] = true;
        e.preventDefault();
    }
});
window.addEventListener('keyup', e => { if (e.code in keys) keys[e.code] = false; });

// --- Input: touch / pointer ---

document.querySelectorAll('#touchControls [data-key]').forEach(btn => {
    const key = btn.dataset.key;
    if (!(key in keys)) return;

    function setKey(value) {
        keys[key] = value;
        if (value) startEngineSound();
    }

    btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    btn.addEventListener('pointerdown', e => { e.preventDefault(); setKey(true); });
    btn.addEventListener('pointerup', setKey.bind(null, false));
    btn.addEventListener('pointerleave', setKey.bind(null, false));
    btn.addEventListener('pointercancel', setKey.bind(null, false));
    btn.addEventListener('contextmenu', e => e.preventDefault());
});

document.querySelectorAll('#touchControls [data-action]').forEach(btn => {
    const action = btn.dataset.action;

    function handleGear() {
        startEngineSound();
        if (action === 'gearUp' && player.gear < NUM_GEARS) {
            player.gear++;
        } else if (action === 'gearDown' && player.gear > 1) {
            player.gear--;
            player.speed = Math.min(player.speed, GEAR_MAX_SPEEDS[player.gear - 1]);
        }
    }

    btn.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    btn.addEventListener('pointerdown', e => { e.preventDefault(); handleGear(); });
    btn.addEventListener('contextmenu', e => e.preventDefault());
});

document.addEventListener('contextmenu', e => {
    if (e.target.closest('#touchControls')) e.preventDefault();
}, true);

// --- Game loop ---

let lastTimestamp = 0;

function update(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp || performance.now();
    const dtRaw = Math.min(((timestamp || performance.now()) - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp || performance.now();
    const dt60 = dtRaw * TARGET_FPS;

    if (race.over) {
        updateEngineSound(computeRpm(player.speed, player.gear), keys.ArrowUp ? 1 : 0);
        render();
        requestAnimationFrame(update);
        return;
    }

    if (race.countdownActive) {
        const remaining = (race.countdownEnd - Date.now()) / 1000;
        if (remaining <= 0) {
            race.countdownActive = false;
            race.startTime = Date.now();
            race.lapStartTime = Date.now();
        } else {
            player.speed = 0;
            updateEngineSound(RPM_IDLE + (remaining < 0.5 ? 2000 : 0), 0);
            render();
            requestAnimationFrame(update);
            return;
        }
    }

    if (player.crashed) {
        player.crashRot += player.crashSpinSpeed * dt60;
        player.velY -= 15 * dt60;
        player.y += player.velY * dt60;
        player.speed = Math.max(0, player.speed - 2 * dt60);
        player.position += player.speed * dt60;

        const trackStateCrash = getTrackState(player.position);
        const groundHeight = trackStateCrash.trackElevation;

        if (player.y < groundHeight - CRASH_RESET_GROUND_OFFSET) {
            player.crashed = false;
            player.crashResetAt = Date.now();
            player.y = groundHeight;
            player.velY = 0;
            player.speed = 0;
            player.crashRot = 0;
            player.x = 0;
            player.gear = 1;
            player.steeringVel = 0;
            player.handbrakeAmount = 0;
            player.wasInAirPreviousFrame = false;
        }

        updateEngineSound(RPM_IDLE, 0);
        render();
        requestAnimationFrame(update);
        return;
    }

    // Lap wrap
    let trackLength = world.segments.length * segmentLength;
    if (player.position >= trackLength) {
        race.lastLapTime = race.currentLapTime;
        race.currentLap++;
        race.lapStartTime = Date.now();
        player.position = player.position % trackLength;
        if (race.currentLap >= RACE_LAPS && !race.over) {
            race.over = true;
            race.winner = 'player';
        }
    }
    race.currentLapTime = (Date.now() - race.lapStartTime) / 1000;

    // Speed sampling for adaptive NPC difficulty
    race.speedSamples.push(player.speed);
    if (race.speedSamples.length > PLAYER_SPEED_SAMPLES_MAX) race.speedSamples.shift();
    if (race.speedSamples.length >= 30) {
        let sum = 0;
        for (let i = 0; i < race.speedSamples.length; i++) sum += race.speedSamples[i];
        race.playerAvgSpeed = sum / race.speedSamples.length;
    }

    // Collisions
    let trackState = getTrackState(player.position);
    checkStaticObstacleCollision(trackState);
    if (!player.crashed) updateNPCsAndCheckCollision(trackState, dt60);

    // Player physics
    const { inAir } = updatePlayerPhysics(dt60, dtRaw);

    // Audio
    const rpmForSound = computeRpm(player.speed, player.gear);
    updateEngineSound(inAir ? RPM_IN_AIR : rpmForSound, inAir ? 1 : (keys.ArrowUp ? 1 : 0));

    render();
    requestAnimationFrame(update);
}

// --- Boot ---

loadTrackData()
    .then(data => {
        buildRoad(data || getDefaultTrack());
        requestAnimationFrame(update);
    })
    .catch(() => {
        buildRoad(getDefaultTrack());
        requestAnimationFrame(update);
    });
