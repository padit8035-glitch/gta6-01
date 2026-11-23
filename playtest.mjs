// Headless play-test for Vice Point: run the real world rules in Node (no
// browser, no canvas) with a silent audio stub, drive the scenes the way a
// player would, and report what happened. Run with `node playtest.mjs`.
// Exit code 0 means every check passed; anything else is a bug to fix.
import { CAR, STEP } from './game/src/config.js';
import { createWorld, stepWorld } from './game/src/world.js';
import { stageShot } from './game/src/shots.js';
import { nearestRoad, onHorizontalRoad, onVerticalRoad } from './game/src/city.js';

const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) notes.push(`PASS ${name} — ${detail}`);
  else failures.push(`FAIL ${name} — ${detail}`);
}

// The game only ever calls these audio methods; silence is fine here.
const silentAudio = new Proxy({}, { get: () => () => {} });

function noInput() {
  return { move: { x: 0, y: 0 }, actions: 0, shooting: false, aim: null };
}

function roadPilot(world, targetX, targetY) {
  const player = world.player;
  const car = player.inCar;
  if (!car) return walkPilot(world, targetX, targetY);
  const onH = onHorizontalRoad(car.x, car.y);
  const onV = onVerticalRoad(car.x, car.y);
  let wx;
  let wy;
  let turnAtCross = false;
  let distToCross = Infinity;
  if (!onH && !onV) {
    wx = nearestRoad(car.x);
    wy = nearestRoad(car.y);
  } else {
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
  return { move: { x: steer, y: throttle }, actions: 0, shooting: false, aim: null };
}

/** Walk along the roads toward a point: cross at intersections, never cut through blocks. */
function walkPilot(world, targetX, targetY) {
  const player = world.player;
  const onH = onHorizontalRoad(player.x, player.y);
  const onV = onVerticalRoad(player.x, player.y);
  let wx;
  let wy;
  if (onH && !onV) {
    const dirX = Math.sign(targetX - player.x) || 1;
    wx = player.x + dirX * 160;
    wy = nearestRoad(player.y);
  } else if (onV && !onH) {
    const dirY = Math.sign(targetY - player.y) || 1;
    wx = nearestRoad(player.x);
    wy = player.y + dirY * 160;
  } else if (onH && onV) {
    if (Math.abs(targetX - player.x) > Math.abs(targetY - player.y)) {
      const dirX = Math.sign(targetX - player.x) || 1;
      wx = player.x + dirX * 160;
      wy = nearestRoad(player.y);
    } else {
      const dirY = Math.sign(targetY - player.y) || 1;
      wx = nearestRoad(player.x);
      wy = player.y + dirY * 160;
    }
  } else {
    wx = nearestRoad(player.x);
    wy = nearestRoad(player.y);
  }
  const dx = wx - player.x;
  const dy = wy - player.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { move: { x: dx / dist, y: dy / dist }, actions: 0, shooting: false, aim: null };
}

function nearestParkedCar(world) {
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
  return best;
}

function stepN(world, seconds, inputFn) {
  let events = 0;
  for (let i = 0; i < seconds / STEP; i += 1) {
    events = stepWorld(world, inputFn ? inputFn(i) : noInput(), STEP);
    if (world.over) break;
  }
  return events;
}

// T1 — the drive scene: after 16 s the player must still be in a moving car.
{
  const world = createWorld(7, silentAudio);
  if (process.env.VERBOSE) {
    // Replicate the drive scene step by step and log each second.
    const w2 = createWorld(7, silentAudio);
    const parked = nearestParkedCar(w2);
    console.log(`T1 start: player=(${Math.round(w2.player.x)},${Math.round(w2.player.y)}) nearest parked car=(${Math.round(parked.x)},${Math.round(parked.y)}) angle=${parked.angle.toFixed(2)}`);
    w2.player.x = parked.x + 40;
    w2.player.y = parked.y + 40;
    stepWorld(w2, { move: { x: 0, y: 0 }, actions: 4, shooting: false, aim: null }, STEP);
    const market = w2.city.places.market;
    for (let s = 0; s < 16; s += 1) {
      stepN(w2, 1, () => roadPilot(w2, market.x, market.y));
      const car = w2.player.inCar;
      console.log(`T1 t=${s + 1}s player=(${Math.round(w2.player.x)},${Math.round(w2.player.y)}) inCar=${Boolean(car)} speed=${car ? Math.round(car.speed) : 'n/a'} angle=${car ? car.angle.toFixed(2) : 'n/a'} health=${car ? Math.round(car.health) : 'n/a'} over=${w2.over}`);
      if (w2.over) break;
    }
  }
  const scene = stageShot('drive', world);
  const car = world.player.inCar;
  check(
    'T1 drive scene',
    Boolean(car) && Math.abs(car.speed) > 100 && !world.over,
    car
      ? `inCar=yes speed=${Math.round(Math.abs(car.speed))} px/s (${Math.round(Math.abs(car.speed) * 0.14)} mph) health=${Math.round(car.health)} wanted=${world.wanted} over=${world.over} screen=${scene.screen}`
      : `inCar=no player=(${Math.round(world.player.x)},${Math.round(world.player.y)}) health=${Math.round(world.player.health)} over=${world.over} screen=${scene.screen}`,
  );
}

// T2 — the chase scene: after 11 s the player must not be busted.
{
  const world = createWorld(7, silentAudio);
  const scene = stageShot('chase', world);
  check(
    'T2 chase scene',
    world.over !== 'busted' && world.over !== 'wasted',
    `over=${world.over} wanted=${world.wanted} cops=${world.police.length} inCar=${Boolean(world.player.inCar)} carHealth=${world.player.inCar ? Math.round(world.player.inCar.health) : 'n/a'} screen=${scene.screen}`,
  );
}

// T3 — mission 1, played like a player: walk to a parked car, steal it, drive
// to Rico's Garage, and the mission must complete with the reward paid.
{
  const world = createWorld(7, silentAudio);
  const startMoney = world.player.money;
  let entered = false;
  let done = false;
  // One step per loop iteration, up to 120 s of game time.
  for (let step = 0; step < 120 * 60 && !done && !world.over; step += 1) {
    const target = nearestParkedCar(world);
    if (!world.player.inCar && target) {
      const dx = target.x - world.player.x;
      const dy = target.y - world.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 70) {
        stepWorld(world, { move: { x: 0, y: 0 }, actions: 4, shooting: false, aim: null }, STEP);
        entered = world.player.inCar !== null;
      } else {
        stepWorld(world, walkPilot(world, target.x, target.y), STEP);
      }
    } else if (world.player.inCar) {
      const garage = world.city.places.garage;
      stepWorld(world, roadPilot(world, garage.x, garage.y), STEP);
      if (world.missions.index > 0) done = true;
    } else {
      stepWorld(world, noInput(), STEP);
    }
  }
  check(
    'T3 mission 1 completes',
    done && world.player.money > startMoney,
    `entered=${entered} index=${world.missions.index} money=$${world.player.money} (was $${startMoney}) over=${world.over}`,
  );
}

