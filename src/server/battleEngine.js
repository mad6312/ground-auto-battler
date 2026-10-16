/**
 * src/server/battleEngine.js
 * 戦闘計算・マッチング・シミュレーションモジュール (要件改修版)
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

    p1.lastRoundInfo = {
        lineup: p1CombatTeam.map(c => JSON.parse(JSON.stringify(c))),
        bench: applyTribeBonus(p1Bench, p1.hand).map(c => JSON.parse(JSON.stringify(c)))
    };
    if (!isP2Ghost) {
        p2.lastRoundInfo = {
            lineup: p2CombatTeam.map(c => JSON.parse(JSON.stringify(c))),
            bench: applyTribeBonus(p2Bench, p2.hand).map(c => JSON.parse(JSON.stringify(c)))
        };
    }

    const logs = [];
    // 8: 交戦した全カード組み合わせ履歴 (順序維持)
    const combatPairRecords = [];

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
            combatPairs: []
        };
    }
    if (p1CombatTeam.length === 0) {
        logs.push({ text: `${p1.name}はカードを繰り出していないため強制敗北！`, damage: 0, counts: getCountsMeta() });
        return {
            winnerId: p2.id,
            winnerName: p2.name,
            loserIds: [p1.id],
            logs,
            combatPairs: []
        };
    }
    if (p2CombatTeam.length === 0) {
        logs.push({ text: `${p2.name}はカードを繰り出していないため強制敗北！`, damage: 0, counts: getCountsMeta() });
        return {
            winnerId: p1.id,
            winnerName: p1.name,
            loserIds: isP2Ghost ? [] : [p2.id],
            logs,
            combatPairs: []
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

    // 現在対面しているペアの記録ポインタ
    let currentPair = {
        p1Card: JSON.parse(JSON.stringify(active1)),
        p2Card: JSON.parse(JSON.stringify(active2)),
        damageP1toP2: 0,
        damageP2toP1: 0,
        faintedSide: null // 'p1' | 'p2' | null
    };
    combatPairRecords.push(currentPair);

    while (p1Index < p1CombatTeam.length && p2Index < p2CombatTeam.length && turnCount < maxTurns) {
        turnCount++;
        active1 = p1CombatTeam[p1Index];
        active2 = p2CombatTeam[p2Index];

        // ペアが変わったかチェック
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

        // 7: HPを差し引く
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
            // 7: リアルタイム残HP同期用
            state: {
                p1Card: JSON.parse(JSON.stringify(active1)),
                p2Card: JSON.parse(JSON.stringify(active2))
            }
        });

        if (defCard.hp <= 0) {
            const faintedSide = attackerIsP1 ? 'p2' : 'p1';
            currentPair.faintedSide = faintedSide;

            logs.push({
                text: `${defPlayer.name}の『${defCard.name}』は倒れた！`,
                damage: 0,
                faintedSide,
                counts: getCountsMeta(),
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

        if (p1RemCards > p2RemCards || (p1RemCards === p2RemCards && p1TotalRemHp > p2TotalRemHp)) {
            logs.push({ text: `規定ターン終了！ 残存数・HP優勢により ${p1.name} の勝利！`, damage: 0, counts: getCountsMeta() });
            winnerId = p1.id;
            winnerName = p1.name;
            if (!isP2Ghost) loserIds.push(p2.id);
        } else if (p2RemCards > p1RemCards || (p1RemCards === p2RemCards && p2TotalRemHp > p1TotalRemHp)) {
            logs.push({ text: `規定ターン終了！ 残存数・HP優勢により ${p2.name} の勝利！`, damage: 0, counts: getCountsMeta() });
            winnerId = p2.id;
            winnerName = p2.name;
            loserIds.push(p1.id);
        } else {
            logs.push({ text: `規定ターン終了！ 残存数・HP同等により引き分け！`, damage: 0, counts: getCountsMeta() });
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
 * 過去の対戦履歴を考慮したマッチング作成
 */
function createRoundMatchups(activePlayers, matchHistory = {}) {
    const matchups = {};
    if (activePlayers.length === 0) return matchups;

    let pool = [...activePlayers].sort(() => Math.random() - 0.5);
    const matchedIds = new Set();

    for (let i = 0; i < pool.length; i++) {
        const p1 = pool[i];
        if (matchedIds.has(p1.id)) continue;

        const history = matchHistory[p1.id] || new Set();

        let opponent = null;
        for (let j = i + 1; j < pool.length; j++) {
            const p2 = pool[j];
            if (!matchedIds.has(p2.id) && !history.has(p2.id)) {
                opponent = p2;
                break;
            }
        }

        if (!opponent) {
            for (let j = i + 1; j < pool.length; j++) {
                const p2 = pool[j];
                if (!matchedIds.has(p2.id)) {
                    opponent = p2;
                    break;
                }
            }
        }

        if (opponent) {
            matchups[p1.id] = { opponentId: opponent.id, opponentName: opponent.name, isGhost: false };
            matchups[opponent.id] = { opponentId: p1.id, opponentName: p1.name, isGhost: false };
            matchedIds.add(p1.id);
            matchedIds.add(opponent.id);
        } else {
            let candidates = activePlayers.filter(p => p.id !== p1.id);
            if (candidates.length === 0) candidates = [p1];

            let unplayedCandidates = candidates.filter(c => !history.has(c.id));
            let chosenCandidate = unplayedCandidates.length > 0
                ? unplayedCandidates[Math.floor(Math.random() * unplayedCandidates.length)]
                : candidates[Math.floor(Math.random() * candidates.length)];

            matchups[p1.id] = {
                opponentId: 'ghost_' + chosenCandidate.id,
                opponentName: chosenCandidate.name + ' (影)',
                isGhost: true,
                originalId: chosenCandidate.id
            };
            matchedIds.add(p1.id);
        }
    }

    return matchups;
}

module.exports = {
    applyTribeBonus,
    simulateBattle,
    createRoundMatchups
};