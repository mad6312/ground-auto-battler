/**
 * public/js/cardUI.js
 * カードUIコンポーネント生成および表示制御モジュール (完全改修版)
 */

import { state, dom, socket, escapeHtml } from './state.js';

const RARITY_COSTS = {
    common: 2,
    uncommon: 4,
    rare: 6,
    epic: 8,
    legend: 10
};

const TRIBE_BONUSES = {
    'ドワーフ': { target: ['hp'], percent: 10 },
    'ドラゴン': { target: ['atk'], percent: 10 },
    'エルフ': { target: ['spd'], percent: 10 },
    'オーク': { target: ['hp', 'atk'], percent: 5 },
    'ヴァンパイア': { target: ['hp', 'spd'], percent: 5 },
    'リザードマン': { target: ['atk', 'spd'], percent: 5 }
};

const RARITY_ORDER = { common: 1, uncommon: 2, rare: 3, epic: 4, legend: 5 };
const TRIBE_ORDER = { 'ドワーフ': 1, 'ドラゴン': 2, 'エルフ': 3, 'オーク': 4, 'ヴァンパイア': 5, 'リザードマン': 6 };
const ELEMENT_ORDER = { '火': 1, '氷': 2, '風': 3, '雷': 4, '水': 5, '地': 6 };

// 飛翔移動中のカードUIDを追跡管理するSet
const activeFlightUids = new Set();

// 現在マウスホバーまたはドラッグされているカード情報（移動中のカード判定にも動的連動）
let currentHoveredCard = null;
let currentHoveredArea = null;

// タッチ長押しタイマーが発火したタイムスタンプ（タッチ端末特有の二重発火防止専用）
let lastTouchLongTapTimestamp = 0;

export function sortHandCards(cards) {
    return [...cards].sort((a, b) => {
        const rA = RARITY_ORDER[a.rarity] || 99;
        const rB = RARITY_ORDER[b.rarity] || 99;
        if (rA !== rB) return rA - rB;

        const tA = TRIBE_ORDER[a.tribe] || 99;
        const tB = TRIBE_ORDER[b.tribe] || 99;
        if (tA !== tB) return tA - tB;

        const eA = ELEMENT_ORDER[a.element] || 99;
        const eB = ELEMENT_ORDER[b.element] || 99;
        return eA - eB;
    });
}

function applyPercentRoundHalfUp(val, percent) {
    return Math.floor((val * (100 + percent) + 50) / 100);
}

export function getBuffedStats(card, shouldBuff = false) {
    if (!shouldBuff) {
        return {
            hp: card.hp,
            atk: card.atk,
            spd: card.spd,
            isHpBuffed: !!card.isHpBuffed,
            isAtkBuffed: !!card.isAtkBuffed,
            isSpdBuffed: !!card.isSpdBuffed
        };
    }

    const myCards = [...state.localHand];
    const count = myCards.filter(c => c && c.tribe === card.tribe).length;

    let hp = card.hp;
    let atk = card.atk;
    let spd = card.spd;
    let isHpBuffed = false;
    let isAtkBuffed = false;
    let isSpdBuffed = false;

    if (count >= 2 && TRIBE_BONUSES[card.tribe]) {
        const bonus = TRIBE_BONUSES[card.tribe];
        const pct = (count - 1) * bonus.percent;

        if (bonus.target.includes('hp')) {
            hp = applyPercentRoundHalfUp(hp, pct);
            isHpBuffed = true;
        }
        if (bonus.target.includes('atk')) {
            atk = applyPercentRoundHalfUp(atk, pct);
            isAtkBuffed = true;
        }
        if (bonus.target.includes('spd')) {
            spd = applyPercentRoundHalfUp(spd, pct);
            isSpdBuffed = true;
        }
    }

    return { hp, atk, spd, isHpBuffed, isAtkBuffed, isSpdBuffed };
}

/**
 * 同レアリティ・同種族カードの強調アニメーション適用
 * 移動中のカード (.floating-flight-card) も通常カードと全く同一ルールで走査対象に含める
 */
