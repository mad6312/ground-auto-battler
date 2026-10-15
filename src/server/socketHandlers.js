/**
 * src/server/socketHandlers.js
 * Socket.io イベントハンドラモジュール (仕様改修版)
 */

const { gameManager, Player } = require('./gameManager');
const { simulateBattle, createRoundMatchups } = require('./battleEngine');
const { RARITY_SETTINGS } = require('../../cardsData');

function registerSocketHandlers(io) {
    function broadcastLobbyState() {
        gameManager.updateHost();
        io.emit('lobby:update', {
            gameState: gameManager.gameState,
            hostSocketId: gameManager.hostSocketId,
            players: gameManager.getPublicPlayerList(),
            enteredCount: Object.values(gameManager.players).filter(p => p.isEntered).length
        });
    }

    function syncMarketToAll() {
        Object.values(gameManager.players).forEach(p => {
            const filteredMarket = gameManager.activeMarketCards.filter(m =>
                m.sellerId !== p.id && !p.purchasedMarketUids.has(m.card.uid)
            );
            io.to(p.id).emit('market:sync', { activeMarketCards: filteredMarket });
        });
    }

    function broadcastGameState() {
        gameManager.updateHost();
        io.emit('game:sync', {
            gameState: gameManager.gameState,
            round: gameManager.round,
            hostSocketId: gameManager.hostSocketId,
            players: gameManager.getPublicPlayerList()
        });
        syncMarketToAll();
    }

    function notifyRoundMatchups() {
        const activePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
        gameManager.roundMatchups = createRoundMatchups(activePlayers, gameManager.matchHistory);

        Object.keys(gameManager.roundMatchups).forEach(pid => {
            io.to(pid).emit('matchup:notice', {
                opponentName: gameManager.roundMatchups[pid].opponentName
            });
        });
    }

    function checkImmediateWinnerOnDisconnect() {
        if (gameManager.gameState === 'lobby' || gameManager.gameState === 'ended') return;

        const activeEntered = Object.values(gameManager.players).filter(p => p.isEntered);
        const survivors = activeEntered.filter(p => p.isAlive);

        if (survivors.length <= 1) {
            gameManager.gameState = 'ended';
            let finalRankings = [];
            if (survivors.length === 1) {
                finalRankings.push({ rank: 1, name: survivors[0].name, life: survivors[0].life });
            }

            const deadPlayers = activeEntered.filter(p => !p.isAlive);
            deadPlayers.sort((a, b) => b.life - a.life);
            deadPlayers.forEach(p => {
                finalRankings.push({ rank: finalRankings.length + 1, name: p.name, life: p.life });
            });

            gameManager.disconnectedPlayers.forEach(dp => {
                finalRankings.push({ isDisconnected: true, name: dp.name });
            });

            io.emit('game:ended', { rankings: finalRankings });
            broadcastGameState();
        }
    }

    function startBattlePhase() {
        gameManager.gameState = 'battle';

        const activePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);

        activePlayers.forEach(p => {
            const hasDiscarded = gameManager.autoDiscardExcessCards(p);
            if (hasDiscarded) {
                io.to(p.id).emit('player:sync', {
                    gold: p.gold,
                    hand: p.hand,
                    selectedLineup: p.selectedLineup
                });
            }
        });

        Object.values(gameManager.players).forEach(p => {
            p.isReady = false;
            p.hasClickedNext = false;
        });

        gameManager.allBattlesData = {};
        const processedPairs = new Set();

        activePlayers.forEach(p1 => {
            const m = gameManager.roundMatchups[p1.id];
            if (!m) return;

            const pairKey = [p1.id, m.opponentId].sort().join('___');
            if (processedPairs.has(pairKey)) return;
            processedPairs.add(pairKey);

            let p2 = gameManager.players[m.opponentId];
            let isGhost = m.isGhost;

            gameManager.recordMatch(p1.id, m.opponentId, isGhost ? m.originalId : null);

            if (isGhost) {
                const ghostBase = gameManager.players[m.originalId] || p1;
                p2 = new Player('ghost_' + ghostBase.id, ghostBase.name + ' (影)');
                p2.hand = JSON.parse(JSON.stringify(ghostBase.hand));
                p2.selectedLineup = JSON.parse(JSON.stringify(ghostBase.selectedLineup));
            }

            if (!p2) return;

            const res = simulateBattle(p1, p2, isGhost);

            res.loserIds.forEach(lid => {
                if (gameManager.players[lid]) {
                    gameManager.players[lid].life = Math.max(0, gameManager.players[lid].life - 1);
                }
            });

            const battlePayload = {
                summary: {
                    p1Id: p1.id,
                    p2Id: p2.id,
                    p1Name: p1.name,
                    p2Name: p2.name,
                    winnerId: res.winnerId,
                    winnerName: res.winnerName,
                    loserIds: res.loserIds,
                    detailedDamagesP1: res.pairDamages[p1.id] || [],
                    detailedDamagesP2: res.pairDamages[p2.id] || []
                },
                logs: res.logs
            };

            gameManager.allBattlesData[p1.id] = battlePayload;
            if (!isGhost) {
                gameManager.allBattlesData[p2.id] = battlePayload;
            }
        });

        const alivePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
        alivePlayers.forEach(p => {
            if (p.life <= 0) p.isAlive = false;
        });
        const survivors = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
        const instantGameOver = survivors.length <= 1;

        activePlayers.forEach(p => {
            if (gameManager.allBattlesData[p.id]) {
                io.to(p.id).emit('battle:start', {
                    ...gameManager.allBattlesData[p.id],
                    isGameOverDecided: instantGameOver
                });
            }
        });

        broadcastGameState();
    }

    function checkEndBattlePhase() {
        const activePlayers = Object.values(gameManager.players).filter(p => p.isEntered);
        const remaining = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);

        if (remaining.length <= 1) {
            gameManager.gameState = 'ended';
            let finalRankings = [];
            if (remaining.length === 1) {
                finalRankings.push({ rank: 1, name: remaining[0].name, life: remaining[0].life });
            }

            const deadPlayers = activePlayers.filter(p => !p.isAlive);
            deadPlayers.sort((a, b) => b.life - a.life);
            deadPlayers.forEach(p => {
                finalRankings.push({ rank: finalRankings.length + 1, name: p.name, life: p.life });
            });

            gameManager.disconnectedPlayers.forEach(dp => {
                finalRankings.push({ isDisconnected: true, name: dp.name });
            });

            io.emit('game:ended', { rankings: finalRankings });
            broadcastGameState();
            return;
        }

        const allNext = remaining.every(p => p.hasClickedNext);
        if (!allNext) return;

        gameManager.advanceToNextRound();
        notifyRoundMatchups();
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

    io.on('connection', (socket) => {
        const player = gameManager.addPlayer(socket.id, `プレイヤー_${socket.id.substring(0, 4)}`);
        broadcastLobbyState();

        socket.on('player:rename', (newName) => {
            if (typeof newName === 'string' && newName.trim().length > 0) {
                player.name = newName.trim().substring(0, 16);
                broadcastLobbyState();
                broadcastGameState();
            }
        });

        socket.on('lobby:toggleEntry', () => {
            if (gameManager.gameState !== 'lobby') return;
            player.isEntered = !player.isEntered;
            broadcastLobbyState();
        });

        socket.on('lobby:startGame', () => {
            if (socket.id !== gameManager.hostSocketId || gameManager.gameState !== 'lobby') return;
            const entered = Object.values(gameManager.players).filter(p => p.isEntered);
            if (entered.length < 2) return;

            gameManager.resetGameForStart();

            entered.forEach(p => {
                io.to(p.id).emit('player:sync', {
                    gold: p.gold,
                    life: p.life,
                    hand: p.hand,
                    shop: p.shop,
                    selectedLineup: p.selectedLineup
                });
            });

            notifyRoundMatchups();
            broadcastGameState();
        });

        socket.on('shop:buy', ({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            const item = player.shop[shopIndex];
            if (!item || !item.card || player.gold < item.card.cost) return;

            player.gold -= item.card.cost;
            player.hand.push(item.card);
            player.sortHand();
            player.shop[shopIndex] = { card: null, locked: false };

            socket.emit('player:sync', {
                gold: player.gold,
                hand: player.hand,
                shop: player.shop
            });
        });

        socket.on('shop:buyAndDeploy', ({ shopIndex, slotIndex, previousCardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            const item = player.shop[shopIndex];
            if (!item || !item.card || player.gold < item.card.cost) return;

            player.gold -= item.card.cost;
            const boughtCard = item.card;
            player.shop[shopIndex] = { card: null, locked: false };

            player.hand.push(boughtCard);
            player.sortHand();

            if (previousCardUid) {
                player.selectedLineup = player.selectedLineup.filter(c => c && c.uid !== previousCardUid);
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
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (player.rerollShop()) {
                socket.emit('player:sync', {
                    gold: player.gold,
                    shop: player.shop
                });
            }
        });

        socket.on('shop:toggleLock', ({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (player.shop[shopIndex] && player.shop[shopIndex].card) {
                player.shop[shopIndex].locked = !player.shop[shopIndex].locked;
                socket.emit('player:sync', { shop: player.shop });
            }
        });

        socket.on('market:buy', ({ marketCardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive || gameManager.round < 2) return;
            const item = gameManager.activeMarketCards.find(c => c.card.uid === marketCardUid);
            if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

            const price = Math.floor(item.card.totalStats / 10);
            if (player.gold < price) return;

            player.gold -= price;
            player.purchasedMarketUids.add(marketCardUid);

            const boughtCard = JSON.parse(JSON.stringify(item.card));
            boughtCard.uid = 'card_' + Math.random().toString(36).substring(2, 9);
            boughtCard.isMarketCard = true;
            boughtCard.sellerName = item.sellerName;
            boughtCard.starCount = item.card.starCount || 1;
            player.hand.push(boughtCard);
            player.sortHand();

            socket.emit('player:sync', {
                gold: player.gold,
                hand: player.hand
            });
            syncMarketToAll();
        });

        socket.on('market:buyAndDeploy', ({ marketCardUid, slotIndex, previousCardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive || gameManager.round < 2) return;
            const item = gameManager.activeMarketCards.find(c => c.card.uid === marketCardUid);
            if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

            const price = Math.floor(item.card.totalStats / 10);
            if (player.gold < price) return;

            player.gold -= price;
            player.purchasedMarketUids.add(marketCardUid);

            const boughtCard = JSON.parse(JSON.stringify(item.card));
            boughtCard.uid = 'card_' + Math.random().toString(36).substring(2, 9);
            boughtCard.isMarketCard = true;
            boughtCard.sellerName = item.sellerName;
            boughtCard.starCount = item.card.starCount || 1;
            player.hand.push(boughtCard);
            player.sortHand();

            if (previousCardUid) {
                player.selectedLineup = player.selectedLineup.filter(c => c && c.uid !== previousCardUid);
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
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            const baseCard = player.hand.find(c => c.uid === baseUid);
            if (!baseCard) return;

            let matCard = null;
            let cost = 0;

            if (source.type === 'hand') {
                matCard = player.hand.find(c => c.uid === source.uid);
                if (!matCard || matCard.uid === baseUid) return;
            } else if (source.type === 'deploy') {
                matCard = player.selectedLineup.find(c => c && c.uid === source.uid);
                if (!matCard || matCard.uid === baseUid) return;
            } else if (source.type === 'shop') {
                const item = player.shop[source.shopIndex];
                if (!item || !item.card) return;
                matCard = item.card;
                cost = matCard.cost;
                if (player.gold < cost) return;
            } else if (source.type === 'market') {
                const item = gameManager.activeMarketCards.find(c => c.card.uid === source.marketCardUid);
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

                const baseStar = baseCard.starCount || 1;
                const matStar = matCard.starCount || 1;
                baseCard.starCount = baseStar + matStar;

                baseCard.isMarketCard = false;
                delete baseCard.sellerName;

                if (source.type === 'hand') {
                    player.hand = player.hand.filter(c => c.uid !== matCard.uid);
                } else if (source.type === 'deploy') {
                    player.selectedLineup = player.selectedLineup.map(c => (c && c.uid === matCard.uid ? null : c));
                    player.hand = player.hand.filter(c => c.uid !== matCard.uid);
                } else if (source.type === 'shop') {
                    player.shop[source.shopIndex] = { card: null, locked: false };
                } else if (source.type === 'market') {
                    player.purchasedMarketUids.add(source.marketCardUid);
                    syncMarketToAll();
                }

                player.sortHand();

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
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            const card = player.hand.find(c => c.uid === cardUid);
            if (!card) return;

            // 2: 解雇ゴールド計算方式の変更（ショップ購入額 × ★数値 ÷ 2 または 4、小数点以下切り捨て）
            const cost = RARITY_SETTINGS[card.rarity] ? RARITY_SETTINGS[card.rarity].cost : (card.cost || 2);
            const stars = card.starCount || 1;
            const gainGold = card.isMarketCard
                ? Math.floor((cost * stars) / 4)
                : Math.floor((cost * stars) / 2);

            player.gold += gainGold;
            player.hand = player.hand.filter(c => c.uid !== cardUid);
            player.selectedLineup = player.selectedLineup.map(c => (c && c.uid === cardUid ? null : c));
            player.sortHand();

            gameManager.pendingDiscards.push({
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
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            player.selectedLineup = lineupUids
                .map(uid => player.hand.find(c => c && c.uid === uid))
                .filter(Boolean)
                .slice(0, 3);
        });

        socket.on('player:setReady', ({ lineupUids }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            player.selectedLineup = lineupUids
                .map(uid => player.hand.find(c => c && c.uid === uid))
                .filter(Boolean)
                .slice(0, 3);

            player.isReady = true;
            broadcastGameState();

            const active = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
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
            if (gameManager.allBattlesData[targetPlayerId]) {
                const survivors = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                socket.emit('battle:start', {
                    ...gameManager.allBattlesData[targetPlayerId],
                    isGameOverDecided: survivors.length <= 1
                });
            }
        });

        socket.on('game:forceEnd', () => {
            if (socket.id !== gameManager.hostSocketId) return;
            gameManager.gameState = 'ended';

            const active = Object.values(gameManager.players).filter(p => p.isEntered);
            active.sort((a, b) => b.life - a.life);

            let rankings = [];
            let curRank = 1;
            for (let i = 0; i < active.length; i++) {
                if (i > 0 && active[i].life < active[i - 1].life) {
                    curRank = i + 1;
                }
                rankings.push({ rank: curRank, name: active[i].name, life: active[i].life });
            }

            gameManager.disconnectedPlayers.forEach(dp => {
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

            if (gameManager.gameState === 'ended') {
                const anyOtherPlaying = Object.values(gameManager.players).some(p => p.id !== player.id && p.isEntered && gameManager.gameState !== 'ended');
                if (!anyOtherPlaying) {
                    gameManager.gameState = 'lobby';
                    gameManager.round = 1;
                }
            }
            broadcastLobbyState();
            broadcastGameState();
        });

        // 退出処理 (本人のみ確実にロビー初期状態へ戻す)
        socket.on('lobby:leave', () => {
            player.isEntered = false;
            player.isReady = false;
            player.isAlive = true;

            // 本人に対して単独でロビー復帰同期を送信
            socket.emit('game:sync', {
                gameState: 'lobby',
                round: 1,
                hostSocketId: gameManager.hostSocketId,
                players: gameManager.getPublicPlayerList()
            });

            broadcastLobbyState();
        });

        socket.on('disconnect', () => {
            gameManager.removePlayer(socket.id);

            if (gameManager.gameState === 'prep') {
                const activePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                Object.keys(gameManager.roundMatchups).forEach(pid => {
                    if (gameManager.roundMatchups[pid].opponentId === socket.id) {
                        let candidates = activePlayers.filter(p => p.id !== pid);
                        if (candidates.length === 0 && gameManager.players[pid]) candidates = [gameManager.players[pid]];
                        if (candidates.length > 0) {
                            const ghostBase = candidates[Math.floor(Math.random() * candidates.length)];
                            gameManager.roundMatchups[pid] = {
                                opponentId: 'ghost_' + ghostBase.id,
                                opponentName: ghostBase.name + ' (影)',
                                isGhost: true,
                                originalId: ghostBase.id
                            };
                            io.to(pid).emit('matchup:notice', {
                                opponentName: gameManager.roundMatchups[pid].opponentName
                            });
                        }
                    }
                });
            }

            checkImmediateWinnerOnDisconnect();
            broadcastLobbyState();
            broadcastGameState();

            if (gameManager.gameState === 'prep') {
                const active = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                if (active.length > 0 && active.every(p => p.isReady)) {
                    startBattlePhase();
                }
            } else if (gameManager.gameState === 'battle') {
                checkEndBattlePhase();
            }
        });
    });
}

module.exports = { registerSocketHandlers };