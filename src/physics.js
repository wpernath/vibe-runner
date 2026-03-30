import { player, race, world, keys } from './state.js';
import {
    IN_AIR_THRESHOLD, maxSpeed, segmentLength,
    CRASH_INVULN_MS, CRASH_SPEED_THRESHOLD,
    COLLISION_Z_RANGE, COLLISION_STATIC_Z_RANGE, COLLISION_PLAYER_CAR_X,
    ROAD_EDGE, SHOULDER_MAX_SPEED, SHOULDER_ACCEL, SHOULDER_GRIP_FALLOFF,
    STEERING_FACTOR, STEERING_MIN_FACTOR, STEERING_ENGAGE_RATE, STEERING_RETURN_RATE,
    HANDBRAKE_STEERING_MUL, HANDBRAKE_CURVE_MUL, HANDBRAKE_DECEL,
    HANDBRAKE_ENGAGE_RATE, HANDBRAKE_RELEASE_RATE,
    BRAKE_DECEL,
    GEAR_COAST_DECEL, GEAR_ACCEL_RATES, GEAR_MAX_SPEEDS, GEAR_MIN_SPEEDS,
    NUM_GEARS, RAMP_LAUNCH_VELOCITY, GRAVITY_JUMP,
    LANDING_BOUNCE_THRESHOLD, LANDING_BOUNCE_FACTOR,
    LANDING_SPEED_LOSS_FACTOR,
    PITCH_UP_GRAVITY_MUL, PITCH_DOWN_GRAVITY_MUL,
    CLEAN_LANDING_MAX_VEL, CLEAN_LANDING_BOOST,
    NPC_RAMP_LAUNCH_FACTOR, NPC_ROAD_OFFSET_MAX, NPC_CENTERING_RATE,
    SLOPE_GRAVITY_FACTOR, AERO_DRAG, REDLINE_DROPOFF_START,
    NPC_CRASH_GRAVITY, NPC_RESPAWN_DELAY, RACE_LAPS,
    RPM_REDLINE,
} from './constants.js';
import { getTrackState, curveForceMagnitude, computeRpm } from './track.js';
import { playCrashSound } from './audio.js';

// --- Static obstacle collision ---

export function checkStaticObstacleCollision(trackState) {
    const inAir = player.y > trackState.trackElevation + IN_AIR_THRESHOLD || player.velY > 25;
    if (inAir) return;
    if (Date.now() - player.crashResetAt < CRASH_INVULN_MS) return;

    const segmentsToCheck = [
        { seg: trackState.baseSeg, segZ: trackState.startSegIndex * segmentLength },
        { seg: trackState.nextSeg, segZ: (trackState.startSegIndex + 1) * segmentLength }
    ];
    for (let s = 0; s < segmentsToCheck.length; s++) {
        const { seg, segZ } = segmentsToCheck[s];
        if (Math.abs(player.position - segZ) > COLLISION_STATIC_Z_RANGE) continue;
        for (let i = 0; i < seg.sprites.length; i++) {
            const sprite = seg.sprites[i];
            let spriteW = 0.5;
            if (sprite.type === 'TREE_PINE' || sprite.type === 'TREE_LEAFY' || sprite.type === 'CACTUS' || sprite.type === 'ROCK' || sprite.type === 'SNOWY_PINE') spriteW = 0.45;
            if (sprite.type === 'BUILDING') spriteW = 0.9;
            if (sprite.type === 'STREETLIGHT') spriteW = 0.2;
            if (Math.abs(player.x - sprite.offset) >= spriteW) continue;
            if (player.speed > CRASH_SPEED_THRESHOLD) {
                player.crashed = true;
                playCrashSound();
                player.velY = player.speed * 4;
                player.crashSpinSpeed = 0.1 + (player.speed / maxSpeed) * 0.4;
            } else player.speed = 0;
            return;
        }
    }
}

// --- NPC crash ---

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

// --- NPC AI & collision with player ---

let _dirtyCarSegments = [];

