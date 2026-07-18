/* =====================================================================
   ui.js  ―  画面の描画と入力（Stage 5）
   ---------------------------------------------------------------------
   役割:
     ・ゲーム状態（Game.state）を読んで盤面・手札を描画する
     ・開始画面 → マリガン → ターン進行（案内・メイン・ターン終了）を進める
     ・クイック詳細／拡大詳細／案内／確認ダイアログ／ログ／ロスト・トラッシュ閲覧
     ・縦向き固定（横向き警告）

   ルール処理そのものは game.js が担当し、ここでは呼び出して結果を描画します。

   Stage 5 で追加（仕様書 10・15・19・22・23・24）:
     ・追跡選択（自分の怪異＋相手の人間を選び「追跡を確定」）
     ・襲撃の演出（約0.5秒間隔・対象を強調・進行操作をロック）
     ・リザルト画面（勝敗理由・経過・シードコピー・再戦）
     ・ゲームを中断（確認あり）と、対戦中の離脱確認

   Stage 4 で追加（仕様書 11・12.2・12.4）:
     ・手札を短くタップ → クイック詳細＋カード本体に「登場／使用」ボタン
     ・登場（人間・怪異）／使用（グッズ・イベント）の操作
     ・グッズは対象候補を強調し、対象をタップした瞬間に確定
     ・使えないときはボタンを暗くし、押すと画面下部へ理由を表示
   ===================================================================== */

'use strict';

/* =====================================================================
   画面の状態（UIモード）
   ===================================================================== */
let UI_MODE = 'start';            // 'start' / 'mulligan' / 'board'
let bottomSide = null;            // 下側（操作中）に表示している陣営
let mulliganSide = null;          // いまマリガン中の陣営
let mulliganSelected = new Set(); // マリガンで選択中のカード uid
let chosenFirst = 'village';      // 開始画面で選んだ先攻
let selectedHandUid = null;       // 「登場／使用」ボタンを出している手札カード
let targetMode = null;            // グッズの対象選択中の情報 { goods, targets }
let trackSel = null;              // 追跡選択中の情報 { youkai, human }
let attackHighlight = [];         // 襲撃演出で光らせるカードの uid
let isBusy = false;               // 演出中：進行操作をロックする（仕様書 24）
let matchInProgress = false;      // 対戦中かどうか（離脱確認に使う）

/* =====================================================================
   表示用ステータス
   ---------------------------------------------------------------------
   能力値の計算そのものは game.js（ルール処理）に任せ、
   ここでは受け取った結果を表示に使うだけにしています。
   ===================================================================== */
function getDisplayStats(inst) {
  return Game.getStats(inst);
}

const TYPE_LABEL = {
  human: '人間', youkai: '怪異', goods: 'グッズ', event: 'イベント', field: 'フィールド',
};

/* =====================================================================
   カード1枚のDOMを作る
   variant: 'front'（前列） / 'back'（後列） / 'hand'（手札） / 'zone'（閲覧画面）
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

  // グッズの対象選択中：装備できるカードを強調する（仕様書 11.2）
  if (targetMode && targetMode.targets.indexOf(inst) !== -1) {
    el.classList.add('is-target');
  }

  // 追跡選択中：選べるカードと、選択済みのカードを強調する（仕様書 10.1）
  if (trackSel) {
    if (isTrackCandidate(inst)) el.classList.add('is-candidate');
    if (trackSel.youkai === inst || trackSel.human === inst) el.classList.add('is-track-sel');
  }

  // 襲撃の演出中：対象を強調する（仕様書 24）
  if (attackHighlight.indexOf(inst.uid) !== -1) {
    el.classList.add('is-attacking');
  }

  // 選んだ手札カードの本体に「登場／使用」ボタンを出す（仕様書 12.2）
  if (variant === 'hand' && selectedHandUid === inst.uid && canOperateHand()) {
    el.appendChild(createActionButton(inst));
  }

  attachCardInput(el, inst, variant);
  return el;
}

/** いま手札を操作できる状況か（自分のメイン中で、対象選択中でない） */
function canOperateHand() {
  const st = Game.state;
  return UI_MODE === 'board' && st && st.phase === 'main' &&
    targetMode === null && trackSel === null && !isBusy && !st.gameOver;
}

/**
 * 手札カードに付ける「登場／使用」ボタンを作る。
 * 使えない場合は暗く表示するが、タップは受け付けて理由を出す（仕様書 5・11.4）。
 */
