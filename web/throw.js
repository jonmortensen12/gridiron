/* Gridiron - the throw reader. The phone is the football.

   The NOSE of the ball is the BOTTOM of the phone. No buttons:

   1. Ready: hold the phone out in front of you, low and steady, the bottom
      (the nose) pointing to your throwing side, palm toward you.
   2. Hike: bring it up quickly to where you throw from (often out to the
      side). That is the snap. The ready pose gives the line you face
      along, and the cocked pose just after (the nose pointing forward-ish)
      says which way along it: FORWARD for this play. No pointing at the TV.
   3. Throw: come over the top. The throw is seen as the phone spinning
      forward (relative to FORWARD) fast; the release is the peak.

   What a throw says (onThrow):
     h      which way it went, relative to FORWARD, radians, + = right: the
            nose's heading through the fast part, or, when the nose points
            up or down there, the direction the spin carried it. The game
            uses it only to choose WHICH RECEIVER - the one in that
            direction. Leading him is the game's job, not the arm's.
     kind   LOB or BULLET: softer than your own usual throw (or released
            with the nose high) lobs; your normal hard throw is a bullet.
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

/* The forward LINE from a ready pose. Held low in front, the nose points
   across the body, so forward is a quarter turn from it; if the nose
   points steeply up or down, the phone's face looks forward or back. Which
   way along the line is settled just after the hike (settleForward): the
   hike ends cocked, the nose pointing forward-ish. Grips differ - palm in,
   palm out, screen up or toward you - and the sign is where they differ,
   so it is never guessed from the grip alone. The hand only picks the
   first guess. */
function forwardFrom(q, hand){
  var n = noseOf(q);
  if(Math.abs(n[2]) < 0.8){
    var h = horiz(n);
    return hand === 'left' ? Math.atan2(h[1], -h[0]) : Math.atan2(-h[1], h[0]);
  }
  var b = horiz(qrot(q, [0, 0, -1]));
  return b ? heading(b) : 0;
}
function qangle(a, b){
  var d = Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);
  return 2 * Math.acos(Math.min(1, d));
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
  this.calmT = null; this.calmQ = null; this.left = null;   // the hike: calm, then a burst
  this.settle = null;       // after the hike: which way the nose settles
  this.peaks = [];          // this player's recent arm speeds, for lob or bullet
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
  if(mode !== this.mode){ this.mode = mode; this.cur = null; this.calmT = null; this.left = null; }
};
/* For the phone's screen: is the ready pose steady enough to hike from? */
ThrowSense.prototype.readyToHike = function(t){
  return this.mode === 'hike' && this.calmT != null && t - this.calmT >= 250;
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
  if(this.settle) this.settleStep(t, nose);
  if(this.mode === 'hike') return this.hikeStep(t, wmag, a);
  if(this.mode !== 'throw' || t - this.lastEvent < 450) return;

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
    if(fwd > 220){
      if(this.settle) this.settleStep(t, nose, true);     // a quick thrower: settle on what we have
      c = this.cur = {t0: t, s: [], peak: 0, pf: 0, pi: 0};
    }
    else return;
  }
  c.s.push({t: t, arc: arc, roll: roll, a: a, el: el, nose: nose, dir: dir, fwd: fwd});
  if(arc > c.peak) c.peak = arc;
  if(fwd > c.pf){ c.pf = fwd; c.pi = c.s.length - 1; }
  if((t - c.s[c.pi].t > 40 && fwd < c.pf * 0.45) || t - c.t0 > 500) this.finish(t);
};

/* The hike: the phone held steady (a quarter second under 70 deg/s and
   3.5 m/s^2), then brought up quickly - turning over 220 deg/s or the hand
   over 8 m/s^2 - and 45 degrees or more from where it was within 0.4 s of
   leaving the steady pose. A lift counts as much as a twist. */
ThrowSense.prototype.hikeStep = function(t, wmag, a){
  var calm = wmag < 70 && a < 3.5;
  if(calm){
    if(this.calmT == null) this.calmT = t;
    this.calmQ = this.q; this.left = null;
    return;
  }
  if(this.calmT != null){
    this.left = t - this.calmT >= 250 ? {t: t, q: this.calmQ, burst: 0} : null;
    this.calmT = null;
  }
  var L = this.left;
  if(!L || t - this.lastEvent < 800) return;
  if(t - L.t > 400){ this.left = null; return; }
  L.burst = Math.max(L.burst, wmag / 220, a / 8);
  if(L.burst >= 1 && qangle(this.q, L.q) > 45 * D2R){
    this.lastEvent = t; this.left = null;
    this.h0 = wrap(forwardFrom(L.q, this.hand) + (this.flip ? Math.PI : 0));
    this.settle = {from: t + 120, until: t + 600, x: 0, y: 0};
    if(this.onHike) this.onHike({h0: this.h0});
  }
};
/* A tap instead of the motion: the line from wherever the phone is now;
   the direction once it settles into the throwing spot. */
ThrowSense.prototype.hikeNow = function(t){
  t = t || 0;
  if(this.q) this.h0 = wrap(forwardFrom(this.q, this.hand) + (this.flip ? Math.PI : 0));
  this.lastEvent = t;
  this.settle = {from: t + 250, until: t + 1100, x: 0, y: 0};
};
/* Just after the hike the phone is cocked, the nose pointing forward-ish:
   if it points against FORWARD, FORWARD was the wrong way along its line.
   Remembered (this.flip): a grip is a habit, so the next hike guesses right. */
ThrowSense.prototype.settleStep = function(t, nose, now){
  // a nose within 75 degrees of level says which way it points; nearer level counts for more
  var S = this.settle, nh = Math.hypot(nose[0], nose[1]);
  if(t >= S.from && nh > 0.25){ S.x += nose[0] * nh; S.y += nose[1] * nh; }
  if(t < S.until && !now) return;
  this.settle = null;
  if(!S.x && !S.y) return;
  var f = [Math.sin(this.h0), Math.cos(this.h0)];
  if(S.x * f[0] + S.y * f[1] < 0){ this.h0 = wrap(this.h0 + Math.PI); this.flip = !this.flip; }
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
  /* LOB or BULLET. Mostly: softer than your own usual throw is a lob. The
     usual is the faster half of your last eight throws (at least 700 deg/s,
     so the first throws of the night have something to go on). A high
     release (the nose up at the peak) pushes toward a lob too. */
  var ps = this.peaks.slice().sort(function(x, y){ return y - x; });
  var usual = Math.max(700, ps.length ? ps[Math.min(ps.length - 1, Math.floor(ps.length / 3))] : 0);
  var soft = 1 - c.peak / usual;
  var lob = soft * 2.2 + (elR - 10) / 30 > 0.5;
  this.peaks.push(c.peak); if(this.peaks.length > 8) this.peaks.shift();
  this.lastEvent = t;
  var r = {h: h, kind: lob ? 'LOB' : 'BULLET', power: power, spin: Math.max(0, Math.min(1, (roll - 150) / 650)),
           arc: Math.round(c.peak), usual: Math.round(usual), acc: Math.round(acc * 10) / 10, el: Math.round(elR)};
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
