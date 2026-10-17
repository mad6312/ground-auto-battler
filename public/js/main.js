/**
 * public/js/main.js
 * クライアント側メインエントリーモジュール (要件改修版)
 */

import {
    state,
    dom,
    socket,
    formatLife,
    showConfirm,
    clearAllBattleTimers,
    resetClientGameState,
    showToast,
    escapeHtml
} from './state.js';
import {
    createCardElement,
    renderShop,
    renderMarketCards,
    renderHand,
    renderDeploySlots,
    updateMarketTabLabel,
    clearSynthesizableHighlights,
    animateCardFlight,
    sortHandCards,
    setCustomDropHandler
} from './cardUI.js';
import {
    startBattleAnimation,
    skipBattle,
    showGameOver,
    resetResultModalScrollPositions
} from './battleUI.js';

const WEAKNESS_MAP = {
    '火': '風',
    '氷': '火',
    '風': '氷',
    '雷': '地',
    '水': '雷',
    '地': '水'
};

let isRoundPopupPlaying = false;
let currentDistributeCardUid = null;
let hasClickedNextInBattle = false;
let latestRankings = null;

const displayedLifeMap = new Map();

function syncLineupChanges() {
    const lineupUids = [
        state.localDeploySlots[0] || null,
        state.localDeploySlots[1] || null,
        state.localDeploySlots[2] || null
    ];
    socket.emit('player:updateLineup', { lineupUids });
}

function proceedSetReady() {
    if (!state.myPlayer || !state.myPlayer.isAlive) return;

    const lineupUids = [
        state.localDeploySlots[0] || null,
        state.localDeploySlots[1] || null,
        state.localDeploySlots[2] || null
    ];
    socket.emit('player:setReady', { lineupUids });
    dom.playerReadyLamp.classList.add('ready');
    dom.btnFinishPrep.disabled = true;
    dom.waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
    dom.waitAnnouncementBanner.classList.remove('hidden');
}

let isDiscardingFromModal = false;
let discardModalSafetyTimer = null;

function showOverhandDiscardModal() {
    clearSynthesizableHighlights();
    dom.overhandCardList.innerHTML = '';
    dom.modalOverhand.classList.remove('hidden');

    state.localHand.forEach(card => {
        const cardEl = createCardElement(card, { nonDraggable: true });
        cardEl.style.cursor = 'pointer';
        cardEl.onclick = () => {
            if (isDiscardingFromModal) return;
            isDiscardingFromModal = true;
            cardEl.style.opacity = '0.5';

            clearTimeout(discardModalSafetyTimer);
            discardModalSafetyTimer = setTimeout(() => {
                isDiscardingFromModal = false;
                cardEl.style.opacity = '1';
            }, 1200);

            socket.emit('card:discard', { cardUid: card.uid });
        };
        dom.overhandCardList.appendChild(cardEl);
    });
}

