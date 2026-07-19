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
  // 初期6枚で 人間・怪異・グッズ・イベント がひととおり試せる並びにしてある
  hand: [
    'village_sumire',      // 人間
    'village_kohaku',      // 怪異
    'village_flashlight',  // グッズ
    'event_kyoukaisen',    // イベント
    'village_rin',         // 人間
    'village_ofuda',       // グッズ
    'village_sashinoberu', // イベント
    'village_kaede',       // 人間
    'village_nushi',       // 怪異
    'village_luna',        // 人間
  ],
};

/* 画面の状態。
   Stage D からは実際にカードが動くので、枚数ではなくカードの配列で持ちます。
   Stage H で、この配列を本物のゲーム状態に置き換えます。 */
const view = {
  selfYoukai: [],   // 通常盤面（追跡中のカードは含まない）。init で作ります
  selfHuman: [],
  oppYoukai: [],
  oppHuman: [],
  trackSelf: null,   // 自分の怪異 → 相手の人間 { youkai, human }
  trackOpp: null,    // 相手の怪異 → 自分の人間 { youkai, human }
  candidate: null,   // 確定前の追跡候補 { youkai, human }（仕様書 19.2）
  locked: false,     // 演出中は操作を止める（仕様書 20-1）
  hand: [],                                    // 手札はカードIDの配列。init で作ります
  oppHandCount: 5,
  handExpanded: false,
  handSelected: -1,
};

const MAX_ON_BOARD = 3;   // 片側に並べられる数（怪異3・人間3で合計6体：仕様書 9.1）

/* カード1枚ずつに通し番号を振る。
   枚数が変わったときに「同じカードがどこへ動いたか」を追うために使います。 */
let uidCounter = 0;
function withUid(spec) {
  if (typeof spec === 'string') return spec;   // 手札はカードIDの文字列のまま
  return Object.assign({}, spec, { uid: 'c' + (++uidCounter) });
}

/** 配列の長さを n に合わせる（足りない分は見本から補う） */
function resizeList(list, n, pool) {
  while (list.length > n) list.pop();
  while (list.length < n) list.push(withUid(pool[list.length % pool.length]));
  return list;
}

/** 通常列からカードを取り出す */
function removeFromList(list, uid) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].uid === uid) return list.splice(i, 1)[0];
  }
  return null;
}

/** 追跡が解けたカードを通常列の右端へ戻す（仕様書 10.3） */
function returnToList(list, card) {
  if (card && list.length < MAX_ON_BOARD) list.push(card);
}

/**
 * 追跡の入り切り。
 * 追跡が始まると通常列からカードが外れ、解けると右端へ戻ります。
 */
function setTracking(who, on) {
  if (who === 'self') {
    if (on && !view.trackSelf) {
      if (!view.selfYoukai.length || !view.oppHuman.length) return false;
      view.trackSelf = { youkai: view.selfYoukai.shift(), human: view.oppHuman.shift() };
    } else if (!on && view.trackSelf) {
      returnToList(view.selfYoukai, view.trackSelf.youkai);
      returnToList(view.oppHuman, view.trackSelf.human);
      view.trackSelf = null;
    }
  } else {
    if (on && !view.trackOpp) {
      if (!view.oppYoukai.length || !view.selfHuman.length) return false;
      view.trackOpp = { youkai: view.oppYoukai.shift(), human: view.selfHuman.shift() };
    } else if (!on && view.trackOpp) {
      returnToList(view.oppYoukai, view.trackOpp.youkai);
      returnToList(view.selfHuman, view.trackOpp.human);
      view.trackOpp = null;
    }
  }
  return true;
}


