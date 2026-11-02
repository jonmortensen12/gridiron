# Gridiron — handoff

Football on the TV, and your phone is the ball. Built 2026-11-02 for a
party on Saturday 2026-11-07 to watch **BYU at Utah** (10 a.m. MT,
Rice-Eccles). From `GAMEDAY.md` in Night-Watch, ideas #10 (Touchdown Pass)
and #11 (Two-Minute Drill); the Two-Minute Drill is the goal.

## Playing it

Open the site on the TV (a laptop, a Fire Stick in Silk, a tablet).
Phones scan the QR code, type a name, pick BYU or UTAH, JOIN (the page
reloads — see "shake to undo" below), then tap LEFT or RIGHT for the hand
they throw with (that tap also asks iOS for the motion sensors and goes
fullscreen). Any phone picks the mode and presses START (or Enter on the TV).

- **Touchdown Pass** — the practice field. No defence, the plays call
  themselves in turn (slants, outs, curls, post, Hail Mary, screen), the
  thrower hikes (the hike is what tells the phone which way is forward),
  throwers take turns one rep each, and it never ends (LOBBY to leave).
  Every throw gets a report card on the TV and the phone: LOB or BULLET,
  who it went to, which way it was thrown, the ball's speed and angle,
  the arm speed and nose angle the phone measured, and the result (caught
  + air yards, or missed, or why it was dropped). Points
  still count: 10 a catch + air yards, +30 a touchdown.
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

Third version (2026-11-02). Jon: the phone is the ball and its **bottom is
the nose**; the **hike sets the orientation** (no pointing at the TV); the
game should **intuitively choose which receiver** and **lob or bullet**,
not judge aim or lead. History: v1 held a thumb on the screen and pointed
the top at the TV; v2 dropped the thumb; v3 is this.

First real-phone test (Jon, 2026-11-02): the hike did not register; with
the natural right-handed grip (bottom pointing right, palm toward the body,
back of the hand out) forward came out backwards, so the wrong receivers
got it; turned palm-out it picked receivers well; every throw was a
bullet. Why, as far as can be told without the phone: a hike needed a fast
twist AND the nose rising 25°, and a real hike is mostly a lift; and with
the nose pointing well down in the ready pose, forward was taken from the
back of the phone, which in the palm-in grip faces the body. Fixed as below.

