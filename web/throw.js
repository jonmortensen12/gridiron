/* Gridiron - the throw reader. The phone is the football.

   Hold the phone like the ball: the TOP of the phone is the nose. Throw it
   (keep hold of the phone!) and the motion alone is the throw - no button.
   It is seen as the phone spinning forward (toward the TV) fast while the game
   has the reader armed (ball in hand). The release is the peak of the arm:

     h      heading of the nose through the fast part of the arc, relative
            to LOCK (pointing at the TV), radians, + = right. The overhand
            arc swings the nose up and down in the plane of the throw, so
            its heading holds still there even though its pitch does not.
     loft   lob or bullet: the nose's pitch at the peak and the arm speed.
            A high release with an easy arm is a lob; a level release with
            a fast arm is a bullet. kind = LOB | TOUCH | BULLET.
     power  arm speed: peak turning rate across the arc (not the roll) and
            peak hand acceleration.
     spin   the peak roll rate about the nose: a spiral.

   Orientation: the browser's fused orientation is smoothed and too slow
   for a throw (and its Euler angles hit a gimbal point where a wind-up
   stops), so the pose is the gyro integrated per devicemotion event,
   pulled gently toward the browser's orientation only while the phone is
   nearly still. Written from dry-fly-phone's rodsense.js notes (that repo
   was not reachable from the session that wrote this). Its facts kept:
     - rotationRate.alpha is about the phone's x axis, beta y, gamma z
       (some spec text says otherwise; following that drifted 91 degrees);
     - the accelerometer's sign differs between iOS and Android, so only
       magnitudes are used here.

   Pure: no DOM. Feed it events; throws arrive at onThrow. throwcheck.mjs
   drives it with synthetic throws. */
(function(root){
'use strict';
var D2R = Math.PI / 180;

/* ---- quaternions [w, x, y, z] ---- */
function qmul(a, b){
  return [a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
          a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
          a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
          a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0]];
}
function qnorm(q){ var n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0]/n, q[1]/n, q[2]/n, q[3]/n]; }
function qaxis(ax, ay, az, ang){ var s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax * s, ay * s, az * s]; }
function qrot(q, v){
  var p = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
}
function qslerp(a, b, t){
  var d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  if(d < 0){ b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if(d > 0.9995) return qnorm([a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t, a[3] + (b[3]-a[3])*t]);
  var th = Math.acos(d), s = Math.sin(th);
  var wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0]*wa + b[0]*wb, a[1]*wa + b[1]*wb, a[2]*wa + b[2]*wb, a[3]*wa + b[3]*wb];
}
/* deviceorientation -> device-to-earth rotation (earth: x east, y north, z up). R = Rz(a) Rx(b) Ry(g). */
function fromEuler(alpha, beta, gamma){
  return qnorm(qmul(qmul(qaxis(0, 0, 1, alpha * D2R), qaxis(1, 0, 0, beta * D2R)), qaxis(0, 1, 0, gamma * D2R)));
}
function wrap(a){ while(a > Math.PI) a -= 2 * Math.PI; while(a < -Math.PI) a += 2 * Math.PI; return a; }

/* Which way the phone points, as a compass-free heading. The nose if it is
   anywhere near level; the back of the phone if the nose points up or down
   (a phone held up like a remote, or the cocked arm). */
function pointing(q){
  var top = qrot(q, [0, 1, 0]);
  if(Math.abs(top[2]) < 0.85) return {h: Math.atan2(top[0], top[1]), el: Math.asin(Math.max(-1, Math.min(1, top[2]))), top: top};
  var back = qrot(q, [0, 0, -1]);
  return {h: Math.atan2(back[0], back[1]), el: Math.asin(Math.max(-1, Math.min(1, top[2]))), top: top};
}

function ThrowSense(opts){
  opts = opts || {};
  this.q = null;            // fused pose
  this.qo = null;           // browser's orientation
  this.h0 = 0;              // LOCK heading
  this.locked = false;
  this.gotMotion = false; this.gotGyro = false;
  this.armed = false;       // the game wants a throw now
  this.onThrow = opts.onThrow || null;
  this.spikeCb = opts.onSpike || null;
  this.lastSpike = -1e9;
  this.lastThrow = -1e9;
  this.cur = null;          // a throw in progress: {t0, s: [samples], peak}
  this.live = 0;            // arm speed right now, 0..1, for a meter
}
ThrowSense.prototype.orientation = function(alpha, beta, gamma){
  if(alpha == null && beta == null) return;
  this.qo = fromEuler(alpha || 0, beta || 0, gamma || 0);
  if(!this.q || !this.gotGyro) this.q = this.qo;
};
/* The game says when a throw counts (ball in hand, or the kick). Arming
   forgets anything half-seen, so the wind-up before arming cannot fire. */
