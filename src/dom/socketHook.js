import { GameMemory } from '../memory/gameMemory.js';
import { BOARD_TILES } from '../data/boardTiles.js';
import { logToBot } from './actionExecutor.js';

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

                const validNames = new Set();
                for (const p of playersList) {
                    const pName = p.name || p.username;
                    if (!pName) continue;
                    validNames.add(pName);
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

                // Prune any disconnected or stale players not in current room playersList
                if (validNames.size > 0) {
                    for (const existing of Object.keys(GameMemory.players)) {
                        if (!validNames.has(existing)) {
                            delete GameMemory.players[existing];
                        }
                    }
                }
            }
        }

        // Handle player leave/disconnect events
        if (eventName.includes('leave') || eventName.includes('left') || eventName.includes('disconnect')) {
            const pName = payload.playerName || payload.username || payload.name || payload.player;
            if (pName && GameMemory.players[pName] && !GameMemory.isMe(pName)) {
                delete GameMemory.players[pName];
            }
        }

        // 2. Dice Rolled: Strictly advance myPos ONLY if pName is explicitly verified as ME!
        if (eventName.includes('roll') || eventName.includes('dice')) {
            const dice = Array.isArray(payload.dice) ? payload.dice : (Array.isArray(payload) ? payload : []);
            const sum = (dice[0] || 0) + (dice[1] || 0);
            const pName = payload.playerName || payload.username || payload.name || payload.player;

            // NEVER fall back to isMyTurn! Only advance if pName explicitly matches local player!
            if (pName && GameMemory.isMe(pName) && sum > 0) {
                if (!GameMemory.inJail) {
                    GameMemory.myPos = (GameMemory.myPos + sum) % 40;
                    logToBot(`[DICE] 🎲 I rolled ${sum} ([${dice.join(',')}]) -> Moved to Tile #${GameMemory.myPos} (${BOARD_TILES[GameMemory.myPos]?.name || 'Unknown'})`);
                }
            } else if (pName && GameMemory.players[pName]) {
                if (!GameMemory.players[pName].inJail && sum > 0) {
                    const currentOppPos = GameMemory.players[pName].pos || 0;
                    GameMemory.players[pName].pos = (currentOppPos + sum) % 40;
                    logToBot(`[DICE] 🎲 ${pName} rolled ${sum} -> Tile #${GameMemory.players[pName].pos}`);
                }
            }
        }

        // 3. Property Purchases: Strictly assign owner ONLY if pName is explicitly verified!
        if (eventName.includes('purchase') || eventName.includes('buy')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            const pName = payload.playerName || payload.username || payload.name || payload.player;

            if (typeof tileId === 'number' && pName) {
                GameMemory.lastPurchasedBlock = tileId;
                const isMe = GameMemory.isMe(pName);
                const buyer = isMe ? (GameMemory.myName || '__ME__') : pName;
                if (GameMemory.ownership[tileId]) {
                    GameMemory.ownership[tileId].owner = buyer;
                    logToBot(`[WS TELEMETRY] 🏷️ Tile #${tileId} (${BOARD_TILES[tileId]?.name || 'Unknown'}) acquired by ${buyer}`);
                }
            }
        }

        // 4. Auctions: Update owner when auction is won
        if (eventName.includes('auction')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            const winner = payload.winner || payload.playerName || payload.username || payload.name || payload.player;
            if (typeof tileId === 'number' && winner && GameMemory.ownership[tileId]) {
                const isMe = GameMemory.isMe(winner);
                const buyer = isMe ? (GameMemory.myName || '__ME__') : winner;
                GameMemory.ownership[tileId].owner = buyer;
                logToBot(`[WS TELEMETRY] 🔨 Tile #${tileId} won at auction by ${buyer}`);
            }
        }

        // 5. House / Hotel / Build / Upgrade Events
        if (eventName.includes('house') || eventName.includes('hotel') || eventName.includes('build') || eventName.includes('upgrade')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            if (typeof tileId === 'number' && GameMemory.ownership[tileId]) {
                const houses = payload.houses ?? payload.count ?? payload.level ?? payload.houseCount;
                if (typeof houses === 'number') {
                    GameMemory.ownership[tileId].houses = Math.max(0, Math.min(5, houses));
                } else if (eventName.includes('hotel')) {
                    GameMemory.ownership[tileId].houses = 5;
                } else {
                    GameMemory.ownership[tileId].houses = Math.min(5, (GameMemory.ownership[tileId].houses || 0) + 1);
                }
                logToBot(`[WS TELEMETRY] 🏠 Tile #${tileId} houses updated -> ${GameMemory.ownership[tileId].houses}/5`);
            }
        }

        // 6. Mortgage / Unmortgage Events
        if (eventName.includes('mortgage')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            const isUn = eventName.includes('unmortgage');
            if (typeof tileId === 'number' && GameMemory.ownership[tileId]) {
                GameMemory.ownership[tileId].mortgaged = !isUn;
                logToBot(`[WS TELEMETRY] 🏦 Tile #${tileId} ${isUn ? 'unmortgaged' : 'mortgaged'}`);
            }
        }

        // 7. Bankruptcy: Clear assets of bankrupt player
        if (eventName.includes('bankrupt')) {
            const pName = payload.playerName || payload.username || payload.name || payload.player;
            if (pName) {
                logToBot(`[WS TELEMETRY] ⚠️ ${pName} declared bankruptcy. Assets released.`);
                for (const id of Object.keys(GameMemory.ownership)) {
                    if (GameMemory.ownership[id].owner === pName) {
                        GameMemory.ownership[id].owner = null;
                        GameMemory.ownership[id].houses = 0;
                        GameMemory.ownership[id].mortgaged = false;
                    }
                }
            }
        }

        // 8. Turn Ended / Started
        if (eventName.includes('turn')) {
            const active = payload.activePlayer || payload.player || payload.username || payload.name;
            if (active) {
                GameMemory.isMyTurn = GameMemory.isMe(active);
            }
        }

        // Deep sync player stats (cash & positions) across all payloads
        deepSyncFromObject(payload);

        // Deep sync property board state (ownership, houses, mortgages) across all payloads
        deepSyncPropertiesFromPayload(payload);
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

