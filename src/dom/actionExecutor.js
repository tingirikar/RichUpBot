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

        if (!CONFIG.AUTO_TRADE_ENABLED) {
            if (declineBtn) {
                delayClick(declineBtn, 'Auto-declining trade (Auto-Trade disabled)');
                return true;
            }
            return false;
        }

        const tradeData = scrapeTradeModalDOM();
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
                }
            });
        }
        return false;
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

            // 1. Prioritize Direct Buy: If we have enough cash, always secure the asset directly!
            const decision = MarkovRisk.shouldBuyProperty(tile, price, GameMemory.myCash);

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
            const auctionCheck = AuctionSniper.shouldSendToAuctionInsteadOfBuy(tile, price, GameMemory.myCash);
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

        const bidBtn = snapshot.findAuctionBidButton();
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
        return false;
    },

    handleHouseBuilding(snapshot) {
        if (!CONFIG.AUTO_BUILD_ENABLED) return false;

        // Check if an upgrade modal is already open
        const modalUpgradeBtn = snapshot.findModalUpgradeButton();
        if (modalUpgradeBtn) {
            return executeOrAdvise({
                el: modalUpgradeBtn,
                title: 'UPGRADE PROPERTY [↑]',
                reason: 'Building house on selected property.',
                onExecute: () => delayClick(modalUpgradeBtn, 'Clicking [↑] to build house')
            });
        }

        const upgrades = HouseBuilder.rankHouseUpgrades(GameMemory.myCash);
        if (upgrades.length === 0) {
            // Strategic Mortgaging: Liquidate dead-weight singletons to fund lethal monopoly upgrades
            if (CONFIG.AUTO_MORTGAGE_ENABLED) {
                for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
                    if (tiles[0].type !== 'property') continue;
                    const { owned, total } = GameMemory.getGroupCount(groupName, '__ME__');
                    if (owned === total) {
                        const houseCounts = tiles.map(t => GameMemory.ownership[t.id]?.houses || 0);
                        const minHouses = Math.min(...houseCounts);
                        if (minHouses < 3) {
                            const candidates = DebtRecovery.findStrategicMortgageCandidates();
                            if (candidates.length > 0) {
                                // 1. If mortgage button is already visible in an open card modal, execute it!
                                const modalMortgageBtn = snapshot.findModalMortgageButton();
                                const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;

                                if (modalMortgageBtn) {
                                    const matchingCandidate = candidates.find(c => openCard && c.tile.id === openCard.tile.id);
                                    if (matchingCandidate || !openCard) {
                                        const tileToMortgage = matchingCandidate ? matchingCandidate.tile : candidates[0].tile;
                                        return executeOrAdvise({
                                            el: modalMortgageBtn,
                                            title: `MORTGAGE: ${tileToMortgage.name.toUpperCase()}`,
                                            reason: `Mortgaging dead asset (+$${matchingCandidate ? matchingCandidate.mortgageValue : candidates[0].mortgageValue}) to fund 3-house rush on ${groupName}`,
                                            onExecute: () => {
                                                if (GameMemory.ownership[tileToMortgage.id]) {
                                                    GameMemory.ownership[tileToMortgage.id].mortgaged = true;
                                                }
                                                delayClick(modalMortgageBtn, `Mortgaging ${tileToMortgage.name} for strategic rush`);
                                            }
                                        });
                                    }
                                }

                                // 2. If the modal is not open for target, open it from the sidebar
                                const target = candidates[0];
                                if (!openCard || openCard.tile.id !== target.tile.id) {
                                    const sidebarProp = snapshot.findSidebarPropertyItem(target.tile.name);
                                    if (sidebarProp) {
                                        return executeOrAdvise({
                                            el: sidebarProp,
                                            title: `OPEN ${target.tile.name.toUpperCase()} TO MORTGAGE`,
                                            reason: `Mortgaging dead asset (+$${target.mortgageValue}) to fund 3-house rush on ${groupName}`,
                                            onExecute: () => delayClick(sidebarProp, `Opening ${target.tile.name} for strategic mortgage`)
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return false;
        }

        const top = upgrades[0];

        // Click property in "My properties" sidebar (reliable & direct)
        const sidebarItem = snapshot.findSidebarPropertyItem(top.tile.name);
        if (sidebarItem) {
            return executeOrAdvise({
                el: sidebarItem,
                title: `SELECT ${top.tile.name.toUpperCase()} TO UPGRADE`,
                reason: `Opening property menu to build house (${top.nextHouses} houses, ROI: ${top.roi})`,
                onExecute: () => delayClick(sidebarItem, `Opening ${top.tile.name} from sidebar`)
            });
        }

        return false;
    },

    handleDebtRecovery(snapshot) {
        // Player is in debt ONLY when cash is strictly below 0
        const isDebt = GameMemory.myCash < 0;
        if (!CONFIG.AUTO_MORTGAGE_ENABLED || !isDebt) return false;

        logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets to survive...`);

        // Check if a property management modal is already open
        const mortgageBtn = snapshot.findModalMortgageButton();
        const sellHouseBtn = snapshot.findModalSellHouseButton();

        if (mortgageBtn) {
            const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;
            const tileName = openCard ? openCard.tile.name : 'PROPERTY';
            return executeOrAdvise({
                el: mortgageBtn,
                title: `MORTGAGE: ${tileName.toUpperCase()}`,
                reason: `Cash is negative ($${GameMemory.myCash})! Mortgaging asset to clear debt.`,
                onExecute: () => {
                    if (openCard && GameMemory.ownership[openCard.tile.id]) {
                        GameMemory.ownership[openCard.tile.id].mortgaged = true;
                    }
                    delayClick(mortgageBtn, `Clicking Mortgage button to clear debt`);
                }
            });
        }

        if (sellHouseBtn) {
            return executeOrAdvise({
                el: sellHouseBtn,
                title: 'SELL HOUSE [↓]',
                reason: `Cash is negative ($${GameMemory.myCash})! Selling house to clear debt.`,
                onExecute: () => delayClick(sellHouseBtn, 'Clicking [↓] to sell house')
            });
        }

        // If modal is not open, open our lowest sacrifice property from sidebar!
        const targets = DebtRecovery.rankLiquidationTargets();
        if (targets.length > 0) {
            const bestTarget = targets[0];
            const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;
            if (!openCard || openCard.tile.id !== bestTarget.tile.id) {
                const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
                if (sidebarProp) {
                    return executeOrAdvise({
                        el: sidebarProp,
                        title: `OPEN ${bestTarget.tile.name.toUpperCase()} TO LIQUIDATE`,
                        reason: `Cash is negative ($${GameMemory.myCash}). Selecting lowest sacrifice asset to mortgage.`,
                        onExecute: () => delayClick(sidebarProp, `Opening ${bestTarget.tile.name} for debt recovery`)
                    });
                }
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

    async deliberateBeforeEndTurn(snapshot) {
        const endTurnBtn = snapshot.findExactOrIncludes(['end turn', 'done', 'continue', 'ok']);
        if (!endTurnBtn) return false;

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
        const endTurnBtn = snapshot.findExactOrIncludes(['end turn', 'done', 'continue', 'ok']);
        if (endTurnBtn) {
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
