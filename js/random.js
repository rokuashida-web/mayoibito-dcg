/* =====================================================================
   random.js  ―  シード付き疑似乱数
   ---------------------------------------------------------------------
   このゲームでは、シャッフルなどの「ランダムな処理」を必ずこのファイルの
   乱数だけで行います。ブラウザ標準の Math.random() は一切使いません。
   （Math.imul / Math.floor は「計算用の関数」なので使用します。
     ランダムの種になるのは、あくまで下の疑似乱数だけです。）

   なぜシード（種）を使うのか:
     同じ「シード文字列」から作った乱数は、毎回まったく同じ順番の数を返します。
     そのため「同じシード＋同じ操作」なら、いつやっても同じ試合になり、
     バグの再現やテストがしやすくなります（仕様書 2.5）。
   ===================================================================== */

'use strict';

/**
 * シード文字列から疑似乱数生成器を作る。
 * @param {string|number} seedStr - シード（文字列でも数値でもよい）
 * @returns {object} next()/int(n)/shuffle(arr) を持つ乱数オブジェクト
 */
function createRng(seedStr) {
  const text = String(seedStr);

  // --- 文字列を32bitの数値に変換する（xmur3 という有名な方法）---
  // 文字列が1文字でも違えば、まったく違う種になる。
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  const seedFn = xmur3(text);
  let a = seedFn(); // 種の数値

  // --- 種から次々に 0以上1未満 の数を作る（mulberry32 という有名な方法）---
  function mulberry32() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    // 0以上1未満のランダムな小数を返す
    next: function () {
      return mulberry32();
    },

    // 0以上 n未満 の整数を返す
    int: function (n) {
      return Math.floor(mulberry32() * n);
    },

    /**
     * 配列をその場でシャッフルする（フィッシャー・イェーツ法）。
     * 同じ乱数（同じシード・同じ呼び出し順）なら、必ず同じ並びになる。
     */
    shuffle: function (arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

/**
 * シードが空欄のときに、自動でシード文字列を作る。
 * ・ゲームのランダム処理には使わず、「種の文字列そのもの」を作るだけ。
 * ・同じ文字列を後から入力すれば、同じ試合を再現できる。
 * ・Math.random は使わず、時刻から作る（例：MAYO-1A2B-3C4D）。
 */
function autoGenerateSeed() {
  const t1 = Date.now().toString(36);
  const perf = (typeof performance !== 'undefined' && performance.now)
    ? Math.floor(performance.now() * 1000).toString(36)
    : '';
  // 使える文字（A-Z0-9）だけにそろえる
  const raw = (t1 + perf).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // raw の「後ろ8文字」を使う（後ろのほうが時刻の変化が出やすい）。
  // 万一8文字に満たないときだけ 0 で埋めて、必ず8文字にする。
  const s = (raw.slice(-8) + '00000000').slice(0, 8);
  return 'MAYO-' + s.slice(0, 4) + '-' + s.slice(4, 8);
}

/* このファイルは <script> 読み込みで使うため、
   createRng / autoGenerateSeed をグローバル関数として他ファイルから参照します。 */
