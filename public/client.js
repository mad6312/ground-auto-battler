/**
 * client.js
 * グラウンド・オートバトラー クライアントスクリプト (要件改修版)
 */

const socket = io();

// ============================
// 状態管理
// ============================
let myId = null;
let myPlayer = null;
let currentGameState = 'lobby';
let currentRound = 1;
let isHost = false;

// 手札・出撃・市場
let localHand = [];
let localDeploySlots = [null, null, null]; // [cardUid, cardUid, cardUid]
let localShop = [];
let localMarket = [];

// 観戦・マッチング
let currentOpponentName = '未定';
let reservedSpectateTargetId = null; // 観戦予約ID
let activeSpectatingId = null;

// ドラッグ中データ
let dragData = null;

// バトル演出
let battleAnimationTimer = null;
let currentBattleData = null;
let isGameOverDecided = false;

let pendingReadyAfterDiscard = false;

// ============================
// DOM要素
// ============================
const viewLobby = document.getElementById('view-lobby');
const viewGame = document.getElementById('view-game');
const roundIndicator = document.getElementById('round-indicator');
const nextOpponentIndicator = document.getElementById('next-opponent-indicator');
const waitAnnouncementBanner = document.getElementById('wait-announcement-banner');

// ロビーUI
const lobbyEntryCount = document.getElementById('lobby-entry-count');
const lobbyEntryBadge = document.getElementById('lobby-entry-badge');
const btnToggleEntry = document.getElementById('btn-toggle-entry');
const btnStartGame = document.getElementById('btn-start-game');
const lobbyPlayerList = document.getElementById('lobby-player-list');

// プレイヤー情報
const playerNameDisplay = document.getElementById('player-name-display');
const playerLifeDisplay = document.getElementById('player-life-display');
const playerGoldDisplay = document.getElementById('player-gold-display');
const playerReadyLamp = document.getElementById('player-ready-lamp');
const opponentsBar = document.getElementById('opponents-bar');

// ショップ＆解雇市場
const tabShop = document.getElementById('tab-shop');
const tabMarket = document.getElementById('tab-market');
const shopPanel = document.getElementById('shop-panel');
const marketPanel = document.getElementById('market-panel');
const shopCardsContainer = document.getElementById('shop-cards');
const marketCardsContainer = document.getElementById('market-cards');
const btnReroll = document.getElementById('btn-reroll');

// 出撃・手札・解雇
const deployDropzones = [
    document.getElementById('deploy-0'),
    document.getElementById('deploy-1'),
    document.getElementById('deploy-2')
];
const playerHandContainer = document.getElementById('player-hand');
const discardDropzone = document.getElementById('discard-dropzone');
const btnFinishPrep = document.getElementById('btn-finish-prep');

// バトル画面
const battleScreen = document.getElementById('battle-screen');
const battleViewTitle = document.getElementById('battle-view-title');
const spectatingBadge = document.getElementById('spectating-badge');
const bP1Name = document.getElementById('b-p1-name');
const bP2Name = document.getElementById('b-p2-name');
const p1CardsIndicator = document.getElementById('p1-cards-indicator');
const p2CardsIndicator = document.getElementById('p2-cards-indicator');
const bP1CardSlot = document.getElementById('b-p1-card-slot');
const bP2CardSlot = document.getElementById('b-p2-card-slot');
const p1Combatant = document.getElementById('p1-combatant');
const p2Combatant = document.getElementById('p2-combatant');
const battleLogList = document.getElementById('battle-log-list');
const btnSkipBattle = document.getElementById('btn-skip-battle');

// バトルリザルト
const resultModal = document.getElementById('result-modal');
const resultTitle = document.getElementById('result-title');
const resultSummaryText = document.getElementById('result-summary-text');
const resultDamageTableBody = document.querySelector('#result-damage-table tbody');
const btnToggleResultLog = document.getElementById('btn-toggle-result-log');
const resultLogDrawer = document.getElementById('result-log-drawer');
const resultLogList = document.getElementById('result-log-list');
const btnResultNext = document.getElementById('btn-result-next');

// 最終結果画面
const gameOverModal = document.getElementById('game-over-modal');
const winnerCelebration = document.getElementById('winner-celebration');
const winnerNameDisplay = document.getElementById('winner-name-display');
const finalRankingTableBody = document.querySelector('#final-ranking-table tbody');
const btnRematch = document.getElementById('btn-rematch');
const btnLeave = document.getElementById('btn-leave');

// Tipsモーダル
const modalTips = document.getElementById('modal-tips');
const btnOpenTips = document.getElementById('btn-open-tips');
const btnTipsClose = document.getElementById('btn-tips-close');
const tipTabElement = document.getElementById('tip-tab-element');
const tipTabTribe = document.getElementById('tip-tab-tribe');
const tipTabSynth = document.getElementById('tip-tab-synth');
const tipContentElement = document.getElementById('tip-content-element');
const tipContentTribe = document.getElementById('tip-content-tribe');
const tipContentSynth = document.getElementById('tip-content-synth');

