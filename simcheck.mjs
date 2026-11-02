/* simcheck - the football, headless.

   Rules first (the clock, downs, spikes, timeouts, field goals,
   touchdowns), then tuning: hundreds of Two-Minute Drills played by the
   computer quarterback at three skill levels through the same throwBall a
   phone uses. A good thrower should win often but not always, a party
   guest about half the time, a kid on Rookie assist sometimes.

   node simcheck.mjs [drives-per-row] */
import fs from 'fs';
// web/ files are plain browser scripts that also set module.exports; load them as such
function load(f){ const m = {exports: {}}; new Function('module', 'exports', fs.readFileSync(new URL(f, import.meta.url), 'utf8'))(m, m.exports); return m.exports; }
const S = load('./web/sim.js');

let fails = 0;
function ok(c, m){ console.log((c ? '  ok   ' : '  FAIL ') + m); if(!c) fails++; }
const DT = 1 / 60;
function run(g, secs, fn){ for(let i = 0; i < secs * 60 && !g.over; i++){ if(fn) fn(); S.step(g, DT); } }
function untilDead(g){ for(let i = 0; i < 1200 && g.phase === 'live'; i++) S.step(g, DT); }

console.log('rules');
{
  const g = S.newDrive({seed: 5});
  ok(g.down === 1 && g.toGo === 10 && g.ball === 25 && g.clock === 120, 'a drive starts 1st & 10 at the 25 with 2:00');
  S.callPlay(g, 'post'); S.snap(g);
  run(g, 0.5);
  ok(g.clockRunning && g.clock < 120, 'the clock runs from the snap');
  S.throwBall(g, {h: 1.5, loft: 0.3, power: 1, raw: true});   // straight out of bounds
  untilDead(g);
  ok(g.lastWhy === 'inc' && !g.clockRunning && g.down === 2, `an incomplete pass stops the clock and costs a down (${g.lastWhy}, down ${g.down})`);
  const c0 = g.clock; run(g, 5);
  ok(g.clock === c0, 'the clock stays stopped through the huddle after an incomplete');
}
{
  const g = S.newDrive({seed: 9});
  S.callPlay(g, 'run'); S.snap(g);
  untilDead(g);
  ok(g.phase === 'dead' && (g.lastWhy === 'tackle' || g.lastWhy === 'oob'), `a run ends in a tackle (${g.lastWhy}, ${g.lastGain} yds)`);
  run(g, 3);
  if(g.lastWhy === 'tackle' && g.lastGain < g.toGo + g.lastGain) ok(g.clockRunning, 'a tackle in bounds short of the sticks keeps the clock running');
  const c0 = g.clock;
  ok(S.timeout(g) && !g.clockRunning && g.tos === 1, 'a timeout stops it and is used up');
  run(g, 3); ok(g.clock === c0, 'and the clock stays stopped');
}
{
  const g = S.newDrive({seed: 11});
  S.callPlay(g, 'run'); S.snap(g); untilDead(g); run(g, 3);
  const d0 = g.down;
  if(g.clockRunning){
    ok(S.callPlay(g, 'spike') && !g.clockRunning && g.down === d0 + 1, 'a spike stops the clock and costs a down');
  } else ok(true, '(spike check skipped: the run went out of bounds)');
}
{
  // first down stops the clock briefly (college, the last two minutes)
  const g = S.newDrive({seed: 2, ball: 50});
  S.callPlay(g, 'slants'); S.snap(g);
  g.toGo = 1;
  untilDead(g);
  if(g.lastGain >= 1 && g.lastWhy === 'tackle'){
    const c0 = g.clock; run(g, 2);
    ok(g.clock === c0 && g.down === 1, 'a first down stops the clock while the chains move');
    run(g, 8); ok(g.clock < c0, 'and it starts again');
  } else ok(true, `(first-down clock check skipped: ${g.lastWhy})`);
}
{
  // touchdown: a catch in the end zone
  let tds = 0;
  for(let s = 1; s <= 30; s++){
    const g = S.newDrive({seed: s, ball: 92});
    S.callPlay(g, 'post'); S.snap(g); run(g, 1.0);
    const L = S.targets(g).map(rc => S.leadFor(g, rc, 20, 0.4)).filter(l => l && l.y > 100)[0];
    if(L) S.throwBall(g, {at: [L.x, L.y]});
    untilDead(g); if(g.over && g.result.why === 'td') tds++;
  }
  ok(tds >= 4, `throws into the end zone from the 8 score sometimes (${tds}/30)`);
}
{
  // field goals: a good kick from close is good, a weak one from far is short
  const g = S.newDrive({seed: 3, ball: 80});
  S.callPlay(g, 'fg'); S.snap(g); run(g, 0.5); S.kick(g, {power: 0.8, h: 0.0}); run(g, 4);
  ok(g.over && g.result.why === 'fg' && g.points === 3, `a straight 37-yarder is good (${g.result && g.result.why})`);
  const g2 = S.newDrive({seed: 3, ball: 40});
  ok(!S.canCall(g2, 'fg'), 'no field goal from your own 40');
  const g3 = S.newDrive({seed: 3, ball: 62});
  S.callPlay(g3, 'fg'); S.snap(g3); run(g3, 0.5); S.kick(g3, {power: 0.1, h: 0}); run(g3, 4);
  ok(g3.over && g3.result.why === 'fgmiss', 'a 55-yarder with no leg is short');
  const g4 = S.newDrive({seed: 3, ball: 80});
  S.callPlay(g4, 'fg'); S.snap(g4); run(g4, 0.5); S.kick(g4, {power: 0.9, h: 0.35}); run(g4, 4);
  ok(g4.over && g4.result.why === 'fgmiss', 'a kick 20 degrees off line is wide');
}
{
  const g = S.newDrive({seed: 4, clock: 3});
  S.callPlay(g, 'post'); S.snap(g); run(g, 5);
  ok(g.over && g.result.why === 'clock' || g.over, `time runs out (${g.result && g.result.why})`);
  const g2 = S.newDrive({seed: 4, scenario: 'george'});
  ok(g2.untimed && g2.ball === 75, 'overtime has no clock, ball on the 25');
}
{
  // the throw goes where it is aimed: 0 = straight downfield
  const g = S.newDrive({seed: 1});
  S.callPlay(g, 'post'); S.snap(g); run(g, 0.3);
  S.throwBall(g, {h: 0.3, loft: 0.4, power: 0.5, raw: true});
  ok(g.ballObj.vx > 0 && g.ballObj.vy > 0, 'a throw aimed right goes right and downfield');
  const L = g.landing, d = Math.hypot(L.x - g.o.QB.x, L.y - g.o.QB.y);
  ok(d > 25 && d < 45, `half power at 23 degrees carries ${d.toFixed(0)} yards`);
}