function createActionButton(inst) {
  const m = inst.master;
  const isUnit = (m.type === 'human' || m.type === 'youkai');
  const check = Game.canPlay(bottomSide, inst);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card__action' + (check.ok ? '' : ' card__action--disabled');
  btn.textContent = isUnit ? '登場' : '使用';

  btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  btn.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    onActionButton(inst);
  });
  return btn;
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

  // ゲーム枠・上部バー
  dom.gameFrame = document.getElementById('game-frame');
  dom.turnDisplay = document.getElementById('turn-display');
  dom.seedDisplay = document.getElementById('seed-display');
  dom.logBtn = document.getElementById('log-btn');

  // 上側（待機中）
  dom.oppHeader = document.getElementById('opp-header');
  dom.oppStatus = document.getElementById('opp-status');
  dom.oppTrackYoukai = document.getElementById('opp-track-youkai');
  dom.oppField = document.getElementById('opp-field');
  dom.oppTrackHuman = document.getElementById('opp-track-human');
  dom.oppBackYoukai = document.getElementById('opp-back-youkai');
  dom.oppBackHuman = document.getElementById('opp-back-human');

  // 下側（操作中）
  dom.selfTrackYoukai = document.getElementById('self-track-youkai');
  dom.selfField = document.getElementById('self-field');
  dom.selfTrackHuman = document.getElementById('self-track-human');
  dom.selfBackYoukai = document.getElementById('self-back-youkai');
  dom.selfBackHuman = document.getElementById('self-back-human');

  // 操作中ヘッダー（独立領域）
  dom.selfHeader = document.getElementById('self-header');
  dom.selfHeaderLabel = document.getElementById('self-header-label');
  dom.selfStatus = document.getElementById('self-status');

  // 手札・操作バー
  dom.hand = document.getElementById('hand');
  dom.mulliganBar = document.getElementById('mulligan-bar');
  dom.mulliganConfirm = document.getElementById('mulligan-confirm');
  dom.actionBar = document.getElementById('action-bar');
  dom.actionHint = document.getElementById('action-hint');
  dom.actionBtn = document.getElementById('action-btn');
  dom.targetBar = document.getElementById('target-bar');
  dom.targetHint = document.getElementById('target-hint');
  dom.targetCancel = document.getElementById('target-cancel');
  dom.toast = document.getElementById('toast');
  dom.trackBar = document.getElementById('track-bar');
  dom.trackHint = document.getElementById('track-hint');
  dom.trackConfirm = document.getElementById('track-confirm');
  dom.trackSkip = document.getElementById('track-skip');
  dom.trackBack = document.getElementById('track-back');
  dom.quitBtn = document.getElementById('quit-btn');
  dom.result = document.getElementById('result');
  dom.banner = document.getElementById('banner');

  // 盤面・重ね表示
  dom.board = document.getElementById('board');
  dom.quickDetail = document.getElementById('quick-detail');
  dom.expandedDetail = document.getElementById('expanded-detail');
  dom.guideOverlay = document.getElementById('guide-overlay');
  dom.modal = document.getElementById('modal');
  dom.logPanel = document.getElementById('log-panel');
  dom.zoneViewer = document.getElementById('zone-viewer');
  dom.orientationWarning = document.getElementById('orientation-warning');
}

/* =====================================================================
   盤面の描画（ゲーム状態から）
   ===================================================================== */

/** ステータス枠（山札・気力・ロスト・トラッシュ）
    ロスト／トラッシュはタップで閲覧画面を開けるボタンにする（仕様書 21）*/
