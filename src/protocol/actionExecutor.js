import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { GROUP_POWER } from '../data/boardTiles.js';
import { MarkovRisk } from '../engine/markovRisk.js';
import { JailStrategy } from '../engine/jailStrategy.js';
import { AuctionSniper } from '../engine/auctionSniper.js';
import { TradeEngine } from '../engine/tradeEngine.js';
import { TradeProposalExecutor } from '../engine/tradeProposalExecutor.js';
import { HouseBuilder } from '../engine/houseBuilder.js';
import { DebtRecovery } from '../engine/debtRecovery.js';
import { OllamaClient } from '../engine/ollamaClient.js';
import { ChatEngine } from '../ui/chatEngine.js';
import { HUDPanel } from '../ui/hudPanel.js';
import { sendSocketAction, getPlayerIdByName } from './socketHook.js';

let isActing = false;
let isEvaluatingTrade = false;
const processedTradeSignatures = new Map();

export function getIsActing() {
    return isActing;
}

export function setIsActing(val) {
    isActing = Boolean(val);
}

export function logToBot(msg) {
    console.log(`[RichUp AI] ${new Date().toISOString()} - ${msg}`);
    if (window.__richupLogTerminal) {
        window.__richupLogTerminal(msg);
    }
}

/**
 * Pure Protocol Action Dispatcher
 * In AUTO mode: executes the network action immediately.
 * In ADVISOR mode: displays proposal in HUD for human approval.
 */
export function executeOrAdvise({ title, reason, delayMs = 600, onExecute, onSkip }) {
    if (isActing) return false;

    if (CONFIG.ADVISOR_MODE) {
        if (HUDPanel.isProposalActive(title)) {
            return true;
        }

        HUDPanel.showAdvisorProposal(
            title,
            reason,
            () => {
                HUDPanel.hideAdvisorBox();
                if (onExecute) onExecute();
            },
            () => {
                HUDPanel.hideAdvisorBox();
                logToBot(`[ADVISOR] Action skipped by user.`);
                if (onSkip) onSkip();
            }
        );
        return true;
    }

    // Full-Auto: Execute with humanized timing delay
    isActing = true;
    const delay = Math.max(200, delayMs);
    setTimeout(() => { isActing = false; }, delay + 350);

    logToBot(`[PROTOCOL ACTION] ${title} - ${reason}`);
    setTimeout(() => {
        if (onExecute) onExecute();
    }, delay);
    return true;
}

