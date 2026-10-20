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
     * Rule: We ALWAYS buy directly if we can afford it!
     * Auctioning is ONLY for when we physically cannot afford the purchase.
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

        // We can afford direct buy: ALWAYS BUY DIRECTLY! Never gamble with auctions!
        return {
            auction: false,
            reason: `Direct Buy: Securing ${tile.name} directly ($${price} <= $${myCash}).`
        };
    },

    /**
     * Decides whether to bid +$10, +$50, or Pass in an ongoing auction
     */
    evaluateAuctionStep(tile, currentBid, myCash) {
        const { maxBid, reason } = this.calculateCeilingBid(tile, myCash);

        // Aggressive +$50 jump bid if ceiling is far above current bid and we have sufficient funds
        if (maxBid - currentBid >= 100 && currentBid + 50 <= maxBid && currentBid + 50 <= myCash - 30) {
            return {
                shouldBid: true,
                increment: 50,
                maxBid,
                reason: `Aggressive Jump +$50 -> $${currentBid + 50} <= Max $${maxBid} (${reason})`
            };
        }

        // Standard +$10 bid
        if (currentBid + 10 <= maxBid && currentBid + 10 <= myCash - 30) {
            return {
                shouldBid: true,
                increment: 10,
                maxBid,
                reason: `Bidding +$10 -> $${currentBid + 10} <= Max $${maxBid} (${reason})`
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