export function highlightSynthesizableCards(sourceCard, sourceArea) {
    if (!sourceCard) return;
    const allowedAreas = ['shop', 'market', 'deploy', 'hand'];
    if (!allowedAreas.includes(sourceArea)) return;
    if (!dom.modalOverhand.classList.contains('hidden')) return;

    // 移動中のカード (.floating-flight-card) も対象に含める
    const validContainersSelector = '#player-hand .card-item, #shop-cards .card-item, #market-cards .card-item, .slots-container .card-item, .floating-flight-card';
    const targetCardElements = document.querySelectorAll(validContainersSelector);

    targetCardElements.forEach(el => {
        const cardData = el.__cardData;
        // ホバーされているカード自身ではなく、かつ同レアリティ・同種族であるカードのみを強調
        if (cardData && cardData.uid !== sourceCard.uid) {
            if (cardData.rarity === sourceCard.rarity && cardData.tribe === sourceCard.tribe) {
                el.classList.add('card-synth-highlight');
            } else {
                el.classList.remove('card-synth-highlight');
            }
        } else {
            el.classList.remove('card-synth-highlight');
        }
    });
}

export function clearSynthesizableHighlights() {
    document.querySelectorAll('.card-synth-highlight').forEach(el => {
        el.classList.remove('card-synth-highlight');
    });
}

/**
 * カードの飛翔アニメーション
 * 移動中のカード自身に不当な強制発光は行わず、マウスオーバー状態に完全連動
 */
export function animateCardFlight(startRect, targetElement, card = null, onComplete = null) {
    if (!startRect || !targetElement) {
        if (onComplete) onComplete();
        return;
    }

    const cardUid = card ? card.uid : null;

    if (cardUid) {
        activeFlightUids.add(cardUid);
    }

    const endRect = targetElement.getBoundingClientRect();
    const ghost = targetElement.cloneNode(true);
    ghost.classList.add('floating-flight-card');
    ghost.classList.remove('card-synth-highlight'); // 初期状態では無条件発光させない

    // 移動中のゴースト要素にカードデータを紐付け、強調判定の走査対象とする
    if (card) {
        ghost.__cardData = card;
    }

    // 移動開始時点で別のカードがすでにホバー/ドラッグ中であれば、そのカードの条件に基づき強調判定
    if (currentHoveredCard && currentHoveredArea) {
        if (card && card.uid !== currentHoveredCard.uid &&
            card.rarity === currentHoveredCard.rarity && card.tribe === currentHoveredCard.tribe) {
            ghost.classList.add('card-synth-highlight');
        }
    }

    ghost.style.left = `${startRect.left}px`;
    ghost.style.top = `${startRect.top}px`;
    ghost.style.width = `${startRect.width}px`;
    ghost.style.height = `${startRect.height}px`;
    ghost.style.transform = 'translate(0px, 0px)';
    ghost.style.opacity = '1';

    document.body.appendChild(ghost);
    targetElement.style.opacity = '0';

    void ghost.offsetHeight;

    const deltaX = endRect.left - startRect.left;
    const deltaY = endRect.top - startRect.top;

    let hasCleanedUp = false;
    const cleanup = () => {
        if (hasCleanedUp) return;
        hasCleanedUp = true;

        if (cardUid) {
            activeFlightUids.delete(cardUid);
            const currentTarget = document.querySelector(`[data-card-uid="${cardUid}"]`);
            if (currentTarget) {
                currentTarget.style.opacity = '1';
                // 着地後、現在ホバー中のカードがあれば強調状態を再反映
                if (currentHoveredCard && currentHoveredArea) {
                    highlightSynthesizableCards(currentHoveredCard, currentHoveredArea);
                }
            }
        } else {
            targetElement.style.opacity = '1';
        }

        if (ghost.parentNode) ghost.remove();
        if (onComplete) onComplete();
    };

    const safetyTimer = setTimeout(cleanup, 450);

    requestAnimationFrame(() => {
        ghost.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        setTimeout(() => {
            clearTimeout(safetyTimer);
            cleanup();
        }, 390);
    });
}

// ============================
// 高性能ポインタードラッグシステム
// ============================
let customDropHandler = null;
export function setCustomDropHandler(handler) {
    customDropHandler = handler;
}

let activeDragSession = null;
let currentHighlightedDropzone = null;

function updateDropzoneHighlight(dropTarget) {
    if (currentHighlightedDropzone) {
        currentHighlightedDropzone.classList.remove('drag-over');
        currentHighlightedDropzone = null;
    }
    if (!dropTarget) return;

    const zone = dropTarget.closest('.deploy-slot .slot-dropzone, #discard-dropzone');
    if (zone) {
        zone.classList.add('drag-over');
        currentHighlightedDropzone = zone;
    }
}