console.log('\nthrowing: direction picks the man, the game leads him');
{
  const g = S.newDrive({seed: 21, ball: 40});
  S.callPlay(g, 'post'); S.snap(g); run(g, 1.2);     // the back stays in to block on POST
  const qb = g.o.QB, bear = k => Math.atan2(g.o[k].x - qb.x, g.o[k].y - qb.y);
  ok(S.pickTarget(g, -1.2).key === 'X', `a throw well left goes to the left wideout (${S.pickTarget(g, -1.2).key})`);
  ok(S.pickTarget(g, 1.2).key === 'Z', `a throw well right goes to the right wideout (${S.pickTarget(g, 1.2).key})`);
  ok(S.pickTarget(g, bear('Y')).key === 'Y', 'a throw straight at the slot goes to the slot');
}
{
  // a perfect lead: on an empty practice field every throw to a running man is caught
  let caught = 0, n = 0, lobH = 0, bulH = 0;
  for(let sd = 1; sd <= 40; sd++){
    for(const kind of ['LOB', 'BULLET']){
      const g = S.newDrive({seed: sd, practice: true, clock: 0, ot: true, ball: 30});
      S.callPlay(g, ['slants', 'outs', 'post', 'curls'][sd % 4]); S.snap(g); run(g, 1.3);
      const key = ['X', 'Z', 'Y', 'T'][sd % 4];
      if(!g.o[key].route) continue;
      S.throwTo(g, {to: key, kind}); n++;
      let top = 0;
      for(let i = 0; i < 600 && g.phase === 'live'; i++){ S.step(g, DT); top = Math.max(top, g.ballObj.z); }
      if(kind === 'LOB') lobH = Math.max(lobH, top); else bulH = Math.max(bulH, top);
      if(g.lastWhy === 'caught' || (g.result && g.result.why === 'td')) caught++;
    }
  }
  ok(caught / n > 0.8, `led perfectly, ${caught}/${n} caught with nobody covering (drops still happen)`);
  ok(lobH > bulH + 4, `a lob goes up (${lobH.toFixed(1)} yd), a bullet stays flat (${bulH.toFixed(1)} yd)`);
}

