/* =====================================================================
   preview.js  ―  Stage A：静的レイアウトの確認用
   ---------------------------------------------------------------------
   このファイルには、ゲームのルール処理は一切ありません。
   ・画面を9:16に保ったまま縮小する
   ・仮のカード枠を並べる
   ・調整パネルで枚数や見え方を切り替える
   本実装（Stage H）では、ここが v0.1 の game.js とつながります。
   ===================================================================== */

'use strict';

/* 設計座標（ラフ画像と同じ大きさ） */
const STAGE_W = 1080;
const STAGE_H = 1920;

/* 盤面の枚数に応じたカード幅（仕様書 9.3） */
const SELF_CARD_W = { 1: 190, 2: 175, 3: 146 };
const OPP_CARD_W  = { 1: 165, 2: 148, 3: 123 };

/* 画面の状態（Stage A では見た目だけ） */
const view = {
  selfYoukai: 2,
  selfHuman: 2,
  oppYoukai: 2,
  oppHuman: 2,
  trackSelf: true,   // 自分の怪異 → 相手の人間
  trackOpp: true,    // 相手の怪異 → 自分の人間
  handCount: 6,
  oppHandCount: 5,
  handExpanded: false,
  handSelected: -1,
};

/* =====================================================================
   画面を9:16のまま画面内へ収める
   ===================================================================== */
function fitStage() {
  const vp = document.getElementById('viewport');
  const rect = vp.getBoundingClientRect();
  const scale = Math.min(rect.width / STAGE_W, rect.height / STAGE_H);
  document.getElementById('stage').style.setProperty('--fit', String(scale));
}

/* =====================================================================
   仮のカード枠を作る
   ===================================================================== */
function makeCard(label, no, back) {
  const el = document.createElement('div');
  el.className = 'card' + (back ? ' card--back' : '');
  if (no != null) {
    const badge = document.createElement('div');
    badge.className = 'card__no';
    badge.textContent = String(no);
    el.appendChild(badge);
  }
  const text = document.createElement('div');
  text.textContent = label;
  el.appendChild(text);
  return el;
}

function fillZone(id, count, label, no) {
  const zone = document.getElementById(id);
  zone.innerHTML = '';
  for (let i = 0; i < count; i++) {
    zone.appendChild(makeCard(label, no));
  }
}

/* =====================================================================
   盤面を描く
   ===================================================================== */
function renderBoard() {
  const root = document.documentElement;

  // 枚数に応じてカード幅を変える（追跡中のカードは通常列から外す）
  const selfY = view.selfYoukai - (view.trackSelf ? 1 : 0);
  const selfH = view.selfHuman - (view.trackOpp ? 1 : 0);
  const oppY  = view.oppYoukai - (view.trackOpp ? 1 : 0);
  const oppH  = view.oppHuman - (view.trackSelf ? 1 : 0);

  const selfMax = Math.max(1, selfY, selfH);
  const oppMax  = Math.max(1, oppY, oppH);
  root.style.setProperty('--self-normal-w', SELF_CARD_W[Math.min(3, selfMax)] + 'px');
  root.style.setProperty('--opp-normal-w',  OPP_CARD_W[Math.min(3, oppMax)] + 'px');

  fillZone('self-normal-youkai', Math.max(0, selfY), '自分の怪異', 16);
  fillZone('self-normal-human',  Math.max(0, selfH), '自分の人間', 17);
  fillZone('opp-normal-youkai',  Math.max(0, oppY),  '相手の怪異', 6);
  fillZone('opp-normal-human',   Math.max(0, oppH),  '相手の人間', 5);

  // 追跡カード（左＝怪異、右＝人間の関係が上下で鏡合わせになる）
  fillZone('self-track-youkai', view.trackSelf ? 1 : 0, '追跡している怪異', 12);
  fillZone('opp-track-human',   view.trackSelf ? 1 : 0, '追跡されている人間', 8);
  fillZone('opp-track-youkai',  view.trackOpp ? 1 : 0,  '追跡している怪異', 9);
  fillZone('self-track-human',  view.trackOpp ? 1 : 0,  '追跡されている人間', 13);

  renderArrows();
}

/* =====================================================================
   追跡矢印（Stage F で本実装。ここでは向きの確認用）
   ---------------------------------------------------------------------
   左半分：自分の怪異(12) → 相手の人間(8)
   右半分：相手の怪異(9)  → 自分の人間(13)
   ===================================================================== */
