import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { BOARD_TILES, GROUP_TILES } from '../data/boardTiles.js';
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
        // ALWAYS evaluate with the game-theoretic rule engine first to establish baseline constraints
        const ruleVerdict = TradeEngine.evaluateIncomingTrade(tradeData);

        if (!CONFIG.OLLAMA_ENABLED) {
            return ruleVerdict;
        }

        const prompt = this.buildPrompt(tradeData);

        try {
            const payload = {
                model: CONFIG.OLLAMA_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a Grandmaster Monopoly / RichUp AI player whose primary goal is to WIN. Never trade in the enemy\'s favor. If enemy completes a monopoly and we do not, you MUST DECLINE. Output ONLY valid JSON in format: {"decision": "CONFIRM" | "DECLINE" | "NEGOTIATE", "reason": "concise rationale under 15 words", "chatReply": "short casual in-game message under 15 words"}'
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
                timeout: CONFIG.OLLAMA_TIMEOUT_MS || 5500
            });

            const rawContent = data?.message?.content || '';
            const parsed = this.parseJsonSafely(rawContent);

            if (parsed && (parsed.decision === 'CONFIRM' || parsed.decision === 'DECLINE' || parsed.decision === 'NEGOTIATE')) {
                // GRANDMASTER INTEGRITY GUARD:
                // If rule engine found a fatal danger or unfair EV, the LLM is NEVER permitted to accept!
                const isAccept = parsed.decision === 'CONFIRM' && ruleVerdict.accept;
                const isNegotiate = parsed.decision === 'NEGOTIATE' || (!isAccept && ruleVerdict.counterSwap != null);

                // Use the LLM's custom chat reply if it provided one; otherwise use the rule engine's exact demand message
                const chatReply = (parsed.chatReply && parsed.chatReply.trim().length > 3) 
                    ? parsed.chatReply.trim() 
                    : ruleVerdict.chatReply;

                return {
                    accept: isAccept,
                    negotiate: !isAccept && isNegotiate,
                    reason: isAccept 
                        ? `[Ollama ${CONFIG.OLLAMA_MODEL}] ${parsed.reason}` 
                        : (ruleVerdict.accept ? `[Ollama ${CONFIG.OLLAMA_MODEL}] ${parsed.reason}` : ruleVerdict.reason),
                    chatReply: chatReply,
                    counterSwap: ruleVerdict.counterSwap
                };
            }

            // Fallback if response schema didn't match
            return ruleVerdict;
        } catch (_) {
            // Automatic instant fallback to mathematical Minimax engine
            return ruleVerdict;
        }
    },

    buildPrompt(tradeData) {
        const partner = tradeData.partnerName || 'Opponent';
        const partnerObj = GameMemory.players[partner] || { cash: 'Unknown', pos: 0, inJail: false };
        const partnerCash = partnerObj.cash;

        // 1. Compile detailed property and house/hotel status for every player
        const playerStats = {};
        for (const [pName, pData] of Object.entries(GameMemory.players)) {
            playerStats[pName] = {
                cash: pData.cash,
                pos: pData.pos,
                inJail: pData.inJail,
                monopolies: [],
                properties: [],
                totalHouses: 0,
                totalHotels: 0,
                mortgaged: []
            };
        }

        // Include ME if not yet in players
        const myName = GameMemory.myName || 'Me';
        if (!playerStats[myName]) {
            playerStats[myName] = {
                cash: GameMemory.myCash,
                pos: GameMemory.myPos,
                inJail: GameMemory.inJail,
                monopolies: [],
                properties: [],
                totalHouses: 0,
                totalHotels: 0,
                mortgaged: []
            };
        } else {
            playerStats[myName].cash = GameMemory.myCash;
            playerStats[myName].pos = GameMemory.myPos;
            playerStats[myName].inJail = GameMemory.inJail;
        }

        // Tally properties, houses, hotels, and monopolies
        for (const [tileId, ownInfo] of Object.entries(GameMemory.ownership)) {
            if (!ownInfo || !ownInfo.owner) continue;
            const tile = BOARD_TILES[tileId];
            if (!tile) continue;

            const ownerKey = Object.keys(playerStats).find(k => 
                GameMemory.isMe(ownInfo.owner) ? (k === myName || GameMemory.isMe(k)) : k.toLowerCase() === ownInfo.owner.toLowerCase()
            ) || ownInfo.owner;

            if (!playerStats[ownerKey]) {
                playerStats[ownerKey] = {
                    cash: 'Unknown',
                    pos: 0,
                    inJail: false,
                    monopolies: [],
                    properties: [],
                    totalHouses: 0,
                    totalHotels: 0,
                    mortgaged: []
                };
            }

            const pEntry = playerStats[ownerKey];
            pEntry.properties.push(tile.name);
            if (ownInfo.mortgaged) pEntry.mortgaged.push(tile.name);

            if (ownInfo.houses === 5) {
                pEntry.totalHotels++;
            } else if (ownInfo.houses > 0) {
                pEntry.totalHouses += ownInfo.houses;
            }
        }

        // Identify complete monopolies and house counts on each
        for (const [pName, pEntry] of Object.entries(playerStats)) {
            for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
                if (groupName === 'Airport' || groupName === 'Utility') continue;
                const ownsAll = groupTiles.every(t => {
                    const o = GameMemory.ownership[t.id];
                    return o && (GameMemory.isMe(pName) ? GameMemory.isMe(o.owner) : o.owner?.toLowerCase() === pName.toLowerCase());
                });
                if (ownsAll) {
                    const houseCounts = groupTiles.map(t => `${t.name}: ${GameMemory.ownership[t.id]?.houses || 0}h`).join(', ');
                    pEntry.monopolies.push(`${groupName} (${houseCounts})`);
                }
            }
        }

        // Format Player Breakdown
        const playersFormatted = Object.entries(playerStats).map(([pName, p]) => {
            const isMeText = GameMemory.isMe(pName) ? ' (ME)' : (pName === partner ? ' (TRADE PARTNER)' : '');
            const monoText = p.monopolies.length > 0 ? p.monopolies.join(' | ') : 'None';
            const mortgagedText = p.mortgaged.length > 0 ? ` | Mortgaged: [${p.mortgaged.join(', ')}]` : '';
            return `- ${pName}${isMeText}:
    Money: $${p.cash} | Pos: Tile #${p.pos} | In Jail: ${p.inJail ? 'YES' : 'No'}
    Monopolies: [${monoText}]
    Houses Built: ${p.totalHouses} | Hotels Built: ${p.totalHotels} | Properties Owned: ${p.properties.length}${mortgagedText}`;
        }).join('\n');

        // Analyze Trade Impact
        const givenTiles = (tradeData.givenTiles || []);
        const receivedTiles = (tradeData.receivedTiles || []);

        const givenDetails = givenTiles.map(t => {
            return `${t.name} (Group: ${t.group || 'Special'}, Price: $${t.price}, HouseCost: $${t.houseCost || 0})`;
        }).join('\n  - ') || 'None';

        const receivedDetails = receivedTiles.map(t => {
            return `${t.name} (Group: ${t.group || 'Special'}, Price: $${t.price}, HouseCost: $${t.houseCost || 0})`;
        }).join('\n  - ') || 'None';

        // Check if trade completes monopolies
        const partnerCompletedGroups = [];
        for (const t of givenTiles) {
            if (t.group && GROUP_TILES[t.group]) {
                const groupTiles = GROUP_TILES[t.group];
                const othersOwned = groupTiles.filter(gid => gid !== t.id).every(gid => {
                    const o = GameMemory.ownership[gid];
                    return o && (o.owner?.toLowerCase() === partner.toLowerCase());
                });
                if (othersOwned) partnerCompletedGroups.push(t.group);
            }
        }

        const myCompletedGroups = [];
        for (const t of receivedTiles) {
            if (t.group && GROUP_TILES[t.group]) {
                const groupTiles = GROUP_TILES[t.group];
                const othersOwned = groupTiles.filter(gid => gid !== t.id).every(gid => {
                    const o = GameMemory.ownership[gid];
                    return o && GameMemory.isMe(o.owner);
                });
                if (othersOwned) myCompletedGroups.push(t.group);
            }
        }

        const partnerCanBuild = partnerCompletedGroups.length > 0 && typeof partnerCash === 'number' && partnerCash >= 300;
        const myPostCash = GameMemory.myCash + (tradeData.receivedCash || 0) - (tradeData.givenCash || 0);

        // Run 20-round forward rollout simulation to pass real mathematical projections to Ollama
        const sim = TradeEngine.simulateFutureTradeRounds(tradeData, 20, 60);

        return `=== RICHUP FULL GAME-STATE BRIEFING ===
MY IDENTITY: ${myName}
LIVE FINANCIALS:
- My Live Cash: $${GameMemory.myCash}
- My Dynamic Survival Reserve: $${GameMemory.lastDynamicReserve} (Required cash floor to survive incoming rent hits)
- Next Turn Danger EV: $${GameMemory.lastDangerEV}

ALL PLAYERS IN MATCH (MONEY, HOUSES, POSITIONS):
${playersFormatted}

=== PROPOSED TRADE OFFER ===
Trade Partner: ${partner} (Their Money: $${partnerCash})
WE GIVE:
  - ${givenDetails}
  - Cash Offered: $${tradeData.givenCash || 0}

WE RECEIVE:
  - ${receivedDetails}
  - Cash Demanded: $${tradeData.receivedCash || 0}

Net Cash Transfer: ${tradeData.receivedCash - tradeData.givenCash >= 0 ? `+$${tradeData.receivedCash - tradeData.givenCash} to us` : `-$${tradeData.givenCash - tradeData.receivedCash} from us`}

=== STRATEGIC THREAT & OPPORTUNITY SIMULATION ===
1. Monopoly Impact on ${partner}:
   ${partnerCompletedGroups.length > 0 
       ? `CRITICAL ALERT: Completes [${partnerCompletedGroups.join(', ')}] monopoly for ${partner}!` +
         (partnerCanBuild ? ` Partner has $${partnerCash} cash and CAN IMMEDIATELY RUSH HOUSES!` : ` Partner only has $${partnerCash} cash (building power delayed).`)
       : `No monopoly completed for partner.`}

2. Monopoly Impact on Us:
   ${myCompletedGroups.length > 0 
       ? `MASSIVE WIN: Completes [${myCompletedGroups.join(', ')}] monopoly for us! Post-trade cash: $${myPostCash}.`
       : `No monopoly completed for us.`}

3. 20-Round Forward Rollout Simulation:
   - If Trade ACCEPTED: 20-Round Survival: ${sim.accSurvRate}%, Projected 20-Turn Cash: $${sim.accAvgCash}
   - If Trade REJECTED: 20-Round Survival: ${sim.rejSurvRate}%, Projected 20-Turn Cash: $${sim.avgRejCash}
   - Monte Carlo Projection: ${sim.isSimulationEVPlus ? 'PROFITABLE (+EV across 20 simulated rounds)' : 'HIGH RISK / NEGATIVE EV across 20 simulated rounds'}

=== GRANDMASTER TRADING DIRECTIVE ===
You are an elite Grandmaster Monopoly AI whose primary objective is to WIN.
CRITICAL RULES:
1. NEVER accept or propose a trade in the opponent's favor.
2. If the trade completes a monopoly for ${partner} and does NOT complete a monopoly for us, it is a FATAL DANGER — you MUST output "DECLINE".
3. If both players get a monopoly, verify if ${partner} has high cash to rush hotels immediately. If they have a massive cash advantage, DECLINE unless they pay huge cash to balance building power.
4. When declining or negotiating, clearly state in "chatReply" why it failed and what counter-asset or cash we demand.

Respond ONLY with valid JSON:
{
  "decision": "CONFIRM" | "DECLINE" | "NEGOTIATE",
  "reason": "concise rationale under 15 words",
  "chatReply": "under 15 words stating reason and our counter-demands"
}`;
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
    },

    /**
     * Generates a casual, human-like in-game chat reply to an opponent's message
     */
    async generateChatResponse(sender, messageText) {
        if (!CONFIG.OLLAMA_ENABLED || this.status === 'offline') {
            return this.getFallbackChatReply(sender, messageText);
        }

        const prompt = `You are playing RichUp (online Monopoly) under the nickname "${GameMemory.myName || 'matrix'}".
Opponent "${sender}" just wrote in room chat: "${messageText}".

Generate a brief, natural, authentic gamer reply.
Guidelines:
- Keep it under 8 words.
- All lowercase or casual punctuation, relaxed gaming tone.
- If they ask if you are a bot ("bot?", "chat if not bot", etc.): play along casually or deny naturally (e.g. "im here lol", "nah watching a video on 2nd screen", "just planning my turns", "nah im here").
- If they say hi/hello: respond casually ("yo", "hey", "sup").
- If they ask to trade: say "send an offer, ill look" or "what you offering?".
- If they ask someone to start/ready: say "lets go" or "ready".
- Output ONLY the message text. No quotes.`;

        try {
            const data = await this.httpRequest({
                method: 'POST',
                url: `${CONFIG.OLLAMA_HOST}/api/chat`,
                data: {
                    model: CONFIG.OLLAMA_MODEL,
                    messages: [
                        { role: 'system', content: 'You are an authentic online multiplayer gamer. Output ONLY a casual, friendly chat message under 8 words. No quotation marks.' },
                        { role: 'user', content: prompt }
                    ],
                    stream: false,
                    options: { temperature: 0.6, num_predict: 25 }
                },
                timeout: 1800
            });

            const content = (data?.message?.content || '').replace(/^["']|["']$/g, '').trim();
            if (content && content.length <= 80) {
                return content;
            }
        } catch (_) {}

        return this.getFallbackChatReply(sender, messageText);
    },

    getFallbackChatReply(sender, messageText) {
        const lower = (messageText || '').toLowerCase();
        if (lower.includes('bot')) {
            const replies = ['im here lol', 'nah watching a video on 2nd screen', 'im here just playing quiet', 'nah just planning turns'];
            return replies[Math.floor(Math.random() * replies.length)];
        }
        if (lower.includes('trade')) {
            return 'send an offer, ill check it out';
        }
        if (lower.includes('hi') || lower.includes('hello') || lower.includes('yo') || lower.includes('hey')) {
            return 'yo';
        }
        if (lower.includes('start') || lower.includes('ready')) {
            return 'ready';
        }
        if (lower.includes('gg') || lower.includes('wp')) {
            return 'gg';
        }
        return 'watching the board';
    },

    /**
     * Deliberate strategic check right before ending turn
     */
    async deliberateEndTurnStrategy() {
        if (!CONFIG.OLLAMA_ENABLED || !CONFIG.DELIBERATE_BEFORE_END_TURN || this.status === 'offline') {
            return { action: 'END_TURN', rationale: 'Minimax math checks satisfied' };
        }

        const monopolies = [];
        for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
            if (groupName === 'Airport' || groupName === 'Utility') continue;
            const ownsAll = groupTiles.every(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
            if (ownsAll) monopolies.push(groupName);
        }

        const prompt = `Player ${GameMemory.myName}: Cash $${GameMemory.myCash}, Monopolies: [${monopolies.join(', ') || 'None'}]. Next turn danger: $${GameMemory.lastDangerEV}.
Is it optimal to END_TURN now or UPGRADE_HOUSES?
Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "under 10 words"}`;

        try {
            const data = await this.httpRequest({
                method: 'POST',
                url: `${CONFIG.OLLAMA_HOST}/api/chat`,
                data: {
                    model: CONFIG.OLLAMA_MODEL,
                    messages: [
                        { role: 'system', content: 'You are a Grandmaster Monopoly AI. Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "..."}' },
                        { role: 'user', content: prompt }
                    ],
                    stream: false,
                    options: { temperature: 0.1, num_predict: 40 }
                },
                timeout: 1800
            });

            const parsed = this.parseJsonSafely(data?.message?.content || '');
            if (parsed && (parsed.action === 'END_TURN' || parsed.action === 'UPGRADE')) {
                return parsed;
            }
        } catch (_) {}

        return { action: 'END_TURN', rationale: 'Turn complete' };
    }
};
