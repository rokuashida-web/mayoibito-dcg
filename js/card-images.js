/* =====================================================================
   card-images.js  ―  カードIDと画像ファイル名の対応表
   ---------------------------------------------------------------------
   仕様書 11.1：画像ファイル名の管理はこの1か所だけで行います。
   カードID（cards.js のID）は v0.1 から変更していません。

   画像を差し替えたいとき：
     ・同じファイル名で上書きする → ここは編集不要
     ・別の名前にしたい → 下の表の右側だけ書き換える

   1枚のカードに陣営ごとの絵柄がある場合（例：境界線）は、
   { village: '…', mansion: '…' } の形で書けます。
   ===================================================================== */

'use strict';

/** 画像を置いてあるフォルダ */
const CARD_IMAGE_DIR = 'images/';

/** カードID → 画像ファイル名 */
const CARD_IMAGES = {

  /* ---------------- ヨマモリ村 ---------------- */
  village_sumire:      'village_sumire.webp',       // 放課後の帰り道 スミレ
  village_haruka:      'village_haruka.webp',       // 孤独な夜道 ハルカ
  village_luna:        'village_luna.webp',         // 泣き虫転校生 ルナ
  village_kaede:       'village_kaede.webp',        // 負けず嫌い カエデ
  village_rin:         'village_rin.webp',          // 頼れる委員長 リン
  village_ichimatsu:   'village_ichimatsu.webp',    // 寂しがる市松人形
  village_kohaku:      'village_kohaku.webp',       // 狐のお面 コハク
  village_kakashi:     'village_kakashi.webp',      // 朽ちゆく嗤い案山子
  village_nushi:       'village_nushi.webp',        // 山を守るヌシ様
  village_flashlight:  'village_flashlight.webp',   // 懐中電灯
  village_ofuda:       'village_ofuda.webp',        // 古いお札
  village_sashinoberu: 'village_sashinoberu.webp',  // 差し伸べる手
  field_village:       'field_village.webp',        // ～ヨマモリ村～（横長）

  /* ---------------- 黒薔薇の館 ---------------- */
  mansion_elise:       'mansion_elise.webp',        // 屋敷の令嬢 エリーゼ
  mansion_annette:     'mansion_annette.webp',      // 不憫な客人 アネット
  mansion_emma:        'mansion_emma.webp',         // 微笑む使用人 エマ
  mansion_lily:        'mansion_lily.webp',         // 招かれた令嬢 リリィ
  mansion_sylvie:      'mansion_sylvie.webp',       // 寡黙な使用人 シルヴィ
  mansion_claude:      'mansion_claude.webp',       // 紫炎の執事 クロード
  mansion_chimera:     'mansion_chimera.webp',      // 地下室に棲むキメラ
  mansion_armor:       'mansion_armor.webp',        // 彷徨う亡霊甲冑
  mansion_isabella:    'mansion_isabella.webp',     // 企む貴婦人 イザベラ
  mansion_key:         'mansion_key.webp',          // 小さな鍵
  mansion_ring:        'mansion_ring.webp',         // 黒い指輪
  mansion_sakuryaku:   'mansion_sakuryaku.webp',    // 黒薔薇の策略
  field_mansion:       'field_mansion.webp',        // ～黒薔薇の館～（横長）

  /* ---------------- 共通 ----------------
     境界線は村・洋館の両デッキに入ります。
     いただいた画像が2種類あったため、持ち主の陣営で出し分けています。
     どちらか1枚に統一する場合は、文字列1つに書き換えてください。 */
  event_kyoukaisen: {
    village: 'event_kyoukaisen_village.webp',
    mansion: 'event_kyoukaisen_mansion.webp',
  },
};

/**
 * カードの裏面画像。
 * まだ用意していないため null にしてあります。
 * 用意できたら images/ に置いて、ここにファイル名を書けば反映されます。
 * 例： const CARD_BACK_IMAGE = 'card_back.webp';
 */
const CARD_BACK_IMAGE = null;

/** 横長で作られているカード（フィールドカード）。表示枠の形を変えるために使う */
const LANDSCAPE_CARDS = ['field_village', 'field_mansion'];

/* =====================================================================
   取り出し用の関数
   ===================================================================== */

/**
 * カードの画像パスを返す。画像が無ければ null。
 * @param {string} cardId  カードID
 * @param {string} [owner] 'village' または 'mansion'（陣営別の絵柄がある場合に使う）
 */
function getCardImagePath(cardId, owner) {
  const entry = CARD_IMAGES[cardId];
  if (!entry) return null;

  if (typeof entry === 'string') return CARD_IMAGE_DIR + entry;

  // 陣営ごとに絵柄がある場合
  const file = entry[owner] || entry.village || entry.mansion;
  return file ? (CARD_IMAGE_DIR + file) : null;
}

/** 裏面画像のパス。未用意なら null（その場合は仮の裏面を表示する） */
function getCardBackPath() {
  return CARD_BACK_IMAGE ? (CARD_IMAGE_DIR + CARD_BACK_IMAGE) : null;
}

/** 横長のカードかどうか */
function isLandscapeCard(cardId) {
  return LANDSCAPE_CARDS.indexOf(cardId) !== -1;
}
