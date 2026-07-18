/* =====================================================================
   ui.js  ―  画面の描画と入力（Stage 2）
   ---------------------------------------------------------------------
   役割:
     ・ゲーム状態（Game.state）を読んで盤面・手札を描画する
     ・開始画面 → マリガン → 先攻1ターン目案内 の流れを進める
     ・タップ／長押し・クイック詳細・拡大詳細・案内・確認ダイアログ・ログ表示
     ・縦向き固定（横向き警告）

   ルール処理そのものは game.js が担当し、ここでは呼び出して結果を描画します。

   Stage 2 の終わり:
     「先攻1ターン目の案内」を表示するところまで。
     案内タップ後のターン開始処理（気力回復・ドロー・メイン）は Stage 3。
   ===================================================================== */

'use strict';

/* =====================================================================
   画面の状態（UIモード）
   ===================================================================== */
let UI_MODE = 'start';           // 'start' / 'mulligan' / 'board'
let bottomSide = null;           // 下側（操作中）に表示している陣営
let mulliganSide = null;         // いまマリガン中の陣営
let mulliganSelected = new Set();// マリガンで選択中のカード uid
let chosenFirst = 'village';     // 開始画面で選んだ先攻

/* =====================================================================
   表示用ステータス（Stage2は補正なしなので基礎値と同じ）
   ===================================================================== */
function getDisplayStats(inst) {
  const m = inst.master;
  const baseSpeed = (typeof m.speed === 'number') ? m.speed : null;
  const baseHp = (typeof m.hp === 'number') ? m.hp : null;
  return {
    hasStats: baseSpeed !== null && baseHp !== null,
    baseSpeed: baseSpeed,
    baseHp: baseHp,
    curSpeed: baseSpeed,
    maxHp: baseHp,
    curHp: baseHp,
    accum: inst.accumulatedDamage,
    corrections: [],
    equip: inst.equippedGoods,
    tracking: inst.tracking,
  };
}

const TYPE_LABEL = {
  human: '人間', youkai: '怪異', goods: 'グッズ', event: 'イベント', field: 'フィールド',
};

/* =====================================================================
   カード1枚のDOMを作る（前列 front / 後列 back / 手札 hand）
   ===================================================================== */
function createCardElement(inst, variant) {
  const m = inst.master;
  const stats = getDisplayStats(inst);

  const el = document.createElement('div');
  el.className =
    'card card--' + variant + ' card--type-' + m.type + ' card--owner-' + inst.owner;
  el.dataset.uid = String(inst.uid);

  if (typeof m.cost === 'number') {
    const cost = document.createElement('div');
    cost.className = 'card__cost';
    cost.textContent = String(m.cost);
    el.appendChild(cost);
  }

  const type = document.createElement('div');
  type.className = 'card__type';
  type.textContent = TYPE_LABEL[m.type] || m.type;
  el.appendChild(type);

  const name = document.createElement('div');
  name.className = 'card__name';
  name.textContent = m.name;
  el.appendChild(name);

  if (stats.hasStats) {
    const statsRow = document.createElement('div');
    statsRow.className = 'card__stats';
    const spd = document.createElement('span');
    spd.className = 'card__spd';
    spd.textContent = 'ス' + stats.curSpeed;
    statsRow.appendChild(spd);
    const hp = document.createElement('span');
    hp.className = 'card__hp';
    hp.textContent = '体' + stats.curHp;
    statsRow.appendChild(hp);
    el.appendChild(statsRow);
  }

  // マリガンで選択中のカードは枠を強調する
  if (variant === 'hand' && mulliganSelected.has(inst.uid)) {
    el.classList.add('is-selected');
  }

  attachCardInput(el, inst, variant);
  return el;
}

/* =====================================================================
   DOM のキャッシュ
   ===================================================================== */
const dom = {};

