// The renderer: a top-down camera over Vice Point, painted on one canvas.
// Roads, buildings, parks, cars, pedestrians, police, particles and pickups,
// then the HUD (wanted stars, money, health, mission, minimap, speed) and the
// screens (title, pause, busted, wasted, story complete). All art is drawn
// shapes — no image files, no network.
import { MINIMAP, ROAD_GAP, ROAD_HALF, VIEW_H, VIEW_W, WORLD } from './config.js';
import { missionObjective, missionTarget } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_COMPLETE = 'complete';

/** Camera top-left so the player stays centred, clamped to the world. */
export function cameraFor(world, viewW, viewH) {
  return {
    x: Math.max(0, Math.min(WORLD - viewW, world.player.x - viewW / 2)),
    y: Math.max(0, Math.min(WORLD - viewH, world.player.y - viewH / 2)),
  };
}

function drawCar(ctx, car, isPlayer) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const len = 54;
  const wid = 26;
  // Wheels.
  ctx.fillStyle = '#16181c';
  ctx.fillRect(-len / 2 + 4, -wid / 2 - 3, 12, 5);
  ctx.fillRect(len / 2 - 16, -wid / 2 - 3, 12, 5);
  ctx.fillRect(-len / 2 + 4, wid / 2 - 2, 12, 5);
  ctx.fillRect(len / 2 - 16, wid / 2 - 2, 12, 5);
  // Body.
  ctx.fillStyle = car.color;
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 8);
  ctx.fill();
  // Windshield and roof.
  ctx.fillStyle = 'rgba(20, 30, 46, 0.85)';
  ctx.fillRect(len / 2 - 20, -wid / 2 + 4, 8, wid - 8);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(-8, -wid / 2 + 4, 16, wid - 8);
  // Headlights.
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(len / 2 - 2, -wid / 2 + 3, 3, 5);
  ctx.fillRect(len / 2 - 2, wid / 2 - 8, 3, 5);
  if (car.kind === 'police') {
    // Black-and-white cruiser with a flashing light bar.
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(-len / 2 + 2, -wid / 2 + 3, len - 4, 6);
    const flashing = Math.sin(car.flash * 9) > 0;
    ctx.fillStyle = flashing ? '#ff2e2e' : '#2e6bff';
    ctx.fillRect(-6, -wid / 2 - 2, 6, 5);
    ctx.fillStyle = flashing ? '#2e6bff' : '#ff2e2e';
    ctx.fillRect(0, -wid / 2 - 2, 6, 5);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VPPD', 0, 4);
  }
  if (isPlayer) {
    ctx.strokeStyle = '#ffd23c';
    ctx.lineWidth = 2.5;
    roundRect(ctx, -len / 2 - 3, -wid / 2 - 3, len + 6, wid + 6, 10);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCity(ctx, city, camera, viewW, viewH, night) {
  const x0 = camera.x;
  const y0 = camera.y;
  const x1 = camera.x + viewW;
  const y1 = camera.y + viewH;
  // Ground.
  ctx.fillStyle = night ? '#5c7a48' : '#79a75c';
  ctx.fillRect(x0, y0, viewW, viewH);
  // Parks.
  for (const park of city.parks) {
    if (park.x > x1 || park.x + park.w < x0 || park.y > y1 || park.y + park.h < y0) continue;
    ctx.fillStyle = night ? '#4a6a3e' : '#5f9e4e';
    ctx.fillRect(park.x, park.y, park.w, park.h);
    ctx.fillStyle = '#5a9ec8';
    ctx.beginPath();
    ctx.ellipse(park.x + park.w * 0.68, park.y + park.h * 0.62, 34, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const tree of park.trees) {
      ctx.fillStyle = '#2f6b2a';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f8a35';
      ctx.beginPath();
      ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Yard bushes and trees, tucked between the buildings.
  for (const yard of city.yards) {
    if (yard.x < x0 || yard.x > x1 || yard.y < y0 || yard.y > y1) continue;
    ctx.fillStyle = yard.tree ? '#2f6b2a' : '#4a7a3e';
    ctx.beginPath();
    ctx.arc(yard.x, yard.y, yard.r, 0, Math.PI * 2);
    ctx.fill();
    if (yard.tree) {
      ctx.fillStyle = '#3f8a35';
      ctx.beginPath();
      ctx.arc(yard.x - 3, yard.y - 3, yard.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Parking lots: asphalt with painted bays, so parked cars sit on tarmac.
  for (const lot of city.lots) {
    if (lot.x > x1 || lot.x + lot.w < x0 || lot.y > y1 || lot.y + lot.h < y0) continue;
    ctx.fillStyle = night ? '#33363e' : '#4a4f5a';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 6; i += 1) {
      ctx.fillRect(lot.x + 14 + i * 40, lot.y + 8, 2, 22);
      ctx.fillRect(lot.x + 14 + i * 40, lot.y + lot.h - 30, 2, 22);
    }
  }
  // Roads: asphalt bands with dashed centrelines, plus pale sidewalks.
  ctx.fillStyle = night ? '#2e323c' : '#3a3f4a';
  for (const road of city.roads) {
    if (road.horizontal) {
      if (road.at < y0 - ROAD_HALF || road.at > y1 + ROAD_HALF) continue;
      ctx.fillRect(x0, road.at - ROAD_HALF, viewW, ROAD_HALF * 2);
      ctx.fillStyle = night ? '#8a8a7a' : '#b8b0a0';
      ctx.fillRect(x0, road.at - ROAD_HALF - 6, viewW, 6);
      ctx.fillRect(x0, road.at + ROAD_HALF, viewW, 6);
      ctx.fillStyle = night ? '#2e323c' : '#3a3f4a';
    } else {
      if (road.at < x0 - ROAD_HALF || road.at > x1 + ROAD_HALF) continue;
      ctx.fillRect(road.at - ROAD_HALF, y0, ROAD_HALF * 2, viewH);
      ctx.fillStyle = night ? '#8a8a7a' : '#b8b0a0';
      ctx.fillRect(road.at - ROAD_HALF - 6, y0, 6, viewH);
      ctx.fillRect(road.at + ROAD_HALF, y0, 6, viewH);
      ctx.fillStyle = night ? '#2e323c' : '#3a3f4a';
    }
  }
  // Centre dashes.
  ctx.fillStyle = '#d8c25a';
  for (let at = ROAD_HALF; at < WORLD; at += ROAD_GAP) {
    if (at > y0 - 20 && at < y1 + 20) {
      for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44) ctx.fillRect(x, at - 2, 24, 4);
    }
    if (at > x0 - 20 && at < x1 + 20) {
      for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) ctx.fillRect(at - 2, y, 4, 24);
    }
  }
  // Zebra crossings at every intersection: white stripes across each road.
  ctx.fillStyle = night ? '#9a9a8a' : '#e8e8e8';
  for (let ay = ROAD_HALF; ay < WORLD; ay += ROAD_GAP) {
    for (let ax = ROAD_HALF; ax < WORLD; ax += ROAD_GAP) {
      if (ax < x0 - 60 || ax > x1 + 60 || ay < y0 - 60 || ay > y1 + 60) continue;
      for (let i = -3; i <= 3; i += 1) {
        ctx.fillRect(ax + i * 10 - 3, ay - ROAD_HALF + 2, 6, 12);
        ctx.fillRect(ax + i * 10 - 3, ay + ROAD_HALF - 14, 6, 12);
        ctx.fillRect(ax - ROAD_HALF + 2, ay + i * 10 - 3, 12, 6);
        ctx.fillRect(ax + ROAD_HALF - 14, ay + i * 10 - 3, 12, 6);
      }
    }
  }
  // Buildings: coloured block, darker roof edge, lit windows.
  for (const b of city.buildings) {
    if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x, b.y, b.w, 8);
    ctx.fillRect(b.x, b.y, 8, b.h);
    // A soft shadow on the south face, so the block reads as a volume.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(b.x, b.y + b.h - 6, b.w, 6);
    ctx.fillRect(b.x + b.w - 6, b.y, 6, b.h);
    ctx.fillStyle = night ? '#ffe9a8' : 'rgba(30, 40, 60, 0.55)';
    const cols = Math.max(1, Math.floor(b.w / 26));
    const rows = Math.max(1, Math.floor(b.h / 26));
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        if ((c * 7 + r * 13 + b.floors) % 3 === 0) continue;
        ctx.fillRect(b.x + 12 + c * 26, b.y + 14 + r * 26, 12, 14);
      }
    }
  }
  // Street lamps.
  ctx.fillStyle = night ? '#ffe9a8' : '#5a5a5a';
  for (const lamp of city.lamps) {
    if (lamp.x < x0 || lamp.x > x1 || lamp.y < y0 || lamp.y > y1) continue;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMinimap(ctx, world, camera) {
  const size = MINIMAP;
  const x0 = VIEW_W - size - 14;
  const y0 = VIEW_H - size - 14;
  const scale = size / WORLD;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  roundRect(ctx, x0 - 4, y0 - 4, size + 8, size + 8, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  ctx.fillStyle = '#3f6b34';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = '#c8c8c8';
  ctx.lineWidth = 2;
  for (let at = ROAD_HALF; at < WORLD; at += ROAD_GAP) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + at * scale);
    ctx.lineTo(x0 + size, y0 + at * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + at * scale, y0);
    ctx.lineTo(x0 + at * scale, y0 + size);
    ctx.stroke();
  }
  ctx.fillStyle = '#8a8a8a';
  for (const b of world.city.buildings) ctx.fillRect(x0 + b.x * scale, y0 + b.y * scale, Math.max(2, b.w * scale), Math.max(2, b.h * scale));
  const target = missionTarget(world.missions);
  if (target) {
    ctx.fillStyle = '#ffd23c';
    ctx.beginPath();
    ctx.arc(x0 + target.x * scale, y0 + target.y * scale, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ff2e2e';
  for (const cop of world.police) {
    ctx.beginPath();
    ctx.arc(x0 + cop.x * scale, y0 + cop.y * scale, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x0 + world.player.x * scale, y0 + world.player.y * scale, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd23c';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx, world) {
  const player = world.player;
  // Wanted stars, top left.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 26px sans-serif';
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i < world.wanted ? '#ffd23c' : 'rgba(255,255,255,0.28)';
    ctx.fillText('★', 16 + i * 30, 12);
  }
  if (world.wanted > 0) {
    // Its own row below the stars: at y=44 the star glyphs' lower points
    // touched the top of the letters.
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ff5a5a';
    ctx.fillText('WANTED', 16, 52);
  }
  // Money and health, top right.
  ctx.textAlign = 'right';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#2ed573';
  ctx.fillText(`$${player.money.toLocaleString('en-US')}`, VIEW_W - 16, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(VIEW_W - 216, 44, 200, 14);
  ctx.fillStyle = player.health > 30 ? '#2ed573' : '#ff5a5a';
  ctx.fillRect(VIEW_W - 216, 44, 200 * (player.health / 100), 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(VIEW_W - 216, 44, 200, 14);
  // Mission objective, bottom left.
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const objective = missionObjective(world.missions);
  const width = ctx.measureText(objective).width + 20;
  ctx.fillRect(12, VIEW_H - 58, width, 26);
  ctx.fillStyle = '#ffd23c';
  ctx.fillText(objective, 22, VIEW_H - 51);
  const target = missionTarget(world.missions);
  if (target) {
    const dist = Math.round(Math.hypot(target.x - player.x, target.y - player.y));
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${target.label} — ${dist}m`, 22, VIEW_H - 26);
  }
  // Speed while driving, above the minimap.
  if (player.inCar) {
    ctx.textAlign = 'right';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#ffffff';
    const mph = Math.round(Math.abs(player.inCar.speed) * 0.14);
    ctx.fillText(`${mph} mph`, VIEW_W - 16, VIEW_H - MINIMAP - 52);
  }
  // Toast messages (Rico, events), top centre.
  if (world.messageTimer > 0 && world.message) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px sans-serif';
    const w = ctx.measureText(world.message).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(VIEW_W / 2 - w / 2, 12, w, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(world.message, VIEW_W / 2, 20);
  }
  drawMinimap(ctx, world);
}

function drawMissionMarker(ctx, world, camera) {
  const target = missionTarget(world.missions);
  if (!target) return;
  const pulse = 0.6 + 0.4 * Math.sin(world.time * 4);
  const sx = target.x - camera.x;
  const sy = target.y - camera.y;
  if (sx > -40 && sx < VIEW_W + 40 && sy > -40 && sy < VIEW_H + 40) {
    // Beacon on the spot: a pulsing diamond and a light pillar.
    ctx.save();
    ctx.globalAlpha = 0.25 * pulse;
    ctx.fillStyle = '#ffd23c';
    ctx.fillRect(sx - 3, sy - 260, 6, 260);
    ctx.globalAlpha = 1;
    ctx.translate(sx, sy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd23c';
    ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-12, -12, 24, 24);
    ctx.restore();
    return;
  }
  // Off-screen: an arrow on the screen edge pointing at it.
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const angle = Math.atan2(sy - cy, sx - cx);
  const ex = cx + Math.cos(angle) * (VIEW_W / 2 - 50);
  const ey = cy + Math.sin(angle) * (VIEW_H / 2 - 50);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffd23c';
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -11);
  ctx.lineTo(-10, 11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawScreen(ctx, world, screen, best, hasSave) {
  ctx.save();
  if (screen === SCREEN_TITLE) {
    ctx.fillStyle = 'rgba(8, 12, 24, 0.42)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold 84px sans-serif';
    ctx.fillText('VICE POINT', VIEW_W / 2, 150);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('An open-world crime story — walk it, drive it, own it.', VIEW_W / 2, 240);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText('WASD / Arrows — move & drive      E — steal / exit car', VIEW_W / 2, 306);
    // Controls on two lines: on one line the four items crowd together and
    // the "P" of pause reads as touching the end of "shoot" at a glance.
    ctx.fillText('F — punch      Mouse — shoot', VIEW_W / 2, 336);
    ctx.fillText('P — pause      M — mute', VIEW_W / 2, 366);
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold 26px sans-serif';
    const blink = Math.sin(world.time * 4) > -0.2;
    if (blink) ctx.fillText(hasSave ? 'Press ENTER to play — or C to continue your story' : 'Press ENTER to start', VIEW_W / 2, 420);
    if (best > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px sans-serif';
      ctx.fillText(`Best fortune: $${best.toLocaleString('en-US')}`, VIEW_W / 2, 470);
    }
    ctx.font = '13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Five jobs from Rico. Steal cars, lose the heat, take the Big Score.', VIEW_W / 2, 520);
  } else if (screen === SCREEN_PAUSED) {
    ctx.fillStyle = 'rgba(8, 12, 24, 0.65)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('PAUSED', VIEW_W / 2, 320);
    ctx.font = '18px sans-serif';
    ctx.fillText('Press P or ENTER to keep playing', VIEW_W / 2, 380);
  } else if (screen === SCREEN_BUSTED) {
    ctx.fillStyle = 'rgba(20, 8, 12, 0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5a5a';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText('BUSTED', VIEW_W / 2, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.fillText('The Vice Point police took you in. Your story continues.', VIEW_W / 2, 360);
    ctx.fillText('Press ENTER to get back out there', VIEW_W / 2, 396);
  } else if (screen === SCREEN_WASTED) {
    ctx.fillStyle = 'rgba(20, 8, 8, 0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5a5a';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText('WASTED', VIEW_W / 2, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.fillText('Vice Point is unforgiving. Press ENTER to try again.', VIEW_W / 2, 360);
  } else if (screen === SCREEN_COMPLETE) {
    ctx.fillStyle = 'rgba(8, 18, 10, 0.72)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2ed573';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('THE BIG SCORE', VIEW_W / 2, 280);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('You own Vice Point now.', VIEW_W / 2, 340);
    ctx.font = '18px sans-serif';
    ctx.fillText(`Fortune: $${world.player.money.toLocaleString('en-US')} — ${world.stats.missionsDone} jobs done, ${world.stats.carsStolen} cars stolen`, VIEW_W / 2, 390);
    ctx.fillText('Press ENTER to keep roaming the city', VIEW_W / 2, 430);
  }
  ctx.restore();
}

export function createRenderer(canvas) {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d');

  function draw(world, screen, best, hasSave) {
    const camera = cameraFor(world, VIEW_W, VIEW_H);
    const night = world.dayTime > 0.62 || world.dayTime < 0.08;
    const dusk = world.dayTime >= 0.45 && world.dayTime <= 0.62;
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawCity(ctx, world.city, camera, VIEW_W, VIEW_H, night);
    // Pickups.
    for (const pickup of world.pickups) {
      const bob = Math.sin(pickup.bob) * 3;
      ctx.fillStyle = pickup.kind === 'cash' ? '#2ed573' : '#ff6b81';
      ctx.beginPath();
      ctx.arc(pickup.x, pickup.y + bob, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pickup.kind === 'cash' ? '$' : '+', pickup.x, pickup.y + bob + 1);
    }
    // Cars (parked, traffic, player car) then police, then pedestrians.
    for (const car of world.cars) drawCar(ctx, car, car === world.player.inCar);
    for (const cop of world.police) drawCar(ctx, cop, false);
    for (const ped of world.peds) {
      ctx.fillStyle = ped.shirt;
      ctx.beginPath();
      ctx.arc(ped.x, ped.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ped.skin;
      ctx.beginPath();
      ctx.arc(ped.x, ped.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      if (ped.panic) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', ped.x, ped.y - 16);
      }
    }
    // The player on foot: a bright jacket, easy to spot in the crowd.
    const player = world.player;
    if (!player.inCar) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.facing);
      ctx.fillStyle = '#ffd23c';
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.beginPath();
      ctx.arc(6, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(10, -3, 10, 6);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Bullets.
    ctx.fillStyle = '#ffd23c';
    for (const bullet of world.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Particles.
    for (const particle of world.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // The mission marker is screen space (an on-screen beacon or an edge
    // arrow), so it is drawn after the world transform is undone.
    drawMissionMarker(ctx, world, camera);
    // Day/night tint over everything.
    if (night) {
      ctx.fillStyle = 'rgba(8, 14, 48, 0.42)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else if (dusk) {
      ctx.fillStyle = 'rgba(255, 120, 40, 0.10)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (screen === SCREEN_PLAY) drawHud(ctx, world);
    else drawScreen(ctx, world, screen, best, hasSave);
  }

  return { draw };
}
