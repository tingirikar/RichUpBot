import { GameMemory } from '../memory/gameMemory.js';
import { MarkovRisk } from './markovRisk.js';
import { CONFIG } from '../config.js';

/**
 * MARGINAL ROI HOUSE BUILDER & AMBUSH TIMING ENGINE
 * 
 * Rules:
 * 1. NEVER build houses if we are standing in the 2-12 landing zone of enemy hotels!
 *    (Preserve cash to survive the crossing).
 * 2. AMBUSH TIMING: Trigger builds when opponents enter the 2-12 strike zone of our set,
 *    or when we have a massive safe cash surplus.
 * 3. 3-House Sweet Spot: Rushes from 2 to 3 houses (steepest rent jump).
 */
export const HouseBuilder = {
    /**
     * Checks if we are currently standing within 2 to 12 tiles of any opponent
     * property that has 3+ houses or a hotel.
     */
    isPlayerInEnemyHotelZone() {
        const myPos = GameMemory.myPos || 0;

        const bLen = GameMemory.getBoardLength();
        for (let roll = 2; roll <= 12; roll++) {
            const targetTileId = (myPos + roll) % bLen;
            const tile = GameMemory.getTile(targetTileId);
            if (!tile || !tile.group) continue;

            const info = GameMemory.ownership[targetTileId];
            // If owned by opponent and heavily developed (3+ houses or hotel)
            if (info && !GameMemory.isMe(info.owner) && info.houses >= 3 && !info.mortgaged) {
                const rent = tile.rent[info.houses] || 0;
                if (rent > 250) {
                    return { inDanger: true, tile, rent, distance: roll };
                }
            }
        }
        return { inDanger: false };
    },

    /**
     * Checks if any active opponent is currently 2 to 12 tiles away
     * from any tile in the given color group.
     */
    areOpponentsInStrikeZone(groupTiles) {
        const tileIds = new Set(groupTiles.map(t => t.id));

        const bLen = GameMemory.getBoardLength();
        for (const [pName, pData] of Object.entries(GameMemory.players)) {
            if (GameMemory.isMe(pName) || pData.bankrupt || pData.inJail) continue;

            const oppPos = pData.pos || 0;
            for (const tileId of tileIds) {
                const dist = (tileId - oppPos + bLen) % bLen;
                if (dist >= 2 && dist <= 12) {
                    return { oppApproaching: true, opponentName: pName, distance: dist };
                }
            }
        }
        return { oppApproaching: false };
    },

    rankHouseUpgrades(myCash) {
        const reserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
        const candidates = [];

        // Check 1: Cash floor
        if (myCash <= reserve) return candidates;

        // Check 2: HOTEL AMBUSH RULE
        // If we are currently facing enemy hotels right in front of us, DO NOT BUILD!
        if (CONFIG.AMBUSH_BUILD_ONLY) {
            const dangerCheck = this.isPlayerInEnemyHotelZone();
            if (dangerCheck.inDanger) {
                // We are in the minefield! Hold all cash to survive!
                return candidates;
            }
        }

        for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
            if (tiles[0].type !== 'property') continue;

            const { owned, total } = GameMemory.getGroupCount(groupName, '__ME__');
            if (owned !== total) continue; // Only build on complete monopolies!

            const anyMortgaged = tiles.some(t => GameMemory.ownership[t.id]?.mortgaged);
            if (anyMortgaged) continue;

            // Enforce even building rule
            const houseCounts = tiles.map(t => GameMemory.ownership[t.id]?.houses || 0);
            const minHouses = Math.min(...houseCounts);

            // Ambush Timing Check: Are opponents in our strike zone?
            const strikeCheck = this.areOpponentsInStrikeZone(tiles);
            const isAmbushWindow = strikeCheck.oppApproaching;
            // The 3-house rush is the critical inflection point in Monopoly rent (spikes 400%-800%)
            const isRushingTo3Houses = minHouses < 3;
            const hasSufficientSurplus = isRushingTo3Houses ? (myCash >= reserve + tiles[0].houseCost * 1.2) : (myCash >= reserve + 300);

            // If Ambush Build is on, only build when opponents are near OR we have sufficient surplus
            if (CONFIG.AMBUSH_BUILD_ONLY && !isAmbushWindow && !hasSufficientSurplus) {
                continue;
            }

            for (const tile of tiles) {
                const info = GameMemory.ownership[tile.id];
                if (!info || info.houses >= 5) continue;
                if (info.houses > minHouses) continue; // Even building constraint

                const cost = tile.houseCost;
                if (myCash - cost < reserve) continue; // Must respect survival cash reserve

                const currentRent = tile.rent[info.houses];
                const nextRent = tile.rent[info.houses + 1] || currentRent;
                const rentDelta = nextRent - currentRent;

                // Boost for 3 houses + boost for ambush timing
                const sweetSpotBoost = info.houses === 2 ? 2.6 : (info.houses === 1 ? 1.5 : 1.0);
                const ambushBoost = isAmbushWindow ? 1.8 : 1.0;
                const roi = ((rentDelta / cost) * tile.markov * sweetSpotBoost * ambushBoost).toFixed(4);

                candidates.push({
                    tile,
                    currentHouses: info.houses,
                    nextHouses: info.houses + 1,
                    cost,
                    rentDelta,
                    roi: parseFloat(roi),
                    isAmbush: isAmbushWindow,
                    targetOpp: strikeCheck.opponentName || null
                });
            }
        }

        candidates.sort((a, b) => b.roi - a.roi);
        return candidates;
    }
};
