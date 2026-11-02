# Gridiron — handoff

Football on the TV, and your phone is the ball. Built 2026-11-02 for a
party on Saturday 2026-11-07 to watch **BYU at Utah** (10 a.m. MT,
Rice-Eccles). From `GAMEDAY.md` in Night-Watch, ideas #10 (Touchdown Pass)
and #11 (Two-Minute Drill); the Two-Minute Drill is the goal.

## Playing it

Open the site on the TV (a laptop, a Fire Stick in Silk, a tablet).
Phones scan the QR code, type a name, pick BYU or UTAH, JOIN, then point
the top of the phone at the TV and LOCK. Any phone picks the mode and
presses START (or Enter on the TV).

- **Touchdown Pass** — warm-up. Five throws each from a random spot, pass
  plays only. Points: 10 a catch + air yards, +30 a touchdown.
- **Two-Minute Drill** — the team with more phones has the ball (ties:
  BYU). The QB passes to the next phone on that team every play. Pick a
  scenario: *Saturday at Rice-Eccles* (down 4, 2:00, own 25, 2 TOs),
  *Harline's Still Open* ('06-inspired, down 4, 1:18), *Ferrin From 44*
  ('24-inspired, down 2: a field goal wins), *George Is Still Running*
  ('09-inspired OT from the 25, need a TD), *Backyard* (kids: 3:00, slow
  defence, softer catches). The scenario blurbs say "inspired by": the
  numbers are approximate on purpose.
- **Holy War** — BYU phones vs Utah phones. A two-minute drive each from
  the 25; the defending team's phones call the coverage (MAN, ZONE,
  BLITZ, PREVENT) during the huddle; tied after both: overtime from the
  25, no clock, up to three rounds, then "share the Beehive Boot".

Throwing help (lobby): ROOKIE / STARTER / PRO — how much a throw is bent
toward the receiver it was nearly aimed at (`ASSIST` in `sim.js`).

On the TV without phones: 1–9 call a play, Space or a click hikes, click
on the field throws there, arrows steer, T timeout, S spike, Esc lobby,
F fullscreen. In the lobby a computer QB plays drives behind the menu.

## The throw (`web/throw.js`, `throwcheck.mjs`)

Hold the phone like the ball, **top of the phone = the nose**. Thumb on the
screen = ball in hand (it also hikes). Throw — keep hold of the phone — and
**lift the thumb** as you let go. What is read at the thumb-up:

| | from | notes |
|---|---|---|
| aim | heading of the nose at release, minus the LOCK heading | the overhand arc swings the nose in the vertical plane of the throw, so the heading holds still through the release while the pitch does not |
| loft | the nose's pitch at release | early release (nose up) lobs, late (nose level) is a bullet: 9°–46° |
| power | peak turning rate across the arc (not the roll) and peak hand acceleration, last 350 ms | `(arc − 120)/1000` or `(acc − 4)/26`, whichever is bigger. Under 0.08 = **pump fake**, the ball stays in hand |
| spin | roll rate about the nose | a spiral; less wobble in flight |

