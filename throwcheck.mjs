/* throwcheck - the throw reader against hikes and throws whose answer is known.

   The phone is the ball, its BOTTOM is the nose. Builds a phone's true pose
   through a play - the ready pose (held low in front, nose across the body
   to the throwing side), the hike (brought up fast to the throwing spot),
   a turn toward a receiver, the overhand throw - turns it into the events
   a phone would fire (gyro rates in the phone's own frame, the browser's
   orientation lagging behind), and checks what throw.js sees with no
   button: FORWARD from the hike, for right- and left-handers, facing
   anywhere on the compass; one throw per throw; which way it went; LOB or
   BULLET; power; spin. And what must not count: a slow lift as a hike, a
   wind-up, waving, lowering the phone, anything not armed. The spike, and
   the swipe fallback.

   node throwcheck.mjs */
import fs from 'fs';
// web/ files are plain browser scripts that also set module.exports; load them as such
function load(f){ const m = {exports: {}}; new Function('module', 'exports', fs.readFileSync(new URL(f, import.meta.url), 'utf8'))(m, m.exports); return m.exports; }
const T = load('./web/throw.js');
const D = Math.PI / 180;

let fails = 0;
function ok(cond, msg){ console.log((cond ? '  ok   ' : '  FAIL ') + msg); if(!cond) fails++; }