/* =====================================================================
   操作の判定（仕様書 16.3）
   ---------------------------------------------------------------------
   Pointer Events を使い、マウスと指の操作を同じ仕組みで扱います。
     ・短時間で離す           → タップ
     ・約500ms ほぼ動かず保持 → 長押し
     ・8〜12px 以上動かす     → ドラッグ開始（長押しは中止）
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
    // 指がカードの外へ出ても操作を追い続ける
    if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }

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
    if (dragging && handlers.onDragMove) handlers.onDragMove(e);
  });

  function finish(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    clearTimer();
    const wasTap = !dragging && !longFired;
    const wasDrag = dragging;
    pointerId = null;
    dragging = false;
    if (wasDrag && handlers.onDragEnd) handlers.onDragEnd(e);
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
  if (spec.uid) el.dataset.uid = spec.uid;
  return el;
}

/** 盤面・手札のカードに、タップと長押しの操作を割り当てる */
function attachCardInput(el, spec, place, zoneId) {
  attachPointer(el, {
    onTap: function () {
      if (view.locked) return;   // 演出中は操作を受け付けない（仕様書 20-1）
      if (place === 'hand') {
        // 同じカードをもう一度押したら選択解除
        const idx = spec.handIndex;
        view.handSelected = (view.handSelected === idx) ? -1 : idx;
        syncPanel();
        renderFan();
        if (view.handSelected === idx) openQuickDetail(spec, el);
        else closeQuickDetail();
      } else {
        // 追跡候補は、関係ないところを押したら解除する。
        // ただし候補のカード自身を押したときは、詳細を見たいだけなので残す。
        if (view.candidate) {
          const isPartOfCandidate =
            spec.uid === view.candidate.youkai.uid || spec.uid === view.candidate.human.uid;
          if (!isPartOfCandidate) setCandidate(null, null);
        }
        // 盤面のカードを押したら、手札の選択は解除する
        if (view.handSelected !== -1) {
          view.handSelected = -1;
          syncPanel();
          renderFan();
        }
        // 同じカードをもう一度押したら閉じる
        if (quickDetailEl === el) closeQuickDetail();
        else openQuickDetail(spec, el);
      }
    },
    onLongPress: function () {
      if (view.locked) return;
      openZoomDetail(spec);
    },
    onDragStart: function (e) {
      if (view.locked) return;
      // 手札が拡大表示のときだけドラッグできる（仕様書 18）
      if (place === 'hand' && view.handExpanded) {
        beginDrag(spec, el, e);
      } else if (zoneId === 'self-normal-youkai' && !view.trackSelf) {
        // 自分の怪異 → 相手の人間 の向きだけ（仕様書 19.1）
        beginTrackDrag(spec, el, e);
      }
    },
    onDragMove: function (e) { moveDrag(e); },
    onDragEnd: function (e) { endDrag(e); },
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
    attachCardInput(el, spec, 'board', id);
    zone.appendChild(el);
  });
}

/* =====================================================================
   盤面を描く
   ===================================================================== */
/**
 * 再配置アニメーション（仕様書 9.3）
 * ---------------------------------------------------------------------
 * 描き直す前に各カードの位置と大きさを控えておき、描き直した後に
 * 「元の位置から新しい位置へ」短く動かします。瞬間移動を防ぐためです。
 */
function captureCardRects() {
  const map = {};
  document.querySelectorAll('#board-plane .card[data-uid]').forEach(function (el) {
    map[el.dataset.uid] = el.getBoundingClientRect();
  });
  return map;
}

function playReflow(before) {
  document.querySelectorAll('#board-plane .card[data-uid]').forEach(function (el) {
    const prev = before[el.dataset.uid];
    const now = el.getBoundingClientRect();

    // このカード自身の縮小率。
    // 画面全体の縮小に加えて、相手側は 0.90 倍されているため、
    // 実際の見た目の幅と、指定した幅の比から求める。
    const scale = (el.offsetWidth && now.width) ? (now.width / el.offsetWidth) : 1;

    // 新しく現れたカードは、軽く浮かび上がらせる
    if (!prev) {
      if (el.animate) {
        el.animate([{ opacity: 0, transform: 'scale(0.86)' }, { opacity: 1, transform: 'none' }],
                   { duration: 180, easing: 'ease-out' });
      }
      return;
    }

    // 画面上の差を、カード自身の座標系に直す（画面全体が縮小されているため）
    const dx = (prev.left - now.left) / scale;
    const dy = (prev.top - now.top) / scale;
    const ratio = now.width ? (prev.width / now.width) : 1;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(ratio - 1) < 0.01) return;

    if (el.animate) {
      el.animate([
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + ratio + ')' },
        { transform: 'none' },
      ], { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
    }
  });
}

