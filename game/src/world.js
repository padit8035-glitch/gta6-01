// The world: everything that happens in Vice Point, one fixed step at a time.
// The player walks or drives, traffic flows, pedestrians wander and flee,
// police chase the wanted, bullets fly, missions advance. The renderer only
// reads this state; it never changes it.
import { CAR, PED, PLAYER, POLICE, STEP, TRAFFIC, WANTED, WORLD } from './config.js';
import { createCity, clampToWorld, collideBuildings, isRoad, nearestRoad } from './city.js';
import { createRandom } from './random.js';
import {
  makeBullet, makeCar, makeParticle, makePed, makePickup,
  stepBullet, stepParticle, stepPed, stepPoliceCar, stepTrafficCar,
} from './entities.js';
import {
  completeMission, createMissionState, currentMission, restartMission,
  startMission, updateMissions,
} from './missions.js';

export const EVENT_MISSION_DONE = 1;
export const EVENT_MISSION_FAIL = 2;
export const EVENT_BUSTED = 4;
export const EVENT_WASTED = 8;
export const EVENT_CRASH = 16;
export const EVENT_PICKUP = 32;
export const EVENT_SHOT = 64;

function burst(world, x, y, count, color, speed, life, size) {
  for (let i = 0; i < count; i += 1) {
    const angle = world.random.next() * Math.PI * 2;
    const v = speed * (0.4 + world.random.next() * 0.8);
    world.particles.push(makeParticle(x, y, Math.cos(angle) * v, Math.sin(angle) * v, life * (0.6 + world.random.next() * 0.7), color, size));
  }
}

function explodeCar(world, car) {
  burst(world, car.x, car.y, 26, '#ff7a2e', 260, 0.8, 5);
  burst(world, car.x, car.y, 18, '#3a3a3a', 160, 1.4, 7);
  burst(world, car.x, car.y, 10, '#ffd23c', 320, 0.5, 4);
  world.audio.explosion();
}

function addWanted(world, amount) {
  world.wanted = Math.min(WANTED.max, world.wanted + amount);
  world.wantedTimer = 0;
}

function nearestCar(world, x, y, maxDist) {
  let best = null;
  let bestSq = maxDist * maxDist;
  for (let i = 0; i < world.cars.length; i += 1) {
    const car = world.cars[i];
    const dx = car.x - x;
    const dy = car.y - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = car;
    }
  }
  return best;
}

function spawnTraffic(world) {
  const angle = world.random.next() * Math.PI * 2;
  const dist = TRAFFIC.spawnMargin * (0.8 + world.random.next() * 0.4);
  const x = world.player.x + Math.cos(angle) * dist;
  const y = world.player.y + Math.sin(angle) * dist;
  if (x < 60 || x > WORLD - 60 || y < 60 || y > WORLD - 60) return;
  const roadX = nearestRoad(x);
  const roadY = nearestRoad(y);
  const horizontal = world.random.chance(0.5);
  const car = makeCar(world.random, horizontal ? x : roadX, horizontal ? roadY : y, 0, 'traffic');
  car.axis = horizontal ? 'h' : 'v';
  car.dir = world.random.chance(0.5) ? 1 : -1;
  car.angle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  car.speed = car.cruise;
  world.cars.push(car);
}

function spawnPed(world) {
  const angle = world.random.next() * Math.PI * 2;
  const dist = 300 + world.random.next() * 500;
  const ped = makePed(world.random, world.player.x + Math.cos(angle) * dist, world.player.y + Math.sin(angle) * dist);
  clampToWorld(ped, 40);
  world.peds.push(ped);
}

function spawnPolice(world) {
  const angle = world.random.next() * Math.PI * 2;
  const dist = 620 + world.random.next() * 200;
  const x = Math.max(60, Math.min(WORLD - 60, world.player.x + Math.cos(angle) * dist));
  const y = Math.max(60, Math.min(WORLD - 60, world.player.y + Math.sin(angle) * dist));
  const car = makeCar(world.random, x, y, 0, 'police');
  car.speed = 200;
  world.police.push(car);
}

