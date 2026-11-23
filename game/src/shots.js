// The screenshot scenes behind ?shot=start|drive|chase|mission. Each one plays
// the real rules forward from a fresh world for a fixed number of steps,
// steered by a simple autopilot (drive along the roads toward a waypoint,
// walk toward the mission marker), so the frame is what a short game really
// looks like and the same seed always gives the same frame.
import { CAR, STEP } from './config.js';
import { nearestRoad, onHorizontalRoad, onVerticalRoad } from './city.js';
import { EVENT_BUSTED, EVENT_WASTED, resetWorld, stepWorld } from './world.js';
import { SCREEN_BUSTED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';

const START_SECONDS = 7;
const DRIVE_SECONDS = 16;
const CHASE_SECONDS = 11;
const MISSION_SECONDS = 9;

/**
 * Drive along the road network toward a waypoint: aim at the crossing ahead,
 * and once close, past it on the road the route takes, so a turn starts
 * before the corner instead of at it. A 90-degree turn at full speed swings
 * wider than the road and scrapes the corner buildings, so the pilot brakes
 * early for a turn that is coming up.
 */
function roadPilot(world, targetX, targetY) {
  const player = world.player;
  const car = player.inCar;
  // The car can blow up mid-chase: walk toward the waypoint instead.
  if (!car) return walkInput(world, targetX, targetY);
  const onH = onHorizontalRoad(car.x, car.y);
  const onV = onVerticalRoad(car.x, car.y);
  let wx;
  let wy;
  let turnAtCross = false;
  let distToCross = Infinity;
  if (!onH && !onV) {
    // Off the roads (a parking lot, a yard): head for the nearest crossing.
    wx = nearestRoad(car.x);
    wy = nearestRoad(car.y);
  } else {
    // The crossing the car is heading for on the road it is on.
    const movingH = Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle));
    const dirH = Math.sign(Math.cos(car.angle)) || 1;
    const dirV = Math.sign(Math.sin(car.angle)) || 1;
    let ix;
    let iy;
    if (movingH) {
      ix = nearestRoad(car.x + dirH * 160);
      iy = nearestRoad(car.y);
    } else {
      ix = nearestRoad(car.x);
      iy = nearestRoad(car.y + dirV * 160);
    }
    distToCross = Math.hypot(ix - car.x, iy - car.y);
    // At that crossing, does the route turn onto the other road?
    turnAtCross = movingH
      ? Math.abs(targetY - iy) > Math.abs(targetX - ix)
      : Math.abs(targetX - ix) > Math.abs(targetY - iy);
    if (distToCross < 120 && turnAtCross) {
      if (movingH) {
        wx = ix;
        wy = iy + Math.sign(targetY - iy) * 160;
      } else {
        wx = ix + Math.sign(targetX - ix) * 160;
        wy = iy;
      }
    } else {
      wx = ix;
      wy = iy;
    }
  }
  const wantAngle = Math.atan2(wy - car.y, wx - car.x);
  let diff = wantAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, diff * 2.2));
  const targetSpeed = turnAtCross && distToCross < 240 ? 130 : CAR.maxSpeed;
  let throttle = -1;
  if (car.speed > targetSpeed + 20) throttle = car.speed > 30 ? 1 : 0;
  return { x: steer, y: throttle };
}

/** Steering toward a waypoint from a car: -1..1 turn, always throttle. */
function driveInput(world, targetX, targetY) {
  return roadPilot(world, targetX, targetY);
}

/** Walking toward a point on foot. */
function walkInput(world, targetX, targetY) {
  const player = world.player;
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: dx / dist, y: dy / dist };
}

function noInput() {
  return { move: { x: 0, y: 0 }, actions: 0, shooting: false, aim: null };
}

function stepN(world, seconds, inputFn) {
  for (let i = 0; i < seconds / STEP; i += 1) {
    const input = inputFn ? inputFn(i) : noInput();
    const events = stepWorld(world, input, STEP);
    if (events & (EVENT_BUSTED | EVENT_WASTED)) break;
  }
}

/** Put the player in the nearest parked car and return its waypoint target. */
function enterNearestCar(world) {
  let best = null;
  let bestSq = Infinity;
  for (const car of world.cars) {
    if (car.kind !== 'parked') continue;
    const dx = car.x - world.player.x;
    const dy = car.y - world.player.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = car;
    }
  }
  if (!best) return null;
  world.player.x = best.x + 40;
  world.player.y = best.y + 40;
  stepWorld(world, { move: { x: 0, y: 0 }, actions: 4, shooting: false, aim: null }, STEP);
  return best;
}

/**
 * Set `world` to the named scene (start, drive, chase or mission; any other
 * name is start) and return the screen to draw over it.
 */
export function stageShot(name, world) {
  resetWorld(world);
  if (name !== 'drive' && name !== 'chase' && name !== 'mission') {
    stepN(world, START_SECONDS, null);
    return { screen: SCREEN_TITLE };
  }
  if (name === 'drive') {
    enterNearestCar(world);
    const target = { x: world.city.places.market.x, y: world.city.places.market.y };
    stepN(world, DRIVE_SECONDS, () => {
      const input = driveInput(world, target.x, target.y);
      return { move: input, actions: 0, shooting: false, aim: null };
    });
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    enterNearestCar(world);
    world.wanted = 3;
    const target = { x: world.city.places.dock.x, y: world.city.places.dock.y };
    stepN(world, CHASE_SECONDS, () => {
      const input = driveInput(world, target.x, target.y);
      return { move: input, actions: 0, shooting: false, aim: null };
    });
    return { screen: world.over === 'busted' ? SCREEN_BUSTED : SCREEN_PLAY };
  }
  // mission: the courier run, on foot toward Palm Market.
  world.missions.index = 1;
  const target = world.city.places.market;
  stepN(world, MISSION_SECONDS, () => {
    const input = walkInput(world, target.x, target.y);
    return { move: input, actions: 0, shooting: false, aim: null };
  });
  return { screen: world.over === 'wasted' ? SCREEN_WASTED : SCREEN_PLAY };
}
