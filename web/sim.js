/* Gridiron - the football simulation. Decides everything, draws nothing.

   The TV runs it at 60 Hz and draws what it says; simcheck.mjs runs it
   headless with a computer quarterback. Deterministic for a given seed.

   Units are YARDS and SECONDS. The field: x across (sidelines at +-26.65),
   y along, 0 = the offense's own goal line, 100 = the goal line it is
   driving at, the end zone runs to 110. z is height. The offense always
   drives toward +y; the renderer turns the field round for the other team.

   One drive at a time. A drive is a scenario (score, clock, ball, timeouts)
   and a run of plays: huddle -> pre-snap -> live -> dead -> huddle. The
   phones send calls into it (callPlay, snap, throwBall, steer, spike,
   timeout, kick) and read `g.ev` for what just happened - and empty it
   (g.ev = []) once read: a call or a throw from a phone lands between
   steps, so step() must not throw its events away. */
(function(root){
'use strict';

var HALF_W = 26.65, G = 10.73;                 // gravity in yd/s^2
var WR_SPEED = 8.9, RB_SPEED = 8.6, TE_SPEED = 8.0, QB_SPEED = 7.4;
var DB_SPEED = 8.8, LB_SPEED = 8.0, DL_SPEED = 6.6;

function rng(seed){
  var s = (seed >>> 0) || 1;
  return function(){ s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
function len(x, y){ return Math.sqrt(x * x + y * y); }

/* ---------- the playbook ----------
   Routes are waypoints relative to the receiver's start, y downfield, x
   POSITIVE = OUTWARD (toward his own sideline). Mirrored for a receiver on
   the left, so one table serves both sides. */
var ROUTES = {
  go:     [[0, 40]],
  slant:  [[0, 2], [-5, 8], [-13, 15]],
  out:    [[0, 9], [9, 9.5]],
  quick:  [[0, 5], [5, 5]],
  post:   [[0, 11], [-9, 30]],
  corner: [[0, 11], [9, 24]],
  curl:   [[0, 12], [-1, 10]],
  dig:    [[0, 13], [-16, 13]],
  seam:   [[0, 35]],
  flat:   [[1, 1], [8, 3]],
  wheel:  [[6, 1], [8, 8], [8, 40]],
  drag:   [[0, 2], [-18, 5]],
  check:  [[0, -1], [3, 4], [3, 6]],
  screen: [[3, -2], [6, -2.5]],
  block:  null
};
/* x: X (wide left), Z (wide right), Y (slot right), T (tight end left), R (back) */
var PLAYS = {
  slants:   {name: 'SLANTS',     kind: 'pass', drop: 3, r: {X: 'slant', Z: 'slant', Y: 'flat',  T: 'quick', R: 'check'}, tip: 'Quick throws over the middle'},
  outs:     {name: 'OUTS',       kind: 'pass', drop: 5, r: {X: 'out',   Z: 'out',   Y: 'corner',T: 'flat',  R: 'check'}, tip: 'Catch it and get out of bounds'},
  post:     {name: 'POST',       kind: 'pass', drop: 7, r: {X: 'post',  Z: 'go',    Y: 'dig',   T: 'seam',  R: 'block'}, tip: 'Deep shots, needs time'},
  curls:    {name: 'CURLS',      kind: 'pass', drop: 5, r: {X: 'curl',  Z: 'curl',  Y: 'drag',  T: 'curl',  R: 'flat'},  tip: 'Safe, sits in the holes'},
  screen:   {name: 'SCREEN',     kind: 'pass', drop: 4, r: {X: 'go',    Z: 'go',    Y: 'quick', T: 'block', R: 'screen'}, tip: 'Dump it to the back, blockers in front', screen: true},
  hail:     {name: 'HAIL MARY',  kind: 'pass', drop: 8, r: {X: 'go',    Z: 'go',    Y: 'seam',  T: 'seam',  R: 'block'}, tip: 'Everybody to the end zone', hail: true},
  run:      {name: 'RUN',        kind: 'run',  drop: 0, r: {X: 'block', Z: 'block', Y: 'block', T: 'block', R: 'block'}, tip: 'Hand off, tilt to steer'},
  spike:    {name: 'SPIKE',      kind: 'spike', tip: 'Stops the clock, costs a down'},
  fg:       {name: 'FIELD GOAL', kind: 'fg',   tip: 'Kick it through'}
};
var PLAY_ORDER = ['slants', 'outs', 'curls', 'post', 'screen', 'hail', 'run', 'spike', 'fg'];

var COVERS = {
  man:     {name: 'MAN',     pocket: 3.9, react: 0.42},
  zone:    {name: 'ZONE',    pocket: 4.2, react: 0.36},
  blitz:   {name: 'BLITZ',   pocket: 2.7, react: 0.5},
  prevent: {name: 'PREVENT', pocket: 4.8, react: 0.3}
};

var ASSIST = {   // how much the game helps a throw find a receiver
  rookie:  {aim: 0.85, win: 32, dist: 0.85, dwin: 30, reach: 1.9},
  starter: {aim: 0.55, win: 16, dist: 0.5,  dwin: 14, reach: 1.5},
  pro:     {aim: 0.15, win: 6,  dist: 0.12, dwin: 6,  reach: 1.25}
};

/* ---------- scenarios ---------- */
var SCENARIOS = {
  saturday: {name: 'Saturday at Rice-Eccles', blurb: 'Down 4. Two minutes. 75 yards. Two timeouts.',
             need: 4, clock: 120, ball: 25, tos: 2},
  harline:  {name: "Harline's Still Open", blurb: 'Inspired by 2006: down 4, about a minute and a quarter, a long way to go.',
             need: 4, clock: 78, ball: 22, tos: 1},
  ferrin:   {name: 'Ferrin From 44', blurb: 'Inspired by 2024: down 2, a field goal wins it.',
             need: 2, clock: 95, ball: 30, tos: 1},
  george:   {name: 'George Is Still Running', blurb: 'Inspired by 2009: overtime from the 25. Need a touchdown.',
             need: 4, clock: 0, ball: 75, tos: 1, ot: true},
  kids:     {name: 'Backyard', blurb: 'Three minutes, all three timeouts, the defence is half asleep.',
             need: 4, clock: 180, ball: 40, tos: 3, easy: true}
};

/* ---------- making a drive ---------- */
function newDrive(opts){
  opts = opts || {};
  var sc = SCENARIOS[opts.scenario] || SCENARIOS.saturday;
  var g = {
    seed: opts.seed || 1, r: rng(opts.seed || 1),
    mode: opts.mode || 'drill',             // drill | pass | versus
    sc: sc, scKey: opts.scenario || 'saturday',
    assist: ASSIST[opts.assist] ? opts.assist : 'starter',
    offense: opts.offense || 'byu', defense: opts.offense === 'utah' ? 'byu' : 'utah',
    need: opts.need != null ? opts.need : sc.need,
    clock: opts.clock != null ? opts.clock : sc.clock, untimed: !!(opts.ot || sc.ot) || (opts.clock === 0),
    ball: opts.ball != null ? opts.ball : sc.ball, down: 1, toGo: 10,
    tos: opts.tos != null ? opts.tos : sc.tos,
    easy: !!sc.easy || !!opts.easy,
    practice: !!opts.practice,              // Touchdown Pass: receivers and nobody else
    phase: 'huddle', t: 0, phaseT: 0, clockRunning: false, restartIn: 0,
    playClock: 40, call: null, cover: null, dcall: null,
    players: [], ballObj: null, carrier: null, events: [], ev: [],
    over: false, result: null, points: 0, lastText: '', plays: 0,
    stats: {att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, rush: 0},
    log: []
  };
  if(g.untimed){ g.clock = 0; }
  firstDownLine(g);
  return g;
}
function firstDownLine(g){
  g.toGo = Math.min(10, 100 - g.ball);
  g.goalToGo = g.ball + 10 >= 100;
}

function emit(g, type, data){ var e = Object.assign({type: type, t: g.t}, data || {}); g.ev.push(e); g.log.push(e); }

/* ---------- lining up ---------- */
function mk(g, side, pos, x, y, speed){
  var p = {side: side, pos: pos, x: x, y: y, z: 0, vx: 0, vy: 0, sx: x, sy: y, speed: speed,
           route: null, ri: 0, rpts: null, assign: null, hist: [], engaged: 0, react: 0, down: false,
           hand: 0, dive: 0, broke: false};
  g.players.push(p);
  return p;
}

function lineUp(g){
  var los = g.ball, P = PLAYS[g.call] || PLAYS.slants, hash = clamp(g.hashX || 0, -6, 6);
  g.players = [];
  var o = {};
  // offensive line
  for(var i = -2; i <= 2; i++) mk(g, 'o', 'OL', hash + i * 1.3, los - 0.6, 5);
  o.QB = mk(g, 'o', 'QB', hash, P.kind === 'fg' ? los - 7 : los - (P.kind === 'run' ? 4 : 1.2), QB_SPEED);
  o.R  = mk(g, 'o', 'RB', hash + (P.kind === 'run' ? 0 : 2.2), los - 6, RB_SPEED);
  o.X  = mk(g, 'o', 'WR', -22, los - 0.7, WR_SPEED);
  o.Z  = mk(g, 'o', 'WR', 22, los - 0.7, WR_SPEED);
  o.Y  = mk(g, 'o', 'WR', hash + 9, los - 1.2, WR_SPEED);
  o.T  = mk(g, 'o', 'TE', hash - 4.2, los - 0.8, TE_SPEED);
  g.o = o;
  ['X', 'Z', 'Y', 'T', 'R'].forEach(function(k){
    var p = o[k], rk = P.r ? P.r[k] : 'block';
    p.key = k;
    if(!rk || !ROUTES[rk]){ p.route = null; return; }
    var flip = p.x < 0 ? -1 : 1;
    p.route = rk;
    p.rpts = ROUTES[rk].map(function(w){ return [p.x + w[0] * flip, p.y + w[1]]; });
    // a route must stay in bounds
    p.rpts.forEach(function(w){ w[0] = clamp(w[0], -HALF_W + 1.5, HALF_W - 1.5); w[1] = Math.min(w[1], 108.5); });
  });
  o.QB.key = 'QB';
  if(g.practice){ g.d = {}; g.pocket = 1e9; g.react = 0.4; return; }

  // defence
  var cov = g.cover, d = {};
  var deep = cov === 'prevent' ? 20 : cov === 'blitz' ? 14 : 12;
  var soft = g.easy ? 2 : 0;
  // four down linemen
  [-3.2, -1.1, 1.1, 3.2].forEach(function(dx, i){ var p = mk(g, 'd', 'DL', hash + dx, los + 0.8, DL_SPEED); p.key = 'DL' + i; });
  d.CB1 = mk(g, 'd', 'CB', -21, los + (cov === 'prevent' ? 9 : 6) + soft, DB_SPEED);
  d.CB2 = mk(g, 'd', 'CB', 21, los + (cov === 'prevent' ? 9 : 6) + soft, DB_SPEED);
  d.NB  = mk(g, 'd', 'CB', hash + 9, los + 5 + soft, DB_SPEED);
  d.LB1 = mk(g, 'd', 'LB', hash - 3, los + 5, LB_SPEED);
  d.LB2 = mk(g, 'd', 'LB', hash + 3, los + 5, LB_SPEED);
  d.S1  = mk(g, 'd', 'S', -9, Math.min(los + deep + soft, 108), DB_SPEED);
  d.S2  = mk(g, 'd', 'S', 9, Math.min(los + deep + 2 + soft, 108), DB_SPEED);
  Object.keys(d).forEach(function(k){ d[k].key = k; });
  g.d = d;
  if(g.easy) g.players.forEach(function(p){ if(p.side === 'd') p.speed *= 0.86; });

  // assignments
  var man = {CB1: 'X', CB2: 'Z', NB: 'Y', LB1: 'T', LB2: 'R'};
  Object.keys(d).forEach(function(k){
    var p = d[k];
    if(cov === 'man' || cov === 'blitz') p.assign = man[k] ? {man: o[man[k]]} : {zone: [p.x * 0.5, los + deep + 4, 14]};
    else {
      // zones: [cx, cy, radius]
      var depth = cov === 'prevent' ? 1.5 : 1;
      var zones = {CB1: [-17, los + 9 * depth, 9], CB2: [17, los + 9 * depth, 9], NB: [8, los + 7 * depth, 8],
                   LB1: [-5, los + 6 * depth, 7], LB2: [5, los + 6 * depth, 7],
                   S1: [-10, los + 18 * depth, 13], S2: [10, los + 18 * depth, 13]};
      var z = zones[k];
      p.assign = {zone: [z[0], Math.min(z[1], 106), z[2]]};
    }
  });
  if(cov === 'blitz'){ d.LB2.assign = {rush: true}; d.NB.assign = {rush: true}; }
  if(P.hail){ // everybody back
    Object.keys(d).forEach(function(k){ if(d[k].assign.zone) d[k].assign.zone[1] = Math.min(Math.max(d[k].assign.zone[1], los + 25), 106); });
  }
  g.pocket = (COVERS[cov] ? COVERS[cov].pocket : 4) + (g.r() - 0.5) * 0.8 + (g.easy ? 1.6 : 0) + (P.hail ? 0.6 : 0);
  g.react = (COVERS[cov] ? COVERS[cov].react : 0.4) + (g.easy ? 0.25 : 0);
}

/* ---------- the calls ---------- */
function canCall(g, key){
  var P = PLAYS[key];
  if(!P) return false;
  if(key === 'fg') return (100 - g.ball) + 17 <= 62;
  if(key === 'spike') return !g.untimed && g.clock > 0;
  return true;
}
function pickCover(g){
  if(g.dcall && COVERS[g.dcall]) return g.dcall;
  var r = g.r(), yl = 100 - g.ball;
  if(g.toGo >= 15 || (g.clock < 25 && !g.untimed && yl > 35)) return r < 0.6 ? 'prevent' : r < 0.85 ? 'zone' : 'man';
  if(yl < 12) return r < 0.4 ? 'man' : r < 0.7 ? 'blitz' : 'zone';
  if(g.toGo <= 3) return r < 0.4 ? 'blitz' : r < 0.75 ? 'man' : 'zone';
  return r < 0.35 ? 'zone' : r < 0.65 ? 'man' : r < 0.85 ? 'blitz' : 'prevent';
}

function callPlay(g, key){
  if(g.over || g.phase !== 'huddle' || !canCall(g, key)) return false;
  g.call = key;
  if(key === 'spike'){
    // spike: line up fast, ball into the ground
    g.down++;
    g.clock = Math.max(0, g.clock - 1);
    g.clockRunning = false;
    g.restartIn = 0;
    emit(g, 'spike', {text: 'SPIKED - CLOCK STOPPED'});
    g.lastText = 'Spike. Clock stopped.';
    afterDown(g);
    if(!g.over){ g.call = null; g.phase = 'huddle'; g.phaseT = 0; }
    return true;
  }
  g.cover = key === 'fg' ? 'fg' : pickCover(g);
  g.dcall = null;
  g.t0key = (g.t0key || 0) + 1;
  lineUp(g);
  g.phase = 'presnap'; g.phaseT = 0;
  emit(g, 'call', {play: key, cover: g.cover});
  return true;
}

/* The cadence. The QB's call puts everyone DOWN; SET_AT seconds later the
   line is SET, the quarterback is assumed to be in the snap position, and
   only then can he hike it (his phone's snap motion, or a tap). */
var SET_AT = 2.0;
function cadence(g){ return g.phase !== 'presnap' ? null : g.phaseT < SET_AT ? 'down' : 'set'; }
function snap(g){
  if(g.phase !== 'presnap' || g.phaseT < SET_AT) return false;
  g.phase = 'live'; g.phaseT = 0; g.liveT = 0;
  if(!g.untimed && g.clock > 0) g.clockRunning = true;
  g.restartIn = 0;
  g.ballObj = {x: g.o.QB.x, y: g.o.QB.y, z: 1.2, vx: 0, vy: 0, vz: 0, state: 'held', spin: 0, wob: 0, owner: g.o.QB};
  g.carrier = g.o.QB;
  g.thrown = false; g.startBall = g.ball; g.sacked = false; g.handed = false;
  g.steerX = 0;
  emit(g, 'snap', {play: g.call, cover: g.cover});
  return true;
}

function timeout(g){
  if(g.over || g.tos <= 0 || g.phase === 'live' || g.untimed || !g.clockRunning) return false;
  g.tos--; g.clockRunning = false; g.restartIn = 0;
  emit(g, 'timeout', {left: g.tos, text: 'TIMEOUT'});
  return true;
}

/* ---------- the throw ----------
   t = {h: heading (radians, 0 = straight downfield, + = right),
        loft (radians, launch angle), power 0..1, spin 0..1}
   Or t = {at: [x, y]}: throw to a spot (keyboard/mouse on the TV, and the
   computer quarterback). */
function throwBall(g, t){
  if(g.phase !== 'live' || g.thrown || g.carrier !== g.o.QB || g.sacked) return false;
  var qb = g.o.QB, A = ASSIST[g.assist];
  var speed, loft, h, spin = clamp(t.spin || 0, 0, 1);
  if(t.at){
    var dx = t.at[0] - qb.x, dy = t.at[1] - qb.y, d = len(dx, dy);
    h = Math.atan2(dx, dy);
    loft = clamp(0.18 + d * 0.006, 0.18, 0.62);
    speed = Math.sqrt(Math.max(1, d) * G / Math.sin(2 * loft));
  } else {
    var power = clamp(t.power, 0, 1);
    h = t.h || 0;
    loft = clamp(t.loft == null ? 0.35 : t.loft, 0.08, 0.95);
    speed = t.speed || 11 + 19 * power;
  }
  // assist: bend the throw toward the receiver it was nearly aimed at
  var best = null, bestErr = 1e9;
  if(!t.raw){
    targets(g).forEach(function(rc){
      var lead = leadFor(g, rc, speed, loft);
      if(!lead) return;
      var err = Math.abs(angDiff(lead.h, h)) * 180 / Math.PI;
      if(err < A.win && err < bestErr){ bestErr = err; best = {rc: rc, lead: lead}; }
    });
  }
  if(best){
    var w = A.aim * (1 - bestErr / A.win * 0.5);
    h = h + angDiff(best.lead.h, h) * w;
    // distance: the range this throw would have vs the range it needs
    var rng0 = speed * speed * Math.sin(2 * loft) / G, need = best.lead.d;
    if(Math.abs(rng0 - need) < A.dwin + need * 0.25){
      var want = rng0 + (need - rng0) * A.dist;
      speed = Math.sqrt(Math.max(1, want) * G / Math.sin(2 * loft));
    }
    best.rc.target = true;
  }
  if(t.target && g.o[t.target]){ best = {rc: g.o[t.target]}; g.o[t.target].target = true; }
  speed = Math.min(speed, 36);
  var hz = Math.cos(loft) * speed;
  var b = g.ballObj;
  b.state = 'air'; b.owner = null;
  b.x = qb.x; b.y = qb.y; b.z = 2.0;
  b.vx = Math.sin(h) * hz; b.vy = Math.cos(h) * hz; b.vz = Math.sin(loft) * speed;
  b.spin = spin; b.wob = (1 - spin) * (g.assist === 'pro' ? 1 : 0.5);
  b.from = [qb.x, qb.y];
  g.thrown = true; g.carrier = null; g.airT = 0;
  g.stats.att++;
  g.throwInfo = {h: h, loft: loft, speed: speed, target: best ? best.rc.key : null};
  // where it will come down (for everyone's eyes and the defence's brains)
  g.landing = predictLanding(b);
  emit(g, 'throw', {speed: speed, h: h, loft: loft, target: best ? best.rc.key : null, land: g.landing});
  return true;
}

function targets(g){
  return ['X', 'Z', 'Y', 'T', 'R'].map(function(k){ return g.o[k]; }).filter(function(p){ return p.route; });
}
function angDiff(a, b){ var d = a - b; while(d > Math.PI) d -= 2 * Math.PI; while(d < -Math.PI) d += 2 * Math.PI; return d; }

/* ---------- the throw, as a phone throws it ----------
   t = {h: which way (radians from FORWARD, + = right), kind: 'LOB' |
   'BULLET', power, spin}, or {to: 'X'|'Z'|'Y'|'T'|'R', kind}.
   The phone only says which way and how; the game picks the receiver in
   that direction and puts the ball on him, led perfectly. A LOB goes up
   high (over the underneath defenders, but it hangs: the deep ones have
   time to come); a BULLET goes flat and fast (no time to react, but a
   defender in the lane can get a hand on it). */
var LOB_LOFT = 0.72, BULLET_LOFT = 0.17, MAX_SPEED = 33;
function pickTarget(g, h){
  var qb = g.o.QB, best = null, bd = 1e9;
  targets(g).forEach(function(rc){
    var f = predictPos(rc, 0.3), bear = Math.atan2(f[0] - qb.x, f[1] - qb.y);
    var d = Math.abs(angDiff(bear, h || 0));
    if(d < bd){ bd = d; best = rc; }
  });
  return best;
}
/* Speed and loft that land a ball at catch height (1.2) at range R, from the hand (2.0). */
function solveThrow(R, loft, capped){
  for(var i = 0; i < 40; i++){
    var c = Math.cos(loft), den = 2 * c * c * (0.8 + R * Math.tan(loft));
    var v = den > 0 ? Math.sqrt(G * R * R / den) : 99;
    if(!capped || v <= MAX_SPEED || loft > 0.7) return {v: v, loft: loft, T: R / (v * c)};
    loft += 0.02;                          // too far for a flat one: put a little air under it
  }
  return {v: MAX_SPEED, loft: loft, T: R / (MAX_SPEED * Math.cos(loft))};
}
function throwTo(g, t){
  if(g.phase !== 'live' || g.thrown || !g.o || g.carrier !== g.o.QB || g.sacked) return false;
  var rc = t.to && g.o[t.to] && g.o[t.to].route ? g.o[t.to] : pickTarget(g, t.h);
  if(!rc) return false;
  var lob = t.kind === 'LOB', qb = g.o.QB, T = 0, sol = null, fx = rc.x, fy = rc.y;
  for(var i = 0; i < 8; i++){
    var f = predictPos(rc, T + 0.05);
    fx = f[0]; fy = f[1];
    sol = solveThrow(Math.max(2, len(fx - qb.x, fy - qb.y)), lob ? LOB_LOFT : BULLET_LOFT, !lob);
    T = sol.T;
  }
  var ok = throwBall(g, {h: Math.atan2(fx - qb.x, fy - qb.y), loft: sol.loft, speed: sol.v, spin: t.spin == null ? 0.7 : t.spin, raw: true, target: rc.key});
  if(ok){
    g.throwInfo.kind = lob ? 'LOB' : 'BULLET';
    g.throwInfo.target = rc.key;
    var e = g.ev[g.ev.length - 1];
    if(e && e.type === 'throw'){ e.target = rc.key; e.kind = g.throwInfo.kind; e.dist = Math.round(len(fx - qb.x, fy - qb.y)); }
  }
  return ok;
}

/* Where should a ball thrown at this speed and loft go to meet rc? */
function leadFor(g, rc, speed, loft){
  var qb = g.o.QB, hz = Math.cos(loft) * speed, T = 0, px = rc.x, py = rc.y;
  for(var i = 0; i < 6; i++){
    var fut = predictPos(rc, T);
    px = fut[0]; py = fut[1];
    var d = len(px - qb.x, py - qb.y);
    T = d / hz;
  }
  var dd = len(px - qb.x, py - qb.y);
  if(dd < 2) return null;
  return {h: Math.atan2(px - qb.x, py - qb.y), d: dd, x: px, y: py, T: T};
}
/* Where a receiver will be in T seconds, following his route. */
function predictPos(p, T){
  var x = p.x, y = p.y, ri = p.ri, left = T, sp = p.speed * (p.down ? 0 : 1);
  if(!p.rpts) return [x + p.vx * T, y + p.vy * T];
  var lastDx = p.vx, lastDy = p.vy;
  while(left > 0 && ri < p.rpts.length){
    var w = p.rpts[ri], dx = w[0] - x, dy = w[1] - y, d = len(dx, dy), step = sp * left;
    if(d < 1e-6){ ri++; continue; }
    lastDx = dx / d * sp; lastDy = dy / d * sp;
    if(step < d){ x += dx / d * step; y += dy / d * step; left = 0; }
    else { x = w[0]; y = w[1]; left -= d / sp; ri++; }
  }
  if(left > 0){ x += lastDx * left; y += lastDy * left; }
  return [clamp(x, -HALF_W, HALF_W), Math.min(y, 109.5)];
}
function predictLanding(b){
  // solve z(t) = 1.2 (catch height) on the way down
  var a = -0.5 * G, bq = b.vz, c = b.z - 1.2;
  var disc = bq * bq - 4 * a * c, T = disc > 0 ? (-bq - Math.sqrt(disc)) / (2 * a) : 1;
  return {x: b.x + b.vx * T, y: b.y + b.vy * T, T: T};
}

/* The ball carrier's steering: -1..1 across the field. */
function steer(g, x){ g.steerX = clamp(+x || 0, -1, 1); }

/* ---------- the field goal ----------
   k = {h, power} (from the same flick as a throw), or {auto: quality}. */
function kick(g, k){
  if(g.phase !== 'live' || g.call !== 'fg' || g.kicked) return false;
  var spotY = g.ball - 7, dist = 110 - spotY;
  var power = clamp(k.power == null ? 0.7 : k.power, 0, 1);
  var maxRange = 34 + power * 34;                           // yards the kick carries at crossbar height
  var hErr = (k.h || 0) * 180 / Math.PI;                    // degrees off straight
  var A = ASSIST[g.assist];
  hErr *= (1 - A.aim * 0.7);
  var lateral = Math.tan(hErr * Math.PI / 180) * dist + (g.r() - 0.5) * (g.easy ? 0.5 : 1.2);
  var good = maxRange >= dist && Math.abs(lateral) < 3.08;          // the posts are 6.17 yards apart
  g.kicked = true;
  g.kickRes = {good: good, dist: Math.round(dist), short: maxRange < dist, lateral: lateral};
  var x0 = g.hashX || 0;
  g.ballObj = {x: x0, y: spotY, z: 0.2, vx: 0, vy: 0, vz: 0, state: 'kick', spin: 0, wob: 0,
               path: {x0: x0, y0: spotY, x1: lateral * 1.15, y1: spotY + Math.min(maxRange, dist + 6), H: maxRange >= dist ? 9 + power * 6 : 7, T: 2.5}};
  g.kickT = 0;
  emit(g, 'kick', {dist: Math.round(dist)});
  return true;
}

/* ---------- running the clock ---------- */
function step(g, dt){
  if(g.ev.length > 500) g.ev = [];             // nobody reading (the attract loop, the checks)
  if(g.over) { g.t += dt; return g; }
  g.t += dt; g.phaseT += dt;
  if(g.clockRunning && !g.untimed){
    if(g.restartIn > 0) g.restartIn -= dt;
    else {
      g.clock -= dt;
      if(g.clock <= 0){
        g.clock = 0; g.clockRunning = false;
        if(g.phase !== 'live'){ endDrive(g, 'clock'); return g; }
      }
    }
  }
  if(g.phase === 'huddle' || g.phase === 'presnap'){
    if(g.clockRunning || g.phase === 'presnap'){
      g.playClock -= dt;
      if(g.playClock <= 0 && !g.untimed && g.clockRunning){ // delay of game
        g.playClock = 25; g.ball = Math.max(1, g.ball - 5); firstDownLineKeep(g, 5);
        emit(g, 'flag', {text: 'DELAY OF GAME - 5 YARDS'});
      }
    }
  }
  if(g.phase === 'live') live(g, dt);
  else if(g.phase === 'dead'){
    if(g.phaseT > 2.6) nextPlay(g);
  }
  return g;
}
function firstDownLineKeep(g, back){ g.toGo += back; }

function live(g, dt){
  g.liveT += dt;
  var P = PLAYS[g.call], o = g.o, b = g.ballObj;
  if(g.call === 'fg'){ return liveKick(g, dt); }

  // the QB drops back; on a run he hands off
  var qb = o.QB;
  if(g.practice && !g.thrown && g.liveT > 9){ emit(g, 'reset', {text: 'TOO SLOW - RESET'}); deadBall(g, g.startBall, false, 'inc'); return; }
  if(!g.thrown && g.carrier === qb){
    var dropTo = g.startBall - 1.2 - (P.drop || 0);
    if(P.kind === 'run'){
      if(g.liveT > 0.55 && !g.handed){
        g.handed = true; g.carrier = o.R; b.owner = o.R; emit(g, 'handoff', {});
      }
    } else if(qb.y > dropTo) moveTo(qb, qb.x, dropTo, dt, 6);
    else { qb.vx = 0; qb.vy = 0; }
    // the pocket collapses
    if(P.kind === 'pass' && g.liveT > g.pocket && !g.thrown){
      g.sacked = true;
      var loss = 5 + Math.round(g.r() * 4);
      emit(g, 'sack', {text: 'SACKED!'});
      g.stats.sacks++;
      deadBall(g, g.startBall - loss, false, 'sack');
      return;
    }
  }

  // offence
  targets(g).concat(o.T, o.R).forEach(function(p){ if(p !== g.carrier) runRoute(g, p, dt); });
  // linemen hold their ground (drawn only)
  g.players.forEach(function(p){
    if(p.side === 'o' && p.pos === 'OL'){
      var push = P.kind === 'run' ? 1.5 : -1.2;
      moveTo(p, p.sx, Math.min(p.sy + push, p.sy + push * g.liveT), dt, 2);
    }
  });

  // the ball carrier
  var c = g.carrier;
  if(c && (g.handed || g.caught)){
    var sx = g.steerX || 0, want = c.speed * (g.caught ? 0.84 : 0.9);    // carrying the ball, cutting, tired legs
    var vx = sx * 0.72 * want, vy = Math.sqrt(Math.max(0, want * want - vx * vx));
    c.vx += (vx - c.vx) * Math.min(1, dt * 6); c.vy += (vy - c.vy) * Math.min(1, dt * 6);
    c.x += c.vx * dt; c.y += c.vy * dt;
    b.x = c.x; b.y = c.y; b.z = 1.1;
    if(Math.abs(c.x) > HALF_W){ deadBall(g, c.y, true, 'oob'); return; }
    if(c.y >= 100){ touchdown(g); return; }
  } else if(c === qb){ b.x = qb.x + 0.3; b.y = qb.y; b.z = 1.8; }

  // the ball in the air
  if(b.state === 'air'){
    g.airT += dt;
    b.vz -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if(b.wob){ b.x += Math.sin(g.airT * 9) * b.wob * dt * 0.8; }
    if(tryCatch(g)) return;
    if(b.z <= 0.05){
      b.z = 0.05;
      // how far from anybody it came down: the practice field's report card
      var miss = 1e9, by = null;
      targets(g).forEach(function(rc){ var d = len(rc.x - b.x, rc.y - b.y); if(d < miss){ miss = d; by = rc; } });
      emit(g, 'incomplete', {text: 'INCOMPLETE', miss: Math.round(miss), dir: by ? (b.y > by.y + 1 ? 'long' : b.y < by.y - 1 ? 'short' : b.x > by.x ? 'right' : 'left') : ''});
      deadBall(g, g.startBall, false, 'inc');
      return;
    }
  }

  // defence
  defend(g, dt);

  // tackles
  if(c && c !== qb){
    for(var i = 0; i < g.players.length; i++){
      var p = g.players[i];
      if(p.side !== 'd' || p.engaged > 0) continue;
      if(len(p.x - c.x, p.y - c.y) < 1.15){
        if(!p.tried){
          p.tried = true;
          var brk = (c.pos === 'RB' ? 0.22 : 0.14) + (g.easy ? 0.2 : 0);
          if(g.r() < brk){ emit(g, 'broken', {text: 'BROKE A TACKLE!'}); p.engaged = 0.7; continue; }
        }
        emit(g, 'tackle', {});
        deadBall(g, c.y, true, 'tackle');
        return;
      }
    }
  }
}

function runRoute(g, p, dt){
  if(p.pos === 'OL') return;
  if(g.thrown && b_inAir(g) && p.target !== false){
    // read the ball: go and get it if he can
    var L = g.landing, rem = Math.max(0.05, L.T - g.airT), d = len(L.x - p.x, L.y - p.y);
    if(d < p.speed * rem + 3 && g.airT > 0.2) { moveTo(p, L.x, L.y, dt, p.speed); return; }
  }
  if(!p.rpts){ // blockers stay home
    if(p.key === 'R' && PLAYS[g.call].kind === 'pass') moveTo(p, p.sx + 0.5, p.sy + 1, dt, 3);
    else if(p.pos !== 'QB') moveTo(p, p.sx, p.sy + 1.5, dt, 3);
    return;
  }
  if(p.ri >= p.rpts.length){
    var a = p.rpts[p.rpts.length - 1], bp = p.rpts.length > 1 ? p.rpts[p.rpts.length - 2] : [p.sx, p.sy];
    var dx = a[0] - bp[0], dy = a[1] - bp[1], dd = len(dx, dy) || 1;
    if(!/^(go|seam|post|corner|wheel|slant)$/.test(p.route)){ p.vx *= 0.85; p.vy *= 0.85; }   // settle in the hole
    else { p.vx = dx / dd * p.speed; p.vy = dy / dd * p.speed; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, -HALF_W + 0.8, HALF_W - 0.8); p.y = Math.min(p.y, 109);
    return;
  }
  var w = p.rpts[p.ri];
  if(moveTo(p, w[0], w[1], dt, p.speed)) p.ri++;
}
function b_inAir(g){ return g.ballObj && g.ballObj.state === 'air'; }

function moveTo(p, x, y, dt, sp){
  var dx = x - p.x, dy = y - p.y, d = len(dx, dy), s = sp * dt;
  if(d <= s){ p.vx = dx / dt; p.vy = dy / dt; p.x = x; p.y = y; return true; }
  p.vx = dx / d * sp; p.vy = dy / d * sp;
  p.x += p.vx * dt; p.y += p.vy * dt;
  return false;
}

function defend(g, dt){
  var b = g.ballObj, qb = g.o.QB, c = g.carrier, P = PLAYS[g.call];
  g.players.forEach(function(p){
    if(p.side !== 'd') return;
    p.hist.push([p.x, p.y]);
    if(p.engaged > 0){ p.engaged -= dt; return; }
    // linemen and blitzers rush the quarterback
    if(p.pos === 'DL' || (p.assign && p.assign.rush)){
      if(c && c !== qb){ pursue(g, p, c, dt); return; }
      var near = g.liveT / Math.max(1, g.pocket);
      var tx = qb.x + (p.x - qb.x) * 0.4, ty = qb.y + 0.6 + (1 - Math.min(1, near)) * 2.5;
      if(P.kind === 'run' && !g.handed) ty = p.sy;
      moveTo(p, tx, ty, dt, p.pos === 'DL' ? 2.6 : 4.5);
      return;
    }
    // ball in the air: break on it after a beat
    if(b.state === 'air'){
      if(g.airT > g.react){
        var L = g.landing, rem = Math.max(0.05, L.T - g.airT), d = len(L.x - p.x, L.y - p.y);
        if(d < p.speed * rem + 1.5){ moveTo(p, L.x, L.y, dt, p.speed); return; }
      }
    }
    // somebody has the ball: go get him
    if(c && c !== qb){
      if(!(P.kind === 'run' && g.liveT < 0.9)) { pursue(g, p, c, dt); return; }
    }
    var a = p.assign || {};
    if(a.man){
      var m = a.man, lag = Math.round((g.react * 0.45) * 60);
      // trail the receiver with a beat of lag: separation comes at the cuts
      var hpos = m.hist.length > lag ? m.hist[m.hist.length - 1 - lag] : [m.sx, m.sy];
      var cushion = p.pos === 'CB' ? 0.9 : 0.6;
      moveTo(p, hpos[0] + (m.x - hpos[0]) * 0.5, hpos[1] + (m.y - hpos[1]) * 0.5 + cushion, dt, p.speed);
    } else if(a.zone && (p.pos === 'S' || (g.cover === 'prevent' && p.pos === 'CB'))){
      // deep zone: stay deeper than the deepest man on this side
      var dz = a.zone, deepest = null;
      targets(g).forEach(function(rc){ if(Math.abs(rc.x - dz[0]) < 15 && (!deepest || rc.y > deepest.y)) deepest = rc; });
      if(deepest && deepest.y > dz[1] - 8) moveTo(p, clamp(deepest.x, dz[0] - 11, dz[0] + 11), Math.min(Math.max(dz[1] - 4, deepest.y + 2.5), 109), dt, p.speed);
      else moveTo(p, dz[0], dz[1], dt, p.speed * 0.6);
    } else if(a.zone){
      var z = a.zone, best = null, bd = 1e9;
      targets(g).forEach(function(rc){
        var dd = len(rc.x - z[0], rc.y - z[1]);
        if(dd < z[2] && dd < bd){ bd = dd; best = rc; }
      });
      if(best) moveTo(p, clamp(best.x, z[0] - z[2], z[0] + z[2]), Math.max(best.y + 1, z[1] - z[2] * 0.6), dt, p.speed * 0.9);
      else moveTo(p, z[0], z[1], dt, p.speed * 0.6);
    }
  });
  // receivers remember where they were, for the man defenders
  targets(g).forEach(function(rc){ rc.hist.push([rc.x, rc.y]); if(rc.hist.length > 90) rc.hist.shift(); });
  g.players.forEach(function(p){ if(p.hist.length > 90) p.hist.shift(); });
  // blocks: a defender reaching a blocker is held up for a moment
  if(P.kind === 'run' || P.screen || g.caught){
    g.players.forEach(function(p){
      if(p.side !== 'd' || p.engaged > 0 || p.blocked) return;
      for(var i = 0; i < g.players.length; i++){
        var q = g.players[i];
        if(q.side !== 'o' || q === g.carrier || q.pos === 'QB') continue;
        if((q.pos === 'OL' || !q.route || g.caught) && len(q.x - p.x, q.y - p.y) < 1.1){
          p.blocked = true; p.engaged = 0.6 + g.r() * (P.screen ? 2.0 : 1.4); break;
        }
      }
    });
  }
}

function pursue(g, p, c, dt){
  // aim where he is going, not where he is
  var d = len(c.x - p.x, c.y - p.y), T = Math.min(1.2, d / p.speed);
  moveTo(p, c.x + c.vx * T * 0.8, c.y + c.vy * T * 0.8, dt, p.speed);
}

function tryCatch(g){
  var b = g.ballObj, A = ASSIST[g.assist];
  if(b.z > 3.1 || b.vz > 2 || g.airT < 0.15) return false;
  var o = null, od = 1e9, dd = null, ddd = 1e9;
  g.players.forEach(function(p){
    if(p.pos === 'OL' || p.pos === 'QB' || p.pos === 'DL') return;
    var d = len(p.x - b.x, p.y - b.y);
    var reach = p.side === 'o' ? A.reach : 1.15;
    if(d > reach) return;
    if(p.side === 'o'){ if(d < od){ od = d; o = p; } }
    else if(d < ddd){ ddd = d; dd = p; }
  });
  if(!o && !dd) return false;
  var inb = Math.abs(b.x) <= HALF_W && b.y <= 110;
  if(dd && (!o || ddd < od - 0.4)){
    // defender gets there first
    var pick = g.r() < (g.easy ? 0.15 : 0.32);
    if(pick && inb){
      emit(g, 'int', {text: 'INTERCEPTED!', by: dd.key});
      g.stats.int++;
      deadBall(g, b.y, false, 'int');
      return true;
    }
    emit(g, 'breakup', {text: 'BROKEN UP!', by: dd.key});
    deadBall(g, g.startBall, false, 'inc');
    return true;
  }
  // receiver gets a hand on it
  var thrownFrom = len(b.x - (b.from ? b.from[0] : b.x), b.y - (b.from ? b.from[1] : b.y));
  var hot = Math.max(0, len(b.vx, b.vy) - 26) * 0.04 * (thrownFrom < 12 ? 1 : 0.25);   // a bullet at close range
  // a defender near the catch: the closer, the harder
  var near = 1e9;
  g.players.forEach(function(q){ if(q.side === 'd' && q.pos !== 'DL'){ var d = len(q.x - b.x, q.y - b.y); if(d < near) near = d; } });
  var contested = near < 2.8 ? (2.8 - near) / 2.8 * 0.6 : 0;
  var p = clamp(0.95 - hot - contested - b.wob * 0.12 - (b.z > 2.5 ? 0.15 : 0) + (g.easy ? 0.1 : 0), 0.15, 0.98);
  if(!inb){
    emit(g, 'incomplete', {text: 'OUT OF BOUNDS'});
    deadBall(g, g.startBall, false, 'inc');
    return true;
  }
  if(g.r() < p){
    g.caught = true; g.carrier = o; b.state = 'held'; b.owner = o;
    o.vx *= 0.6; o.vy = Math.max(o.vy * 0.6, 2);
    g.stats.comp++;
    emit(g, 'catch', {text: 'CAUGHT!', by: o.key, at: [o.x, o.y], air: Math.round(o.y - g.startBall)});
    if(o.y >= 100){ touchdown(g); }
    else if(g.practice) deadBall(g, o.y, true, 'caught');      // practice: the catch is the point
    return true;
  }
  emit(g, contested ? 'breakup' : 'drop', {text: contested ? 'BROKEN UP!' : 'DROPPED!',
    why: contested ? 'defender' : hot > 0.05 ? 'too hot' : b.z > 2.5 ? 'too high' : b.wob > 0.3 ? 'wobbly ball' : 'just dropped it'});
  deadBall(g, g.startBall, false, 'inc');
  return true;
}

function liveKick(g, dt){
  var b = g.ballObj;
  if(!g.kicked){
    if(g.liveT > 6){ kick(g, {power: 0.15, h: 0.3}); }    // nobody kicked: a shank
    return;
  }
  g.kickT += dt;
  var k0 = b.path, u = Math.min(1, g.kickT / k0.T);
  b.x = k0.x0 + (k0.x1 - k0.x0) * u; b.y = k0.y0 + (k0.y1 - k0.y0) * u; b.z = 0.2 + 4 * k0.H * u * (1 - u);
  if(u >= 1){
    var k = g.kickRes;
    if(k.good){
      emit(g, 'fg', {text: 'IT\'S GOOD! ' + k.dist + ' YARDS', good: true});
      g.points += 3;
      endDrive(g, 'fg');
    } else {
      emit(g, 'fgmiss', {text: k.short ? 'SHORT!' : 'NO GOOD! WIDE ' + (k.lateral > 0 ? 'RIGHT' : 'LEFT'), good: false});
      endDrive(g, 'fgmiss');
    }
  }
}

function touchdown(g){
  g.points += 7;
  g.stats.td++;
  var yd = Math.round(100 - g.startBall);
  if(g.thrown) g.stats.yds += yd; else g.stats.rush += yd;
  emit(g, 'td', {text: 'TOUCHDOWN!', by: g.carrier && g.carrier.key, yds: yd});
  g.ball = 100;
  endDrive(g, 'td');
}

/* The play is over. spot = where the ball is now. */
function deadBall(g, spot, inPlayRun, why, forceGain){
  var gain = forceGain != null ? forceGain : spot - g.startBall;
  if(why === 'inc' || why === 'int') gain = 0;
  gain = Math.round(gain);
  if(why === 'sack') gain = Math.min(gain, -3);
  g.ball = clamp(g.startBall + gain, 1, 99);
  if(gain && why !== 'sack'){ if(g.thrown) g.stats.yds += gain; else g.stats.rush += gain; }
  g.lastGain = gain; g.lastWhy = why;
  g.phase = 'dead'; g.phaseT = 0;
  g.ballObj.vx = g.ballObj.vy = g.ballObj.vz = 0;
  if(g.ballObj.state === 'air') g.ballObj.state = 'dead';
  if(why === 'int'){ endDrive(g, 'int'); return; }
  // the clock
  var stop = why === 'inc' || why === 'oob';
  var firstDown = gain >= g.toGo;
  if(!g.untimed){
    if(stop) { g.clockRunning = false; }
    else if(firstDown){ g.clockRunning = true; g.restartIn = 6; }   // college, last two minutes: stops for the chains
    else if(g.clockRunning) g.restartIn = 0;
  }
  if(firstDown){
    g.down = 1; g.toGo = 10; g.goalToGo = g.ball + 10 >= 100;
    if(g.goalToGo) g.toGo = 100 - g.ball;
    emit(g, 'first', {text: 'FIRST DOWN!'});
  } else {
    g.down++; g.toGo -= gain;
  }
  g.plays++;
  var txt = why === 'oob' ? 'Out of bounds, ' + yds(gain) : why === 'inc' ? 'Incomplete' : why === 'sack' ? 'Sacked, ' + yds(gain) : yds(gain);
  g.lastText = txt;
  emit(g, 'dead', {why: why, gain: gain, text: txt});
  if(g.down > 4){ emit(g, 'downs', {text: 'TURNOVER ON DOWNS'}); endDrive(g, 'downs'); return; }
  if(!g.untimed && g.clock <= 0) { endDrive(g, 'clock'); return; }
}
function yds(n){ return n === 0 ? 'no gain' : n > 0 ? 'gain of ' + n : 'loss of ' + (-n); }

function afterDown(g){
  if(g.down > 4){ emit(g, 'downs', {text: 'TURNOVER ON DOWNS'}); endDrive(g, 'downs'); }
}

function nextPlay(g){
  if(g.over) return;
  g.phase = 'huddle'; g.phaseT = 0; g.call = null; g.playClock = 40;
  g.thrown = false; g.caught = false; g.handed = false; g.kicked = false; g.landing = null;
  g.hashX = clamp(g.ballObj ? g.ballObj.x : 0, -6, 6);
  if(g.clockRunning && g.restartIn <= 0){
    // getting up and lining up again: real football burns this whether the
    // phone is quick or not
    g.clock = Math.max(0, g.clock - 6);
    if(g.clock <= 0){ endDrive(g, 'clock'); }
  }
}

function endDrive(g, why){
  if(g.over) return;
  g.over = true; g.phase = 'over'; g.clockRunning = false;
  var win = g.points >= g.need;
  g.result = {why: why, points: g.points, win: g.mode === 'versus' ? null : win};
  emit(g, 'over', {why: why, win: win, points: g.points});
}

/* What a phone or the TV needs to draw the drive. */
function view(g){
  return {
    phase: g.phase, cadence: cadence(g), clock: Math.max(0, g.clock), running: g.clockRunning && g.restartIn <= 0, untimed: g.untimed,
    down: g.down, toGo: Math.max(1, Math.round(g.toGo)), goal: g.goalToGo, ball: Math.round(g.ball), tos: g.tos,
    call: g.call, cover: g.cover, points: g.points, need: g.need, over: g.over, result: g.result,
    text: g.lastText, pc: Math.ceil(g.playClock), canFg: canCall(g, 'fg'), canSpike: canCall(g, 'spike'),
    held: g.phase === 'live' && g.carrier === (g.o && g.o.QB) && !g.thrown && PLAYS[g.call] && PLAYS[g.call].kind === 'pass',
    carrying: g.phase === 'live' && !!g.carrier && g.carrier !== (g.o && g.o.QB),
    kicking: g.phase === 'live' && g.call === 'fg' && !g.kicked,
    pocket: g.phase === 'live' && g.pocket ? clamp(1 - g.liveT / g.pocket, 0, 1) : 1,
    stats: g.stats
  };
}

/* The Touchdown Pass mode: one throw, scored. */
function passScore(g){
  var s = 0;
  g.log.forEach(function(e){
    if(e.type === 'catch') s += 10 + Math.max(0, e.air || 0);
    if(e.type === 'td') s += 30;
  });
  return s;
}

/* ---------- the computer quarterback ----------
   Plays a drive the way a person with a phone would: calls a play that
   suits the situation, waits for the routes, picks the most open man and
   throws with a human's error (sk.aim degrees, sk.dist fraction) through
   the same throwBall a phone uses, so the assist is tested too. Steers for
   the sideline when the clock matters. Used by simcheck and the TV's
   attract mode. */
function bot(g, dt, sk){
  sk = sk || {aim: 6, dist: 0.12, patience: 1};
  var b = g.bot || (g.bot = {wait: 0});
  b.wait -= dt;
  if(g.over) return;
  if(g.phase === 'huddle'){
    if(b.wait > 0) return;
    var yl = 100 - g.ball, late = !g.untimed && g.clock < 30;
    var key;
    if(!g.untimed && g.clock < 22 && g.restartIn <= 0 && g.down < 4 && g.clockRunning && g.tos === 0) key = 'spike';
    else if(g.down === 4 && yl + 17 <= 50 && g.points + 3 >= g.need) key = 'fg';
    else if(!g.untimed && g.clock < 12 && yl > 30) key = 'hail';
    else if(!g.untimed && g.clock < 6 && yl + 17 <= 52 && g.points + 3 >= g.need) key = 'fg';
    else {
      var opts = late ? ['outs', 'outs', 'curls', 'post', 'slants'] : g.toGo <= 3 ? ['run', 'slants', 'slants', 'screen'] : ['slants', 'outs', 'curls', 'post', 'screen', 'run'];
      key = opts[Math.floor(g.r() * opts.length)];
    }
    if(!canCall(g, key)) key = 'slants';
    if(key !== 'spike' && g.clockRunning && g.tos > 0 && !g.untimed && g.clock < 40) timeout(g);
    callPlay(g, key);
    b.wait = 0.6 + g.r() * 0.6;
    b.throwAt = 1.4 + g.r() * 1.2 * sk.patience;
    return;
  }
  if(g.phase === 'presnap'){ if(b.wait <= 0) snap(g); return; }
  if(g.phase !== 'live') return;
  if(g.call === 'fg'){ if(g.liveT > 0.8 && !g.kicked) kick(g, {power: 0.55 + g.r() * 0.45, h: gauss(g) * (sk.aim || 6) * Math.PI / 180}); return; }
  var qb = g.o.QB;
  if(g.carrier === qb && !g.thrown && PLAYS[g.call].kind === 'pass' && g.liveT > Math.min(b.throwAt, g.pocket - 0.25)){
    var best = null, bs = -1e9, cands = [];
    targets(g).forEach(function(rc){
      var L = leadFor(g, rc, 22, 0.42);
      if(!L) return;
      L.rc = rc; cands.push(L);
      var sep = 1e9;
      g.players.forEach(function(p){ if(p.side === 'd' && p.pos !== 'DL'){ var d = len(p.x - L.x, p.y - L.y) - p.speed * L.T * 0.5; if(d < sep) sep = d; } });
      var score = Math.min(sep, 6) * 3 + (L.y - g.ball) * 0.25 + (L.y >= 100 ? 6 : 0) + (Math.abs(L.x) > HALF_W - 3 && !g.untimed && g.clock < 60 ? 2 : 0);
      if(score > bs){ bs = score; best = L; }
    });
    if(best){
      // a person reads the field less well: sometimes the wrong man, sometimes the wrong ball
      var pick = best;
      if(g.r() > (sk.pick == null ? 0.8 : sk.pick)) pick = cands[Math.floor(g.r() * cands.length)];
      var under = false;
      g.players.forEach(function(p){
        if(p.side !== 'd' || p.pos === 'DL') return;
        var ax = pick.x - qb.x, ay = pick.y - qb.y, L2 = ax * ax + ay * ay, u = ((p.x - qb.x) * ax + (p.y - qb.y) * ay) / L2;
        if(u > 0.2 && u < 0.85 && Math.abs((p.x - qb.x) * ay - (p.y - qb.y) * ax) / Math.sqrt(L2) < 2.5) under = true;
      });
      var kind = pick.d > 26 || under ? 'LOB' : 'BULLET';
      if(g.r() > (sk.kind == null ? 0.8 : sk.kind)) kind = kind === 'LOB' ? 'BULLET' : 'LOB';
      throwTo(g, {to: pick.rc.key, kind: kind, spin: 0.6});
    }
  }
  if(g.carrier && g.carrier !== qb){
    var c = g.carrier, wantOut = !g.untimed && g.clock < 70 && g.clock > 0;
    var side = c.x >= 0 ? 1 : -1;
    // run at the gap: away from the nearest defender, toward the sideline late
    var nd = null, ndd = 1e9;
    g.players.forEach(function(p){ if(p.side === 'd'){ var d = len(p.x - c.x, p.y - c.y); if(d < ndd && p.y > c.y - 1){ ndd = d; nd = p; } } });
    var sx = 0;
    if(nd && ndd < 6) sx = nd.x > c.x ? -0.8 : 0.8;
    if(wantOut && (ndd < 4 || Math.abs(c.x) > 18)) sx = side;
    steer(g, sx);
  }
}
function gauss(g){ return (g.r() + g.r() + g.r() - 1.5) * 1.41; }

var API = {SET_AT: SET_AT, cadence: cadence, throwTo: throwTo, pickTarget: pickTarget, bot: bot, newDrive: newDrive, step: step, callPlay: callPlay, snap: snap, throwBall: throwBall, steer: steer,
  kick: kick, timeout: timeout, view: view, canCall: canCall, passScore: passScore, leadFor: leadFor, targets: targets,
  PLAYS: PLAYS, PLAY_ORDER: PLAY_ORDER, COVERS: COVERS, ASSIST: ASSIST, SCENARIOS: SCENARIOS, HALF_W: HALF_W, G: G};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.GSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