// T4 — wanted decays when no cop is anywhere near the player (the trail is
// cold: the cruisers that were chasing have been cleared, none respawn).
{
  const world = createWorld(7, silentAudio);
  world.player.x = 1280;
  world.player.y = 1280;
  world.wanted = 2;
  for (let i = 0; i < 50 / STEP; i += 1) {
    world.police.length = 0;
    stepWorld(world, noInput(), STEP);
  }
  check('T4 wanted decays', world.wanted === 0, `wanted=${world.wanted} after 50 s with no cops near`);
}

// T5 — combat: shooting at a cop damages it and raises the wanted level.
{
  const world = createWorld(7, silentAudio);
  // The cop stands on the same road as the player, 194 px south, so no
  // building stands between the pistol and the cruiser.
  const cop = { x: world.player.x, y: world.player.y + 194, angle: 0, color: '#111', kind: 'police', health: 100, speed: 0, cruise: 0, stuck: 0, flash: 0, shootTimer: 0 };
  world.police.push(cop);
  const before = world.wanted;
  for (let i = 0; i < 3; i += 1) {
    stepWorld(world, { move: { x: 0, y: 0 }, actions: 0, shooting: true, aim: { x: cop.x, y: cop.y } }, STEP);
    for (let j = 0; j < 20; j += 1) stepWorld(world, noInput(), STEP);
  }
  check('T5 shooting a cop', cop.health < 100 && world.wanted > before, `cop health=${Math.round(cop.health)} wanted=${before} -> ${world.wanted}`);
}