function renderStatus(container, player) {
  container.innerHTML = '';

  const items = [
    { key: '山札', value: String(player.deck.length), zone: null },
    { key: '気力', value: String(player.energy), zone: null },
    { key: 'ロスト', value: String(player.lost.length), zone: 'lost' },
    { key: 'トラッシュ', value: String(player.trash.length), zone: 'trash' },
  ];

  items.forEach(function (item) {
    const stat = document.createElement('span');
    stat.className = 'stat';
    const k = document.createElement('span');
    k.className = 'stat__k';
    k.textContent = item.key;
    const v = document.createElement('span');
    v.className = 'stat__v';
    v.textContent = item.value;
    stat.appendChild(k);
    stat.appendChild(v);

    // ロスト・トラッシュは押せるようにする
    if (item.zone) {
      stat.classList.add('stat--button');
      stat.addEventListener('click', function () {
        openZoneViewer(player, item.zone);
      });
    }
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

  dom.oppHeader.textContent = DECKS[oppSide].label + '｜待機中';
  renderStatus(dom.oppStatus, opp);
  renderSide(opp, {
    trackYoukai: dom.oppTrackYoukai, field: dom.oppField, trackHuman: dom.oppTrackHuman,
    backYoukai: dom.oppBackYoukai, backHuman: dom.oppBackHuman,
  });

  dom.selfHeaderLabel.textContent = DECKS[bottomSide].label + '｜操作中';
  dom.selfHeader.className = 'op-header op-header--' + bottomSide;
  renderStatus(dom.selfStatus, self);
  renderSide(self, {
    trackYoukai: dom.selfTrackYoukai, field: dom.selfField, trackHuman: dom.selfTrackHuman,
    backYoukai: dom.selfBackYoukai, backHuman: dom.selfBackHuman,
  });

  fillZone(dom.hand, self.hand, 'hand');
}

/** 手札だけを描き直す（ボタンの出し入れなど、軽い更新用） */
function renderHandOnly() {
  const self = Game.state.players[bottomSide];
  fillZone(dom.hand, self.hand, 'hand');
}

/** 上部バー（ターン表示・シード）＋盤面を描画 */
function renderScreen() {
  dom.turnDisplay.textContent = Game.getTurnHeaderText();
  dom.seedDisplay.textContent = 'シード：' + Game.state.seed;
  renderBoard();
}

/* =====================================================================
   詳細表示の共通部品
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

/* ---- クイック詳細（左上） ---- */
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
  // 「登場／使用」ボタンはカード本体に表示するため、ここには置きません（仕様書 12.2）
  panel.classList.add('is-open');
}

function closeQuickDetail() {
  quickDetailUid = null;
  dom.quickDetail.classList.remove('is-open');
  dom.quickDetail.innerHTML = '';
}

/* ---- 拡大詳細（中央） ---- */
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
   ロスト・トラッシュ閲覧（仕様書 21）
   ・古いカードが左、新しいカードが右
   ・短いタップ：閲覧画面の中にクイック詳細
   ・長押し：拡大詳細
   ・閲覧中はゲーム処理を止める（閉じると再開）
   ===================================================================== */
function openZoneViewer(player, zoneKey) {
  closeQuickDetail();   // 閲覧画面を開いたらクイック詳細は自動で閉じる（仕様書 12.2）
  const cards = (zoneKey === 'lost') ? player.lost : player.trash;
  const zoneName = (zoneKey === 'lost') ? 'ロスト' : 'トラッシュ';

  const ov = dom.zoneViewer;
  ov.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'viewer__box';

  const title = document.createElement('div');
  title.className = 'viewer__title';
  title.textContent = player.label + '｜' + zoneName + '（' + cards.length + '枚）';
  box.appendChild(title);

  // カード列（横スクロール。左が古い・右が新しい）
  const row = document.createElement('div');
  row.className = 'viewer__row';
  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'viewer__empty';
    empty.textContent = 'カードはありません';
    row.appendChild(empty);
  } else {
    cards.forEach(function (inst) {
      row.appendChild(createCardElement(inst, 'zone'));
    });
  }
  box.appendChild(row);

  // 閲覧画面の中のクイック詳細（短いタップで中身が入る）
  const detail = document.createElement('div');
  detail.className = 'viewer__detail';
  detail.id = 'viewer-detail';
  box.appendChild(detail);

  const close = document.createElement('button');
  close.className = 'viewer__close';
  close.textContent = '閉じる';
  close.addEventListener('click', function (e) { e.stopPropagation(); closeZoneViewer(); });
  box.appendChild(close);

  ov.appendChild(box);
  ov.classList.add('is-open');
}

function closeZoneViewer() {
  dom.zoneViewer.classList.remove('is-open');
  dom.zoneViewer.innerHTML = '';
}

/** 閲覧画面の中でカードを短くタップしたときの詳細表示 */
function showViewerDetail(inst) {
  const panel = document.getElementById('viewer-detail');
  if (!panel) return;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'detail__title';
  title.textContent = inst.master.name;
  panel.appendChild(title);
  fillDetailBody(panel, inst);
}

/* =====================================================================
   カードへの入力（短いタップ／長押し）
   ===================================================================== */
const LONG_PRESS_MS = 1000;
const MOVE_CANCEL_PX = 10;