export function createWorld(seed, audio) {
  const random = createRandom(seed);
  const city = createCity(random);
  const world = {
    seed,
    random,
    city,
    audio,
    time: 0,
    dayTime: 0.32,
    player: {
      x: city.places.garage.x, y: city.places.garage.y + 40,
      angle: 0, facing: 0, health: PLAYER.health, money: PLAYER.startMoney,
      inCar: null, punchTimer: 0, shotTimer: 0, moving: false,
    },
    cars: [],
    peds: [],
    police: [],
    bullets: [],
    particles: [],
    pickups: [],
    wanted: 0,
    wantedTimer: 0,
    lastWanted: 0,
    missions: createMissionState(),
    message: '',
    messageTimer: 0,
    bustTimer: 0,
    stats: { carsStolen: 0, shots: 0, missionsDone: 0, earned: 0 },
    over: null,
  };
  // Parked cars in the lots, ready to steal.
  for (let i = 0; i < city.parking.length && world.cars.length < 26; i += 1) {
    const spot = city.parking[i];
    if (random.chance(0.55)) world.cars.push(makeCar(random, spot.x, spot.y, spot.angle, 'parked'));
  }
  // A few health pickups on the roads, always reachable.
  world.pickups.push(makePickup(354, WORLD - 286, 'health', 40));
  world.pickups.push(makePickup(WORLD - 286, WORLD - 286, 'health', 40));
  world.pickups.push(makePickup(WORLD - 286, 354, 'health', 40));
  for (let i = 0; i < TRAFFIC.count; i += 1) spawnTraffic(world);
  for (let i = 0; i < PED.count; i += 1) spawnPed(world);
  return world;
}

export function resetWorld(world) {
  const fresh = createWorld(world.seed, world.audio);
  for (const key of Object.keys(fresh)) world[key] = fresh[key];
}

function stepPlayerOnFoot(world, move, dt) {
  const player = world.player;
  const len = Math.hypot(move.x, move.y) || 1;
  const speed = PLAYER.walkSpeed;
  player.moving = Boolean(move.x || move.y);
  if (player.moving) player.facing = Math.atan2(move.y, move.x);
  player.x += (move.x / len) * speed * dt;
  player.y += (move.y / len) * speed * dt;
  clampToWorld(player, 20);
  const circle = { x: player.x, y: player.y, r: PLAYER.radius };
  collideBuildings(world.city, circle);
  player.x = circle.x;
  player.y = circle.y;
  // Bumping into a parked or traffic car stops the player.
  for (let i = 0; i < world.cars.length; i += 1) {
    const car = world.cars[i];
    const dx = player.x - car.x;
    const dy = player.y - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 30 && dist > 0) {
      player.x = car.x + (dx / dist) * 30;
      player.y = car.y + (dy / dist) * 30;
    }
  }
}

