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

    executeProposal(swap, onComplete) {
        if (this.isExecuting) return;
        this.isExecuting = true;

        logToBot(`[TRADE CREATOR] Starting automated proposal for ${swap.targetOwner}...`);

        const snapshot = createDOMSnapshot();
        const createBtn = snapshot.findCreateTradeButton();

        if (!createBtn) {
            logToBot('[TRADE CREATOR] Could not find [+ Create] trade button.');
            this.isExecuting = false;
            if (onComplete) onComplete(false);
            return;
        }

        // STEP 1: Click [+ Create] under Trades
        delayClick(createBtn, 'Opening Create Trade dialog');

        // STEP 2: Wait for player selection modal and click target player
        setTimeout(() => {
            const snap2 = createDOMSnapshot();
            const playerBtn = snap2.findPlayerSelectButton(swap.targetOwner);

            if (!playerBtn) {
                logToBot(`[TRADE CREATOR] Could not find player button for "${swap.targetOwner}".`);
                this.closeTradeModal();
                this.isExecuting = false;
                if (onComplete) onComplete(false);
                return;
            }

            delayClick(playerBtn, `Selecting trade partner: ${swap.targetOwner}`);

            // STEP 3: Wait for 2-column trade configuration window
            setTimeout(() => {
                const snap3 = createDOMSnapshot();

                // Select our property to give (if applicable)
                if (swap.myGivenTile) {
                    const myPropCard = snap3.findTradePropertyCard(swap.myGivenTile.name);
                    if (myPropCard) {
                        delayClick(myPropCard, `Selecting offer property: ${swap.myGivenTile.name}`);
                    } else {
                        logToBot(`[TRADE CREATOR] Could not find offer property: ${swap.myGivenTile.name}`);
                    }
                }

                // Select their property to request
                setTimeout(() => {
                    const snap4 = createDOMSnapshot();
                    if (swap.myReceivedTile) {
                        const theirPropCard = snap4.findTradePropertyCard(swap.myReceivedTile.name);
                        if (theirPropCard) {
                            delayClick(theirPropCard, `Selecting request property: ${swap.myReceivedTile.name}`);
                        } else {
                            logToBot(`[TRADE CREATOR] Could not find request property: ${swap.myReceivedTile.name}`);
                        }
                    }

                    // STEP 4: Set cash if applicable
                    this.adjustCashInTradeModal(swap);

                    // STEP 5: Click "Send trade"
                    setTimeout(() => {
                        const snap5 = createDOMSnapshot();
                        const sendBtn = snap5.findSendTradeButton();

                        if (sendBtn) {
                            delayClick(sendBtn, `Submitting trade proposal to ${swap.targetOwner}`);
                            this.lastProposedTimes.set(swap.targetOwner, Date.now());

                            // STEP 6: Send friendly chat line
                            setTimeout(() => {
                                ChatEngine.sendChatMessage('tradeOffer', swap.pitch);
                            }, 500);

                            this.isExecuting = false;
                            if (onComplete) onComplete(true);
                        } else {
                            logToBot('[TRADE CREATOR] Could not find [Send trade] button.');
                            this.closeTradeModal();
                            this.isExecuting = false;
                            if (onComplete) onComplete(false);
                        }
                    }, 400);

                }, 350);

            }, 450);

        }, 380);
    },

    adjustCashInTradeModal(swap) {
        try {
            // Find inputs/sliders in trade modal
            const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="trade"]');
            if (!modal) return;

            const inputs = modal.querySelectorAll('input[type="number"], input[type="range"], input[type="text"]');
            if (inputs.length >= 2) {
                // Input 0 = Our cash offer, Input 1 = Their cash demand
                if (swap.cashOffer > 0 && inputs[0]) {
                    this.setNativeInputValue(inputs[0], swap.cashOffer);
                } else if (swap.cashDemand > 0 && inputs[1]) {
                    this.setNativeInputValue(inputs[1], swap.cashDemand);
                }
            }
        } catch (err) {
            logToBot(`Cash adjust note: ${err}`);
        }
    },

    setNativeInputValue(input, val) {
        try {
            input.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(input, String(val));
            else input.value = String(val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
    },

    closeTradeModal() {
        // Attempt to close modal if stuck
        const closeBtn = document.querySelector('[class*="close" i], button[aria-label*="close" i], button:has(svg)');
        if (closeBtn) {
            closeBtn.click();
        }
    }
};
