import { createDOMSnapshot } from '../dom/elementFinder.js';
import { delayClick, logToBot } from '../dom/actionExecutor.js';
import { ChatEngine } from '../ui/chatEngine.js';

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
            const snap3 = createDOMSnapshot();

            // Select our property to give (left column)
            if (swap.myGivenTile) {
                const myPropCard = snap3.findTradePropertyCard(swap.myGivenTile.name, 'mine');
                if (myPropCard) {
                    myPropCard.click();
                    logToBot(`[TRADE CREATOR] Selected offer property: ${swap.myGivenTile.name}`);
                    await sleep(400);
                } else {
                    logToBot(`[TRADE CREATOR] Could not find offer property: ${swap.myGivenTile.name}`);
                }
            }

            // Select their property to request (right column)
            const snap4 = createDOMSnapshot();
            if (swap.myReceivedTile) {
                const theirPropCard = snap4.findTradePropertyCard(swap.myReceivedTile.name, 'theirs');
                if (theirPropCard) {
                    theirPropCard.click();
                    logToBot(`[TRADE CREATOR] Selected request property: ${swap.myReceivedTile.name}`);
                    await sleep(400);
                } else {
                    logToBot(`[TRADE CREATOR] Could not find request property: ${swap.myReceivedTile.name}`);
                }
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

                // STEP 6: Send friendly chat line
                await sleep(600);
                ChatEngine.sendChatMessage('tradeOffer', swap.pitch);

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

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
    },

    closeTradeModal() {
        const closeBtn = document.querySelector('[role="dialog"] button, [class*="modal" i] button, [class*="close" i], button[aria-label*="close" i]');
        if (closeBtn) {
            closeBtn.click();
        }
    }
};
