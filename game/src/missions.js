// The story: five jobs from Rico, the fixer who runs Vice Point from a garage
// on the north side. Each mission is a small state machine — start it, watch
// its goal, finish it for cash — and the next one opens. Failing a timed job
// just restarts it; the story never dead-ends.
import { MISSIONS } from './config.js';
import { nearestRoad } from './city.js';
import { makePickup } from './entities.js';

const PAYDAY_DROPS = 6;
const COURIER_SECONDS = 100;

export function createMissionState() {
  return {
    index: 0,
    active: false,
    phase: 0,
    timer: 0,
    dropsLeft: 0,
    target: null,
    done: false,
    toast: '',
    toastTimer: 0,
  };
}

/** The mission the player is on, or null when the story is finished. */
export function currentMission(missions) {
  return missions.index < MISSIONS.length ? MISSIONS[missions.index] : null;
}

/** Short objective line for the HUD. */
export function missionObjective(missions) {
  if (missions.done) return 'Story complete — Vice Point is yours.';
  const mission = currentMission(missions);
  if (!mission) return '';
  if (!missions.active) return `Talk to Rico — ${mission.name} is waiting.`;
  switch (mission.id) {
    case 'wheels':
      return 'Steal a car and bring it to Rico’s Garage.';
    case 'courier':
      return `Deliver the package to Palm Market — ${Math.ceil(missions.timer)}s left.`;
    case 'heat':
      return 'Lose the heat — get to the Hideout.';
    case 'payday':
      return `Collect the cash drops — ${PAYDAY_DROPS - missions.dropsLeft}/${PAYDAY_DROPS}.`;
    case 'score':
      return missions.phase === 0
        ? 'Get to Vice Point Bank.'
        : 'Grab the bag and reach the South Dock — the cops are coming.';
    default:
      return mission.name;
  }
}

/** Where the marker points, or null when there is no target yet. */
export function missionTarget(missions) {
  return missions.target;
}

function setTarget(missions, world, place) {
  missions.target = { x: place.x, y: place.y, label: place.label };
}

function near(world, target, radius) {
  if (!target) return false;
  const dx = world.player.x - target.x;
  const dy = world.player.y - target.y;
  return dx * dx + dy * dy < radius * radius;
}

/** Begin the current mission: place its marker, drops and heat. */
export function startMission(missions, world) {
  const mission = currentMission(missions);
  if (!mission) return;
  missions.active = true;
  missions.phase = 0;
  missions.timer = 0;
  missions.dropsLeft = 0;
  const places = world.city.places;
  if (mission.id === 'wheels') {
    setTarget(missions, world, places.garage);
    missions.toast = 'Rico: I need wheels. Any car. Bring it to my garage.';
  } else if (mission.id === 'courier') {
    setTarget(missions, world, places.market);
    missions.timer = COURIER_SECONDS;
    missions.toast = 'Rico: Package for Palm Market. Fast. 100 seconds.';
  } else if (mission.id === 'heat') {
    setTarget(missions, world, places.hideout);
    world.wanted = 3;
    missions.toast = 'Rico: Three stars on you. Lose them at the Hideout.';
  } else if (mission.id === 'payday') {
    missions.dropsLeft = PAYDAY_DROPS;
    for (let i = 0; i < PAYDAY_DROPS; i += 1) {
      const angle = (i / PAYDAY_DROPS) * Math.PI * 2 + 0.4;
      const radius = 420 + (i % 3) * 260;
      let x = world.city.places.market.x + Math.cos(angle) * radius;
      let y = world.city.places.market.y + Math.sin(angle) * radius;
      x = Math.max(80, Math.min(2480, x));
      y = Math.max(80, Math.min(2480, y));
      // Nudge the drop onto the nearest road, so it is never inside a building.
      if (Math.abs(x - nearestRoad(x)) < Math.abs(y - nearestRoad(y))) x = nearestRoad(x);
      else y = nearestRoad(y);
      const drop = makePickup(x, y, 'cash', 150);
      drop.mission = true;
      world.pickups.push(drop);
    }
    missions.toast = 'Rico: Six drops stashed around town. Collect them all.';
  } else if (mission.id === 'score') {
    setTarget(missions, world, places.bank);
    missions.toast = 'Rico: The Big Score. The bank. Then the dock. No mistakes.';
  }
  missions.toastTimer = 5;
}

/**
 * Advance the active mission one step. Returns 'done' when it completes,
 * 'failed' when a timed job runs out (it restarts), or '' otherwise.
 */
export function updateMissions(missions, world, dt) {
  if (missions.toastTimer > 0) missions.toastTimer -= dt;
  const mission = currentMission(missions);
  if (!mission || !missions.active) return '';
  if (mission.id === 'wheels') {
    if (world.player.inCar && near(world, missions.target, 110)) return 'done';
  } else if (mission.id === 'courier') {
    missions.timer -= dt;
    if (near(world, missions.target, 100)) return 'done';
    if (missions.timer <= 0) return 'failed';
  } else if (mission.id === 'heat') {
    if (near(world, missions.target, 110)) {
      world.wanted = 0;
      return 'done';
    }
  } else if (mission.id === 'payday') {
    if (missions.dropsLeft <= 0) return 'done';
  } else if (mission.id === 'score') {
    if (missions.phase === 0) {
      if (near(world, missions.target, 100)) {
        missions.phase = 1;
        world.wanted = 3;
        setTarget(missions, world, world.city.places.dock);
        missions.toast = 'Bag grabbed! Three stars! Get to the South Dock!';
        missions.toastTimer = 5;
      }
    } else if (near(world, missions.target, 110)) {
      world.wanted = 0;
      return 'done';
    }
  }
  return '';
}

/** Pay the reward, close the mission and open the next one. */
export function completeMission(missions, world) {
  const mission = currentMission(missions);
  if (!mission) return 0;
  world.player.money += mission.reward;
  missions.index += 1;
  missions.active = false;
  missions.target = null;
  if (missions.index >= MISSIONS.length) missions.done = true;
  return mission.reward;
}

/** Restart the current mission after a failure (timer ran out). */
export function restartMission(missions, world) {
  missions.active = false;
  missions.target = null;
  world.pickups = world.pickups.filter((p) => p.kind !== 'cash' || p.mission !== true);
  startMission(missions, world);
}
