// The things that move through Vice Point: traffic cars, parked cars, police
// cars, pedestrians, bullets, particles and pickups. Each factory makes a plain
// object; each step function advances one kind for one fixed step. The world
// owns the lists and calls the steps.
import { CAR, PED, POLICE, TRAFFIC } from './config.js';
import { collideBuildings, isRoad, nearestRoad, onHorizontalRoad, onVerticalRoad } from './city.js';

const CAR_COLORS = ['#d94f3d', '#3d7ad9', '#e0b13c', '#4fae5a', '#8a5fd0', '#d97fb0', '#e8e8e8', '#3a3a3a', '#e07b2e', '#2ea8a0'];
const PED_COLORS = ['#e8c39a', '#c98d5f', '#8a5a3b', '#f0d0b0', '#a06a42'];
const SHIRT_COLORS = ['#d94f3d', '#3d7ad9', '#4fae5a', '#e0b13c', '#8a5fd0', '#e8e8e8', '#3a3a3a'];

export function makeCar(random, x, y, angle, kind) {
  return {
    kind,
    x, y,
    angle,
    speed: 0,
    color: kind === 'police' ? '#20242c' : random.pick(CAR_COLORS),
    health: CAR.health,
    // Traffic only: which road it follows and which way it drives.
    axis: random.chance(0.5) ? 'h' : 'v',
    dir: random.chance(0.5) ? 1 : -1,
    cruise: random.range(TRAFFIC.speedMin, TRAFFIC.speedMax),
    stuck: 0,
    flash: 0,
    shootTimer: 0,
  };
}

export function makePed(random, x, y) {
  return {
    x, y,
    angle: random.range(0, Math.PI * 2),
    speed: random.range(PED.speedMin, PED.speedMax),
    skin: random.pick(PED_COLORS),
    shirt: random.pick(SHIRT_COLORS),
    targetX: x,
    targetY: y,
    wait: random.range(0, 3),
    flee: 0,
    panic: 0,
  };
}

export function makeBullet(x, y, angle, speed, damage, fromPlayer) {
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0.9,
    damage,
    fromPlayer,
  };
}

export function makeParticle(x, y, vx, vy, life, color, size) {
  return { x, y, vx, vy, life, maxLife: life, color, size };
}

export function makePickup(x, y, kind, amount) {
  return { x, y, kind, amount, bob: 0 };
}

/** The car ahead in the same lane, if any: same direction, in a narrow cone. */
function carAhead(cars, self, lookAhead) {
  const fx = Math.cos(self.angle);
  const fy = Math.sin(self.angle);
  let best = null;
  let bestDist = lookAhead;
  for (let i = 0; i < cars.length; i += 1) {
    const other = cars[i];
    if (other === self) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const along = dx * fx + dy * fy;
    if (along < 10 || along > lookAhead) continue;
    const lateral = Math.abs(-dx * fy + dy * fx);
    if (lateral > 24) continue;
    // Only cars heading roughly the same way block the lane; oncoming cars
    // and cars crossing at an intersection never stop this one.
    const dot = Math.cos(other.angle) * fx + Math.sin(other.angle) * fy;
    if (dot < 0.5) continue;
    if (along < bestDist) {
      bestDist = along;
      best = other;
    }
  }
  return best;
}

/**
 * Drive a traffic car along its road for one step. It keeps to its lane, slows
 * for the car ahead, and sometimes turns at a crossing. Returns false when the
 * car should despawn (it drove far from the player).
 */
