/**
 * Shared mutable game state, grouped by domain.
 * Modules import these objects and read/write properties directly.
 */

export const player = {
    position: 0,
    x: 0,
    speed: 0,
    y: 0,
    velY: 0,
    skyOffset: 0,
    crashed: false,
    crashRot: 0,
    crashSpinSpeed: 0,
    crashResetAt: Date.now(),
    gear: 1,
    steeringVel: 0,
    handbrakeAmount: 0,
    wasInAirPreviousFrame: false,
};

export const race = {
    currentLap: 1,
    currentLapTime: 0,
    lastLapTime: 0,
    lapStartTime: Date.now(),
    over: false,
    winner: null,
    winnerName: null,
    startTime: 0,
    countdownActive: true,
    countdownEnd: 0,
    playerAvgSpeed: 110,
    speedSamples: [],
};

export const world = {
    segments: [],
    cars: [],
};

export const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    ShiftLeft: false,
};
