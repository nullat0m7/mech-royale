# CLAUDE2.md: overflow of CLAUDE.md

`CLAUDE.md` is capped at 800 words by `wc -w` (owner, 2026-11-20). Anything that does not fit lives here. `CLAUDE.md` wins on any conflict.

## Observations (continued)

- 2026-11-20: No public replays, match data or debug downloads exist (watch, status, leaderboard pages). The practice score is the only real feedback.
- 2026-11-20: Leaderboard ~21:00 ET: 94 teams, top 5.23 (then 5.19, 5.19, 4.75, 4.73); we are about 9th at 4.44. The top 32 by practice score qualify for the final.
- 2026-11-20: In Claude's sandbox, `python3`, `npm` and `bun` are shell wrappers (safe-chain) that fail with `listen EPERM`. `node --run <script>` and `/opt/homebrew/bin/python3` work. Docker, `gh` and `git push` must run outside the sandbox.
- 2026-11-20: Writes to the memory directory from Bash are denied by the sandbox; use the Edit or Write tool.
