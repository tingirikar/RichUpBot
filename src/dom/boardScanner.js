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

    const wsHealthy = typeof GameMemory.isWsHealthy === 'function' && GameMemory.isWsHealthy();

    // 1. Detect Lobby Settings & Player Identity (run only if WS hasn't verified identity)
    if (!wsHealthy || !GameMemory.myName) {
        detectLobbySettingsAndIdentity();
    }

    // 2. Always verify Live Player Balances from Scoreboard List
    detectLocalPlayerFromPlayerList();

    // 3. Dynamically read exact property prices and live house badges from board tiles
    syncBoardTilePricesAndBadgesFromDOM();

    // 4. Dynamically scrape live rent table and house costs if any property card modal is open
    syncPropertyCardModalFromDOM();

    // 5. Sync Properties & House Counts from "My properties" Sidebar
    syncMyPropertiesFromSidebar();

    // 6. Activity Logs: Safely parse activity log events without corrupting verified cash
    scanActivityLogsOnly();
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
    if (isInGame) return;

    // 1. Starting Cash Setting: Dynamically read whatever value is selected in the dropdown ($500 - $3000+)
    const startingCashRow = Array.from(document.querySelectorAll('div, li, p, section, tr')).find(el => {
        if (hud && hud.contains(el)) return false;
        const t = (el.innerText || '').toLowerCase();
        return t.includes('starting cash') && (t.includes('adjust how much money') || t.includes('$'));
    });

    let detectedStartCash = null;
    if (startingCashRow) {
        // Look specifically for the selected dropdown trigger button or select box
        const trigger = startingCashRow.querySelector('button, [role="button"], [class*="select" i], [class*="dropdown" i]');
        const targetText = trigger ? trigger.innerText : startingCashRow.innerText;
        const cashMatch = /\$\s*(\d{2,5})|(\d{2,5})\s*\$/.exec(targetText);
        if (cashMatch) {
            detectedStartCash = parseInt(cashMatch[1] || cashMatch[2], 10);
        }
    }

    if (!detectedStartCash) {
        const fallbackMatch = /Starting cash[\s\S]*?\$(\d{2,5})/i.exec(pageText);
        if (fallbackMatch) {
            detectedStartCash = parseInt(fallbackMatch[1], 10);
        }
    }

    if (detectedStartCash && !isNaN(detectedStartCash) && detectedStartCash >= 100 && detectedStartCash <= 10000) {
        GameMemory.roomSettings.startingCash = detectedStartCash;
        if (!GameMemory.cashVerified) {
            GameMemory.myCash = detectedStartCash;
        }
    }

    // 2. Scan Gameplay Rules Toggles from Lobby (as shown in assets/gameplay-rules.png)
    try {
        const candidateRows = Array.from(document.querySelectorAll('div, li, p, section, tr')).filter(el => {
            if (hud && hud.contains(el)) return false;
            const text = (el.innerText || '').toLowerCase();
            return (
                text.includes("don't collect rent while in prison") ||
                text.includes("x2 rent on full-set") ||
                text.includes("vacation cash") ||
                text.includes("even build") ||
                (text.includes("auction") && text.includes("skips purchasing"))
            );
        });

        for (const row of candidateRows) {
            const text = (row.innerText || '').toLowerCase();
            const toggle = row.querySelector('input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]');
            if (!toggle) continue;

            let isChecked = false;
            if (toggle.tagName === 'INPUT') {
                isChecked = toggle.checked;
            } else if (toggle.getAttribute('aria-checked') != null) {
                isChecked = toggle.getAttribute('aria-checked') === 'true';
            } else {
                const cls = (toggle.className || '').toLowerCase();
                isChecked = cls.includes('active') || cls.includes('checked') || cls.includes('on') || cls.includes('enabled');
            }

            if (text.includes("don't collect rent while in prison")) {
                // When toggle is ON ("Don't collect rent"), collectRentInJail is FALSE
                GameMemory.roomSettings.collectRentInJail = !isChecked;
            } else if (text.includes("auction") && text.includes("skips purchasing")) {
                GameMemory.roomSettings.auctionsEnabled = isChecked;
            } else if (text.includes("x2 rent on full-set")) {
                GameMemory.roomSettings.doubleRentOnFullSet = isChecked;
            } else if (text.includes("even build")) {
                GameMemory.roomSettings.evenBuild = isChecked;
            }
        }
    } catch (_) {}

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

    let foundLocalPlayerInScoreboard = false;

    // 4. Extract players from discovered scoreboard container
    if (bestScoreboardContainer) {
        const rows = Array.from(bestScoreboardContainer.children);
        for (const row of rows) {
            const rowText = row.innerText || '';
            if (!rowText.includes('$') || rowText.length > 160) continue;

            // Strictly filter out any row that contains activity log words
            if (/paid|bought|rolled|landed|rent|tax|pardon|jail|prison|bankrupt|joined|left|game started|is playing/i.test(rowText)) continue;

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
                foundLocalPlayerInScoreboard = true;
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

    // 5. Fallback: Only scan other elements IF scoreboard container did not locate local player AND cash is unverified
    if (!foundLocalPlayerInScoreboard && !GameMemory.cashVerified && currentName) {
        const currentLower = currentName.toLowerCase();
        const candidates = document.querySelectorAll('*');
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (hud && hud.contains(el)) continue;

            const text = el.innerText || '';
            // Strictly exclude anything resembling activity logs or game action text
            if (/paid|bought|rolled|landed|rent|tax|pardon|jail|prison|bankrupt|joined|left|game started|is playing|received|pay|sent/i.test(text)) {
                continue;
            }

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
    if (!foundLocalPlayerInScoreboard && GameMemory.myName && GameMemory.players[GameMemory.myName]) {
        const storedCash = GameMemory.players[GameMemory.myName].cash;
        if (typeof storedCash === 'number') {
            GameMemory.myCash = storedCash;
            GameMemory.cashVerified = true;
        }
    }
}

/**
 * Dynamically reads property purchase prices and live house badges directly off board tiles
 */
export function syncBoardTilePricesAndBadgesFromDOM() {
    const hud = document.getElementById('rubot-hud-panel');
    const allEls = document.querySelectorAll('div, [class*="tile"], [class*="cell"]');

    for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        if (hud && hud.contains(el)) continue;

        const text = el.innerText || '';
        if (text.length > 100) continue;

        for (const tile of BOARD_TILES) {
            if (!tile.group) continue;
            if (new RegExp(`\\b${tile.name}\\b`, 'i').test(text)) {
                // 1. Dynamic property price tag on board tile
                if (text.includes('$')) {
                    const m = /(\d{2,4})\s*\$|\$\s*(\d{2,4})/.exec(text);
                    if (m) {
                        const price = parseInt(m[1] || m[2], 10);
                        if (!isNaN(price) && price >= 50 && price <= 500) {
                            tile.price = price;
                        }
                    }
                }

                // 2. Dynamic house/hotel badges on board tile (e.g. "🏠 x 3", "hotel")
                const houseMatch = /(?:🏠\s*x?\s*|x\s*)(\d)/i.exec(text);
                if (houseMatch && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].houses = parseInt(houseMatch[1], 10);
                } else if (/hotel/i.test(text) && GameMemory.ownership[tile.id]) {
                    GameMemory.ownership[tile.id].houses = 5;
                }
            }
        }
    }
}

