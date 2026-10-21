# RUBOT — Grandmaster AI Traits, Strategies & Mathematical Specifications

> **RUBOT** is an elite, fully autonomous Grandmaster AI bot engineered for [RichUp.io](https://richup.io). It operates directly on the native **Socket.IO v4 wire protocol** (Zero-DOM / Zero-UI) with sub-millisecond event parsing, game-theoretic minimax risk engines, 20-round Monte Carlo forward trade simulations, dynamic Markov survival reserves, and a multi-tier local LLM brain (Ollama) guarded by a mathematical integrity filter.

---

## TABLE OF CONTENTS
1. [Architectural Overview & Core Technology](#1-architectural-overview--core-technology)
2. [Operating Modes: FULL-AUTO vs ADVISOR](#2-operating-modes-full-auto-vs-advisor)
3. [Basic Functionalities & Protocol Automation](#3-basic-functionalities--protocol-automation)
4. [Authoritative Game Memory & Live Telemetry](#4-authoritative-game-memory--live-telemetry)
5. [Markov Risk & Future Vision Probability Engine](#5-markov-risk--future-vision-probability-engine)
6. [Game-Theoretic Minimax Trade Engine](#6-game-theoretic-minimax-trade-engine)
7. [House Building & Ambush Timing Engine](#7-house-building--ambush-timing-engine)
8. [Optimal Debt Recovery & Liquidation Hierarchy](#8-optimal-debt-recovery--liquidation-hierarchy)
9. [Context-Aware Jail Strategy](#9-context-aware-jail-strategy)
10. [Auction Sniper & Bidding Engine](#10-auction-sniper--bidding-engine)
11. [Hybrid Local LLM (Ollama) & Bot Camouflage](#11-hybrid-local-llm-ollama--bot-camouflage)
12. [Glassmorphic HUD & Interactive Controls](#12-glassmorphic-hud--interactive-controls)

---

## 1. ARCHITECTURAL OVERVIEW & CORE TECHNOLOGY

### Zero-DOM Wire-Hooking Architecture
Unlike fragile bots that rely on scraping HTML elements, clicking DOM buttons, or waiting for CSS animations, RUBOT operates at the **transport layer**:
- **WebSocket Interceptor**: Injects a hook into `unsafeWindow.WebSocket` at `document-start` before RichUp's client scripts execute.
- **Socket.IO v4 Protocol Sniffer**: Sniffs incoming and outgoing Engine.IO / Socket.IO frames matching `42/api/game,[...]`.
- **Zero-Latency Network Dispatcher**: Directly emits raw JSON payloads over the active WebSocket (`ws.send()`).
- **Headless UI Immunity**: Modals (trades, auctions, bankruptcy, house purchases) do not even need to render on screen. RUBOT receives the packet, processes the decision in memory, and dispatches the action in milliseconds.

### Compilation & Packaging
- **Modular ES6 Source**: Separated into clear domain modules (`protocol/`, `memory/`, `engine/`, `data/`, `ui/`).
- **Rollup Bundler**: Transpiles and tree-shakes into a standalone Tampermonkey / Violentmonkey userscript (`dist/RichUpBot.user.js`).
- **Cross-Domain Privileges**: Utilizes `GM_xmlhttpRequest` for local Ollama REST queries, completely bypassing browser CORS and mixed-content restrictions.

---

## 2. OPERATING MODES: FULL-AUTO VS ADVISOR

RUBOT provides two operational paradigms, toggleable instantly via the HUD:

### 1. FULL-AUTO Mode (`ADVISOR_MODE = false`)
- The AI autonomously executes all moves: rolls dice, purchases properties, bids in auctions, negotiates trades, develops houses, liquidates assets to clear debt, and passes turns.
- Includes randomized human-like timing delays (400ms – 1800ms) to avoid robotic burst detection.

### 2. ADVISOR Mode (`ADVISOR_MODE = true`)
- Operates as a co-pilot for human players.
- Whenever an action is recommended (e.g. buying a property, bidding $140 on an auction, accepting a mutual trade swap, upgrading to 3 houses, or paying jail bail), RUBOT **pauses execution** and renders a high-visibility advisor modal inside the HUD.
- Displays:
  - **Action Title** (e.g., `ACCEPT TRADE #a9f1b2`, `BUY GERMANY 2 ($260)`)
  - **Strategic Rationale** (e.g., `Dominates opponent group power; cash buffer remains above $250 reserve`)
  - **Execute Button**: Dispatches the network packet immediately.
  - **Skip Button**: Declines or bypasses the action, logging the human's override into memory.

---

## 3. BASIC FUNCTIONALITIES & PROTOCOL AUTOMATION

| Capability | Wire Event Dispatched | Description |
| :--- | :--- | :--- |
| **Roll Dice** | `plz-roll-dices` | Triggers dice roll when it is our turn and we haven't rolled yet. |
| **Roll Again (Doubles)** | `plz-roll-dices` | Automatically triggers extra roll when doubles are rolled (`dice[0] === dice[1]`). |
| **End Turn** | `end-turn` | Passes priority to the next player once all mandatory actions are resolved. |
| **Buy Property** | `purchase-property` | Acquires unowned tiles directly at base board price. |
| **Send to Auction** | `start-auction` | Sends unowned property to public auction if we cannot afford direct purchase. |
| **Place Auction Bid** | `auction-bid` (`{ amount }`) | Submits precise incremental or aggressive jump bids. |
| **Propose Trade** | `create-trade` (`{ trade }`) | Sends multi-asset property + cash proposals with custom notes. |
| **Accept Trade** | `confirm-trade` (`{ tradeId }`) | Confirms incoming trade offers. |
| **Decline Trade** | `decline-trade` (`{ tradeId }`) | Rejects unfavorable incoming offers. |
| **Cancel Trade** | `delete-trade` (`{ tradeId }`) | Cancels pending outgoing trade offers to free locked assets before ending turns. |
| **Build House/Hotel** | `upgrade-city` (`{ blockIndex }`) | Purchases houses and hotels on completed color monopolies. |
| **Sell House/Hotel** | `downgrade-city` (`{ blockIndex }`) | Liquidates houses to pay off debt under the Even-Build rule. |
| **Mortgage Property** | `mortgage-property` (`{ propertyIndex }`) | Mortgages unimproved properties for 50% face value cash. |
| **Unmortgage Property**| `lift-property-mortgage` (`{ propertyIndex }`) | Unmortgages properties for 55% face value cash (50% + 10% interest). |
| **Pay Jail Bail** | `pay-out-of-prison` | Pays $50 to immediately leave jail. |
| **Use Pardon Card** | `use-pardon-card` | Consumes a "Get Out of Jail Free" card to leave jail. |
| **Declare Bankruptcy**| `do-bankrupt` | Concedes match gracefully when truly insolvent with zero assets left. |
| **Turn Clock Extension**| `request-clock-time` | Automatically requests +60s extension when turn clock drops under 7 seconds. |
| **Grant Clock Time** | `grant-clock-time` (`{ playerId }`) | Auto-approves clock extension requests from opponents to keep matches fair. |
| **Anti-Stall Votekick** | `votekick-player` (`{ playerId }`) | Instantly votes to kick AFK stallers on `new-votekick-request`. |
| **Auto Coin Claimer** | `POST /api/game/claim-coin-reward` | Automatically claims richup coin rewards upon match victory. |
| **State Resync** | `request-sync` (`{ snapshot: "" }`) | Forces instant authoritative state refresh from server on demand. |

---

## 4. AUTHORITATIVE GAME MEMORY & LIVE TELEMETRY

`GameMemory` maintains the synchronized internal state of the entire board:

### 1. Player Telemetry
- **Identity Resolution**: Determines our player ID and nickname, automatically sanitizing emoji and SVG badges.
- **Live Balances**: Tracks exact liquid cash for all players. Sets `isNegativeDebt = true` if balance drops below $0.
- **Authoritative Prison Tracking**: Accurately tracks prison inmates via `blocks[10].suspendedTurnsRemaining[playerId]`, cleanly distinguishing real prisoners from players who are "Just Visiting" Tile 10.
- **Turn State**: Tracks active player, dice roll status (`hasRolled`), turn counter, and turn clock budget.

### 2. Property & Set Registry
- **Tile Ownership**: Maps each of the 40 board tiles to its owner, current house count (0–4 houses, 5 = hotel), and mortgage status.
- **Monopoly Detection**: Calculates exact owned vs. total cards for all 8 color sets, Airports, and Utilities.
- **Country Power Rankings (`GROUP_POWER`)**:
  - 🇩🇪 **Germany**: `95` (Most lethal endgame set)
  - 🇨🇳 **China**: `88`
  - 🇫🇷 **France**: `82`
  - 🇺🇸 **USA**: `80`
  - 🇬🇧 **UK**: `75`
  - 🇮🇹 **Italy**: `68`
  - ✈️ **Airports**: `60`
  - 🇮🇱 **Israel**: `52`
  - ⚡ **Utilities**: `35`
  - 🇧🇷 **Brazil**: `30`

### 3. Archival Declined Trades Memory
- Maintains a per-player FIFO history of the last 25 declined trade packages (`givenIds`, `receivedIds`, `cashOffer`, `timestamp`).
- **Anti-Spam Filter**: Checks if an identical proposal was recently rejected (< 4 minutes ago). If so, RUBOT **never spams** the same offer: it automatically sweetens with +$75 cash or upgrades to a 2-for-1 package.

### 4. Turn-Clock & Anti-AFK Watchdog
- Calculates remaining turn time using `turnStartedAt + graceMs (20s) + grantedMs + bankMs (60s)`.
- **Clock Request**: When remaining time $< 7\text{s}$, RUBOT requests +60s table extension.
- **Emergency Safe Action**: When remaining time $< 2.5\text{s}$, RUBOT fires an emergency move (`plz-roll-dices` or `end-turn`) to guarantee no AFK strikes or votekicks occur.

---

## 5. MARKOV RISK & FUTURE VISION PROBABILITY ENGINE

RUBOT utilizes Markov chain probability distributions based on 2-dice combinations to assess board danger before making any financial commitment.

### 1. Dice Probability Distribution
$$\begin{array}{|c|c|c|c|c|c|c|c|c|c|c|c|}
\hline
\textbf{Roll} & 2 & 3 & 4 & 5 & 6 & 7 & 8 & 9 & 10 & 11 & 12 \\
\hline
\textbf{Combos} & 1/36 & 2/36 & 3/36 & 4/36 & 5/36 & 6/36 & 5/36 & 4/36 & 3/36 & 2/36 & 1/36 \\
\hline
\textbf{Prob} & 2.78\% & 5.56\% & 8.33\% & 11.11\% & 13.89\% & 16.67\% & 13.89\% & 11.11\% & 8.33\% & 5.56\% & 2.78\% \\
\hline
\end{array}$$

### 2. Expected Rent Exposure ($E[\text{Rent}]$)
- **1-Turn Danger ($E[\text{Rent}_1$])**: Sum of $(\text{Probability} \times \text{Current Rent})$ for all tiles 2 to 12 steps ahead of our current position.
- **3-Turn Danger ($E[\text{Rent}_3$])**: Extended projection covering steps 13 to 21, weighted by steady-state Markov arrival rates ($\text{markov} \times 0.45$).
- **High-Frequency Danger Window**: Identifies the maximum single rent hit in the most common roll window (rolls 5 through 9, representing $66.7\%$ of all dice rolls).

### 3. Dynamic Survival Cash Floor
To prevent bankruptcy traps, RUBOT enforces a dynamic cash reserve:
$$\text{DynamicReserve} = \max\Big(\text{BASE\_MIN\_RESERVE}, \; \text{BASE\_MIN\_RESERVE} + 1.5 \times E[\text{Rent}_1] + 0.25 \times \text{WorstCaseDangerWindow}\Big)$$
- Default `BASE_MIN_RESERVE` = **$250**.
- If approaching opponent hotels, the cash floor dynamically expands (often to $400–$700), preventing the bot from over-spending on unneeded assets right before landing on enemy territory.

### 4. Property Purchase Hierarchy
When landing on an unowned tile, RUBOT applies a 7-step decision waterfall:
1. **Physical Affordability**: Must have cash $\ge$ tile price.
2. **Critical Monopoly Completer**: Always buys if owning it completes our color set.
3. **Monopoly Builder**: Always buys if we already own 1 card in the set (aiming for monopoly).
4. **Defensive Blocker**: Always buys if an opponent owns $N - 1$ cards in that set to block their monopoly.
5. **Airports & Utilities**: Always buys high-yield cashflow assets.
6. **Finale Endgame Check**: Only skips non-set singletons in deep late-game (turns > 30) if purchase leaves $< \$60$ while facing lethal enemy hotels directly ahead.
7. **Early/Mid Game Rule**: **ALWAYS BUY!** Properties are irreplaceable board presence.

---

## 6. GAME-THEORETIC MINIMAX TRADE ENGINE

The trade engine is the core strategic brain of RUBOT. It treats every trade as a game-theoretic minimax optimization.

### 1. Asset Valuation Formula
$$\text{BaseEV} = \text{Price} \times (1 + \text{Markov} \times 18) \times \left(\frac{\text{GroupPower}}{50}\right) \times \text{Synergy}$$
- **Synergy Multipliers**:
  - `6.2x`: If card completes a color monopoly.
  - `2.0x`: If card secures 2-of-3 set advancement.
  - `1.0 + 0.45 * owned`: Airport scaling.
  - `1.8x`: Utilities if owning 1 or more.

### 2. 20-Round Monte Carlo Forward Rollout Simulation
Before accepting any trade, RUBOT runs **80 iterations** of a 20-round forward rollout simulation:
- Clones board ownership into a sandbox.
- Simulates future dice rolls, Go salaries (+$200), and rent payments under both **Trade Accepted** and **Trade Rejected** conditions.
- **Simulation Veto**: If accepting the trade causes our 20-round survival rate to drop by $> 10\%$, the trade is **instantly vetoed**, regardless of cash offered!

### 3. Grandmaster Trade Veto Hierarchy (8 Non-Negotiable Rules)
1. **Monopoly Break Veto**: NEVER trade away a property that belongs to a completed monopoly we own.
2. **Monopoly Denial Veto**: If an opponent already owns a monopoly, NEVER give them another set.
3. **Cash Extortion Veto**: Refuse paying $> \$100$ cash to an opponent unless receiving an instant monopoly.
4. **Fatal Danger Veto**: NEVER give an opponent a monopoly while receiving no monopoly in return. Money cannot compensate for giving away a monopoly!
5. **Post-Monopoly Starvation Veto**: Once we own a monopoly, our #1 winning path is building houses and starving opponents. Hold all singletons/blockers; only trade for an immediate 2nd monopoly.
6. **Blocker & Advancement Veto**: Pre-monopoly, do not hand an opponent their 2nd card in a set if we receive no set.
7. **Cash-Only Veto**: Never sell properties for cash alone.
8. **Country Power Deficit Veto**: In Mutual Monopoly Swaps:
   - **Dominant Swap** (Our Power $-$ Opponent Power $> 5$): Accept if net cash $\ge -\$100$.
   - **Balanced Swap** ($|\Delta\text{Power}| \le 5$): Accept if net cash $\ge -\$50$.
   - **Inferior Set** (Opponent gets stronger set): Requires cash compensation of $\Delta\text{Power} \times \$8$ to balance building power.

### 4. Proactive Trade Generator
RUBOT scans the board every turn to propose win-win trades:
- **Mutual Monopoly Swaps**: Both players receive complete sets, with cash automatically leveled by Country Power differences.
- **Monopoly Completer Offers**: Offers a safe singleton + cash buyout to acquire our final missing card.
- **2-for-1 Multi-Asset Packages**: Offers two surplus singletons for our critical 3rd monopoly card.
- **Set Consolidation Swaps**: Swaps singletons to advance sets, verifying the sacrificed card isn't in a group more lethal than the one we are advancing.
- **Airport Buyouts**: Offers cash buyout for remaining airports if we already hold 1–3 airports.
- **Open Trade Auto-Cleanup**: Outgoing trade offers are automatically cancelled via `delete-trade` before ending turns or if unresponded for $> 35\text{s}$, freeing assets.

---

## 7. HOUSE BUILDING & AMBUSH TIMING ENGINE

### 1. Requirements & Constraints
- Must own **100% of the properties** in the color group.
- **No Mortgages**: Every property in the set must be unmortgaged.
- **Even-Building Rule**: Properties in a group must be upgraded evenly ($\text{houses} \le \min(\text{houses}) + 1$).
- **Survival Cash Reserve**: We must never spend cash below `MarkovRisk.computeDynamicReserve()`.

### 2. Marginal ROI Calculation
$$\text{ROI} = \left(\frac{\Delta\text{Rent}}{\text{Cost}}\right) \times \text{Markov} \times \text{SweetSpotBoost} \times \text{AmbushBoost}$$
- **3-House Sweet Spot Rush**:
  - Inflection point in Monopoly rent (spikes $400\%–800\%$).
  - `houses == 2`: Multiplier boosted to **2.6x**.
  - `houses == 1`: Multiplier boosted to **1.5x**.
- **Ambush Timing Boost (`1.8x`)**: Triggered when active opponents enter our set's **Strike Zone** (2 to 12 tiles away).
- **Hotel Zone Avoidance**: If we are standing 2 to 12 steps away from an opponent's 3-house or hotel property, house building is temporarily frozen to hoard cash for survival.

---

## 8. OPTIMAL DEBT RECOVERY & LIQUIDATION HIERARCHY

When in debt ($Cash < 0$), RUBOT executes an automated liquidation waterfall:

### 1. Strategic Sacrifice Score
$$\text{SacrificeScore} = \text{Price} \times (1 + \text{Markov} \times 10) \times \text{MonopolyWeight}$$
- Complete monopolies: Multiplied by **10.0x** (never sacrifice unless forced).
- Near-complete sets ($N - 1$): Multiplied by **4.0x**.
- Critical blockers stopping opponent monopolies: Multiplied by **5.0x**.

### 2. Liquidation Sequence
1. **House Downgrades**: Sells houses starting from the most developed property in low-yield sets (recovers 50% house cost while keeping title deeds).
2. **Low-Sacrifice Mortgages**: Mortgages un-improved singletons with low landing probability (recovers 50% property price).
3. **Airport & Utility Mortgages**: Mortgaged only after singletons are exhausted.
4. **Monopoly House Downgrades**: Downgrades houses on monopolies only under extreme debt.
5. **Bankruptcy Concession**: If balance $< 0$ and all liquid assets are exhausted for 3 consecutive ticks, dispatches `do-bankrupt` to concede gracefully.

### 3. Surplus Unmortgaging
When cash exceeds `Reserve + $200`, RUBOT unmortgages assets:
- **Monopoly Pieces**: **12.0x Priority** (unlocks house construction immediately).
- **Near-Monopoly Cards**: 4.0x Priority.
- **Airports**: 3.0x Priority.

---

## 9. CONTEXT-AWARE JAIL STRATEGY

RUBOT dynamically evaluates jail decisions using board context:

1. **Board Safe Exit**: If opponents have built **0 houses** on the board, there is zero landing danger. RUBOT leaves jail immediately ($50 bail or Pardon card) to lap the board and collect the **+$200 Start bonus**.
2. **Early-Game Land Grab**: If $\ge 4$ unowned properties remain on the board, leaves jail immediately to buy land.
3. **Late-Game Safe Shelter (Fortress Mode)**:
   - When lethal enemy hotels exist on the board ($E[\text{Rent}_1] > \$60$), RUBOT rolls for doubles to stay sheltered inside the cell for up to 3 turns, safely collecting rent without risking landing on opponent hotels.
4. **Rent Collection Rule Check**:
   - If the room setting **prohibits rent collection in jail** (`collectRentInJail = false`) and opponents are approaching our hotels (2–12 steps away), RUBOT immediately pays the $50 bail to exit and collect incoming rent!

---

## 10. AUCTION SNIPER & BIDDING ENGINE

### 1. Ceiling Fair Value Formula
$$\text{CeilingBid} = \text{Price} \times \text{Multiplier}$$
- **Monopoly Completer**: **2.5x Multiplier** (Massive aggressive premium to complete our set).
- **Defensive Blocker**: **1.6x Multiplier** (Prevents an opponent from completing their set).
- **High-Traffic Asset**: **1.2x Multiplier** (Airports, USA, Brazil, High-traffic color sets).
- **Standard Singleton**: **0.85x Multiplier** (Secures unowned tiles at a 15% discount).
- **Safety Ceiling**: Absolute bid cap at $\text{myCash} - \$30$.

### 2. Dynamic Bid Stepping
- **Aggressive Jump Bid (+ $50)**: If `CeilingBid - CurrentBid >= $100`, jumps the bid by +$50 to intimidate opponents and speed up auction resolution.
- **Standard Increment (+ $10)**: Places regular +$10 bids when approaching ceiling value.
- **Passing**: Automatically passes when the current bid exceeds `CeilingBid`.

### 3. Direct Buy vs. Auction
- **Rule**: RUBOT **always buys directly** if it can afford the property. Auctioning is strictly reserved for when physical cash is insufficient for direct purchase.

---

## 11. HYBRID LOCAL LLM (OLLAMA) & BOT CAMOUFLAGE

RUBOT features a local, private, zero-cost AI brain powered by Ollama (default: `qwen2.5:7b` / `llama3.2:3b` at `http://localhost:11434`):

### 1. Multi-Tier Fallback Hierarchy
1. **Tier 1 (Primary Model)**: `qwen2.5:7b` (Deep game-state reasoning & nuance).
2. **Tier 2 (Fast Model)**: `llama3.2:3b` (Ultra-fast 3500ms fallback if primary fails).
3. **Tier 3 (Minimax Engine)**: Instant mathematical fallback if Ollama is offline or uninstalled. The bot never freezes.

### 2. Grandmaster Integrity Guard
Even if an LLM hallucinates or outputs an unfavorable trade decision, the **Grandmaster Integrity Guard** intercepts the response. If the Minimax rule engine flagged a Fatal Danger or negative survival EV, the LLM is **strictly forbidden** from accepting the trade.

### 3. Human Gamer Camouflage & Chat Responses
When players type in room chat, RUBOT replies like an authentic human gamer:
- Generates all-lowercase, short (1–6 words), relaxed gaming slang.
- **Bot Accusation Handling**: If asked *"are you a bot?"* or *"chat if not bot"*, it naturally denies or jokes:
  - *"nah lol just calculating"*
  - *"nah watching stream on 2nd monitor"*
  - *"im here lol"*
  - *"just planning turns lol"*
- Casual greetings: *"yo"*, *"hey"*, *"ready"*, *"gg"*.
- Trade negotiation pitches: *"counter me with germany 2"*, *"take china 1 + 50 for italy 2?"*.

---

## 12. GLASSMORPHIC HUD & INTERACTIVE CONTROLS

The visual interface is rendered via a non-intrusive, draggable, glassmorphic HUD:

- **Draggable & Minimizable**: Position anywhere on screen; collapse to a sleek floating badge.
- **1-Click Server Resync**: Clicking the 🎲 logo dispatches `request-sync { snapshot: "" }`, instantly healing any desynchronized state.
- **4 Real-Time Tabs**:
  1. 🧠 **Brain**: Live Cash, Verified badge, Position, Turn Count, Markov Danger EV, Dynamic Survival Reserve, Turn Clock remaining, and Local Ollama status.
  2. 📊 **Intel**: Real-time breakdown of all players' net worth, liquid cash, hungry sets, and critical blockers.
  3. ⚙️ **Toggles**: Individual persistence toggles for Auto Buy, Smart Reserve, Auto Trade, Auto Auction, Auto Build, Auto Mortgage, and Auto Chat.
  4. 📜 **Activity Log**: Real-time terminal streaming network events, valuations, trade verdicts, and protocol actions.

---

*Engineered with precision for absolute strategic dominance on RichUp.io.*
