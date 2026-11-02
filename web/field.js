/* Gridiron - the TV's picture: a morning game at a mountain stadium.

   Draws a GSim drive. Sim yards -> three.js: X = x, Y = z (up), Z = -y,
   so the offense always drives away from the camera, the way a broadcast
   shoots a drive from behind the quarterback.

   Light enough for a Fire TV Stick: no post-processing, blob shadows, one
   canvas texture for the whole field. */
import * as THREE from './lib/three.module.min.js';
import {createPlayers} from './players.js';

export const TEAMS = {
  byu:  {name: 'BYU', nick: 'COUGARS', col: '#002E5D', alt: '#ffffff', trim: '#0062B8', helmet: '#ffffff'},
  utah: {name: 'UTAH', nick: 'UTES', col: '#CC0000', alt: '#ffffff', trim: '#8b0000', helmet: '#CC0000'}
};

function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* The field: 53.3 wide, -10..110 long, 10 px a yard across, 10 along. */
function fieldTexture(off, def){
  const PX = 12;
  return canvasTex(Math.round(53.3 * PX), 120 * PX, (g, W, H) => {
    const Y = y => H - (y + 10) * PX;            // field y -> canvas y
    for(let y = 0; y < 100; y += 5){
      g.fillStyle = (y / 5) % 2 ? '#3f8a2e' : '#47963a';
      g.fillRect(0, Y(y + 5), W, 5 * PX);
    }
    // end zones: the offense's own (y<0) and the one it attacks (y>100)
    const ez = (y0, team) => {
      g.fillStyle = team.col; g.fillRect(0, Y(y0 + 10), W, 10 * PX);
      g.save(); g.translate(W / 2, Y(y0 + 5));
      if(y0 < 0) g.rotate(Math.PI);
      g.fillStyle = team.alt; g.font = `900 ${7 * PX}px Impact, "Arial Black", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(team.nick, 0, 0);
      g.restore();
    };
    ez(-10, off); ez(100, def);
    // lines
    g.fillStyle = 'rgba(255,255,255,0.92)';
    for(let y = 0; y <= 100; y += 5) g.fillRect(0, Y(y) - 2, W, y % 50 === 0 ? 5 : 4);
    g.fillRect(0, 0, 5, H); g.fillRect(W - 5, 0, 5, H);
    // hash marks every yard, college hashes 20 yards apart (+-10 ft... 6.67 yd from centre)
    for(let y = 1; y < 100; y++){
      if(y % 5 === 0) continue;
      [-26.15, -6.67, 6.67, 26.15].forEach(x => g.fillRect((x + 26.65) * PX - 6, Y(y) - 1, 12, 3));
    }
    // numbers
    g.font = `900 ${2.6 * PX}px "Arial Black", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for(let y = 10; y <= 90; y += 10){
      const n = y <= 50 ? y : 100 - y;
      [[-17.5, -Math.PI / 2], [17.5, Math.PI / 2]].forEach(([x, rot]) => {
        g.save(); g.translate((x + 26.65) * PX, Y(y)); g.rotate(rot);
        g.fillText(String(n), 0, 0); g.restore();
      });
    }
    // midfield
    g.save(); g.translate(W / 2, Y(50));
    g.beginPath(); g.arc(0, 0, 5.5 * PX, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill();
    g.font = `900 ${2.4 * PX}px Impact, "Arial Black", sans-serif`; g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText('HOLY WAR', 0, 0);
    g.restore();
    // a little turf grain
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for(let i = 0; i < d.length; i += 4){ const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
  });
}

function crowdTexture(main, other){
  // rows of seats, a fan in most of them; square-ish pixels once stretched over the stand
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#2a2c31'; g.fillRect(0, 0, W, H);
    for(let row = 0; row < 64; row++){
      g.fillStyle = '#1d1f23'; g.fillRect(0, row * 8 + 6, W, 2);
      if(row % 16 === 15){ g.fillStyle = '#5b5e66'; g.fillRect(0, row * 8 + 2, W, 6); continue; }   // a walkway
      for(let i = 0; i < 128; i++){
        const r = Math.random();
        if(r > 0.93) continue;
        g.fillStyle = r < 0.6 ? main : r < 0.78 ? other : r < 0.86 ? '#d9d2c4' : '#4a4038';
        g.fillRect(i * 4 + Math.random() * 0.8, row * 8 + Math.random() * 1.5, 3, 5);
      }
      for(let x = 0; x < W; x += 128){ g.fillStyle = '#6a6d75'; g.fillRect(x, row * 8, 6, 8); }   // aisles
    }
  });
}

function mountainTexture(){
  return canvasTex(2048, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    // the Wasatch in the morning: hazy blue ridges, snow on the tops
    [['#7f93b3', 0.25, 90], ['#5d7193', 0.42, 60], ['#46597a', 0.6, 38]].forEach(([col, base, amp], k) => {
      g.beginPath(); g.moveTo(0, H);
      for(let x = 0; x <= W; x += 8){
        const y = H * base + Math.sin(x * 0.004 + k) * amp * 0.5 + Math.sin(x * 0.011 + k * 3) * amp * 0.3 + Math.sin(x * 0.031 + k) * amp * 0.12;
        g.lineTo(x, y);
      }
      g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill();
      if(k === 0){
        g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.75)';
        g.fillRect(0, 0, W, H * base + 4); g.restore();
      }
    });
  });
}

