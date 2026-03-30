// Canvas defaults
export const DESKTOP_CANVAS_WIDTH = 1024;
export const DESKTOP_CANVAS_HEIGHT = 768;

// Player car rendering
export const PLAYER_CAR_W = 130;
export const PLAYER_CAR_H = 55;
export const PLAYER_CAR_BOTTOM_MARGIN = 20;
export const JUMP_HEIGHT_SCALE = 0.015;
export const ROLL_GROUND_THRESHOLD = 12;
export const PITCH_UP_ANGLE = -0.12;
export const PITCH_DOWN_ANGLE = 0.15;
export const AIR_ROAD_ROLL_SCALE = 0.012;
export const LANE_MARK_WIDTH_RATIO = 0.012;
export const LANE_MARK_INTERVAL = 4;

// Core physics
export const IN_AIR_THRESHOLD = 100;
export const maxSpeed = 250;
export const segmentLength = 200;
export const cameraDepth = 0.84;
export const cameraHeight = 1200;
export const roadWidth = 3000;

// Ramps
export const RAMP_LAUNCH_VELOCITY = 520;
export const GRAVITY_JUMP = 70;
export const LANDING_BOUNCE_THRESHOLD = 100;
export const LANDING_BOUNCE_FACTOR = 0.38;

// Collision & crash
export const CRASH_RESET_GROUND_OFFSET = 100;
export const CRASH_INVULN_MS = 1800;
export const CRASH_SPEED_THRESHOLD = 50;
export const COLLISION_Z_RANGE = 140;
export const COLLISION_Z_OFFSET = 300;
export const COLLISION_PLAYER_CAR_X = 0.18;
export const COLLISION_STATIC_Z_RANGE = 280;

// Target FPS
export const TARGET_FPS = 60;

// Road shoulders
export const ROAD_EDGE = 1.1;
export const SHOULDER_MAX_SPEED = 80;
export const SHOULDER_ACCEL = 0.2;
export const SHOULDER_GRIP_FALLOFF = 1.5;

// Steering inertia
export const STEERING_FACTOR = 0.032;
export const STEERING_MIN_FACTOR = 0.25;
export const STEERING_ENGAGE_RATE = 0.12;
export const STEERING_RETURN_RATE = 0.08;

// Centrifugal curve force
export const CURVE_FORCE_DIVISOR = 3_600_000;
export const CURVE_FORCE_SPEED_THRESHOLD = 60;
export const CURVE_ROLL_MAX = 0.22;
export const CURVE_ROLL_SCALE = 8;

// Handbrake
export const HANDBRAKE_STEERING_MUL = 0.26;
export const HANDBRAKE_CURVE_MUL = 1.7;
export const HANDBRAKE_DECEL = 1.5;
export const HANDBRAKE_ENGAGE_RATE = 4.0;
export const HANDBRAKE_RELEASE_RATE = 6.0;

// Brake
export const BRAKE_DECEL = 5.0;

// Engine braking per gear (1st = strong; downshift before corners is tactical)
export const GEAR_COAST_DECEL = [1.0, 0.7, 0.5, 0.4, 0.3, 0.2];

// Acceleration per gear (1st aggressive, 6th weak)
export const GEAR_ACCEL_RATES = [1.4, 1.1, 0.85, 0.65, 0.5, 0.35];

// Redline limiter
export const REDLINE_DROPOFF_START = 6200;

// Aerodynamic drag
export const AERO_DRAG = 0.000006;

// Speed loss on hard landing
export const LANDING_SPEED_LOSS_FACTOR = 0.0004;

// Pitch in air
export const PITCH_UP_GRAVITY_MUL = 0.75;
export const PITCH_DOWN_GRAVITY_MUL = 1.35;

// Clean-landing bonus
export const CLEAN_LANDING_MAX_VEL = 80;
export const CLEAN_LANDING_BOOST = 10;

// NPCs
export const NPC_RAMP_LAUNCH_FACTOR = 0.65;
export const NPC_ROAD_OFFSET_MAX = 0.95;
export const NPC_CENTERING_RATE = 0.04;

// Slope gravity
export const SLOPE_GRAVITY_FACTOR = 0.55;

// Manual gearbox
export const NUM_GEARS = 6;
export const GEAR_MAX_SPEEDS = [45, 90, 135, 180, 215, 250];
export const GEAR_MIN_SPEEDS = [0, 18, 38, 58, 85, 115];
export const RPM_REDLINE = 7000;
export const RPM_IDLE = 800;
export const RPM_IN_AIR = 6400;

// Race
export const RACE_LAPS = 3;
export const NUM_OPPONENTS = 10;
export const COUNTDOWN_DURATION = 3;
export const PLAYER_SPEED_SAMPLES_MAX = 90;

// NPC crash animation
export const NPC_CRASH_DURATION = 180;
export const NPC_CRASH_GRAVITY = 6;
export const NPC_RESPAWN_DELAY = 300;

// Road/grass/rumble palette per biome
export const COLORS = {
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

// Rear-view mirror
export const MIRROR_W = 200;
export const MIRROR_H = 95;
export const MIRROR_Y = 12;
export const MIRROR_SEGMENTS = 100;
