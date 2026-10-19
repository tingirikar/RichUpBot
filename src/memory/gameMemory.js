import { BOARD_TILES, GROUP_TILES, BOARD_LABELS_BLACKLIST } from '../data/boardTiles.js';
import { CONFIG } from '../config.js';

/**
 * LIVE IN-MEMORY GAME STATE STORE
 */
export const GameMemory = {
    // Identity
    myName: localStorage.getItem('richup_bot_my_name') || null,
    myCash: 1500,
    cashVerified: false,
    myPos: 0,
    inJail: false,
    jailTurns: 0,
    turnCount: 0,
    isMyTurn: false,

    // Room Settings (Sniffed from match start or DOM)
    roomSettings: {
        collectRentInJail: true,    // RichUp default: players can collect rent in jail
        doubleOnStart: false,       // Landing on Start gives $400?
        passStartBonus: 200,        // Standard pass start bonus
        auctionsEnabled: true       // Auctions allowed?
    },

    // All active players: name -> { cash, pos, inJail, isMe, bankrupt }
    players: {},

    // Tile ownership: tileId -> { owner, houses, mortgaged }
    ownership: {},

    // Diagnostic & tracking logs
    processedLogs: new Set(),
    wsMessages: [],
    lastPurchasedBlock: null,
    lastDangerEV: 0,
    lastDynamicReserve: CONFIG.BASE_MIN_RESERVE,
    lastJailMode: 'AGR_EXIT',
    lastTradeVerdict: 'READY',

    setMyName(name) {
        if (!name || typeof name !== 'string') return;
        const trimmed = name.trim();
        if (!trimmed) return;
        if (BOARD_LABELS_BLACKLIST.has(trimmed.toLowerCase())) return;
        this.myName = trimmed;
        try {
            localStorage.setItem('richup_bot_my_name', trimmed);
        } catch (_) {}
    },

    isMe(playerName) {
        if (!playerName) return false;
        if (this.myName && playerName.toLowerCase() === this.myName.toLowerCase()) return true;
        if (playerName === '__ME__') return true;
        return false;
    },

    reset() {
        this.myCash = 1500;
        this.cashVerified = false;
        this.myPos = 0;
        this.inJail = false;
        this.jailTurns = 0;
        this.turnCount = 0;
        this.isMyTurn = false;
        this.players = {};
        this.ownership = {};
        BOARD_TILES.forEach(t => {
            if (t.group) {
                this.ownership[t.id] = { owner: null, houses: 0, mortgaged: false };
            }
        });
        this.processedLogs.clear();
    },

    getGroupCount(groupName, ownerName) {
        const tiles = GROUP_TILES[groupName] || [];
        let count = 0;
        for (const t of tiles) {
            const info = this.ownership[t.id];
            if (!info || !info.owner) continue;
            if (ownerName === '__ME__' ? this.isMe(info.owner) : info.owner === ownerName) {
                count++;
            }
        }
        return { owned: count, total: tiles.length };
    },

    getUnownedPropertyCount() {
        let unowned = 0;
        for (const t of BOARD_TILES) {
            if (t.group && (!this.ownership[t.id] || !this.ownership[t.id].owner)) {
                unowned++;
            }
        }
        return unowned;
    },

    getTileCurrentRent(tileId, visitorName = null) {
        const tile = BOARD_TILES[tileId];
        if (!tile) return 0;
        if (tile.type === 'tax') return tile.rent[0] || 0;
        if (!tile.group) return 0;

        const info = this.ownership[tileId];
        if (!info || !info.owner || info.mortgaged) return 0;

        // If I own it, I don't pay rent to myself!
        if (this.isMe(info.owner)) return 0;

        // If checking for a specific visitor who owns it, they don't pay rent
        if (visitorName && info.owner === visitorName) return 0;

        const { owned, total } = this.getGroupCount(tile.group, info.owner);

        // Check if owner is in jail and room setting prohibits rent in jail
        if (!this.roomSettings.collectRentInJail) {
            const ownerPlayer = this.players[info.owner];
            if (ownerPlayer && ownerPlayer.inJail) return 0;
        }

        if (tile.type === 'airport') {
            return tile.rent[Math.max(0, Math.min(owned - 1, 3))] || 25;
        }
        if (tile.type === 'utility') {
            return owned >= 2 ? 70 : 28;
        }
        if (info.houses > 0) {
            return tile.rent[Math.min(info.houses, 5)] || tile.rent[0];
        }
        return owned === total ? tile.rent[0] * 2 : tile.rent[0];
    }
};

GameMemory.reset();
