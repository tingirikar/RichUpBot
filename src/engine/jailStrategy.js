import { GameMemory } from '../memory/gameMemory.js';
import { MarkovRisk } from './markovRisk.js';

/**
 * CONTEXT-AWARE JAIL STRATEGY ENGINE
 * 
 * Implements traits:
 * 1. Early game: Rush out immediately to buy unowned properties.
 * 2. Late game:
 *    - If room setting allows rent collection in jail -> stay safe inside!
 *    - If room setting PROHIBITS rent in jail -> check opponent distances:
 *      if opponents are approaching our hotels, exit immediately to collect rent!
 */
export const JailStrategy = {
    shouldPayToLeaveJail(myCash) {
        const totalOpponentHouses = this.countOpponentHouses();

        // 1. BOARD SAFE: If opponents have built 0 houses on the board, there is NO landing danger!
        // Leaving jail allows circling the board to collect +$200 at START!
        if (totalOpponentHouses === 0 && myCash >= 50) {
            GameMemory.lastJailMode = 'SAFE_EXIT';
            return {
                exit: true,
                reason: `Board Safe (0 enemy houses): Leaving cell to circle board & collect +$200 at Start`
            };
        }

        const unownedCount = GameMemory.getUnownedPropertyCount();

        // 2. EARLY GAME: Rush out to buy unowned land
        if (unownedCount >= 4 && myCash >= 50) {
            GameMemory.lastJailMode = 'AGR_EXIT';
            return {
                exit: true,
                reason: `Early Game Land Grab: ${unownedCount} unowned properties remaining on board`
            };
        }

        // 3. LATE GAME EVALUATION
        const prisonPos = GameMemory.prisonBlockIndex ?? 10;
        const dangerOutside = MarkovRisk.analyzeDangerAhead(prisonPos);
        const reserve = MarkovRisk.computeDynamicReserve(prisonPos);
        const canCollectRentInJail = GameMemory.roomSettings.collectRentInJail;

        // If room setting prohibits rent collection in jail:
        if (!canCollectRentInJail) {
            // Check if any opponent is in the strike zone (2-12 tiles away) of ANY of our monopolies
            const opponentsApproachingOurHotels = this.areOpponentsApproachingOurProperties();
            if (opponentsApproachingOurHotels && myCash >= 50) {
                GameMemory.lastJailMode = 'RENT_HUNT_EXIT';
                return {
                    exit: true,
                    reason: `Room Setting Alert: Cannot collect rent in jail! Opponents entering our hotel strike zone.`
                };
            }
        }

        // If rent CAN be collected in jail (standard rules):
        // Only stay in jail if there are serious developed enemy properties ahead!
        if (dangerOutside.expectedLoss1Turn > 60 || dangerOutside.maxDangerWindowLoss > 200) {
            GameMemory.lastJailMode = 'SAFE_STAY';
            return {
                exit: false,
                reason: `Fortress Mode: Safe in Jail collecting rent. High danger ($${dangerOutside.expectedLoss1Turn} EV) outside.`
            };
        }

        // If danger is low and we have the bail money, circle the board for +$200 Start bonus
        if (myCash >= 50 && (myCash - 50 >= reserve * 0.7 || dangerOutside.expectedLoss1Turn < 40)) {
            GameMemory.lastJailMode = 'SAFE_EXIT';
            return {
                exit: true,
                reason: `Board Safe: Low danger EV ($${dangerOutside.expectedLoss1Turn}) ahead. Circling for +$200 Start.`
            };
        }

        GameMemory.lastJailMode = 'SAFE_STAY';
        return {
            exit: false,
            reason: `Preserving $50 cash: Remaining safe in Jail`
        };
    },

    /**
     * Checks if any active opponent is 2 to 12 tiles away from any property
     * we own that has houses built on it.
     */
    areOpponentsApproachingOurProperties() {
        // Collect tile IDs of our developed properties
        const myHotels = [];
        const allTiles = GameMemory.getAllTiles();
        for (const tile of allTiles) {
            const info = GameMemory.ownership[tile.id];
            if (info && GameMemory.isMe(info.owner) && info.houses >= 1) {
                myHotels.push(tile.id);
            }
        }

        if (myHotels.length === 0) return false;

        const bLen = GameMemory.getBoardLength();
        for (const [pName, pData] of Object.entries(GameMemory.players)) {
            if (GameMemory.isMe(pName) || pData.bankrupt || pData.inJail) continue;

            const oppPos = pData.pos || 0;
            for (const hotelTileId of myHotels) {
                const distance = (hotelTileId - oppPos + bLen) % bLen;
                // High probability 2-12 roll window
                if (distance >= 2 && distance <= 12) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Counts the total number of houses and hotels built by all opponents on the board.
     */
    countOpponentHouses() {
        let count = 0;
        const allTiles = GameMemory.getAllTiles();
        for (const tile of allTiles) {
            const info = GameMemory.ownership[tile.id];
            if (info && info.owner && !GameMemory.isMe(info.owner)) {
                count += (info.houses || 0);
            }
        }
        return count;
    }
};
