/* =====================================================================
   effects.js  ―  カード効果（Stage 6-C：全カード効果）
   ---------------------------------------------------------------------
   このファイルには「カードごとの効果」を書きます。
   ルールの共通処理は game.js、画面表示は ui.js が担当します。

   ここに効果をまとめておくと、カードを追加・変更するときに
   このファイルだけを見ればよくなります。

   Stage 6-A で実装するもの（仕様書 17）:
     ・【常在】山を守るヌシ様
     ・【常在】企む貴婦人 イザベラ

   Stage 6-B で追加:
     ・【登場時】ルナ／カエデ／リン／コハク／案山子／シルヴィ／イザベラ

   Stage 6-C で追加:
     ・【場を離れた時】アネット
     ・イベント：境界線／差し伸べる手／黒薔薇の策略
     ・フィールド：～ヨマモリ村～（ターン終了時）／～黒薔薇の館～（ロスト3枚目）
   ===================================================================== */

'use strict';

/* =====================================================================
   便利な小道具
   ===================================================================== */

/** そのカードが指定の特徴（〈村〉〈洋館〉など）を持っているか */
function hasTrait(inst, trait) {
  const traits = inst.master.traits || [];
  return traits.indexOf(trait) !== -1;
}

/** カードの並び（配列）の中で、指定の特徴を持つ枚数を数える */
function countTrait(cards, trait) {
  let n = 0;
  for (let i = 0; i < cards.length; i++) {
    if (hasTrait(cards[i], trait)) n++;
  }
  return n;
}

/** そのプレイヤーの場にいる人間・怪異をすべて集める（追跡中も場にいる扱い） */
function fieldUnits(player) {
  return player.humans.concat(player.youkai);
}

/* =====================================================================
   常在効果の定義（仕様書 17）
   ---------------------------------------------------------------------
   常在効果は「条件を満たしている間ずっと働く」効果です。
   そのつど計算し直すので、条件が変わった瞬間に反映されます。

   書き方:
     source   … 効果を出しているカードのID
     apply(ctx) … 効果を出しているカード1体ぶんの補正を返す関数
       ctx.source  効果を出しているカード
       ctx.target  補正を受けるか調べたいカード
       ctx.state   ゲーム全体の状態
     返り値: { speed: 数値, hp: 数値, note: '表示用の説明' } または null
   ===================================================================== */

const STATIC_EFFECTS = [

  /* --- 《山を守るヌシ様》 -------------------------------------------
     自分のトラッシュに〈村〉カードが10枚以上ある間、
     相手の人間・怪異すべてのスピード-1。複数体で重複。
     ------------------------------------------------------------------ */
  {
    source: 'village_nushi',
    apply: function (ctx) {
      const owner = ctx.state.players[ctx.source.owner];

      // 条件：自分のトラッシュの〈村〉カードが10枚以上
      if (countTrait(owner.trash, '村') < 10) return null;

      // 対象：相手の人間・怪異すべて
      if (ctx.target.owner === ctx.source.owner) return null;

      return { speed: -1, hp: 0, note: 'ヌシ様：スピード-1' };
    },
  },

  /* --- 《企む貴婦人 イザベラ》 --------------------------------------
     自分のロストに〈洋館〉カードが3枚以上ある間、
     自分の〈洋館〉怪異すべてと《屋敷の令嬢 エリーゼ》の
     スピード・体力を+2。イザベラ自身も対象。複数体で重複。
     ------------------------------------------------------------------ */
  {
    source: 'mansion_isabella',
    apply: function (ctx) {
      const owner = ctx.state.players[ctx.source.owner];

      // 条件：自分のロストの〈洋館〉カードが3枚以上
      if (countTrait(owner.lost, '洋館') < 3) return null;

      // 対象は「自分の」カードだけ
      if (ctx.target.owner !== ctx.source.owner) return null;

      // 対象：〈洋館〉怪異、または《屋敷の令嬢 エリーゼ》
      const isMansionYoukai =
        (ctx.target.master.type === 'youkai') && hasTrait(ctx.target, '洋館');
      const isElise = (ctx.target.cardId === 'mansion_elise');
      if (!isMansionYoukai && !isElise) return null;

      return { speed: 2, hp: 2, note: 'イザベラ：スピード・体力+2' };
    },
  },

];

