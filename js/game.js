/* =====================================================================
   game.js  ―  ゲームのルール処理（Stage 6-C）
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

   Stage 5 で追加（仕様書 10・14・15・16・19）:
     ・追跡（自分の怪異1体＋相手の人間1体を指定）
     ・襲撃（同時ダメージ・軽減・致死の同時処理）
     ・場を離れる処理（装備グッズもトラッシュへ／状態リセット）
     ・勝敗判定（ロスト上限／人間0体／山札0枚、同時なら引き分け）

   Stage 6-A で追加（仕様書 17）:
     ・常在効果の反映（effects.js が計算し、ここで能力値に足す）
     ・常在効果の即時再計算と、体力0以下になったカードの同時致死処理

   Stage 6-B で追加（仕様書 18）:
     ・効果の待機列（誘発した効果を順番に解決する仕組み）
     ・効果が使う共通操作（山札を削る／効果ダメージ／回収／山札上を見る など）

   Stage 6-C で追加:
     ・【場を離れた時】・イベント・フィールドの効果を待機列へ流す仕組み
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
      // 'setup' / 'main' / 'tracking'（追跡選択中）/ 'end'（ターン終了待ち）
      phase: 'setup',

      // 追跡ペア。各プレイヤー1組まで（仕様書 10.1）
      // 例：{ youkai: 怪異インスタンス, human: 相手人間インスタンス }
      tracking: { village: null, mansion: null },

      // 決着したらここに結果が入る。入ったら以降の処理は止める（仕様書 19）
      gameOver: null,

      // 誘発した効果を並べておく待機列（仕様書 18.1）
      pendingEffects: [],

      // 「1ターンに1回」「ゲーム中1回」の使用済み記録
      effectUsed: {},
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
      // すでに0枚なら、この時点で敗北しているはず（念のための保険）
      this.checkVictory('ドロー中');
      return null;
    }
    const card = p.deck.shift();
    p.hand.push(card);
    st.log.push('ドロー：' + p.label + ' ' + card.master.name);

    // 「山札が0枚になった瞬間」に敗北する（仕様書 6）
    // 最後の1枚を手札へ移す処理は行い、その直後に判定する。
    if (p.deck.length === 0) {
      st.log.push('山札が0枚になりました：' + p.label);
      this.checkVictory('ドロー中');
    }
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

    return st;
  },

  /**
   * ターン開始時の気力回復とドロー（仕様書 9.3 の 3〜4）。
   * 襲撃の演出を先に見せられるよう、beginTurn とは分けています。
   */
  turnStartResources: function (side) {
    if (this.state.gameOver) return; // 決着していたら何もしない
    this.gainEnergy(side);
    this.drawOne(side);
  },

  /**
   * メイン終了（仕様書 10.4 の手順1）。
   * 自分の怪異が0体、または相手の人間が0体なら追跡選択を自動省略します（仕様書 10.1）。
   */
  endMain: function () {
    const st = this.state;
    const me = st.players[st.currentSide];
    const opp = st.players[otherSide(st.currentSide)];

    st.log.push('メイン終了：' + DECKS[st.currentSide].label);

    const canTrack = (me.youkai.length > 0 && opp.humans.length > 0);
    st.phase = canTrack ? 'tracking' : 'end';
    if (!canTrack) {
      st.log.push('追跡選択：対象がいないため省略');
    }
    return st.phase;
  },

  /** 追跡選択からメインへ戻る（確定前のみ・仕様書 10.4） */
  backToMain: function () {
    this.state.phase = 'main';
  },

  /** 追跡を終えてターン終了待ちへ */
  toEndPhase: function () {
    this.state.phase = 'end';
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

    // --- 常在効果による補正（仕様書 17）---
    // 計算そのものは effects.js が行い、ここでは結果を足すだけ。
    if (typeof Effects !== 'undefined') {
      const stat = Effects.getStaticModifiers(inst, this.state);
      speedBonus += stat.speed;
      hpBonus += stat.hp;
      stat.notes.forEach(function (n) { corrections.push(n); });
    }

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

    // 常在効果を即時再計算し、体力0以下になったカードを処理する（仕様書 11.1 の 5〜7）
    this.recalcAndResolveDeaths('登場時');

    // 8. 勝敗がなければ【登場時】効果を待機列へ追加する
    this.queueEnterEffect(inst);
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

    // 能力値の再計算（仕様書 11.2 の 7〜8）
    this.recalcAndResolveDeaths('装備時');
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
    // ※トラッシュへ送るのは効果の解決後（仕様書 11.3）。
    //   手札から離れているので、境界線などで自分自身が捨てる候補にならない。

    st.log.push('使用：' + p.label + ' ' + inst.master.name +
      '（気力' + cost + '消費 → 残り' + p.energy + '）');

    // 効果を待機列へ。効果を持たないカードでも必ずトラッシュへ送る。
    if (Effects.hasEffect('event', inst.cardId)) {
      this.queueEffect('event', inst);
    } else {
      p.trash.push(inst);
      this.recalcAndResolveDeaths('イベント使用時');
    }
    return { ok: true };
  },

  /* =============================================================
     勝敗判定（仕様書 19）
     -------------------------------------------------------------
     敗北条件は3つ。
       1. フィールドが定めたロスト上限に達した（村5／洋館4）
       2. 自分の場の人間が0体になった
       3. 自分の山札が0枚になった
     各処理の直後に呼び、両者が同時に満たしたら引き分けにします。
     @param phaseLabel 決着した場面の名前（リザルトに表示する）
     ============================================================= */
  checkVictory: function (phaseLabel) {
    const st = this.state;
    if (!st || st.gameOver) return st ? st.gameOver : null; // すでに決着済み

    const losers = [];
    ['village', 'mansion'].forEach(function (side) {
      const p = st.players[side];
      const reasons = [];

      const limit = p.field.master.lostLimit;
      if (typeof limit === 'number' && p.lost.length >= limit) {
        reasons.push('ロスト上限到達');
      }
      if (p.humans.length === 0) {
        reasons.push('場の人間が0体');
      }
      if (p.deck.length === 0) {
        reasons.push('山札が0枚');
      }
      if (reasons.length > 0) losers.push({ side: side, reasons: reasons });
    });

    if (losers.length === 0) return null;

    let result;
    if (losers.length === 2) {
      // 両者が同じ処理で条件を満たしたら引き分け
      result = {
        draw: true,
        winner: null,
        losers: losers,
        phaseLabel: phaseLabel,
      };
      st.log.push('決着：引き分け（' +
        losers.map(function (l) { return DECKS[l.side].label + '＝' + l.reasons.join('／'); }).join('、') + '）');
    } else {
      const loser = losers[0];
      const winner = otherSide(loser.side);
      result = {
        draw: false,
        winner: winner,
        losers: losers,
        phaseLabel: phaseLabel,
      };
      st.log.push('決着：' + DECKS[winner].label + 'の勝利（' +
        DECKS[loser.side].label + 'の敗北理由：' + loser.reasons.join('／') + '）');
    }

    // リザルト表示用に、決着時点の情報を控えておく（仕様書 22）
    result.turnCount = st.turnCount;
    result.round = Math.ceil(st.turnCount / 2);      // 巡目
    result.currentSide = st.currentSide;
    result.sideTurn = st.currentSide ? st.sideTurnCount[st.currentSide] : 0;

    st.gameOver = result;
    return result;
  },

  /* =============================================================
     カードが場を離れる処理（仕様書 16・14）
     -------------------------------------------------------------
     ・人間はロストへ、怪異はトラッシュへ
     ・装備グッズは本体の直後にトラッシュへ
     ・蓄積ダメージ・追跡・一時補正はリセット
     ============================================================= */
  _leaveField: function (inst) {
    const st = this.state;
    const p = st.players[inst.owner];

    // 場（人間エリア／怪異エリア）から取り除く
    const zone = (inst.master.type === 'human') ? p.humans : p.youkai;
    const i = zone.indexOf(inst);
    if (i !== -1) zone.splice(i, 1);

    // 装備していたグッズを覚えておく（本体の直後にトラッシュへ送るため）
    const goods = inst.equippedGoods;

    // 場を離れるときに状態をリセットする（仕様書 14）
    inst.accumulatedDamage = 0;
    inst.tracking = false;
    inst.equippedGoods = null;

    // 人間はロスト、怪異はトラッシュ
    let lostThird = false;
    if (inst.master.type === 'human') {
      p.lost.push(inst);
      st.log.push('移動：' + p.label + ' ' + inst.master.name + ' → ロスト（' + p.lost.length + '枚）');
      // ちょうど3枚目が置かれた瞬間だけ、フィールド効果が誘発する
      if (p.lost.length === 3) lostThird = true;
    } else {
      p.trash.push(inst);
      st.log.push('移動：' + p.label + ' ' + inst.master.name + ' → トラッシュ');
    }

    // グッズは本体の直後にトラッシュへ（仕様書 16.1・16.2）
    if (goods) {
      goods.equippedTo = null;
      p.trash.push(goods);
      st.log.push('移動：' + p.label + ' ' + goods.master.name + '（装備）→ トラッシュ');
    }

    // 追跡ペアに含まれていたら解除する（仕様書 10.3）
    this._clearTrackingWith(inst);

    // 【場を離れた時】効果を待機列へ（仕様書 17 の 8）
    this.queueEffect('leave', inst);

    // ロストへちょうど3枚目が置かれたときのフィールド効果
    if (lostThird) this.queueEffect('lostThird', p.field);
  },

  /** そのカードが関わっている追跡を解除する */
  _clearTrackingWith: function (inst) {
    const st = this.state;
    ['village', 'mansion'].forEach(function (side) {
      const pair = st.tracking[side];
      if (!pair) return;
      if (pair.youkai === inst || pair.human === inst) {
        // 相方の追跡表示も戻す
        if (pair.youkai !== inst) pair.youkai.tracking = false;
        if (pair.human !== inst) pair.human.tracking = false;
        st.tracking[side] = null;
        st.log.push('追跡解除：' + DECKS[side].label + '（対象が場を離れたため）');
      }
    });
  },

  /* =============================================================
     効果の待機列（仕様書 18.1・18.2）
     -------------------------------------------------------------
     効果が誘発したら、すぐに実行せずいったん待機列へ入れます。
     そして1つずつ、完全に解決してから次へ進みます。
     ============================================================= */

  /**
   * 効果を待機列へ入れる（仕様書 18.1）
   * @param kind 'enter'（登場時）/'leave'（場を離れた時）/'event'（イベント）
   *             /'endTurn'（フィールドのターン終了時）/'lostThird'（ロスト3枚目）
   */
  queueEffect: function (kind, inst) {
    const st = this.state;
    if (st.gameOver) return;                        // 敗北成立後は誘発しない
    if (!Effects.hasEffect(kind, inst.cardId)) return; // 効果を持たないカードは何もしない

    st.pendingEffects.push({
      kind: kind,
      source: inst,
      side: inst.owner,
      // 並び替え用に、誘発した時点の場所を控えておく（仕様書 18.2）
      order: this._positionOrder(inst),
    });
  },

  /** 【登場時】効果を待機列へ入れる（仕様書 11.1 の 8） */
  queueEnterEffect: function (inst) {
    this.queueEffect('enter', inst);
  },

  /** 自分のターン終了時にはたらくフィールド効果を待機列へ（仕様書 10.4 の 4） */
  queueEndTurnEffects: function (side) {
    const p = this.state.players[side];
    this.queueEffect('endTurn', p.field);
  },

  /**
   * 同時タイミングの並び順を数値にする（小さいほど先に解決）。
   * 同じプレイヤー内の順番（仕様書 18.2）:
   *   1 フィールド → 2 通常人間 左→右 → 3 通常怪異 左→右
   *   → 4 追跡中人間 → 5 追跡中怪異
   */
  _positionOrder: function (inst) {
    const p = this.state.players[inst.owner];
    const type = inst.master.type;

    if (type === 'field') return 100;
    // イベントやグッズは場に並ばないので、いちばん後ろの扱いにする
    if (type !== 'human' && type !== 'youkai') return 600;

    const zone = (type === 'human') ? p.humans : p.youkai;
    const index = Math.max(0, zone.indexOf(inst));

    if (type === 'human') return (inst.tracking ? 400 : 200) + index;
    return (inst.tracking ? 500 : 300) + index;
  },

  /**
   * 待機列から次に解決する効果を1つ取り出す。
   * ターンプレイヤーの効果を先に解決します（仕様書 18.2・18.3）。
   * 同じプレイヤー内は、入った順（FIFO）と場所の順で決めます。
   */
  takeNextPending: function () {
    const st = this.state;
    if (st.gameOver) { st.pendingEffects = []; return null; } // 敗北後はすべて中止
    if (st.pendingEffects.length === 0) return null;

    let bestIndex = 0;
    for (let i = 1; i < st.pendingEffects.length; i++) {
      const a = st.pendingEffects[i];
      const b = st.pendingEffects[bestIndex];

      // ターンプレイヤーの効果を優先
      const aTurn = (a.side === st.currentSide) ? 0 : 1;
      const bTurn = (b.side === st.currentSide) ? 0 : 1;
      if (aTurn !== bTurn) { if (aTurn < bTurn) bestIndex = i; continue; }

      // 同じプレイヤーなら場所の順
      if (a.order < b.order) bestIndex = i;
    }
    return st.pendingEffects.splice(bestIndex, 1)[0];
  },

  /**
   * 待機列から取り出した効果を1つ解決する。
   * 選択などの操作は画面側（ui.js）から渡された道具（uiOps）を使います。
   * @param item   takeNextPending() で取り出したもの
   * @param uiOps  { confirmYesNo, pickCards, pickBoardTarget }
   * @param done   解決が終わったときに呼ばれる関数
   */
  runEffect: function (item, uiOps, done) {
    const st = this.state;
    const self = this;
    if (st.gameOver) { done(); return; }

    const KIND_LABEL = {
      enter: '【登場時】',
      leave: '【場を離れた時】',
      event: '（イベント使用）',
      endTurn: '【ターン終了時】',
      lostThird: '【ロスト3枚目】',
    };
    st.log.push('効果：' + DECKS[item.side].label + ' ' +
      item.source.master.name + (KIND_LABEL[item.kind] || ''));

    // 効果の中で使える道具をまとめる
    const ctx = {
      state: st,
      side: item.side,
      source: item.source,
      me: st.players[item.side],
      opponent: st.players[otherSide(item.side)],
      game: this,
      log: function (msg) { st.log.push(msg); },
      isOver: function () { return !!st.gameOver; },
      confirmYesNo: uiOps.confirmYesNo,
      pickCards: uiOps.pickCards,
      pickBoardTarget: uiOps.pickBoardTarget,
    };

    Effects.runEffect(item.kind, item.source.cardId, ctx, function () {
      // イベントは効果の解決が終わったらトラッシュへ送る（仕様書 11.3）
      if (item.kind === 'event') {
        st.players[item.side].trash.push(item.source);
        st.log.push('トラッシュへ：' + DECKS[item.side].label + ' ' +
          item.source.master.name + '（使用後）');
      }
      // 効果ダメージなどで倒れたカードをここで処理する（仕様書 17）
      self.recalcAndResolveDeaths('効果解決中');
      done();
    });
  },

  /* =============================================================
     効果が使う共通操作
     ============================================================= */

  /** 「1ターンに1回」などの使用済み判定 */
  isEffectUsed: function (key) { return this.state.effectUsed[key] === true; },
  markEffectUsed: function (key) { this.state.effectUsed[key] = true; },

  /** 1ターンに1回の記録キー（プレイヤーごと・ターンごと・カード名ごと） */
  turnUseKey: function (side, cardId) {
    return 'turn:' + side + ':' + cardId + ':' + this.state.turnCount;
  },
  /** ゲーム中1回の記録キー（プレイヤーごと・カード名ごと） */
  gameUseKey: function (side, cardId) {
    return 'game:' + side + ':' + cardId;
  },

  /**
   * 山札の上から n 枚をトラッシュへ置く（仕様書 6・19）
   * 山札が足りなければある分だけ。0枚になった時点で敗北し、以降を中止します。
   */
  trashTopOfDeck: function (side, n) {
    const st = this.state;
    const p = st.players[side];
    const moved = [];

    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) break;
      const card = p.deck.shift();
      p.trash.push(card);
      moved.push(card);
      st.log.push('トラッシュへ：' + p.label + ' ' + card.master.name + '（山札から）');

      if (p.deck.length === 0) {
        st.log.push('山札が0枚になりました：' + p.label);
        this.checkVictory('効果解決中');
        break; // 敗北したので以降の処理を中止する
      }
    }
    return moved;
  },

  /**
   * 効果ダメージを与える（仕様書 14：襲撃ダメージとは内部で区別する）
   */
  dealEffectDamage: function (target, amount, sourceName) {
    const st = this.state;
    target.accumulatedDamage += amount;
    st.log.push('効果ダメージ：' + (sourceName ? sourceName + ' → ' : '') +
      target.master.name + ' に ' + amount);
    // 倒れたかどうかは、このあと recalcAndResolveDeaths で判定する
  },

  /** トラッシュからカードを手札へ戻す */
  moveTrashToHand: function (side, inst) {
    const st = this.state;
    const p = st.players[side];
    const i = p.trash.indexOf(inst);
    if (i === -1) return false;
    p.trash.splice(i, 1);
    p.hand.push(inst);
    st.log.push('回収：' + p.label + ' ' + inst.master.name + '（トラッシュ → 手札）');
    return true;
  },

  /** 手札からトラッシュへ置く（選択順に処理する） */
  discardFromHand: function (side, insts) {
    const st = this.state;
    const p = st.players[side];
    insts.forEach(function (inst) {
      const i = p.hand.indexOf(inst);
      if (i === -1) return;
      p.hand.splice(i, 1);
      p.trash.push(inst);
      st.log.push('トラッシュへ：' + p.label + ' ' + inst.master.name + '（手札から）');
    });
  },

  /**
   * 山札の上から n 枚を「見る」（仕様書 18.7）
   * 見るだけなので移動せず、山札0枚の判定も行いません。
   */
  lookTopOfDeck: function (side, n) {
    const p = this.state.players[side];
    return p.deck.slice(0, Math.min(n, p.deck.length));
  },

  /**
   * 見たカードのうち1枚を手札へ、残りを無作為順で山札の下へ戻す（仕様書 18.7）
   * @param taken 手札へ加えるカード（なければ null）
   * @param looked 見たカード全部
   */
  resolveLook: function (side, looked, taken) {
    const st = this.state;
    const p = st.players[side];

    // 見た枚数ぶんを山札の上から取り除く
    p.deck.splice(0, looked.length);

    if (taken) {
      p.hand.push(taken);
      st.log.push('回収：' + p.label + ' ' + taken.master.name + '（山札から手札へ）');
    }

    // 残りをシード付き乱数で無作為に並べ替えて山札の下へ
    const rest = looked.filter(function (c) { return c !== taken; });
    st.rng.shuffle(rest);
    rest.forEach(function (c) { p.deck.push(c); });
    st.log.push('山札下へ戻す：' + p.label + ' ' + rest.length + '枚（順番は非公開）');
  },

  /**
   * ロストからカードを場へ登場させる（イザベラ用・仕様書 27）
   * ・コスト不要、新しい登場として人間エリアの右端へ
   * ・ダメージや状態はリセット
   * ・人間エリアが満員なら不発（既存カードは押し出さない）
   */
  summonFromLost: function (side, cardId) {
    const st = this.state;
    const p = st.players[side];

    const i = p.lost.findIndex(function (c) { return c.cardId === cardId; });
    if (i === -1) {
      st.log.push('不発：ロストに対象のカードがありません');
      return null;
    }
    if (p.humans.length >= MAX_HUMANS) {
      st.log.push('不発：人間エリアが上限のため登場できません');
      return null;
    }

    const card = p.lost.splice(i, 1)[0];
    card.accumulatedDamage = 0;   // 新しい登場として扱う
    card.tracking = false;
    card.equippedGoods = null;
    p.humans.push(card);          // 右端へ
    st.log.push('登場：' + p.label + ' ' + card.master.name + '（ロストから／コスト不要）');
    return card;
  },

  /* =============================================================
     盤面の再計算と、同時致死処理（仕様書 17）
     -------------------------------------------------------------
     常在効果の条件が変わると、能力値が変わります。
     その結果、現在体力が0以下になったカードは「同時に」場を離れます。
     さらにその離脱で条件が変わり、新たに倒れるカードが出ることもあるため、
     変化が起きなくなるまで繰り返します。

     手順（仕様書 17）:
       1. 盤面再計算
       2. 致死カードをすべて同時移動
       3. グッズを同時移動（_leaveField の中で行う）
       4. 勝敗判定
       5. 勝敗がなければ再計算
       6. 新たな致死カードを次の一団として処理
       7. 安定するまで繰り返す
     ============================================================= */
  recalcAndResolveDeaths: function (phaseLabel) {
    const st = this.state;
    const self = this;
    const dead = [];      // このあいだに倒れたカード（画面表示用）

    let guard = 0;        // 万一の無限ループ防止
    while (guard++ < 30) {
      if (!st || st.gameOver) break;

      // 1. 盤面を見直し、現在体力が0以下のカードを集める
      const dying = [];
      ['village', 'mansion'].forEach(function (side) {
        const p = st.players[side];
        p.humans.concat(p.youkai).forEach(function (c) {
          const stats = self.getStats(c);
          if (stats.hasStats && stats.curHp <= 0) dying.push(c);
        });
      });

      // 倒れるカードがなければ、盤面は安定している
      if (dying.length === 0) break;

      // 2〜3. まとめて同時に場を離れる（装備グッズも一緒に移動する）
      dying.forEach(function (c) {
        st.log.push('致死：' + c.master.name + '（現在体力0以下）');
        self._leaveField(c);
        dead.push(c);
      });

      // 4. 勝敗判定
      self.checkVictory(phaseLabel);
    }

    return dead;
  },

  /* =============================================================
     追跡の確定（仕様書 10.1）
     -------------------------------------------------------------
     自分の怪異1体と、相手の人間1体を指定します。
     確定後は取り消せません。
     ============================================================= */
  setTracking: function (side, youkaiInst, humanInst) {
    const st = this.state;
    st.tracking[side] = { youkai: youkaiInst, human: humanInst };
    youkaiInst.tracking = true;
    humanInst.tracking = true;
    st.log.push('追跡：' + DECKS[side].label + ' ' + youkaiInst.master.name +
      ' → ' + humanInst.master.name);
  },

  /** 追跡せずにターンを終える */
  skipTracking: function (side) {
    this.state.log.push('追跡：' + DECKS[side].label + ' 追跡なし');
  },

  /* =============================================================
     襲撃の準備（仕様書 15.1〜15.4）
     -------------------------------------------------------------
     ダメージを「計算するだけ」で、まだ適用はしません。
     （画面側が0.5秒ずつ演出を見せられるように、段階を分けています）
     ============================================================= */
  prepareAttack: function (side) {
    const st = this.state;
    const pair = st.tracking[side];
    if (!pair) return null; // 有効な追跡がなければ襲撃を自動省略

    const attacker = pair.youkai;  // 自分の怪異
    const defender = pair.human;   // 相手の人間

    const aStats = this.getStats(attacker);
    const dStats = this.getStats(defender);

    // 襲撃ダメージは「現在スピード」。互いに同時に与える（仕様書 14・15.3）
    const rawToHuman = aStats.curSpeed;
    const rawToYoukai = dStats.curSpeed;

    // 軽減（仕様書 15.4）。いまは装備グッズによる軽減のみ。
    const redHuman = this._calcReduction(defender);
    const redYoukai = this._calcReduction(attacker);

    return {
      side: side,
      attacker: attacker,
      defender: defender,
      rawToHuman: rawToHuman,
      rawToYoukai: rawToYoukai,
      reductionHuman: redHuman.total,
      reductionYoukai: redYoukai.total,
      // 最終ダメージ ＝ max(0, 元ダメージ - 軽減合計)
      finalToHuman: Math.max(0, rawToHuman - redHuman.total),
      finalToYoukai: Math.max(0, rawToYoukai - redYoukai.total),
      usedGoods: redHuman.usedGoods.concat(redYoukai.usedGoods),
    };
  },

  /** 装備グッズによる軽減量を計算する（仕様書 15.4） */
  _calcReduction: function (inst) {
    const goods = inst.equippedGoods;
    if (!goods || !goods.master.damageReduction) {
      return { total: 0, usedGoods: [] };
    }
    const rule = goods.master.damageReduction;
    let amount = rule.amount || 0;

    // 条件付きで軽減量が増える（例：自分の場にイザベラがいれば4軽減）
    if (rule.ifCardOnField) {
      const p = this.state.players[inst.owner];
      const onField = p.youkai.concat(p.humans).some(function (c) {
        return c.cardId === rule.ifCardOnField;
      });
      if (onField) amount = rule.boosted;
    }
    return { total: amount, usedGoods: rule.trashAfterUse ? [{ host: inst, goods: goods }] : [] };
  },

  /* =============================================================
     襲撃のダメージ適用（仕様書 15.2 の 5〜6）
     -------------------------------------------------------------
     両者へ同時にダメージを与えます。
     軽減に使った《小さな鍵》はここでトラッシュへ移りますが、
     確定した軽減値はすでに計算済みなので影響しません。
     ============================================================= */
  applyAttackDamage: function (info) {
    const st = this.state;

    st.log.push('襲撃：' + DECKS[info.side].label + ' ' + info.attacker.master.name +
      ' → ' + info.defender.master.name);

    if (info.reductionHuman > 0) {
      st.log.push('軽減：' + info.defender.master.name + ' ' +
        info.rawToHuman + ' - ' + info.reductionHuman + ' = ' + info.finalToHuman);
    }

    // 同時ダメージ
    info.defender.accumulatedDamage += info.finalToHuman;
    info.attacker.accumulatedDamage += info.finalToYoukai;

    st.log.push('ダメージ：' + info.defender.master.name + ' に ' + info.finalToHuman +
      '／' + info.attacker.master.name + ' に ' + info.finalToYoukai + '（反撃）');

    // 軽減に使ったグッズをトラッシュへ
    info.usedGoods.forEach(function (u) {
      u.host.equippedGoods = null;
      u.goods.equippedTo = null;
      st.players[u.goods.owner].trash.push(u.goods);
      st.log.push('移動：' + u.goods.master.name + '（軽減に使用）→ トラッシュ');
    });
  },

  /* =============================================================
     襲撃後の致死処理（仕様書 15.2 の 7〜9）
     -------------------------------------------------------------
     現在体力0以下のカードを「同時に」場から移動し、勝敗を判定します。
     生き残ったカードは追跡を解除し、通常列の右端へ戻します。
     ============================================================= */
  finishAttack: function (info) {
    const st = this.state;
    const self = this;

    // 倒れたカードを先に「まとめて」調べる（同時処理のため）
    const dying = [];
    [info.attacker, info.defender].forEach(function (c) {
      if (self.getStats(c).curHp <= 0) dying.push(c);
    });

    // まとめて移動する
    dying.forEach(function (c) { self._leaveField(c); });

    // 生存者は追跡を解除し、通常列の右端へ戻す（仕様書 15.2 の 9）
    [info.attacker, info.defender].forEach(function (c) {
      if (dying.indexOf(c) !== -1) return;
      c.tracking = false;
      const p = st.players[c.owner];
      const zone = (c.master.type === 'human') ? p.humans : p.youkai;
      const i = zone.indexOf(c);
      if (i !== -1) { zone.splice(i, 1); zone.push(c); } // 右端へ移す
    });

    // この襲撃の追跡ペアは解決済みなので消す
    st.tracking[info.side] = null;

    // 勝敗判定
    this.checkVictory('襲撃中');

    // ロスト・トラッシュが増えたことで常在効果の条件が変わり、
    // さらに倒れるカードが出ることがある（仕様書 17）
    const extra = this.recalcAndResolveDeaths('襲撃中');

    return dying.concat(extra);
  },

  /** ヘッダー用の文字列（例：ターン5｜村 第3ターン｜メイン）※仕様書 9.1 */
  getTurnHeaderText: function () {
    const st = this.state;
    if (!st || st.turnCount === 0) return '';
    const shortLabel = DECKS[st.currentSide].shortLabel;
    let phaseLabel = 'メイン';
    if (st.phase === 'tracking') phaseLabel = '追跡選択';
    else if (st.phase === 'end') phaseLabel = 'ターン終了';
    return 'ターン' + st.turnCount + '｜' + shortLabel +
      ' 第' + st.sideTurnCount[st.currentSide] + 'ターン｜' + phaseLabel;
  },

  otherSide: otherSide,
};

/* このファイルは <script> 読み込みで使うため、
   Game / createInstance をグローバルとして他ファイルから参照します。 */
