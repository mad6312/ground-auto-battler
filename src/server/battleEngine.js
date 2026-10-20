/**
 * src/server/battleEngine.js
 * 戦闘計算・マッチング・シミュレーションモジュール (前ラウンド情報確定タイミング最適化版)
 */

const {
    ELEMENT_RELATIONS,
    TRIBE_BONUSES,
    BATTLE_HIT_RATE,
    applyPercentRoundHalfUp
} = require('../../cardsData');
const { Player } = require('./gameManager');

/**
 * 各プレイヤー単体の所持カードのみを対象とした種族ボーナス補正計算
 */
function applyTribeBonus(cardsInBattle, allCardsInPossession) {
    const tribeCounts = {};
    allCardsInPossession.forEach(c => {
        if (c) tribeCounts[c.tribe] = (tribeCounts[c.tribe] || 0) + 1;
    });

    return cardsInBattle.map(card => {
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

/**
 * 1対1自動戦闘シミュレーション
 */
function simulateBattle(p1, p2, isP2Ghost = false) {
    const p1LineupCards = (p1.selectedLineup || []).filter(Boolean);
    const p2LineupCards = (p2.selectedLineup || []).filter(Boolean);

    const p1DeployUids = new Set(p1LineupCards.map(c => c.uid));
    const p2DeployUids = new Set(p2LineupCards.map(c => c.uid));

    const p1Bench = p1.hand.filter(c => !p1DeployUids.has(c.uid));
    const p2Bench = p2.hand.filter(c => !p2DeployUids.has(c.uid));

    const p1CombatTeam = applyTribeBonus(p1LineupCards, p1.hand);
    const p2CombatTeam = applyTribeBonus(p2LineupCards, p2.hand);

    // バトル中の「前ラウンド情報」先行上書きを防止し、次ラウンド移行時に確定反映するよう一時保持
    p1.pendingLastRoundInfo = {
        lineup: p1CombatTeam.map(c => JSON.parse(JSON.stringify(c))),
        bench: applyTribeBonus(p1Bench, p1.hand).map(c => JSON.parse(JSON.stringify(c)))
    };
    if (!isP2Ghost) {
        p2.pendingLastRoundInfo = {
            lineup: p2CombatTeam.map(c => JSON.parse(JSON.stringify(c))),
            bench: applyTribeBonus(p2Bench, p2.hand).map(c => JSON.parse(JSON.stringify(c)))
        };
    }

    const logs = [];
    const combatPairRecords = [];

    const p1TotalCount = p1CombatTeam.length;
    const p2TotalCount = p2CombatTeam.length;

    const p1InitialTotalHp = Math.max(1, p1CombatTeam.reduce((sum, c) => sum + c.hp, 0));
    const p2InitialTotalHp = Math.max(1, p2CombatTeam.reduce((sum, c) => sum + c.hp, 0));

    let p1Index = 0;
    let p2Index = 0;

    const getCountsMeta = (p1Offset = 0, p2Offset = 0) => ({
        p1Total: p1TotalCount,
        p1Remaining: Math.max(0, p1TotalCount - (p1Index + p1Offset)),
        p2Total: p2TotalCount,
        p2Remaining: Math.max(0, p2TotalCount - (p2Index + p2Offset))
    });

    if (p1CombatTeam.length === 0 && p2CombatTeam.length === 0) {
        logs.push({ text: '両プレイヤーともカードが出撃していません。両者敗北！', damage: 0, counts: getCountsMeta() });
        return {
            winnerId: null,
            winnerName: null,
            loserIds: [p1.id, isP2Ghost ? null : p2.id].filter(Boolean),
            logs,
            combatPairs: []
        };
    }

    if (p1CombatTeam.length === 0) {
        const p2FirstCard = JSON.parse(JSON.stringify(p2CombatTeam[0]));
        logs.push({
            text: `${p1.name}はカードを繰り出していないため強制敗北！`,
            damage: 0,
            counts: getCountsMeta(),
            state: { p1Card: null, p2Card: p2FirstCard }
        });
        return {
            winnerId: p2.id,
            winnerName: p2.name,
            loserIds: [p1.id],
            logs,
            combatPairs: [{
                p1Card: null,
                p2Card: p2FirstCard,
                damageP1toP2: 0,
                damageP2toP1: 0,
                faintedSide: null
            }]
        };
    }

    if (p2CombatTeam.length === 0) {
        const p1FirstCard = JSON.parse(JSON.stringify(p1CombatTeam[0]));
        logs.push({
            text: `${p2.name}はカードを繰り出していないため強制敗北！`,
            damage: 0,
            counts: getCountsMeta(),
            state: { p1Card: p1FirstCard, p2Card: null }
        });
        return {
            winnerId: p1.id,
            winnerName: p1.name,
            loserIds: isP2Ghost ? [] : [p2.id],
            logs,
            combatPairs: [{
                p1Card: p1FirstCard,
                p2Card: null,
                damageP1toP2: 0,
                damageP2toP1: 0,
                faintedSide: null
            }]
        };
    }

    let turnCount = 0;
    const maxTurns = 300;

    let active1 = p1CombatTeam[p1Index];
    let active2 = p2CombatTeam[p2Index];

    logs.push({
        text: `【戦闘開始】 ${p1.name}の『${active1.name}』 vs ${p2.name}の『${active2.name}』！`,
        damage: 0,
        counts: getCountsMeta(),
        state: { p1Card: JSON.parse(JSON.stringify(active1)), p2Card: JSON.parse(JSON.stringify(active2)) }
    });

    let nextAttacker = null;

    let currentPair = {
        p1Card: JSON.parse(JSON.stringify(active1)),
        p2Card: JSON.parse(JSON.stringify(active2)),
        damageP1toP2: 0,
        damageP2toP1: 0,
        faintedSide: null
    };
    combatPairRecords.push(currentPair);

    while (p1Index < p1CombatTeam.length && p2Index < p2CombatTeam.length && turnCount < maxTurns) {
        turnCount++;
        active1 = p1CombatTeam[p1Index];
        active2 = p2CombatTeam[p2Index];

        if (currentPair.p1Card.uid !== active1.uid || currentPair.p2Card.uid !== active2.uid) {
            currentPair = {
                p1Card: JSON.parse(JSON.stringify(active1)),
                p2Card: JSON.parse(JSON.stringify(active2)),
                damageP1toP2: 0,
                damageP2toP1: 0,
                faintedSide: null
            };
            combatPairRecords.push(currentPair);
        }

        // 新カード繰り出し時および初期ターン：素早さを再度比較して先攻を決定
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

        const isHit = Math.random() < BATTLE_HIT_RATE;
        let finalDmg = 0;
        let isCrit = false;

        if (isHit) {
            if (Math.random() < (1 / 6)) {
                isCrit = true;
            }
            let dmg = baseDmg * attrMult * (isCrit ? 1.5 : 1.0);
            finalDmg = Math.round(dmg);

            if (isCrit) {
                finalDmg = Math.max(2, finalDmg);
            } else {
                finalDmg = Math.max(1, finalDmg);
            }

            if (attackerIsP1) {
                currentPair.damageP1toP2 += finalDmg;
            } else {
                currentPair.damageP2toP1 += finalDmg;
            }
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
                p1Card: JSON.parse(JSON.stringify(active1)),
                p2Card: JSON.parse(JSON.stringify(active2))
            }
        });

        if (defCard.hp <= 0) {
            const faintedSide = attackerIsP1 ? 'p2' : 'p1';
            currentPair.faintedSide = faintedSide;

            const faintedCounts = attackerIsP1 ? getCountsMeta(0, 1) : getCountsMeta(1, 0);

            logs.push({
                text: `${defPlayer.name}の『${defCard.name}』は倒れた！`,
                damage: 0,
                faintedSide,
                counts: faintedCounts,
                state: {
                    p1Card: JSON.parse(JSON.stringify(active1)),
                    p2Card: JSON.parse(JSON.stringify(active2))
                }
            });

            if (attackerIsP1) {
                p2Index++;
                if (p2Index < p2CombatTeam.length) {
                    active2 = p2CombatTeam[p2Index];
                    logs.push({
                        text: `${p2.name}は次のカード『${active2.name}』を繰り出した！`,
                        damage: 0,
                        deployedSide: 'p2',
                        counts: getCountsMeta(),
                        state: { p1Card: JSON.parse(JSON.stringify(active1)), p2Card: JSON.parse(JSON.stringify(active2)) }
                    });
                }
            } else {
                p1Index++;
                if (p1Index < p1CombatTeam.length) {
                    active1 = p1CombatTeam[p1Index];
                    logs.push({
                        text: `${p1.name}は次のカード『${active1.name}』を繰り出した！`,
                        damage: 0,
                        deployedSide: 'p1',
                        counts: getCountsMeta(),
                        state: { p1Card: JSON.parse(JSON.stringify(active1)), p2Card: JSON.parse(JSON.stringify(active2)) }
                    });
                }
            }
            // 新カード繰り出しのため、先攻をリセットして素早さを再比較する
            nextAttacker = null;
        } else {
            nextAttacker = attackerIsP1 ? 2 : 1;
        }
    }

    let winnerId = null;
    let winnerName = null;
    let loserIds = [];

    const p1Survives = p1Index < p1CombatTeam.length;
    const p2Survives = p2Index < p2CombatTeam.length;

    if (!p1Survives && !p2Survives) {
        logs.push({ text: '両者のカードが全滅しました。引き分け！', damage: 0, counts: getCountsMeta() });
        loserIds.push(p1.id);
        if (!isP2Ghost) loserIds.push(p2.id);
    } else if (!p1Survives) {
        logs.push({ text: `${p2.name}の勝利！`, damage: 0, counts: getCountsMeta() });
        winnerId = p2.id;
        winnerName = p2.name;
        loserIds.push(p1.id);
    } else if (!p2Survives) {
        logs.push({ text: `${p1.name}の勝利！`, damage: 0, counts: getCountsMeta() });
        winnerId = p1.id;
        winnerName = p1.name;
        if (!isP2Ghost) loserIds.push(p2.id);
    } else {
        const p1RemCards = p1CombatTeam.length - p1Index;
        const p2RemCards = p2CombatTeam.length - p2Index;
        let p1TotalRemHp = p1CombatTeam.slice(p1Index).reduce((sum, c) => sum + c.hp, 0);
        let p2TotalRemHp = p2CombatTeam.slice(p2Index).reduce((sum, c) => sum + c.hp, 0);

        const p1Ratio = p1TotalRemHp / p1InitialTotalHp;
        const p2Ratio = p2TotalRemHp / p2InitialTotalHp;

        if (p1RemCards > p2RemCards || (p1RemCards === p2RemCards && p1Ratio > p2Ratio + 1e-6)) {
            logs.push({ text: `規定ターン終了！ 残存数・HP比率優勢により ${p1.name} の勝利！`, damage: 0, counts: getCountsMeta() });
            winnerId = p1.id;
            winnerName = p1.name;
            if (!isP2Ghost) loserIds.push(p2.id);
        } else if (p2RemCards > p1RemCards || (p1RemCards === p2RemCards && p2Ratio > p1Ratio + 1e-6)) {
            logs.push({ text: `規定ターン終了！ 残存数・HP比率優勢により ${p2.name} の勝利！`, damage: 0, counts: getCountsMeta() });
            winnerId = p2.id;
            winnerName = p2.name;
            loserIds.push(p1.id);
        } else {
            logs.push({ text: `規定ターン終了！ 残存数・HP比率同等により引き分け！`, damage: 0, counts: getCountsMeta() });
            loserIds.push(p1.id);
            if (!isP2Ghost) loserIds.push(p2.id);
        }
    }

    return {
        winnerId,
        winnerName,
        loserIds,
        logs,
        combatPairs: combatPairRecords
    };
}

/**
 * 過去対戦履歴から対戦回数を取得
 */
function getMatchCount(matchHistory, idA, idB) {
    if (!matchHistory || !matchHistory[idA]) return 0;
    const record = matchHistory[idA];
    if (record instanceof Map) {
        return record.get(idB) || 0;
    }
    if (record instanceof Set) {
        return record.has(idB) ? 1 : 0;
    }
    if (typeof record === 'object') {
        return record[idB] || 0;
    }
    return 0;
}

/**
 * 3層ハイブリッド評価関数による完全均等マッチングアルゴリズム
 */
function createRoundMatchups(activePlayers, matchHistory = {}, matchMetadata = {}) {
    const matchups = {};
    if (!activePlayers || activePlayers.length === 0) return matchups;

    if (activePlayers.length === 1) {
        const sole = activePlayers[0];
        matchups[sole.id] = {
            opponentId: 'ghost_' + sole.id,
            opponentName: sole.name + ' (影)',
            isGhost: true,
            originalId: sole.id
        };
        return matchups;
    }

    const ghostMatchCounts = matchMetadata.ghostMatchCounts || {};
    const lastPvPOpponents = matchMetadata.lastPvPOpponents || {};
    const lastRoundGhostFighters = matchMetadata.lastRoundGhostFighters || new Set();
    const lastGhostSources = matchMetadata.lastGhostSources || {};

    const pool = [...activePlayers];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const n = pool.length;

    function getPvPCost(pA, pB) {
        const count = getMatchCount(matchHistory, pA.id, pB.id);
        let cost = count * 100;

        if (lastPvPOpponents[pA.id] === pB.id || lastPvPOpponents[pB.id] === pA.id) {
            cost += 1000;
        }

        return cost;
    }

    const minGhostCount = Math.min(...pool.map(p => ghostMatchCounts[p.id] || 0));

    function getGhostCost(oddPlayer, ghostSource) {
        let cost = 0;
        const gCount = ghostMatchCounts[oddPlayer.id] || 0;

        if (gCount > minGhostCount) {
            cost += (gCount - minGhostCount) * 10000;
        }

        if (lastRoundGhostFighters.has(oddPlayer.id)) {
            cost += 5000;
        }

        const sourceMatchCount = getMatchCount(matchHistory, oddPlayer.id, ghostSource.id);
        cost += sourceMatchCount * 10;

        if (lastGhostSources[oddPlayer.id] === ghostSource.id) {
            cost += 200;
        }

        if (lastPvPOpponents[oddPlayer.id] === ghostSource.id) {
            cost += 100;
        }

        return cost;
    }

    function solveEvenPairing(playerList) {
        const m = playerList.length;
        if (m === 0) return { pairs: [], cost: 0 };

        let bestPairs = null;
        let minCost = Infinity;

        function search(indices, currentPairs, currentCost) {
            if (currentCost >= minCost) return;
            if (indices.length === 0) {
                if (currentCost < minCost) {
                    minCost = currentCost;
                    bestPairs = currentPairs.map(p => [...p]);
                }
                return;
            }

            const first = indices[0];
            const rest = indices.slice(1);

            for (let i = 0; i < rest.length; i++) {
                const second = rest[i];
                const pairCost = getPvPCost(playerList[first], playerList[second]);
                const nextIndices = rest.filter((_, idx) => idx !== i);

                currentPairs.push([playerList[first], playerList[second]]);
                search(nextIndices, currentPairs, currentCost + pairCost);
                currentPairs.pop();
            }
        }

        const initialIndices = Array.from({ length: m }, (_, i) => i);
        search(initialIndices, [], 0);

        return { pairs: bestPairs || [], cost: minCost };
    }

    if (n % 2 === 0) {
        const result = solveEvenPairing(pool);
        result.pairs.forEach(([p1, p2]) => {
            matchups[p1.id] = { opponentId: p2.id, opponentName: p2.name, isGhost: false };
            matchups[p2.id] = { opponentId: p1.id, opponentName: p1.name, isGhost: false };
        });
        return matchups;
    }

    let bestTotalCost = Infinity;
    let bestOddGhost = null;
    let bestGhostSource = null;
    let bestEvenPairs = null;

    for (let i = 0; i < n; i++) {
        const oddPlayer = pool[i];
        const remainingPlayers = pool.filter((_, idx) => idx !== i);

        const evenSolution = solveEvenPairing(remainingPlayers);

        for (let j = 0; j < remainingPlayers.length; j++) {
            const sourceCandidate = remainingPlayers[j];
            const ghostCost = getGhostCost(oddPlayer, sourceCandidate);
            const totalCost = evenSolution.cost + ghostCost;

            if (totalCost < bestTotalCost) {
                bestTotalCost = totalCost;
                bestOddGhost = oddPlayer;
                bestGhostSource = sourceCandidate;
                bestEvenPairs = evenSolution.pairs;
            }
        }
    }

    if (bestEvenPairs) {
        bestEvenPairs.forEach(([p1, p2]) => {
            matchups[p1.id] = { opponentId: p2.id, opponentName: p2.name, isGhost: false };
            matchups[p2.id] = { opponentId: p1.id, opponentName: p1.name, isGhost: false };
        });
    }

    if (bestOddGhost && bestGhostSource) {
        matchups[bestOddGhost.id] = {
            opponentId: 'ghost_' + bestGhostSource.id,
            opponentName: bestGhostSource.name + ' (影)',
            isGhost: true,
            originalId: bestGhostSource.id
        };
    }

    return matchups;
}

module.exports = {
    applyTribeBonus,
    simulateBattle,
    createRoundMatchups
};