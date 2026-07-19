/* =====================================================================
   preview.js  ―  Stage A〜C：レイアウトと手札操作の確認用
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

/* 確認用の見本カード。Stage H で本物のゲーム状態に置き換わります。
   speed/hp は「今の値」、base は画像に印刷されている基礎値です。 */
const SAMPLE = {
  selfYoukai: [
    { cardId: 'village_kakashi',   owner: 'village', speed: 3, hp: 4, baseSpeed: 3, baseHp: 4 },
    { cardId: 'village_kohaku',    owner: 'village', speed: 4, hp: 2, baseSpeed: 3, baseHp: 2, dmg: 0 },
    { cardId: 'village_nushi',     owner: 'village', speed: 4, hp: 3, baseSpeed: 4, baseHp: 6, dmg: 3 },
  ],
  selfHuman: [
    { cardId: 'village_rin',       owner: 'village', speed: 2, hp: 4, baseSpeed: 2, baseHp: 4 },
    { cardId: 'village_luna',      owner: 'village', speed: 2, hp: 1, baseSpeed: 2, baseHp: 2, dmg: 1 },
    { cardId: 'village_kaede',     owner: 'village', speed: 3, hp: 4, baseSpeed: 3, baseHp: 4 },
  ],
  oppHuman: [
    { cardId: 'mansion_elise',     owner: 'mansion', speed: 4, hp: 5, baseSpeed: 2, baseHp: 3 },
    { cardId: 'mansion_emma',      owner: 'mansion', speed: 2, hp: 3, baseSpeed: 2, baseHp: 3 },
    { cardId: 'mansion_sylvie',    owner: 'mansion', speed: 2, hp: 4, baseSpeed: 2, baseHp: 4 },
  ],
  oppYoukai: [
    { cardId: 'mansion_armor',     owner: 'mansion', speed: 1, hp: 4, baseSpeed: 1, baseHp: 4 },
    { cardId: 'mansion_isabella',  owner: 'mansion', speed: 5, hp: 7, baseSpeed: 3, baseHp: 5 },
    { cardId: 'mansion_chimera',   owner: 'mansion', speed: 3, hp: 2, baseSpeed: 3, baseHp: 2 },
  ],
  selfTrackYoukai: { cardId: 'village_ichimatsu', owner: 'village', speed: 3, hp: 2, baseSpeed: 3, baseHp: 2 },
  selfTrackHuman:  { cardId: 'village_haruka',    owner: 'village', speed: 2, hp: 2, baseSpeed: 2, baseHp: 3, dmg: 1 },
  oppTrackHuman:   { cardId: 'mansion_lily',      owner: 'mansion', speed: 2, hp: 3, baseSpeed: 2, baseHp: 3 },
  oppTrackYoukai:  { cardId: 'mansion_claude',    owner: 'mansion', speed: 2, hp: 3, baseSpeed: 2, baseHp: 3 },
  hand: [
    'village_sumire', 'village_flashlight', 'village_ofuda', 'village_sashinoberu',
    'event_kyoukaisen', 'village_rin', 'village_luna', 'village_kaede',
    'village_kohaku', 'village_nushi',
  ],
};

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
   操作の判定（仕様書 16.3）
   ---------------------------------------------------------------------
   Pointer Events を使い、マウスと指の操作を同じ仕組みで扱います。
     ・短時間で離す           → タップ
     ・約500ms ほぼ動かず保持 → 長押し
     ・8〜12px 以上動かす     → ドラッグ開始（長押しは中止）
   ドラッグ本体は Stage D で実装します。ここでは判定だけ用意します。
   ===================================================================== */

const LONG_PRESS_MS = 500;    // 長押しと判定するまでの時間
const DRAG_THRESHOLD = 10;    // ドラッグ開始とみなす移動距離（画面px）