function cross(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
/* quaternion from an orthonormal frame: device x, y, z in world */
function fromFrame(x, y, z){
  const m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let w, qx, qy, qz;
  if(tr > 0){ const s = Math.sqrt(tr + 1) * 2; w = s / 4; qx = (m[2][1] - m[1][2]) / s; qy = (m[0][2] - m[2][0]) / s; qz = (m[1][0] - m[0][1]) / s; }
  else if(m[0][0] > m[1][1] && m[0][0] > m[2][2]){ const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; qx = s / 4; qy = (m[0][1] + m[1][0]) / s; qz = (m[0][2] + m[2][0]) / s; }
  else if(m[1][1] > m[2][2]){ const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; qx = (m[0][1] + m[1][0]) / s; qy = s / 4; qz = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; qx = (m[0][2] + m[2][0]) / s; qy = (m[1][2] + m[2][1]) / s; qz = s / 4; }
  return [w, qx, qy, qz];
}
function toEuler(q){
  const [w, x, y, z] = q;
  const R01 = 2*(x*y - w*z), R11 = 1 - 2*(x*x + z*z), R21 = 2*(y*z + w*x), R20 = 2*(x*z - w*y), R22 = 1 - 2*(x*x + y*y);
  return {alpha: Math.atan2(-R01, R11) / D, beta: Math.asin(Math.max(-1, Math.min(1, R21))) / D, gamma: Math.atan2(-R20, R22) / D};
}
function conj(q){ return [q[0], -q[1], -q[2], -q[3]]; }

/* Feed a pose trajectory to a ThrowSense. path(t) -> {q, acc}. */
function run(s, path, t0, t1, opts = {}){
  const dt = 1 / 60;
  let prev = path(t0).q, lagQ = prev;
  for(let t = t0; t <= t1 + 1e-9; t += dt){
    const {q, acc} = path(t);
    // body rates: 2 * conj(prev) * q / dt
    const dq = T.qmul(conj(prev), q);
    const sgn = dq[0] < 0 ? -1 : 1;
    const ang = 2 * Math.acos(Math.min(1, Math.abs(dq[0])));
    const sn = Math.sqrt(Math.max(1e-12, 1 - dq[0] * dq[0]));
    const w = ang / dt / D;
    const ax = sgn * dq[1] / sn, ay = sgn * dq[2] / sn, az = sgn * dq[3] / sn;
    const rate = ang < 1e-9 ? {alpha: 0, beta: 0, gamma: 0} : {alpha: ax * w + (opts.bias || 0), beta: ay * w, gamma: az * w};
    // the browser's orientation trails the truth (it is smoothed)
    lagQ = slerp(lagQ, q, 0.15);
    const eu = toEuler(lagQ);
    s.orientation(eu.alpha, eu.beta, eu.gamma);
    s.motion(rate, {x: acc * 0.6, y: acc * 0.8, z: 0}, null, dt, (t + (s.__off || 0)) * 1000);   // one phone's clock runs on across plays
    prev = q;
  }
}
function slerp(a, b, t){
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  if(d < 0){ b = b.map(v => -v); }
  const q = a.map((v, i) => v + (b[i] - v) * t), n = Math.hypot(...q);
  return q.map(v => v / n);
}

/* Throwing pose: the nose (bottom of the phone) at heading H, elevation e, rolled r about the nose. */
function pose(H, e, r = 0){
  const f = [Math.sin(H), Math.cos(H), 0], u = [0, 0, 1], a = cross(u, f);
  const y = f.map(v => -v), z = u;                            // nose forward, screen up
  const base = fromFrame(cross(y, z), y, z);
  return T.qmul(T.qmul(T.qaxis(a[0], a[1], a[2], -e), base), T.qaxis(0, 1, 0, r));
}
/* Ready pose: held low in front, facing F, nose across the body to the throwing side, a little tilt. */
/* Ready pose: held low in front, facing F. grip:
     'up'      nose (bottom) to the throwing side, screen up
     'toward'  nose to the throwing side, screen facing you (palm in, back of the hand out)
     'away'    nose to the throwing side, screen facing forward
     'down'    nose to the throwing side but pointing well down, screen toward you
     'palmout' hand turned round: the nose to the OTHER side, screen up */
function ready(F, hand = 'right', grip = 'toward'){
  const f = [Math.sin(F), Math.cos(F), 0], u = [0, 0, 1];
  let side = cross(f, u);                                     // the right
  if(hand === 'left') side = side.map(v => -v);
  if(grip === 'palmout') side = side.map(v => -v);
  const tilt = grip === 'down' ? 60 * D : 0.1;
  const nose = [side[0] * Math.cos(tilt), side[1] * Math.cos(tilt), -Math.sin(tilt)];
  const y = nose.map(v => -v);
  const want = grip === 'toward' || grip === 'down' ? f.map(v => -v) : grip === 'away' ? f : u;
  const z0 = cross(cross(y, want), y).map(v => -v);           // the screen as near to `want` as it can be
  const zn = Math.hypot(...z0), z = z0.map(v => v / zn);
  return fromFrame(cross(y, z), y, z);
}
function qlerp(a, b, k){ return slerp(a, b, k); }

/* A whole play: ready (facing F), hike, turn toward F + off, throw. Returns
   {hikes, throws, s}. opts: hand, grip (see ready), cock/through/dur/acc/
   spin (the throw), hikeDur (how fast it comes up), unarmed (the game is not
   asking), sense (reuse one, as a phone does all night). */
function play(F, off, opts = {}){
  const hikes = [], throws = [];
  const s = opts.sense || new T.ThrowSense({hand: opts.hand});
  s.onHike = h => { hikes.push(h); s.arm('throw'); }; s.onThrow = r => throws.push(r);
  const R = ready(F, opts.hand, opts.grip), H = F + off * D;
  const cock = opts.cock != null ? opts.cock : 70 * D, through = opts.through != null ? opts.through : -30 * D;
  const dur = opts.dur || 0.18, hd = opts.hikeDur || 0.2, spin = opts.spin || 0;
  const C0 = pose(F, 60 * D), C1 = pose(H, cock);           // the hike ends cocked normally; any bigger wind-up comes after
  const path = t => {
    if(t < 0.8) return {q: R, acc: 0};
    if(t < 0.8 + hd){ const k = (t - 0.8) / hd; return {q: qlerp(R, C0, k * k * (3 - 2 * k)), acc: 2 / hd * Math.sin(Math.PI * k)}; }
    if(t < 1.6) return {q: C0, acc: 0.2};
    if(t < 1.9){ const k = (t - 1.6) / 0.3; return {q: qlerp(C0, C1, k * k * (3 - 2 * k)), acc: 1}; }
    if(t < 2.1) return {q: C1, acc: 0.2};
    const u = Math.min(1, (t - 2.1) / dur), sm = u * u * (3 - 2 * u);
    return {q: pose(H, cock + (through - cock) * sm, spin * sm), acc: (opts.acc != null ? opts.acc : 24) * Math.sin(Math.PI * u)};
  };
  s.arm(opts.unarmed ? null : 'hike');
  run(s, path, 0, 2.1 + dur + 0.6, opts);
  s.arm(null);
  s.__off = (s.__off || 0) + 10;
  return {hikes, throws, s};
}
const deg = r => (r / D).toFixed(1);
const near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) < tol;

