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
const SELF_CARD_W = { 1: 205, 2: 189, 3: 158 };
const OPP_CARD_W  = { 1: 178, 2: 160, 3: 133 };

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
  let scrubbing = false;   // 横になぞって選んでいる最中か
  let docMove = null, docUp = null;

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function stopDocListeners() {
    if (docMove) { document.removeEventListener('pointermove', docMove); docMove = null; }
    if (docUp) {
      document.removeEventListener('pointerup', docUp);
      document.removeEventListener('pointercancel', docUp);
      docUp = null;
    }
  }

  /**
   * 「なぞって選ぶ」を始める。
   * なぞっている間に手札が描き直されて指の下のカードが作り替わっても
   * 追い続けられるよう、画面全体で指の動きを受け取ります。
   */
  function startScrub(e) {
    scrubbing = true;
    if (el.releasePointerCapture) {
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    docMove = function (ev) {
      if (ev.pointerId !== pointerId) return;
      if (handlers.onScrubMove) handlers.onScrubMove(ev);
    };
    docUp = function (ev) { if (ev.pointerId === pointerId) finish(ev); };
    document.addEventListener('pointermove', docMove);
    document.addEventListener('pointerup', docUp);
    document.addEventListener('pointercancel', docUp);

    if (handlers.onScrubMove) handlers.onScrubMove(e);
  }

  el.addEventListener('pointerdown', function (e) {
    if (pointerId !== null) return;      // 2本目の指は無視する
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    longFired = false; dragging = false; scrubbing = false;
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
    if (!dragging && !scrubbing && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      clearTimer();                       // 動いたら長押しは中止
      // 横向きに大きく動いたときは「なぞって選ぶ」操作にする。
      // 縦向きならこれまでどおりカードを持ち上げるドラッグ。
      if (handlers.onScrubMove && Math.abs(dx) > Math.abs(dy)) {
        startScrub(e);
      } else {
        dragging = true;
        if (handlers.onDragStart) handlers.onDragStart(e);
      }
    }
    if (dragging && handlers.onDragMove) handlers.onDragMove(e);
  });

  function finish(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    clearTimer();
    stopDocListeners();
    const wasTap = !dragging && !scrubbing && !longFired;
    const wasDrag = dragging;
    pointerId = null;
    dragging = false;
    scrubbing = false;
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
    // 手札を横になぞると、指の下のカードが選ばれる
    onScrubMove: (place === 'hand') ? scrubHandSelection : null,
    onTap: function () {
      // 効果の対象選択中だけは、ロック中でもカードを選べるようにする
      if (view.locked && !boardPick) return;   // 演出中は操作を受け付けない（仕様書 20-1）
      if (place === 'hand') {
        // マリガン中は「交換するカードの選択」になる
        if (play.mode === 'mulligan') { toggleMulligan(spec.inst); return; }
        // 同じカードをもう一度押したら選択解除
        const idx = spec.handIndex;
        view.handSelected = (view.handSelected === idx) ? -1 : idx;
        syncPanel();
        renderFan();
        if (view.handSelected === idx) openQuickDetail(spec, el);
        else closeQuickDetail();
      } else {
        // 効果の対象を選んでいる最中は、その選択を優先する
        if (boardPick && spec.inst && boardPick.candidates.indexOf(spec.inst) !== -1) {
          finishBoardPick(spec.inst);
          return;
        }
        if (boardPick) return;   // 対象外のカードは反応させない
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
      if (play.mode === 'mulligan') return;   // マリガン中は置けない
      // ゲーム中はメインの段階だけカードを出せる
      if (play.active && place === 'hand' && Game.state.phase !== 'main') return;
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

  fillZone('self-normal-youkai', view.selfYoukai);
  fillZone('self-normal-human',  view.selfHuman);
  fillZone('opp-normal-youkai',  view.oppYoukai);
  fillZone('opp-normal-human',   view.oppHuman);

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

  // 効果が発動しているカードの強調を付け直す
  if (activatingUid) {
    const el = document.querySelector('#board-plane .card[data-uid="' + activatingUid + '"]');
    if (el) el.classList.add('is-activating');
  }

  // 効果の対象として選べるカードを光らせる
  if (boardPick) {
    boardPick.candidates.forEach(function (inst) {
      const el = document.querySelector('#board-plane .card[data-uid="' + inst.uid + '"]');
      if (el) el.classList.add('is-target');
    });
  }
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
/* いま襲撃している側。その陣営の追跡矢印だけを赤く速くする（仕様書 21.4） */
let attackArrowSide = null;

/* 矢印の流れ。描き直しても続きから動かせるよう、動きと進み具合を控えておく。 */
const CONVEYOR_MS = 2200;        // 山形1つぶん流れるのにかかる時間
const CONVEYOR_ATTACK_MS = 380;  // 襲撃中の速さ
let conveyorAnims = [null, null];
let conveyorPhase = [0, 0];

function drawConveyor(svg, fromEl, toEl, index, isAttack, side) {
  const a = designRect(fromEl);
  const b = designRect(toEl);

  // 形は常に同じにして、襲撃中は CSS で広げる。
  // 描き直さずに済ませることで、流れがカクつかないようにする。
  const halfW = 20;   // 山形の横幅（片側）
  const depth = 16;   // 山形の深さ
  const STEP  = 44;   // 山形の間隔

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
  rect.setAttribute('x', x - halfW - 26);   // 襲撃中に広がるぶんの余白も見込む
  rect.setAttribute('y', top);
  rect.setAttribute('width', (halfW + 26) * 2);
  rect.setAttribute('height', bottom - top);
  clip.appendChild(rect);
  defs.appendChild(clip);
  svg.appendChild(defs);

  const clipped = document.createElementNS(SVG_NS, 'g');
  clipped.setAttribute('clip-path', 'url(#' + clipId + ')');
  clipped.setAttribute('data-side', side || '');

  const flow = document.createElementNS(SVG_NS, 'g');
  flow.setAttribute('class', 'conveyor');

  // 上下に1つぶん多く描いておくと、繰り返しの継ぎ目が見えない
  for (let y = top - STEP; y <= bottom + STEP; y += STEP) {
    const path = document.createElementNS(SVG_NS, 'path');
    const d = goingUp
      ? 'M ' + (x - halfW) + ' ' + (y + depth) + ' L ' + x + ' ' + y + ' L ' + (x + halfW) + ' ' + (y + depth)
      : 'M ' + (x - halfW) + ' ' + (y - depth) + ' L ' + x + ' ' + y + ' L ' + (x + halfW) + ' ' + (y - depth);
    path.setAttribute('d', d);
    path.setAttribute('class', 'chevron' + (isAttack ? ' is-attack' : ''));
    flow.appendChild(path);
  }

  clipped.appendChild(flow);
  svg.appendChild(clipped);

  // 流れる動きを作る。描き直す前の進み具合を引き継ぐので、継ぎ目が見えない。
  if (flow.animate) {
    const shift = goingUp ? -STEP : STEP;
    const anim = flow.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(' + shift + 'px)' }],
      { duration: CONVEYOR_MS, iterations: Infinity, easing: 'linear' }
    );
    anim.currentTime = conveyorPhase[index] || 0;
    anim.playbackRate = isAttack ? (CONVEYOR_MS / CONVEYOR_ATTACK_MS) : 1;
    conveyorAnims[index] = anim;
  }
}

/** 追跡中のペアぶんだけ矢印を描く（2組同時にも対応：仕様書 21.5） */
function renderArrows() {
  const svg = document.getElementById('pursuit-arrows');

  // 描き直す前に、いまの進み具合を控えておく
  conveyorAnims.forEach(function (anim, i) {
    if (anim && typeof anim.currentTime === 'number') conveyorPhase[i] = anim.currentTime;
  });
  conveyorAnims = [null, null];
  svg.innerHTML = '';

  const pairs = [
    // 自分の怪異 → 相手の人間
    { from: '#self-track-youkai .card', to: '#opp-track-human .card', side: bottomSide() },
    // 相手の怪異 → 自分の人間
    { from: '#opp-track-youkai .card', to: '#self-track-human .card', side: topSide() },
  ];
  pairs.forEach(function (pair, i) {
    const from = document.querySelector(pair.from);
    const to = document.querySelector(pair.to);
    // 襲撃演出は、実際に襲撃している側の矢印にだけ付ける
    const isAttack = (attackArrowSide !== null && attackArrowSide === pair.side);
    if (from && to) drawConveyor(svg, from, to, i, isAttack, pair.side);
  });
}

/**
 * 襲撃の見た目を、描き直さずに切り替える。
 * 山形は CSS の transition で広がり、流れは再生速度だけを変えるので、
 * 位置が飛んだりカクついたりしません。
 */
function applyArrowAttack() {
  const sides = [bottomSide(), topSide()];
  sides.forEach(function (side, i) {
    const isAttack = (attackArrowSide !== null && attackArrowSide === side);
    const anim = conveyorAnims[i];
    if (anim) anim.playbackRate = isAttack ? (CONVEYOR_MS / CONVEYOR_ATTACK_MS) : 1;
  });

  // 矢印が1本だけのこともあるので、要素に持たせた陣営で判断する
  const svg = document.getElementById('pursuit-arrows');
  svg.querySelectorAll('g[data-side]').forEach(function (g) {
    const isAttack = (attackArrowSide !== null && attackArrowSide === g.getAttribute('data-side'));
    g.querySelectorAll('.chevron').forEach(function (path) {
      path.classList.toggle('is-attack', isAttack);
    });
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

  // マリガン中と、効果の解決などの自動処理中は、常に開いたままにする。
  // （処理中はどのみち操作できないので、勝手に閉じる余地をなくしておく）
  if (play.mode === 'mulligan' || view.locked) view.handExpanded = true;

  // 拡大表示のあいだは、カードが0枚でも折りたたまない
  // （ドロー演出の途中で勝手に閉じてしまわないようにするため）
  if (!view.handExpanded) {
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
  const CARD_W = 250;
  const USABLE_W = 1050;
  const maxSpacing = (n <= 1) ? 0 : (USABLE_W - CARD_W) / (n - 1);
  const spacing = Math.min(wantSpacing, maxSpacing);

  fan.innerHTML = '';
  for (let i = 0; i < n; i++) {
    // t は -1（左端）〜 0（中央）〜 +1（右端）
    const t = (n <= 1) ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);

    const x = (i - (n - 1) / 2) * spacing;   // 横に等間隔で並べる
    const y = -arc * (1 - t * t);            // 中央ほど持ち上げる（弧）
    const angle = t * (spread / 2);          // 端ほど少し傾ける

    // 見本のときはカードIDの文字列、ゲーム中は本物のカード（インスタンス）
    const entry = view.hand[i];
    const isInstance = (entry && typeof entry === 'object');
    const spec = handSpecAt(i);
    const card = makeCard(spec);
    card.classList.add('fan-card');
    card.dataset.handIndex = String(i);   // なぞって選ぶときに使う

    // いま出せないカード（気力不足・場が上限など）は選んでも光らせない
    if (play.active && isInstance && Game.state && !Game.state.gameOver &&
        !Game.canPlay(bottomSide(), entry).ok) {
      card.classList.add('is-unplayable');
    }

    // マリガンで交換に選んだカードは目印を付ける
    if (play.mode === 'mulligan' && isInstance &&
        play.mulliganSelected.indexOf(entry.uid) !== -1) {
      card.classList.add('is-mulligan');
    }

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

  appendConditionLine(qd, spec, 'qd__cond');

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

  appendConditionLine(info, spec, 'zd__cond');

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
  // ゲーム中は、その陣営が実際に持っているフィールドカードを出す
  const selfId = fieldSpecFor('self').cardId;
  const oppId = fieldSpecFor('opp').cardId;

  const pairs = [
    ['.field-box--self .field-box__card', selfId],
    ['.field-box--opp .field-box__card', oppId],
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

  // ゲーム中は、本物の合法性判定（気力・場の上限・装備条件）を使う
  if (play.active) {
    const side = bottomSide();
    const inst = spec.inst;
    if (!inst || !Game.canPlay(side, inst).ok) return list;

    if (master.type === 'human' || master.type === 'youkai') {
      const isYoukai = (master.type === 'youkai');
      list.push({
        el: document.getElementById(isYoukai ? 'self-normal-youkai' : 'self-normal-human'),
        kind: 'unit',
        side: isYoukai ? 'youkai' : 'human',
      });

    } else if (master.type === 'goods') {
      // 装備できる相手だけを光らせる（仕様書 18.2）
      Game.getGoodsTargets(side, inst).forEach(function (t) {
        const el = document.querySelector('#board-plane .card[data-uid="' + t.uid + '"]');
        if (el) list.push({ el: el, kind: 'equip' });
      });

    } else if (master.type === 'event') {
      list.push({ el: document.getElementById('event-drop'), kind: 'event' });
    }
    return list;
  }

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
  if (play.active) {
    const check = Game.canPlay(bottomSide(), spec.inst);
    if (!check.ok) { target.reason = check.reasons[0]; return false; }
    return true;
  }
  if (target.kind === 'unit') {
    const arr = (target.side === 'youkai') ? view.selfYoukai : view.selfHuman;
    if (arr.length >= MAX_ON_BOARD) {
      target.reason = (target.side === 'youkai' ? '怪異' : '人間') + 'の場が上限です';
      return false;
    }
  }
  return true;
}

/**
 * 置けない場所ではあるが「ここへ置こうとした」と分かる領域を集める。
 * 気力不足などで光らない場合でも、そこへ運んだら理由を知らせるために使います。
 */
function collectHintTargets(spec) {
  const list = [];
  const master = CARD_MASTER[spec.cardId];
  if (!play.active || !master || !spec.inst) return list;

  const check = Game.canPlay(bottomSide(), spec.inst);
  if (check.ok) return list;              // 置けるなら知らせる必要はない
  const reason = check.reasons[0];

  if (master.type === 'human' || master.type === 'youkai') {
    const isYoukai = (master.type === 'youkai');
    list.push({
      el: document.getElementById(isYoukai ? 'self-normal-youkai' : 'self-normal-human'),
      reason: reason,
    });
  } else if (master.type === 'goods') {
    document.querySelectorAll('#self-normal-youkai .card, #self-normal-human .card, ' +
                              '#self-track-youkai .card, #self-track-human .card')
      .forEach(function (card) { list.push({ el: card, reason: reason }); });
  } else if (master.type === 'event') {
    list.push({ el: document.getElementById('event-drop'), reason: reason });
  }
  return list;
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
    hints: collectHintTargets(spec),   // 置けない理由を知らせる領域
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

  // 置けない理由の判定は、領域を隠す前に済ませておく
  let hintReason = null;
  if (!hover && st.hints && e) {
    for (let i = 0; i < st.hints.length; i++) {
      const r = st.hints[i].el.getBoundingClientRect();
      if (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom) {
        hintReason = st.hints[i].reason;
        break;
      }
    }
  }

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
  // 単に置き場所を外しただけのときは何も言わないが、
  // 本来の置き場所へ運んだのに置けなかったときは理由を知らせる。
  if (hover && hover.reason) showToast(hover.reason);
  else if (hintReason) showToast(hintReason);
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
  // ゲーム中は本物の登場・使用処理を呼ぶ
  if (play.active) { playCardInGame(spec, target); return; }
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
  // ゲーム中は、メイン中でも追跡対象を選べる（確定するとメインが終わる）
  if (play.active) {
    const ph = Game.state.phase;
    if (ph !== 'main' && ph !== 'tracking') return;
  }
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

  if (view.candidate) {
    [view.candidate.youkai.uid, view.candidate.human.uid].forEach(function (uid) {
      const el = document.querySelector('#board-plane .card[data-uid="' + uid + '"]');
      if (el) el.classList.add('is-candidate');
    });
  }
  updateMainButton();
}

/** 画面中央の大きな文字 */
/**
 * 長い文をキリのいいところで2行に分ける。
 * 「ヨマモリ村のマリガン」→「ヨマモリ村の」「マリガン」
 * 「ヨマモリ村：2枚交換」→「ヨマモリ村」「2枚交換」
 */
function splitBannerText(text) {
  if (text.length <= 7) return [text];

  const colon = text.indexOf('：');
  if (colon > 0) return [text.slice(0, colon), text.slice(colon + 1)];

  const no = text.lastIndexOf('の');
  if (no > 0 && no < text.length - 1) return [text.slice(0, no + 1), text.slice(no + 1)];

  return [text];
}

function showBanner(text, isAttack) {
  const box = document.getElementById('banner');
  const span = box.querySelector('span');
  const lines = splitBannerText(text);

  span.innerHTML = '';
  lines.forEach(function (line) {
    const el = document.createElement('div');
    el.textContent = line;
    span.appendChild(el);
  });

  // いちばん長い行が画面に収まる大きさにする（字間 0.12em ぶんも見込む）
  const longest = lines.reduce(function (a, b) { return (a.length >= b.length) ? a : b; });
  const size = Math.min(190, Math.floor(980 / (Math.max(2, longest.length) * 1.14)));
  span.style.fontSize = size + 'px';

  box.classList.toggle('is-attack', !!isAttack);
  box.classList.add('is-open');
}

/* 演出と演出のあいだに置く間 */
const STEP_GAP = 500;

/* 演出の速さ。設定画面で変えられます（1＝標準、小さいほど速い） */
let speedScale = 1;

/* 左右のレーンを入れ替えるか。設定画面で変えられます。
   反転した配置のほうが操作しやすいという判断で、こちらを既定にしています。 */
let mirrorLanes = true;

/** 左右の入れ替えを画面に反映する */
function applyMirrorLanes() {
  document.body.classList.toggle('mirror-lanes', mirrorLanes);
  renderAll();
  renderArrows();
}

/** 演出の長さを、いまの速さ設定に合わせて直す */
function ms(value) {
  return Math.max(1, Math.round(value * speedScale));
}

/**
 * 大きな文字を一定時間出してから、少し間を置いて次へ進む。
 * 出ているあいだは操作できません（フェーズの区切りに使います）。
 */
function playBanner(text, options, next) {
  const opt = options || {};
  view.locked = true;
  closeQuickDetail();
  showBanner(text, !!opt.attack);

  setTimeout(function () {
    hideBanner();
    // 続けて演出や選択が来るときに、詰まって見えないよう間を置く
    setTimeout(function () { if (next) next(); }, ms(STEP_GAP));
  }, ms(opt.hold || 900));
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
  attackArrowSide = bottomSide();    // 1〜2. 自分側の矢印だけを速く・太く・赤く
  applyArrowAttack();
  showBanner('襲撃', true);           // 3. 中央へ赤文字で「襲撃」

  setTimeout(function () { hideBanner(); }, 1100);
  setTimeout(function () {
    attackArrowSide = null;
    applyArrowAttack();
    view.locked = false;
  }, 1900);
}

/* =====================================================================
   案内・確認ダイアログ
   ボタンは 左＝戻る／右＝進む の並びで統一します（v0.1からの約束）
   ===================================================================== */

function showDialog(opts) {
  const box = document.getElementById('dialog');
  box.querySelector('.dlg__title').textContent = opts.title || '';
  box.querySelector('.dlg__message').textContent = opts.message || '';

  const area = box.querySelector('.dlg__buttons');
  area.innerHTML = '';
  (opts.buttons || []).forEach(function (b) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dlg__btn' + (b.primary ? ' dlg__btn--primary' : '');
    btn.textContent = b.label;
    btn.addEventListener('click', function () {
      closeDialog();
      if (b.onClick) b.onClick();
    });
    area.appendChild(btn);
  });
  box.classList.add('is-open');
}

function closeDialog() {
  document.getElementById('dialog').classList.remove('is-open');
}

/* =====================================================================
   ゲーム進行との接続（Stage H）
   ---------------------------------------------------------------------
   H-1：ゲーム処理の読み込みと初期化、マリガンまで
   ここでは手札だけを本物の状態につないでいます。
   盤面・気力・山札などの表示は H-2 でつなぎます。
   ===================================================================== */

const play = {
  active: false,          // ゲームが始まっているか
  handSnapshot: null,     // ドロー演出中に映しておく「増える前の手札」
  mode: 'idle',           // 'mulligan' / 'main'
  mulliganSide: null,     // いまマリガン中の陣営
  mulliganSelected: [],   // 交換に選んだカードの uid
};

/** ゲームを始める */
/* 対戦開始前の設定画面で選ばれている先攻 */
let startFirstSide = 'village';

/** 開始画面を出す（まだ対戦は始めない） */
function openStartScreen() {
  const screen = document.getElementById('start-screen');
  view.locked = true;
  closeQuickDetail();
  hideDim();
  updateStartChoices();
  screen.classList.add('is-open');
}

/** 先攻の選択の見た目を合わせる */
function updateStartChoices() {
  document.querySelectorAll('.start__choice').forEach(function (btn) {
    btn.classList.toggle('is-on', btn.dataset.side === startFirstSide);
  });
}

/** 開始画面のボタンをつなぐ（起動時に1回だけ） */
function setupStartScreen() {
  document.querySelectorAll('.start__choice').forEach(function (btn) {
    btn.addEventListener('click', function () {
      startFirstSide = btn.dataset.side;
      updateStartChoices();
    });
  });

  document.getElementById('start-btn').addEventListener('click', function () {
    const input = document.getElementById('seed-input');
    const seed = input ? input.value.trim() : '';
    document.getElementById('start-screen').classList.remove('is-open');
    startGame(startFirstSide, seed);
  });
}

/** 対戦を始める（マリガンの演出へ入る） */
function startGame(firstSide, seed) {
  Game.start(firstSide || 'village', seed || '');
  play.active = true;
  play.mode = 'start';
  play.handSnapshot = null;
  view.locked = true;
  view.handExpanded = false;
  setCandidate(null, null);
  hideDim();
  renderAll();

  showToast('シード：' + Game.state.seed);
  beginMulligan(Game.state.firstSide);
}

/** 手札の表示を、本物のゲーム状態から作り直す */
function syncHandFromGame(side) {
  view.hand = Game.state.players[side].hand.slice();
  view.handSelected = -1;
}

/** マリガン開始（仕様書 v0.1 の8） */
function beginMulligan(side) {
  play.mode = 'mulligan';
  play.mulliganSide = side;
  play.mulliganSelected = [];

  play.handSnapshot = [];            // 「はじめる」を押したらドロー演出で配る
  view.handExpanded = true;
  const check = document.getElementById('hand-expanded');
  if (check) check.checked = true;
  renderAll();

  // 「◯◯のマリガン」と大きく出してから、明るく戻して5枚を配る
  playBanner(DECKS[side].label + 'のマリガン', { hold: 1200 }, function () {
    hideDim();
    const cards = Game.state.players[side].hand.slice();
    const items = cards.map(function (inst) {
      return {
        from: deckElFor(side),
        to: function () { return handRightPointFor(side); },
        kind: 'toHand',
        onArrive: function () {
          if (!play.handSnapshot) return;
          play.handSnapshot.push(inst);
          refreshHandOnly();
          flashNewHandCard(inst);
        },
      };
    });
    flyCardSequence(items, function () {
      play.handSnapshot = null;
      view.locked = false;        // ここから交換するカードを選べる
      renderAll();
      updateMainButton();
    });
  });
}

/** マリガンでカードの選択を切り替える */
function toggleMulligan(inst) {
  if (!inst || !inst.uid) return;
  const i = play.mulliganSelected.indexOf(inst.uid);
  if (i === -1) play.mulliganSelected.push(inst.uid);
  else play.mulliganSelected.splice(i, 1);
  renderFan();
  updateMainButton();
}

/** マリガンを確定する */
function confirmMulliganNow() {
  const side = play.mulliganSide;
  const n = play.mulliganSelected.length;

  if (n === 0) {
    afterMulliganConfirmed(side, Game.confirmMulligan(side, []));
    return;
  }

  // 選んだカードが裏向きで山札へ戻り、その枚数ぶん引き直す。
  // 交換しないカードは、そのあいだも手札に見えたままにする。
  const selected = play.mulliganSelected.slice();
  const kept = Game.state.players[side].hand.filter(function (c) {
    return selected.indexOf(c.uid) === -1;
  });

  const returning = Game.state.players[side].hand.filter(function (c) {
    return selected.indexOf(c.uid) !== -1;
  });

  play.handSnapshot = Game.state.players[side].hand.slice();
  renderAll();

  // 選んだカードが1枚ずつ山札へ戻る
  const backItems = returning.map(function (inst) {
    return {
      from: function () { return handCardPoint(side, inst); },
      to: deckElFor(side),
      kind: 'handTrash',
      onDepart: function () {
        if (!play.handSnapshot) return;
        const i = play.handSnapshot.indexOf(inst);
        if (i !== -1) { play.handSnapshot.splice(i, 1); refreshHandOnly(); }
      },
    };
  });

  flyCardSequence(backItems, function () {
    const count = Game.confirmMulligan(side, selected);
    play.mulliganSelected = [];

    // 引き直したぶんが1枚ずつ加わる
    const drawn = Game.state.players[side].hand.filter(function (c) {
      return kept.indexOf(c) === -1;
    });
    const drawItems = drawn.map(function (inst) {
      return {
        from: deckElFor(side),
        to: function () { return handRightPointFor(side); },
        kind: 'toHand',
        onArrive: function () {
          if (!play.handSnapshot) return;
          play.handSnapshot.push(inst);
          refreshHandOnly();
        },
      };
    });

    flyCardSequence(drawItems, function () {
      play.handSnapshot = null;
      renderAll();
      afterMulliganConfirmed(side, count);
    });
  });
}

/** マリガンが終わったあとの案内 */
function afterMulliganConfirmed(side, count) {
  play.mulliganSelected = [];
  const st = Game.state;
  const result = (count > 0) ? (count + '枚交換') : '交換なし';

  showDim();   // 相手に渡すあいだは手札が見えないように暗くする
  playBanner(DECKS[side].label + '：' + result, {}, function () {
    if (side === st.firstSide) {
      beginMulligan(st.secondSide);              // 続けて後攻のマリガンへ
    } else {
      playBanner('ゲーム開始', { hold: 1200 }, finishMulligan);
    }
  });
}

/** マリガン終了 → 先攻の第1ターンへ（ターン開始の中身は beginTurnFlow が行う） */
function finishMulligan() {
  const st = Game.state;
  play.mode = 'main';

  // 暗いうちに盤面を先攻のものにしてから、名前を出して明るく戻す
  switchBoardTo(st.firstSide);
  playBanner(DECKS[st.firstSide].label + 'のターン', { hold: 1200 }, function () {
    hideDim();
    setTimeout(function () { runTurnStart(st.firstSide); }, ms(350));
  });
}

/* ---------------------------------------------------------------------
   H-2：盤面・気力などの表示を本物のゲーム状態につなぐ
   --------------------------------------------------------------------- */

/** 画面の下側に表示する陣営（v0.1と同じく、いま手番のプレイヤー） */
function bottomSide() {
  const st = Game.state;
  if (!st) return 'village';
  if (play.mode === 'mulligan' && play.mulliganSide) return play.mulliganSide;
  return st.currentSide || st.firstSide;
}

/** 画面の上側に表示する陣営 */
function topSide() {
  return otherSide(bottomSide());
}

/** ゲームのカード1枚を、画面表示用の形に直す */
function instToSpec(inst) {
  const spec = {
    cardId: inst.cardId,
    owner: inst.owner,
    uid: inst.uid,
    inst: inst,
  };
  const s = Game.getStats(inst);
  if (s.hasStats) {
    // 表示は0が下限（体力を超えるダメージでもマイナスにしない）
    spec.speed = Math.max(0, s.curSpeed);
    spec.hp = Math.max(0, s.curHp);
    spec.baseSpeed = s.baseSpeed; // カードに印刷されている値
    spec.baseHp = s.baseHp;
  }
  return spec;
}

/** 本物のゲーム状態を、画面表示用の view へ写す */
function syncFromGame() {
  if (!play.active || !Game.state) return;
  const st = Game.state;
  const meSide = bottomSide();
  const opSide = topSide();
  const me = st.players[meSide];
  const op = st.players[opSide];

  const trackMe = st.tracking[meSide];   // 自分の怪異 → 相手の人間
  const trackOp = st.tracking[opSide];   // 相手の怪異 → 自分の人間

  function normal(list, exclude) {
    return list.filter(function (c) { return c !== exclude; }).map(instToSpec);
  }

  // 通常列には、追跡に関わっているカードを含めない（仕様書 10.1）
  view.selfYoukai = normal(me.youkai, trackMe && trackMe.youkai);
  view.selfHuman  = normal(me.humans, trackOp && trackOp.human);
  view.oppYoukai  = normal(op.youkai, trackOp && trackOp.youkai);
  view.oppHuman   = normal(op.humans, trackMe && trackMe.human);

  view.trackSelf = trackMe
    ? { youkai: instToSpec(trackMe.youkai), human: instToSpec(trackMe.human) } : null;
  view.trackOpp = trackOp
    ? { youkai: instToSpec(trackOp.youkai), human: instToSpec(trackOp.human) } : null;

  // ドロー演出の最中は「増える前の手札」を映しておき、
  // カードが着いてから増えるように見せる
  view.hand = play.handSnapshot ? play.handSnapshot.slice() : me.hand.slice();
  view.oppHandCount = op.hand.length;
}

/** 気力・山札・トラッシュ・ロスト数の表示を更新する */
function renderStatus() {
  if (!play.active || !Game.state) return;
  const st = Game.state;
  const me = st.players[bottomSide()];
  const op = st.players[topSide()];

  function put(selector, text) {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
  }
  function lostText(p) {
    const limit = p.field && p.field.master ? p.field.master.lostLimit : '-';
    return p.lost.length + ' / ' + limit;
  }

  put('.energy-box--self .energy-box__value', me.energy);
  put('.energy-box--opp  .energy-box__value', op.energy);
  put('.deck-box--self .deck-box__count', '残り ' + me.deck.length + '枚');
  put('.deck-box--opp  .deck-box__count', '残り ' + op.deck.length + '枚');
  put('.hexbtn--self-trash span', 'トラッシュ ' + me.trash.length);
  put('.hexbtn--opp-trash  span', 'トラッシュ ' + op.trash.length);
  put('.field-box--self .field-box__value', lostText(me));
  put('.field-box--opp  .field-box__value', lostText(op));
}

/* =====================================================================
   H-3：カードの登場・使用と、効果の解決
   ===================================================================== */

/** カードを選ぶ画面の状態 */
let picker = null;      // { cards, count, mode, chosen: [inst], cb }
/** 盤面のカードを選ぶ状態 */
let boardPick = null;   // { candidates: [inst], cb }

/** カードを選ぶ画面を開く */
function openCardPicker(options, cb) {
  picker = {
    cards: options.cards.slice(),
    // 選べるカードの指定。無指定なら全部選べる（仕様書 18.7）
    selectable: options.selectable ? options.selectable.slice() : null,
    count: options.count,
    mode: options.mode || 'max',
    ordered: !!options.ordered,
    chosen: [],
    cb: cb,
  };
  const box = document.getElementById('picker');
  box.querySelector('.pick__title').textContent = options.title || '';
  box.querySelector('.pick__message').textContent = options.message || '';
  box.classList.add('is-open');
  renderPicker();
}

function renderPicker() {
  if (!picker) return;
  const box = document.getElementById('picker');
  const grid = box.querySelector('.pick__grid');
  grid.innerHTML = '';

  picker.cards.forEach(function (inst) {
    const el = document.createElement('div');
    el.className = 'pick__card';
    const path = getCardImagePath(inst.cardId, inst.owner);
    if (path) el.style.backgroundImage = 'url("' + path + '")';

    // 選べるカードだけ光らせ、選べないカードは暗くしてタップも受けない
    const canPick = !picker.selectable || picker.selectable.indexOf(inst) !== -1;
    el.classList.add(canPick ? 'is-selectable' : 'is-locked');

    const at = picker.chosen.indexOf(inst);
    if (at !== -1) {
      el.classList.add('is-picked');
      if (picker.ordered) {
        const n = document.createElement('div');
        n.className = 'pick__order';
        n.textContent = String(at + 1);
        el.appendChild(n);
      }
    }
    attachPointer(el, {
      onTap: function () { if (canPick) togglePick(inst); },
      onLongPress: function () { openZoomDetail({ cardId: inst.cardId, owner: inst.owner }); },
    });
    grid.appendChild(el);
  });

  // ボタン（左＝戻る／右＝進む の並び）
  const area = box.querySelector('.pick__buttons');
  area.innerHTML = '';
  const n = picker.chosen.length;
  const canConfirm = (picker.mode === 'exact') ? (n === picker.count) : (n <= picker.count);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dlg__btn dlg__btn--primary';
  btn.textContent = (n === 0) ? '選ばない' : ('確定 ' + n + '枚');
  btn.disabled = !canConfirm;
  btn.style.opacity = canConfirm ? '1' : '0.45';
  btn.addEventListener('click', function () {
    if (!canConfirm) return;
    if (n === 0 && picker.mode === 'max') {
      // 0枚で確定するときは念のため確認する
      showDialog({
        title: '確認',
        message: '1枚も選ばずに進めますか？',
        buttons: [
          { label: '戻る' },
          { label: '進む', primary: true, onClick: closeCardPicker },
        ],
      });
      return;
    }
    closeCardPicker();
  });
  area.appendChild(btn);
}

function togglePick(inst) {
  if (!picker) return;
  if (picker.selectable && picker.selectable.indexOf(inst) === -1) return;
  const at = picker.chosen.indexOf(inst);
  if (at !== -1) picker.chosen.splice(at, 1);
  else if (picker.chosen.length < picker.count) picker.chosen.push(inst);
  else if (picker.count === 1) picker.chosen = [inst];   // 1枚だけのときは選び直し
  renderPicker();
}

function closeCardPicker() {
  if (!picker) return;
  const cb = picker.cb;
  const chosen = picker.chosen.slice();
  picker = null;
  document.getElementById('picker').classList.remove('is-open');
  document.getElementById('picker').querySelector('.pick__grid').innerHTML = '';
  if (cb) cb(chosen);
}

/** 盤面のカードを1体選ばせる */
function openBoardPick(options, cb) {
  boardPick = { candidates: options.candidates.slice(), cb: cb };
  const hint = document.getElementById('target-hint');
  hint.textContent = options.title + '：' + options.message;
  hint.classList.add('is-open');
  renderBoard();
}

function finishBoardPick(inst) {
  if (!boardPick) return;
  const cb = boardPick.cb;
  boardPick = null;
  document.getElementById('target-hint').classList.remove('is-open');
  renderBoard();
  if (cb) cb(inst);
}

/* 効果が発動しているカード。描き直しても強調が消えないよう控えておく。 */
let activatingUid = null;

/**
 * フィールドカードの中身を、そのときの盤面の向きから求める。
 * @param which 'self'（画面下側）または 'opp'（画面上側）
 */
function fieldSpecFor(which) {
  if (play.active && Game.state) {
    const side = (which === 'self') ? bottomSide() : topSide();
    const inst = Game.state.players[side].field;
    if (inst) return { cardId: inst.cardId, owner: side, inst: inst };
  }
  // ゲーム前の見本表示
  return (which === 'self')
    ? { cardId: 'field_village', owner: 'village', inst: null }
    : { cardId: 'field_mansion', owner: 'mansion', inst: null };
}

/** 効果の発生源のカード要素を探す */
function findCardElement(inst) {
  if (!inst) return null;
  if (inst.uid) {
    const el = document.querySelector('#board-plane .card[data-uid="' + inst.uid + '"]');
    if (el) return el;
  }
  // フィールドカードのとき
  const st = Game.state;
  if (st) {
    if (st.players[bottomSide()].field === inst) {
      return document.querySelector('.field-box--self .field-box__card');
    }
    if (st.players[topSide()].field === inst) {
      return document.querySelector('.field-box--opp .field-box__card');
    }
  }
  return null;
}

/**
 * 効果が発動するカードを少し持ち上げて光らせ、クイック詳細を開く。
 * 0.5秒ほど見せてから、効果の解決へ進みます。
 */
function highlightEffectSource(item, next) {
  const el = findCardElement(item.source);
  if (!el) { next(); return; }

  activatingUid = item.source.uid || null;
  el.classList.add('is-activating');
  openQuickDetail(instToSpec(item.source), el);

  // 見せ終えてから、さらに少し間を置いて効果の解決へ
  setTimeout(function () { setTimeout(next, ms(STEP_GAP)); }, ms(520));
}

/** 発動の強調を解く */
function clearActivating() {
  activatingUid = null;
  document.querySelectorAll('.card.is-activating').forEach(function (el) {
    el.classList.remove('is-activating');
  });
  closeQuickDetail();
}

/* いま解決している効果の情報。
   効果の途中で選択を求められたとき、そこまでの移動演出を先に見せるために使う。 */
let effectFlow = null;   // { side, before, eventCard }

/**
 * ここまでに起きたカードの移動を演出してから、次へ進む。
 * ドローや墓地肥やしを見てから、捨てる／回収するカードを選べるようになります。
 */
function flushEffectAnimations(next) {
  if (!effectFlow) { next(); return; }
  const side = effectFlow.side;
  const before = effectFlow.before;

  // 何も動いていなければ待たせない
  const p = Game.state.players[side];
  const moved = (p.hand.length !== before.hand) || (p.trash.length !== before.trash);

  animateZoneChanges(side, before, function () {
    if (effectFlow) effectFlow.before = snapshotZones(side);   // ここまでを反映済みにする
    renderAll();
    setTimeout(next, moved ? ms(STEP_GAP) : 0);
  });
}

/** 効果から呼ばれる画面操作 */
const uiOps = {
  confirmYesNo: function (title, message, cb) {
    flushEffectAnimations(function () {
      showDialog({
        title: title,
        message: message,
        buttons: [
          { label: '発動しない', onClick: function () { cb(false); } },
          { label: '発動する', primary: true, onClick: function () { cb(true); } },
        ],
      });
    });
  },
  pickCards: function (options, cb) {
    flushEffectAnimations(function () { openCardPicker(options, cb); });
  },
  pickBoardTarget: function (options, cb) {
    flushEffectAnimations(function () { openBoardPick(options, cb); });
  },
};

/** 待機している効果をすべて順に解決する */
function runPendingEffects(done) {
  const st = Game.state;
  if (st.gameOver) { done(); return; }

  const item = Game.takeNextPending();
  if (!item) { done(); return; }

  view.locked = true;      // 解決中は操作を止める
  closeQuickDetail();      // いったん閉じ、発動するカードのものを開き直す
  if (item.side === bottomSide()) keepHandOpen();
  renderAll();

  // 効果が起きてから 0.5秒 → カードを持ち上げて見せる → さらに 0.5秒 → 解決
  setTimeout(function () {
  highlightEffectSource(item, function () {
    effectFlow = {
      side: item.side,
      before: snapshotZones(item.side),
      // 効果ダメージで相手のカードが倒れることもあるので、相手側も控えておく
      beforeOpp: snapshotZones(otherSide(item.side)),
      // 使い終わったイベントは、効果と演出がすべて終わってからトラッシュへ置く
      eventCard: (item.kind === 'event') ? item.source : null,
    };

    Game.runEffect(item, uiOps, function () {
      const flow = effectFlow;
      effectFlow = null;
      clearActivating();

      // 残りのカードの移動を、自分側 → 相手側の順に演出する
      animateZoneChanges(flow.side, flow.before, function () {
        animateZoneChanges(otherSide(flow.side), flow.beforeOpp, function () {
          renderAll();
          setTimeout(function () { runPendingEffects(done); }, ms(200));
        });
      }, flow.eventCard);
    });
  });
  }, ms(STEP_GAP));
}

/** 手札を拡大表示のままに保つ */
function keepHandOpen() {
  view.handExpanded = true;
  const check = document.getElementById('hand-expanded');
  if (check) check.checked = true;
}

/** カードを実際に登場・使用する（H-3） */
function playCardInGame(spec, target) {
  const side = bottomSide();
  const inst = spec.inst;
  if (!inst) return;

  let result = null;
  if (target.kind === 'unit') {
    result = Game.playUnit(side, inst);
  } else if (target.kind === 'equip') {
    const targetInst = target.el._spec ? target.el._spec.inst : null;
    result = Game.playGoods(side, inst, targetInst);
  } else if (target.kind === 'event') {
    result = Game.playEvent(side, inst);
  }

  if (!result || !result.ok) {
    showToast((result && result.reasons && result.reasons[0]) || 'ここには置けません');
    renderAll();
    return;
  }

  view.handSelected = -1;
  keepHandOpen();          // 効果の解決が終わるまで拡大表示を保つ
  renderAll();

  // 【登場時】やイベントの効果を解決する
  runPendingEffects(function () {
    view.locked = false;
    keepHandOpen();
    renderAll();
    updateMainButton();
  });
}

/* =====================================================================
   H-4：追跡・襲撃・終了時効果・自動ターン終了（仕様書 19〜21・23・25）
   ---------------------------------------------------------------------
   v0.2 の流れ（仕様書 23.2 を、制作者の判断でさらに簡略化）
     メイン中に、次のどちらかを行う
       ・盤面の怪異を相手の人間へドラッグして「追跡を確定」
       ・「ターン終了」ボタンを押す（追跡なし）
     → 確認（まだプレイできるカードがあれば知らせる）
       → 追跡開始演出（追跡した場合）
       → 終了時効果解決
       → 自動ターン終了
       → 盤面上下入れ替え
       → 次ターンの操作案内
   「追跡フェーズ」という段階は設けません。メインの中で追跡まで決めます。
   ===================================================================== */

/** ボタン14を押したとき */
function onMainButton() {
  if (view.locked) return;
  if (play.mode === 'mulligan') { confirmMulliganNow(); return; }

  if (!play.active) {
    // 見本モード（ゲーム未接続）
    if (confirmTracking()) return;
    showToast('ターン終了はゲーム中のみ使えます');
    return;
  }

  const st = Game.state;
  if (st.gameOver) return;

  // 追跡を選んでいれば「追跡を確定」、選んでいなければ「ターン終了」
  if (st.phase === 'main' || st.phase === 'tracking') {
    if (view.candidate) confirmTrackingFromMain();
    else endTurnFlow();
  }
}

/**
 * メイン中に追跡を確定しようとしたとき。
 * 確定するとメインが終わるので、必ず確認をはさむ。
 */
function confirmTrackingFromMain() {
  const side = bottomSide();
  const stillPlayable = Game.hasMeaningfulPlay(side);
  const message = stillPlayable
    ? '追跡を確定すると、このターンは終了します。\nまだプレイできるカードがありますが、よろしいですか？'
    : '追跡を確定すると、このターンは終了します。\nよろしいですか？';

  showDialog({
    title: '追跡の確定',
    message: message,
    buttons: [
      { label: '戻る' },
      {
        label: '確定する', primary: true,
        onClick: function () {
          closeQuickDetail();
          view.handSelected = -1;
          if (view.handExpanded) {
            view.handExpanded = false;
            const c = document.getElementById('hand-expanded');
            if (c) c.checked = false;
          }
          if (Game.state.phase === 'main') Game.endMain();
          confirmTrackingInGame(); // 追跡を確定して演出へ
        },
      },
    ],
  });
}

/**
 * ターン終了。まだ使えるカードがあれば確認する（仕様書 24.1）
 * 追跡を指定していない場合は、追跡なしでターンを終えます。
 */
function endTurnFlow() {
  const side = bottomSide();
  const st = Game.state;
  const me = st.players[side];
  const opp = st.players[otherSide(side)];

  const lines = [];

  // 追跡できる状況なのに指定していない場合は、そのことを知らせる
  if (me.youkai.length > 0 && opp.humans.length > 0) {
    lines.push('追跡を指定していません。\n次の自分のターンに襲撃は起こりません。');
  }
  if (Game.hasMeaningfulPlay(side)) {
    lines.push('まだプレイできるカードがあります。');
  }

  if (lines.length === 0) { doEndTurn(); return; }
  lines.push('このターンを終了しますか？');

  showDialog({
    title: 'ターン終了の確認',
    message: lines.join('\n\n'),
    buttons: [
      { label: '戻る' },
      { label: 'ターンを終了', primary: true, onClick: doEndTurn },
    ],
  });
}

function doEndTurn() {
  closeQuickDetail();
  view.handSelected = -1;
  if (view.handExpanded) {
    view.handExpanded = false;
    const c = document.getElementById('hand-expanded');
    if (c) c.checked = false;
  }

  const side = bottomSide();
  if (Game.state.phase === 'main') Game.endMain();
  if (Game.state.phase === 'tracking') Game.skipTracking(side);

  renderAll();
  goToEndPhase();
}

/** 追跡を確定して演出へ（仕様書 20） */
function confirmTrackingInGame() {
  const pair = view.candidate;
  if (!pair || !pair.youkai.inst || !pair.human.inst) return;

  const side = bottomSide();
  view.candidate = null;
  view.locked = true;
  closeQuickDetail();

  Game.setTracking(side, pair.youkai.inst, pair.human.inst);
  showBanner('追跡開始');

  // カードが追跡位置へ移動する（再配置アニメーション）
  setTimeout(function () { renderAll(); }, 60);

  setTimeout(function () {
    hideBanner();
    goToEndPhase();
  }, ms(950));
}

/** 終了時効果を解決してから、自動でターンを終える（仕様書 23.2・25） */
function goToEndPhase() {
  const side = bottomSide();
  view.locked = true;
  Game.queueEndTurnEffects(side);
  renderAll();

  runPendingEffects(function () {
    if (Game.state.gameOver) { finishWithResult(); return; }
    Game.toEndPhase();
    autoEndTurn();
  });
}

/** 画面を暗くする／戻す（ターン交代のとき） */
function showDim() { document.getElementById('dim-screen').classList.add('is-on'); }
function hideDim() { document.getElementById('dim-screen').classList.remove('is-on'); }

/** 自動ターン終了 → 盤面の上下入れ替え → 次のターン案内（仕様書 25） */
function autoEndTurn() {
  const next = Game.endTurn();

  // 手札を簡略表示へ戻し、クイック詳細を閉じる
  view.handExpanded = false;
  view.handSelected = -1;
  setCandidate(null, null);
  closeQuickDetail();
  const c = document.getElementById('hand-expanded');
  if (c) c.checked = false;
  renderAll();

  // 画面を暗くしたまま「ターン終了」→ 盤面を入れ替え →「◯◯のターン」→ 明るく戻す
  showDim();
  playBanner('ターン終了', {}, function () {
    switchBoardTo(next);        // 暗いうちに上下を入れ替える
    playBanner(DECKS[next].label + 'のターン', { hold: 1200 }, function () {
      hideDim();
      setTimeout(function () { runTurnStart(next); }, ms(350));
    });
  });
}

/**
 * ターン開始（仕様書 v0.1 の 9.3 と同じ順番）
 *   1. ターン数を進める（ここで盤面の上下が入れ替わる）
 *   2. 前の自分のターンに指定した追跡による襲撃
 *   3. 開始時効果
 *   4. 気力回復
 *   5. 1枚ドロー
 */
function beginTurnFlow(side) {
  switchBoardTo(side);
  runTurnStart(side);
}

/**
 * 盤面を次のプレイヤーのものに切り替える。
 * 暗転しているあいだに呼ぶので、入れ替わる瞬間は見えません。
 */
function switchBoardTo(side) {
  view.locked = true;
  Game.beginTurn(side);

  // ターン開始から操作できるようになるまで、手札は拡大表示のままにする。
  view.handExpanded = true;
  view.handSelected = -1;
  const check = document.getElementById('hand-expanded');
  if (check) check.checked = true;

  renderAll();
}

/** ターン開始の処理：襲撃 → 開始時効果 → 気力回復 → ドロー */
function runTurnStart(side) {
  view.locked = true;
  const info = Game.prepareAttack(side);
  if (info) playAttack(info, function () { afterAttack(side); });
  else afterAttack(side);
}

/** 襲撃の演出（仕様書 21.4） */
function playAttack(info, done) {
  view.locked = true;
  closeQuickDetail();

  attackArrowSide = info.side;    // 襲撃している側の矢印だけを加速させる
  applyArrowAttack();             // 描き直さず、その場で速く・太くする
  showBanner('襲撃', true);

  // 1. ダメージを与える
  setTimeout(function () {
    Game.applyAttackDamage(info);
    renderAll();
    showToast(info.attacker.master.name + ' → ' + info.defender.master.name +
      '：' + info.finalToHuman + 'ダメージ／反撃 ' + info.finalToYoukai);

    // 2. 倒れたカードを移動し、生き残りは通常列へ戻す
    setTimeout(function () {  /* 演出の間隔 */
      const beforeSelf = snapshotZones(bottomSide());
      const beforeOpp = snapshotZones(topSide());

      Game.finishAttack(info);
      hideBanner();
      attackArrowSide = null;
      applyArrowAttack();
      renderAll();

      // 3. 倒れてトラッシュへ置かれたカードを、両陣営ぶん演出する
      animateZoneChanges(bottomSide(), beforeSelf, function () {
        animateZoneChanges(topSide(), beforeOpp, function () {
          setTimeout(done, ms(320));
        });
      });
    }, ms(620));
  }, ms(550));
}

/** 襲撃のあと：開始時効果 → 気力回復 → ドロー → メインへ */
function afterAttack(side) {
  if (Game.state.gameOver) { finishWithResult(); return; }

  runPendingEffects(function () {
    if (Game.state.gameOver) { finishWithResult(); return; }

    // 気力回復＋1枚ドロー。
    // 描き直しを演出の後にすることで、カードが着いてから手札が増えて見える。
    const before = snapshotZones(side);
    Game.turnStartResources(side);

    animateZoneChanges(side, before, function () {
      renderAll();
      if (Game.state.gameOver) { finishWithResult(); return; }

      view.locked = false;
      updateMainButton();
    });
  });
}

/** 決着したとき（本格的なリザルト画面は H-5 で作ります） */
/** 決着。大きく「決着」と出してから、リザルト画面を開く */
function finishWithResult() {
  view.locked = true;
  closeQuickDetail();
  renderAll();

  playBanner('決着', { hold: 1200 }, openResultScreen);
}

/** 決着の画面を組み立てて開く */
function openResultScreen() {
  const st = Game.state;
  const over = st.gameOver;
  const screen = document.getElementById('result-screen');

  // どちらが負けたか（引き分けなら両方）
  const lostSides = over.losers.map(function (l) { return l.side; });
  const isLoser = function (side) { return lostSides.indexOf(side) !== -1; };

  // 1. 決着した場面
  const phase = screen.querySelector('.result__phase');
  phase.textContent = (over.phaseLabel || '') +
    '（' + over.turnCount + 'ターン目・' + over.round + '巡目）';

  // 2. 勝敗
  const title = screen.querySelector('.result__title');
  title.textContent = over.draw ? '引き分け' : (DECKS[over.winner].label + '\nの勝利');
  title.classList.toggle('is-draw', !!over.draw);

  // 3. 敗北の理由
  screen.querySelector('.result__reason').textContent =
    over.losers.map(function (l) {
      return DECKS[l.side].label + '　' + l.reasons.join('／');
    }).join('\n');

  // 4. 両者の最終状態をならべる
  const table = screen.querySelector('.result__table');
  table.innerHTML = '';

  const sides = ['village', 'mansion'];
  const head = ['', '', ''];
  sides.forEach(function (side, i) {
    const el = document.createElement('div');
    el.className = 'result__head' + (!over.draw && over.winner === side ? ' result__head--win' : '');
    el.textContent = DECKS[side].label + (!over.draw && over.winner === side ? '　勝利' : '');
    head[i === 0 ? 0 : 2] = el;
  });
  const headMid = document.createElement('div');
  headMid.className = 'result__head';
  table.appendChild(head[0]);
  table.appendChild(headMid);
  table.appendChild(head[2]);

  const rows = [
    ['場の人間', function (p) { return p.humans.length + '体'; }, function (p) { return p.humans.length === 0; }],
    ['場の怪異', function (p) { return p.youkai.length + '体'; }, null],
    ['ロスト', function (p) {
      const limit = p.field.master.lostLimit;
      return p.lost.length + (typeof limit === 'number' ? ' / ' + limit + '枚' : '枚');
    }, function (p) {
      const limit = p.field.master.lostLimit;
      return (typeof limit === 'number') && p.lost.length >= limit;
    }],
    ['山札', function (p) { return p.deck.length + '枚'; }, function (p) { return p.deck.length === 0; }],
    ['トラッシュ', function (p) { return p.trash.length + '枚'; }, null],
    ['手札', function (p) { return p.hand.length + '枚'; }, null],
  ];

  rows.forEach(function (row) {
    sides.forEach(function (side, i) {
      const p = st.players[side];
      const val = document.createElement('div');
      val.className = 'result__val' + (row[2] && row[2](p) ? ' is-lose' : '');
      val.textContent = row[1](p);

      if (i === 0) {
        table.appendChild(val);
        const key = document.createElement('div');
        key.className = 'result__key';
        key.textContent = row[0];
        table.appendChild(key);
      } else {
        table.appendChild(val);
      }
    });
  });

  // 5. ボタン
  const buttons = screen.querySelector('.result__buttons');
  buttons.innerHTML = '';
  const seed = st.seed;
  const first = st.firstSide;

  [
    ['ログを見る', false, function () { openLog(); }],
    ['同じ条件でもう一度', false, function () { closeResultScreen(); startGame(first, seed); }],
    ['新しい対戦', true, function () { closeResultScreen(); openStartScreen(); }],
  ].forEach(function (item) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result__btn' + (item[1] ? ' result__btn--primary' : '');
    btn.textContent = item[0];
    btn.addEventListener('click', item[2]);
    buttons.appendChild(btn);
  });

  screen.classList.add('is-open');
}

function closeResultScreen() {
  document.getElementById('result-screen').classList.remove('is-open');
  closeSheet();
}

/* =====================================================================
   ドローの演出
   ---------------------------------------------------------------------
   山札から裏向きのカードが手札へ飛んでいきます。
   演出中は手札の描き直しを遅らせるので、カードが「着いてから増える」
   ように見えます。
   ===================================================================== */

/** その陣営の山札・トラッシュの要素 */
function deckElFor(side) {
  return document.querySelector(side === bottomSide() ? '.deck-box--self' : '.deck-box--opp');
}
function trashElFor(side) {
  return document.querySelector(side === bottomSide() ? '.hexbtn--self-trash' : '.hexbtn--opp-trash');
}

/** その陣営の手札の位置（設計座標） */
function handPointFor(side) {
  const list = (side === bottomSide())
    ? ['#hand-fan', '.hand-mini--self']
    : ['.hand-mini--opp'];

  for (let i = 0; i < list.length; i++) {
    const el = document.querySelector(list[i]);
    if (!el) continue;
    const r = designRect(el);
    if (r.w > 0 && r.h > 0) {
      // 拡大手札は縦に長い枠なので、カードが並ぶ下寄りを狙う
      const ratio = (list[i] === '#hand-fan') ? 0.62 : 0.5;
      return { x: r.x + r.w / 2, y: r.y + r.h * ratio };
    }
  }
  // 演出中で手札が隠れているときの控えの位置
  return { x: 540, y: (side === bottomSide()) ? 1640 : 180 };
}

/**
 * 手札の右端（新しいカードが加わるあたり）の位置。
 * 拡大手札が出ていれば、いま一番右にあるカードの位置を使います。
 */
function handRightPointFor(side) {
  if (side === bottomSide()) {
    const cards = document.querySelectorAll('#hand-fan .fan-card');
    if (cards.length) {
      const r = designRect(cards[cards.length - 1]);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
  }
  return handPointFor(side);
}

/** 手札の i 枚目のカード情報 */
function handSpecAt(i) {
  const entry = view.hand[i];
  const isInstance = (entry && typeof entry === 'object');
  return {
    cardId: isInstance ? entry.cardId : entry,
    owner: isInstance ? (entry.owner || 'village') : 'village',
    label: '手札',
    handIndex: i,
    inst: isInstance ? entry : null,
    uid: isInstance ? entry.uid : undefined,
  };
}

/**
 * 手札を横になぞったときに、指の下のカードを選び直す。
 * なぞっている間は拡大詳細を出しません（長押しは移動の時点で中止されます）。
 */
function scrubHandSelection(e) {
  if (!view.handExpanded || view.locked) return;
  if (play.mode === 'mulligan') return;   // マリガン中は交換の選択なので触らない

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const card = (under && under.closest) ? under.closest('#hand-fan .fan-card') : null;
  if (!card) return;

  const idx = parseInt(card.dataset.handIndex, 10);
  if (isNaN(idx) || idx === view.handSelected) return;

  view.handSelected = idx;
  syncPanel();
  renderFan();

  // 描き直したあとの要素に合わせて詳細を出し直す
  const shown = document.querySelector('#hand-fan .fan-card[data-hand-index="' + idx + '"]');
  if (shown) openQuickDetail(handSpecAt(idx), shown);
}

/** 手札の中の1枚の位置。見つからなければ手札全体の位置を返す */
function handCardPoint(side, inst) {
  if (side === bottomSide() && inst && inst.uid) {
    const el = document.querySelector('#hand-fan .fan-card[data-uid="' + inst.uid + '"]');
    if (el) {
      const r = designRect(el);
      if (r.w > 0) return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
  }
  return handPointFor(side);
}

/** 要素の中心（設計座標） */
function centerOfEl(el) {
  const r = designRect(el);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/* ---------------------------------------------------------------------
   カードの移動演出
   ---------------------------------------------------------------------
   「カード状の光」が弧を描いて移動します。
     toHand    … 山札／トラッシュ → 手札。下向きの弧を描き、横から手札に入る
     deckTrash … 山札 → トラッシュ。似た軌跡で、手札より後ろの層を通る
     handTrash … 手札 → トラッシュ／山札。手札の上の層を、少し上向きの弧で通る
   --------------------------------------------------------------------- */

const FLY_DURATION = 360;   // 1枚が移動する時間
const FLY_GAP = 150;        // 次の1枚を出すまでの間隔（手札が増える間隔と同じ）
const ARRIVE_RATIO = 0.82;  // この割合まで進んだら、着いたものとして手札に反映する

/** 光を1つ作る */
function makeFlyLight(kind) {
  const el = document.createElement('div');
  let cls = 'fly-light';
  if (kind !== 'toHand') cls += ' fly-light--warm';
  if (kind === 'dropToTrash') cls += ' fly-light--small';
  el.className = cls;
  return el;
}

/** 弧の「ふくらみ」を決める点 */
function arcControlPoint(kind, start, goal) {
  const mid = { x: (start.x + goal.x) / 2, y: (start.y + goal.y) / 2 };

  if (kind === 'toHand') {
    // いったん手札より下へ回り込み、横から入ってくる
    return { x: start.x, y: goal.y + 170 };
  }
  if (kind === 'deckTrash') {
    // ドローと似た軌跡で、下へ回り込んでトラッシュへ
    return { x: start.x, y: goal.y + 80 };
  }
  if (kind === 'dropToTrash') {
    return mid;   // 真上から落とすだけなので、ふくらませない
  }
  if (kind === 'handTrash') {
    // 手札の上を、少し持ち上がるように通る
    return { x: mid.x, y: mid.y - 190 };
  }
  return mid;
}

/** 弧に沿った動きを、細かい区切りの並びに直す */
function arcKeyframes(start, ctrl, goal) {
  const frames = [];
  const STEPS = 20;

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    const x = u * u * start.x + 2 * u * t * ctrl.x + t * t * goal.x;
    const y = u * u * start.y + 2 * u * t * ctrl.y + t * t * goal.y;

    // 途中で少しふくらみ、着くときにすっと消える
    const scale = 0.62 + 0.46 * Math.sin(Math.PI * t);
    let opacity = 1;
    if (t < 0.12) opacity = t / 0.12;
    else if (t > 0.86) opacity = (1 - t) / 0.14;

    frames.push({
      transform: 'translate(calc(-50% + ' + (x - start.x) + 'px), ' +
                 'calc(-50% + ' + (y - start.y) + 'px)) scale(' + scale.toFixed(3) + ')',
      opacity: opacity,
    });
  }
  return frames;
}

/**
 * カードの移動演出をまとめて行う。
 * @param items [{ from, to, kind, onDepart, onArrive }]
 *              from / to は要素または {x,y}
 * @param done  すべて終わったら呼ぶ
 */
function flyCardSequence(items, done) {
  const finish = done || function () {};
  if (!items || !items.length) { finish(); return; }

  let finished = 0;

  items.forEach(function (item, index) {
    setTimeout(function () {
      function resolvePoint(v) {
        if (typeof v === 'function') return v();          // 飛ぶ直前に計算する
        return (v && v.nodeType) ? centerOfEl(v) : v;
      }
      const start = resolvePoint(item.from);
      const goal = resolvePoint(item.to);

      let arrived = false;
      function complete() {
        if (arrived) return;
        arrived = true;
        if (item.onArrive) item.onArrive();
        finished++;
        if (finished >= items.length) finish();
      }

      if (!start || !goal) { complete(); return; }
      if (item.onDepart) item.onDepart();   // 出発と同時に元の場所から消す

      // 手札から出ていく動きだけ、手札より前の層を通す
      const layerId = (item.kind === 'handTrash') ? 'fly-layer-top' : 'fly-layer';
      const el = makeFlyLight(item.kind);
      el.style.left = start.x + 'px';
      el.style.top = start.y + 'px';
      document.getElementById(layerId).appendChild(el);

      if (el.animate) {
        const ctrl = arcControlPoint(item.kind, start, goal);
        const anim = el.animate(arcKeyframes(start, ctrl, goal),
                                { duration: ms(FLY_DURATION), easing: 'cubic-bezier(0.35, 0, 0.3, 1)' });
        anim.onfinish = function () { el.remove(); };
        setTimeout(function () { el.remove(); }, ms(FLY_DURATION) + 400);   // 念のための保険
      } else {
        setTimeout(function () { el.remove(); }, ms(FLY_DURATION));
      }

      // 光が着くのと同時に手札へ反映する（終わりを待つとわずかに遅れて見えるため）
      setTimeout(complete, ms(Math.round(FLY_DURATION * ARRIVE_RATIO)));
    }, index * ms(FLY_GAP));
  });
}

/** 新しく手札に加わったカードを、光とともに浮かび上がらせる */
function flashNewHandCard(inst) {
  if (!inst || !inst.uid) return;
  const el = document.querySelector('#hand-fan .fan-card[data-uid="' + inst.uid + '"]');
  if (!el || !el.animate) return;

  el.animate([
    { opacity: 0, filter: 'brightness(2.6) drop-shadow(0 0 26px rgba(190, 230, 255, 0.95))' },
    { opacity: 1, filter: 'brightness(1.5) drop-shadow(0 0 16px rgba(190, 230, 255, 0.7))', offset: 0.45 },
    { opacity: 1, filter: 'brightness(1) drop-shadow(0 5px 9px rgba(0, 0, 0, 0.55))' },
  ], { duration: 260, easing: 'ease-out' });
}

/** 手札の表示だけを更新する（盤面は動かさない） */
function refreshHandOnly() {
  if (play.active) syncFromGame();
  renderFan();
}

/**
 * 前後の状態を見比べて、カードの移動をまとめて演出する。
 *   手札 → トラッシュ … 表向き（捨てたことが分かるように）
 *   山札 → トラッシュ … 表向き
 *   山札 → 手札       … 裏向き（ドロー）
 *   トラッシュ → 手札 … 表向き（公開されている場所からの回収）
 * 手札は、カードが出ていく／着くのに合わせて1枚ずつ増減します。
 */
function animateZoneChanges(side, before, done, eventCard) {
  const p = Game.state.players[side];
  const isMine = (side === bottomSide());

  function has(list, c) { return list.indexOf(c) !== -1; }

  const leftHand = before.handCards.filter(function (c) { return !has(p.hand, c); });
  const joinedHand = p.hand.filter(function (c) { return !has(before.handCards, c); });
  const joinedTrash = p.trash.filter(function (c) { return !has(before.trashCards, c); });

  const discarded = joinedTrash.filter(function (c) {
    return has(leftHand, c) && c !== eventCard;
  });
  const board = before.boardCards || [];
  // 場から離れてトラッシュへ置かれたカード（倒された怪異や、外れたグッズ）
  const leftBoard = joinedTrash.filter(function (c) {
    return !has(leftHand, c) && c !== eventCard && has(board, c);
  });
  const deckToTrash = joinedTrash.filter(function (c) {
    return !has(leftHand, c) && c !== eventCard && !has(board, c);
  });
  const usedEvent = (eventCard && has(joinedTrash, eventCard)) ? [eventCard] : [];

  if (!discarded.length && !deckToTrash.length && !joinedHand.length &&
      !leftBoard.length && !usedEvent.length) {
    done(); return;
  }

  // 演出のあいだ、手札は「変わる前の状態」を映しておく
  if (isMine) {
    play.handSnapshot = before.handCards.slice();
    refreshHandOnly();
  }

  const deckEl = deckElFor(side);
  const trashEl = trashElFor(side);
  const items = [];

  // 1. 手札から捨てたカード（表向きでトラッシュへ）
  discarded.forEach(function (inst) {
    items.push({
      from: function () { return handCardPoint(side, inst); },
      to: trashEl,
      kind: 'handTrash',
      onDepart: function () {
        if (!isMine || !play.handSnapshot) return;
        const i = play.handSnapshot.indexOf(inst);
        if (i !== -1) { play.handSnapshot.splice(i, 1); refreshHandOnly(); }
      },
    });
  });

  // 2. 山札からトラッシュへ置かれたカード（表向き）
  deckToTrash.forEach(function (inst) {
    items.push({ from: deckEl, to: trashEl, kind: 'deckTrash' });
  });

  // 3. 手札に加わったカード（山札からは裏向き、トラッシュからは表向き）
  joinedHand.forEach(function (inst) {
    const fromTrash = has(before.trashCards, inst);
    items.push({
      from: fromTrash ? trashEl : deckEl,
      to: function () { return handRightPointFor(side); },
      kind: 'toHand',
      onArrive: function () {
        if (!isMine || !play.handSnapshot) return;
        play.handSnapshot.push(inst);
        refreshHandOnly();
        flashNewHandCard(inst);
      },
    });
  });

  // 4. 倒れてトラッシュへ置かれたカードと、使い終わったイベント。
  //    どちらもトラッシュの少し上から、小さな光がすとんと落ちる。
  leftBoard.concat(usedEvent).forEach(function () {
    items.push({
      from: function () {
        const r = designRect(trashEl);
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 - 150 };
      },
      to: trashEl,
      kind: 'dropToTrash',
    });
  });

  flyCardSequence(items, function () {
    play.handSnapshot = null;
    done();
  });
}

/** 演出の前に控えておく枚数 */
/** 場に出ているカード（装備中のグッズも含む） */
function boardCardsOf(p) {
  const list = [];
  p.humans.concat(p.youkai).forEach(function (c) {
    list.push(c);
    if (c.equippedGoods) list.push(c.equippedGoods);
  });
  return list;
}

function snapshotZones(side) {
  const p = Game.state.players[side];
  return {
    hand: p.hand.length,
    handCards: p.hand.slice(),     // 演出中に映しておく手札
    deck: p.deck.length,
    trash: p.trash.length,
    trashCards: p.trash.slice(),
    boardCards: boardCardsOf(p),   // 倒れてトラッシュへ行くカードを見分けるため
  };
}

/* 公開領域（トラッシュ・ロスト）の枚数を条件にするカード。
   詳細表示のときに、いまどれくらい満たしているかを出します。 */
const ZONE_CONDITIONS = {
  village_rin:     { zone: 'trash', trait: '村',   min: 5 },   // 【登場時】の条件
  village_nushi:   { zone: 'trash', trait: '村',   min: 10 },  // 【常在】の条件
  village_ofuda:   { zone: 'trash', trait: null,   min: 10 },  // 追加のスピード補正
  mansion_chimera: { zone: 'lost',  trait: '洋館', min: 3 },   // 【常在】の条件
  mansion_ring:    { zone: 'lost',  trait: null,   min: 3 },   // 追加のスピード補正
};

/** 条件の充足状況。条件を持たないカードやゲーム外では null を返す */
function zoneConditionStatus(cardId, owner) {
  const cond = ZONE_CONDITIONS[cardId];
  if (!cond || !play.active || !Game.state) return null;

  const p = Game.state.players[owner || bottomSide()];
  if (!p) return null;

  const list = (cond.zone === 'trash') ? p.trash : p.lost;
  const count = cond.trait
    ? list.filter(function (c) {
        return (c.master.traits || []).indexOf(cond.trait) !== -1;
      }).length
    : list.length;

  const zoneName = (cond.zone === 'trash') ? 'トラッシュ' : 'ロスト';
  const what = cond.trait ? ('の〈' + cond.trait + '〉カード') : 'の合計';
  const met = (count >= cond.min);

  return {
    text: '自分の' + zoneName + what + '：' + count + ' / ' + cond.min + '枚' +
          (met ? '（条件を満たしています）' : ''),
    met: met,
  };
}

/** 詳細表示に、条件の充足状況の行を足す */
function appendConditionLine(parent, spec, className) {
  const status = zoneConditionStatus(spec.cardId, spec.owner);
  if (!status) return;
  const el = document.createElement('div');
  el.className = className + (status.met ? ' is-met' : '');
  el.textContent = status.text;
  parent.appendChild(el);
}

/* ---------------------------------------------------------------------
   画面が拡大されてしまうのを防ぐ
   ---------------------------------------------------------------------
   スマホの標準動作（素早い2回タップ、二本指の広げ操作）で画面が拡大され、
   そのまま戻らなくなることがあるため、まとめて止めます。
   ボタンや入力欄の上では止めないので、押したり入力したりはできます。
   --------------------------------------------------------------------- */
function blockZoomGestures() {
  function isControl(target) {
    return target && target.closest && target.closest('button, input, textarea, select');
  }

  // 素早い2回タップ
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 320 && !isControl(e.target)) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

  // 二本指の広げ操作（iOS）
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
  });
}

/* =====================================================================
   ログ・トラッシュ・設定の画面
   ===================================================================== */

/** 共通の画面を開く。build は中身を組み立てる処理 */
function openSheet(title, build) {
  const box = document.getElementById('sheet');
  box.querySelector('.sheet__title').textContent = title;
  const body = box.querySelector('.sheet__body');
  body.innerHTML = '';
  build(body);
  box.classList.add('is-open');
}

function closeSheet() {
  const box = document.getElementById('sheet');
  box.classList.remove('is-open');
  box.querySelector('.sheet__body').innerHTML = '';
}

/** ログ画面 */
function openLog() {
  openSheet('ログ', function (body) {
    const log = (play.active && Game.state) ? Game.state.log : [];
    if (!log.length) {
      const empty = document.createElement('div');
      empty.className = 'log__empty';
      empty.textContent = 'まだ記録がありません。';
      body.appendChild(empty);
      return;
    }
    log.forEach(function (line) {
      const el = document.createElement('div');
      el.className = 'log__line';
      el.textContent = line;
      body.appendChild(el);
    });
    // 最新の行が見えるように下まで送る
    setTimeout(function () { body.scrollTop = body.scrollHeight; }, 0);
  });
}

/** トラッシュの中身を見る画面（両者とも公開領域） */
function openTrash(side) {
  const label = DECKS[side] ? DECKS[side].label : '';
  openSheet(label + ' のトラッシュ', function (body) {
    const list = (play.active && Game.state) ? Game.state.players[side].trash : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'log__empty';
      empty.textContent = 'トラッシュにカードはありません。';
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'trash__grid';
    // 新しく置かれたものが上に来るように、後ろから並べる
    list.slice().reverse().forEach(function (inst) {
      const el = document.createElement('div');
      el.className = 'trash__card';
      const path = getCardImagePath(inst.cardId, inst.owner);
      if (path) el.style.backgroundImage = 'url("' + path + '")';
      attachPointer(el, {
        onTap: function () { openZoomDetail(instToSpec(inst)); },
        onLongPress: function () { openZoomDetail(instToSpec(inst)); },
      });
      grid.appendChild(el);
    });
    body.appendChild(grid);
  });
}

/** 設定画面（いま用意できる項目だけ） */
function openSettings() {
  openSheet('設定', function (body) {
    // 1. 演出の速さ
    const row1 = document.createElement('div');
    row1.className = 'set__row';
    row1.innerHTML = '<div class="set__label">演出の速さ</div>' +
                     '<div class="set__note">カードの移動や文字表示の速さを変えます。</div>';
    const choices = document.createElement('div');
    choices.className = 'set__choices';
    [['ゆっくり', 1.4], ['標準', 1], ['速い', 0.7], ['とても速い', 0.5]].forEach(function (pair) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set__choice' + (speedScale === pair[1] ? ' is-on' : '');
      btn.textContent = pair[0];
      btn.addEventListener('click', function () {
        speedScale = pair[1];
        choices.querySelectorAll('.set__choice').forEach(function (b) {
          b.classList.remove('is-on');
        });
        btn.classList.add('is-on');
      });
      choices.appendChild(btn);
    });
    row1.appendChild(choices);
    body.appendChild(row1);

    // 2. 左右のレーンの入れ替え
    const rowLane = document.createElement('div');
    rowLane.className = 'set__row';
    rowLane.innerHTML = '<div class="set__label">左右の配置</div>' +
                        '<div class="set__note">盤面の左右を入れ替えます。' +
                        '利き手に合わせて選んでください。</div>';
    const laneChoices = document.createElement('div');
    laneChoices.className = 'set__choices';
    [['標準', false], ['左右を反転', true]].forEach(function (pair) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set__choice' + (mirrorLanes === pair[1] ? ' is-on' : '');
      btn.textContent = pair[0];
      btn.addEventListener('click', function () {
        mirrorLanes = pair[1];
        laneChoices.querySelectorAll('.set__choice').forEach(function (b) {
          b.classList.remove('is-on');
        });
        btn.classList.add('is-on');
        applyMirrorLanes();
      });
      laneChoices.appendChild(btn);
    });
    rowLane.appendChild(laneChoices);
    body.appendChild(rowLane);

    // 3. カードの裏面（画像が未提供のあいだは案内だけ）
    const row2 = document.createElement('div');
    row2.className = 'set__row';
    row2.innerHTML = '<div class="set__label">今の対戦</div>' +
                     '<div class="set__note">シード：' +
                     ((play.active && Game.state) ? Game.state.seed : '—') +
                     '<br>同じシードなら同じ順番で山札が並びます。</div>';
    body.appendChild(row2);

    // 3. はじめから
    const row3 = document.createElement('div');
    row3.className = 'set__row';
    row3.innerHTML = '<div class="set__label">はじめから</div>' +
                     '<div class="set__note">シードを入れると、その並びで始められます。' +
                     '空欄なら毎回ちがう並びになります。</div>';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'set__seed';
    input.placeholder = 'シード（空欄でおまかせ）';
    row3.appendChild(input);

    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'set__choice';
    restart.style.marginTop = '14px';
    restart.textContent = 'この設定ではじめから';
    restart.addEventListener('click', function () {
      showDialog({
        title: 'はじめから',
        message: 'いまの対戦をやめて、最初からやり直しますか？',
        buttons: [
          { label: '戻る' },
          {
            label: 'はじめから', primary: true,
            onClick: function () {
              closeSheet();
              startGame(startFirstSide, input.value.trim());
            },
          },
        ],
      });
    });
    row3.appendChild(restart);
    body.appendChild(row3);
  });
}

/** ボタン14の文字を、いまの状況に合わせて変える */
function updateMainButton() {
  const label = document.querySelector('#btn-main span');
  if (!label) return;

  if (play.mode === 'mulligan') {
    const n = play.mulliganSelected.length;
    label.textContent = (n === 0) ? '交換しない' : ('交換を確定 ' + n + '枚');
    return;
  }
  label.textContent = view.candidate ? '追跡を確定' : 'ターン終了';
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
  if (play.active) syncFromGame();
  renderBoard();
  applyFieldImages();
  renderStatus();
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

  // ゲーム中は本物の状態が優先されるので、見本用の枚数変更は効かない
  function sampleOnly(fn) {
    return function (v) {
      if (play.active) return;
      fn(v);
      renderBoard();
    };
  }
  bindRange('c-self-youkai', sampleOnly(function (v) { resizeList(view.selfYoukai, v, SAMPLE.selfYoukai); }));
  bindRange('c-self-human',  sampleOnly(function (v) { resizeList(view.selfHuman,  v, SAMPLE.selfHuman); }));
  bindRange('c-opp-youkai',  sampleOnly(function (v) { resizeList(view.oppYoukai,  v, SAMPLE.oppYoukai); }));
  bindRange('c-opp-human',   sampleOnly(function (v) { resizeList(view.oppHuman,   v, SAMPLE.oppHuman); }));

  bindCheck('t-self', function (b) { if (play.active) return; setTracking('self', b); syncPanel(); renderBoard(); });
  bindCheck('t-opp',  function (b) { if (play.active) return; setTracking('opp', b);  syncPanel(); renderBoard(); });

  bindRange('c-hand', function (v) {
    if (play.active) return;
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

  bindCheck('show-guides', function (b) {
    document.body.classList.toggle('show-guides', b);
  });
}

/* =====================================================================
   起動
   ===================================================================== */
function init() {
  blockZoomGestures();   // スマホで画面が拡大されないようにする
  setupStartScreen();
  document.body.classList.toggle('mirror-lanes', mirrorLanes);
  fitStage();
  setupPanel();
  renderAll();
  syncPanel();

  // 簡略手札をタップすると拡大表示に切り替わる（仕様書 13.1）
  // 簡略表示の間は、個別選択・詳細・ドラッグはできない
  attachPointer(document.getElementById('self-hand-mini'), {
    onTap: function () {
      if (view.locked) return;
      view.handExpanded = true;
      document.getElementById('hand-expanded').checked = true;
      renderFan();
    },
  });

  // ターン終了ボタン。追跡候補があるときは「追跡を確定」として働く
  attachPointer(document.getElementById('btn-main'), {
    onTap: onMainButton,
  });

  // ログ・トラッシュ・設定（演出中でも中身を見るだけなので開ける）
  attachPointer(document.getElementById('btn-log'), { onTap: openLog });
  attachPointer(document.getElementById('btn-settings'), { onTap: openSettings });
  attachPointer(document.getElementById('btn-self-trash'), {
    onTap: function () { openTrash(bottomSide()); },
  });
  attachPointer(document.getElementById('btn-opp-trash'), {
    onTap: function () { openTrash(topSide()); },
  });
  document.getElementById('sheet-close').addEventListener('click', closeSheet);

  // はじめからやり直すボタン（調整パネル）
  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', function () {
      const seed = (document.getElementById('panel-seed-input') || {}).value || '';
      startGame(startFirstSide, seed);
    });
  }

  // 襲撃の演出を確認するボタン（調整パネル）
  const attackBtn = document.getElementById('btn-attack-demo');
  if (attackBtn) attackBtn.addEventListener('click', playAttackEffect);

  // フィールドカードもタップで詳細、長押しで拡大詳細を出せるようにする。
  // どちらの陣営のカードかは盤面の向きで変わるので、押されたときに読み直す。
  // （決め打ちにすると、上下が入れ替わったときに相手のカードの詳細が出てしまう）
  [['.field-box--self', 'self'], ['.field-box--opp', 'opp']].forEach(function (item) {
    const box = document.querySelector(item[0]);
    if (!box) return;
    const which = item[1];
    const valueEl = box.querySelector('.field-box__value');

    attachCardInput(box, {
      get cardId() { return fieldSpecFor(which).cardId; },
      get owner() { return fieldSpecFor(which).owner; },
      get inst() { return fieldSpecFor(which).inst; },
      get lostText() { return valueEl ? valueEl.textContent : ''; },
    }, 'board');
  });

  // 空白をタップすると拡大手札とクイック詳細を閉じる（仕様書 13.3）
  // カード・各ボタン・詳細表示の上は「空白」とみなさない
  document.getElementById('stage').addEventListener('pointerup', function (e) {
    // カード・ボタン・詳細・ドロップ先・各種画面の上は「空白」とみなさない（仕様書 13.3）
    if (e.target.closest('.card, .ui-box, #event-drop, #quick-detail, #zoom-detail, ' +
                         '#dialog, #picker, #target-hint, #banner, #sheet, ' +
                         '#start-screen, #result-screen')) return;
    closeQuickDetail();
    if (view.candidate) setCandidate(null, null);   // 追跡候補も解除する
    // マリガン中は手札を必ず開いたままにする（交換するカードを選ぶため）
    if (play.mode === 'mulligan') return;
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

  // まずは対戦開始前の設定画面を出す（先攻とシードを選んでもらう）
  openStartScreen();
}

document.addEventListener('DOMContentLoaded', init);