// T6 — traffic keeps flowing: after 60 s of play, no traffic car is stuck on a
// building and the count near the player stays full.
{
  const world = createWorld(7, silentAudio);
  stepN(world, 60, () => ({ move: { x: 1, y: 0 }, actions: 0, shooting: false, aim: null }));
  let onBuilding = 0;
  let traffic = 0;
  for (const car of world.cars) {
    if (car.kind !== 'traffic') continue;
    traffic += 1;
    for (const b of world.city.buildings) {
      if (car.x > b.x - 20 && car.x < b.x + b.w + 20 && car.y > b.y - 20 && car.y < b.y + b.h + 20) {
        onBuilding += 1;
        break;
      }
    }
  }
  check('T6 traffic flows', traffic >= 14 && onBuilding === 0, `traffic=${traffic} cars on buildings=${onBuilding}`);
}

// T8 — the whole story, played by the pilots: mission 1 (steal a car, garage),
// 2 (courier to the market), 3 (heat: lose the cops at the Hideout),
// 4 (payday: six cash drops), 5 (the Big Score: bank, then the dock).
{
  const world = createWorld(7, silentAudio);
  let steps = 0;
  let bustedOrWasted = false;
  while (!world.missions.done && steps < 900 * 60 && !world.over) {
    steps += 1;
    const target = world.missions.target;
    if (!world.player.inCar) {
      const parked = nearestParkedCar(world);
      if (parked) {
        const dx = parked.x - world.player.x;
        const dy = parked.y - world.player.y;
        if (Math.hypot(dx, dy) < 70) {
          stepWorld(world, { move: { x: 0, y: 0 }, actions: 4, shooting: false, aim: null }, STEP);
          continue;
        }
        stepWorld(world, walkPilot(world, parked.x, parked.y), STEP);
        continue;
      }
      stepWorld(world, noInput(), STEP);
      continue;
    }
    // In a car: drive to the mission target, or to the nearest cash drop.
    if (target) {
      stepWorld(world, roadPilot(world, target.x, target.y), STEP);
    } else {
      let best = null;
      let bestSq = Infinity;
      for (const pickup of world.pickups) {
        if (pickup.kind !== 'cash' || !pickup.mission) continue;
        const dx = pickup.x - world.player.x;
        const dy = pickup.y - world.player.y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) {
          bestSq = sq;
          best = pickup;
        }
      }
      if (best) stepWorld(world, roadPilot(world, best.x, best.y), STEP);
      else stepWorld(world, noInput(), STEP);
    }
    if (world.over) bustedOrWasted = true;
  }
  check(
    'T8 full story completes',
    world.missions.done && !bustedOrWasted,
    `done=${world.missions.done} index=${world.missions.index} money=$${world.player.money} time=${Math.round(steps / 60)}s over=${world.over}`,
  );
}

// T7 — determinism: the same seed and the same inputs give the same world.
{
  const a = createWorld(7, silentAudio);
  const b = createWorld(7, silentAudio);
  const input = () => ({ move: { x: 0.5, y: -1 }, actions: 0, shooting: false, aim: null });
  stepN(a, 10, input);
  stepN(b, 10, input);
  const same = Math.abs(a.player.x - b.player.x) < 0.001 && Math.abs(a.player.y - b.player.y) < 0.001 && a.cars.length === b.cars.length;
  check('T7 deterministic', same, `player a=(${a.player.x.toFixed(1)},${a.player.y.toFixed(1)}) b=(${b.player.x.toFixed(1)},${b.player.y.toFixed(1)}) cars=${a.cars.length}/${b.cars.length}`);
}

for (const note of notes) console.log(note);
for (const failure of failures) console.log(failure);
console.log(failures.length === 0 ? 'ALL PLAY-TESTS PASSED' : `${failures.length} PLAY-TEST(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