console.log('the hike, and FORWARD from it, for every grip');
for(const hand of ['right', 'left']){
  for(const grip of ['toward', 'up', 'away', 'down', 'palmout']){
    for(const F of [0, 120, -100]){
      const {hikes, throws, s: sn} = play(F * D, 30 * (hand === 'left' ? -1 : 1), {hand, grip});
      const want = 30 * (hand === 'left' ? -1 : 1);
      const good = hikes.length === 1 && throws.length === 1 && near(throws[0].h / D, want, 8);
      if(!good || F === 0) ok(good, `${hand}-hander, ${grip.padEnd(7)}, facing ${String(F).padStart(4)}: hiked ${hikes.length}x, ` +
        `throw ${want} deg read as ${throws[0] ? deg(throws[0].h) : 'nothing'} (forward settled at ${deg(sn.h0)}, flip ${!!sn.flip})`);
    }
  }
}
{
  // the grip is remembered: palm out once, the next hike guesses the right way at once
  const s = new T.ThrowSense({hand: 'right'});
  play(0, 0, {grip: 'palmout', sense: s});
  const h = []; s.onHike = x => h.push(x); s.arm('hike');
  run(s, () => ({q: ready(50 * D, 'right', 'palmout'), acc: 0}), 0, 0.6);
  run(s, t => { const k = Math.min(1, (t - 0.6) / 0.2); return {q: slerp(ready(50 * D, 'right', 'palmout'), pose(50 * D, 70 * D), k), acc: 9 * Math.sin(Math.PI * k)}; }, 0.6, 0.85);
  ok(h.length === 1 && near(h[0].h0 / D, 50, 8), `a palm-out thrower's next hike is right straight away (${h[0] ? deg(h[0].h0) : '-'} deg)`);
}
{
  // a tap instead: looking at the screen, phone upright and tipped back a little; then cocked
  const F = 40 * D, f = [Math.sin(F), Math.cos(F), 0], c = Math.cos(15 * D), sn = Math.sin(15 * D);
  const y = [-f[0] * sn, -f[1] * sn, c], z = [-f[0] * c, -f[1] * c, -sn];
  const q0 = fromFrame(cross(y, z), y, z), s = new T.ThrowSense();
  run(s, () => ({q: q0, acc: 0}), 0, 0.5);
  s.hikeNow(500);
  run(s, t => ({q: slerp(q0, pose(F, 70 * D), Math.min(1, (t - 0.5) / 0.3)), acc: 2}), 0.5, 1.8);
  ok(near(s.h0 / D, 40, 8), `a tap to hike, then up to the throwing spot: forward ${deg(s.h0)} deg (facing 40)`);
}
{
  const sl = [], ss = new T.ThrowSense({onHike: x => sl.push(x)});
  ss.arm('hike');
  run(ss, t => { const k = Math.max(0, Math.min(1, (t - 0.8) / 1.6)), sm = k * k * (3 - 2 * k);
    return {q: slerp(ready(0), pose(0, 60 * D), sm), acc: 1.2 * Math.sin(Math.PI * k)}; }, 0, 3.2);
  ok(sl.length === 0, 'bringing the phone up slowly (1.6 s) is not a hike');
  const h = [], s = new T.ThrowSense({onHike: x => h.push(x)});
  s.arm('hike');
  run(s, t => ({q: T.qmul(T.qaxis(0, 0, 1, Math.sin(t * 9) * 0.9), ready(0)), acc: 6}), 0, 1.5);
  ok(h.length === 0, 'waving the phone about without ever holding still is not a hike');
  run(s, () => ({q: ready(0), acc: 0}), 1.5, 2.2);
  run(s, t => ({q: slerp(ready(0), pose(0, -0.2), Math.min(1, (t - 2.2) / 0.1) * 0.4), acc: 8}), 2.2, 2.6);
  ok(h.length === 0, 'a quick jiggle from the ready pose (well under 45 degrees) is not a hike');
}
{
  // a fast thrower: the throw starts 0.2 s after the hike, before the nose has had time to settle
  const hikes = [], throws = [], s = new T.ThrowSense({onHike: x => { hikes.push(x); s.arm('throw'); }, onThrow: r => throws.push(r)});
  s.arm('hike');
  const R = ready(0, 'right', 'toward'), C0 = pose(25 * D, 70 * D);
  run(s, t => {
    if(t < 0.6) return {q: R, acc: 0};
    if(t < 0.8) return {q: slerp(R, C0, (t - 0.6) / 0.2), acc: 9};
    if(t < 0.95) return {q: C0, acc: 0.5};
    const u = Math.min(1, (t - 0.95) / 0.18); return {q: pose(25 * D, 70 * D - 100 * D * u * u * (3 - 2 * u)), acc: 24 * Math.sin(Math.PI * u)};
  }, 0, 1.6);
  ok(throws.length === 1 && near(throws[0].h / D, 25, 10), `hike and throw in one motion: the throw ${throws[0] ? deg(throws[0].h) : 'missing'} deg (want 25)`);
}

