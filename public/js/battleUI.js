/**
 * public/js/battleUI.js
 * バトル演出・アニメーション・リザルト描画モジュール (要件改修版)
 */

import { state, dom, socket, formatLife, renderCardDots, clearAllBattleTimers, escapeHtml } from './state.js';
import { createCardElement } from './cardUI.js';

let backgroundSkipTimer = null;

function clearBackgroundSkipTimer() {
    if (backgroundSkipTimer) {
        clearTimeout(backgroundSkipTimer);
        backgroundSkipTimer = null;
    }
}

function startBackgroundSkipTimerIfNeeded() {
    clearBackgroundSkipTimer();
    if (document.hidden && !dom.battleScreen.classList.contains('hidden') && state.battleAnimationTimer) {
        backgroundSkipTimer = setTimeout(() => {
            if (document.hidden && !dom.battleScreen.classList.contains('hidden') && state.battleAnimationTimer) {
                skipBattle();
            }
        }, 30000);
    }
}

function safeTimeout(fn, ms) {
    const id = setTimeout(() => {
        state.battleTimeoutIds = state.battleTimeoutIds.filter(tid => tid !== id);
        fn();
    }, ms);
    state.battleTimeoutIds.push(id);
    return id;
}

function cleanupCombatantVisuals() {
    const animClasses = ['anim-faint', 'anim-atk-p1', 'anim-atk-p2', 'anim-hurt', 'anim-dodge'];
    if (dom.p1Combatant) dom.p1Combatant.classList.remove(...animClasses);
    if (dom.p2Combatant) dom.p2Combatant.classList.remove(...animClasses);
    document.querySelectorAll('.damage-popup').forEach(p => p.remove());
}

export function spawnDamagePopup(container, text, type) {
    const popup = document.createElement('div');
    popup.className = `damage-popup ${type}`;
    popup.textContent = text;
    container.appendChild(popup);
    safeTimeout(() => popup.remove(), 1000);
}

function updateCardSlotHp(cardSlotElement, newHp) {
    if (!cardSlotElement) return;
    const hpValEl = cardSlotElement.querySelector('.stat-hp .stat-val');
    if (hpValEl) {
        hpValEl.textContent = Math.max(0, newHp);
    }
}

export function resetResultModalScrollPositions() {
    const selectors = [
        '.result-damage-table-wrapper',
        '#result-log-drawer',
        '#result-log-list',
        '.result-split-body',
        '.result-damage-panel',
        '.result-log-panel'
    ];
    selectors.forEach(sel => {
        const el = dom.resultModal.querySelector(sel);
        if (el) {
            el.scrollTop = 0;
            el.scrollLeft = 0;
        }
    });

    const modalContent = dom.resultModal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.scrollTop = 0;
        modalContent.scrollLeft = 0;
    }
}

export function startBattleAnimation(summary, logs, gameOverFlag) {
    clearAllBattleTimers();
    clearBackgroundSkipTimer();
    cleanupCombatantVisuals();

    state.currentBattleData = { summary, logs };
    state.isGameOverDecided = !!gameOverFlag;

    dom.waitAnnouncementBanner.classList.add('hidden');

    if (state.reservedSpectateTargetId && !state.myPlayer?.isAlive) {
        state.activeSpectatingId = state.reservedSpectateTargetId;
    }

    dom.battleScreen.classList.remove('hidden');
    dom.battleLogList.innerHTML = '';

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
        if (!dom.gameOverModal.classList.contains('hidden') || !dom.resultModal.classList.contains('hidden')) {
            clearAllBattleTimers();
            clearBackgroundSkipTimer();
            cleanupCombatantVisuals();
            return;
        }

        // 戦闘終了時
        if (logIndex >= logs.length) {
            clearAllBattleTimers();
            clearBackgroundSkipTimer();
            cleanupCombatantVisuals();
            safeTimeout(() => {
                if (dom.gameOverModal.classList.contains('hidden')) {
                    showBattleResult(summary);
                }
            }, 1400);
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

        if (log.faintedSide) {
            const isLeft = (log.faintedSide === 'p1' !== needSwap);
            const targetSide = isLeft ? dom.p1Combatant : dom.p2Combatant;
            const targetSlot = isLeft ? dom.bP1CardSlot : dom.bP2CardSlot;

            updateCardSlotHp(targetSlot, 0);

            if (isLeft) leftSlotHasCard = false;
            else rightSlotHasCard = false;

            targetSide.classList.add('anim-faint');
            safeTimeout(() => {
                targetSide.classList.remove('anim-faint');
                targetSlot.innerHTML = '';
            }, 440);
        }

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
            const defSlot = atkIsP1 ? dom.bP2CardSlot : dom.bP1CardSlot;

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

                    const defRemainingHp = atkIsP1
                        ? (needSwap ? log.state?.p1Card?.hp : log.state?.p2Card?.hp)
                        : (needSwap ? log.state?.p2Card?.hp : log.state?.p1Card?.hp);

                    if (defRemainingHp !== undefined) {
                        updateCardSlotHp(defSlot, defRemainingHp);
                    }
                }
            }, 200);
        }

        // 要件2: 片方のみカードが存在する場合でも確実にスロットへ描画
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

    startBackgroundSkipTimerIfNeeded();
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        clearBackgroundSkipTimer();
    } else {
        startBackgroundSkipTimerIfNeeded();
    }
});

