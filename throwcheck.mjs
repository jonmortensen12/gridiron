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
    s.motion(rate, {x: acc * 0.6, y: acc * 0.8, z: 0}, null, dt, t * 1000);
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
function ready(F, hand = 'right', tilt = 0.1){
  const f = [Math.sin(F), Math.cos(F), 0], u = [0, 0, 1];
  const side = cross(f, u);                                   // the right
  const n = hand === 'left' ? side.map(v => -v) : side;
  const nose = [n[0] * Math.cos(tilt), n[1] * Math.cos(tilt), -Math.sin(tilt)];
  const y = nose.map(v => -v);
  const z0 = cross(cross(y, u), y);                           // screen as close to up as it can be
  const zn = Math.hypot(...z0), z = z0.map(v => v / zn);
  return fromFrame(cross(y, z), y, z);
}
function qlerp(a, b, k){ return slerp(a, b, k); }

/* A whole play: ready (facing F), hike, turn toward F + off, throw. Returns
   {hikes, throws, s}. opts: hand, cock/through/dur/acc/spin (the throw),
   hikeDur (how fast it comes up), unarmed (the game is not asking). */
function play(F, off, opts = {}){
  const hikes = [], throws = [];
  const s = new T.ThrowSense({hand: opts.hand, onHike: h => { hikes.push(h); s.arm('throw'); }, onThrow: r => throws.push(r)});
  const R = ready(F, opts.hand), H = F + off * D;
  const cock = opts.cock != null ? opts.cock : 70 * D, through = opts.through != null ? opts.through : -30 * D;
  const dur = opts.dur || 0.18, hd = opts.hikeDur || 0.2, spin = opts.spin || 0;
  const C0 = pose(F, cock), C1 = pose(H, cock);
  const path = t => {
    if(t < 0.8) return {q: R, acc: 0};
    if(t < 0.8 + hd){ const k = (t - 0.8) / hd; return {q: qlerp(R, C0, k * k * (3 - 2 * k)), acc: 10 * Math.sin(Math.PI * k)}; }
    if(t < 1.6) return {q: C0, acc: 0.2};
    if(t < 1.9){ const k = (t - 1.6) / 0.3; return {q: qlerp(C0, C1, k * k * (3 - 2 * k)), acc: 1}; }
    if(t < 2.1) return {q: C1, acc: 0.2};
    const u = Math.min(1, (t - 2.1) / dur), sm = u * u * (3 - 2 * u);
    return {q: pose(H, cock + (through - cock) * sm, spin * sm), acc: (opts.acc != null ? opts.acc : 24) * Math.sin(Math.PI * u)};
  };
  if(!opts.unarmed) s.arm('hike');
  run(s, path, 0, 2.1 + dur + 0.6, opts);
  return {hikes, throws, s};
}
const deg = r => (r / D).toFixed(1);
const near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) < tol;

console.log('the hike sets FORWARD');
for(const hand of ['right', 'left']){
  for(const F of [0, 70, 175, -100]){
    const {hikes} = play(F * D, 0, {hand});
    ok(hikes.length === 1 && near(hikes[0].h0 / D, F, 6), `${hand}-hander facing ${F} deg: one hike, forward read as ${hikes[0] ? deg(hikes[0].h0) : 'nothing'} deg`);
  }
}
{
  // a tap instead: looking at the screen, phone upright and tipped back a little
  const F = 40 * D, f = [Math.sin(F), Math.cos(F), 0], c = Math.cos(15 * D), sn = Math.sin(15 * D);
  const y = [-f[0] * sn, -f[1] * sn, c], z = [-f[0] * c, -f[1] * c, -sn];
  const s = new T.ThrowSense();
  run(s, () => ({q: fromFrame(cross(y, z), y, z), acc: 0}), 0, 0.5);
  s.hikeNow(500);
  ok(near(s.h0 / D, 40, 5), `a tap to hike while looking at the screen: forward is where the back of the phone faces (${deg(s.h0)} deg)`);
}
{
  const slow = play(0, 0, {hikeDur: 1.6});
  ok(slow.hikes.length === 0, 'bringing the phone up slowly is not a hike');
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
  const lob = play(0, 0, {cock: 100 * D, through: 5 * D, dur: 0.32, acc: 9}).throws[0];
  const bullet = play(0, 0, {cock: 55 * D, through: -55 * D, dur: 0.13, acc: 30}).throws[0];
  ok(lob && lob.kind === 'LOB', `a high, easy release is a LOB: ${lob && lob.kind} (power ${lob && lob.power.toFixed(2)}, nose ${lob && lob.el} deg)`);
  ok(bullet && bullet.kind === 'BULLET', `a level, fast release is a BULLET: ${bullet && bullet.kind} (power ${bullet && bullet.power.toFixed(2)}, nose ${bullet && bullet.el} deg)`);
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
