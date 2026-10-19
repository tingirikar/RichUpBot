/**
 * RESILIENT DOM ELEMENT FINDER
 * 
 * Uses semantic text matching and ARIA attributes rather than fragile CSS classes.
 * Immune to React build hashes and class name changes.
 */

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
            // Check modal first if open
            const modal = document.querySelector('[role="dialog"], [class*="modal" i]');
            if (modal && (!hud || !hud.contains(modal))) {
                const modalBtns = modal.querySelectorAll('button, [role="button"], [class*="btn" i]');
                for (let i = 0; i < modalBtns.length; i++) {
                    const btn = modalBtns[i];
                    if (!isVisibleAndEnabled(btn)) continue;
                    const txt = normalizeText(btn);
                    if (
                        txt.includes('buy') &&
                        !txt.includes('house') &&
                        !txt.includes('hotel') &&
                        !txt.includes('back')
                    ) {
                        return btn;
                    }
                }
            }

            for (const b of allButtons) {
                if (
                    b.text.includes('buy') &&
                    !b.text.includes('house') &&
                    !b.text.includes('hotel') &&
                    !b.text.includes('back') &&
                    (b.text.startsWith('buy') || b.text.endsWith('buy') || b.text.includes('buy for') || b.text.includes('purchase'))
                ) {
                    return b.el;
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
         * Finds the UP-ARROW [↑] button to build a house inside the property card modal
         */
        findModalUpgradeButton() {
            const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="property-modal"]');
            if (!modal) return null;

            const btns = modal.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (!isVisibleAndEnabled(btn)) continue;
                const inner = btn.innerHTML || '';
                const text = normalizeText(btn);

                // Matches up arrow icon, svg, or upgrade text
                if (
                    inner.includes('↑') || 
                    inner.includes('arrow-up') || 
                    inner.includes('M5 10l7-7m0 0l7 7m-7-7v18') ||
                    text.includes('upgrade') ||
                    text.includes('build')
                ) {
                    return btn;
                }
            }
            // Fallback: If 3 buttons exist in a row, button 0 is usually Upgrade
            if (btns.length >= 3 && isVisibleAndEnabled(btns[0])) {
                return btns[0];
            }
            return null;
        },

        /**
         * Finds the DOWN-ARROW [↓] button to sell a house inside the property modal
         */
        findModalSellHouseButton() {
            const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="property-modal"]');
            if (!modal) return null;

            const btns = modal.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (!isVisibleAndEnabled(btn)) continue;
                const inner = btn.innerHTML || '';
                const text = normalizeText(btn);

                if (
                    inner.includes('↓') || 
                    inner.includes('arrow-down') || 
                    inner.includes('M19 14l-7 7m0 0l-7-7m7 7V3') ||
                    text.includes('sell') ||
                    text.includes('downgrade')
                ) {
                    return btn;
                }
            }
            if (btns.length >= 3 && isVisibleAndEnabled(btns[1])) {
                return btns[1];
            }
            return null;
        },

        /**
         * Finds the TRASH [🗑] button to mortgage a property inside the modal
         */
        findModalMortgageButton() {
            const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="property-modal"]');
            if (!modal) return null;

            const btns = modal.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (!isVisibleAndEnabled(btn)) continue;
                const inner = btn.innerHTML || '';
                const text = normalizeText(btn);

                if (
                    inner.includes('🗑') || 
                    inner.includes('trash') || 
                    inner.includes('mortgage') ||
                    text.includes('mortgage')
                ) {
                    return btn;
                }
            }
            if (btns.length >= 3 && isVisibleAndEnabled(btns[2])) {
                return btns[2];
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
         * Finds a property element inside the trade modal
         */
        findTradePropertyCard(propertyName) {
            if (!propertyName) return null;
            const lowerName = propertyName.toLowerCase();

            const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="trade"]');
            const searchRoot = modal || document.body;

            const candidates = searchRoot.querySelectorAll('button, div, span, p');
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                if (!isVisibleAndEnabled(el)) continue;
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
