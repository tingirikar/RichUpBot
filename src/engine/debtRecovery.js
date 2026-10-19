import { BOARD_TILES } from '../data/boardTiles.js';
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

        for (const tile of BOARD_TILES) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (!info || !GameMemory.isMe(info.owner) || info.mortgaged) continue;

            const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');

            // Strategic sacrifice score: lower score = liquidate FIRST
            let sacrificeScore = tile.price * (1 + tile.markov * 10);

            // Never sacrifice complete monopolies unless literally going bankrupt
            if (owned === total) {
                sacrificeScore *= 10.0;
            } else if (owned === total - 1) {
                sacrificeScore *= 4.0;
            }

            // Defend critical blockers against opponent monopolies
            if (blockers.has(tile.id)) {
                sacrificeScore *= 5.0;
            }

            // If it has houses, calculate house refund value
            const mortgageValue = Math.round(tile.price / 2);
            const houseSellValue = Math.round(tile.houseCost / 2);

            targets.push({
                tile,
                houses: info.houses,
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
    }
};