/* =====================================================================
   常在効果の計算
   ===================================================================== */

const Effects = {

  /**
   * そのカードが受けている常在効果の合計を返す。
   * 場にいるすべてのカードを調べ、同じ効果が複数あれば重ねて数えます。
   *
   * @param {object} target 補正を受けるか調べたいカード
   * @param {object} state  ゲーム全体の状態
   * @returns {{speed:number, hp:number, notes:string[]}}
   */
  getStaticModifiers: function (target, state) {
    let speed = 0;
    let hp = 0;
    const noteCount = {}; // 同じ説明が何回重なったか

    if (!state) return { speed: 0, hp: 0, notes: [] };

    // 両プレイヤーの場にいるカードを、効果の発生源として順に調べる
    ['village', 'mansion'].forEach(function (side) {
      const units = fieldUnits(state.players[side]);

      units.forEach(function (source) {
        // このカードに対応する常在効果を探す
        for (let i = 0; i < STATIC_EFFECTS.length; i++) {
          const def = STATIC_EFFECTS[i];
          if (def.source !== source.cardId) continue;

          const mod = def.apply({ source: source, target: target, state: state });
          if (!mod) continue;

          speed += (mod.speed || 0);
          hp += (mod.hp || 0);
          if (mod.note) noteCount[mod.note] = (noteCount[mod.note] || 0) + 1;
        }
      });
    });

    // 「イザベラ：スピード・体力+2 ×2」のように、重なった数も表示する
    const notes = Object.keys(noteCount).map(function (note) {
      const n = noteCount[note];
      return (n > 1) ? (note + ' ×' + n) : note;
    });

    return { speed: speed, hp: hp, notes: notes };
  },

};

/* このファイルは <script> 読み込みで使うため、
   Effects をグローバルとして他ファイルから参照します。 */


/* =====================================================================
   【登場時】効果（仕様書 11.1・18・26・27）
   ---------------------------------------------------------------------
   書き方:
     各効果は function (ctx, done) の形で書きます。
     処理が終わったら必ず done() を呼びます。
     途中でプレイヤーに選ばせる場合は、ctx の道具を使い、
     その結果を受け取る関数の中で続きを書きます（順番が守られます）。

   ctx で使える道具:
     ctx.state / ctx.side / ctx.source / ctx.me / ctx.opponent
     ctx.log(文章)
     ctx.game … game.js の Game（ルール操作をまとめて持っている）
     ctx.confirmYesNo(見出し, 説明, 続き)        … 発動する／しないの確認
     ctx.pickCards({ ... }, 続き)                … カードを選ぶ画面
     ctx.pickBoardTarget({ ... }, 続き)          … 盤面のカードを1体選ぶ
     ctx.isOver()                                … 決着したら true（以降は中止）
   ===================================================================== */

/** 〈村〉の人間または怪異か（案山子・差し伸べる手で使う） */
function isVillageUnit(inst) {
  const t = inst.master.type;
  return (t === 'human' || t === 'youkai') && hasTrait(inst, '村');
}

