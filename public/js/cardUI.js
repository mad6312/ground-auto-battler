/**
 * public/js/cardUI.js
 * カードUIコンポーネント生成および表示制御モジュール
 * (無限読み込み安全遮断・枠線クリップ根絶・高画質レンダリング・日英2行表示完全版)
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

// 高品質属性シンボルマーク (インラインSVG)
export const ELEMENT_ICONS = {
    '火': `<svg viewBox="0 0 24 24"><path d="M12 2C9.5 6 6 8.5 6 13a6 6 0 0 0 12 0c0-4-3-6.5-6-11zm0 15a3 3 0 0 1-3-3c0-1.8 1.5-3 3-5 1.5 2 3 3.2 3 5a3 3 0 0 1-3 3z"/></svg>`,
    '氷': `<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    '風': `<svg viewBox="0 0 24 24"><path d="M4 8h11a3 3 0 1 0-3-3M2 13h15a3 3 0 1 1-3 3M6 18h8a2 2 0 1 0-2-2" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`,
    '雷': `<svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-2 8 11-13h-7l2-7z"/></svg>`,
    '水': `<svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
    '地': `<svg viewBox="0 0 24 24"><path d="M12 3l9 6-3 12H6L3 9zm0 4.5L6.5 10l1.8 7.5h7.4l1.8-7.5z"/></svg>`
};

const activeFlightCounts = new Map();
let currentHoveredCard = null;
let currentHoveredArea = null;

/**
 * カード名（"日本語名 (英語名)"）を日本語と英語（括弧なし）に分離する
 */
export function splitCardName(fullName) {
    if (!fullName) return { ja: '', en: '' };
    const match = fullName.match(/^(.*?)(?:\s*\((.*?)\))?$/);
    if (match) {
        return {
            ja: (match[1] || '').trim(),
            en: (match[2] || '').trim()
        };
    }
    return { ja: fullName.trim(), en: '' };
}

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

