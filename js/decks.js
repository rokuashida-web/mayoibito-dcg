/* =====================================================================
   decks.js  ―  固定デッキの中身
   ---------------------------------------------------------------------
   どのカード（id）を、何枚デッキに入れるかをここで決めます。
   カードの中身そのものは cards.js を参照します（ここには書きません）。

   各デッキのデータの意味:
     side          … 陣営の識別子。'village'(村) / 'mansion'(洋館)
     label         … 画面に出す陣営名
     fieldId       … このデッキのフィールドカードの id（40枚には含めない）
     initialHuman  … 初期配置する0コスト人間の id（40枚には含める）
     mainDeck      … メインデッキ40枚の内訳。{ id, count } の配列
                    （count = そのカードの枚数）

   ※ 40枚には initialHuman（スミレ／エリーゼ）を含みます。
   ※ フィールドは40枚に含みません。
   ===================================================================== */

const DECKS = {

  /* ---------------- ヨマモリ村（合計40枚） ---------------- */
  village: {
    side: 'village',
    label: 'ヨマモリ村',
    shortLabel: '村',
    fieldId: 'field_village',
    initialHuman: 'village_sumire',
    mainDeck: [
      // 人間 14枚
      { id: 'village_sumire', count: 1 },   // 0コスト初期人間（40枚に含む）
      { id: 'village_haruka', count: 3 },
      { id: 'village_luna', count: 4 },
      { id: 'village_kaede', count: 3 },
      { id: 'village_rin', count: 3 },
      // 怪異 15枚
      { id: 'village_ichimatsu', count: 4 },
      { id: 'village_kohaku', count: 4 },
      { id: 'village_kakashi', count: 4 },
      { id: 'village_nushi', count: 3 },
      // グッズ 5枚
      { id: 'village_flashlight', count: 3 },
      { id: 'village_ofuda', count: 2 },
      // イベント 6枚
      { id: 'event_kyoukaisen', count: 3 },
      { id: 'village_sashinoberu', count: 3 },
    ],
  },

  /* ---------------- 黒薔薇の館（合計40枚） ---------------- */
  mansion: {
    side: 'mansion',
    label: '黒薔薇の館',
    shortLabel: '洋館',
    fieldId: 'field_mansion',
    initialHuman: 'mansion_elise',
    mainDeck: [
      // 人間 15枚
      { id: 'mansion_elise', count: 1 },    // 0コスト初期人間（40枚に含む）
      { id: 'mansion_annette', count: 4 },
      { id: 'mansion_emma', count: 3 },
      { id: 'mansion_lily', count: 3 },
      { id: 'mansion_sylvie', count: 4 },
      // 怪異 14枚
      { id: 'mansion_claude', count: 3 },
      { id: 'mansion_chimera', count: 4 },
      { id: 'mansion_armor', count: 4 },
      { id: 'mansion_isabella', count: 3 },
      // グッズ 5枚
      { id: 'mansion_key', count: 3 },
      { id: 'mansion_ring', count: 2 },
      // イベント 6枚
      { id: 'event_kyoukaisen', count: 3 },
      { id: 'mansion_sakuryaku', count: 3 },
    ],
  },

};

/* このファイルは <script> 読み込みで使うため、
   グローバル変数 DECKS として他ファイルから参照します。 */
