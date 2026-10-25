# Asteroid Fleet

A browser idle game with an autobattler setup, in full 3D. You are the admiral, not the pilot: outfit a mining carrier's hangars, set stances and rules, and warp outward into richer, more dangerous systems while the fleet works on its own. See [asteroid-fleet-game-concept.md](asteroid-fleet-game-concept.md) for the design.

## Run it

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # simulation tests
npm run build     # typecheck + production build into dist/
npm run balance   # 2-hour headless economy run, prints income every 10 min
```

## What is in this first playable slice

| Concept area | Status |
| --- | --- |
| Logistics chain drone → barge → hauler → carrier refinery | Playable. Barges park at rich clusters as depots; the Carrier tab shows the throughput links and the current bottleneck. |
| Hangars as the board | Slot sizes (drone 1, fighter/hauler 2, harvester 3, barge 4), drag-and-drop between slots, launch order per hangar, launch bay / dry dock / cargo bay types, repair-drone adjacency synergy. |
| Stances | Fleet → ship type → hangar scopes, most specific wins. Engagement (aggressive, defensive, escort, passive), under fire (stand, retreat at X % hull, unload first), mining (greedy, safe). |
| Rules | Fixed rule cards with on/off and a parameter: fighters escort on wave, barge calls hauler above X %, barge falls back, drones unload at barges beyond X, haulers park, recall on low shields, keep warp energy in reserve. |
| Zones | 10 systems across starter, frontier and deep space, two with gas giants. Pirate waves scale with distance and cargo heat; debris and radiation hazards; solar storms. |
| Carrier | One energy pool (solar, later fusion from H2) feeding refinery, shields, warp and drift; power modes; sublight "follow richest cluster"; warp with charge time, automatic recall, and losses for ships left outside. |
| Prestige & research | RP = ⌊√(ore value delivered ÷ 10,000)⌋ × furthest tier. Hybrid tree: global branches plus one small branch per ship class, loss-buffer reserves. |
| Offline | Settled from timestamps at 50 % of the recent income, no pirate waves, reserves keep rebuilding. |
| Save | IndexedDB with localStorage fallback, text export/import from the ☰ menu. |
| Rendering | React Three Fiber, one instanced mesh per ship class, instanced asteroids, line-segment beams, bloom, nebula skybox, tactical sensor view (toggle or zoom far out), low-quality mode. |

## Choices made for the open questions

1. **Energy at zero**: shields stop regenerating and refining stops, but the carrier is never stranded because solar keeps trickling in.
2. **H2**: fusion fuel only, not direct warp fuel.
3. **Reserves offline**: reserve ships keep rebuilding on their cooldown while you are away.
4. **Rule depth**: fixed rule cards with one parameter each, as a first step before building blocks.

## Layout

- `src/sim/`: deterministic simulation (seeded RNG, fixed 10 Hz tick), pure TypeScript with no React or three.js. `step()` in `tick.ts` is the whole game loop; `actions.ts` holds every player command.
- `src/game/`: the engine that runs ticks outside React and interpolates positions for the renderer, plus save/load.
- `src/render/`: the 3D scene.
- `src/ui/`: HTML/React panels over the canvas.

The simulation currently runs on the main thread; it is self-contained so it can move into a Web Worker later. Not yet built: ship modules, scouts revealing hazards, short expeditions, async PvP, glTF models.

The engine is exposed as `__fleet` in the browser console for debugging and balancing.