// その他モーダル
const modalOverhand = document.getElementById('modal-overhand');
const overhandCardList = document.getElementById('overhand-card-list');
const modalConfirm = document.getElementById('modal-confirm');
const modalConfirmMsg = document.getElementById('modal-confirm-msg');
const btnConfirmYes = document.getElementById('btn-confirm-yes');
const btnConfirmNo = document.getElementById('btn-confirm-no');
let confirmCallback = null;

const modalHistory = document.getElementById('modal-history');
const historyPlayerName = document.getElementById('history-player-name');
const historyLineup = document.getElementById('history-lineup');
const historyBench = document.getElementById('history-bench');
const btnHistoryClose = document.getElementById('btn-history-close');

const modalSettings = document.getElementById('modal-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');
const inputPlayerName = document.getElementById('input-player-name');
const btnSaveName = document.getElementById('btn-save-name');
const btnSettingsClose = document.getElementById('btn-settings-close');
const hostAdminActions = document.getElementById('host-admin-actions');
const btnForceEnd = document.getElementById('btn-force-end');

let cachedOpponentsList = [];

// ============================
// ヘルパー関数
// ============================
function formatLife(life) {
    const max = 5;
    const clamped = Math.max(0, Math.min(max, life));
    return '♥'.repeat(clamped) + '♡'.repeat(max - clamped);
}

function showConfirm(message, onYes) {
    modalConfirmMsg.textContent = message;
    confirmCallback = onYes;
    modalConfirm.classList.remove('hidden');
}

btnConfirmYes.onclick = () => {
    modalConfirm.classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
};
btnConfirmNo.onclick = () => {
    modalConfirm.classList.add('hidden');
    confirmCallback = null;
};

function renderCardDots(total, remaining) {
    if (!total || total <= 0) return '';
    const rem = Math.max(0, Math.min(total, remaining));
    return '●'.repeat(rem) + '〇'.repeat(total - rem);
}

function getRarityBaseCost(rarity) {
    switch (rarity) {
        case 'common': return 2;
        case 'uncommon': return 4;
        case 'rare': return 6;
        case 'epic': return 8;
        case 'legend': return 10;
        default: return 2;
    }
}

function calculateStarCount(card) {
    const baseCost = getRarityBaseCost(card.rarity);
    const total = card.hp + card.atk + card.spd;
    return Math.floor((1 / 5) * (total / baseCost));
}

// 2-2: 手札超過解雇モーダル表示中は強調表示をスキップ
function highlightSynthesizableCards(sourceCard) {
    if (!sourceCard) return;
    if (!modalOverhand.classList.contains('hidden')) return; // モーダル表示中は無効化

    const allCards = document.querySelectorAll('.card-item');
    allCards.forEach(el => {
        const cardData = el.__cardData;
        if (cardData && cardData.uid !== sourceCard.uid) {
            if (cardData.rarity === sourceCard.rarity && cardData.tribe === sourceCard.tribe) {
                el.classList.add('card-synth-highlight');
            }
        }
    });
}

function clearSynthesizableHighlights() {
    document.querySelectorAll('.card-synth-highlight').forEach(el => {
        el.classList.remove('card-synth-highlight');
    });
}

// 1-1: カードDOM生成（2行レイアウト構造）
function createCardElement(card, options = {}) {
    const div = document.createElement('div');
    div.className = `card-item rarity-${card.rarity}`;
    div.draggable = !options.nonDraggable;
    div.__cardData = card;

    let costHtml = '';
    if (options.isShop) {
        costHtml = `<span class="card-cost">${card.cost}G</span>`;
    } else if (options.isMarket) {
        const marketPrice = Math.floor(card.totalStats / 10);
        costHtml = `<span class="card-cost">${marketPrice}G</span>`;
    }

    const starCount = calculateStarCount(card);
    const starBadgeHtml = `<span class="badge-star" title="★評価">★${starCount}</span>`;

    // 1-2: 落ち着いたグレーの解バッジ
    let kaiBadgeHtml = '';
    if (card.isMarketCard || options.isMarket) {
        const seller = card.sellerName || options.sellerName || '他プレイヤー';
        kaiBadgeHtml = `<span class="badge-market-kai" title="解雇者: ${seller}">解</span>`;
    }

    div.innerHTML = `
    <!-- 1行目: 属性・種族 -->
    <div class="card-row-meta">
      <span class="elem-badge elem-${card.element}">${card.element}</span>
      <span class="card-tribe-name">${card.tribe}</span>
    </div>
    <!-- 2行目: ★バッジ・購入額 -->
    <div class="card-row-stats-head">
      ${starBadgeHtml}
      ${costHtml}
    </div>
    <!-- カード名 -->
    <div class="card-name">${card.name}</div>
    <!-- スタッツ -->
    <div class="card-stats">
      <span class="stat-hp" title="HP">❤${card.hp}</span>
      <span class="stat-atk" title="攻撃">⚔${card.atk}</span>
      <span class="stat-spd" title="素早さ">⚡${card.spd}</span>
    </div>
    ${kaiBadgeHtml}
  `;

    if (options.isLocked) {
        const lockBadge = document.createElement('div');
        lockBadge.className = 'card-lock-badge';
        lockBadge.textContent = '🔒';
        div.appendChild(lockBadge);
    }

    div.addEventListener('mouseenter', () => {
        if (!dragData) highlightSynthesizableCards(card);
    });
    div.addEventListener('mouseleave', () => {
        if (!dragData) clearSynthesizableHighlights();
    });

    div.addEventListener('dragstart', (e) => {
        dragData = { ...options.dragInfo, card };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        highlightSynthesizableCards(card);
    });

    div.addEventListener('dragend', () => {
        clearSynthesizableHighlights();
        dragData = null;
    });

    if (options.onContextMenu) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            options.onContextMenu();
        });
    }

    return div;
}

