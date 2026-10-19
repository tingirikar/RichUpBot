# RichUp.io Grandmaster AI Bot 🎩🎲

An advanced, game-theoretic autonomous AI engine and strategic advisor for [RichUp.io](https://richup.io) (the multiplayer browser-based Monopoly game). 

Combines **Markov chain risk modeling**, **Monte Carlo forward rollouts**, **heuristic game theory**, and an optional **local LLM brain (Ollama)** to make mathematically optimal, human-like decisions in real time.

---

## ⚡ Core Features at a Glance

### 1. 🎲 Complete Autonomous Gameplay
* **Auto-Roll & Navigation:** Automatically detects turns and rolls the dice with humanized randomized delays (160ms–320ms) to avoid bot detection.
* **Auto-End Turn:** Concludes turns smoothly after executing all viable purchases, upgrades, and trade proposals.
* **Dual Operation Modes:**
  * **Auto-Pilot Mode:** The bot plays fully autonomously at Grandmaster level.
  * **Advisor Mode:** Instead of auto-clicking, displays tactical popups with clear mathematical rationales and **[Execute] / [Skip]** buttons for human-in-the-loop play.
* **Anti-Stall & Self-Healing:** Built-in watchdog timer and DOM mutation observer recover automatically if game states lag or desync.

---

### 2. 🧠 Intelligent Property Acquisition & "Intelligent Skip"
* **High-Yield Asset Priority:** Automatically prioritizes Airports (scaling to $200 rent with zero building cost) and Utilities.
* **Critical Blocker Defense:** Continuously scans opponent inventories; if an unowned property stops an opponent from completing a color set, the bot **always buys it** to deny them a monopoly.
* **Monopoly Completers:** Instantly secures properties that complete sets for yourself.
* **Intelligent Skip (Hotel Danger Veto):** In the mid-to-late game, if cash is limited and dangerous enemy houses/hotels ($250+ rent) lie ahead within dice range, the bot **skips buying non-essential land** to preserve a safety cash reserve and prevent rolling into bankruptcy.

---

### 3. 🔨 Strategic Building & "Ambush" Timing
* **The 3-House Rent Rush:** Exploits the fundamental inflection point in Monopoly mathematics—rent spikes 400%–800% upon building the 3rd house. The bot aggressively rushes 3 houses on complete color groups.
* **Ambush Window Strike:** Tracks real-time board positions of every opponent. Rather than spending cash prematurely, it holds cash until an opponent enters the **Strike Zone** (5 to 9 tiles away), then builds instantly to trap them.
* **Dynamic Cash Floor:** Computes Markov 1-turn and 3-turn expected rent exposure ($E[\text{Rent}]$) across all tiles ahead, ensuring house construction never drains cash below survival thresholds.

---

### 4. 💸 Debt Recovery & Strategic Mortgaging
* **Strategic Sacrifice Scoring:** Evaluates all owned assets by strategic value. Low-EV singletons are liquidated first, while critical opponent blockers have a **5.0x defense multiplier** to prevent accidental surrender.
* **Strategic Mortgaging for Monopoly Rushes:** Mortgages dead-weight, isolated properties (e.g. single airports or uncompleted sets) to raise immediate capital for lethal 3-house builds.
* **Emergency Debt Relief:** If cash drops below zero, automatically sells houses evenly and mortgages optimal properties to clear debt without getting bankrupted.

---

### 5. 🤝 20-Round Monte Carlo Trade Engine
* **20-Round Forward Rollout Simulation:** For every trade offer (incoming or proposed), runs **80 stochastic Monte Carlo trajectories simulating 20 future turns** of dice rolls, passing GO salary (+$200), rent payments, and bankruptcy risk.
* **Simulation Veto:** Automatically rejects any trade where accepting drops your projected 20-round survival probability by $>15\%$.
* **Monopoly Veto Rule:** Strict veto against any trade that grants an opponent an uncountered monopoly.
* **Proactive Mutual Monopoly Swaps:** Scans the board for win-win complementary cards (e.g. *"I give you your 3rd card, you give me my 3rd card"*) and calculates cash equalization balances.

---

### 6. 🦙 Hybrid Local LLM Brain (Ollama)
* **Zero API Costs & 100% Private:** Integrates with local Ollama (`qwen2.5:7b`, `llama3.2`, etc.) over `http://localhost:11434`.
* **Full Match Context Briefing:** Sends the LLM a complete tactical snapshot:
  * Every player's cash, board position, jail status, and property list
  * Developed monopolies, house/hotel counts, and mortgaged assets
  * 1-turn danger exposure and 20-round Monte Carlo simulation outputs
* **End-Turn Strategic Deliberation:** Pauses right before clicking "End Turn" to ask the LLM whether building houses or ending the turn is optimal.

---

### 7. 💬 Human-Mimicry & Chat Negotiation
* **Chat Feed Scanner:** Continuously reads the in-game room chat.
* **Anti-Bot Chameleon Persona:** If opponents ask *"bot?"*, *"chat if not bot"*, or say *"hi"*, Ollama generates casual, authentic gamer replies under 8 words (e.g. *"im here lol"*, *"nah watching video on 2nd screen"*).
* **Trade Negotiation Banter:** Automatically types contextual negotiation messages into the chat bar when proposing, countering, or rejecting trades.

---

### 8. 🔒 Context-Aware Jail Strategy ("Fortress Mode")
* **WebSocket Rule Sniffing:** Sniffs initial WebSocket handshake packets (`can_collect_rent_in_jail`) to know with 100% accuracy whether rent can be collected while in jail.
* **Early Game Land Rush:** Immediately pays the $50 bail or uses Pardon cards to buy unowned land and circle the board.
* **Late Game "Fortress Mode":** If the lobby allows collecting rent in jail and enemy hotels are outside, the bot **stays in jail for free** ("intelligent round wasting"), safely collecting rent from opponents while immune to outside board damage.
* **Rent-Hunting Early Exit:** If the lobby prohibits collecting rent in jail, the bot checks if opponents are approaching its hotels and bails out immediately to collect rent.

---

### 9. 📊 Interactive In-Game HUD Panel
* **Sleek Cyberpunk Dark UI:** Injected directly into the RichUp.io interface.
* **Live Telemetry Cards:** Displays real-time Cash, Position, Danger EV ($), and Dynamic Reserve ($).
* **Bot Activity Log:** Real-time terminal tracking every evaluation, decision, click delay, and trade simulation.
* **Feature Toggles:** Real-time switches for Auto-Pilot, Advisor Mode, Buy Land, Ambush Build, Auto-Auction, Auto-Trade, Smart Reserve, and Ollama Brain.

---

## 🛠️ Tech Stack & Architecture

| Layer | Technologies |
| :--- | :--- |
| **Userscript Runtime** | Tampermonkey / Violentmonkey (ES2020 IIFE) |
| **Bundler** | `esbuild` |
| **Mathematical Engine** | Markov Chain Probability, Monte Carlo Stochastic Rollouts |
| **AI / Reasoning** | Local Ollama API (`qwen2.5:7b` / `llama3.2-vision`) |
| **DOM Engine** | Semantic ARIA & MutationObserver (immune to React build hashes) |
| **Network Sniffer** | Native WebSocket Hook & `GM_xmlhttpRequest` |

---

## 🚀 Installation & Setup

1. **Prerequisites:**
   * Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
   * *(Optional for AI Brain)* Install [Ollama](https://ollama.com/) and run `ollama run qwen2.5:7b`.

2. **Build the Userscript:**
   ```bash
   npm install
   npm run build
   ```

3. **Install to Browser:**
   * Open Tampermonkey in your browser $\rightarrow$ **Create a new script**.
   * Copy and paste the entire contents of `dist/RichUpBot.user.js`.
   * Save and navigate to [richup.io](https://richup.io).