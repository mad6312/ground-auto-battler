/**
 * public/js/cardUI.js
 * カードUIコンポーネント生成および表示制御モジュール (完全修正版)
 */

import { state, dom, socket, escapeHtml } from './state.js';

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

        // M5: 浮動小数点丸め誤差のない整数演算四捨五入
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

export function highlightSynthesizableCards(sourceCard, sourceArea) {
    if (!sourceCard) return;
    const allowedAreas = ['shop', 'market', 'deploy', 'hand'];
    if (!allowedAreas.includes(sourceArea)) return;
    if (!dom.modalOverhand.classList.contains('hidden')) return;

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

export function clearSynthesizableHighlights() {
    document.querySelectorAll('.card-synth-highlight').forEach(el => {
        el.classList.remove('card-synth-highlight');
    });
}

/**
 * カード飛翔移動アニメーション (リフロー強制により確実なtransition再生を保証)
 */
export function animateCardFlight(startRect, targetElement, onComplete) {
    if (!startRect || !targetElement) {
        if (onComplete) onComplete();
        return;
    }

    const endRect = targetElement.getBoundingClientRect();
    const ghost = targetElement.cloneNode(true);
    ghost.classList.add('floating-flight-card');

    ghost.style.left = `${startRect.left}px`;
    ghost.style.top = `${startRect.top}px`;
    ghost.style.width = `${startRect.width}px`;
    ghost.style.height = `${startRect.height}px`;
    ghost.style.transform = 'translate(0px, 0px)';
    ghost.style.opacity = '1';

    document.body.appendChild(ghost);
    targetElement.style.opacity = '0';

    // 強制リフロー
    void ghost.offsetHeight;

    const deltaX = endRect.left - startRect.left;
    const deltaY = endRect.top - startRect.top;

    requestAnimationFrame(() => {
        ghost.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

        setTimeout(() => {
            targetElement.style.opacity = '1';
            ghost.remove();
            if (onComplete) onComplete();
        }, 390);
    });
}

// ============================
// 高性能ポインタードラッグシステム (M7: window監視版)
// ============================
let customDropHandler = null;
export function setCustomDropHandler(handler) {
    customDropHandler = handler;
}

let activeDragSession = null;

// window単位でmove / up / cancelを処理し、途中の再描画によるリスナ切断・ゴースト残留を完全排除
window.addEventListener('pointermove', (e) => {
    if (!activeDragSession) return;
    const s = activeDragSession;

    const moveDist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
    if (!s.hasStartedDrag && moveDist > 5) {
        s.hasStartedDrag = true;
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
        highlightSynthesizableCards(s.card, s.dragInfo.type);
    }

    if (s.hasStartedDrag && state.pointerDrag.ghostElement) {
        const g = state.pointerDrag.ghostElement;
        g.style.left = `${e.clientX - state.pointerDrag.offsetX}px`;
        g.style.top = `${e.clientY - state.pointerDrag.offsetY}px`;
    }
});

const endCurrentDrag = (e, isSuccess) => {
    if (!activeDragSession) return;
    const s = activeDragSession;
    activeDragSession = null;

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

    // M7: ドラッグ中に届いていた市場更新があれば即時反映
    if (state.pendingMarketSync) {
        renderMarketCards();
        updateMarketTabLabel();
        state.pendingMarketSync = null;
    }
};

window.addEventListener('pointerup', (e) => endCurrentDrag(e, true));
window.addEventListener('pointercancel', (e) => endCurrentDrag(e, false));

function initPointerDrag(cardElement, card, dragInfo) {
    cardElement.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // 左クリックのみ
        if (cardElement.dataset.nonDraggable === 'true') return;

        activeDragSession = {
            startX: e.clientX,
            startY: e.clientY,
            hasStartedDrag: false,
            sourceElement: cardElement,
            card,
            dragInfo
        };
    });
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

    let costHtml = '';
    if (options.isShop) {
        costHtml = `<span class="card-cost">${card.cost}G</span>`;
    } else if (options.isMarket) {
        const marketPrice = Math.floor(card.totalStats / 10);
        costHtml = `<span class="card-cost">${marketPrice}G</span>`;
    }

    const starCount = card.starCount || 1;
    const starBadgeHtml = `<span class="badge-star" title="★評価">★${starCount}</span>`;

    let kaiBadgeHtml = '';
    if (card.isMarketCard || options.isMarket) {
        const rawSeller = card.sellerName || options.sellerName || '他プレイヤー';
        const seller = escapeHtml(rawSeller); // M10: XSS対策
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

    const shouldApplyBuff = (options.area === 'hand' || options.area === 'deploy' || options.isMyCombatant || options.isMyResultCard);
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
    div.addEventListener('mouseenter', () => {
        if (!state.pointerDrag.isDragging && sourceArea) highlightSynthesizableCards(card, sourceArea);
    });
    div.addEventListener('mouseleave', () => {
        if (!state.pointerDrag.isDragging) clearSynthesizableHighlights();
    });

    if (!options.nonDraggable && options.dragInfo) {
        initPointerDrag(div, card, options.dragInfo);
    }

    if (options.onContextMenu) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            options.onContextMenu();
        });
    }

    return div;
}

export function updateMarketTabLabel() {
    if (state.currentRound >= 2) {
        dom.tabMarket.removeAttribute('disabled');
        dom.tabMarket.classList.remove('disabled-tab');
        dom.tabMarket.textContent = `解雇市場(${state.localMarket.length})`;
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
            emptyDiv.className = 'slot-dropzone';
            emptyDiv.style.width = '126px';
            emptyDiv.style.height = '148px';
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

export function renderMarketCards() {
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
                for (let i = 0; i < 3; i++) {
                    if (!state.localDeploySlots[i]) {
                        const startRect = cardEl.getBoundingClientRect();
                        state.localDeploySlots[i] = card.uid;
                        renderHand(syncLineupCallback);
                        renderDeploySlots(syncLineupCallback);
                        if (syncLineupCallback) syncLineupCallback();

                        const targetZone = dom.deployDropzones[i].querySelector('.card-item');
                        if (targetZone) {
                            animateCardFlight(startRect, targetZone);
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
                        renderHand(syncLineupCallback);
                        renderDeploySlots(syncLineupCallback);
                        if (syncLineupCallback) syncLineupCallback();

                        const targetEl = dom.playerHandContainer.querySelector(`[data-card-uid="${card.uid}"]`);
                        if (targetEl) {
                            animateCardFlight(startRect, targetEl);
                        }
                    }
                });
                zone.appendChild(cardEl);
            }
        }
    });
}