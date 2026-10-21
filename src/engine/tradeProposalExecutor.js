import { createDOMSnapshot } from '../dom/elementFinder.js';
import { delayClick, logToBot } from '../dom/actionExecutor.js';
import { ChatEngine } from '../ui/chatEngine.js';
import { BOARD_TILES } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';

/**
 * TRADE PROPOSAL EXECUTOR
 * 
 * Automates the complete multi-step RichUp.io trade creation UI sequence:
 * 1. Click [+ Create] under Trades panel
 * 2. Select target player from modal list
 * 3. Select our property to offer (left column)
 * 4. Select their property to request (right column)
 * 5. Set cash sweetener if applicable
 * 6. Click [Send trade] button
 * 7. Send friendly negotiation message in chat
 */
export const TradeProposalExecutor = {
    isExecuting: false,
    lastProposedTimes: new Map(), // playerName -> timestamp
    skippedSwaps: new Map(),      // summary -> timestamp

    canProposeToPlayer(playerName) {
        if (!playerName) return false;
        const lastTime = this.lastProposedTimes.get(playerName) || 0;
        return Date.now() - lastTime > 40000; // 40-second cooldown per player
    },

    isSwapSkipped(summary) {
        const lastSkipped = this.skippedSwaps.get(summary) || 0;
        return Date.now() - lastSkipped < 60000; // 60-second cooldown on skipped offers
    },

    recordSkipped(summary) {
        this.skippedSwaps.set(summary, Date.now());
    },

    async executeProposal(swap, onComplete) {
        if (this.isExecuting) return;
        this.isExecuting = true;

        logToBot(`[TRADE CREATOR] Starting automated proposal for ${swap.targetOwner}...`);

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const safetyTimer = setTimeout(() => {
            if (this.isExecuting) {
                logToBot('[TRADE CREATOR] Safety timeout triggered. Closing modal and resetting lock.');
                this.closeTradeModal();
                this.isExecuting = false;
                if (onComplete) onComplete(false);
            }
        }, 12000);

        try {
            // STEP 1: Click [+ Create] under Trades
            const snap1 = createDOMSnapshot();
            const createBtn = snap1.findCreateTradeButton();
            if (!createBtn) {
                logToBot('[TRADE CREATOR] Could not find [+ Create] trade button.');
                return;
            }

            createBtn.click();
            await sleep(600);

            // STEP 2: Wait for player selection modal and click target player
            let playerBtn = null;
            for (let i = 0; i < 6; i++) {
                const snap2 = createDOMSnapshot();
                playerBtn = snap2.findPlayerSelectButton(swap.targetOwner);
                if (playerBtn) break;
                await sleep(350);
            }

            if (!playerBtn) {
                logToBot(`[TRADE CREATOR] Could not find player button for "${swap.targetOwner}".`);
                this.closeTradeModal();
                return;
            }

            playerBtn.click();
            await sleep(700);

            // STEP 3: Wait for 2-column trade configuration window
            const tradeModal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            if (tradeModal) {
                const modalRect = tradeModal.getBoundingClientRect();
                const modalCenter = modalRect.left + modalRect.width / 2;
                const modalCards = Array.from(tradeModal.querySelectorAll('button, div, li, span, p'));
                for (const card of modalCards) {
                    const txt = (card.innerText || '').trim().toLowerCase();
                    if (!txt || txt.length > 35) continue;
                    const r = card.getBoundingClientRect();
                    const isRight = (r.left + r.width / 2) >= modalCenter;
                    for (const t of BOARD_TILES) {
                        if (t.group && (txt === t.name.toLowerCase() || txt.startsWith(t.name.toLowerCase()))) {
                            if (GameMemory.ownership[t.id]) {
                                GameMemory.ownership[t.id].owner = isRight ? swap.targetOwner : (GameMemory.myName || '__ME__');
                            }
                        }
                    }
                }
            }

            const givenTiles = Array.isArray(swap.myGivenTiles) 
                ? swap.myGivenTiles 
                : (swap.myGivenTile ? [swap.myGivenTile] : []);

            for (const tile of givenTiles) {
                const snap3 = createDOMSnapshot();
                const myPropCard = snap3.findTradePropertyCard(tile.name, 'mine');
                if (myPropCard) {
                    myPropCard.click();
                    logToBot(`[TRADE CREATOR] Selected offer property: ${tile.name}`);
                    await sleep(350);
                } else {
                    logToBot(`[TRADE CREATOR] Could not find offer property: ${tile.name}`);
                }
            }

            // Select their property to request (right column - supports multi-property swaps)
            const receivedTiles = Array.isArray(swap.myReceivedTiles)
                ? swap.myReceivedTiles
                : (swap.myReceivedTile ? [swap.myReceivedTile] : []);

            let allRequestedFound = true;
            for (const tile of receivedTiles) {
                const snap4 = createDOMSnapshot();
                const theirPropCard = snap4.findTradePropertyCard(tile.name, 'theirs');
                if (theirPropCard) {
                    theirPropCard.click();
                    logToBot(`[TRADE CREATOR] Selected request property: ${tile.name}`);
                    if (GameMemory.ownership[tile.id]) GameMemory.ownership[tile.id].owner = swap.targetOwner;
                    await sleep(350);
                } else {
                    logToBot(`[TRADE CREATOR] ${swap.targetOwner} does not hold ${tile.name}. Closing modal.`);
                    allRequestedFound = false;
                    break;
                }
            }

            if (!allRequestedFound) {
                this.closeTradeModal();
                if (onComplete) onComplete(false);
                return;
            }

            // STEP 4: Set cash if applicable (via range sliders)
            this.adjustCashInTradeModal(swap);
            await sleep(400);

            // STEP 5: Click "Send trade"
            const snap5 = createDOMSnapshot();
            const sendBtn = snap5.findSendTradeButton();

            if (sendBtn) {
                sendBtn.click();
                logToBot(`[TRADE CREATOR] Trade proposal sent to ${swap.targetOwner}!`);
                this.lastProposedTimes.set(swap.targetOwner, Date.now());
                this.lastSentProposal = {
                    targetOwner: swap.targetOwner,
                    givenTiles,
                    receivedTiles,
                    cashOffer: swap.cashOffer || 0,
                    cashDemand: swap.cashDemand || 0,
                    timestamp: Date.now()
                };

                // STEP 6: Send friendly chat line (only if chat is enabled)
                if (CONFIG.CHAT_ENABLED && swap.pitch) {
                    await sleep(400);
                    ChatEngine.sendChatMessage('tradeOffer', swap.pitch);
                }

                if (onComplete) onComplete(true);
            } else {
                logToBot('[TRADE CREATOR] Could not find [Send trade] button.');
                this.closeTradeModal();
                if (onComplete) onComplete(false);
            }
        } catch (err) {
            logToBot(`[TRADE CREATOR Error] ${err}`);
            this.closeTradeModal();
            if (onComplete) onComplete(false);
        } finally {
            clearTimeout(safetyTimer);
            this.isExecuting = false;
        }
    },

    adjustCashInTradeModal(swap) {
        try {
            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            if (!modal) return;

            const modalRect = modal.getBoundingClientRect();
            const modalCenter = modalRect.left + modalRect.width / 2;

            const inputs = Array.from(modal.querySelectorAll('input[type="range"], input[type="number"], input'));
            let ourSlider = null;
            let theirSlider = null;

            for (const input of inputs) {
                const rect = input.getBoundingClientRect();
                const center = rect.left + rect.width / 2;
                if (center < modalCenter && !ourSlider) ourSlider = input;
                else if (center >= modalCenter && !theirSlider) theirSlider = input;
            }

            if (swap.cashOffer > 0 && ourSlider) {
                this.setReactInputValue(ourSlider, swap.cashOffer);
            }
            if (swap.cashDemand > 0 && theirSlider) {
                this.setReactInputValue(theirSlider, swap.cashDemand);
            }

            // Fallback for custom button steppers (+ / - or +$10)
            if (!ourSlider && !theirSlider) {
                const buttons = Array.from(modal.querySelectorAll('button, [role="button"], span, div')).filter(el => {
                    const t = (el.innerText || '').trim();
                    return t === '+' || t === '+10' || t === '+$10' || t.includes('+') || t.includes('add');
                });
                for (const btn of buttons) {
                    const rect = btn.getBoundingClientRect();
                    const center = rect.left + rect.width / 2;
                    if (swap.cashOffer > 0 && center < modalCenter) {
                        const clicks = Math.min(10, Math.max(1, Math.round(swap.cashOffer / 20)));
                        for (let c = 0; c < clicks; c++) {
                            try { btn.click(); } catch (_) {}
                        }
                    } else if (swap.cashDemand > 0 && center >= modalCenter) {
                        const clicks = Math.min(10, Math.max(1, Math.round(swap.cashDemand / 20)));
                        for (let c = 0; c < clicks; c++) {
                            try { btn.click(); } catch (_) {}
                        }
                    }
                }
            }
        } catch (err) {
            logToBot(`Cash adjust note: ${err}`);
        }
    },

    setReactInputValue(input, val) {
        try {
            const maxVal = input.max ? Number(input.max) : 99999;
            const minVal = input.min ? Number(input.min) : 0;
            const clamped = Math.max(minVal, Math.min(Number(val), maxVal));

            input.focus();
            const prev = input.value;
            input.value = String(clamped);

            if (input._valueTracker) {
                input._valueTracker.setValue(prev);
            }

            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            )?.set || (typeof unsafeWindow !== 'undefined' && Object.getOwnPropertyDescriptor(
                unsafeWindow.HTMLInputElement.prototype, 'value'
            )?.set);

            if (nativeSetter) {
                nativeSetter.call(input, String(clamped));
            }

            input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        } catch (_) {}
    },

    closeTradeModal() {
        try {
            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            if (!modal) return;
            const elements = Array.from(modal.querySelectorAll('button, [role="button"], span, div, svg'));
            const closeBtn = elements.find(b => {
                const t = (b.innerText || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const title = (b.getAttribute('title') || '').toLowerCase();
                const cls = (b.className?.baseVal || b.className || '').toString().toLowerCase();
                return t === '✕' || t === 'x' || t === 'cancel' || t === 'close' || 
                       aria.includes('close') || aria.includes('cancel') ||
                       title.includes('close') || title.includes('cancel') ||
                       cls.includes('close') || cls.includes('cancel');
            });
            if (closeBtn) {
                closeBtn.click();
            }
        } catch (_) {}
    }
};
