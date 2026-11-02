/* Gridiron - the players: built from simple shapes, but built like
   football players. All sizes in yards (a 6'2" player is 2.05 yd tall).

   A figure faces -z in its own frame. Its parts hang off pivots so it can
   take a stance, run, throw and reach for a catch:
     root (on the ground)
       hipL / hipR -> thigh, kneeL / kneeR -> shin, sock, cleat
       body (at the hips; leans) -> pants, jersey (number front, name and
         number back), shoulder pads, neck, helmet (shell, stripe, logo,
         facemask), shoulderL / shoulderR -> sleeve, elbow -> forearm, glove
   Shared geometry and one material per colour; each jersey has its own
   small canvas (its number and name). */
import * as THREE from './lib/three.module.min.js';

/* Saturday's uniforms: Utah at home in red, BYU on the road in white. */
export const KITS = {
  utah: {jersey: '#c8102e', number: '#ffffff', outline: '#111111', trim: '#ffffff', pants: '#f2f2f2', stripe: '#c8102e',
         sock: '#c8102e', cleat: '#151515', helmet: '#c8102e', helmetStripe: null, mask: '#1b1b1b', logo: 'U', logoCol: '#ffffff', logoEdge: '#111111', glove: '#151515'},
  byu:  {jersey: '#f7f7f7', number: '#0062b8', outline: '#002e5d', trim: '#0062b8', pants: '#f2f2f2', stripe: '#0062b8',
         sock: '#0062b8', cleat: '#f2f2f2', helmet: '#f7f7f7', helmetStripe: '#002e5d', mask: '#8f9aa8', logo: 'Y', logoCol: '#0062b8', logoEdge: '#002e5d', glove: '#0062b8'}
};
const SKIN = ['#8d5a3b', '#6b4029', '#c58c66', '#a8714e', '#e0b293', '#7a4a2c', '#b98060', '#55331f'];

const H = {hip: 0.98, thigh: 0.45, shin: 0.46, shoulderY: 0.6, shoulderX: 0.31, upper: 0.3, fore: 0.29};