function renderArrows() {
  const svg = document.getElementById('pursuit-arrows');
  svg.innerHTML = '';

  function arrow(x, y1, y2) {
    const dir = (y2 > y1) ? 1 : -1;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', y1);
    line.setAttribute('x2', x); line.setAttribute('y2', y2 - dir * 26);
    line.setAttribute('class', 'arrow-line');
    svg.appendChild(line);

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points',
      (x - 18) + ',' + (y2 - dir * 30) + ' ' +
      (x + 18) + ',' + (y2 - dir * 30) + ' ' +
      x + ',' + y2);
    head.setAttribute('class', 'arrow-head');
    svg.appendChild(head);
  }

  // 場の要素は --play-shift ぶん上へ動くので、矢印も同じだけ動かす
  const shift = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--play-shift')) || 0;
  const OPP_TRACK_BOTTOM = 806 - shift;   // 相手の追跡カードの下端
  const SELF_TRACK_TOP = 918 - shift;     // 自分の追跡カードの上端

  // 自分の怪異 → 相手の人間：左半分を上向き
  if (view.trackSelf) arrow(397, SELF_TRACK_TOP, OPP_TRACK_BOTTOM);
  // 相手の怪異 → 自分の人間：右半分を下向き
  if (view.trackOpp) arrow(691, OPP_TRACK_BOTTOM, SELF_TRACK_TOP);
}

/* =====================================================================
   簡略手札（裏向きの重ね＋枚数）
   ===================================================================== */
function renderMiniHand(id, count) {
  const box = document.getElementById(id);
  const stack = box.querySelector('.hand-mini__stack');
  const num = box.querySelector('.hand-mini__count');
  stack.innerHTML = '';

  // 枚数ぶんの裏面をすべて並べる（数字と見た目の枚数を一致させる）
  const STACK_W = 289;   // 重ねられる範囲の幅（CSSと同じ値）
  const BACK_W = 60;     // 裏面1枚の幅
  const step = (count <= 1) ? 0 : Math.min(40, (STACK_W - BACK_W) / (count - 1));

  for (let i = 0; i < count; i++) {
    const back = document.createElement('div');
    back.className = 'hand-mini__back';
    back.style.left = Math.round(i * step) + 'px';
    back.style.zIndex = String(i);
    stack.appendChild(back);
  }
  num.textContent = String(count);
}

/* =====================================================================
   拡大手札（扇状）
   ===================================================================== */
function renderFan() {
  const fan = document.getElementById('hand-fan');
  const backdrop = document.getElementById('hand-backdrop');
  const miniSelf = document.getElementById('self-hand-mini');

  if (!view.handExpanded || view.handCount === 0) {
    fan.classList.add('is-hidden');
    backdrop.classList.add('is-hidden');
    miniSelf.style.visibility = 'visible';
    return;
  }

  fan.classList.remove('is-hidden');
  backdrop.classList.remove('is-hidden');
  // 拡大中は簡略手札を隠す（同じ場所に重なるため）
  miniSelf.style.visibility = 'hidden';

  const n = view.handCount;
  const css = getComputedStyle(document.documentElement);
  const spread = parseFloat(css.getPropertyValue('--fan-spread')) || 20;   // 端の傾き（合計角度）
  const arc = parseFloat(css.getPropertyValue('--fan-arc')) || 55;         // 弧の深さ（px）
  const wantSpacing = parseFloat(css.getPropertyValue('--fan-spacing')) || 150;

  // 画面からはみ出さない範囲で、できるだけ広い間隔にする
  const CARD_W = 190;
  const USABLE_W = 1020;
  const maxSpacing = (n <= 1) ? 0 : (USABLE_W - CARD_W) / (n - 1);
  const spacing = Math.min(wantSpacing, maxSpacing);

  fan.innerHTML = '';
  for (let i = 0; i < n; i++) {
    // t は -1（左端）〜 0（中央）〜 +1（右端）
    const t = (n <= 1) ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);

    const x = (i - (n - 1) / 2) * spacing;   // 横に等間隔で並べる
    const y = -arc * (1 - t * t);            // 中央ほど持ち上げる（弧）
    const angle = t * (spread / 2);          // 端ほど少し傾ける

    const card = makeCard('手札', null);
    card.classList.add('fan-card');
    card.style.zIndex = String(i);

    let lift = 0;
    if (i === view.handSelected) {
      card.classList.add('is-selected');
      lift = parseFloat(css.getPropertyValue('--fan-lift')) || 70;
    }
    card.style.transform =
      'translateX(' + x.toFixed(1) + 'px) ' +
      'translateY(' + (y - lift).toFixed(1) + 'px) ' +
      'rotate(' + angle.toFixed(2) + 'deg)';

    card.addEventListener('click', function () {
      view.handSelected = (view.handSelected === i) ? -1 : i;
      syncPanel();
      renderFan();
    });
    fan.appendChild(card);
  }
}

