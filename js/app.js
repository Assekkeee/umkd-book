/* WEB бағдарламалау — ЭОӘК. Негізгі скрипт.
   Деректер (беттер саны, мазмұны, іздеу мәтіні) data/data.js ішінде (build.py жасайды). */
(function () {
'use strict';

const D = window.UMKD;
const N = D.pages;
const pad = i => String(i + 1).padStart(3, '0');
const IMGS    = Array.from({length: N}, (_, i) => `pages/${pad(i)}.webp`);
const IMGS_HI = Array.from({length: N}, (_, i) => `pages_hi/${pad(i)}.webp`);
const IMGS_MD = Array.from({length: N}, (_, i) => `pages_md/${pad(i)}.webp`);

// Canvas суретті кішірейткенде сапасы төмен болады — жоғары сапалы тегістеуді қосамыз
(function () {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function () {
    const ctx = orig.apply(this, arguments);
    if (ctx && ctx.imageSmoothingQuality !== undefined) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    return ctx;
  };
})();
const $ = id => document.getElementById(id);

// localStorage қолжетімсіз болуы мүмкін (жеке режим) — қауіпсіз орауыш
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

let flip = null, cur = 0, zoom = 1, buildTimer = null, io = null;
const hasFlip = typeof window.St !== 'undefined' && window.St.PageFlip;
let reader = store.get('umkd-mode', hasFlip ? 'book' : 'reader') === 'reader' || !hasFlip;

$('total').textContent = N;
$('goto').max = N;
$('scrub').max = N;

// ---------- Тақырып (жарық / қараңғы) ----------
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
applyTheme(store.get('umkd-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme').onclick = () => {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(t); store.set('umkd-theme', t);
};

// ---------- Толық экран ----------
$('fs').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
};

// ---------- Мазмұны ----------
const tocEl = $('p-toc');
D.toc.forEach(({title, page, level}) => {
  const a = document.createElement('a');
  a.className = 'l' + level; a.dataset.p = page;
  a.innerHTML = '<div></div><span>' + page + '</span>';
  a.firstChild.textContent = title;
  a.onclick = () => { go(page - 1); if (innerWidth <= 820) side(false); };
  tocEl.appendChild(a);
});
function markToc() {
  let best = null;
  tocEl.querySelectorAll('a').forEach(a => { a.classList.remove('cur'); if (+a.dataset.p <= cur + 1) best = a; });
  if (best) {
    best.classList.add('cur');
    $('chapter').textContent = best.firstChild.textContent;
    if ($('p-toc').classList.contains('on') && !$('side').classList.contains('closed')) best.scrollIntoView({block: 'nearest'});
  }
}

// ---------- Беттер (нобайлар), жалқау жүктеу ----------
const thumbs = $('thumbs');
for (let i = 0; i < N; i++) {
  const f = document.createElement('figure');
  f.dataset.p = i;
  f.innerHTML = `<img loading="lazy" decoding="async" src="${IMGS[i]}" alt="${i + 1}-бет"><figcaption>${i + 1}</figcaption>`;
  f.onclick = () => { go(i); if (innerWidth <= 820) side(false); };
  thumbs.appendChild(f);
}
function markThumb() {
  const old = thumbs.querySelector('.cur'); if (old) old.classList.remove('cur');
  const f = thumbs.children[cur]; if (f) f.classList.add('cur');
}

// ---------- Іздеу ----------
const esc = s => s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
$('q').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase(), box = $('results');
  if (q.length < 2) { box.innerHTML = '<div class="hint">Кемінде 2 таңба енгізіңіз.</div>'; return; }
  const out = []; let total = 0;
  D.text.forEach((t, i) => {
    const k = t.toLowerCase().indexOf(q);
    if (k < 0) return; total++;
    if (out.length < 60) {
      const s = Math.max(0, k - 40), en = Math.min(t.length, k + q.length + 60);
      out.push('<div class="res" data-p="' + (i + 1) + '"><span class="rp">' + (i + 1) + '</span><span>' + (s > 0 ? '…' : '') +
        esc(t.slice(s, k)) + '<mark>' + esc(t.slice(k, k + q.length)) + '</mark>' + esc(t.slice(k + q.length, en)) +
        (en < t.length ? '…' : '') + '</span></div>');
    }
  });
  box.innerHTML = out.length ? ('<div class="hint">Табылды: ' + total + ' бет</div>' + out.join('')) : '<div class="hint">Ештеңе табылмады.</div>';
});
$('results').addEventListener('click', e => {
  const r = e.target.closest('.res'); if (!r) return;
  go(+r.dataset.p - 1); if (innerWidth <= 820) side(false);
});

