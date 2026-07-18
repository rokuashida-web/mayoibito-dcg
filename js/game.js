/* =====================================================================
   game.js  ―  ゲームのルール処理（Stage 3）
   ---------------------------------------------------------------------
   このファイルは「ルール処理だけ」を担当します。画面表示は書きません。
   （画面表示は ui.js が担当します。処理と表示を分けるためです。）

   Stage 2 までに実装済み（仕様書 7・8）:
     ・シード付き乱数の準備
     ・デッキ40枚をマスターから複製して作る
     ・0コスト初期人間（スミレ／エリーゼ）をフィールドと共に配置
     ・残り39枚をシャッフル、両者5枚ドロー
     ・マリガン

   Stage 3 で追加（仕様書 9・10.4）:
     ・ターンの数え方（通算ターン／各陣営の第Nターン）
     ・ターン開始処理（気力回復 → 1枚ドロー → メイン）
     ・気力（0開始・上限10・持ち越し・超過分は失う）
     ・メイン終了 → ターン終了 → 手番交代

   Stage 4 以降で実装（今回はやらない）:
     ・登場／使用、追跡・襲撃、カード効果、勝敗判定
   ===================================================================== */

'use strict';

/* 気力の上限（仕様書 9.4）。1か所にまとめて、後から変えやすくする。 */
const ENERGY_MAX = 10;

/* =====================================================================
   カードの複製（マスターは書き換えない）
   ===================================================================== */

let _uidCounter = 0; // 1枚ごとに割り当てる通し番号

function createInstance(cardId, owner) {
  const master = CARD_MASTER[cardId];
  if (!master) {
    console.error('未定義のカードID:', cardId);
    return null;
  }
  return {
    uid: ++_uidCounter,
    cardId: master.id,
    owner: owner,      // 'village'（村） か 'mansion'（洋館）
    master: master,    // マスターへの参照（読み取り専用のつもりで使う）

    // Stage 4 以降で使う可変データ（Stage 3 では初期値のまま）
    accumulatedDamage: 0,
    equippedGoods: null,
    tracking: false,
  };
}

/** 反対側の陣営を返す */
function otherSide(side) {
  return side === 'village' ? 'mansion' : 'village';
}

/* =====================================================================
   1人分の初期準備（仕様書 7）
   ===================================================================== */

function buildPlayerState(side, rng, log) {
  const def = DECKS[side];

  // --- 1. 40枚を複製して作る ---
  const all = [];
  def.mainDeck.forEach(function (entry) {
    for (let i = 0; i < entry.count; i++) {
      all.push(createInstance(entry.id, side));
    }
  });

  // --- 2. 0コスト初期人間（スミレ／エリーゼ）を1枚取り出す ---
  const initIndex = all.findIndex(function (c) {
    return c.cardId === def.initialHuman;
  });
  const initialHuman = all.splice(initIndex, 1)[0];

  // --- 3. フィールドを用意（フィールドは40枚に含まない） ---
  const field = createInstance(def.fieldId, side);

  // --- 4. 残り39枚をシャッフル ---
  rng.shuffle(all);
  log.push('シャッフル：' + def.label + ' 山札' + all.length + '枚');

  // --- 5. 5枚ドロー（山札の上から手札へ） ---
  const hand = [];
  const drawnNames = [];
  for (let i = 0; i < 5; i++) {
    const card = all.shift(); // 先頭を「山札の上」とする
    hand.push(card);
    drawnNames.push(card.master.name);
  }
  log.push('初期ドロー：' + def.label + ' ' + drawnNames.join('、'));

  return {
    side: side,
    label: def.label,
    deck: all,              // 山札（残り34枚）
    hand: hand,             // 手札（5枚）
    field: field,           // フィールド
    humans: [initialHuman], // 人間エリア（初期人間1体。登場扱いにしない）
    youkai: [],             // 怪異エリア（まだ空）
    lost: [],               // ロスト
    trash: [],              // トラッシュ
    energy: 0,              // 気力（仕様書 9.4：両者0から開始）
  };
}

/* =====================================================================
   ゲーム本体
   ===================================================================== */

