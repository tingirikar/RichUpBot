import { GameMemory } from '../memory/gameMemory.js';
import { logToBot } from './actionExecutor.js';

/**
 * SOCKET.IO & WEBSOCKET TELEMETRY INTERCEPTOR
 * 
 * Intercepts unsafeWindow.WebSocket at document-start to decode
 * RichUp's native Socket.IO wire protocol (42/api/game,[...])
 */
let onSocketMessageCallback = null;
export function setSocketMessageCallback(fn) {
    onSocketMessageCallback = fn;
}

/**
 * Direct Zero-UI Action Dispatcher
 * Sends actions straight to the backend game server over the live WebSocket.
 */
export function sendSocketAction(eventName, payload) {
    const ws = GameMemory.activeSocket;
    if (!ws || ws.readyState !== 1) { // 1 = WebSocket.OPEN
        return false;
    }

    // Strictly ensure prefix has no trailing digits from previous ACKs (e.g. '42/api/game,')
    let prefix = GameMemory.socketPrefix || '42/api/game,';
    prefix = prefix.replace(/(,\d+)$/, ',');
    if (!prefix.includes('/api/game')) prefix = '42/api/game,';
    GameMemory.socketPrefix = prefix;

    const body = payload !== undefined ? payload : {};
    const packet = `${prefix}${JSON.stringify([eventName, body])}`;
    logToBot(`[ZERO-UI WS] 🚀 Sent: ${eventName} ${JSON.stringify(body)}`);
    ws.send(packet);
    return true;
}

/**
 * Forces a full authoritative game state resync from the server.
 * RichUp wire protocol secret: sending { snapshot: "" } triggers instant sync-game-state!
 */
export function requestFullStateResync() {
    logToBot(`[PROTOCOL] 🔄 Requesting authoritative game state resync from server...`);
    return sendSocketAction('request-sync', { snapshot: '' });
}

export function getPlayerIdByName(name) {
    if (!name) return null;
    const cleanTarget = String(name).replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '').replace(/[->\]\[→←\|👑:]/g, '').replace(/[^\w\s-]/g, '').trim().toLowerCase();
    for (const [pName, pData] of Object.entries(GameMemory.players)) {
        const cleanName = String(pName).replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '').replace(/[->\]\[→←\|👑:]/g, '').replace(/[^\w\s-]/g, '').trim().toLowerCase();
        if (cleanName === cleanTarget && pData?.id !== undefined) {
            return pData.id;
        }
    }
    return null;
}

function hookSocketInstance(ws) {
    if (!ws || ws.__richupSendHooked) return;
    ws.__richupSendHooked = true;
    GameMemory.activeSocket = ws;

    const origSend = ws.send;
    ws.send = function (data) {
        try {
            const raw = typeof data === 'string' ? data : '';
            if (raw && raw !== '2' && raw !== '3') {
                console.log('%c[OUTGOING WS FRAME]', 'color: #38bdf8; font-weight: bold;', raw);
                if (!GameMemory.wsOutgoing) GameMemory.wsOutgoing = [];
                if (GameMemory.wsOutgoing.length >= 50) GameMemory.wsOutgoing.shift();
                GameMemory.wsOutgoing.push({
                    ts: Date.now(),
                    raw
                });
                logToBot(`[WS OUTGOING] 📤 ${raw.slice(0, 140)}`);
                parseOutgoingSocketIOFrame(raw);
            }
        } catch (err) {
            console.warn('[RichUpBot WS Hook] Error in ws.send hook:', err);
        }
        return origSend.apply(this, arguments);
    };
}