const endCurrentDrag = (e, isSuccess) => {
    if (!activeDragSession) return;
    const s = activeDragSession;
    activeDragSession = null;

    currentHoveredCard = null;
    currentHoveredArea = null;

    updateDropzoneHighlight(null);

    if (s.sourceElement) {
        s.sourceElement.style.opacity = '1';
    }
    clearSynthesizableHighlights();

    if (state.pointerDrag.ghostElement) {
        state.pointerDrag.ghostElement.remove();
    }

    if (s.hasStartedDrag && isSuccess && customDropHandler && state.pointerDrag.dragData) {
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
        customDropHandler(dropTarget, state.pointerDrag.dragData, e.clientX, e.clientY);
    }

    state.pointerDrag = { isDragging: false, dragData: null, ghostElement: null, offsetX: 0, offsetY: 0 };

    if (state.pendingMarketSync) {
        renderMarketCards();
        updateMarketTabLabel();
        state.pendingMarketSync = null;
    }
};

window.addEventListener('pointermove', (e) => {
    if (!activeDragSession) return;

    if (e.buttons === 0) {
        endCurrentDrag(e, false);
        return;
    }

    const s = activeDragSession;
    const moveDist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
    if (!s.hasStartedDrag && moveDist > 5) {
        s.hasStartedDrag = true;
        if (s.clearTapTimer) s.clearTapTimer();

        const rect = s.sourceElement.getBoundingClientRect();

        const ghost = s.sourceElement.cloneNode(true);
        ghost.classList.add('custom-drag-ghost');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.left = `${e.clientX - (s.startX - rect.left)}px`;
        ghost.style.top = `${e.clientY - (s.startY - rect.top)}px`;
        document.body.appendChild(ghost);

        state.pointerDrag = {
            isDragging: true,
            dragData: { ...s.dragInfo, card: s.card },
            ghostElement: ghost,
            offsetX: s.startX - rect.left,
            offsetY: s.startY - rect.top,
            sourceElement: s.sourceElement
        };

        s.sourceElement.style.opacity = '0.35';

        // ドラッグ中のカードをホバー対象として登録し強調
        currentHoveredCard = s.card;
        currentHoveredArea = s.dragInfo.type;
        highlightSynthesizableCards(s.card, s.dragInfo.type);
    }

    if (s.hasStartedDrag && state.pointerDrag.ghostElement) {
        const g = state.pointerDrag.ghostElement;
        g.style.left = `${e.clientX - state.pointerDrag.offsetX}px`;
        g.style.top = `${e.clientY - state.pointerDrag.offsetY}px`;

        const target = document.elementFromPoint(e.clientX, e.clientY);
        updateDropzoneHighlight(target);
    }
});

window.addEventListener('pointerup', (e) => endCurrentDrag(e, true));
window.addEventListener('pointercancel', (e) => endCurrentDrag(e, false));

window.addEventListener('blur', () => {
    if (activeDragSession) {
        endCurrentDrag({ clientX: 0, clientY: 0 }, false);
    }
});

function initPointerDrag(cardElement, card, dragInfo, onContextMenu) {
    let longTapTimer = null;

    const clearTap = () => {
        if (longTapTimer) {
            clearTimeout(longTapTimer);
            longTapTimer = null;
        }
    };

    cardElement.addEventListener('pointerdown', (e) => {
        if (e.isPrimary === false) return;
        if (e.button !== 0) return;
        if (cardElement.dataset.nonDraggable === 'true') return;

        if (activeDragSession) {
            endCurrentDrag(e, false);
        }

        clearTap();

        if (e.pointerType === 'touch' && onContextMenu) {
            longTapTimer = setTimeout(() => {
                lastTouchLongTapTimestamp = Date.now();
                onContextMenu();
                if (navigator.vibrate) navigator.vibrate(30);
                longTapTimer = null;
            }, 480);
        }

        activeDragSession = {
            startX: e.clientX,
            startY: e.clientY,
            hasStartedDrag: false,
            sourceElement: cardElement,
            card,
            dragInfo,
            clearTapTimer: clearTap
        };
    });

    cardElement.addEventListener('pointermove', (e) => {
        if (Math.hypot(e.clientX - (activeDragSession?.startX || 0), e.clientY - (activeDragSession?.startY || 0)) > 5) {
            clearTap();
        }
    });

    cardElement.addEventListener('pointerup', clearTap);
    cardElement.addEventListener('pointercancel', clearTap);
}

/**
 * カードDOM生成
 */
