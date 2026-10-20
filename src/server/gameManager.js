/**
 * src/server/gameManager.js
 * プレイヤーおよび全体ゲーム状態の管理モジュール (前ラウンド情報ライフサイクル適正化版)
 */

const crypto = require('crypto');
const {
    createRandomShopCard,
    createRandomDistributedCard,
    TRIBE_BONUSES,
    RARITY_SETTINGS,
    applyPercentRoundHalfUp
} = require('../../cardsData');

function generateSecureCardUid() {
    if (crypto && typeof crypto.randomUUID === 'function') {
        return 'card_' + crypto.randomUUID();
    }
    return 'card_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

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

function normalizeLineup(player, slots) {
    const used = new Set();
    const out = [null, null, null];
    if (!Array.isArray(slots)) return out;

    for (let i = 0; i < 3; i++) {
        const uid = slots[i];
        if (!uid || typeof uid !== 'string') continue;
        const card = player.hand.find(c => c && c.uid === uid);
        if (card && !used.has(uid)) {
            out[i] = card;
            used.add(uid);
        }
    }
    return out;
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
            const pct = (count - 1) * bonus.percent;

            if (bonus.target.includes('hp')) {
                c.hp = applyPercentRoundHalfUp(c.hp, pct);
                c.maxHp = c.hp;
                c.isHpBuffed = true;
            }
            if (bonus.target.includes('atk')) {
                c.atk = applyPercentRoundHalfUp(c.atk, pct);
                c.isAtkBuffed = true;
            }
            if (bonus.target.includes('spd')) {
                c.spd = applyPercentRoundHalfUp(c.spd, pct);
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
        this.selectedLineup = [null, null, null];
        this.shop = [];
        this.isReady = false;
        this.hasClickedNext = false;
        this.isAlive = true;
        this.eliminatedRound = null;
        this.rank = null;
        this.lastRoundInfo = null; // 前ラウンドの確定編成情報
        this.pendingLastRoundInfo = null; // 当該ラウンドの戦闘編成一時退避
        this.purchasedMarketUids = new Set();
    }

    initRoundShop(round = 1) {
        this.purchasedMarketUids.clear();
        if (this.shop.length === 0) {
            for (let i = 0; i < 6; i++) {
                this.shop.push({ card: createRandomShopCard(round), locked: false });
            }
        } else {
            for (let i = 0; i < 6; i++) {
                if (!this.shop[i] || !this.shop[i].locked) {
                    this.shop[i] = { card: createRandomShopCard(round), locked: false };
                }
            }
        }
    }

    rerollShop(round = 1) {
        if (!this.shop || this.shop.length === 0) return false;
        if (this.gold < 2) return false;
        this.gold -= 2;
        for (let i = 0; i < 6; i++) {
            if (!this.shop[i] || !this.shop[i].locked) {
                this.shop[i] = { card: createRandomShopCard(round), locked: false };
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
        this.matchHistory = {}; // id -> { opponentId: count }
        this.gameOverDecided = false;
        this.finalOutcome = null;
        this.battleParticipants = new Set();

        // 公平マッチング用メタデータ
        this.ghostMatchCounts = {};
        this.lastPvPOpponents = {};
        this.lastRoundGhostFighters = new Set();
        this.lastGhostSources = {};
    }

    addPlayer(id, name) {
        const p = new Player(id, name);
        this.players[id] = p;
        if (!this.matchHistory[id]) {
            this.matchHistory[id] = {};
        }
        if (this.ghostMatchCounts[id] === undefined) {
            this.ghostMatchCounts[id] = 0;
        }
        this.updateHost();
        return p;
    }

    removePlayer(id) {
        const p = this.players[id];
        if (p && this.gameState !== 'lobby' && p.isEntered) {
            this.disconnectedPlayers.push({
                id: p.id,
                name: p.name,
                wasAlive: p.isAlive,
                eliminatedRound: p.eliminatedRound || this.round
            });
        }
        delete this.players[id];
        delete this.matchHistory[id];
        delete this.ghostMatchCounts[id];
        delete this.lastPvPOpponents[id];
        delete this.lastGhostSources[id];
        this.lastRoundGhostFighters.delete(id);

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
        this.gameOverDecided = false;
        this.finalOutcome = null;
        this.battleParticipants.clear();

        this.ghostMatchCounts = {};
        this.lastPvPOpponents = {};
        this.lastRoundGhostFighters.clear();
        this.lastGhostSources = {};
    }

    getPlayer(id) {
        return this.players[id];
    }

    updateHost(forceTransferFromId = null) {
        const allPlayerList = Object.values(this.players);
        if (allPlayerList.length === 0) {
            this.hostSocketId = null;
            return;
        }

        const currentHost = this.players[this.hostSocketId];
        const needTransfer = !currentHost || (forceTransferFromId && this.hostSocketId === forceTransferFromId);

        if (needTransfer) {
            const enteredPlayers = allPlayerList.filter(p => p.isEntered);
            const candidateEntered = enteredPlayers.filter(p => p.id !== forceTransferFromId);

            if (candidateEntered.length > 0) {
                this.hostSocketId = candidateEntered[0].id;
            } else {
                const otherConnected = allPlayerList.filter(p => p.id !== forceTransferFromId);
                this.hostSocketId = otherConnected.length > 0 ? otherConnected[0].id : allPlayerList[0].id;
            }
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
            eliminatedRound: p.eliminatedRound,
            isHost: p.id === this.hostSocketId,
            handCount: p.hand.length,
            lastRoundInfo: p.lastRoundInfo
        }));
    }

    getMatchMetadata() {
        return {
            ghostMatchCounts: this.ghostMatchCounts,
            lastPvPOpponents: this.lastPvPOpponents,
            lastRoundGhostFighters: this.lastRoundGhostFighters,
            lastGhostSources: this.lastGhostSources
        };
    }

    recordMatch(p1Id, p2Id, isGhost = false, originalGhostId = null) {
        if (!this.matchHistory[p1Id]) this.matchHistory[p1Id] = {};

        if (isGhost) {
            const targetGhostSourceId = originalGhostId || p2Id;

            this.ghostMatchCounts[p1Id] = (this.ghostMatchCounts[p1Id] || 0) + 1;
            this.lastRoundGhostFighters.add(p1Id);
            this.lastGhostSources[p1Id] = targetGhostSourceId;

            delete this.lastPvPOpponents[p1Id];

            this.matchHistory[p1Id][targetGhostSourceId] = (this.matchHistory[p1Id][targetGhostSourceId] || 0) + 1;
            if (this.players[targetGhostSourceId]) {
                if (!this.matchHistory[targetGhostSourceId]) this.matchHistory[targetGhostSourceId] = {};
                this.matchHistory[targetGhostSourceId][p1Id] = (this.matchHistory[targetGhostSourceId][p1Id] || 0) + 1;
            }
        } else {
            this.matchHistory[p1Id][p2Id] = (this.matchHistory[p1Id][p2Id] || 0) + 1;
            if (this.players[p2Id]) {
                if (!this.matchHistory[p2Id]) this.matchHistory[p2Id] = {};
                this.matchHistory[p2Id][p1Id] = (this.matchHistory[p2Id][p1Id] || 0) + 1;
            }

            this.lastPvPOpponents[p1Id] = p2Id;
            this.lastPvPOpponents[p2Id] = p1Id;

            this.lastRoundGhostFighters.delete(p1Id);
            this.lastRoundGhostFighters.delete(p2Id);
            delete this.lastGhostSources[p1Id];
            delete this.lastGhostSources[p2Id];
        }
    }

    resetGameForStart() {
        this.gameState = 'prep';
        this.round = 1;
        this.pendingDiscards = [];
        this.activeMarketCards = [];
        this.disconnectedPlayers = [];
        this.matchHistory = {};
        this.roundMatchups = {};
        this.gameOverDecided = false;
        this.finalOutcome = null;
        this.battleParticipants.clear();

        this.ghostMatchCounts = {};
        this.lastPvPOpponents = {};
        this.lastRoundGhostFighters.clear();
        this.lastGhostSources = {};

        const entered = Object.values(this.players).filter(p => p.isEntered);
        entered.forEach(p => {
            p.life = 5;
            p.gold = 20;
            p.hand = [];
            p.selectedLineup = [null, null, null];
            p.isReady = false;
            p.hasClickedNext = false;
            p.isAlive = true;
            p.eliminatedRound = null;
            p.rank = null;

            p.shop = [];
            p.lastRoundInfo = null;
            p.pendingLastRoundInfo = null;
            p.purchasedMarketUids.clear();

            this.matchHistory[p.id] = {};
            this.ghostMatchCounts[p.id] = 0;

            p.initRoundShop(1);

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
        this.gameOverDecided = false;
        this.finalOutcome = null;
        this.battleParticipants.clear();

        const goldBonus = this.round >= 5 ? 15 : 10;

        // 全プレイヤー（生存者・脱落者含む）の前ラウンド情報を確定反映
        Object.values(this.players).forEach(p => {
            if (p.pendingLastRoundInfo) {
                p.lastRoundInfo = p.pendingLastRoundInfo;
                p.pendingLastRoundInfo = null;
            }
        });

        const remaining = Object.values(this.players).filter(p => p.isAlive && p.isEntered);
        remaining.forEach(p => {
            p.gold += goldBonus;
            p.isReady = false;
            p.hasClickedNext = false;

            p.selectedLineup = [null, null, null];

            p.hand.forEach(c => {
                if (c && c.isNewDistributed) delete c.isNewDistributed;
            });

            p.initRoundShop(this.round);

            const distCard = createRandomDistributedCard(this.round);
            distCard.isNewDistributed = true;
            p.hand.push(distCard);
            p.sortHand();
        });
    }

    autoDiscardExcessCards(p) {
        let hasDiscarded = false;
        while (p.hand.length > 6) {
            const deployUids = new Set(p.selectedLineup.map(c => c && c.uid).filter(Boolean));
            const benchCards = p.hand.filter(c => !deployUids.has(c.uid));
            if (benchCards.length === 0) break;

            const target = benchCards[Math.floor(Math.random() * benchCards.length)];

            const cost = RARITY_SETTINGS[target.rarity] ? RARITY_SETTINGS[target.rarity].cost : (target.cost || 2);
            const stars = target.starCount || 1;
            const gainGold = target.isMarketCard
                ? Math.floor((cost * stars) / 4)
                : Math.floor((cost * stars) / 2);

            p.gold += gainGold;
            p.hand = p.hand.filter(c => c.uid !== target.uid);

            const discardCard = JSON.parse(JSON.stringify(target));
            if (discardCard.isNewDistributed) delete discardCard.isNewDistributed;

            discardCard.sellerName = p.name;

            this.pendingDiscards.push({
                card: discardCard,
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
    normalizeLineup,
    calculatePlayerTribeBuffedCards,
    generateSecureCardUid,
    gameManager: new GameManager()
};