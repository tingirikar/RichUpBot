import { GameMemory } from '../memory/gameMemory.js';

/**
 * SOCKET.IO & WEBSOCKET TELEMETRY INTERCEPTOR
 * 
 * Intercepts unsafeWindow.WebSocket at document-start to decode
 * RichUp's native Socket.IO wire protocol (42/api/game,[...])
 */
export function installWebSocketHook() {
    const targetWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (targetWin.__richupWsHooked) return;
    targetWin.__richupWsHooked = true;

    const NativeWS = targetWin.WebSocket;
    if (!NativeWS) return;

    targetWin.WebSocket = function (...args) {
        const ws = new NativeWS(...args);

        // Store active WS instance
        GameMemory.activeSocket = ws;
        console.log('[RichUpBot WS Hook] Native WebSocket intercepted:', args[0]);

        ws.addEventListener('message', (event) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : '';
                if (!raw || raw === '2' || raw === '3') return; // Heartbeat frames

                if (GameMemory.wsMessages.length >= 35) GameMemory.wsMessages.shift();
                GameMemory.wsMessages.push({
                    ts: Date.now(),
                    preview: raw.slice(0, 300)
                });

                parseSocketIOFrame(raw);
            } catch (err) {
                console.warn('[RichUpBot WS Hook] Error parsing message:', err);
            }
        });
        return ws;
    };

    targetWin.WebSocket.prototype = NativeWS.prototype;
    Object.assign(targetWin.WebSocket, NativeWS);

    // Also wrap sandbox window if different
    if (typeof window !== 'undefined' && window !== targetWin) {
        window.__richupWsHooked = true;
        window.WebSocket = targetWin.WebSocket;
    }
}

