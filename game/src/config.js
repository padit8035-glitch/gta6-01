// Vice Point — tuning constants for the whole game. One place for every number a
// designer would want to change: world size, speeds, wanted rules, mission money.
export const STEP = 1 / 60;
export const WORLD = 2560;
export const ROAD_GAP = 320;
export const ROAD_HALF = 34;
export const BLOCK = ROAD_GAP - ROAD_HALF * 2;

export const PLAYER = {
  radius: 14,
  walkSpeed: 210,
  runSpeed: 300,
  health: 100,
  punchRange: 46,
  punchDamage: 26,
  punchCooldown: 0.42,
  shotCooldown: 0.3,
  bulletSpeed: 780,
  bulletDamage: 34,
  startMoney: 250,
};

export const CAR = {
  length: 54,
  width: 26,
  accel: 420,
  brake: 620,
  reverseAccel: 260,
  maxSpeed: 540,
  maxReverse: 180,
  steer: 2.6,
  grip: 0.94,
  health: 100,
  ramDamage: 26,
};

export const TRAFFIC = {
  count: 18,
  speedMin: 90,
  speedMax: 165,
  spawnMargin: 700,
  despawnMargin: 1100,
};

export const PED = {
  count: 28,
  speedMin: 34,
  speedMax: 62,
  fleeSpeed: 130,
};

export const POLICE = {
  maxCars: 5,
  speed: 470,
  ramDamage: 10,
  bustDistance: 46,
  bustSeconds: 1.6,
  shootRange: 420,
  shootCooldown: 1.15,
};

export const WANTED = {
  max: 5,
  decaySeconds: 22,
  stealCar: 1,
  hitPed: 1,
  shoot: 1,
  killCop: 2,
};

export const MISSIONS = [
  { id: 'wheels', name: 'Wheels', reward: 300 },
  { id: 'courier', name: 'Courier Run', reward: 500 },
  { id: 'heat', name: 'Heat', reward: 700 },
  { id: 'payday', name: 'Payday', reward: 900 },
  { id: 'score', name: 'The Big Score', reward: 2000 },
];

export const SAVE_KEY = 'vicepoint.save.v1';
export const BEST_KEY = 'vicepoint.best.v1';
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const MINIMAP = 168;