/**
 * Ingests full board state arrays, properties, and blocks from WebSocket match payloads
 */
function deepSyncPropertiesFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    // Player ID to Name lookup map
    const playerMap = new Map();
    for (const name of Object.keys(GameMemory.players)) {
        playerMap.set(name, name);
    }
    const playersList = Array.isArray(payload.players) ? payload.players : (Array.isArray(payload.playerList) ? payload.playerList : null);
    if (playersList) {
        for (const p of playersList) {
            const pName = p.name || p.username;
            const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;
            if (pName) {
                if (pId !== undefined) playerMap.set(String(pId), pName);
                playerMap.set(pName, pName);
            }
        }
    }

    const resolveOwner = (raw) => {
        if (raw === null || raw === undefined || raw === false || raw === '') return null;
        if (typeof raw === 'string') {
            if (playerMap.has(raw)) return playerMap.get(raw);
            if (GameMemory.isMe(raw)) return GameMemory.myName || '__ME__';
            return raw;
        }
        if (typeof raw === 'number' && playerMap.has(String(raw))) {
            return playerMap.get(String(raw));
        }
        if (typeof raw === 'object' && (raw.name || raw.username)) {
            return raw.name || raw.username;
        }
        return null;
    };

    const visited = new Set();

    const scan = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 5 || visited.has(obj)) return;
        visited.add(obj);

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i];
                if (!item) continue;

                if (typeof item === 'string' && obj.length >= 35 && i < 40 && GameMemory.ownership[i]) {
                    const resolved = resolveOwner(item);
                    if (resolved) GameMemory.ownership[i].owner = resolved;
                    continue;
                }

                if (typeof item === 'object') {
                    const tileId = typeof item.blockIndex === 'number' ? item.blockIndex : 
                                   (typeof item.tileId === 'number' ? item.tileId : 
                                   (typeof item.index === 'number' ? item.index : (typeof item.id === 'number' && item.id < 40 ? item.id : null)));

                    const targetId = tileId !== null ? tileId : (obj.length >= 35 && i < 40 ? i : null);

                    if (targetId !== null && GameMemory.ownership[targetId]) {
                        if (item.owner !== undefined || item.ownerName !== undefined || item.ownerId !== undefined || item.userId !== undefined) {
                            const rawOwner = item.owner ?? item.ownerName ?? item.ownerId ?? item.userId;
                            GameMemory.ownership[targetId].owner = resolveOwner(rawOwner);
                        }
                        if (typeof item.houses === 'number') {
                            GameMemory.ownership[targetId].houses = Math.max(0, Math.min(5, item.houses));
                        } else if (item.hotel) {
                            GameMemory.ownership[targetId].houses = 5;
                        }
                        if (typeof item.mortgaged === 'boolean') {
                            GameMemory.ownership[targetId].mortgaged = item.mortgaged;
                        } else if (typeof item.isMortgaged === 'boolean') {
                            GameMemory.ownership[targetId].mortgaged = item.isMortgaged;
                        }
                    }
                }
            }
            return;
        }

        if (obj.properties || obj.tiles || obj.blocks || obj.board) {
            scan(obj.properties || obj.tiles || obj.blocks || obj.board, depth + 1);
        }

        for (const k of Object.keys(obj)) {
            if (typeof obj[k] === 'object' && obj[k] !== null && k !== 'processedLogs' && k !== 'wsMessages') {
                scan(obj[k], depth + 1);
            }
        }
    };

    scan(payload);
}
