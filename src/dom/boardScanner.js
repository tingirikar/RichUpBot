import { BOARD_TILES, TILE_BY_NAME, BOARD_LABELS_BLACKLIST } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';

/**
 * BOARD DOM SCANNER & PLAYER TELEMETRY SYNC
 * 
 * Accurately detects:
 * 1. Local player identity & cash balance from the player card with the leave [->] icon
 * 2. Exact owned properties and house counts from the "My properties" sidebar panel
 * 3. Activity feed logs
 */
export function syncBoardStateFromDOM() {
    if (!document.body) return;

    // 1. Detect Lobby Settings (Starting cash) and Player Identity from "Change appearance"
    detectLobbySettingsAndIdentity();

    // 2. Detect Local Player & Exact Cash Balance from Scoreboard List
    detectLocalPlayerFromPlayerList();

    // 3. Dynamically read exact property prices from the board DOM
    syncBoardTilePricesFromDOM();

    // 4. Sync Properties & House Counts from "My properties" Sidebar
    syncMyPropertiesFromSidebar();

    // 5. Fallback: Parse Text Nodes for Other Players & Activity Logs
    scanTextNodesAndActivityLogs();
}

/**
 * Detects starting cash and local username in the pre-game lobby
 */
function detectLobbySettingsAndIdentity() {
    const hud = document.getElementById('rubot-hud-panel');
    const pageText = document.body.innerText || '';

    // 1. Starting Cash Setting (e.g. "Starting cash: ... $1000")
    const cashMatch = /Starting cash[\s\S]*?\$(\d{2,5})/i.exec(pageText);
    if (cashMatch) {
        const startCash = parseInt(cashMatch[1], 10);
        if (!isNaN(startCash) && startCash >= 100 && startCash <= 10000) {
            GameMemory.roomSettings.startingCash = startCash;
            if (!GameMemory.cashVerified) {
                GameMemory.myCash = startCash;
            }
        }
    }

    // 2. Lobby Player Identity: Only the local player has the "Change appearance" button!
    const allButtons = Array.from(document.querySelectorAll('button, a, div'));
    const changeApp = allButtons.find(b => {
        if (hud && hud.contains(b)) return false;
        return (b.innerText || '').toLowerCase().includes('change appearance');
    });

    if (changeApp) {
        const row = changeApp.closest('div, li, [class*="player"], [class*="user"], [class*="item"]') || changeApp.parentElement;
        if (row) {
            const lines = (row.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
            const candidate = lines.find(l => 
                l.length >= 2 && l.length <= 24 &&
                !BOARD_LABELS_BLACKLIST.has(l.toLowerCase()) &&
                !l.toLowerCase().includes('change appearance') &&
                !l.toLowerCase().includes('host') &&
                !l.includes('$')
            );
            if (candidate && (!GameMemory.myName || GameMemory.myName.toLowerCase() !== candidate.toLowerCase())) {
                GameMemory.setMyName(candidate);
            }
        }
    }
}

/**
 * In RichUp, the local player's card in the top-right scoreboard has a unique
 * "leave game" / exit door icon [->]. This allows 100% foolproof identity & cash detection!
 */
function detectLocalPlayerFromPlayerList() {
    const hud = document.getElementById('rubot-hud-panel');
    const currentName = GameMemory.myName;

    // Search for player row containers in the scoreboard
    const candidates = document.querySelectorAll('[class*="player"], [class*="user"], [class*="item"], [class*="row"]');

    for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (hud && hud.contains(el)) continue;

        const text = el.innerText || '';
        if (!text.includes('$')) continue;

        // Extract cash: $X or -$X or $-X
        const cashMatch = /(-?\$?\d{1,5}|\$-?\d{1,5})/.exec(text);
        if (!cashMatch) continue;

        const rawCash = cashMatch[1].replace(/\$/g, '');
        const parsedCash = parseInt(rawCash, 10);
        if (isNaN(parsedCash)) continue;

        // Parse lines to get player username
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const nameCandidates = lines.filter(l => 
            !l.includes('$') && 
            l.length >= 2 && 
            l.length <= 24 && 
            !BOARD_LABELS_BLACKLIST.has(l.toLowerCase())
        );

        if (nameCandidates.length === 0) continue;
        const candidateName = nameCandidates[0];

        // In RichUp, only the local player's row has the interactive leave [->] button in the scoreboard
        const hasLeaveIcon = Boolean(
            el.querySelector('[class*="leave" i], [class*="exit" i], [title*="leave" i], [aria-label*="leave" i]') ||
            el.querySelector('button') ||
            (el.innerHTML.includes('->') && !text.includes('passed through'))
        );

        const isKnownMe = currentName && candidateName.toLowerCase() === currentName.toLowerCase();

        // Update player record in memory
        GameMemory.players[candidateName] = GameMemory.players[candidateName] || { cash: parsedCash, pos: 0, isMe: false };
        GameMemory.players[candidateName].cash = parsedCash;

        if (hasLeaveIcon || isKnownMe) {
            GameMemory.players[candidateName].isMe = true;
            GameMemory.setMyName(candidateName);
            GameMemory.myCash = parsedCash;
            GameMemory.cashVerified = true;
            return;
        }
    }

    // Direct fallback if player name is known and present in players dictionary
    if (GameMemory.myName && GameMemory.players[GameMemory.myName]) {
        GameMemory.myCash = GameMemory.players[GameMemory.myName].cash;
        GameMemory.cashVerified = true;
    }
}