/**
 * Dynamically scrapes property card modals when opened (as shown in assets/building-houses.png)
 * Scrapes live rent progression array, live house cost, live hotel cost, price, and owner.
 */
export function syncPropertyCardModalFromDOM() {
    const hud = document.getElementById('rubot-hud-panel');
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], div[style*="z-index"]');

    for (const modal of modals) {
        if (hud && hud.contains(modal)) continue;
        const text = modal.innerText || '';
        if (!text.includes('with rent') && !text.includes('with one house') && !text.includes('with a hotel')) continue;

        let matchedTile = null;
        for (const t of BOARD_TILES) {
            if (t.group && new RegExp(`\\b${t.name}\\b`, 'i').test(text)) {
                matchedTile = t;
                break;
            }
        }
        if (!matchedTile) continue;

        // 1. Dynamic rent progression table:
        const rBase = /with rent\s*\$?(\d+)/i.exec(text);
        const r1 = /with one house\s*\$?(\d+)/i.exec(text);
        const r2 = /with two houses\s*\$?(\d+)/i.exec(text);
        const r3 = /with three houses\s*\$?(\d+)/i.exec(text);
        const r4 = /with four houses\s*\$?(\d+)/i.exec(text);
        const rHotel = /with a hotel\s*\$?(\d+)/i.exec(text);

        if (rBase && r1 && r2 && r3 && r4 && rHotel) {
            matchedTile.rent = [
                parseInt(rBase[1], 10),
                parseInt(r1[1], 10),
                parseInt(r2[1], 10),
                parseInt(r3[1], 10),
                parseInt(r4[1], 10),
                parseInt(rHotel[1], 10)
            ];
        }

        // 2. Dynamic house cost:
        const houseCostMatch = /🏠\s*\$?(\d+)|house\s*\$?(\d+)/i.exec(text);
        if (houseCostMatch) {
            const hc = parseInt(houseCostMatch[1] || houseCostMatch[2], 10);
            if (!isNaN(hc) && hc >= 20 && hc <= 500) {
                matchedTile.houseCost = hc;
            }
        }

        // 3. Dynamic purchase price:
        const priceMatch = /Price\s*\$?(\d+)/i.exec(text);
        if (priceMatch) {
            const p = parseInt(priceMatch[1], 10);
            if (!isNaN(p) && p >= 30 && p <= 1000) {
                matchedTile.price = p;
            }
        }

        // 4. Dynamic owner:
        const ownerMatch = /Owner\s*([A-Za-z0-9_-]+)/i.exec(text);
        if (ownerMatch && GameMemory.ownership[matchedTile.id]) {
            const ownerName = ownerMatch[1].trim();
            if (ownerName && !ownerName.toLowerCase().includes('price')) {
                GameMemory.ownership[matchedTile.id].owner = ownerName;
            }
        }
        break;
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

function scanActivityLogsOnly() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hud = document.getElementById('rubot-hud-panel');

    let node = walker.nextNode();
    while (node) {
        if (!hud || !hud.contains(node.parentElement)) {
            const line = node.nodeValue ? node.nodeValue.trim() : '';
            if (line.length > 8 && line.length < 120 && !GameMemory.processedLogs.has(line)) {
                parseActivityLogLine(line);
            }
        }
        node = walker.nextNode();
    }
}