function spawnDamagePopup(container, text, type) {
    const popup = document.createElement('div');
    popup.className = `damage-popup ${type}`;
    popup.textContent = text;
    container.appendChild(popup);
    setTimeout(() => popup.remove(), 1000);
}

// ============================
// ソケット接続・同期
// ============================
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('lobby:update', (data) => {
    currentGameState = data.gameState;
    isHost = data.hostSocketId === myId;
    const me = data.players.find(p => p.id === myId);

    lobbyEntryCount.textContent = data.enteredCount;

    if (currentGameState === 'lobby') {
        roundIndicator.classList.add('hidden');
        nextOpponentIndicator.classList.add('hidden');
        waitAnnouncementBanner.classList.add('hidden');
    }

    if (me && me.isEntered) {
        btnToggleEntry.textContent = '参加キャンセル';
        btnToggleEntry.className = 'btn danger';
        lobbyEntryBadge.textContent = '参加中... 他のプレイヤーを待っています';
        lobbyEntryBadge.classList.add('active');
    } else {
        btnToggleEntry.textContent = '参加する';
        btnToggleEntry.className = 'btn primary';
        lobbyEntryBadge.textContent = '未エントリー';
        lobbyEntryBadge.classList.remove('active');
    }

    if (isHost && data.enteredCount >= 2 && currentGameState === 'lobby') {
        btnStartGame.classList.remove('hidden');
    } else {
        btnStartGame.classList.add('hidden');
    }

    lobbyPlayerList.innerHTML = '';
    data.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.name} ${p.isHost ? '👑(ホスト)' : ''}`;
        const statusSpan = document.createElement('span');
        statusSpan.textContent = p.isEntered ? '【参加中】' : '【待機】';
        statusSpan.style.color = p.isEntered ? '#10b981' : '#94a3b8';
        li.appendChild(statusSpan);
        lobbyPlayerList.appendChild(li);
    });
});

socket.on('market:sync', (data) => {
    localMarket = data.activeMarketCards || [];
    renderMarketCards();
    updateMarketTabLabel();
});

function updateMarketTabLabel() {
    if (currentRound >= 2) {
        tabMarket.removeAttribute('disabled');
        tabMarket.classList.remove('disabled-tab');
        tabMarket.textContent = `解雇市場(${localMarket.length})`;
    } else {
        tabMarket.setAttribute('disabled', 'true');
        tabMarket.classList.add('disabled-tab');
        tabMarket.textContent = '解雇市場 (R2～)';
    }
}

socket.on('matchup:notice', ({ opponentName }) => {
    currentOpponentName = opponentName;
    nextOpponentIndicator.textContent = `次の対戦相手: ${currentOpponentName}`;
    nextOpponentIndicator.classList.remove('hidden');
});

// 2-3: ゲーム全体同期と待機メッセージ維持
socket.on('game:sync', (data) => {
    const previousState = currentGameState;
    currentGameState = data.gameState;
    currentRound = data.round;
    isHost = data.hostSocketId === myId;
    cachedOpponentsList = data.players || [];

    if (currentGameState !== 'lobby') {
        roundIndicator.textContent = `ラウンド: ${currentRound}`;
        roundIndicator.classList.remove('hidden');
        nextOpponentIndicator.classList.remove('hidden');
    } else {
        roundIndicator.classList.add('hidden');
        nextOpponentIndicator.classList.add('hidden');
    }

    // 2-1: 準備フェーズ開始時、必ずショップタブを選択
    if (previousState !== 'prep' && currentGameState === 'prep') {
        tabShop.click();
        activeSpectatingId = null;
        waitAnnouncementBanner.classList.add('hidden');
        btnFinishPrep.disabled = false;
        playerReadyLamp.classList.remove('ready');
    }

    // 2-3: 準備フェーズ中、自分が準備完了なら待機メッセージを維持表示
    const me = data.players.find(p => p.id === myId);
    if (currentGameState === 'prep') {
        if (me && me.isReady) {
            waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
            waitAnnouncementBanner.classList.remove('hidden');
            btnFinishPrep.disabled = true;
        } else {
            waitAnnouncementBanner.classList.add('hidden');
            btnFinishPrep.disabled = false;
        }
    }

    if (isHost && currentGameState !== 'lobby') {
        hostAdminActions.classList.remove('hidden');
    } else {
        hostAdminActions.classList.add('hidden');
    }

    if (currentGameState === 'lobby') {
        viewLobby.classList.remove('hidden');
        viewGame.classList.add('hidden');
        waitAnnouncementBanner.classList.add('hidden');
    } else {
        viewLobby.classList.add('hidden');
        viewGame.classList.remove('hidden');
    }

    renderOpponentsBar();
    updateMarketTabLabel();
});

// 3-1: 相手バーの個別レンダリング（観戦予約ボタンの即時切り替え対応）
function renderOpponentsBar() {
    opponentsBar.innerHTML = '';
    cachedOpponentsList.forEach(p => {
        if (p.id === myId) {
            myPlayer = p;
            playerNameDisplay.textContent = p.name;
            playerLifeDisplay.textContent = formatLife(p.life);
            playerGoldDisplay.textContent = `${p.gold}G`;

            if (p.isReady) {
                playerReadyLamp.classList.add('ready');
            } else {
                playerReadyLamp.classList.remove('ready');
            }
            return;
        }

        const card = document.createElement('div');
        card.className = `opponent-card ${!p.isAlive ? 'dead' : ''}`;

        let actionBtnHtml = '';
        const isMeDead = myPlayer && !myPlayer.isAlive;
        const isMeReady = myPlayer && myPlayer.isReady;

        if (isMeDead) {
            // 3-1: 脱落プレイヤーの観戦予約ボタン切り替え
            if (currentGameState === 'prep') {
                const isReserved = reservedSpectateTargetId === p.id;
                actionBtnHtml = `<button class="btn btn-reserve-spectate ${isReserved ? 'warning' : 'secondary'}">${isReserved ? '予約解除' : '観戦予約'}</button>`;
            } else {
                actionBtnHtml = `<button class="btn btn-spectate primary">観戦</button>`;
            }
        } else if (isMeReady && currentGameState === 'battle') {
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
                if (isMeDead && currentGameState === 'prep') {
                    // 3-1: 観戦予約の即時トグルと即座の再描画
                    if (reservedSpectateTargetId === p.id) {
                        reservedSpectateTargetId = null;
                    } else {
                        reservedSpectateTargetId = p.id;
                    }
                    renderOpponentsBar(); // 即座にボタン表示を反映
                } else {
                    activeSpectatingId = p.id;
                    socket.emit('spectate:getBattle', { targetPlayerId: p.id });
                }
            };
        }

        card.onclick = () => {
            if (currentRound > 1 && p.lastRoundInfo) {
                historyPlayerName.textContent = `${p.name} の前ラウンド情報`;
                historyLineup.innerHTML = '';
                historyBench.innerHTML = '';

                p.lastRoundInfo.lineup.forEach(c => {
                    historyLineup.appendChild(createCardElement(c, { nonDraggable: true }));
                });
                p.lastRoundInfo.bench.forEach(c => {
                    historyBench.appendChild(createCardElement(c, { nonDraggable: true }));
                });

                modalHistory.classList.remove('hidden');
            }
        };

        opponentsBar.appendChild(card);
    });
}

socket.on('synthesize:success', ({ baseUid }) => {
    const cardEl = Array.from(document.querySelectorAll('.card-item')).find(el => el.__cardData?.uid === baseUid);
    if (cardEl) {
        cardEl.classList.add('card-synth-success');
        setTimeout(() => cardEl.classList.remove('card-synth-success'), 700);
    }
});

// 個人データ同期
socket.on('player:sync', (data) => {
    if (data.hand) localHand = data.hand;
    if (data.shop) localShop = data.shop;
    if (data.gold !== undefined) playerGoldDisplay.textContent = `${data.gold}G`;
    if (data.life !== undefined) playerLifeDisplay.textContent = formatLife(data.life);

    if (data.selectedLineup) {
        data.selectedLineup.forEach((c, idx) => {
            if (idx < 3) localDeploySlots[idx] = c.uid;
        });
    }

    renderHand();
    renderShop();
    renderDeploySlots();

    if (pendingReadyAfterDiscard && localHand.length <= 6) {
        pendingReadyAfterDiscard = false;
        proceedSetReady();
    }
});

// ============================
// レンダリング処理
// ============================
function renderShop() {
    shopCardsContainer.innerHTML = '';
    localShop.forEach((slot, index) => {
        if (!slot.card) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'slot-dropzone';
            emptyDiv.style.width = '124px';
            emptyDiv.style.height = '148px';
            emptyDiv.textContent = '売却済み';
            shopCardsContainer.appendChild(emptyDiv);
            return;
        }

        const cardEl = createCardElement(slot.card, {
            isShop: true,
            isLocked: slot.locked,
            dragInfo: { type: 'shop', shopIndex: index, card: slot.card },
            onContextMenu: () => {
                socket.emit('shop:toggleLock', { shopIndex: index });
            }
        });
        shopCardsContainer.appendChild(cardEl);
    });
}

function renderMarketCards() {
    marketCardsContainer.innerHTML = '';
    localMarket.forEach((item) => {
        const cardEl = createCardElement(item.card, {
            isMarket: true,
            sellerName: item.sellerName,
            dragInfo: { type: 'market', marketCardUid: item.card.uid, card: item.card }
        });
        marketCardsContainer.appendChild(cardEl);
    });
}

function renderHand() {
    playerHandContainer.innerHTML = '';
    const benchCards = localHand.filter(c => !localDeploySlots.includes(c.uid));

    benchCards.forEach(card => {
        const cardEl = createCardElement(card, {
            dragInfo: { type: 'hand', uid: card.uid }
        });

        cardEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            cardEl.style.transform = 'scale(1.05)';
        });
        cardEl.addEventListener('dragleave', () => {
            cardEl.style.transform = 'none';
        });
        cardEl.addEventListener('drop', (e) => {
            e.preventDefault();
            cardEl.style.transform = 'none';
            if (!dragData) return;

            if (dragData.type === 'deploy') {
                const slotIdx = dragData.slotIndex;
                localDeploySlots[slotIdx] = card.uid;
                renderHand();
                renderDeploySlots();
                syncLineupChanges();
                dragData = null;
                return;
            }

            if (dragData.type === 'hand' || dragData.type === 'shop' || dragData.type === 'market') {
                socket.emit('card:synthesizeEx', {
                    baseUid: card.uid,
                    source: dragData
                });
            }
            dragData = null;
        });

        playerHandContainer.appendChild(cardEl);
    });
}

function renderDeploySlots() {
    deployDropzones.forEach((zone, index) => {
        zone.innerHTML = '';
        const uid = localDeploySlots[index];
        if (uid) {
            const card = localHand.find(c => c.uid === uid);
            if (card) {
                const cardEl = createCardElement(card, {
                    dragInfo: { type: 'deploy', slotIndex: index, uid: card.uid },
                    onContextMenu: () => {
                        localDeploySlots[index] = null;
                        renderHand();
                        renderDeploySlots();
                        syncLineupChanges();
                    }
                });
                zone.appendChild(cardEl);
            }
        }
    });
}

function syncLineupChanges() {
    const lineupUids = localDeploySlots.filter(Boolean);
    socket.emit('player:updateLineup', { lineupUids });
}

// ============================
// ドラッグ＆ドロップ ゾーン
// ============================
playerHandContainer.addEventListener('dragover', (e) => e.preventDefault());
playerHandContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragData) return;

    if (dragData.type === 'shop') {
        socket.emit('shop:buy', { shopIndex: dragData.shopIndex });
    } else if (dragData.type === 'market') {
        socket.emit('market:buy', { marketCardUid: dragData.marketCardUid });
    } else if (dragData.type === 'deploy') {
        localDeploySlots[dragData.slotIndex] = null;
        renderHand();
        renderDeploySlots();
        syncLineupChanges();
    }
    dragData = null;
});

deployDropzones.forEach((zone, index) => {
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (!dragData) return;

        const previousCardUid = localDeploySlots[index];

        if (dragData.type === 'shop') {
            socket.emit('shop:buyAndDeploy', {
                shopIndex: dragData.shopIndex,
                slotIndex: index,
                previousCardUid: previousCardUid
            });
        } else if (dragData.type === 'market') {
            socket.emit('market:buyAndDeploy', {
                marketCardUid: dragData.marketCardUid,
                slotIndex: index,
                previousCardUid: previousCardUid
            });
        } else if (dragData.type === 'hand') {
            localDeploySlots[index] = dragData.uid;
            renderHand();
            renderDeploySlots();
            syncLineupChanges();
        } else if (dragData.type === 'deploy') {
            const temp = localDeploySlots[index];
            localDeploySlots[index] = dragData.uid;
            localDeploySlots[dragData.slotIndex] = temp;
            renderHand();
            renderDeploySlots();
            syncLineupChanges();
        }
        dragData = null;
    });
});

discardDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    discardDropzone.classList.add('drag-over');
});
discardDropzone.addEventListener('dragleave', () => {
    discardDropzone.classList.remove('drag-over');
});
discardDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    discardDropzone.classList.remove('drag-over');
    if (!dragData) return;

    if (dragData.type === 'hand') {
        socket.emit('card:discard', { cardUid: dragData.uid });
    } else if (dragData.type === 'deploy') {
        socket.emit('card:discard', { cardUid: dragData.uid });
        localDeploySlots[dragData.slotIndex] = null;
        renderDeploySlots();
        syncLineupChanges();
    }
    dragData = null;
});

// ============================
// UIイベント
// ============================
btnToggleEntry.onclick = () => socket.emit('lobby:toggleEntry');
btnStartGame.onclick = () => socket.emit('lobby:startGame');

btnOpenTips.onclick = () => {
    modalTips.classList.remove('hidden');
    tipTabElement.click();
};
btnTipsClose.onclick = () => modalTips.classList.add('hidden');

tipTabElement.onclick = () => {
    tipTabElement.classList.add('active');
    tipTabTribe.classList.remove('active');
    tipTabSynth.classList.remove('active');
    tipContentElement.classList.remove('hidden');
    tipContentTribe.classList.add('hidden');
    tipContentSynth.classList.add('hidden');
};
tipTabTribe.onclick = () => {
    tipTabTribe.classList.add('active');
    tipTabElement.classList.remove('active');
    tipTabSynth.classList.remove('active');
    tipContentTribe.classList.remove('hidden');
    tipContentElement.classList.add('hidden');
    tipContentSynth.classList.add('hidden');
};
tipTabSynth.onclick = () => {
    tipTabSynth.classList.add('active');
    tipTabElement.classList.remove('active');
    tipTabTribe.classList.remove('active');
    tipContentSynth.classList.remove('hidden');
    tipContentElement.classList.add('hidden');
    tipContentTribe.classList.add('hidden');
};

tabShop.onclick = () => {
    tabShop.classList.add('active');
    tabMarket.classList.remove('active');
    shopPanel.classList.remove('hidden');
    marketPanel.classList.add('hidden');
};
tabMarket.onclick = () => {
    if (currentRound < 2) return;
    tabMarket.classList.add('active');
    tabShop.classList.remove('active');
    marketPanel.classList.remove('hidden');
    shopPanel.classList.add('hidden');
};

btnReroll.onclick = () => socket.emit('shop:reroll');

btnFinishPrep.onclick = () => {
    if (localHand.length >= 7) {
        pendingReadyAfterDiscard = true;
        showOverhandDiscardModal();
        return;
    }

    if (localHand.length === 0) {
        showConfirm('手札が0枚です。\n本当に完了しますか？', () => {
            proceedSetReady();
        });
        return;
    }

    const selectedCount = localDeploySlots.filter(Boolean).length;
    if (selectedCount === 0) {
        showConfirm('繰り出すカードを選択していません。\n本当に完了しますか？', () => {
            proceedSetReady();
        });
        return;
    }

    proceedSetReady();
};

function proceedSetReady() {
    const lineupUids = localDeploySlots.filter(Boolean);
    socket.emit('player:setReady', { lineupUids });
    playerReadyLamp.classList.add('ready');
    btnFinishPrep.disabled = true;
    // 2-3: メッセージを即座に表示
    waitAnnouncementBanner.textContent = '全員の準備完了を待っています...';
    waitAnnouncementBanner.classList.remove('hidden');
}

function showOverhandDiscardModal() {
    clearSynthesizableHighlights(); // 2-2: ハイライト解除
    overhandCardList.innerHTML = '';
    modalOverhand.classList.remove('hidden');

    localHand.forEach(card => {
        const cardEl = createCardElement(card, { nonDraggable: true });
        cardEl.style.cursor = 'pointer';
        cardEl.onclick = () => {
            socket.emit('card:discard', { cardUid: card.uid });
            setTimeout(() => {
                if (localHand.length <= 6) {
                    modalOverhand.classList.add('hidden');
                    if (pendingReadyAfterDiscard) {
                        pendingReadyAfterDiscard = false;
                        proceedSetReady();
                    }
                } else {
                    showOverhandDiscardModal();
                }
            }, 200);
        };
        overhandCardList.appendChild(cardEl);
    });
}

btnOpenSettings.onclick = () => modalSettings.classList.remove('hidden');
btnSettingsClose.onclick = () => modalSettings.classList.add('hidden');
btnSaveName.onclick = () => {
    const name = inputPlayerName.value;
    if (name.trim()) {
        socket.emit('player:rename', name.trim());
        modalSettings.classList.add('hidden');
    }
};
btnForceEnd.onclick = () => {
    showConfirm('本当にゲームを強制終了しますか？', () => {
        socket.emit('game:forceEnd');
        modalSettings.classList.add('hidden');
    });
};

btnHistoryClose.onclick = () => modalHistory.classList.add('hidden');

// ============================
// バトル進行・演出 (4-1, 5-1)
// ============================
socket.on('battle:start', ({ summary, logs, isGameOverDecided: gameOverFlag }) => {
    currentBattleData = { summary, logs };
    isGameOverDecided = !!gameOverFlag;

    waitAnnouncementBanner.classList.add('hidden');

    if (reservedSpectateTargetId && !myPlayer?.isAlive) {
        activeSpectatingId = reservedSpectateTargetId;
    }

    battleScreen.classList.remove('hidden');
    battleLogList.innerHTML = '';

    const isSpectating = summary.p1Id !== myId && summary.p2Id !== myId;
    const needSwap = !isSpectating && summary.p2Id === myId;

    const leftName = needSwap ? summary.p2Name : summary.p1Name;
    const rightName = needSwap ? summary.p1Name : summary.p2Name;

    battleViewTitle.textContent = isSpectating ? `観戦：${leftName} VS ${rightName}` : 'バトルフェーズ';
    if (isSpectating) spectatingBadge.classList.remove('hidden');
    else spectatingBadge.classList.add('hidden');

    bP1Name.textContent = isSpectating ? leftName : 'あなた';
    bP2Name.textContent = rightName;
    bP1CardSlot.innerHTML = '';
    bP2CardSlot.innerHTML = '';

    let logIndex = 0;
    clearInterval(battleAnimationTimer);

    function advanceStep() {
        if (logIndex >= logs.length) {
            clearInterval(battleAnimationTimer);
            setTimeout(() => showBattleResult(summary), 1200);
            return;
        }

        const log = logs[logIndex];

        if (log.counts) {
            const p1Rem = needSwap ? log.counts.p2Remaining : log.counts.p1Remaining;
            const p1Tot = needSwap ? log.counts.p2Total : log.counts.p1Total;
            const p2Rem = needSwap ? log.counts.p1Remaining : log.counts.p2Remaining;
            const p2Tot = needSwap ? log.counts.p1Total : log.counts.p2Total;

            p1CardsIndicator.textContent = renderCardDots(p1Tot, p1Rem);
            p2CardsIndicator.textContent = renderCardDots(p2Tot, p2Rem);
        }

        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        if (log.damage > 0) logItem.classList.add('dmg');
        if (log.isCrit) logItem.classList.add('crit');
        logItem.textContent = log.text;
        battleLogList.appendChild(logItem);

        // 5-1: 確実な自動スクロール
        requestAnimationFrame(() => {
            battleLogList.scrollTop = battleLogList.scrollHeight;
            logItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        // 4-1: HP0消滅アニメーションとスロットクリア制御
        if (log.faintedSide) {
            const targetSide = (log.faintedSide === 'p1' !== needSwap) ? p1Combatant : p2Combatant;
            const targetSlot = (log.faintedSide === 'p1' !== needSwap) ? bP1CardSlot : bP2CardSlot;
            targetSide.classList.add('anim-faint');
            setTimeout(() => {
                targetSide.classList.remove('anim-faint');
                targetSlot.innerHTML = ''; // 復活見えを防ぐため空にする
            }, 550);
        }

        if (log.attacker) {
            const atkIsP1 = (log.attacker === 'p1') !== needSwap;
            const atkSide = atkIsP1 ? p1Combatant : p2Combatant;
            const defSide = atkIsP1 ? p2Combatant : p1Combatant;

            atkSide.classList.add(atkIsP1 ? 'anim-atk-p1' : 'anim-atk-p2');
            setTimeout(() => atkSide.classList.remove(atkIsP1 ? 'anim-atk-p1' : 'anim-atk-p2'), 400);

            setTimeout(() => {
                if (!log.isHit) {
                    defSide.classList.add('anim-dodge');
                    spawnDamagePopup(defSide, 'MISS', 'miss');
                    setTimeout(() => defSide.classList.remove('anim-dodge'), 450);
                } else {
                    defSide.classList.add('anim-hurt');
                    let popType = 'normal';
                    if (log.isCrit) popType = 'crit';
                    else if (log.attrMult === 2.0) popType = 'weak';
                    else if (log.attrMult === 0.5) popType = 'resist';

                    spawnDamagePopup(defSide, `-${log.damage}`, popType);
                    setTimeout(() => defSide.classList.remove('anim-hurt'), 400);
                }
            }, 200);
        }

        // カード描画（消滅直後でない場合のみ描画）
        if (log.state && !log.faintedSide) {
            const leftCard = needSwap ? log.state.p2Card : log.state.p1Card;
            const rightCard = needSwap ? log.state.p1Card : log.state.p2Card;

            if (leftCard && leftCard.hp > 0) {
                bP1CardSlot.innerHTML = '';
                bP1CardSlot.appendChild(createCardElement(leftCard, { nonDraggable: true }));
            }
            if (rightCard && rightCard.hp > 0) {
                bP2CardSlot.innerHTML = '';
                bP2CardSlot.appendChild(createCardElement(rightCard, { nonDraggable: true }));
            }
        }

        logIndex++;
    }

    advanceStep();
    battleAnimationTimer = setInterval(advanceStep, 700);
});

btnSkipBattle.onclick = () => {
    if (!currentBattleData) return;
    clearInterval(battleAnimationTimer);
    battleLogList.innerHTML = '';
    currentBattleData.logs.forEach(l => {
        const item = document.createElement('div');
        item.className = 'log-item';
        if (l.damage > 0) item.classList.add('dmg');
        if (l.isCrit) item.classList.add('crit');
        item.textContent = l.text;
        battleLogList.appendChild(item);
    });
    requestAnimationFrame(() => {
        battleLogList.scrollTop = battleLogList.scrollHeight;
    });

    const lastLog = currentBattleData.logs[currentBattleData.logs.length - 1];
    if (lastLog && lastLog.counts) {
        p1CardsIndicator.textContent = renderCardDots(lastLog.counts.p1Total, lastLog.counts.p1Remaining);
        p2CardsIndicator.textContent = renderCardDots(lastLog.counts.p2Total, lastLog.counts.p2Remaining);
    }

    showBattleResult(currentBattleData.summary);
};

function showBattleResult(summary) {
    battleScreen.classList.add('hidden');
    resultModal.classList.remove('hidden');

    const isSpectating = summary.p1Name !== myPlayer?.name && summary.p2Name !== myPlayer?.name;

    if (isSpectating) {
        if (summary.winnerName) {
            resultTitle.textContent = '🏆 バトル終了';
            resultTitle.style.color = 'var(--accent-color)';
            resultSummaryText.textContent = `${summary.winnerName} がバトルに勝利しました！`;
        } else {
            resultTitle.textContent = '⚔ バトル終了';
            resultTitle.style.color = 'var(--warning-color)';
            resultSummaryText.textContent = `対戦は引き分けでした。`;
        }
    } else {
        if (summary.isWinner) {
            resultTitle.textContent = '🏆 バトル勝利！';
            resultTitle.style.color = 'var(--success-color)';
            resultSummaryText.textContent = `${summary.opponentName} との対戦に勝利しました！`;
        } else if (summary.isDraw) {
            resultTitle.textContent = '⚔ 引き分け';
            resultTitle.style.color = 'var(--warning-color)';
            resultSummaryText.textContent = `${summary.opponentName} との対戦は引き分けでした。`;
        } else {
            resultTitle.textContent = '💀 バトル敗北…';
            resultTitle.style.color = 'var(--danger-color)';
            resultSummaryText.textContent = `${summary.opponentName} との対戦に敗北しました。（ライフ -1）`;
        }
    }

    resultDamageTableBody.innerHTML = '';
    if (summary.detailedDamages && summary.detailedDamages.length > 0) {
        summary.detailedDamages.forEach(d => {
            const row = document.createElement('tr');
            const tdAtk = document.createElement('td');
            const tdDef = document.createElement('td');
            const tdDmg = document.createElement('td');

            if (d.atkCard) tdAtk.appendChild(createCardElement(d.atkCard, { nonDraggable: true }));
            else tdAtk.textContent = d.atkCardName;

            if (d.defCard) tdDef.appendChild(createCardElement(d.defCard, { nonDraggable: true }));
            else tdDef.textContent = d.defCardName;

            tdDmg.style.fontWeight = 'bold';
            tdDmg.style.color = 'var(--warning-color)';
            tdDmg.style.fontSize = '1.2rem';
            tdDmg.textContent = d.damage;

            row.appendChild(tdAtk);
            row.appendChild(tdDef);
            row.appendChild(tdDmg);
            resultDamageTableBody.appendChild(row);
        });
    } else {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="3" style="text-align:center;">戦闘ダメージなし</td>`;
        resultDamageTableBody.appendChild(row);
    }

    resultLogList.innerHTML = '';
    if (currentBattleData && currentBattleData.logs) {
        currentBattleData.logs.forEach(l => {
            const item = document.createElement('div');
            item.className = 'log-item';
            if (l.damage > 0) item.classList.add('dmg');
            if (l.isCrit) item.classList.add('crit');
            item.textContent = l.text;
            resultLogList.appendChild(item);
        });
    }
}