export function createCardElement(card, options = {}) {
    const div = document.createElement('div');
    div.className = `card-item rarity-${card.rarity}`;
    div.dataset.cardUid = card.uid;
    if (options.nonDraggable) div.dataset.nonDraggable = 'true';
    div.__cardData = card;

    if (activeFlightUids.has(card.uid)) {
        div.style.opacity = '0';
    }

    let costHtml = '';
    if (options.isShop) {
        costHtml = `<span class="card-cost">${card.cost}G</span>`;
    } else if (options.isMarket) {
        const baseCost = RARITY_COSTS[card.rarity] || card.cost || 2;
        const stars = card.starCount || 1;
        const marketPrice = Math.floor((baseCost * stars) / 2);
        costHtml = `<span class="card-cost">${marketPrice}G</span>`;
    }

    const starCount = card.starCount || 1;
    const starBadgeHtml = `<span class="badge-star" title="★評価">★${starCount}</span>`;

    let kaiBadgeHtml = '';
    if (card.isMarketCard || options.isMarket) {
        const rawSeller = options.sellerName || card.sellerName || '他プレイヤー';
        const seller = escapeHtml(rawSeller);
        kaiBadgeHtml = `
      <span class="badge-market-kai">解
        <div class="kai-balloon">解雇者：${seller}</div>
      </span>
    `;
    }

    let nameClass = 'card-name';
    if (card.name.length >= 26) {
        nameClass += ' name-very-long';
    } else if (card.name.length >= 17) {
        nameClass += ' name-long';
    }

    const shouldApplyBuff = (
        options.area === 'hand' ||
        options.area === 'deploy' ||
        options.area === 'overhand' ||
        options.isMyCombatant ||
        options.isMyResultCard
    );
    const stats = getBuffedStats(card, shouldApplyBuff);

    const hpValClass = stats.isHpBuffed ? 'stat-buffed' : '';
    const atkValClass = stats.isAtkBuffed ? 'stat-buffed' : '';
    const spdValClass = stats.isSpdBuffed ? 'stat-buffed' : '';

    div.innerHTML = `
    <div class="card-row-meta">
      <span class="elem-badge elem-${card.element}">${card.element}</span>
      <span class="card-tribe-name">${card.tribe}</span>
    </div>
    <div class="card-row-stats-head">
      <div class="badge-group-left">
        ${starBadgeHtml}
        ${kaiBadgeHtml}
      </div>
      ${costHtml}
    </div>
    <div class="${nameClass}">${escapeHtml(card.name)}</div>
    <div class="card-stats">
      <span class="stat-hp" title="HP"><span class="stat-icon">❤</span><span class="stat-val ${hpValClass}">${stats.hp}</span></span>
      <span class="stat-atk" title="攻撃"><span class="stat-icon">⚔</span><span class="stat-val ${atkValClass}">${stats.atk}</span></span>
      <span class="stat-spd" title="素早さ"><span class="stat-icon">⚡</span><span class="stat-val ${spdValClass}">${stats.spd}</span></span>
    </div>
  `;

    if (options.isLocked) {
        const lockBadge = document.createElement('div');
        lockBadge.className = 'card-lock-badge';
        lockBadge.textContent = '🔒';
        div.appendChild(lockBadge);
    }

    const sourceArea = options.dragInfo ? options.dragInfo.type : options.area;

    // マウスホバー検知
    div.addEventListener('mouseenter', () => {
        if (!state.pointerDrag.isDragging && sourceArea) {
            currentHoveredCard = card;
            currentHoveredArea = sourceArea;
            highlightSynthesizableCards(card, sourceArea);
        }
    });

    // マウス離脱検知
    div.addEventListener('mouseleave', () => {
        if (!state.pointerDrag.isDragging) {
            if (currentHoveredCard && currentHoveredCard.uid === card.uid) {
                currentHoveredCard = null;
                currentHoveredArea = null;
            }
            clearSynthesizableHighlights();
        }
    });

    if (!options.nonDraggable && options.dragInfo) {
        initPointerDrag(div, card, options.dragInfo, options.onContextMenu);
    }

    if (options.onContextMenu) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (Date.now() - lastTouchLongTapTimestamp < 450) {
                return;
            }
            options.onContextMenu();
        });
    }

    return div;
}

export function updateMarketTabLabel() {
    if (state.currentRound >= 2) {
        dom.tabMarket.removeAttribute('disabled');
        dom.tabMarket.classList.remove('disabled-tab');
        const count = state.currentGameState === 'battle' ? 0 : state.localMarket.length;
        dom.tabMarket.textContent = `解雇市場(${count})`;
    } else {
        dom.tabMarket.setAttribute('disabled', 'true');
        dom.tabMarket.classList.add('disabled-tab');
        dom.tabMarket.textContent = '解雇市場 (R2～)';
    }
}

