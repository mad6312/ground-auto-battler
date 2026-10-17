/**
 * public/js/state.js
 * クライアント側状態管理およびDOM要素参照モジュール (完全改修版)
 */

export const socket = io();

export const state = {
    myId: null,
    myPlayer: null,
    currentGameState: 'lobby',
    currentRound: 1,
    isHost: false,

    localHand: [],
    localDeploySlots: [null, null, null],
    localShop: [],
    localMarket: [],

    currentOpponentName: '未定',
    reservedSpectateTargetId: null,
    activeSpectatingId: null,

    // 高性能カスタムポインタドラッグ状態
    pointerDrag: {
        isDragging: false,
        dragData: null,
        ghostElement: null,
        offsetX: 0,
        offsetY: 0
    },

    pendingMarketSync: null,
    pendingHandDropAnim: null,

    battleAnimationTimer: null,
    battleTimeoutIds: [],
    roundPopupTimer: null,

    currentBattleData: null,
    isGameOverDecided: false,
    isGameOverShown: false, // H-4: 明示的フラグ管理
    pendingReadyAfterDiscard: false,

    cachedOpponentsList: [],

    latestRankings: null,
    hasClickedNextInBattle: false,
    displayedLifeMap: new Map(),
    currentDistributeCardUid: null,
    isRoundPopupPlaying: false
};

// すべてのバトル関連タイマーを安全に全破棄する関数
export function clearAllBattleTimers() {
    if (state.battleAnimationTimer) {
        clearInterval(state.battleAnimationTimer);
        state.battleAnimationTimer = null;
    }
    state.battleTimeoutIds.forEach(id => clearTimeout(id));
    state.battleTimeoutIds = [];
}

// クライアント側ゲーム状態および開いているモーダルの一括完全リセット (H-4 / L-10改修)
export function resetClientGameState() {
    clearAllBattleTimers();

    if (state.roundPopupTimer) {
        clearTimeout(state.roundPopupTimer);
        state.roundPopupTimer = null;
    }

    state.localHand = [];
    state.localDeploySlots = [null, null, null];
    state.localShop = [];
    state.localMarket = [];

    state.reservedSpectateTargetId = null;
    state.activeSpectatingId = null;
    state.pendingMarketSync = null;
    state.pendingHandDropAnim = null;
    state.currentBattleData = null;
    state.isGameOverDecided = false;
    state.isGameOverShown = false;
    state.pendingReadyAfterDiscard = false;
    state.latestRankings = null;
    state.hasClickedNextInBattle = false;
    state.displayedLifeMap.clear();
    state.currentDistributeCardUid = null;
    state.isRoundPopupPlaying = false;
    state.currentOpponentName = '未定';

    // モーダルの完全非表示（H-4: gameOverModal も確実に閉じる）
    if (dom.gameOverModal) dom.gameOverModal.classList.add('hidden');
    if (dom.modalOverhand) dom.modalOverhand.classList.add('hidden');
    if (dom.modalConfirm) dom.modalConfirm.classList.add('hidden');
    if (dom.modalHistory) dom.modalHistory.classList.add('hidden');
    if (dom.modalSettings) dom.modalSettings.classList.add('hidden');
    if (dom.modalTips) dom.modalTips.classList.add('hidden');
    if (dom.battleScreen) dom.battleScreen.classList.add('hidden');
    if (dom.resultModal) dom.resultModal.classList.add('hidden');
    if (dom.waitAnnouncementBanner) dom.waitAnnouncementBanner.classList.add('hidden');
    if (dom.roundStartPopup) dom.roundStartPopup.classList.add('hidden');
}

// プレイヤー名エスケープ関数
export function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// トーストメッセージ表示 (タイマー重複クリア付き)
let toastTimer = null;
export function showToast(msg) {
    let toast = document.getElementById('game-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'game-toast';
        toast.className = 'game-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');

    if (toastTimer) {
        clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        toastTimer = null;
    }, 2000);
}