0. **The cadence** (second real-phone test: "it was so fast I had to be in
   snap position before calling the play"): calling a play puts everyone
   **DOWN** — two seconds (`SET_AT` in `sim.js`) to get the phone into the
   ready pose; nothing the phone does counts yet, and the ball cannot be
   snapped. Then **SET**: the phone buzzes, the TV says "Set!", and the
   phone takes its pose at that moment as the snap position. The next
   quick move is the hike ("Hut!"). The TV speaks the cadence with the
   browser's speech synthesis where it has one (and the sound is on).
1. **Ready** (during DOWN): phone held low in front, bottom (nose) pointing
   to the throwing side, palm toward you. Other grips work too (screen up,
   toward you, away, nose pointing down, palm out): `throwcheck` plays all
   of them for both hands.
2. **Hike** (after SET): a burst — turning over 220°/s or the hand over
   8 m/s², a lift counts as much as a twist — that ends 45° or more from the
   snap position AND tipped 30° or more (the angle between "up" as the two
   poses see it, so swinging the phone flat round the room is never a hike),
   within 0.4 s of starting. Any steady moment (under 70°/s and 3.5 m/s²)
   moves the snap position to where the phone is; a slow drift restarts
   after 0.4 s. A tap on the pad hikes too (only at SET).
   - **The forward line** comes from the steady ready pose: a quarter turn
     from the nose (or the phone's face, if the nose points steeply down).
   - **Which way along it** comes from just after the hike (120–600 ms;
     a tap: 250–1100 ms): the phone is cocked, the nose pointing
     forward-ish, so if the nose (when within 75° of level) points against
     the guess, the guess flips. The flip is remembered (`flip`): the next
     hike guesses that grip's way at once. A throw that starts before the
     window ends settles on what it has.
   - FORWARD is fresh every play, so gyro drift between plays never matters.
3. **Throw**: armed once the TV says the ball is in hand. The phone's spin
   in room axes, level part only: an overhand throw spins it about a level
   axis and the throw goes where that spin carries the top of the arc
   (`dir = axis × up`). A throw starts when that level spin passes
   220°/s heading within ~100° of FORWARD (so the wind-up, which spins it
   backward, and waving, which spins about the vertical, never start one),
   peaks, and ends when it falls below 45% of the peak. It counts if the
   arm peaked over 300°/s or the hand over 14 m/s².
   - **Which way** (`h`, relative to FORWARD): the nose's heading through
     the fast part where the nose is level enough to say, else the spin's
     direction. The TV gives the ball to the receiver whose bearing from
     the QB (0.3 s ahead) is nearest that direction (`pickTarget`), and
     `throwTo` leads him perfectly.
   - **LOB or BULLET**: your normal throw is a bullet; an easier one is a
     lob. "Normal" is this phone's own: the faster third of its last eight
     throws (at least 700°/s). `soft = 1 − peak/usual`; lob when
     `2.2·soft + (nose pitch at the peak − 10)/30 > 0.5`, so about 25%
     easier than usual, or a hard throw let go with the nose 25° higher.
     (The first version used absolute numbers and everything came out a
     bullet.) The practice card shows the arm speed against "your usual". In the game: a lob goes up ~9 yd at 41°, over underneath
     defenders, but hangs, so deep defenders have time to come; a bullet
     goes at ~10° (more if it must, to stay under 33 yd/s), no time to
     react, but a defender in the lane can get a hand on it.
   - Power and spin are measured and shown, but do not change where the
     ball goes.

While the ball is in hand the TV rings the receiver the nose is pointing
at — who gets it if you throw now.

Orientation maths: the gyro integrated per `devicemotion` event, pulled
toward the browser's orientation only when nearly still. Facts carried over
from dry-fly-phone's `rodsense.js` notes (GAMEDAY.md): `rotationRate.alpha`
is about the phone's **x** axis, beta y, gamma z; the accelerometer's sign
differs between iOS and Android, so only magnitudes are used.
dry-fly-phone itself was never reachable from this session (not in its
GitHub scope; code search does not reach it either).

**None of this has been on a real phone yet.** The practice field's report
card is the tuning tool. If hikes do not register, lower the 220°/s / 8 m/s²
burst or the 45° in `hikeStep` (or loosen the steady pose: 70°/s, 3.5 m/s²); if the wrong receiver gets it, look at the card's
"Thrown" angle against where you threw (a mirror image means an axis sign);
if lobs come out as bullets, the formula above.

The **spike**: not armed for a throw, nose (bottom) flung at the floor
(below −49° and 420°/s or 18 m/s²). Only acts in the huddle with the clock
running. There is also a SPIKE button.

**Swipe mode** (no sensors, little kids): tap to hike; flick up the pad
toward a receiver — the direction picks him, a slow flick lobs, a fast one
is a bullet. A long drag up the pad (> 90 px) counts in motion mode too.

**Shake to undo.** iOS offers "Undo Typing" when the phone is shaken and
the page has typing it could undo — and every throw is a shake. JOIN
therefore stores the name, team and room (localStorage + a sessionStorage
`gridiron_go`) and reloads: the new page joins straight from storage,
removes the text fields, and has no typing history. The fishing game
solved this too, in dry-fly-phone, but that code was not reachable — if
its fix differs, compare.

**Layout and orientation.** `#app` is sized to the visible window
(`innerWidth` × `innerHeight`, re-fitted on every resize): `100vh` on a
phone includes the browser's own bars, which pushed the bottom buttons off
the screen. Android: fullscreen + `screen.orientation.lock('portrait')`,
asked again on the which-hand tap and on pad taps. iPhones cannot lock orientation from a
web page, so when one rotates, `fitOrientation` turns the whole layout
(`#app`) back the other way so it stays upright on the phone; touches go
through `toLocal` for the swipe and the steering box. The throw maths reads
the phone's own axes, so the screen's rotation never touches it. Rotation
Lock in Control Centre still stops the flicker of the turn itself.
**Untested on a real iPhone.**

**After the catch** the QB phone steers the ball carrier: tilt left/right
(`deviceorientation` gamma, ±30° = full), or hold a side of the box.

`throwcheck` builds true poses through a whole play (ready pose, hike, a
turn toward a receiver, the overhand throw, a spiral), turns them into the
events a phone fires (body-frame rates, a lagging browser orientation) and
checks: FORWARD from the hike within 6° for right- and left-handers facing
anywhere on the compass, the tap-hike while looking at the screen, a slow
lift is not a hike, waving the ready pose is not a hike; one throw per
throw, direction within 8° from −65° to +60°, LOB vs BULLET, power, spin
not moving the direction, a gyro bias; and no throw from a wind-up past
vertical, waving, lowering the phone, or while not armed; the spike; the
swipe. `simcheck` checks that direction picks the left wideout, the right
wideout and the slot, that a perfectly led ball on an empty field is caught,
and that a lob flies higher than a bullet. The computer QB now plays as a
person does: picks a receiver (`sk.pick` how often the right one) and lob or
bullet (`sk.kind` how often the right one); the tuning rows still land in
their bands (sharp ~63%, party ~55%, kid ~41%).

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

Events: `sim.js` pushes to `g.ev` and never clears it; the TV takes them
each tick (`G.ev = []`). Until 2026-11-02 `step()` cleared them, which
silently lost every event a phone caused between steps (throws, calls,
timeouts): no throw sound, passer stats stuck at 0/0.

`index.html` hosts the room (PeerJS via `net.js`, from Night Watch), runs
the sim in fixed 60 Hz steps that catch up with real time (a slow frame
must not slow the game clock), and sends each phone its state 8× a second
(plus right after anything it sent). `field.js` draws it in three.js: a
10 a.m. sky, the field as one canvas texture (end zones painted with the
team names, HOLY WAR at midfield, pylons), red stands with aisles and
walkways and a blue visitor end, the players (below), sun shadows that follow
the play (off with `?q=low`, which keeps soft blobs), the ball with a trail, route
ribbons before the snap, the LOS and first-down lines, the QB's live aim as
an arrow. Camera: high behind the QB so both wide receivers are on screen.
Scorebug: Utah as home (Rice-Eccles), timeouts, clock, down & distance.
Sound (`sound.js`): synthesised crowd, whistle, horn, "Charge!"; the
cadence spoken ("Down!", "Set!", "Hut!").

**The players** (`web/players.js`, names and numbers from `web/rosters.js`).
Built from primitives but jointed like people: hips, knees, shoulders and
elbows on pivots, a body that leans, a helmet with facemask, stripe (BYU)
and side logo, shoulder pads, a jersey canvas wrapped round the torso with
the number on the front and the name and number on the back, pants, socks,
cleats, gloves, a few skin tones. Saturday's uniforms: Utah at home in red,
BYU on the road in white. Poses: linemen in a three-point stance before
the snap and crouched while they block; everyone else in a two-point stance
by position; running strides with arms pumping; the QB cocked once the ball
is snapped and following through when he throws; receivers (either team)
reaching up when the ball is coming down on them; ball carriers tucking it.
Defenders dropping into coverage backpedal, still facing the ball. Drawn
15% big (27% for the man with the ball or the ball coming to him): true
size, they are specks from the broadcast camera. Name tags ("#3 KASPER")
over the QB and receivers before the snap, then over the ball carrier,
the receiver the QB is facing, and the target of a ball in the air. The
TV's report card and banners use the names too ("CAUGHT! #3 Kasper").

**The depth chart** (`rosters.js`): expected starters by slot, researched
2026-11-02 — Utah from Ourlads (updated 2026-10-31) plus Jackson Bennee #23
at nickel; BYU from TWO-DEEP and KSL's game-7 chart. BYU's running back
(Rex here; Moa on TWO-DEEP) and defensive line rotation are the guesses.
Check game week's depth charts and edit the file.

`?local=1` = BroadcastChannel instead of WebRTC (tabs of one browser);
`?seed=N` = the same game every time; `?q=low` = no antialiasing, 1×.
Phones: `?pid=` overrides the stored device id (the check's phones share
one browser's storage).

## The phone (`web/play.html`)

Night Watch's habits: never zoom, motion permission inside a tap (iOS:
the which-hand tap), wake lock, fullscreen + portrait on Android. Screens:
join → (reload) → which hand → lobby / huddle (play cards; SPIKE and TIMEOUT when the
clock runs) / the football pad (laces; arm meter; the report card in
practice) / RUN (tilt) / defence coverage cards / watching / results.
Sends `aim` 20× a second while the ball is in hand so the TV can draw the
arrow and the arm meter.

Protocol, phone → TV: `hello {id,name,team}`, `team`, `cfg {mode,sc,assist}`,
`start`, `again`, `lobby`, `call {play}`, `dcall {cover}`, `snap`,
`throw {h,kind,power,spin,arc,el}` (h = direction from FORWARD, kind = LOB | BULLET; also the kick during a field goal, power only), `steer {x}`,
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

- **Real-phone testing of the throw** (above), on the practice field. Most important.
- Field Goal Frenzy (#5) as its own mode — the kick exists inside the drill
  (`kick`), reading the same flick.
- Hail Mary (#6), Pick-Six (#20), Kickoff Return (#22).
- Posting scores to party-hub's scoreboard (`POST /score`), if party-hub
  gets built.
- Music (Night Watch's `tools/music.py` pipeline could render a brass-band
  piece); player numbers on jerseys; a QB scramble.
- Icons/link preview are a plain SVG football.