/**
 * Dynamically reads property purchase prices directly off the board tiles
 */
export function syncBoardTilePricesFromDOM() {
    const hud = document.getElementById('rubot-hud-panel');
    const allEls = document.querySelectorAll('div, [class*="tile"], [class*="cell"]');

    for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        if (hud && hud.contains(el)) continue;

        const text = el.innerText || '';
        if (!text.includes('$') || text.length > 80) continue;

        for (const tile of BOARD_TILES) {
            if (!tile.group) continue;
            if (new RegExp(`\\b${tile.name}\\b`, 'i').test(text)) {
                const m = /(\d{2,4})\s*\$|\$\s*(\d{2,4})/.exec(text);
                if (m) {
                    const price = parseInt(m[1] || m[2], 10);
                    if (!isNaN(price) && price >= 50 && price <= 500) {
                        tile.price = price;
                    }
                }
            }
        }
    }
}

/**
 * In RichUp, the right sidebar has a "My properties" section listing all owned cards
 * and their house counts (e.g. "San Francisco  🏠 x 4").
 */
function syncMyPropertiesFromSidebar() {
    const hud = document.getElementById('rubot-hud-panel');

    // Find the specific "My properties (N)" header in the right sidebar
    const allEls = document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p');
    let headerEl = null;

    for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        if (hud && hud.contains(el)) continue;
        const text = (el.innerText || '').trim();
        if (/^My properties\s*\(\d+\)/i.test(text)) {
            if (!headerEl || text.length < (headerEl.innerText || '').length) {
                headerEl = el;
            }
        }
    }

    if (!headerEl) return;

    const countMatch = /My properties\s*\((\d+)\)/i.exec(headerEl.innerText);
    const ownedCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const myName = GameMemory.myName || '__ME__';

    // If "My properties (0)", we own ZERO properties! Clear any local player ownership
    if (ownedCount === 0) {
        for (const tileId of Object.keys(GameMemory.ownership)) {
            if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner)) {
                GameMemory.ownership[tileId].owner = null;
                GameMemory.ownership[tileId].houses = 0;
            }
        }
        return;
    }

    // When ownedCount > 0, find the list container inside the sidebar
    // We look at the parent element of the header
    const sidebarContainer = headerEl.parentElement;
    if (!sidebarContainer) return;

    // Ensure we are not accidentally scanning the board
    const text = sidebarContainer.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Track which tiles we actually found in the sidebar
    const foundTileIds = new Set();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();

        // Check if line matches a known board tile
        let matchedTile = null;
        for (const tile of BOARD_TILES) {
            if (tile.group && lower === tile.name.toLowerCase()) {
                matchedTile = tile;
                break;
            }
        }

        if (matchedTile && GameMemory.ownership[matchedTile.id]) {
            foundTileIds.add(matchedTile.id);
            GameMemory.ownership[matchedTile.id].owner = myName;

            // Check for house count indicators (e.g. "x 3", "x 4", "hotel")
            const houseMatch = /(?:x\s*|houses?\s*)(\d)/i.exec(line) 
                || (i + 1 < lines.length ? /(?:x\s*|houses?\s*)(\d)/i.exec(lines[i + 1]) : null);

            if (houseMatch) {
                GameMemory.ownership[matchedTile.id].houses = parseInt(houseMatch[1], 10);
            } else if (lower.includes('hotel') || (i + 1 < lines.length && lines[i + 1].toLowerCase().includes('hotel'))) {
                GameMemory.ownership[matchedTile.id].houses = 5;
            }
        }
    }

    // Clean up any properties we no longer own
    for (const tileId of Object.keys(GameMemory.ownership)) {
        if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner) && !foundTileIds.has(Number(tileId))) {
            GameMemory.ownership[tileId].owner = null;
            GameMemory.ownership[tileId].houses = 0;
        }
    }
}

