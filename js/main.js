/* ============================================================
   ROHIT DIGGI — cinematic scroll portfolio · engine
   No build step. Vanilla + Three.js (importmap).
   ============================================================ */
import * as THREE from 'three';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

/* ---- feature flag: LeetCode chapter stays dormant until real data ---- */
const SHOW_LEETCODE = false;   // flip to true (and call renderLeetCode) when ready

/* ============================================================
   0 · DOM refs + chapter list
   ============================================================ */
const spacer   = document.getElementById('spacer');
const canvas   = document.getElementById('gl');
const progress = document.querySelector('#progress span');
const navEl    = document.getElementById('nav');

if (SHOW_LEETCODE){
  const lc = document.getElementById('ch-leetcode');
  if (lc) lc.removeAttribute('hidden');
}

const chapters = [...document.querySelectorAll('.chapter')].filter(c => !c.hasAttribute('hidden'));
const N = chapters.length;
const lastFadeState = new Array(N).fill(false);   // reveal replay tracking
const counted = new Array(N).fill(false);

const PER = 0.95;   // viewport-fraction of scroll per chapter transition

/* ============================================================
   1 · SMOOTH SCROLL MODEL
   Native scroll -> lerped virtual index v in [0, N-1]
   ============================================================ */
let vh = innerHeight;
let target = 0;     // normalized 0..1
let smooth = 0;     // lerped 0..1

function layout(){
  vh = innerHeight;
  spacer.style.height = (vh * (1 + (N - 1) * PER)) + 'px';
  onScroll();
}
function scrollMax(){ return Math.max(1, spacer.offsetHeight - vh); }
function onScroll(){ target = Math.min(1, Math.max(0, scrollY / scrollMax())); }

let lastInput = -9999;          // last real user-scroll input (for soft snap)
addEventListener('scroll', onScroll, { passive:true });
['wheel','touchmove','keydown','pointerdown'].forEach(ev =>
  addEventListener(ev, () => { lastInput = performance.now(); }, { passive:true }));
addEventListener('resize', () => { layout(); resize3D(); });

/* ============================================================
   2 · NAV DOTS + PROGRESS
   ============================================================ */
chapters.forEach((ch, i) => {
  const b = document.createElement('button');
  b.dataset.cursor = 'link';
  b.innerHTML = `<span class="n-label">${ch.dataset.label || i}</span><span class="n-dot"></span>`;
  b.addEventListener('click', () => {
    scrollTo({ top: (i / (N - 1)) * scrollMax(), behavior: reduce ? 'auto' : 'smooth' });
  });
  navEl.appendChild(b);
});
const navBtns = [...navEl.children];

/* ============================================================
   3 · REVEALS + COUNT-UP
   ============================================================ */
function reveal(ch, on){
  const els = ch.querySelectorAll('[data-anim]');
  els.forEach((el, j) => {
    if (reduce){ el.style.opacity = 1; el.style.transform = 'none'; return; }
    if (on){
      el.style.transition = `opacity .85s var(--ease) ${j * 0.075}s, transform .85s var(--ease) ${j * 0.075}s`;
      el.style.opacity = 1; el.style.transform = 'none';
    } else {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = 0; el.style.transform = 'translateY(28px)';
    }
  });
}

function countUp(ch){
  ch.querySelectorAll('[data-count]').forEach(el => {
    const to = parseFloat(el.dataset.count);
    const dp = parseInt(el.dataset.dp || '0', 10);
    if (reduce){ el.textContent = to.toFixed(dp); return; }
    const t0 = performance.now(), dur = 1100;
    (function tick(now){
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = (to * e).toFixed(dp);
      if (k < 1) requestAnimationFrame(tick);
    })(performance.now());
  });
}

/* ============================================================
   4 · THREE.JS — drifting neural / routing mesh
   ============================================================ */
let renderer, scene, camera, group, points, lines, posAttr, linePos;
let nodes = [];
const NODE_COUNT = coarse ? 70 : 130;
const K = 3;                          // nearest neighbours per node -> edges
const R = 26;                         // field radius

// interactive layer (cursor weaves the web; clicks pin a node into it)
let cursorLines, cursorLinePos, cursorDot, pinnedPoints, pinnedLines, pinnedPos, pinnedLinePos;
let pCount = 0;
const LINKS = 6, LINK_MAXD2 = 20 * 20, MAXP = 90;
const raycaster = new THREE.Raycaster();
const zplane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _ndc = new THREE.Vector2(), _wp = new THREE.Vector3();
const _white = new THREE.Color(0xffffff);
let ambW;                       // ambient node world positions (recomputed each frame)
let sharedDot;

