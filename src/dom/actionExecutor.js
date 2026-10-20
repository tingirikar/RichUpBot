import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { BOARD_TILES, GROUP_TILES } from '../data/boardTiles.js';
import { normalizeText } from './elementFinder.js';
import { MarkovRisk } from '../engine/markovRisk.js';
import { JailStrategy } from '../engine/jailStrategy.js';
import { AuctionSniper } from '../engine/auctionSniper.js';
import { TradeEngine } from '../engine/tradeEngine.js';
import { TradeProposalExecutor } from '../engine/tradeProposalExecutor.js';
import { HouseBuilder } from '../engine/houseBuilder.js';
import { DebtRecovery } from '../engine/debtRecovery.js';
import { scrapeTradeModalDOM } from './boardScanner.js';
import { OllamaClient } from '../engine/ollamaClient.js';
import { ChatEngine } from '../ui/chatEngine.js';
import { HUDPanel } from '../ui/hudPanel.js';

let isActing = false;
let isEvaluatingTrade = false;
const processedTradeSignatures = new Map();

export function getIsActing() {
    return isActing;
}

export function logToBot(msg) {
    console.log(`[RichUp AI] ${new Date().toISOString()} - ${msg}`);
    if (window.__richupLogTerminal) {
        window.__richupLogTerminal(msg);
    }
}

export function delayClick(el, reason = '') {
    if (!el || isActing) return false;
    isActing = true;

    const delay = Math.floor(Math.random() * (CONFIG.ACTION_DELAY_MAX - CONFIG.ACTION_DELAY_MIN + 1)) + CONFIG.ACTION_DELAY_MIN;
    logToBot(`[ACTION] ${reason} (in ${delay}ms)`);

    setTimeout(() => {
        try {
            if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            try {
                if (typeof el.focus === 'function') el.focus();
                el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            } catch (_) {}
            el.click();
        } catch (err) {
            logToBot(`Click error: ${err}`);
        } finally {
            setTimeout(() => {
                isActing = false;
            }, 120);
        }
    }, delay);

    return true;
}

/**
 * Executes action directly in AUTO mode, or requests human confirmation in ADVISOR mode
 */
function executeOrAdvise({ el, title, reason, onExecute, onSkip }) {
    if (!el || isActing) return false;

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
                else delayClick(el, reason);
            },
            () => {
                HUDPanel.hideAdvisorBox();
                logToBot(`[ADVISOR] Action skipped by user.`);
                if (onSkip) onSkip();
            }
        );
        return true;
    }

    // Full-Auto mode
    if (onExecute) onExecute();
    else delayClick(el, reason);
    return true;
}

