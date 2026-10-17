/**
 * cardsData.js
 * 全180種類のカードマスターデータ、属性相性、種族ボーナス、出現率・スタッツ生成定義 (完全修正版)
 */

// レアリティ設定 (各スタッツの最低値 minStat)
const RARITY_SETTINGS = {
  common: { name: 'コモン', statsTotal: 10, cost: 2, minStat: 1, color: '#94a3b8' },
  uncommon: { name: 'アンコモン', statsTotal: 20, cost: 4, minStat: 2, color: '#22c55e' },
  rare: { name: 'レア', statsTotal: 30, cost: 6, minStat: 3, color: '#38bdf8' },
  epic: { name: 'エピック', statsTotal: 40, cost: 8, minStat: 4, color: '#a855f7' },
  legend: { name: 'レジェンド', statsTotal: 50, cost: 10, minStat: 5, color: '#facc15' }
};

// ラウンド別レアリティ出現率テーブル
const RARITY_RATES_BY_ROUND = {
  early: { // ラウンド1～4
    common: 0.45,
    uncommon: 0.25,
    rare: 0.15,
    epic: 0.10,
    legend: 0.05
  },
  late: { // ラウンド5以降
    common: 0.25,
    uncommon: 0.225,
    rare: 0.20,
    epic: 0.175,
    legend: 0.15
  }
};

function getRarityRatesForRound(round) {
  return round >= 5 ? RARITY_RATES_BY_ROUND.late : RARITY_RATES_BY_ROUND.early;
}

// 命中率 ((100 - (25 / 3))%) = 91.66666...%
const BATTLE_HIT_RATE = (100 - (25 / 3)) / 100;

// 属性相性表 (攻撃側 -> { weak: 与ダメ2倍になる対象, resist: 与ダメ0.5倍になる対象 })
const ELEMENT_RELATIONS = {
  '火': { weak: '氷', resist: '風' },
  '氷': { weak: '風', resist: '火' },
  '風': { weak: '火', resist: '氷' },
  '雷': { weak: '水', resist: '地' },
  '水': { weak: '地', resist: '雷' },
  '地': { weak: '雷', resist: '水' }
};

function getWeaknessElement(defElement) {
  for (const [atkElem, rel] of Object.entries(ELEMENT_RELATIONS)) {
    if (rel.weak === defElement) {
      return atkElem;
    }
  }
  return null;
}

// 種族ボーナス設定 (百分率整数)
const TRIBE_BONUSES = {
  'ドワーフ': { target: ['hp'], percent: 10 },
  'ドラゴン': { target: ['atk'], percent: 10 },
  'エルフ': { target: ['spd'], percent: 10 },
  'オーク': { target: ['hp', 'atk'], percent: 5 },
  'ヴァンパイア': { target: ['hp', 'spd'], percent: 5 },
  'リザードマン': { target: ['atk', 'spd'], percent: 5 }
};

function applyPercentRoundHalfUp(val, percent) {
  return Math.floor((val * (100 + percent) + 50) / 100);
}

