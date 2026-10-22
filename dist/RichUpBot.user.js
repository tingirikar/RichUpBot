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
// @inject-into  page
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
    hasRolled: false,
    doublesInARow: 0,
    canPerformTurnActions: false,
    isNegativeDebt: false,
    currentRoomId: null,
    // Universal Dynamic Map State (40-tile classic, 48-tile expanded, or arbitrary custom boards)
    boardLength: 40,
    prisonBlockIndex: 10,
    vacationBlockIndex: 20,
    goToPrisonBlockIndex: 30,
    boardTiles: [],
    groupTiles: {},
    vacationCash: 0,
    autoActedTurns: 0,
    pardonCards: { treasure: false, surprise: false },
    currentPlayerIndex: 0,
    participantsOrder: [],
    getBoardLength() {
      return this.boardTiles && this.boardTiles.length > 0 ? this.boardTiles.length : this.boardLength || 40;
    },
    getAllTiles() {
      return this.boardTiles && this.boardTiles.length > 0 ? this.boardTiles : BOARD_TILES;
    },
    getGroupTiles() {
      return this.groupTiles && Object.keys(this.groupTiles).length > 0 ? this.groupTiles : GROUP_TILES;
    },
    getTile(tileId) {
      if (typeof tileId !== "number") return null;
      if (this.boardTiles && this.boardTiles[tileId]) {
        return this.boardTiles[tileId];
      }
      return BOARD_TILES[tileId % BOARD_TILES.length] || null;
    },
    // Turn Clock & Anti-AFK Protection State
    turnClock: {
      turnStartedAt: 0,
      graceMs: 2e4,
      debtGraceMs: 6e4,
      bankMs: 6e4,
      grantedMs: 0,
      turnExpiresAt: 0,
      clockRequestedThisTurn: false
    },
    activeOutgoingTradeId: null,
    activeOutgoingTradeTime: 0,
    updateTurnClock(clockData) {
      if (!clockData) return;
      const cfg = clockData.config || {};
      const turn = clockData.turn || {};
      if (cfg.graceMs) this.turnClock.graceMs = cfg.graceMs;
      if (cfg.debtGraceMs) this.turnClock.debtGraceMs = cfg.debtGraceMs;
      if (turn.turnStartedAt) {
        if (this.turnClock.turnStartedAt !== turn.turnStartedAt) {
          this.turnClock.turnStartedAt = turn.turnStartedAt;
          this.turnClock.clockRequestedThisTurn = false;
        }
      }
      this.turnClock.grantedMs = turn.grantedMs || 0;
      const grace = turn.debtGraceLatched ? this.turnClock.debtGraceMs || 6e4 : this.turnClock.graceMs || 2e4;
      const totalBudget = grace + (this.turnClock.grantedMs || 0) + (this.turnClock.bankMs || 6e4);
      this.turnClock.turnExpiresAt = (this.turnClock.turnStartedAt || Date.now()) + totalBudget;
    },
    getTurnClockRemainingMs() {
      if (!this.turnClock.turnExpiresAt) return 6e4;
      return Math.max(0, this.turnClock.turnExpiresAt - Date.now());
    },
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
    wsOutgoing: [],
    socketPrefix: "42/api/game,",
    activeSocket: null,
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
      if (playerName === "__ME__") return true;
      if (!this.myName) return false;
      const cleanA = playerName.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[->\]\[→←\|👑:]/g, "").replace(/[^\w\s-]/g, "").trim().toLowerCase();
      const cleanB = this.myName.replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[->\]\[→←\|👑:]/g, "").replace(/[^\w\s-]/g, "").trim().toLowerCase();
      return cleanA === cleanB;
    },
    reset() {
      this.myCash = 1500;
      this.cashVerified = false;
      this.myPos = 0;
      this.inJail = false;
      this.jailTurns = 0;
      this.turnCount = 0;
      this.isMyTurn = false;
      this.hasRolled = false;
      this.doublesInARow = 0;
      this.canPerformTurnActions = false;
      this.players = {};
      this.ownership = {};
      this.declinedTrades = {};
      this.activeOutgoingTradeId = null;
      this.activeOutgoingTradeTime = 0;
      this.vacationCash = 0;
      this.autoActedTurns = 0;
      this.pardonCards = { treasure: false, surprise: false };
      this.currentPlayerIndex = 0;
      this.participantsOrder = [];
      this.turnClock = {
        turnStartedAt: 0,
        graceMs: 2e4,
        debtGraceMs: 6e4,
        bankMs: 6e4,
        grantedMs: 0,
        turnExpiresAt: 0,
        clockRequestedThisTurn: false
      };
      const tiles = this.getAllTiles();
      tiles.forEach((t) => {
        if (t.group) {
          this.ownership[t.id] = { owner: null, houses: 0, mortgaged: false };
        }
      });
      this.processedLogs.clear();
    },
    getGroupCount(groupName, ownerName) {
      const gMap = this.getGroupTiles();
      const tiles = gMap[groupName] || [];
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
      const tiles = this.getAllTiles();
      for (const t of tiles) {
        if (t.group && (!this.ownership[t.id] || !this.ownership[t.id].owner)) {
          unowned++;
        }
      }
      return unowned;
    },
    getTileCurrentRent(tileId, visitorName = null) {
      const tile = this.getTile(tileId);
      if (!tile) return 0;
      if (tile.type === "tax" || tile.type === "bonus") return tile.rent && tile.rent[0] || 0;
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
        if (Array.isArray(tile.rent)) {
          return tile.rent[Math.max(0, Math.min(owned - 1, tile.rent.length - 1))] || 25;
        }
        return 25 * Math.pow(2, Math.max(0, owned - 1));
      }
      if (tile.type === "utility") {
        return owned >= 2 ? 70 : 28;
      }
      if (info.houses > 0) {
        if (Array.isArray(tile.rent)) {
          return tile.rent[Math.min(info.houses, tile.rent.length - 1)] || tile.rent[0] || 0;
        }
        return tile.rent && tile.rent[info.houses] || 0;
      }
      const baseRent = tile.rent && tile.rent[0] || 0;
      return total > 0 && owned === total ? baseRent * 2 : baseRent;
    }
  };
  GameMemory.reset();

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
        for (const tile of GameMemory.getAllTiles()) {
          if (!tile.group) continue;
          const info = GameMemory.ownership[tile.id];
          if (info && isSamePlayer(info.owner, pName)) {
            ownedTiles.push(tile);
            totalPropertyNetWorth += tile.price;
          }
        }
        for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
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
      for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
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
      for (const [groupName, tiles] of Object.entries(GameMemory.getGroupTiles())) {
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
      for (const tile of GameMemory.getAllTiles()) {
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
      for (const tile of GameMemory.getAllTiles()) {
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
      const bLen = GameMemory.getBoardLength();
      for (let roll = 2; roll <= 12; roll++) {
        const prob = DICE_PROB[roll];
        const targetTile = (currentPos + roll) % bLen;
        const rent = GameMemory.getTileCurrentRent(targetTile);
        expectedLoss1Turn += prob * rent;
        if (targetTile === GameMemory.vacationBlockIndex && GameMemory.vacationCash > 0) {
          const jackpotEV = prob * GameMemory.vacationCash;
          expectedLoss1Turn = Math.max(0, expectedLoss1Turn - jackpotEV * 0.4);
        }
        if (roll >= 5 && roll <= 9 && rent > maxDangerWindowLoss) {
          maxDangerWindowLoss = rent;
        }
        if (rent > maxAnyRollLoss) {
          maxAnyRollLoss = rent;
        }
      }
      let expectedLoss3Turns = expectedLoss1Turn;
      for (let step = 13; step <= 21; step++) {
        const targetTile = (currentPos + step) % bLen;
        const tileData = GameMemory.getTile(targetTile);
        const rent = GameMemory.getTileCurrentRent(targetTile);
        const markovWeight = (tileData?.markov || 1 / bLen) * 0.45;
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
      const unownedRemaining = GameMemory.getUnownedPropertyCount();
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
      const prisonPos = GameMemory.prisonBlockIndex ?? 10;
      const dangerOutside = MarkovRisk.analyzeDangerAhead(prisonPos);
      const reserve = MarkovRisk.computeDynamicReserve(prisonPos);
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
      const allTiles = GameMemory.getAllTiles();
      for (const tile of allTiles) {
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner) && info.houses >= 1) {
          myHotels.push(tile.id);
        }
      }
      if (myHotels.length === 0) return false;
      const bLen = GameMemory.getBoardLength();
      for (const [pName, pData] of Object.entries(GameMemory.players)) {
        if (GameMemory.isMe(pName) || pData.bankrupt || pData.inJail) continue;
        const oppPos = pData.pos || 0;
        for (const hotelTileId of myHotels) {
          const distance = (hotelTileId - oppPos + bLen) % bLen;
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
      const allTiles = GameMemory.getAllTiles();
      for (const tile of allTiles) {
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
        const bLen = GameMemory.getBoardLength();
        const groupTilesMap = GameMemory.getGroupTiles();
        for (let r = 1; r <= numRounds; r++) {
          if (!myBankrupt) {
            const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
            const newPos = (myPos + roll) % bLen;
            if (newPos < myPos) myCash += 200;
            myPos = newPos;
            const tile = GameMemory.getTile(myPos);
            if (tile?.group) {
              const info = simOwnership[tile.id];
              if (info?.owner === partnerName && !info.mortgaged) {
                let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                if (tile.type === "property" && tile.rent) {
                  rent = tile.rent[info.houses || 0] || tile.rent[0];
                  if ((info.houses || 0) === 0 && tile.group) {
                    const gTiles = groupTilesMap[tile.group] || [];
                    if (gTiles.length > 0 && gTiles.every((gt) => simOwnership[gt.id]?.owner === partnerName)) {
                      rent *= 2;
                    }
                  }
                } else if (tile.type === "airport") {
                  const count = Object.values(simOwnership).filter((x) => x.owner === partnerName && GameMemory.getTile(x.id)?.type === "airport").length;
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
            const newPos = (oppPos + roll) % bLen;
            if (newPos < oppPos) oppCash += 200;
            oppPos = newPos;
            const tile = GameMemory.getTile(oppPos);
            if (tile?.group) {
              const info = simOwnership[tile.id];
              if (info && GameMemory.isMe(info.owner) && !info.mortgaged) {
                let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                if (tile.type === "property" && tile.rent) {
                  rent = tile.rent[info.houses || 0] || tile.rent[0];
                  if ((info.houses || 0) === 0 && tile.group) {
                    const gTiles = groupTilesMap[tile.group] || [];
                    if (gTiles.length > 0 && gTiles.every((gt) => GameMemory.isMe(simOwnership[gt.id]?.owner))) {
                      rent *= 2;
                    }
                  }
                } else if (tile.type === "airport") {
                  const count = Object.values(simOwnership).filter((x) => GameMemory.isMe(x.owner) && GameMemory.getTile(x.id)?.type === "airport").length;
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
      for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
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
        for (const [gName, gTiles] of Object.entries(GameMemory.getGroupTiles())) {
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
      for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
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
        const allTiles = GameMemory.getAllTiles();
        const myAirports = allTiles.filter((t) => t.type === "airport" && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
        if (myAirports.length >= 1 && myAirports.length < 4) {
          const otherAirports = allTiles.filter((t) => t.type === "airport" && !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
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
        const tile = GameMemory.getTile(tileId);
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
      const gTilesMap = GameMemory.getGroupTiles();
      for (const [pName, pEntry] of Object.entries(playerStats)) {
        for (const [groupName, groupTiles] of Object.entries(gTilesMap)) {
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
        if (t.group && gTilesMap[t.group]) {
          const groupTiles = gTilesMap[t.group];
          const othersOwned = groupTiles.filter((gid) => gid !== t.id).every((gid) => {
            const o = GameMemory.ownership[gid];
            return o && o.owner?.toLowerCase() === partner.toLowerCase();
          });
          if (othersOwned) partnerCompletedGroups.push(t.group);
        }
      }
      const myCompletedGroups = [];
      for (const t of receivedTiles) {
        if (t.group && gTilesMap[t.group]) {
          const groupTiles = gTilesMap[t.group];
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
      for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
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
      this.lastSentTime = now;
      this.lastSentText = message;
      logToBot(`[CHAT SEND] "${message}"`);
      if (sendSocketAction("chat:send-message", { content: message })) {
        return true;
      }
      const input = document.querySelector('input[placeholder*="say" i], input[placeholder*="something" i], input[placeholder*="chat" i], input[placeholder*="message" i], textarea');
      if (!input) return false;
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
    cancelPendingTrade() {
      const trId = GameMemory.activeOutgoingTradeId;
      if (trId) {
        logToBot(`[TRADE] \u{1F5D1}\uFE0F Cancelling open outgoing trade offer (ID: ${trId}) to release assets.`);
        sendSocketAction("delete-trade", { tradeId: trId });
        GameMemory.activeOutgoingTradeId = null;
        GameMemory.activeOutgoingTradeTime = 0;
        return true;
      }
      return false;
    },
    cancelStaleProposal() {
      if (GameMemory.activeOutgoingTradeId) {
        const age = Date.now() - (GameMemory.activeOutgoingTradeTime || 0);
        if (age > 35e3) {
          return this.cancelPendingTrade();
        }
      }
      return false;
    },
    async executeProposal(swap, onComplete) {
      if (this.isExecuting) return;
      this.isExecuting = true;
      logToBot(`[ZERO-UI TRADE] Starting automated proposal for ${swap.targetOwner}...`);
      const targetId = getPlayerIdByName(swap.targetOwner);
      const givenTiles = Array.isArray(swap.myGivenTiles) ? swap.myGivenTiles : swap.myGivenTile ? [swap.myGivenTile] : [];
      const receivedTiles = Array.isArray(swap.myReceivedTiles) ? swap.myReceivedTiles : swap.myReceivedTile ? [swap.myReceivedTile] : [];
      const cashOffer = swap.cashOffer || 0;
      const cashDemand = swap.cashDemand || 0;
      if (targetId !== null && targetId !== void 0 && GameMemory.activeSocket?.readyState === 1) {
        const payload = {
          recipientId: targetId,
          initiatorOffer: {
            money: cashOffer,
            properties: givenTiles.map((t) => t.id)
          },
          recipientOffer: {
            money: cashDemand,
            properties: receivedTiles.map((t) => t.id)
          },
          note: swap.pitch || ""
        };
        const success = sendSocketAction("create-trade", { trade: payload });
        if (success) {
          logToBot(`[ZERO-UI TRADE] \u{1F91D} Propose trade emitted via WebSocket to ${swap.targetOwner}!`);
          this.lastProposedTimes.set(swap.targetOwner, Date.now());
          this.lastSentProposal = {
            targetOwner: swap.targetOwner,
            givenTiles,
            receivedTiles,
            cashOffer,
            cashDemand,
            timestamp: Date.now()
          };
          if (CONFIG.CHAT_ENABLED && swap.pitch) {
            setTimeout(() => ChatEngine.sendChatMessage("tradeOffer", swap.pitch), 400);
          }
          this.isExecuting = false;
          if (onComplete) onComplete(true);
          return;
        }
      }
      logToBot(`[ZERO-UI TRADE] Could not emit trade: targetId=${targetId}, wsReady=${GameMemory.activeSocket?.readyState === 1}`);
      this.isExecuting = false;
      if (onComplete) onComplete(false);
    }
  };

  // src/engine/debtRecovery.js
  var DebtRecovery = {
    rankLiquidationTargets() {
      const targets = [];
      const blockers = new Set(OpponentTracker.getCriticalBlockers().map((b) => b.tile.id));
      const groupMaxHouses = {};
      for (const tile of GameMemory.getAllTiles()) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner)) {
          groupMaxHouses[tile.group] = Math.max(groupMaxHouses[tile.group] || 0, info.houses || 0);
        }
      }
      for (const tile of GameMemory.getAllTiles()) {
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
      for (const tile of GameMemory.getAllTiles()) {
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
                background: linear-gradient(180deg, rgba(24, 19, 44, 0.96) 0%, rgba(18, 14, 33, 0.98) 100%);
                backdrop-filter: blur(24px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7), 0 0 1px rgba(255, 255, 255, 0.12);
                color: #f1f0f7;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                font-size: 11px; z-index: 9999999;
                display: flex; flex-direction: column; user-select: none;
            }
            .rubot-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 16px;
                background: rgba(30, 24, 54, 0.85);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 16px 16px 0 0; cursor: grab; flex-shrink: 0;
            }
            .rubot-title-wrap { display: flex; align-items: center; gap: 8px; }
            .rubot-logo {
                width: 24px; height: 24px; border-radius: 7px;
                background: #7c3aed;
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; flex-shrink: 0; box-shadow: 0 2px 8px rgba(124,58,237,0.4);
            }
            .rubot-title-main { font-size: 12px; font-weight: 800; color: #fff; letter-spacing: 0.8px; }
            .rubot-badge {
                font-size: 8.5px; font-weight: 700; padding: 3px 8px;
                border-radius: 9999px; letter-spacing: 0.5px;
                background: rgba(255,255,255,0.06); color: #9ca3af;
                border: 1px solid rgba(255,255,255,0.08); transition: all 0.25s ease;
            }
            .rubot-badge.active {
                background: rgba(16,185,129,0.18); color: #34d399;
                border-color: rgba(16,185,129,0.35); box-shadow: 0 0 10px rgba(16,185,129,0.25);
            }
            .rubot-top-controls {
                padding: 10px 14px 6px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
            }
            .rubot-master-btn {
                background: #7c3aed; border: none; color: #fff; padding: 10px 14px;
                font-family: inherit; font-weight: 700; font-size: 11.5px;
                letter-spacing: 0.5px; border-radius: 10px; cursor: pointer;
                box-shadow: 0 4px 14px rgba(124,58,237,0.35); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .rubot-master-btn:hover { background: #8b5cf6; box-shadow: 0 6px 20px rgba(124,58,237,0.5); transform: translateY(-1px); }
            .rubot-master-btn.active {
                background: #10b981; box-shadow: 0 4px 14px rgba(16,185,129,0.35);
            }
            .rubot-master-btn.active:hover { background: #34d399; }
            .rubot-mode-wrap {
                display: flex; background: rgba(0,0,0,0.35);
                border-radius: 9999px; padding: 3px;
                border: 1px solid rgba(255,255,255,0.05); gap: 2px;
            }
            .rubot-mode-btn {
                flex: 1; background: transparent; border: none;
                color: #9ca3af; font-family: inherit;
                font-weight: 700; font-size: 9.5px; padding: 6px 6px;
                border-radius: 9999px; cursor: pointer; transition: all 0.15s ease;
            }
            .rubot-mode-btn.active {
                background: #7c3aed; color: #fff;
                box-shadow: 0 2px 8px rgba(124,58,237,0.35);
            }
            .rubot-tab-bar {
                display: flex; background: transparent;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                padding: 0 12px; gap: 4px; flex-shrink: 0;
            }
            .rubot-tab-btn {
                background: transparent; border: none;
                color: #8b81a8; font-family: inherit;
                font-weight: 700; font-size: 10.5px; padding: 9px 11px;
                cursor: pointer; border-bottom: 2px solid transparent;
                transition: all 0.2s; display: flex; align-items: center; gap: 5px;
            }
            .rubot-tab-btn:hover { color: #fff; }
            .rubot-tab-btn.active {
                color: #fff; border-bottom-color: #8b5cf6;
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
                padding: 8px 11px; border-radius: 10px;
                background: rgba(30, 24, 54, 0.55); border: 1px solid rgba(255,255,255,0.06);
            }
            .rubot-status-indicator { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 10px; }
            .rubot-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; }
            .rubot-status-dot.online { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.8); }
            .rubot-status-dot.offline { background: #ef4444; }
            .rubot-field-group { display: flex; flex-direction: column; gap: 4px; }
            .rubot-field-label { font-size: 9px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.5px; }
            .rubot-input {
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px; color: #fff; padding: 7px 10px;
                font-family: inherit; font-size: 10px; outline: none;
            }
            .rubot-input:focus { border-color: #8b5cf6; }
            .rubot-select {
                background: #191428; border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px; color: #fff; padding: 7px 10px;
                font-family: inherit; font-size: 10px; outline: none;
            }
            .rubot-btn-test {
                background: #7c3aed;
                border: none; color: #fff;
                padding: 8px; border-radius: 8px; font-weight: 700; font-size: 10.5px;
                cursor: pointer; transition: all 0.2s; text-align: center; margin-top: 2px;
            }
            .rubot-btn-test:hover { background: #8b5cf6; }
            .rubot-info-box {
                font-size: 9.5px; color: #a5b4fc; line-height: 1.4;
                padding: 7px 10px; border-radius: 8px; background: rgba(124,58,237,0.08);
                border: 1px solid rgba(139,92,246,0.18);
            }

            /* Toggles Tab */
            .rubot-toggles-list { display: flex; flex-direction: column; gap: 5px; }
            .rubot-toggle-item {
                display: flex; align-items: center; justify-content: space-between;
                padding: 8px 11px; background: rgba(30, 24, 54, 0.55);
                border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
                cursor: pointer; transition: border-color 0.2s;
            }
            .rubot-toggle-item:hover { border-color: rgba(139,92,246,0.35); }
            .rubot-toggle-info { display: flex; flex-direction: column; gap: 2px; }
            .rubot-toggle-name { font-size: 10.5px; font-weight: 700; color: #fff; }
            .rubot-toggle-desc { font-size: 9px; color: #8b81a8; }
            .rubot-toggle-pill { position: relative; width: 32px; height: 18px; flex-shrink: 0; }
            .rubot-toggle-pill input { opacity: 0; width: 0; height: 0; position: absolute; }
            .rubot-pill-track {
                position: absolute; inset: 0; background: rgba(255,255,255,0.1);
                border-radius: 20px; border: 1px solid rgba(255,255,255,0.12);
                transition: all 0.2s ease;
            }
            .rubot-pill-track::after {
                content: ''; position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
                width: 12px; height: 12px; border-radius: 50%;
                background: #9ca3af; transition: all 0.2s ease;
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track {
                background: #7c3aed; border-color: #8b5cf6;
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track::after {
                left: calc(100% - 14px); background: #fff;
            }

            /* Intel / Memory Tab */
            .rubot-intel-page { display: flex; flex-direction: column; gap: 7px; flex: 1; }
            .rubot-intel-card {
                background: rgba(30, 24, 54, 0.55); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 12px; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px;
            }
            .rubot-intel-title { font-size: 10.5px; font-weight: 700; color: #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
            .rubot-intel-content { font-size: 9.5px; color: #d1d5db; line-height: 1.4; word-break: break-word; }
            .rubot-intel-badge { font-size: 8.5px; font-weight: 700; padding: 2px 7px; border-radius: 6px; display: inline-block; }
            .rubot-intel-badge.green { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
            .rubot-intel-badge.amber { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
            .rubot-intel-badge.red { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
            .rubot-intel-badge.violet { background: rgba(124,58,237,0.15); color: #c4b5fd; border: 1px solid rgba(124,58,237,0.3); }

            /* Activity Log Tab */
            .rubot-log-page { display: flex; flex-direction: column; height: 100%; flex: 1; }
            .rubot-log-toolbar {
                display: flex; justify-content: space-between; align-items: center;
                padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 6px;
            }
            .rubot-log-title { font-size: 9.5px; font-weight: 700; color: #8b81a8; text-transform: uppercase; }
            .rubot-btn-clear {
                background: transparent; border: 1px solid rgba(255,255,255,0.1);
                color: #9ca3af; padding: 3px 8px; border-radius: 6px;
                font-size: 9px; cursor: pointer; transition: all 0.15s;
            }
            .rubot-btn-clear:hover { background: rgba(255,255,255,0.08); color: #fff; }
            .rubot-terminal {
                flex: 1; overflow-y: auto; padding: 7px 9px;
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 10px; font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 9.5px; color: #c4b5fd;
                display: flex; flex-direction: column-reverse; gap: 3px;
                scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.3) transparent;
            }
            .log-line { display: flex; gap: 6px; line-height: 1.35; word-break: break-word; }
            .log-ts { color: #8b81a8; flex-shrink: 0; font-size: 8.5px; }
            .log-msg { flex: 1; }
            .log-line.green .log-msg { color: #34d399; }
            .log-line.violet .log-msg { color: #c084fc; }
            .log-line.amber .log-msg { color: #fbbf24; }
            .log-line.red .log-msg { color: #f87171; }

            /* Advisor Box Overlay */
            .rubot-advisor-box {
                background: rgba(30, 24, 54, 0.85);
                border: 1px solid rgba(139,92,246,0.4); border-radius: 10px;
                padding: 10px 12px; display: none; flex-direction: column; gap: 7px; margin-bottom: 6px;
            }
            .rubot-adv-title { font-weight: 700; font-size: 10.5px; color: #fff; }
            .rubot-adv-desc { font-size: 9.5px; color: #d1d5db; line-height: 1.35; }
            .rubot-adv-btns { display: flex; gap: 6px; }
            .rubot-adv-btn {
                flex: 1; padding: 7px; border: none; border-radius: 8px;
                font-family: inherit; font-weight: 700; font-size: 10.5px;
                cursor: pointer; transition: all 0.15s ease;
            }
            .rubot-adv-btn.exec { background: #10b981; color: #fff; }
            .rubot-adv-btn.skip { background: rgba(255,255,255,0.08); color: #c4b5fd; border: 1px solid rgba(255,255,255,0.1); }
        `;
      document.head.appendChild(style);
      const panel = document.createElement("div");
      panel.id = "rubot-hud-panel";
      panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <div class="rubot-title-wrap">
                    <div class="rubot-logo" id="rubot-logo-btn" title="Click to force full state resync" style="cursor: pointer;">\u{1F3B2}</div>
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
                                <button class="rubot-btn-clear" id="rubot-btn-export-log" title="Export Match Trace to JSONL">Export JSONL</button>
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
        btnPing: document.getElementById("rubot-btn-ping"),
        logoBtn: document.getElementById("rubot-logo-btn")
      };
      if (this.elements.logoBtn) {
        this.elements.logoBtn.addEventListener("click", () => {
          requestFullStateResync();
          this.logTerminal("\u{1F504} Requested full authoritative game state resync from server!");
        });
      }
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
      const exportBtn = document.getElementById("rubot-btn-export-log");
      if (exportBtn) {
        exportBtn.addEventListener("click", () => {
          const logs = Array.from(this.elements.terminal?.querySelectorAll(".log-line") || []).reverse().map((el) => ({
            ts: el.querySelector(".log-ts")?.textContent || "",
            msg: el.querySelector(".log-msg")?.textContent || ""
          }));
          const trace = {
            exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
            room: GameMemory.currentRoomId,
            boardLength: GameMemory.getBoardLength(),
            myName: GameMemory.myName,
            myCash: GameMemory.myCash,
            myPos: GameMemory.myPos,
            autoActedTurns: GameMemory.autoActedTurns,
            vacationCash: GameMemory.vacationCash,
            pardonCards: GameMemory.pardonCards,
            players: GameMemory.players,
            ownership: GameMemory.ownership,
            roomSettings: GameMemory.roomSettings,
            logs
          };
          const jsonl = JSON.stringify(trace, null, 2);
          const blob = new Blob([jsonl], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `richup_trace_${GameMemory.currentRoomId || "match"}_${Date.now()}.jsonl`;
          a.click();
          URL.revokeObjectURL(url);
          this.logTerminal(`Match trace exported: ${a.download}`);
        });
      }
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
      const myTiles = GameMemory.getAllTiles().filter((t) => t.group && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
      const myMonopolies = [];
      for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
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
                    <div style="display:flex;gap:4px;align-items:center;">
                        <span class="rubot-intel-badge ${GameMemory.autoActedTurns >= 1 ? "rose" : "green"}">Strikes: ${GameMemory.autoActedTurns || 0}/2</span>
                        <span class="rubot-intel-badge violet">Tile #${GameMemory.myPos || 0}</span>
                        <span class="rubot-intel-badge green">$${myCash}</span>
                    </div>
                </div>
                <div class="rubot-intel-content" style="margin-top:2px;">
                    <div style="display:flex;gap:6px;margin-bottom:4px;font-size:9.5px;color:#c4b5fd;">
                        <span>\u{1F5FA}\uFE0F Board: <b>${GameMemory.getBoardLength()} Tiles</b></span>
                        <span>\u{1F3D6}\uFE0F Vacation Pot: <b>$${GameMemory.vacationCash || 0}</b></span>
                        <span>\u{1F6E1}\uFE0F Pardon: <b>${GameMemory.pardonCards.treasure || GameMemory.pardonCards.surprise ? "YES" : "No"}</b></span>
                    </div>
                    <b>Properties (${myTiles.length}):</b> ${myTiles.length > 0 ? myTiles.map((t) => {
        const h = GameMemory.ownership[t.id]?.houses || 0;
        const hStr = h === 5 ? " [\u{1F3E8}]" : h > 0 ? ` [\u{1F3E0}x${h}]` : "";
        return `${t.name}${hStr}`;
      }).join(", ") : '<span style="color:#6b7280">None yet</span>'}<br>
                    <b>Monopolies:</b> ${myMonopolies.length > 0 ? myMonopolies.map((m) => `<span class="rubot-intel-badge green">${m}</span>`).join(" ") : '<span style="color:#6b7280">None</span>'}
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
        html += `<span style="color:#6b7280; font-style:italic;">Scanning scoreboard...</span>`;
      } else {
        for (const [pName, data] of oppEntries) {
          const hungryStr = data.hungrySets.length > 0 ? data.hungrySets.map((h) => `<span class="rubot-intel-badge red">${h.group} ${h.ownedCount}/${h.total}</span>`).join(" ") : "";
          const propStr = data.ownedTiles.length > 0 ? data.ownedTiles.map((t) => t.name).join(", ") : '<span style="color:#6b7280">None yet</span>';
          const declCount = typeof GameMemory.getDeclinedCountForPlayer === "function" ? GameMemory.getDeclinedCountForPlayer(pName) : 0;
          const declBadge = declCount > 0 ? `<span class="rubot-intel-badge red">${declCount} Declined</span>` : "";
          const pos = GameMemory.players[pName]?.pos;
          const posStr = typeof pos === "number" ? `Tile #${pos}` : "Tile #0";
          html += `
                    <div style="margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,0.06);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:700; color:#fff;">${pName}</span>
                            <div style="display:flex; gap:4px; align-items:center;">
                                <span class="rubot-intel-badge violet">${posStr}</span>
                                <span class="rubot-intel-badge green">$${data.cash}</span>
                            </div>
                        </div>
                        <div style="margin-top: 2px; color: #9ca3af;">
                            ${propStr} ${hungryStr} ${declBadge}
                        </div>
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
                    <span class="rubot-intel-badge violet">${unownedCount} Unowned</span>
                </div>
                <div class="rubot-intel-content" style="margin-top:2px;">
                    <b>Chat Engagement:</b> ${CONFIG.CHAT_ENABLED ? '<span class="rubot-intel-badge green">ACTIVE (Smart/Casual)</span>' : '<span class="rubot-intel-badge red">SILENT (Off)</span>'}<br>
                    <b>Ollama Brain:</b> <span class="rubot-intel-badge green">${CONFIG.OLLAMA_MODEL}</span>
                </div>
            </div>
        `;
      container.innerHTML = html;
    }
  };

  // src/protocol/actionExecutor.js
  var isActing = false;
  var isEvaluatingTrade = false;
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
  function executeOrAdvise({ title, reason, delayMs = 600, onExecute, onSkip }) {
    if (isActing) return false;
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
        },
        () => {
          HUDPanel.hideAdvisorBox();
          logToBot(`[ADVISOR] Action skipped by user.`);
          if (onSkip) onSkip();
        }
      );
      return true;
    }
    isActing = true;
    const delay = Math.max(200, delayMs);
    setTimeout(() => {
      isActing = false;
    }, delay + 350);
    logToBot(`[PROTOCOL ACTION] ${title} - ${reason}`);
    setTimeout(() => {
      if (onExecute) onExecute();
    }, delay);
    return true;
  }
  var ActionExecutor = {
    async handleTrade() {
      if (!CONFIG.AUTO_TRADE_ENABLED || isEvaluatingTrade) return false;
      const incomingTrades = (GameMemory.trades || []).filter(
        (t) => t.recipientId === GameMemory.myId || GameMemory.myName && GameMemory.isMe(t.recipient?.name)
      );
      if (incomingTrades.length === 0) return false;
      const trade = incomingTrades[0];
      const tradeId = trade.id;
      if (!tradeId) return false;
      const now = Date.now();
      if (processedTradeSignatures.has(tradeId) && now - processedTradeSignatures.get(tradeId) < 15e3) {
        return true;
      }
      isEvaluatingTrade = true;
      processedTradeSignatures.set(tradeId, now);
      try {
        const givenTiles = (trade.recipientOffer?.properties || []).map((id) => GameMemory.getTile(id)).filter(Boolean);
        const receivedTiles = (trade.initiatorOffer?.properties || []).map((id) => GameMemory.getTile(id)).filter(Boolean);
        const givenCash = trade.recipientOffer?.money || 0;
        const receivedCash = trade.initiatorOffer?.money || 0;
        const tradeData = {
          partnerName: trade.initiator?.name || "Opponent",
          givenTiles,
          givenCash,
          receivedTiles,
          receivedCash
        };
        logToBot(`[PROTOCOL TRADE] Evaluating incoming offer from ${tradeData.partnerName}...`);
        const verdict = await OllamaClient.evaluateTradeWithLLM(tradeData);
        logToBot(`[TRADE VERDICT] ${verdict.reason}`);
        if (verdict.accept) {
          return executeOrAdvise({
            title: `ACCEPT TRADE #${tradeId.slice(0, 6)}`,
            reason: verdict.reason,
            onExecute: () => {
              if (verdict.chatReply) ChatEngine.sendChatMessage("tradeAccept", verdict.chatReply);
              sendSocketAction("confirm-trade", { tradeId });
              GameMemory.trades = (GameMemory.trades || []).filter((t) => t.id !== tradeId);
            }
          });
        } else {
          return executeOrAdvise({
            title: `DECLINE TRADE #${tradeId.slice(0, 6)}`,
            reason: verdict.reason,
            onExecute: () => {
              if (verdict.chatReply) ChatEngine.sendChatMessage("tradeReject", verdict.chatReply);
              sendSocketAction("decline-trade", { tradeId });
              GameMemory.trades = (GameMemory.trades || []).filter((t) => t.id !== tradeId);
              if (verdict.counterSwap && CONFIG.AUTO_TRADE_ENABLED) {
                setTimeout(() => {
                  if (!TradeProposalExecutor.isExecuting) {
                    TradeProposalExecutor.executeProposal(verdict.counterSwap);
                  }
                }, 1200);
              }
            }
          });
        }
      } finally {
        isEvaluatingTrade = false;
      }
    },
    insolventTicks: 0,
    handleDebtRecovery() {
      if (!CONFIG.AUTO_MORTGAGE_ENABLED) return false;
      const myPlayerCash = GameMemory.players[GameMemory.myName]?.cash;
      const isDebt = GameMemory.myCash < 0 || GameMemory.isNegativeDebt || typeof myPlayerCash === "number" && myPlayerCash < 0;
      if (!isDebt) {
        this.insolventTicks = 0;
        return false;
      }
      logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets via protocol...`);
      const targets = DebtRecovery.rankLiquidationTargets();
      const bestTarget = targets.length > 0 ? targets[0] : null;
      if (bestTarget) {
        this.insolventTicks = 0;
        if (bestTarget.canSellHouse) {
          return executeOrAdvise({
            title: `SELL HOUSE: ${bestTarget.tile.name.toUpperCase()}`,
            reason: `Negative balance ($${GameMemory.myCash}). Liquidating house to survive.`,
            onExecute: () => {
              sendSocketAction("downgrade-city", { blockIndex: bestTarget.tile.id });
              if (GameMemory.ownership[bestTarget.tile.id]) {
                GameMemory.ownership[bestTarget.tile.id].houses = Math.max(0, (GameMemory.ownership[bestTarget.tile.id].houses || 1) - 1);
              }
            }
          });
        } else {
          return executeOrAdvise({
            title: `MORTGAGE: ${bestTarget.tile.name.toUpperCase()}`,
            reason: `Negative balance ($${GameMemory.myCash}). Mortgaging asset to clear debt.`,
            onExecute: () => {
              sendSocketAction("mortgage-property", { propertyIndex: bestTarget.tile.id });
              if (GameMemory.ownership[bestTarget.tile.id]) {
                GameMemory.ownership[bestTarget.tile.id].mortgaged = true;
              }
            }
          });
        }
      }
      this.insolventTicks = (this.insolventTicks || 0) + 1;
      if (this.insolventTicks >= 3) {
        return executeOrAdvise({
          title: "DECLARE BANKRUPTCY",
          reason: `Insolvent balance ($${GameMemory.myCash}) with zero liquidatable assets. Conceding match gracefully.`,
          onExecute: () => {
            sendSocketAction("do-bankrupt");
          }
        });
      }
      return true;
    },
    findNativeRollButton() {
      if (typeof document === "undefined") return null;
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find((b) => {
        const txt = (b.textContent || "").trim().toLowerCase();
        const isVisible = b.offsetParent !== null && !b.disabled;
        return isVisible && (txt === "roll the dice" || txt === "roll again" || txt.includes("roll the dice") || txt.includes("roll again"));
      }) || null;
    },
    findNativeEndTurnButton() {
      if (typeof document === "undefined") return null;
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find((b) => {
        const txt = (b.textContent || "").trim().toLowerCase();
        const isVisible = b.offsetParent !== null && !b.disabled;
        return isVisible && (txt === "end turn" || txt.includes("end turn"));
      }) || null;
    },
    findNativeBuyButton() {
      if (typeof document === "undefined") return null;
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find((b) => {
        const txt = (b.textContent || "").trim().toLowerCase();
        const isVisible = b.offsetParent !== null && !b.disabled;
        return isVisible && (txt.includes("buy for") || txt.startsWith("buy"));
      }) || null;
    },
    findNativeAuctionButton() {
      if (typeof document === "undefined") return null;
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find((b) => {
        const txt = (b.textContent || "").trim().toLowerCase();
        const isVisible = b.offsetParent !== null && !b.disabled;
        return isVisible && (txt === "auction" || txt.includes("auction"));
      }) || null;
    },
    handleJail() {
      if (!GameMemory.inJail || !GameMemory.isMyTurn) return false;
      GameMemory.myPos = GameMemory.prisonBlockIndex ?? 10;
      const decision = JailStrategy.shouldPayToLeaveJail(GameMemory.myCash);
      const hasPardon = Boolean(GameMemory.pardonCards?.treasure || GameMemory.pardonCards?.surprise);
      if (decision.exit) {
        if (hasPardon) {
          return executeOrAdvise({
            title: "USE PARDON CARD (Get Out of Jail Free)",
            reason: decision.reason,
            onExecute: () => {
              GameMemory.inJail = false;
              const deck = GameMemory.pardonCards?.treasure ? "treasure" : "surprise";
              sendSocketAction("use-pardon-card", deck);
            }
          });
        } else if (GameMemory.myCash >= 50) {
          return executeOrAdvise({
            title: "PAY $50 JAIL BAIL",
            reason: decision.reason,
            onExecute: () => {
              GameMemory.inJail = false;
              sendSocketAction("pay-out-of-prison");
            }
          });
        }
      }
      if (!GameMemory.hasRolled) {
        return executeOrAdvise({
          title: "ROLL IN JAIL (Safe Stay)",
          reason: "Rolling dice to stay safe in cell or leave on doubles.",
          onExecute: () => {
            GameMemory.hasRolled = true;
            const btn = this.findNativeRollButton();
            if (btn) {
              try {
                btn.click();
              } catch (_) {
              }
            }
            sendSocketAction("plz-roll-dices");
          }
        });
      }
      return false;
    },
    handleBuyOrAuction() {
      if (!GameMemory.isMyTurn || !GameMemory.hasRolled) return false;
      const nativeBuy = this.findNativeBuyButton();
      const nativeAuction = this.findNativeAuctionButton();
      if (nativeBuy || nativeAuction) {
        let price2 = 0;
        if (nativeBuy) {
          const match = nativeBuy.textContent.match(/\$(\d+)/);
          if (match) price2 = parseInt(match[1], 10);
        }
        if (!price2) {
          const tile3 = GameMemory.getTile(GameMemory.myPos);
          price2 = tile3?.price || 100;
        }
        const tile2 = GameMemory.getTile(GameMemory.myPos) || { name: "Property", price: price2, group: "Special" };
        const decision2 = MarkovRisk.shouldBuyProperty(tile2, price2, GameMemory.myCash);
        if (decision2.buy && GameMemory.myCash >= price2 && nativeBuy) {
          return executeOrAdvise({
            title: `BUY ${tile2.name.toUpperCase()} (DOM Verified $${price2})`,
            reason: decision2.reason,
            delayMs: 800,
            onExecute: () => {
              try {
                nativeBuy.click();
              } catch (_) {
              }
              sendSocketAction("purchase-property", {});
              if (GameMemory.ownership[GameMemory.myPos]) {
                GameMemory.ownership[GameMemory.myPos].owner = GameMemory.myName || "__ME__";
              }
              GameMemory.myCash -= price2;
            }
          });
        } else if (nativeAuction) {
          return executeOrAdvise({
            title: `PASS / AUCTION ${tile2.name.toUpperCase()} (DOM Verified)`,
            reason: decision2.reason || "Sending to auction to conserve cash reserve",
            delayMs: 800,
            onExecute: () => {
              try {
                nativeAuction.click();
              } catch (_) {
              }
              sendSocketAction("start-auction", {});
            }
          });
        }
      }
      const tile = GameMemory.getTile(GameMemory.myPos);
      const isPurchasable = tile && tile.group && (tile.type === "property" || tile.type === "airport" || tile.type === "utility");
      const isUnowned = isPurchasable && !GameMemory.ownership[tile.id]?.owner;
      if (!isUnowned) return false;
      const price = tile.price || 60;
      const decision = MarkovRisk.shouldBuyProperty(tile, price, GameMemory.myCash);
      logToBot(`[BUY EVAL] ${tile.name} ($${price}) | Cash: $${GameMemory.myCash} | Decision: ${decision.buy ? "BUY" : "AUCTION"} (${decision.reason})`);
      if (decision.buy && GameMemory.myCash >= price) {
        return executeOrAdvise({
          title: `BUY ${tile.name.toUpperCase()} ($${price})`,
          reason: decision.reason,
          delayMs: 800,
          onExecute: () => {
            sendSocketAction("purchase-property", {});
            if (GameMemory.ownership[tile.id]) {
              GameMemory.ownership[tile.id].owner = GameMemory.myName || "__ME__";
            }
            GameMemory.myCash -= price;
          }
        });
      } else {
        return executeOrAdvise({
          title: `PASS / AUCTION ${tile.name.toUpperCase()}`,
          reason: decision.reason || "Sending to auction to conserve cash reserve",
          delayMs: 800,
          onExecute: () => {
            sendSocketAction("start-auction", {});
          }
        });
      }
    },
    handleRollDice() {
      const nativeBtn = this.findNativeRollButton();
      if (nativeBtn && !GameMemory.hasRolled && !GameMemory.inJail) {
        GameMemory.isMyTurn = true;
        return executeOrAdvise({
          title: `ROLL THE DICE (DOM Verified)`,
          reason: `Native roll button is active on screen. Executing roll.`,
          delayMs: 900,
          onExecute: () => {
            GameMemory.hasRolled = true;
            try {
              nativeBtn.click();
            } catch (_) {
            }
            sendSocketAction("plz-roll-dices", {});
          }
        });
      }
      if (!GameMemory.isMyTurn || GameMemory.hasRolled || GameMemory.inJail) return false;
      if (this.findNativeBuyButton() || this.findNativeAuctionButton()) {
        if (this.handleBuyOrAuction()) return true;
      }
      const isRollAgain = Boolean(GameMemory.doublesInARow && GameMemory.doublesInARow > 0);
      return executeOrAdvise({
        title: isRollAgain ? `ROLL AGAIN (Doubles! Roll #${GameMemory.doublesInARow + 1})` : `ROLL THE DICE (Turn #${GameMemory.turnCount + 1})`,
        reason: isRollAgain ? `Doubles rolled! Extra roll granted.` : `My turn! Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`,
        delayMs: 900,
        onExecute: () => {
          GameMemory.hasRolled = true;
          if (!isRollAgain) {
            GameMemory.turnCount++;
          }
          const btn = this.findNativeRollButton();
          if (btn) {
            try {
              btn.click();
            } catch (_) {
            }
          }
          sendSocketAction("plz-roll-dices", {});
        }
      });
    },
    handleAuction() {
      if (!CONFIG.AUTO_AUCTION_ENABLED || !GameMemory.activeAuction) return false;
      const auction = GameMemory.activeAuction;
      const auctionedTile = GameMemory.getTile(auction.blockIndex) || null;
      const currentBid = auction.currentBid || auction.price || 0;
      const decision = AuctionSniper.evaluateAuctionStep(auctionedTile, currentBid, GameMemory.myCash);
      if (decision.shouldBid) {
        const newBid = currentBid + decision.increment;
        if (GameMemory.myCash >= newBid) {
          return executeOrAdvise({
            title: `AUCTION BID: $${newBid} [${auctionedTile ? auctionedTile.name : "Tile"}]`,
            reason: decision.reason,
            onExecute: () => {
              sendSocketAction("auction-bid", { amount: newBid });
            }
          });
        }
      }
      return false;
    },
    async handleHouseBuilding() {
      if (!CONFIG.AUTO_BUILD_ENABLED || !GameMemory.isMyTurn || !GameMemory.hasRolled) return false;
      const completeSets = [];
      const groupTilesMap = GameMemory.getGroupTiles();
      for (const [groupName, tiles] of Object.entries(groupTilesMap)) {
        if (!tiles || !tiles[0] || tiles[0].type !== "property") continue;
        const { owned, total } = GameMemory.getGroupCount(groupName, "__ME__");
        if (owned === total) {
          const unmortgaged = tiles.every((t) => !GameMemory.ownership[t.id]?.mortgaged);
          if (unmortgaged) {
            const houseCounts = tiles.map((t) => GameMemory.ownership[t.id]?.houses || 0);
            const minHouses = Math.min(...houseCounts);
            if (minHouses < 5) {
              completeSets.push({
                groupName,
                tiles,
                minHouses,
                houseCost: tiles[0].houseCost
              });
            }
          }
        }
      }
      if (completeSets.length === 0) return false;
      const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
      const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);
      const affordableSets = completeSets.filter((s) => GameMemory.myCash - s.houseCost >= reserve);
      if (affordableSets.length === 0) return false;
      affordableSets.sort((a, b) => (GROUP_POWER[b.groupName] || 0) - (GROUP_POWER[a.groupName] || 0));
      const targetSet = affordableSets[0];
      const candidateTile = targetSet.tiles.find((t) => (GameMemory.ownership[t.id]?.houses || 0) === targetSet.minHouses);
      if (candidateTile) {
        return executeOrAdvise({
          title: `UPGRADE ${candidateTile.name.toUpperCase()} (HOUSE #${targetSet.minHouses + 1})`,
          reason: `Monopoly upgrade on ${targetSet.groupName}. Cash ($${GameMemory.myCash}) > Reserve ($${reserve}).`,
          onExecute: () => {
            sendSocketAction("upgrade-city", { blockIndex: candidateTile.id });
            if (GameMemory.ownership[candidateTile.id]) {
              GameMemory.ownership[candidateTile.id].houses = targetSet.minHouses + 1;
            }
            GameMemory.myCash -= targetSet.houseCost;
          }
        });
      }
      return false;
    },
    handleUnmortgage() {
      if (!CONFIG.AUTO_MORTGAGE_ENABLED || !GameMemory.isMyTurn || !GameMemory.hasRolled) return false;
      const dynamicReserve = MarkovRisk.computeDynamicReserve(GameMemory.myPos);
      const reserve = Math.max(CONFIG.BASE_MIN_RESERVE || 250, dynamicReserve);
      const candidates = DebtRecovery.rankUnmortgageCandidates(GameMemory.myCash, reserve);
      if (candidates.length === 0) return false;
      const target = candidates[0];
      return executeOrAdvise({
        title: `UNMORTGAGE ${target.tile.name.toUpperCase()}`,
        reason: `Surplus funds available ($${GameMemory.myCash} > $${reserve + 200}). Restoring asset.`,
        onExecute: () => {
          sendSocketAction("lift-property-mortgage", { propertyIndex: target.tile.id });
          if (GameMemory.ownership[target.tile.id]) {
            GameMemory.ownership[target.tile.id].mortgaged = false;
          }
        }
      });
    },
    handleProactiveTrade() {
      if (!CONFIG.AUTO_TRADE_ENABLED || !GameMemory.isMyTurn || TradeProposalExecutor.isExecuting) return false;
      const swaps = TradeEngine.scanMutualMonopolySwaps();
      if (swaps.length === 0) return false;
      const validSwap = swaps.find(
        (s) => TradeProposalExecutor.canProposeToPlayer(s.targetOwner) && !TradeProposalExecutor.isSwapSkipped(s.summary)
      );
      if (!validSwap) return false;
      const cashText = validSwap.cashDemand > 0 ? ` (+ ask $${validSwap.cashDemand})` : validSwap.cashOffer > 0 ? ` (+ offer $${validSwap.cashOffer})` : "";
      return executeOrAdvise({
        title: `PROPOSE TRADE: ${validSwap.targetOwner.toUpperCase()}`,
        reason: `${validSwap.summary}${cashText}. Mutual win-win.`,
        onExecute: () => {
          TradeProposalExecutor.executeProposal(validSwap);
        },
        onSkip: () => {
          TradeProposalExecutor.recordSkipped(validSwap.summary);
        }
      });
    },
    lastDeliberatedTurn: -1,
    async deliberateBeforeEndTurn() {
      if (CONFIG.DELIBERATE_BEFORE_END_TURN && CONFIG.OLLAMA_ENABLED && this.lastDeliberatedTurn !== GameMemory.turnCount) {
        this.lastDeliberatedTurn = GameMemory.turnCount;
        const verdict = await OllamaClient.deliberateEndTurnStrategy();
        if (verdict.action === "UPGRADE") {
          if (await this.handleHouseBuilding()) return true;
        }
      }
      return this.handleEndTurn();
    },
    handleEndTurn() {
      if (!GameMemory.isMyTurn || !GameMemory.hasRolled) return false;
      if (GameMemory.myCash < 0 || GameMemory.isNegativeDebt) {
        logToBot(`[DEBT GUARD] Cannot end turn while in debt ($${GameMemory.myCash}). Liquidating...`);
        if (this.handleDebtRecovery()) return true;
        return false;
      }
      if (this.findNativeBuyButton() || this.findNativeAuctionButton()) {
        logToBot(`[TURN GUARD] Purchase/Auction decision pending on screen. Resolving before ending turn.`);
        if (this.handleBuyOrAuction()) return true;
        return false;
      }
      const standingTile = GameMemory.getTile(GameMemory.myPos);
      const isPurchasable = standingTile && standingTile.group && (standingTile.type === "property" || standingTile.type === "airport" || standingTile.type === "utility");
      const isUnowned = isPurchasable && !GameMemory.ownership[standingTile.id]?.owner;
      if (isUnowned && GameMemory.myCash >= (standingTile.price || 0)) {
        if (this.handleBuyOrAuction()) return true;
      }
      return executeOrAdvise({
        title: "END TURN",
        reason: `Turn actions complete. Passing priority to next player.`,
        delayMs: 700,
        onExecute: () => {
          TradeProposalExecutor.cancelPendingTrade();
          const endBtn = this.findNativeEndTurnButton();
          if (endBtn) {
            try {
              endBtn.click();
            } catch (_) {
            }
          }
          sendSocketAction("end-turn", {});
          GameMemory.isMyTurn = false;
          GameMemory.hasRolled = false;
        }
      });
    },
    handleTurnClockWatchdog() {
      if (!GameMemory.isMyTurn) return false;
      const leftMs = GameMemory.getTurnClockRemainingMs();
      const autoActed = GameMemory.autoActedTurns || 0;
      const isUrgentStrikeRisk = autoActed >= 1;
      const clockRequestThreshold = isUrgentStrikeRisk ? 12e3 : 7e3;
      const emergencyThreshold = isUrgentStrikeRisk ? 5e3 : 2500;
      if (leftMs < clockRequestThreshold && !GameMemory.turnClock.clockRequestedThisTurn) {
        GameMemory.turnClock.clockRequestedThisTurn = true;
        logToBot(`[TURN CLOCK] \u26A0\uFE0F Turn timer low (${Math.round(leftMs / 1e3)}s${isUrgentStrikeRisk ? " [STRIKE RISK!]" : ""})! Requesting +60s extension...`);
        sendSocketAction("request-clock-time");
        return true;
      }
      if (leftMs < emergencyThreshold) {
        logToBot(`[TURN CLOCK] \u{1F6A8} EMERGENCY FALLBACK (${Math.round(leftMs / 1e3)}s left${isUrgentStrikeRisk ? " - 2ND STRIKE PREVENTION" : ""})! Auto-acting.`);
        if (!GameMemory.hasRolled && !GameMemory.inJail) {
          GameMemory.hasRolled = true;
          const btn = this.findNativeRollButton();
          if (btn) {
            try {
              btn.click();
            } catch (_) {
            }
          }
          sendSocketAction("plz-roll-dices");
          return true;
        } else {
          this.handleEndTurn();
          return true;
        }
      }
      return false;
    }
  };

  // src/protocol/socketHook.js
  var onSocketMessageCallback = null;
  function setSocketMessageCallback(fn) {
    onSocketMessageCallback = fn;
  }
  function sendSocketAction(eventName, payload) {
    const ws = GameMemory.activeSocket;
    if (!ws || ws.readyState !== 1) {
      return false;
    }
    let prefix = GameMemory.socketPrefix || "42/api/game,";
    prefix = prefix.replace(/(,\d+)$/, ",");
    if (!prefix.includes("/api/game")) prefix = "42/api/game,";
    GameMemory.socketPrefix = prefix;
    const body = payload !== void 0 ? payload : {};
    const packet = `${prefix}${JSON.stringify([eventName, body])}`;
    logToBot(`[ZERO-UI WS] \u{1F680} Sent: ${eventName} ${JSON.stringify(body)}`);
    ws.send(packet);
    return true;
  }
  function requestFullStateResync() {
    logToBot(`[PROTOCOL] \u{1F504} Requesting authoritative game state resync from server...`);
    return sendSocketAction("request-sync", { snapshot: "" });
  }
  function getPlayerIdByName(name) {
    if (!name) return null;
    const cleanTarget = String(name).replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[->\]\[→←\|👑:]/g, "").replace(/[^\w\s-]/g, "").trim().toLowerCase();
    for (const [pName, pData] of Object.entries(GameMemory.players)) {
      const cleanName = String(pName).replace(/[\p{Emoji}\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").replace(/[->\]\[→←\|👑:]/g, "").replace(/[^\w\s-]/g, "").trim().toLowerCase();
      if (cleanName === cleanTarget && pData?.id !== void 0) {
        return pData.id;
      }
    }
    return null;
  }
  function hookSocketInstance(ws) {
    if (!ws || ws.__richupSendHooked) return;
    ws.__richupSendHooked = true;
    GameMemory.activeSocket = ws;
    const origSend = ws.send;
    ws.send = function(data) {
      try {
        const raw = typeof data === "string" ? data : "";
        if (raw && raw !== "2" && raw !== "3") {
          console.log("%c[OUTGOING WS FRAME]", "color: #38bdf8; font-weight: bold;", raw);
          if (!GameMemory.wsOutgoing) GameMemory.wsOutgoing = [];
          if (GameMemory.wsOutgoing.length >= 50) GameMemory.wsOutgoing.shift();
          GameMemory.wsOutgoing.push({
            ts: Date.now(),
            raw
          });
          logToBot(`[WS OUTGOING] \u{1F4E4} ${raw.slice(0, 140)}`);
          parseOutgoingSocketIOFrame(raw);
        }
      } catch (err) {
        console.warn("[RichUpBot WS Hook] Error in ws.send hook:", err);
      }
      return origSend.apply(this, arguments);
    };
  }
  function parseOutgoingSocketIOFrame(raw) {
    if (!raw || typeof raw !== "string") return;
    const bracketIdx = raw.indexOf("[");
    if (bracketIdx === -1) return;
    let prefix = raw.slice(0, bracketIdx);
    if (prefix) {
      prefix = prefix.replace(/(,\d+)$/, ",");
      if (!prefix.includes("/api/game")) prefix = "42/api/game,";
      GameMemory.socketPrefix = prefix;
    }
    try {
      const arr = JSON.parse(raw.slice(bracketIdx));
      if (!Array.isArray(arr) || arr.length === 0) return;
      const eventName = arr[0];
      const payload = arr[1];
      logToBot(`[WS ACTION DETECTED] Event: "${eventName}" Payload: ${JSON.stringify(payload)}`);
      console.log("[RICHUP OUTGOING ACTION]", { eventName, payload, prefix });
    } catch (_) {
    }
  }
  function installWebSocketHook() {
    const targetWin = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
    if (targetWin.__richupWsHooked) return;
    targetWin.__richupWsHooked = true;
    const NativeWS = targetWin.WebSocket;
    if (!NativeWS) return;
    targetWin.WebSocket = function(...args) {
      const ws = new NativeWS(...args);
      hookSocketInstance(ws);
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
    const origProtoSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function(data) {
      try {
        hookSocketInstance(this);
        const raw = typeof data === "string" ? data : "";
        if (raw && raw !== "2" && raw !== "3") {
          console.log("%c[OUTGOING WS PROTO FRAME]", "color: #38bdf8; font-weight: bold;", raw);
          if (!GameMemory.wsOutgoing) GameMemory.wsOutgoing = [];
          if (GameMemory.wsOutgoing.length >= 50) GameMemory.wsOutgoing.shift();
          GameMemory.wsOutgoing.push({
            ts: Date.now(),
            raw
          });
          parseOutgoingSocketIOFrame(raw);
        }
      } catch (_) {
      }
      return origProtoSend.apply(this, arguments);
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
        const gs = payload.gameState || payload.room || payload;
        const settings = gs.settings || payload.settings;
        if (settings) {
          if (typeof settings.can_collect_rent_in_jail === "boolean") {
            GameMemory.roomSettings.collectRentInJail = settings.can_collect_rent_in_jail;
          }
          if (typeof settings.double_on_start === "boolean") {
            GameMemory.roomSettings.doubleOnStart = settings.double_on_start;
          }
          if (typeof settings.pass_start_bonus === "number") {
            GameMemory.roomSettings.passStartBonus = settings.pass_start_bonus;
          }
          if (typeof settings.startingCash === "number") {
            GameMemory.roomSettings.startingCash = settings.startingCash;
          } else if (typeof settings.starting_cash === "number") {
            GameMemory.roomSettings.startingCash = settings.starting_cash;
          }
          if (GameMemory.roomSettings.startingCash && !GameMemory.cashVerified) {
            GameMemory.myCash = GameMemory.roomSettings.startingCash;
          }
        }
        const myId = payload.selfParticipantId || payload.myId || payload.my_id || payload.userId || payload.user_id || payload.playerId;
        if (myId) {
          GameMemory.myId = myId;
        }
        const playersList = Array.isArray(gs.participants) ? gs.participants : Array.isArray(payload.participants) ? payload.participants : Array.isArray(gs.players) ? gs.players : Array.isArray(payload.playerList) ? payload.playerList : null;
        if (playersList) {
          const me = myId ? playersList.find((p) => p.id === myId || p.userId === myId || p.isMe || p.is_me) : playersList.find((p) => p.isMe || p.is_me);
          if (me && (me.name || me.username)) {
            GameMemory.setMyName(me.name || me.username);
          }
          if (me?.clock?.autoActedTurns !== void 0) {
            GameMemory.autoActedTurns = me.clock.autoActedTurns;
          }
          if (Array.isArray(gs.blocks) && gs.blocks.length > 0) {
            GameMemory.boardLength = gs.blocks.length;
            const cfg = gs.boardConfig || {};
            GameMemory.prisonBlockIndex = cfg.prisonBlockIndex ?? (gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "prison") !== -1 ? gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "prison") : 10);
            GameMemory.vacationBlockIndex = cfg.vacationBlockIndex ?? (gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "vacation") !== -1 ? gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "vacation") : 20);
            GameMemory.goToPrisonBlockIndex = cfg.goToPrisonBlockIndex ?? (gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "go-to-prison") !== -1 ? gs.blocks.findIndex((b) => b.type === "corner" && b.cornerType === "go-to-prison") : 30);
            const pMap = /* @__PURE__ */ new Map();
            for (const p of playersList) {
              const pName = p.name || p.username;
              const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;
              if (pName) {
                if (pId !== void 0) pMap.set(String(pId), pName);
                pMap.set(pName, pName);
              }
            }
            GameMemory.boardTiles = gs.blocks.map((b, idx) => {
              let type = b.type;
              if (type === "city") type = "property";
              else if (type === "company") type = "utility";
              let group = b.countryId;
              if (!group) {
                if (type === "airport") group = "Airport";
                else if (type === "utility") group = "Utility";
                else group = null;
              } else {
                group = group.charAt(0).toUpperCase() + group.slice(1);
              }
              let rent = [];
              if (Array.isArray(b.rentPrices)) {
                rent = [...b.rentPrices];
              } else if (b.rentPrices && typeof b.rentPrices === "object") {
                rent = [
                  b.rentPrices[0] || b.rentPrices["0"] || 0,
                  b.rentPrices[1] || b.rentPrices["1"] || 0,
                  b.rentPrices[2] || b.rentPrices["2"] || 0,
                  b.rentPrices[3] || b.rentPrices["3"] || 0,
                  b.rentPrices[4] || b.rentPrices["4"] || 0,
                  b.rentPrices[5] || b.rentPrices["5"] || 0
                ];
              }
              const ownerId = b.ownerId || b.userId || null;
              let resolvedOwner = null;
              if (ownerId) {
                resolvedOwner = pMap.get(String(ownerId)) || (myId && String(ownerId) === String(myId) ? GameMemory.myName || "__ME__" : String(ownerId));
              }
              GameMemory.ownership[idx] = {
                owner: resolvedOwner,
                houses: typeof b.level === "number" ? b.level : typeof b.houses === "number" ? b.houses : 0,
                mortgaged: Boolean(b.isMortgaged || b.mortgaged)
              };
              return {
                id: idx,
                name: b.name || `Tile #${idx}`,
                type,
                group,
                price: b.price || 0,
                houseCost: b.housePrice || b.hotelPrice || Math.round(b.price || 50),
                rent,
                markov: idx >= 14 && idx <= 26 ? 1.3 / gs.blocks.length : 1 / gs.blocks.length
              };
            });
            const gTiles = {};
            GameMemory.boardTiles.forEach((t) => {
              if (t.group) {
                if (!gTiles[t.group]) gTiles[t.group] = [];
                gTiles[t.group].push(t);
              }
            });
            GameMemory.groupTiles = gTiles;
          }
          if (typeof gs.vacationCash === "number") {
            GameMemory.vacationCash = gs.vacationCash;
          }
          if (gs.bonusCards) {
            const meId = GameMemory.myId;
            GameMemory.pardonCards = {
              treasure: Boolean(meId && gs.bonusCards.treasure?.pardonCardHolderId === meId),
              surprise: Boolean(meId && gs.bonusCards.surprise?.pardonCardHolderId === meId)
            };
          }
          const prisonIdx = GameMemory.prisonBlockIndex;
          const prisonBlock = Array.isArray(gs.blocks) ? gs.blocks[prisonIdx] : null;
          const prisonSuspensions = prisonBlock && typeof prisonBlock.suspendedTurnsRemaining === "object" ? prisonBlock.suspendedTurnsRemaining : null;
          const validNames = /* @__PURE__ */ new Set();
          GameMemory.participantsOrder = [];
          for (const p of playersList) {
            const pName = p.name || p.username;
            if (!pName) continue;
            validNames.add(pName);
            const isBankrupt = Boolean(p.bankrupt || p.bankruptedAt);
            GameMemory.participantsOrder.push({
              id: p.id ?? p.userId ?? p.user_id ?? p.playerId,
              name: pName,
              bankrupt: isBankrupt
            });
            const rawMoney = typeof p.money === "number" ? p.money : typeof p.cash === "number" ? p.cash : typeof p.balance === "number" ? p.balance : null;
            const isThisPlayerMe = GameMemory.isMe(pName) || myId && (p.id === myId || p.userId === myId) || Boolean(p.isMe || p.is_me);
            const pId = p.id ?? p.userId ?? p.user_id ?? p.playerId;
            const playerPos = typeof p.position === "number" ? p.position : typeof p.pos === "number" ? p.pos : GameMemory.players[pName]?.pos || 0;
            const realJailTurns = prisonSuspensions && pId ? prisonSuspensions[pId] || 0 : 0;
            const isReallyInJail = realJailTurns > 0 || playerPos === prisonIdx && Boolean(p.inJail || p.jailTurns || p.in_jail);
            if (rawMoney !== null) {
              GameMemory.players[pName] = {
                id: pId,
                cash: rawMoney,
                pos: playerPos,
                inJail: isReallyInJail,
                isMe: isThisPlayerMe,
                bankrupt: isBankrupt
              };
              if (isThisPlayerMe) {
                GameMemory.setMyName(pName);
                GameMemory.myCash = rawMoney;
                GameMemory.cashVerified = true;
                GameMemory.myPos = playerPos;
                GameMemory.inJail = isReallyInJail;
                GameMemory.jailTurns = realJailTurns;
                if (p.clock?.autoActedTurns !== void 0) {
                  GameMemory.autoActedTurns = p.clock.autoActedTurns;
                }
              }
            }
          }
          if (typeof gs.currentPlayerIndex === "number") {
            GameMemory.currentPlayerIndex = gs.currentPlayerIndex;
            if (playersList[gs.currentPlayerIndex]) {
              const curP = playersList[gs.currentPlayerIndex];
              GameMemory.isMyTurn = Boolean(GameMemory.isMe(curP.name || curP.username) || myId && curP.id === myId);
            }
          }
          if (typeof gs.cubesRolledInTurn === "boolean") {
            if (GameMemory.isMyTurn) {
              GameMemory.hasRolled = gs.cubesRolledInTurn;
            }
          }
          if (typeof gs.canPerformTurnActions === "boolean") {
            GameMemory.canPerformTurnActions = gs.canPerformTurnActions;
          }
          if (typeof gs.doublesInARow === "number") {
            GameMemory.doublesInARow = gs.doublesInARow;
          }
          if (gs.turnClock) {
            GameMemory.updateTurnClock(gs.turnClock);
          }
          if (Array.isArray(gs.trades)) {
            GameMemory.trades = gs.trades;
          }
          if (gs.auction !== void 0) {
            GameMemory.activeAuction = gs.auction;
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
      if (eventName === "game-started" || eventName.includes("game-started")) {
        logToBot(`[WS TELEMETRY] \u{1F3C1} New game started! Resetting memory.`);
        GameMemory.reset();
        if (payload && Array.isArray(payload.participantsOrder)) {
          GameMemory.participantsOrder = payload.participantsOrder.map((p) => ({
            id: p.id,
            name: p.name || p.username,
            bankrupt: false
          }));
        }
      }
      if (eventName.includes("roll") || eventName.includes("dice")) {
        const dice = Array.isArray(payload.dice) ? payload.dice : Array.isArray(payload) ? payload : [];
        const sum = (dice[0] || 0) + (dice[1] || 0);
        const isDoubles = dice.length >= 2 && dice[0] === dice[1] && dice[0] > 0;
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        const isMeRolling = pName && GameMemory.isMe(pName) || !pName && GameMemory.isMyTurn;
        if (isMeRolling && sum > 0) {
          if (isDoubles) {
            GameMemory.hasRolled = false;
            GameMemory.doublesInARow = (GameMemory.doublesInARow || 0) + 1;
            logToBot(`[DICE] \u{1F3B2} DOUBLES ROLLED ([${dice[0]},${dice[1]}])! "Roll again" granted (Doubles #${GameMemory.doublesInARow})`);
          } else {
            GameMemory.hasRolled = true;
            GameMemory.doublesInARow = 0;
          }
          if (!GameMemory.inJail) {
            const bLen = GameMemory.getBoardLength();
            GameMemory.myPos = (GameMemory.myPos + sum) % bLen;
            const tileName = GameMemory.getTile(GameMemory.myPos)?.name || "Unknown";
            logToBot(`[DICE] \u{1F3B2} I rolled ${sum} ([${dice.join(",")}]) -> Moved to Tile #${GameMemory.myPos} (${tileName})`);
          }
        } else if (pName && GameMemory.players[pName]) {
          if (!GameMemory.players[pName].inJail && sum > 0) {
            const bLen = GameMemory.getBoardLength();
            const currentOppPos = GameMemory.players[pName].pos || 0;
            GameMemory.players[pName].pos = (currentOppPos + sum) % bLen;
            logToBot(`[DICE] \u{1F3B2} ${pName} rolled ${sum} -> Tile #${GameMemory.players[pName].pos}`);
          }
        }
      }
      if (eventName.includes("purchase") || eventName.includes("buy")) {
        const tileId = typeof payload.blockIndex === "number" ? payload.blockIndex : typeof payload.tileId === "number" ? payload.tileId : payload.tileIndex;
        const pName = payload.playerName || payload.username || payload.name || payload.player;
        const buyer = pName ? GameMemory.isMe(pName) ? GameMemory.myName || "__ME__" : pName : GameMemory.isMyTurn ? GameMemory.myName || "__ME__" : null;
        if (typeof tileId === "number") {
          GameMemory.lastPurchasedBlock = tileId;
          if (GameMemory.ownership[tileId]) {
            if (buyer) GameMemory.ownership[tileId].owner = buyer;
            logToBot(`[WS TELEMETRY] \u{1F3F7}\uFE0F Tile #${tileId} (${GameMemory.getTile(tileId)?.name || "Unknown"}) acquired by ${buyer || "Active Player"}`);
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
          logToBot(`[WS TELEMETRY] \u{1F528} Tile #${tileId} (${GameMemory.getTile(tileId)?.name || "Unknown"}) won at auction by ${buyer}`);
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
      if (eventName === "turn-ended" || eventName.includes("turn-ended")) {
        GameMemory.hasRolled = false;
        GameMemory.isMyTurn = false;
        if (Array.isArray(GameMemory.participantsOrder) && GameMemory.participantsOrder.length > 0) {
          let nextIdx = (GameMemory.currentPlayerIndex + 1) % GameMemory.participantsOrder.length;
          let loops = 0;
          while (loops < GameMemory.participantsOrder.length) {
            const candidate = GameMemory.participantsOrder[nextIdx];
            const pData = GameMemory.players[candidate.name] || candidate;
            if (!pData.bankrupt && !pData.bankruptedAt) {
              break;
            }
            nextIdx = (nextIdx + 1) % GameMemory.participantsOrder.length;
            loops++;
          }
          GameMemory.currentPlayerIndex = nextIdx;
          const nextPlayer = GameMemory.participantsOrder[nextIdx];
          if (nextPlayer) {
            GameMemory.isMyTurn = Boolean(GameMemory.isMe(nextPlayer.name) || GameMemory.myId && nextPlayer.id === GameMemory.myId);
            if (GameMemory.isMyTurn) {
              GameMemory.hasRolled = false;
              logToBot(`[TURN ADVANCE] \u{1F3AF} Advanced to Player #${nextIdx} (${nextPlayer.name}) -> It is MY TURN!`);
            } else {
              logToBot(`[TURN ADVANCE] \u23ED\uFE0F Advanced to Player #${nextIdx} (${nextPlayer.name})`);
            }
          }
        }
      } else if (eventName.includes("turn")) {
        const active = payload.activePlayer || payload.player || payload.username || payload.name;
        if (active) {
          GameMemory.isMyTurn = GameMemory.isMe(active);
          if (GameMemory.isMyTurn) {
            GameMemory.hasRolled = false;
          }
        }
      }
      if (eventName === "auction-started" || eventName.includes("auction-started")) {
        const blockIndex = typeof payload.blockIndex === "number" ? payload.blockIndex : GameMemory.myPos;
        GameMemory.activeAuction = {
          blockIndex,
          currentBid: typeof payload.amount === "number" ? payload.amount : 0
        };
      }
      if (eventName === "auction-bade" || eventName.includes("auction-bade")) {
        if (GameMemory.activeAuction && typeof payload.amount === "number") {
          GameMemory.activeAuction.currentBid = payload.amount;
        }
      }
      if (eventName === "auction-ended" || eventName.includes("auction-ended")) {
        GameMemory.activeAuction = null;
      }
      if (eventName === "trade-created" || eventName.includes("trade-created")) {
        const tr = payload.trade || payload;
        if (tr) {
          if (!GameMemory.trades) GameMemory.trades = [];
          if (!GameMemory.trades.some((t) => t.id === tr.id)) {
            GameMemory.trades.push(tr);
          }
          if (tr.initiatorId === GameMemory.myId || GameMemory.myName && tr.initiator?.name === GameMemory.myName) {
            GameMemory.activeOutgoingTradeId = tr.id;
            GameMemory.activeOutgoingTradeTime = Date.now();
            logToBot(`[TRADE] \u{1F4E4} Outgoing trade registered (ID: ${tr.id}).`);
          }
        }
      }
      if (eventName === "trade-confirmed" || eventName === "trade-declined" || eventName === "trade-deleted") {
        const trId = payload.tradeId || payload.id;
        if (trId) {
          if (GameMemory.trades) {
            GameMemory.trades = GameMemory.trades.filter((t) => t.id !== trId);
          }
          if (GameMemory.activeOutgoingTradeId === trId) {
            GameMemory.activeOutgoingTradeId = null;
            GameMemory.activeOutgoingTradeTime = 0;
          }
        }
      }
      if (eventName === "clock-time-requested" || eventName.includes("clock-time-requested")) {
        const reqPid = payload.playerId || payload.participantId;
        if (reqPid && reqPid !== GameMemory.myId) {
          sendSocketAction("grant-clock-time");
          logToBot("[TURN CLOCK] \u23F1\uFE0F Opponent requested clock time -> Automatically granted +60s extension.");
        }
      }
      if (eventName === "clock-time-granted" || eventName.includes("clock-time-granted")) {
        if (GameMemory.turnClock) {
          GameMemory.turnClock.grantedMs = (GameMemory.turnClock.grantedMs || 0) + 6e4;
          GameMemory.turnClock.turnExpiresAt = (GameMemory.turnClock.turnExpiresAt || Date.now()) + 6e4;
        }
        logToBot("[TURN CLOCK] \u23F1\uFE0F Clock time granted (+60s)!");
      }
      if (eventName === "new-votekick-request" || eventName.includes("votekick")) {
        const targetId = payload.playerId || payload.votingPlayerId || payload.targetPlayerId;
        if (targetId && targetId !== GameMemory.myId) {
          sendSocketAction("votekick-player", { playerId: targetId });
          logToBot(`[ANTI-STALL] \u{1F5F3}\uFE0F Voted YES on votekick request to remove AFK staller.`);
        }
      }
      if (eventName === "game-ended" || eventName.includes("game-ended")) {
        const winnerId = payload.winnerId;
        const isMeWinner = Boolean(winnerId && (winnerId === GameMemory.myId || GameMemory.isMe(winnerId)));
        if (isMeWinner) {
          logToBot(`[VICTORY] \u{1F3C6} Match WON! Claiming free post-game coin rewards...`);
          try {
            fetch("/api/game/claim-coin-reward", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" }
            }).then((r) => r.json()).then((res) => {
              logToBot(`[VICTORY] \u{1F4B0} Coins claimed successfully: ${JSON.stringify(res)}`);
            }).catch(() => {
            });
          } catch (_) {
          }
        }
      }
      deepSyncFromObject(payload);
      deepSyncPropertiesFromPayload(payload);
      if (onSocketMessageCallback) {
        try {
          onSocketMessageCallback(eventName, payload);
        } catch (_) {
        }
      }
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
    const gs = payload.gameState || payload.room || payload;
    const playersList = Array.isArray(gs.participants) ? gs.participants : Array.isArray(payload.participants) ? payload.participants : Array.isArray(gs.players) ? gs.players : Array.isArray(payload.playerList) ? payload.playerList : null;
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
        const bLen = GameMemory.getBoardLength();
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (!item) continue;
          if (typeof item === "string" && obj.length >= 30 && i < bLen && GameMemory.ownership[i]) {
            const resolved = resolveOwner(item);
            if (resolved) GameMemory.ownership[i].owner = resolved;
            continue;
          }
          if (typeof item === "object") {
            const tileId = typeof item.blockIndex === "number" ? item.blockIndex : typeof item.tileId === "number" ? item.tileId : typeof item.index === "number" ? item.index : typeof item.id === "number" && item.id < bLen ? item.id : null;
            const targetId = tileId !== null ? tileId : obj.length >= 30 && i < bLen ? i : null;
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
    timeouts: /* @__PURE__ */ new Set(),
    intervals: /* @__PURE__ */ new Set(),
    evaluateTimeout: null,
    keydownHandler: null,
    cleanup() {
      this.status = false;
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
  var isEvaluating = false;
  async function evaluateAndAct() {
    try {
      if (!state.status || getIsActing() || isEvaluating) return;
      isEvaluating = true;
      try {
        HUDPanel.updateTelemetry();
      } catch (_) {
      }
      try {
        ChatEngine.scanAndRespondToOpponentChat().catch(() => {
        });
      } catch (_) {
      }
      try {
        TradeProposalExecutor.cancelStaleProposal();
        if (ActionExecutor.handleTurnClockWatchdog()) return;
      } catch (err) {
        logToBot(`[Clock Watchdog Warning] ${err}`);
      }
      try {
        if (await ActionExecutor.handleTrade()) return;
      } catch (err) {
        logToBot(`[Trade Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleDebtRecovery()) return;
      } catch (err) {
        logToBot(`[Debt Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleJail()) return;
      } catch (err) {
        logToBot(`[Jail Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleBuyOrAuction()) return;
      } catch (err) {
        logToBot(`[Buy/Auction Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleRollDice()) return;
      } catch (err) {
        logToBot(`[Roll Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleAuction()) return;
      } catch (err) {
        logToBot(`[Auction Warning] ${err}`);
      }
      try {
        if (await ActionExecutor.handleHouseBuilding()) return;
      } catch (err) {
        logToBot(`[Build Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleUnmortgage()) return;
      } catch (err) {
        logToBot(`[Unmortgage Warning] ${err}`);
      }
      try {
        if (ActionExecutor.handleProactiveTrade()) return;
      } catch (err) {
        logToBot(`[Trade Swap Warning] ${err}`);
      }
      try {
        await ActionExecutor.deliberateBeforeEndTurn();
      } catch (err) {
        logToBot(`[End Turn Warning] ${err}`);
        try {
          ActionExecutor.handleEndTurn();
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
    }, 60);
  }
  function toggleAutomation() {
    state.status = !state.status;
    HUDPanel.updateMasterButton(state.status);
    if (state.status) {
      logToBot("\u{1F680} GRANDMASTER AI ENGAGED. PURE PROTOCOL ACTIVE.");
      evaluateAndAct();
    } else {
      logToBot("\u23F8\uFE0F Automation Paused (STANDBY).");
    }
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
    HUDPanel.updateTelemetry();
    setSocketMessageCallback((eventName) => {
      if (state.status) {
        scheduleEvaluate();
      }
      try {
        HUDPanel.updateTelemetry();
      } catch (_) {
      }
    });
    scheduleInterval(() => {
      if (state.status && !getIsActing()) {
        evaluateAndAct();
      } else {
        try {
          HUDPanel.updateTelemetry();
        } catch (_) {
        }
      }
    }, 250);
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