function attachPointer(el, handlers) {
  let pointerId = null;
  let startX = 0, startY = 0;
  let timer = null;
  let longFired = false;
  let dragging = false;

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  el.addEventListener('pointerdown', function (e) {
    if (pointerId !== null) return;      // 2本目の指は無視する
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    longFired = false; dragging = false;

    if (handlers.onLongPress) {
      timer = setTimeout(function () {
        timer = null;
        longFired = true;
        handlers.onLongPress();
      }, LONG_PRESS_MS);
    }
  });

  el.addEventListener('pointermove', function (e) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      dragging = true;
      clearTimer();                       // 動いたら長押しは中止
      if (handlers.onDragStart) handlers.onDragStart(e);
    }
  });

  function finish(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    clearTimer();
    const wasTap = !dragging && !longFired;
    pointerId = null;
    if (wasTap && handlers.onTap) handlers.onTap();
  }

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
}

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
function makeCard(spec) {
  const el = document.createElement('div');
  el.className = 'card';

  // カード画像（対応表にあれば表示、無ければ枠と文字のまま）
  const path = spec.cardId ? getCardImagePath(spec.cardId, spec.owner) : null;
  if (path) {
    el.style.backgroundImage = 'url("' + path + '")';
    el.classList.add('has-image');
  }
  if (spec.cardId && isLandscapeCard(spec.cardId)) el.classList.add('card--landscape');

  if (spec.no != null) {
    const badge = document.createElement('div');
    badge.className = 'card__no';
    badge.textContent = String(spec.no);
    el.appendChild(badge);
  }

  const label = document.createElement('div');
  label.className = 'card__label';
  label.textContent = spec.label || '';
  el.appendChild(label);

  // 現在値オーバーレイ（画像の印刷値は基礎値なので、今の値を重ねる）
  // 数字どうしが重ならないよう、横一列に並べる
  if (spec.speed != null) {
    const row = document.createElement('div');
    row.className = 'ov-row';
    row.appendChild(makeOverlay('speed', spec.speed, spec.baseSpeed));
    row.appendChild(makeOverlay('hp', spec.hp, spec.baseHp));
    // 蓄積ダメージは盤面には出しません。
    // 体力の枠が赤くなることで「ダメージを受けていて今いくつか」が分かるためです。
    el.appendChild(row);
  }

  // あとで詳細表示に使うため、このカードの情報を持たせておく
  el._spec = spec;
  return el;
}

/** 盤面・手札のカードに、タップと長押しの操作を割り当てる */
function attachCardInput(el, spec, place) {
  attachPointer(el, {
    onTap: function () {
      if (place === 'hand') {
        // 同じカードをもう一度押したら選択解除
        const idx = spec.handIndex;
        view.handSelected = (view.handSelected === idx) ? -1 : idx;
        syncPanel();
        renderFan();
        if (view.handSelected === idx) openQuickDetail(spec, el);
        else closeQuickDetail();
      } else {
        // 盤面のカードも、同じカードをもう一度押したら閉じる
        if (quickDetailEl === el) closeQuickDetail();
        else openQuickDetail(spec, el);
      }
    },
    onLongPress: function () {
      openZoomDetail(spec);
    },
    onDragStart: function () {
      // Stage D でドラッグ処理を入れます（今は長押しを止めるだけ）
    },
  });
}

/** 現在値の枠（基礎値より高い/低いで色を変える） */
function makeOverlay(kind, value, base) {
  const el = document.createElement('div');
  el.className = 'ov ov--' + kind;
  if (base != null && value > base) el.classList.add('is-up');
  if (base != null && value < base) el.classList.add('is-down');
  el.textContent = String(value);
  return el;
}

