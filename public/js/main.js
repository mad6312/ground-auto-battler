/**
 * public/js/main.js
 * クライアント側メインエントリーモジュール (仕様改修版)
 */

import { state, dom, socket, formatLife, showConfirm, clearAllBattleTimers } from './state.js';
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
    showGameOver
} from './battleUI.js';

const WEAKNESS_MAP = {
    '火': '風',
    '氷': '火',
    '風': '氷',
    '雷': '地',
    '水': '雷',
    '地': '水'
};

// 各ラウンド開始時のポップアップ制御フラグ
let isRoundPopupPlaying = false;
let currentDistributeCardUid = null;

function syncLineupChanges() {
    const lineupUids = state.localDeploySlots.filter(Boolean);
    socket.emit('player:updateLineup', { lineupUids });
}

function proceedSetReady() {
    const lineupUids = state.localDeploySlots.filter(Boolean);
    socket.emit('player:setReady', { lineupUids });
    dom.playerReadyLamp.classList.add('ready');
    dom.btnFinishPrep.disabled = true;
    dom.waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
    dom.waitAnnouncementBanner.classList.remove('hidden');
}

function showOverhandDiscardModal() {
    clearSynthesizableHighlights();
    dom.overhandCardList.innerHTML = '';
    dom.modalOverhand.classList.remove('hidden');

    state.localHand.forEach(card => {
        const cardEl = createCardElement(card, { nonDraggable: true });
        cardEl.style.cursor = 'pointer';
        cardEl.onclick = () => {
            socket.emit('card:discard', { cardUid: card.uid });
            setTimeout(() => {
                if (state.localHand.length <= 6) {
                    dom.modalOverhand.classList.add('hidden');
                    if (state.pendingReadyAfterDiscard) {
                        state.pendingReadyAfterDiscard = false;
                        proceedSetReady();
                    }
                } else {
                    showOverhandDiscardModal();
                }
            }, 200);
        };
        dom.overhandCardList.appendChild(cardEl);
    });
}

