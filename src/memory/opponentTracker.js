import { BOARD_TILES, GROUP_TILES } from '../data/boardTiles.js';
import { GameMemory } from './gameMemory.js';

/**
 * OPPONENT TRACKER & STRATEGIC INVENTORY ANALYZER
 * 
 * Tracks:
 * 1. Opponent cash & liquidity (can they afford houses right now?)
 * 2. Monopoly Hungry sets (who needs 1 card to complete a set?)
 * 3. Crucial Blockers (cards WE own that we must NEVER give away)
 * 4. Tradable Sacrifices (cards we can offer as sweeteners)
 * 5. Our Missing Monopoly Cards (who holds the key to our win?)
 */
export const OpponentTracker = {
    /**
     * Comprehensive scan of all opponents
     */
    analyzeOpponents() {
        const myName = GameMemory.myName || '__ME__';
        const analysis = {};

        for (const [pName, pData] of Object.entries(GameMemory.players)) {
            if (GameMemory.isMe(pName) || pData.bankrupt) continue;

            const ownedTiles = [];
            const hungrySets = []; // Color groups where opponent has total - 1
            let totalPropertyNetWorth = 0;

            for (const tile of BOARD_TILES) {
                if (!tile.group) continue;
                const info = GameMemory.ownership[tile.id];
                if (info && info.owner === pName) {
                    ownedTiles.push(tile);
                    totalPropertyNetWorth += tile.price;
                }
            }

            // Check each color group for monopoly threats
            for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
                if (tiles[0].type !== 'property') continue;
                const ownedCount = tiles.filter(t => GameMemory.ownership[t.id]?.owner === pName).length;
                if (ownedCount === tiles.length - 1) {
                    const missingTile = tiles.find(t => GameMemory.ownership[t.id]?.owner !== pName);
                    const holder = GameMemory.ownership[missingTile?.id]?.owner || 'Unowned';
                    hungrySets.push({
                        group: groupName,
                        ownedCount,
                        total: tiles.length,
                        missingTile,
                        heldBy: holder,
                        weHoldIt: GameMemory.isMe(holder),
                        houseCost: missingTile?.houseCost || 100,
                        affordableHouses: Math.floor((pData.cash || 0) / (missingTile?.houseCost || 100))
                    });
                }
            }

            analysis[pName] = {
                name: pName,
                cash: pData.cash || 0,
                pos: pData.pos || 0,
                inJail: pData.inJail || false,
                ownedTiles,
                hungrySets,
                totalPropertyNetWorth,
                threatLevel: hungrySets.length > 0 ? (pData.cash > 400 ? 'LETHAL' : 'HIGH') : 'MODERATE'
            };
        }

        return analysis;
    },

    /**
     * Returns a list of properties we own that are actively blocking
     * an opponent from completing a monopoly.
     * RULE: NEVER SELL/TRADE THESE unless we receive an immediate winning monopoly!
     */
    getCriticalBlockers() {
        const blockers = [];
        const opponents = this.analyzeOpponents();

        for (const opp of Object.values(opponents)) {
            for (const hungry of opp.hungrySets) {
                if (hungry.weHoldIt && hungry.missingTile) {
                    blockers.push({
                        tile: hungry.missingTile,
                        blockingOpponent: opp.name,
                        targetGroup: hungry.group,
                        oppCash: opp.cash,
                        threat: hungry.affordableHouses >= 3 ? 'IMMEDIATE_DEATH' : 'HIGH'
                    });
                }
            }
        }
        return blockers;
    },

    /**
     * Identifies the missing card(s) WE need to complete our own monopolies.
     */
    getMyMissingCards() {
        const myMissing = [];

        for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
            if (tiles[0].type !== 'property') continue;
            const myCount = tiles.filter(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner)).length;

            if (myCount === tiles.length - 1) {
                const missing = tiles.find(t => !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
                const holder = GameMemory.ownership[missing.id]?.owner || null;
                myMissing.push({
                    group: groupName,
                    missingTile: missing,
                    heldBy: holder,
                    isUnowned: !holder,
                    houseCost: missing.houseCost,
                    buildCostTo3Houses: missing.houseCost * 3 * tiles.length
                });
            }
        }
        return myMissing;
    },

    /**
     * Assets we own that are SAFE to trade away as sweeteners.
     * Singletons that do NOT complete any opponent's monopoly.
     */
    getSafeTradeSacrifices() {
        const blockers = new Set(this.getCriticalBlockers().map(b => b.tile.id));
        const sacrifices = [];

        for (const tile of BOARD_TILES) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (info && GameMemory.isMe(info.owner) && info.houses === 0 && !blockers.has(tile.id)) {
                const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');
                // Only sacrifice if we don't already have 2/3 of this set
                if (owned < total - 1) {
                    sacrifices.push(tile);
                }
            }
        }
        return sacrifices;
    },

    isBlockerAgainstAnyOpponent(tile) {
        if (!tile || !tile.group) return false;
        const opps = this.analyzeOpponents();
        for (const opp of Object.values(opps)) {
            if (opp.hungrySets.some(h => h.group === tile.group)) {
                return true;
            }
        }
        return false;
    }
};