function cacheDom() {
  // 開始画面
  dom.startScreen = document.getElementById('start-screen');
  dom.seedInput = document.getElementById('seed-input');
  dom.startBtn = document.getElementById('start-btn');
  dom.choiceBtns = Array.prototype.slice.call(document.querySelectorAll('.choice'));

  // ゲーム枠
  dom.gameFrame = document.getElementById('game-frame');
  dom.seedDisplay = document.getElementById('seed-display');
  dom.logBtn = document.getElementById('log-btn');

  // 洋館（上）
  dom.oppHeader = document.getElementById('opp-header');
  dom.oppStatus = document.getElementById('opp-status');
  dom.oppTrackYoukai = document.getElementById('opp-track-youkai');
  dom.oppField = document.getElementById('opp-field');
  dom.oppTrackHuman = document.getElementById('opp-track-human');
  dom.oppBackYoukai = document.getElementById('opp-back-youkai');
  dom.oppBackHuman = document.getElementById('opp-back-human');

  // 村（下）
  dom.selfTrackYoukai = document.getElementById('self-track-youkai');
  dom.selfField = document.getElementById('self-field');
  dom.selfTrackHuman = document.getElementById('self-track-human');
  dom.selfBackYoukai = document.getElementById('self-back-youkai');
  dom.selfBackHuman = document.getElementById('self-back-human');

  // 操作中ヘッダー（独立領域）
  dom.selfHeader = document.getElementById('self-header');
  dom.selfHeaderLabel = document.getElementById('self-header-label');
  dom.selfStatus = document.getElementById('self-status');

  // 手札・マリガンバー
  dom.hand = document.getElementById('hand');
  dom.mulliganBar = document.getElementById('mulligan-bar');
  dom.mulliganConfirm = document.getElementById('mulligan-confirm');

  // 盤面・重ね表示
  dom.board = document.getElementById('board');
  dom.quickDetail = document.getElementById('quick-detail');
  dom.expandedDetail = document.getElementById('expanded-detail');
  dom.guideOverlay = document.getElementById('guide-overlay');
  dom.modal = document.getElementById('modal');
  dom.logPanel = document.getElementById('log-panel');
  dom.orientationWarning = document.getElementById('orientation-warning');
}

/* =====================================================================
   盤面の描画（ゲーム状態から）
   ===================================================================== */

/** ステータス枠（山札・気力・ロスト・トラッシュ） */
function renderStatus(container, player) {
  // Stage2 では 気力 はまだ処理しないので「--」。他は実際の枚数を表示する。
  const items = [
    ['山札', String(player.deck.length)],
    ['気力', '--'],
    ['ロスト', String(player.lost.length)],
    ['トラッシュ', String(player.trash.length)],
  ];
  container.innerHTML = '';
  items.forEach(function (pair) {
    const stat = document.createElement('span');
    stat.className = 'stat';
    const k = document.createElement('span');
    k.className = 'stat__k';
    k.textContent = pair[0];
    const v = document.createElement('span');
    v.className = 'stat__v';
    v.textContent = pair[1];
    stat.appendChild(k);
    stat.appendChild(v);
    container.appendChild(stat);
  });
}

function fillZone(container, instances, variant) {
  container.innerHTML = '';
  instances.forEach(function (inst) {
    if (inst) container.appendChild(createCardElement(inst, variant));
  });
}

/** 片方の陣営（前列・後列）を描画 */
function renderSide(player, slots) {
  const trackYoukai = player.youkai.filter(function (c) { return c && c.tracking; });
  const trackHuman = player.humans.filter(function (c) { return c && c.tracking; });
  const backYoukai = player.youkai.filter(function (c) { return c && !c.tracking; });
  const backHuman = player.humans.filter(function (c) { return c && !c.tracking; });

  fillZone(slots.trackYoukai, trackYoukai.slice(0, 1), 'front');
  fillZone(slots.field, [player.field], 'front');
  fillZone(slots.trackHuman, trackHuman.slice(0, 1), 'front');

  fillZone(slots.backYoukai, backYoukai.slice(0, 3), 'back');
  fillZone(slots.backHuman, backHuman.slice(0, 3), 'back');
}

/** 盤面全体を描画（bottomSide が下側＝操作中） */
function renderBoard() {
  const st = Game.state;
  const oppSide = Game.otherSide(bottomSide);
  const self = st.players[bottomSide];
  const opp = st.players[oppSide];

  // 上側（待機中）
  dom.oppHeader.textContent = DECKS[oppSide].label + '｜待機中';
  renderStatus(dom.oppStatus, opp);
  renderSide(opp, {
    trackYoukai: dom.oppTrackYoukai, field: dom.oppField, trackHuman: dom.oppTrackHuman,
    backYoukai: dom.oppBackYoukai, backHuman: dom.oppBackHuman,
  });

  // 下側（操作中）。ヘッダーは独立領域＋陣営色。
  dom.selfHeaderLabel.textContent = DECKS[bottomSide].label + '｜操作中';
  dom.selfHeader.className = 'op-header op-header--' + bottomSide;
  renderStatus(dom.selfStatus, self);
  renderSide(self, {
    trackYoukai: dom.selfTrackYoukai, field: dom.selfField, trackHuman: dom.selfTrackHuman,
    backYoukai: dom.selfBackYoukai, backHuman: dom.selfBackHuman,
  });

  // 手札（下側プレイヤーのもの）
  fillZone(dom.hand, self.hand, 'hand');
}

