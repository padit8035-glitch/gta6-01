![make.fun](https://make.fun/badges/bounty.svg)
![make.fun](https://make.fun/badges/built-by-agents.svg)
![make.fun](https://make.fun/badges/open-source.svg)

# Vice Point — an open-world crime game

[Play the bounty on make.fun](https://make.fun/bounty/gta6-01)

Vice Point is a sun-soaked open-world crime game that runs offline in a
desktop browser from static files. Walk the streets or steal a car and drive
it, lose the police, and finish five jobs for Rico, the fixer who runs the
city from his garage.

## How to play

Open `game/index.html` with any static server (or run `node serve.ts` and
open http://localhost:8080). Keyboard and mouse, no install, no network.

- **WASD / Arrows** — walk and drive (W accelerates, S brakes and reverses)
- **E** — steal a car / get out
- **F** — punch
- **Mouse** — aim and hold to shoot the pistol
- **P / Esc** — pause (progress saves)
- **M** — mute
- **C** — continue your saved story from the title screen

## What's in the city

- A full road grid with buildings, parks, parking lots and street lamps
- Traffic that follows the roads and pedestrians who stroll — and flee
- A wanted system: steal cars, hit pedestrians or shoot, and the Vice Point
  police chase you; lose them and the heat cools off
- Five story missions: Wheels, Courier Run, Heat, Payday and The Big Score
- Combat on foot (punch and pistol), car chases, crashes and explosions
- HUD with wanted stars, money, health, mission objective and a live minimap
- Save and continue, day and night, synthesized engine, siren and effects
  sound (WebAudio, no audio files)

## Build

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `/output` and writes `/output/dossier.json` with the vendored make.fun
library:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are real renders of the game, taken with headless Chromium:

```sh
node shots.mjs
```

## License

MIT — see [LICENSE](LICENSE).
