/* =====================================================================
   game.js  ―  ゲームのルール処理（Stage 4）
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

   Stage 4 で追加（仕様書 5・11・17）:
     ・場の上限（人間3体／怪異3体／1体につきグッズ1枚）
     ・人間・怪異の登場（気力を払って後列の右端へ）
     ・グッズの使用（対象を選んで装備し、能力値を再計算）
     ・イベントの使用（気力を払い、最後にトラッシュへ）
     ・使用できない理由の判定（気力不足・盤面上限・装備対象なし）

   Stage 5 以降で実装（今回はやらない）:
     ・追跡・襲撃・致死処理・勝敗判定
     ・【登場時】【常在】【場を離れた時】などのカード効果
   ===================================================================== */

'use strict';

/* ルールの数値は1か所にまとめて、後から変えやすくする。 */
const ENERGY_MAX = 10;   // 気力の上限（仕様書 9.4）
const MAX_HUMANS = 3;    // 人間エリアの上限（仕様書 5）
const MAX_YOUKAI = 3;    // 怪異エリアの上限（仕様書 5）

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

  /* =============================================================
     能力値の計算（仕様書 14・17）
     -------------------------------------------------------------
     カードの「いまの」スピードと体力を、そのつど計算して返します。
     こうしておくと、条件（トラッシュ枚数など）が変わったときに
     自動で正しい値になります＝仕様書17の「即時再計算」。

     ・体力補正は、蓄積ダメージを維持したまま現在体力と最大体力を同量増やす
     ・スピードの最低値は0
     ============================================================= */
  getStats: function (inst) {
    const m = inst.master;
    const baseSpeed = (typeof m.speed === 'number') ? m.speed : null;
    const baseHp = (typeof m.hp === 'number') ? m.hp : null;

    // 人間・怪異以外（グッズ・イベント・フィールド）は能力値を持たない
    if (baseSpeed === null || baseHp === null) {
      return { hasStats: false, corrections: [] };
    }

    let speedBonus = 0;
    let hpBonus = 0;
    const corrections = []; // 「補正内訳」の表示用

    // --- 装備しているグッズによる補正 ---
    const goods = inst.equippedGoods;
    if (goods && goods.master.equipBonus) {
      const b = goods.master.equipBonus;
      let s = b.speed || 0;
      let h = b.hp || 0;

      // 条件付きの追加分（例：トラッシュ10枚以上でさらにスピード+1）
      if (b.bonusIf) {
        const owner = this.state ? this.state.players[inst.owner] : null;
        if (owner) {
          const zoneCount = (b.bonusIf.zone === 'trash') ? owner.trash.length : owner.lost.length;
          if (zoneCount >= b.bonusIf.min) {
            s += (b.bonusIf.speed || 0);
            h += (b.bonusIf.hp || 0);
          }
        }
      }

      speedBonus += s;
      hpBonus += h;

      // 内訳の文章を作る（例：懐中電灯：体力+1）
      const parts = [];
      if (s !== 0) parts.push('スピード' + (s > 0 ? '+' : '') + s);
      if (h !== 0) parts.push('体力' + (h > 0 ? '+' : '') + h);
      if (parts.length) corrections.push(goods.master.name + '：' + parts.join('、'));
    }

    const curSpeed = Math.max(0, baseSpeed + speedBonus); // スピードは最低0
    const maxHp = baseHp + hpBonus;
    const curHp = maxHp - inst.accumulatedDamage;

    return {
      hasStats: true,
      baseSpeed: baseSpeed,
      baseHp: baseHp,
      curSpeed: curSpeed,
      maxHp: maxHp,
      curHp: curHp,
      accum: inst.accumulatedDamage,
      corrections: corrections,
      equip: goods,
      tracking: inst.tracking,
    };
  },

  /* =============================================================
     グッズの装備先として選べるカードを集める（仕様書 11.2）
     -------------------------------------------------------------
     ・自分の場のカードのみ
     ・カードごとの条件（人間／怪異、必要な特徴）に合うもの
     ・すでにグッズを装備しているカードは対象外（1体に1枚まで）
     ============================================================= */
  getGoodsTargets: function (side, goodsInst) {
    const p = this.state.players[side];
    const rule = goodsInst.master.equipTarget;
    if (!rule) return [];

    const pool = (rule.type === 'human') ? p.humans : p.youkai;
    return pool.filter(function (c) {
      if (!c) return false;
      if (c.equippedGoods) return false; // すでにグッズあり
      if (rule.trait) {
        const traits = c.master.traits || [];
        if (traits.indexOf(rule.trait) === -1) return false; // 特徴が合わない
      }
      return true;
    });
  },

  /* =============================================================
     そのカードが今使えるか調べる（仕様書 11.4・5）
     -------------------------------------------------------------
     返り値：{ ok: true/false, reasons: [理由の文章...] }
     理由が複数あるときは、まとめて返します。
     ============================================================= */
  canPlay: function (side, inst) {
    const p = this.state.players[side];
    const m = inst.master;
    const reasons = [];

    // 気力が足りているか
    const cost = (typeof m.cost === 'number') ? m.cost : 0;
    if (p.energy < cost) {
      reasons.push('気力が' + (cost - p.energy) + '足りません。');
    }

    // 場の上限（追跡中のカードも上限に含む＝配列の長さで数える）
    if (m.type === 'human' && p.humans.length >= MAX_HUMANS) {
      reasons.push('人間エリアが上限のため、これ以上登場できません。');
    }
    if (m.type === 'youkai' && p.youkai.length >= MAX_YOUKAI) {
      reasons.push('怪異エリアが上限のため、これ以上登場できません。');
    }

    // グッズは装備できる対象がいるか
    if (m.type === 'goods' && this.getGoodsTargets(side, inst).length === 0) {
      reasons.push('装備できる対象がいません。');
    }

    return { ok: reasons.length === 0, reasons: reasons };
  },

  /** 気力を支払う（内部用） */
  _payCost: function (side, inst) {
    const p = this.state.players[side];
    const cost = (typeof inst.master.cost === 'number') ? inst.master.cost : 0;
    p.energy -= cost;
    return cost;
  },

  /** 手札からカードを取り除く（内部用） */
  _removeFromHand: function (side, inst) {
    const p = this.state.players[side];
    const i = p.hand.indexOf(inst);
    if (i !== -1) p.hand.splice(i, 1);
  },

  /* =============================================================
     人間・怪異の登場（仕様書 11.1）
     -------------------------------------------------------------
     1. 気力を支払う
     2. 登場を確定
     3. 通常列（後列）の右端へ配置
     ※ 常在再計算・致死処理・勝敗判定・【登場時】効果は Stage5／Stage6
     ============================================================= */
  playUnit: function (side, inst) {
    const st = this.state;
    const p = st.players[side];

    const check = this.canPlay(side, inst);
    if (!check.ok) return { ok: false, reasons: check.reasons };

    const cost = this._payCost(side, inst);
    this._removeFromHand(side, inst);

    // 新しく登場したカードは右端＝配列の最後に追加する（仕様書13）
    if (inst.master.type === 'human') {
      p.humans.push(inst);
    } else {
      p.youkai.push(inst);
    }

    st.log.push('登場：' + p.label + ' ' + inst.master.name +
      '（気力' + cost + '消費 → 残り' + p.energy + '）');
    return { ok: true };
  },

  /* =============================================================
     グッズの使用＝装備（仕様書 11.2）
     -------------------------------------------------------------
     1. 気力消費
     2. 装備
     3. 能力値再計算（getStats が毎回計算するので自動で反映される）
     ============================================================= */
  playGoods: function (side, goodsInst, targetInst) {
    const st = this.state;
    const p = st.players[side];

    const check = this.canPlay(side, goodsInst);
    if (!check.ok) return { ok: false, reasons: check.reasons };

    // 対象が本当に装備できる相手か、念のため確認する
    const targets = this.getGoodsTargets(side, goodsInst);
    if (targets.indexOf(targetInst) === -1) {
      return { ok: false, reasons: ['そのカードには装備できません。'] };
    }

    const cost = this._payCost(side, goodsInst);
    this._removeFromHand(side, goodsInst);

    targetInst.equippedGoods = goodsInst; // 装備する
    goodsInst.equippedTo = targetInst;    // どのカードに付いているかも覚えておく

    st.log.push('使用：' + p.label + ' ' + goodsInst.master.name +
      ' → ' + targetInst.master.name + ' に装備' +
      '（気力' + cost + '消費 → 残り' + p.energy + '）');
    return { ok: true };
  },

  /* =============================================================
     イベントの使用（仕様書 11.3）
     -------------------------------------------------------------
     気力を払い、可能な部分だけ処理し、最後にトラッシュへ送る。
     ※ 効果そのものは Stage6 で実装するため、今は気力の支払いと
        トラッシュ送りだけを行います。
     ============================================================= */
  playEvent: function (side, inst) {
    const st = this.state;
    const p = st.players[side];

    const check = this.canPlay(side, inst);
    if (!check.ok) return { ok: false, reasons: check.reasons };

    const cost = this._payCost(side, inst);
    this._removeFromHand(side, inst);
    p.trash.push(inst); // 使用後はトラッシュへ

    st.log.push('使用：' + p.label + ' ' + inst.master.name +
      '（気力' + cost + '消費 → 残り' + p.energy + '）効果はStage6で実装');
    return { ok: true };
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
