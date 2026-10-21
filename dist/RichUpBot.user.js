// ==UserScript==
// @name         RichUp.io Grandmaster AI Engine (Modular Edition)
// @namespace    http://tampermonkey.net/
// @version      5.2.0
// @description  Grandmaster-level autonomous AI for RichUp.io with full opponent tracking, auction sniping, Markov risk management, intelligent trading, and room-aware jail strategy.
// @author       haxxor + Grandmaster AI
// @license      GPL-3.0
// @match        https://richup.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==

(() => {
  // src/config.js
  var CONFIG = {
    // Action timing delays (in milliseconds) for human-like interaction
    ACTION_DELAY_MIN: 400,
    ACTION_DELAY_MAX: 1800,
    OBSERVER_DEBOUNCE_MS: 200,
    POLL_INTERVAL_MS: 1200,
    SELF_HEAL_INTERVAL_MS: 1e3,
    STALL_TIMEOUT_SEC: 8,
    // AI Operation Mode: false = FULL_AUTO, true = ADVISOR (Asks human before acting)
    ADVISOR_MODE: false,
    // AI Strategy Toggles (Persisted in localStorage)
    ALWAYS_BUY_AFFORDABLE: localStorage.getItem("richup_cfg_buy") !== "false",
    SMART_RESERVE_ENABLED: localStorage.getItem("richup_cfg_reserve") !== "false",
    AMBUSH_BUILD_ONLY: false,
    // Proactively build houses on monopolies whenever safe & affordable
    AUTO_TRADE_ENABLED: localStorage.getItem("richup_cfg_trade") !== "false",
    AUTO_AUCTION_ENABLED: localStorage.getItem("richup_cfg_auction") !== "false",
    AUTO_BUILD_ENABLED: localStorage.getItem("richup_cfg_build") !== "false",
    AUTO_MORTGAGE_ENABLED: localStorage.getItem("richup_cfg_mortgage") !== "false",
    CHAT_ENABLED: localStorage.getItem("richup_cfg_chat") !== "false",
    // Math & Game-Theory Parameters
    BASE_MIN_RESERVE: 250,
    // Absolute cash floor to prevent low-cash building traps
    RISK_AVERSION_FACTOR: 1.5,
    // Balanced multiplier on 1-turn expected rent loss
    WORST_CASE_WEIGHT: 0.25,
    // Weight on worst-case single roll
    TRADE_MIN_ADVANTAGE_RATIO: 1.05,
    // Require at least 5% utility edge in trades
    AUCTION_MAX_OVERBID_RATIO: 1.4,
    // Max bid for critical blocker/completer
    CHAT_COOLDOWN_MS: 2e4,
    // Cooldown between trade negotiation messages
    AUTO_REPLY_CHAT: true,
    // Natural AI replies to opponent in-game chat ("chat if not bot", etc.)
    CHAT_REPLY_COOLDOWN_MS: 7e3,
    // Cooldown between chat conversational replies
    DELIBERATE_BEFORE_END_TURN: true,
    // LLM strategic review right before ending turn
    // Hybrid Vision / LLM Brain Configuration (Local Ollama)
    OLLAMA_ENABLED: localStorage.getItem("richup_ollama_enabled") !== "false",
    // Default to true!
    OLLAMA_HOST: localStorage.getItem("richup_ollama_host") || "http://localhost:11434",
    OLLAMA_MODEL: localStorage.getItem("richup_ollama_model") || "qwen2.5:7b",
    OLLAMA_TIMEOUT_MS: 6e3
    // Cap to allow local LLMs to reason without early timeout
  };
  var STATES = Object.freeze({
    IDLE: "idle",
    ROLLING: "rolling",
    JAIL_DECISION: "jail_eval",
    BUYING: "buying",
    AUCTION: "auction_eval",
    TRADING: "trade_eval",
    BUILDING: "roi_build",
    LIQUIDATING: "debt_recovery",
    ENDING_TURN: "ending_turn"
  });

  // src/data/boardTiles.js
  var BOARD_TILES = [
    { id: 0, name: "Start", type: "special", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0309 },
    { id: 1, name: "Salvador", type: "property", group: "Brazil", price: 60, houseCost: 50, rent: [2, 10, 30, 90, 150, 240], markov: 0.0213 },
    { id: 2, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0188 },
    { id: 3, name: "Rio", type: "property", group: "Brazil", price: 60, houseCost: 50, rent: [4, 20, 60, 190, 330, 460], markov: 0.0216 },
    { id: 4, name: "Earnings Tax", type: "tax", group: null, price: 200, houseCost: 0, rent: [200], markov: 0.0233 },
    { id: 5, name: "TLV Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0296 },
    { id: 6, name: "Tel Aviv", type: "property", group: "Israel", price: 100, houseCost: 50, rent: [6, 30, 90, 260, 380, 540], markov: 0.0226 },
    { id: 7, name: "Haifa", type: "property", group: "Israel", price: 110, houseCost: 50, rent: [6, 30, 90, 280, 400, 560], markov: 0.0232 },
    { id: 8, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 86e-4 },
    { id: 9, name: "Jerusalem", type: "property", group: "Israel", price: 120, houseCost: 50, rent: [8, 40, 110, 300, 460, 610], markov: 0.023 },
    { id: 10, name: "In Prison", type: "jail", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0589 },
    { id: 11, name: "Venice", type: "property", group: "Italy", price: 130, houseCost: 100, rent: [10, 50, 140, 440, 600, 740], markov: 0.027 },
    { id: 12, name: "Power Company", type: "utility", group: "Utility", price: 150, houseCost: 0, rent: [28, 70], markov: 0.026 },
    { id: 13, name: "Milan", type: "property", group: "Italy", price: 140, houseCost: 100, rent: [10, 50, 160, 460, 630, 760], markov: 0.0237 },
    { id: 14, name: "Rome", type: "property", group: "Italy", price: 160, houseCost: 100, rent: [12, 60, 180, 500, 700, 900], markov: 0.0246 },
    { id: 15, name: "MUC Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0292 },
    { id: 16, name: "Frankfurt", type: "property", group: "Germany", price: 180, houseCost: 100, rent: [14, 70, 190, 540, 760, 950], markov: 0.0279 },
    { id: 17, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0259 },
    { id: 18, name: "Munich", type: "property", group: "Germany", price: 190, houseCost: 100, rent: [15, 70, 210, 560, 760, 960], markov: 0.0293 },
    { id: 19, name: "Berlin", type: "property", group: "Germany", price: 200, houseCost: 100, rent: [15, 80, 220, 600, 780, 1e3], markov: 0.0308 },
    { id: 20, name: "Vacation", type: "special", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0288 },
    { id: 21, name: "Shenzhen", type: "property", group: "China", price: 210, houseCost: 150, rent: [18, 90, 240, 680, 850, 1e3], markov: 0.0283 },
    { id: 22, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0104 },
    { id: 23, name: "Beijing", type: "property", group: "China", price: 220, houseCost: 150, rent: [20, 90, 260, 710, 900, 1100], markov: 0.0273 },
    { id: 24, name: "Shanghai", type: "property", group: "China", price: 240, houseCost: 150, rent: [20, 100, 290, 740, 920, 1100], markov: 0.0318 },
    { id: 25, name: "CDG Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0306 },
    { id: 26, name: "Lyon", type: "property", group: "France", price: 260, houseCost: 150, rent: [20, 100, 320, 800, 950, 1100], markov: 0.027 },
    { id: 27, name: "Water Company", type: "utility", group: "Utility", price: 150, houseCost: 0, rent: [28, 70], markov: 0.0281 },
    { id: 28, name: "Toulouse", type: "property", group: "France", price: 270, houseCost: 150, rent: [20, 120, 350, 825, 1e3, 1150], markov: 0.0268 },
    { id: 29, name: "Paris", type: "property", group: "France", price: 280, houseCost: 150, rent: [25, 120, 350, 850, 1e3, 1200], markov: 0.0258 },
    { id: 30, name: "Go to prison", type: "gotojail", group: null, price: 0, houseCost: 0, rent: [0], markov: 0 },
    { id: 31, name: "Liverpool", type: "property", group: "UK", price: 290, houseCost: 200, rent: [25, 120, 380, 850, 1050, 1250], markov: 0.0267 },
    { id: 32, name: "Manchester", type: "property", group: "UK", price: 300, houseCost: 200, rent: [26, 140, 400, 950, 1150, 1300], markov: 0.0262 },
    { id: 33, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0245 },
    { id: 34, name: "London", type: "property", group: "UK", price: 320, houseCost: 200, rent: [30, 140, 440, 1e3, 1200, 1400], markov: 0.025 },
    { id: 35, name: "JFK Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0243 },
    { id: 36, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0102 },
    { id: 37, name: "San Francisco", type: "property", group: "USA", price: 360, houseCost: 200, rent: [35, 180, 550, 1150, 1350, 1525], markov: 0.0218 },
    { id: 38, name: "Premium Tax", type: "tax", group: null, price: 75, houseCost: 0, rent: [75], markov: 0.0217 },
    { id: 39, name: "New York", type: "property", group: "USA", price: 400, houseCost: 200, rent: [50, 200, 600, 1400, 1700, 2e3], markov: 0.0263 }
  ];
  var GROUP_TILES = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
      if (tile.group) {
        if (!acc[tile.group]) acc[tile.group] = [];
        acc[tile.group].push(tile);
      }
      return acc;
    }, {})
  );
  var TILE_BY_NAME = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
      acc[tile.name.toLowerCase()] = tile;
      return acc;
    }, {
      // Aliases for RichUp alternate names
      "electric company": BOARD_TILES[12],
      "power": BOARD_TILES[12],
      "muc airport": BOARD_TILES[15],
      "nuc airport": BOARD_TILES[15],
      "income tax": BOARD_TILES[4],
      "luxury tax": BOARD_TILES[38],
      "premium tax": BOARD_TILES[38]
    })
  );
  var TILE_BY_ID = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
      acc[tile.id] = tile;
      return acc;
    }, {})
  );
  var HIGH_TRAFFIC_GROUPS = /* @__PURE__ */ new Set(["Germany", "China", "France", "Italy"]);
  var GROUP_POWER = Object.freeze({
    // Tier 1: Game Enders (Peak Prison exit landing frequencies + high rent ROI)
    "Germany": 95,
    // Orange: Sits 6, 8, 9 from Prison, cheap $100 houses, highest landing rate
    "China": 88,
    // Red: High frequency right after Germany, $1,100 rent
    // Tier 2: Heavy Hitters
    "France": 82,
    // Yellow: $1,200 rent, high late-game traffic
    "USA": 80,
    // Dark Blue: Only 2 tiles to build, massive $2,000 rent
    "UK": 75,
    // Green: Huge $1,400 rent, but expensive $200 houses
    // Tier 3: Budget / Mid-Game
    "Italy": 68,
    // Pink: Cheap $100 houses, moderate $900 rent
    "Israel": 52,
    // Light Blue: Ultra-cheap $50 houses, low $600 ceiling
    // Tier 4: Weakest
    "Brazil": 30,
    // Brown: 2 tiles, maximum rent capped at only $240 / $460
    // Non-monopoly utility groups
    "Airport": 45,
    "Utility": 20
  });
  var BOARD_LABELS_BLACKLIST = /* @__PURE__ */ new Set([
    ...BOARD_TILES.map((t) => t.name.toLowerCase()),
    "start",
    "passing by",
    "in prison",
    "vacation",
    "go to prison",
    "treasure",
    "surprise",
    "income tax",
    "earnings tax",
    "luxury tax",
    "electric",
    "water",
    "company",
    "airport",
    "collect",
    "on hold",
    "trades",
    "bankrupt",
    "votekick",
    "buy",
    "buy for",
    "buy for:",
    "buy land",
    "buy property",
    "sell",
    "connection lost",
    "disconnected",
    "reconnecting",
    "server error",
    "ping",
    "advisor",
    "auto-pilot",
    "danger ev",
    "survival reserve",
    "position",
    "my name",
    "cash",
    "store",
    "shop",
    "inventory",
    "profile",
    "settings",
    "rules",
    "lobby",
    "room",
    "host",
    "change appearance",
    "waiting for",
    "joined the game",
    "start the game",
    "is playing",
    "good luck",
    "even build",
    "starting cash",
    "randomize player order",
    "create",
    "share this game",
    "share",
    "share this",
    "chat if not bot",
    // UI button labels that must never be mistaken for usernames:
    "copy",
    "leave",
    "kick",
    "mute",
    "report",
    "trade",
    "mortgage",
    "upgrade",
    "downgrade",
    "end turn",
    "roll the dice",
    "roll again",
    "auction",
    "pass",
    "bid",
    "ok",
    "done",
    "continue",
    "confirm",
    "decline",
    "negotiate",
    "skip",
    "execute",
    "cancel",
    "close",
    "test",
    "my properties",
    "properties",
    "back",
    "next",
    "send",
    "submit"
  ]);

  // src/memory/gameMemory.js
  var GameMemory = {
    // Identity
    myName: (() => {
      const saved = localStorage.getItem("richup_bot_my_name");
      if (saved && BOARD_LABELS_BLACKLIST.has(saved.toLowerCase())) {
        localStorage.removeItem("richup_bot_my_name");
        return null;
      }
      return saved || null;
    })(),
    myCash: 1e3,
    cashVerified: false,
    myPos: 0,
    inJail: false,
    jailTurns: 0,
    turnCount: 0,
    isMyTurn: false,
    isNegativeDebt: false,
    currentRoomId: null,
    checkRoomTransition() {
      const match = typeof window !== "undefined" && window.location ? window.location.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/i) : null;
      const newRoomId = match ? match[1] : null;
      if (this.currentRoomId !== newRoomId) {
        const prevRoom = this.currentRoomId;
        this.currentRoomId = newRoomId;
        if (prevRoom !== null || newRoomId !== null) {
          this.reset();
          return true;
        }
      }
      return false;
    },
    // Room Settings (Sniffed from match start or DOM)
    roomSettings: {
      startingCash: 1500,
      // RichUp default starting cash ($1500 as seen in gameplay-rules.png)
      collectRentInJail: true,
      // RichUp default: players can collect rent in jail unless toggled off
      doubleOnStart: false,
      // Landing on Start gives $400?
      passStartBonus: 200,
      // Standard pass start bonus
      auctionsEnabled: true,
      // Auctions allowed?
      evenBuild: true,
      // Even build requirement
      doubleRentOnFullSet: false
      // x2 rent on full-set properties
    },
    // All active players: name -> { cash, pos, inJail, isMe, bankrupt }
    players: {},
    // Tile ownership: tileId -> { owner, houses, mortgaged }
    ownership: {},
    // Archival history of declined trades per player:
    // playerName -> Array<{ givenIds: number[], receivedIds: number[], cashOffer: number, ts: number }>
    declinedTrades: {},
    recordDeclinedTrade(partnerName, trade = {}) {
      if (!partnerName) return;
      const key = partnerName.trim();
      if (!this.declinedTrades[key]) this.declinedTrades[key] = [];
      const given = trade.givenTiles || (trade.myGivenTiles ? trade.myGivenTiles : trade.myGivenTile ? [trade.myGivenTile] : []);
      const received = trade.receivedTiles || (trade.myReceivedTiles ? trade.myReceivedTiles : trade.myReceivedTile ? [trade.myReceivedTile] : []);
      const givenIds = given.map((t) => typeof t === "object" ? t.id : t).filter((x) => typeof x === "number").sort();
      const receivedIds = received.map((t) => typeof t === "object" ? t.id : t).filter((x) => typeof x === "number").sort();
      const cashOffer = trade.cashOffer || trade.givenCash || 0;
      this.declinedTrades[key].push({
        givenIds,
        receivedIds,
        cashOffer,
        ts: Date.now()
      });
      if (this.declinedTrades[key].length > 25) this.declinedTrades[key].shift();
    },
    isTradePreviouslyDeclined(partnerName, givenIds = [], receivedIds = [], cashOffer = 0) {
      if (!partnerName) return false;
      const history = this.declinedTrades[partnerName.trim()];
      if (!history || history.length === 0) return false;
      const gSorted = [...givenIds].sort().join(",");
      const rSorted = [...receivedIds].sort().join(",");
      return history.some((h) => {
        const matchG = h.givenIds.join(",") === gSorted;
        const matchR = h.receivedIds.join(",") === rSorted;
        return matchG && matchR && cashOffer <= h.cashOffer && Date.now() - h.ts < 24e4;
      });
    },
    getDeclinedCountForPlayer(partnerName) {
      if (!partnerName) return 0;
      return (this.declinedTrades[partnerName.trim()] || []).length;
    },
    // Diagnostic & tracking logs
    processedLogs: /* @__PURE__ */ new Map(),
    wsActive: false,
    wsLastMessageTime: 0,
    wsMessages: [],
    lastPurchasedBlock: null,
    lastDangerEV: 0,
    lastDynamicReserve: CONFIG.BASE_MIN_RESERVE,
    lastJailMode: "AGR_EXIT",
    lastTradeVerdict: "READY",
    isLogProcessed(line, ttlMs = 8e3) {
      if (!line) return true;
      const last = this.processedLogs.get(line);
      if (!last) return false;
      if (Date.now() - last > ttlMs) {
        this.processedLogs.delete(line);
        return false;
      }
      return true;
    },
    markLogProcessed(line) {
      if (!line) return;
      const now = Date.now();
      this.processedLogs.set(line, now);
      if (this.processedLogs.size > 100) {
        for (const [k, v] of this.processedLogs.entries()) {
          if (now - v > 2e4) this.processedLogs.delete(k);
        }
      }
    },
    isWsHealthy() {
      return Boolean(this.wsActive && Date.now() - this.wsLastMessageTime < 15e3 && this.cashVerified && this.myName);
    },
    setMyName(name) {
      if (!name || typeof name !== "string") return;
      const trimmed = name.trim();
      if (!trimmed) return;
      if (BOARD_LABELS_BLACKLIST.has(trimmed.toLowerCase())) return;
      this.myName = trimmed;
      try {
        localStorage.setItem("richup_bot_my_name", trimmed);
      } catch (_) {
      }
    },
    isMe(playerName) {
      if (!playerName) return false;
      if (this.myName && playerName.toLowerCase() === this.myName.toLowerCase()) return true;
      if (playerName === "__ME__") return true;
      return false;
    },
    reset() {
      this.myCash = 1500;
      this.cashVerified = false;
      this.myPos = 0;
      this.inJail = false;
      this.jailTurns = 0;
      this.turnCount = 0;
      this.isMyTurn = false;
      this.players = {};
      this.ownership = {};
      this.declinedTrades = {};
      BOARD_TILES.forEach((t) => {
        if (t.group) {
          this.ownership[t.id] = { owner: null, houses: 0, mortgaged: false };
        }
      });
      this.processedLogs.clear();
    },
    getGroupCount(groupName, ownerName) {
      const tiles = GROUP_TILES[groupName] || [];
      let count = 0;
      for (const t of tiles) {
        const info = this.ownership[t.id];
        if (!info || !info.owner) continue;
        if (ownerName === "__ME__" ? this.isMe(info.owner) : info.owner === ownerName) {
          count++;
        }
      }
      return { owned: count, total: tiles.length };
    },
    getUnownedPropertyCount() {
      let unowned = 0;
      for (const t of BOARD_TILES) {
        if (t.group && (!this.ownership[t.id] || !this.ownership[t.id].owner)) {
          unowned++;
        }
      }
      return unowned;
    },
    getTileCurrentRent(tileId, visitorName = null) {
      const tile = BOARD_TILES[tileId];
      if (!tile) return 0;
      if (tile.type === "tax") return tile.rent[0] || 0;
      if (!tile.group) return 0;
      const info = this.ownership[tileId];
      if (!info || !info.owner || info.mortgaged) return 0;
      if (this.isMe(info.owner)) return 0;
      if (visitorName && info.owner === visitorName) return 0;
      const { owned, total } = this.getGroupCount(tile.group, info.owner);
      if (!this.roomSettings.collectRentInJail) {
        const ownerPlayer = this.players[info.owner];
        if (ownerPlayer && ownerPlayer.inJail) return 0;
      }
      if (tile.type === "airport") {
        return tile.rent[Math.max(0, Math.min(owned - 1, 3))] || 25;
      }
      if (tile.type === "utility") {
        return owned >= 2 ? 70 : 28;
      }
      if (info.houses > 0) {
        return tile.rent[Math.min(info.houses, 5)] || tile.rent[0];
      }
      return owned === total ? tile.rent[0] * 2 : tile.rent[0];
    }
  };
  GameMemory.reset();

  // src/dom/elementFinder.js
  function isVisibleAndEnabled(el) {
    if (!el || el.disabled) return false;
    const hud = document.getElementById("rubot-hud-panel");
    if (hud && hud.contains(el)) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.classList && (el.classList.contains("disabled") || el.classList.contains("btn-disabled"))) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0 || style.pointerEvents === "none") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function normalizeText(el) {
    return String(el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function createDOMSnapshot() {
    const hud = document.getElementById("rubot-hud-panel");
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
      findBuyPropertyButton(targetTile = null) {
        for (const b of allButtons) {
          const txt = b.text;
          if ((txt.includes("buy") || txt.includes("purchase")) && !txt.includes("don't") && !txt.includes("dont") && !txt.includes("house") && !txt.includes("hotel") && !txt.includes("back") && !txt.includes("cancel")) {
            return b.el;
          }
        }
        const searchContainers = [];
        const openCard = this.getOpenPropertyCard ? this.getOpenPropertyCard() : null;
        if (openCard && openCard.el) searchContainers.push(openCard.el);
        const modals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], [class*="prompt" i], [class*="popup" i], [class*="action" i], [class*="drawer" i]');
        for (let i = 0; i < modals.length; i++) {
          if (!hud || !hud.contains(modals[i])) searchContainers.push(modals[i]);
        }
        for (const container of searchContainers) {
          const modalBtns = container.querySelectorAll('button, [role="button"], [class*="btn" i], [class*="button" i], div[tabindex]');
          for (let i = 0; i < modalBtns.length; i++) {
            const btn = modalBtns[i];
            if (!isVisibleAndEnabled(btn)) continue;
            const txt = normalizeText(btn);
            if (txt.length <= 40 && (txt.includes("buy") || txt.includes("purchase") || targetTile && (txt.includes(`$${targetTile.price}`) || txt === `${targetTile.price}`)) && !txt.includes("don't") && !txt.includes("dont") && !txt.includes("house") && !txt.includes("hotel") && !txt.includes("back") && !txt.includes("cancel")) {
              return btn;
            }
          }
        }
        const allClickables = Array.from(document.querySelectorAll('button, [role="button"], [class*="btn" i], [class*="button" i], div[role="button"], div[tabindex], a, div')).filter((el) => (!hud || !hud.contains(el)) && el.childElementCount <= 2);
        for (const el of allClickables) {
          if (!isVisibleAndEnabled(el)) continue;
          const txt = normalizeText(el);
          if (txt.length <= 40 && (txt.includes("buy") || txt.includes("purchase")) && !txt.includes("don't") && !txt.includes("dont") && !txt.includes("house") && !txt.includes("hotel") && !txt.includes("back") && !txt.includes("cancel")) {
            return el;
          }
        }
        return null;
      },
      findAuctionBidButton(preferredIncrement = 10) {
        if (preferredIncrement >= 50) {
          for (const b of allButtons) {
            if (b.text.includes("+50") || b.text.includes("+ 50") || b.text.includes("+$50") || b.text.includes("+ $50")) {
              return b.el;
            }
          }
        }
        for (const b of allButtons) {
          if (b.text.includes("+$") || b.text.includes("+ $") || b.text.includes("+10") || b.text.includes("bid") && !b.text.includes("history")) {
            return b.el;
          }
        }
        return null;
      },
      findAuctionPassButton() {
        return this.findExactOrIncludes(["pass", "withdraw", "don't bid", "skip bid"]);
      },
      /**
       * Finds "+ Create" button under Trades panel in the sidebar
       */
      findCreateTradeButton() {
        for (const b of allButtons) {
          if ((b.text === "+ create" || b.text === "create" || b.text.includes("create trade")) && !b.text.includes("game") && !b.text.includes("room")) {
            return b.el;
          }
        }
        const elements = document.querySelectorAll("div, span, button, a");
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (hud && hud.contains(el)) continue;
          if (!isVisibleAndEnabled(el)) continue;
          const text = normalizeText(el);
          if ((text === "+ create" || text === "create") && !text.includes("game") && !text.includes("room")) {
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
        const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
        const searchRoot = modal || document.body;
        const candidates = searchRoot.querySelectorAll('button, div, [role="button"], li, a, span');
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (hud && hud.contains(el)) continue;
          if (!isVisibleAndEnabled(el)) continue;
          const text = normalizeText(el);
          if (text === targetLower || text.includes(targetLower) && text.length < targetLower.length + 20) {
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
          if (b.text.includes("send trade") || b.text.includes("propose trade") || b.text === "send") {
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
          if (text.includes("send trade") || text.includes("propose trade") || text === "send") {
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
        const hud2 = document.getElementById("rubot-hud-panel");
        for (let i = 0; i < allItems.length; i++) {
          const el = allItems[i];
          if (hud2 && hud2.contains(el)) continue;
          if (!isVisibleAndEnabled(el)) continue;
          const text = normalizeText(el);
          if ((text.includes("\u2194") || text.includes("<->")) && text.length < 50) {
            return el;
          }
        }
        return null;
      },
      findTradeConfirmButton() {
        return this.findExactOrIncludes(["confirm", "accept", "agree"]);
      },
      findTradeDeclineButton() {
        return this.findExactOrIncludes(["decline", "reject", "refuse"]);
      },
      findTradeNegotiateButton() {
        return this.findExactOrIncludes(["negotiate", "counter"]);
      },
      /**
       * Detects secondary confirmation modal dialogs (e.g. "Are you sure you want to mortgage?", "Confirm action")
       */
      findConfirmationModalButton() {
        const modals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="confirm" i], [class*="alert" i], [class*="dialog" i]');
        for (let i = 0; i < modals.length; i++) {
          const m = modals[i];
          if (hud && hud.contains(m)) continue;
          if (!isVisibleAndEnabled(m)) continue;
          if (m.querySelector('input[type="range"], [class*="trade" i]') || (m.className || "").toString().toLowerCase().includes("trade")) {
            continue;
          }
          const text = (m.innerText || "").toLowerCase();
          if (text.includes("trade") || text.includes("propose") || text.includes("counter")) {
            continue;
          }
          if (text.includes("are you sure") || text.includes("confirm action") || text.includes("confirm mortgage") || text.includes("confirm bankruptcy")) {
            const btns = m.querySelectorAll('button, [role="button"], [class*="btn" i]');
            for (let j = 0; j < btns.length; j++) {
              const b = btns[j];
              if (!isVisibleAndEnabled(b)) continue;
              const bText = normalizeText(b);
              if (bText === "yes" || bText === "confirm" || bText === "mortgage" || bText === "unmortgage" || bText === "ok" || bText === "proceed" || bText.includes("confirm")) {
                return b;
              }
            }
          }
        }
        return null;
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
          const rect = c.getBoundingClientRect();
          if (rect.width < 160 || rect.height < 160) continue;
          if (rect.left > window.innerWidth * 0.65 && rect.width < 320) continue;
          const text = c.innerText || "";
          const lower = text.toLowerCase();
          if (lower.includes("i'm bidding") || lower.includes("current bid") || lower.includes("highest bid") || lower.includes("sold in") || lower.includes("trades") || lower.includes("select your player")) {
            continue;
          }
          if (text.includes("Owner") || text.includes("Price") || text.includes("with rent") || text.includes("when")) {
            for (const t of BOARD_TILES) {
              if (t.group && new RegExp(`\\b${t.name}\\b`, "i").test(text)) {
                const lowerText = text.toLowerCase();
                if (lowerText.includes("mortgaged") || lowerText.includes("get back for")) {
                  if (GameMemory.ownership[t.id]) {
                    GameMemory.ownership[t.id].mortgaged = true;
                  }
                } else if (lowerText.includes("mortgage for")) {
                  if (GameMemory.ownership[t.id]) {
                    GameMemory.ownership[t.id].mortgaged = false;
                  }
                }
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
        const allCardBtns = Array.from(card.el.querySelectorAll('button, [role="button"], [class*="button" i]')).filter((b) => {
          if (hud && hud.contains(b)) return false;
          if (!isVisibleAndEnabled(b)) return false;
          const txt = (b.innerText || "").trim().toLowerCase();
          if (txt.includes("end turn") || txt.includes("roll") || txt.includes("bankrupt") || txt === "x") return false;
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
          const inner = btn.innerHTML || "";
          const text = normalizeText(btn);
          if (inner.includes("\u2191") || inner.includes("\u2B61") || inner.includes("arrow-up") || text.includes("upgrade") || text.includes("build")) {
            return btn;
          }
        }
        if (actionBtns.length >= 2) {
          return actionBtns[0];
        }
        for (const b of allButtons) {
          const inner = b.el.innerHTML || "";
          if (inner.includes("\u2191") || inner.includes("\u2B61") || b.text === "\u2191" || b.text.includes("upgrade") || b.text.includes("build")) {
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
          const inner = btn.innerHTML || "";
          const text = normalizeText(btn);
          if (inner.includes("\u2193") || inner.includes("\u2B63") || inner.includes("arrow-down") || text.includes("sell") || text.includes("downgrade")) {
            return btn;
          }
        }
        if (actionBtns.length >= 3) {
          return actionBtns[1];
        }
        for (const b of allButtons) {
          const inner = b.el.innerHTML || "";
          if (inner.includes("\u2193") || inner.includes("\u2B63") || b.text === "\u2193" || b.text.includes("sell") || b.text.includes("downgrade")) {
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
        if (!card) return null;
        const cardText = (card.el.innerText || "").toLowerCase();
        if (cardText.includes("mortgaged") || cardText.includes("get back for") || GameMemory.ownership[card.tile.id]?.mortgaged) {
          return null;
        }
        const actionBtns = this.getPropertyCardActionButtons();
        if (actionBtns.length === 1) {
          return actionBtns[0];
        }
        for (const btn of actionBtns) {
          const inner = (btn.innerHTML || "").toLowerCase();
          const text = normalizeText(btn);
          if (text.includes("mortgage") || inner.includes("mortgage") || inner.includes("trash") || inner.includes("bin") || inner.includes("m19 7")) {
            if (!text.includes("unmortgage") && !inner.includes("unmortgage")) return btn;
          }
        }
        if (actionBtns.length >= 3) {
          return actionBtns[2];
        }
        const cardBtns = card.el.querySelectorAll('button, [role="button"], div[role="button"]');
        for (let i = 0; i < cardBtns.length; i++) {
          const btn = cardBtns[i];
          if (!isVisibleAndEnabled(btn)) continue;
          const text = normalizeText(btn);
          if (text.includes("mortgage") && !text.includes("unmortgage")) {
            return btn;
          }
        }
        for (const b of allButtons) {
          const text = b.text || "";
          const inner = (b.el.innerHTML || "").toLowerCase();
          if ((text.includes("mortgage") || inner.includes("mortgage")) && !text.includes("unmortgage") && !inner.includes("unmortgage")) {
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
        const cardBtns = Array.from(card.el.querySelectorAll('button, [role="button"], [class*="button" i]')).filter((b) => {
          if (hud && hud.contains(b)) return false;
          if (!isVisibleAndEnabled(b)) return false;
          return true;
        });
        for (const btn of cardBtns) {
          const text = normalizeText(btn);
          const inner = (btn.innerHTML || "").toLowerCase();
          if (text.includes("unmortgage") || inner.includes("unmortgage") || text.includes("un-mortgage") || text.includes("get back for") || inner.includes("get back for") || /get back for|\$?\d+.*get back/i.test(text)) {
            return btn;
          }
        }
        const cardText = (card.el.innerText || "").toLowerCase();
        if (cardText.includes("mortgaged") || cardText.includes("get back for") || GameMemory.ownership[card.tile.id]?.mortgaged) {
          for (const btn of cardBtns) {
            const txt = (btn.innerText || "").toLowerCase();
            if (txt.includes("$") && (txt.includes("get back") || !txt.includes("mortgage for"))) {
              return btn;
            }
          }
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
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const inner = (el.innerHTML || "").toLowerCase();
          if (txt === "x" || txt === "\u2715" || txt === "\u2716" || txt === "close" || aria.includes("close") || inner.includes("close") || el.tagName === "BUTTON" && el.querySelector("svg") && el.getBoundingClientRect().width < 38) {
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
        const allItems = document.querySelectorAll('div, li, button, [class*="property" i], [class*="item" i], p, span');
        for (let i = 0; i < allItems.length; i++) {
          const el = allItems[i];
          if (hud && hud.contains(el)) continue;
          if (!isVisibleAndEnabled(el)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.left < window.innerWidth * 0.5) continue;
          if (rect.height < 18 || rect.height > 95 || rect.width < 70) continue;
          const rawText = normalizeText(el);
          if (rawText.includes("my properties") || rawText.includes("trades") || rawText.includes("bankrupt")) continue;
          const cleanText = rawText.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
          if (cleanText === lowerTarget || cleanText.startsWith(lowerTarget) || rawText.includes(lowerTarget) || cleanText.includes(lowerTarget) && cleanText.length < lowerTarget.length + 18) {
            const clickable = el.closest('button, [role="button"], li, div[class*="item" i], div[class*="property" i]') || el;
            return clickable;
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
          if (column && modal) {
            const rect = el.getBoundingClientRect();
            const elCenter = rect.left + rect.width / 2;
            if ((column === "mine" || column === "left") && elCenter > modalCenter) continue;
            if ((column === "theirs" || column === "right") && elCenter < modalCenter) continue;
          }
          const rawText = normalizeText(el);
          const cleanText = rawText.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
          if (cleanText === lowerName || cleanText.startsWith(lowerName) || cleanText.endsWith(lowerName) || rawText.includes(lowerName) || cleanText.includes(lowerName) && cleanText.length < lowerName.length + 35) {
            const clickable = el.closest('button, [role="button"], li, div[class*="card" i], div[class*="property" i]') || el;
            return clickable;
          }
        }
        return null;
      },
      /**
       * Detects the red/orange [Bankrupt] button that appears when the player is in debt
       */
      findBankruptButton() {
        for (const b of allButtons) {
          const txt = (b.text || "").toLowerCase();
          if (txt === "bankrupt" || txt.includes("bankrupt")) {
            return b.el;
          }
        }
        const candidates = document.querySelectorAll('button, [role="button"], a, div');
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (hud && hud.contains(el)) continue;
          if (!isVisibleAndEnabled(el)) continue;
          const txt = normalizeText(el);
          if (txt === "bankrupt" || txt.includes("bankrupt") && txt.length <= 20) {
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
          if (text === lowerName || el.getAttribute("title")?.toLowerCase() === lowerName) {
            return el;
          }
        }
        return null;
      }
    };
  }

  // src/data/diceProb.js
  var DICE_PROB = Object.freeze({
    2: 1 / 36,
    3: 2 / 36,
    4: 3 / 36,
    5: 4 / 36,
    6: 5 / 36,
    7: 6 / 36,
    8: 5 / 36,
    9: 4 / 36,
    10: 3 / 36,
    11: 2 / 36,
    12: 1 / 36
  });

  // src/memory/opponentTracker.js
  var OpponentTracker = {
    /**
     * Comprehensive scan of all opponents
     */
    analyzeOpponents() {
      const myName = GameMemory.myName || "__ME__";
      const analysis = {};
      const playerNames = new Set(Object.keys(GameMemory.players));
      for (const info of Object.values(GameMemory.ownership)) {
        if (info?.owner && !GameMemory.isMe(info.owner)) {
          playerNames.add(info.owner);
        }
      }
      const isSamePlayer = (a, b) => {
        if (!a || !b) return false;
        return a.trim().toLowerCase() === b.trim().toLowerCase();
      };
      for (const pName of playerNames) {
        if (GameMemory.isMe(pName)) continue;
        const pData = GameMemory.players[pName] || { cash: 500, pos: 0, bankrupt: false };
        if (pData.bankrupt) continue;
        const ownedTiles = [];
        const hungrySets = [];
        let totalPropertyNetWorth = 0;
        for (const tile of BOARD_TILES) {
          if (!tile.group) continue;
          const info = GameMemory.ownership[tile.id];
          if (info && isSamePlayer(info.owner, pName)) {
            ownedTiles.push(tile);
            totalPropertyNetWorth += tile.price;
          }
        }
        for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
          if (tiles[0].type !== "property") continue;
          const ownedCount = tiles.filter((t) => isSamePlayer(GameMemory.ownership[t.id]?.owner, pName)).length;
          if (ownedCount === tiles.length - 1) {
            const missingTile = tiles.find((t) => !isSamePlayer(GameMemory.ownership[t.id]?.owner, pName));
            const holder = GameMemory.ownership[missingTile?.id]?.owner || "Unowned";
            hungrySets.push({
              group: groupName,
              ownedCount,
              total: tiles.length,
              missingTile,
              heldBy: holder,
              weHoldIt: GameMemory.isMe(holder),
              houseCost: missingTile?.houseCost || 100,
              affordableHouses: Math.floor((pData.cash || 0) / (missingTile?.houseCost || 100))
            });
          }
        }
        analysis[pName] = {
          name: pName,
          cash: pData.cash || 0,
          pos: pData.pos || 0,
          inJail: pData.inJail || false,
          ownedTiles,
          hungrySets,
          totalPropertyNetWorth,
          threatLevel: hungrySets.length > 0 ? pData.cash > 400 ? "LETHAL" : "HIGH" : "MODERATE"
        };
      }
      return analysis;
    },
    /**
     * Returns a list of properties we own that are actively blocking
     * an opponent from completing a monopoly.
     * RULE: NEVER SELL/TRADE THESE unless we receive an immediate winning monopoly!
     */
    getCriticalBlockers() {
      const blockers = [];
      const opponents = this.analyzeOpponents();
      for (const opp of Object.values(opponents)) {
        for (const hungry of opp.hungrySets) {
          if (hungry.weHoldIt && hungry.missingTile) {
            blockers.push({
              tile: hungry.missingTile,
              blockingOpponent: opp.name,
              targetGroup: hungry.group,
              oppCash: opp.cash,
              threat: hungry.affordableHouses >= 3 ? "IMMEDIATE_DEATH" : "HIGH"
            });
          }
        }
      }
      return blockers;
    },
    /**
     * Identifies the missing card(s) WE need to complete our own monopolies.
     */
    getMyMissingCards() {
      const myMissing = [];
      for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
        if (tiles[0].type !== "property" && tiles[0].type !== "airport") continue;
        const myCount = tiles.filter((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner)).length;
        if (myCount === tiles.length - 1) {
          const missing = tiles.find((t) => !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
          const holder = GameMemory.ownership[missing.id]?.owner || null;
          myMissing.push({
            group: groupName,
            missingTile: missing,
            heldBy: holder,
            isUnowned: !holder,
            houseCost: missing.houseCost,
            buildCostTo3Houses: missing.houseCost * 3 * tiles.length
          });
        }
      }
      return myMissing;
    },
    /**
     * Identifies sets where we own 1 card (out of 3) and an opponent owns another card,
     * presenting a consolidation trade opportunity!
     */
    getMyAdvancingNeeds() {
      const needs = [];
      for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
        if (tiles[0].type !== "property" || tiles.length !== 3) continue;
        const myCount = tiles.filter((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner)).length;
        if (myCount === 1) {
          const myTile = tiles.find((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
          const otherTiles = tiles.filter((t) => !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
          for (const other of otherTiles) {
            const holder = GameMemory.ownership[other.id]?.owner;
            if (holder && !GameMemory.isMe(holder)) {
              needs.push({
                group: groupName,
                myTile,
                wantedTile: other,
                heldBy: holder
              });
            }
          }
        }
      }
      return needs;
    },
    /**
     * Assets we own that are SAFE to trade away as sweeteners.
     * Singletons that do NOT complete any opponent's monopoly.
     */
    getSafeTradeSacrifices() {
      const blockers = new Set(this.getCriticalBlockers().map((b) => b.tile.id));
      const safe = [];
      const tradable = [];
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner) && info.houses === 0) {
          const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
          if (owned < total - 1) {
            if (!blockers.has(tile.id)) {
              safe.push(tile);
            }
            tradable.push(tile);
          }
        }
      }
      return safe;
    },
    /**
     * All singletons owned (including blockers) - strictly for Mutual Monopoly Swaps where
     * giving away a blocker is justified by immediately completing our own monopoly.
     */
    getAllTradableSingletons() {
      const tradable = [];
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner) && info.houses === 0) {
          const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
          if (owned < total - 1) {
            tradable.push(tile);
          }
        }
      }
      return tradable;
    },
    isBlockerAgainstAnyOpponent(tile) {
      if (!tile || !tile.group) return false;
      const opps = this.analyzeOpponents();
      for (const opp of Object.values(opps)) {
        if (opp.hungrySets.some((h) => h.group === tile.group)) {
          return true;
        }
      }
      return false;
    }
  };

  // src/engine/markovRisk.js
  var MarkovRisk = {
    analyzeDangerAhead(currentPos) {
      let expectedLoss1Turn = 0;
      let maxDangerWindowLoss = 0;
      let maxAnyRollLoss = 0;
      for (let roll = 2; roll <= 12; roll++) {
        const prob = DICE_PROB[roll];
        const targetTile = (currentPos + roll) % 40;
        const rent = GameMemory.getTileCurrentRent(targetTile);
        expectedLoss1Turn += prob * rent;
        if (roll >= 5 && roll <= 9 && rent > maxDangerWindowLoss) {
          maxDangerWindowLoss = rent;
        }
        if (rent > maxAnyRollLoss) {
          maxAnyRollLoss = rent;
        }
      }
      let expectedLoss3Turns = expectedLoss1Turn;
      for (let step = 13; step <= 21; step++) {
        const targetTile = (currentPos + step) % 40;
        const tileData = BOARD_TILES[targetTile];
        const rent = GameMemory.getTileCurrentRent(targetTile);
        const markovWeight = tileData.markov * 0.45;
        expectedLoss3Turns += markovWeight * rent;
      }
      GameMemory.lastDangerEV = Math.round(expectedLoss1Turn);
      return {
        expectedLoss1Turn: Math.round(expectedLoss1Turn),
        expectedLoss3Turns: Math.round(expectedLoss3Turns),
        maxDangerWindowLoss,
        maxAnyRollLoss
      };
    },
    computeDynamicReserve(currentPos) {
      if (!CONFIG.SMART_RESERVE_ENABLED) return CONFIG.BASE_MIN_RESERVE;
      const danger = this.analyzeDangerAhead(currentPos);
      const dynamicReserve = Math.round(
        CONFIG.BASE_MIN_RESERVE + CONFIG.RISK_AVERSION_FACTOR * danger.expectedLoss1Turn + CONFIG.WORST_CASE_WEIGHT * danger.maxDangerWindowLoss
      );
      GameMemory.lastDynamicReserve = Math.max(CONFIG.BASE_MIN_RESERVE, dynamicReserve);
      return GameMemory.lastDynamicReserve;
    },
    /**
     * Evaluates property purchase when landing on unowned tile.
     * PROPERTIES ARE #1 PRIORITY: Always secure properties, airports, and utilities!
     */
    shouldBuyProperty(tile, price, myCash) {
      if (myCash < price) {
        return {
          buy: false,
          reason: `Cannot afford ${tile ? tile.name : "property"} ($${price} > $${myCash})`
        };
      }
      const mySet = tile?.group ? GameMemory.getGroupCount(tile.group, "__ME__") : null;
      if (mySet && mySet.total > 1 && mySet.owned === mySet.total - 1 && mySet.owned > 0) {
        return {
          buy: true,
          reason: `CRITICAL: Completes ${tile.group} Monopoly!`
        };
      }
      if (mySet && mySet.owned >= 1) {
        return {
          buy: true,
          reason: `MONOPOLY BUILDER: Secures ${mySet.owned + 1}/${mySet.total} for ${tile.group} set!`
        };
      }
      if (tile && OpponentTracker.isBlockerAgainstAnyOpponent(tile)) {
        return {
          buy: true,
          reason: `DEFENSIVE BLOCK: Prevents opponent from completing ${tile.group}!`
        };
      }
      if (tile && (tile.group === "Airport" || tile.group === "Airports" || tile.type === "airport")) {
        return { buy: true, reason: `Essential High-Yield Asset: ${tile.name} (Airport)` };
      }
      if (tile && (tile.group === "Utility" || tile.group === "Utilities" || tile.type === "utility")) {
        return { buy: true, reason: `Cashflow Asset: ${tile.name} (Utility)` };
      }
      const unownedRemaining = BOARD_TILES.filter((t) => t.group && (!GameMemory.ownership[t.id] || !GameMemory.ownership[t.id].owner)).length;
      const isFinaleEndGame = unownedRemaining === 0 || GameMemory.turnCount > 30 && myCash < 300;
      if (isFinaleEndGame) {
        const danger = this.analyzeDangerAhead(GameMemory.myPos);
        const postCash = myCash - price;
        if (danger.maxDangerWindowLoss >= 300 && postCash < 60) {
          return {
            buy: false,
            reason: `FINALE END-GAME SKIP: Facing lethal hotel ($${danger.maxDangerWindowLoss}) directly ahead. Preserving $${myCash} survival cash.`
          };
        }
      }
      return {
        buy: true,
        reason: `PRIORITY ACQUISITION: ${tile ? tile.name : "Property"} ($${price}) [Set Progress / Net Worth]`
      };
    }
  };

  // src/engine/jailStrategy.js
  var JailStrategy = {
    shouldPayToLeaveJail(myCash) {
      const totalOpponentHouses = this.countOpponentHouses();
      if (totalOpponentHouses === 0 && myCash >= 50) {
        GameMemory.lastJailMode = "SAFE_EXIT";
        return {
          exit: true,
          reason: `Board Safe (0 enemy houses): Leaving cell to circle board & collect +$200 at Start`
        };
      }
      const unownedCount = GameMemory.getUnownedPropertyCount();
      if (unownedCount >= 4 && myCash >= 50) {
        GameMemory.lastJailMode = "AGR_EXIT";
        return {
          exit: true,
          reason: `Early Game Land Grab: ${unownedCount} unowned properties remaining on board`
        };
      }
      const dangerOutside = MarkovRisk.analyzeDangerAhead(10);
      const reserve = MarkovRisk.computeDynamicReserve(10);
      const canCollectRentInJail = GameMemory.roomSettings.collectRentInJail;
      if (!canCollectRentInJail) {
        const opponentsApproachingOurHotels = this.areOpponentsApproachingOurProperties();
        if (opponentsApproachingOurHotels && myCash >= 50) {
          GameMemory.lastJailMode = "RENT_HUNT_EXIT";
          return {
            exit: true,
            reason: `Room Setting Alert: Cannot collect rent in jail! Opponents entering our hotel strike zone.`
          };
        }
      }
      if (dangerOutside.expectedLoss1Turn > 60 || dangerOutside.maxDangerWindowLoss > 200) {
        GameMemory.lastJailMode = "SAFE_STAY";
        return {
          exit: false,
          reason: `Fortress Mode: Safe in Jail collecting rent. High danger ($${dangerOutside.expectedLoss1Turn} EV) outside.`
        };
      }
      if (myCash >= 50 && (myCash - 50 >= reserve * 0.7 || dangerOutside.expectedLoss1Turn < 40)) {
        GameMemory.lastJailMode = "SAFE_EXIT";
        return {
          exit: true,
          reason: `Board Safe: Low danger EV ($${dangerOutside.expectedLoss1Turn}) ahead. Circling for +$200 Start.`
        };
      }
      GameMemory.lastJailMode = "SAFE_STAY";
      return {
        exit: false,
        reason: `Preserving $50 cash: Remaining safe in Jail`
      };
    },
    /**
     * Checks if any active opponent is 2 to 12 tiles away from any property
     * we own that has houses built on it.
     */
    areOpponentsApproachingOurProperties() {
      const myHotels = [];
      for (const tile of BOARD_TILES) {
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner) && info.houses >= 1) {
          myHotels.push(tile.id);
        }
      }
      if (myHotels.length === 0) return false;
      for (const [pName, pData] of Object.entries(GameMemory.players)) {
        if (GameMemory.isMe(pName) || pData.bankrupt || pData.inJail) continue;
        const oppPos = pData.pos || 0;
        for (const hotelTileId of myHotels) {
          const distance = (hotelTileId - oppPos + 40) % 40;
          if (distance >= 2 && distance <= 12) {
            return true;
          }
        }
      }
      return false;
    },
    /**
     * Counts the total number of houses and hotels built by all opponents on the board.
     */
    countOpponentHouses() {
      let count = 0;
      for (const tile of BOARD_TILES) {
        const info = GameMemory.ownership[tile.id];
        if (info && info.owner && !GameMemory.isMe(info.owner)) {
          count += info.houses || 0;
        }
      }
      return count;
    }
  };

  // src/engine/auctionSniper.js
  var AuctionSniper = {
    /**
     * Calculates the maximum rational bid for a property in auction
     */
    calculateCeilingBid(tile, myCash) {
      if (!tile) return { maxBid: 0, multiplier: 0.8, reason: "Unknown tile" };
      let multiplier = 0.85;
      let reason = "Standard Asset Discount Bid";
      const mySet = GameMemory.getGroupCount(tile.group, "__ME__");
      if (tile.group && mySet.owned === mySet.total - 1) {
        multiplier = 2.5;
        reason = `MUST-HAVE: Completes our ${tile.group} Monopoly!`;
      } else if (tile.group && OpponentTracker.isBlockerAgainstAnyOpponent(tile)) {
        multiplier = 1.6;
        reason = `DEFENSIVE BLOCK: Prevents opponent from completing ${tile.group}`;
      } else if (tile.group && (HIGH_TRAFFIC_GROUPS.has(tile.group) || tile.group === "USA" || tile.group === "Brazil")) {
        multiplier = 1.2;
        reason = `High-Traffic Asset: ${tile.name} (${tile.group})`;
      }
      const ceilingValue = Math.round(tile.price * multiplier);
      const maxAffordable = Math.max(0, myCash - 30);
      return {
        maxBid: Math.min(ceilingValue, maxAffordable),
        multiplier,
        reason
      };
    },
    /**
     * Decides whether to click "Auction" instead of "Buy for $X" upon landing on an unowned property.
     * Rule: We ALWAYS buy directly if we can afford it!
     * Auctioning is ONLY for when we physically cannot afford the purchase.
     */
    shouldSendToAuctionInsteadOfBuy(tile, price, myCash) {
      if (!tile) return { auction: false, reason: "Direct Buy" };
      if (myCash < price) {
        return {
          auction: true,
          reason: `Cannot afford direct buy ($${myCash} < $${price}). Sending to auction.`
        };
      }
      return {
        auction: false,
        reason: `Direct Buy: Securing ${tile.name} directly ($${price} <= $${myCash}).`
      };
    },
    /**
     * Decides whether to bid +$10, +$50, or Pass in an ongoing auction
     */
    evaluateAuctionStep(tile, currentBid, myCash) {
      const { maxBid, reason } = this.calculateCeilingBid(tile, myCash);
      if (maxBid - currentBid >= 100 && currentBid + 50 <= maxBid && currentBid + 50 <= myCash - 30) {
        return {
          shouldBid: true,
          increment: 50,
          maxBid,
          reason: `Aggressive Jump +$50 -> $${currentBid + 50} <= Max $${maxBid} (${reason})`
        };
      }
      if (currentBid + 10 <= maxBid && currentBid + 10 <= myCash - 30) {
        return {
          shouldBid: true,
          increment: 10,
          maxBid,
          reason: `Bidding +$10 -> $${currentBid + 10} <= Max $${maxBid} (${reason})`
        };
      }
      return {
        shouldBid: false,
        increment: 0,
        maxBid,
        reason: `Passing: Current bid $${currentBid} exceeds ceiling $${maxBid} (${reason})`
      };
    }
  };

  // src/engine/tradeEngine.js
  var TradeEngine = {
    scoreTileForPlayer(tile, playerName) {
      if (!tile) return 0;
      const powerMult = tile.group && GROUP_POWER[tile.group] ? GROUP_POWER[tile.group] / 50 : 1;
      const baseEV = tile.price * (1 + tile.markov * 18) * powerMult;
      if (!tile.group) return Math.round(baseEV);
      const isMe = GameMemory.isMe(playerName);
      const { owned, total } = GameMemory.getGroupCount(tile.group, isMe ? "__ME__" : playerName);
      let synergy = 1;
      if (tile.type === "property") {
        if (owned >= total - 1) synergy = 6.2;
        else if (owned === 1 && total === 3) synergy = 2;
      } else if (tile.type === "airport") {
        synergy = 1 + owned * 0.45;
      } else if (tile.type === "utility") {
        synergy = owned >= 1 ? 1.8 : 0.9;
      }
      return Math.round(baseEV * synergy);
    },
    /**
     * 20-ROUND MONTE CARLO FORWARD TRADE SIMULATION
     * Simulates up to 20 rounds of future dice rolls, rent payments, salary collection,
     * and bankruptcy risk comparing trade ACCEPTED vs REJECTED.
     */
    simulateFutureTradeRounds(tradeData, numRounds = 20, iterations = 80) {
      const {
        partnerName = "__OPP__",
        givenTiles = [],
        receivedTiles = [],
        givenCash = 0,
        receivedCash = 0
      } = tradeData;
      const givenIds = new Set(givenTiles.map((t) => t.id));
      const receivedIds = new Set(receivedTiles.map((t) => t.id));
      const runTrajectory = (isAccepted) => {
        const simOwnership = {};
        for (const [id, info] of Object.entries(GameMemory.ownership)) {
          let owner = info.owner;
          if (isAccepted) {
            if (givenIds.has(Number(id))) owner = partnerName;
            if (receivedIds.has(Number(id))) owner = GameMemory.myName || "__ME__";
          }
          simOwnership[id] = { owner, houses: info.houses || 0, mortgaged: info.mortgaged || false };
        }
        let myCash = isAccepted ? GameMemory.myCash - givenCash + receivedCash : GameMemory.myCash;
        let oppBase = GameMemory.players[partnerName]?.cash ?? 500;
        let oppCash = isAccepted ? oppBase - receivedCash + givenCash : oppBase;
        let myPos = GameMemory.myPos || 0;
        let oppPos = GameMemory.players[partnerName]?.pos || 0;
        let myBankrupt = myCash < 0;
        let oppBankrupt = oppCash < 0;
        for (let r = 1; r <= numRounds; r++) {
          if (!myBankrupt) {
            const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
            const newPos = (myPos + roll) % 40;
            if (newPos < myPos) myCash += 200;
            myPos = newPos;
            const tile = BOARD_TILES[myPos];
            if (tile?.group) {
              const info = simOwnership[tile.id];
              if (info?.owner === partnerName && !info.mortgaged) {
                let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                if (tile.type === "property" && tile.rent) {
                  rent = tile.rent[info.houses || 0] || tile.rent[0];
                  if ((info.houses || 0) === 0 && tile.group) {
                    const gTiles = GROUP_TILES[tile.group] || [];
                    if (gTiles.length > 0 && gTiles.every((gt) => simOwnership[gt.id]?.owner === partnerName)) {
                      rent *= 2;
                    }
                  }
                } else if (tile.type === "airport") {
                  const count = Object.values(simOwnership).filter((x) => x.owner === partnerName && BOARD_TILES[x.id]?.type === "airport").length;
                  rent = 25 * Math.pow(2, Math.max(0, count - 1));
                }
                myCash -= rent;
                oppCash += rent;
                if (myCash < 0) myBankrupt = true;
              }
            }
          }
          if (!oppBankrupt) {
            const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
            const newPos = (oppPos + roll) % 40;
            if (newPos < oppPos) oppCash += 200;
            oppPos = newPos;
            const tile = BOARD_TILES[oppPos];
            if (tile?.group) {
              const info = simOwnership[tile.id];
              if (info && GameMemory.isMe(info.owner) && !info.mortgaged) {
                let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                if (tile.type === "property" && tile.rent) {
                  rent = tile.rent[info.houses || 0] || tile.rent[0];
                  if ((info.houses || 0) === 0 && tile.group) {
                    const gTiles = GROUP_TILES[tile.group] || [];
                    if (gTiles.length > 0 && gTiles.every((gt) => GameMemory.isMe(simOwnership[gt.id]?.owner))) {
                      rent *= 2;
                    }
                  }
                } else if (tile.type === "airport") {
                  const count = Object.values(simOwnership).filter((x) => GameMemory.isMe(x.owner) && BOARD_TILES[x.id]?.type === "airport").length;
                  rent = 25 * Math.pow(2, Math.max(0, count - 1));
                }
                oppCash -= rent;
                myCash += rent;
                if (oppCash < 0) oppBankrupt = true;
              }
            }
          }
        }
        return { myCash, oppCash, mySurvive: !myBankrupt, oppSurvive: !oppBankrupt };
      };
      let accSurvivals = 0, accCashSum = 0;
      let rejSurvivals = 0, rejCashSum = 0;
      for (let i = 0; i < iterations; i++) {
        const acc = runTrajectory(true);
        if (acc.mySurvive) accSurvivals++;
        accCashSum += acc.myCash;
        const rej = runTrajectory(false);
        if (rej.mySurvive) rejSurvivals++;
        rejCashSum += rej.myCash;
      }
      const accSurvRate = Math.round(accSurvivals / iterations * 100);
      const rejSurvRate = Math.round(rejSurvivals / iterations * 100);
      const accAvgCash = Math.round(accCashSum / iterations);
      const avgRejCash = Math.round(rejCashSum / iterations);
      return {
        simulatedRounds: numRounds,
        iterations,
        accSurvRate,
        rejSurvRate,
        accAvgCash,
        avgRejCash,
        isSimulationEVPlus: accAvgCash >= avgRejCash && accSurvRate >= rejSurvRate - 10
      };
    },
    findCounterTrade(tradeData) {
      const { partnerName, givenTiles = [], receivedTiles = [] } = tradeData;
      if (!partnerName || partnerName === "Opponent") return null;
      const myMissing = OpponentTracker.getMyMissingCards();
      const partnerMissingCard = myMissing.find((m) => m.heldBy && m.heldBy.toLowerCase() === partnerName.toLowerCase());
      if (partnerMissingCard && partnerMissingCard.missingTile) {
        const requestedTile = givenTiles[0] || OpponentTracker.getSafeTradeSacrifices()[0]?.tile;
        if (requestedTile) {
          const oppSet = requestedTile.group ? GameMemory.getGroupCount(requestedTile.group, partnerName) : null;
          const givesThemMonopoly = oppSet && oppSet.owned === oppSet.total - 1;
          const oppCash = GameMemory.players[partnerName]?.cash ?? 500;
          let cashDemand = 0;
          if (givesThemMonopoly) {
            const myPower = GROUP_POWER[partnerMissingCard.missingTile.group] || 50;
            const oppPower = GROUP_POWER[requestedTile.group] || 50;
            const powerDeficit = oppPower - myPower;
            if (powerDeficit > 0) {
              cashDemand = Math.min(oppCash, Math.max(100, Math.round(powerDeficit * 8)));
            } else {
              cashDemand = Math.max(0, Math.min(Math.max(0, oppCash - 50), 100));
            }
          }
          const cashDemandStr = cashDemand > 0 ? ` + $${cashDemand}` : "";
          return {
            targetOwner: partnerName,
            myGivenTile: requestedTile,
            myReceivedTile: partnerMissingCard.missingTile,
            cashOffer: 0,
            cashDemand,
            summary: `COUNTER: Give ${requestedTile.name} -> Get ${partnerMissingCard.missingTile.name}${cashDemandStr}`,
            pitch: `counter: ${partnerMissingCard.missingTile.name.toLowerCase()} for ${requestedTile.name.toLowerCase()}`,
            reason: `Grandmaster Counter-Proposal: Securing ${partnerMissingCard.missingTile.name} to complete our ${partnerMissingCard.missingTile.group} Monopoly!`
          };
        }
      }
      return null;
    },
    evaluateIncomingTrade(tradeData) {
      const {
        partnerName = "__OPP__",
        givenTiles = [],
        receivedTiles = [],
        givenCash = 0,
        receivedCash = 0
      } = tradeData;
      const myExistingMonopolies = [];
      for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
        if (groupName === "Airport" || groupName === "Utility") continue;
        if (groupTiles.every((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
          myExistingMonopolies.push(groupName);
        }
      }
      const weAlreadyHaveMonopoly = myExistingMonopolies.length > 0;
      for (const tile of givenTiles) {
        if (tile.group && myExistingMonopolies.includes(tile.group)) {
          return {
            accept: false,
            counterSwap: null,
            reason: `MONOPOLY BREAK VETO: Cannot trade away ${tile.name}; it is part of our completed ${tile.group} monopoly!`,
            chatReply: CONFIG.CHAT_ENABLED ? `not breaking my set sry` : null
          };
        }
      }
      let givesOppMonopoly = false;
      let oppGroupName = "";
      let givenBlockerTile = null;
      for (const tile of givenTiles) {
        if (tile.group && tile.type === "property") {
          const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
          if (oppSet.owned === oppSet.total - 1) {
            givesOppMonopoly = true;
            oppGroupName = tile.group;
            givenBlockerTile = tile;
            break;
          }
        }
      }
      if (givesOppMonopoly) {
        const oppMonopolies = [];
        for (const [gName, gTiles] of Object.entries(GROUP_TILES)) {
          if (gName === "Airport" || gName === "Utility") continue;
          if (gTiles.every((t) => GameMemory.ownership[t.id]?.owner === partnerName)) {
            oppMonopolies.push(gName);
          }
        }
        if (oppMonopolies.length > 0) {
          return {
            accept: false,
            counterSwap: null,
            reason: `MONOPOLY DENIAL: ${partnerName} already owns ${oppMonopolies.join(", ")}. Will NOT give them another monopoly!`,
            chatReply: CONFIG.CHAT_ENABLED ? `u already have a set lol no way` : null
          };
        }
      }
      let givesOppAdvancement = false;
      let oppAdvanceGroup = "";
      for (const tile of givenTiles) {
        if (tile.group && tile.type === "property") {
          const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
          if (oppSet.owned >= 1) {
            givesOppAdvancement = true;
            oppAdvanceGroup = tile.group;
            break;
          }
        }
      }
      let completesMyMonopoly = false;
      let myCompletedGroup = "";
      for (const tile of receivedTiles) {
        if (tile.group && tile.type === "property") {
          const mySet = GameMemory.getGroupCount(tile.group, "__ME__");
          if (mySet.owned === mySet.total - 1) {
            completesMyMonopoly = true;
            myCompletedGroup = tile.group;
            break;
          }
        }
      }
      if (givenCash > 100) {
        if (!completesMyMonopoly || givesOppMonopoly) {
          return {
            accept: false,
            counterSwap: this.findCounterTrade(tradeData),
            reason: `CASH EXTORTION VETO: Opponent demands $${givenCash} cash sweetener! Refusing to fund opponent.`,
            chatReply: CONFIG.CHAT_ENABLED ? `not paying $${givenCash} cash lol` : null
          };
        }
      }
      if (givesOppMonopoly && !completesMyMonopoly) {
        const counter = this.findCounterTrade(tradeData);
        if (counter) {
          return {
            accept: false,
            counterSwap: counter,
            reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none! (Money cannot compensate for a monopoly).`,
            chatReply: CONFIG.CHAT_ENABLED ? `counter me with ${counter.myReceivedTile.name.toLowerCase()}` : null
          };
        }
        return {
          accept: false,
          counterSwap: null,
          reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none! (Money cannot compensate for a monopoly).`,
          chatReply: CONFIG.CHAT_ENABLED ? `cant give u a set sry` : null
        };
      }
      if (weAlreadyHaveMonopoly && !completesMyMonopoly && givenTiles.length > 0) {
        const counter = this.findCounterTrade(tradeData);
        return {
          accept: false,
          counterSwap: counter,
          reason: `POST-MONOPOLY STARVATION VETO: We already own ${myExistingMonopolies.join(", ")}. Holding all properties/blockers to starve opponents until we secure a 2nd monopoly!`,
          chatReply: CONFIG.CHAT_ENABLED ? `already have my set, only trading for 2nd set` : null
        };
      }
      if (!weAlreadyHaveMonopoly && givesOppAdvancement && !completesMyMonopoly) {
        const counter = this.findCounterTrade(tradeData);
        return {
          accept: false,
          counterSwap: counter,
          reason: `BLOCKER VETO: Trade advances ${partnerName} toward a ${oppAdvanceGroup} monopoly while we get no set!`,
          chatReply: CONFIG.CHAT_ENABLED ? counter ? `counter me with ${counter.myReceivedTile.name.toLowerCase()}` : `cant give u that sry` : null
        };
      }
      if (receivedTiles.length === 0 && givenTiles.length > 0) {
        return {
          accept: false,
          counterSwap: null,
          reason: `CASH-ONLY VETO: Never sell board presence for cash alone. Properties are irreplaceable.`,
          chatReply: CONFIG.CHAT_ENABLED ? `not selling properties for cash sry` : null
        };
      }
      if (completesMyMonopoly) {
        const myCashAfter = GameMemory.myCash + receivedCash - givenCash;
        if (myCashAfter < 30) {
          return {
            accept: false,
            counterSwap: this.findCounterTrade(tradeData),
            reason: `MONOPOLY BLOCKED BY DEBT: Trade completes ${myCompletedGroup} but leaves only $${myCashAfter} cash!`,
            chatReply: CONFIG.CHAT_ENABLED ? `id be broke lol add cash` : null
          };
        }
        if (givesOppMonopoly) {
          const myPower = GROUP_POWER[myCompletedGroup] || 50;
          const oppPower = GROUP_POWER[oppGroupName] || 50;
          const powerDiff = myPower - oppPower;
          const netCash = receivedCash - givenCash;
          if (powerDiff > 5) {
            if (netCash >= -100) {
              return {
                accept: true,
                myGain: 4e3 + powerDiff * 25,
                oppGain: 2500,
                reason: `DOMINANT MUTUAL MONOPOLY SWAP: Our ${myCompletedGroup} (Power ${myPower}) dominates their ${oppGroupName} (Power ${oppPower})!`,
                chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
              };
            }
          } else if (Math.abs(powerDiff) <= 5) {
            if (netCash >= -50) {
              return {
                accept: true,
                myGain: 3500,
                oppGain: 3500,
                reason: `BALANCED MUTUAL MONOPOLY SWAP: Both players get equal-tier sets (${myCompletedGroup} vs ${oppGroupName}).`,
                chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
              };
            }
          } else {
            const requiredCashBonus = Math.round(Math.abs(powerDiff) * 8);
            if (netCash >= requiredCashBonus) {
              return {
                accept: true,
                myGain: 3200 + netCash,
                oppGain: 3500,
                reason: `COMPENSATED MUTUAL MONOPOLY SWAP: ${oppGroupName} (Power ${oppPower}) is stronger than ${myCompletedGroup} (Power ${myPower}), but compensated by +$${netCash} cash!`,
                chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
              };
            } else {
              const counter = this.findCounterTrade(tradeData);
              return {
                accept: false,
                counterSwap: counter,
                reason: `INFERIOR SET VETO: ${oppGroupName} (Power ${oppPower}) is significantly more lethal than ${myCompletedGroup} (Power ${myPower}). Needs at least +$${requiredCashBonus} cash bonus to balance building power!`,
                chatReply: CONFIG.CHAT_ENABLED ? `need $${requiredCashBonus}+ cash, ${oppGroupName.toLowerCase()} is way stronger` : null
              };
            }
          }
        } else {
          return {
            accept: true,
            myGain: 5e3,
            oppGain: 500,
            reason: `MONOPOLY COMPLETER: Completes our ${myCompletedGroup} monopoly without giving opponent a set!`,
            chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
          };
        }
      }
      let myGain = receivedCash - givenCash;
      let oppGain = givenCash - receivedCash;
      for (const tile of receivedTiles) {
        myGain += this.scoreTileForPlayer(tile, "__ME__");
        oppGain -= this.scoreTileForPlayer(tile, partnerName);
      }
      for (const tile of givenTiles) {
        myGain -= this.scoreTileForPlayer(tile, "__ME__");
        oppGain += this.scoreTileForPlayer(tile, partnerName);
      }
      const sim = this.simulateFutureTradeRounds(tradeData, 20, 80);
      if (sim.accSurvRate < sim.rejSurvRate - 10) {
        return {
          accept: false,
          counterSwap: null,
          reason: `20-ROUND SIMULATION VETO: Accepting drops 20-round survival from ${sim.rejSurvRate}% to ${sim.accSurvRate}%!`,
          chatReply: CONFIG.CHAT_ENABLED ? `nah sry` : null
        };
      }
      if (oppGain > myGain && !completesMyMonopoly) {
        const counter = this.findCounterTrade(tradeData);
        if (counter) {
          return {
            accept: false,
            counterSwap: counter,
            reason: `UNFAIR DEFICIT: Trade favors ${partnerName}. Countering for set completer.`,
            chatReply: CONFIG.CHAT_ENABLED ? `counter me` : null
          };
        }
        return {
          accept: false,
          counterSwap: null,
          reason: `UNFAIR DEFICIT: Trade favors ${partnerName} by +$${Math.round(oppGain - myGain)}.`,
          chatReply: CONFIG.CHAT_ENABLED ? "nah sry" : null
        };
      }
      const acceptable = myGain > 0 && (completesMyMonopoly || !weAlreadyHaveMonopoly && myGain >= oppGain * CONFIG.TRADE_MIN_ADVANTAGE_RATIO) && sim.isSimulationEVPlus;
      GameMemory.lastTradeVerdict = acceptable ? "ACCEPTABLE" : "UNFAVORABLE";
      return {
        accept: acceptable,
        myGain: Math.round(myGain),
        oppGain: Math.round(oppGain),
        sim20Rounds: sim,
        counterSwap: acceptable ? null : this.findCounterTrade(tradeData),
        reason: acceptable ? `GRANDMASTER EV+ TRADE: Net gain +$${Math.round(myGain)} vs Opp +$${Math.round(oppGain)} (20-turn Sim: +EV)` : `Unfavorable utility: Net gain $${Math.round(myGain)} < requirement`,
        chatReply: CONFIG.CHAT_ENABLED ? acceptable ? "deal thx" : "nah sry" : null
      };
    },
    /**
     * Proactively scans board state for win-win trade opportunities:
     * 1. Mutual Monopoly Swaps (both players complete sets)
     * 2. Monopoly Completing Acquisitions (we offer cash + surplus properties to get our 3rd card!)
     */
    scanMutualMonopolySwaps() {
      const opportunities = [];
      const myMissing = OpponentTracker.getMyMissingCards();
      const opponents = OpponentTracker.analyzeOpponents();
      const safeSacrifices = OpponentTracker.getSafeTradeSacrifices();
      const myExistingMonopolies = [];
      for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
        if (groupName === "Airport" || groupName === "Utility") continue;
        if (groupTiles.every((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
          myExistingMonopolies.push(groupName);
        }
      }
      const weAlreadyHaveMonopoly = myExistingMonopolies.length > 0;
      for (const myNeed of myMissing) {
        if (myNeed.isUnowned) continue;
        const targetOpponents = myNeed.heldBy ? [myNeed.heldBy] : Object.keys(GameMemory.players).filter((p) => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);
        for (const targetOppName of targetOpponents) {
          const targetOpp = opponents[targetOppName];
          if (!targetOpp) continue;
          for (const oppNeed of targetOpp.hungrySets) {
            if (oppNeed.weHoldIt && oppNeed.missingTile) {
              const myCardValue = this.scoreTileForPlayer(oppNeed.missingTile, targetOppName);
              const theirCardValue = this.scoreTileForPlayer(myNeed.missingTile, "__ME__");
              const myPower = GROUP_POWER[myNeed.missingTile.group] || 50;
              const oppPower = GROUP_POWER[oppNeed.missingTile.group] || 50;
              const powerDiff = myPower - oppPower;
              let cashOffer = 0;
              let cashDemand = 0;
              if (powerDiff > 5) {
                const cashAvailable = weAlreadyHaveMonopoly ? Math.max(0, GameMemory.myCash - 350) : Math.max(0, GameMemory.myCash - 150);
                cashOffer = Math.min(cashAvailable, Math.round(powerDiff * 6));
              } else if (powerDiff < -5) {
                cashDemand = Math.min(targetOpp.cash, Math.round(Math.abs(powerDiff) * 8));
              } else {
                const cashDiff = myCardValue - theirCardValue;
                if (cashDiff > 0) {
                  cashDemand = Math.min(targetOpp.cash, Math.round(cashDiff * 0.4));
                } else if (cashDiff < 0) {
                  const cashAvailable = weAlreadyHaveMonopoly ? Math.max(0, GameMemory.myCash - 350) : Math.max(0, GameMemory.myCash - 100);
                  cashOffer = Math.min(cashAvailable, Math.round(Math.abs(cashDiff) * 0.4));
                }
              }
              const cashClause = cashOffer > 0 ? ` + $${cashOffer}` : cashDemand > 0 ? ` [Demand $${cashDemand}]` : "";
              opportunities.push({
                targetOwner: targetOppName,
                myGivenTile: oppNeed.missingTile,
                myReceivedTile: myNeed.missingTile,
                cashOffer: Math.max(0, cashOffer),
                cashDemand: Math.max(0, cashDemand),
                summary: `MUTUAL SWAP: Give ${oppNeed.missingTile.name} -> Get ${myNeed.missingTile.name}${cashClause}`,
                pitch: cashDemand > 0 ? `swap ${oppNeed.missingTile.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()} + ${cashDemand}?` : cashOffer > 0 ? `swap ${oppNeed.missingTile.name.toLowerCase()} + ${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?` : `swap ${oppNeed.missingTile.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()}?`
              });
            }
          }
        }
      }
      for (const myNeed of myMissing) {
        if (myNeed.isUnowned) continue;
        const targetOpponents = myNeed.heldBy ? [myNeed.heldBy] : Object.keys(GameMemory.players).filter((p) => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);
        for (const targetOppName of targetOpponents) {
          if (opportunities.some((o) => o.targetOwner === targetOppName && o.myReceivedTile.id === myNeed.missingTile.id)) continue;
          const sacrificeTile = safeSacrifices.length > 0 ? safeSacrifices[0] : null;
          if (sacrificeTile) {
            const cashAvailable = weAlreadyHaveMonopoly ? Math.max(0, GameMemory.myCash - 350) : Math.max(0, GameMemory.myCash - 200);
            const cashOffer = Math.min(cashAvailable, Math.max(50, Math.round(myNeed.missingTile.price * 0.6)));
            opportunities.push({
              targetOwner: targetOppName,
              myGivenTile: sacrificeTile,
              myReceivedTile: myNeed.missingTile,
              cashOffer: Math.max(0, cashOffer),
              cashDemand: 0,
              summary: `MONOPOLY ACQUISITION: Give ${sacrificeTile.name} + $${cashOffer} -> Get ${myNeed.missingTile.name}`,
              pitch: `take ${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
            });
          } else {
            const minCashReq = weAlreadyHaveMonopoly ? myNeed.missingTile.price + 450 : myNeed.missingTile.price + 150;
            if (GameMemory.myCash >= minCashReq) {
              const reserve = weAlreadyHaveMonopoly ? 350 : 100;
              const cashOffer = Math.min(GameMemory.myCash - reserve, Math.round(myNeed.missingTile.price * 1.8));
              opportunities.push({
                targetOwner: targetOppName,
                myGivenTile: null,
                myReceivedTile: myNeed.missingTile,
                cashOffer: Math.max(80, cashOffer),
                cashDemand: 0,
                summary: `CASH ACQUISITION: Offer $${cashOffer} -> Get ${myNeed.missingTile.name}`,
                pitch: `${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
              });
            }
          }
        }
      }
      if (!weAlreadyHaveMonopoly) {
        const advancingNeeds = OpponentTracker.getMyAdvancingNeeds();
        for (const need of advancingNeeds) {
          const targetOpponents = need.heldBy ? [need.heldBy] : Object.keys(GameMemory.players).filter((p) => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);
          for (const targetOppName of targetOpponents) {
            if (opportunities.some((o) => o.targetOwner === targetOppName && o.myReceivedTile.id === need.wantedTile.id)) continue;
            const sacrificeTile = safeSacrifices.find((s) => s.id !== need.myTile.id) || null;
            if (sacrificeTile) {
              if (sacrificeTile.group) {
                const oppCount = GameMemory.getGroupCount(sacrificeTile.group, targetOppName);
                if (oppCount.owned >= 1) {
                  const sacPower = GROUP_POWER[sacrificeTile.group] || 50;
                  const myPower = GROUP_POWER[need.group] || 50;
                  if (sacPower > myPower) continue;
                }
              }
              const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 150), Math.max(20, Math.round(need.wantedTile.price * 0.25)));
              const cashLabel = cashOffer > 0 ? ` + $${cashOffer}` : "";
              opportunities.push({
                targetOwner: targetOppName,
                myGivenTile: sacrificeTile,
                myReceivedTile: need.wantedTile,
                cashOffer: Math.max(0, cashOffer),
                cashDemand: 0,
                summary: `SET CONSOLIDATION: Give ${sacrificeTile.name}${cashLabel} -> Get ${need.wantedTile.name}`,
                pitch: cashOffer > 0 ? `${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${need.wantedTile.name.toLowerCase()}?` : `swap ${sacrificeTile.name.toLowerCase()} for ${need.wantedTile.name.toLowerCase()}?`
              });
            }
          }
        }
      }
      if (!weAlreadyHaveMonopoly) {
        const myAirports = BOARD_TILES.filter((t) => t.type === "airport" && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
        if (myAirports.length >= 1 && myAirports.length < 4) {
          const otherAirports = BOARD_TILES.filter((t) => t.type === "airport" && !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
          for (const air of otherAirports) {
            const holder = GameMemory.ownership[air.id]?.owner;
            if (holder && !opportunities.some((o) => o.targetOwner === holder && o.myReceivedTile.id === air.id)) {
              const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), Math.round(air.price * 1.4));
              if (cashOffer >= 100) {
                opportunities.push({
                  targetOwner: holder,
                  myGivenTile: null,
                  myReceivedTile: air,
                  cashOffer,
                  cashDemand: 0,
                  summary: `AIRPORT BUYOUT: Offer $${cashOffer} -> Get ${air.name}`,
                  pitch: `${cashOffer} for ${air.name.toLowerCase()}?`
                });
              }
            }
          }
        }
      }
      if (safeSacrifices.length >= 2) {
        for (const myNeed of myMissing) {
          if (!myNeed.heldBy || myNeed.isUnowned) continue;
          const targetOppName = myNeed.heldBy;
          const s1 = safeSacrifices[0];
          const s2 = safeSacrifices[1];
          const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), 50);
          opportunities.push({
            targetOwner: targetOppName,
            myGivenTiles: [s1, s2],
            myReceivedTiles: [myNeed.missingTile],
            myGivenTile: s1,
            myReceivedTile: myNeed.missingTile,
            cashOffer,
            cashDemand: 0,
            summary: `2-FOR-1 PACKAGE: Give ${s1.name} & ${s2.name} -> Get ${myNeed.missingTile.name}`,
            pitch: `take both ${s1.name.toLowerCase()} and ${s2.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()}?`
          });
        }
      }
      const finalized = [];
      for (const op of opportunities) {
        const givenTiles = Array.isArray(op.myGivenTiles) ? op.myGivenTiles : op.myGivenTile ? [op.myGivenTile] : [];
        const recTiles = Array.isArray(op.myReceivedTiles) ? op.myReceivedTiles : op.myReceivedTile ? [op.myReceivedTile] : [];
        const givenIds = givenTiles.map((t) => t.id);
        const recIds = recTiles.map((t) => t.id);
        if (GameMemory.isTradePreviouslyDeclined(op.targetOwner, givenIds, recIds, op.cashOffer)) {
          const extra = 75;
          if (GameMemory.myCash - (op.cashOffer + extra) >= 150) {
            op.cashOffer += extra;
            op.summary += ` [SWEETENED +$${extra}]`;
            op.pitch = `${op.pitch.replace(/\?$/, "")} + ${op.cashOffer}?`;
            logToBot(`[TRADE ENGINE] \u{1F36F} Sweetened previously declined trade for ${op.targetOwner}: increased cash to $${op.cashOffer}`);
            finalized.push(op);
          } else if (givenTiles.length === 1 && safeSacrifices.length >= 2) {
            const s2 = safeSacrifices.find((s) => s.id !== givenTiles[0].id);
            if (s2) {
              op.myGivenTiles = [givenTiles[0], s2];
              op.myGivenTile = null;
              op.summary = `2-FOR-1 SWEETENED: Give ${givenTiles[0].name} & ${s2.name} -> Get ${recTiles[0]?.name || "property"}`;
              op.pitch = `what about ${givenTiles[0].name.toLowerCase()} AND ${s2.name.toLowerCase()} for ${recTiles[0]?.name?.toLowerCase()}?`;
              logToBot(`[TRADE ENGINE] \u{1F381} Upgraded declined trade to 2-for-1 package: [${givenTiles[0].name}, ${s2.name}]`);
              finalized.push(op);
            }
          }
        } else {
          finalized.push(op);
        }
      }
      return finalized;
    }
  };

  // src/engine/ollamaClient.js
  var OllamaClient = {
    status: "unchecked",
    // 'connected' | 'offline' | 'error'
    /**
     * Universal HTTP helper using GM_xmlhttpRequest if present, else fetch
     */
    httpRequest({ method = "POST", url, data = null, timeout = CONFIG.OLLAMA_TIMEOUT_MS || 6e3 }) {
      return new Promise((resolve, reject) => {
        const gmReq = typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : typeof GM !== "undefined" && GM && GM.xmlHttpRequest ? GM.xmlHttpRequest : null;
        if (gmReq) {
          gmReq({
            method,
            url,
            headers: { "Content-Type": "application/json" },
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
                reject(new Error(`Ollama HTTP ${res.status}: ${res.statusText || ""}`));
              }
            },
            ontimeout: () => reject(new Error("Ollama request timed out")),
            onerror: (err) => reject(new Error(`Ollama connection error: ${err.message || "Host unreachable"}`))
          });
          return;
        }
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeout);
        fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: data ? JSON.stringify(data) : void 0,
          signal: controller.signal
        }).then((res) => {
          clearTimeout(tid);
          if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
          return res.json();
        }).then(resolve).catch((err) => {
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
          method: "GET",
          url: `${CONFIG.OLLAMA_HOST}/api/tags`,
          timeout: 1800
        });
        const models = (data?.models || []).map((m) => m.name);
        this.status = "connected";
        return {
          ok: true,
          models,
          hasTargetModel: models.some((m) => m.includes(CONFIG.OLLAMA_MODEL))
        };
      } catch (err) {
        this.status = "offline";
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
      const primaryModel = CONFIG.OLLAMA_MODEL || "qwen2.5:7b";
      const fallbackModel = primaryModel === "llama3.2:3b" ? "qwen2.5:7b" : "llama3.2:3b";
      try {
        const data = await this.httpRequest({
          method: "POST",
          url: `${CONFIG.OLLAMA_HOST}/api/chat`,
          data: {
            model: primaryModel,
            messages,
            stream: false,
            options
          },
          timeout: CONFIG.OLLAMA_TIMEOUT_MS || 6e3
        });
        if (data?.message?.content) {
          return { content: data.message.content, modelUsed: primaryModel };
        }
        if (data?.error && primaryModel !== fallbackModel) {
          throw new Error(data.error);
        }
      } catch (primaryErr) {
        if (primaryModel !== fallbackModel) {
          try {
            const fallbackData = await this.httpRequest({
              method: "POST",
              url: `${CONFIG.OLLAMA_HOST}/api/chat`,
              data: {
                model: fallbackModel,
                messages,
                stream: false,
                options
              },
              timeout: Math.min(CONFIG.OLLAMA_TIMEOUT_MS || 6e3, 3500)
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
      const ruleVerdict = TradeEngine.evaluateIncomingTrade(tradeData);
      if (!CONFIG.OLLAMA_ENABLED) {
        return ruleVerdict;
      }
      const prompt = this.buildPrompt(tradeData);
      try {
        const messages = [
          {
            role: "system",
            content: 'You are a human playing RichUp.io casually online. Your goal is to WIN. Never trade in enemy favor. If enemy completes a monopoly and we do not, you MUST DECLINE. In "chatReply", write like a real gamer in all lowercase, very short (1-5 words), casual slang (e.g. "nah sry", "cant do that", "nty", "add cash and deal", "need more cash", "deal thx"). NEVER sound like an AI, never use capital letters or periods. Output ONLY valid JSON: {"decision": "CONFIRM" | "DECLINE" | "NEGOTIATE", "reason": "concise rationale under 10 words", "chatReply": "short casual lowercase message"}'
          },
          {
            role: "user",
            content: prompt
          }
        ];
        const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 120 });
        const rawContent = result?.content || "";
        const parsed = this.parseJsonSafely(rawContent);
        if (parsed && (parsed.decision === "CONFIRM" || parsed.decision === "DECLINE" || parsed.decision === "NEGOTIATE")) {
          const isAccept = parsed.decision === "CONFIRM" && ruleVerdict.accept;
          const isNegotiate = parsed.decision === "NEGOTIATE" || !isAccept && ruleVerdict.counterSwap != null;
          const chatReply = parsed.chatReply && parsed.chatReply.trim().length > 3 ? parsed.chatReply.trim() : ruleVerdict.chatReply;
          return {
            accept: isAccept,
            negotiate: !isAccept && isNegotiate,
            reason: isAccept ? `[Ollama ${result.modelUsed}] ${parsed.reason}` : ruleVerdict.accept ? `[Ollama ${result.modelUsed}] ${parsed.reason}` : ruleVerdict.reason,
            chatReply,
            counterSwap: ruleVerdict.counterSwap
          };
        }
        return ruleVerdict;
      } catch (_) {
        return ruleVerdict;
      }
    },
    buildPrompt(tradeData) {
      const partner = tradeData.partnerName || "Opponent";
      const partnerObj = GameMemory.players[partner] || { cash: "Unknown", pos: 0, inJail: false };
      const partnerCash = partnerObj.cash;
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
      const myName = GameMemory.myName || "Me";
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
      for (const [tileId, ownInfo] of Object.entries(GameMemory.ownership)) {
        if (!ownInfo || !ownInfo.owner) continue;
        const tile = BOARD_TILES[tileId];
        if (!tile) continue;
        const ownerKey = Object.keys(playerStats).find(
          (k) => GameMemory.isMe(ownInfo.owner) ? k === myName || GameMemory.isMe(k) : k.toLowerCase() === ownInfo.owner.toLowerCase()
        ) || ownInfo.owner;
        if (!playerStats[ownerKey]) {
          playerStats[ownerKey] = {
            cash: "Unknown",
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
      for (const [pName, pEntry] of Object.entries(playerStats)) {
        for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
          if (groupName === "Airport" || groupName === "Utility") continue;
          const ownsAll = groupTiles.every((t) => {
            const o = GameMemory.ownership[t.id];
            return o && (GameMemory.isMe(pName) ? GameMemory.isMe(o.owner) : o.owner?.toLowerCase() === pName.toLowerCase());
          });
          if (ownsAll) {
            const houseCounts = groupTiles.map((t) => `${t.name}: ${GameMemory.ownership[t.id]?.houses || 0}h`).join(", ");
            pEntry.monopolies.push(`${groupName} (${houseCounts})`);
          }
        }
      }
      const playersFormatted = Object.entries(playerStats).map(([pName, p]) => {
        const isMeText = GameMemory.isMe(pName) ? " (ME)" : pName === partner ? " (TRADE PARTNER)" : "";
        const monoText = p.monopolies.length > 0 ? p.monopolies.join(" | ") : "None";
        const mortgagedText = p.mortgaged.length > 0 ? ` | Mortgaged: [${p.mortgaged.join(", ")}]` : "";
        return `- ${pName}${isMeText}:
    Money: $${p.cash} | Pos: Tile #${p.pos} | In Jail: ${p.inJail ? "YES" : "No"}
    Monopolies: [${monoText}]
    Houses Built: ${p.totalHouses} | Hotels Built: ${p.totalHotels} | Properties Owned: ${p.properties.length}${mortgagedText}`;
      }).join("\n");
      const givenTiles = tradeData.givenTiles || [];
      const receivedTiles = tradeData.receivedTiles || [];
      const givenDetails = givenTiles.map((t) => {
        return `${t.name} (Group: ${t.group || "Special"}, Price: $${t.price}, HouseCost: $${t.houseCost || 0})`;
      }).join("\n  - ") || "None";
      const receivedDetails = receivedTiles.map((t) => {
        return `${t.name} (Group: ${t.group || "Special"}, Price: $${t.price}, HouseCost: $${t.houseCost || 0})`;
      }).join("\n  - ") || "None";
      const partnerCompletedGroups = [];
      for (const t of givenTiles) {
        if (t.group && GROUP_TILES[t.group]) {
          const groupTiles = GROUP_TILES[t.group];
          const othersOwned = groupTiles.filter((gid) => gid !== t.id).every((gid) => {
            const o = GameMemory.ownership[gid];
            return o && o.owner?.toLowerCase() === partner.toLowerCase();
          });
          if (othersOwned) partnerCompletedGroups.push(t.group);
        }
      }
      const myCompletedGroups = [];
      for (const t of receivedTiles) {
        if (t.group && GROUP_TILES[t.group]) {
          const groupTiles = GROUP_TILES[t.group];
          const othersOwned = groupTiles.filter((gid) => gid !== t.id).every((gid) => {
            const o = GameMemory.ownership[gid];
            return o && GameMemory.isMe(o.owner);
          });
          if (othersOwned) myCompletedGroups.push(t.group);
        }
      }
      const partnerCanBuild = partnerCompletedGroups.length > 0 && typeof partnerCash === "number" && partnerCash >= 300;
      const myPostCash = GameMemory.myCash + (tradeData.receivedCash || 0) - (tradeData.givenCash || 0);
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
   ${partnerCompletedGroups.length > 0 ? `CRITICAL ALERT: Completes [${partnerCompletedGroups.join(", ")}] monopoly for ${partner}!` + (partnerCanBuild ? ` Partner has $${partnerCash} cash and CAN IMMEDIATELY RUSH HOUSES!` : ` Partner only has $${partnerCash} cash (building power delayed).`) : `No monopoly completed for partner.`}

2. Monopoly Impact on Us:
   ${myCompletedGroups.length > 0 ? `MASSIVE WIN: Completes [${myCompletedGroups.join(", ")}] monopoly for us! Post-trade cash: $${myPostCash}.` : `No monopoly completed for us.`}

3. 20-Round Forward Rollout Simulation:
   - If Trade ACCEPTED: 20-Round Survival: ${sim.accSurvRate}%, Projected 20-Turn Cash: $${sim.accAvgCash}
   - If Trade REJECTED: 20-Round Survival: ${sim.rejSurvRate}%, Projected 20-Turn Cash: $${sim.avgRejCash}
   - Monte Carlo Projection: ${sim.isSimulationEVPlus ? "PROFITABLE (+EV across 20 simulated rounds)" : "HIGH RISK / NEGATIVE EV across 20 simulated rounds"}

=== GRANDMASTER TRADING DIRECTIVE ===
You are an elite Grandmaster Monopoly AI whose primary objective is to WIN.
CRITICAL RULES:
1. NEVER accept or propose a trade in the opponent's favor. Cash alone can NEVER compensate for giving away a monopoly!
2. If the trade completes a monopoly for ${partner} and does NOT complete a monopoly for us, it is a FATAL DANGER \u2014 you MUST output "DECLINE".
3. If WE already hold a completed monopoly, our primary winning path is building houses and starving opponents. You MUST output "DECLINE" to any request for our properties unless it secures an immediate 2nd completed monopoly for us!
4. Selling properties for cash alone is strictly forbidden \u2014 properties are irreplaceable blockers.
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
      } catch (_) {
      }
      return null;
    },
    /**
     * Generates a casual, human-like in-game chat reply to an opponent's message
     */
    async generateChatResponse(sender, messageText) {
      if (!CONFIG.CHAT_ENABLED) return null;
      if (!CONFIG.OLLAMA_ENABLED || this.status === "offline") {
        return this.getFallbackChatReply(sender, messageText);
      }
      const prompt = `You are playing RichUp (online Monopoly) under the nickname "${GameMemory.myName || "matrix"}".
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
          { role: "system", content: "You are an authentic online multiplayer gamer. Output ONLY a casual, friendly chat message under 8 words. No quotation marks." },
          { role: "user", content: prompt }
        ];
        const result = await this.sendChatCompletion(messages, { temperature: 0.6, num_predict: 25 });
        const content = (result?.content || "").replace(/^["']|["']$/g, "").trim();
        if (content && content.length <= 80) {
          return content;
        }
      } catch (_) {
      }
      return this.getFallbackChatReply(sender, messageText);
    },
    getFallbackChatReply(sender, messageText) {
      const lower = (messageText || "").toLowerCase();
      if (lower.includes("play") || lower.includes("bruh") || lower.includes("roll") || lower.includes("turn")) {
        const replies = ["rolling now", "my bad hold on", "im thinking lol", "one sec", "hold on"];
        return replies[Math.floor(Math.random() * replies.length)];
      }
      if (lower.includes("bot") || lower.includes("ai")) {
        const replies = ["nah lol just calculating", "no lol", "nah watching stream on 2nd monitor", "just planning turns lol"];
        return replies[Math.floor(Math.random() * replies.length)];
      }
      if (lower.includes("trade") || lower.includes("deal")) {
        return "send an offer ill check";
      }
      if (lower.includes("why") || lower.includes("lol")) {
        return "just trying to get sets lol";
      }
      if (lower.includes("hi") || lower.includes("hello") || lower.includes("yo") || lower.includes("hey")) {
        return "yo";
      }
      if (lower.includes("start") || lower.includes("ready")) {
        return "ready";
      }
      if (lower.includes("gg") || lower.includes("wp")) {
        return "gg";
      }
      return "watching board";
    },
    /**
     * Evaluates house upgrades and unmortgage-to-upgrade decisions with local LLM.
     * Enforces intelligent building, strike-zone ambushes, and strict cash conservation.
     */
    async evaluateHouseBuildingWithLLM(buildContext) {
      if (!CONFIG.OLLAMA_ENABLED || this.status === "offline") {
        return null;
      }
      const { completeSets = [], mortgagedMonopolies = [], myCash, reserve, opponents = [], myPos, dangerEV } = buildContext;
      const setsDescription = completeSets.map(
        (s) => `- ${s.groupName}: Tiles [${s.tiles.map((t) => `${t.name} (${GameMemory.ownership[t.id]?.houses || 0}h)`).join(", ")}]. House cost: $${s.houseCost} each. Min houses: ${s.minHouses}. Opponents in strike zone: ${s.opponentsInStrikeZone || "None"}.`
      ).join("\n") || "None";
      const mortgagedDescription = mortgagedMonopolies.map(
        (m) => `- ${m.groupName}: Mortgaged tile ${m.tile.name} (Cost to unmortgage: $${m.unmortgageCost}). Unmortgaging unlocks building on this set!`
      ).join("\n") || "None";
      const oppSummary = opponents.map((o) => `- ${o.name}: $${o.cash} (Pos #${o.pos})`).join("\n") || "None";
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
          { role: "system", content: 'You are an elite Grandmaster Monopoly AI. Output strictly valid JSON: {"decision": "UPGRADE" | "UNMORTGAGE" | "WAIT", "targetGroup": "...", "targetTile": "...", "rationale": "..."}' },
          { role: "user", content: prompt }
        ];
        const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 80 });
        const parsed = this.parseJsonSafely(result?.content || "");
        if (parsed && (parsed.decision === "UPGRADE" || parsed.decision === "UNMORTGAGE" || parsed.decision === "WAIT")) {
          return {
            ...parsed,
            modelUsed: result.modelUsed
          };
        }
      } catch (_) {
      }
      return null;
    },
    /**
     * Deliberate strategic check right before ending turn
     */
    async deliberateEndTurnStrategy() {
      if (!CONFIG.OLLAMA_ENABLED || !CONFIG.DELIBERATE_BEFORE_END_TURN || this.status === "offline") {
        return { action: "END_TURN", rationale: "Minimax math checks satisfied" };
      }
      const monopolies = [];
      for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
        if (groupName === "Airport" || groupName === "Utility") continue;
        const ownsAll = groupTiles.every((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
        if (ownsAll) monopolies.push(groupName);
      }
      const oppSummaries = Object.entries(GameMemory.players).filter(([pName]) => !GameMemory.isMe(pName)).map(([pName, p]) => `${pName}: $${p.cash} (Pos #${p.pos || 0})`).join(", ") || "None";
      const prompt = `Player ${GameMemory.myName || "Me"}: Cash $${GameMemory.myCash}, Monopolies: [${monopolies.join(", ") || "None"}], Next turn danger: $${GameMemory.lastDangerEV}, Opponents: [${oppSummaries}].
Is it optimal to END_TURN now or UPGRADE_HOUSES?
Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "under 10 words"}`;
      try {
        const messages = [
          { role: "system", content: 'You are a Grandmaster Monopoly AI. Output strictly valid JSON: {"action": "END_TURN" | "UPGRADE", "rationale": "..."}' },
          { role: "user", content: prompt }
        ];
        const result = await this.sendChatCompletion(messages, { temperature: 0.1, num_predict: 40 });
        const parsed = this.parseJsonSafely(result?.content || "");
        if (parsed && (parsed.action === "END_TURN" || parsed.action === "UPGRADE")) {
          return parsed;
        }
      } catch (_) {
      }
      return { action: "END_TURN", rationale: "Turn complete" };
    }
  };

  // src/ui/chatEngine.js
  var ChatEngine = {
    lastSentTime: 0,
    lastSentText: "",
    lastRepliedTime: 0,
    processedChatIds: /* @__PURE__ */ new Set(),
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
      if (now - this.lastRepliedTime < (CONFIG.CHAT_REPLY_COOLDOWN_MS || 7e3)) return false;
      const input = document.querySelector('input[placeholder*="say" i], input[placeholder*="something" i], input[placeholder*="chat" i], input[placeholder*="message" i], textarea');
      if (!input) return false;
      const chatContainer = input.closest('form, [class*="chat"], div')?.parentElement || document.body;
      const bubbles = chatContainer.querySelectorAll('[class*="message"], [class*="bubble"], div');
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const el = bubbles[i];
        const text = (el.innerText || "").trim();
        if (!text || text.length < 2 || text.length > 140) continue;
        if (text.includes("Say something") || text.includes("joined room") || text.includes("joined the game") || text.includes("Game started")) continue;
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const sender = lines[0];
          const msgText = lines.slice(1).join(" ").trim();
          if (GameMemory.isMe(sender) || !sender || sender.length > 20) continue;
          const msgId = `${sender}:${msgText}`;
          if (this.processedChatIds.has(msgId)) continue;
          this.processedChatIds.add(msgId);
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
      let message = (customText || "").trim();
      if (!message) {
        const list = this.TEMPLATES[category];
        if (!list || list.length === 0) return false;
        message = list[Math.floor(Math.random() * list.length)];
      }
      message = message.replace(/^(decline:|accept:|negotiate:|counter:)\s*/i, "").replace(/@[A-Za-z0-9_-]+\s*/g, "").replace(/[.!]+$/, "").toLowerCase().trim();
      const cooldown = CONFIG.CHAT_COOLDOWN_MS || 6e3;
      if (now - this.lastSentTime < cooldown) return false;
      if (this.lastSentText && message.toLowerCase() === this.lastSentText.toLowerCase() && now - this.lastSentTime < 25e3) {
        return false;
      }
      const input = document.querySelector('input[placeholder*="say" i], input[placeholder*="something" i], input[placeholder*="chat" i], input[placeholder*="message" i], textarea');
      if (!input) return false;
      this.lastSentTime = now;
      this.lastSentText = message;
      logToBot(`[CHAT SEND] "${message}"`);
      setTimeout(() => {
        try {
          input.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          if (nativeSetter) {
            nativeSetter.call(input, message);
          } else {
            input.value = message;
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          setTimeout(() => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            const sendBtn = input.parentElement?.querySelector("button");
            if (sendBtn) {
              try {
                sendBtn.click();
              } catch (_) {
              }
            }
          }, 90);
        } catch (err) {
          logToBot(`Chat error: ${err}`);
        }
      }, 320);
      return true;
    }
  };

  // src/engine/tradeProposalExecutor.js
  var TradeProposalExecutor = {
    isExecuting: false,
    lastProposedTimes: /* @__PURE__ */ new Map(),
    // playerName -> timestamp
    skippedSwaps: /* @__PURE__ */ new Map(),
    // summary -> timestamp
    canProposeToPlayer(playerName) {
      if (!playerName) return false;
      const lastTime = this.lastProposedTimes.get(playerName) || 0;
      return Date.now() - lastTime > 4e4;
    },
    isSwapSkipped(summary) {
      const lastSkipped = this.skippedSwaps.get(summary) || 0;
      return Date.now() - lastSkipped < 6e4;
    },
    recordSkipped(summary) {
      this.skippedSwaps.set(summary, Date.now());
    },
    async executeProposal(swap, onComplete) {
      if (this.isExecuting) return;
      this.isExecuting = true;
      logToBot(`[TRADE CREATOR] Starting automated proposal for ${swap.targetOwner}...`);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const safetyTimer = setTimeout(() => {
        if (this.isExecuting) {
          logToBot("[TRADE CREATOR] Safety timeout triggered. Closing modal and resetting lock.");
          this.closeTradeModal();
          this.isExecuting = false;
          if (onComplete) onComplete(false);
        }
      }, 12e3);
      try {
        const snap1 = createDOMSnapshot();
        const createBtn = snap1.findCreateTradeButton();
        if (!createBtn) {
          logToBot("[TRADE CREATOR] Could not find [+ Create] trade button.");
          return;
        }
        createBtn.click();
        await sleep(600);
        let playerBtn = null;
        for (let i = 0; i < 6; i++) {
          const snap2 = createDOMSnapshot();
          playerBtn = snap2.findPlayerSelectButton(swap.targetOwner);
          if (playerBtn) break;
          await sleep(350);
        }
        if (!playerBtn) {
          logToBot(`[TRADE CREATOR] Could not find player button for "${swap.targetOwner}".`);
          this.closeTradeModal();
          return;
        }
        playerBtn.click();
        await sleep(700);
        const tradeModal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
        if (tradeModal) {
          const modalRect = tradeModal.getBoundingClientRect();
          const modalCenter = modalRect.left + modalRect.width / 2;
          const modalCards = Array.from(tradeModal.querySelectorAll("button, div, li, span, p"));
          for (const card of modalCards) {
            const txt = (card.innerText || "").trim().toLowerCase();
            if (!txt || txt.length > 35) continue;
            const r = card.getBoundingClientRect();
            const isRight = r.left + r.width / 2 >= modalCenter;
            for (const t of BOARD_TILES) {
              if (t.group && (txt === t.name.toLowerCase() || txt.startsWith(t.name.toLowerCase()))) {
                if (GameMemory.ownership[t.id]) {
                  GameMemory.ownership[t.id].owner = isRight ? swap.targetOwner : GameMemory.myName || "__ME__";
                }
              }
            }
          }
        }
        const givenTiles = Array.isArray(swap.myGivenTiles) ? swap.myGivenTiles : swap.myGivenTile ? [swap.myGivenTile] : [];
        for (const tile of givenTiles) {
          const snap3 = createDOMSnapshot();
          const myPropCard = snap3.findTradePropertyCard(tile.name, "mine");
          if (myPropCard) {
            myPropCard.click();
            logToBot(`[TRADE CREATOR] Selected offer property: ${tile.name}`);
            await sleep(350);
          } else {
            logToBot(`[TRADE CREATOR] Could not find offer property: ${tile.name}`);
          }
        }
        const receivedTiles = Array.isArray(swap.myReceivedTiles) ? swap.myReceivedTiles : swap.myReceivedTile ? [swap.myReceivedTile] : [];
        let allRequestedFound = true;
        for (const tile of receivedTiles) {
          const snap4 = createDOMSnapshot();
          const theirPropCard = snap4.findTradePropertyCard(tile.name, "theirs");
          if (theirPropCard) {
            theirPropCard.click();
            logToBot(`[TRADE CREATOR] Selected request property: ${tile.name}`);
            if (GameMemory.ownership[tile.id]) GameMemory.ownership[tile.id].owner = swap.targetOwner;
            await sleep(350);
          } else {
            logToBot(`[TRADE CREATOR] ${swap.targetOwner} does not hold ${tile.name}. Closing modal.`);
            allRequestedFound = false;
            break;
          }
        }
        if (!allRequestedFound) {
          this.closeTradeModal();
          if (onComplete) onComplete(false);
          return;
        }
        this.adjustCashInTradeModal(swap);
        await sleep(400);
        const snap5 = createDOMSnapshot();
        const sendBtn = snap5.findSendTradeButton();
        if (sendBtn) {
          sendBtn.click();
          logToBot(`[TRADE CREATOR] Trade proposal sent to ${swap.targetOwner}!`);
          this.lastProposedTimes.set(swap.targetOwner, Date.now());
          this.lastSentProposal = {
            targetOwner: swap.targetOwner,
            givenTiles,
            receivedTiles,
            cashOffer: swap.cashOffer || 0,
            cashDemand: swap.cashDemand || 0,
            timestamp: Date.now()
          };
          if (CONFIG.CHAT_ENABLED && swap.pitch) {
            await sleep(400);
            ChatEngine.sendChatMessage("tradeOffer", swap.pitch);
          }
          if (onComplete) onComplete(true);
        } else {
          logToBot("[TRADE CREATOR] Could not find [Send trade] button.");
          this.closeTradeModal();
          if (onComplete) onComplete(false);
        }
      } catch (err) {
        logToBot(`[TRADE CREATOR Error] ${err}`);
        this.closeTradeModal();
        if (onComplete) onComplete(false);
      } finally {
        clearTimeout(safetyTimer);
        this.isExecuting = false;
      }
    },
    adjustCashInTradeModal(swap) {
      try {
        const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
        if (!modal) return;
        const modalRect = modal.getBoundingClientRect();
        const modalCenter = modalRect.left + modalRect.width / 2;
        const inputs = Array.from(modal.querySelectorAll('input[type="range"], input[type="number"], input'));
        let ourSlider = null;
        let theirSlider = null;
        for (const input of inputs) {
          const rect = input.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          if (center < modalCenter && !ourSlider) ourSlider = input;
          else if (center >= modalCenter && !theirSlider) theirSlider = input;
        }
        if (swap.cashOffer > 0 && ourSlider) {
          this.setReactInputValue(ourSlider, swap.cashOffer);
        }
        if (swap.cashDemand > 0 && theirSlider) {
          this.setReactInputValue(theirSlider, swap.cashDemand);
        }
        if (!ourSlider && !theirSlider) {
          const buttons = Array.from(modal.querySelectorAll('button, [role="button"], span, div')).filter((el) => {
            const t = (el.innerText || "").trim();
            return t === "+" || t === "+10" || t === "+$10" || t.includes("+") || t.includes("add");
          });
          for (const btn of buttons) {
            const rect = btn.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            if (swap.cashOffer > 0 && center < modalCenter) {
              const clicks = Math.min(10, Math.max(1, Math.round(swap.cashOffer / 20)));
              for (let c = 0; c < clicks; c++) {
                try {
                  btn.click();
                } catch (_) {
                }
              }
            } else if (swap.cashDemand > 0 && center >= modalCenter) {
              const clicks = Math.min(10, Math.max(1, Math.round(swap.cashDemand / 20)));
              for (let c = 0; c < clicks; c++) {
                try {
                  btn.click();
                } catch (_) {
                }
              }
            }
          }
        }
      } catch (err) {
        logToBot(`Cash adjust note: ${err}`);
      }
    },
    setReactInputValue(input, val) {
      try {
        const maxVal = input.max ? Number(input.max) : 99999;
        const minVal = input.min ? Number(input.min) : 0;
        const clamped = Math.max(minVal, Math.min(Number(val), maxVal));
        input.focus();
        const prev = input.value;
        input.value = String(clamped);
        if (input._valueTracker) {
          input._valueTracker.setValue(prev);
        }
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set || typeof unsafeWindow !== "undefined" && Object.getOwnPropertyDescriptor(
          unsafeWindow.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, String(clamped));
        }
        input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      } catch (_) {
      }
    },
    closeTradeModal() {
      try {
        const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
        if (!modal) return;
        const elements = Array.from(modal.querySelectorAll('button, [role="button"], span, div, svg'));
        const closeBtn = elements.find((b) => {
          const t = (b.innerText || "").trim().toLowerCase();
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          const title = (b.getAttribute("title") || "").toLowerCase();
          const cls = (b.className?.baseVal || b.className || "").toString().toLowerCase();
          return t === "\u2715" || t === "x" || t === "cancel" || t === "close" || aria.includes("close") || aria.includes("cancel") || title.includes("close") || title.includes("cancel") || cls.includes("close") || cls.includes("cancel");
        });
        if (closeBtn) {
          closeBtn.click();
        }
      } catch (_) {
      }
    }
  };

  // src/engine/houseBuilder.js
  var HouseBuilder = {
    /**
     * Checks if we are currently standing within 2 to 12 tiles of any opponent
     * property that has 3+ houses or a hotel.
     */
    isPlayerInEnemyHotelZone() {
      const myPos = GameMemory.myPos || 0;
      for (let roll = 2; roll <= 12; roll++) {
        const targetTileId = (myPos + roll) % 40;
        const tile = BOARD_TILES[targetTileId];
        if (!tile || !tile.group) continue;
        const info = GameMemory.ownership[targetTileId];
        if (info && !GameMemory.isMe(info.owner) && info.houses >= 3 && !info.mortgaged) {
          const rent = tile.rent[info.houses] || 0;
          if (rent > 250) {
            return { inDanger: true, tile, rent, distance: roll };
          }
        }
      }
      return { inDanger: false };
    },
    /**
     * Checks if any active opponent is currently 2 to 12 tiles away
     * from any tile in the given color group.
     */
    areOpponentsInStrikeZone(groupTiles) {
      const tileIds = new Set(groupTiles.map((t) => t.id));
      for (const [pName, pData] of Object.entries(GameMemory.players)) {
        if (GameMemory.isMe(pName) || pData.bankrupt || pData.inJail) continue;
        const oppPos = pData.pos || 0;
        for (const tileId of tileIds) {
          const dist = (tileId - oppPos + 40) % 40;
          if (dist >= 2 && dist <= 12) {
            return { oppApproaching: true, opponentName: pName, distance: dist };
          }
        }
      }
      return { oppApproaching: false };
    },
    rankHouseUpgrades(myCash) {
      const reserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
      const candidates = [];
      if (myCash <= reserve) return candidates;
      if (CONFIG.AMBUSH_BUILD_ONLY) {
        const dangerCheck = this.isPlayerInEnemyHotelZone();
        if (dangerCheck.inDanger) {
          return candidates;
        }
      }
      for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
        if (tiles[0].type !== "property") continue;
        const { owned, total } = GameMemory.getGroupCount(groupName, "__ME__");
        if (owned !== total) continue;
        const anyMortgaged = tiles.some((t) => GameMemory.ownership[t.id]?.mortgaged);
        if (anyMortgaged) continue;
        const houseCounts = tiles.map((t) => GameMemory.ownership[t.id]?.houses || 0);
        const minHouses = Math.min(...houseCounts);
        const strikeCheck = this.areOpponentsInStrikeZone(tiles);
        const isAmbushWindow = strikeCheck.oppApproaching;
        const isRushingTo3Houses = minHouses < 3;
        const hasSufficientSurplus = isRushingTo3Houses ? myCash >= reserve + tiles[0].houseCost * 1.2 : myCash >= reserve + 300;
        if (CONFIG.AMBUSH_BUILD_ONLY && !isAmbushWindow && !hasSufficientSurplus) {
          continue;
        }
        for (const tile of tiles) {
          const info = GameMemory.ownership[tile.id];
          if (!info || info.houses >= 5) continue;
          if (info.houses > minHouses) continue;
          const cost = tile.houseCost;
          if (myCash - cost < reserve) continue;
          const currentRent = tile.rent[info.houses];
          const nextRent = tile.rent[info.houses + 1] || currentRent;
          const rentDelta = nextRent - currentRent;
          const sweetSpotBoost = info.houses === 2 ? 2.6 : info.houses === 1 ? 1.5 : 1;
          const ambushBoost = isAmbushWindow ? 1.8 : 1;
          const roi = (rentDelta / cost * tile.markov * sweetSpotBoost * ambushBoost).toFixed(4);
          candidates.push({
            tile,
            currentHouses: info.houses,
            nextHouses: info.houses + 1,
            cost,
            rentDelta,
            roi: parseFloat(roi),
            isAmbush: isAmbushWindow,
            targetOpp: strikeCheck.opponentName || null
          });
        }
      }
      candidates.sort((a, b) => b.roi - a.roi);
      return candidates;
    }
  };

  // src/engine/debtRecovery.js
  var DebtRecovery = {
    rankLiquidationTargets() {
      const targets = [];
      const blockers = new Set(OpponentTracker.getCriticalBlockers().map((b) => b.tile.id));
      const groupMaxHouses = {};
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner)) {
          groupMaxHouses[tile.group] = Math.max(groupMaxHouses[tile.group] || 0, info.houses || 0);
        }
      }
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (!info || !GameMemory.isMe(info.owner) || info.mortgaged) continue;
        const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
        const groupMax = groupMaxHouses[tile.group] || 0;
        const canSellHouse = info.houses > 0 && info.houses === groupMax;
        const canMortgage = info.houses === 0 && groupMax === 0;
        if (!canSellHouse && !canMortgage) continue;
        let sacrificeScore = tile.price * (1 + tile.markov * 10);
        if (owned === total) {
          sacrificeScore *= 10;
        } else if (owned === total - 1) {
          sacrificeScore *= 4;
        }
        if (blockers.has(tile.id)) {
          sacrificeScore *= 5;
        }
        if (canSellHouse) {
          sacrificeScore = Math.min(sacrificeScore, 280 + tile.houseCost * 0.5);
        }
        const mortgageValue = Math.round(tile.price / 2);
        const houseSellValue = Math.round(tile.houseCost / 2);
        targets.push({
          tile,
          houses: info.houses,
          canSellHouse,
          canMortgage,
          mortgageValue,
          houseSellValue,
          sacrificeScore
        });
      }
      targets.sort((a, b) => a.sacrificeScore - b.sacrificeScore);
      return targets;
    },
    /**
     * Finds safe, dead-weight properties that can be strategically mortgaged
     * to raise immediate cash for high-yield monopoly building.
     */
    findStrategicMortgageCandidates() {
      const targets = this.rankLiquidationTargets();
      return targets.filter((t) => t.houses === 0 && t.sacrificeScore < 300);
    },
    /**
     * Identifies mortgaged properties owned by local player that can be
     * safely unmortgaged when cash is surplus.
     */
    rankUnmortgageCandidates(myCash, reserve) {
      const candidates = [];
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (!info || !GameMemory.isMe(info.owner) || !info.mortgaged) continue;
        const unmortgageCost = Math.round(tile.price * 0.55);
        if (myCash - unmortgageCost < reserve + 120) continue;
        const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
        let priority = tile.price * (1 + tile.markov * 8);
        if (owned === total) {
          priority *= 12;
        } else if (owned === total - 1) {
          priority *= 4;
        } else if (tile.type === "airport") {
          priority *= 3;
        }
        candidates.push({
          tile,
          unmortgageCost,
          priority
        });
      }
      candidates.sort((a, b) => b.priority - a.priority);
      return candidates;
    }
  };

  // src/dom/boardScanner.js
  function parseColor(str) {
    if (!str || typeof str !== "string") return null;
    str = str.trim().toLowerCase();
    if (str === "transparent" || str === "inherit" || str === "none") return null;
    const rgbMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i.exec(str);
    if (rgbMatch) {
      const a = rgbMatch[4] !== void 0 ? parseFloat(rgbMatch[4]) : 1;
      if (a < 0.15) return null;
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
        a
      };
    }
    const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(str);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split("").map((c) => c + c).join("");
      }
      if (hex.length >= 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
        };
      }
    }
    return null;
  }
  function isVibrantPlayerColor(c) {
    if (!c) return false;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const delta = max - min;
    if (max < 40) return false;
    if (min > 225 && delta < 25) return false;
    if (delta < 25) return false;
    return true;
  }
  function colorDistance(c1, c2) {
    if (!c1 || !c2) return Infinity;
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
  }
  function syncBoardStateFromDOM() {
    if (!document.body) return;
    if (GameMemory.checkRoomTransition()) {
      logToBot(`[ROOM SWITCH] Joined room '${GameMemory.currentRoomId || "Lobby/Menu"}'. Cleared previous game state.`);
    }
    const hud = document.getElementById("rubot-hud-panel");
    const pageText = document.body.innerText || "";
    const hasCashOnScreen = /\$\s*\d+|\d+\s*\$/.test(pageText);
    const hasGameElements = Boolean(
      hasCashOnScreen || document.querySelector('[class*="board" i], [class*="tile" i], [class*="dice" i]') || Array.from(document.querySelectorAll('button, [role="button"]')).some((b) => {
        if (hud && hud.contains(b)) return false;
        const t = (b.innerText || "").trim().toLowerCase();
        return t.includes("roll") || t.includes("end turn") || t.includes("bankrupt") || t.includes("create") || t.includes("trades");
      }) || /roll.*dice|end turn|is playing|bankrupt|my properties|trades/i.test(pageText)
    );
    if (!hasGameElements && !hasCashOnScreen && GameMemory.turnCount === 0) {
      const isLobby = Boolean(
        Array.from(document.querySelectorAll('button, [role="button"]')).some((el) => {
          if (hud && hud.contains(el)) return false;
          const t = (el.innerText || "").trim().toLowerCase();
          return t === "ready up" || t === "join game" || t === "change color" || t === "start game";
        })
      );
      if (isLobby) {
        syncLobbyStateAndPlayers();
      }
      return;
    }
    try {
      detectLocalPlayerFromPlayerList();
    } catch (e) {
      logToBot(`[Scoreboard Sync Err] ${e}`);
    }
    try {
      syncMyPropertiesFromSidebar();
    } catch (e) {
      logToBot(`[Sidebar Sync Err] ${e}`);
    }
    try {
      syncBoardTileOwnershipAndPricesFromDOM();
    } catch (e) {
      logToBot(`[Board Tiles Sync Err] ${e}`);
    }
    try {
      syncPropertyCardModalFromDOM();
    } catch (e) {
      logToBot(`[Card Modal Sync Err] ${e}`);
    }
    try {
      syncTradeModalInventoriesFromDOM();
    } catch (e) {
      logToBot(`[Trade Modal Sync Err] ${e}`);
    }
    try {
      scanPlayerTokenPositionsFromDOM();
    } catch (e) {
      logToBot(`[Token Scraper Err] ${e}`);
    }
    try {
      scanActivityLogsOnly();
    } catch (e) {
      logToBot(`[Activity Log Err] ${e}`);
    }
  }
  function syncLobbyStateAndPlayers() {
    const pageText = document.body ? document.body.innerText : "";
    const hasCashBalances = /\$\s*\d+|\d+\s*\$/.test(pageText);
    const hasActiveTurnControls = Boolean(
      document.querySelector('[class*="board" i], [class*="tile" i], [class*="dice" i]') || Array.from(document.querySelectorAll('button, [role="button"]')).some((b) => {
        const t = (b.innerText || "").trim().toLowerCase();
        return t.includes("roll") || t.includes("end turn") || t.includes("bankrupt") || t.includes("trades");
      })
    );
    if (GameMemory.turnCount > 0 || hasCashBalances || hasActiveTurnControls) {
      return;
    }
    const hud = document.getElementById("rubot-hud-panel");
    for (const tileId of Object.keys(GameMemory.ownership)) {
      if (GameMemory.ownership[tileId]?.owner) {
        GameMemory.ownership[tileId].owner = null;
        GameMemory.ownership[tileId].houses = 0;
        GameMemory.ownership[tileId].mortgaged = false;
      }
    }
    GameMemory.myPos = 0;
    GameMemory.inJail = false;
    GameMemory.isMyTurn = false;
    GameMemory.turnCount = 0;
    const startingCashRow = Array.from(document.querySelectorAll("div, li, p, section, tr")).find((el) => {
      if (hud && hud.contains(el)) return false;
      const t = (el.innerText || "").toLowerCase();
      return t.includes("starting cash") && (t.includes("adjust how much money") || t.includes("$"));
    });
    let detectedStartCash = null;
    if (startingCashRow) {
      const trigger = startingCashRow.querySelector('button, [role="button"], [class*="select" i], [class*="dropdown" i]');
      const targetText = trigger ? trigger.innerText : startingCashRow.innerText;
      const cashMatch = /\$\s*(\d{2,5})|(\d{2,5})\s*\$/.exec(targetText);
      if (cashMatch) {
        detectedStartCash = parseInt(cashMatch[1] || cashMatch[2], 10);
      }
    }
    if (!detectedStartCash) {
      const fallbackMatch = /Starting cash[\s\S]*?\$(\d{2,5})/i.exec(pageText);
      if (fallbackMatch) {
        detectedStartCash = parseInt(fallbackMatch[1], 10);
      }
    }
    if (detectedStartCash && !isNaN(detectedStartCash) && detectedStartCash >= 100 && detectedStartCash <= 1e4) {
      GameMemory.roomSettings.startingCash = detectedStartCash;
    }
    const startCash = GameMemory.roomSettings.startingCash || 1500;
    GameMemory.myCash = startCash;
    try {
      const candidateRows = Array.from(document.querySelectorAll("div, li, p, section, tr")).filter((el) => {
        if (hud && hud.contains(el)) return false;
        const text = (el.innerText || "").toLowerCase();
        return text.includes("don't collect rent while in prison") || text.includes("x2 rent on full-set") || text.includes("vacation cash") || text.includes("even build") || text.includes("auction") && text.includes("skips purchasing");
      });
      for (const row of candidateRows) {
        const text = (row.innerText || "").toLowerCase();
        const toggle = row.querySelector('input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]');
        if (!toggle) continue;
        let isChecked = false;
        if (toggle.tagName === "INPUT") {
          isChecked = toggle.checked;
        } else if (toggle.getAttribute("aria-checked") != null) {
          isChecked = toggle.getAttribute("aria-checked") === "true";
        } else {
          const cls = (toggle.className || "").toLowerCase();
          isChecked = cls.includes("active") || cls.includes("checked") || cls.includes("on") || cls.includes("enabled");
        }
        if (text.includes("don't collect rent while in prison")) {
          GameMemory.roomSettings.collectRentInJail = !isChecked;
        } else if (text.includes("auction") && text.includes("skips purchasing")) {
          GameMemory.roomSettings.auctionsEnabled = isChecked;
        } else if (text.includes("x2 rent on full-set")) {
          GameMemory.roomSettings.doubleRentOnFullSet = isChecked;
        } else if (text.includes("even build")) {
          GameMemory.roomSettings.evenBuild = isChecked;
        }
      }
    } catch (_) {
    }
    const changeApp = Array.from(document.querySelectorAll("button, a, div, span")).find((b) => {
      if (hud && hud.contains(b)) return false;
      return (b.innerText || "").trim().toLowerCase() === "change appearance";
    });
    let playerRows = [];
    if (changeApp) {
      let parent = changeApp.parentElement;
      for (let depth = 0; depth < 5 && parent && parent !== document.body; depth++) {
        const children = Array.from(parent.children).filter((c) => {
          if (c.contains(changeApp)) return true;
          const t = (c.innerText || "").trim().toLowerCase();
          return t.length > 0 && !t.includes("game settings") && !t.includes("maximum players") && !t.includes("chat");
        });
        const pText = (parent.innerText || "").toLowerCase();
        if (children.length >= 2 || children.length >= 1 && (pText.includes("host") || children[0].contains(changeApp))) {
          playerRows = children;
          break;
        }
        parent = parent.parentElement;
      }
    }
    if (playerRows.length === 0) {
      const candidateContainers = document.querySelectorAll("div, ul, section");
      for (const c of candidateContainers) {
        if (hud && hud.contains(c)) continue;
        const rect = c.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.55 || rect.top > window.innerHeight * 0.45) continue;
        if (rect.width < 90 || rect.height < 35 || rect.height > 350) continue;
        const txt = (c.innerText || "").toLowerCase();
        if (txt.includes("game settings") || txt.includes("maximum players")) continue;
        if (txt.includes("host") || txt.includes("change appearance")) {
          const kids = Array.from(c.children).filter((k) => {
            const kt = (k.innerText || "").trim().toLowerCase();
            return kt.length > 0 && !kt.includes("game settings");
          });
          if (kids.length >= 1 && kids.length <= 8) {
            playerRows = kids;
            break;
          }
        }
      }
    }
    const currentLobbyPlayers = /* @__PURE__ */ new Set();
    for (const row of playerRows) {
      const rawText = row.innerText || "";
      if (rawText.toLowerCase().includes("game settings")) continue;
      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
      let detectedName = null;
      for (const line of lines) {
        const clean = line.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/change appearance/gi, "").replace(/\bhost\b/gi, "").replace(/[->\]\[→←\|👑]/g, "").trim();
        if (clean.length >= 2 && clean.length <= 24 && !BOARD_LABELS_BLACKLIST.has(clean.toLowerCase()) && !clean.toLowerCase().includes("rules") && !clean.toLowerCase().includes("settings") && !clean.toLowerCase().includes("players")) {
          detectedName = clean;
          break;
        }
      }
      if (!detectedName) continue;
      currentLobbyPlayers.add(detectedName);
      const isMeRow = rawText.toLowerCase().includes("change appearance") || GameMemory.myName && detectedName.toLowerCase() === GameMemory.myName.toLowerCase();
      if (isMeRow) {
        GameMemory.setMyName(detectedName);
        GameMemory.players[detectedName] = {
          cash: startCash,
          pos: 0,
          isMe: true,
          bankrupt: false
        };
      } else {
        GameMemory.players[detectedName] = {
          cash: startCash,
          pos: 0,
          isMe: false,
          bankrupt: false
        };
      }
    }
    if (!GameMemory.myName) {
      try {
        const saved = localStorage.getItem("richup_bot_my_name");
        if (saved && !BOARD_LABELS_BLACKLIST.has(saved.toLowerCase())) {
          GameMemory.setMyName(saved);
          if (!GameMemory.players[saved]) {
            GameMemory.players[saved] = { cash: startCash, pos: 0, isMe: true, bankrupt: false };
          }
        }
      } catch (_) {
      }
    }
    if (currentLobbyPlayers.size > 0) {
      for (const existingName of Object.keys(GameMemory.players)) {
        if (GameMemory.isMe(existingName)) continue;
        if (!currentLobbyPlayers.has(existingName)) {
          logToBot(`[LOBBY PRUNE] Removed stale opponent '${existingName}' from previous match.`);
          delete GameMemory.players[existingName];
        }
      }
    } else {
      for (const existingName of Object.keys(GameMemory.players)) {
        if (!GameMemory.isMe(existingName)) {
          delete GameMemory.players[existingName];
        }
      }
    }
  }
  function detectLocalPlayerFromPlayerList() {
    const hud = document.getElementById("rubot-hud-panel");
    const hasJailUI = Boolean(
      Array.from(document.querySelectorAll('button, [role="button"], div, span')).some((b) => {
        if (hud && hud.contains(b)) return false;
        const t = (b.innerText || "").toLowerCase();
        return t.includes("get free for") || t.includes("pay $50") || t.includes("pardon card");
      })
    );
    if (hasJailUI) {
      GameMemory.myPos = 10;
      GameMemory.inJail = true;
    }
    if (GameMemory.myName && (GameMemory.myName.toLowerCase().includes("share") || GameMemory.myName.toLowerCase().includes("copy") || BOARD_LABELS_BLACKLIST.has(GameMemory.myName.toLowerCase()))) {
      GameMemory.myName = null;
      try {
        localStorage.removeItem("richup_bot_my_name");
      } catch (_) {
      }
    }
    if (!GameMemory.myName) {
      const rollOrEndBtn = Array.from(document.querySelectorAll('button, [role="button"]')).some((b) => {
        const t = (b.innerText || "").trim().toLowerCase();
        return t === "roll the dice" || t === "roll again" || t === "end turn";
      });
      if (rollOrEndBtn) {
        const pText = document.body ? document.body.innerText : "";
        const playingMatch = /([a-zA-Z0-9_-]{2,24})\s+is playing/i.exec(pText);
        if (playingMatch && !BOARD_LABELS_BLACKLIST.has(playingMatch[1].toLowerCase())) {
          GameMemory.setMyName(playingMatch[1]);
          logToBot(`[IDENTITY SELF-HEAL] Identified local player '${playingMatch[1]}' from active turn state!`);
        }
      }
    }
    if (!GameMemory.myName) {
      try {
        const saved = localStorage.getItem("richup_bot_my_name");
        if (saved && !BOARD_LABELS_BLACKLIST.has(saved.toLowerCase())) {
          GameMemory.setMyName(saved);
        }
      } catch (_) {
      }
    }
    const currentName = GameMemory.myName;
    const directCards = Array.from(document.querySelectorAll("div, section, li, tr, button")).filter((el) => {
      if (hud && hud.contains(el)) return false;
      if (el.closest('[class*="chat" i], [class*="modal" i], [role="dialog"]')) return false;
      const rect = el.getBoundingClientRect();
      if (rect.left < window.innerWidth * 0.48) return false;
      if (rect.top > window.innerHeight * 0.65) return false;
      if (rect.height < 18 || rect.height > 95 || rect.width < 90) return false;
      const text = (el.innerText || "").trim();
      if (text.length > 120 || text.length < 2) return false;
      if (/my properties|trades\b|create|bankrupt button|dice|rules/i.test(text)) return false;
      const hasCashOrBankrupt = /\$|\b(?:bankrupt)\b/i.test(text);
      if (!hasCashOrBankrupt) return false;
      const innerWithDollar = Array.from(el.children).filter((c) => (c.innerText || "").includes("$"));
      return innerWithDollar.length <= 1;
    });
    let rows = directCards;
    if (rows.length === 0) {
      const allContainers = document.querySelectorAll("div, section, aside, ul");
      for (let i = 0; i < allContainers.length; i++) {
        const el = allContainers[i];
        if (hud && hud.contains(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.45 || rect.top > window.innerHeight * 0.65) continue;
        const kids = Array.from(el.children).filter((k) => (k.innerText || "").includes("$") || /bankrupt/i.test(k.innerText || ""));
        if (kids.length >= 2 && kids.length <= 8) {
          rows = kids;
          break;
        }
      }
    }
    let foundLocalPlayerInScoreboard = false;
    const activeScoreboardPlayers = /* @__PURE__ */ new Set();
    if (rows.length > 0) {
      for (const row of rows) {
        const rowText = row.innerText || "";
        if (!rowText.includes("$") || rowText.length > 160) continue;
        if (/\b(?:paid|bought|buy|buying|rolled|landed|rent|tax|joined|left|game started|is playing)\b/i.test(rowText)) continue;
        const normalizedRow = rowText.replace(/[−–—]/g, "-");
        const negCashMatch = /(?:-\s*\$\s*(\d{1,6})|\$\s*-\s*(\d{1,6}))/.exec(normalizedRow);
        let parsedCash;
        let cashToken = "";
        if (negCashMatch) {
          parsedCash = -parseInt(negCashMatch[1] || negCashMatch[2], 10);
          cashToken = negCashMatch[0];
        } else {
          const posCashMatch = /(?:\$\s*(\d{1,6})|(\d{1,6})\s*\$)/.exec(normalizedRow);
          if (!posCashMatch) continue;
          parsedCash = parseInt(posCashMatch[1] || posCashMatch[2], 10);
          cashToken = posCashMatch[0];
        }
        if (isNaN(parsedCash)) continue;
        let textWithoutCash = normalizedRow.replace(cashToken, " ");
        textWithoutCash = textWithoutCash.replace(/[+-]\s*\$?\s*\d+/g, " ");
        const candidateLines = textWithoutCash.split("\n").map((l) => l.trim()).filter(Boolean);
        let candidateName = null;
        for (const line of candidateLines) {
          const clean = line.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[->\]\[→←\|👑:]/g, "").replace(/\b-?\d+\b/g, "").trim();
          const lower = clean.toLowerCase();
          if (clean.length >= 2 && clean.length <= 24 && !BOARD_LABELS_BLACKLIST.has(lower) && !lower.startsWith("buy") && !lower.startsWith("pay") && !lower.startsWith("bid") && !lower.includes("share") && !lower.includes("copy")) {
            candidateName = clean;
            break;
          }
        }
        if (!candidateName) continue;
        activeScoreboardPlayers.add(candidateName);
        const innerHtml = (row.innerHTML || "").toString();
        const hasLeaveIcon = Boolean(
          row.querySelector('[class*="leave" i], [class*="exit" i], [title*="leave" i], [aria-label*="leave" i], button[aria-label*="leave" i]') || innerHtml.includes("->") || innerHtml.includes("M17 16l4") || innerHtml.includes("M11 16l-4-4") || innerHtml.includes("M15 3h4a2") || innerHtml.includes("M9 21H5a2") || innerHtml.includes("M16 17l5-5-5-5") || innerHtml.includes("logout")
        );
        const isKnownMe = currentName && candidateName.toLowerCase() === currentName.toLowerCase() || GameMemory.myName && candidateName.toLowerCase() === GameMemory.myName.toLowerCase();
        const isBankrupt = rowText.toLowerCase().includes("bankrupt") || row.classList.contains("bankrupt");
        const avEl = row.querySelector('svg, img, [class*="avatar" i], [class*="face" i], [class*="token" i], [class*="user" i], div[style*="border-radius"], div[style*="background"]');
        let playerColor = null;
        let playerFill = null;
        if (avEl) {
          const style = window.getComputedStyle(avEl);
          let parsed = parseColor(style.backgroundColor);
          if (!parsed || !isVibrantPlayerColor(parsed)) {
            const svgShape = avEl.querySelector('path[fill]:not([fill="none"]):not([fill="#fff"]):not([fill="#ffffff"]), circle[fill]:not([fill="none"]), rect[fill]:not([fill="none"])') || (avEl.tagName.toLowerCase() === "svg" ? avEl : null);
            if (svgShape) {
              const fillVal = svgShape.getAttribute("fill") || window.getComputedStyle(svgShape).fill;
              parsed = parseColor(fillVal);
              if (parsed && isVibrantPlayerColor(parsed)) playerFill = fillVal;
            }
          }
          if (!parsed || !isVibrantPlayerColor(parsed)) {
            parsed = parseColor(style.color);
          }
          if (parsed && isVibrantPlayerColor(parsed)) {
            playerColor = parsed;
          }
        }
        if (!playerColor) {
          const innerShapes = Array.from(row.querySelectorAll("svg, path, circle, rect, div, span, img"));
          for (const shape of innerShapes) {
            const sStyle = window.getComputedStyle(shape);
            let p = parseColor(sStyle.backgroundColor);
            if (p && isVibrantPlayerColor(p)) {
              playerColor = p;
              break;
            }
            const fillAttr = shape.getAttribute ? shape.getAttribute("fill") : null;
            if (fillAttr) {
              let pf = parseColor(fillAttr);
              if (pf && isVibrantPlayerColor(pf)) {
                playerColor = pf;
                playerFill = fillAttr;
                break;
              }
            }
            if (sStyle.fill) {
              let pf = parseColor(sStyle.fill);
              if (pf && isVibrantPlayerColor(pf)) {
                playerColor = pf;
                playerFill = sStyle.fill;
                break;
              }
            }
          }
        }
        const existingColor = GameMemory.players[candidateName]?.color || null;
        const existingFill = GameMemory.players[candidateName]?.fill || null;
        const finalColor = playerColor || existingColor;
        const finalFill = playerFill || existingFill;
        if (hasLeaveIcon || isKnownMe) {
          foundLocalPlayerInScoreboard = true;
          GameMemory.setMyName(candidateName);
          GameMemory.myCash = parsedCash;
          GameMemory.cashVerified = true;
          GameMemory.isNegativeDebt = parsedCash < 0;
          GameMemory.players[candidateName] = {
            cash: parsedCash,
            pos: GameMemory.myPos,
            isMe: true,
            bankrupt: isBankrupt,
            color: finalColor,
            fill: finalFill
          };
        } else {
          GameMemory.players[candidateName] = {
            cash: parsedCash,
            pos: GameMemory.players[candidateName]?.pos || 0,
            isMe: false,
            bankrupt: isBankrupt,
            color: finalColor,
            fill: finalFill
          };
        }
      }
      if (!foundLocalPlayerInScoreboard && GameMemory.myName && GameMemory.players[GameMemory.myName]) {
        const sbCash = GameMemory.players[GameMemory.myName].cash;
        if (typeof sbCash === "number") {
          GameMemory.myCash = sbCash;
          GameMemory.cashVerified = true;
          GameMemory.isNegativeDebt = sbCash < 0;
          foundLocalPlayerInScoreboard = true;
        }
      }
      if (activeScoreboardPlayers.size >= 2) {
        for (const pName of Object.keys(GameMemory.players)) {
          if (!activeScoreboardPlayers.has(pName) && !GameMemory.isMe(pName)) {
            delete GameMemory.players[pName];
          }
        }
      }
    }
  }
  function syncBoardTileOwnershipAndPricesFromDOM() {
    const hud = document.getElementById("rubot-hud-panel");
    const boardEl = document.querySelector('[class*="board" i], main, section') || document.body;
    if (!boardEl) return;
    const boardRect = boardEl.getBoundingClientRect();
    if (boardRect.width < 150 || boardRect.height < 150) return;
    const activePlayersWithColors = [];
    for (const [pName, pData] of Object.entries(GameMemory.players)) {
      if (pData && pData.color && !pData.bankrupt) {
        activePlayersWithColors.push({
          name: pName,
          isMe: GameMemory.isMe(pName),
          color: pData.color
        });
      }
    }
    const candidateEls = Array.from(boardEl.querySelectorAll('div, [class*="tile" i], [class*="cell" i], [class*="block" i]')).filter((el) => {
      if (hud && hud.contains(el)) return false;
      if (el.closest('[class*="chat" i], [class*="scoreboard" i], [class*="modal" i], [class*="sidebar" i]')) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 25 && r.width <= 190 && r.height >= 25 && r.height <= 190;
    });
    const tileElements = /* @__PURE__ */ new Map();
    for (const tile of BOARD_TILES) {
      if (!tile.group) continue;
      const nameRegex = new RegExp(`\\b${tile.name}\\b`, "i");
      let bestEl = null;
      let smallestArea = Infinity;
      for (const el of candidateEls) {
        const text = (el.innerText || "").trim();
        if (text.length > 70) continue;
        if (nameRegex.test(text)) {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area < smallestArea) {
            smallestArea = area;
            bestEl = el;
          }
        }
      }
      if (bestEl) {
        tileElements.set(tile.id, bestEl);
      }
    }
    for (const [tileId, tileEl] of tileElements.entries()) {
      const tile = BOARD_TILES[tileId];
      if (!tile) continue;
      const text = (tileEl.innerText || "").trim();
      const priceMatch = /(?:^|[^\d])(\d{2,4})\s*\$|\$\s*(\d{2,4})/.exec(text);
      let tileHasPriceTag = false;
      if (priceMatch) {
        const p = parseInt(priceMatch[1] || priceMatch[2], 10);
        if (!isNaN(p) && p >= 50 && p <= 500) {
          tile.price = p;
          tileHasPriceTag = true;
        }
      }
      let houseCount = 0;
      const houseMatch = /(?:🏠\s*x?\s*|x\s*)(\d)/i.exec(text);
      if (houseMatch) {
        houseCount = Math.min(5, parseInt(houseMatch[1], 10));
      } else if (/hotel|🏨/i.test(text)) {
        houseCount = 5;
      } else {
        const houseSvg = tileEl.querySelector?.('svg[class*="house" i], [class*="house" i], [class*="hotel" i]');
        if (houseSvg) houseCount = 1;
      }
      const tileCls = (tileEl.className?.baseVal !== void 0 ? tileEl.className.baseVal : tileEl.className || "").toString().toLowerCase();
      const tileStyle = window.getComputedStyle(tileEl);
      const isMortgagedTile = /mortgaged/i.test(text) || tileCls.includes("mortgage") || Boolean(tileEl.querySelector?.('[class*="mortgage" i]')) || tileStyle.opacity && parseFloat(tileStyle.opacity) < 0.65;
      if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner)) {
        if (houseCount > 0) GameMemory.ownership[tileId].houses = houseCount;
        if (isMortgagedTile) GameMemory.ownership[tileId].mortgaged = true;
        continue;
      }
      const childEls = Array.from(tileEl.querySelectorAll('div, span, [class*="owner" i], [class*="bar" i], [class*="ribbon" i], [class*="strip" i], [class*="cell" i]'));
      childEls.push(tileEl);
      const colorMatches = [];
      for (const child of childEls) {
        const style = window.getComputedStyle(child);
        const bgParsed = parseColor(style.backgroundColor);
        const fillParsed = parseColor(style.fill) || (child.getAttribute ? parseColor(child.getAttribute("fill")) : null);
        const colParsed = parseColor(style.color);
        const testColors = [bgParsed, fillParsed, colParsed].filter(Boolean);
        for (const c of testColors) {
          if (!isVibrantPlayerColor(c)) continue;
          for (const p of activePlayersWithColors) {
            const dist = colorDistance(c, p.color);
            if (dist < 42) {
              colorMatches.push({
                player: p.name,
                dist,
                isMe: p.isMe
              });
            }
          }
        }
      }
      if (colorMatches.length > 0) {
        colorMatches.sort((a, b) => a.dist - b.dist);
        const best = colorMatches[0];
        if (best.isMe) {
          GameMemory.ownership[tileId].owner = GameMemory.myName || "__ME__";
        } else {
          GameMemory.ownership[tileId].owner = best.player;
        }
        GameMemory.ownership[tileId].houses = houseCount;
        GameMemory.ownership[tileId].mortgaged = Boolean(isMortgagedTile);
      } else if (tileHasPriceTag && houseCount === 0) {
        GameMemory.ownership[tileId].owner = null;
        GameMemory.ownership[tileId].houses = 0;
        GameMemory.ownership[tileId].mortgaged = false;
      }
    }
    const bodyText = document.body ? document.body.innerText : "";
    if (bodyText.includes("negative amount of money") || bodyText.includes("Sell properties or trade")) {
      GameMemory.isNegativeDebt = true;
      if (GameMemory.myCash >= 0) {
        GameMemory.myCash = -50;
      }
    } else {
      GameMemory.isNegativeDebt = GameMemory.myCash < 0;
    }
  }
  function scanPlayerTokenPositionsFromDOM() {
    const hud = document.getElementById("rubot-hud-panel");
    if (!document.body) return;
    const boardEl = document.querySelector('[class*="board" i], main, section') || document.body;
    const boardRect = boardEl.getBoundingClientRect();
    if (boardRect.width < 200 || boardRect.height < 200) return;
    const tileRects = /* @__PURE__ */ new Map();
    const allEls = boardEl.querySelectorAll('div, [class*="tile" i], [class*="cell" i]');
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      if (hud && hud.contains(el)) continue;
      const text = (el.innerText || "").trim();
      if (text.length > 80) continue;
      for (const tile of BOARD_TILES) {
        if (tileRects.has(tile.id)) continue;
        let match = false;
        if (tile.id === 0 && /^start/i.test(text)) match = true;
        else if (tile.id === 10 && (/in prison/i.test(text) || /passing by/i.test(text))) match = true;
        else if (tile.id === 20 && /vacation/i.test(text)) match = true;
        else if (tile.id === 30 && /go to prison/i.test(text)) match = true;
        else if (tile.name && new RegExp(`\\b${tile.name}\\b`, "i").test(text)) match = true;
        if (match) {
          const r = el.getBoundingClientRect();
          if (r.width >= 25 && r.height >= 25) {
            tileRects.set(tile.id, {
              id: tile.id,
              name: tile.name,
              el,
              rect: r,
              cx: r.left + r.width / 2,
              cy: r.top + r.height / 2
            });
          }
        }
      }
    }
    const playerAvatars = [];
    const playerEntries = Object.keys(GameMemory.players);
    for (const pName of playerEntries) {
      const rows = Array.from(document.querySelectorAll("div, section, li, tr")).filter((el) => {
        if (hud && hud.contains(el)) return false;
        const t = el.innerText || "";
        return t.includes(pName) && t.includes("$") && t.length < 150;
      });
      const pRow = rows.find((r) => r.children.length >= 2) || rows[0];
      if (!pRow) continue;
      const avEl = pRow.querySelector('svg, img, [class*="avatar" i], [class*="face" i], [class*="token" i], div[style*="border-radius"]');
      let color = "";
      let fill = "";
      let src = "";
      let classSnippet = "";
      if (avEl) {
        const style = window.getComputedStyle(avEl);
        color = style.backgroundColor || style.color || "";
        classSnippet = (avEl.className || "").toString();
        if (avEl.tagName.toLowerCase() === "img") {
          src = avEl.src || avEl.getAttribute("data-src") || "";
        }
        const coloredShape = avEl.querySelector('path[fill]:not([fill="none"]):not([fill="#fff"]):not([fill="#ffffff"]), circle[fill]:not([fill="none"]), rect[fill]:not([fill="none"])') || (avEl.tagName.toLowerCase() === "svg" ? avEl : avEl.querySelector("svg, circle, path"));
        if (coloredShape) {
          fill = coloredShape.getAttribute("fill") || window.getComputedStyle(coloredShape).fill || "";
        }
      }
      playerAvatars.push({
        name: pName,
        isMe: GameMemory.isMe(pName),
        color,
        fill,
        src,
        classSnippet
      });
    }
    const candidates = Array.from(boardEl.querySelectorAll("svg, img, div, span")).filter((el) => {
      if (hud && hud.contains(el)) return false;
      if (el.closest('[class*="chat" i], [class*="scoreboard" i], [class*="modal" i]')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 18 || r.width > 65 || r.height < 18 || r.height > 65) return false;
      if (r.left < boardRect.left || r.right > boardRect.right || r.top < boardRect.top || r.bottom > boardRect.bottom) return false;
      const style = window.getComputedStyle(el);
      const isRound = style.borderRadius && (parseInt(style.borderRadius) >= 10 || style.borderRadius.includes("%"));
      const isSvg = el.tagName.toLowerCase() === "svg";
      const isImg = el.tagName.toLowerCase() === "img";
      const clsName = (el.className?.baseVal !== void 0 ? el.className.baseVal : el.className || "").toString().toLowerCase();
      const hasAvatarClass = clsName.includes("avatar") || clsName.includes("token");
      return isRound || isSvg || isImg || hasAvatarClass;
    });
    for (const tokenEl of candidates) {
      const tr = tokenEl.getBoundingClientRect();
      const tcx = tr.left + tr.width / 2;
      const tcy = tr.top + tr.height / 2;
      const style = window.getComputedStyle(tokenEl);
      const tColor = style.backgroundColor || style.color || "";
      const tSrc = tokenEl.tagName.toLowerCase() === "img" ? tokenEl.src || "" : "";
      const tColoredShape = tokenEl.querySelector('path[fill]:not([fill="none"]):not([fill="#fff"]):not([fill="#ffffff"]), circle[fill]:not([fill="none"]), rect[fill]:not([fill="none"])') || (tokenEl.tagName.toLowerCase() === "svg" ? tokenEl : tokenEl.querySelector("svg, circle, path"));
      const tFill = tColoredShape ? tColoredShape.getAttribute("fill") || window.getComputedStyle(tColoredShape).fill || "" : "";
      const tClass = (tokenEl.className || "").toString();
      let matchedPlayer = null;
      for (const p of playerAvatars) {
        let score = 0;
        if (p.src && tSrc && p.src === tSrc) score += 10;
        if (p.fill && tFill && p.fill === tFill && p.fill !== "none") score += 5;
        if (p.color && tColor && p.color === tColor && !tColor.includes("rgba(0, 0, 0, 0)")) score += 3;
        if (p.classSnippet && tClass && p.classSnippet === tClass) score += 2;
        if (score >= 3) {
          matchedPlayer = p;
          break;
        }
      }
      if (!matchedPlayer && playerAvatars.length === 1) {
        matchedPlayer = playerAvatars[0];
      }
      if (!matchedPlayer) continue;
      let bestTile = null;
      let minDistance = Infinity;
      for (const [id, t] of tileRects.entries()) {
        if (tcx >= t.rect.left && tcx <= t.rect.right && tcy >= t.rect.top && tcy <= t.rect.bottom) {
          bestTile = t;
          minDistance = 0;
          break;
        }
        if (t.el && typeof t.el.contains === "function" && t.el.contains(tokenEl)) {
          bestTile = t;
          minDistance = 0;
          break;
        }
        const dist = Math.hypot(tcx - t.cx, tcy - t.cy);
        if (dist < minDistance) {
          minDistance = dist;
          bestTile = t;
        }
      }
      if (bestTile && minDistance < 85) {
        if (matchedPlayer.isMe) {
          if (GameMemory.myPos !== bestTile.id && !GameMemory.inJail) {
            GameMemory.myPos = bestTile.id;
            logToBot(`[DOM COORDINATE SCRAPER] \u{1F3AF} Verified local position at Tile #${bestTile.id} (${bestTile.name}) [Pixel: (${Math.round(tcx)}, ${Math.round(tcy)})]`);
          }
        } else if (GameMemory.players[matchedPlayer.name]) {
          const curPos = GameMemory.players[matchedPlayer.name].pos;
          if (curPos !== bestTile.id) {
            GameMemory.players[matchedPlayer.name].pos = bestTile.id;
            logToBot(`[DOM COORDINATE SCRAPER] \u{1F3AF} Verified ${matchedPlayer.name} at Tile #${bestTile.id} (${bestTile.name}) [Pixel: (${Math.round(tcx)}, ${Math.round(tcy)})] (was #${curPos})`);
          }
        }
      }
    }
  }
  function syncPropertyCardModalFromDOM() {
    const hud = document.getElementById("rubot-hud-panel");
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="card" i], div[style*="z-index"]');
    for (const modal of modals) {
      if (hud && hud.contains(modal)) continue;
      const text = modal.innerText || "";
      if (!text.includes("with rent") && !text.includes("with one house") && !text.includes("with a hotel")) continue;
      let matchedTile = null;
      for (const t of BOARD_TILES) {
        if (t.group && new RegExp(`\\b${t.name}\\b`, "i").test(text)) {
          matchedTile = t;
          break;
        }
      }
      if (!matchedTile) continue;
      const rBase = /with rent\s*\$?(\d+)/i.exec(text);
      const r1 = /with one house\s*\$?(\d+)/i.exec(text);
      const r2 = /with two houses\s*\$?(\d+)/i.exec(text);
      const r3 = /with three houses\s*\$?(\d+)/i.exec(text);
      const r4 = /with four houses\s*\$?(\d+)/i.exec(text);
      const rHotel = /with a hotel\s*\$?(\d+)/i.exec(text);
      if (rBase && r1 && r2 && r3 && r4 && rHotel) {
        matchedTile.rent = [
          parseInt(rBase[1], 10),
          parseInt(r1[1], 10),
          parseInt(r2[1], 10),
          parseInt(r3[1], 10),
          parseInt(r4[1], 10),
          parseInt(rHotel[1], 10)
        ];
      }
      const houseCostMatch = /🏠\s*\$?(\d+)|house\s*\$?(\d+)/i.exec(text);
      if (houseCostMatch) {
        const hc = parseInt(houseCostMatch[1] || houseCostMatch[2], 10);
        if (!isNaN(hc) && hc >= 20 && hc <= 500) {
          matchedTile.houseCost = hc;
        }
      }
      const priceMatch = /Price\s*\$?(\d+)/i.exec(text);
      if (priceMatch) {
        const p = parseInt(priceMatch[1], 10);
        if (!isNaN(p) && p >= 30 && p <= 1e3) {
          matchedTile.price = p;
        }
      }
      const ownerMatch = /Owner\s*([A-Za-z0-9_-]+)/i.exec(text);
      if (ownerMatch && GameMemory.ownership[matchedTile.id]) {
        const ownerName = ownerMatch[1].trim();
        if (ownerName && !ownerName.toLowerCase().includes("price")) {
          GameMemory.ownership[matchedTile.id].owner = ownerName;
        }
      }
      break;
    }
  }
  function syncMyPropertiesFromSidebar() {
    const hud = document.getElementById("rubot-hud-panel");
    const allEls = document.querySelectorAll("h1, h2, h3, h4, h5, div, span, p");
    let headerEl = null;
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      if (hud && hud.contains(el)) continue;
      const text2 = (el.innerText || "").trim();
      if (/^My properties\s*\(\d+\)/i.test(text2)) {
        if (!headerEl || text2.length < (headerEl.innerText || "").length) {
          headerEl = el;
        }
      }
    }
    if (!headerEl) return;
    const countMatch = /My properties\s*\((\d+)\)/i.exec(headerEl.innerText);
    const ownedCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const myName = GameMemory.myName || "__ME__";
    if (ownedCount === 0) {
      for (const tileId of Object.keys(GameMemory.ownership)) {
        if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner)) {
          GameMemory.ownership[tileId].owner = null;
          GameMemory.ownership[tileId].houses = 0;
        }
      }
      return;
    }
    const sidebarContainer = headerEl.parentElement;
    if (!sidebarContainer) return;
    const text = sidebarContainer.innerText || "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const foundTileIds = /* @__PURE__ */ new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      let matchedTile = null;
      for (const tile of BOARD_TILES) {
        if (tile.group && (lower === tile.name.toLowerCase() || new RegExp(`^${tile.name}\\b`, "i").test(line))) {
          matchedTile = tile;
          break;
        }
      }
      if (matchedTile && GameMemory.ownership[matchedTile.id]) {
        foundTileIds.add(matchedTile.id);
        GameMemory.ownership[matchedTile.id].owner = myName;
        const houseMatch = /(?:x\s*|houses?\s*)(\d)/i.exec(line) || (i + 1 < lines.length ? /(?:x\s*|houses?\s*)(\d)/i.exec(lines[i + 1]) : null);
        if (houseMatch) {
          GameMemory.ownership[matchedTile.id].houses = parseInt(houseMatch[1], 10);
        } else if (lower.includes("hotel") || i + 1 < lines.length && lines[i + 1].toLowerCase().includes("hotel")) {
          GameMemory.ownership[matchedTile.id].houses = 5;
        }
      }
    }
    const propertyRows = sidebarContainer.querySelectorAll('div, li, button, [class*="property" i], [class*="item" i]');
    for (const row of propertyRows) {
      if (row.children.length > 5) continue;
      const rowText = (row.innerText || "").trim();
      if (!rowText || rowText.length > 80) continue;
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`^${tile.name}\\b`, "i").test(rowText)) {
          const inner = (row.innerHTML || "").toLowerCase();
          const rowCls = (row.className?.baseVal !== void 0 ? row.className.baseVal : row.className || "").toString().toLowerCase();
          const rowStyle = window.getComputedStyle(row);
          const isMortgagedRow = inner.includes("mortgage") || rowCls.includes("mortgage") || rowStyle.opacity && parseFloat(rowStyle.opacity) < 0.7;
          if (isMortgagedRow && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].mortgaged = true;
          }
          if (GameMemory.ownership[tile.id]) {
            if (inner.includes("hotel") || /hotel/i.test(rowText)) {
              GameMemory.ownership[tile.id].houses = 5;
            } else {
              const numMatch = /(?:x\s*|houses?\s*)(\d)/i.exec(rowText);
              if (numMatch) {
                GameMemory.ownership[tile.id].houses = parseInt(numMatch[1], 10);
              } else if (row.querySelector('svg, [class*="house" i], [class*="building" i]')) {
                if (!GameMemory.ownership[tile.id].houses) {
                  GameMemory.ownership[tile.id].houses = 1;
                }
              }
            }
          }
        }
      }
    }
    for (const tileId of Object.keys(GameMemory.ownership)) {
      if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner) && !foundTileIds.has(Number(tileId))) {
        GameMemory.ownership[tileId].owner = null;
        GameMemory.ownership[tileId].houses = 0;
      }
    }
  }
  function matchPlayerName(rawName) {
    if (!rawName) return null;
    const clean = rawName.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[^\w\s-]/g, "").trim();
    if (!clean) return null;
    const lower = clean.toLowerCase();
    for (const key of Object.keys(GameMemory.players)) {
      if (key.toLowerCase() === lower) return key;
    }
    return clean;
  }
  function scanActivityLogsOnly() {
    const hud = document.getElementById("rubot-hud-panel");
    const processedLines = /* @__PURE__ */ new Set();
    const chatInput = document.querySelector('input[placeholder*="Say something" i], textarea[placeholder*="Say something" i]');
    const chatBox = chatInput ? chatInput.closest('[class*="chat" i]') || chatInput.parentElement?.parentElement : null;
    const isExcluded = (el) => {
      if (!el) return true;
      if (hud && hud.contains(el)) return true;
      if (chatBox && chatBox.contains(el)) return true;
      return false;
    };
    const candidateEls = document.querySelectorAll(
      '[class*="board" i] p, [class*="board" i] div, [class*="feed" i] *, [class*="activity" i] *, [class*="log" i] *, [class*="history" i] *, p, li, div[class*="item" i]'
    );
    for (let i = 0; i < candidateEls.length; i++) {
      const el = candidateEls[i];
      if (isExcluded(el)) continue;
      if ((el.children?.length ?? 0) > 5) continue;
      const line = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (line.length >= 6 && line.length <= 220 && !processedLines.has(line)) {
        if (/bought|paid|rolled|landed on|passed through|prison|jail|pardon|bankrupt|won.*auction|trade|treasure card|tax/i.test(line)) {
          processedLines.add(line);
          if (!GameMemory.isLogProcessed(line)) {
            parseActivityLogLine(line);
          }
        }
      }
    }
  }
  function parseActivityLogLine(line) {
    if (/created a trade with/i.test(line)) {
      const parts = line.split(/created a trade with/i);
      const p1 = matchPlayerName(parts[0]);
      const p2 = matchPlayerName(parts[1]);
      logToBot(`[TRADE INTEL] Negotiation initiated: ${p1} \u2194\uFE0F ${p2}`);
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/is looking at a trade/i.test(line)) {
      const p = matchPlayerName(line.split(/is looking at a trade/i)[0]);
      logToBot(`[TRADE INTEL] ${p} is reviewing trade proposal...`);
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/declined.*trade/i.test(line)) {
      const parts = line.split(/declined/i);
      const decliner = matchPlayerName(parts[0]);
      const createdByPart = /created by (.+)/i.exec(line);
      const creator = createdByPart ? matchPlayerName(createdByPart[1]) : null;
      if (TradeProposalExecutor.lastSentProposal && (GameMemory.isMe(creator) || !creator)) {
        const proposal = TradeProposalExecutor.lastSentProposal;
        if (!decliner || decliner.toLowerCase() === proposal.targetOwner.toLowerCase() || !creator) {
          GameMemory.recordDeclinedTrade(proposal.targetOwner, proposal);
          const givenNames = (proposal.givenTiles || []).map((t) => t.name).join(", ") || "cash";
          const recNames = (proposal.receivedTiles || []).map((t) => t.name).join(", ");
          logToBot(`[TRADE MEMORY] \u{1F4DC} Archival rejection recorded for ${proposal.targetOwner}: Offered [${givenNames}] for [${recNames}] (+$${proposal.cashOffer || 0})`);
        }
      } else if (decliner) {
        GameMemory.recordDeclinedTrade(decliner, { givenTiles: [], receivedTiles: [], cashOffer: 0 });
        logToBot(`[TRADE INTEL] Trade declined by ${decliner}`);
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/traded/i.test(line) || /accepted trade/i.test(line)) {
      logToBot(`[TRADE INTEL] Deal executed: ${line}`);
      GameMemory.markLogProcessed(line);
      return;
    }
    const payMatch = /(.+?)\s+paid\s+\$?(\d+)\s+to\s+(.+)/i.exec(line);
    if (payMatch) {
      const payer = matchPlayerName(payMatch[1]);
      const amount = parseInt(payMatch[2], 10);
      const recipient = matchPlayerName(payMatch[3]);
      if (payer && GameMemory.players[payer] && typeof GameMemory.players[payer].cash === "number") {
        GameMemory.players[payer].cash -= amount;
      }
      if (recipient && GameMemory.players[recipient] && typeof GameMemory.players[recipient].cash === "number") {
        GameMemory.players[recipient].cash += amount;
      }
      logToBot(`[CASH FLOW] ${payer} paid $${amount} to ${recipient}`);
      GameMemory.markLogProcessed(line);
      return;
    }
    const taxMatch = /(.+?)\s+paid\s+(?:a\s+)?\$?(\d+)\s+tax/i.exec(line);
    if (taxMatch) {
      const player = matchPlayerName(taxMatch[1]);
      const taxAmount = parseInt(taxMatch[2], 10);
      const isMe = GameMemory.isMe(player);
      const taxTileId = taxAmount >= 150 ? 4 : 38;
      if (isMe) {
        GameMemory.myPos = taxTileId;
        logToBot(`[TAX] Paid $${taxAmount} tax (Tile #${taxTileId})`);
      } else if (player && GameMemory.players[player]) {
        GameMemory.players[player].pos = taxTileId;
        if (typeof GameMemory.players[player].cash === "number") {
          GameMemory.players[player].cash -= taxAmount;
        }
        logToBot(`[TAX] ${player} paid $${taxAmount} tax (Tile #${taxTileId})`);
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (line.includes("passed through Start")) {
      const playerPart = line.split(/passed through Start/i)[0].trim();
      const player = matchPlayerName(playerPart);
      const isMe = GameMemory.isMe(player);
      if (isMe) {
        logToBot(`[START PASS] I passed through Start and received $200`);
      } else if (player && GameMemory.players[player]) {
        if (typeof GameMemory.players[player].cash === "number") {
          GameMemory.players[player].cash += 200;
        }
        logToBot(`[START PASS] ${player} passed through Start and received $200`);
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/won.*in auction|bought.*in auction/i.test(line)) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const buyerPart = line.split(/won|bought/i)[0].trim();
          const cleanBuyer = matchPlayerName(buyerPart);
          if (cleanBuyer && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = cleanBuyer;
            if (!GameMemory.isMe(cleanBuyer) && GameMemory.players[cleanBuyer]) {
              GameMemory.players[cleanBuyer].pos = tile.id;
            }
            logToBot(`[MARKET INTEL] ${cleanBuyer} won ${tile.name} at auction!`);
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    if (/got into prison|went to prison|sent to prison/i.test(line)) {
      const playerPart = line.split(/got into prison|went to prison|sent to prison/i)[0].trim();
      const cleanPlayer = matchPlayerName(playerPart);
      const isMe = GameMemory.isMe(cleanPlayer);
      logToBot(`[PRISON EVENT] \u{1F694} ${isMe ? "I was" : cleanPlayer + " was"} sent to prison!`);
      if (isMe) {
        GameMemory.myPos = 10;
        GameMemory.inJail = true;
      } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
        GameMemory.players[cleanPlayer].pos = 10;
        GameMemory.players[cleanPlayer].inJail = true;
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/got free|left prison|paid.*jail|paid.*bail|used a Pardon/i.test(line)) {
      const playerPart = line.split(/got free|left prison|paid|used a Pardon/i)[0].trim();
      const cleanPlayer = matchPlayerName(playerPart);
      const isMe = GameMemory.isMe(cleanPlayer);
      logToBot(`[PRISON EVENT] \u{1F513} ${isMe ? "I got" : cleanPlayer + " got"} released from prison.`);
      if (isMe) {
        GameMemory.inJail = false;
      } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
        GameMemory.players[cleanPlayer].inJail = false;
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    const rollMatch = /^(.+?)\s+rolled\s+(\d+)/i.exec(line);
    if (rollMatch) {
      const player = matchPlayerName(rollMatch[1]);
      const rollVal = parseInt(rollMatch[2], 10);
      if (!isNaN(rollVal) && rollVal >= 2 && rollVal <= 12) {
        const isMe = GameMemory.isMe(player);
        logToBot(`[DICE EVENT] \u{1F3B2} ${isMe ? "I" : player} rolled ${rollVal}`);
        if (isMe) {
          if (!GameMemory.inJail) {
            GameMemory.myPos = (GameMemory.myPos + rollVal) % 40;
          }
        } else if (player && GameMemory.players[player]) {
          if (!GameMemory.players[player].inJail) {
            GameMemory.players[player].pos = ((GameMemory.players[player].pos || 0) + rollVal) % 40;
          }
        }
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (line.includes("landed on")) {
      for (const tile of BOARD_TILES) {
        if (new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const playerPart = line.split(/landed on/i)[0].trim();
          const cleanPlayer = matchPlayerName(playerPart);
          const isMe = GameMemory.isMe(cleanPlayer);
          const priceStr = tile.price ? ` ($${tile.price})` : "";
          if (isMe) {
            GameMemory.myPos = tile.id;
            logToBot(`[LANDING] \u{1F4CD} I landed on ${tile.name} (Tile #${tile.id}, ${tile.group || tile.type}${priceStr})`);
          } else if (cleanPlayer && GameMemory.players[cleanPlayer]) {
            GameMemory.players[cleanPlayer].pos = tile.id;
            logToBot(`[LANDING] \u{1F4CD} ${cleanPlayer} landed on ${tile.name} (Tile #${tile.id})`);
          } else if (cleanPlayer) {
            logToBot(`[LANDING] \u{1F4CD} ${cleanPlayer} landed on ${tile.name} (Tile #${tile.id})`);
          }
          GameMemory.markLogProcessed(line);
          return;
        }
      }
    }
    if (line.includes("bought a house in")) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const buyerPart = line.split(/bought a house in/i)[0].trim();
          const cleanBuyer = matchPlayerName(buyerPart);
          if (cleanBuyer && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = cleanBuyer;
            GameMemory.ownership[tile.id].houses = Math.min(5, (GameMemory.ownership[tile.id].houses || 0) + 1);
            const isMe = GameMemory.isMe(cleanBuyer);
            if (isMe) GameMemory.myPos = tile.id;
            else if (GameMemory.players[cleanBuyer]) GameMemory.players[cleanBuyer].pos = tile.id;
            logToBot(`[BUILD EVENT] \u{1F3E0} ${isMe ? "I" : cleanBuyer} bought a house in ${tile.name} (${GameMemory.ownership[tile.id].houses}/5)`);
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    if (line.includes("bought a hotel in")) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const buyerPart = line.split(/bought a hotel in/i)[0].trim();
          const cleanBuyer = matchPlayerName(buyerPart);
          if (cleanBuyer && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = cleanBuyer;
            GameMemory.ownership[tile.id].houses = 5;
            const isMe = GameMemory.isMe(cleanBuyer);
            if (isMe) GameMemory.myPos = tile.id;
            else if (GameMemory.players[cleanBuyer]) GameMemory.players[cleanBuyer].pos = tile.id;
            logToBot(`[BUILD EVENT] \u{1F3E8} ${isMe ? "I" : cleanBuyer} bought a HOTEL in ${tile.name}!`);
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    if (line.includes("bought") && !line.includes("house") && !line.includes("hotel")) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const buyerPart = line.split(/bought/i)[0].trim();
          const cleanBuyer = matchPlayerName(buyerPart);
          if (cleanBuyer && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = cleanBuyer;
            const isMe = GameMemory.isMe(cleanBuyer);
            if (isMe) {
              GameMemory.myPos = tile.id;
              logToBot(`[PURCHASE EVENT] \u{1F3F7}\uFE0F I purchased ${tile.name} (${tile.group}, $${tile.price})!`);
            } else {
              GameMemory.players[cleanBuyer] = GameMemory.players[cleanBuyer] || { name: cleanBuyer, cash: 1500, pos: tile.id, isMe: false };
              GameMemory.players[cleanBuyer].pos = tile.id;
              logToBot(`[PURCHASE EVENT] \u{1F3F7}\uFE0F ${cleanBuyer} bought ${tile.name} (${tile.group}, $${tile.price}) -> Tile #${tile.id}`);
            }
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    let m = /^(.+?)\s+bankrupted/i.exec(line);
    if (m) {
      const bankruptPlayer = m[1].replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[^\w\s-]/g, "").trim();
      logToBot(`[BANKRUPTCY] \u26A0\uFE0F ${bankruptPlayer} went bankrupt! Assets returned to bank.`);
      for (const id of Object.keys(GameMemory.ownership)) {
        if (GameMemory.ownership[id].owner === bankruptPlayer) {
          GameMemory.ownership[id].owner = null;
          GameMemory.ownership[id].houses = 0;
          GameMemory.ownership[id].mortgaged = false;
        }
      }
      GameMemory.markLogProcessed(line);
      return;
    }
    if (line.includes("mortgaged")) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          if (GameMemory.ownership[tile.id]) {
            const isUn = line.includes("unmortgaged");
            GameMemory.ownership[tile.id].mortgaged = !isUn;
            logToBot(`[MORTGAGE EVENT] \u{1F3E6} ${tile.name} was ${isUn ? "unmortgaged" : "mortgaged"}.`);
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    if (line.includes("traded")) {
      for (const tile of BOARD_TILES) {
        if (tile.group && new RegExp(`\\b${tile.name}\\b`, "i").test(line)) {
          const matchTo = /to\s+([A-Za-z0-9_-]+)/i.exec(line);
          if (matchTo && GameMemory.ownership[tile.id]) {
            GameMemory.ownership[tile.id].owner = matchTo[1].trim();
            logToBot(`[TRADE EVENT] \u{1F91D} ${tile.name} transferred to ${matchTo[1].trim()}`);
            GameMemory.markLogProcessed(line);
            return;
          }
        }
      }
    }
    if (/drew a card|got a card|surprise|treasure|chance/i.test(line)) {
      logToBot(`[CARD EVENT] \u{1F0CF} ${line}`);
      GameMemory.markLogProcessed(line);
      return;
    }
    if (/tax|salary|bonus|reward|passed start|passed go/i.test(line)) {
      logToBot(`[GAME EVENT] \u{1F514} ${line}`);
      GameMemory.markLogProcessed(line);
      return;
    }
  }
  function syncTradeModalInventoriesFromDOM() {
    const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
    if (!modal) return;
    const modalRect = modal.getBoundingClientRect();
    if (modalRect.width < 100 || modalRect.height < 100) return;
    const modalMidX = modalRect.left + modalRect.width / 2;
    let leftPlayerName = null;
    let rightPlayerName = null;
    const headerCandidates = Array.from(modal.querySelectorAll("h1, h2, h3, h4, h5, div, span, strong, b, p")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < modalRect.top + modalRect.height * 0.4 && rect.height > 10;
    });
    for (const el of headerCandidates) {
      const t = (el.innerText || "").trim();
      if (t.length >= 2 && t.length <= 25 && !t.includes("$") && !t.toLowerCase().includes("trade") && !t.toLowerCase().includes("create") && !BOARD_LABELS_BLACKLIST.has(t.toLowerCase())) {
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        for (const pName of Object.keys(GameMemory.players)) {
          if (t.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes(t.toLowerCase())) {
            if (center < modalMidX && !leftPlayerName) leftPlayerName = pName;
            else if (center >= modalMidX && !rightPlayerName) rightPlayerName = pName;
          }
        }
        if (GameMemory.isMe(t)) {
          if (center < modalMidX && !leftPlayerName) leftPlayerName = t;
          else if (center >= modalMidX && !rightPlayerName) rightPlayerName = t;
        }
      }
    }
    if (!leftPlayerName && !rightPlayerName) return;
    const cards = Array.from(modal.querySelectorAll('div, li, button, [class*="item" i], [class*="property" i], [class*="card" i]'));
    for (const card of cards) {
      const text = (card.innerText || "").trim();
      if (!text || text.length > 60) continue;
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const tName = tile.name.toLowerCase();
        if (text.toLowerCase().includes(tName)) {
          const rect = card.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          const ownerName = center < modalMidX ? leftPlayerName : rightPlayerName;
          if (ownerName && GameMemory.ownership[tile.id]) {
            const isMe = GameMemory.isMe(ownerName);
            GameMemory.ownership[tile.id].owner = isMe ? GameMemory.myName || "__ME__" : ownerName;
            const houseMatch = /(?:x\s*|houses?\s*)(\d)/i.exec(text);
            if (houseMatch) {
              GameMemory.ownership[tile.id].houses = parseInt(houseMatch[1], 10);
            } else if (/hotel/i.test(text)) {
              GameMemory.ownership[tile.id].houses = 5;
            }
            const cardCls = (card.className?.baseVal !== void 0 ? card.className.baseVal : card.className || "").toString().toLowerCase();
            const isMort = /mortgage/i.test(text) || cardCls.includes("mortgage");
            if (isMort) {
              GameMemory.ownership[tile.id].mortgaged = true;
            }
          }
          break;
        }
      }
    }
  }
  function scrapeTradeModalDOM() {
    const modal = document.querySelector('[role="dialog"], [class*="modal" i], [class*="trade" i]');
    if (!modal) {
      return { partnerName: "Opponent", givenTiles: [], receivedTiles: [], givenCash: 0, receivedCash: 0 };
    }
    const modalRect = modal.getBoundingClientRect();
    const modalMidX = modalRect.left + modalRect.width / 2;
    let leftPlayerName = null;
    let rightPlayerName = null;
    const headerCandidates = Array.from(modal.querySelectorAll("h1, h2, h3, h4, h5, div, span, strong, b, p")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < modalRect.top + modalRect.height * 0.4 && rect.height > 10;
    });
    for (const el of headerCandidates) {
      const t = (el.innerText || "").trim();
      if (t.length >= 2 && t.length <= 25 && !t.includes("$") && !t.toLowerCase().includes("trade") && !t.toLowerCase().includes("create") && !BOARD_LABELS_BLACKLIST.has(t.toLowerCase())) {
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        for (const pName of Object.keys(GameMemory.players)) {
          if (t.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes(t.toLowerCase())) {
            if (center < modalMidX && !leftPlayerName) leftPlayerName = pName;
            else if (center >= modalMidX && !rightPlayerName) rightPlayerName = pName;
          }
        }
        if (GameMemory.isMe(t)) {
          if (center < modalMidX && !leftPlayerName) leftPlayerName = t;
          else if (center >= modalMidX && !rightPlayerName) rightPlayerName = t;
        }
      }
    }
    let meIsOnLeft = false;
    let partnerName = "Opponent";
    if (leftPlayerName && GameMemory.isMe(leftPlayerName)) {
      meIsOnLeft = true;
      partnerName = rightPlayerName || "Opponent";
    } else if (rightPlayerName && GameMemory.isMe(rightPlayerName)) {
      meIsOnLeft = false;
      partnerName = leftPlayerName || "Opponent";
    } else if (leftPlayerName && !GameMemory.isMe(leftPlayerName)) {
      meIsOnLeft = false;
      partnerName = leftPlayerName;
    } else if (rightPlayerName && !GameMemory.isMe(rightPlayerName)) {
      meIsOnLeft = true;
      partnerName = rightPlayerName;
    } else {
      meIsOnLeft = false;
      partnerName = "Opponent";
    }
    let givenCash = 0;
    let receivedCash = 0;
    const inputs = Array.from(modal.querySelectorAll('input[type="range"], input[type="number"], input'));
    for (const input of inputs) {
      const rect = input.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const val = parseInt(input.value, 10) || 0;
      if (center < modalMidX) {
        if (meIsOnLeft) givenCash = val;
        else receivedCash = val;
      } else {
        if (meIsOnLeft) receivedCash = val;
        else givenCash = val;
      }
    }
    if (givenCash === 0 && receivedCash === 0) {
      const badges = Array.from(modal.querySelectorAll("div, span, button")).filter((el) => {
        const t = (el.innerText || "").trim();
        return /^\$?\d{1,5}\$?$/.test(t) && t.includes("$");
      });
      for (const badge of badges) {
        const rect = badge.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const val = parseInt((badge.innerText || "").replace(/\D/g, ""), 10) || 0;
        if (center < modalMidX) {
          if (meIsOnLeft && givenCash === 0) givenCash = val;
          else if (!meIsOnLeft && receivedCash === 0) receivedCash = val;
        } else {
          if (meIsOnLeft && receivedCash === 0) receivedCash = val;
          else if (!meIsOnLeft && givenCash === 0) givenCash = val;
        }
      }
    }
    const cards = Array.from(modal.querySelectorAll('div, li, button, [class*="item" i], [class*="property" i], [class*="card" i]'));
    const matchedTileIds = /* @__PURE__ */ new Set();
    const givenTiles = [];
    const receivedTiles = [];
    for (const card of cards) {
      const cls = (card.className?.baseVal !== void 0 ? card.className.baseVal : card.className || "").toString().toLowerCase();
      if (cls.includes("unselected") || cls.includes("inactive") || cls.includes("disabled")) continue;
      const style = window.getComputedStyle(card);
      if (parseFloat(style.opacity) < 0.65) continue;
      const rawText = (card.innerText || "").trim();
      if (!rawText || rawText.length > 50) continue;
      const cleanText = rawText.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        if (matchedTileIds.has(tile.id)) continue;
        const tName = tile.name.toLowerCase();
        if (cleanText === tName || cleanText.startsWith(tName) || cleanText.endsWith(tName) || rawText.toLowerCase().includes(tName)) {
          matchedTileIds.add(tile.id);
          const cardRect = card.getBoundingClientRect();
          const cardCenterX = cardRect.left + cardRect.width / 2;
          const isLeftColumn = cardCenterX < modalMidX;
          if (meIsOnLeft) {
            if (isLeftColumn) givenTiles.push(tile);
            else receivedTiles.push(tile);
          } else {
            if (isLeftColumn) receivedTiles.push(tile);
            else givenTiles.push(tile);
          }
          break;
        }
      }
    }
    return {
      partnerName,
      givenTiles,
      receivedTiles,
      givenCash,
      receivedCash
    };
  }

  // src/ui/hudPanel.js
  var HUDPanel = {
    elements: {},
    maxLogs: 120,
    pendingAdvisorAction: null,
    activeTab: "brain",
    drag: {
      active: false,
      startX: 0,
      startY: 0,
      initialLeft: 20,
      initialTop: 20
    },
    inject(onToggleMaster, onExecuteAdvisor, onSkipAdvisor) {
      if (document.getElementById("rubot-hud-panel")) return;
      let savedGeom = { left: 20, top: 20, width: 340, height: 460 };
      try {
        const raw = localStorage.getItem("richup_hud_geometry");
        if (raw) savedGeom = Object.assign(savedGeom, JSON.parse(raw));
      } catch (_) {
      }
      if (!document.getElementById("rubot-font-link")) {
        const link = document.createElement("link");
        link.id = "rubot-font-link";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";
        document.head.appendChild(link);
      }
      const style = document.createElement("style");
      style.id = "rubot-hud-style";
      style.textContent = `
            #rubot-hud-panel {
                position: fixed;
                top: ${savedGeom.top}px;
                left: ${savedGeom.left}px;
                width: ${savedGeom.width}px;
                height: ${savedGeom.height}px;
                min-width: 310px; min-height: 380px;
                max-width: 520px; max-height: 780px;
                resize: both; overflow: hidden;
                background: linear-gradient(165deg, rgba(13,10,26,0.96) 0%, rgba(20,13,40,0.98) 100%);
                backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(139,92,246,0.3);
                border-radius: 14px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.7), 0 0 50px rgba(109,40,217,0.15), inset 0 1px 0 rgba(255,255,255,0.06);
                color: #f3e8ff;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 11px; z-index: 9999999;
                display: flex; flex-direction: column; user-select: none;
            }
            .rubot-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 10px 14px;
                background: linear-gradient(90deg, rgba(109,40,217,0.5) 0%, rgba(76,29,149,0.4) 100%);
                border-bottom: 1px solid rgba(139,92,246,0.2);
                border-radius: 14px 14px 0 0; cursor: grab; flex-shrink: 0;
            }
            .rubot-title-wrap { display: flex; align-items: center; gap: 8px; }
            .rubot-logo {
                width: 24px; height: 24px; border-radius: 6px;
                background: linear-gradient(135deg, #8b5cf6, #6d28d9);
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; flex-shrink: 0;
            }
            .rubot-title-main { font-size: 11.5px; font-weight: 800; color: #fff; letter-spacing: 1px; }
            .rubot-badge {
                font-size: 8px; font-weight: 700; padding: 2px 7px;
                border-radius: 12px; letter-spacing: 0.6px;
                background: rgba(255,255,255,0.08); color: rgba(196,181,253,0.8);
                border: 1px solid rgba(139,92,246,0.2); transition: all 0.3s ease;
            }
            .rubot-badge.active {
                background: #10b981; color: #fff; border-color: transparent;
                box-shadow: 0 0 10px rgba(16,185,129,0.5);
            }
            .rubot-top-controls {
                padding: 10px 12px 6px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
            }
            .rubot-master-btn {
                background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
                border: none; color: #fff; padding: 9px 14px;
                font-family: 'Inter', sans-serif; font-weight: 800; font-size: 11px;
                letter-spacing: 1px; border-radius: 8px; cursor: pointer;
                box-shadow: 0 3px 12px rgba(109,40,217,0.4); transition: all 0.2s ease;
            }
            .rubot-master-btn:hover { box-shadow: 0 4px 16px rgba(109,40,217,0.6); transform: translateY(-1px); }
            .rubot-master-btn.active {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                box-shadow: 0 3px 12px rgba(16,185,129,0.45);
            }
            .rubot-mode-wrap {
                display: flex; background: rgba(0,0,0,0.3);
                border-radius: 8px; padding: 2px;
                border: 1px solid rgba(139,92,246,0.18); gap: 2px;
            }
            .rubot-mode-btn {
                flex: 1; background: transparent; border: none;
                color: rgba(196,181,253,0.6); font-family: 'Inter', sans-serif;
                font-weight: 700; font-size: 9.5px; padding: 5px 4px;
                border-radius: 6px; cursor: pointer; transition: all 0.15s ease;
            }
            .rubot-mode-btn.active {
                background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
                box-shadow: 0 1px 6px rgba(109,40,217,0.4);
            }
            .rubot-tab-bar {
                display: flex; background: rgba(0,0,0,0.25);
                border-bottom: 1px solid rgba(139,92,246,0.18);
                padding: 0 10px; gap: 4px; flex-shrink: 0;
            }
            .rubot-tab-btn {
                background: transparent; border: none;
                color: rgba(196,181,253,0.6); font-family: 'Inter', sans-serif;
                font-weight: 700; font-size: 10px; padding: 8px 10px;
                cursor: pointer; border-bottom: 2px solid transparent;
                transition: all 0.2s; display: flex; align-items: center; gap: 5px;
            }
            .rubot-tab-btn:hover { color: #e9d5ff; }
            .rubot-tab-btn.active {
                color: #fff; border-bottom-color: #8b5cf6;
                text-shadow: 0 0 10px rgba(167,139,250,0.5);
            }
            .rubot-tab-content {
                padding: 10px 12px; display: flex; flex-direction: column;
                flex: 1; overflow-y: auto; gap: 8px;
            }
            .rubot-tab-page { display: none; flex-direction: column; gap: 8px; flex: 1; }
            .rubot-tab-page.active { display: flex; }

            /* Ollama Tab */
            .rubot-status-card {
                display: flex; align-items: center; justify-content: space-between;
                padding: 7px 10px; border-radius: 8px;
                background: rgba(255,255,255,0.02); border: 1px solid rgba(139,92,246,0.15);
            }
            .rubot-status-indicator { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 10px; }
            .rubot-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; }
            .rubot-status-dot.online { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.8); }
            .rubot-status-dot.offline { background: #ef4444; }
            .rubot-field-group { display: flex; flex-direction: column; gap: 4px; }
            .rubot-field-label { font-size: 9px; font-weight: 600; color: rgba(167,139,250,0.7); text-transform: uppercase; letter-spacing: 0.5px; }
            .rubot-input {
                background: rgba(0,0,0,0.35); border: 1px solid rgba(139,92,246,0.22);
                border-radius: 6px; color: #fff; padding: 6px 8px;
                font-family: 'JetBrains Mono', monospace; font-size: 10px; outline: none;
            }
            .rubot-input:focus { border-color: rgba(139,92,246,0.6); }
            .rubot-select {
                background: #191230; border: 1px solid rgba(139,92,246,0.25);
                border-radius: 6px; color: #fff; padding: 6px 8px;
                font-family: 'Inter', sans-serif; font-size: 10px; outline: none;
            }
            .rubot-btn-test {
                background: linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(109,40,217,0.4) 100%);
                border: 1px solid rgba(139,92,246,0.4); color: #e9d5ff;
                padding: 7px; border-radius: 7px; font-weight: 700; font-size: 10px;
                cursor: pointer; transition: all 0.2s; text-align: center; margin-top: 2px;
            }
            .rubot-btn-test:hover { background: rgba(139,92,246,0.45); color: #fff; }
            .rubot-info-box {
                font-size: 9.5px; color: rgba(196,181,253,0.65); line-height: 1.4;
                padding: 6px 8px; border-radius: 6px; background: rgba(139,92,246,0.06);
                border: 1px dashed rgba(139,92,246,0.2);
            }

            /* Toggles Tab */
            .rubot-toggles-list { display: flex; flex-direction: column; gap: 5px; }
            .rubot-toggle-item {
                display: flex; align-items: center; justify-content: space-between;
                padding: 6px 9px; background: rgba(255,255,255,0.02);
                border: 1px solid rgba(139,92,246,0.12); border-radius: 8px;
                cursor: pointer; transition: border-color 0.2s;
            }
            .rubot-toggle-item:hover { border-color: rgba(139,92,246,0.3); }
            .rubot-toggle-info { display: flex; flex-direction: column; gap: 1px; }
            .rubot-toggle-name { font-size: 10px; font-weight: 700; color: #e9d5ff; }
            .rubot-toggle-desc { font-size: 8.5px; color: rgba(196,181,253,0.55); }
            .rubot-toggle-pill { position: relative; width: 30px; height: 16px; flex-shrink: 0; }
            .rubot-toggle-pill input { opacity: 0; width: 0; height: 0; position: absolute; }
            .rubot-pill-track {
                position: absolute; inset: 0; background: rgba(255,255,255,0.1);
                border-radius: 20px; border: 1px solid rgba(139,92,246,0.3);
                transition: all 0.2s ease;
            }
            .rubot-pill-track::after {
                content: ''; position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
                width: 10px; height: 10px; border-radius: 50%;
                background: rgba(196,181,253,0.5); transition: all 0.2s ease;
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track {
                background: #8b5cf6; border-color: #a78bfa;
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track::after {
                left: calc(100% - 12px); background: #fff;
            }

            /* Intel / Memory Tab */
            .rubot-intel-page { display: flex; flex-direction: column; gap: 6px; flex: 1; }
            .rubot-intel-card {
                background: rgba(255,255,255,0.03); border: 1px solid rgba(139,92,246,0.18);
                border-radius: 8px; padding: 7px 9px; display: flex; flex-direction: column; gap: 3px;
            }
            .rubot-intel-title { font-size: 9.5px; font-weight: 700; color: #c4b5fd; display: flex; justify-content: space-between; align-items: center; }
            .rubot-intel-content { font-size: 8.5px; color: rgba(196,181,253,0.85); line-height: 1.35; word-break: break-word; }
            .rubot-intel-badge { font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 4px; display: inline-block; }
            .rubot-intel-badge.green { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.4); }
            .rubot-intel-badge.amber { background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4); }
            .rubot-intel-badge.red { background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4); }

            /* Activity Log Tab */
            .rubot-log-page { display: flex; flex-direction: column; height: 100%; flex: 1; }
            .rubot-log-toolbar {
                display: flex; justify-content: space-between; align-items: center;
                padding-bottom: 5px; border-bottom: 1px solid rgba(139,92,246,0.12); margin-bottom: 6px;
            }
            .rubot-log-title { font-size: 9px; font-weight: 700; color: rgba(167,139,250,0.7); text-transform: uppercase; }
            .rubot-btn-clear {
                background: transparent; border: 1px solid rgba(139,92,246,0.25);
                color: rgba(196,181,253,0.7); padding: 2px 7px; border-radius: 5px;
                font-size: 8.5px; cursor: pointer; transition: all 0.15s;
            }
            .rubot-btn-clear:hover { background: rgba(139,92,246,0.2); color: #fff; }
            .rubot-terminal {
                flex: 1; overflow-y: auto; padding: 6px 8px;
                background: rgba(0,0,0,0.4); border: 1px solid rgba(139,92,246,0.15);
                border-radius: 8px; font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 9.5px; color: rgba(196,181,253,0.8);
                display: flex; flex-direction: column-reverse; gap: 2px;
                scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.3) transparent;
            }
            .log-line { display: flex; gap: 6px; line-height: 1.35; word-break: break-word; }
            .log-ts { color: rgba(139,92,246,0.6); flex-shrink: 0; font-size: 8.5px; }
            .log-msg { flex: 1; }
            .log-line.green .log-msg { color: #34d399; }
            .log-line.violet .log-msg { color: #c084fc; }
            .log-line.amber .log-msg { color: #fbbf24; }
            .log-line.red .log-msg { color: #f87171; }

            /* Advisor Box Overlay */
            .rubot-advisor-box {
                background: linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(76,29,149,0.25) 100%);
                border: 1px solid rgba(167,139,250,0.5); border-radius: 8px;
                padding: 9px 10px; display: none; flex-direction: column; gap: 7px; margin-bottom: 6px;
            }
            .rubot-adv-title { font-weight: 700; font-size: 10px; color: #e9d5ff; }
            .rubot-adv-desc { font-size: 9.5px; color: #ddd6fe; line-height: 1.35; }
            .rubot-adv-btns { display: flex; gap: 6px; }
            .rubot-adv-btn {
                flex: 1; padding: 6px; border: none; border-radius: 6px;
                font-family: 'Inter', sans-serif; font-weight: 700; font-size: 10px;
                cursor: pointer; transition: all 0.15s ease;
            }
            .rubot-adv-btn.exec { background: #10b981; color: #fff; }
            .rubot-adv-btn.skip { background: rgba(255,255,255,0.08); color: #c4b5fd; border: 1px solid rgba(139,92,246,0.2); }
        `;
      document.head.appendChild(style);
      const panel = document.createElement("div");
      panel.id = "rubot-hud-panel";
      panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <div class="rubot-title-wrap">
                    <div class="rubot-logo">\u{1F3B2}</div>
                    <span class="rubot-title-main">RICHUP BOT</span>
                </div>
                <div class="rubot-badge" id="rubot-badge-status">STANDBY</div>
            </div>

            <div class="rubot-top-controls">
                <button class="rubot-master-btn" id="rubot-btn-master">\u25B6 START BOT  [=]</button>
                <div class="rubot-mode-wrap">
                    <button class="rubot-mode-btn ${!CONFIG.ADVISOR_MODE ? "active" : ""}" id="rubot-mode-auto">\u26A1 AUTO-PILOT</button>
                    <button class="rubot-mode-btn ${CONFIG.ADVISOR_MODE ? "active" : ""}" id="rubot-mode-adv">\u{1F4AC} ADVISOR</button>
                </div>
                <div class="rubot-advisor-box" id="rubot-advisor-box">
                    <div class="rubot-adv-title" id="rubot-adv-title">Proposal</div>
                    <div class="rubot-adv-desc" id="rubot-adv-desc">Advisor action pending.</div>
                    <div class="rubot-adv-btns">
                        <button class="rubot-adv-btn exec" id="rubot-adv-exec">EXECUTE</button>
                        <button class="rubot-adv-btn skip" id="rubot-adv-skip">SKIP</button>
                    </div>
                </div>
            </div>

            <div class="rubot-tab-bar">
                <button class="rubot-tab-btn active" data-tab="brain">\u{1F9E0} Brain</button>
                <button class="rubot-tab-btn" data-tab="intel">\u{1F4CA} Intel</button>
                <button class="rubot-tab-btn" data-tab="toggles">\u2699\uFE0F Features</button>
                <button class="rubot-tab-btn" data-tab="logs">\u{1F4CB} Activity Log</button>
            </div>

            <div class="rubot-tab-content">
                <!-- TAB 1: OLLAMA BRAIN (Initial View) -->
                <div class="rubot-tab-page active" id="rubot-page-brain">
                    <div class="rubot-status-card">
                        <div class="rubot-status-indicator">
                            <span class="rubot-status-dot offline" id="rubot-dot-ollama"></span>
                            <span id="rubot-status-ollama">Testing connection...</span>
                        </div>
                    </div>

                    <div class="rubot-field-group">
                        <label class="rubot-field-label">Ollama Host</label>
                        <input type="text" class="rubot-input" id="rubot-host-ollama" value="${CONFIG.OLLAMA_HOST}" />
                    </div>

                    <div class="rubot-field-group">
                        <label class="rubot-field-label">Model Selection (Auto-Fallback Hierarchy)</label>
                        <select class="rubot-select" id="rubot-select-model">
                            <option value="qwen2.5:7b" ${CONFIG.OLLAMA_MODEL === "qwen2.5:7b" ? "selected" : ""}>qwen2.5:7b (1st Priority Logic & Math)</option>
                            <option value="llama3.2:3b" ${CONFIG.OLLAMA_MODEL === "llama3.2:3b" ? "selected" : ""}>llama3.2:3b (2nd Priority Fast Fallback)</option>
                            <option value="llama3.1:8b" ${CONFIG.OLLAMA_MODEL === "llama3.1:8b" ? "selected" : ""}>llama3.1:8b (Deep Valuation)</option>
                            <option value="qwen3.5:4b" ${CONFIG.OLLAMA_MODEL === "qwen3.5:4b" ? "selected" : ""}>qwen3.5:4b (Thinking & Reasoning)</option>
                            <option value="llama3.2-vision:latest" ${CONFIG.OLLAMA_MODEL === "llama3.2-vision:latest" ? "selected" : ""}>llama3.2-vision:latest (Vision Capable)</option>
                            <option value="custom">Custom model...</option>
                        </select>
                        <input type="text" class="rubot-input" id="rubot-custom-model" style="display:none; margin-top: 4px;" placeholder="Model tag (e.g. qwen2.5:7b)" value="${CONFIG.OLLAMA_MODEL}" />
                    </div>

                    <button class="rubot-btn-test" id="rubot-btn-ping">\u26A1 Test & Connect Ollama</button>

                    <div class="rubot-info-box">
                        Ollama LLM acts as the master brain: evaluates trades, prevents unfair deficits, secures monopolies, plans building, and negotiates with players.
                    </div>
                </div>

                <!-- TAB: LIVE GAME INTEL & MEMORY -->
                <div class="rubot-tab-page" id="rubot-page-intel">
                    <div class="rubot-intel-page" id="rubot-intel-container">
                        <div class="rubot-intel-card">
                            <div class="rubot-intel-title">
                                <span>Game Memory Loading...</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB: FEATURE TOGGLES -->
                <div class="rubot-tab-page" id="rubot-page-toggles">
                    <div class="rubot-toggles-list">
                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Buy Land</span>
                                <span class="rubot-toggle-desc">Acquire unowned properties & utility investments</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-buy" ${CONFIG.ALWAYS_BUY_AFFORDABLE ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Win-Win Trading</span>
                                <span class="rubot-toggle-desc">Always accept monopoly completers & propose swaps</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-trade" ${CONFIG.AUTO_TRADE_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Build Houses</span>
                                <span class="rubot-toggle-desc">Proactively build houses & rush 3-house monopolies</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-build" ${CONFIG.AUTO_BUILD_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Mortgage / Debt</span>
                                <span class="rubot-toggle-desc">Liquidate dead assets to clear debt and avoid bankruptcy</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-mortgage" ${CONFIG.AUTO_MORTGAGE_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Auction Sniping</span>
                                <span class="rubot-toggle-desc">Snipe underpriced auctions & block enemy sets</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-auction" ${CONFIG.AUTO_AUCTION_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Smart Cash Reserve</span>
                                <span class="rubot-toggle-desc">Reserve cash dynamically against enemy landing zones</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-reserve" ${CONFIG.SMART_RESERVE_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Chat Engagement</span>
                                <span class="rubot-toggle-desc">Auto-replies & trade talk (OFF = completely silent)</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-chat" ${CONFIG.CHAT_ENABLED ? "checked" : ""}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- TAB 3: ACTIVITY LOG (Dedicated) -->
                <div class="rubot-tab-page" id="rubot-page-logs">
                    <div class="rubot-log-page">
                        <div class="rubot-log-toolbar">
                            <span class="rubot-log-title">Live Action Stream</span>
                            <div style="display:flex;gap:5px;">
                                <button class="rubot-btn-clear" id="rubot-btn-copy-log">Copy</button>
                                <button class="rubot-btn-clear" id="rubot-btn-clear-log">Clear</button>
                            </div>
                        </div>
                        <div class="rubot-terminal" id="rubot-terminal"></div>
                    </div>
                </div>
            </div>
        `;
      document.body.appendChild(panel);
      this.elements = {
        panel,
        phaseBadge: document.getElementById("rubot-badge-status"),
        masterBtn: document.getElementById("rubot-btn-master"),
        modeAuto: document.getElementById("rubot-mode-auto"),
        modeAdv: document.getElementById("rubot-mode-adv"),
        advisorBox: document.getElementById("rubot-advisor-box"),
        advTitle: document.getElementById("rubot-adv-title"),
        advDesc: document.getElementById("rubot-adv-desc"),
        advExec: document.getElementById("rubot-adv-exec"),
        advSkip: document.getElementById("rubot-adv-skip"),
        terminal: document.getElementById("rubot-terminal"),
        dotOllama: document.getElementById("rubot-dot-ollama"),
        statusOllama: document.getElementById("rubot-status-ollama"),
        hostInput: document.getElementById("rubot-host-ollama"),
        selectModel: document.getElementById("rubot-select-model"),
        customModel: document.getElementById("rubot-custom-model"),
        btnPing: document.getElementById("rubot-btn-ping")
      };
      this.elements.masterBtn.addEventListener("click", onToggleMaster);
      this.elements.modeAuto.addEventListener("click", () => {
        CONFIG.ADVISOR_MODE = false;
        this.elements.modeAuto.classList.add("active");
        this.elements.modeAdv.classList.remove("active");
        this.hideAdvisorBox();
        this.logTerminal("Mode: AUTO-PILOT (Fully Autonomous)");
      });
      this.elements.modeAdv.addEventListener("click", () => {
        CONFIG.ADVISOR_MODE = true;
        this.elements.modeAdv.classList.add("active");
        this.elements.modeAuto.classList.remove("active");
        this.logTerminal("Mode: ADVISOR (Human Approval)");
      });
      this.elements.advExec.addEventListener("click", () => {
        if (this.pendingAdvisorAction?.onExec) {
          this.pendingAdvisorAction.onExec();
        }
        this.hideAdvisorBox();
      });
      this.elements.advSkip.addEventListener("click", () => {
        if (this.pendingAdvisorAction?.onSkip) {
          this.pendingAdvisorAction.onSkip();
        }
        this.hideAdvisorBox();
      });
      const tabBtns = panel.querySelectorAll(".rubot-tab-btn");
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetTab = btn.getAttribute("data-tab");
          tabBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          panel.querySelectorAll(".rubot-tab-page").forEach((page) => {
            page.classList.remove("active");
          });
          const targetPage = document.getElementById(`rubot-page-${targetTab}`);
          if (targetPage) targetPage.classList.add("active");
          this.activeTab = targetTab;
          if (targetTab === "intel") this.updateIntelTab();
        });
      });
      document.getElementById("rubot-btn-clear-log").addEventListener("click", () => {
        if (this.elements.terminal) this.elements.terminal.innerHTML = "";
      });
      const copyBtn = document.getElementById("rubot-btn-copy-log");
      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          const term = this.elements.terminal;
          if (!term) return;
          const lineEls = Array.from(term.querySelectorAll(".log-line"));
          const text = lineEls.reverse().map((l) => l.innerText).join("\n") || term.innerText;
          try {
            await navigator.clipboard.writeText(text);
          } catch (_) {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          const oldText = copyBtn.innerText;
          copyBtn.innerText = "Copied!";
          copyBtn.style.color = "#34d399";
          copyBtn.style.borderColor = "rgba(52,211,153,0.5)";
          setTimeout(() => {
            copyBtn.innerText = oldText;
            copyBtn.style.color = "";
            copyBtn.style.borderColor = "";
          }, 1500);
        });
      }
      this.elements.hostInput.addEventListener("change", (e) => {
        CONFIG.OLLAMA_HOST = e.target.value.trim();
        localStorage.setItem("richup_ollama_host", CONFIG.OLLAMA_HOST);
        this.logTerminal(`Ollama host set to: ${CONFIG.OLLAMA_HOST}`);
      });
      this.elements.selectModel.addEventListener("change", (e) => {
        if (e.target.value === "custom") {
          this.elements.customModel.style.display = "block";
        } else {
          this.elements.customModel.style.display = "none";
          CONFIG.OLLAMA_MODEL = e.target.value;
          localStorage.setItem("richup_ollama_model", CONFIG.OLLAMA_MODEL);
          this.logTerminal(`Ollama model: ${CONFIG.OLLAMA_MODEL}`);
        }
      });
      this.elements.customModel.addEventListener("change", (e) => {
        CONFIG.OLLAMA_MODEL = e.target.value.trim();
        localStorage.setItem("richup_ollama_model", CONFIG.OLLAMA_MODEL);
        this.logTerminal(`Ollama model set to: ${CONFIG.OLLAMA_MODEL}`);
      });
      const testOllama = async () => {
        this.elements.statusOllama.textContent = "Connecting...";
        this.elements.dotOllama.className = "rubot-status-dot";
        const res = await OllamaClient.checkHealth();
        if (res.ok) {
          this.elements.dotOllama.className = "rubot-status-dot online";
          const found = res.models.find((m) => m.includes(CONFIG.OLLAMA_MODEL)) || res.models[0] || CONFIG.OLLAMA_MODEL;
          this.elements.statusOllama.textContent = `Connected (${CONFIG.OLLAMA_MODEL})`;
          CONFIG.OLLAMA_ENABLED = true;
          localStorage.setItem("richup_ollama_enabled", "true");
          this.logTerminal(`Ollama connected: ${found}. Brain online!`);
        } else {
          this.elements.dotOllama.className = "rubot-status-dot offline";
          this.elements.statusOllama.textContent = `Disconnected: ${res.error || "Check host"}`;
          this.logTerminal(`Ollama offline: ${res.error || "Connection failed"}`);
        }
      };
      this.elements.btnPing.addEventListener("click", testOllama);
      document.getElementById("rubot-chk-buy").addEventListener("change", (e) => {
        CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked;
        localStorage.setItem("richup_cfg_buy", String(e.target.checked));
      });
      document.getElementById("rubot-chk-trade").addEventListener("change", (e) => {
        CONFIG.AUTO_TRADE_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_trade", String(e.target.checked));
      });
      document.getElementById("rubot-chk-build").addEventListener("change", (e) => {
        CONFIG.AUTO_BUILD_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_build", String(e.target.checked));
      });
      document.getElementById("rubot-chk-mortgage").addEventListener("change", (e) => {
        CONFIG.AUTO_MORTGAGE_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_mortgage", String(e.target.checked));
      });
      document.getElementById("rubot-chk-auction").addEventListener("change", (e) => {
        CONFIG.AUTO_AUCTION_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_auction", String(e.target.checked));
      });
      document.getElementById("rubot-chk-reserve").addEventListener("change", (e) => {
        CONFIG.SMART_RESERVE_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_reserve", String(e.target.checked));
      });
      document.getElementById("rubot-chk-chat").addEventListener("change", (e) => {
        CONFIG.CHAT_ENABLED = e.target.checked;
        localStorage.setItem("richup_cfg_chat", String(e.target.checked));
        this.logTerminal(`Chat Engagement: ${e.target.checked ? "ENABLED (Casual human replies)" : "DISABLED (100% silent)"}`);
      });
      this.initDragAndPersistence();
      window.__richupLogTerminal = (msg) => this.logTerminal(msg);
      this.logTerminal("RichUp Bot v5.0 initialized. Ready for gameplay.");
      setInterval(() => {
        if (this.activeTab === "intel") {
          this.updateIntelTab();
        }
      }, 1200);
      setTimeout(testOllama, 400);
    },
    isProposalActive(title) {
      return Boolean(
        this.pendingAdvisorAction && this.elements.advisorBox && this.elements.advisorBox.style.display !== "none" && this.elements.advTitle && this.elements.advTitle.textContent === title
      );
    },
    showAdvisorProposal(title, desc, onExec, onSkip) {
      if (!this.elements.advisorBox) return;
      this.elements.advTitle.textContent = title;
      this.elements.advDesc.textContent = desc;
      this.elements.advisorBox.style.display = "flex";
      this.pendingAdvisorAction = { onExec, onSkip };
    },
    hideAdvisorBox() {
      if (!this.elements.advisorBox) return;
      this.elements.advisorBox.style.display = "none";
      this.pendingAdvisorAction = null;
    },
    updateMasterButton(isActive) {
      if (!this.elements.masterBtn) return;
      if (isActive) {
        this.elements.masterBtn.classList.add("active");
        this.elements.masterBtn.textContent = "\u25A0 STOP BOT  [=]";
        this.elements.phaseBadge.classList.add("active");
        this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? "ADVISOR" : "ACTIVE";
      } else {
        this.elements.masterBtn.classList.remove("active");
        this.elements.masterBtn.textContent = "\u25B6 START BOT  [=]";
        this.elements.phaseBadge.classList.remove("active");
        this.elements.phaseBadge.textContent = "STANDBY";
      }
    },
    updateTelemetry() {
      if (this.elements.phaseBadge) {
        const isActive = this.elements.masterBtn && this.elements.masterBtn.classList.contains("active");
        if (isActive) {
          this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? "ADVISOR" : "ACTIVE";
        }
      }
      if (this.activeTab === "intel") {
        this.updateIntelTab();
      }
    },
    appendLog(msg) {
      this.logTerminal(msg);
    },
    logTerminal(msg) {
      if (!this.elements.terminal) return;
      const now = /* @__PURE__ */ new Date();
      const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const line = document.createElement("div");
      line.className = "log-line";
      const tsPart = document.createElement("span");
      tsPart.className = "log-ts";
      tsPart.textContent = ts;
      const msgPart = document.createElement("span");
      msgPart.className = "log-msg";
      msgPart.textContent = msg;
      if (msg.includes("ACTION") || msg.includes("EV+") || msg.includes("Accept") || msg.includes("online") || msg.includes("Deal")) {
        line.classList.add("green");
      } else if (msg.includes("TRADE") || msg.includes("Brain") || msg.includes("Ollama") || msg.includes("STRATEGY")) {
        line.classList.add("violet");
      } else if (msg.includes("Caution") || msg.includes("Reserve") || msg.includes("Decline")) {
        line.classList.add("amber");
      } else if (msg.includes("ERROR") || msg.includes("DEBT") || msg.includes("MORTGAGE") || msg.includes("offline") || msg.includes("Bankrupt")) {
        line.classList.add("red");
      }
      line.appendChild(tsPart);
      line.appendChild(msgPart);
      this.elements.terminal.insertBefore(line, this.elements.terminal.firstChild);
      if (this.elements.terminal.childNodes.length > this.maxLogs) {
        this.elements.terminal.removeChild(this.elements.terminal.lastChild);
      }
    },
    saveGeometry() {
      const panel = this.elements.panel;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const geom = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      try {
        localStorage.setItem("richup_hud_geometry", JSON.stringify(geom));
      } catch (_) {
      }
    },
    initDragAndPersistence() {
      const handle = document.getElementById("rubot-hud-drag");
      const panel = this.elements.panel;
      handle.addEventListener("mousedown", (e) => {
        this.drag.active = true;
        this.drag.startX = e.clientX;
        this.drag.startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        this.drag.initialLeft = rect.left;
        this.drag.initialTop = rect.top;
        handle.style.cursor = "grabbing";
      });
      document.addEventListener("mousemove", (e) => {
        if (this.drag.active) {
          e.preventDefault();
          const deltaX = e.clientX - this.drag.startX;
          const deltaY = e.clientY - this.drag.startY;
          panel.style.left = `${Math.max(0, this.drag.initialLeft + deltaX)}px`;
          panel.style.top = `${Math.max(0, this.drag.initialTop + deltaY)}px`;
        }
      });
      document.addEventListener("mouseup", () => {
        if (this.drag.active) {
          this.drag.active = false;
          if (handle) handle.style.cursor = "grab";
          this.saveGeometry();
        }
      });
      const resizeObserver = new ResizeObserver(() => {
        this.saveGeometry();
      });
      resizeObserver.observe(panel);
    },
    updateIntelTab() {
      const container = document.getElementById("rubot-intel-container");
      if (!container) return;
      const inRoom = window.location.pathname.includes("/room/") || !!document.querySelector('[class*="board" i]');
      if (!inRoom) {
        container.innerHTML = `
                <div style="text-align: center; padding: 28px 14px; color: rgba(196,181,253,0.8);">
                    <div style="font-size: 28px; margin-bottom: 8px;">\u{1F3AE}</div>
                    <div style="font-weight: 700; font-size: 13px; color: #a78bfa; margin-bottom: 6px; letter-spacing: 0.5px;">WAITING FOR GAME TO START</div>
                    <div style="font-size: 11px; line-height: 1.5; color: rgba(196,181,253,0.6);">Join or create a match room to populate live player inventories, monopoly trackers, and real-time trade analytics.</div>
                </div>
            `;
        return;
      }
      const myName = GameMemory.myName || "matrix";
      const myCash = GameMemory.myCash;
      const myTiles = BOARD_TILES.filter((t) => t.group && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
      const myMonopolies = [];
      for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
        if (groupName === "Airport" || groupName === "Utility") continue;
        if (groupTiles.every((t) => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
          myMonopolies.push(groupName);
        }
      }
      const oppData = OpponentTracker.analyzeOpponents();
      const unownedCount = GameMemory.getUnownedPropertyCount();
      let html = `
            <div class="rubot-intel-card">
                <div class="rubot-intel-title">
                    <span>\u{1F451} ME (${myName})</span>
                    <span class="rubot-intel-badge green">$${myCash}</span>
                </div>
                <div class="rubot-intel-content">
                    <b>Properties (${myTiles.length}):</b> ${myTiles.length > 0 ? myTiles.map((t) => {
        const h = GameMemory.ownership[t.id]?.houses || 0;
        const hStr = h === 5 ? " [\u{1F3E8}]" : h > 0 ? ` [\u{1F3E0}x${h}]` : "";
        return `${t.name}${hStr}`;
      }).join(", ") : "None yet"}<br>
                    <b>Monopolies:</b> ${myMonopolies.length > 0 ? myMonopolies.map((m) => `<span class="rubot-intel-badge green">${m}</span>`).join(" ") : '<span style="color:rgba(196,181,253,0.5)">None</span>'}
                </div>
            </div>

            <div class="rubot-intel-card">
                <div class="rubot-intel-title">
                    <span>\u{1F465} OPPONENTS INVENTORIES</span>
                    <span class="rubot-intel-badge amber">${Object.keys(oppData).length} Tracked</span>
                </div>
                <div class="rubot-intel-content">
        `;
      const oppEntries = Object.entries(oppData);
      if (oppEntries.length === 0) {
        html += `<span style="color:rgba(196,181,253,0.5)">Auto-scanning scoreboard...</span>`;
      } else {
        for (const [pName, data] of oppEntries) {
          const hungryStr = data.hungrySets.length > 0 ? data.hungrySets.map((h) => `<span class="rubot-intel-badge red">${h.group} ${h.ownedCount}/${h.total}</span>`).join(" ") : "";
          const propStr = data.ownedTiles.length > 0 ? data.ownedTiles.map((t) => t.name).join(", ") : "None yet";
          const declCount = typeof GameMemory.getDeclinedCountForPlayer === "function" ? GameMemory.getDeclinedCountForPlayer(pName) : 0;
          const declBadge = declCount > 0 ? `<span class="rubot-intel-badge red">${declCount} Declined</span>` : "";
          const pos = GameMemory.players[pName]?.pos;
          const posStr = typeof pos === "number" ? `Tile #${pos}` : "Tile #0";
          html += `
                    <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(139,92,246,0.12);">
                        <b>${pName}:</b> <span class="rubot-intel-badge green">$${data.cash}</span> <span class="rubot-intel-badge">${posStr}</span> ${hungryStr} ${declBadge}<br>
                        <span style="color: rgba(196,181,253,0.7);">${propStr}</span>
                    </div>
                `;
        }
      }
      html += `
                </div>
            </div>

            <div class="rubot-intel-card">
                <div class="rubot-intel-title">
                    <span>\u{1F5FA}\uFE0F BOARD & STRATEGY STATUS</span>
                    <span class="rubot-intel-badge">${unownedCount} Unowned</span>
                </div>
                <div class="rubot-intel-content">
                    <b>Chat Engagement:</b> ${CONFIG.CHAT_ENABLED ? '<span class="rubot-intel-badge green">ACTIVE (Smart/Casual)</span>' : '<span class="rubot-intel-badge red">SILENT (Off)</span>'}<br>
                    <b>Ollama Brain:</b> <span class="rubot-intel-badge green">${CONFIG.OLLAMA_MODEL}</span>
                </div>
            </div>
        `;
      container.innerHTML = html;
    }
  };

  // src/dom/actionExecutor.js
  var isActing = false;
  var isEvaluatingTrade = false;
  var isBuyingLand = false;
  var processedTradeSignatures = /* @__PURE__ */ new Map();
  function getIsActing() {
    return isActing;
  }
  function logToBot(msg) {
    console.log(`[RichUp AI] ${(/* @__PURE__ */ new Date()).toISOString()} - ${msg}`);
    if (window.__richupLogTerminal) {
      window.__richupLogTerminal(msg);
    }
  }
  function delayClick(el, reason = "") {
    if (!el || isActing) return false;
    isActing = true;
    const delay = Math.floor(Math.random() * (CONFIG.ACTION_DELAY_MAX - CONFIG.ACTION_DELAY_MIN + 1)) + CONFIG.ACTION_DELAY_MIN;
    logToBot(`[ACTION] ${reason} (in ${delay}ms)`);
    setTimeout(() => {
      try {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        try {
          if (typeof el.focus === "function") el.focus();
          el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        } catch (_) {
        }
        el.click();
      } catch (err) {
        logToBot(`Click error: ${err}`);
      } finally {
        setTimeout(() => {
          isActing = false;
        }, 400);
      }
    }, delay);
    return true;
  }
  function executeOrAdvise({ el, title, reason, onExecute, onSkip }) {
    if (!el || isActing) return false;
    if (CONFIG.ADVISOR_MODE) {
      if (HUDPanel.isProposalActive(title)) {
        return true;
      }
      HUDPanel.showAdvisorProposal(
        title,
        reason,
        () => {
          HUDPanel.hideAdvisorBox();
          if (onExecute) onExecute();
          else delayClick(el, reason);
        },
        () => {
          HUDPanel.hideAdvisorBox();
          logToBot(`[ADVISOR] Action skipped by user.`);
          if (onSkip) onSkip();
        }
      );
      return true;
    }
    if (onExecute) onExecute();
    else delayClick(el, reason);
    return true;
  }
  var ActionExecutor = {
    handleConfirmationModal(snapshot) {
      const confirmBtn = snapshot.findConfirmationModalButton ? snapshot.findConfirmationModalButton() : null;
      if (confirmBtn) {
        logToBot("[MODAL ACTION] Secondary confirmation dialog detected. Confirming action...");
        delayClick(confirmBtn, "Confirm secondary action prompt");
        return true;
      }
      return false;
    },
    async handleTrade(snapshot) {
      const sidebarTrade = snapshot.findSidebarIncomingTradeItem();
      const confirmBtn = snapshot.findTradeConfirmButton();
      const declineBtn = snapshot.findTradeDeclineButton();
      const negotiateBtn = snapshot.findTradeNegotiateButton();
      if (!confirmBtn && !declineBtn && sidebarTrade) {
        logToBot("[TRADE] Incoming trade row detected in sidebar. Opening trade modal...");
        delayClick(sidebarTrade, "Open incoming trade from sidebar");
        return true;
      }
      if (!declineBtn && !confirmBtn) return false;
      if (isEvaluatingTrade) return true;
      const tradeData = scrapeTradeModalDOM();
      const sig = `${tradeData.partnerName || "Unknown"}_give:${(tradeData.givenTiles || []).map((t) => t.id).sort().join(",")}_$${tradeData.givenCash || 0}_recv:${(tradeData.receivedTiles || []).map((t) => t.id).sort().join(",")}_$${tradeData.receivedCash || 0}`;
      const now = Date.now();
      for (const [key, ts] of processedTradeSignatures.entries()) {
        if (now - ts > 6e4) processedTradeSignatures.delete(key);
      }
      if (processedTradeSignatures.has(sig) && now - processedTradeSignatures.get(sig) < 15e3) {
        return true;
      }
      if (!CONFIG.AUTO_TRADE_ENABLED) {
        if (declineBtn) {
          processedTradeSignatures.set(sig, now);
          delayClick(declineBtn, "Auto-declining trade (Auto-Trade disabled)");
          return true;
        }
        return false;
      }
      isEvaluatingTrade = true;
      processedTradeSignatures.set(sig, now);
      try {
        logToBot("[TRADE] Evaluating incoming trade with Hybrid Brain...");
        const verdict = await OllamaClient.evaluateTradeWithLLM(tradeData);
        logToBot(`Trade Verdict: ${verdict.reason}`);
        if (verdict.negotiate && negotiateBtn) {
          return executeOrAdvise({
            el: negotiateBtn,
            title: "NEGOTIATE INCOMING TRADE",
            reason: verdict.reason,
            onExecute: () => {
              if (verdict.chatReply) ChatEngine.sendChatMessage("tradeNegotiate", verdict.chatReply);
              delayClick(negotiateBtn, `Negotiating trade (${verdict.reason})`);
            }
          });
        }
        if (verdict.accept && confirmBtn) {
          return executeOrAdvise({
            el: confirmBtn,
            title: "CONFIRM INCOMING TRADE",
            reason: verdict.reason,
            onExecute: () => {
              if (verdict.chatReply) ChatEngine.sendChatMessage("tradeAccept", verdict.chatReply);
              delayClick(confirmBtn, `Confirming trade (${verdict.reason})`);
            }
          });
        }
        if (declineBtn) {
          return executeOrAdvise({
            el: declineBtn,
            title: "DECLINE INCOMING TRADE",
            reason: verdict.reason,
            onExecute: () => {
              if (verdict.chatReply) ChatEngine.sendChatMessage("tradeReject", verdict.chatReply);
              delayClick(declineBtn, `Declining trade (${verdict.reason})`);
              if (verdict.counterSwap && CONFIG.AUTO_TRADE_ENABLED) {
                logToBot(`[COUNTER TRADE] Scheduling counter-proposal for ${verdict.counterSwap.targetOwner}...`);
                setTimeout(() => {
                  if (!TradeProposalExecutor.isExecuting) {
                    TradeProposalExecutor.executeProposal(verdict.counterSwap);
                  }
                }, 1800);
              }
            }
          });
        }
        return false;
      } finally {
        isEvaluatingTrade = false;
      }
    },
    /**
     * Proactively opens the Trade UI and submits win-win trade proposals!
     */
    handleProactiveTrade(snapshot) {
      if (!CONFIG.AUTO_TRADE_ENABLED || TradeProposalExecutor.isExecuting) return false;
      const createBtn = snapshot.findCreateTradeButton();
      if (!createBtn) return false;
      const swaps = TradeEngine.scanMutualMonopolySwaps();
      if (swaps.length === 0) return false;
      const validSwap = swaps.find(
        (s) => TradeProposalExecutor.canProposeToPlayer(s.targetOwner) && !TradeProposalExecutor.isSwapSkipped(s.summary)
      );
      if (!validSwap) return false;
      const cashText = validSwap.cashDemand > 0 ? ` (+ ask $${validSwap.cashDemand})` : validSwap.cashOffer > 0 ? ` (+ offer $${validSwap.cashOffer})` : "";
      return executeOrAdvise({
        el: createBtn,
        title: `PROPOSE TRADE WITH ${validSwap.targetOwner.toUpperCase()}`,
        reason: `${validSwap.summary}${cashText}. Both get monopolies!`,
        onExecute: () => {
          TradeProposalExecutor.executeProposal(validSwap);
        },
        onSkip: () => {
          TradeProposalExecutor.recordSkipped(validSwap.summary);
        }
      });
    },
    handleJail(snapshot) {
      const pardonBtn = snapshot.findExactOrIncludes(["use pardon", "pardon card", "use card", "get out of jail"]);
      const payBailBtn = snapshot.findExactOrIncludes(["get free for", "pay $50", "pay 50"]);
      const rollBtn = snapshot.findExactOrIncludes(["roll the dice", "roll again", "roll"]);
      if (!pardonBtn && !payBailBtn) return false;
      GameMemory.myPos = 10;
      GameMemory.inJail = true;
      const decision = JailStrategy.shouldPayToLeaveJail(GameMemory.myCash);
      if (decision.exit) {
        if (pardonBtn) {
          return executeOrAdvise({
            el: pardonBtn,
            title: "USE PARDON CARD",
            reason: decision.reason,
            onExecute: () => {
              GameMemory.inJail = false;
              delayClick(pardonBtn, decision.reason);
            }
          });
        }
        if (payBailBtn) {
          return executeOrAdvise({
            el: payBailBtn,
            title: "PAY $50 JAIL BAIL",
            reason: decision.reason,
            onExecute: () => {
              if (GameMemory.myCash >= 50) GameMemory.myCash -= 50;
              GameMemory.inJail = false;
              delayClick(payBailBtn, decision.reason);
            }
          });
        }
      } else {
        logToBot(`Jail: Staying safe in cell (${decision.reason})`);
      }
      if (rollBtn) {
        return executeOrAdvise({
          el: rollBtn,
          title: "ROLL IN JAIL (Safe Stay)",
          reason: "Rolling dice to stay safe in cell or leave on doubles.",
          onExecute: () => delayClick(rollBtn, "Rolling in Jail")
        });
      }
      return false;
    },
    handleBuyOrAuction(snapshot) {
      let tile = BOARD_TILES[GameMemory.myPos] || null;
      const buyBtn = snapshot.findBuyPropertyButton ? snapshot.findBuyPropertyButton(tile) : null;
      const auctionBtn = snapshot.findExactOrIncludes(["auction", "pass", "don't buy"]);
      if (isBuyingLand) return false;
      if (!buyBtn && !auctionBtn && !GameMemory.isMyTurn) {
        return false;
      }
      if (buyBtn) {
        let container = buyBtn.parentElement;
        for (let depth = 0; depth < 5 && container && container !== document.body; depth++) {
          const cText = container.innerText || "";
          for (const t of BOARD_TILES) {
            if (t.group && new RegExp(`\\b${t.name}\\b`, "i").test(cText)) {
              tile = t;
              GameMemory.myPos = t.id;
              break;
            }
          }
          if (tile) break;
          container = container.parentElement;
        }
      }
      if (!tile && BOARD_TILES[GameMemory.myPos]?.group) {
        tile = BOARD_TILES[GameMemory.myPos];
      }
      const isPurchasable = tile && tile.group && (tile.type === "property" || tile.type === "airport" || tile.type === "utility");
      const owner = tile ? GameMemory.ownership[tile.id]?.owner : null;
      if (GameMemory.isMyTurn && isPurchasable && !owner && !buyBtn && !auctionBtn) {
        const now = Date.now();
        if (!this._lastPendingBuyLog || now - this._lastPendingBuyLog > 2500) {
          this._lastPendingBuyLog = now;
          logToBot(`[BUY PENDING] Standing on unowned ${tile.name} (Tile #${tile.id}, $${tile.price || 0}), scanning DOM for Buy prompt...`);
        }
        return false;
      }
      if (!buyBtn && !auctionBtn) return false;
      const effectiveCash = Math.max(GameMemory.myCash, GameMemory.players[GameMemory.myName]?.cash || 0);
      if (buyBtn) {
        const btnText = normalizeText(buyBtn);
        const priceMatch = /\$?\s*(\d{2,4})|(\d{2,4})\s*\$/.exec(btnText);
        const price = priceMatch ? parseInt(priceMatch[1] || priceMatch[2], 10) : tile?.price || 60;
        if (GameMemory.myName && GameMemory.players[GameMemory.myName]?.cash !== void 0) {
          const sbCash = GameMemory.players[GameMemory.myName].cash;
          if (typeof sbCash === "number") {
            GameMemory.myCash = sbCash;
          }
        }
        const candidateCash = Math.max(effectiveCash, price);
        const decision = MarkovRisk.shouldBuyProperty(tile, price, candidateCash);
        logToBot(`[BUY EVAL] ${tile ? tile.name : "Property"} ($${price}) | My Cash: $${effectiveCash} | Decision: ${decision.buy ? "BUY" : "SKIP"} (${decision.reason})`);
        if (decision.buy) {
          isBuyingLand = true;
          setTimeout(() => {
            isBuyingLand = false;
          }, 2e3);
          return executeOrAdvise({
            el: buyBtn,
            title: `BUY ${tile ? tile.name.toUpperCase() : "PROPERTY"} ($${price})`,
            reason: decision.reason,
            onExecute: () => {
              logToBot(`[BUY ACTION] Executing direct purchase for ${tile ? tile.name : "Property"} ($${price})`);
              if (tile && GameMemory.ownership[tile.id]) {
                GameMemory.ownership[tile.id].owner = GameMemory.myName || "__ME__";
              }
              if (price > 0 && GameMemory.myCash >= price) {
                GameMemory.myCash -= price;
              }
              delayClick(buyBtn, decision.reason);
            }
          });
        }
        const auctionCheck = AuctionSniper.shouldSendToAuctionInsteadOfBuy(tile, price, candidateCash);
        logToBot(`[AUCTION EVAL] ${tile ? tile.name : "Property"} ($${price}) -> Send to auction? ${auctionCheck.auction ? "YES" : "NO"} (${auctionCheck.reason})`);
        if (auctionCheck.auction && auctionBtn) {
          return executeOrAdvise({
            el: auctionBtn,
            title: "TRIGGER AUCTION",
            reason: auctionCheck.reason,
            onExecute: () => {
              logToBot(`[AUCTION ACTION] Sending ${tile ? tile.name : "Property"} to auction`);
              delayClick(auctionBtn, auctionCheck.reason);
            }
          });
        }
      }
      if (auctionBtn) {
        logToBot(`[AUCTION EVAL] Cannot afford direct purchase; sending property to auction.`);
        return executeOrAdvise({
          el: auctionBtn,
          title: "PASS / AUCTION PROPERTY",
          reason: "Cannot afford direct purchase; sending property to auction.",
          onExecute: () => delayClick(auctionBtn, "Sending to Auction")
        });
      }
      return false;
    },
    handleAuction(snapshot) {
      if (!CONFIG.AUTO_AUCTION_ENABLED) return false;
      let bidBtn = snapshot.findAuctionBidButton();
      const passBtn = snapshot.findAuctionPassButton();
      if (!bidBtn && !passBtn) return false;
      const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="auction"]');
      const modalText = modal ? modal.innerText : document.body ? document.body.innerText : "";
      let auctionedTile = null;
      for (const t of BOARD_TILES) {
        if (t.group && new RegExp(`\\b${t.name}\\b`, "i").test(modalText)) {
          auctionedTile = t;
          break;
        }
      }
      if (!auctionedTile) {
        auctionedTile = BOARD_TILES[GameMemory.myPos] || null;
      }
      const bidMatch = /highest bid:?\s*\$?(\d+)|current bid:?\s*\$?(\d+)/i.exec(modalText);
      const currentBid = bidMatch ? parseInt(bidMatch[1] || bidMatch[2], 10) : 50;
      const decision = AuctionSniper.evaluateAuctionStep(auctionedTile, currentBid, GameMemory.myCash);
      bidBtn = snapshot.findAuctionBidButton(decision.increment) || bidBtn;
      if (decision.shouldBid && bidBtn) {
        return executeOrAdvise({
          el: bidBtn,
          title: `AUCTION BID: +$${decision.increment} [${auctionedTile ? auctionedTile.name : "Tile"}]`,
          reason: decision.reason,
          onExecute: () => delayClick(bidBtn, decision.reason)
        });
      }
      if (passBtn) {
        return executeOrAdvise({
          el: passBtn,
          title: `AUCTION PASS [${auctionedTile ? auctionedTile.name : "Tile"}]`,
          reason: decision.reason,
          onExecute: () => delayClick(passBtn, decision.reason)
        });
      }
      if (modal) {
        return true;
      }
      return false;
    },
    async handleHouseBuilding(snapshot) {
      if (!CONFIG.AUTO_BUILD_ENABLED) return false;
      const hasTurnControls = Boolean(snapshot.findExactOrIncludes(["roll the dice", "roll again", "end turn"]));
      if (!hasTurnControls && !GameMemory.isMyTurn) {
        return false;
      }
      const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;
      const completeSets = [];
      const mortgagedMonopolies = [];
      for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
        if (tiles[0].type !== "property") continue;
        const { owned, total } = GameMemory.getGroupCount(groupName, "__ME__");
        if (owned === total) {
          const mortgagedTiles = tiles.filter((t) => GameMemory.ownership[t.id]?.mortgaged);
          if (mortgagedTiles.length > 0) {
            for (const mTile of mortgagedTiles) {
              const unmortgageCost = Math.round(mTile.price * 0.55);
              mortgagedMonopolies.push({
                groupName,
                tile: mTile,
                unmortgageCost,
                allTiles: tiles
              });
            }
          } else {
            const houseCounts = tiles.map((t) => GameMemory.ownership[t.id]?.houses || 0);
            const minHouses = Math.min(...houseCounts);
            const maxHouses = Math.max(...houseCounts);
            const strikeCheck = HouseBuilder.areOpponentsInStrikeZone ? HouseBuilder.areOpponentsInStrikeZone(tiles) : { oppApproaching: false };
            completeSets.push({
              groupName,
              tiles,
              minHouses,
              maxHouses,
              houseCost: tiles[0].houseCost,
              opponentsInStrikeZone: strikeCheck.oppApproaching ? `${strikeCheck.opponentName} (${strikeCheck.distance} steps)` : null
            });
          }
        }
      }
      if (completeSets.length === 0 && mortgagedMonopolies.length === 0) {
        if (openCard) {
          const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
          if (closeBtn) delayClick(closeBtn, "Closing property card: No monopolies available");
        }
        return false;
      }
      const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
      const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);
      if (GameMemory.myCash <= reserve) {
        if (openCard) {
          const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
          if (closeBtn) delayClick(closeBtn, "Closing property card: Preserving cash reserve");
        }
        return false;
      }
      let chosenAction = null;
      let chosenGroup = null;
      let chosenTile = null;
      if (CONFIG.OLLAMA_ENABLED && OllamaClient.status !== "offline") {
        const oppList = Object.entries(GameMemory.players).filter(([pName]) => !GameMemory.isMe(pName)).map(([pName, p]) => ({ name: pName, cash: p.cash, pos: p.pos || 0 }));
        const aiVerdict = await OllamaClient.evaluateHouseBuildingWithLLM({
          completeSets,
          mortgagedMonopolies,
          myCash: GameMemory.myCash,
          reserve,
          opponents: oppList,
          myPos: GameMemory.myPos,
          dangerEV: GameMemory.lastDangerEV || 0
        });
        if (aiVerdict) {
          logToBot(`[AI UPGRADE] \u{1F9E0} Ollama [${aiVerdict.modelUsed || "AI"}]: ${aiVerdict.decision} - ${aiVerdict.rationale}`);
          if (aiVerdict.decision === "WAIT") {
            if (openCard) {
              const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
              if (closeBtn) delayClick(closeBtn, "Closing property card: Ollama advised holding cash");
            }
            return false;
          }
          chosenAction = aiVerdict.decision;
          chosenGroup = aiVerdict.targetGroup;
          chosenTile = aiVerdict.targetTile;
        }
      }
      const shouldUnmortgage = chosenAction === "UNMORTGAGE" || !chosenAction && mortgagedMonopolies.some((m) => GameMemory.myCash - m.unmortgageCost >= reserve);
      if (shouldUnmortgage && mortgagedMonopolies.length > 0) {
        let targetMortgage = mortgagedMonopolies.find(
          (m) => chosenTile && m.tile.name.toLowerCase() === chosenTile.toLowerCase() || chosenGroup && m.groupName.toLowerCase() === chosenGroup.toLowerCase()
        );
        if (!targetMortgage) {
          targetMortgage = mortgagedMonopolies.find((m) => GameMemory.myCash - m.unmortgageCost >= reserve);
        }
        if (targetMortgage && GameMemory.myCash - targetMortgage.unmortgageCost >= reserve) {
          if (openCard && openCard.tile.id === targetMortgage.tile.id) {
            const unmortgageBtn = snapshot.findModalUnmortgageButton ? snapshot.findModalUnmortgageButton() : null;
            if (unmortgageBtn) {
              return executeOrAdvise({
                el: unmortgageBtn,
                title: `UNMORTGAGE MONOPOLY: ${targetMortgage.tile.name.toUpperCase()}`,
                reason: `Reclaiming ${targetMortgage.tile.name} ($${targetMortgage.unmortgageCost}) to unlock house building on ${targetMortgage.groupName}!`,
                onExecute: () => {
                  if (GameMemory.ownership[targetMortgage.tile.id]) {
                    GameMemory.ownership[targetMortgage.tile.id].mortgaged = false;
                  }
                  GameMemory.myCash -= targetMortgage.unmortgageCost;
                  delayClick(unmortgageBtn, `Unmortgaging ${targetMortgage.tile.name}`);
                }
              });
            }
          }
          if (openCard && openCard.tile.id !== targetMortgage.tile.id) {
            const sidebarItem2 = snapshot.findSidebarPropertyItem(targetMortgage.tile.name);
            if (sidebarItem2) {
              return executeOrAdvise({
                el: sidebarItem2,
                title: `SWITCH TO ${targetMortgage.tile.name.toUpperCase()} (RIGHT SIDEBAR)`,
                reason: `Switching to mortgaged ${targetMortgage.tile.name} to unmortgage for ${targetMortgage.groupName} monopoly upgrades.`,
                onExecute: () => delayClick(sidebarItem2, `Switching to ${targetMortgage.tile.name} from right sidebar`)
              });
            }
            const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
            if (closeBtn) {
              delayClick(closeBtn, `Closing card to select mortgaged ${targetMortgage.tile.name}`);
              return true;
            }
          }
          const sidebarItem = snapshot.findSidebarPropertyItem(targetMortgage.tile.name);
          if (sidebarItem) {
            return executeOrAdvise({
              el: sidebarItem,
              title: `SELECT ${targetMortgage.tile.name.toUpperCase()} (UNMORTGAGE)`,
              reason: `Opening ${targetMortgage.tile.name} from right sidebar to unmortgage and unlock house building.`,
              onExecute: () => delayClick(sidebarItem, `Opening ${targetMortgage.tile.name} from right sidebar to unmortgage`)
            });
          }
        }
      }
      if (completeSets.length > 0) {
        completeSets.sort((a, b) => {
          const powerA = GROUP_POWER[a.groupName] || 50;
          const powerB = GROUP_POWER[b.groupName] || 50;
          return powerB - powerA;
        });
        const mathCandidates = HouseBuilder.rankHouseUpgrades(GameMemory.myCash);
        let targetSet = null;
        let candidateTile = null;
        if (chosenTile || chosenGroup) {
          targetSet = completeSets.find(
            (s) => chosenGroup && s.groupName.toLowerCase() === chosenGroup.toLowerCase() && s.minHouses < 5 && GameMemory.myCash - s.houseCost >= reserve
          );
          if (targetSet) {
            if (chosenTile) {
              candidateTile = targetSet.tiles.find((t) => t.name.toLowerCase() === chosenTile.toLowerCase() && (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);
            }
            if (!candidateTile) {
              candidateTile = targetSet.tiles.find((t) => (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);
            }
          }
        }
        if (!targetSet && mathCandidates.length > 0) {
          const topMath = mathCandidates[0];
          targetSet = completeSets.find((s) => s.tiles.some((t) => t.id === topMath.tile.id));
          candidateTile = topMath.tile;
        }
        if (!targetSet) {
          targetSet = completeSets.find((s) => s.minHouses < 5 && GameMemory.myCash - s.houseCost >= reserve);
          if (targetSet) {
            candidateTile = targetSet.tiles.find((t) => (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);
          }
        }
        if (targetSet && candidateTile) {
          if (openCard && openCard.tile.id !== candidateTile.id) {
            const sidebarItem2 = snapshot.findSidebarPropertyItem(candidateTile.name);
            if (sidebarItem2) {
              return executeOrAdvise({
                el: sidebarItem2,
                title: `SWITCH TO ${candidateTile.name.toUpperCase()} (RIGHT SIDEBAR)`,
                reason: `Even building: Switching to ${candidateTile.name} from right sidebar (${targetSet.minHouses} houses).`,
                onExecute: () => delayClick(sidebarItem2, `Switching to ${candidateTile.name} from right sidebar`)
              });
            }
            const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
            if (closeBtn) {
              delayClick(closeBtn, `Closing ${openCard.tile.name} to upgrade ${candidateTile.name} evenly`);
              return true;
            }
          }
          if (openCard && openCard.tile.id === candidateTile.id) {
            const modalUpgradeBtn = snapshot.findModalUpgradeButton();
            if (modalUpgradeBtn) {
              return executeOrAdvise({
                el: modalUpgradeBtn,
                title: `UPGRADE ${candidateTile.name.toUpperCase()} [\u2191]`,
                reason: `Even building on ${targetSet.groupName}: Upgrading to ${targetSet.minHouses + 1} houses (${targetSet.minHouses} -> ${targetSet.minHouses + 1}).`,
                onExecute: () => {
                  delayClick(modalUpgradeBtn, `Building house on ${candidateTile.name}`);
                  if (GameMemory.ownership[candidateTile.id]) {
                    GameMemory.ownership[candidateTile.id].houses = targetSet.minHouses + 1;
                  }
                  GameMemory.myCash -= targetSet.houseCost;
                }
              });
            }
          }
          const sidebarItem = snapshot.findSidebarPropertyItem(candidateTile.name);
          if (sidebarItem) {
            return executeOrAdvise({
              el: sidebarItem,
              title: `SELECT ${candidateTile.name.toUpperCase()} (RIGHT SIDEBAR)`,
              reason: `Even building: Opening ${candidateTile.name} from right sidebar to build house (${targetSet.minHouses} -> ${targetSet.minHouses + 1}).`,
              onExecute: () => delayClick(sidebarItem, `Opening ${candidateTile.name} from right sidebar`)
            });
          }
        }
      }
      if (openCard) {
        const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
        if (closeBtn) delayClick(closeBtn, "Closing property card: Upgrades complete or budget limited");
      }
      return false;
    },
    /**
     * Autonomous Unmortgaging: Reclaims mortgaged properties when player has cash surplus
     */
    handleUnmortgage(snapshot) {
      if (!CONFIG.AUTO_MORTGAGE_ENABLED || GameMemory.myCash <= 0) return false;
      if (!GameMemory.isMyTurn) return false;
      const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
      const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);
      const candidates = DebtRecovery.rankUnmortgageCandidates(GameMemory.myCash, reserve);
      if (candidates.length === 0) return false;
      const unmortgageBtn = snapshot.findModalUnmortgageButton ? snapshot.findModalUnmortgageButton() : null;
      const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;
      if (unmortgageBtn && openCard) {
        const tileName = openCard.tile.name;
        return executeOrAdvise({
          el: unmortgageBtn,
          title: `UNMORTGAGE: ${tileName.toUpperCase()}`,
          reason: `Surplus cash ($${GameMemory.myCash} > $${reserve + 200}). Reclaiming ${tileName} to collect full rent!`,
          onExecute: () => {
            if (GameMemory.ownership[openCard.tile.id]) {
              GameMemory.ownership[openCard.tile.id].mortgaged = false;
            }
            delayClick(unmortgageBtn, `Unmortgaging ${tileName}`);
          }
        });
      }
      const target = candidates[0];
      const sidebarProp = snapshot.findSidebarPropertyItem(target.tile.name);
      if (sidebarProp) {
        return executeOrAdvise({
          el: sidebarProp,
          title: `OPEN ${target.tile.name.toUpperCase()} TO UNMORTGAGE`,
          reason: `Surplus funds available ($${GameMemory.myCash}). Selecting mortgaged property to restore.`,
          onExecute: () => delayClick(sidebarProp, `Opening ${target.tile.name} to unmortgage`)
        });
      }
      return false;
    },
    insolventTicks: 0,
    isLiquidating: false,
    isRollingDice: false,
    handleDebtRecovery(snapshot) {
      if (!CONFIG.AUTO_MORTGAGE_ENABLED) return false;
      if (this.isLiquidating) return true;
      const myPlayerCash = GameMemory.players[GameMemory.myName]?.cash;
      const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt || typeof myPlayerCash === "number" && myPlayerCash < 0;
      if (!isDebt) {
        this.insolventTicks = 0;
        return false;
      }
      logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets to survive...`);
      const openCard = snapshot.getOpenPropertyCard ? snapshot.getOpenPropertyCard() : null;
      if (openCard && !GameMemory.isMe(GameMemory.ownership[openCard.tile.id]?.owner)) {
        const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
        if (closeBtn) {
          delayClick(closeBtn, `Closing opponent card ${openCard.tile.name} to select our asset for liquidation`);
          return true;
        }
      }
      if (openCard && (GameMemory.ownership[openCard.tile.id]?.houses || 0) > 0 && openCard.tile.group) {
        const groupTiles = BOARD_TILES.filter((t) => t.group === openCard.tile.group);
        const maxHousesInGroup = Math.max(...groupTiles.map((t) => GameMemory.ownership[t.id]?.houses || 0));
        if ((GameMemory.ownership[openCard.tile.id]?.houses || 0) < maxHousesInGroup) {
          const siblingWithMax = groupTiles.find((t) => (GameMemory.ownership[t.id]?.houses || 0) === maxHousesInGroup);
          if (siblingWithMax) {
            const sidebarProp = snapshot.findSidebarPropertyItem(siblingWithMax.name);
            if (sidebarProp) {
              return executeOrAdvise({
                el: sidebarProp,
                title: `SWITCH TO ${siblingWithMax.name.toUpperCase()} (EVEN BUILD)`,
                reason: `Even Build requires selling from ${siblingWithMax.name} (${maxHousesInGroup} houses) before ${openCard.tile.name}.`,
                onExecute: () => delayClick(sidebarProp, `Switching to ${siblingWithMax.name} for even build`)
              });
            }
          }
        }
      }
      const targets = DebtRecovery.rankLiquidationTargets();
      const bestTarget = targets.length > 0 ? targets[0] : null;
      const hasAnyLiquidatableAsset = BOARD_TILES.some((t) => {
        const info = GameMemory.ownership[t.id];
        return info && GameMemory.isMe(info.owner) && (!info.mortgaged || (info.houses || 0) > 0);
      });
      if (!hasAnyLiquidatableAsset && !openCard) {
        this.insolventTicks = (this.insolventTicks || 0) + 1;
        logToBot(`[INSOLVENCY CHECK] Negative balance ($${GameMemory.myCash}) with zero assets or houses left (Tick ${this.insolventTicks}/4)...`);
        if (this.insolventTicks >= 4) {
          const bankruptBtn = snapshot.findBankruptButton ? snapshot.findBankruptButton() : snapshot.findExactOrIncludes(["bankrupt"]);
          if (bankruptBtn) {
            return executeOrAdvise({
              el: bankruptBtn,
              title: "DECLARE BANKRUPTCY (INSOLVENT)",
              reason: `Negative balance ($${GameMemory.myCash}) with zero remaining assets or houses. Conceding match gracefully.`,
              onExecute: () => {
                delayClick(bankruptBtn, "Declaring bankruptcy due to complete insolvency");
              }
            });
          }
        }
        return false;
      } else {
        this.insolventTicks = 0;
      }
      if (openCard && GameMemory.ownership[openCard.tile.id]?.mortgaged) {
        if (bestTarget) {
          const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
          if (sidebarProp) {
            return executeOrAdvise({
              el: sidebarProp,
              title: `SWITCH TO ${bestTarget.tile.name.toUpperCase()} (RIGHT SIDEBAR) TO LIQUIDATE`,
              reason: `In debt ($${GameMemory.myCash}). Current open card is already mortgaged; switching directly from right sidebar.`,
              onExecute: () => delayClick(sidebarProp, `Switching to ${bestTarget.tile.name} from right sidebar`)
            });
          }
        }
        const closeBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
        if (closeBtn) {
          delayClick(closeBtn, `Closing already-mortgaged ${openCard.tile.name} to select unmortgaged asset`);
          return true;
        }
      }
      if (openCard && bestTarget && openCard.tile.id !== bestTarget.tile.id) {
        const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
        if (sidebarProp) {
          return executeOrAdvise({
            el: sidebarProp,
            title: `SWITCH TO ${bestTarget.tile.name.toUpperCase()} (RIGHT SIDEBAR) TO LIQUIDATE`,
            reason: `In debt ($${GameMemory.myCash}). Switching from ${openCard.tile.name} to lower sacrifice asset ${bestTarget.tile.name}.`,
            onExecute: () => delayClick(sidebarProp, `Switching to ${bestTarget.tile.name} from right sidebar for debt recovery`)
          });
        }
      }
      if (openCard && !GameMemory.ownership[openCard.tile.id]?.mortgaged) {
        const mortgageBtn = snapshot.findModalMortgageButton();
        if (mortgageBtn && (GameMemory.ownership[openCard.tile.id]?.houses || 0) === 0) {
          const tileName = openCard.tile.name;
          return executeOrAdvise({
            el: mortgageBtn,
            title: `MORTGAGE: ${tileName.toUpperCase()}`,
            reason: `In debt ($${GameMemory.myCash})! Mortgaging asset to clear debt immediately.`,
            onExecute: () => {
              this.isLiquidating = true;
              setTimeout(() => {
                this.isLiquidating = false;
              }, 800);
              if (GameMemory.ownership[openCard.tile.id]) {
                GameMemory.ownership[openCard.tile.id].mortgaged = true;
              }
              delayClick(mortgageBtn, `Clicking Mortgage button to clear debt`);
            }
          });
        }
        const sellHouseBtn = snapshot.findModalSellHouseButton();
        if (sellHouseBtn && (GameMemory.ownership[openCard.tile.id]?.houses || 0) > 0) {
          return executeOrAdvise({
            el: sellHouseBtn,
            title: `SELL HOUSE: ${openCard.tile.name.toUpperCase()} [\u2193]`,
            reason: `In debt ($${GameMemory.myCash})! Selling house to clear debt immediately.`,
            onExecute: () => {
              this.isLiquidating = true;
              setTimeout(() => {
                this.isLiquidating = false;
              }, 800);
              delayClick(sellHouseBtn, "Clicking [\u2193] to sell house");
            }
          });
        }
      }
      if (bestTarget) {
        const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
        if (sidebarProp) {
          return executeOrAdvise({
            el: sidebarProp,
            title: `OPEN ${bestTarget.tile.name.toUpperCase()} (RIGHT SIDEBAR) TO LIQUIDATE`,
            reason: `In debt ($${GameMemory.myCash}). Selecting lowest sacrifice asset from right sidebar to mortgage.`,
            onExecute: () => delayClick(sidebarProp, `Opening ${bestTarget.tile.name} from right sidebar for debt recovery`)
          });
        }
      }
      return false;
    },
    handleRollDice(snapshot) {
      if (this.isRollingDice) return false;
      const rollBtn = snapshot.findExactOrIncludes(["roll the dice", "roll again"]);
      if (!rollBtn) return false;
      const standingTile = BOARD_TILES[GameMemory.myPos];
      const buyBtn = snapshot.findBuyPropertyButton ? snapshot.findBuyPropertyButton(standingTile) : null;
      const auctionBtn = snapshot.findExactOrIncludes(["auction", "pass", "don't buy"]);
      const isPurchasable = standingTile && standingTile.group && (standingTile.type === "property" || standingTile.type === "airport" || standingTile.type === "utility");
      const isUnowned = isPurchasable && !GameMemory.ownership[standingTile.id]?.owner;
      if (buyBtn || auctionBtn || isUnowned) {
        logToBot(`[DICE GUARD] Buy/Auction pending for ${standingTile?.name || "tile"}. Prioritizing purchase before roll.`);
        if (this.handleBuyOrAuction(snapshot)) {
          return true;
        }
        if (isUnowned && !buyBtn && !auctionBtn) {
          return false;
        }
      }
      GameMemory.isMyTurn = true;
      logToBot(`[DICE ACTION] It's my turn! Rolling dice (Turn #${GameMemory.turnCount + 1}) | Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`);
      return executeOrAdvise({
        el: rollBtn,
        title: `ROLL THE DICE (Turn #${GameMemory.turnCount + 1})`,
        reason: `My turn! Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`,
        onExecute: () => {
          this.isRollingDice = true;
          setTimeout(() => {
            this.isRollingDice = false;
          }, 2200);
          GameMemory.turnCount++;
          delayClick(rollBtn, `Rolling dice`);
        }
      });
    },
    lastDeliberatedTurn: -1,
    isEndingTurn: false,
    unownedTileWaitCount: 0,
    lastGuardedTileId: -1,
    _lastPendingBuyLog: 0,
    async deliberateBeforeEndTurn(snapshot) {
      const endTurnBtn = snapshot.findExactOrIncludes(["end turn", "done", "continue"]);
      if (!endTurnBtn) return false;
      const myPlayerCash = GameMemory.players[GameMemory.myName]?.cash;
      const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt || typeof myPlayerCash === "number" && myPlayerCash < 0;
      if (isDebt) {
        logToBot(`[DEBT GUARD] Cannot end turn while in debt ($${GameMemory.myCash}). Liquidating assets to survive...`);
        if (this.handleDebtRecovery(snapshot)) {
          return true;
        }
        return false;
      }
      const standingTile = BOARD_TILES[GameMemory.myPos];
      const isPurchasable = standingTile && standingTile.group && (standingTile.type === "property" || standingTile.type === "airport" || standingTile.type === "utility");
      const currentOwner = standingTile ? GameMemory.ownership[standingTile.id]?.owner : null;
      const isUnowned = isPurchasable && !currentOwner;
      const effectiveCash = Math.max(GameMemory.myCash, GameMemory.players[GameMemory.myName]?.cash || 0);
      const canAfford = standingTile ? effectiveCash >= (standingTile.price || 0) : false;
      if (isUnowned && canAfford) {
        if (this.lastGuardedTileId !== standingTile.id) {
          this.lastGuardedTileId = standingTile.id;
          this.unownedTileWaitCount = 0;
        }
        if (this.handleBuyOrAuction(snapshot)) {
          return true;
        }
        if (this.unownedTileWaitCount < 4) {
          this.unownedTileWaitCount++;
          if (this.unownedTileWaitCount === 1) {
            logToBot(`[TURN GUARD] Holding 'End Turn' on ${standingTile.name} ($${standingTile.price}) to allow Buy prompt to render...`);
          }
          return false;
        } else {
          logToBot(`[TURN GUARD TIMEOUT] Prompt did not appear for ${standingTile.name} ($${standingTile.price}). Proceeding.`);
        }
      } else {
        this.unownedTileWaitCount = 0;
        this.lastGuardedTileId = -1;
      }
      if (CONFIG.AUTO_TRADE_ENABLED && !TradeProposalExecutor.isExecuting) {
        try {
          if (this.handleProactiveTrade(snapshot)) {
            return true;
          }
        } catch (_) {
        }
      }
      if (CONFIG.DELIBERATE_BEFORE_END_TURN && CONFIG.OLLAMA_ENABLED && this.lastDeliberatedTurn !== GameMemory.turnCount) {
        this.lastDeliberatedTurn = GameMemory.turnCount;
        logToBot("[STRATEGY] Ollama turn review before ending...");
        const verdict = await OllamaClient.deliberateEndTurnStrategy();
        logToBot(`[STRATEGY] Deliberation: ${verdict.action} - ${verdict.rationale}`);
        if (verdict.action === "UPGRADE") {
          if (await this.handleHouseBuilding(snapshot)) {
            return true;
          }
        }
      }
      return this.handleEndTurn(snapshot);
    },
    handleEndTurn(snapshot) {
      if (this.isEndingTurn) return false;
      const myPlayerCash = GameMemory.players[GameMemory.myName]?.cash;
      const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt || typeof myPlayerCash === "number" && myPlayerCash < 0;
      if (isDebt) {
        logToBot(`[DEBT GUARD] Blocked End Turn click: current balance is negative ($${GameMemory.myCash}).`);
        return false;
      }
      const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
      const myName = (GameMemory.myName || "").toLowerCase();
      if (bodyText.includes("is playing...") && myName && !bodyText.includes(`${myName} is playing...`)) {
        return false;
      }
      const standingTile = BOARD_TILES[GameMemory.myPos];
      const isPurchasable = standingTile && standingTile.group && (standingTile.type === "property" || standingTile.type === "airport" || standingTile.type === "utility");
      const currentOwner = standingTile ? GameMemory.ownership[standingTile.id]?.owner : null;
      const effectiveCash = Math.max(GameMemory.myCash, GameMemory.players[GameMemory.myName]?.cash || 0);
      if (isPurchasable && !currentOwner && effectiveCash >= (standingTile.price || 0) && this.unownedTileWaitCount < 8) {
        return false;
      }
      const endTurnBtn = snapshot.findExactOrIncludes(["end turn", "done", "continue"]);
      if (endTurnBtn) {
        const modalCloseBtn = snapshot.findModalCloseButton ? snapshot.findModalCloseButton() : null;
        if (modalCloseBtn) {
          try {
            modalCloseBtn.click();
          } catch (_) {
          }
        }
        this.isEndingTurn = true;
        setTimeout(() => {
          this.isEndingTurn = false;
        }, 2500);
        GameMemory.isMyTurn = false;
        logToBot(`[TURN ACTION] Ending turn #${GameMemory.turnCount}. Passing turn priority to next player.`);
        return executeOrAdvise({
          el: endTurnBtn,
          title: "END TURN",
          reason: "Turn actions finished. Passing priority.",
          onExecute: () => delayClick(endTurnBtn, "Ending turn")
        });
      }
      return false;
    }
  };

  // src/dom/socketHook.js
  function installWebSocketHook() {
    const targetWin = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
    if (targetWin.__richupWsHooked) return;
    targetWin.__richupWsHooked = true;
    const NativeWS = targetWin.WebSocket;
    if (!NativeWS) return;
    targetWin.WebSocket = function(...args) {
      const ws = new NativeWS(...args);
      GameMemory.activeSocket = ws;
      console.log("[RichUpBot WS Hook] Native WebSocket intercepted:", args[0]);
      ws.addEventListener("message", (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw || raw === "2" || raw === "3") return;
          if (GameMemory.wsMessages.length >= 35) GameMemory.wsMessages.shift();
          GameMemory.wsMessages.push({
            ts: Date.now(),
            preview: raw.slice(0, 300)
          });
          parseSocketIOFrame(raw);
        } catch (err) {
          console.warn("[RichUpBot WS Hook] Error parsing message:", err);
        }
      });
      return ws;
    };
    targetWin.WebSocket.prototype = NativeWS.prototype;
    Object.assign(targetWin.WebSocket, NativeWS);
    if (typeof window !== "undefined" && window !== targetWin) {
      window.__richupWsHooked = true;
      window.WebSocket = targetWin.WebSocket;
    }
  }
  function parseSocketIOFrame(raw) {
    const bracketIdx = raw.indexOf("[");
    if (bracketIdx === -1) return;
    try {
      const arr = JSON.parse(raw.slice(bracketIdx));
      if (!Array.isArray(arr) || arr.length === 0) return;
      const eventName = String(arr[0] || "").toLowerCase();
      const payload = arr[1] || {};
      GameMemory.wsActive = true;
      GameMemory.wsLastMessageTime = Date.now();
      if (eventName.includes("game") || eventName.includes("init") || eventName.includes("state") || eventName.includes("room")) {
        if (payload.settings) {
          if (typeof payload.settings.can_collect_rent_in_jail === "boolean") {
            GameMemory.roomSettings.collectRentInJail = payload.settings.can_collect_rent_in_jail;
          }
          if (typeof payload.settings.double_on_start === "boolean") {
            GameMemory.roomSettings.doubleOnStart = payload.settings.double_on_start;
          }
          if (typeof payload.settings.pass_start_bonus === "number") {
            GameMemory.roomSettings.passStartBonus = payload.settings.pass_start_bonus;
          }
          if (typeof payload.settings.starting_cash === "number") {
            GameMemory.roomSettings.startingCash = payload.settings.starting_cash;
            if (!GameMemory.cashVerified) {
              GameMemory.myCash = payload.settings.starting_cash;
            }
          }
        }
        const myId = payload.myId || payload.my_id || payload.userId || payload.user_id || payload.playerId;
        const playersList = Array.isArray(payload.players) ? payload.players : Array.isArray(payload.playerList) ? payload.playerList : null;
        if (playersList) {
          const me = myId ? playersList.find((p) => p.id === myId || p.userId === myId || p.isMe || p.is_me) : playersList.find((p) => p.isMe || p.is_me);
          if (me && (me.name || me.username)) {
            GameMemory.setMyName(me.name || me.username);
          }
          const validNames = /* @__PURE__ */ new Set();
          for (const p of playersList) {
            const pName = p.name || p.username;
            if (!pName) continue;
            validNames.add(pName);
            const rawMoney = typeof p.money === "number" ? p.money : typeof p.cash === "number" ? p.cash : typeof p.balance === "number" ? p.balance : null;
            const isThisPlayerMe = GameMemory.isMe(pName) || myId && p.id === myId || Boolean(p.isMe || p.is_me);
            const playerPos = typeof p.position === "number" ? p.position : typeof p.pos === "number" ? p.pos : GameMemory.players[pName]?.pos || 0;
            if (rawMoney !== null) {
              GameMemory.players[pName] = {
                cash: rawMoney,
                pos: playerPos,
                inJail: Boolean(p.inJail || p.jailTurns || p.in_jail),
                isMe: isThisPlayerMe,
                bankrupt: Boolean(p.bankrupt)
              };
              if (isThisPlayerMe) {
                GameMemory.setMyName(pName);
                GameMemory.myCash = rawMoney;
                GameMemory.cashVerified = true;
                GameMemory.myPos = playerPos;
                if (typeof p.inJail === "boolean") GameMemory.inJail = p.inJail;
              }
            }
          }
          if (validNames.size > 0) {
            for (const existing of Object.keys(GameMemory.players)) {
              if (!validNames.has(existing)) {
                delete GameMemory.players[existing];
              }
            }
          }
        }
      }
      if (eventName.includes("leave") || eventName.includes("left") || eventName.includes("disconnect")) {
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        if (pName && GameMemory.players[pName] && !GameMemory.isMe(pName)) {
          delete GameMemory.players[pName];
        }
      }
      if (eventName.includes("roll") || eventName.includes("dice")) {
        const dice = Array.isArray(payload.dice) ? payload.dice : Array.isArray(payload) ? payload : [];
        const sum = (dice[0] || 0) + (dice[1] || 0);
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        if (pName && GameMemory.isMe(pName) && sum > 0) {
          if (!GameMemory.inJail) {
            GameMemory.myPos = (GameMemory.myPos + sum) % 40;
            logToBot(`[DICE] \u{1F3B2} I rolled ${sum} ([${dice.join(",")}]) -> Moved to Tile #${GameMemory.myPos} (${BOARD_TILES[GameMemory.myPos]?.name || "Unknown"})`);
          }
        } else if (pName && GameMemory.players[pName]) {
          if (!GameMemory.players[pName].inJail && sum > 0) {
            const currentOppPos = GameMemory.players[pName].pos || 0;
            GameMemory.players[pName].pos = (currentOppPos + sum) % 40;
            logToBot(`[DICE] \u{1F3B2} ${pName} rolled ${sum} -> Tile #${GameMemory.players[pName].pos}`);
          }
        }
      }
      if (eventName.includes("purchase") || eventName.includes("buy")) {
        const tileId = typeof payload.blockIndex === "number" ? payload.blockIndex : typeof payload.tileId === "number" ? payload.tileId : payload.tileIndex;
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        if (typeof tileId === "number" && pName) {
          GameMemory.lastPurchasedBlock = tileId;
          const isMe = GameMemory.isMe(pName);
          const buyer = isMe ? GameMemory.myName || "__ME__" : pName;
          if (GameMemory.ownership[tileId]) {
            GameMemory.ownership[tileId].owner = buyer;
            logToBot(`[WS TELEMETRY] \u{1F3F7}\uFE0F Tile #${tileId} (${BOARD_TILES[tileId]?.name || "Unknown"}) acquired by ${buyer}`);
          }
        }
      }
      if (eventName.includes("auction")) {
        const tileId = typeof payload.blockIndex === "number" ? payload.blockIndex : typeof payload.tileId === "number" ? payload.tileId : payload.tileIndex;
        const winner = payload.winner || payload.playerName || payload.username || payload.name || payload.player;
        if (typeof tileId === "number" && winner && GameMemory.ownership[tileId]) {
          const isMe = GameMemory.isMe(winner);
          const buyer = isMe ? GameMemory.myName || "__ME__" : winner;
          GameMemory.ownership[tileId].owner = buyer;
          logToBot(`[WS TELEMETRY] \u{1F528} Tile #${tileId} won at auction by ${buyer}`);
        }
      }
      if (eventName.includes("house") || eventName.includes("hotel") || eventName.includes("build") || eventName.includes("upgrade")) {
        const tileId = typeof payload.blockIndex === "number" ? payload.blockIndex : typeof payload.tileId === "number" ? payload.tileId : payload.tileIndex;
        if (typeof tileId === "number" && GameMemory.ownership[tileId]) {
          const houses = payload.houses ?? payload.count ?? payload.level ?? payload.houseCount;
          if (typeof houses === "number") {
            GameMemory.ownership[tileId].houses = Math.max(0, Math.min(5, houses));
          } else if (eventName.includes("hotel")) {
            GameMemory.ownership[tileId].houses = 5;
          } else {
            GameMemory.ownership[tileId].houses = Math.min(5, (GameMemory.ownership[tileId].houses || 0) + 1);
          }
          logToBot(`[WS TELEMETRY] \u{1F3E0} Tile #${tileId} houses updated -> ${GameMemory.ownership[tileId].houses}/5`);
        }
      }
      if (eventName.includes("mortgage")) {
        const tileId = typeof payload.blockIndex === "number" ? payload.blockIndex : typeof payload.tileId === "number" ? payload.tileId : payload.tileIndex;
        const isUn = eventName.includes("unmortgage");
        if (typeof tileId === "number" && GameMemory.ownership[tileId]) {
          GameMemory.ownership[tileId].mortgaged = !isUn;
          logToBot(`[WS TELEMETRY] \u{1F3E6} Tile #${tileId} ${isUn ? "unmortgaged" : "mortgaged"}`);
        }
      }
      if (eventName.includes("bankrupt")) {
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        if (pName) {
          logToBot(`[WS TELEMETRY] \u26A0\uFE0F ${pName} declared bankruptcy. Assets released.`);
          for (const id of Object.keys(GameMemory.ownership)) {
            if (GameMemory.ownership[id].owner === pName) {
              GameMemory.ownership[id].owner = null;
              GameMemory.ownership[id].houses = 0;
              GameMemory.ownership[id].mortgaged = false;
            }
          }
        }
      }
      if (eventName.includes("turn")) {
        const active = payload.activePlayer || payload.player || payload.username || payload.name;
        if (active) {
          GameMemory.isMyTurn = GameMemory.isMe(active);
        }
      }
      deepSyncFromObject(payload);
      deepSyncPropertiesFromPayload(payload);
    } catch (_) {
    }
  }
  function deepSyncFromObject(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(deepSyncFromObject);
      return;
    }
    const name = obj.name || obj.username || obj.playerName || obj.player_name;
    const rawMoney = typeof obj.money === "number" ? obj.money : typeof obj.cash === "number" ? obj.cash : typeof obj.balance === "number" ? obj.balance : null;
    if (typeof name === "string" && rawMoney !== null) {
      const isThisPlayerMe = GameMemory.isMe(name) || Boolean(obj.isMe || obj.is_me);
      if (obj.isMe || obj.is_me) {
        GameMemory.setMyName(name);
      }
      const playerPos = typeof obj.position === "number" ? obj.position : typeof obj.pos === "number" ? obj.pos : GameMemory.players[name]?.pos || 0;
      GameMemory.players[name] = {
        cash: rawMoney,
        pos: playerPos,
        inJail: Boolean(obj.inJail || obj.jailTurns || obj.in_jail),
        isMe: isThisPlayerMe,
        bankrupt: Boolean(obj.bankrupt)
      };
      if (isThisPlayerMe) {
        GameMemory.myCash = rawMoney;
        GameMemory.cashVerified = true;
        GameMemory.myPos = playerPos;
        if (typeof obj.inJail === "boolean") GameMemory.inJail = obj.inJail;
      }
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "object") deepSyncFromObject(obj[k]);
    }
  }
  function deepSyncPropertiesFromPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    const playerMap = /* @__PURE__ */ new Map();
    for (const name of Object.keys(GameMemory.players)) {
      playerMap.set(name, name);
    }
    const playersList = Array.isArray(payload.players) ? payload.players : Array.isArray(payload.playerList) ? payload.playerList : null;
    if (playersList) {
      for (const p of playersList) {
        const pName = p.name || p.username;
        const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;
        if (pName) {
          if (pId !== void 0) playerMap.set(String(pId), pName);
          playerMap.set(pName, pName);
        }
      }
    }
    const resolveOwner = (raw) => {
      if (raw === null || raw === void 0 || raw === false || raw === "") return null;
      if (typeof raw === "string") {
        if (playerMap.has(raw)) return playerMap.get(raw);
        if (GameMemory.isMe(raw)) return GameMemory.myName || "__ME__";
        return raw;
      }
      if (typeof raw === "number" && playerMap.has(String(raw))) {
        return playerMap.get(String(raw));
      }
      if (typeof raw === "object" && (raw.name || raw.username)) {
        return raw.name || raw.username;
      }
      return null;
    };
    const visited = /* @__PURE__ */ new Set();
    const scan = (obj, depth = 0) => {
      if (!obj || typeof obj !== "object" || depth > 5 || visited.has(obj)) return;
      visited.add(obj);
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (!item) continue;
          if (typeof item === "string" && obj.length >= 35 && i < 40 && GameMemory.ownership[i]) {
            const resolved = resolveOwner(item);
            if (resolved) GameMemory.ownership[i].owner = resolved;
            continue;
          }
          if (typeof item === "object") {
            const tileId = typeof item.blockIndex === "number" ? item.blockIndex : typeof item.tileId === "number" ? item.tileId : typeof item.index === "number" ? item.index : typeof item.id === "number" && item.id < 40 ? item.id : null;
            const targetId = tileId !== null ? tileId : obj.length >= 35 && i < 40 ? i : null;
            if (targetId !== null && GameMemory.ownership[targetId]) {
              if (item.owner !== void 0 || item.ownerName !== void 0 || item.ownerId !== void 0 || item.userId !== void 0) {
                const rawOwner = item.owner ?? item.ownerName ?? item.ownerId ?? item.userId;
                GameMemory.ownership[targetId].owner = resolveOwner(rawOwner);
              }
              if (typeof item.houses === "number") {
                GameMemory.ownership[targetId].houses = Math.max(0, Math.min(5, item.houses));
              } else if (item.hotel) {
                GameMemory.ownership[targetId].houses = 5;
              }
              if (typeof item.mortgaged === "boolean") {
                GameMemory.ownership[targetId].mortgaged = item.mortgaged;
              } else if (typeof item.isMortgaged === "boolean") {
                GameMemory.ownership[targetId].mortgaged = item.isMortgaged;
              }
            }
          }
        }
        return;
      }
      if (obj.properties || obj.tiles || obj.blocks || obj.board) {
        scan(obj.properties || obj.tiles || obj.blocks || obj.board, depth + 1);
      }
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === "object" && obj[k] !== null && k !== "processedLogs" && k !== "wsMessages") {
          scan(obj[k], depth + 1);
        }
      }
    };
    scan(payload);
  }

  // src/index.js
  if (window.__richupAuto && typeof window.__richupAuto.cleanup === "function") {
    window.__richupAuto.cleanup();
  }
  var state = window.__richupAuto = {
    status: false,
    observer: null,
    timeouts: /* @__PURE__ */ new Set(),
    intervals: /* @__PURE__ */ new Set(),
    evaluateTimeout: null,
    keydownHandler: null,
    cleanup() {
      this.status = false;
      if (this.observer) this.observer.disconnect();
      this.timeouts.forEach((id) => clearTimeout(id));
      this.intervals.forEach((id) => clearInterval(id));
      this.timeouts.clear();
      this.intervals.clear();
      if (this.keydownHandler) {
        document.removeEventListener("keydown", this.keydownHandler);
      }
    }
  };
  installWebSocketHook();
  function scheduleTimeout(fn, delay) {
    let id = setTimeout(() => {
      state.timeouts.delete(id);
      fn();
    }, delay);
    state.timeouts.add(id);
    return id;
  }
  function scheduleInterval(fn, delay) {
    let id = setInterval(fn, delay);
    state.intervals.add(id);
    return id;
  }
  function checkGameStarted(snapshot) {
    return !snapshot.findExactOrIncludes(["change color", "join game", "create game", "ready up"]);
  }
  var isEvaluating = false;
  async function evaluateAndAct() {
    try {
      if (!state.status || getIsActing() || isEvaluating) return;
      isEvaluating = true;
      try {
        syncBoardStateFromDOM();
      } catch (err) {
        logToBot(`[DOM Sync Warning] ${err}`);
      }
      try {
        HUDPanel.updateTelemetry();
      } catch (err) {
        logToBot(`[Telemetry Warning] ${err}`);
      }
      try {
        await ChatEngine.scanAndRespondToOpponentChat();
      } catch (err) {
        logToBot(`[Chat Scan Warning] ${err}`);
      }
      let snapshot;
      try {
        snapshot = createDOMSnapshot();
      } catch (err) {
        logToBot(`[DOM Snapshot Error] ${err}`);
        return;
      }
      try {
        if (ActionExecutor.handleConfirmationModal(snapshot)) return;
      } catch (err) {
        logToBot(`[Confirmation Modal Warning] ${err}`);
      }
      try {
        if (await ActionExecutor.handleTrade(snapshot)) return;
      } catch (err) {
        logToBot(`[Trade Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleDebtRecovery(snapshot)) return;
      } catch (err) {
        logToBot(`[Debt Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleJail(snapshot)) return;
      } catch (err) {
        logToBot(`[Jail Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleBuyOrAuction(snapshot)) return;
      } catch (err) {
        logToBot(`[Buy/Auction Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleRollDice(snapshot)) return;
      } catch (err) {
        logToBot(`[Roll Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleAuction(snapshot)) return;
      } catch (err) {
        logToBot(`[Auction Bid Step Warning] ${err}`);
      }
      try {
        if (await ActionExecutor.handleHouseBuilding(snapshot)) return;
      } catch (err) {
        logToBot(`[Build Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleUnmortgage(snapshot)) return;
      } catch (err) {
        logToBot(`[Unmortgage Step Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleProactiveTrade(snapshot)) return;
      } catch (err) {
        logToBot(`[Proactive Trade Step Warning] ${err}`);
      }
      try {
        await ActionExecutor.deliberateBeforeEndTurn(snapshot);
      } catch (err) {
        logToBot(`[End Turn Step Warning] ${err}`);
        try {
          ActionExecutor.handleEndTurn(snapshot);
        } catch (_) {
        }
      }
    } catch (err) {
      logToBot(`Eval loop error: ${err}`);
    } finally {
      isEvaluating = false;
    }
  }
  function scheduleEvaluate() {
    if (!state.status) return;
    if (state.evaluateTimeout) {
      clearTimeout(state.evaluateTimeout);
      state.timeouts.delete(state.evaluateTimeout);
    }
    state.evaluateTimeout = scheduleTimeout(async () => {
      state.evaluateTimeout = null;
      await evaluateAndAct();
    }, CONFIG.OBSERVER_DEBOUNCE_MS);
  }
  function toggleAutomation() {
    state.status = !state.status;
    HUDPanel.updateMasterButton(state.status);
    if (state.status) {
      const snap = createDOMSnapshot();
      if (!checkGameStarted(snap)) {
        logToBot("Lobby detected. Bot will activate once match starts.");
      } else {
        logToBot("GRANDMASTER AI ENGAGED. AUTONOMOUS GAMEPLAY ACTIVE.");
      }
      evaluateAndAct();
    } else {
      logToBot("Automation Paused (STANDBY).");
    }
  }
  function startObserver() {
    const target = document.body;
    if (!target) return;
    state.observer = new MutationObserver((mutations) => {
      if (!state.status || getIsActing()) return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (HUDPanel.elements.panel && HUDPanel.elements.panel.contains(m.target)) continue;
        scheduleEvaluate();
        return;
      }
    });
    state.observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    scheduleInterval(() => {
      if (state.status && !getIsActing()) {
        evaluateAndAct();
      } else {
        try {
          syncBoardStateFromDOM();
        } catch (err) {
          logToBot(`[DOM Sync Warning] ${err}`);
        }
        try {
          HUDPanel.updateTelemetry();
        } catch (err) {
          logToBot(`[Telemetry Warning] ${err}`);
        }
      }
    }, CONFIG.POLL_INTERVAL_MS);
  }
  function initWhenReady() {
    if (!document.body || !document.head) {
      setTimeout(initWhenReady, 100);
      return;
    }
    HUDPanel.inject(
      toggleAutomation,
      () => {
        if (HUDPanel.pendingAdvisorAction?.onExec) {
          HUDPanel.pendingAdvisorAction.onExec();
        }
      },
      () => {
        if (HUDPanel.pendingAdvisorAction?.onSkip) {
          HUDPanel.pendingAdvisorAction.onSkip();
        }
      }
    );
    syncBoardStateFromDOM();
    HUDPanel.updateTelemetry();
    startObserver();
    state.keydownHandler = (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "=") {
        e.preventDefault();
        toggleAutomation();
      }
    };
    document.addEventListener("keydown", state.keydownHandler);
  }
  initWhenReady();
})();