function fillZone(id, specs) {
  const zone = document.getElementById(id);
  zone.innerHTML = '';
  specs.forEach(function (spec) {
    const el = makeCard(spec);
    attachCardInput(el, spec, 'board');
    zone.appendChild(el);
  });
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

  function pick(list, n, no) {
    return list.slice(0, Math.max(0, n)).map(function (c) {
      return Object.assign({}, c, { no: no });
    });
  }
  fillZone('self-normal-youkai', pick(SAMPLE.selfYoukai, selfY, 16));
  fillZone('self-normal-human',  pick(SAMPLE.selfHuman,  selfH, 17));
  fillZone('opp-normal-youkai',  pick(SAMPLE.oppYoukai,  oppY,  6));
  fillZone('opp-normal-human',   pick(SAMPLE.oppHuman,   oppH,  5));

  // 追跡カード（左＝怪異、右＝人間の関係が上下で鏡合わせになる）
  fillZone('self-track-youkai', view.trackSelf ? [Object.assign({}, SAMPLE.selfTrackYoukai, { no: 12 })] : []);
  fillZone('opp-track-human',   view.trackSelf ? [Object.assign({}, SAMPLE.oppTrackHuman,  { no: 8 })] : []);
  fillZone('opp-track-youkai',  view.trackOpp  ? [Object.assign({}, SAMPLE.oppTrackYoukai, { no: 9 })] : []);
  fillZone('self-track-human',  view.trackOpp  ? [Object.assign({}, SAMPLE.selfTrackHuman, { no: 13 })] : []);

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
  const miniSelf = document.getElementById('self-hand-mini');

  if (!view.handExpanded || view.handCount === 0) {
    fan.classList.add('is-hidden');
    miniSelf.style.visibility = 'visible';
    return;
  }

  fan.classList.remove('is-hidden');
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

    const spec = {
      cardId: SAMPLE.hand[i % SAMPLE.hand.length],
      owner: 'village',
      label: '手札',
      handIndex: i,
    };
    const card = makeCard(spec);
    card.classList.add('fan-card');

    let lift = 0;
    let scale = 1;
    let tilt = angle;
    const selected = (i === view.handSelected);
    if (selected) {
      card.classList.add('is-selected');
      lift = parseFloat(css.getPropertyValue('--fan-lift')) || 70;
      scale = parseFloat(css.getPropertyValue('--fan-selected-scale')) || 1.14;
      tilt = angle * 0.3;   // 選んだカードは傾きを弱めて見やすくする（仕様書 15.3）
    }
    // 選んだカードは必ず一番手前に出す（隣のカードに隠れないように）
    card.style.zIndex = selected ? '100' : String(i);

    card.style.transform =
      'translateX(' + x.toFixed(1) + 'px) ' +
      'translateY(' + (y - lift).toFixed(1) + 'px) ' +
      'rotate(' + tilt.toFixed(2) + 'deg) ' +
      'scale(' + scale + ')';

    attachCardInput(card, spec, 'hand');
    fan.appendChild(card);
  }
}

/* =====================================================================
   カード情報の組み立て（cards.js のデータを使う）
   ===================================================================== */

const TYPE_LABEL = { human: '人間', youkai: '怪異', goods: 'グッズ', event: 'イベント', field: 'フィールド' };

/** カードの見出し行（コスト・種類・特徴） */
function metaText(master) {
  const parts = [];
  if (master.cost != null) parts.push('コスト' + master.cost);
  parts.push(TYPE_LABEL[master.type] || master.type);
  if (master.traits && master.traits.length) {
    parts.push(master.traits.map(function (t) { return '〈' + t + '〉'; }).join(''));
  }
  return parts.join(' ／ ');
}

/** 現在値の行を作る。基礎値と違うときは色を変える。 */
function statEl(className, label, value, base) {
  const el = document.createElement('span');
  el.className = className;
  if (base != null && value > base) el.classList.add('is-up');
  if (base != null && value < base) el.classList.add('is-down');
  el.innerHTML = label + '<b>' + value + '</b>';
  return el;
}

/* =====================================================================
   クイック詳細（仕様書 16.1）
   ===================================================================== */

