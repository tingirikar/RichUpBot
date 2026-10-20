import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OllamaClient } from '../engine/ollamaClient.js';
import { logToBot } from '../dom/actionExecutor.js';

/**
 * CONTEXT-AWARE REACT CHAT ENGINE
 * 
 * 1. Injects natural trade negotiation messages into RichUp's chat bar
 * 2. Scans incoming opponent chat ("chat if not bot", greetings, trade requests)
 *    and responds naturally using Ollama (or clever human fallbacks)
 */
export const ChatEngine = {
    lastSentTime: 0,
    lastSentText: '',
    lastRepliedTime: 0,
    processedChatIds: new Set(),

    TEMPLATES: Object.freeze({
        tradeReject: [
            "nah sry",
            "cant do that",
            "nty",
            "need more cash with that",
            "counter me with cash",
            "keeping that sry",
            "no thx",
            "pass for now"
        ],
        tradeAccept: [
            "deal thx",
            "gg thanks",
            "nice trade",
            "thx",
            "accepted"
        ],
        tradeNegotiate: [
            "counter me",
            "add some cash and ill do it",
            "almost, add cash",
            "need a bit more cash"
        ]
    }),

    /**
     * Scans the room chat feed and generates conversational replies to opponents
     */
    async scanAndRespondToOpponentChat() {
        if (!CONFIG.CHAT_ENABLED || !CONFIG.AUTO_REPLY_CHAT) return false;

        const now = Date.now();
        if (now - this.lastRepliedTime < (CONFIG.CHAT_REPLY_COOLDOWN_MS || 7000)) return false;

        // Locate chat input in the bottom left
        const input = document.querySelector('input[placeholder*="say" i], input[placeholder*="something" i], input[placeholder*="chat" i], input[placeholder*="message" i], textarea');
        if (!input) return false;

        // Find message bubbles in the chat container
        const chatContainer = input.closest('form, [class*="chat"], div')?.parentElement || document.body;
        const bubbles = chatContainer.querySelectorAll('[class*="message"], [class*="bubble"], div');

        for (let i = bubbles.length - 1; i >= 0; i--) {
            const el = bubbles[i];
            const text = (el.innerText || '').trim();
            if (!text || text.length < 2 || text.length > 140) continue;
            if (text.includes('Say something') || text.includes('joined room') || text.includes('joined the game') || text.includes('Game started')) continue;

            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length >= 2) {
                const sender = lines[0];
                const msgText = lines.slice(1).join(' ').trim();

                // Skip if sent by ourselves
                if (GameMemory.isMe(sender) || !sender || sender.length > 20) continue;

                const msgId = `${sender}:${msgText}`;
                if (this.processedChatIds.has(msgId)) continue;
                this.processedChatIds.add(msgId);

                // Found a new incoming opponent chat message!
                this.lastRepliedTime = now;
                logToBot(`[CHAT DETECTED] ${sender}: "${msgText}". Engaging with AI reply...`);

                const reply = await OllamaClient.generateChatResponse(sender, msgText);
                if (reply) {
                    this.sendChatMessage(null, reply);
                    return true;
                }
            }
        }
        return false;
    },

    sendChatMessage(category, customText = null) {
        if (!CONFIG.CHAT_ENABLED) return false;

        const now = Date.now();
        let message = (customText || '').trim();

        if (!message) {
            const list = this.TEMPLATES[category];
            if (!list || list.length === 0) return false;
            message = list[Math.floor(Math.random() * list.length)];
        }

        // Enforce lowercase, casual human gamer style: strip robot prefixes & trailing periods
        message = message
            .replace(/^(decline:|accept:|negotiate:|counter:)\s*/i, '')
            .replace(/[.!]$/, '')
            .toLowerCase()
            .trim();

        // Strict global cooldown: minimum 6 seconds between any outgoing chat messages
        const cooldown = CONFIG.CHAT_COOLDOWN_MS || 6000;
        if (now - this.lastSentTime < cooldown) return false;

        // Message deduplication: never spam the same message within 25 seconds
        if (this.lastSentText && message.toLowerCase() === this.lastSentText.toLowerCase() && (now - this.lastSentTime < 25000)) {
            return false;
        }

        const input = document.querySelector('input[placeholder*="say" i], input[placeholder*="something" i], input[placeholder*="chat" i], input[placeholder*="message" i], textarea');
        if (!input) return false;

        this.lastSentTime = now;
        this.lastSentText = message;
        logToBot(`[CHAT SEND] "${message}"`);

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

                    // Also click the paper plane button if present
                    const sendBtn = input.parentElement?.querySelector('button');
                    if (sendBtn) {
                        try { sendBtn.click(); } catch (_) {}
                    }
                }, 90);
            } catch (err) {
                logToBot(`Chat error: ${err}`);
            }
        }, 320);

        return true;
    }
};