export const ActionExecutor = {
    async handleTrade() {
        if (!CONFIG.AUTO_TRADE_ENABLED || isEvaluatingTrade) return false;

        const incomingTrades = (GameMemory.trades || []).filter(t => 
            t.recipientId === GameMemory.myId || 
            (GameMemory.myName && GameMemory.isMe(t.recipient?.name))
        );

        if (incomingTrades.length === 0) return false;
        const trade = incomingTrades[0];
        const tradeId = trade.id;
        if (!tradeId) return false;

        const now = Date.now();
        if (processedTradeSignatures.has(tradeId) && (now - processedTradeSignatures.get(tradeId) < 15000)) {
            return true;
        }

        isEvaluatingTrade = true;
        processedTradeSignatures.set(tradeId, now);

        try {
            // Reconstruct trade data for AI / minimax evaluation
            const givenTiles = (trade.recipientOffer?.properties || []).map(id => GameMemory.getTile(id)).filter(Boolean);
            const receivedTiles = (trade.initiatorOffer?.properties || []).map(id => GameMemory.getTile(id)).filter(Boolean);
            const givenCash = trade.recipientOffer?.money || 0;
            const receivedCash = trade.initiatorOffer?.money || 0;

            const tradeData = {
                partnerName: trade.initiator?.name || 'Opponent',
                givenTiles,
                givenCash,
                receivedTiles,
                receivedCash
            };

            logToBot(`[PROTOCOL TRADE] Evaluating incoming offer from ${tradeData.partnerName}...`);
            const verdict = await OllamaClient.evaluateTradeWithLLM(tradeData);
            logToBot(`[TRADE VERDICT] ${verdict.reason}`);

            if (verdict.accept) {
                return executeOrAdvise({
                    title: `ACCEPT TRADE #${tradeId.slice(0, 6)}`,
                    reason: verdict.reason,
                    onExecute: () => {
                        if (verdict.chatReply) ChatEngine.sendChatMessage('tradeAccept', verdict.chatReply);
                        sendSocketAction('confirm-trade', { tradeId });
                        GameMemory.trades = (GameMemory.trades || []).filter(t => t.id !== tradeId);
                    }
                });
            } else {
                return executeOrAdvise({
                    title: `DECLINE TRADE #${tradeId.slice(0, 6)}`,
                    reason: verdict.reason,
                    onExecute: () => {
                        if (verdict.chatReply) ChatEngine.sendChatMessage('tradeReject', verdict.chatReply);
                        sendSocketAction('decline-trade', { tradeId });
                        GameMemory.trades = (GameMemory.trades || []).filter(t => t.id !== tradeId);

                        if (verdict.counterSwap && CONFIG.AUTO_TRADE_ENABLED) {
                            setTimeout(() => {
                                if (!TradeProposalExecutor.isExecuting) {
                                    TradeProposalExecutor.executeProposal(verdict.counterSwap);
                                }
                            }, 1200);
                        }
                    }
                });
            }
        } finally {
            isEvaluatingTrade = false;
        }
    },

    insolventTicks: 0,

    handleDebtRecovery() {
        if (!CONFIG.AUTO_MORTGAGE_ENABLED) return false;

        const myPlayerCash = GameMemory.players[GameMemory.myName]?.cash;
        const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt || (typeof myPlayerCash === 'number' && myPlayerCash < 0);
        if (!isDebt) {
            this.insolventTicks = 0;
            return false;
        }

        logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets via protocol...`);

        const targets = DebtRecovery.rankLiquidationTargets();
        const bestTarget = targets.length > 0 ? targets[0] : null;

        if (bestTarget) {
            this.insolventTicks = 0;
            if (bestTarget.canSellHouse) {
                return executeOrAdvise({
                    title: `SELL HOUSE: ${bestTarget.tile.name.toUpperCase()}`,
                    reason: `Negative balance ($${GameMemory.myCash}). Liquidating house to survive.`,
                    onExecute: () => {
                        sendSocketAction('downgrade-city', { blockIndex: bestTarget.tile.id });
                        if (GameMemory.ownership[bestTarget.tile.id]) {
                            GameMemory.ownership[bestTarget.tile.id].houses = Math.max(0, (GameMemory.ownership[bestTarget.tile.id].houses || 1) - 1);
                        }
                    }
                });
            } else {
                return executeOrAdvise({
                    title: `MORTGAGE: ${bestTarget.tile.name.toUpperCase()}`,
                    reason: `Negative balance ($${GameMemory.myCash}). Mortgaging asset to clear debt.`,
                    onExecute: () => {
                        sendSocketAction('mortgage-property', { propertyIndex: bestTarget.tile.id });
                        if (GameMemory.ownership[bestTarget.tile.id]) {
                            GameMemory.ownership[bestTarget.tile.id].mortgaged = true;
                        }
                    }
                });
            }
        }

        // True insolvency: No liquidatable assets remaining
        this.insolventTicks = (this.insolventTicks || 0) + 1;
        if (this.insolventTicks >= 3) {
            return executeOrAdvise({
                title: 'DECLARE BANKRUPTCY',
                reason: `Insolvent balance ($${GameMemory.myCash}) with zero liquidatable assets. Conceding match gracefully.`,
                onExecute: () => {
                    sendSocketAction('do-bankrupt');
                }
            });
        }

        return true; // Must hold turn until debt resolves
    },

    findNativeRollButton() {
        if (typeof document === 'undefined') return null;
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            const isVisible = b.offsetParent !== null && !b.disabled;
            return isVisible && (txt === 'roll the dice' || txt === 'roll again' || txt.includes('roll the dice') || txt.includes('roll again'));
        }) || null;
    },

    findNativeEndTurnButton() {
        if (typeof document === 'undefined') return null;
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            const isVisible = b.offsetParent !== null && !b.disabled;
            return isVisible && (txt === 'end turn' || txt.includes('end turn'));
        }) || null;
    },

    findNativeBuyButton() {
        if (typeof document === 'undefined') return null;
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            const isVisible = b.offsetParent !== null && !b.disabled;
            return isVisible && (txt.includes('buy for') || txt.startsWith('buy'));
        }) || null;
    },

    findNativeAuctionButton() {
        if (typeof document === 'undefined') return null;
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            const isVisible = b.offsetParent !== null && !b.disabled;
            return isVisible && (txt === 'auction' || txt.includes('auction'));
        }) || null;
    },

    handleJail() {
        if (!GameMemory.inJail || !GameMemory.isMyTurn) return false;

        GameMemory.myPos = GameMemory.prisonBlockIndex ?? 10;
        const decision = JailStrategy.shouldPayToLeaveJail(GameMemory.myCash);
        const hasPardon = Boolean(GameMemory.pardonCards?.treasure || GameMemory.pardonCards?.surprise);

        if (decision.exit) {
            if (hasPardon) {
                return executeOrAdvise({
                    title: 'USE PARDON CARD (Get Out of Jail Free)',
                    reason: decision.reason,
                    onExecute: () => {
                        GameMemory.inJail = false;
                        const deck = GameMemory.pardonCards?.treasure ? 'treasure' : 'surprise';
                        sendSocketAction('use-pardon-card', deck);
                    }
                });
            } else if (GameMemory.myCash >= 50) {
                return executeOrAdvise({
                    title: 'PAY $50 JAIL BAIL',
                    reason: decision.reason,
                    onExecute: () => {
                        GameMemory.inJail = false;
                        sendSocketAction('pay-out-of-prison');
                    }
                });
            }
        }

        // Stay safe in cell by attempting to roll doubles
        if (!GameMemory.hasRolled) {
            return executeOrAdvise({
                title: 'ROLL IN JAIL (Safe Stay)',
                reason: 'Rolling dice to stay safe in cell or leave on doubles.',
                onExecute: () => {
                    GameMemory.hasRolled = true;
                    const btn = this.findNativeRollButton();
                    if (btn) {
                        try { btn.click(); } catch (_) {}
                    }
                    sendSocketAction('plz-roll-dices');
                }
            });
        }
        return false;
    },

    handleBuyOrAuction() {
        if (!GameMemory.isMyTurn || !GameMemory.hasRolled) return false;

        // 1. DOM Ground Truth: If the native "Buy for $X" or "Auction" buttons are physically visible on screen,
        // we are 100% standing on an unowned property waiting for a decision!
        const nativeBuy = this.findNativeBuyButton();
        const nativeAuction = this.findNativeAuctionButton();

        if (nativeBuy || nativeAuction) {
            let price = 0;
            if (nativeBuy) {
                const match = nativeBuy.textContent.match(/\$(\d+)/);
                if (match) price = parseInt(match[1], 10);
            }
            if (!price) {
                const tile = GameMemory.getTile(GameMemory.myPos);
                price = tile?.price || 100;
            }

            const tile = GameMemory.getTile(GameMemory.myPos) || { name: 'Property', price, group: 'Special' };
            const decision = MarkovRisk.shouldBuyProperty(tile, price, GameMemory.myCash);

            if (decision.buy && GameMemory.myCash >= price && nativeBuy) {
                return executeOrAdvise({
                    title: `BUY ${tile.name.toUpperCase()} (DOM Verified $${price})`,
                    reason: decision.reason,
                    delayMs: 800,
                    onExecute: () => {
                        try { nativeBuy.click(); } catch (_) {}
                        sendSocketAction('purchase-property', {});
                        if (GameMemory.ownership[GameMemory.myPos]) {
                            GameMemory.ownership[GameMemory.myPos].owner = GameMemory.myName || '__ME__';
                        }
                        GameMemory.myCash -= price;
                    }
                });
            } else if (nativeAuction) {
                return executeOrAdvise({
                    title: `PASS / AUCTION ${tile.name.toUpperCase()} (DOM Verified)`,
                    reason: decision.reason || 'Sending to auction to conserve cash reserve',
                    delayMs: 800,
                    onExecute: () => {
                        try { nativeAuction.click(); } catch (_) {}
                        sendSocketAction('start-auction', {});
                    }
                });
            }
        }

        // 2. Pure Protocol Fallback
        const tile = GameMemory.getTile(GameMemory.myPos);
        const isPurchasable = tile && tile.group && (tile.type === 'property' || tile.type === 'airport' || tile.type === 'utility');
        const isUnowned = isPurchasable && !GameMemory.ownership[tile.id]?.owner;

        if (!isUnowned) return false;

        const price = tile.price || 60;
        const decision = MarkovRisk.shouldBuyProperty(tile, price, GameMemory.myCash);

        logToBot(`[BUY EVAL] ${tile.name} ($${price}) | Cash: $${GameMemory.myCash} | Decision: ${decision.buy ? 'BUY' : 'AUCTION'} (${decision.reason})`);

        if (decision.buy && GameMemory.myCash >= price) {
            return executeOrAdvise({
                title: `BUY ${tile.name.toUpperCase()} ($${price})`,
                reason: decision.reason,
                delayMs: 800,
                onExecute: () => {
                    sendSocketAction('purchase-property', {});
                    if (GameMemory.ownership[tile.id]) {
                        GameMemory.ownership[tile.id].owner = GameMemory.myName || '__ME__';
                    }
                    GameMemory.myCash -= price;
                }
            });
        } else {
            return executeOrAdvise({
                title: `PASS / AUCTION ${tile.name.toUpperCase()}`,
                reason: decision.reason || 'Sending to auction to conserve cash reserve',
                delayMs: 800,
                onExecute: () => {
                    sendSocketAction('start-auction', {});
                }
            });
        }
    },

    handleRollDice() {
        // 1. DOM Ground Truth Fallback: If native purple "Roll the dice" button is physically visible,
        // it is 100% our turn to roll!
        const nativeBtn = this.findNativeRollButton();
        if (nativeBtn && !GameMemory.hasRolled && !GameMemory.inJail) {
            GameMemory.isMyTurn = true;
            return executeOrAdvise({
                title: `ROLL THE DICE (DOM Verified)`,
                reason: `Native roll button is active on screen. Executing roll.`,
                delayMs: 900,
                onExecute: () => {
                    GameMemory.hasRolled = true;
                    try { nativeBtn.click(); } catch (_) {}
                    sendSocketAction('plz-roll-dices', {});
                }
            });
        }

        if (!GameMemory.isMyTurn || GameMemory.hasRolled || GameMemory.inJail) return false;

        // Guard: Don't roll if standing on unowned property (must buy or auction first)
        if (this.findNativeBuyButton() || this.findNativeAuctionButton()) {
            if (this.handleBuyOrAuction()) return true;
        }

        const isRollAgain = Boolean(GameMemory.doublesInARow && GameMemory.doublesInARow > 0);
        return executeOrAdvise({
            title: isRollAgain ? `ROLL AGAIN (Doubles! Roll #${GameMemory.doublesInARow + 1})` : `ROLL THE DICE (Turn #${GameMemory.turnCount + 1})`,
            reason: isRollAgain ? `Doubles rolled! Extra roll granted.` : `My turn! Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`,
            delayMs: 900,
            onExecute: () => {
                GameMemory.hasRolled = true;
                if (!isRollAgain) {
                    GameMemory.turnCount++;
                }
                const btn = this.findNativeRollButton();
                if (btn) {
                    try { btn.click(); } catch (_) {}
                }
                sendSocketAction('plz-roll-dices', {});
            }
        });
    },

    handleAuction() {
        if (!CONFIG.AUTO_AUCTION_ENABLED || !GameMemory.activeAuction) return false;

        const auction = GameMemory.activeAuction;
        const auctionedTile = GameMemory.getTile(auction.blockIndex) || null;
        const currentBid = auction.currentBid || auction.price || 0;

        const decision = AuctionSniper.evaluateAuctionStep(auctionedTile, currentBid, GameMemory.myCash);

        if (decision.shouldBid) {
            const newBid = currentBid + decision.increment;
            if (GameMemory.myCash >= newBid) {
                return executeOrAdvise({
                    title: `AUCTION BID: $${newBid} [${auctionedTile ? auctionedTile.name : 'Tile'}]`,
                    reason: decision.reason,
                    onExecute: () => {
                        sendSocketAction('auction-bid', { amount: newBid });
                    }
                });
            }
        }
        return false;
    },

    async handleHouseBuilding() {
        if (!CONFIG.AUTO_BUILD_ENABLED || !GameMemory.isMyTurn || !GameMemory.hasRolled) return false;

        const completeSets = [];
        const groupTilesMap = GameMemory.getGroupTiles();
        for (const [groupName, tiles] of Object.entries(groupTilesMap)) {
            if (!tiles || !tiles[0] || tiles[0].type !== 'property') continue;
            const { owned, total } = GameMemory.getGroupCount(groupName, '__ME__');
            if (owned === total) {
                const unmortgaged = tiles.every(t => !GameMemory.ownership[t.id]?.mortgaged);
                if (unmortgaged) {
                    const houseCounts = tiles.map(t => GameMemory.ownership[t.id]?.houses || 0);
                    const minHouses = Math.min(...houseCounts);
                    if (minHouses < 5) {
                        completeSets.push({
                            groupName,
                            tiles,
                            minHouses,
                            houseCost: tiles[0].houseCost
                        });
                    }
                }
            }
        }
        if (completeSets.length === 0) return false;

        const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
        const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);

        // Filter completeSets we can afford
        const affordableSets = completeSets.filter(s => GameMemory.myCash - s.houseCost >= reserve);
        if (affordableSets.length === 0) return false;

        // Choose set with highest GROUP_POWER
        affordableSets.sort((a, b) => (GROUP_POWER[b.groupName] || 0) - (GROUP_POWER[a.groupName] || 0));
        const targetSet = affordableSets[0];
        const candidateTile = targetSet.tiles.find(t => (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);

        if (candidateTile) {
            return executeOrAdvise({
                title: `UPGRADE ${candidateTile.name.toUpperCase()} (HOUSE #${targetSet.minHouses + 1})`,
                reason: `Monopoly upgrade on ${targetSet.groupName}. Cash ($${GameMemory.myCash}) > Reserve ($${reserve}).`,
                onExecute: () => {
                    sendSocketAction('upgrade-city', { blockIndex: candidateTile.id });
                    if (GameMemory.ownership[candidateTile.id]) {
                        GameMemory.ownership[candidateTile.id].houses = targetSet.minHouses + 1;
                    }
                    GameMemory.myCash -= targetSet.houseCost;
                }
            });
        }
        return false;
    },

    handleUnmortgage() {
        if (!CONFIG.AUTO_MORTGAGE_ENABLED || !GameMemory.isMyTurn || !GameMemory.hasRolled) return false;

        const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
        const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);
        const candidates = DebtRecovery.rankUnmortgageCandidates(GameMemory.myCash, reserve);

        if (candidates.length === 0) return false;
        const target = candidates[0];

        return executeOrAdvise({
            title: `UNMORTGAGE ${target.tile.name.toUpperCase()}`,
            reason: `Surplus funds available ($${GameMemory.myCash} > $${reserve + 200}). Restoring asset.`,
            onExecute: () => {
                sendSocketAction('lift-property-mortgage', { propertyIndex: target.tile.id });
                if (GameMemory.ownership[target.tile.id]) {
                    GameMemory.ownership[target.tile.id].mortgaged = false;
                }
            }
        });
    },

    handleProactiveTrade() {
        if (!CONFIG.AUTO_TRADE_ENABLED || !GameMemory.isMyTurn || TradeProposalExecutor.isExecuting) return false;

        const swaps = TradeEngine.scanMutualMonopolySwaps();
        if (swaps.length === 0) return false;

        const validSwap = swaps.find(s => 
            TradeProposalExecutor.canProposeToPlayer(s.targetOwner) && 
            !TradeProposalExecutor.isSwapSkipped(s.summary)
        );

        if (!validSwap) return false;
        const cashText = validSwap.cashDemand > 0 ? ` (+ ask $${validSwap.cashDemand})` : (validSwap.cashOffer > 0 ? ` (+ offer $${validSwap.cashOffer})` : '');

        return executeOrAdvise({
            title: `PROPOSE TRADE: ${validSwap.targetOwner.toUpperCase()}`,
            reason: `${validSwap.summary}${cashText}. Mutual win-win.`,
            onExecute: () => {
                TradeProposalExecutor.executeProposal(validSwap);
            },
            onSkip: () => {
                TradeProposalExecutor.recordSkipped(validSwap.summary);
            }
        });
    },

    lastDeliberatedTurn: -1,

    async deliberateBeforeEndTurn() {
        // Deliberate LLM strategic review once per turn
        if (CONFIG.DELIBERATE_BEFORE_END_TURN && CONFIG.OLLAMA_ENABLED && this.lastDeliberatedTurn !== GameMemory.turnCount) {
            this.lastDeliberatedTurn = GameMemory.turnCount;
            const verdict = await OllamaClient.deliberateEndTurnStrategy();
            if (verdict.action === 'UPGRADE') {
                if (await this.handleHouseBuilding()) return true;
            }
        }
        return this.handleEndTurn();
    },

    handleEndTurn() {
        if (!GameMemory.isMyTurn || !GameMemory.hasRolled) return false;

        // Debt guard: never end turn while in debt
        if (GameMemory.myCash < 0 || GameMemory.isNegativeDebt) {
            logToBot(`[DEBT GUARD] Cannot end turn while in debt ($${GameMemory.myCash}). Liquidating...`);
            if (this.handleDebtRecovery()) return true;
            return false;
        }

        // CRITICAL GUARD: If native Buy/Auction button is on screen, NEVER end turn!
        // We MUST buy or auction first!
        if (this.findNativeBuyButton() || this.findNativeAuctionButton()) {
            logToBot(`[TURN GUARD] Purchase/Auction decision pending on screen. Resolving before ending turn.`);
            if (this.handleBuyOrAuction()) return true;
            return false;
        }

        // Purchase guard: never skip buying an unowned property we can afford
        const standingTile = GameMemory.getTile(GameMemory.myPos);
        const isPurchasable = standingTile && standingTile.group && (standingTile.type === 'property' || standingTile.type === 'airport' || standingTile.type === 'utility');
        const isUnowned = isPurchasable && !GameMemory.ownership[standingTile.id]?.owner;
        if (isUnowned && GameMemory.myCash >= (standingTile.price || 0)) {
            if (this.handleBuyOrAuction()) return true;
        }

        return executeOrAdvise({
            title: 'END TURN',
            reason: `Turn actions complete. Passing priority to next player.`,
            delayMs: 700,
            onExecute: () => {
                TradeProposalExecutor.cancelPendingTrade();
                const endBtn = this.findNativeEndTurnButton();
                if (endBtn) {
                    try { endBtn.click(); } catch (_) {}
                }
                sendSocketAction('end-turn', {});
                GameMemory.isMyTurn = false;
                GameMemory.hasRolled = false;
            }
        });
    },

    handleTurnClockWatchdog() {
        if (!GameMemory.isMyTurn) return false;
        const leftMs = GameMemory.getTurnClockRemainingMs();
        const autoActed = GameMemory.autoActedTurns || 0;

        // 2-Strike Watchdog: If server already auto-acted for us >= 1 time, we are at risk of removal!
        const isUrgentStrikeRisk = autoActed >= 1;
        const clockRequestThreshold = isUrgentStrikeRisk ? 12000 : 7000;
        const emergencyThreshold = isUrgentStrikeRisk ? 5000 : 2500;

        // 1. Clock Request: If running low on time and haven't asked this turn, request +60s extension
        if (leftMs < clockRequestThreshold && !GameMemory.turnClock.clockRequestedThisTurn) {
            GameMemory.turnClock.clockRequestedThisTurn = true;
            logToBot(`[TURN CLOCK] ⚠️ Turn timer low (${Math.round(leftMs / 1000)}s${isUrgentStrikeRisk ? ' [STRIKE RISK!]' : ''})! Requesting +60s extension...`);
            sendSocketAction('request-clock-time');
            return true;
        }

        // 2. Emergency Fallback: auto-act to prevent AFK kick/strike
        if (leftMs < emergencyThreshold) {
            logToBot(`[TURN CLOCK] 🚨 EMERGENCY FALLBACK (${Math.round(leftMs / 1000)}s left${isUrgentStrikeRisk ? ' - 2ND STRIKE PREVENTION' : ''})! Auto-acting.`);
            if (!GameMemory.hasRolled && !GameMemory.inJail) {
                GameMemory.hasRolled = true;
                const btn = this.findNativeRollButton();
                if (btn) {
                    try { btn.click(); } catch (_) {}
                }
                sendSocketAction('plz-roll-dices');
                return true;
            } else {
                this.handleEndTurn();
                return true;
            }
        }

        return false;
    }
};