const ENTER_EFFECTS = {

  /* --- 《泣き虫転校生 ルナ》 ----------------------------------------
     【登場時】自分の山札上2枚をトラッシュへ置く。
     ・強制／山札が2枚未満なら存在分すべて
     ・0枚になった時点で敗北し、以降を中止
     ------------------------------------------------------------------ */
  village_luna: function (ctx, done) {
    ctx.game.trashTopOfDeck(ctx.side, 2);
    done();
  },

  /* --- 《負けず嫌い カエデ》 ----------------------------------------
     【登場時】任意で2枚引く。そうしたら、手札2枚を選びトラッシュへ置く。
     ・「そうしたら」なので、2枚引けた場合だけ手札を捨てる（仕様書 18.5）
     ・捨てる順は選択順（選択中に1、2の番号を表示）
     ------------------------------------------------------------------ */
  village_kaede: function (ctx, done) {
    ctx.confirmYesNo(
      '負けず嫌い カエデ',
      '2枚引きますか？\n引いた場合、手札2枚を選んでトラッシュへ置きます。',
      function (yes) {
        if (!yes) { ctx.log('発動しない：負けず嫌い カエデ'); done(); return; }

        // 2枚引く（山札が0枚になれば敗北して中止）
        const before = ctx.me.hand.length;
        ctx.game.drawOne(ctx.side);
        if (ctx.isOver()) { done(); return; }
        ctx.game.drawOne(ctx.side);
        if (ctx.isOver()) { done(); return; }

        // 2枚引けたときだけ、手札2枚をトラッシュへ
        const drew = ctx.me.hand.length - before;
        if (drew < 2) {
          ctx.log('不発：2枚引けなかったため、手札を捨てません');
          done();
          return;
        }

        ctx.pickCards({
          title: '負けず嫌い カエデ',
          message: 'トラッシュへ置く手札を2枚選んでください（選んだ順に置きます）',
          cards: ctx.me.hand.slice(),
          count: 2,
          mode: 'exact',   // ちょうど2枚（仕様書 18.6）
          ordered: true,   // 選んだ順に番号を表示
        }, function (chosen) {
          ctx.game.discardFromHand(ctx.side, chosen);
          done();
        });
      }
    );
  },

  /* --- 《頼れる委員長 リン》 ----------------------------------------
     【登場時】自分のトラッシュに〈村〉カードが5枚以上なら、
     相手怪異1体に2効果ダメージ。
     ・同名効果は1ターンに1回
     ・条件と対象が有効なら強制
     ------------------------------------------------------------------ */
  village_rin: function (ctx, done) {
    const key = ctx.game.turnUseKey(ctx.side, 'village_rin');
    if (ctx.game.isEffectUsed(key)) {
      ctx.log('不発：頼れる委員長 リンの効果はこのターン使用済み');
      done(); return;
    }
    if (countTrait(ctx.me.trash, '村') < 5) {
      ctx.log('不発：トラッシュの〈村〉カードが5枚未満');
      done(); return;
    }
    const targets = ctx.opponent.youkai.slice();
    if (targets.length === 0) {
      ctx.log('不発：相手の怪異がいません');
      done(); return;
    }

    ctx.game.markEffectUsed(key);
    ctx.pickBoardTarget({
      title: '頼れる委員長 リン',
      message: '2ダメージを与える相手の怪異を選んでください',
      candidates: targets,
    }, function (target) {
      ctx.game.dealEffectDamage(target, 2, '頼れる委員長 リン');
      done();
    });
  },

  /* --- 《狐のお面 コハク》 ------------------------------------------
     【登場時】自分のフィールドが〈村〉なら、相手怪異1体に1効果ダメージ。
     ・条件と対象が有効なら強制／対象不在なら不発
     ------------------------------------------------------------------ */
  village_kohaku: function (ctx, done) {
    if (!hasTrait(ctx.me.field, '村')) {
      ctx.log('不発：自分のフィールドが〈村〉ではありません');
      done(); return;
    }
    const targets = ctx.opponent.youkai.slice();
    if (targets.length === 0) {
      ctx.log('不発：相手の怪異がいません');
      done(); return;
    }
    ctx.pickBoardTarget({
      title: '狐のお面 コハク',
      message: '1ダメージを与える相手の怪異を選んでください',
      candidates: targets,
    }, function (target) {
      ctx.game.dealEffectDamage(target, 1, '狐のお面 コハク');
      done();
    });
  },

  /* --- 《朽ちゆく嗤い案山子》 ----------------------------------------
     【登場時】
       1. 山札上1枚をトラッシュへ置く（強制）
       2. その後、トラッシュの〈村〉人間または怪異を最大1枚、手札へ加える
     ・同名《朽ちゆく嗤い案山子》は回収不可／新たに落ちたカードも候補
     ・山札0枚なら即敗北し、回収へ進まない
     ------------------------------------------------------------------ */
  village_kakashi: function (ctx, done) {
    ctx.game.trashTopOfDeck(ctx.side, 1);
    if (ctx.isOver()) { done(); return; }  // 山札0枚で敗北したら回収しない

    // 候補：トラッシュの〈村〉人間・怪異。ただし同名は除く。
    const candidates = ctx.me.trash.filter(function (c) {
      return isVillageUnit(c) && c.cardId !== 'village_kakashi';
    });
    if (candidates.length === 0) {
      ctx.log('不発：回収できるカードがありません');
      done(); return;
    }

    ctx.pickCards({
      title: '朽ちゆく嗤い案山子',
      message: '手札へ加えるカードを選んでください（0〜1枚）',
      cards: candidates,
      count: 1,
      mode: 'max',      // 最大1枚（0枚も選べる／仕様書 18.6）
    }, function (chosen) {
      if (chosen.length > 0) ctx.game.moveTrashToHand(ctx.side, chosen[0]);
      else ctx.log('回収：0枚を選択');
      done();
    });
  },

  /* --- 《寡黙な使用人 シルヴィ》 --------------------------------------
     【登場時】
       1. 山札上5枚を見る（強制）
       2. その中の〈洋館〉グッズ／イベント、または《企む貴婦人 イザベラ》を
          最大1枚、手札へ
       3. 残りを無作為順で山札下へ
     ------------------------------------------------------------------ */
  mansion_sylvie: function (ctx, done) {
    const looked = ctx.game.lookTopOfDeck(ctx.side, 5);
    ctx.log('山札上' + looked.length + '枚を見た：' + ctx.me.label);

    if (looked.length === 0) { done(); return; }

    // 回収できる候補を絞り込む
    const candidates = looked.filter(function (c) {
      const t = c.master.type;
      const isMansionGoodsOrEvent = (t === 'goods' || t === 'event') && hasTrait(c, '洋館');
      const isIsabella = (c.cardId === 'mansion_isabella');
      return isMansionGoodsOrEvent || isIsabella;
    });

    // 見た5枚は「すべて」表示する（仕様書 18.7：山札上を見る）。
    // そのうち回収できるカードだけを選べるようにし、光らせて区別する。
    const message = (candidates.length > 0)
      ? '山札の上' + looked.length + '枚です。光っているカードから手札へ加える1枚を選べます（0〜1枚）。\n選ばなかったカードは無作為順で山札下へ戻ります'
      : '山札の上' + looked.length + '枚です。回収できるカードはありません。\n見たカードは無作為順で山札下へ戻ります';

    ctx.pickCards({
      title: '寡黙な使用人 シルヴィ',
      message: message,
      cards: looked,          // 見た5枚すべてを表示する
      selectable: candidates, // そのうち選べるのは条件に合うカードだけ
      count: 1,
      mode: 'max',
    }, function (chosen) {
      ctx.game.resolveLook(ctx.side, looked, chosen.length ? chosen[0] : null);
      done();
    });
  },

  /* --- 《企む貴婦人 イザベラ》 ----------------------------------------
     【登場時】ゲーム中1回、自分のロストの《屋敷の令嬢 エリーゼ》を場へ登場させる。
     ・強制／登場時に「使用済み」を即時消費
     ・エリーゼ不在や人間エリア満員でも消費する（不発理由をログへ）
     ------------------------------------------------------------------ */
  mansion_isabella: function (ctx, done) {
    const key = ctx.game.gameUseKey(ctx.side, 'mansion_isabella');
    if (ctx.game.isEffectUsed(key)) {
      ctx.log('不発：イザベラの効果はこのゲームで使用済み');
      done(); return;
    }
    // 不発でも使用済みを消費する
    ctx.game.markEffectUsed(key);
    ctx.game.summonFromLost(ctx.side, 'mansion_elise');
    done();
  },

};