function tex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createPlayers(scene, opts = {}){
  const low = !!opts.low;
  const mats = {};
  const mat = (c, extra) => mats[c + (extra ? '+' : '')] || (mats[c + (extra ? '+' : '')] = new THREE.MeshLambertMaterial(Object.assign({color: c}, extra || {})));
  const G = {
    pants: new THREE.CylinderGeometry(0.2, 0.17, 0.26, 12),
    jersey: new THREE.CylinderGeometry(0.27, 0.2, 0.56, 20, 1, false, Math.PI / 2, Math.PI * 2),
    pads: new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    neck: new THREE.CylinderGeometry(0.075, 0.085, 0.12, 8),
    helmet: new THREE.SphereGeometry(0.175, 18, 14),
    stripe: new THREE.TorusGeometry(0.178, 0.022, 6, 28, Math.PI * 0.95),
    bar: new THREE.CylinderGeometry(0.012, 0.012, 1, 5),
    logo: new THREE.PlaneGeometry(0.2, 0.2),
    sleeve: new THREE.CylinderGeometry(0.085, 0.07, H.upper, 8),
    fore: new THREE.CylinderGeometry(0.06, 0.05, H.fore, 8),
    glove: new THREE.SphereGeometry(0.06, 8, 6),
    thigh: new THREE.CylinderGeometry(0.105, 0.08, H.thigh, 10),
    shin: new THREE.CylinderGeometry(0.07, 0.055, H.shin, 8),
    cleat: new THREE.BoxGeometry(0.1, 0.07, 0.24),
    shadow: new THREE.PlaneGeometry(1.4, 1.4)
  };
  // geometry that hangs down from its pivot
  [G.sleeve, G.fore, G.thigh, G.shin].forEach(g => g.translate(0, -g.parameters.height / 2, 0));
  const shadowTex = tex(64, 64, (g, W) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
  });
  const shadowMat = new THREE.MeshBasicMaterial({map: shadowTex, transparent: true, depthWrite: false});
  const logoMats = {};
  function logoMat(team){
    if(logoMats[team]) return logoMats[team];
    const k = KITS[team];
    return logoMats[team] = new THREE.MeshLambertMaterial({transparent: true, map: tex(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.font = '900 112px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 14; g.strokeStyle = k.logoEdge; g.strokeText(k.logo, 64, 70);
      g.fillStyle = k.logoCol; g.fillText(k.logo, 64, 70);
    })});
  }
  /* The jersey: a 512x256 canvas wrapped round the torso. u = 0.25 is the
     chest, u = 0.75 the back (see the geometry's thetaStart). */
  function jerseyMat(team, num, last){
    const k = KITS[team];
    return new THREE.MeshLambertMaterial({map: tex(512, 256, (g, W, Hh) => {
      g.fillStyle = k.jersey; g.fillRect(0, 0, W, Hh);
      // side panels and the collar trim
      g.fillStyle = k.trim; g.globalAlpha = 0.9;
      g.fillRect(0, 0, 18, Hh); g.fillRect(238, 0, 36, Hh); g.fillRect(494, 0, 18, Hh);
      g.globalAlpha = 1;
      g.fillRect(96, 0, 64, 8); g.fillRect(352, 0, 64, 8);
      const n = String(num);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 150px "Arial Black", Impact, sans-serif';
      g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = k.outline;
      g.strokeText(n, 128, 150); g.fillStyle = k.number; g.fillText(n, 128, 150);
      g.strokeText(n, 384, 168); g.fillText(n, 384, 168);
      // the name across the shoulders on the back
      g.font = '900 34px "Arial Black", Impact, sans-serif'; g.lineWidth = 6;
      const nm = (last || '').toUpperCase();
      const w = g.measureText(nm).width, sc = Math.min(1, 200 / Math.max(1, w));
      g.save(); g.translate(384, 50); g.scale(sc, 1);
      g.strokeText(nm, 0, 0); g.fillText(nm, 0, 0); g.restore();
    })});
  }

  function limb(parent, x, y, geo, m){
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); parent.add(pivot);
    pivot.add(new THREE.Mesh(geo, m));
    return pivot;
  }

  /* One player. team: 'byu' | 'utah'; who: {num, last} or null. */
  function build(team, who, seed){
    const k = KITS[team];
    const skin = mat(SKIN[seed % SKIN.length]);
    const root = new THREE.Group();
    const body = new THREE.Group(); body.position.y = H.hip; root.add(body);
    const pants = new THREE.Mesh(G.pants, mat(k.pants)); pants.scale.set(1.15, 1, 0.75); pants.position.y = 0.04; body.add(pants);
    const jersey = new THREE.Mesh(G.jersey, who ? jerseyMat(team, who.num, who.last) : mat(k.jersey)); jersey.scale.z = 0.66; jersey.position.y = 0.37; body.add(jersey);
    const pads = new THREE.Mesh(G.pads, mat(k.jersey)); pads.scale.set(1.18, 0.5, 0.78); pads.position.y = 0.6; body.add(pads);
    const neck = new THREE.Mesh(G.neck, skin); neck.position.y = 0.7; body.add(neck);
    // helmet
    const head = new THREE.Group(); head.position.y = 0.88; body.add(head);
    const shell = new THREE.Mesh(G.helmet, mat(k.helmet, {emissive: 0x111111})); shell.scale.set(0.95, 1, 1.1); head.add(shell);
    if(k.helmetStripe){
      // the stripe runs over the crown, front to back, hugging the shell
      const st = new THREE.Mesh(G.stripe, mat(k.helmetStripe));
      st.rotation.y = Math.PI / 2; st.rotation.z = Math.PI * 0.025; st.scale.set(1.1, 1, 0.95); head.add(st);
    }
    [-1, 1].forEach(sd => {
      const lg = new THREE.Mesh(G.logo, logoMat(team));
      lg.position.set(sd * 0.17, 0.01, 0.03); lg.rotation.y = sd * Math.PI / 2;
      head.add(lg);
    });
    if(!low){
      const mm = mat(k.mask);
      // the facemask: three bars across, two down
      [[0.0, 0.2], [-0.06, 0.19], [-0.12, 0.15]].forEach(([y, w]) => {
        const b = new THREE.Mesh(G.bar, mm); b.scale.y = w; b.rotation.z = Math.PI / 2; b.position.set(0, y, -0.2); head.add(b);
      });
      [-0.05, 0.05].forEach(x => { const b = new THREE.Mesh(G.bar, mm); b.scale.y = 0.14; b.position.set(x, -0.06, -0.205); head.add(b); });
    }
    // arms
    const arms = [-1, 1].map(sd => {
      const sh = limb(body, sd * H.shoulderX, H.shoulderY - 0.04, G.sleeve, mat(k.jersey));
      const el = limb(sh, 0, -H.upper, G.fore, skin); el.position.y = -H.upper;
      const gl = new THREE.Mesh(G.glove, mat(k.glove)); gl.position.y = -H.fore - 0.02; el.add(gl);
      sh.rotation.z = sd * 0.18;
      return {sh, el};
    });
    // legs
    const legs = [-1, 1].map(sd => {
      const hip = limb(root, sd * 0.11, H.hip, G.thigh, mat(k.pants));
      const kn = limb(hip, 0, -H.thigh, G.shin, mat(k.sock)); kn.position.y = -H.thigh;
      const cl = new THREE.Mesh(G.cleat, mat(k.cleat)); cl.position.set(0, -H.shin - 0.01, -0.05); kn.add(cl);
      return {hip, kn};
    });
    if(low){ const sh = new THREE.Mesh(G.shadow, shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; root.add(sh); }
    else root.traverse(o => { if(o.isMesh) o.castShadow = true; });
    root.userData = {body, head, arms, legs, phase: seed * 1.7, facing: 0, lean: 0, crouch: 0, team, who};
    scene.add(root);
    return root;
  }

  /* Pose a figure. a = {speed (yd/s), stance 0..1 (crouch), lineman (hand
     down), throwArm 0..1 (cocked) or -1..0 (following through), reach (arms
     up for a catch), carry (ball tucked)}. dt seconds.
     Signs (the figure faces -z): a limb hanging down swings FORWARD with a
     positive rotation.x; the body, standing up, leans forward with a
     negative one. Knees bend back (negative), elbows forward (positive). */
  function pose(f, a, dt){
    const u = f.userData, sp = a.speed || 0;
    u.phase += dt * (2.2 + sp * 1.25);
    const run = Math.min(1, sp / 3.5), s = Math.sin(u.phase), c = Math.cos(u.phase);
    const crouch = a.stance || 0;
    const ease = k => Math.min(1, dt * k);
    // legs: swing from the hip, fold the knee on the back-swing; a crouch bends both
    u.legs.forEach((L, i) => {
      const ph = i ? -1 : 1;
      const hipX = crouch * 0.95 + ph * s * 0.75 * run;
      const knX = -(crouch * 1.5 + run * (0.25 + 1.0 * Math.max(0, -ph * c)));
      L.hip.rotation.x += (hipX - L.hip.rotation.x) * ease(16);
      L.kn.rotation.x += (knX - L.kn.rotation.x) * ease(16);
    });
    // keep the feet on the ground: how tall the legs are with this much bend
    const t1 = crouch * 0.95, t2 = t1 - crouch * 1.5;
    const legH = H.thigh * Math.cos(t1) + H.shin * Math.cos(t2) + 0.04;
    const y = legH + run * 0.05 * Math.abs(c);
    u.body.position.y += (y - u.body.position.y) * ease(12);
    u.legs.forEach(L => { L.hip.position.y = u.body.position.y; });
    // lean: forward when running, more in a stance, most with a hand down
    const lean = Math.min(0.42, sp * 0.045) + crouch * (a.lineman ? 0.9 : 0.45);
    u.lean += (lean - u.lean) * ease(8);
    u.body.rotation.x = -u.lean;
    u.head.rotation.x = u.lean * 0.8;                         // eyes up the field
    // arms: pump opposite to the legs, elbows bent
    u.arms.forEach((A, i) => {
      const out = i ? 1 : -1, ph = i ? 1 : -1;
      let shX = -ph * s * 0.9 * run + crouch * 0.25, shZ = out * 0.18, el = 0.45 + run * 0.95;
      if(a.lineman){ shX = i ? 0.35 + u.lean * 0.9 : 0.6; el = i ? 0.05 : 1.3; }          // one hand down in the dirt
      if(a.reach){ shX = 2.65 + 0.15 * Math.sin(u.phase * 0.7 + i); el = 0.3; shZ = out * 0.3; }
      if(a.carry && i === 1){ shX = -0.25; el = 2.2; shZ = 0.05; }                       // ball tucked high and tight
      if(a.throwArm != null && i === 1){
        if(a.throwArm >= 0){ shX = -2.5 * a.throwArm - 0.2; el = 1.7 * a.throwArm; shZ = 0.35; }   // cocked by the ear
        else { const k2 = -a.throwArm; shX = -2.9 + 3.6 * k2; el = 0.3; shZ = 0.15; }        // over the top and through
      }
      if(a.throwArm != null && a.throwArm >= 0 && i === 0){ shX = 0.9; el = 1.3; shZ = 0.1; }   // off hand on the ball
      A.sh.rotation.x += (shX - A.sh.rotation.x) * ease(14);
      A.sh.rotation.z += (shZ - A.sh.rotation.z) * ease(14);
      A.el.rotation.x += (el - A.el.rotation.x) * ease(14);
    });
  }

  /* A name tag over a player: "#3 KASPER" on the team colour. */
  const tagCache = {};
  function tag(team, who){
    const key = team + who.num + who.last;
    if(tagCache[key]) return tagCache[key].clone();
    const k = KITS[team];
    const m = new THREE.SpriteMaterial({depthTest: false, transparent: true, map: tex(256, 64, (g, W, Hh) => {
      g.fillStyle = team === 'utah' ? 'rgba(200,16,46,0.92)' : 'rgba(0,46,93,0.92)';
      g.beginPath(); g.roundRect ? g.roundRect(2, 6, W - 4, Hh - 12, 14) : g.rect(2, 6, W - 4, Hh - 12); g.fill();
      g.fillStyle = '#fff'; g.font = '900 30px system-ui, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const t = '#' + who.num + ' ' + who.last.toUpperCase();
      const w = g.measureText(t).width, sc = Math.min(1, (W - 24) / w);
      g.save(); g.translate(W / 2, Hh / 2 + 1); g.scale(sc, 1); g.fillText(t, 0, 0); g.restore();
    })});
    const s = new THREE.Sprite(m); s.scale.set(3.2, 0.8, 1); s.renderOrder = 10;
    tagCache[key] = s;
    return s.clone();
  }

  return {build, pose, tag, KITS};
}