const Game = {

  state: null,

  /* -------------------------------------------------------------
     初期準備（仕様書 7 の手順1〜6）
     ------------------------------------------------------------- */
  start: function (firstSide, seedInput) {
    let seed = (seedInput == null ? '' : String(seedInput)).trim();
    if (seed === '') seed = autoGenerateSeed();

    const rng = createRng(seed);
    const log = [];
    log.push('シード：' + seed);
    log.push('先攻：' + DECKS[firstSide].label);

    const secondSide = otherSide(firstSide);

    // 先攻→後攻の順で準備する（同じシードなら同じ順で乱数を使うので再現できる）
    const players = {};
    players[firstSide] = buildPlayerState(firstSide, rng, log);
    players[secondSide] = buildPlayerState(secondSide, rng, log);

    this.state = {
      seed: seed,
      rng: rng,
      firstSide: firstSide,
      secondSide: secondSide,
      players: players,
      log: log,

      // --- Stage 3 で追加したターン管理 ---
      turnCount: 0,        // 通算ターン数（仕様書 9.1）
      sideTurnCount: { village: 0, mansion: 0 }, // 各陣営の「第Nターン」
      currentSide: null,   // いまのターンプレイヤー
      phase: 'setup',      // 'setup' / 'main' / 'end'（メイン終了後）
    };
    return this.state;
  },

  /* -------------------------------------------------------------
     マリガン（仕様書 8）
     ------------------------------------------------------------- */
  confirmMulligan: function (side, selectedUids) {
    const st = this.state;
    const p = st.players[side];

    const selected = p.hand.filter(function (c) {
      return selectedUids.indexOf(c.uid) !== -1;
    });
    const kept = p.hand.filter(function (c) {
      return selectedUids.indexOf(c.uid) === -1;
    });
    const count = selected.length;

    if (count > 0) {
      // 1. 選んだカードを山札へ戻す
      p.hand = kept;
      p.deck = p.deck.concat(selected);

      // 2. 山札全体を再シャッフル
      st.rng.shuffle(p.deck);
      st.log.push('シャッフル（マリガン）：' + p.label);

      // 3. 同じ枚数を引き、手札の右端へ追加
      const drawnNames = [];
      for (let i = 0; i < count; i++) {
        const card = p.deck.shift();
        p.hand.push(card);
        drawnNames.push(card.master.name);
      }
      st.log.push('マリガン：' + p.label + ' ' + count + '枚交換 → ' + drawnNames.join('、'));
    } else {
      st.log.push('マリガン：' + p.label + ' 0枚交換');
    }
    return count;
  },

  /* -------------------------------------------------------------
     1枚ドロー（仕様書 9.5）
     ------------------------------------------------------------
     ※ 山札0枚での敗北判定は仕様書19（Stage 5）で実装します。
        Stage 3 では、エラーで止まらないよう記録だけして飛ばします。
     ------------------------------------------------------------- */
  drawOne: function (side) {
    const st = this.state;
    const p = st.players[side];

    if (p.deck.length === 0) {
      st.log.push('ドロー：' + p.label + ' 山札が0枚のため引けません（敗北判定はStage5で実装）');
      return null;
    }
    const card = p.deck.shift();
    p.hand.push(card);
    st.log.push('ドロー：' + p.label + ' ' + card.master.name);
    return card;
  },

  /* -------------------------------------------------------------
     気力回復（仕様書 9.4）
     ------------------------------------------------------------
     ・先攻プレイヤーの最初のターンだけ +1
     ・それ以外はすべて +2（後攻の最初のターンも +2）
     ・上限10。超過分は失う。未使用分は持ち越し。
     ------------------------------------------------------------- */
  gainEnergy: function (side) {
    const st = this.state;
    const p = st.players[side];

    // このプレイヤーにとって何回目のターンか
    const nth = st.sideTurnCount[side];
    const isFirstTurnOfFirstPlayer = (side === st.firstSide && nth === 1);
    const gain = isFirstTurnOfFirstPlayer ? 1 : 2;

    const before = p.energy;
    const raw = before + gain;              // 上限を考えない合計
    p.energy = Math.min(ENERGY_MAX, raw);   // 上限10でとめる
    const overflow = raw - p.energy;        // あふれて失った分

    let line = '気力：' + p.label + ' +' + gain + ' → ' + p.energy;
    if (overflow > 0) line += '（上限超過 ' + overflow + ' を失う）';
    st.log.push(line);

    return { gain: gain, overflow: overflow, energy: p.energy };
  },

  /* -------------------------------------------------------------
     ターン開始処理（仕様書 9.3）
     ------------------------------------------------------------
     1. 前の自分のターンに指定した追跡による襲撃 → Stage 5 で実装
        （有効な追跡がなければ自動省略：Stage 3 では常に省略）
     2. 開始時効果 → Stage 6 で実装
     3. 気力回復
     4. 1枚ドロー
     5. メイン
     ------------------------------------------------------------- */
  beginTurn: function (side) {
    const st = this.state;

    st.turnCount += 1;
    st.sideTurnCount[side] += 1;
    st.currentSide = side;
    st.phase = 'main';

    st.log.push(
      '── ターン' + st.turnCount + '｜' + DECKS[side].label +
      ' 第' + st.sideTurnCount[side] + 'ターン 開始'
    );

    // 3. 気力回復 → 4. 1枚ドロー
    this.gainEnergy(side);
    this.drawOne(side);

    return st;
  },

  /** メイン終了（仕様書 10.4 の手順1）。追跡選択・終了時効果は Stage 5・6。 */
  endMain: function () {
    const st = this.state;
    st.phase = 'end';
    st.log.push('メイン終了：' + DECKS[st.currentSide].label);
  },

  /** ターン終了 → 手番を相手に渡す（仕様書 10.4 の手順5〜7） */
  endTurn: function () {
    const st = this.state;
    st.log.push('ターン終了：' + DECKS[st.currentSide].label);
    const next = otherSide(st.currentSide);
    st.phase = 'setup';
    return next; // 次のターンプレイヤー
  },

  /** ヘッダー用の文字列（例：ターン5｜村 第3ターン｜メイン）※仕様書 9.1 */
  getTurnHeaderText: function () {
    const st = this.state;
    if (!st || st.turnCount === 0) return '';
    const shortLabel = DECKS[st.currentSide].shortLabel;
    const phaseLabel = (st.phase === 'main') ? 'メイン' : 'ターン終了';
    return 'ターン' + st.turnCount + '｜' + shortLabel +
      ' 第' + st.sideTurnCount[st.currentSide] + 'ターン｜' + phaseLabel;
  },

  otherSide: otherSide,
};

/* このファイルは <script> 読み込みで使うため、
   Game / createInstance をグローバルとして他ファイルから参照します。 */