// 全180種類カードマスタ
const CARD_MASTER = [
  // ===================== 1. 火属性 (Fire) =====================
  { id: 'fire_dragon_1', element: '火', tribe: 'ドラゴン', rarity: 'common', name: '焔のトカゲ竜 (Flame Hatchling)' },
  { id: 'fire_dragon_2', element: '火', tribe: 'ドラゴン', rarity: 'uncommon', name: '灼熱のスカイブレイド (Scalding Skyblade)' },
  { id: 'fire_dragon_3', element: '火', tribe: 'ドラゴン', rarity: 'rare', name: '業火の紅蓮竜 (Crimson Drake of Inferno)' },
  { id: 'fire_dragon_4', element: '火', tribe: 'ドラゴン', rarity: 'epic', name: '噴煙を纏う火山竜 (Volcano Wyrm of Ruin)' },
  { id: 'fire_dragon_5', element: '火', tribe: 'ドラゴン', rarity: 'legend', name: '終焉の星火・インフェルノス (Infernus, the Ending Spark)' },
  { id: 'fire_dwarf_1', element: '火', tribe: 'ドワーフ', rarity: 'common', name: '見習い鍛冶屋 (Apprentice Blacksmith)' },
  { id: 'fire_dwarf_2', element: '火', tribe: 'ドワーフ', rarity: 'uncommon', name: '熔岩の炉番 (Lava Hearthkeeper)' },
  { id: 'fire_dwarf_3', element: '火', tribe: 'ドワーフ', rarity: 'rare', name: '鋼鉄槌の溶接師 (Ironhammer Welder)' },
  { id: 'fire_dwarf_4', element: '火', tribe: 'ドワーフ', rarity: 'epic', name: '灼熱の炉心戦士 (Forge-Core Vanguard)' },
  { id: 'fire_dwarf_5', element: '火', tribe: 'ドワーフ', rarity: 'legend', name: '神焔の鍛冶神・ヘファスト (Hephast, God of Divine Flame)' },
  { id: 'fire_elf_1', element: '火', tribe: 'エルフ', rarity: 'common', name: '焔刃のエルフ (Flameblade Elf)' },
  { id: 'fire_elf_2', element: '火', tribe: 'エルフ', rarity: 'uncommon', name: '灰燼の射手 (Ashwood Archer)' },
  { id: 'fire_elf_3', element: '火', tribe: 'エルフ', rarity: 'rare', name: '焦土の精霊使 (Scorched Elementalist)' },
  { id: 'fire_elf_4', element: '火', tribe: 'エルフ', rarity: 'epic', name: '太陽の熾天使長 (Solar Arch-Seraph)' },
  { id: 'fire_elf_5', element: '火', tribe: 'エルフ', rarity: 'legend', name: '不滅の鳳凰姫・イグニス (Ignis, Phoenix Empress)' },
  { id: 'fire_orc_1', element: '火', tribe: 'オーク', rarity: 'common', name: '突撃の火炎兵 (Flambearer Grunt)' },
  { id: 'fire_orc_2', element: '火', tribe: 'オーク', rarity: 'uncommon', name: '爆炎の狂戦士 (Explosive Berserker)' },
  { id: 'fire_orc_3', element: '火', tribe: 'オーク', rarity: 'rare', name: '熔岩流の突撃隊長 (Lava-Stream Warlord)' },
  { id: 'fire_orc_4', element: '火', tribe: 'オーク', rarity: 'epic', name: '焼尽の拳聖 (Scorching Pit-Fighter)' },
  { id: 'fire_orc_5', element: '火', tribe: 'オーク', rarity: 'legend', name: '世界を焼く巨魁・バグラッシュ (Bagrash, World-Burner)' },
  { id: 'fire_vampire_1', element: '火', tribe: 'ヴァンパイア', rarity: 'common', name: '赤月の小鬼 (Crimson Moon Spawn)' },
  { id: 'fire_vampire_2', element: '火', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '緋焔の貴族 (Scarlet Noble)' },
  { id: 'fire_vampire_3', element: '火', tribe: 'ヴァンパイア', rarity: 'rare', name: '鮮血の魔炎術士 (Blood-Flame Sorcerer)' },
  { id: 'fire_vampire_4', element: '火', tribe: 'ヴァンパイア', rarity: 'epic', name: '煉獄の夜会主 (Purgatory Duke)' },
  { id: 'fire_vampire_5', element: '火', tribe: 'ヴァンパイア', rarity: 'legend', name: '血塗られた紅蓮卿・ヴァルキュリア (Valcuria, Crimson Lord)' },
  { id: 'fire_lizard_1', element: '火', tribe: 'リザードマン', rarity: 'common', name: '砂漠の火蜥蜴人 (Desert Flame-Scout)' },
  { id: 'fire_lizard_2', element: '火', tribe: 'リザードマン', rarity: 'uncommon', name: '炎槍の突撃兵 (Blazing Lancer)' },
  { id: 'fire_lizard_3', element: '火', tribe: 'リザードマン', rarity: 'rare', name: '熔岩鱗の戦士 (Magma-Scale Warrior)' },
  { id: 'fire_lizard_4', element: '火', tribe: 'リザードマン', rarity: 'epic', name: '太陽神の祭司長 (Sun-Priest Overlord)' },
  { id: 'fire_lizard_5', element: '火', tribe: 'リザードマン', rarity: 'legend', name: '灼熱の神竜人・ソラリス (Solaris, Flame-God Saurus)' },

  // ===================== 2. 氷属性 (Ice) =====================
  { id: 'ice_dragon_1', element: '氷', tribe: 'ドラゴン', rarity: 'common', name: '霜降り子竜 (Frost Drake)' },
  { id: 'ice_dragon_2', element: '氷', tribe: 'ドラゴン', rarity: 'uncommon', name: '凍土の翼竜 (Tundra Wyvern)' },
  { id: 'ice_dragon_3', element: '氷', tribe: 'ドラゴン', rarity: 'rare', name: '氷結の白銀竜 (Silver Frost Wyrm)' },
  { id: 'ice_dragon_4', element: '氷', tribe: 'ドラゴン', rarity: 'epic', name: '絶氷の吹雪竜 (Blizzard Dreadnought)' },
  { id: 'ice_dragon_5', element: '氷', tribe: 'ドラゴン', rarity: 'legend', name: '永久凍土の主・グラシアス (Glacias, Sovereign of Permafrost)' },
  { id: 'ice_dwarf_1', element: '氷', tribe: 'ドワーフ', rarity: 'common', name: '氷掘りの作業員 (Ice-Digger Miner)' },
  { id: 'ice_dwarf_2', element: '氷', tribe: 'ドワーフ', rarity: 'uncommon', name: '樹氷の盾持ち (Hoarfrost Shieldbearer)' },
  { id: 'ice_dwarf_3', element: '氷', tribe: 'ドワーフ', rarity: 'rare', name: '凍結槌のルーン師 (Rune-Smith of Absolute Zero)' },
  { id: 'ice_dwarf_4', element: '氷', tribe: 'ドワーフ', rarity: 'epic', name: '零下の重装騎士 (Sub-Zero Juggernaut)' },
  { id: 'ice_dwarf_5', element: '氷', tribe: 'ドワーフ', rarity: 'legend', name: '氷鋼の至高王・ヨトゥン (Jotun, Sovereign of Frozen Steel)' },
  { id: 'ice_elf_1', element: '氷', tribe: 'エルフ', rarity: 'common', name: '霜精のエルフ (Frost-Spirited Elf)' },
  { id: 'ice_elf_2', element: '氷', tribe: 'エルフ', rarity: 'uncommon', name: '氷脈の射手 (Ice-Vein Ranger)' },
  { id: 'ice_elf_3', element: '氷', tribe: 'エルフ', rarity: 'rare', name: '樹氷の巫女 (Priestess of Silver Frost)' },
  { id: 'ice_elf_4', element: '氷', tribe: 'エルフ', rarity: 'epic', name: '氷華の舞踏姫 (Dancer of Eternal Frost)' },
  { id: 'ice_elf_5', element: '氷', tribe: 'エルフ', rarity: 'legend', name: '氷雪の絶対女王・クリスタリア (Crystalia, Absolute Ice Queen)' },
  { id: 'ice_orc_1', element: '氷', tribe: 'オーク', rarity: 'common', name: '凍えた襲撃者 (Freezing Raider)' },
  { id: 'ice_orc_2', element: '氷', tribe: 'オーク', rarity: 'uncommon', name: '氷原の蛮族 (Tundra Barbarian)' },
  // #18-9: 誤字修正
  { id: 'ice_orc_3', element: '氷', tribe: 'オーク', rarity: 'rare', name: '凍土の砕石槌 (Glacier-Smasher)' },
  { id: 'ice_orc_4', element: '氷', tribe: 'オーク', rarity: 'epic', name: '氷結の狂乱者 (Frost-Frenzy Behemoth)' },
  { id: 'ice_orc_5', element: '氷', tribe: 'オーク', rarity: 'legend', name: '吹雪を喚ぶ覇王・フロストボーン (Frostborn, Blizzard Chieftain)' },
  { id: 'ice_vampire_1', element: '氷', tribe: 'ヴァンパイア', rarity: 'common', name: '蒼血の従者 (Cold-Blood Thrall)' },
  { id: 'ice_vampire_2', element: '氷', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '凍てつく棺の貴婦人 (Lady of the Frozen Coffin)' },
  { id: 'ice_vampire_3', element: '氷', tribe: 'ヴァンパイア', rarity: 'rare', name: '氷夜の伯爵 (Count of the Frozen Night)' },
  { id: 'ice_vampire_4', element: '氷', tribe: 'ヴァンパイア', rarity: 'epic', name: '蒼白の吸血姫 (Pale Blood Duchess)' },
  { id: 'ice_vampire_5', element: '氷', tribe: 'ヴァンパイア', rarity: 'legend', name: '氷獄の帝王・ノスフェラトゥ (Nosferatu, Emperor of Cocytus)' },
  { id: 'ice_lizard_1', element: '氷', tribe: 'リザードマン', rarity: 'common', name: '氷湖のスカウト (Ice-Lake Scout)' },
  { id: 'ice_lizard_2', element: '氷', tribe: 'リザードマン', rarity: 'uncommon', name: '凍鱗の槍術士 (Frost-Scale Spearmaster)' },
  { id: 'ice_lizard_3', element: '氷', tribe: 'リザードマン', rarity: 'rare', name: '氷爪の暗殺者 (Glacial Assassin)' },
  { id: 'ice_lizard_4', element: '氷', tribe: 'リザードマン', rarity: 'epic', name: '氷河の巨鱗守護者 (Guardian of the Iceberg)' },
  { id: 'ice_lizard_5', element: '氷', tribe: 'リザードマン', rarity: 'legend', name: '厳冬の氷龍人・フロスガル (Frosgar, Winter God-Dragon)' },

  // ===================== 3. 風属性 (Wind) =====================
  { id: 'wind_dragon_1', element: '風', tribe: 'ドラゴン', rarity: 'common', name: '風駆ける子竜 (Gale Hatchling)' },
  { id: 'wind_dragon_2', element: '風', tribe: 'ドラゴン', rarity: 'uncommon', name: '疾風の翼竜 (Zephyr Wyvern)' },
  { id: 'wind_dragon_3', element: '風', tribe: 'ドラゴン', rarity: 'rare', name: '暴風の翠玉竜 (Emerald Storm Drake)' },
  { id: 'wind_dragon_4', element: '風', tribe: 'ドラゴン', rarity: 'epic', name: '竜巻の天空竜 (Tornado Sky-Lord)' },
  { id: 'wind_dragon_5', element: '風', tribe: 'ドラゴン', rarity: 'legend', name: '蒼空の覇者・ガルダ (Garuda, Emperor of the Azure Sky)' },
  { id: 'wind_dwarf_1', element: '風', tribe: 'ドワーフ', rarity: 'common', name: '風車の番人 (Windmill Keeper)' },
  { id: 'wind_dwarf_2', element: '風', tribe: 'ドワーフ', rarity: 'uncommon', name: '嵐駆けの射撃手 (Storm-Rider Gunner)' },
  { id: 'wind_dwarf_3', element: '風', tribe: 'ドワーフ', rarity: 'rare', name: '烈風の弩弓士 (Gale Crossbowman)' },
  { id: 'wind_dwarf_4', element: '風', tribe: 'ドワーフ', rarity: 'epic', name: '飛空艇の操縦士長 (Captain of the Cloud-Fleet)' },
  { id: 'wind_dwarf_5', element: '風', tribe: 'ドワーフ', rarity: 'legend', name: '疾風の機関王・ゼファー (Zephyr, Engine Master)' },
  { id: 'wind_elf_1', element: '風', tribe: 'エルフ', rarity: 'common', name: '風読みのエルフ (Wind-Reader Elf)' },
  { id: 'wind_elf_2', element: '風', tribe: 'エルフ', rarity: 'uncommon', name: '疾風の軽装兵 (Gale-Foot Scout)' },
  { id: 'wind_elf_3', element: '風', tribe: 'エルフ', rarity: 'rare', name: '嵐を呼ぶ奏者 (Bard of the Tempest)' },
  { id: 'wind_elf_4', element: '風', tribe: 'エルフ', rarity: 'epic', name: '翠緑の風聖女 (Saint of the Emerald Breeze)' },
  { id: 'wind_elf_5', element: '風', tribe: 'エルフ', rarity: 'legend', name: '天空の風神・シルフィード (Sylphid, Empress of Zephyrs)' },
  { id: 'wind_orc_1', element: '風', tribe: 'オーク', rarity: 'common', name: '突風の突撃兵 (Gust Vanguard)' },
  { id: 'wind_orc_2', element: '風', tribe: 'オーク', rarity: 'uncommon', name: '嵐追いの闘士 (Storm-Chasing Brawler)' },
  { id: 'wind_orc_3', element: '風', tribe: 'オーク', rarity: 'rare', name: '疾風の斧術士 (Gale-Axe Berserker)' },
  { id: 'wind_orc_4', element: '風', tribe: 'オーク', rarity: 'epic', name: '竜巻の咆哮者 (Tornado Howler)' },
  { id: 'wind_orc_5', element: '風', tribe: 'オーク', rarity: 'legend', name: '天災をもたらす暴風・ヴォルテックス (Vortex, Scourge of Winds)' },
  { id: 'wind_vampire_1', element: '風', tribe: 'ヴァンパイア', rarity: 'common', name: '蝙蝠の群れ (Swarm of Night Bats)' },
  { id: 'wind_vampire_2', element: '風', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '突風の奇襲者 (Gust Ambush Nightstalker)' },
  { id: 'wind_vampire_3', element: '風', tribe: 'ヴァンパイア', rarity: 'rare', name: '影風の暗殺貴族 (Shadow-Wind Assassin)' },
  { id: 'wind_vampire_4', element: '風', tribe: 'ヴァンパイア', rarity: 'epic', name: '嵐夜の伯爵夫人 (Countess of Stormy Nights)' },
  { id: 'wind_vampire_5', element: '風', tribe: 'ヴァンパイア', rarity: 'legend', name: '幻影と疾風の男爵・ヴェイン (Vane, Phantom of the Storm)' },
  { id: 'wind_lizard_1', element: '風', tribe: 'リザードマン', rarity: 'common', name: '草原の風蜥蜴 (Grassland Wind-Lizard)' },
  { id: 'wind_lizard_2', element: '風', tribe: 'リザードマン', rarity: 'uncommon', name: '飛翔する鱗兵 (Winged Scale-Trooper)' },
  { id: 'wind_lizard_3', element: '風', tribe: 'リザードマン', rarity: 'rare', name: '疾風の跳躍者 (Leaping Gale-Skinner)' },
  { id: 'wind_lizard_4', element: '風', tribe: 'リザードマン', rarity: 'epic', name: '天空を駆ける狩人 (Sky-Dancer Hunter)' },
  { id: 'wind_lizard_5', element: '風', tribe: 'リザードマン', rarity: 'legend', name: '疾風の神鳥人・ククルカン (Kukulkan, God of Sky-Winds)' },

  // ===================== 4. 雷属性 (Thunder) =====================
  { id: 'thunder_dragon_1', element: '雷', tribe: 'ドラゴン', rarity: 'common', name: '放電幼竜 (Spark Hatchling)' },
  { id: 'thunder_dragon_2', element: '雷', tribe: 'ドラゴン', rarity: 'uncommon', name: '迅雷の飛竜 (Lightning Drake)' },
  { id: 'thunder_dragon_3', element: '雷', tribe: 'ドラゴン', rarity: 'rare', name: '雷雲の紫電竜 (Violet Thunder Wyrm)' },
  { id: 'thunder_dragon_4', element: '雷', tribe: 'ドラゴン', rarity: 'epic', name: '轟雷の天神竜 (Thunderstorm Sovereign)' },
  { id: 'thunder_dragon_5', element: '雷', tribe: 'ドラゴン', rarity: 'legend', name: '万雷の創世神・ボルテックス (Vortex, Genesis of Lightning)' },
  { id: 'thunder_dwarf_1', element: '雷', tribe: 'ドワーフ', rarity: 'common', name: '放電技師 (Spark Technician)' },
  { id: 'thunder_dwarf_2', element: '雷', tribe: 'ドワーフ', rarity: 'uncommon', name: '雷光の錘使い (Lightning-Hammer Smith)' },
  { id: 'thunder_dwarf_3', element: '雷', tribe: 'ドワーフ', rarity: 'rare', name: '避雷針の重装甲兵 (Lightning-Rod Sentinel)' },
  { id: 'thunder_dwarf_4', element: '雷', tribe: 'ドワーフ', rarity: 'epic', name: '紫電の動力機甲士 (Arc-Core Automaton)' },
  { id: 'thunder_dwarf_5', element: '雷', tribe: 'ドワーフ', rarity: 'legend', name: '雷神の槌を継ぐ者・トール (Thor, Successor of Mjolnir)' },
  { id: 'thunder_elf_1', element: '雷', tribe: 'エルフ', rarity: 'common', name: '雷光の導師 (Spark Initiate)' },
  { id: 'thunder_elf_2', element: '雷', tribe: 'エルフ', rarity: 'uncommon', name: '紫電の弓手 (Volt-Arrow Ranger)' },
  { id: 'thunder_elf_3', element: '雷', tribe: 'エルフ', rarity: 'rare', name: '閃光の魔導士 (Flash Sorcerer)' },
  { id: 'thunder_elf_4', element: '雷', tribe: 'エルフ', rarity: 'epic', name: '雷鳴の裁き手 (Judgement of Thunder)' },
  { id: 'thunder_elf_5', element: '雷', tribe: 'エルフ', rarity: 'legend', name: '天雷の聖女王・フライヤ (Freyja, Empress of Fulgur)' },
  { id: 'thunder_orc_1', element: '雷', tribe: 'オーク', rarity: 'common', name: '帯電した蛮兵 (Electrified Grunt)' },
  { id: 'thunder_orc_2', element: '雷', tribe: 'オーク', rarity: 'uncommon', name: '雷鳴の太鼓打者 (Thunder-Drummer)' },
  { id: 'thunder_orc_3', element: '雷', tribe: 'オーク', rarity: 'rare', name: '迅雷の狂戦士 (Lightning Berserker)' },
  { id: 'thunder_orc_4', element: '雷', tribe: 'オーク', rarity: 'epic', name: '轟雷の巨魁 (Thunder-Crash Behemoth)' },
  { id: 'thunder_orc_5', element: '雷', tribe: 'オーク', rarity: 'legend', name: '天雷を穿つ覇王・ライジン (Raijin, Thunder-Clad Overlord)' },
  { id: 'thunder_vampire_1', element: '雷', tribe: 'ヴァンパイア', rarity: 'common', name: '紫電の従者 (Volt Thrall)' },
  { id: 'thunder_vampire_2', element: '雷', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '雷光の夜襲者 (Flash Nightstalker)' },
  { id: 'thunder_vampire_3', element: '雷', tribe: 'ヴァンパイア', rarity: 'rare', name: '迅雷の血族 (Lightning Bloodline)' },
  { id: 'thunder_vampire_4', element: '雷', tribe: 'ヴァンパイア', rarity: 'epic', name: '紫電の夜会主 (Lord of Thunderous Blood)' },
  { id: 'thunder_vampire_5', element: '雷', tribe: 'ヴァンパイア', rarity: 'legend', name: '閃光の吸血皇・アルカード (Alucard, Fulgur Emperor)' },
  { id: 'thunder_lizard_1', element: '雷', tribe: 'リザードマン', rarity: 'common', name: '放電の沼地蜥蜴 (Spark-Swamp Lizard)' },
  { id: 'thunder_lizard_2', element: '雷', tribe: 'リザードマン', rarity: 'uncommon', name: '雷槍の守護兵 (Volt-Spear Guard)' },
  { id: 'thunder_lizard_3', element: '雷', tribe: 'リザードマン', rarity: 'rare', name: '紫電の呪術師 (Arc Shaman)' },
  { id: 'thunder_lizard_4', element: '雷', tribe: 'リザードマン', rarity: 'epic', name: '轟雷の龍鱗将軍 (Thunder-Scale General)' },
  // #18-9: 英語名修正
  { id: 'thunder_lizard_5', element: '雷', tribe: 'リザードマン', rarity: 'legend', name: '迅雷の雷神竜人・インドラ (Indra, the Thunderclap Dragonkin)' },

  // ===================== 5. 水属性 (Water) =====================
  { id: 'water_dragon_1', element: '水', tribe: 'ドラゴン', rarity: 'common', name: '水棲の小竜 (Aquatic Hatchling)' },
  { id: 'water_dragon_2', element: '水', tribe: 'ドラゴン', rarity: 'uncommon', name: '潮汐の海竜 (Tidal Sea-Wyrm)' },
  { id: 'water_dragon_3', element: '水', tribe: 'ドラゴン', rarity: 'rare', name: '蒼海の碧玉竜 (Sapphire Ocean Drake)' },
  { id: 'water_dragon_4', element: '水', tribe: 'ドラゴン', rarity: 'epic', name: '深海の渦潮竜 (Abyssal Leviathan)' },
  { id: 'water_dragon_5', element: '水', tribe: 'ドラゴン', rarity: 'legend', name: '始原の海神竜・リヴァイアサン (Leviathan, Primeval Sea-God)' },
  { id: 'water_dwarf_1', element: '水', tribe: 'ドワーフ', rarity: 'common', name: '港町の水夫 (Port-Town Sailor)' },
  { id: 'water_dwarf_2', element: '水', tribe: 'ドワーフ', rarity: 'uncommon', name: '潜水工作員 (Diving Engineer)' },
  { id: 'water_dwarf_3', element: '水', tribe: 'ドワーフ', rarity: 'rare', name: '水流のルーン師 (Hydro-Rune Craftsman)' },
  { id: 'water_dwarf_4', element: '水', tribe: 'ドワーフ', rarity: 'epic', name: '深海探査艇の船長 (Abyssal Sub-Captain)' },
  { id: 'water_dwarf_5', element: '水', tribe: 'ドワーフ', rarity: 'legend', name: '怒濤の海王・ネプチューン (Neptune, Emperor of the Tides)' },
  { id: 'water_elf_1', element: '水', tribe: 'エルフ', rarity: 'common', name: '泉の乙女 (Spring Maiden)' },
  { id: 'water_elf_2', element: '水', tribe: 'エルフ', rarity: 'uncommon', name: '水鏡の射手 (Water-Mirror Archer)' },
  { id: 'water_elf_3', element: '水', tribe: 'エルフ', rarity: 'rare', name: '潮騒の歌姫 (Mermaid Sirene)' },
  { id: 'water_elf_4', element: '水', tribe: 'エルフ', rarity: 'epic', name: '浄化の清聖女 (Saint of Purifying Streams)' },
  { id: 'water_elf_5', element: '水', tribe: 'エルフ', rarity: 'legend', name: '蒼海のエレメンタルクイーン・アクア (Aqua, Sovereign Queen)' },
  { id: 'water_orc_1', element: '水', tribe: 'オーク', rarity: 'common', name: '湿地帯の襲撃者 (Swamp Raider)' },
  { id: 'water_orc_2', element: '水', tribe: 'オーク', rarity: 'uncommon', name: '怒濤の突撃兵 (Tidal Wave Charger)' },
  { id: 'water_orc_3', element: '水', tribe: 'オーク', rarity: 'rare', name: '渦潮の銛使い (Whirlpool Harpooner)' },
  { id: 'water_orc_4', element: '水', tribe: 'オーク', rarity: 'epic', name: '深海の蛮族長 (Abyssal Chieftain)' },
  { id: 'water_orc_5', element: '水', tribe: 'オーク', rarity: 'legend', name: '海溝を統べる覇者・クラーケン (Kraken, Lord of the Trench)' },
  { id: 'water_vampire_1', element: '水', tribe: 'ヴァンパイア', rarity: 'common', name: '霧の従者 (Mist Thrall)' },
  { id: 'water_vampire_2', element: '水', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '湖畔の血族 (Lakeside Noble)' },
  { id: 'water_vampire_3', element: '水', tribe: 'ヴァンパイア', rarity: 'rare', name: '蒼月の吸血鬼 (Azure Moon Vampire)' },
  { id: 'water_vampire_4', element: '水', tribe: 'ヴァンパイア', rarity: 'epic', name: '深淵の霧の男爵 (Baron of Abyssal Mists)' },
  { id: 'water_vampire_5', element: '水', tribe: 'ヴァンパイア', rarity: 'legend', name: '血潮と霧の支配者・カーミラ (Carmilla, Sovereign of Blood Mists)' },
  { id: 'water_lizard_1', element: '水', tribe: 'リザードマン', rarity: 'common', name: '水辺の斥候 (Waterside Scout)' },
  { id: 'water_lizard_2', element: '水', tribe: 'リザードマン', rarity: 'uncommon', name: '潮鱗の潜水兵 (Tide-Scale Diver)' },
  { id: 'water_lizard_3', element: '水', tribe: 'リザードマン', rarity: 'rare', name: '水流の槍術士 (Torrent Spearmaster)' },
  { id: 'water_lizard_4', element: '水', tribe: 'リザードマン', rarity: 'epic', name: '怒濤の大海将 (Tidal General)' },
  { id: 'water_lizard_5', element: '水', tribe: 'リザードマン', rarity: 'legend', name: '水神の化身・ポセイドニオス (Poseidonios, Incarnation of Water)' },

  // ===================== 6. 地属性 (Earth) =====================
  { id: 'earth_dragon_1', element: '地', tribe: 'ドラゴン', rarity: 'common', name: '岩石の小竜 (Rock Hatchling)' },
  { id: 'earth_dragon_2', element: '地', tribe: 'ドラゴン', rarity: 'uncommon', name: '泥岩の地竜 (Mud-Rock Earth Drake)' },
  { id: 'earth_dragon_3', element: '地', tribe: 'ドラゴン', rarity: 'rare', name: '金剛石の巨竜 (Diamond Ridge Wyrm)' },
  { id: 'earth_dragon_4', element: '地', tribe: 'ドラゴン', rarity: 'epic', name: '地響きの巨龍 (Earth-Quake Behemoth)' },
  { id: 'earth_dragon_5', element: '地', tribe: 'ドラゴン', rarity: 'legend', name: '大地そのものの覚醒・ガイア (Gaia, Awakening of the World)' },
  { id: 'earth_dwarf_1', element: '地', tribe: 'ドワーフ', rarity: 'common', name: '鉱石掘り (Ore Digger)' },
  { id: 'earth_dwarf_2', element: '地', tribe: 'ドワーフ', rarity: 'uncommon', name: '岩塩の護衛兵 (Rock-Salt Guard)' },
  { id: 'earth_dwarf_3', element: '地', tribe: 'ドワーフ', rarity: 'rare', name: '金剛石の盾術士 (Diamond Shieldmaster)' },
  { id: 'earth_dwarf_4', element: '地', tribe: 'ドワーフ', rarity: 'epic', name: '大地の巨槌将 (Mighty Hammer-General)' },
  { id: 'earth_dwarf_5', element: '地', tribe: 'ドワーフ', rarity: 'legend', name: '鉱山郷の創世王・ゴルゴン (Gorgon, King of the Under-Forge)' },
  { id: 'earth_elf_1', element: '地', tribe: 'エルフ', rarity: 'common', name: '樹木を育てる者 (Wood-Caretaker)' },
  { id: 'earth_elf_2', element: '地', tribe: 'エルフ', rarity: 'uncommon', name: '密林の守護者 (Jungle Guardian)' },
  { id: 'earth_elf_3', element: '地', tribe: 'エルフ', rarity: 'rare', name: '大地の薬師 (Druid of the Earth)' },
  { id: 'earth_elf_4', element: '地', tribe: 'エルフ', rarity: 'epic', name: '霊樹の大巫女 (High Priestess of the World-Tree)' },
  { id: 'earth_elf_5', element: '地', tribe: 'エルフ', rarity: 'legend', name: '世界樹の守護女神・ドリアード (Dryad, Goddess of Yggdrasil)' },
  { id: 'earth_orc_1', element: '地', tribe: 'オーク', rarity: 'common', name: '岩を投げる者 (Rock-Throwing Grunt)' },
  { id: 'earth_orc_2', element: '地', tribe: 'オーク', rarity: 'uncommon', name: '崖っぷちの蛮者 (Cliffside Barbarian)' },
  { id: 'earth_orc_3', element: '地', tribe: 'オーク', rarity: 'rare', name: '大地砕きの突爆兵 (Earth-Crusher)' },
  { id: 'earth_orc_4', element: '地', tribe: 'オーク', rarity: 'epic', name: '金剛の巨魁 (Adamantine Behemoth)' },
  { id: 'earth_orc_5', element: '地', tribe: 'オーク', rarity: 'legend', name: '山脈を動かす者・ギガント (Gigant, Sovereign of Mountains)' },
  { id: 'earth_vampire_1', element: '地', tribe: 'ヴァンパイア', rarity: 'common', name: '墓場の番人 (Graveyard Watcher)' },
  { id: 'earth_vampire_2', element: '地', tribe: 'ヴァンパイア', rarity: 'uncommon', name: '暗石の使徒 (Dark-Stone Apostle)' },
  { id: 'earth_vampire_3', element: '地', tribe: 'ヴァンパイア', rarity: 'rare', name: '地底の血族 (Underground Vampire)' },
  { id: 'earth_vampire_4', element: '地', tribe: 'ヴァンパイア', rarity: 'epic', name: '古代墓穴の伯爵 (Count of Ancient Tombs)' },
  { id: 'earth_vampire_5', element: '地', tribe: 'ヴァンパイア', rarity: 'legend', name: '冥界の土を司る者・ハデス (Hades, Lord of the Underworld)' },
  { id: 'earth_lizard_1', element: '地', tribe: 'リザードマン', rarity: 'common', name: '荒野の蜥蜴人 (Wasteland Lizard-Ranger)' },
  { id: 'earth_lizard_2', element: '地', tribe: 'リザードマン', rarity: 'uncommon', name: '硬鱗の防衛兵 (Hard-Scale Defender)' },
  { id: 'earth_lizard_3', element: '地', tribe: 'リザードマン', rarity: 'rare', name: '岩石の重槌士 (Rock-Mace Vanguard)' },
  { id: 'earth_lizard_4', element: '地', tribe: 'リザードマン', rarity: 'epic', name: '砂漠の大首長 (Grand Chieftain of the Dunes)' },
  // #18-9: 既存IP類似回避のための名称変更
  { id: 'earth_lizard_5', element: '地', tribe: 'リザードマン', rarity: 'legend', name: '大地の蜥蜴王ガイア・ゾルダ (Gaia Zolda, the Earthscale Sovereign)' }
];

