import { GameMemory } from '../memory/gameMemory.js';

/**
 * SOCKET.IO & WEBSOCKET TELEMETRY INTERCEPTOR
 * 
 * Intercepts window.WebSocket at document-start to decode
 * RichUp's native Socket.IO wire protocol (42/api/game,[...])
 */
export function installWebSocketHook() {
    if (window.__richupWsHooked) return;
    window.__richupWsHooked = true;

    const NativeWS = window.WebSocket;
    if (!NativeWS) return;

    window.WebSocket = function (...args) {
        const ws = new NativeWS(...args);
        ws.addEventListener('message', (event) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : '';
                if (!raw || raw === '2' || raw === '3') return; // Ignore heartbeat frames

                if (GameMemory.wsMessages.length >= 25) GameMemory.wsMessages.shift();
                GameMemory.wsMessages.push({
                    ts: Date.now(),
                    preview: raw.slice(0, 300)
                });

                parseSocketIOFrame(raw);
            } catch (_) {
                // Ignore binary/unparseable frames
            }
        });
        return ws;
    };

    window.WebSocket.prototype = NativeWS.prototype;
    Object.assign(window.WebSocket, NativeWS);
}

function parseSocketIOFrame(raw) {
    const bracketIdx = raw.indexOf('[');
    if (bracketIdx === -1) return;

    try {
        const arr = JSON.parse(raw.slice(bracketIdx));
        if (!Array.isArray(arr) || arr.length === 0) return;

        const eventName = arr[0];
        const payload = arr[1] || {};

        // 1. Sniff Room Settings & Player Identity at Match Init
        if (eventName === 'game-started' || eventName === 'init-game' || eventName === 'game-state') {
            if (payload.settings) {
                if (typeof payload.settings.can_collect_rent_in_jail === 'boolean') {
                    GameMemory.roomSettings.collectRentInJail = payload.settings.can_collect_rent_in_jail;
                }
                if (typeof payload.settings.double_on_start === 'boolean') {
                    GameMemory.roomSettings.doubleOnStart = payload.settings.double_on_start;
                }
                if (typeof payload.settings.pass_start_bonus === 'number') {
                    GameMemory.roomSettings.passStartBonus = payload.settings.pass_start_bonus;
                }
            }

            // Detect my player name if provided in initialization packet
            if (payload.myId && Array.isArray(payload.players)) {
                const me = payload.players.find(p => p.id === payload.myId || p.isMe);
                if (me && me.name) {
                    GameMemory.setMyName(me.name);
                }
            }
        }

        // 2. Dice Rolled: Only advance myPos if it was MY roll!
        if (eventName === 'dice-rolled' && Array.isArray(payload.dice)) {
            const sum = (payload.dice[0] || 0) + (payload.dice[1] || 0);
            const isMeRolling = payload.playerName ? GameMemory.isMe(payload.playerName) : GameMemory.isMyTurn;

            if (isMeRolling && sum > 0) {
                GameMemory.myPos = (GameMemory.myPos + sum) % 40;
            } else if (payload.playerName && GameMemory.players[payload.playerName]) {
                const currentOppPos = GameMemory.players[payload.playerName].pos || 0;
                GameMemory.players[payload.playerName].pos = (currentOppPos + sum) % 40;
            }
        }

        // 3. Property Purchases
        if (eventName === 'purchase-success' && typeof payload.blockIndex === 'number') {
            const tileId = payload.blockIndex;
            GameMemory.lastPurchasedBlock = tileId;
            const buyer = payload.playerName || (GameMemory.isMyTurn ? (GameMemory.myName || '__ME__') : null);
            if (buyer && GameMemory.ownership[tileId]) {
                GameMemory.ownership[tileId].owner = buyer;
            }
        }

        // 4. Turn Ended
        if (eventName === 'turn-ended' || eventName === 'turn-start') {
            if (payload.activePlayer) {
                GameMemory.isMyTurn = GameMemory.isMe(payload.activePlayer);
            }
        }

        // Deep sync player stats (cash & positions)
        deepSyncFromObject(payload);
    } catch (_) {
        // Ignore JSON parse errors
    }
}

function deepSyncFromObject(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        obj.forEach(deepSyncFromObject);
        return;
    }

    if (typeof obj.name === 'string' && typeof obj.money === 'number') {
        const isThisPlayerMe = GameMemory.isMe(obj.name);

        GameMemory.players[obj.name] = {
            cash: obj.money,
            pos: typeof obj.position === 'number' ? obj.position : (GameMemory.players[obj.name]?.pos || 0),
            inJail: Boolean(obj.inJail || obj.jailTurns),
            isMe: isThisPlayerMe,
            bankrupt: Boolean(obj.bankrupt)
        };

        if (isThisPlayerMe) {
            GameMemory.myCash = obj.money;
            GameMemory.cashVerified = true;
            if (typeof obj.position === 'number') GameMemory.myPos = obj.position;
            if (typeof obj.inJail === 'boolean') GameMemory.inJail = obj.inJail;
        }
    }

    for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object') deepSyncFromObject(obj[k]);
    }
}
