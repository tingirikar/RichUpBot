import { logToBot } from '../protocol/actionExecutor.js';
import { sendSocketAction, getPlayerIdByName } from '../protocol/socketHook.js';
import { ChatEngine } from '../ui/chatEngine.js';
import { GameMemory } from '../memory/gameMemory.js';
import { CONFIG } from '../config.js';

/**
 * PURE PROTOCOL TRADE PROPOSAL EXECUTOR (Zero-UI)
 * Sends trades straight to the server over the live WebSocket.
 * No modals are ever rendered or clicked.
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

    cancelPendingTrade() {
        const trId = GameMemory.activeOutgoingTradeId;
        if (trId) {
            logToBot(`[TRADE] 🗑️ Cancelling open outgoing trade offer (ID: ${trId}) to release assets.`);
            sendSocketAction('delete-trade', { tradeId: trId });
            GameMemory.activeOutgoingTradeId = null;
            GameMemory.activeOutgoingTradeTime = 0;
            return true;
        }
        return false;
    },

    cancelStaleProposal() {
        if (GameMemory.activeOutgoingTradeId) {
            const age = Date.now() - (GameMemory.activeOutgoingTradeTime || 0);
            if (age > 35000) { // 35 seconds unresponded
                return this.cancelPendingTrade();
            }
        }
        return false;
    },

    async executeProposal(swap, onComplete) {
        if (this.isExecuting) return;
        this.isExecuting = true;

        logToBot(`[ZERO-UI TRADE] Starting automated proposal for ${swap.targetOwner}...`);

        const targetId = getPlayerIdByName(swap.targetOwner);
        const givenTiles = Array.isArray(swap.myGivenTiles) 
            ? swap.myGivenTiles 
            : (swap.myGivenTile ? [swap.myGivenTile] : []);
        const receivedTiles = Array.isArray(swap.myReceivedTiles)
            ? swap.myReceivedTiles
            : (swap.myReceivedTile ? [swap.myReceivedTile] : []);

        const cashOffer = swap.cashOffer || 0;
        const cashDemand = swap.cashDemand || 0;

        if (targetId !== null && targetId !== undefined && GameMemory.activeSocket?.readyState === 1) {
            const payload = {
                recipientId: targetId,
                initiatorOffer: {
                    money: cashOffer,
                    properties: givenTiles.map(t => t.id)
                },
                recipientOffer: {
                    money: cashDemand,
                    properties: receivedTiles.map(t => t.id)
                },
                note: swap.pitch || ''
            };

            const success = sendSocketAction('create-trade', { trade: payload });
            if (success) {
                logToBot(`[ZERO-UI TRADE] 🤝 Propose trade emitted via WebSocket to ${swap.targetOwner}!`);
                this.lastProposedTimes.set(swap.targetOwner, Date.now());
                this.lastSentProposal = {
                    targetOwner: swap.targetOwner,
                    givenTiles,
                    receivedTiles,
                    cashOffer,
                    cashDemand,
                    timestamp: Date.now()
                };

                if (CONFIG.CHAT_ENABLED && swap.pitch) {
                    setTimeout(() => ChatEngine.sendChatMessage('tradeOffer', swap.pitch), 400);
                }

                this.isExecuting = false;
                if (onComplete) onComplete(true);
                return;
            }
        }

        logToBot(`[ZERO-UI TRADE] Could not emit trade: targetId=${targetId}, wsReady=${GameMemory.activeSocket?.readyState === 1}`);
        this.isExecuting = false;
        if (onComplete) onComplete(false);
    }
};