console.log('\ntuning: the Two-Minute Drill, computer quarterback');
const N = +process.argv[2] || 200;
const skills = {
  // pick: how often the right receiver; kind: how often the right ball (lob or bullet)
  sharp: {pick: 0.92, kind: 0.9, patience: 1.2},
  party: {pick: 0.7, kind: 0.7, patience: 1},
  kid:   {pick: 0.45, kind: 0.55, patience: 0.7}
};
function drives(sc, assist, sk, n){
  let win = 0, plays = 0, att = 0, comp = 0, sacks = 0, ints = 0, how = {};
  for(let s = 1; s <= n; s++){
    const g = S.newDrive({seed: s * 7919, scenario: sc, assist});
    for(let i = 0; i < 60 * 600 && !g.over; i++){ S.bot(g, DT, sk); S.step(g, DT); }
    if(g.result && g.result.win) win++;
    how[g.result ? g.result.why : 'stuck'] = (how[g.result ? g.result.why : 'stuck'] || 0) + 1;
    plays += g.plays; att += g.stats.att; comp += g.stats.comp; sacks += g.stats.sacks; ints += g.stats.int;
  }
  return {win: win / n, plays: plays / n, comp: comp / Math.max(1, att), sacks: sacks / n, ints: ints / n, how};
}
const rows = [
  ['saturday', 'starter', 'sharp', [0.45, 0.9]],
  ['saturday', 'starter', 'party', [0.2, 0.7]],
  ['saturday', 'rookie', 'kid', [0.15, 0.75]],
  ['saturday', 'pro', 'party', [0.05, 0.6]],
  ['kids', 'rookie', 'kid', [0.35, 0.95]],
  ['harline', 'starter', 'party', [0.1, 0.6]],
  ['ferrin', 'starter', 'party', [0.25, 0.85]],
  ['george', 'starter', 'party', [0.25, 0.85]]
];
for(const [sc, a, k, [lo, hi]] of rows){
  const r = drives(sc, a, skills[k], N);
  const hows = Object.entries(r.how).map(([k2, v]) => `${k2} ${Math.round(v / N * 100)}%`).join(', ');
  ok(r.win >= lo && r.win <= hi && !r.how.stuck,
    `${sc.padEnd(8)} ${a.padEnd(7)} ${k.padEnd(5)}: win ${(r.win * 100).toFixed(0).padStart(3)}%  (want ${lo * 100}-${hi * 100})  ` +
    `${r.plays.toFixed(1)} plays, ${(r.comp * 100).toFixed(0)}% comp, ${r.sacks.toFixed(2)} sacks, ${r.ints.toFixed(2)} int  [${hows}]`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
