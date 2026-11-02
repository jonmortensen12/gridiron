/* throwcheck - the throw reader against throws whose answer is known.

   Builds a phone's true pose through a throw (held like a ball, the nose
   pointing where it goes, an overhand arc, a spiral), turns it into the
   events a phone would fire (gyro rates in the phone's own frame, the
   browser's orientation lagging behind), and checks what throw.js reads
   back: heading, loft, power, spin. Also: a pump fake is not a throw, the
   spike is seen, a soft lob is soft, and the TV can be anywhere on the
   compass (including across the +-180 seam).

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

/* Pose with the nose at heading H (radians, clockwise from north), elevation e, rolled by r about the nose. */
function pose(H, e, r){
  const f = [Math.sin(H), Math.cos(H), 0], u = [0, 0, 1], a = cross(u, f);
  const base = fromFrame(cross(f, u), f, u);                 // screen up, nose forward
  return T.qmul(T.qmul(T.qaxis(a[0], a[1], a[2], -e), base), T.qaxis(0, 1, 0, r));
}

/* Feed a pose trajectory to a ThrowSense. path(t) -> {q, acc}. Returns at release. */
function run(s, path, t0, t1, releaseAt, opts = {}){
  const dt = 1 / 60;
  let prev = path(t0).q, result, lagQ = prev;
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
    if(releaseAt != null && result === undefined && t >= releaseAt) result = s.up(t * 1000);
    prev = q;
  }
  return result;
}
function slerp(a, b, t){
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  if(d < 0){ b = b.map(v => -v); }
  const q = a.map((v, i) => v + (b[i] - v) * t), n = Math.hypot(...q);
  return q.map(v => v / n);
}

function throwAt(tvH, offsetDeg, opts = {}){
  const s = new T.ThrowSense();
  const H = tvH + offsetDeg * D;
  // aim at the TV, lock
  run(s, () => ({q: pose(tvH, 0.1, 0), acc: 0}), 0, 0.8);
  s.lock();
  // cock the arm: nose up and back over the shoulder
  const cock = opts.cock || 75 * D, through = opts.through || -30 * D, dur = opts.dur || 0.18;
  const spin = opts.spin || 0;
  const path = t => {
    if(t < 1.0){ const k = Math.min(1, (t - 0.8) / 0.2); return {q: pose(tvH + (H - tvH) * k, 0.1 + (cock - 0.1) * k, 0), acc: 2}; }
    if(t < 1.3) return {q: pose(H, cock, 0), acc: 0.2};
    const u = Math.min(1, (t - 1.3) / dur), sm = u * u * (3 - 2 * u);
    return {q: pose(H, cock + (through - cock) * sm, spin * sm), acc: (opts.acc || 24) * Math.sin(Math.PI * Math.min(1, u))};
  };
  s.down();
  // release when the nose passes the release elevation
  const relE = opts.release != null ? opts.release : 15 * D;
  const uRel = (cock - relE) / (cock - through);
  // invert smoothstep
  let lo = 0, hi = 1;
  for(let i = 0; i < 40; i++){ const m = (lo + hi) / 2, sm = m * m * (3 - 2 * m); if(sm < uRel) lo = m; else hi = m; }
  const tRel = 1.3 + lo * dur;
  run(s, path, 0.8, 1.3, null, opts);
  return run(s, path, 1.3, 1.3 + dur + 0.1, tRel, opts);
}