function renderBoard() {
  const root = document.documentElement;
  const before = captureCardRects();

  // 並んでいる枚数に応じてカード幅を変える
  const selfMax = Math.max(1, view.selfYoukai.length, view.selfHuman.length);
  const oppMax  = Math.max(1, view.oppYoukai.length, view.oppHuman.length);
  root.style.setProperty('--self-normal-w', SELF_CARD_W[Math.min(3, selfMax)] + 'px');
  root.style.setProperty('--opp-normal-w',  OPP_CARD_W[Math.min(3, oppMax)] + 'px');

  function tag(list, no) {
    return list.map(function (c) { return Object.assign({}, c, { no: no }); });
  }
  fillZone('self-normal-youkai', tag(view.selfYoukai, 16));
  fillZone('self-normal-human',  tag(view.selfHuman,  17));
  fillZone('opp-normal-youkai',  tag(view.oppYoukai,  6));
  fillZone('opp-normal-human',   tag(view.oppHuman,   5));

  // 枚数を要素に持たせておく（枚数別の見た目をCSSで足せるようにするため）
  const selfTotal = view.selfYoukai.length + view.selfHuman.length;
  const oppTotal  = view.oppYoukai.length + view.oppHuman.length;
  document.getElementById('board-plane').dataset.selfCount = String(selfTotal);
  document.getElementById('board-plane').dataset.oppCount = String(oppTotal);

  // 追跡カード（左＝怪異、右＝人間の関係が上下で鏡合わせになる）
  fillZone('self-track-youkai', view.trackSelf ? [Object.assign({}, view.trackSelf.youkai, { no: 12 })] : []);
  fillZone('opp-track-human',   view.trackSelf ? [Object.assign({}, view.trackSelf.human,  { no: 8 })] : []);
  fillZone('opp-track-youkai',  view.trackOpp  ? [Object.assign({}, view.trackOpp.youkai,  { no: 9 })] : []);
  fillZone('self-track-human',  view.trackOpp  ? [Object.assign({}, view.trackOpp.human,   { no: 13 })] : []);

  renderArrows();

  // 並び替わったカードを、元の位置から新しい位置へ短く動かす
  playReflow(before);

  // 描き直すと強調が消えるので付け直す
  renderCandidate();
}

/* =====================================================================
   追跡矢印（Stage F で本実装。ここでは向きの確認用）
   ---------------------------------------------------------------------
   左半分：自分の怪異(12) → 相手の人間(8)
   右半分：相手の怪異(9)  → 自分の人間(13)
   ===================================================================== */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 要素の位置と大きさを、1080×1920 の設計座標で返す */
function designRect(el) {
  const r = el.getBoundingClientRect();
  const st = document.getElementById('stage').getBoundingClientRect();
  const sc = stageScale() || 1;
  return {
    x: (r.left - st.left) / sc,
    y: (r.top - st.top) / sc,
    w: r.width / sc,
    h: r.height / sc,
  };
}

/**
 * コンベア風の追跡矢印を1本描く（仕様書 21.1〜21.2）
 * 実際のカード位置から始点・終点を計算します（仕様書 21.5）。
 */
/* 襲撃中かどうか。山形の形を変えるために使う（仕様書 21.4） */
let arrowAttackMode = false;

function drawConveyor(svg, fromEl, toEl, index) {
  const a = designRect(fromEl);
  const b = designRect(toEl);

  // 襲撃中は横に広く、間隔も広げて迫力を出す
  const halfW = arrowAttackMode ? 32 : 20;   // 山形の横幅（片側）
  const depth = arrowAttackMode ? 22 : 16;   // 山形の深さ
  const STEP  = arrowAttackMode ? 54 : 44;   // 山形の間隔

  // 2枚の中心を結ぶ縦線として描く
  const x = Math.round(((a.x + a.w / 2) + (b.x + b.w / 2)) / 2);
  const goingUp = (b.y + b.h) <= a.y;
  const y1 = goingUp ? a.y : (a.y + a.h);         // 怪異側の端
  const y2 = goingUp ? (b.y + b.h) : b.y;         // 人間側の端
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  if (bottom - top < 20) return;

  const clipId = 'pursuit-clip-' + index;

  const defs = document.createElementNS(SVG_NS, 'defs');
  const clip = document.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', clipId);
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', x - halfW - 14);
  rect.setAttribute('y', top);
  rect.setAttribute('width', (halfW + 14) * 2);
  rect.setAttribute('height', bottom - top);
  clip.appendChild(rect);
  defs.appendChild(clip);
  svg.appendChild(defs);

  const clipped = document.createElementNS(SVG_NS, 'g');
  clipped.setAttribute('clip-path', 'url(#' + clipId + ')');

  const flow = document.createElementNS(SVG_NS, 'g');
  flow.setAttribute('class', 'conveyor ' + (goingUp ? 'conveyor--up' : 'conveyor--down'));
  flow.style.setProperty('--step', STEP + 'px');

  // 上下に1つぶん多く描いておくと、繰り返しの継ぎ目が見えない
  for (let y = top - STEP; y <= bottom + STEP; y += STEP) {
    const path = document.createElementNS(SVG_NS, 'path');
    const d = goingUp
      ? 'M ' + (x - halfW) + ' ' + (y + depth) + ' L ' + x + ' ' + y + ' L ' + (x + halfW) + ' ' + (y + depth)
      : 'M ' + (x - halfW) + ' ' + (y - depth) + ' L ' + x + ' ' + y + ' L ' + (x + halfW) + ' ' + (y - depth);
    path.setAttribute('d', d);
    path.setAttribute('class', 'chevron');
    flow.appendChild(path);
  }

  clipped.appendChild(flow);
  svg.appendChild(clipped);
}