// ---------- Дыбыс (қағаз шуылы) ----------
let actx = null, muted = store.get('umkd-mute', '0') === '1', noiseBuf = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function makeNoise(ac) {
  const len = Math.floor(ac.sampleRate * 0.8), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
  const step = Math.floor(ac.sampleRate * 0.012); let c = 1;
  for (let i = 0; i < len; i++) { if (i % step === 0) c = Math.random(); d[i] = (Math.random() * 2 - 1) * (0.35 + 0.65 * c); }
  return b;
}
function playFlip() {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  if (!noiseBuf) noiseBuf = makeNoise(ac);
  const t = ac.currentTime;
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1400, t); bp.frequency.exponentialRampToValueAtTime(4200, t + 0.45);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ac.destination);
  src.start(t); src.stop(t + 0.8);
  const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t + 0.62); o.frequency.exponentialRampToValueAtTime(60, t + 0.75);
  og.gain.setValueAtTime(0.0001, t + 0.6); og.gain.exponentialRampToValueAtTime(0.22, t + 0.63); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  o.connect(og); og.connect(ac.destination); o.start(t + 0.6); o.stop(t + 0.82);
}
function sndUi() { $('snd').setAttribute('aria-pressed', muted ? 'false' : 'true'); }
$('snd').onclick = () => { muted = !muted; store.set('umkd-mute', muted ? '1' : '0'); sndUi(); if (!muted) playFlip(); };
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (!muted) audio(); }));
sndUi();

// Экрандағы бет өлшеміне сай ең қолайлы суреттер жиынын таңдау (кішірейту аз болса — мәтін анық)
function pickSet(pageCssWidth) {
  const need = pageCssWidth * (window.devicePixelRatio || 1);
  return need <= 1100 ? IMGS_MD : need <= 1450 ? IMGS : IMGS_HI;
}
function bookPageWidth() {
  const st = $('stage'), w = st.clientWidth * zoom, h = st.clientHeight * zoom;
  const portrait = w < 600;                       // бір беттік режим
  return Math.min(portrait ? w : w / 2, h * 827 / 1170);
}

// ---------- Кітап ----------
function build(start) {
  const stage = $('stage'), holder = $('holder');
  if (flip) { try { flip.destroy(); } catch (e) {} flip = null; }
  if (reader) { buildReader(start); return; }
  $('reader').style.display = 'none'; holder.style.display = '';
  stage.classList.toggle('zoomed', zoom > 1);
  holder.style.width = (stage.clientWidth * zoom) + 'px';
  holder.style.height = (stage.clientHeight * zoom) + 'px';
  cur = start || 0;

  if (!hasFlip) {                       // page-flip жүктелмесе — қарапайым режим
    holder.innerHTML = '<div class="simple"><img id="simpleImg" alt=""></div>';
    showSimple();
  } else {
    holder.innerHTML = '<div id="book"></div>';
    flip = new St.PageFlip($('book'), {
      width: 827, height: 1170, size: 'stretch', minWidth: 260, maxWidth: 2400, minHeight: 360, maxHeight: 3400,
      showCover: true, drawShadow: true, maxShadowOpacity: .3, flippingTime: 800,
      usePortrait: true, startPage: cur, mobileScrollSupport: false, swipeDistance: 25,
      clickEventForward: true, useMouseEvents: true
    });
    flip.loadFromImages(pickSet(bookPageWidth()));
    flip.on('flip', e => { cur = e.data; ui(); });
    flip.on('changeState', e => { if (e.data === 'flipping') playFlip(); });
  }
  $('loading').style.display = 'none';
  ui();
}
// ---------- Оқу режимі: барлық беттер тігінен, PDF сияқты ----------
function buildReader(start) {
  const stage = $('stage'), holder = $('holder'), box = $('reader');
  holder.style.display = 'none'; holder.innerHTML = '';
  stage.classList.remove('zoomed');
  const w = Math.min(stage.clientWidth - 24, 980) * zoom;
  const set = pickSet(w);
  if (io) io.disconnect();
  box.style.display = 'block';
  box.innerHTML = '';
  cur = start || 0;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N; i++) {
    const im = document.createElement('img');
    im.className = 'rpage'; im.dataset.i = i; im.alt = (i + 1) + '-бет';
    im.loading = i < cur + 3 ? 'eager' : 'lazy'; im.decoding = 'async';
    im.style.width = w + 'px'; im.style.aspectRatio = '827 / 1170';
    im.src = set[i];
    frag.appendChild(im);
  }
  box.appendChild(frag);
  const target = box.children[cur];
  if (target) box.scrollTop = target.offsetTop - 12;
  io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { const i = +e.target.dataset.i; if (i !== cur) { cur = i; ui(); } } });
  }, {root: box, rootMargin: '-45% 0px -45% 0px'});
  box.querySelectorAll('.rpage').forEach(im => io.observe(im));
  $('loading').style.display = 'none';
  ui();
}
function setMode(r) {
  reader = r || !hasFlip; store.set('umkd-mode', reader ? 'reader' : 'book');
  modeUi(); build(cur);
}
function modeUi() {
  $('m-read').setAttribute('aria-pressed', reader ? 'true' : 'false');
  $('m-book').setAttribute('aria-pressed', reader ? 'false' : 'true');
  document.body.classList.toggle('reading', reader);
}
$('m-read').onclick = () => setMode(true);
$('m-book').onclick = () => setMode(false);
modeUi();