export function renderShop() {
    dom.shopCardsContainer.innerHTML = '';
    state.localShop.forEach((slot, index) => {
        if (!slot.card) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'shop-soldout-placeholder';
            emptyDiv.style.width = '126px';
            emptyDiv.style.height = '148px';
            emptyDiv.style.display = 'flex';
            emptyDiv.style.alignItems = 'center';
            emptyDiv.style.justifyContent = 'center';
            emptyDiv.style.border = '2px dashed #475569';
            emptyDiv.style.borderRadius = '6px';
            emptyDiv.style.color = '#64748b';
            emptyDiv.style.fontSize = '0.85rem';
            emptyDiv.textContent = '売却済み';
            dom.shopCardsContainer.appendChild(emptyDiv);
            return;
        }

        const cardEl = createCardElement(slot.card, {
            isShop: true,
            isLocked: slot.locked,
            area: 'shop',
            dragInfo: { type: 'shop', shopIndex: index, card: slot.card },
            onContextMenu: () => {
                socket.emit('shop:toggleLock', { shopIndex: index });
            }
        });
        dom.shopCardsContainer.appendChild(cardEl);
    });
}

let renderedMarketUids = '';
export function renderMarketCards() {
    if (state.currentGameState === 'battle') {
        dom.marketCardsContainer.innerHTML = '';
        renderedMarketUids = '';
        return;
    }

    const currentUids = state.localMarket.map(item => item.card.uid).join(',');
    if (currentUids === renderedMarketUids && dom.marketCardsContainer.children.length > 0) {
        return;
    }
    renderedMarketUids = currentUids;

    dom.marketCardsContainer.innerHTML = '';
    state.localMarket.forEach((item) => {
        const cardEl = createCardElement(item.card, {
            isMarket: true,
            sellerName: item.sellerName,
            area: 'market',
            dragInfo: { type: 'market', marketCardUid: item.card.uid, card: item.card }
        });
        dom.marketCardsContainer.appendChild(cardEl);
    });
}

export function renderHand(syncLineupCallback, options = {}) {
    dom.playerHandContainer.innerHTML = '';

    const sortedHand = sortHandCards(state.localHand);
    state.localHand = sortedHand;

    const benchCards = sortedHand.filter(c => !state.localDeploySlots.includes(c.uid));

    benchCards.forEach(card => {
        if (options.hideCardUid && options.hideCardUid === card.uid) return;

        const cardEl = createCardElement(card, {
            area: 'hand',
            dragInfo: { type: 'hand', uid: card.uid },
            onContextMenu: () => {
                if (state.localDeploySlots.includes(card.uid)) return;

                for (let i = 0; i < 3; i++) {
                    if (!state.localDeploySlots[i]) {
                        const startRect = cardEl.getBoundingClientRect();
                        state.localDeploySlots[i] = card.uid;

                        // 移動開始によりマウスオーバーが外れるためホバー状態と強調を一旦クリア
                        currentHoveredCard = null;
                        currentHoveredArea = null;
                        clearSynthesizableHighlights();

                        renderHand(syncLineupCallback);
                        renderDeploySlots(syncLineupCallback);
                        if (syncLineupCallback) syncLineupCallback();

                        const targetZone = dom.deployDropzones[i].querySelector('.card-item');
                        if (targetZone) {
                            animateCardFlight(startRect, targetZone, card);
                        }
                        break;
                    }
                }
            }
        });

        dom.playerHandContainer.appendChild(cardEl);
    });
}

export function renderDeploySlots(syncLineupCallback) {
    dom.deployDropzones.forEach((zone, index) => {
        zone.innerHTML = '';
        const uid = state.localDeploySlots[index];
        if (uid) {
            const card = state.localHand.find(c => c && c.uid === uid);
            if (card) {
                const cardEl = createCardElement(card, {
                    area: 'deploy',
                    dragInfo: { type: 'deploy', slotIndex: index, uid: card.uid },
                    onContextMenu: () => {
                        const startRect = cardEl.getBoundingClientRect();
                        state.localDeploySlots[index] = null;

                        // 移動開始によりマウスオーバーが外れるためホバー状態と強調を一旦クリア
                        currentHoveredCard = null;
                        currentHoveredArea = null;
                        clearSynthesizableHighlights();

                        renderHand(syncLineupCallback);
                        renderDeploySlots(syncLineupCallback);
                        if (syncLineupCallback) syncLineupCallback();

                        const targetEl = dom.playerHandContainer.querySelector(`[data-card-uid="${card.uid}"]`);
                        if (targetEl) {
                            animateCardFlight(startRect, targetEl, card);
                        }
                    }
                });
                zone.appendChild(cardEl);
            }
        }
    });
}