function stepPlayerDriving(world, move, dt) {
  const player = world.player;
  const car = player.inCar;
  if (move.y < 0) {
    car.speed += CAR.accel * dt;
  } else if (move.y > 0) {
    if (car.speed > 10) car.speed -= CAR.brake * dt;
    else car.speed -= CAR.reverseAccel * dt;
  }
  // Rolling resistance and a top speed.
  car.speed -= car.speed * 0.25 * dt;
  car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));
  // Steering still bites at a crawl, so a wedged car can turn out of trouble.
  const steer = move.x * CAR.steer * (0.35 + 0.65 * Math.min(1, Math.abs(car.speed) / 140));
  car.angle += steer * dt * (car.speed >= 0 ? 1 : -1);
  const beforeX = car.x;
  const beforeY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  clampToWorld(car, 30);
  const circle = { x: car.x, y: car.y, r: 24 };
  if (collideBuildings(world.city, circle)) {
    car.x = circle.x;
    car.y = circle.y;
    if (Math.abs(car.speed) > 260) {
      car.health -= 12;
      burst(world, car.x, car.y, 8, '#c8c8c8', 120, 0.5, 4);
      world.audio.crash();
      car.speed *= 0.35;
    } else {
      // A light scrape only scrubs a little speed; the car keeps sliding.
      car.speed *= 0.98;
    }
  }
  // Skid smoke on hard turns at speed.
  if (Math.abs(steer) > 1.6 && Math.abs(car.speed) > 300 && world.random.chance(0.5)) {
    world.particles.push(makeParticle(car.x - Math.cos(car.angle) * 20, car.y - Math.sin(car.angle) * 20, 0, 0, 0.6, '#aaaaaa', 6));
  }
  // Hitting a pedestrian with the car.
  for (let i = world.peds.length - 1; i >= 0; i -= 1) {
    const ped = world.peds[i];
    const dx = ped.x - car.x;
    const dy = ped.y - car.y;
    if (dx * dx + dy * dy < 34 * 34 && Math.abs(car.speed) > 60) {
      ped.flee = 2;
      ped.panic = 1;
      ped.x += (dx / (Math.hypot(dx, dy) || 1)) * 60;
      ped.y += (dy / (Math.hypot(dx, dy) || 1)) * 60;
      addWanted(world, WANTED.hitPed);
      world.message = 'You hit a pedestrian! Wanted +1';
      world.messageTimer = 3;
      burst(world, ped.x, ped.y, 6, '#d94f3d', 140, 0.5, 4);
    }
  }
  // Ramming another car: both cars are pushed apart, so a bump can never pin
  // either one to a standstill, and a hard hit only damages once per half
  // second instead of draining both cars in one long scrape.
  for (let i = 0; i < world.cars.length; i += 1) {
    const other = world.cars[i];
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 44 && dist > 0) {
      const push = (44 - dist) / dist / 2;
      car.x -= dx * push;
      car.y -= dy * push;
      other.x += dx * push;
      other.y += dy * push;
      if (Math.abs(car.speed) > 200 && world.time - (other.lastHit || 0) > 0.5) {
        other.lastHit = world.time;
        other.health -= 8;
        car.health -= 4;
        world.audio.crash();
        burst(world, (car.x + other.x) / 2, (car.y + other.y) / 2, 6, '#ffd23c', 160, 0.4, 4);
        if (other.health <= 0 && other.kind !== 'player') {
          explodeCar(world, other);
          world.cars.splice(i, 1);
        }
      }
    }
  }
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.moving = Math.abs(car.speed) > 20;
  if (car.health <= 0) {
    explodeCar(world, car);
    world.cars.splice(world.cars.indexOf(car), 1);
    player.inCar = null;
    player.health = Math.max(20, player.health - 30);
    player.x = beforeX;
    player.y = beforeY;
    world.message = 'Your car blew up!';
    world.messageTimer = 3;
  }
  return car;
}

function tryEnterCar(world) {
  const player = world.player;
  if (player.inCar) {
    // Step out beside the car.
    const car = player.inCar;
    car.kind = 'parked';
    car.speed = 0;
    player.inCar = null;
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 44;
    player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 44;
    clampToWorld(player, 20);
    return;
  }
  const car = nearestCar(world, player.x, player.y, 78);
  if (!car) return;
  if (car.kind === 'traffic') {
    addWanted(world, WANTED.stealCar);
    world.message = 'Car stolen! Wanted +1';
    world.messageTimer = 3;
    world.stats.carsStolen += 1;
  }
  car.kind = 'player';
  player.inCar = car;
  player.angle = car.angle;
}

function punch(world) {
  const player = world.player;
  if (player.punchTimer > 0 || player.inCar) return;
  player.punchTimer = PLAYER.punchCooldown;
  world.audio.punch();
  const reach = PLAYER.punchRange;
  const px = player.x + Math.cos(player.facing) * reach;
  const py = player.y + Math.sin(player.facing) * reach;
  for (let i = world.peds.length - 1; i >= 0; i -= 1) {
    const ped = world.peds[i];
    const dx = ped.x - px;
    const dy = ped.y - py;
    if (dx * dx + dy * dy < 34 * 34) {
      ped.flee = 2;
      ped.panic = 1;
      world.particles.push(makeParticle(ped.x, ped.y, 0, 0, 0.3, '#ffd23c', 8));
    }
  }
  for (let i = 0; i < world.police.length; i += 1) {
    const cop = world.police[i];
    const dx = cop.x - px;
    const dy = cop.y - py;
    if (dx * dx + dy * dy < 40 * 40) {
      cop.health -= PLAYER.punchDamage;
      addWanted(world, 1);
      if (cop.health <= 0) {
        explodeCar(world, cop);
        world.police.splice(i, 1);
        addWanted(world, WANTED.killCop);
      }
    }
  }
}

