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

    // Only run lobby detection if the match has NOT started yet
    const isInGame = Boolean(
        pageText.includes('is playing') ||
        pageText.includes('Roll the dice') ||
        pageText.includes('End turn') ||
        pageText.includes('Game started') ||
        document.querySelector('[class*="bankrupt" i]')
    );

    // 1. Starting Cash Setting (e.g. "Starting cash ... $2000")
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

    if (isInGame) return;

    // 2. Lobby Player Identity: In RichUp lobby, only the local player has the "Change appearance" button!
    const allEls = Array.from(document.querySelectorAll('button, a, div, span'));
    const changeApp = allEls.find(b => {
        if (hud && hud.contains(b)) return false;
        return (b.innerText || '').trim().toLowerCase() === 'change appearance';
    });

    if (changeApp) {
        // Walk up parents (up to 5 levels) to find the player container, avoiding changeApp itself
        let parent = changeApp.parentElement;
        let foundName = null;

        for (let depth = 0; depth < 5 && parent && parent !== document.body; depth++) {
            const childElements = Array.from(parent.querySelectorAll('div, span, p, h1, h2, h3, h4, strong, b'));
            for (const child of childElements) {
                if (hud && hud.contains(child) || child.contains(changeApp)) continue;
                const txt = (child.innerText || '').trim();
                if (
                    txt.length >= 2 && txt.length <= 24 &&
                    !txt.toLowerCase().includes('change appearance') &&
                    !txt.toLowerCase().includes('host') &&
                    !txt.toLowerCase().includes('rules') &&
                    !txt.includes('$') &&
                    !txt.includes('->') &&
                    !txt.includes('\n') &&
                    !BOARD_LABELS_BLACKLIST.has(txt.toLowerCase())
                ) {
                    foundName = txt;
                    break;
                }
            }
            if (foundName) break;
            parent = parent.parentElement;
        }

        if (foundName && (!GameMemory.myName || GameMemory.myName.toLowerCase() !== foundName.toLowerCase())) {
            GameMemory.setMyName(foundName);
        }
    }

    // Fallback: Restore from localStorage if still not set
    if (!GameMemory.myName) {
        try {
            const saved = localStorage.getItem('richup_bot_my_name');
            if (saved && !BOARD_LABELS_BLACKLIST.has(saved.toLowerCase())) {
                GameMemory.setMyName(saved);
            }
        } catch (_) {}
    }
}

/**
 * In RichUp, the top-right scoreboard lists all players in the room.
 * The local player's card uniquely has an interactive "leave game" / exit door icon [->].
 * This function extracts exact cash balances for the local player AND all opponents,
 * completely immune to React build hashes or CSS class name changes.
 */
