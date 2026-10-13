/**
 * server.js
 * グラウンド・オートバトラー サーバープログラム (要件改修版)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
    RARITY_SETTINGS,
    ELEMENT_RELATIONS,
    TRIBE_BONUSES,
    createRandomShopCard
} = require('./cardsData');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ============================
// ゲーム状態管理
// ============================
let players = {}; // socket.id -> PlayerObject
let hostSocketId = null;
let gameState = 'lobby'; // 'lobby' | 'prep' | 'battle' | 'ended'
let round = 1;

let pendingDiscards = [];
let activeMarketCards = [];
let allBattlesData = {}; // targetPlayerId -> { summary, logs }
let roundMatchups = {}; // playerId -> { opponentId, opponentName, isGhost }
let disconnectedPlayers = []; // 切断プレイヤーの記録 { name }

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
}

function updateHost() {
    const ids = Object.keys(players);
    if (ids.length === 0) {
        hostSocketId = null;
    } else if (!hostSocketId || !players[hostSocketId]) {
        hostSocketId = ids[0];
    }
}

function getPublicPlayerList() {
    return Object.values(players).map(p => ({
        id: p.id,
        name: p.name,
        isEntered: p.isEntered,
        life: p.life,
        gold: p.gold,
        isReady: p.isReady,
        isAlive: p.isAlive,
        isHost: p.id === hostSocketId,
        handCount: p.hand.length,
        lastRoundInfo: p.lastRoundInfo
    }));
}

function broadcastLobbyState() {
    updateHost();
    io.emit('lobby:update', {
        gameState,
        hostSocketId,
        players: getPublicPlayerList(),
        enteredCount: Object.values(players).filter(p => p.isEntered).length
    });
}

function syncMarketToAll() {
    Object.values(players).forEach(p => {
        const filteredMarket = activeMarketCards.filter(m =>
            m.sellerId !== p.id && !p.purchasedMarketUids.has(m.card.uid)
        );
        io.to(p.id).emit('market:sync', { activeMarketCards: filteredMarket });
    });
}

function broadcastGameState() {
    updateHost();
    io.emit('game:sync', {
        gameState,
        round,
        hostSocketId,
        players: getPublicPlayerList()
    });
    syncMarketToAll();
}

// 各ラウンド開始時に対戦相手のマッチングを決定
function generateRoundMatchups() {
    roundMatchups = {};
    const activePlayers = Object.values(players).filter(p => p.isAlive && p.isEntered);
    if (activePlayers.length === 0) return;

    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += 2) {
        if (i + 1 < shuffled.length) {
            const p1 = shuffled[i];
            const p2 = shuffled[i + 1];
            roundMatchups[p1.id] = { opponentId: p2.id, opponentName: p2.name, isGhost: false };
            roundMatchups[p2.id] = { opponentId: p1.id, opponentName: p1.name, isGhost: false };
        } else {
            const p1 = shuffled[i];
            let candidates = activePlayers.filter(p => p.id !== p1.id);
            if (candidates.length === 0) candidates = [p1];
            const ghostBase = candidates[Math.floor(Math.random() * candidates.length)];
            roundMatchups[p1.id] = {
                opponentId: 'ghost_' + ghostBase.id,
                opponentName: ghostBase.name + ' (影)',
                isGhost: true,
                originalId: ghostBase.id
            };
        }
    }

    Object.keys(roundMatchups).forEach(pid => {
        io.to(pid).emit('matchup:notice', {
            opponentName: roundMatchups[pid].opponentName
        });
    });
}

function handleOpponentDisconnect(disconnectedId) {
    if (gameState !== 'prep') return;
    const activePlayers = Object.values(players).filter(p => p.isAlive && p.isEntered);

    Object.keys(roundMatchups).forEach(pid => {
        if (roundMatchups[pid].opponentId === disconnectedId) {
            let candidates = activePlayers.filter(p => p.id !== pid);
            if (candidates.length === 0 && players[pid]) candidates = [players[pid]];
            if (candidates.length > 0) {
                const ghostBase = candidates[Math.floor(Math.random() * candidates.length)];
                roundMatchups[pid] = {
                    opponentId: 'ghost_' + ghostBase.id,
                    opponentName: ghostBase.name + ' (影)',
                    isGhost: true,
                    originalId: ghostBase.id
                };
                io.to(pid).emit('matchup:notice', {
                    opponentName: roundMatchups[pid].opponentName
                });
            }
        }
    });
}

// 種族ボーナス計算
function applyTribeBonus(cardsInBattle, allCardsInPossession) {
    const tribeCounts = {};
    allCardsInPossession.forEach(c => {
        tribeCounts[c.tribe] = (tribeCounts[c.tribe] || 0) + 1;
    });

    return cardsInBattle.map(card => {
        const c = JSON.parse(JSON.stringify(card));
        const count = tribeCounts[c.tribe] || 1;
        if (count >= 2 && TRIBE_BONUSES[c.tribe]) {
            const bonus = TRIBE_BONUSES[c.tribe];
            const factor = 1 + (count - 1) * bonus.factor;
            bonus.target.forEach(stat => {
                if (stat === 'hp') {
                    c.hp = Math.floor(c.hp * factor);
                    c.maxHp = c.hp;
                } else if (stat === 'atk') {
                    c.atk = Math.floor(c.atk * factor);
                } else if (stat === 'spd') {
                    c.spd = Math.floor(c.spd * factor);
                }
            });
        }
        return c;
    });
}

// バトルシミュレーション
function simulateBattle(p1, p2, isP2Ghost = false) {
    const p1Bench = p1.hand.filter(c => !p1.selectedLineup.some(sc => sc.uid === c.uid));
    const p2Bench = p2.hand.filter(c => !p2.selectedLineup.some(sc => sc.uid === c.uid));

    const p1CombatTeam = applyTribeBonus(p1.selectedLineup, p1.hand);
    const p2CombatTeam = applyTribeBonus(p2.selectedLineup, p2.hand);

    p1.lastRoundInfo = {
        lineup: p1.selectedLineup.map(c => ({
            name: c.name, element: c.element, tribe: c.tribe, rarity: c.rarity,
            hp: c.hp, atk: c.atk, spd: c.spd, isMarketCard: c.isMarketCard
        })),
        bench: p1Bench.map(c => ({
            name: c.name, element: c.element, tribe: c.tribe, rarity: c.rarity,
            hp: c.hp, atk: c.atk, spd: c.spd, isMarketCard: c.isMarketCard
        }))
    };
    if (!isP2Ghost) {
        p2.lastRoundInfo = {
            lineup: p2.selectedLineup.map(c => ({
                name: c.name, element: c.element, tribe: c.tribe, rarity: c.rarity,
                hp: c.hp, atk: c.atk, spd: c.spd, isMarketCard: c.isMarketCard
            })),
            bench: p2Bench.map(c => ({
                name: c.name, element: c.element, tribe: c.tribe, rarity: c.rarity,
                hp: c.hp, atk: c.atk, spd: c.spd, isMarketCard: c.isMarketCard
            }))
        };
    }

    const logs = [];
    const pairDamagesP1 = {};
    const pairDamagesP2 = {};

    const p1TotalCount = p1CombatTeam.length;
    const p2TotalCount = p2CombatTeam.length;

    let p1Index = 0;
    let p2Index = 0;

    const getCountsMeta = () => ({
        p1Total: p1TotalCount,
        p1Remaining: Math.max(0, p1TotalCount - p1Index),
        p2Total: p2TotalCount,
        p2Remaining: Math.max(0, p2TotalCount - p2Index)
    });

    if (p1CombatTeam.length === 0 && p2CombatTeam.length === 0) {
        logs.push({ text: '両プレイヤーともカードが出撃していません。両者敗北！', damage: 0, counts: getCountsMeta() });
        return {
            winnerId: null,
            winnerName: null,
            loserIds: [p1.id, isP2Ghost ? null : p2.id].filter(Boolean),
            logs,
            pairDamages: { [p1.id]: [], [p2.id]: [] }
        };
    }
    if (p1CombatTeam.length === 0) {
        logs.push({ text: `${p1.name}はカードを繰り出していないため強制敗北！`, damage: 0, counts: getCountsMeta() });
        return {
            winnerId: p2.id,
            winnerName: p2.name,
            loserIds: [p1.id],
            logs,
            pairDamages: { [p1.id]: [], [p2.id]: [] }
        };
    }
    if (p2CombatTeam.length === 0) {
        logs.push({ text: `${p2.name}はカードを繰り出していないため強制敗北！`, damage: 0, counts: getCountsMeta() });
        return {
            winnerId: p1.id,
            winnerName: p1.name,
            loserIds: isP2Ghost ? [] : [p2.id],
            logs,
            pairDamages: { [p1.id]: [], [p2.id]: [] }
        };
    }

    let turnCount = 0;
    const maxTurns = 200;

    let active1 = p1CombatTeam[p1Index];
    let active2 = p2CombatTeam[p2Index];

    logs.push({
        text: `【戦闘開始】 ${p1.name}の『${active1.name}』 vs ${p2.name}の『${active2.name}』！`,
        damage: 0,
        counts: getCountsMeta(),
        state: { p1Card: { ...active1 }, p2Card: { ...active2 } }
    });

    let nextAttacker = null;

    while (p1Index < p1CombatTeam.length && p2Index < p2CombatTeam.length && turnCount < maxTurns) {
        turnCount++;
        active1 = p1CombatTeam[p1Index];
        active2 = p2CombatTeam[p2Index];

        if (!nextAttacker) {
            if (active1.spd > active2.spd) nextAttacker = 1;
            else if (active2.spd > active1.spd) nextAttacker = 2;
            else nextAttacker = Math.random() < 0.5 ? 1 : 2;
        }

        const attackerIsP1 = nextAttacker === 1;
        const atkCard = attackerIsP1 ? active1 : active2;
        const defCard = attackerIsP1 ? active2 : active1;
        const atkPlayer = attackerIsP1 ? p1 : p2;
        const defPlayer = attackerIsP1 ? p2 : p1;

        let baseDmg = atkCard.atk;
        let attrMult = 1.0;
        const rel = ELEMENT_RELATIONS[atkCard.element];
        if (rel && rel.weak === defCard.element) {
            attrMult = 2.0;
        } else if (rel && rel.resist === defCard.element) {
            attrMult = 0.5;
        }

        const isHit = Math.random() < 0.5;
        let finalDmg = 0;
        let isCrit = false;

        if (isHit) {
            if (Math.random() < (1 / 6)) {
                isCrit = true;
            }
            let dmg = baseDmg * attrMult * (isCrit ? 1.5 : 1.0);
            finalDmg = Math.floor(dmg);

            const key = `${atkCard.uid}__${defCard.uid}`;
            const recordTable = attackerIsP1 ? pairDamagesP1 : pairDamagesP2;
            if (!recordTable[key]) {
                recordTable[key] = {
                    atkCard: JSON.parse(JSON.stringify(atkCard)),
                    defCard: JSON.parse(JSON.stringify(defCard)),
                    atkCardName: atkCard.name,
                    defCardName: defCard.name,
                    damage: 0
                };
            }
            recordTable[key].damage += finalDmg;
        }

        defCard.hp = Math.max(0, defCard.hp - finalDmg);

        let logMsg = `${atkPlayer.name}の『${atkCard.name}』の攻撃！ `;
        if (!isHit) {
            logMsg += `しかし攻撃は外れた！`;
        } else {
            if (attrMult === 2.0) logMsg += `【効果はばつぐんだ！】 `;
            if (attrMult === 0.5) logMsg += `【効果はいまひとつのようだ…】 `;
            if (isCrit) logMsg += `【痛恨の一撃！】 `;
            logMsg += `${defPlayer.name}の『${defCard.name}』に ${finalDmg} ダメージ！ (残HP: ${defCard.hp}/${defCard.maxHp})`;
        }

        logs.push({
            turn: turnCount,
            text: logMsg,
            attacker: attackerIsP1 ? 'p1' : 'p2',
            damage: finalDmg,
            isHit,
            isCrit,
            attrMult,
            counts: getCountsMeta(),
            state: {
                p1Card: { ...active1 },
                p2Card: { ...active2 }
            }
        });

        if (defCard.hp <= 0) {
            logs.push({
                text: `${defPlayer.name}の『${defCard.name}』は倒れた！`,
                damage: 0,
                faintedSide: attackerIsP1 ? 'p2' : 'p1',
                counts: getCountsMeta()
            });

            if (attackerIsP1) {
                p2Index++;
                if (p2Index < p2CombatTeam.length) {
                    active2 = p2CombatTeam[p2Index];
                    logs.push({ text: `${p2.name}は次のカード『${active2.name}』を繰り出した！`, damage: 0, counts: getCountsMeta() });
                }
            } else {
                p1Index++;
                if (p1Index < p1CombatTeam.length) {
                    active1 = p1CombatTeam[p1Index];
                    logs.push({ text: `${p1.name}は次のカード『${active1.name}』を繰り出した！`, damage: 0, counts: getCountsMeta() });
                }
            }
            nextAttacker = null;
        } else {
            nextAttacker = attackerIsP1 ? 2 : 1;
        }
    }

    let winnerId = null;
    let winnerName = null;
    let loserIds = [];

    if (p1Index >= p1CombatTeam.length && p2Index >= p2CombatTeam.length) {
        logs.push({ text: '両者のカードが全滅しました。引き分け！', damage: 0, counts: getCountsMeta() });
        loserIds.push(p1.id);
        if (!isP2Ghost) loserIds.push(p2.id);
    } else if (p1Index >= p1CombatTeam.length) {
        logs.push({ text: `${p2.name}の勝利！`, damage: 0, counts: getCountsMeta() });
        winnerId = p2.id;
        winnerName = p2.name;
        loserIds.push(p1.id);
    } else {
        logs.push({ text: `${p1.name}の勝利！`, damage: 0, counts: getCountsMeta() });
        winnerId = p1.id;
        winnerName = p1.name;
        if (!isP2Ghost) loserIds.push(p2.id);
    }

    return {
        winnerId,
        winnerName,
        loserIds,
        logs,
        pairDamages: {
            [p1.id]: Object.values(pairDamagesP1),
            [p2.id]: Object.values(pairDamagesP2)
        }
    };
}

// 2-4: バトル開始直前の手札7枚超過時自動解雇＆ゴールド加算
function autoDiscardExcessCards(p) {
    let hasDiscarded = false;
    while (p.hand.length > 6) {
        const deployUids = new Set(p.selectedLineup.map(c => c.uid));
        const benchCards = p.hand.filter(c => !deployUids.has(c.uid));
        if (benchCards.length === 0) break;

        const target = benchCards[Math.floor(Math.random() * benchCards.length)];
        const gainGold = target.isMarketCard
            ? Math.floor(target.totalStats / 20)
            : Math.floor(target.totalStats / 10);

        p.gold += gainGold;
        p.hand = p.hand.filter(c => c.uid !== target.uid);
        pendingDiscards.push({
            card: JSON.parse(JSON.stringify(target)),
            sellerId: p.id,
            sellerName: p.name
        });
        hasDiscarded = true;
    }

    if (hasDiscarded) {
        io.to(p.id).emit('player:sync', {
            gold: p.gold,
            hand: p.hand,
            selectedLineup: p.selectedLineup
        });
    }
}

// 7-1: 切断による即時ゲーム終了判定
function checkImmediateWinnerOnDisconnect() {
    if (gameState === 'lobby' || gameState === 'ended') return;

    const activeEntered = Object.values(players).filter(p => p.isEntered);
    const survivors = activeEntered.filter(p => p.isAlive);

    if (survivors.length <= 1) {
        gameState = 'ended';
        let finalRankings = [];
        if (survivors.length === 1) {
            finalRankings.push({ rank: 1, name: survivors[0].name, life: survivors[0].life });
        }

        const deadPlayers = activeEntered.filter(p => !p.isAlive);
        deadPlayers.sort((a, b) => b.life - a.life);
        deadPlayers.forEach(p => {
            finalRankings.push({ rank: finalRankings.length + 1, name: p.name, life: p.life });
        });

        disconnectedPlayers.forEach(dp => {
            finalRankings.push({ isDisconnected: true, name: dp.name });
        });

        io.emit('game:ended', { rankings: finalRankings });
        broadcastGameState();
    }
}

// バトルフェーズ全体の開始
function startBattlePhase() {
    gameState = 'battle';

    const activePlayers = Object.values(players).filter(p => p.isAlive && p.isEntered);

    // 2-4: バトル開始時に手札超過を自動解雇＆ゴールド加算
    activePlayers.forEach(p => autoDiscardExcessCards(p));

    Object.values(players).forEach(p => {
        p.isReady = false;
        p.hasClickedNext = false;
    });

    allBattlesData = {};
    const processedPairs = new Set();

    activePlayers.forEach(p1 => {
        const m = roundMatchups[p1.id];
        if (!m) return;

        const pairKey = [p1.id, m.opponentId].sort().join('___');
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        let p2 = players[m.opponentId];
        let isGhost = m.isGhost;

        if (isGhost) {
            const ghostBase = players[m.originalId] || p1;
            p2 = new Player('ghost_' + ghostBase.id, ghostBase.name + ' (影)');
            p2.hand = JSON.parse(JSON.stringify(ghostBase.hand));
            p2.selectedLineup = JSON.parse(JSON.stringify(ghostBase.selectedLineup));
        }

        if (!p2) return;

        const res = simulateBattle(p1, p2, isGhost);

        res.loserIds.forEach(lid => {
            if (players[lid]) {
                players[lid].life = Math.max(0, players[lid].life - 1);
            }
        });

        const simData1 = {
            p1Id: p1.id,
            p2Id: p2.id,
            p1Name: p1.name,
            p2Name: p2.name,
            opponentName: p2.name,
            isWinner: res.winnerId === p1.id,
            isDraw: !res.winnerId && res.loserIds.includes(p1.id),
            winnerName: res.winnerName,
            detailedDamages: res.pairDamages[p1.id] || []
        };
        allBattlesData[p1.id] = { summary: simData1, logs: res.logs };

        if (!isGhost) {
            const simData2 = {
                p1Id: p2.id,
                p2Id: p1.id,
                p1Name: p2.name,
                p2Name: p1.name,
                opponentName: p1.name,
                isWinner: res.winnerId === p2.id,
                isDraw: !res.winnerId && res.loserIds.includes(p2.id),
                winnerName: res.winnerName,
                detailedDamages: res.pairDamages[p2.id] || []
            };
            allBattlesData[p2.id] = { summary: simData2, logs: res.logs };
        }
    });

    const alivePlayers = Object.values(players).filter(p => p.isAlive && p.isEntered);
    alivePlayers.forEach(p => {
        if (p.life <= 0) p.isAlive = false;
    });
    const survivors = Object.values(players).filter(p => p.isAlive && p.isEntered);
    const instantGameOver = survivors.length <= 1;

    activePlayers.forEach(p => {
        if (allBattlesData[p.id]) {
            io.to(p.id).emit('battle:start', {
                ...allBattlesData[p.id],
                isGameOverDecided: instantGameOver
            });
        }
    });

    broadcastGameState();
}

function checkEndBattlePhase() {
    const activePlayers = Object.values(players).filter(p => p.isEntered);
    const remaining = Object.values(players).filter(p => p.isAlive && p.isEntered);

    if (remaining.length <= 1) {
        gameState = 'ended';
        let finalRankings = [];
        if (remaining.length === 1) {
            finalRankings.push({ rank: 1, name: remaining[0].name, life: remaining[0].life });
        }

        const deadPlayers = activePlayers.filter(p => !p.isAlive);
        deadPlayers.sort((a, b) => b.life - a.life);
        deadPlayers.forEach(p => {
            finalRankings.push({ rank: finalRankings.length + 1, name: p.name, life: p.life });
        });

        disconnectedPlayers.forEach(dp => {
            finalRankings.push({ isDisconnected: true, name: dp.name });
        });

        io.emit('game:ended', { rankings: finalRankings });
        broadcastGameState();
        return;
    }

    const allNext = remaining.every(p => p.hasClickedNext);
    if (!allNext) return;

    round++;
    gameState = 'prep';

    activeMarketCards = [...pendingDiscards];
    pendingDiscards = [];

    remaining.forEach(p => {
        p.gold += 10;
        p.isReady = false;
        p.hasClickedNext = false;
        p.selectedLineup = p.selectedLineup.filter(sc => p.hand.some(c => c.uid === sc.uid));
        p.initRoundShop();
    });

    generateRoundMatchups();
    broadcastGameState();

    remaining.forEach(p => {
        io.to(p.id).emit('player:sync', {
            gold: p.gold,
            life: p.life,
            hand: p.hand,
            shop: p.shop,
            selectedLineup: p.selectedLineup
        });
    });
}

// ============================
// Socket通信
// ============================
io.on('connection', (socket) => {
    const player = new Player(socket.id, `プレイヤー_${socket.id.substring(0, 4)}`);
    players[socket.id] = player;

    updateHost();
    broadcastLobbyState();

    socket.on('player:rename', (newName) => {
        if (typeof newName === 'string' && newName.trim().length > 0) {
            player.name = newName.trim().substring(0, 16);
            broadcastLobbyState();
            broadcastGameState();
        }
    });

    socket.on('lobby:toggleEntry', () => {
        if (gameState !== 'lobby') return;
        player.isEntered = !player.isEntered;
        broadcastLobbyState();
    });

    socket.on('lobby:startGame', () => {
        if (socket.id !== hostSocketId || gameState !== 'lobby') return;
        const entered = Object.values(players).filter(p => p.isEntered);
        if (entered.length < 2) return;

        gameState = 'prep';
        round = 1;
        pendingDiscards = [];
        activeMarketCards = [];
        disconnectedPlayers = [];

        entered.forEach(p => {
            p.life = 5;
            p.gold = 20;
            p.hand = [];
            p.selectedLineup = [];
            p.isReady = false;
            p.hasClickedNext = false;
            p.isAlive = true;
            p.initRoundShop();
            io.to(p.id).emit('player:sync', {
                gold: p.gold,
                life: p.life,
                hand: p.hand,
                shop: p.shop,
                selectedLineup: p.selectedLineup
            });
        });

        generateRoundMatchups();
        broadcastGameState();
    });

    socket.on('shop:buy', ({ shopIndex }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        const item = player.shop[shopIndex];
        if (!item || !item.card) return;
        if (player.gold < item.card.cost) return;

        player.gold -= item.card.cost;
        player.hand.push(item.card);
        player.shop[shopIndex] = { card: null, locked: false };

        socket.emit('player:sync', {
            gold: player.gold,
            hand: player.hand,
            shop: player.shop
        });
    });

    socket.on('shop:buyAndDeploy', ({ shopIndex, slotIndex, previousCardUid }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        const item = player.shop[shopIndex];
        if (!item || !item.card) return;
        if (player.gold < item.card.cost) return;

        player.gold -= item.card.cost;
        const boughtCard = item.card;
        player.shop[shopIndex] = { card: null, locked: false };

        player.hand.push(boughtCard);
        if (previousCardUid) {
            player.selectedLineup = player.selectedLineup.filter(c => c.uid !== previousCardUid);
        }
        player.selectedLineup[slotIndex] = boughtCard;

        socket.emit('player:sync', {
            gold: player.gold,
            hand: player.hand,
            shop: player.shop,
            selectedLineup: player.selectedLineup
        });
    });

    socket.on('shop:reroll', () => {
        if (gameState !== 'prep' || !player.isAlive) return;
        if (player.rerollShop()) {
            socket.emit('player:sync', {
                gold: player.gold,
                shop: player.shop
            });
        }
    });

    socket.on('shop:toggleLock', ({ shopIndex }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        if (player.shop[shopIndex] && player.shop[shopIndex].card) {
            player.shop[shopIndex].locked = !player.shop[shopIndex].locked;
            socket.emit('player:sync', { shop: player.shop });
        }
    });

    socket.on('market:buy', ({ marketCardUid }) => {
        if (gameState !== 'prep' || !player.isAlive || round < 2) return;
        const item = activeMarketCards.find(c => c.card.uid === marketCardUid);
        if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

        const price = Math.floor(item.card.totalStats / 10);
        if (player.gold < price) return;

        player.gold -= price;
        player.purchasedMarketUids.add(marketCardUid);

        const boughtCard = JSON.parse(JSON.stringify(item.card));
        boughtCard.uid = 'card_' + Math.random().toString(36).substring(2, 9);
        boughtCard.isMarketCard = true;
        boughtCard.sellerName = item.sellerName;
        player.hand.push(boughtCard);

        socket.emit('player:sync', {
            gold: player.gold,
            hand: player.hand
        });
        syncMarketToAll();
    });

    socket.on('market:buyAndDeploy', ({ marketCardUid, slotIndex, previousCardUid }) => {
        if (gameState !== 'prep' || !player.isAlive || round < 2) return;
        const item = activeMarketCards.find(c => c.card.uid === marketCardUid);
        if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

        const price = Math.floor(item.card.totalStats / 10);
        if (player.gold < price) return;

        player.gold -= price;
        player.purchasedMarketUids.add(marketCardUid);

        const boughtCard = JSON.parse(JSON.stringify(item.card));
        boughtCard.uid = 'card_' + Math.random().toString(36).substring(2, 9);
        boughtCard.isMarketCard = true;
        boughtCard.sellerName = item.sellerName;
        player.hand.push(boughtCard);

        if (previousCardUid) {
            player.selectedLineup = player.selectedLineup.filter(c => c.uid !== previousCardUid);
        }
        player.selectedLineup[slotIndex] = boughtCard;

        socket.emit('player:sync', {
            gold: player.gold,
            hand: player.hand,
            selectedLineup: player.selectedLineup
        });
        syncMarketToAll();
    });

    socket.on('card:synthesizeEx', ({ baseUid, source }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        const baseCard = player.hand.find(c => c.uid === baseUid);
        if (!baseCard) return;

        let matCard = null;
        let cost = 0;

        if (source.type === 'hand') {
            matCard = player.hand.find(c => c.uid === source.uid);
            if (!matCard || matCard.uid === baseUid) return;
        } else if (source.type === 'shop') {
            const item = player.shop[source.shopIndex];
            if (!item || !item.card) return;
            matCard = item.card;
            cost = matCard.cost;
            if (player.gold < cost) return;
        } else if (source.type === 'market') {
            const item = activeMarketCards.find(c => c.card.uid === source.marketCardUid);
            if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(source.marketCardUid)) return;
            matCard = item.card;
            cost = Math.floor(matCard.totalStats / 10);
            if (player.gold < cost) return;
        }

        if (!matCard) return;

        if (baseCard.rarity === matCard.rarity && baseCard.tribe === matCard.tribe) {
            if (cost > 0) player.gold -= cost;

            baseCard.hp += matCard.hp;
            baseCard.maxHp = baseCard.hp;
            baseCard.atk += matCard.atk;
            baseCard.spd += matCard.spd;
            baseCard.totalStats = baseCard.hp + baseCard.atk + baseCard.spd;

            baseCard.isMarketCard = false;
            delete baseCard.sellerName;

            if (source.type === 'hand') {
                player.hand = player.hand.filter(c => c.uid !== matCard.uid);
            } else if (source.type === 'shop') {
                player.shop[source.shopIndex] = { card: null, locked: false };
            } else if (source.type === 'market') {
                player.purchasedMarketUids.add(source.marketCardUid);
                syncMarketToAll();
            }

            socket.emit('player:sync', {
                gold: player.gold,
                hand: player.hand,
                shop: player.shop,
                selectedLineup: player.selectedLineup
            });
            socket.emit('synthesize:success', { baseUid });
        }
    });

    socket.on('card:discard', ({ cardUid }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        const card = player.hand.find(c => c.uid === cardUid);
        if (!card) return;

        const gainGold = card.isMarketCard
            ? Math.floor(card.totalStats / 20)
            : Math.floor(card.totalStats / 10);

        player.gold += gainGold;
        player.hand = player.hand.filter(c => c.uid !== cardUid);
        player.selectedLineup = player.selectedLineup.filter(c => c.uid !== cardUid);

        pendingDiscards.push({
            card: JSON.parse(JSON.stringify(card)),
            sellerId: player.id,
            sellerName: player.name
        });

        socket.emit('player:sync', {
            gold: player.gold,
            hand: player.hand,
            selectedLineup: player.selectedLineup
        });
    });

    socket.on('player:updateLineup', ({ lineupUids }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        player.selectedLineup = lineupUids
            .map(uid => player.hand.find(c => c.uid === uid))
            .filter(Boolean)
            .slice(0, 3);
    });

    socket.on('player:setReady', ({ lineupUids }) => {
        if (gameState !== 'prep' || !player.isAlive) return;
        player.selectedLineup = lineupUids
            .map(uid => player.hand.find(c => c.uid === uid))
            .filter(Boolean)
            .slice(0, 3);

        player.isReady = true;
        broadcastGameState();

        const active = Object.values(players).filter(p => p.isAlive && p.isEntered);
        if (active.every(p => p.isReady)) {
            startBattlePhase();
        }
    });

    socket.on('battle:next', () => {
        player.hasClickedNext = true;
        player.isReady = true;
        broadcastGameState();
        checkEndBattlePhase();
    });

    socket.on('spectate:getBattle', ({ targetPlayerId }) => {
        if (allBattlesData[targetPlayerId]) {
            const survivors = Object.values(players).filter(p => p.isAlive && p.isEntered);
            socket.emit('battle:start', {
                ...allBattlesData[targetPlayerId],
                isGameOverDecided: survivors.length <= 1
            });
        }
    });

    socket.on('game:forceEnd', () => {
        if (socket.id !== hostSocketId) return;
        gameState = 'ended';

        const active = Object.values(players).filter(p => p.isEntered);
        active.sort((a, b) => b.life - a.life);

        let rankings = [];
        let curRank = 1;
        for (let i = 0; i < active.length; i++) {
            if (i > 0 && active[i].life < active[i - 1].life) {
                curRank = i + 1;
            }
            rankings.push({ rank: curRank, name: active[i].name, life: active[i].life });
        }

        disconnectedPlayers.forEach(dp => {
            rankings.push({ isDisconnected: true, name: dp.name });
        });

        io.emit('game:ended', { rankings });
        broadcastGameState();
    });

    socket.on('lobby:rematch', () => {
        player.life = 5;
        player.gold = 20;
        player.hand = [];
        player.shop = [];
        player.selectedLineup = [];
        player.isReady = false;
        player.hasClickedNext = false;
        player.isAlive = true;
        player.isEntered = true;

        if (gameState === 'ended') {
            const anyOtherPlaying = Object.values(players).some(p => p.id !== player.id && p.isEntered && gameState !== 'ended');
            if (!anyOtherPlaying) {
                gameState = 'lobby';
                round = 1;
            }
        }
        broadcastLobbyState();
        broadcastGameState();
    });

    socket.on('lobby:leave', () => {
        player.isEntered = false;
        player.isReady = false;
        player.isAlive = true;
        broadcastLobbyState();
        broadcastGameState();
    });

    socket.on('disconnect', () => {
        if (gameState !== 'lobby' && player.isEntered) {
            disconnectedPlayers.push({ name: player.name });
        }

        handleOpponentDisconnect(socket.id);

        delete players[socket.id];
        updateHost();

        // 7-1: 切断による即時ゲーム終了判定
        checkImmediateWinnerOnDisconnect();

        broadcastLobbyState();
        broadcastGameState();

        if (gameState === 'prep') {
            const active = Object.values(players).filter(p => p.isAlive && p.isEntered);
            if (active.length > 0 && active.every(p => p.isReady)) {
                startBattlePhase();
            }
        } else if (gameState === 'battle') {
            checkEndBattlePhase();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Ground Auto Battler server is running on http://localhost:${PORT}`);
});