/** シード表示＋盤面描画 */
function renderScreen() {
  dom.seedDisplay.textContent = 'シード：' + Game.state.seed;
  renderBoard();
}

/* =====================================================================
   クイック詳細（左上）／拡大詳細（中央）
   ===================================================================== */
let quickDetailUid = null;

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail__row';
  const l = document.createElement('span');
  l.className = 'detail__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'detail__value';
  v.textContent = value;
  row.appendChild(l); row.appendChild(v);
  return row;
}

function detailBlock(label, text) {
  const block = document.createElement('div');
  block.className = 'detail__block';
  const l = document.createElement('div');
  l.className = 'detail__label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'detail__text';
  v.textContent = text;
  v.style.whiteSpace = 'pre-wrap';
  block.appendChild(l); block.appendChild(v);
  return block;
}

function fillDetailBody(container, inst) {
  const m = inst.master;
  const stats = getDisplayStats(inst);
  container.appendChild(detailRow('コスト', (typeof m.cost === 'number') ? String(m.cost) : '―'));
  container.appendChild(detailRow('種類', TYPE_LABEL[m.type] || m.type));
  container.appendChild(detailRow('特徴', (m.traits && m.traits.length) ? m.traits.map(function (t) { return '〈' + t + '〉'; }).join(' ') : 'なし'));
  if (stats.hasStats) {
    container.appendChild(detailRow('基礎スピード／体力', stats.baseSpeed + '／' + stats.baseHp));
    container.appendChild(detailRow('現在スピード', String(stats.curSpeed)));
    container.appendChild(detailRow('現在体力／最大体力', stats.curHp + '／' + stats.maxHp));
    container.appendChild(detailRow('蓄積ダメージ', String(stats.accum)));
    container.appendChild(detailRow('補正内訳', stats.corrections.length ? stats.corrections.join('、') : 'なし'));
    container.appendChild(detailRow('装備グッズ', stats.equip ? stats.equip.master.name : 'なし'));
    container.appendChild(detailRow('追跡状態', stats.tracking ? '追跡中' : 'なし'));
  }
  if (m.type === 'goods' && m.equipTo) container.appendChild(detailRow('装備対象', m.equipTo));
  if (m.type === 'field' && typeof m.lostLimit === 'number') container.appendChild(detailRow('ロスト上限', String(m.lostLimit)));
  container.appendChild(detailBlock('効果', m.effect || '効果なし'));
}

function openQuickDetail(inst, isHandCard) {
  const m = inst.master;
  quickDetailUid = inst.uid;
  const panel = dom.quickDetail;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'detail__title';
  title.textContent = m.name;
  panel.appendChild(title);
  fillDetailBody(panel, inst);
  // 手札の「登場／使用」ボタン位置（Stage2でもまだ動作しない＝Stage4）
  if (isHandCard) {
    const actionLabel = (m.type === 'human' || m.type === 'youkai') ? '登場' : '使用';
    const btn = document.createElement('div');
    btn.className = 'detail__action detail__action--disabled';
    btn.textContent = actionLabel + '（Stage4以降で有効化）';
    panel.appendChild(btn);
  }
  panel.classList.add('is-open');
}

function closeQuickDetail() {
  quickDetailUid = null;
  dom.quickDetail.classList.remove('is-open');
  dom.quickDetail.innerHTML = '';
}

function openExpandedDetail(inst) {
  closeQuickDetail();
  const m = inst.master;
  const overlay = dom.expandedDetail;
  overlay.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'expanded__box card--owner-' + inst.owner;
  const title = document.createElement('div');
  title.className = 'expanded__title';
  title.textContent = m.name;
  box.appendChild(title);
  const body = document.createElement('div');
  body.className = 'expanded__body';
  fillDetailBody(body, inst);
  box.appendChild(body);
  const close = document.createElement('button');
  close.className = 'expanded__close';
  close.textContent = '閉じる';
  close.addEventListener('click', function (e) { e.stopPropagation(); closeExpandedDetail(); });
  box.appendChild(close);
  overlay.appendChild(box);
  overlay.classList.add('is-open');
  overlay.onclick = function () { /* 画面外タップでは閉じない */ };
}

function closeExpandedDetail() {
  dom.expandedDetail.classList.remove('is-open');
  dom.expandedDetail.innerHTML = '';
  dom.expandedDetail.onclick = null;
}

/* =====================================================================
   カードへの入力（短いタップ／長押し）
   ---------------------------------------------------------------------
   ・マリガン中の手札 … 短いタップ＝選択／解除、長押し＝拡大詳細（クイック詳細なし）
   ・それ以外           … 短いタップ＝クイック詳細、長押し＝拡大詳細
   ===================================================================== */