export const ActionExecutor = {
    async handleTrade(snapshot) {
        // If modal buttons aren't visible, check if an incoming trade notification exists in the sidebar
        const sidebarTrade = snapshot.findSidebarIncomingTradeItem();
        const confirmBtn = snapshot.findTradeConfirmButton();
        const declineBtn = snapshot.findTradeDeclineButton();
        const negotiateBtn = snapshot.findTradeNegotiateButton();

        if (!confirmBtn && !declineBtn && sidebarTrade) {
            logToBot('[TRADE] Incoming trade row detected in sidebar. Opening trade modal...');
            delayClick(sidebarTrade, 'Open incoming trade from sidebar');
            return true;
        }

        if (!declineBtn && !confirmBtn) return false;

        // Trade Locking: If an evaluation is already running, prevent overlapping evaluation ticks
        if (isEvaluatingTrade) return true;

        const tradeData = scrapeTradeModalDOM();
        const sig = `${tradeData.partnerName || 'Unknown'}_give:${(tradeData.givenTiles || []).map(t => t.id).sort().join(',')}_$${tradeData.givenCash || 0}_recv:${(tradeData.receivedTiles || []).map(t => t.id).sort().join(',')}_$${tradeData.receivedCash || 0}`;

        const now = Date.now();
        // Prune stale signatures older than 60s
        for (const [key, ts] of processedTradeSignatures.entries()) {
            if (now - ts > 60000) processedTradeSignatures.delete(key);
        }

        // Deduplication Lock: If this trade was already processed in the last 15s, ignore duplicate ticks
        if (processedTradeSignatures.has(sig) && (now - processedTradeSignatures.get(sig) < 15000)) {
            return true;
        }

        if (!CONFIG.AUTO_TRADE_ENABLED) {
            if (declineBtn) {
                processedTradeSignatures.set(sig, now);
                delayClick(declineBtn, 'Auto-declining trade (Auto-Trade disabled)');
                return true;
            }
            return false;
        }

        isEvaluatingTrade = true;
        processedTradeSignatures.set(sig, now);

        try {
            logToBot('[TRADE] Evaluating incoming trade with Hybrid Brain...');
            const verdict = await OllamaClient.evaluateTradeWithLLM(tradeData);
            logToBot(`Trade Verdict: ${verdict.reason}`);

            if (verdict.negotiate && negotiateBtn) {
                return executeOrAdvise({
                    el: negotiateBtn,
                    title: 'NEGOTIATE INCOMING TRADE',
                    reason: verdict.reason,
                    onExecute: () => {
                        if (verdict.chatReply) ChatEngine.sendChatMessage('tradeNegotiate', verdict.chatReply);
                        delayClick(negotiateBtn, `Negotiating trade (${verdict.reason})`);
                    }
                });
            }

            if (verdict.accept && confirmBtn) {
                return executeOrAdvise({
                    el: confirmBtn,
                    title: 'CONFIRM INCOMING TRADE',
                    reason: verdict.reason,
                    onExecute: () => {
                        if (verdict.chatReply) ChatEngine.sendChatMessage('tradeAccept', verdict.chatReply);
                        delayClick(confirmBtn, `Confirming trade (${verdict.reason})`);
                    }
                });
            }

            if (declineBtn) {
                return executeOrAdvise({
                    el: declineBtn,
                    title: 'DECLINE INCOMING TRADE',
                    reason: verdict.reason,
                    onExecute: () => {
                        if (verdict.chatReply) ChatEngine.sendChatMessage('tradeReject', verdict.chatReply);
                        delayClick(declineBtn, `Declining trade (${verdict.reason})`);

                        // Auto-Counter Trade: After declining an unfair offer, launch our own counter proposal!
                        if (verdict.counterSwap && CONFIG.AUTO_TRADE_ENABLED) {
                            logToBot(`[COUNTER TRADE] Scheduling counter-proposal for ${verdict.counterSwap.targetOwner}...`);
                            setTimeout(() => {
                                if (!TradeProposalExecutor.isExecuting) {
                                    TradeProposalExecutor.executeProposal(verdict.counterSwap);
                                }
                            }, 1800);
                        }
                    }
                });
            }
            return false;
        } finally {
            isEvaluatingTrade = false;
        }
    },

    /**
     * Proactively opens the Trade UI and submits win-win trade proposals!
     */
    handleProactiveTrade(snapshot) {
        if (!CONFIG.AUTO_TRADE_ENABLED || TradeProposalExecutor.isExecuting) return false;

        const createBtn = snapshot.findCreateTradeButton();
        if (!createBtn) return false;

        const swaps = TradeEngine.scanMutualMonopolySwaps();
        if (swaps.length === 0) return false;

        // Find the first swap that is not on cooldown or recently skipped
        const validSwap = swaps.find(s => 
            TradeProposalExecutor.canProposeToPlayer(s.targetOwner) && 
            !TradeProposalExecutor.isSwapSkipped(s.summary)
        );

        if (!validSwap) return false;

        const cashText = validSwap.cashDemand > 0 ? ` (+ ask $${validSwap.cashDemand})` : (validSwap.cashOffer > 0 ? ` (+ offer $${validSwap.cashOffer})` : '');

        return executeOrAdvise({
            el: createBtn,
            title: `PROPOSE TRADE WITH ${validSwap.targetOwner.toUpperCase()}`,
            reason: `${validSwap.summary}${cashText}. Both get monopolies!`,
            onExecute: () => {
                TradeProposalExecutor.executeProposal(validSwap);
            },
            onSkip: () => {
                TradeProposalExecutor.recordSkipped(validSwap.summary);
            }
        });
    },

    handleJail(snapshot) {
        const pardonBtn = snapshot.findExactOrIncludes(['use pardon', 'pardon card', 'use card', 'get out of jail']);
        const payBailBtn = snapshot.findExactOrIncludes(['get free for', 'pay $50', 'pay 50']);
        const rollBtn = snapshot.findExactOrIncludes(['roll the dice', 'roll again', 'roll']);

        if (!pardonBtn && !payBailBtn) return false;

        // Position self-healing: bail buttons appear exclusively in Jail (Tile 10)
        GameMemory.myPos = 10;
        GameMemory.inJail = true;

        const decision = JailStrategy.shouldPayToLeaveJail(GameMemory.myCash);

        if (decision.exit) {
            if (pardonBtn) {
                return executeOrAdvise({
                    el: pardonBtn,
                    title: 'USE PARDON CARD',
                    reason: decision.reason,
                    onExecute: () => {
                        GameMemory.inJail = false;
                        delayClick(pardonBtn, decision.reason);
                    }
                });
            }
            if (payBailBtn) {
                return executeOrAdvise({
                    el: payBailBtn,
                    title: 'PAY $50 JAIL BAIL',
                    reason: decision.reason,
                    onExecute: () => {
                        if (GameMemory.myCash >= 50) GameMemory.myCash -= 50;
                        GameMemory.inJail = false;
                        delayClick(payBailBtn, decision.reason);
                    }
                });
            }
        } else {
            logToBot(`Jail: Staying safe in cell (${decision.reason})`);
        }

        if (rollBtn) {
            return executeOrAdvise({
                el: rollBtn,
                title: 'ROLL IN JAIL (Safe Stay)',
                reason: 'Rolling dice to stay safe in cell or leave on doubles.',
                onExecute: () => delayClick(rollBtn, 'Rolling in Jail')
            });
        }
        return false;
    },

    handleBuyOrAuction(snapshot) {
        const buyBtn = snapshot.findBuyPropertyButton();
        const auctionBtn = snapshot.findExactOrIncludes(['auction', 'pass', "don't buy"]);

        if (!buyBtn && !auctionBtn) return false;

        let tile = null;

        // Verify or recover tile directly from the prompt card surrounding the buy button
        if (buyBtn) {
            let container = buyBtn.parentElement;
            for (let depth = 0; depth < 5 && container && container !== document.body; depth++) {
                const cText = container.innerText || '';
                for (const t of BOARD_TILES) {
                    if (t.group && new RegExp(`\\b${t.name}\\b`, 'i').test(cText)) {
                        tile = t;
                        GameMemory.myPos = t.id; // Self-heal position tracking
                        break;
                    }
                }
                if (tile) break;
                container = container.parentElement;
            }
        }

        if (!tile && BOARD_TILES[GameMemory.myPos]?.group) {
            tile = BOARD_TILES[GameMemory.myPos];
        }

        if (buyBtn) {
            const btnText = normalizeText(buyBtn);
            const priceMatch = /\$?\s*(\d{2,4})|(\d{2,4})\s*\$/.exec(btnText);
            const price = priceMatch ? parseInt(priceMatch[1] || priceMatch[2], 10) : (tile?.price || 60);

            // Re-sync verified scoreboard cash for local player if available
            if (GameMemory.myName && GameMemory.players[GameMemory.myName]?.cash !== undefined) {
                const sbCash = GameMemory.players[GameMemory.myName].cash;
                if (typeof sbCash === 'number') {
                    GameMemory.myCash = sbCash;
                }
            }

            // In RichUp, if the "Buy" button is visibly enabled on the board, the player has enough funds.
            // Using Math.max guarantees immunity to any stale DOM scraping states.
            const effectiveCash = Math.max(GameMemory.myCash, GameMemory.players[GameMemory.myName]?.cash || 0, price);

            // 1. Prioritize Direct Buy: If we have enough cash, always secure the asset directly!
            const decision = MarkovRisk.shouldBuyProperty(tile, price, effectiveCash);

            if (decision.buy) {
                return executeOrAdvise({
                    el: buyBtn,
                    title: `BUY ${tile ? tile.name.toUpperCase() : 'PROPERTY'} ($${price})`,
                    reason: decision.reason,
                    onExecute: () => {
                        if (tile && GameMemory.ownership[tile.id]) {
                            GameMemory.ownership[tile.id].owner = GameMemory.myName || '__ME__';
                        }
                        if (price > 0 && GameMemory.myCash >= price) {
                            GameMemory.myCash -= price;
                        }
                        delayClick(buyBtn, decision.reason);
                    }
                });
            }

            // 2. If purchase cannot be made (e.g. insufficient cash):
            const auctionCheck = AuctionSniper.shouldSendToAuctionInsteadOfBuy(tile, price, effectiveCash);
            if (auctionCheck.auction && auctionBtn) {
                return executeOrAdvise({
                    el: auctionBtn,
                    title: 'TRIGGER AUCTION',
                    reason: auctionCheck.reason,
                    onExecute: () => delayClick(auctionBtn, auctionCheck.reason)
                });
            }
        }

        // If we cannot buy directly (e.g. no buy button or not enough cash):
        if (auctionBtn) {
            return executeOrAdvise({
                el: auctionBtn,
                title: 'PASS / AUCTION PROPERTY',
                reason: 'Cannot afford direct purchase; sending property to auction.',
                onExecute: () => delayClick(auctionBtn, 'Sending to Auction')
            });
        }
        return false;
    },

    handleAuction(snapshot) {
        if (!CONFIG.AUTO_AUCTION_ENABLED) return false;

        let bidBtn = snapshot.findAuctionBidButton();
        const passBtn = snapshot.findAuctionPassButton();

        if (!bidBtn && !passBtn) return false;

        // Scrape modal to find the ACTUAL property being auctioned!
        const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="auction"]');
        const modalText = modal ? modal.innerText : (document.body ? document.body.innerText : '');

        let auctionedTile = null;
        for (const t of BOARD_TILES) {
            if (t.group && new RegExp(`\\b${t.name}\\b`, 'i').test(modalText)) {
                auctionedTile = t;
                break;
            }
        }
        if (!auctionedTile) {
            auctionedTile = BOARD_TILES[GameMemory.myPos] || null;
        }

        const bidMatch = /highest bid:?\s*\$?(\d+)|current bid:?\s*\$?(\d+)/i.exec(modalText);
        const currentBid = bidMatch ? parseInt(bidMatch[1] || bidMatch[2], 10) : 50;

        const decision = AuctionSniper.evaluateAuctionStep(auctionedTile, currentBid, GameMemory.myCash);
        bidBtn = snapshot.findAuctionBidButton(decision.increment) || bidBtn;

        if (decision.shouldBid && bidBtn) {
            return executeOrAdvise({
                el: bidBtn,
                title: `AUCTION BID: +$${decision.increment} [${auctionedTile ? auctionedTile.name : 'Tile'}]`,
                reason: decision.reason,
                onExecute: () => delayClick(bidBtn, decision.reason)
            });
        }

        if (passBtn) {
            return executeOrAdvise({
                el: passBtn,
                title: `AUCTION PASS [${auctionedTile ? auctionedTile.name : 'Tile'}]`,
                reason: decision.reason,
                onExecute: () => delayClick(passBtn, decision.reason)
            });
        }

        // If an auction modal is active and we choose to pass/hold, return true so the bot waits for auction to conclude
        if (modal) {
            return true;
        }
        return false;
    },

    handleHouseBuilding(snapshot) {
        if (!CONFIG.AUTO_BUILD_ENABLED) return false;

        const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;

        // 1. Compile complete monopolies and verify even building requirements
        const completeSets = [];
        for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
            if (tiles[0].type !== 'property') continue;
            const { owned, total } = GameMemory.getGroupCount(groupName, '__ME__');
            if (owned === total) {
                const anyMortgaged = tiles.some(t => GameMemory.ownership[t.id]?.mortgaged);
                if (!anyMortgaged) {
                    const houseCounts = tiles.map(t => GameMemory.ownership[t.id]?.houses || 0);
                    const minHouses = Math.min(...houseCounts);
                    const maxHouses = Math.max(...houseCounts);
                    completeSets.push({ groupName, tiles, minHouses, maxHouses, houseCost: tiles[0].houseCost });
                }
            }
        }

        if (completeSets.length === 0) {
            if (openCard) {
                const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
                if (closeBtn) delayClick(closeBtn, 'Closing property card: No monopolies available');
            }
            return false;
        }

        const reserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
        // Find set that needs upgrades (< 5 houses) and is safe to afford
        const targetSet = completeSets.find(s => s.minHouses < 5 && (GameMemory.myCash - s.houseCost >= reserve));

        if (!targetSet) {
            // Cannot afford more upgrades safely
            if (openCard) {
                const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
                if (closeBtn) delayClick(closeBtn, 'Closing property card: Upgrades complete or budget limited');
            }
            return false;
        }

        // EVEN BUILDING RULE: Find the specific tile in this set that has minHouses!
        // That tile is the ONLY one allowed to receive the next house build!
        const candidateTile = targetSet.tiles.find(t => (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);
        if (!candidateTile) return false;

        // If a different property card is open, dismiss it immediately!
        if (openCard && openCard.tile.id !== candidateTile.id) {
            const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
            if (closeBtn) {
                delayClick(closeBtn, `Closing ${openCard.tile.name} to upgrade ${candidateTile.name} evenly`);
                return true;
            }
        }

        // If the correct candidate card is currently open, click Upgrade [↑]!
        if (openCard && openCard.tile.id === candidateTile.id) {
            const modalUpgradeBtn = snapshot.findModalUpgradeButton();
            if (modalUpgradeBtn) {
                return executeOrAdvise({
                    el: modalUpgradeBtn,
                    title: `UPGRADE ${candidateTile.name.toUpperCase()} [↑]`,
                    reason: `Even building on ${targetSet.groupName}: Upgrading to ${targetSet.minHouses + 1} houses (${targetSet.minHouses} -> ${targetSet.minHouses + 1}).`,
                    onExecute: () => {
                        delayClick(modalUpgradeBtn, `Building house on ${candidateTile.name}`);
                        if (GameMemory.ownership[candidateTile.id]) {
                            GameMemory.ownership[candidateTile.id].houses = targetSet.minHouses + 1;
                        }
                        GameMemory.myCash -= targetSet.houseCost;
                    }
                });
            }
        }

        // If modal is not open for candidateTile, OPEN IT DIRECTLY VIA THE RIGHTMOST SIDEBAR!
        const sidebarItem = snapshot.findSidebarPropertyItem(candidateTile.name);
        if (sidebarItem) {
            return executeOrAdvise({
                el: sidebarItem,
                title: `SELECT ${candidateTile.name.toUpperCase()} (RIGHT SIDEBAR)`,
                reason: `Even building: Opening ${candidateTile.name} from right sidebar to build house (${targetSet.minHouses} -> ${targetSet.minHouses + 1}).`,
                onExecute: () => delayClick(sidebarItem, `Opening ${candidateTile.name} from right sidebar`)
            });
        }

        return false;
    },

    /**
     * Autonomous Unmortgaging: Reclaims mortgaged properties when player has cash surplus
     */
    handleUnmortgage(snapshot) {
        if (!CONFIG.AUTO_MORTGAGE_ENABLED || GameMemory.myCash <= 0) return false;

        const reserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
        const candidates = DebtRecovery.rankUnmortgageCandidates(GameMemory.myCash, reserve);
        if (candidates.length === 0) return false;

        const unmortgageBtn = snapshot.findModalUnmortgageButton ? snapshot.findModalUnmortgageButton() : null;
        const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;

        if (unmortgageBtn && openCard) {
            const tileName = openCard.tile.name;
            return executeOrAdvise({
                el: unmortgageBtn,
                title: `UNMORTGAGE: ${tileName.toUpperCase()}`,
                reason: `Surplus cash ($${GameMemory.myCash} > $${reserve + 200}). Reclaiming ${tileName} to collect full rent!`,
                onExecute: () => {
                    if (GameMemory.ownership[openCard.tile.id]) {
                        GameMemory.ownership[openCard.tile.id].mortgaged = false;
                    }
                    delayClick(unmortgageBtn, `Unmortgaging ${tileName}`);
                }
            });
        }

        // If modal is not open, open top unmortgage candidate from sidebar
        const target = candidates[0];
        const sidebarProp = snapshot.findSidebarPropertyItem(target.tile.name);
        if (sidebarProp) {
            return executeOrAdvise({
                el: sidebarProp,
                title: `OPEN ${target.tile.name.toUpperCase()} TO UNMORTGAGE`,
                reason: `Surplus funds available ($${GameMemory.myCash}). Selecting mortgaged property to restore.`,
                onExecute: () => delayClick(sidebarProp, `Opening ${target.tile.name} to unmortgage`)
            });
        }

        return false;
    },

    handleDebtRecovery(snapshot) {
        if (!CONFIG.AUTO_MORTGAGE_ENABLED) return false;

        // Debt is strictly when player cash is negative (GameMemory.myCash < 0)
        // or an explicit debt modal/warning is visible (GameMemory.isNegativeDebt)
        const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt;
        if (!isDebt) return false;

        logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets to survive...`);

        const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;

        // CRITICAL BUG 3 FIX: If an open property card is ALREADY MORTGAGED, CLOSE IT IMMEDIATELY!
        // We cannot mortgage an already-mortgaged card; its button is Unmortgage which costs money!
        if (openCard && GameMemory.ownership[openCard.tile.id]?.mortgaged) {
            const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
            if (closeBtn) {
                delayClick(closeBtn, `Closing already-mortgaged ${openCard.tile.name} to select unmortgaged asset`);
                return true;
            }
        }

        // Check if an unmortgaged singleton is currently open
        if (openCard && !GameMemory.ownership[openCard.tile.id]?.mortgaged) {
            const mortgageBtn = snapshot.findModalMortgageButton();
            if (mortgageBtn && (GameMemory.ownership[openCard.tile.id]?.houses || 0) === 0) {
                const tileName = openCard.tile.name;
                return executeOrAdvise({
                    el: mortgageBtn,
                    title: `MORTGAGE: ${tileName.toUpperCase()}`,
                    reason: `In debt ($${GameMemory.myCash})! Mortgaging asset to clear debt immediately.`,
                    onExecute: () => {
                        if (GameMemory.ownership[openCard.tile.id]) {
                            GameMemory.ownership[openCard.tile.id].mortgaged = true;
                        }
                        delayClick(mortgageBtn, `Clicking Mortgage button to clear debt`);
                    }
                });
            }

            // If it has houses and all singletons are gone, sell a house
            const sellHouseBtn = snapshot.findModalSellHouseButton();
            if (sellHouseBtn && (GameMemory.ownership[openCard.tile.id]?.houses || 0) > 0) {
                return executeOrAdvise({
                    el: sellHouseBtn,
                    title: `SELL HOUSE: ${openCard.tile.name.toUpperCase()} [↓]`,
                    reason: `In debt ($${GameMemory.myCash})! Selling house to clear debt immediately.`,
                    onExecute: () => delayClick(sellHouseBtn, 'Clicking [↓] to sell house')
                });
            }
        }

        // Open our lowest sacrifice unmortgaged property DIRECTLY FROM THE RIGHTMOST SIDEBAR!
        const targets = DebtRecovery.rankLiquidationTargets();
        if (targets.length > 0) {
            const bestTarget = targets[0];
            const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
            if (sidebarProp) {
                return executeOrAdvise({
                    el: sidebarProp,
                    title: `OPEN ${bestTarget.tile.name.toUpperCase()} (RIGHT SIDEBAR) TO LIQUIDATE`,
                    reason: `In debt ($${GameMemory.myCash}). Selecting lowest sacrifice asset from right sidebar to mortgage.`,
                    onExecute: () => delayClick(sidebarProp, `Opening ${bestTarget.tile.name} from right sidebar for debt recovery`)
                });
            }
        }

        return false;
    },

    handleRollDice(snapshot) {
        const rollBtn = snapshot.findExactOrIncludes(['roll the dice', 'roll again']);
        if (rollBtn) {
            GameMemory.isMyTurn = true;

            return executeOrAdvise({
                el: rollBtn,
                title: `ROLL THE DICE (Turn #${GameMemory.turnCount + 1})`,
                reason: `My turn! Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`,
                onExecute: () => {
                    GameMemory.turnCount++;
                    delayClick(rollBtn, `Rolling dice`);
                }
            });
        }
        return false;
    },

    lastDeliberatedTurn: -1,
    isEndingTurn: false,

    async deliberateBeforeEndTurn(snapshot) {
        const endTurnBtn = snapshot.findExactOrIncludes(['end turn', 'done', 'continue']);
        if (!endTurnBtn) return false;

        // BUG 4 FIX: Check for proactive trades before ending turn!
        if (CONFIG.AUTO_TRADE_ENABLED && !TradeProposalExecutor.isExecuting) {
            try {
                if (this.handleProactiveTrade(snapshot)) {
                    return true;
                }
            } catch (_) {}
        }

        // Perform deliberate LLM strategic check once per turn before ending
        if (CONFIG.DELIBERATE_BEFORE_END_TURN && CONFIG.OLLAMA_ENABLED && this.lastDeliberatedTurn !== GameMemory.turnCount) {
            this.lastDeliberatedTurn = GameMemory.turnCount;
            logToBot('[STRATEGY] Ollama turn review before ending...');
            const verdict = await OllamaClient.deliberateEndTurnStrategy();
            logToBot(`[STRATEGY] Deliberation: ${verdict.action} - ${verdict.rationale}`);

            if (verdict.action === 'UPGRADE') {
                if (this.handleHouseBuilding(snapshot)) {
                    return true;
                }
            }
        }

        return this.handleEndTurn(snapshot);
    },

    handleEndTurn(snapshot) {
        // BUG 2 FIX: Debounce lock prevents spamming end turn while server transition is pending
        if (this.isEndingTurn) return false;

        // Verify that the board does not say another player is playing
        const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
        const myName = (GameMemory.myName || '').toLowerCase();
        if (bodyText.includes('is playing...') && myName && !bodyText.includes(`${myName} is playing...`)) {
            return false;
        }

        const endTurnBtn = snapshot.findExactOrIncludes(['end turn', 'done', 'continue']);
        if (endTurnBtn) {
            // If any property card modal is lingering open, dismiss it before ending turn
            const modalCloseBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
            if (modalCloseBtn) {
                try { modalCloseBtn.click(); } catch (_) {}
            }

            this.isEndingTurn = true;
            setTimeout(() => { this.isEndingTurn = false; }, 2500);

            GameMemory.isMyTurn = false;
            return executeOrAdvise({
                el: endTurnBtn,
                title: 'END TURN',
                reason: 'Turn actions finished. Passing priority.',
                onExecute: () => delayClick(endTurnBtn, 'Ending turn')
            });
        }
        return false;
    }
};