/* =====================================================================
   【場を離れた時】効果（仕様書 27）
   ===================================================================== */

const LEAVE_EFFECTS = {

  /* --- 《不憫な客人 アネット》 --------------------------------------
     【場を離れた時】
       1. 山札上3枚を見る（強制）
       2. その中の〈洋館〉人間または怪異を最大1枚、手札へ加える
       3. 残りを無作為順で山札下へ戻す
     ・離れた理由・移動先を問わず誘発
     ・4枚目のロストで敗北した場合は解決しない（待機列が中止されるため）
     ------------------------------------------------------------------ */
  mansion_annette: function (ctx, done) {
    const looked = ctx.game.lookTopOfDeck(ctx.side, 3);
    ctx.log('山札上' + looked.length + '枚を見た：' + ctx.me.label);
    if (looked.length === 0) { done(); return; }

    // 回収できるのは〈洋館〉の人間または怪異
    const candidates = looked.filter(function (c) {
      const t = c.master.type;
      return (t === 'human' || t === 'youkai') && hasTrait(c, '洋館');
    });

    const message = (candidates.length > 0)
      ? '山札の上' + looked.length + '枚です。光っているカードから手札へ加える1枚を選べます（0〜1枚）。\n選ばなかったカードは無作為順で山札下へ戻ります'
      : '山札の上' + looked.length + '枚です。回収できるカードはありません。\n見たカードは無作為順で山札下へ戻ります';

    ctx.pickCards({
      title: '不憫な客人 アネット',
      message: message,
      cards: looked,           // 見た3枚すべてを表示する（仕様書 18.7）
      selectable: candidates,
      count: 1,
      mode: 'max',
    }, function (chosen) {
      ctx.game.resolveLook(ctx.side, looked, chosen.length ? chosen[0] : null);
      done();
    });
  },

};

