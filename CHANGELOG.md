# Changelog

Every change to the bot, the simulator and the project setup, newest first, with the practice score when one exists. Practice scores are exact: the scorer replays the same 48 seeds, and the same code scored the same (4.44 twice). Design detail and the reasoning behind each decision live in `docs/bot.md`.

## 2026-11-20

### Unreleased (pending submission 9)
- `dropSlack` 6 → 30 s: chase a landed, untaken supply drop anywhere within `dropMaxDist`. Before, the arrival rule limited landed drops to about 70 m, because `lands_in` is 0 once a drop is down.

### `7a3a25a`: chase supply drops out to 300 m. Practice **4.46** (submission 8, new best)
- `crateRange` and `cubeRange` back to 90 m.
- `dropMaxDist` 220 → 300 m: go for supply drops (3 cubes, full HP and full energy) up to 300 m away, still subject to the arrival-time rule.

### `aeb2484` and `5770340`: crates and cubes to 140 m, `PATTERNS.md`. Practice **4.35** (submission 7)
- Added `PATTERNS.md`: patterns in the practice scores with evidence and confidence, and the next candidates. Linked from `CLAUDE.md`. Corrected `docs/bot.md`: `6df0e10` changed seven things, not two (`idleRegen` was in both ~0.45 losses); the regen state runs to 85%, not 65%; the sim uses 1 hunter per kill.
- `reengageHp` back to 0.85 (the 4.44 value).
- `crateRange` and `cubeRange` 90 → 140 m: shoot crates farther out and walk to the cube each one drops. Crates do not shoot back, and each gives a cube (+4% max HP and damage) plus a weapon half the time.

### `926e5b7`: `farmHp` back to 0.6, `reengageHp` 0.65 alone. Practice **4.40** (submission 6)

### `f4f93f8`: farm only at 85% HP. Practice **4.31** (submission 5, together with `fe134fc`)
- `farmHp` 0.6 → 0.85: shoot NPC drones and crates only at 85% HP or more. Per `protocol.md` §7, dealing damage pauses regen as much as taking it, and drones shoot back, so farming while hurt left the bot stuck at partial HP.

### `fe134fc`: reengage at 65% HP (never scored alone; see `f4f93f8`)
- `reengageHp` 0.85 → 0.65: after a retreat, stand still only until 65% HP, then roam or fight again (regen continues while roaming). `treeCover` and `idleRegen` off again: the bot is the 4.44 behaviour plus this one change.
- Logged submission 4 (4.00) in `docs/bot.md`, `docs/handoff.md` and `CLAUDE.md`.

### `029df2d` (submitted as `096c710`): tree cover and idle regen. Practice **4.00** (submission 4)
- Retreat and fight-position searches now count trees. A spot hidden from a hunter only by trees costs 40% of an exposed spot: trees block sight, not shots, and a hunter keeps tracking us for 5 s after losing sight (`treeCover`, `treeCoverCost`).
- `idleRegen` on: whenever nothing is in view and HP is under 85%, stand still (silent) and regenerate before roaming.
- Added this changelog. `CLAUDE.md` records that practice scoring is deterministic, the submit-and-log flow, and the rule that a tactic is kept only when its real score beats the best.

### `ecbee26` and `f89def7`: back to the 4.44 behaviour. Practice **4.44** (submission 3)
- Reverted the long-range parameters (gun 75 m, laser 120 m, outnumbered at 3, +15% retreat threshold per extra shooter, loadout laser 3 / lightning 2.6 / gun 1.6 / mortar 1.2). New behaviour flags added off.
- Same score as `65ce172`, so practice scoring is deterministic and any score change is real.
- Simulator: tree occlusion for vision (`World.sightClear`, `World.treesBlock`). Trunks block sight; crowns block when the path through them exceeds ln(1/`canopyBlockT`)/`canopyDensity` = 3.96 m (our reading of the map rules). Trees block about half of building-clear sightlines.
- `HOUSE_PARAMS` env override for house-squad calibration sweeps.

### `6df0e10`: gun plus laser loadout. Practice **3.98** (submission 2)
- Loadout values laser 3, gun 2, lightning 1.3, mortar 1.
- Together with `d0a5be5`, worse than 4.44 although the simulator predicted 7.63. Lesson: the simulator ranks tactics wrongly. Reverted in `f89def7`.

