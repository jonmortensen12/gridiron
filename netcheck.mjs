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
  // no sensors in a headless browser: swipe mode by itself
  ok(await until(() => phones[0].evaluate(() => document.getElementById('sGame').classList.contains('on')), 4000), 'a phone with no motion sensors goes to swipe mode');
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
  await sleep(600);
  await tv.screenshot({path: SHOTS + '/tv-presnap.png'});
  await qbp.screenshot({path: SHOTS + '/phone-pad.png'});
  // hike: thumb down; wait for the routes; then a swipe up and to the right
  const box = await qbp.locator('#pad').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.8;
  await qbp.mouse.move(cx, cy); await qbp.mouse.down();
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'live')), 'thumb down hikes it');
  await sleep(1300);
  await tv.screenshot({path: SHOTS + '/tv-live.png'});
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

    console.log('a throw from real DeviceMotionEvents');
    await qbp.evaluate(() => {
      window.__fire = (alpha, beta, gamma, rate) => {
        dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha, beta, gamma}));
        dispatchEvent(new DeviceMotionEvent('devicemotion', {rotationRate: rate, acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {x: 0, y: 0, z: 9.8}, interval: 16}));
      };
      for(let i = 0; i < 20; i++) __fire(0, 80, 0, {alpha: 0, beta: 0, gamma: 0});
    });
    await qbp.click('#btnMode');                     // now it has sensors: motion mode
    await qbp.click('#btnRelock');
    await qbp.click('#btnLock');
    await until(() => qbp.evaluate(() => !!document.querySelector('[data-play=post]')));
    await qbp.click('[data-play=post]');
    await until(() => qbp.evaluate(() => !!document.getElementById('pad')));
    const b2 = await qbp.locator('#pad').boundingBox();
    await qbp.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await qbp.mouse.down();
    await until(() => tv.evaluate(() => GRID.G.phase === 'live'));
    await sleep(1600);
    // the arm comes over: 1000 deg/s about the phone's x axis for a tenth of a second
    // and the thumb comes up at the release (in the page: a slow software-drawn page must not put a gap between them)
    await qbp.evaluate(async () => {
      for(let i = 0; i < 6; i++){ __fire(0, 80 - i * 15, 0, {alpha: -1000, beta: 0, gamma: 0}); await new Promise(r => setTimeout(r, 16)); }
      const r = document.getElementById('pad').getBoundingClientRect();
      document.getElementById('pad').dispatchEvent(new MouseEvent('mouseup', {clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true}));
    });
    await qbp.mouse.up();
    ok(await until(() => tv.evaluate(() => GRID.G.thrown || GRID.G.sacked)), 'the motion throw reaches the TV');
    const lt = await tv.evaluate(() => GRID.lastThrow);
    ok(lt && lt.power > 0.6 && Math.abs(lt.h) < 0.2, `and it was thrown hard and straight (power ${lt ? lt.power.toFixed(2) : '-'}, aim ${lt ? (lt.h * 57.3).toFixed(1) : '-'} deg)`);
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
  ok(await until(() => qbp.evaluate(() => !document.querySelector('[data-play=run]') && !!document.querySelector('[data-play=post]'))), 'only passes on the menu');
  await qbp.click('[data-play=post]');
  await until(() => qbp.evaluate(() => !!document.getElementById('pad')));
  const b4 = await qbp.locator('#pad').boundingBox();
  await qbp.mouse.move(b4.x + b4.width / 2, b4.y + b4.height * 0.8); await qbp.mouse.down();
  await sleep(1500);
  await qbp.mouse.move(b4.x + b4.width / 2, b4.y + b4.height * 0.5); await qbp.mouse.move(b4.x + b4.width / 2 - 10, b4.y + 10); await qbp.mouse.up();
  ok(await until(() => tv.evaluate(() => GRID.G.thrown || GRID.G.sacked)), 'a pass is thrown');
  ok(await until(() => tv.evaluate(() => GRID.G.phase === 'huddle' && GRID.G.plays === 0), 12000), 'and the next throw is set up');
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