/* =====================================================================
   イベントの効果（仕様書 11.3・26・27）
   ---------------------------------------------------------------------
   気力はすでに支払われています。ここでは効果だけを処理し、
   解決が終わったカードは game.js が自動でトラッシュへ送ります。
   ===================================================================== */

const EVENT_EFFECTS = {

  /* --- 《境界線》（村・洋館 共通） ------------------------------------
     自分の手札1枚をトラッシュへ置く。その後、2枚引く。
     ・ほかの手札がなくても使用可能
     ・捨てられなくても2ドローを行う（「その後」＝仕様書 18.5）
     ・イベント自身は捨てる候補に含めない（すでに手札から離れている）
     ------------------------------------------------------------------ */
  event_kyoukaisen: function (ctx, done) {

    // 2枚引く処理（捨てられたかどうかに関わらず行う）
    function drawTwo() {
      ctx.game.drawOne(ctx.side);
      if (ctx.isOver()) { done(); return; }
      ctx.game.drawOne(ctx.side);
      done();
    }

    if (ctx.me.hand.length === 0) {
      ctx.log('手札がないため、捨てずに2枚引きます');
      drawTwo();
      return;
    }

    ctx.pickCards({
      title: '境界線',
      message: 'トラッシュへ置く手札を1枚選んでください',
      cards: ctx.me.hand.slice(),
      count: 1,
      mode: 'exact',   // 「1枚」なので0枚では決定できない（仕様書 18.6）
    }, function (chosen) {
      ctx.game.discardFromHand(ctx.side, chosen);
      if (ctx.isOver()) { done(); return; }
      drawTwo();
    });
  },

  /* --- 《差し伸べる手》 ----------------------------------------------
     自分のトラッシュの〈村〉人間・怪異・グッズを最大1枚、手札へ加える。
     ・イベント・フィールドは対象外
     ・候補なしでも使用可能
     ------------------------------------------------------------------ */
  village_sashinoberu: function (ctx, done) {
    const candidates = ctx.me.trash.filter(function (c) {
      const t = c.master.type;
      const isTargetType = (t === 'human' || t === 'youkai' || t === 'goods');
      return isTargetType && hasTrait(c, '村');
    });

    if (candidates.length === 0) {
      ctx.log('不発：回収できるカードがありません');
      done(); return;
    }

    ctx.pickCards({
      title: '差し伸べる手',
      message: '手札へ加えるカードを選んでください（0〜1枚）',
      cards: candidates,
      count: 1,
      mode: 'max',
    }, function (chosen) {
      if (chosen.length > 0) ctx.game.moveTrashToHand(ctx.side, chosen[0]);
      else ctx.log('回収：0枚を選択');
      done();
    });
  },

  /* --- 《黒薔薇の策略》 ----------------------------------------------
     自分の場にイザベラがいるなら、相手怪異1体に2効果ダメージ。
     ・イザベラ不在でも、相手怪異不在でも使用は可能
     ・条件不成立・対象不在なら不発（気力は消費したまま）
     ------------------------------------------------------------------ */
  mansion_sakuryaku: function (ctx, done) {
    const hasIsabella = ctx.me.youkai.some(function (c) {
      return c.cardId === 'mansion_isabella';
    });
    if (!hasIsabella) {
      ctx.log('不発：自分の場に《企む貴婦人 イザベラ》がいません');
      done(); return;
    }
    const targets = ctx.opponent.youkai.slice();
    if (targets.length === 0) {
      ctx.log('不発：相手の怪異がいません');
      done(); return;
    }

    ctx.pickBoardTarget({
      title: '黒薔薇の策略',
      message: '2ダメージを与える相手の怪異を選んでください',
      candidates: targets,
    }, function (target) {
      ctx.game.dealEffectDamage(target, 2, '黒薔薇の策略');
      done();
    });
  },

};

