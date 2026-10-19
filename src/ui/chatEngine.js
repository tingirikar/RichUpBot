import { CONFIG } from '../config.js';
import { logToBot } from '../dom/actionExecutor.js';

/**
 * CONTEXT-AWARE REACT CHAT ENGINE
 * 
 * Injects natural trade negotiation messages into RichUp's chat bar
 * using React synthetic input events.
 */
export const ChatEngine = {
    lastSentTime: 0,

    TEMPLATES: Object.freeze({
        tradeReject: [
            "Numbers don't add up for me on that offer, sweeten the cash.",
            "Can't let that property go that cheap. Add some cash on top?",
            "That leaves me short on board value, no deal."
        ],
        tradeAccept: [
            "Deal accepted! Win-win.",
            "Pleasure doing business with you.",
            "Good trade, let's see how the dice roll."
        ]
    }),

    sendChatMessage(category, customText = null) {
        if (!CONFIG.CHAT_ENABLED) return false;

        const now = Date.now();
        if (now - this.lastSentTime < CONFIG.CHAT_COOLDOWN_MS) return false;

        let message = customText;
        if (!message) {
            const list = this.TEMPLATES[category];
            if (!list || list.length === 0) return false;
            message = list[Math.floor(Math.random() * list.length)];
        }

        const input = document.querySelector('input[placeholder*="chat" i], input[placeholder*="message" i], textarea[placeholder*="chat" i]');
        if (!input) return false;

        this.lastSentTime = now;
        logToBot(`[CHAT] ${message}`);

        // Humanized typing delay
        setTimeout(() => {
            try {
                input.focus();

                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

                if (nativeSetter) {
                    nativeSetter.call(input, message);
                } else {
                    input.value = message;
                }

                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                setTimeout(() => {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                }, 80);
            } catch (err) {
                logToBot(`Chat error: ${err}`);
            }
        }, 300);

        return true;
    }
};
