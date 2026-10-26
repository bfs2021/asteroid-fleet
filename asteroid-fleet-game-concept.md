# Asteroid Fleet – Game Concept

> A browser idle game with autobattler setup in full 3D: as the admiral, you outfit a mining carrier's hangars, set stances and doctrine, and warp the carrier into ever richer and more dangerous star systems while the fleet works on its own. The page covers the concept, decisions so far, comparable games, the tech plan, and what is still open.

## Contents

- [Core fantasy](#core-fantasy)
- [Decisions so far](#decisions-so-far)
- [Direction: the endless field](#direction-the-endless-field)
- [Core loop](#core-loop)
- [Logistics chain: drone → barge → carrier](#logistics-chain-drone--barge--carrier)
- [Hangars as the autobattler board](#hangars-as-the-autobattler-board)
- [Stances & Doctrine](#stances--doctrine)
- [Ship types](#ship-types-proposal)
- [Zones & Progression](#zones--progression)
- [Carrier Power](#carrier-power)
- [Prestige & Research](#prestige--research)
- [Meta progression](#meta-progression-incremental-layer)
- [The gap in the market](#the-gap-in-the-market)
- [Reference games](#reference-games)
- [Tech: 3D in the browser with React Three Fiber](#tech-3d-in-the-browser-with-react-three-fiber)
- [Late Game & Scaling (brainstorm)](#late-game--scaling-brainstorm)
- [Multiple Carriers (design draft)](#multiple-carriers-design-draft)
- [Open questions for Lars](#open-questions-for-lars)

## Core fantasy

> **Player fantasy: you are the admiral, not the pilot.**
> You command a mining carrier and set doctrine: what goes into each hangar, which stance each ship takes, and a few simple rules. Then the fleet runs on its own: drones swarm out, barges become floating depots, fighters keep pirates away, and the carrier warps outward into richer, more dangerous systems.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Direction | Open, near-endless field is the core |
| Intervention | No direct orders during play; the player sets doctrine like an admiral |
| Control levers | Hangar loadout, stances, and simple rules |
| Camera | Free 3D camera plus a tactical view, as a toggle or automatic zoom-out |
| Combat and progression | Safe starter systems; farther out, richer ores plus pirate waves and hazard zones |
| Carrier movement | Slow sublight repositioning within a system, warp jump between systems or zones |
| Warp back | The carrier can warp back to safer systems; ships outside the carrier at jump time are lost |
| Losses | Destroyed ships are gone for good; prestige upgrades can grant a minimum buffer per ship class that regenerates on a cooldown |
| Offline | Mostly safe: offline progress runs at reduced risk |
| Pirate scaling | Mostly by distance from the starter systems, plus a cargo-heat factor for ore held by the fleet and carrier |
| Carrier power | An energy pool for refinery, warp, and shields; recharges slowly from solar, later boosted by H2 fusion from gas giants |
| Prestige | A reset that pays a currency for a research tree: attribute and stat upgrades and/or per-ship-class upgrades |
| Prestige payout | One fixed, simple formula from ore value delivered and furthest zone reached |

## Direction: the endless field

| Direction | Role | Status |
| --- | --- | --- |
| Open, near-endless field (like Omen MiniMiner) | Core of the game | ✅ Chosen |
| Prestige with research tree | Long-term layer | ✅ Chosen |
| Short expeditions | Optional extra | Later |
| Asynchronous PvP raids | Possible later mode | Open |

Each star system is a persistent field that keeps refilling. The carrier works one system at a time and warps outward when the fleet is ready for richer ores and higher risk.

**Pros**

- Relaxed, runs in a tab or offline
- The fleet visibly grows into a big 3D swarm
- Fits idle and incremental habits

**Cons**

- Without player-shaped AI it gets frustrating, which is why stances and rules matter
- Needs depth from zones and hazards so it doesn't flatten out

## Core loop

```mermaid
flowchart LR
    setup["Set doctrine<br/>Hangars, stances, rules"]
    run["Fleet works the system<br/>autonomous, live or offline"]
    yield["Yield<br/>ore, salvage, losses"]
    upgrade["Upgrade<br/>ships, slots, next system"]
    setup --> run
    run --> yield
    yield --> upgrade
    upgrade -->|adjust doctrine| setup
```

The loop never resets on its own: you adjust doctrine whenever you like, and the fleet keeps working in between. There are no direct orders; the autobattler part is the setup.

## Logistics chain: drone → barge → carrier

```mermaid
flowchart LR
    ast(["Asteroid"])
    drone["Mining drone<br/>small load, fast"]
    barge["Mining barge<br/>mobile depot, compresses ore"]
    hauler["Hauler<br/>shuttles barge ↔ carrier"]
    carrier(["Carrier<br/>refinery, hangars"])
    pirate{"Pirates"}
    fighter["Fighter escort"]
    gas(["Gas giant"])
    harvester["Gas harvester<br/>suggestion: skims H2"]
    gas -->|H2| harvester
    harvester -->|fusion fuel| carrier
    ast -->|ore| drone
    drone -->|short hop| barge
    barge --> hauler
    hauler -->|long haul| carrier
    pirate -.->|attacks| barge
    fighter -.->|intercepts| pirate
```

Barges are the central idea. They move to rich clusters and take ore from the drones there, so drone trips stay short. Homeworld 2's Mobile Refinery and EVE Online's Orca and Rorqual work on the same principle.

$$
\text{Throughput} = \min(\text{mining rate},\ \text{drone transport},\ \text{barge capacity},\ \text{hauler transport},\ \text{refinery})
$$

The slowest link sets the income. That bottleneck puzzle is the optimization fun Factorio players know, at fleet scale.

- Barges are valuable, vulnerable targets: pirates go after full barges first, and all ore held out in the field raises cargo heat (see Pirate scaling).
- That gives fighters a clear job: escort barges instead of chasing anything in range.
- Rich clusters far out only pay off with a barge and an escort, a real risk-versus-reward call.
- A lost barge loses its cargo; a jettisoned container to salvage could be an upgrade.

## Hangars as the autobattler board

Hangar slots are the scarce resource everything revolves around, much like the board in The Bazaar. Each hangar has a fixed number of slots, neighbouring slots can trigger synergies, and each hangar has its own launch order.

| Mechanic | Example |
| --- | --- |
| Slot size | Drone 1 slot, fighter 2, barge 4 |
| Adjacency | Repair drone next to fighters: fighters heal when they dock |
| Hangar types | Launch bay (fast launch), dry dock (repairs), cargo bay (more storage) |
| Launch order | Fighters first, barge only once the zone is secured |
| Barge as mini-carrier | Big upgrade: a barge with its own drone slot |

## Stances & Doctrine

| Axis | Option | What it does automatically | Origin |
| --- | --- | --- | --- |
| Engagement | Aggressive | Chases any hostile in sensor range | Lars |
| Engagement | Defensive | Engages only hostiles attacking own ships or near the carrier | Lars |
| Engagement | Escort | Sticks to an assigned barge or hauler and attacks whatever attacks it | Lars |
| Engagement | Passive | Never engages, evades threats | Suggestion |
| Under fire | Stand ground | Keeps doing its job until destroyed | Lars |
| Under fire | Retreat at X % hull | Returns to the nearest hangar for repair below a threshold | Lars, threshold is a suggestion |
| Under fire | Retreat when cargo full | Miners and haulers unload first instead of risking the load | Suggestion |
| Mining | Greedy | Goes for the richest asteroids, even far out or in danger | Suggestion |
| Mining | Safe | Mines only inside escort or carrier cover | Suggestion |

Stances are the main control lever. Suggested scope, from broad to specific (the most specific wins):

1. Fleet-wide doctrine: the default for every ship, e.g. Defensive, Retreat at 30 % hull, Safe.
2. Per ship type: e.g. all fighters on Escort, all drones on Greedy.
3. Per hangar: overrides for one hangar's group, e.g. a strike hangar on Aggressive.

Stances set the default behaviour; rules are the exceptions. A rule fires on a condition and can switch a stance for a while, and it wins over the stance while it is active.

| Unit | When | Then |
| --- | --- | --- |
| All fighters | Pirate wave announced | Switch to Escort |
| Barge | Cargo above 80 % | Call a hauler |
| Barge | Pirate in range | Fall back to the carrier |
| Drone | Nearest asteroid farther than X | Unload at the nearest barge instead of the carrier |
| Hauler | No job | Park at the carrier |

## Ship types (proposal)

| Type | Role | Slots | Strength | Weakness |
| --- | --- | --- | --- | --- |
| Carrier | Base, refinery, hangars, warp drive | – | Heavy armor | Slow, barely armed |
| Mining drone | Mines ore | 1 | Cheap, numerous | Small load, fragile |
| Mining barge | Mobile depot, compresses | 4 | Shortens trips | Prime pirate target |
| Hauler | Barge ↔ carrier | 2 | Large cargo | Unarmed |
| Fighter | Escort, intercept | 2 | Fast, damage | Low endurance |
| Scout | Finds clusters and hazards | 1 | Reveals rich veins | Doesn't mine |
| Repair drone | Heals barges and fighters | 1 | Keeps the fleet alive | No yield |
| Gas harvester (suggestion) | Skims H2 from gas giants | 3 | Feeds fusion power | Slow, works far from cover |

Modules (laser, drill, tractor beam, shield, compressor) go into the ships, one or two module slots per type.

## Zones & Progression

```mermaid
flowchart LR
    starter["Starter systems<br/>cheap ores, no aggression"]
    frontier["Frontier<br/>better ores, pirate raids, hazards"]
    deep["Deep space<br/>rare ores, scaling waves, harsh hazards"]
    starter -->|warp jump| frontier
    frontier -->|warp jump| deep
```

| Zone | Ore value | Threats | Unlocks |
| --- | --- | --- | --- |
| Starter systems | Low, common ores | None | Drones, barges, haulers, first rules |
| Frontier | Medium | Occasional pirate raids, debris fields, solar storms | Fighters, engagement stances, repair drones |
| Deep space | High, rare ores | Scaling pirate waves, dangerous hazard zones | Advanced hangar types, deeper research |
| Gas giant systems | H2 instead of ore | Storms, pirates drawn to harvesters | Gas harvester, fusion reactor |

The three tiers and gas giants as an H2 source come from Lars; the specific threats and unlocks per zone are a proposal.

### Pirate scaling

- Distance: the main driver. The farther from the starter systems, the bigger and more frequent the waves.
- Cargo heat: ore held by barges, haulers, and the carrier raises the threat, which rewards hauling ore home and refining it quickly.
- Suggestion: refined goods or ore stored at a safe system count less, so greedy hoarding far out is a deliberate gamble.

### Carrier movement

| Movement | How it works | Origin |
| --- | --- | --- |
| Within a system | Slow sublight drift or repositioning toward richer clusters | Lars |
| Between systems or zones | Warp jump | Lars |
| Warp back | The carrier can jump back to safer systems | Lars |
| Ships outside at jump time | Lost | Lars |
| Jump cost | Energy from the carrier's power pool, plus a charge time before the jump | Energy: Lars; charge time: suggestion |
| Before a jump | An automatic recall during the charge time, so ships can dock before they are lost | Suggestion |
| Repositioning by doctrine | A carrier stance, e.g. follow the richest cluster or hold position | Suggestion |

The charge time is a vulnerable moment: in frontier and deep space a pirate wave during recall becomes a real test of the escort doctrine, and a panic jump costs every ship still outside.

## Carrier Power

The carrier runs on one energy pool. It recharges slowly from solar; the later goal is to harvest H2 from gas giants and burn it in fusion reactors for far more power.

| Side | Item | Origin |
| --- | --- | --- |
| Consumer | Refinery | Lars |
| Consumer | Warp drive | Lars |
| Consumer | Shields | Lars |
| Consumer | Hangar repair and relaunch | Suggestion |
| Consumer | Sublight drift | Suggestion |
| Source | Solar, slow; stronger near bright stars | Lars; star brightness is a suggestion |
| Source | Fusion reactor burning H2 from gas giants | Lars |
| Source | Reactor or capacitor upgrades in the research tree | Suggestion |

| Spend energy on | You gain | You give up |
| --- | --- | --- |
| Refining | Income, lower cargo heat | A slower warp charge, weaker shields |
| Shields | The carrier survives raids | Refining stalls, so cargo heat keeps rising |
| Warp | Reach richer systems or escape to safety | An empty pool on arrival: no shields, no refining for a while |

The trade-off table is a suggestion. The core tension: energy saved for an emergency jump is energy not spent on income or defence.

## Prestige & Research

A prestige resets the operation and pays out a research currency. Which parts reset and persist is a suggestion.

| Resets | Persists |
| --- | --- |
| Credits, ore, H2, and stored energy | Research currency and the research tree |
| Bought ships and modules | Unlocked ship classes and module blueprints |
| Bought hangar slots | Unlocked stances and rule conditions |
| Current system (back to a starter system) | Discovered systems as warp targets |

| Branch | Example upgrades |
| --- | --- |
| Logistics | Barge capacity, hauler speed, compression ratio |
| Mining | Mining yield, rare-ore chance, drone cargo |
| Combat | Fighter damage, armor, retreat repair speed |
| Carrier | Hangar slots, warp charge time, energy capacity and recharge, sublight speed |
| Reserves | Loss buffer per ship class: minimum size and rebuild cooldown |
| Per ship class | One small branch each for drone, barge, hauler, fighter, scout, repair drone |

All branch names and upgrades are suggestions.

| Model | Good | Risk |
| --- | --- | --- |
| Global tree only | Simple, every point helps the whole fleet | Little identity per ship class |
| Per-class upgrades only | Strong builds and specialisation | Points spread thin, weak early runs |
| ✅ **Hybrid (recommended)** | Global branches for basics, class branches for build identity | More UI and balancing |

Recommendation: the hybrid. The global branches carry the steady incremental growth, and the per-class branches feed into the hangar board, so a prestige can change which fleet composition is strongest.

### Loss buffer

Destroyed ships are gone for good. Prestige upgrades can grant a minimum buffer, for example per ship class: if the count drops below it, a replacement is rebuilt for free after a cooldown.

| Upgrade (suggestion) | Effect |
| --- | --- |
| Drone reserve | Keeps at least 4 mining drones, one rebuilt every 2 min |
| Fighter reserve | Keeps at least 2 fighters, one rebuilt every 5 min |
| Higher tiers | Larger minimum, shorter cooldown, more ship classes |

### Payout

Recommended formula (suggestion): research points from total ore value delivered to the carrier in the run, multiplied by the furthest zone tier reached (starter 1, frontier 2, deep space 3).

$$
\text{RP} = \left\lfloor \sqrt{\frac{\text{ore value delivered}}{1{,}000{,}000}} \right\rfloor \times \text{furthest zone tier}
$$

The square root keeps long runs from exploding the payout, and the zone multiplier rewards pushing outward over farming a safe system. The constants are placeholders for balancing.

## Meta progression (incremental layer)

1. In a system: ore becomes credits, which buy ships, modules, and hangar slots.
2. Outward: each warp jump opens richer ores together with tougher threats.
3. Idle: the current system keeps running offline at a reduced rate, settled from timestamps. Offline is mostly safe (Lars); suggested details: no pirate waves while away, and the fleet earns only what the current system's safe behaviour would yield.
4. Automation as a reward: unlock more stances, rule conditions, auto-buy, and auto-rebuild of losses, as Unnamed Space Idle does with its AI upgrades.
5. Prestige: reset for research currency and spend it in the research tree (see Prestige & Research).
6. Optional later: short expeditions into deep fields.

## The gap in the market

| Game | Does well | Missing |
| --- | --- | --- |
| Omen MiniMiner | Endless field, growing fleet, browser | Control over fleet behavior |
| Idle Fleet | Server-side idle, drones, player market | Fleet is just numbers, no tactics |
| Space Miner – Idle Adventures | Drones, research, prestige | Player control |
| Deep Space Mining Company | Live drone swarm in the browser | Control over the AI |
| Gladiabots | Rule building without code | No idle, no mining |
| Screeps Arena | Fully autonomous units | Real JavaScript, steep entry |
| The Bazaar, Super Auto Pets | Board building, synergies, async PvP | No logistics or space theme |

> So I was like, ok I have no control over any of this, and my units are actively making the worst possible decisions, which is a really bad combination.
>
> — u/TyaArcade on Deep Space Mining Company, r/incremental_games

> Upd. My Barge haven't brought a single ore piece in 10 minutes
>
> — Player comment on Mini Miner, itch.io

The gap: an endless-field idle game where you shape how the autonomous fleet behaves through hangars, stances, and simple rules, between plain idle numbers and Screeps-style code, and in 3D.

## Reference games

- [Omen MiniMiner](https://wompthecat.itch.io/omen-miniminer) (itch.io): endless field, growing mining fleet, playable in the browser
- [Idle Fleet](https://store.steampowered.com/app/4939470/Idle_Fleet/) (Steam): idle MMO with a mining fleet and 6 autonomous drones
- [Space Miner – Idle Adventures](https://store.steampowered.com/app/2679860/Space_Miner__Idle_Adventures/) (Steam): asteroid idle with drones and prestige
- [Little Asteroid Miner](https://store.steampowered.com/app/3848230/Little_Asteroid_Miner/) (Steam): incremental with AI drones and enemies
- [Unnamed Space Idle](https://store.steampowered.com/app/2471100/) (Steam): prestige and unlockable automation
- [Deep Space Mining Company](https://omiigames.itch.io/deep-space-mining-company) (itch.io): browser drone fleet, useful player feedback
- [Astronomics](https://astronomicsgame.com/) (astronomicsgame.com): asteroid mining automation with a bot crew and pirates
- [Gladiabots](https://store.steampowered.com/app/871930/) (Steam): build AI rules, robots fight on their own
- [Screeps: Arena](https://store.steampowered.com/app/1137320/Screeps_Arena/) (Steam): autonomous units scripted in JavaScript
- [Mindustry](https://store.steampowered.com/app/1127400/Mindustry/) (Steam): factory, units, and its own logic language
- [Super Auto Pets](https://store.steampowered.com/app/1714040/Super_Auto_Pets/) (Steam): autobattler with an asynchronous arena
- [The Bazaar](https://store.steampowered.com/app/1617400/The_Bazaar/) (Steam): board building with synergies, async PvP
- [Homeworld Remastered](https://store.steampowered.com/app/244160/) (Steam): mothership, collectors, Mobile Refinery, the 3D feel to aim for
- [Carrier Command 2](https://store.steampowered.com/app/1489630/) (Steam): a carrier launching autonomous units
- [EVE Online Rorqual](https://wiki.eveuniversity.org/Rorqual) (EVE University Wiki): capital mining ship with drones and compression

## Tech: 3D in the browser with React Three Fiber

> **Feasible.**
> A Homeworld-like 3D look with low-poly models runs well in the browser with React Three Fiber, three.js, and drei, as long as the many small objects are instanced and the simulation stays out of React.

| Aspect | Plan |
| --- | --- |
| Stack | TypeScript, React, React Three Fiber (`@react-three/fiber`), three.js, drei (`@react-three/drei`) |
| Many drones and asteroids | `InstancedMesh` (or drei `Instances`): one draw call per model type, thousands of objects, positions updated from the simulation each frame |
| Simulation | Deterministic, fixed tick (e.g. 10–20 Hz) with a seeded RNG in a Web Worker, fully separate from rendering; the renderer interpolates between the last two ticks |
| Camera | Free Homeworld-style camera (orbit, zoom, focus a ship) plus a tactical sensor view with icons; switch by toggle or automatically when zoomed far out |
| Look | Postprocessing via `@react-three/postprocessing`: bloom on engines and lasers, engine trails (drei `Trail` or instanced ribbons), dark skybox with a nebula |
| Distant objects | LOD (drei `Detailed`) and impostors or billboards for far asteroids and ships |
| Models | Low-poly from Blender or Kenney and Quaternius assets (free, CC0), loaded as glTF via drei `useGLTF` |
| Offline progress | Store a timestamp on close; on load, settle the elapsed time with a simplified income model instead of simulating every tick |
| Save state | IndexedDB, plus text export and import |

### Risks and limits

- Draw calls: every non-instanced mesh costs one; trails, lasers, and UI markers add up fast, so batch them as well.
- Mobile GPUs: bloom and many transparent trails are expensive; plan a low-quality mode and frame-rate cap from the start.
- React re-renders: per-frame updates must go through refs and `useFrame`, never React state, or performance collapses.
- UI overlay: hangar board, stance, rule, and research editors are better as normal HTML/React on top of the canvas than inside 3D; drei `Html` labels get expensive in large numbers.
- Worker boundary: send compact typed arrays (positions, states) per tick, not objects, to keep transfer cheap.
- Scope: free camera plus tactical view is two render modes; build the free camera first and add the tactical view as icons over the same scene.

### Libraries and assets

- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) (github.com/pmndrs)
- [React Three Fiber docs](https://r3f.docs.pmnd.rs/) (r3f.docs.pmnd.rs)
- [drei](https://github.com/pmndrs/drei) (github.com/pmndrs): helpers for R3F (Instances, Detailed, Trail, useGLTF)
- [react-postprocessing](https://github.com/pmndrs/react-postprocessing) (github.com/pmndrs): bloom and other effects for R3F
- [three.js](https://threejs.org/) (threejs.org)
- [Kenney Space Kit](https://kenney.nl/assets/space-kit) (kenney.nl): free low-poly space models
- [Quaternius](https://quaternius.com/) (quaternius.com): free low-poly model packs

## Late Game & Scaling (brainstorm)

> **Everything in this section is brainstorm.** Lars asked how to get past the hangar and slot hard caps: more carrier hulls, multiple carriers, or a second prestige layer with infinite upgrades. Nothing here is decided.

### Where the caps live today

| Limit | Value | Where (repo, 26 Oct) |
| --- | --- | --- |
| Hangars per carrier | 2 at start, hard max 5 (a literal, not in config) | `src/sim/actions.ts:125` |
| Slots per hangar | 6 at start (+1 to +3 from Hangar frames research), max 12 | `src/sim/state.ts:316`, `src/sim/config.ts:185` |
| Cost curves | Slot 120 × 1.45^(slots−6), new hangar 1,500 × 3^(n−2) | `src/sim/config.ts:183-184` |
| Carriers | Exactly one: the game state has a single `carrier` | `src/sim/types.ts:257` |
| Research | 50 nodes, all with a max level (140 levels in total), so RP eventually has no sink | `src/sim/research.ts` |
| Power and refinery | Energy max 1,000, refinery max level 8 | `src/sim/config.ts:291-296` |
| Sim budget | 1,000 ships and 600 asteroids under 8 ms per tick, tested | `src/sim/scale.test.ts` |
| Render budget | 1,000 instances per ship class, 1,000 asteroids | `src/render/Fleet.tsx:14`, `src/render/AsteroidField.tsx:9` |
| UI snapshot | The full game state goes to the UI 5 times a second | `src/game/runner.ts:130` |

So the fleet tops out around 60 hangar slots (5 × 12, plus barge drone bays) while the sim is tested at 1,000 ships. The cap is a design choice, not a performance wall: one carrier has roughly ten times headroom. Several carriers in several systems do not; they need abstraction.

### How other games handle it

| Game | Mechanic | Lesson for us |
| --- | --- | --- |
| Antimatter Dimensions | Three prestige layers: Infinity → Eternity → Reality; each resets the ones below and opens a new upgrade system | Each layer needs a new mechanic, not just bigger numbers |
| Realm Grinder | Abdication → Reincarnation → Ascension, each with its own requirement | Nested resets give a long tail |
| NGU Idle | Rebirth, plus difficulty modes Normal → Evil → Sadistic that unlock new content | A harder universe can be a layer of its own |
| Egg, Inc. | Soul Eggs add a bonus, Prophecy Eggs compound it; contracts run on a separate farm beside the home farm | A second currency as a multiplier; a side operation next to the main one |
| Idle Planet Miner | Sell a galaxy for credits; Mothership rooms persist across galaxies | A persistent ship as the meta layer fits a carrier |
| Kittens Game | Paragon on reset: 1 point per kitten above 70 | A simple, readable threshold payout |
| Mindustry | Unit cap comes from cores: Shard +8, Foundation +16, Nucleus +24, additive; on Erekir each core gives +15, so you build more cores | Exactly our case: cap per base, more or bigger bases raise it |
| Homeworld Remastered | Unit caps per ship family and per type, e.g. only a few carriers | Per-class caps read as fiction, not an arbitrary wall |
| EVE Online | Capital ships jump with jump drives; jump fatigue grows with distance | A cost on moving big ships instead of a cap |
| X4: Foundations | Ships are assigned to a commander (Defend, Mimic …); miners can mine for a station | An admiral layer: give orders to commanders, not to ships |
| Factorio: Space Age | Space platforms fly between planets, collect asteroids, run scheduled routes | Mobile bases on routes, a model for secondary carriers |

Where it collapses:

- Number inflation: Antimatter Dimensions' layers open at 1.80e308; past that, numbers stop meaning anything to most players.
- UI overload: every layer adds tabs and currencies; the HTML panels are already the densest part of the game.
- Performance: a second fully simulated and rendered carrier doubles cost; a fifth one breaks the budget.
- Offline balance: several carriers earning offline multiply the 12-hour offline payout.

### Idea groups

| Group | Idea (suggestion) | Performance fit |
| --- | --- | --- |
| (a) Hulls | Hull classes with their own slot grids: light carrier (fast warp, few hangars), fleet carrier (more hangars), mining mothership (big refinery, few combat slots), bastion (shields) | Free: same sim, one carrier |
| (a) Hulls | Hull refit at a shipyard in a starter system; ships that still fit stay aboard | Free |
| (a) Hulls | Modular hangar sections beyond 5, each drawing power and upkeep instead of a hard limit | Fine up to the 1,000-ship budget |
| (a) Hulls | A carrier tech branch: frame, reactor, bays, sensors | Free |
| (b) Carriers | A second carrier, unlocked by a prestige-2 milestone | Only the active carrier is fully simulated and rendered |
| (b) Carriers | Actively played carriers with a background sim: carriers outside the viewed system run an aggregate model (throughput equation plus risk rolls); see Multiple Carriers | Cheap: only the viewed system is fully simulated and rendered |
| (b) Carriers | Supply routes: convoys between carriers, abstracted as a flow with an interception chance | Cheap: one number per route |
| (b) Carriers | Admiral layer: a strategic star map, doctrine presets per carrier, switch focus between carriers | UI cost, little sim cost |
| (c) Prestige 2 | Admiralty: resets research, RP and discovered systems; keeps hulls, carriers and milestones; pays Admiralty Marks from lifetime RP | Free |
| (c) Prestige 2 | Infinite upgrades (yield, energy, launch speed) with geometric cost and a soft cap on the effect | Free; keep numbers readable |
| (c) Prestige 2 | Milestones: 1st Admiralty unlocks hull classes, 3rd a second carrier, 5th a third carrier slot | Grows the abstraction need |
| (c) Prestige 2 | Challenges: runs with restrictions (no fighters, half energy, deep space start) for permanent bonuses | Free |
| (d) Soft caps | Command points: each ship costs CP, the hull supplies CP; going over slows launches and lowers efficiency | Bounds the fleet without a wall |
| (d) Soft caps | Upkeep: every hangar and ship draws power, so the energy pool becomes the real cap | Uses the existing power system |
| (d) Soft caps | Logistics limits: more drones than barges and haulers can serve add nothing (the throughput equation already does this) | Free |
| (d) Soft caps | Replace the 5-hangar and 12-slot maxima with steeper cost curves and diminishing returns | Free |

### Recommended ladder (suggestion)

```mermaid
flowchart LR
  run["Run<br/>one carrier, soft caps"] --> p1["Prestige 1<br/>research tree"]
  p1 -->|late research| hulls["Hull classes<br/>refits, hangar sections"]
  hulls --> p2["Prestige 2<br/>Admiralty, infinite upgrades"]
  p2 -->|milestone| c2["2nd carrier<br/>played actively, background sim"]
  c2 --> multi(["Multi-system command<br/>admiral map, supply routes"])
```

Start with soft caps (command points and power upkeep), since they reuse the energy system and lift the wall at almost no cost. Hull classes come next as late prestige-1 content. A second prestige layer, Admiralty, then unlocks extra carriers. All of them are played actively; the ones outside the viewed system run on a background sim, so the render and sim budget stays one system wide.

### References for scaling

- [Antimatter Dimensions: prestige layers (Infinity, Eternity, Reality)](https://antimatterdimensions.wiki.gg/wiki/Prestige) (antimatterdimensions.wiki.gg)
- [Realm Grinder: Abdication, Reincarnation, Ascension](https://realm-grinder.fandom.com/wiki/Soft_Resets) (realm-grinder.fandom.com)
- [NGU Idle: Evil difficulty as a progression layer](https://ngu-idle.fandom.com/wiki/Evil_difficulty) (ngu-idle.fandom.com)
- [Egg, Inc.: Eggs of Prophecy compound the Soul Egg bonus](https://egg-inc.fandom.com/wiki/Earnings_Bonus/Eggs_of_Prophecy) (egg-inc.fandom.com)
- [Egg, Inc.: contracts on a separate farm](https://egg-inc.fandom.com/wiki/Contracts) (egg-inc.fandom.com)
- [Idle Planet Miner: selling galaxies and Mothership rooms](https://idle-planet-miner.fandom.com/wiki/Strategy_Guide) (idle-planet-miner.fandom.com)
- [Kittens Game: Paragon](https://wiki.kittensgame.com/en/general-information/resources/paragon) (wiki.kittensgame.com)
- [Mindustry: cores set the unit cap](https://mindustry.miraheze.org/wiki/Core) (mindustry.miraheze.org)
- [Homeworld Remastered: players on per-type unit caps](https://steamcommunity.com/app/244160/discussions/0/618457398960679464/) (Steam Community)
- [EVE Online: jump drives and jump fatigue](https://wiki.eveuniversity.org/Jump_drives) (EVE University Wiki)
- [X4: Foundations: station building and management](https://wiki.egosoft.com/X4%20Foundations%20Wiki/Manual%20and%20Guides/X4%3A%20Foundations%20Manual/Station%20Building%20And%20Management/) (wiki.egosoft.com)
- [Factorio: Space platforms](https://wiki.factorio.com/Space_platform) (wiki.factorio.com)

### Open questions on scaling

1. Decided (Lars, 26 Oct): extra carriers are played actively at the same time, with a background sim for other systems. See Multiple Carriers.
2. What does Admiralty reset: the whole research tree, or only RP and discovered systems?
3. Keep a visible fleet limit for readability (command points), or let power and upkeep be the only limit?
4. Infinite upgrades: let numbers run into e-notation, or keep them human-readable with soft caps?

## Multiple Carriers (design draft)

> **Lars' decision (26 Oct):** Several carriers are played actively at the same time. The panels follow the selected carrier, switching carrier also switches the system view, carriers in other systems keep running in the background, and events from other systems arrive as toasts. Everything else in this section is a suggestion.

### What the repo has today

| Area | Today | Where |
| --- | --- | --- |
| Event log | `log(s, text, tone)` pushes plain strings into `GameState.log`, capped at 40, shown in the Log tab. Over 20 call sites, no event types, no carrier or system id | `src/sim/state.ts:269`, `src/sim/types.ts:232`, `src/ui/App.tsx:66` |
| Toasts | One toast at a time, 2.5 s, used only for command errors and engine messages | `src/game/engine.ts:26`, `src/ui/App.tsx:182` |
| Offline report | `settleOffline` pays mining income × time × 0.5 (max 12 h), clears pirates, rebuilds reserves; returns seconds, credits, rebuilt | `src/sim/actions.ts:289-328` |
| Worker protocol | In: init, cmd, speed, pause, prestige, replace, snapshot. Out: a typed-array `frame` after every pump with ticks, and the full `state` at most 5 times a second | `src/game/protocol.ts`, `src/game/runner.ts` |
| Single carrier | `GameState` holds one `carrier`, one `hangars`, `ships`, `pirates`, `asteroids`, one `systemId`, `warp`, `wave`, `storm`, `rng`. About 200 lines touch `s.carrier`, `s.ships`, `s.hangars` or `s.systemId` across sim, render and UI | `src/sim/types.ts:257-283` |
| Commands | No carrier id; every command acts on the one carrier | `src/sim/actions.ts:35-62` |
| Left-behind systems | Depletion records of systems the carrier left (`fields`), a good base for background fields | `src/sim/types.ts:156` |
| Save | Version 7 with a migration per version | `src/sim/state.ts:28`, `src/game/migrate.ts` |

What multi-carrier needs: move everything per-carrier into an `ops: Operation[]` array (carrier, hangars, ships, pirates, asteroids, containers, hazards, recon, systemId, warp, wave, storm, reserve timers, fx, rng and income averages); keep credits, research, unlocks, lifetime stats and the event log global; add a v7 → v8 migration that wraps today's state into `ops[0]`; give every command a `carrierId`; and key the render scene by the focused carrier's system.

### Selection model (suggestion)

| Element | Suggestion |
| --- | --- |
| Focus | One focused carrier at a time; its system is the system view. The focus is UI state, sent to the worker so it knows which carrier gets the full sim |
| Switching | A carrier bar (one card per carrier with hull, energy, income and an event badge), hotkeys 1–9, and clicks on the tactical or star map. A short warp-style camera cut hides the scene swap |
| Bound to the focused carrier | Fleet, Hangars, Doctrine, Power and Carrier tabs, plus the HUD |
| Global | Research, prestige, credits, unlocks, settings and the event inbox (filterable by carrier) |
| Resource pool (open) | Suggested split: credits and research shared; ore, H2 and energy stay on each carrier, as `Carrier` already holds them |

### Sim fidelity tiers (suggestion)

| Tier | Who | How it runs | Cost |
| --- | --- | --- | --- |
| A: full | The focused carrier | Today's deterministic 10 Hz `step`, rendered, frames and UI snapshot | Today's budget (tested to 1,000 ships) |
| B: background | Every other carrier while you play | An aggregate model at 1 Hz: yield per minute from the bottleneck (drones, barges, haulers, refinery), energy balance, wave and hazard timers; a wave resolves as a strength comparison plus a seeded roll, and losses come out of the loss buffer first | Microseconds per carrier; no ships moved, nothing rendered |
| C: offline | All carriers while the game is closed | Tier B with risk off, at offline efficiency, capped at 12 h, like today's `settleOffline` | One call per carrier on load |

- A → B (focus leaves): snapshot the ship roster, hull values and field depletion into the carrier's record, measure income from its recent Tier A average, and drop positions.
- B → A (focus arrives): rebuild asteroids from the system seed plus the depletion record, put ships at the carrier with docked ships at their dock and launched ships placed near their last target, and spawn an active wave at the system edge. The camera cut hides the re-materialisation.
- Determinism: each carrier gets its own `rng`, so background rolls never shift the focused carrier's random stream. The results depend only on the save and the order of focus switches, so a replay stays reproducible.
- Budget: N carriers (e.g. up to 8), one at Tier A. The worker sends the full state of the focused carrier only, plus a small summary per other carrier. That also removes today's risk of the full-state clone growing with the fleet.

### Event pipeline (suggestion)

```mermaid
flowchart LR
  sim["Sim<br/>emit typed events, Tier A and B"] --> buf["Event buffer<br/>per tick, in the worker"]
  buf --> run["Runner<br/>aggregate, rank, batch"]
  run -->|events message| eng["Engine<br/>main thread, alert rules"]
  eng -->|warn and up| toast(["Toast<br/>with Go to"])
  eng --> log(["Event inbox<br/>per carrier filter"])
  eng --> badge(["Carrier bar badge"])
  off["Offline settlement<br/>Tier C"] --> away(["Away report<br/>grouped per carrier"])
```

Each event carries `kind`, `carrierId`, `systemId`, `severity`, sim time `t`, a `count` and small data. The runner merges events with the same kind and carrier within about 5 seconds ("3 drones lost in Kepler-4"), ranks by severity, and sends a batch alongside the frame. The text is formatted in the UI, so `log()` call sites turn into `emit()`.

| Event | Severity | UI treatment |
| --- | --- | --- |
| HullCritical / EmergencyJump | critical | Sticky toast with Go to, red badge, optional auto-pause |
| PiratesArrived | critical | Toast with Go to, red badge |
| PirateWaveIncoming | warn | Toast with countdown and Go to, badge |
| ShipLost (aggregated) | warn | Toast when it is a barge or 3+ ships, else inbox only |
| EnergyLow | warn | Badge and inbox; toast once per carrier |
| BargeFull / BargeFallback | warn | Badge and inbox |
| StormStarted | warn | Inbox; toast only for the focused carrier |
| WarpReady / Warped | info | Toast for the carrier that jumped |
| WaveRepelled | good | Inbox, clears the red badge |
| ReserveRebuilt / BufferRebuilt | good | Inbox only, aggregated |
| VeinFound | good | Inbox only |
| ResearchAffordable | info | Global badge on the Research tab |

Offline: Tier C writes the same events, and the away report groups them per carrier ("Kepler-4: +12,400 credits, 2 reserves rebuilt"). Since doctrine and rules already react on their own (recall on low shields, reserve warp energy, barge fallback), toasts are information, not a call to micromanage. Doctrine could gain per-carrier alert rules: for each event kind choose off, inbox, toast, toast + pause, or toast + focus.

### Implementation order (suggestion)

1. **Event bus and toasts on today's single carrier:** SimEvent type in `src/sim/types.ts`, `emit()` replacing `log()` in `src/sim/state.ts`, drain and batch in `src/game/runner.ts`, an events message in `src/game/protocol.ts`, a toast queue and inbox in `src/game/engine.ts` and `src/ui/App.tsx`.
2. **State refactor to ops[]:** Operation type, `step(global, op)` in `src/sim/tick.ts`, `carrierId` on every Command in `src/sim/actions.ts`, v8 migration in `src/game/migrate.ts`, still one carrier.
3. **Tier B background model:** new `src/sim/background.ts` with materialise and dematerialise; `settleOffline` reuses it as Tier C; determinism and handover tests.
4. **Carrier switching and UI:** a focus message in `protocol.ts`, state for the focused carrier plus summaries, carrier bar and hotkeys, Scene keyed by system in `src/render/Scene.tsx`, panels bound to the focus.
5. **Second carrier unlock:** a buy-carrier action behind an Admiralty milestone (a debug unlock earlier for testing), then supply routes and the star map.

### Open questions on multiple carriers

1. Do background carriers take full risk (real losses while you are not watching), or reduced risk like offline?
2. Shared resource pool, or credits shared and ore, H2 and energy per carrier?
3. May two carriers share a system? If so, both are Tier A when you view it, which doubles that system's cost.
4. Doctrine and rules: per carrier, or fleet-wide with per-carrier overrides?

## Open questions for Lars

1. Energy at zero: can the pool run dry completely, and what happens then (shields drop, refining stops, the carrier is stranded until solar recharges)?
2. Is H2 also direct warp fuel, or does it only feed the fusion reactors that fill the energy pool?
3. Loss buffer and offline: do reserve ships keep rebuilding on their cooldown while you're away, or only while the game is open?
4. How deep should the rules go next to stances: fixed rule cards, Gladiabots-style building blocks, or real scripting like Screeps?
