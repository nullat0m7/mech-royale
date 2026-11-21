# Handoff

Rules live in `CLAUDE.md` and override this file. Design, decisions and the submissions log are in `docs/bot.md`; the change history is in `CHANGELOG.md`.

## 0. Built, with evidence

- **Repo setup**, 2026-11-20, `64d0b01`: TypeScript bot on Node 24 with no runtime dependencies; `Dockerfile` (node:24.22.3-slim pinned by digest, copies `package.json` and `bot/` only); `.gitignore`, `.dockerignore`; vendored kit in `mechfight-kit/`; scripts in `package.json` (`node --run typecheck|test|check|docker:build|check:docker|verify|sim`).
- **Bot**, 2026-11-20, `bot/main.ts` → `bot/brain/brain.ts` (`Brain.act`):
  - World: `bot/world/map.ts` (`World.rayHit`, `clear`, `sightClear`, `treesBlock`) and `bot/world/nav.ts` (`Nav.path`, `reachable`, `snap`, regions).
  - Every tunable number is in `bot/params.ts` (`P`).
  - Verified at submission 10 (`rangeGun` 100 m): type check 0 errors, `node --run test` 10/10 (includes a 10 000-observation fuzz test), local check PASS 300/300 (p99 0.7 ms), Docker sandbox check PASS 300/300 (p99 4.7 ms, max 14.1 ms).
- **Simulator**, 2026-11-20:
  - `sim/engine.ts` (`Sim`), `sim/house.ts` (`houseController`, `ffaController`, `exampleFactory`, `HOUSE` with a `HOUSE_PARAMS` env override), `tools/run.ts` (batch runner), `tools/viewer.html` (replay viewer).
  - About 1.5 s per match.
  - It mis-ranks tactics: see the `CLAUDE.md` Observations.
- **Practice scores (exact; the scorer is deterministic):**

  | Commit | Score | Notes |
  | --- | --- | --- |
  | `65ce172` | 4.44 | |
  | `6df0e10` | 3.98 | long range, reverted |
  | `ecbee26` | 4.44 | |
  | `096c710` (bot = `029df2d`) | 4.00 | submission 4: `treeCover` and `idleRegen` on; turned off again |
| `fe134fc` | not scored | `reengageHp` 0.65 alone |
| `f4f93f8` | 4.31 | submission 5: `reengageHp` 0.65 + `farmHp` 0.85 |
| `926e5b7` | 4.40 | submission 6: `reengageHp` 0.65 alone; back to 0.85 |
| `aeb2484` / `5770340` | 4.35 | submission 7: `crateRange` and `cubeRange` 140 m; back to 90 |
| `7a3a25a` | **4.46** | submission 8: 4.44 behaviour plus `dropMaxDist` 300 m; new best |
| `944ca5c` | 4.38 | submission 9: `dropSlack` 30 s; back to 6 |
| `3a7229f` | pending | submission 10: `7a3a25a` plus `rangeGun` 100 m |
| `d2453c4` | 4.31 | submission 11: laser duck, no mortar, FFA mode; practice parts reverted |
| `3a7455a` | 3.90 | submission 12: kill securing, damage-first upgrades, `lootRange` 260; reverted |
| `1314c3d` | not submitted | 4.46 practice play plus FFA mode |
| `8074641` | 1.75 | probe 13: survival (ghost) play from the first tick; reverted |
| HEAD of `main` | not submitted | 4.46 practice play plus FFA mode; hunter built, off |

## 1. Next

Paused by the owner on 2026-11-21 (see `CLAUDE.md`, PAUSED). Nothing is pending. If the owner lifts the pause: HEAD plays the 4.46 practice behaviour plus the free-for-all mode; the hunter behaviour is built behind `hunt` (off; sim −0.2 to −0.5).