function shoot(world, targetX, targetY) {
  const player = world.player;
  if (player.shotTimer > 0 || player.inCar) return;
  player.shotTimer = PLAYER.shotCooldown;
  const angle = Math.atan2(targetY - player.y, targetX - player.x);
  const bx = player.x + Math.cos(angle) * 22;
  const by = player.y + Math.sin(angle) * 22;
  world.bullets.push(makeBullet(bx, by, angle, PLAYER.bulletSpeed, PLAYER.bulletDamage, true));
  world.stats.shots += 1;
  world.audio.shoot();
  burst(world, bx, by, 3, '#ffd23c', 90, 0.12, 3);
  addWanted(world, WANTED.shoot);
}

function updatePolice(world, dt) {
  const player = world.player;
  const wantCount = Math.min(world.wanted, POLICE.maxCars);
  // Fresh heat (the wanted level just went up) always brings cruisers; once
  // the trail is cold, no new cruiser appears out of nowhere — outrun them
  // and the heat can actually cool off.
  let nearestCop = Infinity;
  for (const cop of world.police) {
    const dx = cop.x - player.x;
    const dy = cop.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestCop) nearestCop = dist;
  }
  const freshHeat = world.wanted > (world.lastWanted || 0);
  world.lastWanted = world.wanted;
  if (freshHeat || nearestCop < 750) {
    while (world.police.length < wantCount) spawnPolice(world);
  }
  while (world.police.length > wantCount) world.police.pop();
  // A cruiser a kilometre behind has lost the trail: it gives up.
  for (let i = world.police.length - 1; i >= 0; i -= 1) {
    const cop = world.police[i];
    const dx = cop.x - player.x;
    const dy = cop.y - player.y;
    if (dx * dx + dy * dy > 1000 * 1000) world.police.splice(i, 1);
  }
  let near = false;
  for (let i = world.police.length - 1; i >= 0; i -= 1) {
    const cop = world.police[i];
    stepPoliceCar(cop, player.x, player.y, dt);
    const circle = { x: cop.x, y: cop.y, r: 24 };
    collideBuildings(world.city, circle);
    cop.x = circle.x;
    cop.y = circle.y;
    const dx = cop.x - player.x;
    const dy = cop.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 700) near = true;
    // Ram the player's car, or corner the player on foot.
    if (player.inCar) {
      if (dist < 46) {
        player.inCar.health -= POLICE.ramDamage * dt * 2;
        player.inCar.speed *= 1 - dt * 0.8;
        cop.speed *= 0.6;
        if (world.random.chance(dt * 2)) world.audio.crash();
      }
    } else if (dist < POLICE.bustDistance) {
      world.bustTimer += dt;
      if (world.bustTimer >= POLICE.bustSeconds) {
        world.over = 'busted';
        world.audio.busted();
        return EVENT_BUSTED;
      }
    }
    // Cops shoot back at two stars and up.
    if (world.wanted >= 2 && dist < POLICE.shootRange && dist > 120) {
      cop.shootTimer -= dt;
      if (cop.shootTimer <= 0) {
        cop.shootTimer = POLICE.shootCooldown * (0.8 + world.random.next() * 0.6);
        const spread = (world.random.next() - 0.5) * 0.35;
        const angle = Math.atan2(dy, dx) + Math.PI + spread;
        world.bullets.push(makeBullet(cop.x, cop.y, angle, 620, 8, false));
      }
    }
  }
  if (world.police.length === 0 || !near) world.bustTimer = 0;
  return 0;
}