/** その variant のカードが、いま操作を受け付けてよいか */
function isInputBlocked(variant) {
  // リザルト表示中は盤面を操作しない
  if (dom.result.classList.contains('is-open')) return true;
  // 拡大詳細・確認ダイアログ・案内・ログ が開いている間は、どのカードも操作しない
  if (dom.expandedDetail.classList.contains('is-open')) return true;
  if (dom.modal.classList.contains('is-open')) return true;
  if (dom.guideOverlay.classList.contains('is-open')) return true;
  if (dom.logPanel.classList.contains('is-open')) return true;
  // 閲覧画面が開いている間は、閲覧画面の中のカードだけ操作できる
  if (dom.zoneViewer.classList.contains('is-open')) return (variant !== 'zone');
  return false;
}

function attachCardInput(el, inst, variant) {
  const isHandCard = (variant === 'hand');
  let pressTimer = null, startX = 0, startY = 0, moved = false, longFired = false;

  function clearTimer() { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } }

  el.addEventListener('pointerdown', function (e) {
    if (isInputBlocked(variant)) return;
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
    if (variant === 'zone') {
      showViewerDetail(inst);                // 閲覧画面の中の詳細
      return;
    }
    if (UI_MODE === 'mulligan' && isHandCard) {
      toggleMulliganSelect(inst, el);        // マリガン中の手札は選択トグル
      return;
    }
    // 演出中は選択・使用の操作を受け付けない（詳細の確認は可能・仕様書 24）
    if (isBusy) { openQuickDetail(inst, false); return; }

    // 追跡選択中（仕様書 10.1・12.4：クイック詳細は出さない）
    if (trackSel) {
      if (isHandCard) return;                // 手札は反応させない
      toggleTrackSelect(inst);
      return;
    }
    // グッズの対象選択中（仕様書 12.4：クイック詳細は出さない）
    if (targetMode) {
      if (isHandCard) return;                // 手札は反応させない
      if (targetMode.targets.indexOf(inst) !== -1) {
        confirmGoodsTarget(inst);            // 対象をタップした瞬間に確定
      } else {
        showToast('そのカードには装備できません。');
      }
      return;
    }
    // 通常：クイック詳細を開く。自分の手札ならカード本体にボタンも出す。
    if (isHandCard && canOperateHand()) {
      selectedHandUid = inst.uid;
      openQuickDetail(inst, true);
      renderHandOnly();                      // ボタンを描き直す
    } else {
      openQuickDetail(inst, isHandCard);
    }
  });

  el.addEventListener('pointercancel', clearTimer);
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}

/* 盤面の空白タップでクイック詳細を閉じる */
function setupBlankTapToClose() {
  dom.board.addEventListener('pointerup', function (e) {
    if (isInputBlocked('back')) return;
    if (e.target.closest('.card')) return;
    if (quickDetailUid !== null) closeQuickDetail();
  });
}

/* =====================================================================
   案内オーバーレイ（タップで進む。仕様書 9.2）
   ・案内中は、案内を閉じるタップ以外を受け付けない
   ===================================================================== */
function showGuide(lines, onProceed) {
  closeQuickDetail();
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
   確認ダイアログ／ログ
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

function openLog() {
  closeQuickDetail();   // ログを開いたらクイック詳細は自動で閉じる（仕様書 12.2）
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
  list.scrollTop = list.scrollHeight; // 最新（下）へ自動スクロール
}
function closeLog() {
  dom.logPanel.classList.remove('is-open');
  dom.logPanel.innerHTML = '';
}

/* =====================================================================
   マリガンの進行（仕様書 8）
   ===================================================================== */
function toggleMulliganSelect(inst, el) {
  if (mulliganSelected.has(inst.uid)) {
    mulliganSelected.delete(inst.uid);
    el.classList.remove('is-selected');
  } else {
    mulliganSelected.add(inst.uid);
    el.classList.add('is-selected');
  }
}

function beginMulligan(side) {
  mulliganSide = side;
  bottomSide = side;
  mulliganSelected.clear();
  UI_MODE = 'mulligan';
  dom.mulliganBar.hidden = true;
  dom.actionBar.hidden = true;
  renderScreen();

  const label = DECKS[side].label;
  showGuide(
    [label + 'のマリガン', label + '側を操作してください', 'タップして開始'],
    function () { dom.mulliganBar.hidden = false; }
  );
}

function onMulliganConfirm() {
  if (mulliganSelected.size === 0) {
    showModal(
      ['交換するカードが選ばれていません。', '0枚のままマリガンを終了しますか？'],
      [
        { label: '0枚で確定', onClick: function () { closeModal(); doMulliganConfirm([]); } },
        { label: '選択に戻る', onClick: function () { closeModal(); } },
      ]
    );
  } else {
    // mulliganSelected は Set なので Array.from で配列に変換して渡す
    doMulliganConfirm(Array.from(mulliganSelected));
  }
}

function doMulliganConfirm(uids) {
  Game.confirmMulligan(mulliganSide, uids);
  mulliganSelected.clear();
  dom.mulliganBar.hidden = true;

  const first = Game.state.firstSide;
  const second = Game.state.secondSide;

  if (mulliganSide === first) {
    beginMulligan(second);   // 先攻の次は後攻のマリガン
  } else {
    startFirstTurn();        // 両者終わったら先攻1ターン目へ
  }
}

/* =====================================================================
   画面下部の警告表示（仕様書 5・11.4）
   ---------------------------------------------------------------------
   使えない理由を数秒だけ表示します。クイック詳細は閉じません。
   ===================================================================== */
let toastTimer = null;

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-open');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    dom.toast.classList.remove('is-open');
    toastTimer = null;
  }, 2600); // 2〜3秒程度
}

