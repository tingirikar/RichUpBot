import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { HIGH_TRAFFIC_GROUPS } from '../data/boardTiles.js';

/**
 * AUCTION SNIPER & BIDDING STRATEGY ENGINE
 * 
 * Calculates property ceiling fair value and automatically bids
 * or passes in RichUp auctions.
 */
export const AuctionSniper = {
    /**
     * Calculates the maximum rational bid for a property in auction
     */
    calculateCeilingBid(tile, myCash) {
        if (!tile) return { maxBid: 0, multiplier: 0.8, reason: 'Unknown tile' };

        let multiplier = 0.85; // Standard default: buy unowned tiles at a 15% discount
        let reason = 'Standard Asset Discount Bid';

        // Check 1: Does this complete OUR monopoly?
        const mySet = GameMemory.getGroupCount(tile.group, '__ME__');
        if (tile.group && mySet.owned === mySet.total - 1) {
            multiplier = 2.5; // Massive premium to complete our monopoly!
            reason = `MUST-HAVE: Completes our ${tile.group} Monopoly!`;
        } 
        // Check 2: Does it block an opponent's monopoly?
        else if (tile.group && OpponentTracker.isBlockerAgainstAnyOpponent(tile)) {
            multiplier = 1.6;
            reason = `DEFENSIVE BLOCK: Prevents opponent from completing ${tile.group}`;
        }
        // Check 3: High traffic boost or 2-tile sets
        else if (tile.group && (HIGH_TRAFFIC_GROUPS.has(tile.group) || tile.group === 'USA' || tile.group === 'Brazil')) {
            multiplier = 1.2;
            reason = `High-Traffic Asset: ${tile.name} (${tile.group})`;
        }

        const ceilingValue = Math.round(tile.price * multiplier);
        // Absolute safety cap: never bid more than cash minus $30 emergency buffer
        const maxAffordable = Math.max(0, myCash - 30);

        return {
            maxBid: Math.min(ceilingValue, maxAffordable),
            multiplier,
            reason
        };
    },

    /**
     * Decides whether to click "Auction" instead of "Buy for $X" upon landing on an unowned property.
     * Rule: We almost ALWAYS buy directly! Auctioning is only for when we are broke,
     * or when ALL opponents are so broke that we can steal the property for $20.
     */
    shouldSendToAuctionInsteadOfBuy(tile, price, myCash) {
        if (!tile) return { auction: false, reason: 'Direct Buy' };

        // If we physically cannot afford direct buy:
        if (myCash < price) {
            return {
                auction: true,
                reason: `Cannot afford direct buy ($${myCash} < $${price}). Sending to auction.`
            };
        }

        // Check max cash among all active opponents
        let maxOppCash = 0;
        for (const [pName, pData] of Object.entries(GameMemory.players)) {
            if (!GameMemory.isMe(pName) && !pData.bankrupt) {
                if ((pData.cash || 0) > maxOppCash) maxOppCash = pData.cash;
            }
        }

        const mySet = GameMemory.getGroupCount(tile.group, '__ME__');
        const completesMyMonopoly = tile.group && mySet.owned === mySet.total - 1;
        const blocksOpponent = OpponentTracker.isBlockerAgainstAnyOpponent(tile);

        // Crucial property: NEVER risk sending to auction if any opponent can afford to bid!
        if (completesMyMonopoly || blocksOpponent) {
            return {
                auction: false,
                reason: `Direct Buy: Crucial asset (${completesMyMonopoly ? 'Monopoly' : 'Blocker'}). Never risk auctioning!`
            };
        }

        // Steal Opportunity: If all opponents have < $60 cash, we can auction and snipe it for cheap!
        if (maxOppCash < 60 && price >= 200) {
            return {
                auction: true,
                reason: `Auction Steal: Opponents are broke (Max Opp Cash $${maxOppCash}). Auctioning to buy for cheap!`
            };
        }

        // Default: Buy directly to secure the property without bidding wars
        return {
            auction: false,
            reason: `Direct Buy: Securing ${tile.name} without auction risk.`
        };
    },

    /**
     * Decides whether to bid +$10, +$50, or Pass in an ongoing auction
     */
    evaluateAuctionStep(tile, currentBid, myCash) {
        const { maxBid, reason } = this.calculateCeilingBid(tile, myCash);

        // Can we afford to increment bid by $10?
        if (currentBid + 10 <= maxBid && currentBid + 10 <= myCash - 30) {
            return {
                shouldBid: true,
                increment: 10,
                maxBid,
                reason: `Bidding $${currentBid + 10} <= Max $${maxBid} (${reason})`
            };
        }

        return {
            shouldBid: false,
            increment: 0,
            maxBid,
            reason: `Passing: Current bid $${currentBid} exceeds ceiling $${maxBid} (${reason})`
        };
    }
};
