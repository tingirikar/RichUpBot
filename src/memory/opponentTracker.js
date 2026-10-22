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

        // Merge all player names from players and ownership
        const playerNames = new Set(Object.keys(GameMemory.players));
        for (const info of Object.values(GameMemory.ownership)) {
            if (info?.owner && !GameMemory.isMe(info.owner)) {
                playerNames.add(info.owner);
            }
        }

        const isSamePlayer = (a, b) => {
            if (!a || !b) return false;
            return a.trim().toLowerCase() === b.trim().toLowerCase();
        };

        for (const pName of playerNames) {
            if (GameMemory.isMe(pName)) continue;
            const pData = GameMemory.players[pName] || { cash: 500, pos: 0, bankrupt: false };
            if (pData.bankrupt) continue;

            const ownedTiles = [];
            const hungrySets = []; // Color groups where opponent has total - 1
            let totalPropertyNetWorth = 0;

            for (const tile of GameMemory.getAllTiles()) {
                if (!tile.group) continue;
                const info = GameMemory.ownership[tile.id];
                if (info && isSamePlayer(info.owner, pName)) {
                    ownedTiles.push(tile);
                    totalPropertyNetWorth += tile.price;
                }
            }

            // Check each color group for monopoly threats
            for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
                if (tiles[0].type !== 'property') continue;
                const ownedCount = tiles.filter(t => isSamePlayer(GameMemory.ownership[t.id]?.owner, pName)).length;
                if (ownedCount === tiles.length - 1) {
                    const missingTile = tiles.find(t => !isSamePlayer(GameMemory.ownership[t.id]?.owner, pName));
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

        for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
            if (tiles[0].type !== 'property' && tiles[0].type !== 'airport') continue;
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
     * Identifies sets where we own 1 card (out of 3) and an opponent owns another card,
     * presenting a consolidation trade opportunity!
     */
    getMyAdvancingNeeds() {
        const needs = [];
        for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
            if (tiles[0].type !== 'property' || tiles.length !== 3) continue;
            const myCount = tiles.filter(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner)).length;
            if (myCount === 1) {
                const myTile = tiles.find(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
                const otherTiles = tiles.filter(t => !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
                for (const other of otherTiles) {
                    const holder = GameMemory.ownership[other.id]?.owner;
                    if (holder && !GameMemory.isMe(holder)) {
                        needs.push({
                            group: groupName,
                            myTile,
                            wantedTile: other,
                            heldBy: holder
                        });
                    }
                }
            }
        }
        return needs;
    },

    /**
     * Assets we own that are SAFE to trade away as sweeteners.
     * Singletons that do NOT complete any opponent's monopoly.
     */
    getSafeTradeSacrifices() {
        const blockers = new Set(this.getCriticalBlockers().map(b => b.tile.id));
        const safe = [];
        const tradable = [];

        for (const tile of GameMemory.getAllTiles()) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (info && GameMemory.isMe(info.owner) && info.houses === 0) {
                const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');
                // Do not trade away complete monopolies or sets where we own total - 1
                if (owned < total - 1) {
                    if (!blockers.has(tile.id)) {
                        safe.push(tile);
                    }
                    tradable.push(tile);
                }
            }
        }
        // Strictly return only safe non-blockers to prevent leaking critical blockers in trades!
        return safe;
    },

    /**
     * All singletons owned (including blockers) - strictly for Mutual Monopoly Swaps where
     * giving away a blocker is justified by immediately completing our own monopoly.
     */
    getAllTradableSingletons() {
        const tradable = [];
        for (const tile of GameMemory.getAllTiles()) {
            if (!tile.group) continue;
            const info = GameMemory.ownership[tile.id];
            if (info && GameMemory.isMe(info.owner) && info.houses === 0) {
                const { owned, total } = GameMemory.getGroupCount(tile.group, '__ME__');
                if (owned < total - 1) {
                    tradable.push(tile);
                }
            }
        }
        return tradable;
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
