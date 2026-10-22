import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
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
    httpRequest({ method = 'POST', url, data = null, timeout = (CONFIG.OLLAMA_TIMEOUT_MS || 6000) }) {
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
                    ontimeout: () => reject(new Error('Ollama request timed out')),
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
     * Executes chat completion with multi-tier model priority:
     * 1st priority: Primary configured model (default: qwen2.5:7b)
     * 2nd priority: llama3.2:3b (ultra-fast fallback if primary fails)
     * 3rd priority: Minimax Markov math engine (automatic zero-latency fallback)
     */
    async sendChatCompletion(messages, options = { temperature: 0.1, num_predict: 120 }) {
        const primaryModel = CONFIG.OLLAMA_MODEL || 'qwen2.5:7b';
        const fallbackModel = (primaryModel === 'llama3.2:3b') ? 'qwen2.5:7b' : 'llama3.2:3b';

        // 1st Priority Attempt
        try {
            const data = await this.httpRequest({
                method: 'POST',
                url: `${CONFIG.OLLAMA_HOST}/api/chat`,
                data: {
                    model: primaryModel,
                    messages,
                    stream: false,
                    options
                },
                timeout: CONFIG.OLLAMA_TIMEOUT_MS || 6000
            });
            if (data?.message?.content) {
                return { content: data.message.content, modelUsed: primaryModel };
            }
            if (data?.error && primaryModel !== fallbackModel) {
                throw new Error(data.error);
            }
        } catch (primaryErr) {
            // 2nd Priority Attempt (llama3.2:3b)
            if (primaryModel !== fallbackModel) {
                try {
                    const fallbackData = await this.httpRequest({
                        method: 'POST',
                        url: `${CONFIG.OLLAMA_HOST}/api/chat`,
                        data: {
                            model: fallbackModel,
                            messages,
                            stream: false,
                            options
                        },
                        timeout: Math.min(CONFIG.OLLAMA_TIMEOUT_MS || 6000, 3500)
                    });
                    if (fallbackData?.message?.content) {
                        return { content: fallbackData.message.content, modelUsed: fallbackModel };
                    }
                } catch (fallbackErr) {
                    throw new Error(`Both ${primaryModel} and ${fallbackModel} failed: ${fallbackErr.message}`);
                }
            }
            throw primaryErr;
        }
        return null;
    },

    /**
     * Evaluates incoming trade with local LLM (1st priority: qwen2.5:7b, 2nd: llama3.2:3b, 3rd: Minimax)
     */
    async evaluateTradeWithLLM(tradeData) {
        // ALWAYS evaluate with the game-theoretic rule engine first to establish baseline constraints
        const ruleVerdict = TradeEngine.evaluateIncomingTrade(tradeData);

        if (!CONFIG.OLLAMA_ENABLED) {
            return ruleVerdict;
        }

        const prompt = this.buildPrompt(tradeData);

        try {
            const messages = [
                {
                    role: 'system',
                    content: 'You are a human playing RichUp.io casually online. Your goal is to WIN. Never trade in enemy favor. If enemy completes a monopoly and we do not, you MUST DECLINE. In "chatReply", write like a real gamer in all lowercase, very short (1-5 words), casual slang (e.g. "nah sry", "cant do that", "nty", "add cash and deal", "need more cash", "deal thx"). NEVER sound like an AI, never use capital letters or periods. Output ONLY valid JSON: {"decision": "CONFIRM" | "DECLINE" | "NEGOTIATE", "reason": "concise rationale under 10 words", "chatReply": "short casual lowercase message"}'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ];

            const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 120 });
            const rawContent = result?.content || '';
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
                        ? `[Ollama ${result.modelUsed}] ${parsed.reason}` 
                        : (ruleVerdict.accept ? `[Ollama ${result.modelUsed}] ${parsed.reason}` : ruleVerdict.reason),
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
            const tile = GameMemory.getTile(tileId);
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
        const gTilesMap = GameMemory.getGroupTiles();
        for (const [pName, pEntry] of Object.entries(playerStats)) {
            for (const [groupName, groupTiles] of Object.entries(gTilesMap)) {
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
            if (t.group && gTilesMap[t.group]) {
                const groupTiles = gTilesMap[t.group];
                const othersOwned = groupTiles.filter(gid => gid !== t.id).every(gid => {
                    const o = GameMemory.ownership[gid];
                    return o && (o.owner?.toLowerCase() === partner.toLowerCase());
                });
                if (othersOwned) partnerCompletedGroups.push(t.group);
            }
        }

        const myCompletedGroups = [];
        for (const t of receivedTiles) {
            if (t.group && gTilesMap[t.group]) {
                const groupTiles = gTilesMap[t.group];
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
1. NEVER accept or propose a trade in the opponent's favor. Cash alone can NEVER compensate for giving away a monopoly!
2. If the trade completes a monopoly for ${partner} and does NOT complete a monopoly for us, it is a FATAL DANGER — you MUST output "DECLINE".
3. If WE already hold a completed monopoly, our primary winning path is building houses and starving opponents. You MUST output "DECLINE" to any request for our properties unless it secures an immediate 2nd completed monopoly for us!
4. Selling properties for cash alone is strictly forbidden — properties are irreplaceable blockers.
5. If both players get a monopoly (Mutual Monopoly Swap): Rate Country Power: Germany (95) >= China (88) > France (82) >= USA (80) > UK (75) > Italy (68) > Israel (52) > Brazil (30). We MUST receive a set >= opponent's set in power! If their set is stronger, you MUST output "DECLINE" or "NEGOTIATE" demanding substantial cash ($150-$350+) to balance building power.
6. When declining or negotiating, clearly state in "chatReply" why it failed and what counter-asset or cash we demand.

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
        if (!CONFIG.CHAT_ENABLED) return null;
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
            const messages = [
                { role: 'system', content: 'You are an authentic online multiplayer gamer. Output ONLY a casual, friendly chat message under 8 words. No quotation marks.' },
                { role: 'user', content: prompt }
            ];
            const result = await this.sendChatCompletion(messages, { temperature: 0.6, num_predict: 25 });
            const content = (result?.content || '').replace(/^["']|["']$/g, '').trim();
            if (content && content.length <= 80) {
                return content;
            }
        } catch (_) {}

        return this.getFallbackChatReply(sender, messageText);
    },

    getFallbackChatReply(sender, messageText) {
        const lower = (messageText || '').toLowerCase();
        if (lower.includes('play') || lower.includes('bruh') || lower.includes('roll') || lower.includes('turn')) {
            const replies = ['rolling now', 'my bad hold on', 'im thinking lol', 'one sec', 'hold on'];
            return replies[Math.floor(Math.random() * replies.length)];
        }
        if (lower.includes('bot') || lower.includes('ai')) {
            const replies = ['nah lol just calculating', 'no lol', 'nah watching stream on 2nd monitor', 'just planning turns lol'];
            return replies[Math.floor(Math.random() * replies.length)];
        }
        if (lower.includes('trade') || lower.includes('deal')) {
            return 'send an offer ill check';
        }
        if (lower.includes('why') || lower.includes('lol')) {
            return 'just trying to get sets lol';
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
        return 'watching board';
    },

    /**
     * Evaluates house upgrades and unmortgage-to-upgrade decisions with local LLM.
     * Enforces intelligent building, strike-zone ambushes, and strict cash conservation.
     */
    async evaluateHouseBuildingWithLLM(buildContext) {
        if (!CONFIG.OLLAMA_ENABLED || this.status === 'offline') {
            return null;
        }

        const { completeSets = [], mortgagedMonopolies = [], myCash, reserve, opponents = [], myPos, dangerEV } = buildContext;

        const setsDescription = completeSets.map(s => 
            `- ${s.groupName}: Tiles [${s.tiles.map(t => `${t.name} (${GameMemory.ownership[t.id]?.houses || 0}h)`).join(', ')}]. House cost: $${s.houseCost} each. Min houses: ${s.minHouses}. Opponents in strike zone: ${s.opponentsInStrikeZone || 'None'}.`
        ).join('\n') || 'None';

        const mortgagedDescription = mortgagedMonopolies.map(m => 
            `- ${m.groupName}: Mortgaged tile ${m.tile.name} (Cost to unmortgage: $${m.unmortgageCost}). Unmortgaging unlocks building on this set!`
        ).join('\n') || 'None';

        const oppSummary = opponents.map(o => `- ${o.name}: $${o.cash} (Pos #${o.pos})`).join('\n') || 'None';

        const prompt = `You are a Grandmaster Monopoly AI playing RichUp.io. It is YOUR turn.
YOUR STATUS:
- Current Cash: $${myCash}
- Position: Tile #${myPos}
- Next-turn danger (estimated rent loss): $${dangerEV}
- Strict Safety Cash Floor: $${reserve} (Your cash balance after any action MUST remain at or above this reserve!)

CANDIDATE MONOPOLIES TO UPGRADE:
${setsDescription}

CANDIDATE MONOPOLIES BLOCKED BY MORTGAGE:
${mortgagedDescription}

OPPONENT STATUS:
${oppSummary}

GRANDMASTER DIRECTIVES:
1. STRICT CASH PRESERVATION: You are NEVER allowed to spend cash below the safety floor of $${reserve}. If spending cash leaves you below this reserve, choose "WAIT".
2. UNMORTGAGE FIRST: In Monopoly/RichUp, you cannot build houses on a monopoly if any property in it is mortgaged. If unmortgaging safely unlocks building on a high-traffic set, output "UNMORTGAGE".
3. STRIKE ZONE ADVANTAGE: Upgrade sets where active opponents are within 2-12 steps (strike zone).
4. EVEN BUILDING: In Monopoly, all properties in a set must be upgraded evenly.
5. If no safe, high-EV action is possible, choose "WAIT".

Output strictly valid JSON:
{
  "decision": "UPGRADE" | "UNMORTGAGE" | "WAIT",
  "targetGroup": "group name or null",
  "targetTile": "tile name or null",
  "rationale": "under 15 words"
}`;

        try {
            const messages = [
                { role: 'system', content: 'You are an elite Grandmaster Monopoly AI. Output strictly valid JSON: {"decision": "UPGRADE" | "UNMORTGAGE" | "WAIT", "targetGroup": "...", "targetTile": "...", "rationale": "..."}' },
                { role: 'user', content: prompt }
            ];

            const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 80 });
            const parsed = this.parseJsonSafely(result?.content || '');
            if (parsed && (parsed.decision === 'UPGRADE' || parsed.decision === 'UNMORTGAGE' || parsed.decision === 'WAIT')) {
                return {
                    ...parsed,
                    modelUsed: result.modelUsed
                };
            }
        } catch (_) {}

        return null;
    },

    /**
     * Deliberate strategic check right before ending turn
     */
    async deliberateEndTurnStrategy() {
        if (!CONFIG.OLLAMA_ENABLED || !CONFIG.DELIBERATE_BEFORE_END_TURN || this.status === 'offline') {
            return { action: 'END_TURN', rationale: 'Minimax math checks satisfied' };
        }

        const monopolies = [];
        for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
            if (groupName === 'Airport' || groupName === 'Utility') continue;
            const ownsAll = groupTiles.every(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
            if (ownsAll) monopolies.push(groupName);
        }

        const oppSummaries = Object.entries(GameMemory.players)
            .filter(([pName]) => !GameMemory.isMe(pName))
            .map(([pName, p]) => `${pName}: $${p.cash} (Pos #${p.pos || 0})`)
            .join(', ') || 'None';

        const prompt = `Player ${GameMemory.myName || 'Me'}: Cash $${GameMemory.myCash}, Monopolies: [${monopolies.join(', ') || 'None'}], Next turn danger: $${GameMemory.lastDangerEV}, Opponents: [${oppSummaries}].
Is it optimal to END_TURN now or UPGRADE_HOUSES?
Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "under 10 words"}`;

        try {
            const messages = [
                { role: 'system', content: 'You are a Grandmaster Monopoly AI. Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "..."}' },
                { role: 'user', content: prompt }
            ];

            const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 40 });
            const parsed = this.parseJsonSafely(result?.content || '');
            if (parsed && (parsed.action === 'END_TURN' || parsed.action === 'UPGRADE')) {
                return parsed;
            }
        } catch (_) {}

        return { action: 'END_TURN', rationale: 'Turn complete' };
    }
};