function detectLocalPlayerFromPlayerList() {
    const hud = document.getElementById('rubot-hud-panel');

    // 1. Jail State Self-Healing: bail buttons appear exclusively when the player is in Jail (Tile 10)
    const hasJailUI = Boolean(
        Array.from(document.querySelectorAll('button, [role="button"], div, span')).some(b => {
            if (hud && hud.contains(b)) return false;
            const t = (b.innerText || '').toLowerCase();
            return t.includes('get free for') || t.includes('pay $50') || t.includes('pardon card');
        })
    );
    if (hasJailUI) {
        GameMemory.myPos = 10;
        GameMemory.inJail = true;
    }

    // 2. Purge accidental bad name
    if (GameMemory.myName && (
        GameMemory.myName.toLowerCase().includes('share') ||
        GameMemory.myName.toLowerCase().includes('copy') ||
        BOARD_LABELS_BLACKLIST.has(GameMemory.myName.toLowerCase())
    )) {
        GameMemory.myName = null;
        try { localStorage.removeItem('richup_bot_my_name'); } catch (_) {}
    }

    const currentName = GameMemory.myName;

    // 3. Class-Agnostic Scoreboard Discovery:
    // Find the container element that holds 2 to 8 player cards, each containing a dollar sign
    const allContainers = document.querySelectorAll('div, section, aside, ul');
    let bestScoreboardContainer = null;
    let maxDollarChildren = 0;

    for (let i = 0; i < allContainers.length; i++) {
        const el = allContainers[i];
        if (hud && hud.contains(el)) continue;
        if (el === document.body || el === document.documentElement) continue;

        const children = Array.from(el.children);
        if (children.length >= 2 && children.length <= 8) {
            let dollarCount = 0;
            for (const child of children) {
                const cText = child.innerText || '';
                if (cText.includes('$') && cText.length < 160 && !cText.toLowerCase().includes('my properties')) {
                    dollarCount++;
                }
            }
            if (dollarCount >= 2 && dollarCount > maxDollarChildren && (el.innerText || '').length < 800) {
                maxDollarChildren = dollarCount;
                bestScoreboardContainer = el;
            }
        }
    }

    // 4. Extract players from discovered scoreboard container
    if (bestScoreboardContainer) {
        const rows = Array.from(bestScoreboardContainer.children);
        for (const row of rows) {
            const rowText = row.innerText || '';
            if (!rowText.includes('$') || rowText.length > 160) continue;

            const cashMatch = /\$\s*(-?\d{1,5})|(-?\d{1,5})\s*\$|(-\s*\$?\d{1,5})/.exec(rowText);
            if (!cashMatch) continue;

            const rawCash = (cashMatch[1] || cashMatch[2] || cashMatch[3] || '').replace(/[\$\s]/g, '');
            const parsedCash = parseInt(rawCash, 10);
            if (isNaN(parsedCash)) continue;

            const beforeDollar = rowText.split('$')[0].trim();
            const candidateLines = beforeDollar.split('\n').map(l => l.trim()).filter(Boolean);

            let candidateName = null;
            for (const line of candidateLines) {
                const clean = line.replace(/[->\]\[→←\|👑]/g, '').trim();
                if (
                    clean.length >= 2 && clean.length <= 24 &&
                    !BOARD_LABELS_BLACKLIST.has(clean.toLowerCase()) &&
                    !clean.toLowerCase().includes('share') &&
                    !clean.toLowerCase().includes('copy') &&
                    !/^\d+$/.test(clean)
                ) {
                    candidateName = clean;
                    break;
                }
            }

            if (!candidateName) continue;

            // In RichUp, only the local player's row has the interactive leave [->] button
            const hasLeaveIcon = Boolean(
                row.querySelector('[class*="leave" i], [class*="exit" i], [title*="leave" i], [aria-label*="leave" i]') ||
                row.innerHTML.includes('->') ||
                row.innerHTML.includes('M17 16l4') ||
                row.innerHTML.includes('M11 16l-4-4') ||
                row.innerHTML.includes('M15 3h4a2')
            );

            const isKnownMe = currentName && candidateName.toLowerCase() === currentName.toLowerCase();
            const isBankrupt = rowText.toLowerCase().includes('bankrupt') || row.classList.contains('bankrupt');

            if (hasLeaveIcon || isKnownMe) {
                GameMemory.setMyName(candidateName);
                GameMemory.myCash = parsedCash;
                GameMemory.cashVerified = true;
                GameMemory.players[candidateName] = {
                    cash: parsedCash,
                    pos: GameMemory.myPos,
                    isMe: true,
                    bankrupt: isBankrupt
                };
            } else {
                GameMemory.players[candidateName] = {
                    cash: parsedCash,
                    pos: GameMemory.players[candidateName]?.pos || 0,
                    isMe: false,
                    bankrupt: isBankrupt
                };
            }
        }
    }

    // 5. Direct Fallback: Scan any elements containing current player name & $
    if (currentName) {
        const currentLower = currentName.toLowerCase();
        const candidates = document.querySelectorAll('*');
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (hud && hud.contains(el)) continue;

            const text = el.innerText || '';
            if (text.toLowerCase().includes(currentLower) && text.includes('$') && text.length <= 150) {
                const cashMatch = /\$\s*(-?\d{1,5})|(-?\d{1,5})\s*\$|(-\s*\$?\d{1,5})/.exec(text);
                if (cashMatch) {
                    const rawCash = (cashMatch[1] || cashMatch[2] || cashMatch[3] || '').replace(/[\$\s]/g, '');
                    const parsedCash = parseInt(rawCash, 10);
                    if (!isNaN(parsedCash)) {
                        GameMemory.myCash = parsedCash;
                        GameMemory.cashVerified = true;
                        GameMemory.players[currentName] = GameMemory.players[currentName] || { cash: parsedCash, pos: GameMemory.myPos, isMe: true };
                        GameMemory.players[currentName].cash = parsedCash;
                        GameMemory.players[currentName].isMe = true;
                        break;
                    }
                }
            }
        }
    }

    // 6. Direct fallback if player name is known and present in players dictionary
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
            if (tile.group && (lower === tile.name.toLowerCase() || new RegExp(`^${tile.name}\\b`, 'i').test(line))) {
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
            const numeric = parseInt(item.text.replace(/[\$\s]/g, ''), 10);
            
            // Search backwards up to 4 text nodes to skip icons like "->", "👑", "→"
            let prevText = '';
            for (let k = 1; k <= 4 && (i - k) >= 0; k++) {
                const candidate = textNodes[i - k].text.trim().replace(/[->\]\[→←\|👑]/g, '').trim();
                if (
                    candidate.length >= 2 && candidate.length <= 24 &&
                    !/^\$|%|\d|^x\s*\$/i.test(candidate) &&
                    !BOARD_LABELS_BLACKLIST.has(candidate.toLowerCase())
                ) {
                    prevText = candidate;
                    break;
                }
            }

            if (prevText && !isNaN(numeric)) {
                const isMe = GameMemory.isMe(prevText);
                GameMemory.players[prevText] = GameMemory.players[prevText] || { cash: numeric, pos: 0, isMe };
                GameMemory.players[prevText].cash = numeric;
                cashCandidates.push({ name: prevText, cash: numeric });
                if (isMe) {
                    GameMemory.myCash = numeric;
                    GameMemory.cashVerified = true;
                }
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
    // 1. In Prison / Go to Prison events
    if (/got into prison|went to prison|sent to prison/i.test(line)) {
        const playerPart = line.split(/got into prison|went to prison|sent to prison/i)[0].trim();
        const cleanPlayer = playerPart.replace(/[^\w\s-]/g, '').trim();
        if (GameMemory.isMe(cleanPlayer)) {
            GameMemory.myPos = 10;
            GameMemory.inJail = true;
        } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
            GameMemory.players[cleanPlayer].pos = 10;
            GameMemory.players[cleanPlayer].inJail = true;
        }
        GameMemory.processedLogs.add(line);
        return;
    }

    // 2. Left Prison / Got free events
    if (/got free|left prison|paid.*jail|paid.*bail/i.test(line)) {
        const playerPart = line.split(/got free|left prison|paid/i)[0].trim();
        const cleanPlayer = playerPart.replace(/[^\w\s-]/g, '').trim();
        if (GameMemory.isMe(cleanPlayer)) {
            GameMemory.inJail = false;
        } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
            GameMemory.players[cleanPlayer].inJail = false;
        }
        GameMemory.processedLogs.add(line);
        return;
    }

    // 3. Dice Roll events (position update)
    const rollMatch = /^(.+?)\s+rolled\s+(\d+)/i.exec(line);
    if (rollMatch) {
        const player = rollMatch[1].trim();
        const rollVal = parseInt(rollMatch[2], 10);
        if (!isNaN(rollVal) && rollVal >= 2 && rollVal <= 12) {
            if (GameMemory.isMe(player)) {
                GameMemory.myPos = (GameMemory.myPos + rollVal) % 40;
            } else if (GameMemory.players[player]) {
                GameMemory.players[player].pos = ((GameMemory.players[player].pos || 0) + rollVal) % 40;
            }
        }
        GameMemory.processedLogs.add(line);
        return;
    }

    // 4. Landed on events
    if (line.includes('landed on')) {
        for (const tile of BOARD_TILES) {
            if (new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                const playerPart = line.split(/landed on/i)[0].trim();
                const cleanPlayer = playerPart.replace(/[^\w\s-]/g, '').trim();
                if (GameMemory.isMe(cleanPlayer)) {
                    GameMemory.myPos = tile.id;
                } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
                    GameMemory.players[cleanPlayer].pos = tile.id;
                }
                GameMemory.processedLogs.add(line);
                return;
            }
        }
    }

    if (line.includes('bought a house in')) {
        for (const tile of BOARD_TILES) {
            if (tile.group && new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                const buyerPart = line.split(/bought a house in/i)[0].trim();
                const cleanBuyer = buyerPart.replace(/[^\w\s-]/g, '').trim();
                if (cleanBuyer && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].owner = cleanBuyer;
                    GameMemory.ownership[tile.id].houses = Math.min(5, (GameMemory.ownership[tile.id].houses || 0) + 1);
                    if (GameMemory.isMe(cleanBuyer)) {
                        GameMemory.myPos = tile.id;
                    }
                    GameMemory.processedLogs.add(line);
                    return;
                }
            }
        }
    }

    if (line.includes('bought a hotel in')) {
        for (const tile of BOARD_TILES) {
            if (tile.group && new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                const buyerPart = line.split(/bought a hotel in/i)[0].trim();
                const cleanBuyer = buyerPart.replace(/[^\w\s-]/g, '').trim();
                if (cleanBuyer && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].owner = cleanBuyer;
                    GameMemory.ownership[tile.id].houses = 5;
                    if (GameMemory.isMe(cleanBuyer)) {
                        GameMemory.myPos = tile.id;
                    }
                    GameMemory.processedLogs.add(line);
                    return;
                }
            }
        }
    }

    if (line.includes('bought') && !line.includes('house') && !line.includes('hotel')) {
        for (const tile of BOARD_TILES) {
            if (tile.group && new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                const buyerPart = line.split(/bought/i)[0].trim();
                const cleanBuyer = buyerPart.replace(/[^\w\s-]/g, '').trim();
                if (cleanBuyer && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].owner = cleanBuyer;
                    if (GameMemory.isMe(cleanBuyer)) {
                        GameMemory.myPos = tile.id;
                    }
                    GameMemory.processedLogs.add(line);
                    return;
                }
            }
        }
    }

    let m = /^(.+?)\s+bankrupted/i.exec(line);
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
        return;
    }

    if (line.includes('mortgaged')) {
        for (const tile of BOARD_TILES) {
            if (tile.group && new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                if (GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].mortgaged = !line.includes('unmortgaged');
                    GameMemory.processedLogs.add(line);
                    return;
                }
            }
        }
    }

    if (line.includes('traded')) {
        for (const tile of BOARD_TILES) {
            if (tile.group && new RegExp(`\\b${tile.name}\\b`, 'i').test(line)) {
                const matchTo = /to\s+([A-Za-z0-9_-]+)/i.exec(line);
                if (matchTo && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].owner = matchTo[1].trim();
                    GameMemory.processedLogs.add(line);
                    return;
                }
            }
        }
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