/** いまクイック詳細を出しているカード（再タップで閉じる判定に使う） */
let quickDetailEl = null;

function openQuickDetail(spec, el) {
  const master = CARD_MASTER[spec.cardId];
  const box = document.getElementById('quick-detail');
  if (!master) { closeQuickDetail(); return; }
  quickDetailEl = el || null;

  box.innerHTML = '';
  const qd = document.createElement('div');
  qd.className = 'qd';

  const name = document.createElement('div');
  name.className = 'qd__name';
  name.textContent = master.name;
  qd.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'qd__meta';
  meta.textContent = metaText(master);
  qd.appendChild(meta);

  // 場に出ているカードは現在値、手札のカードは基礎値を出す
  if (spec.speed != null) {
    const stats = document.createElement('div');
    stats.className = 'qd__stats';
    stats.appendChild(statEl('qd__stat', 'スピード', spec.speed, spec.baseSpeed));
    stats.appendChild(statEl('qd__stat', '体力', spec.hp, spec.baseHp));
    qd.appendChild(stats);
  } else if (master.speed != null) {
    const stats = document.createElement('div');
    stats.className = 'qd__stats';
    stats.appendChild(statEl('qd__stat', 'スピード', master.speed));
    stats.appendChild(statEl('qd__stat', '体力', master.hp));
    qd.appendChild(stats);
  }

  if (master.effect) {
    const text = document.createElement('div');
    text.className = 'qd__text';
    text.textContent = master.effect;
    qd.appendChild(text);
  }

  box.appendChild(qd);
  box.classList.add('is-open');
}

function closeQuickDetail() {
  const box = document.getElementById('quick-detail');
  box.classList.remove('is-open');
  box.innerHTML = '';
  quickDetailEl = null;
}

/* =====================================================================
   拡大詳細（仕様書 16.2）
   約0.5秒の長押しで開く。閉じるボタンでのみ戻る。
   ===================================================================== */

function openZoomDetail(spec) {
  const master = CARD_MASTER[spec.cardId];
  const box = document.getElementById('zoom-detail');
  if (!master) return;

  box.innerHTML = '';
  const zd = document.createElement('div');
  zd.className = 'zd';

  // カード画像を大きく
  const card = document.createElement('div');
  card.className = 'zd__card' + (isLandscapeCard(spec.cardId) ? ' zd__card--landscape' : '');
  const path = getCardImagePath(spec.cardId, spec.owner);
  if (path) card.style.backgroundImage = 'url("' + path + '")';
  zd.appendChild(card);

  const info = document.createElement('div');
  info.className = 'zd__info';

  const name = document.createElement('div');
  name.className = 'zd__name';
  name.textContent = master.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'zd__meta';
  meta.textContent = metaText(master);
  info.appendChild(meta);

  // 現在値・基礎値を併記する
  if (spec.speed != null) {
    const stats = document.createElement('div');
    stats.className = 'zd__stats';
    stats.appendChild(statEl('zd__stat', '現在スピード', spec.speed, spec.baseSpeed));
    stats.appendChild(statEl('zd__stat', '現在体力', spec.hp, spec.baseHp));
    stats.appendChild(statEl('zd__stat', '基礎スピード', spec.baseSpeed));
    stats.appendChild(statEl('zd__stat', '基礎体力', spec.baseHp));
    info.appendChild(stats);
  } else if (master.speed != null) {
    const stats = document.createElement('div');
    stats.className = 'zd__stats';
    stats.appendChild(statEl('zd__stat', 'スピード', master.speed));
    stats.appendChild(statEl('zd__stat', '体力', master.hp));
    info.appendChild(stats);
  }

  if (master.effect) {
    const text = document.createElement('div');
    text.className = 'zd__text';
    text.textContent = master.effect;
    info.appendChild(text);
  }
  zd.appendChild(info);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'zd__close';
  close.textContent = '閉じる';
  close.addEventListener('click', closeZoomDetail);
  zd.appendChild(close);

  box.appendChild(zd);
  box.classList.add('is-open');
}