function renderOpponentsBar() {
    dom.opponentsBar.innerHTML = '';
    const enteredPlayers = state.cachedOpponentsList.filter(p => p.isEntered);

    enteredPlayers.forEach(p => {
        const showMaskedLife = (state.currentGameState === 'battle' && !hasClickedNextInBattle);
        const effectiveLife = showMaskedLife
            ? (displayedLifeMap.has(p.id) ? displayedLifeMap.get(p.id) : p.life)
            : p.life;

        const effectiveIsAlive = effectiveLife > 0;

        if (p.id === state.myId) {
            state.myPlayer = p;
            dom.playerNameDisplay.textContent = p.name;
            dom.playerLifeDisplay.textContent = formatLife(effectiveLife);
            dom.playerGoldDisplay.textContent = `${p.gold}G`;

            if (p.isReady || hasClickedNextInBattle) {
                dom.playerReadyLamp.classList.add('ready');
            } else {
                dom.playerReadyLamp.classList.remove('ready');
            }

            if (!p.isAlive) {
                dom.btnFinishPrep.disabled = true;
            }
            return;
        }

        const card = document.createElement('div');
        card.className = `opponent-card ${!effectiveIsAlive ? 'dead' : ''}`;

        let actionBtnHtml = '';
        const isMeDead = state.myPlayer && !state.myPlayer.isAlive;
        const isMeFinishedBattle = hasClickedNextInBattle || (state.myPlayer && (state.myPlayer.isReady || state.myPlayer.hasClickedNext));

        if (isMeDead) {
            if (state.currentGameState === 'prep') {
                const isReserved = state.reservedSpectateTargetId === p.id;
                actionBtnHtml = `<button class="btn btn-reserve-spectate ${isReserved ? 'warning' : 'secondary'}">${isReserved ? '予約解除' : '観戦予約'}</button>`;
            } else if (effectiveIsAlive) {
                actionBtnHtml = `<button class="btn btn-spectate primary">観戦</button>`;
            }
        } else if (isMeFinishedBattle && state.currentGameState === 'battle' && effectiveIsAlive) {
            actionBtnHtml = `<button class="btn btn-spectate primary">観戦</button>`;
        }

        card.innerHTML = `
      <div class="opp-header">
        <span>${escapeHtml(p.name)}</span>
        <span class="ready-lamp ${p.isReady ? 'ready' : ''}"></span>
      </div>
      <div class="opp-life-row">
        <span class="opp-life">${formatLife(effectiveLife)}</span>
        ${actionBtnHtml}
      </div>
    `;

        const actBtn = card.querySelector('.btn-spectate, .btn-reserve-spectate');
        if (actBtn) {
            actBtn.onclick = (e) => {
                e.stopPropagation();
                if (isMeDead && state.currentGameState === 'prep') {
                    if (state.reservedSpectateTargetId === p.id) {
                        state.reservedSpectateTargetId = null;
                    } else {
                        state.reservedSpectateTargetId = p.id;
                    }
                    renderOpponentsBar();
                } else {
                    state.activeSpectatingId = p.id;
                    socket.emit('spectate:getBattle', { targetPlayerId: p.id });
                }
            };
        }

        card.onclick = () => {
            if (!effectiveIsAlive) return;

            if (state.currentRound > 1 && p.lastRoundInfo) {
                dom.historyPlayerName.textContent = `${p.name} の前ラウンド情報`;
                dom.historyLineup.innerHTML = '';
                dom.historyBench.innerHTML = '';

                p.lastRoundInfo.lineup.forEach(c => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'history-card-wrapper';
                    const weakElem = WEAKNESS_MAP[c.element] || 'なし';
                    wrapper.innerHTML = `
            <div class="history-weakness-badge">
              弱点：<span class="elem-badge elem-${weakElem}">${weakElem}</span>
            </div>
          `;
                    wrapper.appendChild(createCardElement(c, { nonDraggable: true }));
                    dom.historyLineup.appendChild(wrapper);
                });

                p.lastRoundInfo.bench.forEach(c => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'history-card-wrapper';
                    const weakElem = WEAKNESS_MAP[c.element] || 'なし';
                    wrapper.innerHTML = `
            <div class="history-weakness-badge">
              弱点：<span class="elem-badge elem-${weakElem}">${weakElem}</span>
            </div>
          `;
                    wrapper.appendChild(createCardElement(c, { nonDraggable: true }));
                    dom.historyBench.appendChild(wrapper);
                });

                dom.modalHistory.classList.remove('hidden');
            }
        };

        dom.opponentsBar.appendChild(card);
    });
}

function triggerRoundStartPopupAndDistribute(roundNumber, activePlayersCount) {
    const popup = document.getElementById('round-start-popup');
    const title = document.getElementById('round-popup-title');
    const playersText = document.getElementById('round-popup-players');

    title.textContent = `ラウンド ${roundNumber}`;
    playersText.textContent = `残プレイヤー: ${activePlayersCount}`;

    isRoundPopupPlaying = true;
    popup.classList.remove('hidden');

    renderHand(syncLineupChanges, { hideCardUid: currentDistributeCardUid });

    setTimeout(() => {
        popup.classList.add('hidden');
        isRoundPopupPlaying = false;

        renderHand(syncLineupChanges);

        if (currentDistributeCardUid) {
            const targetEl = dom.playerHandContainer.querySelector(`[data-card-uid="${currentDistributeCardUid}"]`);
            if (targetEl) {
                const targetRect = targetEl.getBoundingClientRect();
                const startRect = {
                    left: window.innerWidth / 2 - 62,
                    top: -160,
                    width: targetRect.width,
                    height: targetRect.height
                };
                animateCardFlight(startRect, targetEl);
            }
            currentDistributeCardUid = null;
        }
    }, 1600);
}