function showSimple() {
  const img = $('simpleImg'); if (!img) return;
  img.src = pickSet(Math.min($('stage').clientWidth * zoom, $('stage').clientHeight * zoom * 0.707))[cur];
  img.alt = (cur + 1) + '-бет';
}
function ui() {
  $('goto').value = cur + 1;
  const pct = ((cur + 1) / N * 100);
  $('edgePrev').disabled = cur <= 0;
  $('edgeNext').disabled = cur >= N - 1;
  $('progressBar').style.width = pct + '%';
  $('progress').setAttribute('aria-valuenow', Math.round(pct));
  $('scrub').value = cur + 1; $('scrub').style.setProperty('--pct', ((cur) / Math.max(1, N - 1) * 100) + '%');
  $('zout').disabled = zoom <= 1; $('zin').disabled = zoom >= 3;
  store.set('umkd-page', cur);
  markToc(); markThumb();
}
function go(i) {
  i = Math.max(0, Math.min(N - 1, i));
  if (i === cur) return;
  if (reader) { const t = $('reader').children[i]; if (t) $('reader').scrollTo({top: t.offsetTop - 12, behavior: 'smooth'}); cur = i; ui(); return; }
  if (flip) flip.flip(i, 'bottom');
  else { cur = i; showSimple(); ui(); }
}
function step(d) {
  if (reader) go(cur + d);
  else if (flip) { d > 0 ? flip.flipNext('bottom') : flip.flipPrev('bottom'); }
  else go(cur + d);
}
$('edgeNext').onclick = () => step(1);
$('edgePrev').onclick = () => step(-1);
$('scrub').addEventListener('input', e => { $('goto').value = e.target.value; });
$('scrub').addEventListener('change', e => go(+e.target.value - 1));
$('goto').addEventListener('change', e => go((parseInt(e.target.value) || 1) - 1));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Escape') { if (innerWidth <= 820) side(false); return; }
  if (/INPUT|TEXTAREA/.test(e.target.tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case '/': e.preventDefault(); openSearch(); break;
    case 'ArrowRight': case 'PageDown': if (!reader || e.key === 'ArrowRight') { if (reader) e.preventDefault(); step(1); } break;
    case 'ArrowLeft': case 'PageUp': if (!reader || e.key === 'ArrowLeft') { if (reader) e.preventDefault(); step(-1); } break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End': e.preventDefault(); go(N - 1); break;
    case '+': case '=': $('zin').click(); break;
    case '-': $('zout').click(); break;
    case 'f': case 'F': $('fs').click(); break;
    case 'm': case 'M': setMode(!reader); break;
  }
});

// ---------- Масштаб ----------
function setZoom(z) {
  zoom = Math.max(1, Math.min(3, Math.round(z * 4) / 4));
  $('zv').textContent = Math.round(zoom * 100) + '%';
  build(cur);
  ui();
}
$('zin').onclick = () => setZoom(zoom + .5);
$('zout').onclick = () => setZoom(zoom - .5);

// ---------- Панель ----------
function side(open) {
  $('side').classList.toggle('closed', !open);
  $('menu').setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('drawer', open && innerWidth <= 820);
}
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === name));
  ['toc', 'thumbs', 'search'].forEach(n => $('p-' + n).classList.toggle('on', name === n));
  if (name === 'search') $('q').focus();
  if (name === 'thumbs') { const f = thumbs.children[cur]; if (f) f.scrollIntoView({block: 'center'}); }
  if (name === 'toc') markToc();
}
function openSearch() { $('splash').classList.add('hide'); side(true); showTab('search'); $('q').select(); }
$('menu').onclick = () => side($('side').classList.contains('closed'));
$('scrim').onclick = () => side(false);
$('searchBtn').onclick = openSearch;
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
if (innerWidth <= 820) side(false);

// ---------- Кіріспе бет ----------
const startPage = Math.min(N - 1, Math.max(0, parseInt(store.get('umkd-page', '0')) || 0));
cur = startPage;
function hideSplash() { $('splash').classList.add('hide'); audio(); }
if (startPage > 0) { $('resume').hidden = false; $('resumePage').textContent = (startPage + 1) + '-бет'; }
$('open').onclick = () => { hideSplash(); if (cur !== 0) { cur = 0; build(0); } };
$('resume').onclick = hideSplash;
$('home').onclick = () => $('splash').classList.remove('hide');

// ---------- Өлшем өзгергенде қайта құру ----------
let lw = 0, lh = 0;
new ResizeObserver(() => {
  const st = $('stage'), w = st.clientWidth, h = st.clientHeight;
  if (Math.abs(w - lw) < 4 && Math.abs(h - lh) < 4 && (flip || !hasFlip || reader)) return;
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => { lw = st.clientWidth; lh = st.clientHeight; build(cur); }, 250);
}).observe($('stage'));

if (!hasFlip) $('loading').textContent = 'Парақтау кітапханасы жүктелмеді — қарапайым режим қосылды.';
})();
