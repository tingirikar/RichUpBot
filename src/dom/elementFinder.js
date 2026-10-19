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

        findAuctionBidButton() {
            for (const b of allButtons) {
                if (
                    b.text.includes('+$') ||
                    b.text.includes('+ $') ||
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
        getOpenPropertyCard() {
            const containers = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="popover" i], [class*="property" i]');
            for (const c of containers) {
                if (hud && hud.contains(c)) continue;
                if (!isVisibleAndEnabled(c)) continue;
                // Exclude the right-side properties sidebar (typically on right side > 65% width)
                const rect = c.getBoundingClientRect();
                if (rect.left > window.innerWidth * 0.65 && rect.width < 320) continue;

                const text = c.innerText || '';
                // Must look like an open property card (contains "Owner", "Price", "when", or "rent")
                if (text.includes('Owner') || text.includes('Price') || text.includes('when') || text.includes('rent') || text.includes('Mortgage') || text.includes('mortgage')) {
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
         * Finds the UP-ARROW [↑] button to build a house inside the property card popover
         */
        findModalUpgradeButton() {
            const openCard = this.getOpenPropertyCard();
            const searchContainers = openCard ? [openCard.el] : document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="popover" i]');
            for (const c of searchContainers) {
                if (hud && hud.contains(c)) continue;
                const btns = c.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i]');
                for (let i = 0; i < btns.length; i++) {
                    const btn = btns[i];
                    if (!isVisibleAndEnabled(btn)) continue;
                    const inner = btn.innerHTML || '';
                    const text = normalizeText(btn);
                    if (
                        inner.includes('↑') || inner.includes('⭡') ||
                        inner.includes('arrow-up') || 
                        inner.includes('M5 10l7-7m0 0l7 7m-7-7v18') ||
                        text.includes('upgrade') || text.includes('build')
                    ) {
                        return btn;
                    }
                }
            }
            // Page-wide fallback
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
            const openCard = this.getOpenPropertyCard();
            const searchContainers = openCard ? [openCard.el] : document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="popover" i]');
            for (const c of searchContainers) {
                if (hud && hud.contains(c)) continue;
                const btns = c.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i]');
                for (let i = 0; i < btns.length; i++) {
                    const btn = btns[i];
                    if (!isVisibleAndEnabled(btn)) continue;
                    const inner = btn.innerHTML || '';
                    const text = normalizeText(btn);
                    if (
                        inner.includes('↓') || inner.includes('⭣') ||
                        inner.includes('arrow-down') || 
                        inner.includes('M19 14l-7 7m0 0l-7-7m7 7V3') ||
                        text.includes('sell') || text.includes('downgrade')
                    ) {
                        return btn;
                    }
                }
            }
            // Page-wide fallback
            for (const b of allButtons) {
                const inner = b.el.innerHTML || '';
                if (inner.includes('↓') || inner.includes('⭣') || b.text === '↓' || b.text.includes('sell') || b.text.includes('downgrade')) {
                    return b.el;
                }
            }
            return null;
        },

        /**
         * Finds the Mortgage button inside the property card popover/modal
         */
        findModalMortgageButton() {
            const openCard = this.getOpenPropertyCard();
            const searchContainers = openCard ? [openCard.el] : document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="popover" i]');
            for (const c of searchContainers) {
                if (hud && hud.contains(c)) continue;
                // Target real clickable button elements
                const btns = c.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i]');
                for (let i = 0; i < btns.length; i++) {
                    const btn = btns[i];
                    if (!isVisibleAndEnabled(btn)) continue;
                    const inner = (btn.innerHTML || '').toLowerCase();
                    const text = normalizeText(btn);

                    // Strictly match "mortgage" and ignore "unmortgage"
                    if (
                        (text.includes('mortgage') || inner.includes('mortgage')) &&
                        !text.includes('unmortgage') && !inner.includes('unmortgage')
                    ) {
                        return btn;
                    }
                }
            }
            // Page-wide fallback for buttons
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
         * Finds a property item in the "My properties" sidebar to open its management modal
         */
        findSidebarPropertyItem(propertyName) {
            if (!propertyName) return null;
            const lowerTarget = propertyName.toLowerCase();

            // Find all elements under My properties sidebar
            const allItems = document.querySelectorAll('div, li, button, [class*="property"]');
            for (let i = 0; i < allItems.length; i++) {
                const el = allItems[i];
                if (!isVisibleAndEnabled(el)) continue;

                const text = normalizeText(el);
                if (text === lowerTarget || (text.includes(lowerTarget) && text.length < lowerTarget.length + 15)) {
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