/* =====================================================================
   全体を描き直す
   ===================================================================== */
function renderAll() {
  renderBoard();
  renderMiniHand('self-hand-mini', view.handCount);
  renderMiniHand('opp-hand-mini', view.oppHandCount);
  renderFan();
}

/* =====================================================================
   調整パネル（Stage A 専用）
   ===================================================================== */
function bindRange(id, apply, format) {
  const el = document.getElementById(id);
  const out = el.parentElement.querySelector('.v');
  function update() {
    const v = Number(el.value);
    apply(v);
    if (out) out.textContent = format ? format(v) : String(v);
  }
  el.addEventListener('input', update);
  update();
}

function bindCheck(id, apply) {
  const el = document.getElementById(id);
  function update() { apply(el.checked); }
  el.addEventListener('change', update);
  update();
}

function syncPanel() {
  const sel = document.getElementById('hand-selected');
  sel.value = String(view.handSelected);
  const out = sel.parentElement.querySelector('.v');
  if (out) out.textContent = (view.handSelected < 0) ? 'なし' : String(view.handSelected + 1);
}

function setupPanel() {
  const root = document.documentElement;

  document.getElementById('panel-toggle').addEventListener('click', function () {
    document.getElementById('panel').classList.toggle('is-closed');
  });

  bindRange('c-self-youkai', function (v) { view.selfYoukai = v; renderBoard(); });
  bindRange('c-self-human',  function (v) { view.selfHuman = v; renderBoard(); });
  bindRange('c-opp-youkai',  function (v) { view.oppYoukai = v; renderBoard(); });
  bindRange('c-opp-human',   function (v) { view.oppHuman = v; renderBoard(); });

  bindCheck('t-self', function (b) { view.trackSelf = b; renderBoard(); });
  bindCheck('t-opp',  function (b) { view.trackOpp = b; renderBoard(); });

  bindRange('c-hand', function (v) {
    view.handCount = v;
    if (view.handSelected >= v) view.handSelected = -1;
    renderMiniHand('self-hand-mini', v);
    renderFan();
    syncPanel();
  });
  bindRange('c-opp-hand', function (v) {
    view.oppHandCount = v;
    renderMiniHand('opp-hand-mini', v);
  });
  bindCheck('hand-expanded', function (b) { view.handExpanded = b; renderFan(); });
  bindRange('hand-selected', function (v) {
    view.handSelected = (v >= view.handCount) ? -1 : v;
    renderFan();
  }, function (v) { return (v < 0) ? 'なし' : String(v + 1); });

  bindRange('v-perspective', function (v) {
    root.style.setProperty('--board-perspective', v + 'px');
  });
  bindRange('v-tilt', function (v) {
    root.style.setProperty('--board-tilt', v + 'deg');
  }, function (v) { return v.toFixed(1); });
  bindRange('v-far', function (v) {
    root.style.setProperty('--far-card-scale', (v / 100).toFixed(2));
  }, function (v) { return (v / 100).toFixed(2); });
  bindRange('v-shift', function (v) {
    root.style.setProperty('--play-shift', v + 'px');
    renderArrows();
  });
  bindRange('v-spacing', function (v) {
    root.style.setProperty('--fan-spacing', v + 'px');
    renderFan();
  });
  bindRange('v-arc', function (v) {
    root.style.setProperty('--fan-arc', v + 'px');
    renderFan();
  });
  bindRange('v-fan', function (v) {
    root.style.setProperty('--fan-spread', v + 'deg');
    renderFan();
  });
  bindRange('v-bottom', function (v) {
    root.style.setProperty('--fan-bottom', v + 'px');
    renderFan();
  });

  bindCheck('show-numbers', function (b) {
    document.body.classList.toggle('hide-numbers', !b);
  });
  bindCheck('show-guides', function (b) {
    document.body.classList.toggle('show-guides', b);
  });
}

/* =====================================================================
   起動
   ===================================================================== */
function init() {
  fitStage();
  setupPanel();
  renderAll();
  syncPanel();

  // 簡略手札をタップすると拡大表示に切り替わる（仕様書 13.1）
  document.getElementById('self-hand-mini').addEventListener('click', function () {
    view.handExpanded = true;
    document.getElementById('hand-expanded').checked = true;
    renderFan();
  });

  // 空白をタップすると拡大手札を閉じる（仕様書 13.3）
  document.getElementById('hand-backdrop').addEventListener('click', function () {
    view.handExpanded = false;
    view.handSelected = -1;
    document.getElementById('hand-expanded').checked = false;
    syncPanel();
    renderFan();
  });

  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
}

document.addEventListener('DOMContentLoaded', init);
