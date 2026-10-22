import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';

/**
 * OPTIMAL DEBT RECOVERY & LIQUIDATION ENGINE
 * 
 * Orders owned assets by Strategic Sacrifice Value so we liquidate
 * low-value singletons first to preserve high-yield monopolies.
 */
export const DebtRecovery = {
    rankLiquidationTargets() {
        const targets = [];
        const blockers = new Set(OpponentTracker.getCriticalBlockers().map(b => b.tile.id));

        // Calculate max houses per group for Even Build compliance
        const groupMaxHouses = {};
        for (const tile of GameMemory.getAllTiles()) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (info && GameMemory.isMe(info.owner)) {
                groupMaxHouses[tile.group] = Math.max(groupMaxHouses[tile.group] || 0, info.houses || 0);
            }
        }

        for (const tile of GameMemory.getAllTiles()) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (!info || !GameMemory.isMe(info.owner) || info.mortgaged) continue;

            const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');
            const groupMax = groupMaxHouses[tile.group] || 0;

            // In RichUp / Monopoly rules:
            // 1. If a group has ANY houses (groupMax > 0), no property in that group can be mortgaged until ALL houses are sold.
            // 2. Under Even Build, you can ONLY sell a house from a property if it has the MAXIMUM number of houses in that group.
            const canSellHouse = info.houses > 0 && info.houses === groupMax;
            const canMortgage = info.houses === 0 && groupMax === 0;

            // Skip properties that currently cannot be mortgaged or downgraded due to sibling houses
            if (!canSellHouse && !canMortgage) continue;

            // Strategic sacrifice score: lower score = liquidate FIRST
            let sacrificeScore = tile.price * (1 + tile.markov * 10);

            // Never sacrifice complete monopolies unless literally forced
            if (owned === total) {
                sacrificeScore *= 10.0;
            } else if (owned === total - 1) {
                sacrificeScore *= 4.0;
            }

            // Defend critical blockers against opponent monopolies
            if (blockers.has(tile.id)) {
                sacrificeScore *= 5.0;
            }

            // If it can sell a house, selling a house preserves property title ownership
            if (canSellHouse) {
                // Adjust score so house sales on monopolies are considered before mortgaging vital singletons
                sacrificeScore = Math.min(sacrificeScore, 280 + tile.houseCost * 0.5);
            }

            const mortgageValue = Math.round(tile.price / 2);
            const houseSellValue = Math.round(tile.houseCost / 2);

            targets.push({
                tile,
                houses: info.houses,
                canSellHouse,
                canMortgage,
                mortgageValue,
                houseSellValue,
                sacrificeScore
            });
        }

        // Sort ascending: lowest sacrifice first
        targets.sort((a, b) => a.sacrificeScore - b.sacrificeScore);
        return targets;
    },

    /**
     * Finds safe, dead-weight properties that can be strategically mortgaged
     * to raise immediate cash for high-yield monopoly building.
     */
    findStrategicMortgageCandidates() {
        const targets = this.rankLiquidationTargets();
        return targets.filter(t => t.houses === 0 && t.sacrificeScore < 300);
    },

    /**
     * Identifies mortgaged properties owned by local player that can be
     * safely unmortgaged when cash is surplus.
     */
    rankUnmortgageCandidates(myCash, reserve) {
        const candidates = [];
        for (const tile of GameMemory.getAllTiles()) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (!info || !GameMemory.isMe(info.owner) || !info.mortgaged) continue;

            // In RichUp, unmortgaging costs mortgage value + 10% interest (55% of property price)
            const unmortgageCost = Math.round(tile.price * 0.55);
            if (myCash - unmortgageCost < reserve + 120) continue; // Must maintain safety cash buffer

            const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');
            let priority = tile.price * (1 + tile.markov * 8);

            // Top priority: unmortgaging a monopoly piece unlocks house construction!
            if (owned === total) {
                priority *= 12.0;
            } else if (owned === total - 1) {
                priority *= 4.0;
            } else if (tile.type === 'airport') {
                priority *= 3.0;
            }

            candidates.push({
                tile,
                unmortgageCost,
                priority
            });
        }

        candidates.sort((a, b) => b.priority - a.priority);
        return candidates;
    }
};

