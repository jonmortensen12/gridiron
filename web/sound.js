/* Gridiron - the stadium, synthesised. No files: a crowd that never stops
   murmuring, swells on big plays, groans on bad ones; the whistle; the
   ball into hands; the stadium horn; and the old "Charge!" bugle. */
(function(root){
'use strict';
var ctx = null, master = null, crowd = null, crowdGain = null, on = true;

function start(){
  if(ctx) { if(ctx.state === 'suspended') ctx.resume(); return; }
  var AC = root.AudioContext || root.webkitAudioContext;
  if(!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  // the crowd: brown-ish noise through a band-pass, slowly breathing
  var len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for(var ch = 0; ch < 2; ch++){
    var d = buf.getChannelData(ch), last = 0;
    for(var i = 0; i < len; i++){ last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 3.2; }
  }
  crowd = ctx.createBufferSource(); crowd.buffer = buf; crowd.loop = true;
  var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.18;
  crowd.connect(bp); bp.connect(crowdGain); crowdGain.connect(master);
  crowd.start();
}
function now(){ return ctx.currentTime; }

function roar(level, secs){
  if(!ctx || !on) return;
  var g = crowdGain.gain, t = now();
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.18 + level * 0.9, t + 0.25);
  g.linearRampToValueAtTime(0.18, t + (secs || 3));
}
function groan(){
  if(!ctx || !on) return;
  roar(0.35, 1.6);
  var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), t = now();
  o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 500;
  o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(140, t + 1.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 1.3);
  o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 1.4);
}
function whistle(){
  if(!ctx || !on) return;
  var t = now(), o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
  o.frequency.value = 2900; lfo.frequency.value = 38; lg.gain.value = 120;
  lfo.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.42);
  o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
}
function thud(hard){
  if(!ctx || !on) return;
  var t = now(), o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(hard ? 140 : 220, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  g.gain.setValueAtTime(hard ? 0.5 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
}
function horn(){
  if(!ctx || !on) return;
  var t = now();
  [110, 138.6, 165, 220].forEach(function(fq){
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = fq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.05); g.gain.setValueAtTime(0.05, t + 1.4); g.gain.linearRampToValueAtTime(0, t + 1.6);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
  });
}
/* "Charge!": sol do mi sol - mi sol */
function charge(){
  if(!ctx || !on) return;
  var t = now(), notes = [[392, 0.16], [523, 0.16], [659, 0.16], [784, 0.36], [659, 0.14], [784, 0.7]], at = t;
  notes.forEach(function(n){
    var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = n[0]; f.type = 'lowpass'; f.frequency.value = 2400;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.07, at + 0.02); g.gain.setValueAtTime(0.07, at + n[1] * 0.8); g.gain.linearRampToValueAtTime(0, at + n[1]);
    o.connect(f); f.connect(g); g.connect(master); o.start(at); o.stop(at + n[1] + 0.02);
    at += n[1] + 0.03;
  });
  setTimeout(function(){ roar(0.6, 2.5); }, 1400);
}

root.GSound = {start: start, roar: roar, groan: groan, whistle: whistle, thud: thud, horn: horn, charge: charge,
  toggle: function(){ on = !on; if(master) master.gain.value = on ? 0.8 : 0; return on; },
  on: function(){ return on && !!ctx && ctx.state === 'running'; }};
})(window);