// accent colour per chapter (cinematic hue drift)
const PAL = [
  new THREE.Color('#4fe3ff'), // hero  · cyan
  new THREE.Color('#4fe3ff'), // about
  new THREE.Color('#7bd0ff'), // skills
  new THREE.Color('#34e6b0'), // research · teal
  new THREE.Color('#a688ff'), // projects · violet
  new THREE.Color('#ff9f6b'), // awards · warm
  new THREE.Color('#4fe3ff'), // leetcode
  new THREE.Color('#a688ff'), // contact
];
function palAt(v){
  const i = Math.max(0, Math.min(PAL.length - 1, Math.floor(v)));
  const j = Math.min(PAL.length - 1, i + 1);
  return PAL[i].clone().lerp(PAL[j], v - i);
}

function dotTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

function initGL(){
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060a, 0.021);
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 0, 46);

  group = new THREE.Group();
  scene.add(group);

  // nodes
  const pos = new Float32Array(NODE_COUNT * 3);
  for (let i = 0; i < NODE_COUNT; i++){
    const base = new THREE.Vector3(
      (Math.random() * 2 - 1) * R,
      (Math.random() * 2 - 1) * R * 0.7,
      (Math.random() * 2 - 1) * R
    );
    nodes.push({
      base,
      amp:   1.2 + Math.random() * 2.4,
      freq:  0.15 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      cur:   base.clone()
    });
    pos[i*3] = base.x; pos[i*3+1] = base.y; pos[i*3+2] = base.z;
  }
  const pGeo = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(pos, 3);
  pGeo.setAttribute('position', posAttr);
  sharedDot = dotTexture();
  const pMat = new THREE.PointsMaterial({
    size: 0.9, map: sharedDot, transparent:true, depthWrite:false,
    blending: THREE.AdditiveBlending, color: 0x4fe3ff, sizeAttenuation:true, opacity:0.95
  });
  points = new THREE.Points(pGeo, pMat);
  group.add(points);

  // edges via k-nearest neighbours (computed once, flex as nodes drift)
  const edges = [];
  for (let i = 0; i < NODE_COUNT; i++){
    const d = [];
    for (let j = 0; j < NODE_COUNT; j++) if (i !== j)
      d.push([j, nodes[i].base.distanceToSquared(nodes[j].base)]);
    d.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < K; k++){
      const j = d[k][0];
      if (i < j) edges.push([i, j]); else edges.push([j, i]);
    }
  }
  const uniq = [...new Set(edges.map(e => e[0] + '_' + e[1]))].map(s => s.split('_').map(Number));
  linePos = new Float32Array(uniq.length * 6);
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({
    color: 0x4fe3ff, transparent:true, opacity:0.18, blending:THREE.AdditiveBlending, depthWrite:false
  }));
  lines.userData.edges = uniq;
  group.add(lines);

  ambW = new Float32Array(NODE_COUNT * 3);

  // ---- cursor tether: glowing lines from the cursor to nearby stars ----
  cursorLinePos = new Float32Array(LINKS * 6);
  const clg = new THREE.BufferGeometry();
  clg.setAttribute('position', new THREE.BufferAttribute(cursorLinePos, 3));
  cursorLines = new THREE.LineSegments(clg, new THREE.LineBasicMaterial({
    color: 0x4fe3ff, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false
  }));
  scene.add(cursorLines);

  const cdg = new THREE.BufferGeometry();
  cdg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  cursorDot = new THREE.Points(cdg, new THREE.PointsMaterial({
    size: 9, map: sharedDot, transparent:true, depthWrite:false, sizeAttenuation:false,
    blending: THREE.AdditiveBlending, color: 0xffffff, opacity:0.95
  }));
  cursorDot.visible = false;
  scene.add(cursorDot);

  // ---- pinned nodes: clicks freeze a node wired into the same web ----
  pinnedLinePos = new Float32Array(MAXP * LINKS * 6);
  const plg = new THREE.BufferGeometry();
  plg.setAttribute('position', new THREE.BufferAttribute(pinnedLinePos, 3));
  plg.setDrawRange(0, 0);
  pinnedLines = new THREE.LineSegments(plg, new THREE.LineBasicMaterial({
    color: 0x4fe3ff, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false
  }));
  scene.add(pinnedLines);

  pinnedPos = new Float32Array(MAXP * 3);
  const ppg = new THREE.BufferGeometry();
  ppg.setAttribute('position', new THREE.BufferAttribute(pinnedPos, 3));
  ppg.setDrawRange(0, 0);
  pinnedPoints = new THREE.Points(ppg, new THREE.PointsMaterial({
    size: 8, map: sharedDot, transparent:true, depthWrite:false, sizeAttenuation:false,
    blending: THREE.AdditiveBlending, color: 0x8ff3ff
  }));
  scene.add(pinnedPoints);

  resize3D();
}