/* =====================================================================
   登場・使用（仕様書 11）
   ===================================================================== */

/** 手札カード本体の「登場／使用」ボタンを押したとき */
function onActionButton(inst) {
  const check = Game.canPlay(bottomSide, inst);

  // 使えない場合：理由をまとめて表示し、クイック詳細は閉じない（仕様書 11.4）
  if (!check.ok) {
    showToast(check.reasons.join(' '));
    return;
  }

  const type = inst.master.type;
  if (type === 'goods') {
    startTargetMode(inst);   // グッズは対象を選ぶ
    return;
  }

  // 人間・怪異・イベントは押した時点で確定（取り消せない）
  closeQuickDetail();
  selectedHandUid = null;

  const result = (type === 'event')
    ? Game.playEvent(bottomSide, inst)
    : Game.playUnit(bottomSide, inst);

  if (!result.ok) {
    showToast(result.reasons.join(' '));
  }
  renderScreen();
}

/** グッズの対象選択を始める（仕様書 11.2） */
function startTargetMode(goodsInst) {
  closeQuickDetail();                 // 対象選択中はクイック詳細を出さない（12.4）
  const targets = Game.getGoodsTargets(bottomSide, goodsInst);
  targetMode = { goods: goodsInst, targets: targets };

  dom.actionBar.hidden = true;
  dom.targetBar.hidden = false;
  dom.targetHint.textContent = goodsInst.master.name + ' を装備する対象を選んでください';

  renderScreen();                     // 対象候補を強調して描き直す
}

/** 対象をタップして装備を確定する */
function confirmGoodsTarget(targetInst) {
  const goodsInst = targetMode.goods;
  const result = Game.playGoods(bottomSide, goodsInst, targetInst);

  endTargetMode();
  if (!result.ok) {
    showToast(result.reasons.join(' '));
  }
  renderScreen();
}

/** 対象選択をやめる（対象をタップする前ならキャンセルできる） */
function endTargetMode() {
  targetMode = null;
  selectedHandUid = null;
  dom.targetBar.hidden = true;
  if (Game.state && Game.state.phase !== 'setup') showActionBar();
}

function onTargetCancel() {
  endTargetMode();
  renderScreen();
}

/* =====================================================================
   追跡選択（仕様書 10.1）
   ---------------------------------------------------------------------
   ・自分の怪異1体と、相手の人間1体を選ぶ
   ・短いタップで選択／解除、長押しは拡大詳細、クイック詳細は出さない
   ・2枚そろうと「追跡を確定」が押せる
   ・確定前は「メインに戻る」「追跡せず終了」が可能
   ===================================================================== */

/** そのカードが追跡の選択対象になり得るか */
function isTrackCandidate(inst) {
  if (!trackSel) return false;
  const oppSide = Game.otherSide(bottomSide);
  // 自分の怪異
  if (inst.owner === bottomSide && inst.master.type === 'youkai') return true;
  // 相手の人間
  if (inst.owner === oppSide && inst.master.type === 'human') return true;
  return false;
}

/** 追跡選択を開始する */
function enterTrackingMode() {
  trackSel = { youkai: null, human: null };
  closeQuickDetail();
  dom.actionBar.hidden = true;
  dom.targetBar.hidden = true;
  dom.trackBar.hidden = false;
  updateTrackBar();
  renderScreen();
}