btnToggleResultLog.onclick = () => {
    resultLogDrawer.classList.toggle('hidden');
    btnToggleResultLog.textContent = resultLogDrawer.classList.contains('hidden') ? 'ログを表示 ▼' : 'ログを隠す ▲';
};

btnResultNext.onclick = () => {
    resultModal.classList.add('hidden');

    if (isGameOverDecided) {
        socket.emit('battle:next');
        return;
    }

    playerReadyLamp.classList.add('ready');
    waitAnnouncementBanner.textContent = '全員のバトル終了を待っています...';
    waitAnnouncementBanner.classList.remove('hidden');
    socket.emit('battle:next');
};

// ============================
// 最終結果画面
// ============================
socket.on('game:ended', ({ rankings }) => {
    battleScreen.classList.add('hidden');
    resultModal.classList.add('hidden');
    waitAnnouncementBanner.classList.add('hidden');
    gameOverModal.classList.remove('hidden');

    const winner = rankings.find(r => r.rank === 1);
    if (winner) {
        winnerCelebration.classList.remove('hidden');
        winnerNameDisplay.textContent = winner.name;
    } else {
        winnerCelebration.classList.add('hidden');
    }

    finalRankingTableBody.innerHTML = '';
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

        finalRankingTableBody.appendChild(row);
    });
});

btnRematch.onclick = () => {
    gameOverModal.classList.add('hidden');
    viewGame.classList.add('hidden');
    viewLobby.classList.remove('hidden');
    socket.emit('lobby:rematch');
};

btnLeave.onclick = () => {
    gameOverModal.classList.add('hidden');
    viewGame.classList.add('hidden');
    viewLobby.classList.remove('hidden');
    socket.emit('lobby:leave');
};