console.log('throws: which way, lob or bullet');
for(const off of [0, 25, -40, 60, -65]){
  const {throws} = play(30 * D, off);
  ok(throws.length === 1 && near(throws[0].h / D, off, 8), `thrown ${off} deg from forward: one throw, read ${throws[0] ? deg(throws[0].h) : 'nothing'} deg`);
}
{
  const {throws} = play(0, 20, {hand: 'left'});
  ok(throws.length === 1 && near(throws[0].h / D, 20, 8), `a left-hander's throw 20 deg right: read ${throws[0] ? deg(throws[0].h) : 'nothing'} deg`);
}
{
  // one phone, all night: your normal throws are bullets, an easier one is a lob
  const s = new T.ThrowSense({hand: 'right'});
  const kinds = [];
  for(let i = 0; i < 4; i++) kinds.push(play(0, 0, {sense: s}).throws[0]);
  const easy = play(0, 0, {sense: s, dur: 0.32, acc: 8}).throws[0];
  const high = play(0, 0, {sense: s, cock: 110 * D, through: 20 * D}).throws[0];
  const again = play(0, 0, {sense: s}).throws[0];
  ok(kinds.every(k => k && k.kind === 'BULLET'), `your normal hard throws are BULLETs (${kinds.map(k => k && k.kind).join(', ')})`);
  ok(easy && easy.kind === 'LOB', `an easier throw than your usual is a LOB: ${easy && easy.kind} (${easy && easy.arc} vs usual ${easy && easy.usual} deg/s)`);
  ok(high && high.kind === 'LOB', `a hard throw released with the nose high is a LOB: ${high && high.kind} (nose ${high && high.el} deg)`);
  ok(again && again.kind === 'BULLET', `and the next normal throw is a bullet again: ${again && again.kind}`);
  const first = play(0, 0, {dur: 0.4, acc: 6}).throws[0];
  ok(first && first.kind === 'LOB', `a soft first throw of the night lobs: ${first && first.kind} (${first && first.arc} deg/s)`);
  const hard = play(0, 0).throws[0], soft = play(0, 0, {dur: 0.4, acc: 6}).throws[0];
  ok(hard && soft && hard.power > 0.6 && soft.power < 0.4, `a hard throw is hard (${hard && hard.power.toFixed(2)}), a soft toss soft (${soft && soft.power.toFixed(2)})`);
  const sp = play(0, 10, {spin: 4 * Math.PI}).throws[0];
  ok(sp && sp.spin > 0.5 && near(sp.h / D, 10, 8), `a spiral reads as spin (${sp && sp.spin.toFixed(2)}) and does not move the direction (${sp && deg(sp.h)} deg)`);
  const b = play(0, 10, {bias: 3}).throws[0];
  ok(b && near(b.h / D, 10, 8), `a gyro with a 3 deg/s bias: ${b && deg(b.h)} deg`);
}