export function highlightSynthesizableCards(sourceCard, sourceArea) {
    if (!sourceCard) return;
    const allowedAreas = ['shop', 'market', 'deploy', 'hand'];
    if (!allowedAreas.includes(sourceArea)) return;
    if (!dom.modalOverhand.classList.contains('hidden')) return;

    const validContainersSelector = '#player-hand .card-item, #shop-cards .card-item, #market-cards .card-item, .slots-container .card-item, .floating-flight-card';
    const targetCardElements = document.querySelectorAll(validContainersSelector);

    targetCardElements.forEach(el => {
        const cardData = el.__cardData;
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
    currentHoveredCard = null;
    currentHoveredArea = null;
    document.querySelectorAll('.card-synth-highlight').forEach(el => {
        el.classList.remove('card-synth-highlight');
    });
}

export function animateCardFlight(startRect, targetElement, cardOrUid = null, onComplete = null) {
    if (!startRect || !targetElement) {
        if (onComplete) onComplete();
        return;
    }

    let cardObj = null;
    let cardUid = null;

    if (cardOrUid) {
        if (typeof cardOrUid === 'object') {
            cardObj = cardOrUid;
            cardUid = cardOrUid.uid;
        } else if (typeof cardOrUid === 'string') {
            cardUid = cardOrUid;
            cardObj = state.localHand.find(c => c && c.uid === cardUid) || null;
        }
    }

    if (cardUid) {
        activeFlightCounts.set(cardUid, (activeFlightCounts.get(cardUid) || 0) + 1);
    }

    const endRect = targetElement.getBoundingClientRect();
    const ghost = targetElement.cloneNode(true);
    ghost.classList.add('floating-flight-card');
    ghost.classList.remove('card-synth-highlight');
    ghost.classList.remove('card-synth-success');

    if (cardObj) {
        ghost.__cardData = cardObj;
    }

    if (currentHoveredCard && currentHoveredArea && cardObj) {
        if (cardObj.uid !== currentHoveredCard.uid &&
            cardObj.rarity === currentHoveredCard.rarity && cardObj.tribe === currentHoveredCard.tribe) {
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
            const currentCount = activeFlightCounts.get(cardUid) || 1;
            if (currentCount <= 1) {
                activeFlightCounts.delete(cardUid);
                const currentTarget = document.querySelector(`[data-card-uid="${cardUid}"]`);
                if (currentTarget) {
                    currentTarget.style.opacity = '1';
                    if (currentHoveredCard && currentHoveredArea) {
                        highlightSynthesizableCards(currentHoveredCard, currentHoveredArea);
                    }
                }
            } else {
                activeFlightCounts.set(cardUid, currentCount - 1);
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

    const zone = dropTarget.closest('.deploy-slot .slot-dropzone, #discard-dropzone, .discard-box');
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

        s.sourceElement.classList.remove('card-synth-success');

        const rect = s.sourceElement.getBoundingClientRect();

        const ghost = s.sourceElement.cloneNode(true);
        ghost.classList.add('custom-drag-ghost');
        ghost.classList.remove('card-synth-success');
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
    let isTouchActive = false;

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

        // 要望5: イラスト部分も含め、すべての領域で通常どおりカードUIカスタムドラッグを発火させる
        if (activeDragSession) {
            endCurrentDrag(e, false);
        }

        clearTap();

        if (e.pointerType === 'touch') {
            isTouchActive = true;
            if (onContextMenu) {
                longTapTimer = setTimeout(() => {
                    onContextMenu();
                    if (navigator.vibrate) navigator.vibrate(30);
                    longTapTimer = null;
                }, 480);
            }
        } else {
            isTouchActive = false;
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

    if (onContextMenu) {
        cardElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (isTouchActive || e.pointerType === 'touch') {
                return;
            }
            onContextMenu();
        });
    }
}

/**
 * カードDOM生成 (高精細レンダリング・安全フォールバック対応・日英2行表示)
 */
export function createCardElement(card, options = {}) {
    const div = document.createElement('div');
    div.className = `card-item rarity-${card.rarity}`;
    div.dataset.cardUid = card.uid;
    if (options.nonDraggable) div.dataset.nonDraggable = 'true';
    div.__cardData = card;

    if (activeFlightCounts.has(card.uid)) {
        div.style.opacity = '0';
    }

    const elemSvg = ELEMENT_ICONS[card.element] || '';
    const starCount = card.starCount || 1;
    const starOverlayHtml = `<span class="badge-star-pill" title="★評価">★${starCount}</span>`;

    let kaiOverlayHtml = '';
    if (card.isMarketCard || options.isMarket) {
        const rawSeller = options.sellerName || card.sellerName || '他プレイヤー';
        const seller = escapeHtml(rawSeller);
        kaiOverlayHtml = `
      <span class="badge-kai-pill">解
        <div class="kai-balloon">解雇者：${seller}</div>
      </span>
    `;
    }

    const artId = card.masterId || card.uid || card.id || 'default';
    const primarySrc = `/images/cards/${artId}.webp`;
    const fallbackSrc = `/assets/cards/${artId}.webp`;

    let tribeClass = 'card-race-title';
    if (card.tribe.length >= 6) {
        tribeClass += ' race-very-long';
    } else if (card.tribe.length >= 4) {
        tribeClass += ' race-long';
    }

    // 要望6: 日本語・英語表記の分離パース
    const nameParts = splitCardName(card.name);
    let nameClass = '';
    if (nameParts.ja.length >= 14 || nameParts.en.length >= 26) {
        nameClass = 'name-very-long';
    } else if (nameParts.ja.length >= 9 || nameParts.en.length >= 18) {
        nameClass = 'name-long';
    }

    const shouldApplyBuff = (
        options.area === 'hand' ||
        options.area === 'deploy' ||
        options.area === 'overhand' ||
        options.isMyCombatant ||
        options.isMyResultCard
    );
    const stats = getBuffedStats(card, shouldApplyBuff);

    const hpBuffClass = stats.isHpBuffed ? 'stat-buffed' : '';
    const atkBuffClass = stats.isAtkBuffed ? 'stat-buffed' : '';
    const spdBuffClass = stats.isSpdBuffed ? 'stat-buffed' : '';

    div.innerHTML = `
    <!-- ① 最上部ヘッダー：属性丸アイコン ＆ 中央揃え種族名 -->
    <div class="card-header-bar">
      <div class="card-elem-badge elem-${card.element}" title="属性: ${card.element}">
        ${elemSvg}
      </div>
      <div class="${tribeClass}">${card.tribe}</div>
    </div>

    <!-- ② イラスト領域（要望5: ブラウザ標準の画像ドラッグを完全阻止） -->
    <div class="card-art-container">
      <img class="card-art-image" src="${primarySrc}" alt="${escapeHtml(nameParts.ja)}"
           draggable="false" ondragstart="return false;"
           onerror="if(!this.dataset.triedFallback){ this.dataset.triedFallback='true'; this.src='${fallbackSrc}'; } else { this.onerror=null; this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex'; }" />
      <div class="card-art-fallback" style="display: none;">
        ${elemSvg}
      </div>
      <div class="card-art-overlay">
        ${starOverlayHtml}
        ${kaiOverlayHtml}
      </div>
    </div>

    <!-- ③ カード名プレート (要望6: 1行目日本語・2行目英語・文字サイズ比率2:1・中央揃え) -->
    <div class="card-name-bar ${nameClass}">
      <span class="card-name-ja">${escapeHtml(nameParts.ja)}</span>
      ${nameParts.en ? `<span class="card-name-en">${escapeHtml(nameParts.en)}</span>` : ''}
    </div>

    <!-- ④ 最下部スタッツバー (❤ ⚔ ⚡：数値のみ緑色) -->
    <div class="card-stats-footer">
      <div class="stat-unit hp" title="HP">
        <span class="icon">❤</span><span class="val ${hpBuffClass}">${stats.hp}</span>
      </div>
      <div class="stat-unit atk" title="攻撃力">
        <span class="icon">⚔</span><span class="val ${atkBuffClass}">${stats.atk}</span>
      </div>
      <div class="stat-unit spd" title="素早さ">
        <span class="icon">⚡</span><span class="val ${spdBuffClass}">${stats.spd}</span>
      </div>
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
        if (!state.pointerDrag.isDragging && sourceArea) {
            currentHoveredCard = card;
            currentHoveredArea = sourceArea;
            highlightSynthesizableCards(card, sourceArea);
        }
    });

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
        const slotWrapper = document.createElement('div');
        slotWrapper.className = 'market-item-slot';

        if (!slot.card) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-shop-slot';
            emptyDiv.textContent = '売却済み';
            slotWrapper.appendChild(emptyDiv);

            const emptyCost = document.createElement('div');
            emptyCost.className = 'card-below-cost-empty';
            slotWrapper.appendChild(emptyCost);

            dom.shopCardsContainer.appendChild(slotWrapper);
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
        slotWrapper.appendChild(cardEl);

        // カード直下（外側）に中央揃えで配置される価格ラベル
        const costLabel = document.createElement('div');
        costLabel.className = 'card-below-cost';
        costLabel.innerHTML = `<span class="gold-coin-symbol">🟡</span> ${slot.card.cost}G`;
        slotWrapper.appendChild(costLabel);

        dom.shopCardsContainer.appendChild(slotWrapper);
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
        const slotWrapper = document.createElement('div');
        slotWrapper.className = 'market-item-slot';

        const cardEl = createCardElement(item.card, {
            isMarket: true,
            sellerName: item.sellerName,
            area: 'market',
            dragInfo: { type: 'market', marketCardUid: item.card.uid, card: item.card }
        });
        slotWrapper.appendChild(cardEl);

        // マスター仕様に従った解雇市場購入価格計算式: floor(通常価格 * ★ / 2)
        const baseCost = RARITY_COSTS[item.card.rarity] || item.card.cost || 2;
        const stars = item.card.starCount || 1;
        const marketPrice = Math.floor((baseCost * stars) / 2);

        // カード直下（外側）に中央揃えで配置される価格ラベル
        const costLabel = document.createElement('div');
        costLabel.className = 'card-below-cost';
        costLabel.innerHTML = `<span class="gold-coin-symbol">🟡</span> ${marketPrice}G`;
        slotWrapper.appendChild(costLabel);

        dom.marketCardsContainer.appendChild(slotWrapper);
    });
}

/**
 * 手札エリアのレンダリング (視認性重視の水平並び展開)
 */
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

/**
 * 繰り出しUIスロットのレンダリング
 */
export function renderDeploySlots(syncLineupCallback) {
    dom.deployDropzones.forEach((zone, index) => {
        zone.innerHTML = '';
        const uid = state.localDeploySlots[index];
        if (uid) {
            const card = state.localHand.find(c => c && c.uid === uid);
            if (card) {
                zone.classList.add('has-card');
                const cardEl = createCardElement(card, {
                    area: 'deploy',
                    dragInfo: { type: 'deploy', slotIndex: index, uid: card.uid },
                    onContextMenu: () => {
                        const startRect = cardEl.getBoundingClientRect();
                        state.localDeploySlots[index] = null;

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
            } else {
                zone.classList.remove('has-card');
            }
        } else {
            zone.classList.remove('has-card');
        }
    });
}