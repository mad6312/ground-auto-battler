/**
 * src/server/socketHandlers.js
 * Socket.io イベントハンドラモジュール (完全改修版)
 */

const { gameManager, Player, normalizeLineup, generateSecureCardUid } = require('./gameManager');
const { simulateBattle, createRoundMatchups } = require('./battleEngine');
const { RARITY_SETTINGS } = require('../../cardsData');

const guard = (fn) => (payload) => {
    try {
        fn(payload ?? {});
    } catch (e) {
        console.error('Socket handler error:', e);
    }
};

function cleanPlayerName(str) {
    if (typeof str !== 'string') return '';
    // 制御文字・Unicode双方向オーバーライド文字を除去
    const sanitized = str.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E]/g, '').trim();
    return sanitized.substring(0, 16);
}

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
        if (gameManager.gameState === 'battle') {
            io.emit('market:sync', { activeMarketCards: [] });
            return;
        }

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

    // H-3 / M-9: 決着種別と切断者状況を完全考慮した順位計算
    function computeRankings() {
        const allEntered = Object.values(gameManager.players).filter(p => p.isEntered);
        const survivors = allEntered.filter(p => p.isAlive);
        const deadPlayers = allEntered.filter(p => !p.isAlive);

        let rankings = [];

        // 決着時に勝者が記録されていたが、その後切断されたかを確認
        let isSoleWinnerDisconnected = false;
        if (gameManager.finalOutcome && gameManager.finalOutcome.type === 'winner') {
            const winnerStillConnected = allEntered.some(p => p.id === gameManager.finalOutcome.id);
            if (!winnerStillConnected) {
                isSoleWinnerDisconnected = true;
            }
        }

        const isNoWinnerSituation = isSoleWinnerDisconnected ||
            (survivors.length === 0 && (!gameManager.finalOutcome || gameManager.finalOutcome.type === 'noWinner') && deadPlayers.every(p => (p.eliminatedRound || 1) < gameManager.round));

        if (isNoWinnerSituation) {
            rankings.push({ rank: '-', name: '（優勝者なし）', life: 0, isNoWinner: true });
        } else if (survivors.length >= 2) {
            // 強制終了等の場合：残りライフ降順
            const sortedSurvivors = [...survivors].sort((a, b) => b.life - a.life);
            let currentRank = 1;
            for (let i = 0; i < sortedSurvivors.length; i++) {
                if (i > 0 && sortedSurvivors[i].life !== sortedSurvivors[i - 1].life) {
                    currentRank = i + 1;
                }
                const isTopTied = currentRank === 1 && sortedSurvivors.filter(s => s.life === sortedSurvivors[0].life).length > 1;
                rankings.push({
                    rank: currentRank,
                    id: sortedSurvivors[i].id,
                    name: sortedSurvivors[i].name,
                    life: sortedSurvivors[i].life,
                    isJointWinner: isTopTied
                });
            }
        } else if (survivors.length === 1) {
            // 単独生存者
            rankings.push({
                rank: 1,
                id: survivors[0].id,
                name: survivors[0].name,
                life: survivors[0].life
            });
        } else if (survivors.length === 0) {
            // 同時全滅（最終ラウンドで全員脱落）
            const targetElimRound = (gameManager.finalOutcome && gameManager.finalOutcome.type === 'jointWinners' && gameManager.finalOutcome.round)
                ? gameManager.finalOutcome.round
                : Math.max(1, ...deadPlayers.map(p => p.eliminatedRound || 1));

            const jointWinners = deadPlayers.filter(p => (p.eliminatedRound || 1) === targetElimRound);
            jointWinners.forEach(p => {
                rankings.push({
                    rank: 1,
                    id: p.id,
                    name: p.name,
                    life: p.life,
                    isJointWinner: jointWinners.length > 1
                });
            });
        }

        // 脱落者の順位決定（同ラウンド脱落は同順位、未登録者のみ）
        const rankedIds = new Set(rankings.map(r => r.id).filter(Boolean));
        const remainingDead = deadPlayers.filter(p => !rankedIds.has(p.id));
        remainingDead.sort((a, b) => (b.eliminatedRound || 0) - (a.eliminatedRound || 0));

        let currentRankNum = rankings.filter(r => !r.isNoWinner).length + 1;
        for (let i = 0; i < remainingDead.length; i++) {
            if (i > 0 && remainingDead[i].eliminatedRound !== remainingDead[i - 1].eliminatedRound) {
                currentRankNum = rankings.filter(r => !r.isNoWinner).length + 1;
            }
            rankings.push({
                rank: currentRankNum,
                id: remainingDead[i].id,
                name: remainingDead[i].name,
                life: remainingDead[i].life
            });
        }

        // 切断プレイヤーの表示（最下位行・グレー）
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

    // ゲーム終了処理を一元化
    function endGameCompletely() {
        if (gameManager.gameState === 'ended') return;
        gameManager.gameState = 'ended';

        const finalRankings = computeRankings();
        io.emit('game:ended', { rankings: finalRankings });

        // 全プレイヤーの参加状態を安全にリセット
        Object.values(gameManager.players).forEach(p => {
            p.isEntered = false;
            p.isReady = false;
            p.hasClickedNext = false;
        });

        gameManager.gameState = 'lobby';
        gameManager.round = 1;
        gameManager.gameOverDecided = false;
        gameManager.finalOutcome = null;
        gameManager.roundMatchups = {};
        gameManager.allBattlesData = {};
        gameManager.battleParticipants.clear();

        broadcastGameState();
        broadcastLobbyState();
    }

    function startBattlePhase() {
        gameManager.gameState = 'battle';

        const activePlayers = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);

        // H-5: マッチングの完全存在検証（欠けている生存者がいれば即時再マッチング）
        const missingMatchup = activePlayers.some(p => !gameManager.roundMatchups[p.id]);
        if (missingMatchup || Object.keys(gameManager.roundMatchups).length === 0) {
            gameManager.roundMatchups = createRoundMatchups(activePlayers, gameManager.matchHistory);
        }

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
            let m = gameManager.roundMatchups[p1.id];
            if (!m) {
                // 安全策：影を緊急生成
                m = {
                    opponentId: 'ghost_' + p1.id,
                    opponentName: p1.name + ' (影)',
                    isGhost: true,
                    originalId: p1.id
                };
                gameManager.roundMatchups[p1.id] = m;
            }

            const pairKey = [p1.id, m.opponentId].sort().join('___');
            if (processedPairs.has(pairKey)) return;
            processedPairs.add(pairKey);

            let p2 = gameManager.players[m.opponentId];
            let isGhost = m.isGhost;

            gameManager.recordMatch(p1.id, m.opponentId, isGhost ? m.originalId : null);

            if (isGhost) {
                let ghostBase = gameManager.players[m.originalId];
                if (!ghostBase) {
                    const fallbackCandidates = activePlayers.filter(p => p.id !== p1.id);
                    ghostBase = fallbackCandidates.length > 0
                        ? fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)]
                        : p1;
                }
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

        gameManager.gameOverDecided = instantGameOver;
        gameManager.battleParticipants = new Set(Object.keys(gameManager.allBattlesData));

        // H-3: 決着種別を明示記録
        if (instantGameOver) {
            if (survivors.length === 1) {
                gameManager.finalOutcome = { type: 'winner', id: survivors[0].id };
            } else {
                const maxElim = Math.max(...alivePlayers.map(p => p.eliminatedRound || gameManager.round));
                const joint = alivePlayers.filter(p => (p.eliminatedRound || gameManager.round) === maxElim);
                gameManager.finalOutcome = {
                    type: 'jointWinners',
                    round: maxElim,
                    ids: joint.map(p => p.id)
                };
            }
        }

        const finalRankings = instantGameOver ? computeRankings() : null;

        // L-1: クライアント側の状態認識を先行同期
        broadcastGameState();

        Object.values(gameManager.players).forEach(p => {
            if (gameManager.allBattlesData[p.id]) {
                io.to(p.id).emit('battle:start', {
                    ...gameManager.allBattlesData[p.id],
                    isGameOverDecided: instantGameOver,
                    rankings: finalRankings
                });
            } else if (p.isEntered && !p.isAlive) {
                io.to(p.id).emit('battle:start_notice', {
                    isGameOverDecided: instantGameOver,
                    rankings: finalRankings
                });
            }
        });
    }

    function checkEndBattlePhase() {
        const remaining = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
        const activeParticipants = Array.from(gameManager.battleParticipants).map(id => gameManager.players[id]).filter(Boolean);

        if (gameManager.gameOverDecided || remaining.length <= 1) {
            const allParticipantsNext = activeParticipants.length === 0 || activeParticipants.every(p => p.hasClickedNext);
            if (allParticipantsNext) {
                endGameCompletely();
            }
            return;
        }

        const allNext = remaining.every(p => p.hasClickedNext);
        if (!allNext) return;

        gameManager.advanceToNextRound();

        broadcastGameState();
        notifyRoundMatchups();

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

        // L-11: 名前の制御文字サニタイズ
        socket.on('player:rename', guard((newName) => {
            const cleaned = cleanPlayerName(newName);
            if (cleaned.length > 0) {
                player.name = cleaned;

                if (gameManager.gameState === 'prep') {
                    Object.entries(gameManager.roundMatchups).forEach(([pid, m]) => {
                        if (m.opponentId === player.id) {
                            m.opponentName = player.name;
                            io.to(pid).emit('matchup:notice', { opponentName: m.opponentName });
                        } else if (m.isGhost && m.originalId === player.id) {
                            m.opponentName = player.name + ' (影)';
                            io.to(pid).emit('matchup:notice', { opponentName: m.opponentName });
                        }
                    });
                }

                broadcastLobbyState();
                broadcastGameState();
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
            gameManager.updateHost();
            if (socket.id !== gameManager.hostSocketId) return;

            if (gameManager.gameState !== 'lobby') {
                if (gameManager.gameOverDecided || gameManager.gameState === 'ended') {
                    endGameCompletely();
                } else {
                    return;
                }
            }

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

            broadcastGameState();
            notifyRoundMatchups();
        }));

        socket.on('shop:buy', guard(({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;

            const item = player.shop[shopIndex];
            if (!item || !item.card) return;

            if (player.gold < item.card.cost) {
                socket.emit('shop:buy:error', { message: 'ゴールドが足りません' });
                return;
            }

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
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) return;

            const item = player.shop[shopIndex];
            if (!item || !item.card) return;

            if (player.gold < item.card.cost) {
                socket.emit('shop:buy:error', { message: 'ゴールドが足りません' });
                return;
            }

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

        socket.on('shop:reroll', guard(() => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            if (player.gold < 2) {
                socket.emit('shop:buy:error', { message: 'ゴールドが足りません' });
                return;
            }
            if (player.rerollShop(gameManager.round)) {
                socket.emit('player:sync', {
                    gold: player.gold,
                    shop: player.shop
                });
            }
        }));

        socket.on('shop:toggleLock', guard(({ shopIndex }) => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            if (!Number.isInteger(shopIndex) || shopIndex < 0 || shopIndex > 5) return;
            if (player.shop[shopIndex] && player.shop[shopIndex].card) {
                player.shop[shopIndex].locked = !player.shop[shopIndex].locked;
                socket.emit('player:sync', { shop: player.shop });
            }
        }));

        socket.on('market:buy', guard(({ marketCardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive || gameManager.round < 2) return;
            if (typeof marketCardUid !== 'string') return;

            const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === marketCardUid);
            if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

            const cost = RARITY_SETTINGS[item.card.rarity] ? RARITY_SETTINGS[item.card.rarity].cost : (item.card.cost || 2);
            const stars = item.card.starCount || 1;
            const price = Math.floor((cost * stars) / 2);

            if (player.gold < price) {
                socket.emit('market:buy:error', { message: 'ゴールドが足りません' });
                return;
            }

            player.gold -= price;
            player.purchasedMarketUids.add(marketCardUid);

            const boughtCard = JSON.parse(JSON.stringify(item.card));
            boughtCard.uid = generateSecureCardUid();
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
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive || gameManager.round < 2) return;
            if (typeof marketCardUid !== 'string') return;
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) return;

            const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === marketCardUid);
            if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(marketCardUid)) return;

            const cost = RARITY_SETTINGS[item.card.rarity] ? RARITY_SETTINGS[item.card.rarity].cost : (item.card.cost || 2);
            const stars = item.card.starCount || 1;
            const price = Math.floor((cost * stars) / 2);

            if (player.gold < price) {
                socket.emit('market:buy:error', { message: 'ゴールドが足りません' });
                return;
            }

            player.gold -= price;
            player.purchasedMarketUids.add(marketCardUid);

            const boughtCard = JSON.parse(JSON.stringify(item.card));
            boughtCard.uid = generateSecureCardUid();
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
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
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
            } else if (source.type === 'market') {
                if (typeof source.marketCardUid !== 'string') return;
                const item = gameManager.activeMarketCards.find(c => c.card && c.card.uid === source.marketCardUid);
                if (!item || item.sellerId === player.id || player.purchasedMarketUids.has(source.marketCardUid)) return;
                matCard = item.card;
                const mCost = RARITY_SETTINGS[matCard.rarity] ? RARITY_SETTINGS[matCard.rarity].cost : (matCard.cost || 2);
                const mStars = matCard.starCount || 1;
                cost = Math.floor((mCost * mStars) / 2);
            }

            if (!matCard) return;

            if (baseCard.rarity !== matCard.rarity || baseCard.tribe !== matCard.tribe) {
                return;
            }

            if (cost > 0 && player.gold < cost) {
                if (source.type === 'shop') {
                    socket.emit('shop:buy:error', { message: 'ゴールドが足りません' });
                } else if (source.type === 'market') {
                    socket.emit('market:buy:error', { message: 'ゴールドが足りません' });
                }
                return;
            }

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
        }));

        socket.on('card:discard', guard(({ cardUid }) => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
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

            const discardCard = JSON.parse(JSON.stringify(card));
            if (discardCard.isNewDistributed) delete discardCard.isNewDistributed;
            discardCard.sellerName = player.name;

            gameManager.pendingDiscards.push({
                card: discardCard,
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
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            player.selectedLineup = normalizeLineup(player, lineupUids);
        }));

        socket.on('player:setReady', guard(({ lineupUids }) => {
            if (gameManager.gameState !== 'prep' || !player.isEntered || !player.isAlive) return;
            player.selectedLineup = normalizeLineup(player, lineupUids);

            player.isReady = true;
            broadcastGameState();

            const active = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
            if (active.length > 0 && active.every(p => p.isReady)) {
                startBattlePhase();
            }
        }));

        socket.on('battle:next', guard(() => {
            if (gameManager.gameState !== 'battle') return;

            player.hasClickedNext = true;
            player.isReady = true;
            broadcastGameState();

            checkEndBattlePhase();
        }));

        // L-6: 観戦取得のフェーズ検証
        socket.on('spectate:getBattle', guard(({ targetPlayerId }) => {
            if (gameManager.gameState !== 'battle') return;
            if (typeof targetPlayerId !== 'string') return;
            if (!player.isEntered) return;
            if (player.isAlive && !player.hasClickedNext) return;

            if (gameManager.allBattlesData[targetPlayerId]) {
                const survivors = Object.values(gameManager.players).filter(p => p.isAlive && p.isEntered);
                socket.emit('battle:start', {
                    ...gameManager.allBattlesData[targetPlayerId],
                    isGameOverDecided: survivors.length <= 1,
                    rankings: survivors.length <= 1 ? computeRankings() : null
                });
            }
        }));

        socket.on('game:forceEnd', guard(() => {
            if (socket.id !== gameManager.hostSocketId) return;
            if (gameManager.gameState !== 'prep' && gameManager.gameState !== 'battle') return;
            endGameCompletely();
        }));

        // H-1 / H-2 / M-8: 再戦の安全化と一本化
        socket.on('lobby:rematch', guard(() => {
            // 決着後のみ受け付け
            if (gameManager.gameState !== 'lobby') {
                if (gameManager.gameOverDecided || gameManager.gameState === 'ended') {
                    endGameCompletely();
                } else {
                    return; // 試合進行中は遮断
                }
            }

            // 10人定員チェック
            const enteredCount = Object.values(gameManager.players).filter(p => p.isEntered).length;
            if (!player.isEntered && enteredCount >= 10) return;

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

        // H-1 / H-2 / M-1: 退出の安全化
        socket.on('lobby:leave', guard(() => {
            if (gameManager.gameState !== 'lobby') {
                if (gameManager.gameOverDecided || gameManager.gameState === 'ended') {
                    endGameCompletely();
                } else {
                    return; // 試合進行中は遮断
                }
            }

            player.isEntered = false;
            player.isReady = false;
            player.isAlive = true;

            gameManager.updateHost(); // M-1: ホスト委譲

            socket.emit('game:sync', {
                gameState: 'lobby',
                round: 1,
                hostSocketId: gameManager.hostSocketId,
                players: gameManager.getPublicPlayerList()
            });

            broadcastLobbyState();
            broadcastGameState();
        }));

        socket.on('disconnect', () => {
            try {
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
            } catch (err) {
                console.error('Error during player disconnect handling:', err);
            }
        });
    });
}

module.exports = { registerSocketHandlers };