/** カードを選択／解除する */
function toggleTrackSelect(inst) {
  if (!isTrackCandidate(inst)) return;

  if (inst.owner === bottomSide) {
    // 自分の怪異（すでに同じカードを選んでいたら解除）
    trackSel.youkai = (trackSel.youkai === inst) ? null : inst;
  } else {
    // 相手の人間
    trackSel.human = (trackSel.human === inst) ? null : inst;
  }
  updateTrackBar();
  renderScreen();
}

/** 追跡バーの表示を、選択状況に合わせて更新する */
function updateTrackBar() {
  const y = trackSel.youkai ? trackSel.youkai.master.name : '未選択';
  const h = trackSel.human ? trackSel.human.master.name : '未選択';
  dom.trackHint.textContent = '怪異：' + y + '／相手の人間：' + h;

  const ready = !!(trackSel.youkai && trackSel.human);
  dom.trackConfirm.disabled = !ready;
  dom.trackConfirm.classList.toggle('is-disabled', !ready);
}

/** 追跡を確定する（確定後は取り消せない） */
function onTrackConfirm() {
  if (!trackSel.youkai || !trackSel.human) return;
  Game.setTracking(bottomSide, trackSel.youkai, trackSel.human);
  exitTrackingMode();
  Game.toEndPhase();
  renderScreen();
  showActionBar();
}

/** 追跡せずにターン終了へ */
function onTrackSkip() {
  Game.skipTracking(bottomSide);
  exitTrackingMode();
  Game.toEndPhase();
  renderScreen();
  showActionBar();
}

/** メインに戻る（確定前のみ） */
function onTrackBack() {
  exitTrackingMode();
  Game.backToMain();
  renderScreen();
  showActionBar();
}

function exitTrackingMode() {
  trackSel = null;
  dom.trackBar.hidden = true;
}

/* =====================================================================
   襲撃の演出（仕様書 15・24）
   ---------------------------------------------------------------------
   約0.5秒間隔で段階を進めます。演出中は進行操作をロックしますが、
   詳細・ログ・ロスト／トラッシュの確認はできます。
   ===================================================================== */
const STEP_MS = 500;

/** 画面中央に短い見出しを出す（襲撃など） */
function showBanner(text) {
  dom.banner.textContent = text;
  dom.banner.classList.add('is-open');
}
function hideBanner() {
  dom.banner.classList.remove('is-open');
  dom.banner.textContent = '';
}

/**
 * 襲撃を段階的に処理する。
 * @param {object} info  Game.prepareAttack の結果
 * @param {function} done 終わったときに呼ぶ処理
 */
function playAttack(info, done) {
  isBusy = true;
  attackHighlight = [info.attacker.uid, info.defender.uid];
  showBanner('襲撃');
  renderScreen();

  // 1. ダメージを与える
  setTimeout(function () {
    Game.applyAttackDamage(info);
    renderScreen();
    showToast(
      info.attacker.master.name + ' → ' + info.defender.master.name +
      '：' + info.finalToHuman + 'ダメージ／反撃 ' + info.finalToYoukai
    );

    // 2. 倒れたカードを移動する
    setTimeout(function () {
      Game.finishAttack(info);
      renderScreen();

      // 3. 演出を終える
      setTimeout(function () {
        attackHighlight = [];
        hideBanner();
        isBusy = false;
        renderScreen();
        done();
      }, STEP_MS);
    }, STEP_MS);
  }, STEP_MS);
}

/* =====================================================================
   リザルト（仕様書 22）
   ===================================================================== */
function showResult() {
  const st = Game.state;
  const g = st.gameOver;
  matchInProgress = false;

  const ov = dom.result;
  ov.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'result__box';

  // 勝者／引き分け
  const head = document.createElement('div');
  head.className = 'result__head';
  head.textContent = g.draw ? '引き分け' : DECKS[g.winner].label + 'の勝利';
  box.appendChild(head);

  // 勝敗理由（複数あればすべて表示）
  const reasons = document.createElement('div');
  reasons.className = 'result__reasons';
  g.losers.forEach(function (l) {
    const row = document.createElement('div');
    row.textContent = DECKS[l.side].label + 'の敗北理由：' + l.reasons.join('／');
    reasons.appendChild(row);
  });
  box.appendChild(reasons);

  // 経過・決着
  const info = document.createElement('div');
  info.className = 'result__info';
  const sideLabel = g.currentSide ? DECKS[g.currentSide].shortLabel : '―';
  info.appendChild(makeResultRow('経過', '通算' + g.turnCount + 'ターン／第' + g.round + '巡'));
  info.appendChild(makeResultRow('決着', sideLabel + 'の第' + g.sideTurn + 'ターン・' + g.phaseLabel));

  ['village', 'mansion'].forEach(function (side) {
    const p = st.players[side];
    info.appendChild(makeResultRow(
      DECKS[side].label,
      'ロスト' + p.lost.length + '／山札' + p.deck.length + '／手札' + p.hand.length
    ));
  });
  info.appendChild(makeResultRow('シード', st.seed));
  box.appendChild(info);

  // ボタン
  const btns = document.createElement('div');
  btns.className = 'result__buttons';

  btns.appendChild(makeResultButton('シードをコピー', function () {
    copySeed(st.seed);
  }));
  btns.appendChild(makeResultButton('ログを確認', function () { openLog(); }));
  btns.appendChild(makeResultButton('同じデッキでもう一度対戦', function () { rematch(); }));
  btns.appendChild(makeResultButton('開始画面へ戻る', function () { backToStart(); }));
  box.appendChild(btns);

  ov.appendChild(box);
  ov.classList.add('is-open');
}