const LONG_PRESS_MS = 1000;
const MOVE_CANCEL_PX = 10;

function attachCardInput(el, inst, variant) {
  const isHandCard = (variant === 'hand');
  let pressTimer = null, startX = 0, startY = 0, moved = false, longFired = false;

  function clearTimer() { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } }

  el.addEventListener('pointerdown', function (e) {
    // 何かのオーバーレイが開いている間は盤面操作を止める
    if (isAnyOverlayOpen()) return;
    moved = false; longFired = false;
    startX = e.clientX; startY = e.clientY;
    clearTimer();
    pressTimer = setTimeout(function () {
      if (!moved) { longFired = true; openExpandedDetail(inst); }
    }, LONG_PRESS_MS);
  });

  el.addEventListener('pointermove', function (e) {
    if (pressTimer === null) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
      moved = true; clearTimer();
    }
  });

  el.addEventListener('pointerup', function () {
    clearTimer();
    if (longFired) return;
    if (moved) return;
    // 短いタップの処理
    if (UI_MODE === 'mulligan' && isHandCard) {
      toggleMulliganSelect(inst, el); // マリガン中の手札は選択トグル
    } else {
      openQuickDetail(inst, isHandCard);
    }
  });

  el.addEventListener('pointercancel', clearTimer);
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}

/** 何らかの重ね表示（拡大詳細・案内・確認・ログ）が開いているか */
function isAnyOverlayOpen() {
  return dom.expandedDetail.classList.contains('is-open') ||
    dom.guideOverlay.classList.contains('is-open') ||
    dom.modal.classList.contains('is-open') ||
    dom.logPanel.classList.contains('is-open');
}

/* 盤面の空白タップでクイック詳細を閉じる */
function setupBlankTapToClose() {
  dom.board.addEventListener('pointerup', function (e) {
    if (isAnyOverlayOpen()) return;
    if (e.target.closest('.card')) return;
    if (quickDetailUid !== null) closeQuickDetail();
  });
}

/* =====================================================================
   案内オーバーレイ（タップで進む）
   ===================================================================== */
function showGuide(lines, onProceed) {
  const ov = dom.guideOverlay;
  ov.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'guide__box';
  lines.forEach(function (ln, i) {
    const p = document.createElement('div');
    p.className = (i === lines.length - 1) ? 'guide__tap' : 'guide__line';
    p.textContent = ln;
    box.appendChild(p);
  });
  ov.appendChild(box);
  ov.classList.add('is-open');
  ov.onclick = function () {
    ov.classList.remove('is-open');
    ov.innerHTML = '';
    ov.onclick = null;
    if (onProceed) onProceed();
  };
}

/* =====================================================================
   確認ダイアログ（ボタンでのみ閉じる）
   ===================================================================== */
function showModal(lines, buttons) {
  const ov = dom.modal;
  ov.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal__box';
  lines.forEach(function (ln) {
    const p = document.createElement('div');
    p.className = 'modal__line';
    p.textContent = ln;
    box.appendChild(p);
  });
  const row = document.createElement('div');
  row.className = 'modal__buttons';
  buttons.forEach(function (b) {
    const btn = document.createElement('button');
    btn.className = 'modal__btn';
    btn.textContent = b.label;
    btn.addEventListener('click', function (e) { e.stopPropagation(); b.onClick(); });
    row.appendChild(btn);
  });
  box.appendChild(row);
  ov.appendChild(box);
  ov.classList.add('is-open');
}
function closeModal() {
  dom.modal.classList.remove('is-open');
  dom.modal.innerHTML = '';
}

/* =====================================================================
   ログ表示
   ===================================================================== */
function openLog() {
  const ov = dom.logPanel;
  ov.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'log__box';
  const title = document.createElement('div');
  title.className = 'log__title';
  title.textContent = 'ログ';
  box.appendChild(title);
  const list = document.createElement('div');
  list.className = 'log__list';
  (Game.state ? Game.state.log : []).forEach(function (line) {
    const row = document.createElement('div');
    row.className = 'log__row';
    row.textContent = line;
    list.appendChild(row);
  });
  box.appendChild(list);
  const close = document.createElement('button');
  close.className = 'log__close';
  close.textContent = '閉じる';
  close.addEventListener('click', function (e) { e.stopPropagation(); closeLog(); });
  box.appendChild(close);
  ov.appendChild(box);
  ov.classList.add('is-open');
  // 開いたら最新（下）へスクロール
  list.scrollTop = list.scrollHeight;
}
function closeLog() {
  dom.logPanel.classList.remove('is-open');
  dom.logPanel.innerHTML = '';
}