export function updateNPCsAndCheckCollision(trackState, dt60) {
    const maxZ = world.segments.length * segmentLength;
    for (let i = 0; i < _dirtyCarSegments.length; i++) _dirtyCarSegments[i].cars = [];
    _dirtyCarSegments = [];

    for (let i = 0; i < world.cars.length; i++) {
        const car = world.cars[i];

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
            const crashSeg = world.segments[Math.floor(car.z / segmentLength) % world.segments.length];
            crashSeg.cars.push(car);
            _dirtyCarSegments.push(crashSeg);

            if (car.crashTimer > NPC_RESPAWN_DELAY) {
                car.crashed = false;
                car.crashRot = 0;
                car.crashY = 0;
                car.airY = 0;
                car.airVelY = 0;
                car.npcGear = 1;
                car.speed = Math.min(maxSpeed * 0.95, race.playerAvgSpeed * car.targetSpeedFactor);
                car.originalSpeed = car.speed;
                car.offset = Math.max(-NPC_ROAD_OFFSET_MAX, Math.min(NPC_ROAD_OFFSET_MAX, car.offset));
            }
            continue;
        }

        let carSegIdx = Math.floor(car.z / segmentLength) % world.segments.length;
        let carSeg = world.segments[carSegIdx];
        const elapsed = (Date.now() - race.startTime) / 1000;
        if (elapsed < car.startDelay) {
            carSeg.cars.push(car);
            _dirtyCarSegments.push(carSeg);
            continue;
        }
        const targetSpeed = Math.max(60, Math.min(maxSpeed * 0.96, race.playerAvgSpeed * car.targetSpeedFactor));

        const npcGearMax = GEAR_MAX_SPEEDS[car.npcGear - 1];
        if (car.speed > npcGearMax * 0.95 && car.npcGear < NUM_GEARS) car.npcGear++;
        if (car.npcGear > 1 && car.speed < GEAR_MIN_SPEEDS[car.npcGear - 1] * 0.8) car.npcGear--;
        const npcAccel = GEAR_ACCEL_RATES[car.npcGear - 1];
        const npcGearMaxSpeed = GEAR_MAX_SPEEDS[car.npcGear - 1];

        if (car.speed < targetSpeed) {
            car.speed = Math.min(car.speed + npcAccel * 0.85 * dt60, npcGearMaxSpeed);
        } else {
            car.speed = Math.max(car.speed - GEAR_COAST_DECEL[car.npcGear - 1] * dt60, targetSpeed * 0.9);
        }
        car.speed = Math.max(30, Math.min(maxSpeed * 0.98, car.speed));

        car.speed = Math.max(0, car.speed - AERO_DRAG * car.speed * car.speed * dt60);
        const nextSeg = world.segments[(carSegIdx + 1) % world.segments.length];
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

        for (let j = 0; j < world.cars.length; j++) {
            if (j === i || world.cars[j].crashed) continue;
            const other = world.cars[j];
            const dzNpc = Math.abs(car.z - other.z);
            if (dzNpc < 300 && Math.abs(car.offset - other.offset) < 0.25) {
                const dodgeDir = car.offset >= other.offset ? 1 : -1;
                car.offset += dodgeDir * 0.03 * dt60;
                if (dzNpc < 150 && car.speed > other.speed) car.speed -= 0.5 * dt60;
            }
        }

        car.offset = Math.max(-NPC_ROAD_OFFSET_MAX, Math.min(NPC_ROAD_OFFSET_MAX, car.offset));

        car.z += car.dir * car.speed * dt60;
        if (car.z >= maxZ) {
            car.lap++;
            car.z = car.z % maxZ;
        }
        if (car.z < 0) car.z += maxZ;

        carSegIdx = Math.floor(car.z / segmentLength) % world.segments.length;
        carSeg = world.segments[carSegIdx];

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

        const playerZ = player.position % maxZ;
        const distToPlayerZ = Math.abs(car.z - playerZ);
        const playerInAir = player.y > trackState.trackElevation + IN_AIR_THRESHOLD || player.velY > 25;
        if (distToPlayerZ >= COLLISION_Z_RANGE || playerInAir) continue;
        if (Math.abs(player.x - car.offset) >= COLLISION_PLAYER_CAR_X) continue;
        if (Date.now() - player.crashResetAt < CRASH_INVULN_MS) continue;

        const lateralDir = player.x >= car.offset ? 1 : -1;

        if (car.dir === -1) {
            const impactSpeed = player.speed + car.speed;
            crashNPCCar(car, impactSpeed, lateralDir);
            player.crashed = true;
            player.velY = 300 + player.speed * 4;
            player.crashSpinSpeed = 0.05 + (player.speed / maxSpeed) * 0.4;
        } else {
            const impactSpeed = Math.max(0, player.speed - car.speed);
            if (impactSpeed > CRASH_SPEED_THRESHOLD) {
                crashNPCCar(car, impactSpeed, lateralDir);
                player.speed = Math.max(0, player.speed * 0.4);
                if (impactSpeed > 120) {
                    player.crashed = true;
                    player.velY = impactSpeed * 2;
                    player.crashSpinSpeed = 0.05 + (impactSpeed / maxSpeed) * 0.3;
                }
            } else {
                player.speed = Math.min(player.speed, car.speed);
                player.x += lateralDir * 0.08;
            }
        }
    }

    if (!race.over) {
        for (let i = 0; i < world.cars.length; i++) {
            if (world.cars[i].lap >= RACE_LAPS) {
                race.over = true;
                race.winner = 'opponent';
                race.winnerName = world.cars[i].name;
                break;
            }
        }
    }
}