/**
 * 4: レアリティごとの最低値(minStat)を保証した上で合計(total)を公平に配分
 */
function generateRandomStats(total, minStat = 1) {
  const surplus = total - (minStat * 3);
  if (surplus <= 0) {
    return { hp: minStat, atk: minStat, spd: minStat };
  }

  let c1 = Math.floor(Math.random() * (surplus + 2));
  let c2 = Math.floor(Math.random() * (surplus + 1));
  if (c2 >= c1) c2++;

  const cut1 = Math.min(c1, c2);
  const cut2 = Math.max(c1, c2);

  const p1 = cut1;
  const p2 = cut2 - cut1 - 1;
  const p3 = surplus - p1 - p2;

  const parts = [p1, p2, p3];

  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return {
    hp: minStat + parts[0],
    atk: minStat + parts[1],
    spd: minStat + parts[2]
  };
}

/**
 * 5: ショップ用カード生成 (ラウンド別出現率を適用)
 */
function createRandomShopCard(round = 1) {
  const rates = getRarityRatesForRound(round);
  const rand = Math.random();
  let cumulative = 0;
  let rarity = 'common';

  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legend'];
  for (const r of rarities) {
    cumulative += rates[r];
    if (rand <= cumulative) {
      rarity = r;
      break;
    }
  }

  const setting = RARITY_SETTINGS[rarity];
  const pool = CARD_MASTER.filter(c => c.rarity === rarity);
  const base = pool[Math.floor(Math.random() * pool.length)];
  const stats = generateRandomStats(setting.statsTotal, setting.minStat);

  return {
    uid: 'card_' + Math.random().toString(36).substring(2, 9),
    masterId: base.id,
    name: base.name,
    element: base.element,
    tribe: base.tribe,
    rarity: base.rarity,
    cost: setting.cost,
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    spd: stats.spd,
    totalStats: setting.statsTotal,
    starCount: 1
  };
}