function S_PASS(g){ return g.call && !/^(run|fg|spike)$/.test(g.call); }

export function createField(canvas, opts = {}){
  const low = !!opts.low;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: !low, powerPreference: 'high-performance'});
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // sun shadows for the players (not on a slow box: ?q=low keeps the soft blobs)
  if(!low){ renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 900);

  // a 10 a.m. sky
  scene.background = canvasTex(4, 256, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#4f86c9'); gr.addColorStop(0.55, '#9cc3ea'); gr.addColorStop(1, '#e8ecef');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  scene.fog = new THREE.Fog(0xc9d8e8, 160, 520);
  scene.add(new THREE.HemisphereLight(0xdde9ff, 0x3a5a2a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
  sun.position.set(-80, 60, -40);
  scene.add(sun);
  if(!low){
    // the shadow camera follows the play: 60 yards square round the ball
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun.target);
  }

  // field
  let off = TEAMS.byu, def = TEAMS.utah;
  const fieldMat = new THREE.MeshLambertMaterial({map: fieldTexture(off, def)});
  const field = new THREE.Mesh(new THREE.PlaneGeometry(53.3, 120), fieldMat);
  field.rotation.x = -Math.PI / 2; field.position.set(0, 0, -50);
  field.receiveShadow = true;
  scene.add(field);
  // pylons at the corners of both end zones
  const pylonGeo = new THREE.BoxGeometry(0.11, 0.5, 0.11), pylonMat = new THREE.MeshLambertMaterial({color: 0xff6a13, emissive: 0x331100});
  [0, 10, 100, 110].forEach(y => [-26.65, 26.65].forEach(x => {
    const pl = new THREE.Mesh(pylonGeo, pylonMat); pl.position.set(x, 0.25, -y); pl.castShadow = !low; scene.add(pl);
  }));
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(110, 170), new THREE.MeshLambertMaterial({color: 0x356e27}));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.02, -50);
  scene.add(apron);

  // stands: home (Utah red) on most of it, a blue visitor corner
  const stands = new THREE.Group();
  function stand(w, x, z, rotY, main, other, hgt = 34, y = 13){
    const tex = crowdTexture(main, other);
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(w / 40, 1);
    tex.repeat.y = hgt / 34;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshLambertMaterial({map: tex, side: THREE.DoubleSide}));
    m.position.set(x, y, z); m.rotation.y = rotY; m.rotateX(-0.62);
    stands.add(m);
  }
  stand(150, -48, -50, Math.PI / 2, '#b8202a', '#ffffff');
  stand(150, 48, -50, -Math.PI / 2, '#b8202a', '#ffffff');
  stand(80, 0, -126, 0, '#b8202a', '#ffffff', 16, 5.5);       // the open end: the Wasatch behind it
  stand(80, 0, 30, Math.PI, '#173f74', '#ffffff');
  scene.add(stands);
  const mtn = new THREE.Mesh(new THREE.CylinderGeometry(420, 420, 110, 64, 1, true),
    new THREE.MeshBasicMaterial({map: mountainTexture(), transparent: true, side: THREE.BackSide, fog: false}));
  mtn.material.map.wrapS = THREE.RepeatWrapping; mtn.material.map.repeat.set(3, 1);
  mtn.position.set(0, 46, -50);
  scene.add(mtn);

  // goalposts
  function posts(y){
    const mat = new THREE.MeshLambertMaterial({color: 0xffd21f, emissive: 0x332200});
    const gp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.33), mat); base.position.y = 1.66;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.17), mat); bar.rotation.z = Math.PI / 2; bar.position.y = 3.33;
    gp.add(base, bar);
    [-3.08, 3.08].forEach(x => { const u = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10), mat); u.position.set(x, 8.33, 0); gp.add(u); });
    gp.position.z = -y;
    scene.add(gp);
  }
  posts(110); posts(-10);

  // lines of scrimmage and to gain
  function band(col, op){
    const m = new THREE.Mesh(new THREE.PlaneGeometry(53.3, 0.32), new THREE.MeshBasicMaterial({color: col, transparent: true, opacity: op, depthWrite: false}));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 2;
    scene.add(m); return m;
  }
  const losLine = band(0x2f7bff, 0.85), fdLine = band(0xffe100, 0.9);

  // players: real kits, numbers and names (rosters.js), built in players.js
  const PL = createPlayers(scene, {low});
  const shadowTex = canvasTex(64, 64, (g, W) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
  });
  const shadowMat = new THREE.MeshBasicMaterial({map: shadowTex, transparent: true, depthWrite: false});
  const figs = new Map();          // team + slot -> figure (built the first time it is needed)
  function figFor(team, slot, i){
    const key = team + ':' + slot;
    let f = figs.get(key);
    if(!f){
      const R = window.GRoster, who = R && R.who(team, slot);
      f = PL.build(team, who, i * 7 + (team === 'utah' ? 3 : 0));
      if(who){ f.userData.tag = PL.tag(team, who); f.userData.tag.position.y = 2.75; f.userData.tag.visible = false; f.add(f.userData.tag); }
      figs.set(key, f);
    }
    return f;
  }
  const STANCE = {OL: 1, DL: 1, QB: 0.2, WR: 0.45, TE: 0.5, RB: 0.5, LB: 0.55, CB: 0.4, S: 0.3};

  // the ball
  const ball = new THREE.Group();
  const leather = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshLambertMaterial({color: 0x7a3d17}));
  leather.scale.set(1, 1, 1.75);
  const lace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.2), new THREE.MeshBasicMaterial({color: 0xffffff}));
  lace.position.y = 0.19;
  ball.add(leather, lace);
  scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), shadowMat);
  ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.025;
  scene.add(ballShadow);
  const trail = [];
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(60 * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.55}));
  trailLine.frustumCulled = false;
  scene.add(trailLine);

  // routes, drawn before the snap
  const routeGroup = new THREE.Group(); scene.add(routeGroup);
  const routeMat = new THREE.MeshBasicMaterial({color: 0xfff6b0, transparent: true, opacity: 0.8, depthWrite: false});
  let routesFor = null;
  function drawRoutes(g){
    while(routeGroup.children.length){ const c = routeGroup.children.pop(); c.geometry.dispose(); }
    if(!g.o) return;
    ['X', 'Z', 'Y', 'T', 'R'].forEach(k => {
      const p = g.o[k];
      if(!p.rpts) return;
      const pts = [new THREE.Vector3(p.sx, 0.06, -p.sy)].concat(p.rpts.map(w => new THREE.Vector3(w[0], 0.06, -w[1])));
      const last = p.rpts[p.rpts.length - 1], prev = pts[pts.length - 2];
      if(!/curl|quick|out|screen/.test(p.route)){
        const dx = last[0] + (last[0] - prev.x) * 0.0, dz = -last[1];
        const dir = new THREE.Vector3(last[0] - prev.x, 0, -last[1] - prev.z).normalize();
        pts.push(new THREE.Vector3(dx + dir.x * 4, 0.06, dz + dir.z * 4));
      }
      // a flat ribbon, wide enough to read from the couch
      const path = new THREE.CurvePath();
      for(let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 8, 0.22, 4, false), routeMat);
      tube.scale.y = 0.2; tube.renderOrder = 2;
      routeGroup.add(tube);
    });
  }

  // the quarterback's aim, while he holds the ball
  const aimMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false});
  const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1), aimMat);
  aim.rotation.x = -Math.PI / 2; aim.visible = false; aim.renderOrder = 3;
  const aimPivot = new THREE.Group(); aimPivot.add(aim); scene.add(aimPivot);
  // the receiver the QB is facing: who gets it if he throws now
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({color: 0xffd21f, transparent: true, opacity: 0.85, depthWrite: false}));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.renderOrder = 3; ring.visible = false;
  scene.add(ring);

  // camera
  const camPos = new THREE.Vector3(0, 12, 20), camLook = new THREE.Vector3(0, 0, -20);
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();

  let offKey = 'byu', defKey = 'utah';
  function setTeams(o, d){
    offKey = o === 'utah' ? 'utah' : 'byu'; defKey = d === 'byu' ? 'byu' : 'utah';
    off = TEAMS[o] || TEAMS.byu; def = TEAMS[d] || TEAMS.utah;
    fieldMat.map.dispose(); fieldMat.map = fieldTexture(off, def); fieldMat.needsUpdate = true;
    // whoever is attacking, the end you drive at should be the home end: the field is turned, not repainted
  }

  function resize(){
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  let lastCall = null, lastG = null, tPrev = performance.now();
  function draw(g, live){
    const now = performance.now(), dt = Math.min(0.1, (now - tPrev) / 1000); tPrev = now;
    live = live || {};
    if(!g){ renderer.render(scene, camera); return; }
    if(g !== lastG){ trail.length = 0; lastG = g; }
    losLine.position.z = -g.ball; losLine.visible = g.phase !== 'over';
    const fd = g.ball + g.toGo;
    fdLine.position.z = -fd; fdLine.visible = g.phase !== 'over' && fd < 100 && g.call !== 'fg';
    // players
    const ps = g.phase === 'huddle' && !g.o ? [] : g.players;
    const used = new Set();
    const air = g.ballObj && g.ballObj.state === 'air';
    ps.forEach((p, i) => {
      if(g.phase === 'huddle') return;
      const team = p.side === 'o' ? offKey : defKey;
      const f = figFor(team, p.key || (p.pos + i), i);
      used.add(f); f.visible = true;
      f.position.set(p.x, 0, -p.y);
      const sp = Math.hypot(p.vx, p.vy);
      const u = f.userData;
      // which way he faces: where he runs; at rest, at the other team; a
      // defender dropping into coverage backpedals, still facing the ball
      let face = p.side === 'o' ? 0 : Math.PI;
      if(sp > 0.6){
        face = Math.atan2(-p.vx, p.vy);
        if(p.side === 'd' && p.vy > 0 && !g.thrown && !(g.carrier && g.carrier !== (g.o && g.o.QB)) && sp < 7.5) face = Math.PI;
      }
      if(p.side === 'o' && p.pos === 'QB' && g.phase === 'live' && g.carrier === p) face = live.aim != null && !g.thrown ? live.aim * 0.6 : face;
      let d = face - u.facing; while(d > Math.PI) d -= 2 * Math.PI; while(d < -Math.PI) d += 2 * Math.PI;
      u.facing += d * Math.min(1, dt * 10);
      f.rotation.y = u.facing;
      // what he is doing
      const pre = g.phase === 'presnap';
      const a = {speed: sp};
      if(pre) a.stance = STANCE[p.pos] || 0.3;
      else if((p.pos === 'OL' || p.pos === 'DL') && g.phase === 'live' && g.liveT < 3.5) a.stance = 0.45;
      a.lineman = pre && (p.pos === 'OL' || p.pos === 'DL');
      if(p.pos === 'QB' && g.phase === 'live' && g.call !== 'fg' && S_PASS(g)){
        if(g.carrier === p && !g.thrown) a.throwArm = Math.min(1, g.liveT / 0.4);
        else if(g.thrown && g.airT != null && g.airT < 0.45) a.throwArm = -Math.min(1, g.airT / 0.3);
      }
      if(air && g.landing && p.pos !== 'QB' && p.pos !== 'OL' && p.pos !== 'DL'){
        const dl = Math.hypot(p.x - g.landing.x, p.y - g.landing.y), db = Math.hypot(g.ballObj.x - p.x, g.ballObj.y - p.y);
        a.reach = dl < 3 && db < 9;
      }
      a.carry = p === g.carrier && p.pos !== 'QB';
      PL.pose(f, a, dt);
      // a touch bigger with the ball, or the ball coming to him, so the eye finds him
      const big = p === g.carrier || (g.thrown && g.throwInfo && g.throwInfo.target === p.key && air);
      // drawn 15% big: at broadcast distance true-size players are specks (Night Watch draws its ships big for the same reason)
      f.scale.setScalar(big ? 1.27 : 1.15);
      // name tags: the skill players before the snap; then whoever matters
      if(u.tag){
        const skill = p.side === 'o' && /^(X|Z|Y|T|R|QB)$/.test(p.key);
        u.tag.visible = (pre && skill) || (g.phase === 'live' && (p === g.carrier && p.pos !== 'QB' || (live.target && p.key === live.target && p.side === 'o' && !g.thrown) ||
          (air && g.throwInfo && g.throwInfo.target === p.key && p.side === 'o')));
      }
    });
    figs.forEach(f => { if(!used.has(f)) f.visible = false; });
    // ball
    const b = g.ballObj;
    ball.visible = !!b && g.phase !== 'huddle';
    if(b){
      ball.position.set(b.x, Math.max(0.2, b.z), -b.y);
      if(b.state === 'air' || b.state === 'kick'){
        const v = new THREE.Vector3(b.vx || 0, b.vz || 0, -(b.vy || 0));
        if(b.state === 'kick') ball.rotation.x += dt * 12;
        else if(v.lengthSq() > 0.01){ ball.lookAt(ball.position.clone().add(v)); leather.rotation.z += dt * (6 + 20 * (b.spin || 0)); }
        trail.push(ball.position.clone()); if(trail.length > 60) trail.shift();
      } else if(g.phase === 'presnap' || g.phase === 'huddle') trail.length = 0;
      ballShadow.visible = ball.visible; ballShadow.position.set(b.x, 0.025, -b.y);
      ballShadow.scale.setScalar(1 / (1 + b.z * 0.25));
    }
    for(let i = 0; i < 60; i++){
      const p = trail[Math.max(0, trail.length - 60 + i)] || trail[0] || ball.position;
      trailPos[i * 3] = p.x; trailPos[i * 3 + 1] = p.y; trailPos[i * 3 + 2] = p.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailLine.visible = trail.length > 1;
    // routes
    if(g.phase === 'presnap' && (lastCall !== g.t0key || routesFor !== g)){ drawRoutes(g); lastCall = g.t0key; routesFor = g; }
    routeGroup.visible = g.phase === 'presnap' || (g.phase === 'live' && g.liveT < 1.2 && !g.thrown);
    routeMat.opacity = g.phase === 'presnap' ? 0.8 : Math.max(0, 0.8 - g.liveT * 0.7);
    // aim
    const qb = g.o && g.o.QB;
    aim.visible = !!(qb && live.aim != null && g.phase === 'live' && g.carrier === qb && !g.thrown && g.call !== 'run' && g.call !== 'fg');
    const tg = live.target && g.o ? g.o[live.target] : null;
    ring.visible = !!(tg && aim.visible);
    if(ring.visible){ ring.position.x = tg.x; ring.position.z = -tg.y; ring.scale.setScalar(1 + 0.12 * Math.sin(performance.now() / 120)); }
    if(aim.visible){
      const L = 12 + (live.power || 0) * 30;
      aim.scale.set(1, L, 1); aim.position.set(0, 0.07, -L / 2);
      aimPivot.position.set(qb.x, 0, -qb.y); aimPivot.rotation.y = -live.aim;
      aimMat.opacity = 0.35 + (live.power || 0) * 0.5;
    }

    // camera
    if(g.phase === 'over' || g.phase === 'huddle'){
      wantPos.set(0, 19, -g.ball + 27); wantLook.set(0, 0, -g.ball - 16);
    } else if(g.call === 'fg'){
      wantPos.set(0, 6, -g.ball + 18); wantLook.set(0, 4, -110);
      if(b && b.state === 'kick'){ wantLook.set(b.x * 0.5, 4, -Math.max(b.y, 100)); }
    } else {
      const c = g.carrier;
      let fx = (g.hashX || 0) * 0.4, fy = g.ball;
      if(b && b.state === 'air'){ fy = Math.max(g.ball, b.y - 6); fx = b.x * 0.6; }
      else if(c && c !== qb){ fy = Math.max(g.ball, c.y - 4); fx = c.x * 0.7; }
      // high and far enough back to see both wide receivers, like the all-22 broadcast angle
      const close = (b && b.state === 'air') || (c && c !== qb) ? 0.75 : 1;
      wantPos.set(fx * 0.5, 19 * close, -fy + 27 * close);
      wantLook.set(fx * 0.7, 0, -fy - 16);
    }
    const k = Math.min(1, dt * 2.2);
    camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
    if(!low){ sun.target.position.set(camLook.x, 0, camLook.z + 12); sun.position.set(camLook.x - 80, 60, camLook.z + 12 - 40); }
    camera.position.copy(camPos); camera.lookAt(camLook);
    renderer.render(scene, camera);
  }

  /* Where on the field the mouse is (for throwing from the TV). */
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pick(nx, ny){
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const p = new THREE.Vector3();
    if(!ray.ray.intersectPlane(plane, p)) return null;
    return [p.x, -p.z];
  }

  return {draw, setTeams, resize, pick, renderer};
}