### `d0a5be5`: long-range fighting (not submitted alone)
- Preferred range: gun 170 m, laser 210 m. Outnumbered at 2 hostiles; +30% retreat threshold per extra hostile with a line of fire.
- `idleRegen` (regenerate whenever unseen and hurt) and `avoidLightning` (stay over 60 m from lightning carriers) added.

### `0553231`: simulator calibrated to the first real score
- House squad: one hunter joins per house bot killed, aim noise 1.5° / 0.9° / 0.5° / 0.3° by tier, lead 0.6 / 0.9 / 1 / 1. Sim: kit example 0.96 (real 1.15), first build 4.90 (real 4.44).

### `65ce172`: first submission. Practice **4.44** (submission 1)
Baseline to beat was 1.15; the visible leaderboard top was 5.23 of 94 teams.

Bot (all of `64d0b01` through `65ce172`):
- **World model:** terrain (bilinear), 259 prisms in a 16 m spatial hash, ray tests for shots and sight.
- **Navigation:** a 2 m walk grid with step-up and slope rules, roof and wall flags, and A*.
- **Behaviours:** zone rotation to 70% of the next radius, with a time-to-safety check; fight; retreat to cover; regen; loot weapons; collect cubes; farm NPC drones and crates; supply drops; hold beside a wall inside the next circle.
- **Aim:** gun lead by intercept time, fired only when the slewed aim is within the target's angular radius. Laser charges and releases on target. Lightning fires within range. Mortar uses a low or high arc by line of sight.
- **Dodging:** bullets, mortar impacts, and lasers charging on us.
- **Unsticking:** jump and jet when stuck for 1 s, and blacklist the blocking path cell.
- **Upgrades:** plating, then armor, then nanites first.
- **Focus fire (`2f72b8d`):** the target score favours line of fire, low HP and the current target. Damage had been spread across hunters that regenerate.
- **Peek spots (`2f72b8d`):** fight from a nearby spot with a line of fire to the target that other hostiles cannot see. The retreat threshold rises with each extra shooter.
- **Budgets (`2f72b8d`):** at most one A* per decision (25 000 cells, only under 12 ms used), and cover and peek searches use the 4 nearest threats. Max decision time fell from 77 ms to under 15 ms in the sim.
- **Sealed yards (`df534b7`):** walk regions are labelled and goals must be reachable. The bot jets out of small enclosed yards. It had died to the zone after following a zone goal into a courtyard.
- **NPC drones (`3d734ab`):** fight back at drones that shoot us while no mech is in view.

Tooling:
- **Simulator (`e456f6a`):** `sim/engine.ts`, an approximation of the server: physics, all four weapons, NPCs, crates, loot, cubes, offers, drops, zone, vision, sound. `sim/house.ts` has the practice squad, a free-for-all bot and the kit example. `tools/run.ts` runs parallel batches, reporting score with 95% CI, death causes, damage, accuracy and timing, plus a decision trace (`TRACE_ALL=1 … -v`).
- **Fuzz test (`3d734ab`):** 10 000 random observations; the bot must never throw and must always send a well-formed action.
- **Replays and viewer (`65ce172`):** `--replay runs/x.jsonl` writes a replay; `tools/viewer.html` plays it top-down.

### `64d0b01`: project setup
- **Language:** TypeScript on Node 24, no runtime dependencies. Python was too slow for per-tick line-of-sight and pathfinding under 50 ms on 1 CPU, and TypeScript lets the simulator share the bot's code.
- **Docker image:** `node:24.22.3-slim`, pinned by digest; it copies only `package.json` and `bot/` (`.dockerignore` allowlist).
- **Type checking:** the locally installed Deno (`deno check`), so nothing is installed from npm.
- **`.gitignore`:** OS files, Python bytecode, `node_modules`, sim output (`runs/`, `replays/`), env files, Claude local state.
- **Kit:** vendored unchanged at `mechfight-kit/` (check tool, arena, schema).
- **Scripts:** `node --run typecheck | test | check | docker:build | check:docker | verify | sim`.
- **Docs:** `docs/bot.md` (design, commands, decisions, measurements, submissions); `CLAUDE.md` updated with the language and commands.

### `9bac469` to `4daea12`: agent context
- `CLAUDE.md`, `AGENTS.md` and `docs/agent/` (quality bar, maintenance prompt, worked examples). Git is `main` only. The goal is the track score, not money.
