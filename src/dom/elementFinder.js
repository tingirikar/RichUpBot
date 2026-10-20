/**
 * RESILIENT DOM ELEMENT FINDER
 * 
 * Uses semantic text matching and ARIA attributes rather than fragile CSS classes.
 * Immune to React build hashes and class name changes.
 */

import { BOARD_TILES } from '../data/boardTiles.js';

export function isVisibleAndEnabled(el) {
    if (!el || el.disabled) return false;

    // Ignore clicks inside our own bot HUD panel
    const hud = document.getElementById('rubot-hud-panel');
    if (hud && hud.contains(el)) return false;

    if (el.getAttribute('aria-disabled') === 'true') return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

export function normalizeText(el) {
    return String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function createDOMSnapshot() {
    const hud = document.getElementById('rubot-hud-panel');
    const rawElements = document.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i]');
    const allButtons = [];

    for (let i = 0; i < rawElements.length; i++) {
        const btn = rawElements[i];
        if (hud && hud.contains(btn)) continue;
        if (!isVisibleAndEnabled(btn)) continue;
        allButtons.push({
            el: btn,
            text: normalizeText(btn)
        });
    }

    return {
        allButtons,

        findExactOrIncludes(patterns) {
            for (const p of patterns) {
                const lower = p.toLowerCase();
                for (const b of allButtons) {
                    if (b.text === lower || b.text.includes(lower)) return b.el;
                }
            }
            return null;
        },

        findBuyPropertyButton() {
            // 1. Direct scan across all detected buttons
            for (const b of allButtons) {
                const txt = b.text;
                if (
                    (txt.includes('buy') || txt.includes('purchase')) &&
                    !txt.includes("don't buy") &&
                    !txt.includes("dont buy") &&
                    !txt.includes('house') &&
                    !txt.includes('hotel') &&
                    !txt.includes('back') &&
                    !txt.includes('cancel')
                ) {
                    return b.el;
                }
            }

            // 2. Check modal or center prompt if present
            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="card" i]');
            if (modal && (!hud || !hud.contains(modal))) {
                const modalBtns = modal.querySelectorAll('button, [role="button"], [class*="btn" i], div');
                for (let i = 0; i < modalBtns.length; i++) {
                    const btn = modalBtns[i];
                    if (!isVisibleAndEnabled(btn)) continue;
                    const txt = normalizeText(btn);
                    if (
                        txt.length <= 35 &&
                        (txt.includes('buy') || txt.includes('purchase')) &&
                        !txt.includes("don't") &&
                        !txt.includes("dont") &&
                        !txt.includes('house') &&
                        !txt.includes('hotel') &&
                        !txt.includes('back')
                    ) {
                        return btn;
                    }
                }
            }

            // 3. Fallback: scan any clickable element on the page
            const allClickables = Array.from(document.querySelectorAll('button, [role="button"], [class*="btn" i], div, a, span'))
                .filter(el => !hud || !hud.contains(el));
            
            for (const el of allClickables) {
                if (!isVisibleAndEnabled(el)) continue;
                const txt = normalizeText(el);
                if (
                    txt.length <= 35 &&
                    (txt.includes('buy') || txt.includes('purchase')) &&
                    !txt.includes("don't") &&
                    !txt.includes("dont") &&
                    !txt.includes('house') &&
                    !txt.includes('hotel') &&
                    !txt.includes('back') &&
                    !txt.includes('cancel')
                ) {
                    return el;
                }
            }

            return null;
        },

        findAuctionBidButton(preferredIncrement = 10) {
            if (preferredIncrement >= 50) {
                for (const b of allButtons) {
                    if (b.text.includes('+50') || b.text.includes('+ 50') || b.text.includes('+$50') || b.text.includes('+ $50')) {
                        return b.el;
                    }
                }
            }
            for (const b of allButtons) {
                if (
                    b.text.includes('+$') ||
                    b.text.includes('+ $') ||
                    b.text.includes('+10') ||
                    (b.text.includes('bid') && !b.text.includes('history'))
                ) {
                    return b.el;
                }
            }
            return null;
        },

        findAuctionPassButton() {
            return this.findExactOrIncludes(['pass', 'withdraw', "don't bid", 'skip bid']);
        },

        /**
         * Finds "+ Create" button under Trades panel in the sidebar
         */
        findCreateTradeButton() {
            for (const b of allButtons) {
                if (
                    (b.text === '+ create' || b.text === 'create' || b.text.includes('create trade')) &&
                    !b.text.includes('game') &&
                    !b.text.includes('room')
                ) {
                    return b.el;
                }
            }
            // Fallback: search any clickable element containing "+ create" or "create" near Trades
            const elements = document.querySelectorAll('div, span, button, a');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const text = normalizeText(el);
                if ((text === '+ create' || text === 'create') && !text.includes('game') && !text.includes('room')) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds player selection button inside "Create a trade" modal
         */
        findPlayerSelectButton(targetPlayerName) {
            if (!targetPlayerName) return null;
            const targetLower = targetPlayerName.toLowerCase();
            for (const b of allButtons) {
                if (b.text === targetLower || b.text.includes(targetLower)) {
                    return b.el;
                }
            }
            // Check within modal/dialog for player option row/card
            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            const searchRoot = modal || document.body;
            const candidates = searchRoot.querySelectorAll('button, div, [role="button"], li, a, span');
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const text = normalizeText(el);
                if (text === targetLower || (text.includes(targetLower) && text.length < targetLower.length + 20)) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds the "Send trade" submission button
         */
        findSendTradeButton() {
            for (const b of allButtons) {
                if (b.text.includes('send trade') || b.text.includes('propose trade') || b.text === 'send') {
                    return b.el;
                }
            }
            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            const searchRoot = modal || document.body;
            const btns = searchRoot.querySelectorAll('button, [role="button"], div, span');
            for (let i = 0; i < btns.length; i++) {
                const el = btns[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const text = normalizeText(el);
                if (text.includes('send trade') || text.includes('propose trade') || text === 'send') {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds incoming trade rows under the "Trades" sidebar (e.g. "Round Guest ↔ Lokesh")
         */
        findSidebarIncomingTradeItem() {
            const allItems = document.querySelectorAll('div, li, button, [class*="trade"], p, span');
            const hud = document.getElementById('rubot-hud-panel');
            for (let i = 0; i < allItems.length; i++) {
                const el = allItems[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const text = normalizeText(el);
                if ((text.includes('↔') || text.includes('<->')) && text.length < 50) {
                    return el;
                }
            }
            return null;
        },

        findTradeConfirmButton() {
            return this.findExactOrIncludes(['confirm', 'accept', 'agree']);
        },

        findTradeDeclineButton() {
            return this.findExactOrIncludes(['decline', 'reject', 'refuse']);
        },

        findTradeNegotiateButton() {
            return this.findExactOrIncludes(['negotiate', 'counter']);
        },

        /**
         * Detects if a property card popover/modal is currently open and returns its DOM element & tile info
         */
        /**
         * Detects if a property card popover/modal is currently open and returns its DOM element & tile info
         */
        getOpenPropertyCard() {
            const containers = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="popover" i], div');
            for (let i = 0; i < containers.length; i++) {
                const c = containers[i];
                if (hud && hud.contains(c)) continue;
                if (!isVisibleAndEnabled(c)) continue;

                // Exclude the right-side properties sidebar (typically on right side > 65% width and fixed)
                const rect = c.getBoundingClientRect();
                if (rect.width < 160 || rect.height < 160) continue;
                if (rect.left > window.innerWidth * 0.65 && rect.width < 320) continue;

                const text = c.innerText || '';
                const lower = text.toLowerCase();

                // Strictly exclude Auction, Bidding, Trade, and Lobby modals!
                if (
                    lower.includes('auction') ||
                    lower.includes("i'm bidding") ||
                    lower.includes('current bid') ||
                    lower.includes('highest bid') ||
                    lower.includes('sold in') ||
                    lower.includes('trades') ||
                    lower.includes('select your player')
                ) {
                    continue;
                }

                // Must look like an open property card (contains "Owner", "Price", "with rent", "when")
                if (
                    (text.includes('Owner') || text.includes('Price') || text.includes('with rent') || text.includes('when'))
                ) {
                    for (const t of BOARD_TILES) {
                        if (t.group && new RegExp(`\\b${t.name}\\b`, 'i').test(text)) {
                            return { el: c, tile: t };
                        }
                    }
                }
            }
            return null;
        },

        /**
         * Helper to get the action buttons row inside the open property card:
         * Button 0: Upgrade [↑]
         * Button 1: Sell / Downgrade [↓]
         * Button 2: Mortgage [🗑️]
         */
        getPropertyCardActionButtons() {
            const card = this.getOpenPropertyCard();
            if (!card) return [];

            const allCardBtns = Array.from(card.el.querySelectorAll('button, [role="button"], [class*="button" i]')).filter(b => {
                if (hud && hud.contains(b)) return false;
                if (!isVisibleAndEnabled(b)) return false;
                const txt = (b.innerText || '').trim().toLowerCase();
                // Filter out turn completion or modal close buttons
                if (txt.includes('end turn') || txt.includes('roll') || txt.includes('bankrupt') || txt === 'x') return false;
                return true;
            });

            return allCardBtns;
        },

        /**
         * Finds the UP-ARROW [↑] button to build a house inside the property card popover
         */
        findModalUpgradeButton() {
            const actionBtns = this.getPropertyCardActionButtons();
            for (const btn of actionBtns) {
                const inner = btn.innerHTML || '';
                const text = normalizeText(btn);
                if (
                    inner.includes('↑') || inner.includes('⭡') ||
                    inner.includes('arrow-up') || text.includes('upgrade') || text.includes('build')
                ) {
                    return btn;
                }
            }
            // RichUp position-based action: 1st button in the 3-button action group
            if (actionBtns.length >= 2) {
                return actionBtns[0];
            }

            // Fallback: search all buttons on screen
            for (const b of allButtons) {
                const inner = b.el.innerHTML || '';
                if (inner.includes('↑') || inner.includes('⭡') || b.text === '↑' || b.text.includes('upgrade') || b.text.includes('build')) {
                    return b.el;
                }
            }
            return null;
        },

        /**
         * Finds the DOWN-ARROW [↓] button to sell a house inside the property card popover
         */
        findModalSellHouseButton() {
            const actionBtns = this.getPropertyCardActionButtons();
            for (const btn of actionBtns) {
                const inner = btn.innerHTML || '';
                const text = normalizeText(btn);
                if (
                    inner.includes('↓') || inner.includes('⭣') ||
                    inner.includes('arrow-down') || text.includes('sell') || text.includes('downgrade')
                ) {
                    return btn;
                }
            }
            // RichUp position-based action: 2nd button in the 3-button action group
            if (actionBtns.length >= 3) {
                return actionBtns[1];
            }

            for (const b of allButtons) {
                const inner = b.el.innerHTML || '';
                if (inner.includes('↓') || inner.includes('⭣') || b.text === '↓' || b.text.includes('sell') || b.text.includes('downgrade')) {
                    return b.el;
                }
            }
            return null;
        },

        /**
         * Finds the Mortgage [🗑️] button inside the property card popover/modal
         */
        findModalMortgageButton() {
            const card = this.getOpenPropertyCard();
            // If the open property card is ALREADY mortgaged, button is UNMORTGAGE! Do not return as mortgage!
            if (card && GameMemory.ownership[card.tile.id]?.mortgaged) {
                return null;
            }

            const actionBtns = this.getPropertyCardActionButtons();
            
            // 1. If property has 0 houses / singleton, RichUp only renders 1 action button: Mortgage!
            if (actionBtns.length === 1) {
                return actionBtns[0];
            }

            for (const btn of actionBtns) {
                const inner = (btn.innerHTML || '').toLowerCase();
                const text = normalizeText(btn);
                if (
                    text.includes('mortgage') || inner.includes('mortgage') ||
                    inner.includes('trash') || inner.includes('bin') ||
                    inner.includes('m19 7')
                ) {
                    if (!text.includes('unmortgage') && !inner.includes('unmortgage')) return btn;
                }
            }

            // RichUp position-based action: In a 3-button action group ([↑], [↓], [🗑️]), 3rd button is Mortgage!
            if (actionBtns.length >= 3) {
                return actionBtns[2];
            }

            for (const b of allButtons) {
                const text = b.text || '';
                const inner = (b.el.innerHTML || '').toLowerCase();
                if (
                    (text.includes('mortgage') || inner.includes('mortgage')) &&
                    !text.includes('unmortgage') && !inner.includes('unmortgage')
                ) {
                    return b.el;
                }
            }
            return null;
        },

        /**
         * Finds the Unmortgage button inside the property card popover/modal
         */
        findModalUnmortgageButton() {
            const card = this.getOpenPropertyCard();
            if (!card) return null;

            const cardBtns = Array.from(card.el.querySelectorAll('button, [role="button"], [class*="button" i]')).filter(b => {
                if (hud && hud.contains(b)) return false;
                if (!isVisibleAndEnabled(b)) return false;
                return true;
            });

            for (const btn of cardBtns) {
                const text = normalizeText(btn);
                const inner = (btn.innerHTML || '').toLowerCase();
                if (text.includes('unmortgage') || inner.includes('unmortgage') || text.includes('un-mortgage')) {
                    return btn;
                }
            }

            // If tile is marked mortgaged and card is open, the action button is the unmortgage trigger
            const tileInfo = GameMemory.ownership[card.tile.id];
            if (tileInfo && tileInfo.mortgaged) {
                const actionBtns = this.getPropertyCardActionButtons();
                if (actionBtns.length > 0) return actionBtns[0];
            }
            return null;
        },

        /**
         * Finds the close button ([X]) inside the open property card popover/modal
         */
        findModalCloseButton() {
            const card = this.getOpenPropertyCard();
            if (!card) return null;

            const allClose = card.el.querySelectorAll('button, [role="button"], span, div');
            for (let i = 0; i < allClose.length; i++) {
                const el = allClose[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const txt = normalizeText(el);
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const inner = (el.innerHTML || '').toLowerCase();
                if (
                    txt === 'x' || txt === '✕' || txt === '✖' || txt === 'close' ||
                    aria.includes('close') || inner.includes('close') ||
                    (el.tagName === 'BUTTON' && el.querySelector('svg') && el.getBoundingClientRect().width < 38)
                ) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds a property item specifically in the right-side "My properties" sidebar
         */
        findSidebarPropertyItem(propertyName) {
            if (!propertyName) return null;
            const lowerTarget = propertyName.toLowerCase().trim();

            // Locate right sidebar elements (x > 55% viewport width) to prevent hitting board tiles
            const allItems = document.querySelectorAll('div, li, button, [class*="property" i], [class*="item" i], p, span');
            for (let i = 0; i < allItems.length; i++) {
                const el = allItems[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;

                const rect = el.getBoundingClientRect();
                if (rect.left < window.innerWidth * 0.55) continue; // Must be in the right panel!
                if (rect.height < 18 || rect.height > 85 || rect.width < 80) continue;

                const text = normalizeText(el);
                if (text.includes('my properties') || text.includes('trades') || text.includes('bankrupt')) continue;

                if (text === lowerTarget || text.startsWith(lowerTarget) || (text.includes(lowerTarget) && text.length < lowerTarget.length + 15)) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds a property element inside the trade modal, with column-awareness:
         * column: 'mine' / 'left' (left side) vs 'theirs' / 'right' (right side)
         */
        findTradePropertyCard(propertyName, column = null) {
            if (!propertyName) return null;
            const lowerName = propertyName.toLowerCase();

            const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
            const searchRoot = modal || document.body;
            const modalRect = searchRoot.getBoundingClientRect();
            const modalCenter = modalRect.left + modalRect.width / 2;

            const candidates = searchRoot.querySelectorAll('button, [role="button"], div, li, span, p');
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                if (!isVisibleAndEnabled(el)) continue;

                // Column side partitioning
                if (column && modal) {
                    const rect = el.getBoundingClientRect();
                    const elCenter = rect.left + rect.width / 2;
                    if ((column === 'mine' || column === 'left') && elCenter > modalCenter) continue;
                    if ((column === 'theirs' || column === 'right') && elCenter < modalCenter) continue;
                }

                const text = normalizeText(el);
                if (
                    text === lowerName || 
                    text.startsWith(lowerName) || 
                    text.endsWith(lowerName) ||
                    (text.includes(lowerName) && text.length < lowerName.length + 35)
                ) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Detects the red/orange [Bankrupt] button that appears when the player is in debt
         */
        findBankruptButton() {
            for (const b of allButtons) {
                const txt = (b.text || '').toLowerCase();
                if (txt === 'bankrupt' || txt.includes('bankrupt')) {
                    return b.el;
                }
            }
            const candidates = document.querySelectorAll('button, [role="button"], a, div');
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                if (hud && hud.contains(el)) continue;
                if (!isVisibleAndEnabled(el)) continue;
                const txt = normalizeText(el);
                if (txt === 'bankrupt' || (txt.includes('bankrupt') && txt.length <= 20)) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Finds a board tile element on the screen so the bot can click it
         */
        findBoardTileElement(tileName) {
            if (!tileName) return null;
            const lowerName = tileName.toLowerCase();

            const allElements = document.querySelectorAll('[class*="block"], [class*="tile"], [class*="property"], div');
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i];
                if (!isVisibleAndEnabled(el)) continue;

                const text = normalizeText(el);
                if (text === lowerName || el.getAttribute('title')?.toLowerCase() === lowerName) {
                    return el;
                }
            }
            return null;
        }
    };
}