function updateBullets(world, dt) {
  let events = 0;
  for (let i = world.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = world.bullets[i];
    if (!stepBullet(bullet, world.city, dt)) {
      burst(world, bullet.x, bullet.y, 3, '#c8c8c8', 80, 0.25, 3);
      world.bullets.splice(i, 1);
      continue;
    }
    if (bullet.fromPlayer) {
      let hit = false;
      for (let j = world.peds.length - 1; j >= 0; j -= 1) {
        const ped = world.peds[j];
        const dx = ped.x - bullet.x;
        const dy = ped.y - bullet.y;
        if (dx * dx + dy * dy < 18 * 18) {
          ped.flee = 2;
          ped.panic = 1;
          burst(world, ped.x, ped.y, 5, '#d94f3d', 120, 0.4, 4);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (let j = 0; j < world.police.length; j += 1) {
          const cop = world.police[j];
          const dx = cop.x - bullet.x;
          const dy = cop.y - bullet.y;
          if (dx * dx + dy * dy < 28 * 28) {
            cop.health -= bullet.damage;
            burst(world, bullet.x, bullet.y, 5, '#ffd23c', 140, 0.3, 4);
            if (cop.health <= 0) {
              explodeCar(world, cop);
              world.police.splice(j, 1);
              addWanted(world, WANTED.killCop);
            }
            hit = true;
            break;
          }
        }
      }
      if (hit) world.bullets.splice(i, 1);
    } else {
      const player = world.player;
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      if (dx * dx + dy * dy < 16 * 16) {
        player.health -= bullet.damage;
        burst(world, player.x, player.y, 4, '#d94f3d', 120, 0.3, 4);
        world.bullets.splice(i, 1);
        if (player.health <= 0) {
          world.over = 'wasted';
          return EVENT_WASTED;
        }
      }
    }
  }
  return events;
}

function updatePickups(world) {
  const player = world.player;
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = world.pickups[i];
    pickup.bob += 0.08;
    const dx = pickup.x - player.x;
    const dy = pickup.y - player.y;
    if (dx * dx + dy * dy < 32 * 32) {
      if (pickup.kind === 'cash') {
        player.money += pickup.amount;
        world.stats.earned += pickup.amount;
        world.audio.cash();
        burst(world, pickup.x, pickup.y, 8, '#2ed573', 120, 0.5, 4);
        if (pickup.mission) world.missions.dropsLeft -= 1;
      } else {
        player.health = Math.min(PLAYER.health, player.health + pickup.amount);
        world.audio.pickup();
        burst(world, pickup.x, pickup.y, 8, '#ff6b81', 120, 0.5, 4);
      }
      world.pickups.splice(i, 1);
    }
  }
}

/**
 * Advance the world one fixed step. `input` is the frame's input snapshot.
 * Returns an event bitmask for the caller (mission done/failed, busted...).
 */