/* project cursor -> world point on the z=0 plane */
function screenToPlane(x, y){
  _ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(zplane, p) ? p : null;
}

function addPinned(p){
  if (pCount >= MAXP) return;
  pinnedPos[pCount*3] = p.x; pinnedPos[pCount*3+1] = p.y; pinnedPos[pCount*3+2] = p.z;
  pCount++;
  pinnedPoints.geometry.setDrawRange(0, pCount);
  pinnedPoints.geometry.attributes.position.needsUpdate = true;
}

function clearPinned(){
  pCount = 0;
  pinnedPoints.geometry.setDrawRange(0, 0);
  pinnedLines.geometry.setDrawRange(0, 0);
}

/* wire one hub point to its nearest ambient stars; returns # segments written */
function weave(buf, off, hx, hy, hz){
  const cand = [];
  for (let i = 0; i < NODE_COUNT; i++){
    const dx = ambW[i*3]-hx, dy = ambW[i*3+1]-hy, dz = ambW[i*3+2]-hz;
    const dd = dx*dx + dy*dy + dz*dz;
    if (dd < LINK_MAXD2) cand.push([dd, i]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < LINKS; k++){
    const o = off + k * 6;
    buf[o] = buf[o+3] = hx; buf[o+1] = buf[o+4] = hy; buf[o+2] = buf[o+5] = hz;
    if (k < cand.length){
      const j = cand[k][1] * 3;
      buf[o+3] = ambW[j]; buf[o+4] = ambW[j+1]; buf[o+5] = ambW[j+2];
    }
  }
  return LINKS;
}

function resize3D(){
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

/* ============================================================
   5 · POINTER — parallax + custom cursor + constellation
   ============================================================ */
const hint = document.getElementById('hint');
if (hint && coarse) hint.querySelector('b').textContent = 'tap';
function dismissHint(){ hint && hint.classList.add('gone'); }
setTimeout(dismissHint, 10000);

/* ---- ambient interface sound (synthesized, off by default) ---- */
let soundOn = false;
let actx = null;
function blip(freq, dur = 0.06, gain = 0.03, type = 'sine'){
  if (!soundOn) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
const soundBtn = document.getElementById('sound');
soundBtn?.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.classList.toggle('on', soundOn);
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.title = soundOn ? 'Sound on' : 'Sound off';
  if (soundOn){ blip(660, 0.08, 0.04); setTimeout(() => blip(990, 0.1, 0.035), 70); }
});

// click the empty space -> pin a node, wired into the same web
addEventListener('click', e => {
  if (e.target.closest('a, button, input, [data-cursor], .panel, .hero-center, #topbar, #nav, #hint')) return;
  const p = screenToPlane(e.clientX, e.clientY);
  if (p){ addPinned(p); dismissHint(); blip(523.25, 0.09, 0.04); setTimeout(() => blip(783.99, 0.12, 0.03), 55); }
});
// double-click in the void clears the nodes you pinned
addEventListener('dblclick', e => {
  if (e.target.closest('a, button, input, .panel, .hero-center, #topbar, #nav')) return;
  clearPinned();
});

let mx = 0, my = 0, tmx = 0, tmy = 0;      // parallax (lerped)
addEventListener('pointermove', e => {
  tmx = (e.clientX / innerWidth - 0.5);
  tmy = (e.clientY / innerHeight - 0.5);
}, { passive:true });

// custom cursor
const cursor = document.getElementById('cursor');
const cDot = cursor.querySelector('.cursor-dot');
const cRing = cursor.querySelector('.cursor-ring');
const cLabel = cursor.querySelector('.cursor-label');
let cx = innerWidth / 2, cy = innerHeight / 2, rx = cx, ry = cy;

if (!coarse){
  addEventListener('pointermove', e => { cx = e.clientX; cy = e.clientY; }, { passive:true });
  addEventListener('pointerdown', () => cursor.classList.add('is-down'));
  addEventListener('pointerup',   () => cursor.classList.remove('is-down'));
  addEventListener('pointerleave',() => cursor.classList.add('is-hidden'));
  addEventListener('pointerenter',() => cursor.classList.remove('is-hidden'));

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('a,button,[data-cursor]');
    cursor.classList.remove('is-link', 'is-tilt', 'has-label');
    cLabel.textContent = '';
    if (!el) return;
    blip(1320, 0.03, 0.012, 'triangle');   // soft hover tick
    const type = el.dataset.cursor || 'link';
    if (el.matches('a[href$=".pdf"], .resume-btn')){ cursor.classList.add('has-label'); cLabel.textContent = 'Get'; }
    else if (el.matches('a[target="_blank"]')){ cursor.classList.add('has-label'); cLabel.textContent = 'Open'; }
    else if (type === 'tilt') cursor.classList.add('is-tilt');
    else cursor.classList.add('is-link');
  });
}