// ============================
// カスタムポインタードラッグのドロップ処理
// ============================
setCustomDropHandler((dropTarget, dragData, clientX, clientY) => {
    if (!dropTarget || !dragData) return;

    const dropPoint = { x: clientX, y: clientY };

    // ① 解雇エリアへのドロップ
    const discardZone = dropTarget.closest('#discard-dropzone');
    if (discardZone) {
        if (dragData.type === 'hand' || dragData.type === 'deploy') {
            socket.emit('card:discard', { cardUid: dragData.card.uid });
            if (dragData.type === 'deploy') {
                state.localDeploySlots[dragData.slotIndex] = null;
                renderDeploySlots(syncLineupChanges);
                syncLineupChanges();
            }
        }
        return;
    }

    // ② 出撃スロットへのドロップ
    const deploySlot = dropTarget.closest('.deploy-slot');
    if (deploySlot) {
        const slotIndex = parseInt(deploySlot.dataset.slot, 10);

        if (dragData.type === 'shop') {
            socket.emit('shop:buyAndDeploy', {
                shopIndex: dragData.shopIndex,
                slotIndex
            });
        } else if (dragData.type === 'market') {
            socket.emit('market:buyAndDeploy', {
                marketCardUid: dragData.marketCardUid,
                slotIndex
            });
        } else if (dragData.type === 'hand') {
            state.localDeploySlots[slotIndex] = dragData.card.uid;
            renderHand(syncLineupChanges);
            renderDeploySlots(syncLineupChanges);
            syncLineupChanges();
        } else if (dragData.type === 'deploy') {
            const temp = state.localDeploySlots[slotIndex];
            state.localDeploySlots[slotIndex] = dragData.card.uid;
            state.localDeploySlots[dragData.slotIndex] = temp;
            renderHand(syncLineupChanges);
            renderDeploySlots(syncLineupChanges);
            syncLineupChanges();
        }
        return;
    }

    // ③ 手札カード上へのドロップ（合成または手札との入れ替え）
    const targetCardEl = dropTarget.closest('.card-item');
    if (targetCardEl && targetCardEl.__cardData && targetCardEl.__cardData.uid !== dragData.card.uid) {
        const targetCard = targetCardEl.__cardData;

        if (dragData.type === 'deploy') {
            state.localDeploySlots[dragData.slotIndex] = targetCard.uid;
            renderHand(syncLineupChanges);
            renderDeploySlots(syncLineupChanges);
            syncLineupChanges();
            return;
        }

        if (dragData.type === 'hand' || dragData.type === 'shop' || dragData.type === 'market') {
            socket.emit('card:synthesizeEx', {
                baseUid: targetCard.uid,
                source: dragData
            });
            return;
        }
    }

    // ④ 手札コンテナ領域全体へのドロップ（購入・配置戻し）
    const handArea = dropTarget.closest('#player-hand') || dropTarget.closest('.hand-wrapper');
    if (handArea) {
        if (dragData.type === 'shop') {
            state.pendingHandDropAnim = { x: dropPoint.x, y: dropPoint.y };
            socket.emit('shop:buy', { shopIndex: dragData.shopIndex });
        } else if (dragData.type === 'market') {
            state.pendingHandDropAnim = { x: dropPoint.x, y: dropPoint.y };
            socket.emit('market:buy', { marketCardUid: dragData.marketCardUid });
        } else if (dragData.type === 'deploy') {
            state.localDeploySlots[dragData.slotIndex] = null;
            renderHand(syncLineupChanges);
            renderDeploySlots(syncLineupChanges);
            syncLineupChanges();

            const targetEl = dom.playerHandContainer.querySelector(`[data-card-uid="${dragData.card.uid}"]`);
            if (targetEl) {
                const targetRect = targetEl.getBoundingClientRect();
                const startRect = {
                    left: dropPoint.x - (targetRect.width / 2),
                    top: dropPoint.y - (targetRect.height / 2),
                    width: targetRect.width,
                    height: targetRect.height
                };
                animateCardFlight(startRect, targetEl);
            }
        }
    }
});