console.log('not throws');
{
  const un = play(0, 0, {unarmed: true});
  ok(un.hikes.length === 0 && un.throws.length === 0, 'nothing counts while the game is not asking');
  ok(play(0, 0, {dur: 1.2, acc: 1}).throws.length === 0, 'lowering the phone slowly is not a throw');
  // armed for a throw: a fast wind-up (nose up and back, past straight up), then waving
  const seen = [], s = new T.ThrowSense({onThrow: r => seen.push(r)});
  run(s, () => ({q: pose(0, 0.1), acc: 0}), 0, 0.5); s.h0 = 0; s.arm('throw');
  run(s, t => { const k = Math.min(1, (t - 0.5) / 0.15); return {q: pose(0, 0.1 + 1.9 * k), acc: 12}; }, 0.5, 1.2);
  ok(seen.length === 0, 'a fast wind-up is not a throw');
  const w = new T.ThrowSense({onThrow: r => seen.push(r)});
  run(w, () => ({q: pose(0, 0.1), acc: 0}), 0, 0.5); w.h0 = 0; w.arm('throw');
  run(w, t => ({q: pose(Math.sin((t - 0.5) * 14) * 0.9, 0.1), acc: 8}), 0.5, 1.7);
  ok(seen.length === 0, 'waving the phone side to side is not a throw');
  // armed for the hike: waving the ready pose about is not a hike
  const hk = [], h = new T.ThrowSense({onHike: x => hk.push(x)});
  h.arm('hike');
  run(h, t => ({q: T.qmul(T.qaxis(0, 0, 1, Math.sin(t * 12) * 0.8), ready(0)), acc: 6}), 0, 1.5);
  ok(hk.length === 0, 'swinging the phone around in the ready pose (no lift) is not a hike');
}
{
  let spiked = 0;
  const s = new T.ThrowSense({onSpike: () => spiked++});
  run(s, () => ({q: pose(0, 0.2), acc: 0}), 0, 0.5);
  run(s, t => { const u = Math.min(1, (t - 0.5) / 0.15); return {q: pose(0, 0.2 - u * 1.6), acc: 20 * Math.sin(Math.PI * u)}; }, 0.5, 0.8);
  ok(spiked === 1, `the spike (nose flung at the floor) is seen once (${spiked})`);
  spiked = 0;
  const s2 = new T.ThrowSense({onSpike: () => spiked++});
  run(s2, t => ({q: pose(0, 0.2 - Math.min(1, t) * 1.5), acc: 0.3}), 0, 2);
  ok(spiked === 0, 'slowly pointing the nose at the floor is not a spike');
}
{
  const fast = T.swipeThrow(60, -300, 120, 400), slow = T.swipeThrow(-80, -200, 500, 400), tap = T.swipeThrow(2, -10, 300, 400);
  ok(fast && fast.h > 0.1 && fast.kind === 'BULLET', `a fast swipe up and right: ${fast && deg(fast.h)} deg, ${fast && fast.kind}`);
  ok(slow && slow.h < -0.1 && slow.kind === 'LOB', `a slow swipe up and left: ${slow && deg(slow.h)} deg, ${slow && slow.kind}`);
  ok(tap === null, 'a tap is not a swipe');
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