ThrowSense.prototype.arm = function(on){
  on = !!on;
  if(on !== this.armed){ this.armed = on; this.cur = null; }
};
/* rate: {alpha, beta, gamma} deg/s; acc: {x,y,z} without gravity (or null); accG: with gravity; dt seconds; t ms */
ThrowSense.prototype.motion = function(rate, acc, accG, dt, t){
  this.gotMotion = true;
  dt = Math.min(Math.max(dt || 0.016, 0.001), 0.1);
  var wx = 0, wy = 0, wz = 0;
  if(rate && (rate.alpha != null || rate.beta != null)){
    this.gotGyro = true;
    wx = rate.alpha || 0; wy = rate.beta || 0; wz = rate.gamma || 0;   // alpha: x, beta: y, gamma: z
    if(this.q){
      var w = Math.hypot(wx, wy, wz) * D2R;
      if(w > 1e-6) this.q = qnorm(qmul(this.q, qaxis(wx * D2R / w, wy * D2R / w, wz * D2R / w, w * dt)));
      // nearly still: lean on the browser's orientation, which cannot drift
      if(this.qo && Math.hypot(wx, wy, wz) < 50) this.q = qslerp(this.q, this.qo, 0.04);
    }
  }
  var a = 0;
  if(acc && acc.x != null) a = Math.hypot(acc.x, acc.y, acc.z);
  else if(accG && accG.x != null) a = Math.abs(Math.hypot(accG.x, accG.y, accG.z) - 9.81);
  var arc = Math.hypot(wx, wz), roll = Math.abs(wy);
  this.live = Math.max(this.live * 0.9, armPower(arc, a));
  if(!this.q) return;
  var p = pointing(this.q), el = p.el / D2R;
  /* Which way the arm is turning, in the room: an overhand throw toward
     the TV spins the phone forward-and-down about the horizontal axis to
     the thrower's LEFT. The wind-up spins it the other way (even when the
     nose goes past straight up, where its pitch alone would lie); waving
     it side to side spins it about the vertical. Throws up to ~60 degrees
     off the TV still show half their speed here. */
  var wW = qrot(this.q, [wx, wy, wz]);
  var fwd = -Math.cos(this.h0) * wW[0] + Math.sin(this.h0) * wW[1];

  // the spike: not throwing, nose flung at the floor
  if(!this.armed && t - this.lastSpike > 1500 && p.top[2] < -0.75 && (arc > 420 || a > 18)){
    this.lastSpike = t;
    if(this.spikeCb) this.spikeCb();
  }
  if(!this.armed || t - this.lastThrow < 700) return;

  /* The throw. The arm comes over the top: the nose sweeps forward and
     DOWN, fast. The wind-up sweeps it up and back, so it never starts one;
     waving the phone side to side turns it but does not sweep it down. */
  var c = this.cur;
  if(!c){
    if(fwd > 200) c = this.cur = {t0: t, s: [], peak: 0, pf: 0, pi: 0};
    else return;
  }
  c.s.push({t: t, arc: arc, roll: roll, a: a, el: el, h: p.h});
  if(arc > c.peak) c.peak = arc;
  if(fwd > c.pf){ c.pf = fwd; c.pi = c.s.length - 1; }
  var past = t - c.s[c.pi].t;
  if((past > 40 && fwd < c.pf * 0.45) || t - c.t0 > 500) this.finish(t);
};
ThrowSense.prototype.finish = function(t){
  var c = this.cur; this.cur = null;
  if(!c || c.s.length < 3) return;
  var acc = 0, roll = 0;
  c.s.forEach(function(e){ if(e.a > acc) acc = e.a; if(e.roll > roll) roll = e.roll; });
  if(c.peak < 300 && acc < 14) return;                    // a jiggle, not a throw
  var power = armPower(c.peak, acc);
  // aim: where the nose pointed through the fast part (it holds still there)
  var sx = 0, sy = 0;
  c.s.forEach(function(e){ if(e.arc >= c.peak * 0.6){ sx += Math.sin(e.h) * e.arc; sy += Math.cos(e.h) * e.arc; } });
  var h = wrap(Math.atan2(sx, sy) - this.h0);
  // release = the peak of the arm. Lob or bullet: a high nose there and an
  // easy arm make a lob; a level nose and a fast arm make a bullet.
  var elR = c.s[c.pi].el;
  var loftDeg = Math.max(7, Math.min(50, 6 + 0.55 * (elR + 10) + 14 * (1 - power)));
  this.lastThrow = t;
  var r = {h: h, loft: loftDeg * D2R, power: power, spin: Math.max(0, Math.min(1, (roll - 150) / 650)),
           kind: loftDeg < 20 ? 'BULLET' : loftDeg > 34 ? 'LOB' : 'TOUCH',
           arc: Math.round(c.peak), acc: Math.round(acc * 10) / 10, el: Math.round(elR)};
  if(this.onThrow) this.onThrow(r);
  return r;
};
function armPower(arc, a){
  return Math.max(0, Math.min(1, Math.max((arc - 120) / 1000, (a - 4) / 26)));
}
ThrowSense.prototype.lock = function(){
  if(!this.q) return false;
  var p = pointing(this.q);
  this.h0 = p.h; this.locked = true;
  return true;
};
ThrowSense.prototype.aim = function(){          // heading relative to LOCK right now (for a pointer on screen)
  if(!this.q) return null;
  var p = pointing(this.q);
  return {h: wrap(p.h - this.h0), el: p.el};
};
/* Swipe fallback (no sensors, or a little kid): a flick up the screen. */
function swipeThrow(dx, dy, ms, w){
  // dy negative = up the screen
  var d = Math.hypot(dx, dy), v = d / Math.max(ms, 30) * 1000 / Math.max(w, 300);   // screen widths per second
  if(dy > -30 || d < 40) return null;
  var h = Math.atan2(dx, -dy) * 1.1;
  return {h: Math.max(-1.2, Math.min(1.2, h)), loft: 0.42, power: Math.max(0.1, Math.min(1, (v - 0.6) / 4)), spin: 0.6, swipe: true, kind: 'SWIPE'};
}

var API = {ThrowSense: ThrowSense, swipeThrow: swipeThrow, fromEuler: fromEuler, qrot: qrot, qmul: qmul, qaxis: qaxis, pointing: pointing};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.GThrow = API;
})(typeof window !== 'undefined' ? window : globalThis);