// --- Player physics (extracted from update loop) ---

/**
 * Runs one frame of player physics: handbrake, speed, position, vertical, curve, steering.
 * @returns {{ inAir: boolean }} State needed by the caller for audio.
 */
export function updatePlayerPhysics(dt60, dtRaw) {
    // Handbrake
    if (keys.ShiftLeft) {
        player.handbrakeAmount = Math.min(1, player.handbrakeAmount + HANDBRAKE_ENGAGE_RATE * dtRaw);
    } else {
        player.handbrakeAmount = Math.max(0, player.handbrakeAmount - HANDBRAKE_RELEASE_RATE * dtRaw);
    }

    // Position look-ahead for ground detection
    const positionNext = player.position + player.speed * dt60;
    const trackStateNext = getTrackState(positionNext);
    const inAirLandThreshold = 8;
    const inAir = (player.y > trackStateNext.trackElevation + IN_AIR_THRESHOLD) ||
        (player.wasInAirPreviousFrame && player.y > trackStateNext.trackElevation + inAirLandThreshold);
    player.wasInAirPreviousFrame = inAir;

    // Road shoulders
    const shoulderDepth = Math.max(0, Math.abs(player.x) - ROAD_EDGE);
    const shoulderFactor = Math.min(1, shoulderDepth * SHOULDER_GRIP_FALLOFF);
    const onShoulder = !inAir && shoulderFactor > 0;

    // Gear, RPM, redline limiter
    const gearMaxSpeed = GEAR_MAX_SPEEDS[player.gear - 1];
    const rpm = computeRpm(player.speed, player.gear);

    let accelRate = GEAR_ACCEL_RATES[player.gear - 1];

    if (rpm > REDLINE_DROPOFF_START) {
        const dropoff = 1 - (rpm - REDLINE_DROPOFF_START) / (RPM_REDLINE - REDLINE_DROPOFF_START);
        accelRate *= Math.max(0, dropoff);
    }

    const gearMinSpeed = GEAR_MIN_SPEEDS[player.gear - 1];
    if (player.speed < gearMinSpeed) {
        accelRate *= 0.06;
    }

    if (onShoulder) {
        accelRate = Math.min(accelRate, SHOULDER_ACCEL);
    }

    // Speed (unchanged in air)
    if (!inAir) {
        if (keys.ArrowUp) {
            player.speed = Math.min(player.speed + accelRate * dt60, gearMaxSpeed);
        } else if (keys.ArrowDown) {
            const brakePower = BRAKE_DECEL * Math.min(1, 0.3 + 0.7 * player.speed / 60);
            player.speed = Math.max(0, player.speed - brakePower * dt60);
        } else {
            player.speed = Math.max(0, player.speed - GEAR_COAST_DECEL[player.gear - 1] * dt60);
        }
        player.speed = Math.max(0, player.speed - AERO_DRAG * player.speed * player.speed * dt60);
        const slope = (trackStateNext.nextSeg.y - trackStateNext.baseSeg.y) / segmentLength;
        player.speed = Math.max(0, player.speed + (-slope * SLOPE_GRAVITY_FACTOR) * dt60);
        if (player.handbrakeAmount > 0) player.speed = Math.max(0, player.speed - HANDBRAKE_DECEL * player.handbrakeAmount * dt60);
        if (onShoulder) {
            const shoulderMax = Math.max(10, SHOULDER_MAX_SPEED * (1 - shoulderFactor * 0.5));
            if (player.speed > shoulderMax) player.speed = Math.max(shoulderMax, player.speed - (3 + shoulderFactor * 4) * dt60);
        }
    }

    player.position = positionNext;
    const { startSegIndex, baseSeg, trackElevation } = trackStateNext;

    // Ramp takeoff
    if (!player.crashed && baseSeg.rampTakeoff && player.y <= trackElevation + 120 && player.velY <= 80 && player.speed > 30) {
        const launchMul = Math.min(1, player.speed / maxSpeed);
        player.velY = RAMP_LAUNCH_VELOCITY * (0.5 + 0.5 * launchMul);
    }

    // Vertical physics
    const wasInAir = player.y > trackElevation + IN_AIR_THRESHOLD;

    let gravMul = 1.0;
    if (inAir) {
        if (keys.ArrowUp) gravMul = PITCH_UP_GRAVITY_MUL;
        else if (keys.ArrowDown) gravMul = PITCH_DOWN_GRAVITY_MUL;
    }

    player.velY -= GRAVITY_JUMP * gravMul * dt60;
    player.y += player.velY * dt60;
    if (player.y < trackElevation) {
        const impactVel = player.velY;
        player.y = trackElevation;
        player.velY = 0;
        if (wasInAir) {
            if (impactVel < -LANDING_BOUNCE_THRESHOLD) {
                player.velY = Math.min(180, -impactVel * LANDING_BOUNCE_FACTOR);
                player.speed = Math.max(0, player.speed - Math.abs(impactVel) * LANDING_SPEED_LOSS_FACTOR * player.speed);
            } else if (Math.abs(impactVel) < CLEAN_LANDING_MAX_VEL) {
                player.speed = Math.min(maxSpeed, player.speed + CLEAN_LANDING_BOOST);
            }
        }
    }

    // Centrifugal curve force
    let currentSeg = world.segments[startSegIndex];
    if (player.speed > 0) player.skyOffset += currentSeg.curve * (player.speed / maxSpeed) * 4 * dt60;

    if (!inAir && player.speed > 0) {
        const handbrakeMul = 1 + player.handbrakeAmount * (HANDBRAKE_CURVE_MUL - 1);
        player.x -= curveForceMagnitude(currentSeg.curve, player.speed, handbrakeMul) * dt60;
    }

    // Steering
    if (inAir) {
        player.steeringVel *= 0.92;
    } else {
        const steerInput = (keys.ArrowLeft ? -1 : 0) + (keys.ArrowRight ? 1 : 0);
        let steerFactor = Math.max(STEERING_MIN_FACTOR, player.speed / maxSpeed);
        steerFactor *= (1 - player.handbrakeAmount * (1 - HANDBRAKE_STEERING_MUL));
        const steerTarget = steerInput * STEERING_FACTOR * steerFactor;
        const lerpRate = steerInput !== 0 ? STEERING_ENGAGE_RATE : STEERING_RETURN_RATE;
        player.steeringVel += (steerTarget - player.steeringVel) * Math.min(1, lerpRate * dt60);
        player.x += player.steeringVel * dt60;
    }

    player.x = Math.max(-2.5, Math.min(2.5, player.x));

    return { inAir };
}