export function stepWorld(world, input, dt) {
  let events = 0;
  world.time += dt;
  world.dayTime = (world.dayTime + dt / 240) % 1;
  const player = world.player;
  if (player.punchTimer > 0) player.punchTimer -= dt;
  if (player.shotTimer > 0) player.shotTimer -= dt;
  if (world.messageTimer > 0) world.messageTimer -= dt;

  const actions = input.actions;
  if (actions & 4) tryEnterCar(world);
  if (actions & 8) punch(world);
  if (actions & 16) world.audio.toggleMute();
  if (input.shooting && !player.inCar) {
    const aim = input.aim || { x: player.x + Math.cos(player.facing) * 200, y: player.y + Math.sin(player.facing) * 200 };
    shoot(world, aim.x, aim.y);
  }

  if (player.inCar) stepPlayerDriving(world, input.move, dt);
  else stepPlayerOnFoot(world, input.move, dt);

  // Traffic: keep the streets busy near the player.
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i];
    if (car.kind === 'traffic') {
      if (!stepTrafficCar(car, world.cars, player.x, player.y, dt, world.random)) {
        world.cars.splice(i, 1);
        continue;
      }
      // A shove (from the player's car) can push a traffic car off the road;
      // the buildings push it back out, so it never ends up on a roof.
      const circle = { x: car.x, y: car.y, r: 24 };
      collideBuildings(world.city, circle);
      car.x = circle.x;
      car.y = circle.y;
    }
  }
  let trafficCount = 0;
  for (const car of world.cars) if (car.kind === 'traffic') trafficCount += 1;
  while (trafficCount < TRAFFIC.count) {
    spawnTraffic(world);
    trafficCount += 1;
  }
  // Traffic cars never pile into each other: separate overlapping pairs.
  for (let i = 0; i < world.cars.length; i += 1) {
    const a = world.cars[i];
    if (a.kind !== 'traffic') continue;
    for (let j = i + 1; j < world.cars.length; j += 1) {
      const b = world.cars[j];
      if (b.kind !== 'traffic') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 44 && dist > 0.01) {
        const push = (44 - dist) / dist / 2;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  }

  // Pedestrians wander and flee from the player when shots are fired.
  const danger = { x: player.x, y: player.y };
  for (let i = world.peds.length - 1; i >= 0; i -= 1) {
    const ped = world.peds[i];
    const dx = ped.x - player.x;
    const dy = ped.y - player.y;
    if (dx * dx + dy * dy > 1300 * 1300) {
      world.peds.splice(i, 1);
      continue;
    }
    stepPed(ped, danger, dt, world.random);
    clampToWorld(ped, 30);
  }
  while (world.peds.length < PED.count) spawnPed(world);

  // Police, bullets, pickups, particles.
  if (world.wanted > 0) events |= updatePolice(world, dt);
  events |= updateBullets(world, dt);
  updatePickups(world);
  for (let i = world.particles.length - 1; i >= 0; i -= 1) {
    if (!stepParticle(world.particles[i], dt)) world.particles.splice(i, 1);
  }

  // Wanted decays when the player stays clean and out of sight.
  if (world.wanted > 0) {
    let copNear = false;
    for (const cop of world.police) {
      const dx = cop.x - player.x;
      const dy = cop.y - player.y;
      if (dx * dx + dy * dy < 600 * 600) {
        copNear = true;
        break;
      }
    }
    if (!copNear) {
      world.wantedTimer += dt;
      if (world.wantedTimer >= WANTED.decaySeconds) {
        world.wanted -= 1;
        world.wantedTimer = 0;
      }
    } else {
      world.wantedTimer = 0;
    }
  }

  // Slow health regen out of trouble.
  if (player.health < PLAYER.health && world.wanted === 0) {
    player.health = Math.min(PLAYER.health, player.health + 2 * dt);
  }

  // Missions.
  if (!world.missions.active && !world.missions.done) {
    startMission(world.missions, world);
    world.message = world.missions.toast;
    world.messageTimer = 5;
  }
  const missionResult = updateMissions(world.missions, world, dt);
  if (missionResult === 'done') {
    const reward = completeMission(world.missions, world);
    world.stats.missionsDone += 1;
    world.stats.earned += reward;
    world.message = `Mission complete! +$${reward}`;
    world.messageTimer = 4;
    world.audio.mission();
    events |= EVENT_MISSION_DONE;
    if (!world.missions.done) {
      startMission(world.missions, world);
      world.message += ` — ${world.missions.toast}`;
      world.messageTimer = 6;
    } else {
      world.message = `Story complete! You own Vice Point. +$${reward}`;
    }
  } else if (missionResult === 'failed') {
    world.message = 'Too slow — Rico is giving you another shot.';
    world.messageTimer = 4;
    restartMission(world.missions, world);
    events |= EVENT_MISSION_FAIL;
  }

  // Engine and siren follow the action.
  const driving = Boolean(player.inCar);
  world.audio.engine(driving ? Math.abs(player.inCar.speed) / CAR.maxSpeed : 0, driving);
  let sirenNear = false;
  for (const cop of world.police) {
    const dx = cop.x - player.x;
    const dy = cop.y - player.y;
    if (dx * dx + dy * dy < 700 * 700) {
      sirenNear = true;
      break;
    }
  }
  world.audio.siren(sirenNear, dt);

  if (world.over === 'busted') return events | EVENT_BUSTED;
  if (world.over === 'wasted') return events | EVENT_WASTED;
  return events;
}

export { STEP };