/** 追跡中のペアぶんだけ矢印を描く（2組同時にも対応：仕様書 21.5） */
function renderArrows() {
  const svg = document.getElementById('pursuit-arrows');
  svg.innerHTML = '';

  const pairs = [
    ['#self-track-youkai .card', '#opp-track-human .card'],   // 自分の怪異 → 相手の人間
    ['#opp-track-youkai .card', '#self-track-human .card'],   // 相手の怪異 → 自分の人間
  ];
  pairs.forEach(function (pair, i) {
    const from = document.querySelector(pair[0]);
    const to = document.querySelector(pair[1]);
    if (from && to) drawConveyor(svg, from, to, i);
  });
}

/** 追跡選択中の仮矢印（仕様書 21.3） */
function drawTempArrow(from, to) {
  const svg = document.getElementById('drag-arrow');
  svg.innerHTML = '';
  if (!from || !to) return;

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 10) return;
  const ux = dx / len, uy = dy / len;
  const tipX = to.x, tipY = to.y;

  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', tipX - ux * 26); line.setAttribute('y2', tipY - uy * 26);
  line.setAttribute('class', 'temp-arrow');
  svg.appendChild(line);

  // 矢じり
  const px = -uy, py = ux;
  const head = document.createElementNS(SVG_NS, 'polygon');
  head.setAttribute('points',
    (tipX - ux * 30 + px * 16) + ',' + (tipY - uy * 30 + py * 16) + ' ' +
    (tipX - ux * 30 - px * 16) + ',' + (tipY - uy * 30 - py * 16) + ' ' +
    tipX + ',' + tipY);
  head.setAttribute('class', 'temp-arrow-head');
  svg.appendChild(head);
}