export function stepTrafficCar(car, cars, playerX, playerY, dt, random) {
  const dx = car.x - playerX;
  const dy = car.y - playerY;
  if (dx * dx + dy * dy > TRAFFIC.despawnMargin * TRAFFIC.despawnMargin) return false;
  const ahead = carAhead(cars, car, 70);
  const want = ahead ? Math.max(0, ahead.speed - 30) : car.cruise;
  car.speed += (want - car.speed) * Math.min(1, dt * 1.6);
  if (car.speed < 4 && ahead) car.stuck += dt;
  else car.stuck = 0;
  // Stuck for seconds (a jam that never clears): turn around and go on.
  if (car.stuck > 4) {
    car.dir *= -1;
    car.angle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    car.stuck = 0;
  }
  // Steer back onto the lane centre and along the road: aim a little toward
  // the lane when off-centre, and ease onto that aim instead of snapping.
  const centre = nearestRoad(car.axis === 'h' ? car.y : car.x);
  const off = (car.axis === 'h' ? car.y : car.x) - centre;
  const targetAngle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  const desiredAngle = targetAngle + Math.max(-0.35, Math.min(0.35, -off * 0.01));
  let diff = desiredAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.angle += diff * Math.min(1, dt * 3);
  // At a crossing, sometimes turn onto the other road.
  const coord = car.axis === 'h' ? car.x : car.y;
  const along = (((coord - 34) % 320) + 320) % 320;
  const nearCross = Math.min(along, 320 - along) < 26;
  if (nearCross && random.next() < dt * 0.25) {
    car.axis = car.axis === 'h' ? 'v' : 'h';
    car.dir = random.chance(0.5) ? 1 : -1;
    // Snap onto the crossing centre and face the new road at once, so the
    // turn never cuts the corner across a sidewalk or a building.
    car.x = nearestRoad(car.x);
    car.y = nearestRoad(car.y);
    car.angle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  return true;
}

/**
 * Walk a pedestrian for one step: wander between sidewalk waypoints, wait a
 * while at each, and run away from `danger` (a point and radius) when it is
 * close. Fleeing pedestrians scream past the camera; calm ones stroll.
 */
export function stepPed(ped, danger, dt, random) {
  const ddx = ped.x - danger.x;
  const ddy = ped.y - danger.y;
  const dangerSq = ddx * ddx + ddy * ddy;
  if (dangerSq < 220 * 220) {
    ped.flee = 1.4;
    ped.panic = 1;
  }
  if (ped.flee > 0) {
    ped.flee -= dt;
    const dist = Math.sqrt(dangerSq) || 1;
    ped.angle = Math.atan2(ddy / dist, ddx / dist);
    ped.x += Math.cos(ped.angle) * PED.fleeSpeed * dt;
    ped.y += Math.sin(ped.angle) * PED.fleeSpeed * dt;
    return;
  }
  if (ped.wait > 0) {
    ped.wait -= dt;
    return;
  }
  const tx = ped.targetX - ped.x;
  const ty = ped.targetY - ped.y;
  const dist = Math.hypot(tx, ty);
  if (dist < 12) {
    ped.wait = 1 + random.next() * 3;
    // A new waypoint a short walk away, preferring to stay near a road.
    const angle = random.next() * Math.PI * 2;
    const step = 120 + random.next() * 220;
    ped.targetX = ped.x + Math.cos(angle) * step;
    ped.targetY = ped.y + Math.sin(angle) * step;
    return;
  }
  ped.angle = Math.atan2(ty, tx);
  ped.x += Math.cos(ped.angle) * ped.speed * dt;
  ped.y += Math.sin(ped.angle) * ped.speed * dt;
}

/** Advance a bullet; returns false when it expired or hit a building. */
export function stepBullet(bullet, city, dt) {
  bullet.x += bullet.vx * dt;
  bullet.y += bullet.vy * dt;
  bullet.life -= dt;
  if (bullet.life <= 0) return false;
  const circle = { x: bullet.x, y: bullet.y, r: 2 };
  if (collideBuildings(city, circle)) return false;
  return true;
}

/** Advance a particle; returns false when it faded out. */
export function stepParticle(particle, dt) {
  particle.x += particle.vx * dt;
  particle.y += particle.vy * dt;
  particle.vx *= 1 - dt * 2.2;
  particle.vy *= 1 - dt * 2.2;
  particle.life -= dt;
  return particle.life > 0;
}

/** A police car chasing `target`: steer toward it and ram. Returns its speed. */
export function stepPoliceCar(car, targetX, targetY, dt) {
  const dx = targetX - car.x;
  const dy = targetY - car.y;
  const dist = Math.hypot(dx, dy) || 1;
  const wantAngle = Math.atan2(dy, dx);
  let diff = wantAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, diff * 2.2));
  car.angle += steer * 2.4 * dt * Math.min(1, car.speed / 120 + 0.3);
  const wantSpeed = Math.min(POLICE.speed, 200 + dist * 0.9);
  car.speed += (wantSpeed - car.speed) * Math.min(1, dt * 1.4);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.flash += dt;
  return car.speed;
}

export { isRoad, onHorizontalRoad, onVerticalRoad };