function parseOutgoingSocketIOFrame(raw) {
    if (!raw || typeof raw !== 'string') return;
    const bracketIdx = raw.indexOf('[');
    if (bracketIdx === -1) return;

    // Sniff prefix (e.g. "42/api/game,") - strip any trailing digits after comma
    let prefix = raw.slice(0, bracketIdx);
    if (prefix) {
        prefix = prefix.replace(/(,\d+)$/, ',');
        if (!prefix.includes('/api/game')) prefix = '42/api/game,';
        GameMemory.socketPrefix = prefix;
    }

    try {
        const arr = JSON.parse(raw.slice(bracketIdx));
        if (!Array.isArray(arr) || arr.length === 0) return;

        const eventName = arr[0];
        const payload = arr[1];

        logToBot(`[WS ACTION DETECTED] Event: "${eventName}" Payload: ${JSON.stringify(payload)}`);
        console.log('[RICHUP OUTGOING ACTION]', { eventName, payload, prefix });
    } catch (_) {}
}

export function installWebSocketHook() {
    const targetWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (targetWin.__richupWsHooked) return;
    targetWin.__richupWsHooked = true;

    const NativeWS = targetWin.WebSocket;
    if (!NativeWS) return;

    targetWin.WebSocket = function (...args) {
        const ws = new NativeWS(...args);

        // Store active WS instance and hook send
        hookSocketInstance(ws);
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

    // Also hook NativeWS.prototype.send to catch sockets created before or outside wrapper
    const origProtoSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function (data) {
        try {
            hookSocketInstance(this);
            const raw = typeof data === 'string' ? data : '';
            if (raw && raw !== '2' && raw !== '3') {
                console.log('%c[OUTGOING WS PROTO FRAME]', 'color: #38bdf8; font-weight: bold;', raw);
                if (!GameMemory.wsOutgoing) GameMemory.wsOutgoing = [];
                if (GameMemory.wsOutgoing.length >= 50) GameMemory.wsOutgoing.shift();
                GameMemory.wsOutgoing.push({
                    ts: Date.now(),
                    raw
                });
                parseOutgoingSocketIOFrame(raw);
            }
        } catch (_) {}
        return origProtoSend.apply(this, arguments);
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

        // 1. Sniff Room Settings & Player Identity at Match Init / Sync
        if (
            eventName.includes('game') ||
            eventName.includes('init') ||
            eventName.includes('state') ||
            eventName.includes('room')
        ) {
            const gs = payload.gameState || payload.room || payload;
            const settings = gs.settings || payload.settings;

            if (settings) {
                if (typeof settings.can_collect_rent_in_jail === 'boolean') {
                    GameMemory.roomSettings.collectRentInJail = settings.can_collect_rent_in_jail;
                }
                if (typeof settings.double_on_start === 'boolean') {
                    GameMemory.roomSettings.doubleOnStart = settings.double_on_start;
                }
                if (typeof settings.pass_start_bonus === 'number') {
                    GameMemory.roomSettings.passStartBonus = settings.pass_start_bonus;
                }
                if (typeof settings.startingCash === 'number') {
                    GameMemory.roomSettings.startingCash = settings.startingCash;
                } else if (typeof settings.starting_cash === 'number') {
                    GameMemory.roomSettings.startingCash = settings.starting_cash;
                }
                if (GameMemory.roomSettings.startingCash && !GameMemory.cashVerified) {
                    GameMemory.myCash = GameMemory.roomSettings.startingCash;
                }
            }

            // Immediately promote WebSocket as primary source of truth for player balances and identity
            const myId = payload.selfParticipantId || payload.myId || payload.my_id || payload.userId || payload.user_id || payload.playerId;
            if (myId) {
                GameMemory.myId = myId;
            }
            const playersList = Array.isArray(gs.participants) ? gs.participants :
                                (Array.isArray(payload.participants) ? payload.participants :
                                (Array.isArray(gs.players) ? gs.players : 
                                (Array.isArray(payload.playerList) ? payload.playerList : null)));

            if (playersList) {
                const me = myId ? playersList.find(p => p.id === myId || p.userId === myId || p.isMe || p.is_me)
                                : playersList.find(p => p.isMe || p.is_me);
                if (me && (me.name || me.username)) {
                    GameMemory.setMyName(me.name || me.username);
                }
                if (me?.clock?.autoActedTurns !== undefined) {
                    GameMemory.autoActedTurns = me.clock.autoActedTurns;
                }

                // Ingest Universal Board Map from gs.blocks & boardConfig
                if (Array.isArray(gs.blocks) && gs.blocks.length > 0) {
                    GameMemory.boardLength = gs.blocks.length;

                    const cfg = gs.boardConfig || {};
                    GameMemory.prisonBlockIndex = cfg.prisonBlockIndex ?? 
                        (gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'prison') !== -1 
                            ? gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'prison') : 10);
                    GameMemory.vacationBlockIndex = cfg.vacationBlockIndex ?? 
                        (gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'vacation') !== -1 
                            ? gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'vacation') : 20);
                    GameMemory.goToPrisonBlockIndex = cfg.goToPrisonBlockIndex ?? 
                        (gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'go-to-prison') !== -1 
                            ? gs.blocks.findIndex(b => b.type === 'corner' && b.cornerType === 'go-to-prison') : 30);

                    // Build lookup map for owner IDs
                    const pMap = new Map();
                    for (const p of playersList) {
                        const pName = p.name || p.username;
                        const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;
                        if (pName) {
                            if (pId !== undefined) pMap.set(String(pId), pName);
                            pMap.set(pName, pName);
                        }
                    }

                    GameMemory.boardTiles = gs.blocks.map((b, idx) => {
                        let type = b.type;
                        if (type === 'city') type = 'property';
                        else if (type === 'company') type = 'utility';

                        let group = b.countryId;
                        if (!group) {
                            if (type === 'airport') group = 'Airport';
                            else if (type === 'utility') group = 'Utility';
                            else group = null;
                        } else {
                            group = group.charAt(0).toUpperCase() + group.slice(1);
                        }

                        let rent = [];
                        if (Array.isArray(b.rentPrices)) {
                            rent = [...b.rentPrices];
                        } else if (b.rentPrices && typeof b.rentPrices === 'object') {
                            rent = [
                                b.rentPrices[0] || b.rentPrices['0'] || 0,
                                b.rentPrices[1] || b.rentPrices['1'] || 0,
                                b.rentPrices[2] || b.rentPrices['2'] || 0,
                                b.rentPrices[3] || b.rentPrices['3'] || 0,
                                b.rentPrices[4] || b.rentPrices['4'] || 0,
                                b.rentPrices[5] || b.rentPrices['5'] || 0
                            ];
                        }

                        // Ingest authoritative property ownership directly from block data
                        const ownerId = b.ownerId || b.userId || null;
                        let resolvedOwner = null;
                        if (ownerId) {
                            resolvedOwner = pMap.get(String(ownerId)) || 
                                            (myId && String(ownerId) === String(myId) ? (GameMemory.myName || '__ME__') : String(ownerId));
                        }
                        GameMemory.ownership[idx] = {
                            owner: resolvedOwner,
                            houses: typeof b.level === 'number' ? b.level : (typeof b.houses === 'number' ? b.houses : 0),
                            mortgaged: Boolean(b.isMortgaged || b.mortgaged)
                        };

                        return {
                            id: idx,
                            name: b.name || `Tile #${idx}`,
                            type,
                            group,
                            price: b.price || 0,
                            houseCost: b.housePrice || b.hotelPrice || Math.round(b.price || 50),
                            rent,
                            markov: (idx >= 14 && idx <= 26) ? (1.3 / gs.blocks.length) : (1.0 / gs.blocks.length)
                        };
                    });

                    const gTiles = {};
                    GameMemory.boardTiles.forEach(t => {
                        if (t.group) {
                            if (!gTiles[t.group]) gTiles[t.group] = [];
                            gTiles[t.group].push(t);
                        }
                    });
                    GameMemory.groupTiles = gTiles;
                }

                // Ingest Vacation Cash pot
                if (typeof gs.vacationCash === 'number') {
                    GameMemory.vacationCash = gs.vacationCash;
                }

                // Ingest Pardon Cards
                if (gs.bonusCards) {
                    const meId = GameMemory.myId;
                    GameMemory.pardonCards = {
                        treasure: Boolean(meId && gs.bonusCards.treasure?.pardonCardHolderId === meId),
                        surprise: Boolean(meId && gs.bonusCards.surprise?.pardonCardHolderId === meId)
                    };
                }

                // Exact jail suspension detection from RichUp boardConfig & corner block
                const prisonIdx = GameMemory.prisonBlockIndex;
                const prisonBlock = Array.isArray(gs.blocks) ? gs.blocks[prisonIdx] : null;
                const prisonSuspensions = (prisonBlock && typeof prisonBlock.suspendedTurnsRemaining === 'object') ? prisonBlock.suspendedTurnsRemaining : null;

                const validNames = new Set();
                GameMemory.participantsOrder = [];

                for (const p of playersList) {
                    const pName = p.name || p.username;
                    if (!pName) continue;
                    validNames.add(pName);
                    const isBankrupt = Boolean(p.bankrupt || p.bankruptedAt);
                    GameMemory.participantsOrder.push({
                        id: p.id ?? p.userId ?? p.user_id ?? p.playerId,
                        name: pName,
                        bankrupt: isBankrupt
                    });

                    const rawMoney = typeof p.money === 'number' ? p.money : 
                                     (typeof p.cash === 'number' ? p.cash : 
                                     (typeof p.balance === 'number' ? p.balance : null));
                    const isThisPlayerMe = GameMemory.isMe(pName) || (myId && (p.id === myId || p.userId === myId)) || Boolean(p.isMe || p.is_me);
                    const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;

                    const playerPos = typeof p.position === 'number' ? p.position : 
                                      (typeof p.pos === 'number' ? p.pos : (GameMemory.players[pName]?.pos || 0));

                    const realJailTurns = prisonSuspensions && pId ? (prisonSuspensions[pId] || 0) : 0;
                    const isReallyInJail = realJailTurns > 0 || (playerPos === prisonIdx && Boolean(p.inJail || p.jailTurns || p.in_jail));

                    if (rawMoney !== null) {
                        GameMemory.players[pName] = {
                            id: pId,
                            cash: rawMoney,
                            pos: playerPos,
                            inJail: isReallyInJail,
                            isMe: isThisPlayerMe,
                            bankrupt: isBankrupt
                        };

                        if (isThisPlayerMe) {
                            GameMemory.setMyName(pName);
                            GameMemory.myCash = rawMoney;
                            GameMemory.cashVerified = true;
                            GameMemory.myPos = playerPos;
                            GameMemory.inJail = isReallyInJail;
                            GameMemory.jailTurns = realJailTurns;
                            if (p.clock?.autoActedTurns !== undefined) {
                                GameMemory.autoActedTurns = p.clock.autoActedTurns;
                            }
                        }
                    }
                }

                // Turn tracking via currentPlayerIndex
                if (typeof gs.currentPlayerIndex === 'number') {
                    GameMemory.currentPlayerIndex = gs.currentPlayerIndex;
                    if (playersList[gs.currentPlayerIndex]) {
                        const curP = playersList[gs.currentPlayerIndex];
                        GameMemory.isMyTurn = Boolean(GameMemory.isMe(curP.name || curP.username) || (myId && curP.id === myId));
                    }
                }

                // Authoritative roll & turn action state from gameState
                if (typeof gs.cubesRolledInTurn === 'boolean') {
                    if (GameMemory.isMyTurn) {
                        GameMemory.hasRolled = gs.cubesRolledInTurn;
                    }
                }
                if (typeof gs.canPerformTurnActions === 'boolean') {
                    GameMemory.canPerformTurnActions = gs.canPerformTurnActions;
                }
                if (typeof gs.doublesInARow === 'number') {
                    GameMemory.doublesInARow = gs.doublesInARow;
                }

                // Sync turnClock & anti-AFK timers from authoritative state
                if (gs.turnClock) {
                    GameMemory.updateTurnClock(gs.turnClock);
                }

                // Sync trades and auction from gameState if available
                if (Array.isArray(gs.trades)) {
                    GameMemory.trades = gs.trades;
                }
                if (gs.auction !== undefined) {
                    GameMemory.activeAuction = gs.auction;
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

        // Game Started event: reset state for new match
        if (eventName === 'game-started' || eventName.includes('game-started')) {
            logToBot(`[WS TELEMETRY] 🏁 New game started! Resetting memory.`);
            GameMemory.reset();
            if (payload && Array.isArray(payload.participantsOrder)) {
                GameMemory.participantsOrder = payload.participantsOrder.map(p => ({
                    id: p.id,
                    name: p.name || p.username,
                    bankrupt: false
                }));
            }
        }

        // 2. Dice Rolled: Advance positions and detect doubles ("Roll again")
        if (eventName.includes('roll') || eventName.includes('dice')) {
            const dice = Array.isArray(payload.dice) ? payload.dice : (Array.isArray(payload) ? payload : []);
            const sum = (dice[0] || 0) + (dice[1] || 0);
            const isDoubles = dice.length >= 2 && dice[0] === dice[1] && dice[0] > 0;
            const pName = payload.playerName || payload.username || payload.name || payload.player;

            // In RichUp, dice-rolled event does not always carry pName; it applies to whoever's turn it currently is!
            const isMeRolling = (pName && GameMemory.isMe(pName)) || (!pName && GameMemory.isMyTurn);

            if (isMeRolling && sum > 0) {
                if (isDoubles) {
                    GameMemory.hasRolled = false; // Reset flag to trigger "Roll again"!
                    GameMemory.doublesInARow = (GameMemory.doublesInARow || 0) + 1;
                    logToBot(`[DICE] 🎲 DOUBLES ROLLED ([${dice[0]},${dice[1]}])! "Roll again" granted (Doubles #${GameMemory.doublesInARow})`);
                } else {
                    GameMemory.hasRolled = true;
                    GameMemory.doublesInARow = 0;
                }

                if (!GameMemory.inJail) {
                    const bLen = GameMemory.getBoardLength();
                    GameMemory.myPos = (GameMemory.myPos + sum) % bLen;
                    const tileName = GameMemory.getTile(GameMemory.myPos)?.name || 'Unknown';
                    logToBot(`[DICE] 🎲 I rolled ${sum} ([${dice.join(',')}]) -> Moved to Tile #${GameMemory.myPos} (${tileName})`);
                }
            } else if (pName && GameMemory.players[pName]) {
                if (!GameMemory.players[pName].inJail && sum > 0) {
                    const bLen = GameMemory.getBoardLength();
                    const currentOppPos = GameMemory.players[pName].pos || 0;
                    GameMemory.players[pName].pos = (currentOppPos + sum) % bLen;
                    logToBot(`[DICE] 🎲 ${pName} rolled ${sum} -> Tile #${GameMemory.players[pName].pos}`);
                }
            }
        }

        // 3. Property Purchases
        if (eventName.includes('purchase') || eventName.includes('buy')) {
            const tileId = typeof payload.blockIndex === 'number' ? payload.blockIndex : 
                           (typeof payload.tileId === 'number' ? payload.tileId : payload.tileIndex);
            const pName = payload.playerName || payload.username || payload.name || payload.player;
            const buyer = pName ? (GameMemory.isMe(pName) ? (GameMemory.myName || '__ME__') : pName)
                                : (GameMemory.isMyTurn ? (GameMemory.myName || '__ME__') : null);

            if (typeof tileId === 'number') {
                GameMemory.lastPurchasedBlock = tileId;
                if (GameMemory.ownership[tileId]) {
                    if (buyer) GameMemory.ownership[tileId].owner = buyer;
                    logToBot(`[WS TELEMETRY] 🏷️ Tile #${tileId} (${GameMemory.getTile(tileId)?.name || 'Unknown'}) acquired by ${buyer || 'Active Player'}`);
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
                logToBot(`[WS TELEMETRY] 🔨 Tile #${tileId} (${GameMemory.getTile(tileId)?.name || 'Unknown'}) won at auction by ${buyer}`);
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

        // 8. Turn Ended / Started: Advancing participant pointer & Authoritative Resync
        if (eventName === 'turn-ended' || eventName.includes('turn-ended')) {
            GameMemory.hasRolled = false;
            GameMemory.isMyTurn = false;

            // Locally advance participant pointer to next non-bankrupt participant
            if (Array.isArray(GameMemory.participantsOrder) && GameMemory.participantsOrder.length > 0) {
                let nextIdx = (GameMemory.currentPlayerIndex + 1) % GameMemory.participantsOrder.length;
                let loops = 0;
                while (loops < GameMemory.participantsOrder.length) {
                    const candidate = GameMemory.participantsOrder[nextIdx];
                    const pData = GameMemory.players[candidate.name] || candidate;
                    if (!pData.bankrupt && !pData.bankruptedAt) {
                        break;
                    }
                    nextIdx = (nextIdx + 1) % GameMemory.participantsOrder.length;
                    loops++;
                }
                GameMemory.currentPlayerIndex = nextIdx;
                const nextPlayer = GameMemory.participantsOrder[nextIdx];
                if (nextPlayer) {
                    GameMemory.isMyTurn = Boolean(GameMemory.isMe(nextPlayer.name) || (GameMemory.myId && nextPlayer.id === GameMemory.myId));
                    if (GameMemory.isMyTurn) {
                        GameMemory.hasRolled = false;
                        logToBot(`[TURN ADVANCE] 🎯 Advanced to Player #${nextIdx} (${nextPlayer.name}) -> It is MY TURN!`);
                    } else {
                        logToBot(`[TURN ADVANCE] ⏭️ Advanced to Player #${nextIdx} (${nextPlayer.name})`);
                    }
                }
            }
        } else if (eventName.includes('turn')) {
            const active = payload.activePlayer || payload.player || payload.username || payload.name;
            if (active) {
                GameMemory.isMyTurn = GameMemory.isMe(active);
                if (GameMemory.isMyTurn) {
                    GameMemory.hasRolled = false;
                }
            }
        }

        // 9. Auction Lifecycle
        if (eventName === 'auction-started' || eventName.includes('auction-started')) {
            const blockIndex = typeof payload.blockIndex === 'number' ? payload.blockIndex : GameMemory.myPos;
            GameMemory.activeAuction = {
                blockIndex,
                currentBid: typeof payload.amount === 'number' ? payload.amount : 0
            };
        }
        if (eventName === 'auction-bade' || eventName.includes('auction-bade')) {
            if (GameMemory.activeAuction && typeof payload.amount === 'number') {
                GameMemory.activeAuction.currentBid = payload.amount;
            }
        }
        if (eventName === 'auction-ended' || eventName.includes('auction-ended')) {
            GameMemory.activeAuction = null;
        }

        // 10. Trade Lifecycle
        if (eventName === 'trade-created' || eventName.includes('trade-created')) {
            const tr = payload.trade || payload;
            if (tr) {
                if (!GameMemory.trades) GameMemory.trades = [];
                if (!GameMemory.trades.some(t => t.id === tr.id)) {
                    GameMemory.trades.push(tr);
                }
                // If we proposed this trade, track its ID so we can cancel it if it goes stale
                if (tr.initiatorId === GameMemory.myId || (GameMemory.myName && tr.initiator?.name === GameMemory.myName)) {
                    GameMemory.activeOutgoingTradeId = tr.id;
                    GameMemory.activeOutgoingTradeTime = Date.now();
                    logToBot(`[TRADE] 📤 Outgoing trade registered (ID: ${tr.id}).`);
                }
            }
        }
        if (eventName === 'trade-confirmed' || eventName === 'trade-declined' || eventName === 'trade-deleted') {
            const trId = payload.tradeId || payload.id;
            if (trId) {
                if (GameMemory.trades) {
                    GameMemory.trades = GameMemory.trades.filter(t => t.id !== trId);
                }
                if (GameMemory.activeOutgoingTradeId === trId) {
                    GameMemory.activeOutgoingTradeId = null;
                    GameMemory.activeOutgoingTradeTime = 0;
                }
            }
        }

        // 11. Turn-Clock Events (Anti-AFK & Time Extensions)
        if (eventName === 'clock-time-requested' || eventName.includes('clock-time-requested')) {
            const reqPid = payload.playerId || payload.participantId;
            if (reqPid && reqPid !== GameMemory.myId) {
                sendSocketAction('grant-clock-time');
                logToBot('[TURN CLOCK] ⏱️ Opponent requested clock time -> Automatically granted +60s extension.');
            }
        }
        if (eventName === 'clock-time-granted' || eventName.includes('clock-time-granted')) {
            if (GameMemory.turnClock) {
                GameMemory.turnClock.grantedMs = (GameMemory.turnClock.grantedMs || 0) + 60000;
                GameMemory.turnClock.turnExpiresAt = (GameMemory.turnClock.turnExpiresAt || Date.now()) + 60000;
            }
            logToBot('[TURN CLOCK] ⏱️ Clock time granted (+60s)!');
        }

        // 12. Anti-Stall Auto-Votekick
        if (eventName === 'new-votekick-request' || eventName.includes('votekick')) {
            const targetId = payload.playerId || payload.votingPlayerId || payload.targetPlayerId;
            if (targetId && targetId !== GameMemory.myId) {
                sendSocketAction('votekick-player', { playerId: targetId });
                logToBot(`[ANTI-STALL] 🗳️ Voted YES on votekick request to remove AFK staller.`);
            }
        }

        // 13. Game Ended & Coin Reward Auto-Claim
        if (eventName === 'game-ended' || eventName.includes('game-ended')) {
            const winnerId = payload.winnerId;
            const isMeWinner = Boolean(winnerId && (winnerId === GameMemory.myId || GameMemory.isMe(winnerId)));
            if (isMeWinner) {
                logToBot(`[VICTORY] 🏆 Match WON! Claiming free post-game coin rewards...`);
                try {
                    fetch('/api/game/claim-coin-reward', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' }
                    })
                    .then(r => r.json())
                    .then(res => {
                        logToBot(`[VICTORY] 💰 Coins claimed successfully: ${JSON.stringify(res)}`);
                    })
                    .catch(() => {});
                } catch (_) {}
            }
        }

        // Deep sync player stats (cash & positions) across all payloads
        deepSyncFromObject(payload);

        // Deep sync property board state (ownership, houses, mortgages) across all payloads
        deepSyncPropertiesFromPayload(payload);

        // Trigger live protocol evaluation on any incoming game packet
        if (onSocketMessageCallback) {
            try {
                onSocketMessageCallback(eventName, payload);
            } catch (_) {}
        }
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
    const gs = payload.gameState || payload.room || payload;
    const playersList = Array.isArray(gs.participants) ? gs.participants :
                        (Array.isArray(payload.participants) ? payload.participants :
                        (Array.isArray(gs.players) ? gs.players : 
                        (Array.isArray(payload.playerList) ? payload.playerList : null)));
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
            const bLen = GameMemory.getBoardLength();
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i];
                if (!item) continue;

                if (typeof item === 'string' && obj.length >= 30 && i < bLen && GameMemory.ownership[i]) {
                    const resolved = resolveOwner(item);
                    if (resolved) GameMemory.ownership[i].owner = resolved;
                    continue;
                }

                if (typeof item === 'object') {
                    const tileId = typeof item.blockIndex === 'number' ? item.blockIndex : 
                                   (typeof item.tileId === 'number' ? item.tileId : 
                                   (typeof item.index === 'number' ? item.index : (typeof item.id === 'number' && item.id < bLen ? item.id : null)));

                    const targetId = tileId !== null ? tileId : (obj.length >= 30 && i < bLen ? i : null);

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