/* =====================================================================
   マリガンの進行
   ===================================================================== */

/** マリガン選択の切り替え（枠を強調。番号は付けない） */
function toggleMulliganSelect(inst, el) {
  if (mulliganSelected.has(inst.uid)) {
    mulliganSelected.delete(inst.uid);
    el.classList.remove('is-selected');
  } else {
    mulliganSelected.add(inst.uid);
    el.classList.add('is-selected');
  }
}

function showMulliganBar() { dom.mulliganBar.hidden = false; }
function hideMulliganBar() { dom.mulliganBar.hidden = true; }

/** 指定した陣営のマリガンを始める */
function beginMulligan(side) {
  mulliganSide = side;
  bottomSide = side;
  mulliganSelected.clear();
  UI_MODE = 'mulligan';
  hideMulliganBar();
  renderScreen();

  const label = DECKS[side].label;
  showGuide(
    [label + 'のマリガン', label + '側を操作してください', 'タップして開始'],
    function () { showMulliganBar(); } // 案内を閉じたら選択開始
  );
}

/** マリガン確定ボタン */
function onMulliganConfirm() {
  if (mulliganSelected.size === 0) {
    // 0枚のときは確認する（仕様書 8）
    showModal(
      ['交換するカードが選ばれていません。', '0枚のままマリガンを終了しますか？'],
      [
        { label: '0枚で確定', onClick: function () { closeModal(); doMulliganConfirm([]); } },
        { label: '選択に戻る', onClick: function () { closeModal(); } },
      ]
    );
  } else {
    // mulliganSelected は Set（重複しない入れ物）なので、
    // Array.from で配列に変換してから渡す。
    doMulliganConfirm(Array.from(mulliganSelected));
  }
}

function doMulliganConfirm(uids) {
  Game.confirmMulligan(mulliganSide, uids);
  mulliganSelected.clear();
  hideMulliganBar();

  const first = Game.state.firstSide;
  const second = Game.state.secondSide;

  if (mulliganSide === first) {
    // 先攻の確定後：手札を隠して後攻のマリガンへ
    beginMulligan(second);
  } else {
    // 後攻の確定後：先攻1ターン目の案内へ
    finishSetup();
  }
}

/** 先攻1ターン目の案内（Stage2 の終わり） */
function finishSetup() {
  const first = Game.state.firstSide;
  bottomSide = first;
  UI_MODE = 'board';
  hideMulliganBar();
  renderScreen();

  const label = DECKS[first].label;
  showGuide(
    [label + 'の先攻1ターン目', label + '側を操作してください', 'タップしてゲーム開始'],
    function () {
      // Stage2 はここまで。ターン開始処理（気力回復・ドロー・メイン）は Stage3 で実装。
      // 盤面（先攻の操作画面）を表示したままにする。
      UI_MODE = 'board';
      renderScreen();
    }
  );
}

/* =====================================================================
   開始画面
   ===================================================================== */
function setupStartScreen() {
  // 先攻の選択ボタン
  dom.choiceBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      chosenFirst = btn.dataset.side;
      dom.choiceBtns.forEach(function (b) { b.classList.remove('is-chosen'); });
      btn.classList.add('is-chosen');
    });
  });
  // 初期の先攻を村にしておく（見た目でも分かるように強調）
  dom.choiceBtns.forEach(function (b) {
    if (b.dataset.side === chosenFirst) b.classList.add('is-chosen');
  });

  dom.startBtn.addEventListener('click', onStart);
}

function onStart() {
  const seedVal = dom.seedInput.value;
  Game.start(chosenFirst, seedVal);

  // 画面を開始画面からゲーム画面へ切り替える
  dom.startScreen.hidden = true;
  dom.gameFrame.hidden = false;

  // 先攻のマリガンから開始
  beginMulligan(Game.state.firstSide);
}

/* =====================================================================
   縦向き固定（横向き警告）
   ===================================================================== */
function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}
function updateOrientation() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  if (isTouchDevice() && isLandscape) {
    dom.orientationWarning.classList.add('is-open');
  } else {
    dom.orientationWarning.classList.remove('is-open');
  }
}

/* =====================================================================
   起動
   ===================================================================== */
function init() {
  cacheDom();

  setupStartScreen();
  setupBlankTapToClose();
  dom.logBtn.addEventListener('click', openLog);
  dom.mulliganConfirm.addEventListener('click', onMulliganConfirm);

  // 全体で長押しメニューを抑制
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', updateOrientation);
}

document.addEventListener('DOMContentLoaded', init);