function clearTempArrow() {
  document.getElementById('drag-arrow').innerHTML = '';
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
  const STACK_W = 250;   // 重ねられる範囲の幅（CSSと同じ値）
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

  if (!view.handExpanded || view.hand.length === 0) {
    fan.classList.add('is-hidden');
    miniSelf.style.visibility = 'visible';
    return;
  }

  fan.classList.remove('is-hidden');
  // 拡大中は簡略手札を隠す（同じ場所に重なるため）
  miniSelf.style.visibility = 'hidden';

  const n = view.hand.length;
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
      cardId: view.hand[i],
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

  // フィールドカードはロスト数も一緒に見せる
  if (spec.lostText) {
    const stats = document.createElement('div');
    stats.className = 'qd__stats';
    stats.appendChild(statEl('qd__stat', 'ロスト', spec.lostText));
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

  if (spec.lostText) {
    const stats = document.createElement('div');
    stats.className = 'zd__stats';
    stats.appendChild(statEl('zd__stat', 'ロスト', spec.lostText));
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

/* =====================================================================
   ドラッグ＆ドロップ（仕様書 17〜18）
   ---------------------------------------------------------------------
   ・タップ操作も必ず残す（仕様書 17.1）。どちらも同じ処理を呼ぶ。
   ・ドロップ時には必ず合法性を再確認する（仕様書 17.4）。
     いまはゲーム処理が未接続のため簡易判定で、Stage H で本物に置き換える。
   ===================================================================== */

let dragState = null;

/** 画面の縮小率（設計座標と実際の画面の比） */
function stageScale() {
  const v = getComputedStyle(document.getElementById('stage')).getPropertyValue('--fit');
  return parseFloat(v) || 1;
}

/** 指の位置を、1080×1920 の設計座標へ直す */
function toStageCoords(e) {
  const rect = document.getElementById('stage').getBoundingClientRect();
  const scale = stageScale();
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}

/** このカードを置ける場所を集める（仕様書 18.1〜18.3） */
function collectDropTargets(spec) {
  const master = CARD_MASTER[spec.cardId];
  const list = [];
  if (!master) return list;

  if (master.type === 'human' || master.type === 'youkai') {
    // 人間・怪異は、自分の通常盤面の正しい側だけ
    const isYoukai = (master.type === 'youkai');
    const el = document.getElementById(isYoukai ? 'self-normal-youkai' : 'self-normal-human');
    const arr = isYoukai ? view.selfYoukai : view.selfHuman;
    // 上限に達している場は無効なので、強調もドロップ先にもしない（仕様書 17.2）
    if (arr.length < MAX_ON_BOARD) {
      list.push({ el: el, kind: 'unit', side: isYoukai ? 'youkai' : 'human' });
    }

  } else if (master.type === 'goods') {
    // グッズは、装備できる自分の場のカードだけ
    const sel = '#self-normal-youkai .card, #self-normal-human .card, ' +
                '#self-track-youkai .card, #self-track-human .card';
    document.querySelectorAll(sel).forEach(function (card) {
      list.push({ el: card, kind: 'equip' });
    });

  } else if (master.type === 'event') {
    // イベントは、画面中央の「ここで使用」エリア
    list.push({ el: document.getElementById('event-drop'), kind: 'event' });
  }
  return list;
}

/**
 * 置いてよいかの最終確認（仕様書 17.4）。
 * Stage H では、気力・盤面上限・装備条件・対象の存在・カードがまだ手札にあるか・
 * ターンとフェイズ・効果処理中でないか を Game 側へ問い合わせます。
 */
function checkLegal(spec, target) {
  if (target.kind === 'unit') {
    const arr = (target.side === 'youkai') ? view.selfYoukai : view.selfHuman;
    if (arr.length >= MAX_ON_BOARD) {
      target.reason = (target.side === 'youkai' ? '怪異' : '人間') + 'の場が上限です';
      return false;
    }
  }
  return true;
}

/** ドラッグ開始 */
function beginDrag(spec, el, e) {
  if (dragState) return;
  closeQuickDetail();

  const master = CARD_MASTER[spec.cardId];
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const path = getCardImagePath(spec.cardId, spec.owner);
  if (path) ghost.style.backgroundImage = 'url("' + path + '")';
  document.getElementById('drag-layer').appendChild(ghost);

  el.classList.add('is-dragging');          // 元位置に薄く残す

  const targets = collectDropTargets(spec);
  targets.forEach(function (t) { t.el.classList.add('is-drop-target'); });
  if (master && master.type === 'event') {
    document.getElementById('event-drop').classList.remove('is-hidden');
  }
  dimOthers(targets, el);

  // 失敗したときに戻す位置を覚えておく
  const cardRect = el.getBoundingClientRect();
  const stageRect = document.getElementById('stage').getBoundingClientRect();
  const scale = stageScale();

  dragState = {
    spec: spec,
    el: el,
    ghost: ghost,
    targets: targets,
    hover: null,
    origin: {
      x: (cardRect.left + cardRect.width / 2 - stageRect.left) / scale,
      y: (cardRect.top + cardRect.height / 2 - stageRect.top) / scale,
    },
  };
  moveDrag(e);
}

/**
 * ドラッグ中、置ける場所以外を軽く暗くする。
 *   人間・怪異 … 置ける側の領域と、その中にあるカードは明るいまま
 *   グッズ     … 装備できるカードだけが明るいまま
 *   イベント   … すべてのカードが暗くなり、中央の使用エリアだけが残る
 * 追跡矢印も暗くする（目立ちすぎるため）。
 */
function dimOthers(targets, draggedEl) {
  const keep = [];
  targets.forEach(function (t) { keep.push(t.el); });
  if (draggedEl) keep.push(draggedEl);

  function isKept(el) {
    return keep.some(function (k) { return k === el || k.contains(el); });
  }

  document.querySelectorAll('.card, .ui-box, .band, #pursuit-arrows')
    .forEach(function (el) {
      if (!isKept(el)) el.classList.add('is-dimmed');
    });
}

/** 暗転を元に戻す */
function undimAll() {
  document.querySelectorAll('.is-dimmed').forEach(function (el) {
    el.classList.remove('is-dimmed');
  });
}

/** ドラッグ中：カードを指に追従させ、置ける場所を光らせる */
function moveDrag(e) {
  if (!dragState) return;
  const p = toStageCoords(e);

  if (dragState.mode === 'track') {
    // 追跡選択中は、カードは動かさず仮矢印だけを伸ばす（仕様書 21.3）
    let target = null;
    dragState.targets.forEach(function (t) {
      const r = t.el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom) target = t;
    });
    if (dragState.hover !== target) {
      if (dragState.hover) dragState.hover.el.classList.remove('is-drop-hover');
      if (target) target.el.classList.add('is-drop-hover');
      dragState.hover = target;
    }
    drawTempArrow(dragState.from, target ? cardCenter(target.el) : p);
    return;
  }

  dragState.ghost.style.left = p.x + 'px';
  dragState.ghost.style.top = p.y + 'px';

  let hover = null;
  dragState.targets.forEach(function (t) {
    const r = t.el.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom) hover = t;
  });

  if (dragState.hover !== hover) {
    if (dragState.hover) dragState.hover.el.classList.remove('is-drop-hover');
    if (hover) hover.el.classList.add('is-drop-hover');
    dragState.hover = hover;
  }
}

/** ドラッグ終了：置けるなら確定、置けないなら元へ戻す（仕様書 17.3） */
function endDrag(e) {
  if (!dragState) return;
  const st = dragState;
  dragState = null;

  const hover = st.hover;

  if (st.mode === 'track') {
    clearTempArrow();
    st.targets.forEach(function (t) {
      t.el.classList.remove('is-drop-target');
      t.el.classList.remove('is-drop-hover');
    });
    // 相手の人間の上で離したら、追跡候補として選ぶ（まだ確定しない）
    if (hover && hover.el._spec) setCandidate(st.spec, hover.el._spec);
    return;
  }

  st.targets.forEach(function (t) {
    t.el.classList.remove('is-drop-target');
    t.el.classList.remove('is-drop-hover');
  });
  document.getElementById('event-drop').classList.add('is-hidden');
  undimAll();

  if (hover && checkLegal(st.spec, hover)) {
    st.ghost.remove();
    st.el.classList.remove('is-dragging');
    applyDrop(st.spec, hover);
    return;
  }

  // 置けなかった：気力も消費せず、カードも動かさず、元位置へ戻す。
  // 単に置き場所を外しただけのときは、何も言わずに戻す（メッセージが煩わしいため）。
  if (hover && hover.reason) showToast(hover.reason);
  st.ghost.classList.add('is-returning');
  st.ghost.style.left = st.origin.x + 'px';
  st.ghost.style.top = st.origin.y + 'px';
  const ghost = st.ghost, el = st.el;
  setTimeout(function () {
    ghost.remove();
    el.classList.remove('is-dragging');
  }, 200);
}

/** 置けたときの処理。Stage H では Game 側の登場・使用処理を呼びます。 */
function applyDrop(spec, target) {
  const master = CARD_MASTER[spec.cardId];

  // 手札から取り除く
  if (typeof spec.handIndex === 'number') view.hand.splice(spec.handIndex, 1);
  view.handSelected = -1;

  if (target.kind === 'unit') {
    const arr = (target.side === 'youkai') ? view.selfYoukai : view.selfHuman;
    arr.push(withUid({
      cardId: spec.cardId,
      owner: 'village',
      speed: master.speed, hp: master.hp,
      baseSpeed: master.speed, baseHp: master.hp,
    }));
    showToast('《' + master.name + '》を登場させました');

  } else if (target.kind === 'equip') {
    const targetName = target.el._spec ? CARD_MASTER[target.el._spec.cardId].name : '対象';
    showToast('《' + master.name + '》を《' + targetName + '》へ装備しました');

  } else if (target.kind === 'event') {
    showToast('《' + master.name + '》を使用しました');
  }

  syncPanel();
  renderAll();
}

/* 注記：仕様書 17.1 は「タップによる代替操作を残す」としていますが、
   制作者の判断で、カードを置く操作はドラッグ＆ドロップのみとしました。
   タップと併用すると誤操作が起きやすいためです。
   （タップは「選択」と「詳細表示」だけに使います） */

/* =====================================================================
   追跡対象の選択と、追跡開始演出（仕様書 19〜21）
   ===================================================================== */

/** カード中心を設計座標で返す */
function cardCenter(el) {
  const r = designRect(el);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 自分の怪異をドラッグして、相手の人間を選ぶ（仕様書 19.2） */
function beginTrackDrag(spec, el, e) {
  if (dragState) return;
  closeQuickDetail();

  const targets = [];
  document.querySelectorAll('#opp-normal-human .card').forEach(function (card) {
    targets.push({ el: card, kind: 'track' });
  });
  if (!targets.length) return;   // 選べる相手がいない

  targets.forEach(function (t) { t.el.classList.add('is-drop-target'); });

  dragState = {
    mode: 'track',
    spec: spec,
    el: el,
    targets: targets,
    hover: null,
    from: cardCenter(el),
  };
  moveDrag(e);
}

/** 追跡候補を決める（ドロップしただけでは確定しない：仕様書 19.2） */
function setCandidate(youkai, human) {
  view.candidate = (youkai && human) ? { youkai: youkai, human: human } : null;
  renderCandidate();
}

/** 候補の2枚を強調し、ボタンの文字を切り替える */
function renderCandidate() {
  document.querySelectorAll('.card.is-candidate').forEach(function (c) {
    c.classList.remove('is-candidate');
  });

  const label = document.querySelector('#btn-main span');
  if (!view.candidate) {
    if (label) label.textContent = 'メイン終了';
    return;
  }
  [view.candidate.youkai.uid, view.candidate.human.uid].forEach(function (uid) {
    const el = document.querySelector('#board-plane .card[data-uid="' + uid + '"]');
    if (el) el.classList.add('is-candidate');
  });
  if (label) label.textContent = '追跡を確定';
}

/** 画面中央の大きな文字 */
function showBanner(text, isAttack) {
  const box = document.getElementById('banner');
  box.querySelector('span').textContent = text;
  box.classList.toggle('is-attack', !!isAttack);
  box.classList.add('is-open');
}
function hideBanner() {
  document.getElementById('banner').classList.remove('is-open');
}

/** 追跡開始演出（仕様書 20） */
function confirmTracking() {
  if (!view.candidate) return false;

  const pair = view.candidate;
  view.candidate = null;
  view.locked = true;                       // 1. 盤面操作を一時ロック

  closeQuickDetail();                       // 2. クイック詳細と拡大手札を閉じる
  if (view.handExpanded) {
    view.handExpanded = false;
    view.handSelected = -1;
    document.getElementById('hand-expanded').checked = false;
    renderFan();
  }
  renderCandidate();
  showBanner('追跡開始');                    // 3. 画面中央へ大きく「追跡開始」

  // 5〜6. 両カードを追跡専用位置へ移し、矢印を伸ばす
  setTimeout(function () {
    removeFromList(view.selfYoukai, pair.youkai.uid);
    removeFromList(view.oppHuman, pair.human.uid);
    view.trackSelf = { youkai: pair.youkai, human: pair.human };
    const check = document.getElementById('t-self');
    if (check) check.checked = true;
    syncPanel();
    renderBoard();
  }, 620);

  // 7. 「追跡」の文字を消す
  setTimeout(function () {
    hideBanner();
    view.locked = false;
  }, 1350);

  return true;
}

/** 襲撃の演出（仕様書 21.4）。Stage H でゲーム進行から呼びます。 */
function playAttackEffect() {
  const svg = document.getElementById('pursuit-arrows');
  if (!view.trackSelf && !view.trackOpp) {
    showToast('追跡中の組がありません');
    return;
  }
  view.locked = true;
  arrowAttackMode = true;
  svg.classList.add('is-attack');    // 1〜2. 矢印を速く・太く・赤く
  renderArrows();                    // 山形の形も襲撃用に描き直す
  showBanner('襲撃', true);           // 3. 中央へ赤文字で「襲撃」

  setTimeout(function () { hideBanner(); }, 1100);
  setTimeout(function () {
    svg.classList.remove('is-attack');
    arrowAttackMode = false;
    renderArrows();
    view.locked = false;
  }, 1900);
}

/* 短いお知らせ */
let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('is-open');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('is-open'); }, 1600);
}

