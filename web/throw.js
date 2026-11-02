/* Gridiron - the throw reader. The phone is the football.

   The NOSE of the ball is the BOTTOM of the phone. No buttons:

   1. Ready: hold the phone out in front of you, low, the bottom (the nose)
      pointing to your throwing side - right for a right-hander, left for a
      left-hander.
   2. Hike: bring it up fast to where you throw from (often out to the
      side). That is the snap, and the ready pose it came from says which
      way you are facing: FORWARD for this play. No pointing at the TV.
   3. Throw: come over the top. The throw is seen as the phone spinning
      forward (relative to FORWARD) fast; the release is the peak.

   What a throw says (onThrow):
     h      which way it went, relative to FORWARD, radians, + = right: the
            nose's heading through the fast part, or, when the nose points
            up or down there, the direction the spin carried it. The game
            uses it only to choose WHICH RECEIVER - the one in that
            direction. Leading him is the game's job, not the arm's.
     kind   LOB or BULLET: a high release with an easy arm lobs, a level
            release with a fast arm is a bullet.
     power  arm speed 0..1, spin the roll about the nose (a spiral).

   Orientation: the gyro integrated per devicemotion event, pulled gently
   toward the browser's orientation only while nearly still (the browser's
   fused angles are too slow for a throw and gimbal at the top of a
   wind-up). FORWARD is set fresh at every hike, so a heading that drifts
   between plays does not matter. Facts from dry-fly-phone's rodsense.js
   notes: rotationRate.alpha is about the phone's x axis, beta y, gamma z;
   the accelerometer's sign differs between iOS and Android, so only
   magnitudes are used.

   Pure: no DOM. Feed it events; hikes and throws come out of the
   callbacks. throwcheck.mjs drives it with synthetic hikes and throws. */
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

var NOSE = [0, -1, 0];          // the bottom of the phone
function horiz(v){ var n = Math.hypot(v[0], v[1]); return n < 1e-6 ? null : [v[0] / n, v[1] / n]; }
function heading(v){ return Math.atan2(v[0], v[1]); }
function noseOf(q){ return qrot(q, NOSE); }
function elev(v){ return Math.asin(Math.max(-1, Math.min(1, v[2]))); }

/* FORWARD from a ready pose: the nose points across the body to the
   throwing side, so forward is a quarter turn from it - left of the nose
   for a right-hander, right of it for a left-hander. A phone that is not
   in the ready pose (nose up or down) falls back to the back of the phone,
   which faces away from you when you look at the screen. */
function forwardFrom(q, hand){
  var n = noseOf(q);
  if(Math.abs(n[2]) < 0.7){
    var h = horiz(n);
    return hand === 'left' ? Math.atan2(h[1], -h[0]) : Math.atan2(-h[1], h[0]);
  }
  var b = horiz(qrot(q, [0, 0, -1]));
  return b ? heading(b) : 0;
}

function ThrowSense(opts){
  opts = opts || {};
  this.q = null;            // fused pose
  this.qo = null;           // browser's orientation
  this.hand = opts.hand === 'left' ? 'left' : 'right';
  this.h0 = 0;              // FORWARD, set at the hike
  this.mode = null;         // null | 'hike' | 'throw'
  this.gotMotion = false; this.gotGyro = false;
  this.onThrow = opts.onThrow || null;
  this.onHike = opts.onHike || null;
  this.spikeCb = opts.onSpike || null;
  this.lastSpike = -1e9; this.lastEvent = -1e9;
  this.cur = null;          // a throw in progress
  this.recent = [];         // [t, |w|, nose elevation (deg), q] for the hike
  this.live = 0;            // arm speed right now, 0..1, for a meter
}
ThrowSense.prototype.orientation = function(alpha, beta, gamma){
  if(alpha == null && beta == null) return;
  this.qo = fromEuler(alpha || 0, beta || 0, gamma || 0);
  if(!this.q || !this.gotGyro) this.q = this.qo;
};
/* What the game wants now: 'hike' (lined up, ball not snapped), 'throw'
   (ball in hand, or the kick), or null. Changing it forgets anything half
   seen, so a motion from before cannot fire into the new phase. */
ThrowSense.prototype.arm = function(mode){
  mode = mode || null;
  if(mode !== this.mode){ this.mode = mode; this.cur = null; this.recent = []; }
};
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
      if(this.qo && Math.hypot(wx, wy, wz) < 50) this.q = qslerp(this.q, this.qo, 0.04);
    }
  }
  var a = 0;
  if(acc && acc.x != null) a = Math.hypot(acc.x, acc.y, acc.z);
  else if(accG && accG.x != null) a = Math.abs(Math.hypot(accG.x, accG.y, accG.z) - 9.81);
  var wmag = Math.hypot(wx, wy, wz), arc = Math.hypot(wx, wz), roll = Math.abs(wy);
  this.live = Math.max(this.live * 0.9, armPower(arc, a));
  if(!this.q) return;
  var nose = noseOf(this.q), el = elev(nose) / D2R;

  // the spike: nothing armed for a throw, nose flung at the floor
  if(this.mode !== 'throw' && t - this.lastSpike > 1500 && nose[2] < -0.75 && (arc > 420 || a > 18)){
    this.lastSpike = t;
    if(this.spikeCb) this.spikeCb();
  }
  if(this.mode === 'hike') return this.hikeStep(t, wmag, el);
  if(this.mode !== 'throw' || t - this.lastEvent < 600) return;

  /* The arm's spin in the room, flat part only. An overhand throw spins the
     phone about a level axis, and the throw goes where that spin carries
     the top of the arc: dir = axis x up. Forward-ish (within ~100 degrees
     of FORWARD) is a throw; the wind-up spins it backward; waving spins it
     about the vertical, which has no level part. */
  var wW = qrot(this.q, [wx, wy, wz]);
  var lev = Math.hypot(wW[0], wW[1]);
  var dir = [wW[1], -wW[0]];                       // (axis x up), level
  var f = [Math.sin(this.h0), Math.cos(this.h0)];
  var along = lev > 1e-6 ? (dir[0] * f[0] + dir[1] * f[1]) / lev : 0;
  var fwd = along > -0.2 ? lev : 0;
  var c = this.cur;
  if(!c){
    if(fwd > 220) c = this.cur = {t0: t, s: [], peak: 0, pf: 0, pi: 0};
    else return;
  }
  c.s.push({t: t, arc: arc, roll: roll, a: a, el: el, nose: nose, dir: dir, fwd: fwd});
  if(arc > c.peak) c.peak = arc;
  if(fwd > c.pf){ c.pf = fwd; c.pi = c.s.length - 1; }
  if((t - c.s[c.pi].t > 40 && fwd < c.pf * 0.45) || t - c.t0 > 500) this.finish(t);
};