export function skipBattle() {
    if (!state.currentBattleData) return;
    clearAllBattleTimers();
    clearBackgroundSkipTimer();
    cleanupCombatantVisuals();

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

    if (dom.gameOverModal.classList.contains('hidden')) {
        showBattleResult(state.currentBattleData.summary);
    }
}

export function showBattleResult(summary) {
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
            dom.resultSummaryText.textContent = `${opponentName} との対戦は引き分けでした。（両者ライフ -1）`;
        } else {
            dom.resultTitle.textContent = '💀 バトル敗北…';
            dom.resultTitle.style.color = 'var(--danger-color)';
            dom.resultSummaryText.textContent = `${opponentName} との対戦に敗北しました。（ライフ -1）`;
        }
    }

    dom.resultDamageTableBody.innerHTML = '';
    const combatPairs = summary.combatPairs || [];

    if (combatPairs.length > 0) {
        combatPairs.forEach(pair => {
            const row = document.createElement('tr');
            const tdMy = document.createElement('td');
            const tdOpp = document.createElement('td');
            const tdDmg = document.createElement('td');

            let myCard = null;
            let oppCard = null;
            let damageGiven = 0;
            let myFainted = false;
            let oppFainted = false;

            if (isP2) {
                myCard = pair.p2Card;
                oppCard = pair.p1Card;
                damageGiven = pair.damageP2toP1;
                myFainted = (pair.faintedSide === 'p2');
                oppFainted = (pair.faintedSide === 'p1');
            } else {
                myCard = pair.p1Card;
                oppCard = pair.p2Card;
                damageGiven = pair.damageP1toP2;
                myFainted = (pair.faintedSide === 'p1');
                oppFainted = (pair.faintedSide === 'p2');
            }

            if (myCard) {
                const elMy = createCardElement(myCard, { nonDraggable: true, isMyResultCard: false });
                if (myFainted) {
                    elMy.classList.add('card-portrait-memorial');
                }
                tdMy.appendChild(elMy);
            } else {
                tdMy.textContent = '-';
            }

            if (oppCard) {
                const elOpp = createCardElement(oppCard, { nonDraggable: true, isMyResultCard: false });
                if (oppFainted) {
                    elOpp.classList.add('card-portrait-memorial');
                }
                tdOpp.appendChild(elOpp);
            } else {
                tdOpp.textContent = '-';
            }

            tdDmg.className = 'dmg-col-center';
            tdDmg.textContent = damageGiven;

            row.appendChild(tdMy);
            row.appendChild(tdOpp);
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

    requestAnimationFrame(() => {
        resetResultModalScrollPositions();
    });
}

export function showGameOver(rankings) {
    clearAllBattleTimers();
    clearBackgroundSkipTimer();
    cleanupCombatantVisuals();

    state.pendingReadyAfterDiscard = false;

    dom.battleScreen.classList.add('hidden');
    dom.resultModal.classList.add('hidden');
    dom.waitAnnouncementBanner.classList.add('hidden');

    dom.modalOverhand.classList.add('hidden');
    dom.modalConfirm.classList.add('hidden');
    dom.modalHistory.classList.add('hidden');
    dom.modalSettings.classList.add('hidden');

    dom.gameOverModal.classList.remove('hidden');

    const hasNoWinner = rankings.some(r => r.isNoWinner);
    const winners = hasNoWinner ? [] : rankings.filter(r => r.rank === 1 && !r.isNoWinner);

    if (winners.length > 0) {
        dom.winnerCelebration.classList.remove('hidden');
        dom.winnerNameDisplay.textContent = winners.map(w => w.name).join(' & ');
    } else {
        dom.winnerCelebration.classList.add('hidden');
    }

    dom.finalRankingTableBody.innerHTML = '';
    rankings.forEach(r => {
        const row = document.createElement('tr');

        if (r.isDisconnected) {
            row.innerHTML = `
        <td class="rank-dc">切断</td>
        <td>${escapeHtml(r.name)}</td>
        <td>-</td>
      `;
        } else if (r.isNoWinner) {
            row.innerHTML = `
        <td class="rank-other">-</td>
        <td>${escapeHtml(r.name)}</td>
        <td>-</td>
      `;
        } else {
            let rankText = `${r.rank}th`;
            let rankClass = 'rank-other';
            if (r.rank === 1) { rankText = '1st'; rankClass = 'rank-1st'; }
            else if (r.rank === 2) { rankText = '2nd'; rankClass = 'rank-2nd'; }
            else if (r.rank === 3) { rankText = '3rd'; rankClass = 'rank-3rd'; }

            const lifeText = `<span class="final-life-red">${formatLife(r.life)}</span>`;
            const jointBadge = r.isJointWinner ? ' 🎉(同時優勝)' : '';

            row.innerHTML = `
        <td class="${rankClass}">${rankText}</td>
        <td>${escapeHtml(r.name)}${jointBadge}</td>
        <td>${lifeText}</td>
      `;
        }

        dom.finalRankingTableBody.appendChild(row);
    });
}