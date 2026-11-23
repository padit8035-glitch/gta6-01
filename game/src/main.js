// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between six screens: title,
// play, paused, busted, wasted and story complete. Progress saves to
// localStorage on every mission and on pause, so Continue picks the story up.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createAudio } from './audio.js';
import { createInput, ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_COMPLETE, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED, cameraFor } from './render.js';
import { createWorld, EVENT_BUSTED, EVENT_MISSION_DONE, EVENT_WASTED, resetWorld, stepWorld } from './world.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261123;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();
const world = createWorld(seed, audio);
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save.money !== 'number' || typeof save.missionIndex !== 'number') return null;
    return save;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: world.player.money,
      missionIndex: world.missions.index,
      missionsDone: world.stats.missionsDone,
      carsStolen: world.stats.carsStolen,
      earned: world.stats.earned,
      x: world.player.x,
      y: world.player.y,
      savedAt: Date.now(),
    }));
  } catch {
    // Storage can be off: the game still plays, it just does not save.
  }
}

function applySave(save) {
  world.player.money = save.money;
  world.missions.index = save.missionIndex;
  world.stats.missionsDone = save.missionsDone || 0;
  world.stats.carsStolen = save.carsStolen || 0;
  world.stats.earned = save.earned || 0;
  if (typeof save.x === 'number' && typeof save.y === 'number') {
    world.player.x = save.x;
    world.player.y = save.y;
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  const best = readBest();
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, best, false);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let hasSave = readSave() !== null;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  // A read-only handle for automated play-tests (and nothing else): the live
  // world and the current screen, so a test can watch the game it is playing.
  window.__vicepoint = {
    get world() {
      return world;
    },
    get screen() {
      return screen;
    },
  };

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    if (fresh) {
      resetWorld(world);
      world.player.money = 250;
    } else {
      const save = readSave();
      resetWorld(world);
      if (save) applySave(save);
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing Vice Point. Follow Rico’s jobs.');
  }

  function endRun(over) {
    if (world.player.money > best) {
      best = world.player.money;
      saveBest(best);
    }
    writeSave();
    screen = over === 'busted' ? SCREEN_BUSTED : SCREEN_WASTED;
    announce(over === 'busted' ? 'Busted. The police took you in.' : 'Wasted. Vice Point is unforgiving.');
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) audio.toggleMute();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame(true);
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        writeSave();
        announce('Paused. Progress saved.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      if (actions & ACTION_CONFIRM) startGame(true);
    } else if (screen === SCREEN_COMPLETE) {
      if (actions & ACTION_CONFIRM) {
        screen = SCREEN_PLAY;
        announce('Back on the streets of Vice Point.');
      }
    }
    if (input.takeClick() && screen === SCREEN_TITLE) startGame(true);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    // One take of the one-shot presses per frame: the first step of the frame
    // gets them, later steps get none, so a press never fires twice.
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_PLAY) {
      const camera = cameraFor(world, canvas.width, canvas.height);
      const mouse = input.mouse();
      const aim = { x: camera.x + mouse.x, y: camera.y + mouse.y };
      let stepActions = actions;
      while (accumulator >= STEP) {
        const snapshot = {
          move: input.move(),
          actions: stepActions,
          shooting: input.shooting(),
          aim,
        };
        stepActions = 0;
        const events = stepWorld(world, snapshot, STEP);
        accumulator -= STEP;
        if (events & EVENT_MISSION_DONE) {
          writeSave();
          if (world.missions.done) {
            screen = SCREEN_COMPLETE;
            if (world.player.money > best) {
              best = world.player.money;
              saveBest(best);
            }
            announce('Story complete. You own Vice Point.');
            break;
          }
        }
        if (events & EVENT_BUSTED) {
          endRun('busted');
          break;
        }
        if (events & EVENT_WASTED) {
          endRun('wasted');
          break;
        }
        if (world.over === 'busted' || world.over === 'wasted') {
          endRun(world.over);
          break;
        }
      }
      saveTimer += 1;
      if (saveTimer >= 600) {
        saveTimer = 0;
        writeSave();
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world, screen, best, hasSave);
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      writeSave();
      announce('Paused.');
    }
  });

  // The C key continues a saved story from the title screen.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC' && screen === SCREEN_TITLE && hasSave) startGame(false);
  });

  announce('Vice Point. Press Enter to start, or C to continue your story.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
