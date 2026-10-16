/**
 * src/server/socketHandlers.js
 * Socket.io イベントハンドラモジュール (要件改修版)
 */

const { gameManager, Player, normalizeLineup } = require('./gameManager');
const { simulateBattle, createRoundMatchups } = require('./battleEngine');
const { RARITY_SETTINGS } = require('../../cardsData');

// 不正ペイロード・例外によるサーバークラッシュを防ぐ共通ガードラッパー
const guard = (fn) => (payload) => {
    try {
        fn(payload ?? {});
    } catch (e) {
        console.error('Socket handler error:', e);
    }
};

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
            const m = gameManager.roundMatchups[pid];
            if (m) {
                io.to(pid).emit('matchup:notice', {
                    opponentName: m.opponentName
                });
            }
        });
    }

    function computeRankings() {
        const allEntered = Object.values(gameManager.players).filter(p => p.isEntered);
        const survivors = allEntered.filter(p => p.isAlive);
        const deadPlayers = allEntered.filter(p => !p.isAlive);

        let rankings = [];

        if (survivors.length === 1) {
            rankings.push({ rank: 1, name: survivors[0].name, life: survivors[0].life });
        } else if (survivors.length === 0 && deadPlayers.length > 0) {
            const maxElimRound = Math.max(...deadPlayers.map(p => p.eliminatedRound || 1));
            const jointWinners = deadPlayers.filter(p => (p.eliminatedRound || 1) === maxElimRound);
            jointWinners.forEach(p => {
                rankings.push({ rank: 1, name: p.name, life: p.life, isJointWinner: true });
            });
        }

        const rankedUids = new Set(rankings.map(r => r.name));
        const remainingDead = deadPlayers.filter(p => !rankedUids.has(p.name));
        remainingDead.sort((a, b) => (b.eliminatedRound || 0) - (a.eliminatedRound || 0));

        let currentRank = rankings.length + 1;
        for (let i = 0; i < remainingDead.length; i++) {
            if (i > 0 && remainingDead[i].eliminatedRound !== remainingDead[i - 1].eliminatedRound) {
                currentRank = rankings.length + 1;
            }
            rankings.push({
                rank: currentRank,
                name: remainingDead[i].name,
                life: remainingDead[i].life
            });
        }

        gameManager.disconnectedPlayers.forEach(dp => {
            rankings.push({ isDisconnected: true, name: dp.name });
        });

        return rankings;
    }

    function checkImmediateWinnerOnDisconnect() {
        if (gameManager.gameState === 'lobby' || gameManager.gameState === 'ended') return;

        const activeEntered = Object.values(gameManager.players).filter(p => p.isEntered);
        const survivors = activeEntered.filter(p => p.isAlive);

        if (survivors.length <= 1) {
            endGameCompletely();
        }
    }

    function endGameCompletely() {
        gameManager.gameState = 'ended';
        const finalRankings = computeRankings();
        io.emit('game:ended', { rankings: finalRankings });

        Object.values(gameManager.players).forEach(p => {
            p.isEntered = false;
            p.isReady = false;
        });
        gameManager.gameState = 'lobby';

        broadcastGameState();
        broadcastLobbyState();
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

            // 8: 全交戦ペア結果 (combatPairs) を含める
            const battlePayload = {
                summary: {
                    p1Id: p1.id,
                    p2Id: p2.id,
                    p1Name: p1.name,
                    p2Name: p2.name,
                    winnerId: res.winnerId,
                    winnerName: res.winnerName,
                    loserIds: res.loserIds,
                    combatPairs: res.combatPairs || []
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
            if (p.life <= 0) {
                p.isAlive = false;
                p.eliminatedRound = gameManager.round;
            }
        });

        const survivors = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
        const instantGameOver = survivors.length <= 1;

        Object.values(gameManager.players).forEach(p => {
            if (gameManager.allBattlesData[p.id]) {
                io.to(p.id).emit('battle:start', {
                    ...gameManager.allBattlesData[p.id],
                    isGameOverDecided: instantGameOver
                });
            } else if (p.isEntered && !p.isAlive) {
                io.to(p.id).emit('battle:start_notice', {
                    isGameOverDecided: instantGameOver
                });
            }
        });

        broadcastGameState();
    }

    function checkEndBattlePhase() {
        const remaining = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);

        if (remaining.length <= 1) {
            endGameCompletely();
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

        socket.on('player:rename', guard((newName) => {
            if (typeof newName === 'string' && newName.trim().length > 0) {
                player.name = newName.trim().substring(0, 16);
                broadcastLobbyState();
                broadcastGameState();
                notifyRoundMatchups();
            }
        }));

        socket.on('lobby:toggleEntry', guard(() => {
            if (gameManager.gameState !== 'lobby') return;
            const enteredCount = Object.values(gameManager.players).filter(p => p.isEntered).length;

            if (!player.isEntered && enteredCount >= 10) {
                return;
            }

            player.isEntered = !player.isEntered;
            broadcastLobbyState();
        }));

        socket.on('lobby:startGame', guard(() => {
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
        }));

        socket.on('shop:buy', guard(({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;

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
        }));

        socket.on('shop:buyAndDeploy', guard(({ shopIndex, slotIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) return;

            const item = player.shop[shopIndex];
            if (!item || !item.card || player.gold < item.card.cost) return;

            player.gold -= item.card.cost;
            const boughtCard = item.card;
            player.shop[shopIndex] = { card: null, locked: false };

            player.hand.push(boughtCard);
            player.sortHand();

            player.selectedLineup[slotIndex] = boughtCard;

            socket.emit('player:sync', {
                gold: player.gold,
                hand: player.hand,
                shop: player.shop,
                selectedLineup: player.selectedLineup
            });
        }));

        // 5: リロール時にも現在のラウンド別出現率を適用
        socket.on('shop:reroll', guard(() => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (player.rerollShop(gameManager.round)) {
                socket.emit('player:sync', {
                    gold: player.gold,
                    shop: player.shop
                });
            }
        }));

        socket.on('shop:toggleLock', guard(({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;
            if (player.shop[shopIndex] && player.shop[shopIndex].card) {
                player.shop[shopIndex].locked = !player.shop[shopIndex].locked;
                socket.emit('player:sync', { shop: player.shop });
            }
        }));

        socket.on('market:buy', guard(({ marketCardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive || gameManager.round < 2) return;
            if (typeof marketCardUid !== 'string') return;

            const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === marketCardUid);
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
        }));

        socket.on('market:buyAndDeploy', guard(({ marketCardUid, slotIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive || gameManager.round < 2) return;
            if (typeof marketCardUid !== 'string') return;
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) return;

            const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === marketCardUid);
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

            player.selectedLineup[slotIndex] = boughtCard;

            socket.emit('player:sync', {
                gold: player.gold,
                hand: player.hand,
                selectedLineup: player.selectedLineup
            });
            syncMarketToAll();
        }));

        socket.on('card:synthesizeEx', guard(({ baseUid, source }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (typeof baseUid !== 'string' || !source || typeof source.type !== 'string') return;

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
                if (!Number.isInteger(source.shopIndex) || source.shopIndex < 0 || source.shopIndex > 5) return;
                const item = player.shop[source.shopIndex];
                if (!item || !item.card) return;
                matCard = item.card;
                cost = matCard.cost;
                if (player.gold < cost) return;
            } else if (source.type === 'market') {
                if (typeof source.marketCardUid !== 'string') return;
                const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === source.marketCardUid);
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
                    player.selectedLineup = player.selectedLineup.map(c => (c && c.uid === matCard.uid ? null : c));
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
        }));

        socket.on('card:discard', guard(({ cardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            if (typeof cardUid !== 'string') return;

            const card = player.hand.find(c => c.uid === cardUid);
            if (!card) return;

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
        }));

        socket.on('player:updateLineup', guard(({ lineupUids }) => {
            // 3: 敗北・脱落プレイヤーの操作を遮断
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            player.selectedLineup = normalizeLineup(player, lineupUids);
        }));

        socket.on('player:setReady', guard(({ lineupUids }) => {
            // 3: 敗北・脱落プレイヤーの準備完了操作を確実に無効化
            if (gameManager.gameState !== 'prep' || !player.isAlive) return;
            player.selectedLineup = normalizeLineup(player, lineupUids);

            player.isReady = true;
            broadcastGameState();

            const active = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
            if (active.every(p => p.isReady)) {
                startBattlePhase();
            }
        }));

        // 1: バトルリザルト画面で「次へ」をクリックした際、待機ランプ(isReady)を点灯し同期
        socket.on('battle:next', guard(() => {
            if (gameManager.gameState !== 'battle' || !player.isAlive || player.hasClickedNext) return;
            player.hasClickedNext = true;
            player.isReady = true; // 待機ランプを点灯
            broadcastGameState();  // 他プレイヤーおよび自身の画面にリアルタイム同期
            checkEndBattlePhase();
        }));

        socket.on('spectate:getBattle', guard(({ targetPlayerId }) => {
            if (typeof targetPlayerId !== 'string') return;
            if (gameManager.allBattlesData[targetPlayerId]) {
                const survivors = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                socket.emit('battle:start', {
                    ...gameManager.allBattlesData[targetPlayerId],
                    isGameOverDecided: survivors.length <= 1
                });
            }
        }));

        socket.on('game:forceEnd', guard(() => {
            if (socket.id !== gameManager.hostSocketId) return;
            if (gameManager.gameState !== 'prep' && gameManager.gameState !== 'battle') return;
            endGameCompletely();
        }));

        socket.on('lobby:rematch', guard(() => {
            player.life = 5;
            player.gold = 20;
            player.hand = [];
            player.shop = [];
            player.selectedLineup = [null, null, null];
            player.isReady = false;
            player.hasClickedNext = false;
            player.isAlive = true;
            player.eliminatedRound = null;
            player.isEntered = true;

            broadcastLobbyState();
            broadcastGameState();
        }));

        socket.on('lobby:leave', guard(() => {
            player.isEntered = false;
            player.isReady = false;
            player.isAlive = true;

            socket.emit('game:sync', {
                gameState: 'lobby',
                round: 1,
                hostSocketId: gameManager.hostSocketId,
                players: gameManager.getPublicPlayerList()
            });

            broadcastLobbyState();
        }));

        socket.on('disconnect', () => {
            gameManager.removePlayer(socket.id);

            if (gameManager.gameState === 'prep') {
                const activePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                Object.keys(gameManager.roundMatchups).forEach(pid => {
                    const m = gameManager.roundMatchups[pid];
                    if (m && (m.opponentId === socket.id || m.originalId === socket.id)) {
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