// ============================
// DOM要素参照
// ============================
export const dom = {
    viewLobby: document.getElementById('view-lobby'),
    viewGame: document.getElementById('view-game'),
    roundIndicator: document.getElementById('round-indicator'),
    nextOpponentIndicator: document.getElementById('next-opponent-indicator'),
    waitAnnouncementBanner: document.getElementById('wait-announcement-banner'),
    roundStartPopup: document.getElementById('round-start-popup'),

    lobbyEntryCount: document.getElementById('lobby-entry-count'),
    lobbyEntryBadge: document.getElementById('lobby-entry-badge'),
    btnToggleEntry: document.getElementById('btn-toggle-entry'),
    btnStartGame: document.getElementById('btn-start-game'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),

    playerNameDisplay: document.getElementById('player-name-display'),
    playerLifeDisplay: document.getElementById('player-life-display'),
    playerGoldDisplay: document.getElementById('player-gold-display'),
    playerReadyLamp: document.getElementById('player-ready-lamp'),
    opponentsBar: document.getElementById('opponents-bar'),

    tabShop: document.getElementById('tab-shop'),
    tabMarket: document.getElementById('tab-market'),
    shopPanel: document.getElementById('shop-panel'),
    marketPanel: document.getElementById('market-panel'),
    shopCardsContainer: document.getElementById('shop-cards'),
    marketCardsContainer: document.getElementById('market-cards'),
    btnReroll: document.getElementById('btn-reroll'),

    deployDropzones: [
        document.getElementById('deploy-0'),
        document.getElementById('deploy-1'),
        document.getElementById('deploy-2')
    ],
    playerHandContainer: document.getElementById('player-hand'),
    discardDropzone: document.getElementById('discard-dropzone'),
    btnFinishPrep: document.getElementById('btn-finish-prep'),

    battleScreen: document.getElementById('battle-screen'),
    battleViewTitle: document.getElementById('battle-view-title'),
    spectatingBadge: document.getElementById('spectating-badge'),
    bP1Name: document.getElementById('b-p1-name'),
    bP2Name: document.getElementById('b-p2-name'),
    p1CardsIndicator: document.getElementById('p1-cards-indicator'),
    p2CardsIndicator: document.getElementById('p2-cards-indicator'),
    bP1CardSlot: document.getElementById('b-p1-card-slot'),
    bP2CardSlot: document.getElementById('b-p2-card-slot'),
    p1Combatant: document.getElementById('p1-combatant'),
    p2Combatant: document.getElementById('p2-combatant'),
    battleLogList: document.getElementById('battle-log-list'),
    btnSkipBattle: document.getElementById('btn-skip-battle'),

    resultModal: document.getElementById('result-modal'),
    resultTitle: document.getElementById('result-title'),
    resultSummaryText: document.getElementById('result-summary-text'),
    resultDamageTableBody: document.querySelector('#result-damage-table tbody'),
    resultLogDrawer: document.getElementById('result-log-drawer'),
    resultLogList: document.getElementById('result-log-list'),
    btnResultNext: document.getElementById('btn-result-next'),

    gameOverModal: document.getElementById('game-over-modal'),
    winnerCelebration: document.getElementById('winner-celebration'),
    winnerNameDisplay: document.getElementById('winner-name-display'),
    finalRankingTableBody: document.querySelector('#final-ranking-table tbody'),
    btnRematch: document.getElementById('btn-rematch'),
    btnLeave: document.getElementById('btn-leave'),

    modalTips: document.getElementById('modal-tips'),
    btnOpenTips: document.getElementById('btn-open-tips'),
    btnTipsClose: document.getElementById('btn-tips-close'),
    tipTabElement: document.getElementById('tip-tab-element'),
    tipTabTribe: document.getElementById('tip-tab-tribe'),
    tipTabSynth: document.getElementById('tip-tab-synth'),
    tipContentElement: document.getElementById('tip-content-element'),
    tipContentTribe: document.getElementById('tip-content-tribe'),
    tipContentSynth: document.getElementById('tip-content-synth'),

    modalOverhand: document.getElementById('modal-overhand'),
    overhandCardList: document.getElementById('overhand-card-list'),
    modalConfirm: document.getElementById('modal-confirm'),
    modalConfirmMsg: document.getElementById('modal-confirm-msg'),
    btnConfirmYes: document.getElementById('btn-confirm-yes'),
    btnConfirmNo: document.getElementById('btn-confirm-no'),

    modalHistory: document.getElementById('modal-history'),
    historyPlayerName: document.getElementById('history-player-name'),
    historyLineup: document.getElementById('history-lineup'),
    historyBench: document.getElementById('history-bench'),
    btnHistoryClose: document.getElementById('btn-history-close'),

    modalSettings: document.getElementById('modal-settings'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    inputPlayerName: document.getElementById('input-player-name'),
    btnSaveName: document.getElementById('btn-save-name'),
    btnSettingsClose: document.getElementById('btn-settings-close'),
    hostAdminActions: document.getElementById('host-admin-actions'),
    btnForceEnd: document.getElementById('btn-force-end')
};

// ============================
// 汎用ヘルパー関数
// ============================
let confirmCallback = null;

export function formatLife(life) {
    const max = 5;
    const clamped = Math.max(0, Math.min(max, life));
    return '♥'.repeat(clamped) + '♡'.repeat(max - clamped);
}

export function showConfirm(message, onYes) {
    dom.modalConfirmMsg.textContent = message;
    confirmCallback = onYes;
    dom.modalConfirm.classList.remove('hidden');
}

dom.btnConfirmYes.onclick = () => {
    dom.modalConfirm.classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
};

dom.btnConfirmNo.onclick = () => {
    dom.modalConfirm.classList.add('hidden');
    confirmCallback = null;
};

export function renderCardDots(total, remaining) {
    if (!total || total <= 0) return '';
    const rem = Math.max(0, Math.min(total, remaining));
    return '●'.repeat(rem) + '〇'.repeat(total - rem);
}