/* The hike: from a steady ready pose, the phone comes up fast - the nose
   rises 25 degrees or more within a third of a second while turning fast.
   FORWARD is read from the steady pose just before. */
ThrowSense.prototype.hikeStep = function(t, wmag, el){
  this.recent.push([t, wmag, el, this.q]);
  while(this.recent.length && t - this.recent[0][0] > 700) this.recent.shift();
  if(t - this.lastEvent < 800 || wmag < 220) return;
  // the last calm moment before this movement
  var calm = null;
  for(var i = this.recent.length - 1; i >= 0; i--){ if(this.recent[i][1] < 90){ calm = this.recent[i]; break; } }
  if(!calm || t - calm[0] > 350) return;
  if(el - calm[2] < 25) return;
  this.lastEvent = t;
  this.h0 = forwardFrom(calm[3], this.hand);
  this.recent = [];
  if(this.onHike) this.onHike({h0: this.h0});
};
/* A tap instead of the motion: FORWARD from wherever the phone is now. */
ThrowSense.prototype.hikeNow = function(t){
  if(this.q) this.h0 = forwardFrom(this.q, this.hand);
  this.lastEvent = t || 0;
  this.recent = [];
};

ThrowSense.prototype.finish = function(t){
  var c = this.cur; this.cur = null;
  if(!c || c.s.length < 3) return;
  var acc = 0, roll = 0;
  c.s.forEach(function(e){ if(e.a > acc) acc = e.a; if(e.roll > roll) roll = e.roll; });
  if(c.peak < 300 && acc < 14) return;                    // a jiggle, not a throw
  var power = armPower(c.peak, acc);
  // which way: the nose through the fast part, where it is level enough to
  // say; otherwise where the spin carried it
  var nx = 0, ny = 0, sx = 0, sy = 0;
  c.s.forEach(function(e){
    if(e.fwd < c.pf * 0.6) return;
    var h = horiz(e.nose);
    if(h && Math.abs(e.nose[2]) < 0.8){ var k = Math.hypot(e.nose[0], e.nose[1]) * e.fwd; nx += h[0] * k; ny += h[1] * k; }
    sx += e.dir[0]; sy += e.dir[1];
  });
  var dh = nx || ny ? Math.atan2(nx, ny) : Math.atan2(sx, sy);
  var h = wrap(dh - this.h0);
  var elR = c.s[c.pi].el;
  var lob = 6 + 0.55 * (elR + 10) + 14 * (1 - power) > 27;
  this.lastEvent = t;
  var r = {h: h, kind: lob ? 'LOB' : 'BULLET', power: power, spin: Math.max(0, Math.min(1, (roll - 150) / 650)),
           arc: Math.round(c.peak), acc: Math.round(acc * 10) / 10, el: Math.round(elR)};
  if(this.onThrow) this.onThrow(r);
  return r;
};
function armPower(arc, a){
  return Math.max(0, Math.min(1, Math.max((arc - 120) / 1000, (a - 4) / 26)));
}
/* Which way the nose points now, relative to FORWARD (for the TV's preview
   of who you would throw to). null while the nose points up or down. */
ThrowSense.prototype.aim = function(){
  if(!this.q) return null;
  var n = noseOf(this.q), h = horiz(n);
  if(!h || Math.abs(n[2]) > 0.85) return null;
  return {h: wrap(heading(h) - this.h0), el: elev(n)};
};
/* Swipe fallback (no sensors, or a little kid): a flick up the screen. */
function swipeThrow(dx, dy, ms, w){
  // dy negative = up the screen
  var d = Math.hypot(dx, dy), v = d / Math.max(ms, 30) * 1000 / Math.max(w, 300);   // screen widths per second
  if(dy > -30 || d < 40) return null;
  var h = Math.atan2(dx, -dy) * 1.1;
  var power = Math.max(0.1, Math.min(1, (v - 0.6) / 4));
  // a slow flick lobs, a fast one is a bullet
  return {h: Math.max(-1.4, Math.min(1.4, h)), power: power, spin: 0.6, swipe: true, kind: power < 0.45 ? 'LOB' : 'BULLET'};
}

var API = {ThrowSense: ThrowSense, swipeThrow: swipeThrow, forwardFrom: forwardFrom, fromEuler: fromEuler, qrot: qrot, qmul: qmul, qaxis: qaxis};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.GThrow = API;
})(typeof window !== 'undefined' ? window : globalThis);
