/**
 * public/js/battleUI.js
 * バトル演出・アニメーション・リザルト描画モジュール (不具合根本修正版)
 */

import { state, dom, socket, formatLife, renderCardDots, clearAllBattleTimers } from './state.js';
import { createCardElement } from './cardUI.js';

function safeTimeout(fn, ms) {
    const id = setTimeout(() => {
        state.battleTimeoutIds = state.battleTimeoutIds.filter(tid => tid !== id);
        fn();
    }, ms);
    state.battleTimeoutIds.push(id);
    return id;
}

export function spawnDamagePopup(container, text, type) {
    const popup = document.createElement('div');
    popup.className = `damage-popup ${type}`;
    popup.textContent = text;
    container.appendChild(popup);
    safeTimeout(() => popup.remove(), 1000);
}

export function startBattleAnimation(summary, logs, gameOverFlag) {
    clearAllBattleTimers(); // 前回のタイマーを完全破棄

    state.currentBattleData = { summary, logs };
    state.isGameOverDecided = !!gameOverFlag;

    dom.waitAnnouncementBanner.classList.add('hidden');

    if (state.reservedSpectateTargetId && !state.myPlayer?.isAlive) {
        state.activeSpectatingId = state.reservedSpectateTargetId;
    }

    dom.battleScreen.classList.remove('hidden');
    dom.battleLogList.innerHTML = '';

    // 自分がどちらの陣営でも必ず左側に自分、右側に相手を配置
    const isSpectating = summary.p1Id !== state.myId && summary.p2Id !== state.myId;
    const needSwap = !isSpectating && summary.p2Id === state.myId;

    const leftName = needSwap ? summary.p2Name : summary.p1Name;
    const rightName = needSwap ? summary.p1Name : summary.p2Name;

    dom.battleViewTitle.textContent = isSpectating ? `観戦：${leftName} VS ${rightName}` : 'バトルフェーズ';
    if (isSpectating) dom.spectatingBadge.classList.remove('hidden');
    else dom.spectatingBadge.classList.add('hidden');

    dom.bP1Name.textContent = isSpectating ? leftName : 'あなた';
    dom.bP2Name.textContent = rightName;
    dom.bP1CardSlot.innerHTML = '';
    dom.bP2CardSlot.innerHTML = '';

    let leftSlotHasCard = false;
    let rightSlotHasCard = false;

    let logIndex = 0;

    function advanceStep() {
        // 4: 最終リザルトやバトルリザルト表示後はステップを即座に停止
        if (!dom.gameOverModal.classList.contains('hidden') || !dom.resultModal.classList.contains('hidden')) {
            clearAllBattleTimers();
            return;
        }

        if (logIndex >= logs.length) {
            clearAllBattleTimers();
            safeTimeout(() => {
                // 最終リザルト画面が開いていない場合のみリザルトを表示
                if (dom.gameOverModal.classList.contains('hidden')) {
                    showBattleResult(summary);
                }
            }, 1200);
            return;
        }

        const log = logs[logIndex];

        if (log.counts) {
            const p1Rem = needSwap ? log.counts.p2Remaining : log.counts.p1Remaining;
            const p1Tot = needSwap ? log.counts.p2Total : log.counts.p1Total;
            const p2Rem = needSwap ? log.counts.p1Remaining : log.counts.p2Remaining;
            const p2Tot = needSwap ? log.counts.p1Total : log.counts.p2Total;

            dom.p1CardsIndicator.textContent = renderCardDots(p1Tot, p1Rem);
            dom.p2CardsIndicator.textContent = renderCardDots(p2Tot, p2Rem);
        }

        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        if (log.damage > 0) logItem.classList.add('dmg');
        if (log.isCrit) logItem.classList.add('crit');
        logItem.textContent = log.text;
        dom.battleLogList.appendChild(logItem);

        requestAnimationFrame(() => {
            dom.battleLogList.scrollTop = dom.battleLogList.scrollHeight;
            logItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        // HP0消滅アニメーション
        if (log.faintedSide) {
            const isLeft = (log.faintedSide === 'p1' !== needSwap);
            const targetSide = isLeft ? dom.p1Combatant : dom.p2Combatant;
            const targetSlot = isLeft ? dom.bP1CardSlot : dom.bP2CardSlot;

            if (isLeft) leftSlotHasCard = false;
            else rightSlotHasCard = false;

            targetSide.classList.add('anim-faint');
            safeTimeout(() => {
                targetSide.classList.remove('anim-faint');
                targetSlot.innerHTML = '';
            }, 440);
        }

        // 次のカードの繰り出し
        if (log.deployedSide) {
            const isLeft = (log.deployedSide === 'p1' !== needSwap);
            const slot = isLeft ? dom.bP1CardSlot : dom.bP2CardSlot;
            const newCard = isLeft
                ? (needSwap ? log.state?.p2Card : log.state?.p1Card)
                : (needSwap ? log.state?.p1Card : log.state?.p2Card);

            if (newCard) {
                if (isLeft) leftSlotHasCard = true;
                else rightSlotHasCard = true;

                slot.innerHTML = '';
                slot.appendChild(createCardElement(newCard, {
                    nonDraggable: true,
                    isNew: true,
                    isMyCombatant: false
                }));
            }
        }

        if (log.attacker) {
            const atkIsP1 = (log.attacker === 'p1') !== needSwap;
            const atkSide = atkIsP1 ? dom.p1Combatant : dom.p2Combatant;
            const defSide = atkIsP1 ? dom.p2Combatant : dom.p1Combatant;

            atkSide.classList.add(atkIsP1 ? 'anim-atk-p1' : 'anim-atk-p2');
            safeTimeout(() => atkSide.classList.remove('anim-atk-p1', 'anim-atk-p2'), 400);

            safeTimeout(() => {
                if (!log.isHit) {
                    defSide.classList.add('anim-dodge');
                    spawnDamagePopup(defSide, 'MISS', 'miss');
                    safeTimeout(() => defSide.classList.remove('anim-dodge'), 450);
                } else {
                    defSide.classList.add('anim-hurt');
                    let popType = 'normal';
                    if (log.isCrit) popType = 'crit';
                    else if (log.attrMult === 2.0) popType = 'weak';
                    else if (log.attrMult === 0.5) popType = 'resist';

                    spawnDamagePopup(defSide, `-${log.damage}`, popType);
                    safeTimeout(() => defSide.classList.remove('anim-hurt'), 400);
                }
            }, 200);
        }

        // 通常描画
        if (log.state && !log.faintedSide && !log.deployedSide) {
            const leftCard = needSwap ? log.state.p2Card : log.state.p1Card;
            const rightCard = needSwap ? log.state.p1Card : log.state.p2Card;

            if (leftCard && leftCard.hp > 0 && !leftSlotHasCard) {
                dom.bP1CardSlot.innerHTML = '';
                dom.bP1CardSlot.appendChild(createCardElement(leftCard, {
                    nonDraggable: true,
                    isMyCombatant: false
                }));
                leftSlotHasCard = true;
            }
            if (rightCard && rightCard.hp > 0 && !rightSlotHasCard) {
                dom.bP2CardSlot.innerHTML = '';
                dom.bP2CardSlot.appendChild(createCardElement(rightCard, {
                    nonDraggable: true,
                    isMyCombatant: false
                }));
                rightSlotHasCard = true;
            }
        }

        logIndex++;
    }

    advanceStep();
    state.battleAnimationTimer = setInterval(advanceStep, 700);
}

// 4: スキップ時に未完了の非同期タイマーを即座に完全破棄
export function skipBattle() {
    if (!state.currentBattleData) return;
    clearAllBattleTimers();

    dom.battleLogList.innerHTML = '';
    state.currentBattleData.logs.forEach(l => {
        const item = document.createElement('div');
        item.className = 'log-item';
        if (l.damage > 0) item.classList.add('dmg');
        if (l.isCrit) item.classList.add('crit');
        item.textContent = l.text;
        dom.battleLogList.appendChild(item);
    });
    requestAnimationFrame(() => {
        dom.battleLogList.scrollTop = dom.battleLogList.scrollHeight;
    });

    const lastLog = state.currentBattleData.logs[state.currentBattleData.logs.length - 1];
    if (lastLog && lastLog.counts) {
        const isSpectating = state.currentBattleData.summary.p1Id !== state.myId && state.currentBattleData.summary.p2Id !== state.myId;
        const needSwap = !isSpectating && state.currentBattleData.summary.p2Id === state.myId;
        const p1Rem = needSwap ? lastLog.counts.p2Remaining : lastLog.counts.p1Remaining;
        const p1Tot = needSwap ? lastLog.counts.p2Total : lastLog.counts.p1Total;
        const p2Rem = needSwap ? lastLog.counts.p1Remaining : lastLog.counts.p2Remaining;
        const p2Tot = needSwap ? lastLog.counts.p1Total : lastLog.counts.p2Total;

        dom.p1CardsIndicator.textContent = renderCardDots(p1Tot, p1Rem);
        dom.p2CardsIndicator.textContent = renderCardDots(p2Tot, p2Rem);
    }

    // 最終リザルトが表示されていなければバトルリザルトを表示
    if (dom.gameOverModal.classList.contains('hidden')) {
        showBattleResult(state.currentBattleData.summary);
    }
}

export function showBattleResult(summary) {
    // 4: 最終リザルト表示中であれば絶対にバトルリザルトを開かない
    if (!dom.gameOverModal.classList.contains('hidden')) return;

    dom.battleScreen.classList.add('hidden');
    dom.resultModal.classList.remove('hidden');

    const isSpectating = summary.p1Id !== state.myId && summary.p2Id !== state.myId;
    const isP1 = summary.p1Id === state.myId;
    const isP2 = summary.p2Id === state.myId;

    const isWinner = !isSpectating && summary.winnerId === state.myId;
    const isDraw = !summary.winnerId && summary.loserIds && summary.loserIds.includes(state.myId);
    const opponentName = isP1 ? summary.p2Name : summary.p1Name;

    if (isSpectating) {
        if (summary.winnerName) {
            dom.resultTitle.textContent = '🏆 バトル終了';
            dom.resultTitle.style.color = 'var(--accent-color)';
            dom.resultSummaryText.textContent = `${summary.winnerName} がバトルに勝利しました！`;
        } else {
            dom.resultTitle.textContent = '⚔ バトル終了';
            dom.resultTitle.style.color = 'var(--warning-color)';
            dom.resultSummaryText.textContent = `対戦は引き分けでした。`;
        }
    } else {
        if (isWinner) {
            dom.resultTitle.textContent = '🏆 バトル勝利！';
            dom.resultTitle.style.color = 'var(--success-color)';
            dom.resultSummaryText.textContent = `${opponentName} との対戦に勝利しました！`;
        } else if (isDraw) {
            dom.resultTitle.textContent = '⚔ 引き分け';
            dom.resultTitle.style.color = 'var(--warning-color)';
            dom.resultSummaryText.textContent = `${opponentName} との対戦は引き分けでした。`;
        } else {
            dom.resultTitle.textContent = '💀 バトル敗北…';
            dom.resultTitle.style.color = 'var(--danger-color)';
            dom.resultSummaryText.textContent = `${opponentName} との対戦に敗北しました。（ライフ -1）`;
        }
    }

    const myDamages = isSpectating
        ? summary.detailedDamagesP1
        : (isP2 ? summary.detailedDamagesP2 : summary.detailedDamagesP1);

    dom.resultDamageTableBody.innerHTML = '';
    if (myDamages && myDamages.length > 0) {
        myDamages.forEach(d => {
            const row = document.createElement('tr');
            const tdAtk = document.createElement('td');
            const tdDef = document.createElement('td');
            const tdDmg = document.createElement('td');

            if (d.atkCard) {
                tdAtk.appendChild(createCardElement(d.atkCard, { nonDraggable: true, isMyResultCard: false }));
            } else {
                tdAtk.textContent = d.atkCardName;
            }

            if (d.defCard) {
                tdDef.appendChild(createCardElement(d.defCard, { nonDraggable: true, isMyResultCard: false }));
            } else {
                tdDef.textContent = d.defCardName;
            }

            tdDmg.className = 'dmg-col-center';
            tdDmg.textContent = d.damage;

            row.appendChild(tdAtk);
            row.appendChild(tdDef);
            row.appendChild(tdDmg);
            dom.resultDamageTableBody.appendChild(row);
        });
    } else {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="3" style="text-align:center;">戦闘ダメージなし</td>`;
        dom.resultDamageTableBody.appendChild(row);
    }

    dom.resultLogList.innerHTML = '';
    if (state.currentBattleData && state.currentBattleData.logs) {
        state.currentBattleData.logs.forEach(l => {
            const item = document.createElement('div');
            item.className = 'log-item';
            if (l.damage > 0) item.classList.add('dmg');
            if (l.isCrit) item.classList.add('crit');
            item.textContent = l.text;
            dom.resultLogList.appendChild(item);
        });
    }
}

// 4: 最終リザルト表示時、すべてのバトルタイマーとバトルリザルトを完全破棄・隠匿
export function showGameOver(rankings) {
    clearAllBattleTimers(); // タイマー完全破棄

    dom.battleScreen.classList.add('hidden');
    dom.resultModal.classList.add('hidden'); // バトルリザルト画面を確実に閉じる
    dom.waitAnnouncementBanner.classList.add('hidden');
    dom.gameOverModal.classList.remove('hidden');

    const winner = rankings.find(r => r.rank === 1);
    if (winner) {
        dom.winnerCelebration.classList.remove('hidden');
        dom.winnerNameDisplay.textContent = winner.name;
    } else {
        dom.winnerCelebration.classList.add('hidden');
    }

    dom.finalRankingTableBody.innerHTML = '';
    rankings.forEach(r => {
        const row = document.createElement('tr');

        if (r.isDisconnected) {
            row.innerHTML = `
        <td class="rank-dc">切断</td>
        <td>${r.name}</td>
        <td>-</td>
      `;
        } else {
            let rankText = `${r.rank}th`;
            let rankClass = 'rank-other';
            if (r.rank === 1) { rankText = '1st'; rankClass = 'rank-1st'; }
            else if (r.rank === 2) { rankText = '2nd'; rankClass = 'rank-2nd'; }
            else if (r.rank === 3) { rankText = '3rd'; rankClass = 'rank-3rd'; }

            const lifeText = `<span class="final-life-red">${formatLife(r.life)}</span>`;

            row.innerHTML = `
        <td class="${rankClass}">${rankText}</td>
        <td>${r.name} ${r.isJointWinner ? '🎉(同時優勝)' : ''}</td>
        <td>${lifeText}</td>
      `;
        }

        dom.finalRankingTableBody.appendChild(row);
    });
}