function closeZoomDetail() {
  const box = document.getElementById('zoom-detail');
  box.classList.remove('is-open');
  box.innerHTML = '';
}

/* =====================================================================
   全体を描き直す
   ===================================================================== */
/** 山札・簡略手札の裏面に、裏面画像があれば適用する */
function applyCardBack() {
  const back = getCardBackPath();
  if (!back) return;   // 未提供のあいだは仮の裏面（単色）のまま
  const url = 'url("' + back + '")';
  document.querySelectorAll('.deck-box__card, .hand-mini__back').forEach(function (el) {
    el.style.backgroundImage = url;
    el.textContent = '';
  });
}

/** フィールド枠に実際のカード画像を入れる */
function applyFieldImages() {
  const pairs = [
    ['.field-box--self .field-box__card', 'field_village'],
    ['.field-box--opp .field-box__card', 'field_mansion'],
  ];
  pairs.forEach(function (pair) {
    const el = document.querySelector(pair[0]);
    const path = getCardImagePath(pair[1]);
    if (el && path) {
      el.style.backgroundImage = 'url("' + path + '")';
      el.textContent = '';
    }
  });
}

function renderAll() {
  renderBoard();
  applyFieldImages();
  renderMiniHand('self-hand-mini', view.handCount);
  renderMiniHand('opp-hand-mini', view.oppHandCount);
  renderFan();
  applyCardBack();
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
  bindCheck('hand-expanded', function (b) {
    view.handExpanded = b;
    if (!b) { view.handSelected = -1; closeQuickDetail(); syncPanel(); }
    renderFan();
  });
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

  bindRange('v-ov-size', function (v) {
    root.style.setProperty('--ov-size', (v / 100).toFixed(2));
  }, function (v) { return (v / 100).toFixed(2); });
  bindRange('v-ov-left', function (v) {
    root.style.setProperty('--ov-left', (v / 1000).toFixed(3));
  }, function (v) { return (v / 1000).toFixed(3); });
  bindRange('v-ov-gap', function (v) {
    root.style.setProperty('--ov-gap', (v / 100).toFixed(2));
  }, function (v) { return (v / 100).toFixed(2); });
  bindRange('v-ov-bottom', function (v) {
    root.style.setProperty('--ov-bottom', (v / 1000).toFixed(3));
  }, function (v) { return (v / 1000).toFixed(3); });
  bindRange('v-fan-lift', function (v) {
    root.style.setProperty('--fan-lift', v + 'px');
    renderFan();
  });
  bindRange('v-fan-scale', function (v) {
    root.style.setProperty('--fan-selected-scale', (v / 100).toFixed(2));
    renderFan();
  }, function (v) { return (v / 100).toFixed(2); });

  bindRange('v-field-h', function (v) {
    root.style.setProperty('--field-h', v + 'px');
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
  // 簡略表示の間は、個別選択・詳細・ドラッグはできない
  attachPointer(document.getElementById('self-hand-mini'), {
    onTap: function () {
      view.handExpanded = true;
      document.getElementById('hand-expanded').checked = true;
      renderFan();
    },
  });

  // 空白をタップすると拡大手札とクイック詳細を閉じる（仕様書 13.3）
  // カード・各ボタン・詳細表示の上は「空白」とみなさない
  document.getElementById('stage').addEventListener('pointerup', function (e) {
    if (e.target.closest('.card, .ui-box, #quick-detail, #zoom-detail')) return;
    closeQuickDetail();
    if (view.handExpanded) {
      view.handExpanded = false;
      view.handSelected = -1;
      document.getElementById('hand-expanded').checked = false;
      syncPanel();
      renderFan();
    }
  });

  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
}

document.addEventListener('DOMContentLoaded', init);