// 相手バーのレンダリング
function renderOpponentsBar() {
    dom.opponentsBar.innerHTML = '';
    state.cachedOpponentsList.forEach(p => {
        if (p.id === state.myId) {
            state.myPlayer = p;
            dom.playerNameDisplay.textContent = p.name;
            dom.playerLifeDisplay.textContent = formatLife(p.life);
            dom.playerGoldDisplay.textContent = `${p.gold}G`;

            if (p.isReady) {
                dom.playerReadyLamp.classList.add('ready');
            } else {
                dom.playerReadyLamp.classList.remove('ready');
            }
            return;
        }

        const card = document.createElement('div');
        card.className = `opponent-card ${!p.isAlive ? 'dead' : ''}`;

        let actionBtnHtml = '';
        const isMeDead = state.myPlayer && !state.myPlayer.isAlive;
        const isMeReady = state.myPlayer && state.myPlayer.isReady;

        if (isMeDead) {
            if (state.currentGameState === 'prep') {
                const isReserved = state.reservedSpectateTargetId === p.id;
                actionBtnHtml = `<button class="btn btn-reserve-spectate ${isReserved ? 'warning' : 'secondary'}">${isReserved ? '予約解除' : '観戦予約'}</button>`;
            } else if (p.isAlive) {
                actionBtnHtml = `<button class="btn btn-spectate primary">観戦</button>`;
            }
        } else if (isMeReady && state.currentGameState === 'battle' && p.isAlive) {
            actionBtnHtml = `<button class="btn btn-spectate primary">観戦</button>`;
        }

        card.innerHTML = `
      <div class="opp-header">
        <span>${p.name}</span>
        <span class="ready-lamp ${p.isReady ? 'ready' : ''}"></span>
      </div>
      <div class="opp-life-row">
        <span class="opp-life">${formatLife(p.life)}</span>
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
            if (!p.isAlive) return;

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

// 各ラウンド開始時のポップアップ演出と配布アニメーション順序制御
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
        const prevUid = state.localDeploySlots[slotIndex];

        if (dragData.type === 'shop') {
            socket.emit('shop:buyAndDeploy', {
                shopIndex: dragData.shopIndex,
                slotIndex,
                previousCardUid: prevUid
            });
        } else if (dragData.type === 'market') {
            socket.emit('market:buyAndDeploy', {
                marketCardUid: dragData.marketCardUid,
                slotIndex,
                previousCardUid: prevUid
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
            // ドロップ座標を記録してアニメーション予約
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

            // 1: 出撃スロットから手札へのドロップ時：マウス位置から手札整列位置への滑らか吸い込み
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
    renderMarketCards();
    updateMarketTabLabel();
});

socket.on('matchup:notice', ({ opponentName }) => {
    state.currentOpponentName = opponentName;
    dom.nextOpponentIndicator.textContent = `次の対戦相手: ${state.currentOpponentName}`;
    dom.nextOpponentIndicator.classList.remove('hidden');
});

socket.on('game:sync', (data) => {
    const previousState = state.currentGameState;

    state.currentGameState = data.gameState;
    state.currentRound = data.round;
    state.isHost = data.hostSocketId === state.myId;
    state.cachedOpponentsList = data.players || [];

    if (state.currentGameState !== 'lobby') {
        dom.roundIndicator.textContent = `ラウンド: ${state.currentRound}`;
        dom.roundIndicator.classList.remove('hidden');
        if (state.currentGameState === 'prep') {
            dom.nextOpponentIndicator.classList.remove('hidden');
        }
    } else {
        dom.roundIndicator.classList.add('hidden');
        dom.nextOpponentIndicator.classList.add('hidden');
    }

    dom.btnReroll.disabled = (state.currentGameState !== 'prep');

    if (previousState !== 'prep' && state.currentGameState === 'prep') {
        dom.tabShop.click();
        state.activeSpectatingId = null;
        dom.waitAnnouncementBanner.classList.add('hidden');
        dom.btnFinishPrep.disabled = false;
        dom.playerReadyLamp.classList.remove('ready');

        const aliveCount = state.cachedOpponentsList.filter(p => p.isAlive).length;
        triggerRoundStartPopupAndDistribute(state.currentRound, aliveCount);
    }

    const me = data.players.find(p => p.id === state.myId);
    if (state.currentGameState === 'prep') {
        if (me && me.isReady) {
            dom.waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
            dom.waitAnnouncementBanner.classList.remove('hidden');
            dom.btnFinishPrep.disabled = true;
        } else {
            dom.waitAnnouncementBanner.classList.add('hidden');
            dom.btnFinishPrep.disabled = false;
        }
    }

    if (state.isHost && state.currentGameState !== 'lobby') {
        dom.hostAdminActions.classList.remove('hidden');
    } else {
        dom.hostAdminActions.classList.add('hidden');
    }

    if (state.currentGameState === 'lobby') {
        dom.viewLobby.classList.remove('hidden');
        dom.viewGame.classList.add('hidden');
        dom.waitAnnouncementBanner.classList.add('hidden');
    } else {
        dom.viewLobby.classList.add('hidden');
        dom.viewGame.classList.remove('hidden');
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

        // 新配布カードを検知
        const distCard = data.hand.find(c => c.isNewDistributed);
        if (distCard) {
            currentDistributeCardUid = distCard.uid;
            delete distCard.isNewDistributed;
        }
    }

    if (data.shop) state.localShop = data.shop;
    if (data.gold !== undefined) dom.playerGoldDisplay.textContent = `${data.gold}G`;
    if (data.life !== undefined) dom.playerLifeDisplay.textContent = formatLife(data.life);

    if (state.currentGameState === 'prep') {
        dom.waitAnnouncementBanner.classList.add('hidden');
    }

    if (data.selectedLineup && data.selectedLineup.length === 0) {
        state.localDeploySlots = [null, null, null];
    } else if (data.selectedLineup) {
        data.selectedLineup.forEach((c, idx) => {
            if (idx < 3) state.localDeploySlots[idx] = c ? c.uid : null;
        });
    }

    renderHand(syncLineupChanges, {
        hideCardUid: isRoundPopupPlaying ? currentDistributeCardUid : null
    });
    renderShop();
    renderDeploySlots(syncLineupChanges);

    // 1: 手札へのドロップ購入アニメーションの実行判定
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

    if (state.pendingReadyAfterDiscard && state.localHand.length <= 6) {
        state.pendingReadyAfterDiscard = false;
        proceedSetReady();
    }
});

socket.on('battle:start', ({ summary, logs, isGameOverDecided: gameOverFlag }) => {
    dom.shopCardsContainer.innerHTML = '';
    dom.marketCardsContainer.innerHTML = '';
    dom.btnReroll.disabled = true;

    if (state.reservedSpectateTargetId && !state.myPlayer?.isAlive) {
        state.activeSpectatingId = state.reservedSpectateTargetId;
        socket.emit('spectate:getBattle', { targetPlayerId: state.reservedSpectateTargetId });
    }

    startBattleAnimation(summary, logs, gameOverFlag);
});

socket.on('game:ended', ({ rankings }) => {
    clearAllBattleTimers();
    showGameOver(rankings);
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
    if (state.currentRound < 2) return;
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
    if (state.localHand.length >= 7) {
        state.pendingReadyAfterDiscard = true;
        showOverhandDiscardModal();
        return;
    }

    const selectedCount = state.localDeploySlots.filter(Boolean).length;
    if (selectedCount === 0) {
        showConfirm('繰り出すカードを選択していません。\n本当に完了しますか？', () => {
            proceedSetReady();
        });
        return;
    }

    proceedSetReady();
};

dom.btnSkipBattle.onclick = skipBattle;

dom.btnResultNext.onclick = () => {
    clearAllBattleTimers();
    dom.resultModal.classList.add('hidden');

    if (state.isGameOverDecided) {
        socket.emit('battle:next');
        return;
    }

    dom.nextOpponentIndicator.classList.add('hidden');

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
    clearAllBattleTimers();
    dom.gameOverModal.classList.add('hidden');
    dom.viewGame.classList.add('hidden');
    dom.viewLobby.classList.remove('hidden');
    socket.emit('lobby:rematch');
};

// 退出ボタン（ロビー画面への即時確実遷移）
dom.btnLeave.onclick = () => {
    clearAllBattleTimers();
    state.currentGameState = 'lobby';
    dom.gameOverModal.classList.add('hidden');
    dom.resultModal.classList.add('hidden');
    dom.battleScreen.classList.add('hidden');
    dom.viewGame.classList.add('hidden');
    dom.viewLobby.classList.remove('hidden');
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
    showConfirm('本当にゲームを強制終了しますか？', () => {
        socket.emit('game:forceEnd');
        dom.modalSettings.classList.add('hidden');
    });
};
dom.btnHistoryClose.onclick = () => dom.modalHistory.classList.add('hidden');