function scanTextNodesAndActivityLogs() {
    scanActivityLogsOnly();
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
 * Uses geometric 2-column boundary detection (as shown in assets/trade-properties.png):
 * Left column = Given items & cash slider
 * Right column = Received items & cash slider + Partner name
 */
export function scrapeTradeModalDOM() {
    const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
    if (!modal) {
        return { partnerName: 'Opponent', givenTiles: [], receivedTiles: [], givenCash: 0, receivedCash: 0 };
    }

    const modalRect = modal.getBoundingClientRect();
    const modalMidX = modalRect.left + modalRect.width / 2;

    let partnerName = 'Opponent';
    let givenCash = 0;
    let receivedCash = 0;
    const givenTiles = [];
    const receivedTiles = [];

    // 1. Dynamic cash extraction from range inputs / sliders
    const inputs = Array.from(modal.querySelectorAll('input[type="range"], input[type="number"], input'));
    for (const input of inputs) {
        const rect = input.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const val = parseInt(input.value, 10) || 0;
        if (center < modalMidX) {
            givenCash = val;
        } else {
            receivedCash = val;
        }
    }

    // Fallback: If sliders are styled badges (e.g. "0 $" or "150 $")
    if (givenCash === 0 && receivedCash === 0) {
        const badges = Array.from(modal.querySelectorAll('div, span, button')).filter(el => {
            const t = (el.innerText || '').trim();
            return /^\$?\d{1,5}\$?$/.test(t) && t.includes('$');
        });
        for (const badge of badges) {
            const rect = badge.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            const val = parseInt((badge.innerText || '').replace(/\D/g, ''), 10) || 0;
            if (center < modalMidX && givenCash === 0) givenCash = val;
            else if (center >= modalMidX && receivedCash === 0) receivedCash = val;
        }
    }

    // 2. Dynamic property tiles extraction scoped by column geometry (Left = Given, Right = Received)
    const cards = Array.from(modal.querySelectorAll('div, li, button, [class*="item" i], [class*="property" i], [class*="card" i]'));
    const matchedTileIds = new Set();

    for (const card of cards) {
        const text = (card.innerText || '').trim();
        if (!text || text.length > 50) continue;

        for (const tile of BOARD_TILES) {
            if (!tile.group) continue;
            if (matchedTileIds.has(tile.id)) continue;

            if (new RegExp(`^${tile.name}\\b|\\b${tile.name}$`, 'i').test(text)) {
                matchedTileIds.add(tile.id);
                const rect = card.getBoundingClientRect();
                const center = rect.left + rect.width / 2;
                if (center < modalMidX) {
                    givenTiles.push(tile);
                } else {
                    receivedTiles.push(tile);
                }
            }
        }
    }

    // 3. Dynamic partner name extraction from the right column header
    const topCandidates = Array.from(modal.querySelectorAll('h1, h2, h3, h4, h5, div, span, strong, b')).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left + rect.width / 2 >= modalMidX && rect.top < (modalRect.top + modalRect.height * 0.35);
    });

    for (const el of topCandidates) {
        const t = (el.innerText || '').trim();
        if (t.length >= 2 && t.length <= 24 && !t.includes('$') && !t.toLowerCase().includes('create') && !t.toLowerCase().includes('trade')) {
            for (const pName of Object.keys(GameMemory.players)) {
                if (!GameMemory.isMe(pName) && t.toLowerCase().includes(pName.toLowerCase())) {
                    partnerName = pName;
                    break;
                }
            }
            if (partnerName !== 'Opponent') break;
            if (!GameMemory.isMe(t) && !BOARD_LABELS_BLACKLIST.has(t.toLowerCase())) {
                partnerName = t;
                break;
            }
        }
    }

    return {
        partnerName,
        givenTiles,
        receivedTiles,
        givenCash,
        receivedCash
    };
}