The pose is the gyro integrated per `devicemotion` event, pulled toward the
browser's orientation only when nearly still — the browser's fused angles
are too slow for a throw and hit a gimbal point at the top of the wind-up.
Facts carried over from dry-fly-phone's `rodsense.js` (as GAMEDAY.md
records them): `rotationRate.alpha` is about the phone's **x** axis, beta
y, gamma z; the accelerometer's sign differs between iOS and Android, so
only magnitudes are used. **dry-fly-phone itself could not be opened from
this session** (it is not in the session's GitHub scope), so `throw.js` is
a rewrite from those notes, not a copy. If the throw misbehaves on a real
phone, compare with `rodsense.js` first.

The **spike**: not holding, nose flung at the floor (nose below −49° and
420°/s or 18 m/s²). Only acts in the huddle with the clock running. There
is also a SPIKE button.

**Swipe mode**: a phone with no motion events after 1.5 s, or anyone who
taps SWIPE MODE (little kids). Thumb down hikes; flick up the screen to
throw; direction from the swipe, power from its speed. A long drag up the
screen (> 90 px) counts as a swipe even in motion mode.

**After the catch** the QB phone steers the ball carrier: tilt left/right
(`deviceorientation` gamma, ±30° = full), or hold a side of the box.

`throwcheck` builds true poses through a throw (wind-up, overhand arc,
spiral), turns them into the events a phone fires (body-frame rates, a
lagging browser orientation) and checks the reading: aim within 4° from
TV headings across the ±180° seam, loft from release timing, power, spin
not moving the aim, a 3°/s gyro bias, pump fake, spike, LOCK with the
phone held upright. **None of this has been on a real phone yet. Test the
throw on an iPhone and an Android first thing.** Things to watch: the sign
of the aim (a throw to the right should go right — if it goes left, the
rotationRate axis mapping is the suspect), and whether `power` feels right
(the numbers in `armPower` are a guess).

## The football (`web/sim.js`, `simcheck.mjs`)

Yards and seconds; x across (sidelines ±26.65), y along (0 = own goal
line, 100 = the one being attacked, end zone to 110), z up. The offense
always drives toward +y; the TV turns the field to whichever team has it.

- **Plays** (`PLAYS`): SLANTS, OUTS, CURLS, POST, SCREEN, HAIL MARY, RUN,
  SPIKE, FIELD GOAL (inside the opponent's 45: kick = 100 − ball + 17 ≤ 62).
  Routes (`ROUTES`) are waypoints with **x positive = outward**, mirrored for
  the left side. (Getting that backwards sent every slant up the sideline;
  `simcheck` caught it as 50-yard "slants".) Short routes settle at the
  end; go/seam/post/corner/wheel/slant keep running.
- **Defence**: 4 rushers, 2 CB, a nickel, 2 LB, 2 S. MAN trails each man
  with a reaction lag (separation comes at the cuts); ZONE sits underneath
  and the safeties stay deeper than the deepest receiver on their side;
  BLITZ sends two more and shortens the pocket; PREVENT plays deep. When
  the ball is in the air everybody who can reach the landing spot breaks
  on it after a reaction time. The AI picks by down, distance and clock
  unless a phone called it (`g.dcall`).
- **Pocket**: 2.7 s (blitz) to 4.8 s (prevent), ±0.4, +1.6 kids. Hold the
  ball past it: sacked, 5–9 yards.
- **Catching**: offence within `ASSIST.reach` of the ball, defence within
  1.15. A defender there first: 32% pick, else broken up. A receiver's
  chance drops with a defender within 2.8 yd, a bullet over 26 yd/s, wobble
  and a high ball. After the catch the carrier runs at 84% speed (tired
  legs, carrying the ball) so defenders can run him down.
- **Clock** (college, last two minutes): runs from the snap; stops on an
  incomplete, out of bounds, a timeout, a spike; stops for 6 s on a first
  down (the chains), then runs. A play that ends with the clock running
  burns 6 more seconds getting lined up. Delay of game at 40 s while the
  clock runs. A play started before 0:00 finishes.
- **The computer QB** (`bot`) plays through the same `throwBall` a phone
  uses, with a human-sized aim error, so the assist is tuned with it.

Tuning (`node simcheck.mjs 200`, the Saturday scenario unless noted), as of
the first build: sharp thrower / Starter ~60% wins, party guest / Starter
~50%, kid / Rookie ~45%, party / Pro ~35%, Backyard kid / Rookie ~80%.
About 4 plays a drive — on the short side; real two-minute drives run 8–12.
If the room finds it too easy, cut big plays first (YAC, deep-zone depth).

## The TV (`web/index.html`, `web/field.js`)

`index.html` hosts the room (PeerJS via `net.js`, from Night Watch), runs
the sim in fixed 60 Hz steps that catch up with real time (a slow frame
must not slow the game clock), and sends each phone its state 8× a second
(plus right after anything it sent). `field.js` draws it in three.js: a
10 a.m. sky, the field as one canvas texture (end zones painted with the
team names, HOLY WAR at midfield), red stands with a blue visitor end,
capsule players in team colours, the ball with a trail and shadow, route
ribbons before the snap, the LOS and first-down lines, the QB's live aim as
an arrow. Camera: high behind the QB so both wide receivers are on screen.
Scorebug: Utah as home (Rice-Eccles), timeouts, clock, down & distance.
Sound (`sound.js`): synthesised crowd, whistle, horn, "Charge!".

`?local=1` = BroadcastChannel instead of WebRTC (tabs of one browser);
`?seed=N` = the same game every time; `?q=low` = no antialiasing, 1×.
Phones: `?pid=` overrides the stored device id (the check's phones share
one browser's storage).

## The phone (`web/play.html`)

Night Watch's habits: never zoom, motion permission inside the JOIN tap
(iOS), wake lock, fullscreen + portrait on Android. Screens: join → LOCK →
lobby / huddle (play cards; SPIKE and TIMEOUT when the clock runs) /
the football pad (laces; arm meter) / RUN (tilt) / defence coverage cards /
watching / results. Sends `aim` 20× a second while holding so the TV can
draw the arrow and the arm meter.

Protocol, phone → TV: `hello {id,name,team}`, `team`, `cfg {mode,sc,assist}`,
`start`, `again`, `lobby`, `call {play}`, `dcall {cover}`, `snap`,
`throw {h,loft,power,spin}` (also the kick during a field goal), `steer {x}`,
`spike`, `timeout`, `aim {h,p}`. TV → phone: `st` (everything), `buzz {ms}`.

## The rivalry (for flavour text)

Researched 2026-11-02.

- **This game**: No. 8 BYU (7-1) at No. 6 Utah (8-0) by the Oct 25 AP poll
  (rankings moved after Oct 31; check), Sat Nov 7, **10 a.m. MT**, Rice-Eccles,
  ABC or ESPN. Utah ~2.5–4.5 point favourite. Utah's first-year coach
  Morgan Scalley (Whittingham's longtime DC); BYU's Kalani Sitake. QBs:
  Utah's Devon Dampier, BYU's Bear Bachmeier. Big 12 title-game and CFP
  stakes. First daytime Holy War since 2010, first 10 a.m. since 1996;
  fans hated the kickoff time; tailgates are brunch.
- **Streak**: BYU has won three straight (2021 26-17, 2024 22-21, 2025
  24-21), its first three-game run since 1989–92. Series: Utah leads 62-37-4
  by Utah's count (BYU counts from 1922: 59-34-4).
- **Lore**: 2006 Beck to Harline on the last play, 33-31 ("Harline's still
  open"); 2009 Max Hall to Andrew George in OT, 26-23 ("George is still
  running"); 2024 Will Ferrin's 44-yarder with 4 s left at Rice-Eccles after
  a late holding call (Utah's AD said it was "stolen" and was fined);
  2025 Bachmeier's 22-yard TD run past eight defenders; 2010 Utah's block
  of a 39-yard try with 4 s left, 17-16; 1993 Yergensen's 55-yarder;
  1998 the Kaneshiro "doink"; 2018 Utah back from 27-7; 1980 McMahon
  pointing at the scoreboard. Utah fans call BYU the "Team Down South".
  The Beehive Boot is the in-state trophy (not regularly awarded lately).
- **Tone**: both coaches asked for mutual respect this year and the Big 12
  has a new penalty for discriminatory chants. The game keeps it to team
  pride and football lore — no religious jabs.

## Not built yet

- **Real-phone testing of the throw** (above). Most important.
- Field Goal Frenzy (#5) as its own mode — the kick exists inside the drill
  (`kick`), reading the same flick.
- Hail Mary (#6), Pick-Six (#20), Kickoff Return (#22).
- Posting scores to party-hub's scoreboard (`POST /score`), if party-hub
  gets built.
- Music (Night Watch's `tools/music.py` pipeline could render a brass-band
  piece); player numbers on jerseys; a QB scramble.
- Icons/link preview are a plain SVG football.
