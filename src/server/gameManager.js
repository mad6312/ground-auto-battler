/**
 * src/server/gameManager.js
 * プレイヤーおよび全体ゲーム状態の管理モジュール (仕様改修版)
 */

const { createRandomShopCard, createRandomDistributedCard, TRIBE_BONUSES, RARITY_SETTINGS } = require('../../cardsData');

// 手札自動整列の順序定義
const RARITY_ORDER = { common: 1, uncommon: 2, rare: 3, epic: 4, legend: 5 };
const TRIBE_ORDER = { 'ドワーフ': 1, 'ドラゴン': 2, 'エルフ': 3, 'オーク': 4, 'ヴァンパイア': 5, 'リザードマン': 6 };
const ELEMENT_ORDER = { '火': 1, '氷': 2, '風': 3, '雷': 4, '水': 5, '地': 6 };

function sortHandCards(hand) {
    return hand.sort((a, b) => {
        const rA = RARITY_ORDER[a.rarity] || 99;
        const rB = RARITY_ORDER[b.rarity] || 99;
        if (rA !== rB) return rA - rB;

        const tA = TRIBE_ORDER[a.tribe] || 99;
        const tB = TRIBE_ORDER[b.tribe] || 99;
        if (tA !== tB) return tA - tB;

        const eA = ELEMENT_ORDER[a.element] || 99;
        const eB = ELEMENT_ORDER[b.element] || 99;
        return eA - eB;
    });
}

function calculatePlayerTribeBuffedCards(cardsToBuff, allPlayerCards) {
    const tribeCounts = {};
    allPlayerCards.forEach(c => {
        if (c) tribeCounts[c.tribe] = (tribeCounts[c.tribe] || 0) + 1;
    });

    return cardsToBuff.map(card => {
        if (!card) return null;
        const c = JSON.parse(JSON.stringify(card));
        const count = tribeCounts[c.tribe] || 1;
        c.isHpBuffed = false;
        c.isAtkBuffed = false;
        c.isSpdBuffed = false;

        if (count >= 2 && TRIBE_BONUSES[c.tribe]) {
            const bonus = TRIBE_BONUSES[c.tribe];
            const factor = 1 + (count - 1) * bonus.factor;
            // 4: 小数点以下四捨五入に変更
            if (bonus.target.includes('hp')) {
                c.hp = Math.round(c.hp * factor);
                c.maxHp = c.hp;
                c.isHpBuffed = true;
            }
            if (bonus.target.includes('atk')) {
                c.atk = Math.round(c.atk * factor);
                c.isAtkBuffed = true;
            }
            if (bonus.target.includes('spd')) {
                c.spd = Math.round(c.spd * factor);
                c.isSpdBuffed = true;
            }
        }
        return c;
    });
}

class Player {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.isEntered = false;
        this.life = 5;
        this.gold = 20;
        this.hand = [];
        this.selectedLineup = []; // 出撃予定カード (最大3枚)
        this.shop = [];
        this.isReady = false;
        this.hasClickedNext = false;
        this.isAlive = true;
        this.rank = null;
        this.lastRoundInfo = null;
        this.purchasedMarketUids = new Set();
    }

    initRoundShop() {
        this.purchasedMarketUids.clear();
        if (this.shop.length === 0) {
            for (let i = 0; i < 6; i++) {
                this.shop.push({ card: createRandomShopCard(), locked: false });
            }
        } else {
            for (let i = 0; i < 6; i++) {
                if (!this.shop[i].locked) {
                    this.shop[i] = { card: createRandomShopCard(), locked: false };
                }
            }
        }
    }

    rerollShop() {
        if (this.gold < 2) return false;
        this.gold -= 2;
        for (let i = 0; i < 6; i++) {
            if (!this.shop[i].locked) {
                this.shop[i] = { card: createRandomShopCard(), locked: false };
            }
        }
        return true;
    }

    sortHand() {
        this.hand = sortHandCards(this.hand);
    }
}

class GameManager {
    constructor() {
        this.players = {}; // socket.id -> Player
        this.hostSocketId = null;
        this.gameState = 'lobby'; // 'lobby' | 'prep' | 'battle' | 'ended'
        this.round = 1;
        this.pendingDiscards = [];
        this.activeMarketCards = [];
        this.allBattlesData = {};
        this.roundMatchups = {};
        this.disconnectedPlayers = [];
        this.matchHistory = {};
    }

    addPlayer(id, name) {
        const p = new Player(id, name);
        this.players[id] = p;
        if (!this.matchHistory[id]) {
            this.matchHistory[id] = new Set();
        }
        this.updateHost();
        return p;
    }

