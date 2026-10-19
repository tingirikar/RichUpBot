import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { GROUP_TILES } from '../data/boardTiles.js';
import { TradeEngine } from './tradeEngine.js';

/**
 * LOCAL OLLAMA HYBRID VISION & REASONING CLIENT
 * 
 * Communicates with local Ollama instance (e.g. http://localhost:11434)
 * to evaluate trade proposals, negotiate counter-offers, and generate
 * persuasive psychological in-game chat messages.
 * 
 * Features:
 * - Uses GM_xmlhttpRequest if available (bypasses browser CORS & mixed-content),
 *   otherwise falls back to fetch()
 * - 2.8s strict timeout with automatic mathematical Minimax fallback
 * - Health check / ping endpoint to verify Ollama status in the HUD
 * - 100% offline, local, private, and zero API costs
 */
export const OllamaClient = {
    status: 'unchecked', // 'connected' | 'offline' | 'error'

    /**
     * Universal HTTP helper using GM_xmlhttpRequest if present, else fetch
     */
    httpRequest({ method = 'POST', url, data = null, timeout = 2800 }) {
        return new Promise((resolve, reject) => {
            // Check for Tampermonkey GM_xmlhttpRequest
            const gmReq = (typeof GM_xmlhttpRequest !== 'undefined') ? GM_xmlhttpRequest
                : (typeof GM !== 'undefined' && GM && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;

            if (gmReq) {
                gmReq({
                    method,
                    url,
                    headers: { 'Content-Type': 'application/json' },
                    data: data ? JSON.stringify(data) : null,
                    timeout,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            try {
                                resolve(JSON.parse(res.responseText));
                            } catch (e) {
                                reject(e);
                            }
                        } else {
                            reject(new Error(`Ollama HTTP ${res.status}: ${res.statusText || ''}`));
                        }
                    },
                    ontimeout: () => reject(new Error('Ollama request timed out (>2.8s)')),
                    onerror: (err) => reject(new Error(`Ollama connection error: ${err.message || 'Host unreachable'}`))
                });
                return;
            }

            // Fallback to standard fetch
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);

            fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: data ? JSON.stringify(data) : undefined,
                signal: controller.signal
            })
            .then(res => {
                clearTimeout(tid);
                if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
                return res.json();
            })
            .then(resolve)
            .catch(err => {
                clearTimeout(tid);
                reject(err);
            });
        });
    },

    /**
     * Checks if Ollama is running and lists available models
     */
    async checkHealth() {
        try {
            const data = await this.httpRequest({
                method: 'GET',
                url: `${CONFIG.OLLAMA_HOST}/api/tags`,
                timeout: 1800
            });
            const models = (data?.models || []).map(m => m.name);
            this.status = 'connected';
            return {
                ok: true,
                models,
                hasTargetModel: models.some(m => m.includes(CONFIG.OLLAMA_MODEL))
            };
        } catch (err) {
            this.status = 'offline';
            return {
                ok: false,
                error: err.message
            };
        }
    },

    /**
     * Evaluates incoming trade with local LLM or falls back to Minimax Markov
     */
    async evaluateTradeWithLLM(tradeData) {
        if (!CONFIG.OLLAMA_ENABLED) {
            return TradeEngine.evaluateIncomingTrade(tradeData);
        }

        const prompt = this.buildPrompt(tradeData);

        try {
            const payload = {
                model: CONFIG.OLLAMA_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a Grandmaster Monopoly / RichUp AI player. Evaluate trade offers with sharp strategic vision. Output ONLY valid JSON in format: {"decision": "CONFIRM" | "DECLINE" | "NEGOTIATE", "reason": "concise rationale under 15 words", "chatReply": "short casual in-game message under 15 words"}'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                stream: false,
                options: {
                    temperature: 0.1,
                    num_predict: 120
                }
            };

            const data = await this.httpRequest({
                method: 'POST',
                url: `${CONFIG.OLLAMA_HOST}/api/chat`,
                data: payload,
                timeout: CONFIG.OLLAMA_TIMEOUT_MS || 2800
            });

            const rawContent = data?.message?.content || '';
            const parsed = this.parseJsonSafely(rawContent);

            if (parsed && (parsed.decision === 'CONFIRM' || parsed.decision === 'DECLINE' || parsed.decision === 'NEGOTIATE')) {
                return {
                    accept: parsed.decision === 'CONFIRM',
                    negotiate: parsed.decision === 'NEGOTIATE',
                    reason: `[Ollama ${CONFIG.OLLAMA_MODEL}] ${parsed.reason}`,
                    chatReply: parsed.chatReply || ''
                };
            }

            // Fallback if response schema didn't match
            return TradeEngine.evaluateIncomingTrade(tradeData);
        } catch (_) {
            // Automatic instant fallback to mathematical Minimax engine
            return TradeEngine.evaluateIncomingTrade(tradeData);
        }
    },

    buildPrompt(tradeData) {
        const givenTiles = (tradeData.givenTiles || []).map(t => `${t.name} (${t.group || 'Special'}, $${t.price})`).join(', ') || 'None';
        const receivedTiles = (tradeData.receivedTiles || []).map(t => `${t.name} (${t.group || 'Special'}, $${t.price})`).join(', ') || 'None';
        const partner = tradeData.partnerName || 'Opponent';

        // Strategic analysis: monopoly completion checks
        let givesMonopoly = false;
        for (const t of tradeData.givenTiles || []) {
            if (t.group && GROUP_TILES[t.group]) {
                const groupTiles = GROUP_TILES[t.group];
                const othersOwned = groupTiles.filter(gid => gid !== t.id).every(gid => GameMemory.ownership[gid]?.owner === partner);
                if (othersOwned) givesMonopoly = true;
            }
        }

        let gainsMonopoly = false;
        for (const t of tradeData.receivedTiles || []) {
            if (t.group && GROUP_TILES[t.group]) {
                const groupTiles = GROUP_TILES[t.group];
                const othersOwned = groupTiles.filter(gid => gid !== t.id).every(gid => GameMemory.isMe(GameMemory.ownership[gid]?.owner));
                if (othersOwned) gainsMonopoly = true;
            }
        }

        return `Incoming trade from ${partner}:
We Give: [${givenTiles}] + $${tradeData.givenCash || 0} cash
We Receive: [${receivedTiles}] + $${tradeData.receivedCash || 0} cash
Our Live Cash: $${GameMemory.myCash}
Strategic Alert: Gives opponent monopoly? ${givesMonopoly ? 'YES (High danger)' : 'No'}. Gives us monopoly? ${gainsMonopoly ? 'YES (High value)' : 'No'}.

Should we CONFIRM, DECLINE, or NEGOTIATE? Output strictly valid JSON: {"decision": "...", "reason": "...", "chatReply": "..."}`;
    },

    parseJsonSafely(text) {
        if (!text) return null;
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (_) {}
        return null;
    }
};
