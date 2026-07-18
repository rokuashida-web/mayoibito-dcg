/* =====================================================================
   game.js  ―  ゲームのルール処理（Stage 5）
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

   Stage 6 で実装（今回はやらない）:
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
      // 'setup' / 'main' / 'tracking'（追跡選択中）/ 'end'（ターン終了待ち）
      phase: 'setup',

      // 追跡ペア。各プレイヤー1組まで（仕様書 10.1）
      // 例：{ youkai: 怪異インスタンス, human: 相手人間インスタンス }
      tracking: { village: null, mansion: null },

      // 決着したらここに結果が入る。入ったら以降の処理は止める（仕様書 19）
      gameOver: null,
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
    if (inst.master.type === 'human') {
      p.lost.push(inst);
      st.log.push('移動：' + p.label + ' ' + inst.master.name + ' → ロスト（' + p.lost.length + '枚）');
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

    return dying;
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