function renderAll() {
  renderBoard();
  applyFieldImages();
  renderMiniHand('self-hand-mini', view.hand.length);
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

  // ドラッグで枚数が変わるので、スライダーの表示も合わせる
  [['c-self-youkai', view.selfYoukai.length],
   ['c-self-human', view.selfHuman.length],
   ['c-opp-youkai', view.oppYoukai.length],
   ['c-opp-human', view.oppHuman.length],
   ['c-hand', view.hand.length]].forEach(function (pair) {
    const el = document.getElementById(pair[0]);
    if (!el) return;
    el.value = String(pair[1]);
    const v = el.parentElement.querySelector('.v');
    if (v) v.textContent = String(pair[1]);
  });
}

function setupPanel() {
  const root = document.documentElement;

  document.getElementById('panel-toggle').addEventListener('click', function () {
    document.getElementById('panel').classList.toggle('is-closed');
  });

  bindRange('c-self-youkai', function (v) { resizeList(view.selfYoukai, v, SAMPLE.selfYoukai); renderBoard(); });
  bindRange('c-self-human',  function (v) { resizeList(view.selfHuman,  v, SAMPLE.selfHuman);  renderBoard(); });
  bindRange('c-opp-youkai',  function (v) { resizeList(view.oppYoukai,  v, SAMPLE.oppYoukai);  renderBoard(); });
  bindRange('c-opp-human',   function (v) { resizeList(view.oppHuman,   v, SAMPLE.oppHuman);   renderBoard(); });

  bindCheck('t-self', function (b) { setTracking('self', b); syncPanel(); renderBoard(); });
  bindCheck('t-opp',  function (b) { setTracking('opp', b);  syncPanel(); renderBoard(); });

  bindRange('c-hand', function (v) {
    resizeList(view.hand, v, SAMPLE.hand);
    if (view.handSelected >= v) view.handSelected = -1;
    renderMiniHand('self-hand-mini', view.hand.length);
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
    view.handSelected = (v >= view.hand.length) ? -1 : v;
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
  bindRange('v-field-h-opp', function (v) {
    root.style.setProperty('--field-h-opp', v + 'px');
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

  // メイン終了ボタン。追跡候補があるときは「追跡を確定」として働く（仕様書 19.2-7）
  attachPointer(document.getElementById('btn-main'), {
    onTap: function () {
      if (view.locked) return;
      if (confirmTracking()) return;
      showToast('メイン終了はゲーム処理とつなぐ Stage H で実装します');
    },
  });

  // 襲撃の演出を確認するボタン（調整パネル）
  const attackBtn = document.getElementById('btn-attack-demo');
  if (attackBtn) attackBtn.addEventListener('click', playAttackEffect);

  // フィールドカードもタップで詳細、長押しで拡大詳細を出せるようにする
  [
    ['.field-box--self', 'field_village', 'village'],
    ['.field-box--opp', 'field_mansion', 'mansion'],
  ].forEach(function (item) {
    const box = document.querySelector(item[0]);
    if (!box) return;
    const valueEl = box.querySelector('.field-box__value');
    attachCardInput(box, {
      cardId: item[1],
      owner: item[2],
      // ロスト数は表示中の値をそのまま読む（Stage H で本物の値につながる）
      get lostText() { return valueEl ? valueEl.textContent : ''; },
    }, 'board');
  });

  // 空白をタップすると拡大手札とクイック詳細を閉じる（仕様書 13.3）
  // カード・各ボタン・詳細表示の上は「空白」とみなさない
  document.getElementById('stage').addEventListener('pointerup', function (e) {
    // カード・ボタン・詳細・ドロップ先の上は「空白」とみなさない（仕様書 13.3）
    if (e.target.closest('.card, .ui-box, #event-drop, #quick-detail, #zoom-detail')) return;
    closeQuickDetail();
    if (view.candidate) setCandidate(null, null);   // 追跡候補も解除する
    if (view.handExpanded) {
      view.handExpanded = false;
      view.handSelected = -1;
      document.getElementById('hand-expanded').checked = false;
      syncPanel();
      renderFan();
    }
  });

  // iOS Safari のピンチ拡大を止める（CSSのtouch-actionだけでは残るため）
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(name, function (e) { e.preventDefault(); }, { passive: false });
  });

  // 素早い2回タップによる画面拡大を止める。
  // ただしボタンや、指で送る枠の上では止めない（押せなくなってしまうため）。
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    const el = e.target;
    const isInteractive = el && el.closest &&
      el.closest('button, input, select, textarea, #quick-detail, .zd__info, #panel');
    if (!isInteractive && now - lastTouchEnd < 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
}

document.addEventListener('DOMContentLoaded', init);
