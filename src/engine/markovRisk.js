import { DICE_PROB } from '../data/diceProb.js';
import { BOARD_TILES, HIGH_TRAFFIC_GROUPS } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { CONFIG } from '../config.js';

/**
 * MARKOV RISK & FUTURE VISION PROBABILITY ENGINE
 * 
 * Computes 1-turn and 3-turn Expected Rent Exposure (E[Rent]),
 * worst-case single-roll loss in the high-frequency 5-to-9 roll window,
 * and maintains the Dynamic Survival Cash Floor.
 */
export const MarkovRisk = {
    analyzeDangerAhead(currentPos) {
        let expectedLoss1Turn = 0;
        let maxDangerWindowLoss = 0;
        let maxAnyRollLoss = 0;

        for (let roll = 2; roll <= 12; roll++) {
            const prob = DICE_PROB[roll];
            const targetTile = (currentPos + roll) % 40;
            const rent = GameMemory.getTileCurrentRent(targetTile);

            expectedLoss1Turn += prob * rent;
            if (roll >= 5 && roll <= 9 && rent > maxDangerWindowLoss) {
                maxDangerWindowLoss = rent;
            }
            if (rent > maxAnyRollLoss) {
                maxAnyRollLoss = rent;
            }
        }

        let expectedLoss3Turns = expectedLoss1Turn;
        for (let step = 13; step <= 21; step++) {
            const targetTile = (currentPos + step) % 40;
            const tileData = BOARD_TILES[targetTile];
            const rent = GameMemory.getTileCurrentRent(targetTile);
            const markovWeight = tileData.markov * 0.45;
            expectedLoss3Turns += markovWeight * rent;
        }

        GameMemory.lastDangerEV = Math.round(expectedLoss1Turn);
        return {
            expectedLoss1Turn: Math.round(expectedLoss1Turn),
            expectedLoss3Turns: Math.round(expectedLoss3Turns),
            maxDangerWindowLoss,
            maxAnyRollLoss
        };
    },

    computeDynamicReserve(currentPos) {
        if (!CONFIG.SMART_RESERVE_ENABLED) return CONFIG.BASE_MIN_RESERVE;

        const danger = this.analyzeDangerAhead(currentPos);
        const dynamicReserve = Math.round(
            CONFIG.BASE_MIN_RESERVE +
            CONFIG.RISK_AVERSION_FACTOR * danger.expectedLoss1Turn +
            CONFIG.WORST_CASE_WEIGHT * danger.maxDangerWindowLoss
        );

        GameMemory.lastDynamicReserve = Math.max(CONFIG.BASE_MIN_RESERVE, dynamicReserve);
        return GameMemory.lastDynamicReserve;
    },

    /**
     * Evaluates property purchase when landing on unowned tile.
     * Enforces strict buy preference: Always secure airports, utilities, and properties!
     */
    shouldBuyProperty(tile, price, myCash) {
        // 1. Physical cash check
        if (myCash < price) {
            return {
                buy: false,
                reason: `Cannot afford ${tile ? tile.name : 'property'} ($${price} > $${myCash})`
            };
        }

        // 2. CRITICAL BLOCKER CHECK: Always buy if it stops an opponent monopoly!
        if (tile && OpponentTracker.isBlockerAgainstAnyOpponent(tile)) {
            return {
                buy: true,
                reason: `DEFENSIVE BLOCK: Prevents opponent from completing ${tile.group}!`
            };
        }

        // 3. MONOPOLY COMPLETER CHECK: Always buy if it completes our set!
        const mySet = tile?.group ? GameMemory.getGroupCount(tile.group, '__ME__') : null;
        if (mySet && (mySet.owned === mySet.total - 1 || tile.group === 'USA' || tile.group === 'Brazil')) {
            return {
                buy: true,
                reason: `CRITICAL: Completes ${tile.group} Monopoly!`
            };
        }

        // 4. INTELLIGENT SKIP / HOTEL DANGER VETO:
        // If we are facing enemy houses/hotels ahead and buying leaves us with less than our danger reserve,
        // SKIP buying this non-critical property to avoid bankruptcy!
        const danger = this.analyzeDangerAhead(GameMemory.myPos);
        const dynamicReserve = this.computeDynamicReserve(GameMemory.myPos);
        const postCash = myCash - price;

        if (danger.maxDangerWindowLoss >= 250 && postCash < dynamicReserve) {
            return {
                buy: false,
                reason: `INTELLIGENT SKIP: Facing dangerous opponent territory ($${danger.maxDangerWindowLoss} rent) ahead. Preserving $${myCash} cash to survive roll.`
            };
        }

        // 5. AIRPORTS & UTILITIES: High-yield cashflow assets
        if (tile && (tile.group === 'Airport' || tile.group === 'Airports')) {
            return { buy: true, reason: `Essential High-Yield Asset: ${tile.name} (Airport)` };
        }
        if (tile && (tile.group === 'Utility' || tile.group === 'Utilities')) {
            return { buy: true, reason: `Cashflow Asset: ${tile.name} (Utility)` };
        }

        // 6. High-traffic groups & standard lands
        if (tile && HIGH_TRAFFIC_GROUPS.has(tile.group)) {
            return { buy: true, reason: `High-Traffic Strategic Asset: ${tile.name} (${tile.group})` };
        }

        return {
            buy: true,
            reason: `EV+ Buy: ${tile ? tile.name : 'property'} ($${price})`
        };
    }
};
