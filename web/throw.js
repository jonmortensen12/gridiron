/* Gridiron - the throw reader. The phone is the football.

   Hold the phone like the ball: the TOP of the phone is the nose. Thumb on
   the screen = ball in hand. Throw (keep hold of the phone!) and lift the
   thumb as you let go. What the throw was:

     h      heading of the nose at release, relative to LOCK (pointing at
            the TV), radians, + = right. A good throw's nose points where
            the ball goes, and the overhand arc swings the nose up and down
            in that same vertical plane, so the heading is steady through
            the release even though the pitch is not.
     loft   the nose's pitch at release: let go early (nose up) for a lob,
            late (nose level) for a bullet.
     power  arm speed: the peak turning rate across the arc (not the roll)
            and the peak hand acceleration, over the last 350 ms.
     spin   the roll rate about the nose: a spiral.

   Orientation: the browser's fused orientation is smoothed and too slow
   for a throw (and its Euler angles hit a gimbal point where a wind-up
   stops), so the pose is the gyro integrated per devicemotion event,
   pulled gently toward the browser's orientation only while the phone is
   nearly still. From dry-fly-phone's rodsense.js, rewritten here: that
   repo was not reachable from this session. Its hard-won facts kept:
     - rotationRate.alpha is about the phone's x axis, beta y, gamma z
       (some spec text says otherwise; following that drifted 91 degrees);
     - the accelerometer's sign differs between iOS and Android, so only
       magnitudes are used here.

   Pure: no DOM. feed it events, read results. throwcheck.mjs drives it
   with a synthetic throw. */
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
  this.hist = [];           // [t, wArc deg/s, wRoll deg/s, acc m/s^2]
  this.holding = false;
  this.gotMotion = false; this.gotGyro = false;
  this.spikeCb = opts.onSpike || null;
  this.lastSpike = -1e9;
  this.live = 0;            // arm speed right now, 0..1, for a meter
}
ThrowSense.prototype.orientation = function(alpha, beta, gamma){
  if(alpha == null && beta == null) return;
  this.qo = fromEuler(alpha || 0, beta || 0, gamma || 0);
  if(!this.q || !this.gotGyro) this.q = this.qo;
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
      if(w > 1e-6) this.q = qnorm(qmul(this.q, qaxis(wx * D2R / w * 1, wy * D2R / w, wz * D2R / w, w * dt)));
      // nearly still: lean on the browser's orientation, which cannot drift
      if(this.qo && Math.hypot(wx, wy, wz) < 50) this.q = qslerp(this.q, this.qo, 0.04);
    }
  }
  var a = 0;
  if(acc && acc.x != null) a = Math.hypot(acc.x, acc.y, acc.z);
  else if(accG && accG.x != null) a = Math.abs(Math.hypot(accG.x, accG.y, accG.z) - 9.81);
  var arc = Math.hypot(wx, wz), roll = Math.abs(wy);
  this.hist.push([t, arc, roll, a]);
  while(this.hist.length && t - this.hist[0][0] > 600) this.hist.shift();
  this.live = Math.max(this.live * 0.9, armPower(arc, a));
  // the spike: not holding, nose flung at the floor
  if(!this.holding && this.q && t - this.lastSpike > 1500){
    var top = qrot(this.q, [0, 1, 0]);
    if(top[2] < -0.75 && (arc > 420 || a > 18)){
      this.lastSpike = t;
      if(this.spikeCb) this.spikeCb();
    }
  }
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
ThrowSense.prototype.down = function(){ this.holding = true; };
/* The thumb came up. Returns the throw, or null for a pump fake. */
ThrowSense.prototype.up = function(t){
  this.holding = false;
  var arc = 0, roll = 0, a = 0;
  for(var i = 0; i < this.hist.length; i++){
    var e = this.hist[i];
    if(t - e[0] > 350) continue;
    if(e[1] > arc) arc = e[1];
    if(e[2] > roll) roll = e[2];
    if(e[3] > a) a = e[3];
  }
  var power = armPower(arc, a);
  if(!this.gotMotion) return null;
  if(power < 0.08) return null;                  // no throw: a pump fake
  var p = this.q ? pointing(this.q) : {h: this.h0, el: 0.3};
  var el = p.el;
  // loft: nose at 50 degrees up -> a 45 degree lob; nose level or below -> a flat 9 degrees
  var loft = Math.max(9, Math.min(46, 9 + Math.max(0, el / D2R + 6) * 0.7)) * D2R;
  return {h: wrap(p.h - this.h0), loft: loft, power: power, spin: Math.max(0, Math.min(1, (roll - 150) / 650)),
          arc: Math.round(arc), acc: Math.round(a * 10) / 10, el: el};
};
/* Swipe fallback (no sensors, or a little kid): a flick up the screen. */
function swipeThrow(dx, dy, ms, w){
  // dy negative = up the screen
  var d = Math.hypot(dx, dy), v = d / Math.max(ms, 30) * 1000 / Math.max(w, 300);   // screen widths per second
  if(dy > -30 || d < 40) return null;
  var h = Math.atan2(dx, -dy) * 1.1;
  return {h: Math.max(-1.2, Math.min(1.2, h)), loft: 0.42, power: Math.max(0.1, Math.min(1, (v - 0.6) / 4)), spin: 0.6, swipe: true};
}

var API = {ThrowSense: ThrowSense, swipeThrow: swipeThrow, fromEuler: fromEuler, qrot: qrot, qmul: qmul, qaxis: qaxis, pointing: pointing};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.GThrow = API;
})(typeof window !== 'undefined' ? window : globalThis);