function makeResultRow(label, value) {
  const row = document.createElement('div');
  row.className = 'result__row';
  const l = document.createElement('span');
  l.className = 'result__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'result__value';
  v.textContent = value;
  row.appendChild(l); row.appendChild(v);
  return row;
}

function makeResultButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'result__btn';
  b.textContent = label;
  b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
  return b;
}

/** シードをクリップボードへコピーする */
function copySeed(seed) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(seed).then(function () {
      showToast('シードをコピーしました：' + seed);
    }, function () {
      showToast('コピーできませんでした。シード：' + seed);
    });
  } else {
    showToast('シード：' + seed);
  }
}

/** 同じデッキ・同じ先攻で、新しいシードでもう一度対戦する（仕様書 22） */
function rematch() {
  const firstSide = Game.state.firstSide;
  dom.result.classList.remove('is-open');
  dom.result.innerHTML = '';
  closeLog();
  resetUiState();
  Game.start(firstSide, '');       // シードは空欄＝新しく自動生成
  matchInProgress = true;
  beginMulligan(Game.state.firstSide);  // 開始画面を経由しない
}

/** 開始画面へ戻る */
function backToStart() {
  dom.result.classList.remove('is-open');
  dom.result.innerHTML = '';
  closeLog();
  resetUiState();
  matchInProgress = false;
  dom.gameFrame.hidden = true;
  dom.startScreen.hidden = false;
}

/** 画面の一時的な状態をすべて初期化する */
function resetUiState() {
  UI_MODE = 'start';
  selectedHandUid = null;
  targetMode = null;
  trackSel = null;
  attackHighlight = [];
  isBusy = false;
  mulliganSelected.clear();
  closeQuickDetail();
  closeExpandedDetail();
  closeZoneViewer();
  closeModal();
  hideBanner();
  dom.mulliganBar.hidden = true;
  dom.actionBar.hidden = true;
  dom.targetBar.hidden = true;
  dom.trackBar.hidden = true;
}

/* =====================================================================
   ゲームを中断（仕様書 23）
   ===================================================================== */
function onQuit() {
  if (isBusy) return;
  showModal(
    ['対戦を中断して開始画面へ戻りますか？', '現在の対戦内容は失われます。'],
    [
      { label: '中断する', onClick: function () { closeModal(); backToStart(); } },
      { label: 'やめる', onClick: function () { closeModal(); } },
    ]
  );
}

/* =====================================================================
   ターン進行（仕様書 9・10.4）
   ===================================================================== */

/** 先攻1ターン目の案内（仕様書 9.2） */
function startFirstTurn() {
  const first = Game.state.firstSide;
  bottomSide = first;          // 操作側が下になるよう上下を入れ替える
  UI_MODE = 'board';
  dom.mulliganBar.hidden = true;
  dom.actionBar.hidden = true;
  renderScreen();

  const label = DECKS[first].label;
  showGuide(
    [label + 'の先攻1ターン目', label + '側を操作してください', 'タップしてゲーム開始'],
    function () { beginTurnFlow(first); }
  );
}

/**
 * ターン開始処理（仕様書 9.3）
 *   1. 襲撃         … 有効な追跡がないため自動省略（Stage5で実装）
 *   2. 開始時効果   … 該当なし（Stage6で実装）
 *   3. 気力回復
 *   4. 1枚ドロー
 *   5. メイン
 */