function scanTextNodesAndActivityLogs() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    const hud = document.getElementById('rubot-hud-panel');

    let node = walker.nextNode();
    while (node) {
        if (!hud || !hud.contains(node.parentElement)) {
            const val = node.nodeValue ? node.nodeValue.trim() : '';
            if (val) textNodes.push({ text: val, el: node.parentElement });
        }
        node = walker.nextNode();
    }

    const cashCandidates = [];
    for (let i = 0; i < textNodes.length; i++) {
        const item = textNodes[i];
        const m = /^(-?\$?\d{1,5}|\$-?\d{1,5})$/.exec(item.text);

        if (m && item.text.includes('$')) {
            const numeric = parseInt(item.text.replace(/\$/g, ''), 10);
            const prevText = i > 0 ? textNodes[i - 1].text.trim() : '';
            const prevLower = prevText.toLowerCase();

            if (
                !isNaN(numeric) &&
                prevText.length >= 2 &&
                prevText.length <= 24 &&
                !/^\$|%|\d|^x\s*\$/i.test(prevText) &&
                !BOARD_LABELS_BLACKLIST.has(prevLower)
            ) {
                GameMemory.players[prevText] = GameMemory.players[prevText] || { cash: numeric, pos: 0, isMe: false };
                GameMemory.players[prevText].cash = numeric;
                cashCandidates.push({ name: prevText, cash: numeric });
            }
        }

        const line = item.text;
        if (line.length > 8 && line.length < 120 && !GameMemory.processedLogs.has(line)) {
            parseActivityLogLine(line);
        }
    }

    // Fallback if local player detection didn't set cash
    if (!GameMemory.cashVerified && cashCandidates.length > 0) {
        if (GameMemory.myName) {
            const myEntry = cashCandidates.find(c => c.name.toLowerCase() === GameMemory.myName.toLowerCase());
            if (myEntry) {
                GameMemory.myCash = myEntry.cash;
                GameMemory.cashVerified = true;
            }
        }
    }
}

function parseActivityLogLine(line) {
    let m = /^(.+?)\s+bought a house in\s+(.+?)\.?$/i.exec(line);
    if (m) {
        const tile = TILE_BY_NAME[m[2].trim().toLowerCase()];
        if (tile && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = m[1].trim();
            GameMemory.ownership[tile.id].houses = Math.min(5, (GameMemory.ownership[tile.id].houses || 0) + 1);
            GameMemory.processedLogs.add(line);
        }
        return;
    }

    m = /^(.+?)\s+bought a hotel in\s+(.+?)\.?$/i.exec(line);
    if (m) {
        const tile = TILE_BY_NAME[m[2].trim().toLowerCase()];
        if (tile && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = m[1].trim();
            GameMemory.ownership[tile.id].houses = 5;
            GameMemory.processedLogs.add(line);
        }
        return;
    }

    m = /^(.+?)\s+bought\s+([A-Za-z\s]+?)(?:\s+by auction.*|\.?)$/i.exec(line);
    if (m) {
        const rawTile = m[2].trim().toLowerCase();
        const tile = TILE_BY_NAME[rawTile];
        if (tile && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = m[1].trim();
            GameMemory.processedLogs.add(line);
        }
        return;
    }

    m = /^(.+?)\s+bankrupted/i.exec(line);
    if (m) {
        const bankruptPlayer = m[1].trim();
        for (const id of Object.keys(GameMemory.ownership)) {
            if (GameMemory.ownership[id].owner === bankruptPlayer) {
                GameMemory.ownership[id].owner = null;
                GameMemory.ownership[id].houses = 0;
                GameMemory.ownership[id].mortgaged = false;
            }
        }
        GameMemory.processedLogs.add(line);
    }
}

/**
 * Scrapes trade data scoped strictly to the trade dialog modal
 */
export function scrapeTradeModalDOM() {
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="trade-modal"]');
    const modalText = modal ? modal.innerText : '';

    const mentionedTiles = BOARD_TILES.filter(t => t.group && new RegExp(`\\b${t.name}\\b`, 'i').test(modalText));
    const givenTiles = [];
    const receivedTiles = [];

    for (const t of mentionedTiles) {
        const owner = GameMemory.ownership[t.id]?.owner;
        if (GameMemory.isMe(owner)) givenTiles.push(t);
        else receivedTiles.push(t);
    }

    // Resolve partner name
    let partnerName = 'Opponent';
    for (const t of receivedTiles) {
        const owner = GameMemory.ownership[t.id]?.owner;
        if (owner && !GameMemory.isMe(owner)) {
            partnerName = owner;
            break;
        }
    }

    if (partnerName === 'Opponent') {
        for (const pName of Object.keys(GameMemory.players)) {
            if (!GameMemory.isMe(pName) && new RegExp(`\\b${pName}\\b`, 'i').test(modalText)) {
                partnerName = pName;
                break;
            }
        }
    }

    if (partnerName === 'Opponent') {
        const allTradeRows = Array.from(document.querySelectorAll('*'))
            .map(e => e.innerText || '')
            .filter(t => (t.includes('↔') || t.includes('<->')) && t.length < 60);

        for (const rowText of allTradeRows) {
            for (const pName of Object.keys(GameMemory.players)) {
                if (!GameMemory.isMe(pName) && rowText.toLowerCase().includes(pName.toLowerCase())) {
                    partnerName = pName;
                    break;
                }
            }
        }
    }

    let givenCash = 0;
    let receivedCash = 0;
    const cashMatches = modalText.match(/\$\s*(\d{1,4})/g);
    if (cashMatches && cashMatches.length >= 1) {
        receivedCash = parseInt(cashMatches[0].replace(/\D/g, ''), 10) || 0;
    }

    return {
        partnerName,
        givenTiles,
        receivedTiles,
        givenCash,
        receivedCash
    };
}
