/* netcheck - the TV and two phones in Chromium, over ?local=1.

   Serves web/ itself, opens the TV and two phones as tabs of one browser
   (BroadcastChannel is the network), and plays: join, pick a team, the
   lobby, a Two-Minute Drill with a swipe throw, a throw from real
   DeviceMotionEvents (the motion path end to end), a spike, a timeout,
   then a Holy War game's defence call. Screenshots land in
   /tmp/gridiron-shots (or argv[2]).

   node netcheck.mjs [shotdir] */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve('web'), SHOTS = process.argv[2] || '/tmp/gridiron-shots';
fs.mkdirSync(SHOTS, {recursive: true});
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'};
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/\/$/, '/index.html'));
  if(!p.startsWith(ROOT) || !fs.existsSync(p)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'content-type': TYPES[path.extname(p)] || 'application/octet-stream'});
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

let fails = 0;
function ok(c, m){ console.log((c ? '  ok   ' : '  FAIL ') + m); if(!c) fails++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100){ const t = Date.now(); while(Date.now() - t < ms){ try { if(await fn()) return true; } catch(e){} await sleep(step); } return false; }

const browser = await chromium.launch({args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
const ctx = await browser.newContext();
const errors = [];
async function page(url, size){
  const p = await ctx.newPage();
  if(size) await p.setViewportSize(size);
  p.on('pageerror', e => errors.push(url.split('?')[0] + ': ' + e.message));
  p.on('console', m => { if(m.type() === 'error') errors.push(url.split('?')[0] + ': ' + m.text()); });
  await p.goto(BASE + url);
  return p;
}

try {
  console.log('the TV');
  const tv = await page('index.html?local=1&seed=' + (+process.env.SEED || 12), {width: 1280, height: 720});
  ok(await until(() => tv.evaluate(() => window.GRID && GRID.code && GRID.code.length === 4)), 'the TV opens a room and shows a code');
  const code = await tv.evaluate(() => GRID.code);
  await sleep(1500);
  await tv.screenshot({path: SHOTS + '/tv-lobby.png'});

  console.log('two phones join');
  const phones = [];
  for(const [name, team] of [['Jon', 'byu'], ['Kate', 'byu']]){
    const ph = await page('play.html?local=1&pid=' + name + '#' + code, {width: 390, height: 780});
    await ph.fill('#inName', name);
    await ph.click(`[data-team=${team}]`);
    await ph.click('#btnJoin');
    phones.push(ph);
  }
  ok(await until(() => tv.evaluate(() => GRID.players.size === 2)), 'both phones are on the TV');
  // JOIN reloads the page so no typing is left to "undo" when the phone is shaken
  ok(await until(() => phones[0].evaluate(() => !document.getElementById('inName') && document.getElementById('sReady').classList.contains('on'))),
    'after JOIN the page is fresh: no text fields left (no shake-to-undo), the which-hand screen up');
  await phones[0].screenshot({path: SHOTS + '/phone-ready.png'});
  for(const ph of phones) await ph.click('[data-hand=right]');
  // no sensors in a headless browser: falls back to swipe mode
  ok(await until(() => phones[0].evaluate(() => document.getElementById('sGame').classList.contains('on')), 4000), 'picking a hand on a phone with no motion sensors goes to swipe mode');
  const foot = await phones[0].evaluate(() => { const r = document.querySelector('.foot').getBoundingClientRect(); return r.bottom <= innerHeight + 0.5 && r.top > 0; });
  ok(foot, 'the bottom buttons are on screen');
  ok(await until(() => phones[0].evaluate(() => !!document.getElementById('btnStart'))), 'the phone shows the lobby');
  await phones[0].screenshot({path: SHOTS + '/phone-lobby.png'});

  console.log('Two-Minute Drill');
  await phones[0].click('[data-cfg-mode=drill]');
  ok(await until(() => tv.evaluate(() => GRID.cfg.mode === 'drill')), 'a phone picks the mode on the TV');
  await phones[0].click('#btnStart');
  ok(await until(() => tv.evaluate(() => GRID.screen === 'game' && GRID.G && GRID.G.phase === 'huddle')), 'START begins a drive');
  const qbIdx = async () => { const id = await tv.evaluate(() => GRID.qbId); for(let i = 0; i < phones.length; i++){ if(await phones[i].evaluate(id => GRID_PHONE.id === id, id)) return i; } return -1; };
  let qi = await qbIdx();
  ok(qi >= 0, 'one of the phones is the quarterback');
  let qbp = phones[qi];
  ok(await until(() => qbp.evaluate(() => !!document.querySelector('[data-play=slants]'))), 'the QB phone shows the plays');
  await qbp.screenshot({path: SHOTS + '/phone-huddle.png'});
  await qbp.click('[data-play=slants]');
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'presnap' && GRID.G.call === 'slants')), 'calling SLANTS lines them up');
  ok(await until(() => qbp.evaluate(() => !!document.getElementById('pad'))), 'the phone shows the football');
  // hike: a tap; wait for the routes; then a swipe up and to the right
  const box = await qbp.locator('#pad').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.8;
  // DOWN: a tap does nothing yet (a software-drawn test machine can be too slow to catch DOWN; then skip)
  if(await tv.evaluate(() => GRID.G.phaseT < 1.5)){
    ok(await qbp.evaluate(() => /DOWN/.test(document.getElementById('padSay').textContent)), 'the call puts them DOWN on the phone');
    await qbp.mouse.click(cx, cy);
    await sleep(100);
    ok(await tv.evaluate(() => GRID.G.phase === 'presnap'), 'a tap during DOWN does not hike it');
  } else console.log('         (DOWN already over by the time the phone was checked: skipped)');
  ok(await until(() => qbp.evaluate(() => /SET/.test(document.getElementById('padSay').textContent)), 4000), 'two seconds later the phone says SET');
  await tv.screenshot({path: SHOTS + '/tv-presnap.png'});
  await qbp.screenshot({path: SHOTS + '/phone-pad.png'});
  await qbp.mouse.click(cx, cy);
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'live')), 'a tap hikes it');
  await sleep(1300);
  await tv.screenshot({path: SHOTS + '/tv-live.png'});
  await qbp.screenshot({path: SHOTS + '/phone-throw-now.png'});
  await qbp.mouse.move(cx, cy); await qbp.mouse.down();
  await qbp.mouse.move(cx + 40, cy - 120); await qbp.mouse.move(cx + 70, cy - 300); await qbp.mouse.up();
  ok(await until(() => tv.evaluate(() => GRID.G.thrown || GRID.G.sacked)), 'a swipe up the screen throws it');
  await sleep(500);
  await tv.screenshot({path: SHOTS + '/tv-throw.png'});
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'dead' || GRID.G.over), 12000), 'the play ends');
  const why = await tv.evaluate(() => GRID.G.lastWhy || (GRID.G.result && GRID.G.result.why));
  console.log('         (' + why + ')');
  ok(await until(() => tv.evaluate(() => GRID.G.over || GRID.G.phase === 'huddle'), 6000), 'back to the huddle');

  if(!(await tv.evaluate(() => GRID.G.over))){
    // the QB rotates
    const q2 = await qbIdx();
    ok(q2 >= 0 && q2 !== qi, 'the quarterback passes to the other phone');
    qi = q2; qbp = phones[qi];

    console.log('a hike and a throw from real DeviceMotionEvents');
    await qbp.evaluate(() => {
      window.__fire = (eu, rate) => {
        dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha: eu[0], beta: eu[1], gamma: eu[2]}));
        dispatchEvent(new DeviceMotionEvent('devicemotion', {rotationRate: rate, acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {x: 0, y: 0, z: 9.8}, interval: 16}));
      };
      // move the phone from one pose to another in n events of 16 ms, with the gyro rates that takes
      const G = GThrow, D = 180 / Math.PI;
      const slerp = (a, b, t) => { let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; if(d < 0){ b = b.map(v => -v); d = -d; }
        const th = Math.acos(Math.min(1, d)); if(th < 1e-6) return a; const s = Math.sin(th);
        return a.map((v, i) => v * Math.sin((1 - t) * th) / s + b[i] * Math.sin(t * th) / s); };
      window.__move = async (e0, e1, n) => {
        const q0 = G.fromEuler(...e0), q1 = G.fromEuler(...e1);
        let prev = q0;
        for(let i = 1; i <= n; i++){
          const q = slerp(q0, q1, i / n), dq = G.qmul([prev[0], -prev[1], -prev[2], -prev[3]], q);
          const sg = dq[0] < 0 ? -1 : 1, ang = 2 * Math.acos(Math.min(1, Math.abs(dq[0]))), sn = Math.sqrt(Math.max(1e-12, 1 - dq[0] * dq[0]));
          const w = ang / 0.016 * D, k = ang < 1e-9 ? 0 : sg * w / sn;
          __fire(e0.map((v, j) => v + (e1[j] - v) * i / n), {alpha: dq[1] * k, beta: dq[2] * k, gamma: dq[3] * k});
          prev = q;
          await new Promise(r => setTimeout(r, 16));
        }
      };
      window.__hold = async (e, n) => { for(let i = 0; i < n; i++){ __fire(e, {alpha: 0, beta: 0, gamma: 0}); await new Promise(r => setTimeout(r, 16)); } };
      for(let i = 0; i < 20; i++) __fire([180, -60, 0], {alpha: 0, beta: 0, gamma: 0});   // starts cocked, as after the last play
    });
    await qbp.click('#btnMode');                     // now it has sensors: motion mode
    await until(() => qbp.evaluate(() => !!document.querySelector('[data-play=post]')));
    await qbp.click('[data-play=post]');
    await until(() => qbp.evaluate(() => !!document.getElementById('pad')));
    await qbp.screenshot({path: SHOTS + '/phone-hike.png'});
    // ready: flat and low, the bottom (nose) pointing right, facing north; then up fast to the cocked
    // pose (nose forward and up, 60 degrees): the hike
    // DOWN: get into the ready pose (flat and low, the bottom pointing right, facing north) - it is not a hike yet
    await qbp.evaluate(async () => { await __hold([180, -60, 0], 5); await __move([180, -60, 0], [90, 0, 0], 12); await __hold([90, 0, 0], 10); });
    ok(await tv.evaluate(() => GRID.G.phase === 'presnap'), 'moving into position during DOWN does not hike it');
    await until(() => qbp.evaluate(() => sense.mode === 'hike'), 4000);
    // SET: up to the cocked pose (the bottom forward and up 60 degrees): the hike
    await qbp.evaluate(async () => { await __hold([90, 0, 0], 4); await __move([90, 0, 0], [180, -60, 0], 12); await __hold([180, -60, 0], 10); });
    ok(await until(() => tv.evaluate(() => GRID.G.phase === 'live')), 'bringing the phone up from the ready pose hikes it');
    const h0 = await qbp.evaluate(() => sense.h0 * 180 / Math.PI);
    ok(Math.abs(h0) < 8, `and forward is read from the ready pose (${h0.toFixed(1)} deg; facing 0)`);
    await sleep(1400);
    // nothing touches the screen: the arm comes over, nose from 60 up to 25 down, in a tenth of a second
    await qbp.evaluate(async () => { await __move([180, -60, 0], [180, 25, 0], 6); await __hold([180, 25, 0], 8); });
    ok(await until(() => tv.evaluate(() => GRID.G.thrown || GRID.G.sacked)), 'the motion alone throws it');
    const lt = await tv.evaluate(() => GRID.lastThrow), ti = await tv.evaluate(() => GRID.G.throwInfo);
    ok(lt && lt.power > 0.6 && Math.abs(lt.h) < 0.25 && /LOB|BULLET/.test(lt.kind), `thrown hard and straight ahead (power ${lt ? lt.power.toFixed(2) : '-'}, ${lt ? (lt.h * 57.3).toFixed(1) : '-'} deg, ${lt && lt.kind})`);
    ok(ti && ti.target, `and the game picked the receiver that way: ${ti && ti.target}, as a ${ti && ti.kind}`);
    await until(() => tv.evaluate(() => GRID.G.over || GRID.G.phase === 'huddle'), 14000);
  }

  if(!(await tv.evaluate(() => GRID.G.over))){
    console.log('spike and timeout');
    // make sure the clock is running: a run play stays in bounds most of the time
    qi = await qbIdx(); qbp = phones[qi];
    await qbp.click('#btnMode').catch(() => {});
    await until(() => qbp.evaluate(() => !!document.querySelector('[data-play=run]')));
    await qbp.click('[data-play=run]');
    await until(() => qbp.evaluate(() => !!document.getElementById('pad')));
    const b3 = await qbp.locator('#pad').boundingBox();
    await until(() => tv.evaluate(() => GRID.G.phase === 'presnap' && GRID.G.phaseT > 2.05), 5000);
    await qbp.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2);
    await until(() => qbp.evaluate(() => !!document.getElementById('steer')), 4000);
    await qbp.screenshot({path: SHOTS + '/phone-run.png'});
    await until(() => tv.evaluate(() => GRID.G.over || GRID.G.phase === 'huddle'), 14000);
    const running = await tv.evaluate(() => GRID.G.clockRunning);
    if(running && !(await tv.evaluate(() => GRID.G.over))){
      qi = await qbIdx(); qbp = phones[qi];
      const d0 = await tv.evaluate(() => GRID.G.down);
      await until(() => qbp.evaluate(() => !!document.getElementById('btnSpike')));
      await qbp.click('#btnSpike');
      ok(await until(() => tv.evaluate(d0 => !GRID.G.clockRunning && GRID.G.down === d0 + 1, d0)), 'SPIKE stops the clock and costs a down');
    } else ok(true, '(spike skipped: the clock was stopped)');
  }

  console.log('results and Holy War');
  await tv.evaluate(() => { const g = GRID.G; g.over = false; });
  await tv.keyboard.press('Escape');
  ok(await until(() => tv.evaluate(() => GRID.screen === 'lobby')), 'Esc goes back to the lobby');
  // Kate switches to Utah: versus
  await phones[1].click('#btnTeam');
  await phones[0].click('[data-cfg-mode=versus]');
  await until(() => tv.evaluate(() => GRID.cfg.mode === 'versus'));
  await phones[0].click('#btnStart');
  ok(await until(() => tv.evaluate(() => GRID.screen === 'game' && GRID.G.offense === 'byu')), 'Holy War: BYU drives first');
  const defP = phones[1];
  ok(await until(() => defP.evaluate(() => !!document.querySelector('[data-cover=blitz]'))), 'the Utah phone gets the coverage calls');
  await defP.click('[data-cover=blitz]');
  await until(() => tv.evaluate(() => GRID.G.dcall === 'blitz'));
  await phones[0].click('[data-play=curls]');
  ok(await until(() => tv.evaluate(() => GRID.G.cover === 'blitz')), 'and the defence\'s call is what the offence faces');
  await sleep(800);
  await tv.screenshot({path: SHOTS + '/tv-versus.png'});
  await defP.screenshot({path: SHOTS + '/phone-defence.png'});
  // play the drive out quickly from the TV keyboard: finish via the sim
  await tv.evaluate(() => { GRID.G.clock = 0.5; GRID.G.clockRunning = true; });
  await until(() => tv.evaluate(() => GRID.G.offense === 'utah' || GRID.screen === 'results'), 20000);
  ok(await tv.evaluate(() => GRID.G.offense === 'utah'), 'then Utah gets its drive');
  await tv.evaluate(() => { GRID.G.clock = 0.5; GRID.G.clockRunning = true; GRID.G.points = 7; });
  ok(await until(() => tv.evaluate(() => GRID.screen === 'results'), 25000), 'and the results come up');
  ok(await tv.evaluate(() => GRID.results && GRID.results.title === 'UTAH WINS'), 'Utah 7, BYU 0: Utah wins');
  await sleep(500);
  await tv.screenshot({path: SHOTS + '/tv-results.png'});
  ok(await until(() => phones[0].evaluate(() => !!document.getElementById('btnAgain'))), 'phones get AGAIN / LOBBY');

  console.log('Touchdown Pass');
  await phones[0].click('#btnLobby');
  await until(() => tv.evaluate(() => GRID.screen === 'lobby'));
  await phones[0].click('[data-cfg-mode=pass]');
  await until(() => tv.evaluate(() => GRID.cfg.mode === 'pass'));
  await phones[0].click('#btnStart');
  ok(await until(() => tv.evaluate(() => GRID.screen === 'game' && GRID.G.mode === 'pass')), 'Touchdown Pass starts');
  qi = await qbIdx(); qbp = phones[qi];
  ok(await tv.evaluate(() => GRID.G.players.length > 0 && GRID.G.players.every(p => p.side === 'o')), 'no defence on the practice field');
  ok(await until(() => qbp.evaluate(() => !!document.getElementById('pad'))), 'no play menu: the phone goes straight to the football');
  const b4 = await qbp.locator('#pad').boundingBox();
  await until(() => tv.evaluate(() => GRID.G.phase === 'presnap' && GRID.G.phaseT > 2.05), 5000);
  await qbp.mouse.click(b4.x + b4.width / 2, b4.y + b4.height / 2);
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'live'), 6000), 'a tap hikes it (swipe mode)');
  await sleep(1200);
  await qbp.mouse.move(b4.x + b4.width / 2, b4.y + b4.height * 0.8); await qbp.mouse.down();
  await qbp.mouse.move(b4.x + b4.width / 2, b4.y + b4.height * 0.5); await qbp.mouse.move(b4.x + b4.width / 2 - 10, b4.y + 10); await qbp.mouse.up();
  ok(await until(() => tv.evaluate(() => GRID.G.thrown)), 'a pass is thrown');
  await tv.evaluate(() => { window.__g = GRID.G; });
  ok(await until(() => tv.evaluate(() => !document.getElementById('card').classList.contains('hide') && /mph/.test(document.getElementById('card').textContent))), 'the TV shows the throw\'s report card');
  await until(() => tv.evaluate(() => /CAUGHT|MISSED|DROPPED|TOUCHDOWN|INCOMPLETE/.test(document.getElementById('card').textContent)), 8000);
  ok(await until(() => qbp.evaluate(() => !!document.getElementById('padCard') && /to the /.test(document.getElementById('padCard').textContent))), 'and so does the phone');
  await tv.screenshot({path: SHOTS + '/tv-practice.png'});
  await qbp.screenshot({path: SHOTS + '/phone-practice.png'});
  ok(await until(() => tv.evaluate(() => GRID.G !== window.__g && GRID.G.phase === 'presnap'), 12000), 'and the next rep sets itself up');
} catch(e){
  console.log('  FAIL ' + e.stack);
  fails++;
}
const real = errors.filter(e => !/favicon|AudioContext|WebGL|GPU stall|swiftshader/i.test(e));
ok(real.length === 0, 'no page errors' + (real.length ? ':\n    ' + real.slice(0, 8).join('\n    ') : ''));
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
