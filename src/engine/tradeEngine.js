import { GROUP_TILES } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { CONFIG } from '../config.js';

/**
 * GAME-THEORETIC MINIMAX TRADE ENGINE
 * 
 * 1. Evaluates incoming trades using synergy multipliers & cash differentials
 * 2. Scans board for Mutual Monopoly Swaps
 * 3. Prevents giving opponents uncountered monopolies
 * 4. Formulates win-win trades with custom chat pitches
 */
export const TradeEngine = {
    scoreTileForPlayer(tile, playerName) {
        if (!tile) return 0;
        const baseEV = tile.price * (1 + tile.markov * 18);
        if (!tile.group) return baseEV;

        const isMe = GameMemory.isMe(playerName);
        const { owned, total } = GameMemory.getGroupCount(tile.group, isMe ? '__ME__' : playerName);

        let synergy = 1.0;
        if (tile.type === 'property') {
            if (owned >= total - 1) synergy = 6.2; // Massive monopoly synergy
            else if (owned === 1 && total === 3) synergy = 2.0;
        } else if (tile.type === 'airport') {
            synergy = 1.0 + owned * 0.45;
        } else if (tile.type === 'utility') {
            synergy = owned >= 1 ? 1.8 : 0.9;
        }
        return Math.round(baseEV * synergy);
    },

    evaluateIncomingTrade(tradeData) {
        const {
            partnerName = '__OPP__',
            givenTiles = [],
            receivedTiles = [],
            givenCash = 0,
            receivedCash = 0
        } = tradeData;

        // VETO CHECK 1: Never hand an opponent a monopoly unless we also receive a monopoly
        let givesOppMonopoly = false;
        for (const tile of givenTiles) {
            if (tile.group && tile.type === 'property') {
                const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
                if (oppSet.owned === oppSet.total - 1) {
                    givesOppMonopoly = true;
                    break;
                }
            }
        }

        let completesMyMonopoly = false;
        for (const tile of receivedTiles) {
            if (tile.group && tile.type === 'property') {
                const mySet = GameMemory.getGroupCount(tile.group, '__ME__');
                if (mySet.owned === mySet.total - 1) {
                    completesMyMonopoly = true;
                    break;
                }
            }
        }

        if (givesOppMonopoly && !completesMyMonopoly) {
            return {
                accept: false,
                reason: `MONOPOLY VETO: Trade would grant ${partnerName} a monopoly without giving us one!`,
                chatReply: "Can't give you a monopoly for that offer, that's game over for me."
            };
        }

        // Calculate utility gains
        let myGain = receivedCash - givenCash;
        let oppGain = givenCash - receivedCash;

        for (const tile of receivedTiles) {
            myGain += this.scoreTileForPlayer(tile, '__ME__');
        }
        for (const tile of givenTiles) {
            myGain -= this.scoreTileForPlayer(tile, '__ME__');
            oppGain += this.scoreTileForPlayer(tile, partnerName);
        }

        const acceptable = myGain > 0 && (myGain >= oppGain * CONFIG.TRADE_MIN_ADVANTAGE_RATIO || completesMyMonopoly);

        GameMemory.lastTradeVerdict = acceptable ? 'ACCEPTABLE' : 'UNFAVORABLE';

        return {
            accept: acceptable,
            myGain: Math.round(myGain),
            oppGain: Math.round(oppGain),
            reason: acceptable
                ? `EV+ Trade: Net gain +$${Math.round(myGain)} vs Opp +$${Math.round(oppGain)}`
                : `Unfavorable utility: Net gain $${Math.round(myGain)} < requirement`,
            chatReply: acceptable
                ? "Pleasure doing business with you!"
                : "Numbers don't work out for me. Sweeten the cash offer and I'll consider it."
        };
    },

    /**
     * Scans for Mutual Monopoly Swaps:
     * We have 2/3 of Group A, Opponent has 1/3 of Group A.
     * Opponent has 2/3 of Group B, We have 1/3 of Group B.
     */
    scanMutualMonopolySwaps() {
        const opportunities = [];
        const myMissing = OpponentTracker.getMyMissingCards();
        const opponents = OpponentTracker.analyzeOpponents();

        for (const myNeed of myMissing) {
            if (!myNeed.heldBy || myNeed.isUnowned) continue;

            const targetOppName = myNeed.heldBy;
            const targetOpp = opponents[targetOppName];
            if (!targetOpp) continue;

            // Does targetOpp have a missing card that WE hold?
            for (const oppNeed of targetOpp.hungrySets) {
                if (oppNeed.weHoldIt && oppNeed.missingTile) {
                    // We found a Mutual Monopoly Swap!
                    // Calculate cash sweetener needed to balance the trade
                    const myCardValue = this.scoreTileForPlayer(oppNeed.missingTile, targetOppName);
                    const theirCardValue = this.scoreTileForPlayer(myNeed.missingTile, '__ME__');
                    const cashDiff = myCardValue - theirCardValue;

                    let cashOffer = 0;
                    let cashDemand = 0;
                    if (cashDiff > 0) {
                        cashDemand = Math.min(targetOpp.cash, Math.round(cashDiff * 0.4));
                    } else if (cashDiff < 0) {
                        cashOffer = Math.min(GameMemory.myCash - 100, Math.round(Math.abs(cashDiff) * 0.4));
                    }

                    opportunities.push({
                        targetOwner: targetOppName,
                        myGivenTile: oppNeed.missingTile,
                        myReceivedTile: myNeed.missingTile,
                        cashOffer: Math.max(0, cashOffer),
                        cashDemand: Math.max(0, cashDemand),
                        summary: `SWAP: Give ${oppNeed.missingTile.name} -> Get ${myNeed.missingTile.name}`,
                        pitch: `@${targetOppName} Let's swap ${oppNeed.missingTile.name} for ${myNeed.missingTile.name}. Both of us get a set to fight the lobby!`
                    });
                }
            }
        }
        return opportunities;
    }
};