function beginTurnFlow(side) {
  bottomSide = side;
  UI_MODE = 'board';
  selectedHandUid = null;   // 前のターンの選択状態を消す
  targetMode = null;
  trackSel = null;
  dom.targetBar.hidden = true;
  dom.trackBar.hidden = true;
  dom.actionBar.hidden = true;

  Game.beginTurn(side);     // ターン数を進める
  renderScreen();

  // 1. 前の自分のターンに指定した追跡による襲撃（仕様書 15.1）
  //    有効な追跡がなければ自動で省略される
  const info = Game.prepareAttack(side);
  if (info) {
    playAttack(info, function () { afterAttack(side); });
  } else {
    afterAttack(side);
  }
}

/** 襲撃のあと：勝敗を確認し、続くなら気力回復とドローへ */
function afterAttack(side) {
  if (Game.state.gameOver) { finishWithResult(); return; }

  // 2. 開始時効果 … Stage6 で実装
  // 3. 気力回復 → 4. 1枚ドロー（仕様書 9.3）
  Game.turnStartResources(side);
  renderScreen();

  if (Game.state.gameOver) { finishWithResult(); return; }

  // 5. メインへ
  showActionBar();
}

/** 決着したとき：約1秒だけ盤面を見せてからリザルトを出す */
function finishWithResult() {
  isBusy = true;
  dom.actionBar.hidden = true;
  dom.trackBar.hidden = true;
  dom.targetBar.hidden = true;
  setTimeout(function () {
    isBusy = false;
    showResult();
  }, 1000);
}

/** 下の操作バー（メイン終了／ターン終了）を、いまの段階に合わせて出す */
function showActionBar() {
  const st = Game.state;
  dom.mulliganBar.hidden = true;
  dom.actionBar.hidden = false;
  if (st.phase === 'main') {
    dom.actionHint.textContent = 'メイン（登場・使用はStage4以降）';
    dom.actionBtn.textContent = 'メイン終了';
  } else {
    dom.actionHint.textContent = 'ターンを終えて相手に渡します';
    dom.actionBtn.textContent = 'ターン終了';
  }
}

/** 操作バーのボタンを押したとき */
function onActionBtn() {
  if (isBusy) return;   // 演出中は進行できない（仕様書 24）
  const st = Game.state;

  if (st.phase === 'main') {
    // メイン終了 → 追跡選択へ（対象がいなければ自動でターン終了待ちへ）
    const nextPhase = Game.endMain();
    closeQuickDetail();
    selectedHandUid = null;
    renderScreen();
    if (nextPhase === 'tracking') {
      enterTrackingMode();
    } else {
      showActionBar();   // 表示を「ターン終了」に変える
    }
    return;
  }

  // ターン終了 → 上下入れ替え → 次のターン案内（仕様書 10.4）
  const next = Game.endTurn();
  closeQuickDetail();
  selectedHandUid = null;
  dom.actionBar.hidden = true;
  bottomSide = next;     // 上下を入れ替える
  renderScreen();

  const label = DECKS[next].label;
  showGuide(
    [label + 'のターン', label + '側を操作してください', 'タップして開始'],
    function () { beginTurnFlow(next); }
  );
}

/* =====================================================================
   開始画面
   ===================================================================== */
function setupStartScreen() {
  dom.choiceBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      chosenFirst = btn.dataset.side;
      dom.choiceBtns.forEach(function (b) { b.classList.remove('is-chosen'); });
      btn.classList.add('is-chosen');
    });
  });
  dom.choiceBtns.forEach(function (b) {
    if (b.dataset.side === chosenFirst) b.classList.add('is-chosen');
  });
  dom.startBtn.addEventListener('click', onStart);
}

function onStart() {
  resetUiState();
  Game.start(chosenFirst, dom.seedInput.value);
  matchInProgress = true;
  dom.startScreen.hidden = true;
  dom.gameFrame.hidden = false;
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
  dom.actionBtn.addEventListener('click', onActionBtn);
  dom.targetCancel.addEventListener('click', onTargetCancel);
  dom.trackConfirm.addEventListener('click', onTrackConfirm);
  dom.trackSkip.addEventListener('click', onTrackSkip);
  dom.trackBack.addEventListener('click', onTrackBack);
  dom.quitBtn.addEventListener('click', onQuit);

  // 対戦中だけ、再読み込みやタブを閉じるときに確認を出す（仕様書 23）
  window.addEventListener('beforeunload', function (e) {
    if (!matchInProgress) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', updateOrientation);
}

document.addEventListener('DOMContentLoaded', init);
