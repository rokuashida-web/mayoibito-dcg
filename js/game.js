/* =====================================================================
   game.js  ―  ゲームのルール処理（Stage 2）
   ---------------------------------------------------------------------
   このファイルは「ルール処理だけ」を担当します。画面表示は書きません。
   （画面表示は ui.js が担当します。処理と表示を分けるためです。）

   Stage 2 で実装する範囲（仕様書 7・8）:
     ・シード付き乱数の準備
     ・デッキ40枚をマスターから複製して作る
     ・0コスト初期人間（スミレ／エリーゼ）を取り出してフィールドと共に配置
     ・残り39枚をシャッフル
     ・両者5枚ドロー
     ・マリガン（選んだ枚数を山札へ戻し、全体を再シャッフルし、同数を引く）

   Stage 3 以降で実装する範囲（今回はやらない）:
     ・ターン開始処理、気力、毎ターンのドロー、登場・使用、追跡・襲撃、勝敗

   ゲームの状態は Game.state に1つだけ持ちます（仕様書 29.7）。
   ===================================================================== */

'use strict';

/* =====================================================================
   カードの複製（マスターは書き換えない）
   ---------------------------------------------------------------------
   場や手札で使うカードは、マスター（CARD_MASTER）を複製したインスタンスです。
   マスターそのものは絶対に変更しません（仕様書 29.8）。
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

    // Stage 4 以降で使う可変データ（Stage 2 では初期値のまま）
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
   ---------------------------------------------------------------------
   1. デッキ定義（decks.js）から40枚を複製して作る
   2. 0コスト初期人間を1枚取り出す
   3. フィールドを用意する
   4. 残り39枚をシャッフル
   5. 5枚ドロー
   返り値：そのプレイヤーの状態オブジェクト
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

  // そのプレイヤーの状態
  return {
    side: side,
    label: def.label,
    deck: all,             // 山札（残り34枚）
    hand: hand,            // 手札（5枚）
    field: field,          // フィールド
    humans: [initialHuman],// 人間エリア（初期人間1体。登場扱いにしない）
    youkai: [],            // 怪異エリア（まだ空）
    lost: [],              // ロスト
    trash: [],             // トラッシュ
    energy: 0,             // 気力（Stage3で使う。今は0のまま表示は「--」）
  };
}

/* =====================================================================
   ゲーム本体
   ===================================================================== */

const Game = {

  state: null,

  /**
   * 初期準備を行い、状態を作る（仕様書 7 の手順1〜6）。
   * @param {string} firstSide - 先攻の陣営 'village' / 'mansion'
   * @param {string} seedInput - 入力されたシード（空欄なら自動生成）
   */
  start: function (firstSide, seedInput) {
    // シードを決める（空欄なら自動生成）
    let seed = (seedInput == null ? '' : String(seedInput)).trim();
    if (seed === '') {
      seed = autoGenerateSeed();
    }

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
    };
    return this.state;
  },

  /**
   * マリガンを確定する（仕様書 8）。
   * 1. 選んだカードを山札へ戻す
   * 2. 山札全体を再シャッフル
   * 3. 同じ枚数を引き、手札の右端へ追加
   * @param {string} side          - マリガンするプレイヤー
   * @param {number[]} selectedUids - 交換に選んだカードの uid の配列
   * @returns {number} 交換した枚数
   */
  confirmMulligan: function (side, selectedUids) {
    const st = this.state;
    const p = st.players[side];

    // 選ばれたカードと、残す手札を分ける
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
      // 0枚交換（そのまま確定）
      st.log.push('マリガン：' + p.label + ' 0枚交換');
    }

    return count;
  },

  otherSide: otherSide,
};

/* このファイルは <script> 読み込みで使うため、
   Game / createInstance をグローバルとして他ファイルから参照します。 */
