# Handoff

Rules live in `CLAUDE.md` and override this file. Design, decisions and the submissions log are in `docs/bot.md`; the change history is in `CHANGELOG.md`.

## 0. Built, with evidence

- **Repo setup**, 2026-11-20, `64d0b01`: TypeScript bot on Node 24 with no runtime dependencies; `Dockerfile` (node:24.22.3-slim pinned by digest, copies `package.json` and `bot/` only); `.gitignore`, `.dockerignore`; vendored kit in `mechfight-kit/`; scripts in `package.json` (`node --run typecheck|test|check|docker:build|check:docker|verify|sim`).
- **Bot**, 2026-11-20, `bot/main.ts` → `bot/brain/brain.ts` (`Brain.act`):
  - World: `bot/world/map.ts` (`World.rayHit`, `clear`, `sightClear`, `treesBlock`) and `bot/world/nav.ts` (`Nav.path`, `reachable`, `snap`, regions).
  - Every tunable number is in `bot/params.ts` (`P`).
  - Verified at `029df2d`: type check 0 errors, `node --run test` 10/10 (includes a 10 000-observation fuzz test), Docker sandbox check PASS 300/300 with p99 4.2 ms.
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
  | `029df2d` / `59199ab` | pending | submission 4: `treeCover` and `idleRegen` on; only docs changed after `029df2d` |

## 1. Next

The owner will paste the practice score for `59199abc6784ca61a2467b019fae467e666f65e1`. Then:
- If it is above 4.44, keep the change.
- If it is 4.44 or below, set `treeCover: false` and `idleRegen: false` in `bot/params.ts` (back to the 4.44 behaviour) and try the next candidate.

Each submission must carry one new candidate improvement.