// ============================
// ソケット受信ハンドラ
// ============================
socket.on('connect', () => {
    state.myId = socket.id;
    if (state.currentGameState !== 'lobby') {
        resetClientGameState();
        state.currentGameState = 'lobby';
        dom.viewGame.classList.add('hidden');
        dom.viewLobby.classList.remove('hidden');
    }
});

socket.on('disconnect', () => {
    resetClientGameState();
});

socket.on('lobby:update', (data) => {
    state.currentGameState = data.gameState;
    state.isHost = data.hostSocketId === state.myId;
    const me = data.players.find(p => p.id === state.myId);

    dom.lobbyEntryCount.textContent = data.enteredCount;

    if (state.currentGameState === 'lobby') {
        dom.roundIndicator.classList.add('hidden');
        dom.nextOpponentIndicator.classList.add('hidden');
        dom.waitAnnouncementBanner.classList.add('hidden');
        hasClickedNextInBattle = false;
        latestRankings = null;
        displayedLifeMap.clear();
    }

    if (me && me.isEntered) {
        dom.btnToggleEntry.textContent = '参加キャンセル';
        dom.btnToggleEntry.className = 'btn danger';
        dom.lobbyEntryBadge.textContent = '参加中... 他のプレイヤーを待っています';
        dom.lobbyEntryBadge.classList.add('active');
    } else {
        dom.btnToggleEntry.textContent = '参加する';
        dom.btnToggleEntry.className = 'btn primary';
        dom.lobbyEntryBadge.textContent = '未エントリー';
        dom.lobbyEntryBadge.classList.remove('active');
    }

    if (state.isHost && data.enteredCount >= 2 && state.currentGameState === 'lobby') {
        dom.btnStartGame.classList.remove('hidden');
    } else {
        dom.btnStartGame.classList.add('hidden');
    }

    dom.lobbyPlayerList.innerHTML = '';
    data.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.name} ${p.isHost ? '👑(ホスト)' : ''}`;
        const statusSpan = document.createElement('span');
        statusSpan.textContent = p.isEntered ? '【参加中】' : '【待機】';
        statusSpan.style.color = p.isEntered ? '#10b981' : '#94a3b8';
        li.appendChild(statusSpan);
        dom.lobbyPlayerList.appendChild(li);
    });
});

socket.on('market:sync', (data) => {
    state.localMarket = data.activeMarketCards || [];
    if (state.currentGameState === 'battle') {
        dom.marketCardsContainer.innerHTML = '';
        return;
    }
    if (state.pointerDrag && state.pointerDrag.isDragging) {
        state.pendingMarketSync = data;
    } else {
        renderMarketCards();
        updateMarketTabLabel();
    }
});

socket.on('matchup:notice', ({ opponentName }) => {
    state.currentOpponentName = opponentName;
    dom.nextOpponentIndicator.textContent = `次の対戦相手: ${state.currentOpponentName}`;
    if (state.currentGameState === 'prep') {
        dom.nextOpponentIndicator.classList.remove('hidden');
    }
});

socket.on('shop:buy:error', ({ message }) => {
    state.pendingHandDropAnim = null;
    showToast(message || 'ゴールドが足りません');
});

socket.on('market:buy:error', ({ message }) => {
    state.pendingHandDropAnim = null;
    showToast(message || 'ゴールドが足りません');
});

socket.on('game:sync', (data) => {
    const previousState = state.currentGameState;

    state.currentGameState = data.gameState;
    state.currentRound = data.round;
    state.isHost = data.hostSocketId === state.myId;
    state.cachedOpponentsList = data.players || [];

    const me = (data.players || []).find(p => p.id === state.myId);

    if (state.currentGameState === 'prep') {
        (data.players || []).forEach(p => {
            displayedLifeMap.set(p.id, p.life);
        });
    }

    if (state.currentGameState === 'lobby' || !me || !me.isEntered) {
        dom.viewLobby.classList.remove('hidden');
        dom.viewGame.classList.add('hidden');
        dom.waitAnnouncementBanner.classList.add('hidden');
        dom.roundIndicator.classList.add('hidden');
        dom.nextOpponentIndicator.classList.add('hidden');
        dom.hostAdminActions.classList.add('hidden');
        return;
    }

    dom.viewLobby.classList.add('hidden');
    dom.viewGame.classList.remove('hidden');

    dom.roundIndicator.textContent = `ラウンド: ${state.currentRound}`;
    dom.roundIndicator.classList.remove('hidden');

    if (state.currentGameState === 'prep') {
        dom.nextOpponentIndicator.textContent = `次の対戦相手: ${state.currentOpponentName}`;
        dom.nextOpponentIndicator.classList.remove('hidden');
    } else {
        dom.nextOpponentIndicator.classList.add('hidden');
    }

    dom.btnReroll.disabled = (state.currentGameState !== 'prep');

    if (previousState !== 'prep' && state.currentGameState === 'prep') {
        dom.tabShop.click();
        state.activeSpectatingId = null;
        hasClickedNextInBattle = false;
        dom.playerReadyLamp.classList.remove('ready');

        if (me && me.isAlive) {
            dom.btnFinishPrep.disabled = false;
            dom.waitAnnouncementBanner.classList.add('hidden');
        } else {
            dom.btnFinishPrep.disabled = true;
        }

        const aliveCount = state.cachedOpponentsList.filter(p => p.isAlive && p.isEntered).length;
        triggerRoundStartPopupAndDistribute(state.currentRound, aliveCount);
    }

    if (state.currentGameState === 'prep') {
        if (me && !me.isAlive) {
            dom.btnFinishPrep.disabled = true;
            dom.waitAnnouncementBanner.classList.add('hidden');
        } else if (me && me.isReady) {
            dom.waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
            dom.waitAnnouncementBanner.classList.remove('hidden');
            dom.btnFinishPrep.disabled = true;
        } else {
            dom.waitAnnouncementBanner.classList.add('hidden');
            dom.btnFinishPrep.disabled = false;
        }
    }

    if (state.isHost) {
        dom.hostAdminActions.classList.remove('hidden');
    } else {
        dom.hostAdminActions.classList.add('hidden');
    }

    renderOpponentsBar();
    updateMarketTabLabel();
});

socket.on('synthesize:success', ({ baseUid }) => {
    const cardEl = Array.from(document.querySelectorAll('.card-item')).find(el => el.__cardData?.uid === baseUid);
    if (cardEl) {
        cardEl.classList.add('card-synth-success');
        setTimeout(() => cardEl.classList.remove('card-synth-success'), 700);
    }
});

socket.on('player:sync', (data) => {
    const prevHandUids = new Set(state.localHand.map(c => c.uid));

    if (data.hand) {
        state.localHand = sortHandCards(data.hand);

        const distCard = data.hand.find(c => c.isNewDistributed);
        if (distCard) {
            currentDistributeCardUid = distCard.uid;
            delete distCard.isNewDistributed;
        }
    }

    if (data.shop) state.localShop = data.shop;
    if (data.gold !== undefined) dom.playerGoldDisplay.textContent = `${data.gold}G`;

    if (data.life !== undefined && state.currentGameState === 'prep') {
        displayedLifeMap.set(state.myId, data.life);
        dom.playerLifeDisplay.textContent = formatLife(data.life);
    }

    if (data.selectedLineup) {
        state.localDeploySlots = [
            data.selectedLineup[0] ? data.selectedLineup[0].uid : null,
            data.selectedLineup[1] ? data.selectedLineup[1].uid : null,
            data.selectedLineup[2] ? data.selectedLineup[2].uid : null
        ];
    }

    renderHand(syncLineupChanges, {
        hideCardUid: isRoundPopupPlaying ? currentDistributeCardUid : null
    });
    renderShop();
    renderDeploySlots(syncLineupChanges);

    if (state.pendingHandDropAnim && data.hand) {
        const newlyAddedCard = data.hand.find(c => !prevHandUids.has(c.uid));
        if (newlyAddedCard) {
            const targetEl = dom.playerHandContainer.querySelector(`[data-card-uid="${newlyAddedCard.uid}"]`);
            if (targetEl) {
                const targetRect = targetEl.getBoundingClientRect();
                const startRect = {
                    left: state.pendingHandDropAnim.x - (targetRect.width / 2),
                    top: state.pendingHandDropAnim.y - (targetRect.height / 2),
                    width: targetRect.width,
                    height: targetRect.height
                };
                animateCardFlight(startRect, targetEl);
            }
        }
        state.pendingHandDropAnim = null;
    }

    clearTimeout(discardModalSafetyTimer);
    isDiscardingFromModal = false;

    if (state.localHand.length <= 6) {
        dom.modalOverhand.classList.add('hidden');
        if (state.pendingReadyAfterDiscard) {
            state.pendingReadyAfterDiscard = false;
            proceedSetReady();
        }
    } else if (!dom.modalOverhand.classList.contains('hidden')) {
        showOverhandDiscardModal();
    }
});

// 2: バトルフェーズへ移行した瞬間に解雇市場カードを非表示化し「解雇市場 (0)」へ切り替え
socket.on('battle:start', ({ summary, logs, isGameOverDecided: gameOverFlag }) => {
    dom.shopCardsContainer.innerHTML = '';
    dom.marketCardsContainer.innerHTML = '';
    state.localMarket = [];
    updateMarketTabLabel(); // 「解雇市場 (0)」へ切り替え
    dom.tabShop.click();
    dom.btnReroll.disabled = true;

    startBattleAnimation(summary, logs, gameOverFlag);
});

socket.on('battle:start_notice', () => {
    if (state.reservedSpectateTargetId) {
        socket.emit('spectate:getBattle', { targetPlayerId: state.reservedSpectateTargetId });
    }
});

socket.on('game:ended', ({ rankings }) => {
    latestRankings = rankings;
    if (dom.resultModal.classList.contains('hidden')) {
        clearAllBattleTimers();
        showGameOver(rankings);
    }
});

// ============================
// UIイベント設定
// ============================
dom.btnToggleEntry.onclick = () => socket.emit('lobby:toggleEntry');
dom.btnStartGame.onclick = () => socket.emit('lobby:startGame');

dom.btnOpenTips.onclick = () => {
    dom.modalTips.classList.remove('hidden');
    dom.tipTabElement.click();
};
dom.btnTipsClose.onclick = () => dom.modalTips.classList.add('hidden');

dom.tipTabElement.onclick = () => {
    dom.tipTabElement.classList.add('active');
    dom.tipTabTribe.classList.remove('active');
    dom.tipTabSynth.classList.remove('active');
    dom.tipContentElement.classList.remove('hidden');
    dom.tipContentTribe.classList.add('hidden');
    dom.tipContentSynth.classList.add('hidden');
};
dom.tipTabTribe.onclick = () => {
    dom.tipTabTribe.classList.add('active');
    dom.tipTabElement.classList.remove('active');
    dom.tipTabSynth.classList.remove('active');
    dom.tipContentTribe.classList.remove('hidden');
    dom.tipContentElement.classList.add('hidden');
    dom.tipContentSynth.classList.add('hidden');
};
dom.tipTabSynth.onclick = () => {
    dom.tipTabSynth.classList.add('active');
    dom.tipTabElement.classList.remove('active');
    dom.tipTabTribe.classList.remove('active');
    dom.tipContentSynth.classList.remove('hidden');
    dom.tipContentElement.classList.add('hidden');
    dom.tipContentTribe.classList.add('hidden');
};

dom.tabShop.onclick = () => {
    dom.tabShop.classList.add('active');
    dom.tabMarket.classList.remove('active');
    dom.shopPanel.classList.remove('hidden');
    dom.marketPanel.classList.add('hidden');
};

dom.tabMarket.onclick = () => {
    if (state.currentRound < 2 || state.currentGameState === 'battle') return;
    dom.tabMarket.classList.add('active');
    dom.tabShop.classList.remove('active');
    dom.marketPanel.classList.remove('hidden');
    dom.shopPanel.classList.add('hidden');
};

dom.btnReroll.onclick = () => {
    if (state.currentGameState !== 'prep') return;
    socket.emit('shop:reroll');
};

dom.btnFinishPrep.onclick = () => {
    if (!state.myPlayer || !state.myPlayer.isAlive) return;

    const selectedCount = state.localDeploySlots.filter(Boolean).length;
    if (selectedCount === 0) {
        showConfirm('繰り出すカードを選択していません。\n本当に完了しますか？', () => {
            if (state.localHand.length >= 7) {
                state.pendingReadyAfterDiscard = true;
                showOverhandDiscardModal();
                return;
            }
            proceedSetReady();
        });
        return;
    }

    if (state.localHand.length >= 7) {
        state.pendingReadyAfterDiscard = true;
        showOverhandDiscardModal();
        return;
    }

    proceedSetReady();
};

dom.btnSkipBattle.onclick = skipBattle;

// 1, 5: バトルリザルト「次へ」押下処理
dom.btnResultNext.onclick = () => {
    // 1: 「次へ」ボタンを押下した時点で両領域の縦スクロール位置を最上部 (0) にリセット
    resetResultModalScrollPositions();

    clearAllBattleTimers();
    dom.resultModal.classList.add('hidden');

    // 5: 最新のライフを表示キャッシュへ反映し画面を更新
    state.cachedOpponentsList.forEach(p => {
        displayedLifeMap.set(p.id, p.life);
    });
    if (state.myPlayer) {
        dom.playerLifeDisplay.textContent = formatLife(state.myPlayer.life);
    }
    renderOpponentsBar();

    if (state.activeSpectatingId) {
        state.activeSpectatingId = null;
        return;
    }

    if (state.isGameOverDecided || latestRankings) {
        if (latestRankings) {
            showGameOver(latestRankings);
        }
        socket.emit('battle:next');
        return;
    }

    dom.nextOpponentIndicator.classList.add('hidden');

    hasClickedNextInBattle = true;
    if (state.myPlayer) {
        state.myPlayer.isReady = true;
    }
    dom.playerReadyLamp.classList.add('ready');
    dom.waitAnnouncementBanner.textContent = '全員のバトル終了を待っています...';
    dom.waitAnnouncementBanner.classList.remove('hidden');

    renderOpponentsBar();

    socket.emit('battle:next');
};

dom.btnRematch.onclick = () => {
    resetClientGameState();
    dom.gameOverModal.classList.add('hidden');
    dom.viewGame.classList.add('hidden');
    dom.viewLobby.classList.remove('hidden');
    hasClickedNextInBattle = false;
    socket.emit('lobby:rematch');
};

dom.btnLeave.onclick = () => {
    resetClientGameState();
    state.currentGameState = 'lobby';
    dom.gameOverModal.classList.add('hidden');
    dom.viewGame.classList.add('hidden');
    dom.viewLobby.classList.remove('hidden');
    hasClickedNextInBattle = false;
    socket.emit('lobby:leave');
};

dom.btnOpenSettings.onclick = () => dom.modalSettings.classList.remove('hidden');
dom.btnSettingsClose.onclick = () => dom.modalSettings.classList.add('hidden');
dom.btnSaveName.onclick = () => {
    const name = dom.inputPlayerName.value;
    if (name.trim()) {
        socket.emit('player:rename', name.trim());
        dom.modalSettings.classList.add('hidden');
    }
};

dom.btnForceEnd.onclick = () => {
    dom.modalSettings.classList.add('hidden');
    showConfirm('本当にゲームを強制終了しますか？', () => {
        socket.emit('game:forceEnd');
    });
};

dom.btnHistoryClose.onclick = () => dom.modalHistory.classList.add('hidden');