console.log('throw reader');
for(const [tv, off] of [[0, 20], [70, -15], [175, 12], [-100, 0], [200, -30]]){
  const r = throwAt(tv * D, off);
  ok(r && Math.abs(r.h / D - off) < 4, `TV at ${tv} deg, thrown ${off} deg: read ${r ? (r.h / D).toFixed(1) : 'nothing'} deg`);
}
{
  const r = throwAt(30 * D, 0);
  ok(r && r.power > 0.6, `a hard throw is hard: power ${r && r.power.toFixed(2)} (arc ${r && r.arc} deg/s)`);
  ok(r && r.loft / D > 18 && r.loft / D < 30, `released with the nose at 15 deg: loft ${r && (r.loft / D).toFixed(1)} deg`);
}
{
  const early = throwAt(0, 0, {release: 50 * D}), late = throwAt(0, 0, {release: -5 * D});
  ok(early && late && early.loft > late.loft + 15 * D, `early release lobs, late release is flat: ${early && (early.loft / D).toFixed(0)} vs ${late && (late.loft / D).toFixed(0)} deg`);
}
{
  const soft = throwAt(0, 0, {dur: 0.5, acc: 6});
  ok(soft && soft.power < 0.35, `a soft toss is soft: power ${soft && soft.power.toFixed(2)}`);
}
{
  const sp = throwAt(0, 10, {spin: 4 * Math.PI}), none = throwAt(0, 10, {spin: 0});
  ok(sp && sp.spin > 0.5 && none.spin < 0.05, `a spiral reads as spin: ${sp && sp.spin.toFixed(2)} vs ${none && none.spin.toFixed(2)}`);
  ok(sp && Math.abs(sp.h / D - 10) < 5, `the spiral does not move the aim: ${sp && (sp.h / D).toFixed(1)} deg`);
}
{
  const b = throwAt(0, 10, {bias: 3});
  ok(b && Math.abs(b.h / D - 10) < 5, `a gyro with a 3 deg/s bias still aims: ${b && (b.h / D).toFixed(1)} deg`);
}
{
  // pump fake: thumb comes up with the phone barely moving
  const s = new T.ThrowSense();
  run(s, t => ({q: pose(0, 0.3 + 0.05 * Math.sin(t * 3), 0), acc: 0.5}), 0, 1);
  s.lock(); s.down();
  const r = run(s, t => ({q: pose(0, 0.3 + 0.05 * Math.sin(t * 3), 0), acc: 0.5}), 1, 1.5, 1.4);
  ok(r === null, 'a pump fake (thumb up, no throw) is not a throw');
}
{
  // the spike: not holding, nose flung at the floor
  let spiked = 0;
  const s = new T.ThrowSense({onSpike: () => spiked++});
  run(s, () => ({q: pose(0, 0.2, 0), acc: 0}), 0, 0.5);
  run(s, t => { const u = Math.min(1, (t - 0.5) / 0.15); return {q: pose(0, 0.2 - u * 1.6, 0), acc: 20 * Math.sin(Math.PI * u)}; }, 0.5, 0.8);
  ok(spiked === 1, `the spike gesture is seen once (${spiked})`);
  const s2 = new T.ThrowSense({onSpike: () => spiked++});
  spiked = 0;
  run(s2, t => ({q: pose(0, 0.2 - Math.min(1, t) * 1.5, 0), acc: 0.3}), 0, 2);
  ok(spiked === 0, 'slowly pointing the phone at the floor is not a spike');
}
{
  // locking with the phone held up like a remote (nose to the ceiling, back toward the TV)
  const s = new T.ThrowSense();
  const tv = 40 * D;
  const f = [Math.sin(tv), Math.cos(tv), 0], u = [0, 0, 1];
  // tipped back 10 degrees: exactly upright is the gimbal point of the browser's angles
  const c = Math.cos(10 * D), sn = Math.sin(10 * D);
  const y = [-f[0] * sn, -f[1] * sn, c], z = [-f[0] * c, -f[1] * c, -sn];
  const q = fromFrame(cross(y, z), y, z);
  run(s, () => ({q, acc: 0}), 0, 0.5);
  s.lock();
  const a = s.aim();
  ok(Math.abs(a.h) < 0.05 && Math.abs(T.pointing(s.q).h - tv) < 0.05, `LOCK with the phone upright points at the TV (${(T.pointing(s.q).h / D).toFixed(1)} deg)`);
}
{
  const sw = T.swipeThrow(60, -300, 120, 400), weak = T.swipeThrow(2, -10, 300, 400);
  ok(sw && sw.h > 0.1 && sw.power > 0.5, `a fast swipe up and to the right: h ${sw && (sw.h / D).toFixed(0)} deg, power ${sw && sw.power.toFixed(2)}`);
  ok(weak === null, 'a tap is not a swipe');
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