/* =====================================================================
   フィールドの効果（仕様書 26.1・27.1）
   ===================================================================== */

/* --- 自分のターン終了時にはたらく効果 --- */
const FIELD_END_TURN_EFFECTS = {

  /* --- 《～ヨマモリ村～》 --------------------------------------------
     自分のターン終了時、任意で自分の山札の上から1枚をトラッシュへ置く。
     ・同タイミングの自陣営効果より先に処理する（待機列の並び順で対応）
     ・山札最後の1枚を置いて0枚になったら即敗北
     ------------------------------------------------------------------ */
  field_village: function (ctx, done) {
    if (ctx.me.deck.length === 0) { done(); return; }

    ctx.confirmYesNo(
      '～ヨマモリ村～',
      '山札の上から1枚をトラッシュへ置きますか？\n（山札が0枚になると敗北します）',
      function (yes) {
        if (!yes) { ctx.log('発動しない：～ヨマモリ村～'); done(); return; }
        ctx.game.trashTopOfDeck(ctx.side, 1);
        done();
      }
    );
  },

};

/* --- 自分のロストへちょうど3枚目が置かれたときにはたらく効果 --- */
const FIELD_LOST_THIRD_EFFECTS = {

  /* --- 《～黒薔薇の館～》 --------------------------------------------
     自分のロストへちょうど3枚目のカードが置かれたとき、
     自分のロストがすべて〈洋館〉なら気力1回復。
     ・強制。気力上限10
     ・3枚目が置かれた瞬間だけ誘発
     ・ロストが減って再び3枚目が置かれた場合は再誘発可能
     ------------------------------------------------------------------ */
  field_mansion: function (ctx, done) {
    const lost = ctx.me.lost;

    // ロストがすべて〈洋館〉かどうか
    const allMansion = lost.every(function (c) { return hasTrait(c, '洋館'); });
    if (!allMansion) {
      ctx.log('不発：ロストに〈洋館〉以外のカードがあります');
      done(); return;
    }

    const before = ctx.me.energy;
    ctx.me.energy = Math.min(10, ctx.me.energy + 1); // 気力上限10
    ctx.log('気力回復：' + ctx.me.label + ' ' + before + ' → ' + ctx.me.energy +
      '（～黒薔薇の館～）');
    done();
  },

};

/* =====================================================================
   効果の呼び出し口
   ---------------------------------------------------------------------
   kind（効果の種類）:
     'enter'     … 【登場時】
     'leave'     … 【場を離れた時】
     'event'     … イベントの使用
     'endTurn'   … フィールドのターン終了時
     'lostThird' … フィールドのロスト3枚目
   ===================================================================== */

const EFFECT_TABLES = {
  enter: ENTER_EFFECTS,
  leave: LEAVE_EFFECTS,
  event: EVENT_EFFECTS,
  endTurn: FIELD_END_TURN_EFFECTS,
  lostThird: FIELD_LOST_THIRD_EFFECTS,
};

Effects.hasEffect = function (kind, cardId) {
  const table = EFFECT_TABLES[kind];
  return !!table && typeof table[cardId] === 'function';
};

Effects.runEffect = function (kind, cardId, ctx, done) {
  const table = EFFECT_TABLES[kind];
  const fn = table ? table[cardId] : null;
  if (typeof fn !== 'function') { done(); return; }
  fn(ctx, done);
};