function parseSocketIOFrame(raw) {
    const bracketIdx = raw.indexOf('[');
    if (bracketIdx === -1) return;

    try {
        const arr = JSON.parse(raw.slice(bracketIdx));
        if (!Array.isArray(arr) || arr.length === 0) return;

        const eventName = String(arr[0] || '').toLowerCase();
        const payload = arr[1] || {};

        GameMemory.wsActive = true;
        GameMemory.wsLastMessageTime = Date.now();

        // 1. Sniff Room Settings & Player Identity at Match Init
        if (
            eventName.includes('game') ||
            eventName.includes('init') ||
            eventName.includes('state') ||
            eventName.includes('room')
        ) {
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
                if (typeof payload.settings.starting_cash === 'number') {
                    GameMemory.roomSettings.startingCash = payload.settings.starting_cash;
                    if (!GameMemory.cashVerified) {
                        GameMemory.myCash = payload.settings.starting_cash;
                    }
                }
            }

            // Immediately promote WebSocket as primary source of truth for player balances and identity
            const myId = payload.myId || payload.my_id || payload.userId || payload.user_id || payload.playerId;
            const playersList = Array.isArray(payload.players) ? payload.players : (Array.isArray(payload.playerList) ? payload.playerList : null);

            if (playersList) {
                const me = myId ? playersList.find(p => p.id === myId || p.userId === myId || p.isMe || p.is_me)
                                : playersList.find(p => p.isMe || p.is_me);
                if (me && (me.name || me.username)) {
                    GameMemory.setMyName(me.name || me.username);
                }

                for (const p of playersList) {
                    const pName = p.name || p.username;
                    if (!pName) continue;
                    const rawMoney = typeof p.money === 'number' ? p.money : 
                                     (typeof p.cash === 'number' ? p.cash : 
                                     (typeof p.balance === 'number' ? p.balance : null));
                    const isThisPlayerMe = GameMemory.isMe(pName) || (myId && p.id === myId) || Boolean(p.isMe || p.is_me);

                    const playerPos = typeof p.position === 'number' ? p.position : 
                                      (typeof p.pos === 'number' ? p.pos : (GameMemory.players[pName]?.pos || 0));

                    if (rawMoney !== null) {
                        GameMemory.players[pName] = {
                            cash: rawMoney,
                            pos: playerPos,
                            inJail: Boolean(p.inJail || p.jailTurns || p.in_jail),
                            isMe: isThisPlayerMe,
                            bankrupt: Boolean(p.bankrupt)
                        };

                        if (isThisPlayerMe) {
                            GameMemory.setMyName(pName);
                            GameMemory.myCash = rawMoney;
                            GameMemory.cashVerified = true;
                            GameMemory.myPos = playerPos;
                            if (typeof p.inJail === 'boolean') GameMemory.inJail = p.inJail;
                        }
                    }
                }
            }
        }

        // 2. Dice Rolled: Only advance myPos if it was MY roll!
        if (eventName.includes('roll') || eventName.includes('dice')) {
            const dice = Array.isArray(payload.dice) ? payload.dice : (Array.isArray(payload) ? payload : []);
            const sum = (dice[0] || 0) + (dice[1] || 0);
            const pName = payload.playerName || payload.username || payload.name || payload.player;
            const isMeRolling = pName ? GameMemory.isMe(pName) : GameMemory.isMyTurn;

            if (isMeRolling && sum > 0) {
                GameMemory.myPos = (GameMemory.myPos + sum) % 40;
            } else if (pName && GameMemory.players[pName]) {
                const currentOppPos = GameMemory.players[pName].pos || 0;
                GameMemory.players[pName].pos = (currentOppPos + sum) % 40;
            }
        }

        // 3. Property Purchases
        if (eventName.includes('purchase') || eventName.includes('buy')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            if (typeof tileId === 'number') {
                GameMemory.lastPurchasedBlock = tileId;
                const buyer = payload.playerName || payload.username || (GameMemory.isMyTurn ? (GameMemory.myName || '__ME__') : null);
                if (buyer && GameMemory.ownership[tileId]) {
                    GameMemory.ownership[tileId].owner = buyer;
                }
            }
        }

        // 4. Turn Ended / Started
        if (eventName.includes('turn')) {
            const active = payload.activePlayer || payload.player || payload.username || payload.name;
            if (active) {
                GameMemory.isMyTurn = GameMemory.isMe(active);
            }
        }

        // Deep sync player stats (cash & positions) across all payloads
        deepSyncFromObject(payload);
    } catch (_) {
        // Ignore JSON parse errors on malformed payloads
    }
}

function deepSyncFromObject(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        obj.forEach(deepSyncFromObject);
        return;
    }

    const name = obj.name || obj.username || obj.playerName || obj.player_name;
    const rawMoney = typeof obj.money === 'number' ? obj.money : 
                     (typeof obj.cash === 'number' ? obj.cash : 
                     (typeof obj.balance === 'number' ? obj.balance : null));

    if (typeof name === 'string' && rawMoney !== null) {
        const isThisPlayerMe = GameMemory.isMe(name) || Boolean(obj.isMe || obj.is_me);

        // If server explicitly says isMe, latch our name
        if (obj.isMe || obj.is_me) {
            GameMemory.setMyName(name);
        }

        const playerPos = typeof obj.position === 'number' ? obj.position : 
                          (typeof obj.pos === 'number' ? obj.pos : (GameMemory.players[name]?.pos || 0));

        GameMemory.players[name] = {
            cash: rawMoney,
            pos: playerPos,
            inJail: Boolean(obj.inJail || obj.jailTurns || obj.in_jail),
            isMe: isThisPlayerMe,
            bankrupt: Boolean(obj.bankrupt)
        };

        if (isThisPlayerMe) {
            GameMemory.myCash = rawMoney;
            GameMemory.cashVerified = true;
            GameMemory.myPos = playerPos;
            if (typeof obj.inJail === 'boolean') GameMemory.inJail = obj.inJail;
        }
    }

    for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object') deepSyncFromObject(obj[k]);
    }
}