/* project card cursor-follow glow */
document.querySelectorAll('.proj').forEach(p => {
  p.addEventListener('pointermove', e => {
    const r = p.getBoundingClientRect();
    p.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
    p.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  });
});

/* subtle tilt for [data-cursor="tilt"] cards */
const tiltEls = [...document.querySelectorAll('[data-cursor="tilt"]')];
if (!reduce && !coarse){
  tiltEls.forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(700px) rotateY(${dx * 6}deg) rotateX(${-dy * 6}deg) translateY(-4px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* ============================================================
   6 · MAIN LOOP
   ============================================================ */
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
let hue = PAL[0].clone();

function frame(now){
  requestAnimationFrame(frame);
  const t = now * 0.001;

  // lerp scroll + parallax
  smooth += (target - smooth) * (reduce ? 1 : 0.075);
  mx += (tmx - mx) * 0.06;
  my += (tmy - my) * 0.06;
  const v = smooth * (N - 1);

  // progress bar
  progress.style.width = (smooth * 100).toFixed(2) + '%';

  // soft snap: when the user stops scrolling, settle onto the nearest chapter
  // (keeps text crisp instead of resting half-faded between sections)
  if (!reduce && performance.now() - lastInput > 170){
    const snapY = Math.round(smooth * (N - 1)) / (N - 1) * scrollMax();
    if (Math.abs(scrollY - snapY) > 0.5) scrollTo(0, scrollY + (snapY - scrollY) * 0.14);
  }

  // chapters: linear crossfade + gentle parallax (NO blur → readable)
  const nearest = Math.round(v);
  chapters.forEach((ch, i) => {
    const d = v - i, ad = Math.abs(d);
    const op = ad >= 1 ? 0 : (1 - ad);
    ch.style.opacity = op.toFixed(3);
    ch.style.visibility = op > 0.02 ? 'visible' : 'hidden';
    if (!reduce) ch.style.transform = `translateY(${d * -20}px) scale(${1 - ad * 0.02})`;
    // reveal replay
    const isActive = i === nearest && op > 0.55;
    if (isActive !== lastFadeState[i]){
      lastFadeState[i] = isActive;
      reveal(ch, isActive);
      if (isActive && !counted[i]){ counted[i] = true; countUp(ch); }
    }
    navBtns[i]?.classList.toggle('active', i === nearest);
  });

  // 3D — node drift
  if (renderer){
    for (let i = 0; i < NODE_COUNT; i++){
      const n = nodes[i];
      n.cur.set(
        n.base.x + Math.sin(t * n.freq + n.phase) * n.amp,
        n.base.y + Math.cos(t * n.freq * 0.9 + n.phase) * n.amp,
        n.base.z + Math.sin(t * n.freq * 1.1 + n.phase * 1.3) * n.amp
      );
      posAttr.array[i*3] = n.cur.x; posAttr.array[i*3+1] = n.cur.y; posAttr.array[i*3+2] = n.cur.z;
    }
    posAttr.needsUpdate = true;

    const E = lines.userData.edges;
    for (let e = 0; e < E.length; e++){
      const [ia, ib] = E[e];
      tmpA.copy(nodes[ia].cur); tmpB.copy(nodes[ib].cur);
      const o = e * 6;
      linePos[o]=tmpA.x; linePos[o+1]=tmpA.y; linePos[o+2]=tmpA.z;
      linePos[o+3]=tmpB.x; linePos[o+4]=tmpB.y; linePos[o+5]=tmpB.z;
    }
    lines.geometry.attributes.position.needsUpdate = true;

    // camera + group motion (scroll pushes through the field, mouse parallaxes)
    group.rotation.y = v * 0.16 + mx * 0.5;
    group.rotation.x = my * 0.32;
    camera.position.z = 46 - Math.sin(smooth * Math.PI) * 8;
    camera.position.x += (mx * 6 - camera.position.x) * 0.05;
    camera.position.y += (-my * 5 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);

    // hue drift per chapter
    const tgt = palAt(v);
    hue.lerp(tgt, 0.05);
    points.material.color.copy(hue);
    lines.material.color.copy(hue);
    cursorLines.material.color.copy(hue);
    scene.fog.color.copy(hue).multiplyScalar(0.05).lerp(new THREE.Color(0x05060a), 0.85);

    // ambient node world positions (shared by cursor + pinned weaving)
    group.updateMatrixWorld();
    for (let i = 0; i < NODE_COUNT; i++){
      _wp.copy(nodes[i].cur); group.localToWorld(_wp);
      ambW[i*3] = _wp.x; ambW[i*3+1] = _wp.y; ambW[i*3+2] = _wp.z;
    }

    // cursor tether — weave the pointer into its nearest drifting stars
    let cw = coarse ? null : screenToPlane(cx, cy);
    if (cw){
      cursorDot.visible = true;
      const cd = cursorDot.geometry.attributes.position.array;
      cd[0] = cw.x; cd[1] = cw.y; cd[2] = cw.z;
      cursorDot.geometry.attributes.position.needsUpdate = true;
      cursorDot.material.size = 8 + Math.sin(t * 4) * 2;
      weave(cursorLinePos, 0, cw.x, cw.y, cw.z);
      cursorLines.geometry.attributes.position.needsUpdate = true;
      cursorLines.material.color.copy(hue);
    } else {
      cursorDot.visible = false;
    }

    // pinned nodes — each stays wired into the web as stars drift
    if (pCount){
      for (let n = 0; n < pCount; n++)
        weave(pinnedLinePos, n * LINKS * 6, pinnedPos[n*3], pinnedPos[n*3+1], pinnedPos[n*3+2]);
      pinnedLines.geometry.setDrawRange(0, pCount * LINKS * 2);
      pinnedLines.geometry.attributes.position.needsUpdate = true;
      pinnedLines.material.color.copy(hue);
      pinnedPoints.material.color.copy(hue).lerp(_white, 0.45);
      pinnedPoints.material.size = 12 + Math.sin(t * 3) * 2.2;
    }

    renderer.render(scene, camera);
  }

  // cursor follow
  if (!coarse){
    rx += (cx - rx) * 0.18; ry += (cy - ry) * 0.18;
    cDot.style.transform  = `translate(${cx}px,${cy}px) translate(-50%,-50%)`;
    cRing.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    cLabel.style.transform= `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
  }
}

/* ============================================================
   7 · LEETCODE (dormant) — call when you have real numbers
   ------------------------------------------------------------
   Usage later:
     1. set SHOW_LEETCODE = true  (top of file)
     2. renderLeetCode({ solved: 420, easy: 180, medium: 190, hard: 50,
                         streak: 60, ranking: '~120k' });
   The chapter, nav dot and scroll length all wire up automatically.
   ============================================================ */
function renderLeetCode(stats = {}){
  const mount = document.getElementById('lc-mount');
  if (!mount) return;
  const s = { solved:0, easy:0, medium:0, hard:0, streak:0, ranking:'—', ...stats };
  const cards = [
    ['solved',  'Total solved'],
    ['easy',    'Easy'],
    ['medium',  'Medium'],
    ['hard',    'Hard'],
    ['streak',  'Day streak'],
    ['ranking', 'Contest rank'],
  ];
  mount.innerHTML = `<div class="lc-wrap">${
    cards.map(([k, label]) =>
      `<div class="lc-stat" data-cursor="tilt"><b>${s[k]}</b><span>${label}</span></div>`
    ).join('')
  }</div>
  <p class="body-lg" style="margin-top:1.4rem">Consistency over cramming — chipping at the DSA ladder daily. <a href="https://leetcode.com/" target="_blank" rel="noopener" style="color:var(--accent)">See profile →</a></p>`;
}
// expose for the console / future automation
window.renderLeetCode = renderLeetCode;
if (SHOW_LEETCODE) renderLeetCode(/* pass stats here */);

/* ============================================================
   8 · BOOT
   ============================================================ */
initGL();
layout();
requestAnimationFrame(frame);
// first chapter reveal on load
setTimeout(() => { lastFadeState[0] = true; reveal(chapters[0], true); }, 120);