    removePlayer(id) {
        const p = this.players[id];
        if (p && this.gameState !== 'lobby' && p.isEntered) {
            this.disconnectedPlayers.push({ name: p.name });
        }
        delete this.players[id];
        this.updateHost();

        if (Object.keys(this.players).length === 0) {
            this.resetLobbyCompletely();
        }
        return p;
    }

    resetLobbyCompletely() {
        this.gameState = 'lobby';
        this.round = 1;
        this.pendingDiscards = [];
        this.activeMarketCards = [];
        this.allBattlesData = {};
        this.roundMatchups = {};
        this.disconnectedPlayers = [];
        this.matchHistory = {};
        this.hostSocketId = null;
    }

    getPlayer(id) {
        return this.players[id];
    }

    updateHost() {
        const ids = Object.keys(this.players);
        if (ids.length === 0) {
            this.hostSocketId = null;
        } else if (!this.hostSocketId || !this.players[this.hostSocketId]) {
            this.hostSocketId = ids[0];
        }
    }

    getPublicPlayerList() {
        return Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            isEntered: p.isEntered,
            life: p.life,
            gold: p.gold,
            isReady: p.isReady,
            isAlive: p.isAlive,
            isHost: p.id === this.hostSocketId,
            handCount: p.hand.length,
            lastRoundInfo: p.lastRoundInfo
        }));
    }

    recordMatch(p1Id, p2Id, originalGhostId = null) {
        if (!this.matchHistory[p1Id]) this.matchHistory[p1Id] = new Set();
        const target2 = originalGhostId || p2Id;
        this.matchHistory[p1Id].add(target2);

        if (!originalGhostId && this.players[p2Id]) {
            if (!this.matchHistory[p2Id]) this.matchHistory[p2Id] = new Set();
            this.matchHistory[p2Id].add(p1Id);
        }
    }

    resetGameForStart() {
        this.gameState = 'prep';
        this.round = 1;
        this.pendingDiscards = [];
        this.activeMarketCards = [];
        this.disconnectedPlayers = [];
        this.matchHistory = {};

        const entered = Object.values(this.players).filter(p => p.isEntered);
        entered.forEach(p => {
            p.life = 5;
            p.gold = 20;
            p.hand = [];
            p.selectedLineup = [];
            p.isReady = false;
            p.hasClickedNext = false;
            p.isAlive = true;
            this.matchHistory[p.id] = new Set();
            p.initRoundShop();

            // 第1ラウンド配布カード
            const distCard = createRandomDistributedCard(1);
            distCard.isNewDistributed = true;
            p.hand.push(distCard);
            p.sortHand();
        });
    }

    advanceToNextRound() {
        this.round++;
        this.gameState = 'prep';
        this.activeMarketCards = [...this.pendingDiscards];
        this.pendingDiscards = [];

        const remaining = Object.values(this.players).filter(p => p.isAlive && p.isEntered);
        remaining.forEach(p => {
            p.gold += 10;
            p.isReady = false;
            p.hasClickedNext = false;

            // 繰り出しUIから手札へ全回収
            p.selectedLineup = [];

            p.initRoundShop();

            // 配布カード追加
            const distCard = createRandomDistributedCard(this.round);
            distCard.isNewDistributed = true;
            p.hand.push(distCard);
            p.sortHand();
        });
    }

    autoDiscardExcessCards(p) {
        let hasDiscarded = false;
        while (p.hand.length > 6) {
            const deployUids = new Set(p.selectedLineup.map(c => c && c.uid));
            const benchCards = p.hand.filter(c => !deployUids.has(c.uid));
            if (benchCards.length === 0) break;

            const target = benchCards[Math.floor(Math.random() * benchCards.length)];

            // 2: 解雇ゴールド計算方式の変更（購入額 × ★ / 2 または 4、小数点以下切り捨て）
            const cost = RARITY_SETTINGS[target.rarity] ? RARITY_SETTINGS[target.rarity].cost : (target.cost || 2);
            const stars = target.starCount || 1;
            const gainGold = target.isMarketCard
                ? Math.floor((cost * stars) / 4)
                : Math.floor((cost * stars) / 2);

            p.gold += gainGold;
            p.hand = p.hand.filter(c => c.uid !== target.uid);
            this.pendingDiscards.push({
                card: JSON.parse(JSON.stringify(target)),
                sellerId: p.id,
                sellerName: p.name
            });
            hasDiscarded = true;
        }
        if (hasDiscarded) {
            p.sortHand();
        }
        return hasDiscarded;
    }
}

module.exports = {
    Player,
    sortHandCards,
    calculatePlayerTribeBuffedCards,
    gameManager: new GameManager()
};