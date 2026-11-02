# Gridiron

## Git workflow

Solo project, no collaborators — work directly on `main`. Commit and push
straight to `main`, no feature branches or PRs needed. Cloudflare Workers
deploys from `main` on every push, so anything on another branch is not
live, and a change has to work before it is committed.

## Start here

Read `HANDOFF.md` before making any non-trivial change — the throw reader,
the football rules, the tuning numbers, the rivalry notes and what is not
built yet. The party plan this comes from is `GAMEDAY.md` in Night-Watch.

## The game lives in `web/`

`web/` is the only directory Cloudflare uploads. The check scripts and the
notes beside it stay in the repo and off the internet. Run the checks from
the repo root.

## Before shipping

```
node throwcheck.mjs   # the throw reader against synthetic throws: aim, loft, power, spin, pump fake, spike
node simcheck.mjs     # the football rules, then Two-Minute Drills by a computer QB at three skill levels
node netcheck.mjs     # the TV and two phones in Chromium over ?local=1: every mode, a swipe throw, a motion throw
```

`web/sim.js` decides everything that happens and draws nothing. Change the
defence, the routes or the assist there and `simcheck` says whether a sharp
thrower, a party guest and a kid still win about as often as they should.
