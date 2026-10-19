import { DICE_PROB } from '../data/diceProb.js';
import { BOARD_TILES, HIGH_TRAFFIC_GROUPS } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';
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
     * Enforces strict survival reserve when facing deadly enemy hotels ahead!
     */
    shouldBuyProperty(tile, price, myCash) {
        const reserve = this.computeDynamicReserve(GameMemory.myPos);
        const danger = this.analyzeDangerAhead(GameMemory.myPos);

        // ENDGAME HOTEL SAFETY OVERRIDE:
        // If dangerous enemy hotels are directly in front of us (in 2-12 tiles),
        // and buying this property leaves us below our emergency reserve -> DO NOT BUY!
        if (danger.maxDangerWindowLoss >= 300 || danger.expectedLoss1Turn >= 120) {
            const postCash = myCash - price;
            if (postCash < reserve * 0.75) {
                return {
                    buy: false,
                    reason: `Hotel Danger Veto: Enemy hotels ($${danger.maxDangerWindowLoss} rent) ahead! Preserving $${myCash} cash to survive.`
                };
            }
        }

        if (CONFIG.ALWAYS_BUY_AFFORDABLE) {
            return {
                buy: true,
                reason: `Acquiring ${tile ? tile.name : 'property'} ($${price})`
            };
        }

        if (!tile || !tile.group) {
            return { buy: true, reason: `Acquiring standard property ($${price})` };
        }

        const mySet = GameMemory.getGroupCount(tile.group, '__ME__');

        // Always buy 2-tile groups (USA, Brazil) or monopoly completers
        if (mySet.owned === mySet.total - 1 || tile.group === 'USA' || tile.group === 'Brazil') {
            return { buy: true, reason: `CRITICAL: Completes ${tile.group} Monopoly!` };
        }

        // High traffic groups (Germany, China, France, Italy)
        if (HIGH_TRAFFIC_GROUPS.has(tile.group)) {
            return { buy: true, reason: `High-Traffic Strategic Asset: ${tile.name} (${tile.group})` };
        }

        const effectiveCash = Math.max(myCash, price);
        if (effectiveCash - price >= reserve * 0.6) {
            return {
                buy: true,
                reason: `EV+ Buy: ${tile.name} ($${price}) | Safe Cash Reserve $${Math.round(reserve)}`
            };
        }

        return {
            buy: false,
            reason: `Preserving survival reserve ($${reserve}) for danger ahead`
        };
    }
};