/**
 * 5: ラウンド開始時配布カード生成
 */
function createRandomDistributedCard(round) {
  const rates = getRarityRatesForRound(round);
  const availableRarities = ['common'];
  if (round >= 2) availableRarities.push('uncommon');
  if (round >= 3) availableRarities.push('rare');
  if (round >= 4) availableRarities.push('epic');
  if (round >= 5) availableRarities.push('legend');

  let totalWeight = 0;
  availableRarities.forEach(r => {
    totalWeight += rates[r];
  });

  const rand = Math.random() * totalWeight;
  let cumulative = 0;
  let chosenRarity = availableRarities[0];

  for (const r of availableRarities) {
    cumulative += rates[r];
    if (rand <= cumulative) {
      chosenRarity = r;
      break;
    }
  }

  const setting = RARITY_SETTINGS[chosenRarity];
  const pool = CARD_MASTER.filter(c => c.rarity === chosenRarity);
  const base = pool[Math.floor(Math.random() * pool.length)];
  const stats = generateRandomStats(setting.statsTotal, setting.minStat);

  return {
    uid: 'card_' + Math.random().toString(36).substring(2, 9),
    masterId: base.id,
    name: base.name,
    element: base.element,
    tribe: base.tribe,
    rarity: base.rarity,
    cost: setting.cost,
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    spd: stats.spd,
    totalStats: setting.statsTotal,
    starCount: 1
  };
}

module.exports = {
  RARITY_SETTINGS,
  RARITY_RATES_BY_ROUND,
  getRarityRatesForRound,
  BATTLE_HIT_RATE,
  ELEMENT_RELATIONS,
  getWeaknessElement,
  TRIBE_BONUSES,
  applyPercentRoundHalfUp,
  CARD_MASTER,
  generateRandomStats,
  createRandomShopCard,
  createRandomDistributedCard
};