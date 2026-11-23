// Vice Point, the city. A road grid over a square world: every ROAD_GAP pixels a
// road runs across the map, the blocks between them hold buildings, parks and
// parking lots. Everything is fixed by the seed, so the same seed always builds
// the same city. Collision is AABB against building rectangles only — roads and
// sidewalks are always open ground.
import { BLOCK, ROAD_GAP, ROAD_HALF, WORLD } from './config.js';

const BUILDING_COLORS = [
  '#c98f5f', '#b98a6d', '#8fa3b8', '#a8b08a', '#c2a878', '#9a8fb0',
  '#d0b090', '#7fa0a8', '#b0705a', '#8a9a7a', '#c8a0a0', '#a0b0c8',
];
const ROOF_COLORS = ['#7a6a58', '#6a7a8a', '#8a7a6a', '#5a6a7a', '#9a8a7a'];
const PARK_TREES = 14;

/**
 * Build the city for `seed`: roads, blocks, buildings, parks, parking spots and
 * the named places the missions point at.
 */
export function createCity(random) {
  const roads = [];
  for (let at = ROAD_HALF; at < WORLD; at += ROAD_GAP) {
    roads.push({ at, horizontal: true });
    roads.push({ at, horizontal: false });
  }
  const buildings = [];
  const parks = [];
  const parking = [];
  const lamps = [];
  const yards = [];
  const lots = [];
  let blockIndex = 0;
  for (let by = ROAD_HALF; by + BLOCK <= WORLD; by += ROAD_GAP) {
    for (let bx = ROAD_HALF; bx + BLOCK <= WORLD; bx += ROAD_GAP) {
      blockIndex += 1;
      const roll = random.next();
      if (roll < 0.16) {
        // A park: grass, trees, a pond, no buildings.
        const trees = [];
        for (let i = 0; i < PARK_TREES; i += 1) {
          trees.push({ x: bx + random.range(40, BLOCK - 40), y: by + random.range(40, BLOCK - 40), r: random.range(9, 15) });
        }
        parks.push({ x: bx, y: by, w: BLOCK, h: BLOCK, trees });
        continue;
      }
      if (roll < 0.26) {
        // A parking lot: painted bays along the edges, a few parked cars later.
        lots.push({ x: bx, y: by, w: BLOCK, h: BLOCK });
        for (let i = 0; i < 6; i += 1) {
          parking.push({ x: bx + 40 + i * 40, y: by + 40, angle: 0 });
          parking.push({ x: bx + 40 + i * 40, y: by + BLOCK - 40, angle: Math.PI });
        }
        continue;
      }
      // One or two buildings per block, with a yard between them. Buildings
      // start 34 px in from the block edge, so no wall ever stands on a road.
      const split = random.chance(0.72);
      const blockBuildings = [{
        x: bx + random.range(34, 60),
        y: by + random.range(34, 60),
        w: random.range(90, split ? 120 : 190),
        h: random.range(80, split ? 120 : 170),
        color: random.pick(BUILDING_COLORS),
        roof: random.pick(ROOF_COLORS),
        floors: random.int(2, 9),
      }];
      if (split) {
        blockBuildings.push({
          x: bx + BLOCK - random.range(100, 140),
          y: by + BLOCK - random.range(90, 130),
          w: random.range(80, 120),
          h: random.range(70, 110),
          color: random.pick(BUILDING_COLORS),
          roof: random.pick(ROOF_COLORS),
          floors: random.int(1, 6),
        });
      }
      for (const b of blockBuildings) buildings.push(b);
      // Bushes and small trees in the yard, clear of every building.
      for (let i = 0; i < 6; i += 1) {
        const px = bx + random.range(34, BLOCK - 14);
        const py = by + random.range(34, BLOCK - 14);
        let clear = true;
        for (const b of blockBuildings) {
          if (px > b.x - 10 && px < b.x + b.w + 10 && py > b.y - 10 && py < b.y + b.h + 10) {
            clear = false;
            break;
          }
        }
        if (clear) yards.push({ x: px, y: py, r: random.range(6, 14), tree: random.chance(0.4) });
      }
      // Street lamps at the block corners.
      lamps.push({ x: bx - 6, y: by - 6 });
      lamps.push({ x: bx + BLOCK + 6, y: by - 6 });
    }
  }
  // Mission places sit ON roads, so a car can drive right up to every one:
  // a target inside a block would be unreachable from a car.
  const places = {
    garage: { x: 354, y: 120, label: 'Rico’s Garage' },
    bank: { x: 2274, y: 200, label: 'Vice Point Bank' },
    dock: { x: 2274, y: 2360, label: 'South Dock' },
    hideout: { x: 220, y: 354, label: 'Hideout' },
    market: { x: 1314, y: 1440, label: 'Palm Market' },
  };
  return { roads, buildings, parks, parking, lamps, yards, lots, places, blockCount: blockIndex };
}

/** True when (x, y) is on a road (inside a road band, either direction). */
export function isRoad(x, y) {
  const mx = ((x % ROAD_GAP) + ROAD_GAP) % ROAD_GAP;
  const my = ((y % ROAD_GAP) + ROAD_GAP) % ROAD_GAP;
  return mx < ROAD_HALF * 2 || my < ROAD_HALF * 2;
}

/** True when (x, y) is inside the road band for a horizontal road at `at`. */
export function onHorizontalRoad(x, y) {
  return Math.abs(y - nearestRoad(y)) <= ROAD_HALF;
}

/** True when (x, y) is inside the road band for a vertical road at `at`. */
export function onVerticalRoad(x, y) {
  return Math.abs(x - nearestRoad(x)) <= ROAD_HALF;
}

/** The centre line of the nearest road to a coordinate. */
export function nearestRoad(value) {
  return Math.round((value - ROAD_HALF) / ROAD_GAP) * ROAD_GAP + ROAD_HALF;
}

/**
 * Push a circle (x, y, radius) out of every building it overlaps. Returns true
 * when any push happened, so callers can tell a crash from a slide.
 */
export function collideBuildings(city, circle) {
  let hit = false;
  for (let i = 0; i < city.buildings.length; i += 1) {
    const b = city.buildings[i];
    const closestX = Math.max(b.x, Math.min(circle.x, b.x + b.w));
    const closestY = Math.max(b.y, Math.min(circle.y, b.y + b.h));
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= circle.r * circle.r) continue;
    hit = true;
    if (distSq === 0) {
      circle.x += circle.r;
      continue;
    }
    const dist = Math.sqrt(distSq);
    const push = (circle.r - dist) / dist;
    circle.x += dx * push;
    circle.y += dy * push;
  }
  return hit;
}

/** Clamp a point inside the world, keeping `margin` from the edge. */
export function clampToWorld(point, margin) {
  point.x = Math.max(margin, Math.min(WORLD - margin, point.x));
  point.y = Math.max(margin, Math.min(WORLD - margin, point.y));
}
