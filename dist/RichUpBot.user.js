// ==UserScript==
// @name         RichUp.io Grandmaster AI Engine (Modular Edition)
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Grandmaster-level autonomous AI for RichUp.io with full opponent tracking, auction sniping, Markov risk management, intelligent trading, and room-aware jail strategy.
// @author       haxxor + Grandmaster AI
// @license      GPL-3.0
// @match        https://richup.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==

(() => {
  // src/config.js
  var CONFIG = {
    // Action timing delays (in milliseconds) for human-like interaction
    ACTION_DELAY_MIN: 160,
    ACTION_DELAY_MAX: 320,
    OBSERVER_DEBOUNCE_MS: 100,
    POLL_INTERVAL_MS: 1200,
    SELF_HEAL_INTERVAL_MS: 1e3,
    STALL_TIMEOUT_SEC: 8,
    // AI Operation Mode: false = FULL_AUTO, true = ADVISOR (Asks human before acting)
    ADVISOR_MODE: false,
    // AI Strategy Toggles
    ALWAYS_BUY_AFFORDABLE: true,
    // Buy unowned lands when safe
    SMART_RESERVE_ENABLED: true,
    // Maintain dynamic cash reserve against opponent monopolies
    AMBUSH_BUILD_ONLY: true,
    // Never build when facing enemy hotels; build when enemies enter strike zone
    AUTO_TRADE_ENABLED: true,
    // Evaluate and propose win-win trades
    AUTO_AUCTION_ENABLED: true,
    // Intelligent auction bidding sniper
    AUTO_BUILD_ENABLED: true,
    // Rush 3 houses on monopolies
    AUTO_MORTGAGE_ENABLED: true,
    // Liquidate lowest-EV assets when in debt
    CHAT_ENABLED: true,
    // Contextual trade negotiation chat
    // Math & Game-Theory Parameters
    BASE_MIN_RESERVE: 60,
    // Absolute cash floor on empty board
    RISK_AVERSION_FACTOR: 1.75,
    // Multiplier on 1-turn expected rent loss
    WORST_CASE_WEIGHT: 0.3,
    // Weight on worst-case single roll in 5-9 window
    TRADE_MIN_ADVANTAGE_RATIO: 1.1,
    // Require at least 10% utility edge in trades
    AUCTION_MAX_OVERBID_RATIO: 1.4,
    // Max bid for critical blocker/completer
    CHAT_COOLDOWN_MS: 2e4,
    // Cooldown between chat negotiation messages
    // Hybrid Vision / LLM Brain Configuration (Local Ollama)
    OLLAMA_ENABLED: localStorage.getItem("richup_ollama_enabled") === "true",
    OLLAMA_HOST: localStorage.getItem("richup_ollama_host") || "http://localhost:11434",
    OLLAMA_MODEL: localStorage.getItem("richup_ollama_model") || "llama3.2-vision",
    OLLAMA_TIMEOUT_MS: 2800
    // Strict 2.8s cap to avoid stalling turns
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
    { id: 1, name: "Salvador", type: "property", group: "Brazil", price: 60, houseCost: 50, rent: [2, 10, 30, 90, 160, 250], markov: 0.0213 },
    { id: 2, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0188 },
    { id: 3, name: "Rio", type: "property", group: "Brazil", price: 60, houseCost: 50, rent: [4, 20, 60, 180, 320, 450], markov: 0.0216 },
    { id: 4, name: "Earnings Tax", type: "tax", group: null, price: 200, houseCost: 0, rent: [200], markov: 0.0233 },
    { id: 5, name: "TLV Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0296 },
    { id: 6, name: "Tel Aviv", type: "property", group: "Israel", price: 100, houseCost: 50, rent: [6, 30, 90, 270, 400, 550], markov: 0.0226 },
    { id: 7, name: "Haifa", type: "property", group: "Israel", price: 110, houseCost: 50, rent: [7, 35, 100, 300, 450, 600], markov: 0.0232 },
    { id: 8, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 86e-4 },
    { id: 9, name: "Jerusalem", type: "property", group: "Israel", price: 120, houseCost: 50, rent: [8, 40, 100, 300, 450, 600], markov: 0.023 },
    { id: 10, name: "In Prison", type: "jail", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0589 },
    { id: 11, name: "Venice", type: "property", group: "Italy", price: 130, houseCost: 100, rent: [10, 50, 150, 450, 625, 750], markov: 0.027 },
    { id: 12, name: "Power Company", type: "utility", group: "Utility", price: 150, houseCost: 0, rent: [28, 70], markov: 0.026 },
    { id: 13, name: "Milan", type: "property", group: "Italy", price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750], markov: 0.0237 },
    { id: 14, name: "Rome", type: "property", group: "Italy", price: 160, houseCost: 100, rent: [12, 60, 180, 500, 700, 900], markov: 0.0246 },
    { id: 15, name: "NUC Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0292 },
    { id: 16, name: "Frankfurt", type: "property", group: "Germany", price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950], markov: 0.0279 },
    { id: 17, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0259 },
    { id: 18, name: "Munich", type: "property", group: "Germany", price: 190, houseCost: 100, rent: [15, 75, 200, 550, 750, 950], markov: 0.0293 },
    { id: 19, name: "Berlin", type: "property", group: "Germany", price: 200, houseCost: 100, rent: [16, 80, 220, 600, 800, 1e3], markov: 0.0308 },
    { id: 20, name: "Vacation", type: "special", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0288 },
    { id: 21, name: "Shenzhen", type: "property", group: "China", price: 210, houseCost: 150, rent: [17, 85, 240, 670, 840, 1025], markov: 0.0283 },
    { id: 22, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0104 },
    { id: 23, name: "Beijing", type: "property", group: "China", price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050], markov: 0.0273 },
    { id: 24, name: "Shanghai", type: "property", group: "China", price: 240, houseCost: 150, rent: [20, 100, 300, 750, 925, 1100], markov: 0.0318 },
    { id: 25, name: "CDG Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0306 },
    { id: 26, name: "Lyon", type: "property", group: "France", price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150], markov: 0.027 },
    { id: 27, name: "Water Company", type: "utility", group: "Utility", price: 150, houseCost: 0, rent: [28, 70], markov: 0.0281 },
    { id: 28, name: "Toulouse", type: "property", group: "France", price: 270, houseCost: 150, rent: [23, 115, 345, 825, 1e3, 1175], markov: 0.0268 },
    { id: 29, name: "Paris", type: "property", group: "France", price: 280, houseCost: 150, rent: [24, 120, 360, 850, 1025, 1200], markov: 0.0258 },
    { id: 30, name: "Go to prison", type: "gotojail", group: null, price: 0, houseCost: 0, rent: [0], markov: 0 },
    { id: 31, name: "Liverpool", type: "property", group: "UK", price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275], markov: 0.0267 },
    { id: 32, name: "Manchester", type: "property", group: "UK", price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275], markov: 0.0262 },
    { id: 33, name: "London", type: "property", group: "UK", price: 320, houseCost: 200, rent: [28, 150, 450, 1e3, 1200, 1400], markov: 0.025 },
    { id: 34, name: "JFK Airport", type: "airport", group: "Airport", price: 200, houseCost: 0, rent: [25, 50, 100, 200], markov: 0.0243 },
    { id: 35, name: "Surprise", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 86e-4 },
    { id: 36, name: "San Francisco", type: "property", group: "USA", price: 350, houseCost: 200, rent: [35, 175, 500, 1100, 1300, 1500], markov: 0.0218 },
    { id: 37, name: "Treasure", type: "card", group: null, price: 0, houseCost: 0, rent: [0], markov: 0.0236 },
    { id: 38, name: "Luxury Tax", type: "tax", group: null, price: 75, houseCost: 0, rent: [75], markov: 0.0217 },
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
      "muc airport": BOARD_TILES[15],
      "income tax": BOARD_TILES[4]
    })
  );
  var TILE_BY_ID = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
      acc[tile.id] = tile;
      return acc;
    }, {})
  );
  var HIGH_TRAFFIC_GROUPS = /* @__PURE__ */ new Set(["Germany", "China", "France", "Italy"]);
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
    "chat if not bot"
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
    // Room Settings (Sniffed from match start or DOM)
    roomSettings: {
      startingCash: 1e3,
      // Default starting cash (e.g. $1000 or $1500)
      collectRentInJail: true,
      // RichUp default: players can collect rent in jail
      doubleOnStart: false,
      // Landing on Start gives $400?
      passStartBonus: 200,
      // Standard pass start bonus
      auctionsEnabled: true
      // Auctions allowed?
    },
    // All active players: name -> { cash, pos, inJail, isMe, bankrupt }
    players: {},
    // Tile ownership: tileId -> { owner, houses, mortgaged }
    ownership: {},
    // Diagnostic & tracking logs
    processedLogs: /* @__PURE__ */ new Set(),
    wsMessages: [],
    lastPurchasedBlock: null,
    lastDangerEV: 0,
    lastDynamicReserve: CONFIG.BASE_MIN_RESERVE,
    lastJailMode: "AGR_EXIT",
    lastTradeVerdict: "READY",
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

  // src/dom/socketHook.js
  function installWebSocketHook() {
    if (window.__richupWsHooked) return;
    window.__richupWsHooked = true;
    const NativeWS = window.WebSocket;
    if (!NativeWS) return;
    window.WebSocket = function(...args) {
      const ws = new NativeWS(...args);
      ws.addEventListener("message", (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw || raw === "2" || raw === "3") return;
          if (GameMemory.wsMessages.length >= 25) GameMemory.wsMessages.shift();
          GameMemory.wsMessages.push({
            ts: Date.now(),
            preview: raw.slice(0, 300)
          });
          parseSocketIOFrame(raw);
        } catch (_) {
        }
      });
      return ws;
    };
    window.WebSocket.prototype = NativeWS.prototype;
    Object.assign(window.WebSocket, NativeWS);
  }
  function parseSocketIOFrame(raw) {
    const bracketIdx = raw.indexOf("[");
    if (bracketIdx === -1) return;
    try {
      const arr = JSON.parse(raw.slice(bracketIdx));
      if (!Array.isArray(arr) || arr.length === 0) return;
      const eventName = arr[0];
      const payload = arr[1] || {};
      if (eventName === "game-started" || eventName === "init-game" || eventName === "game-state") {
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
        }
        if (payload.myId && Array.isArray(payload.players)) {
          const me = payload.players.find((p) => p.id === payload.myId || p.isMe);
          if (me && me.name) {
            GameMemory.setMyName(me.name);
          }
        }
      }
      if (eventName === "dice-rolled" && Array.isArray(payload.dice)) {
        const sum = (payload.dice[0] || 0) + (payload.dice[1] || 0);
        const isMeRolling = payload.playerName ? GameMemory.isMe(payload.playerName) : GameMemory.isMyTurn;
        if (isMeRolling && sum > 0) {
          GameMemory.myPos = (GameMemory.myPos + sum) % 40;
        } else if (payload.playerName && GameMemory.players[payload.playerName]) {
          const currentOppPos = GameMemory.players[payload.playerName].pos || 0;
          GameMemory.players[payload.playerName].pos = (currentOppPos + sum) % 40;
        }
      }
      if (eventName === "purchase-success" && typeof payload.blockIndex === "number") {
        const tileId = payload.blockIndex;
        GameMemory.lastPurchasedBlock = tileId;
        const buyer = payload.playerName || (GameMemory.isMyTurn ? GameMemory.myName || "__ME__" : null);
        if (buyer && GameMemory.ownership[tileId]) {
          GameMemory.ownership[tileId].owner = buyer;
        }
      }
      if (eventName === "turn-ended" || eventName === "turn-start") {
        if (payload.activePlayer) {
          GameMemory.isMyTurn = GameMemory.isMe(payload.activePlayer);
        }
      }
      deepSyncFromObject(payload);
    } catch (_) {
    }
  }
  function deepSyncFromObject(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(deepSyncFromObject);
      return;
    }
    if (typeof obj.name === "string" && typeof obj.money === "number") {
      const isThisPlayerMe = GameMemory.isMe(obj.name);
      GameMemory.players[obj.name] = {
        cash: obj.money,
        pos: typeof obj.position === "number" ? obj.position : GameMemory.players[obj.name]?.pos || 0,
        inJail: Boolean(obj.inJail || obj.jailTurns),
        isMe: isThisPlayerMe,
        bankrupt: Boolean(obj.bankrupt)
      };
      if (isThisPlayerMe) {
        GameMemory.myCash = obj.money;
        GameMemory.cashVerified = true;
        if (typeof obj.position === "number") GameMemory.myPos = obj.position;
        if (typeof obj.inJail === "boolean") GameMemory.inJail = obj.inJail;
      }
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "object") deepSyncFromObject(obj[k]);
    }
  }

  // src/dom/elementFinder.js
  function isVisibleAndEnabled(el) {
    if (!el || el.disabled) return false;
    const hud = document.getElementById("rubot-hud-panel");
    if (hud && hud.contains(el)) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function normalizeText(el) {
    return String(el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function createDOMSnapshot() {
    const rawButtons = document.getElementsByTagName("button");
    const allButtons = [];
    for (let i = 0; i < rawButtons.length; i++) {
      const btn = rawButtons[i];
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
        for (const b of allButtons) {
          if (b.text.includes("buy") && !b.text.includes("house") && !b.text.includes("hotel") && !b.text.includes("back") && (b.text.startsWith("buy") || b.text.endsWith("buy") || b.text.includes("buy for") || b.text.includes("purchase"))) {
            return b.el;
          }
        }
        return null;
      },
      findAuctionBidButton() {
        for (const b of allButtons) {
          if (b.text.includes("+$") || b.text.includes("+ $") || b.text.includes("bid") && !b.text.includes("history")) {
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
          if (b.text.includes("send trade") || b.text.includes("propose trade") || b.text === "send") {
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
        const hud = document.getElementById("rubot-hud-panel");
        for (let i = 0; i < allItems.length; i++) {
          const el = allItems[i];
          if (hud && hud.contains(el)) continue;
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
       * Finds the UP-ARROW [↑] button to build a house inside the property card modal
       */
      findModalUpgradeButton() {
        const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="property-modal"]');
        if (!modal) return null;
        const btns = modal.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          const btn = btns[i];
          if (!isVisibleAndEnabled(btn)) continue;
          const inner = btn.innerHTML || "";
          const text = normalizeText(btn);
          if (inner.includes("\u2191") || inner.includes("arrow-up") || inner.includes("M5 10l7-7m0 0l7 7m-7-7v18") || text.includes("upgrade") || text.includes("build")) {
            return btn;
          }
        }
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
        const btns = modal.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          const btn = btns[i];
          if (!isVisibleAndEnabled(btn)) continue;
          const inner = btn.innerHTML || "";
          const text = normalizeText(btn);
          if (inner.includes("\u2193") || inner.includes("arrow-down") || inner.includes("M19 14l-7 7m0 0l-7-7m7 7V3") || text.includes("sell") || text.includes("downgrade")) {
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
        const btns = modal.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          const btn = btns[i];
          if (!isVisibleAndEnabled(btn)) continue;
          const inner = btn.innerHTML || "";
          const text = normalizeText(btn);
          if (inner.includes("\u{1F5D1}") || inner.includes("trash") || inner.includes("mortgage") || text.includes("mortgage")) {
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
        const allItems = document.querySelectorAll('div, li, button, [class*="property"]');
        for (let i = 0; i < allItems.length; i++) {
          const el = allItems[i];
          if (!isVisibleAndEnabled(el)) continue;
          const text = normalizeText(el);
          if (text === lowerTarget || text.includes(lowerTarget) && text.length < lowerTarget.length + 15) {
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
        const candidates = searchRoot.querySelectorAll("button, div, span, p");
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (!isVisibleAndEnabled(el)) continue;
          const text = normalizeText(el);
          if (text === lowerName || text.startsWith(lowerName) || text.endsWith(lowerName)) {
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

  // src/dom/boardScanner.js
  function syncBoardStateFromDOM() {
    if (!document.body) return;
    detectLobbySettingsAndIdentity();
    detectLocalPlayerFromPlayerList();
    syncBoardTilePricesFromDOM();
    syncMyPropertiesFromSidebar();
    scanTextNodesAndActivityLogs();
  }
  function detectLobbySettingsAndIdentity() {
    const hud = document.getElementById("rubot-hud-panel");
    const pageText = document.body.innerText || "";
    const isInGame = Boolean(
      pageText.includes("is playing") || pageText.includes("Roll the dice") || pageText.includes("End turn") || pageText.includes("Game started") || document.querySelector('[class*="bankrupt" i]')
    );
    if (isInGame) return;
    const cashMatch = /Starting cash[\s\S]*?\$(\d{2,5})/i.exec(pageText);
    if (cashMatch) {
      const startCash = parseInt(cashMatch[1], 10);
      if (!isNaN(startCash) && startCash >= 100 && startCash <= 1e4) {
        GameMemory.roomSettings.startingCash = startCash;
        if (!GameMemory.cashVerified) {
          GameMemory.myCash = startCash;
        }
      }
    }
    const allButtons = Array.from(document.querySelectorAll("button, a, div"));
    const changeApp = allButtons.find((b) => {
      if (hud && hud.contains(b)) return false;
      return (b.innerText || "").toLowerCase().includes("change appearance");
    });
    if (changeApp) {
      const row = changeApp.closest('div, li, [class*="player"], [class*="user"], [class*="item"]') || changeApp.parentElement;
      if (row) {
        const raw = (row.innerText || "").replace(/change appearance/gi, "").replace(/host/gi, "").trim();
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        const candidate = lines.find(
          (l) => l.length >= 2 && l.length <= 20 && !BOARD_LABELS_BLACKLIST.has(l.toLowerCase()) && !l.toLowerCase().includes("share") && !l.includes("$")
        );
        if (candidate && (!GameMemory.myName || GameMemory.myName.toLowerCase() !== candidate.toLowerCase())) {
          GameMemory.setMyName(candidate);
        }
      }
    }
  }
  function detectLocalPlayerFromPlayerList() {
    const hud = document.getElementById("rubot-hud-panel");
    if (GameMemory.myName && (GameMemory.myName.toLowerCase().includes("share") || BOARD_LABELS_BLACKLIST.has(GameMemory.myName.toLowerCase()))) {
      GameMemory.myName = null;
      try {
        localStorage.removeItem("richup_bot_my_name");
      } catch (_) {
      }
    }
    const currentName = GameMemory.myName;
    const candidates = document.querySelectorAll('[class*="player"], [class*="user"], [class*="item"], [class*="row"]');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (hud && hud.contains(el)) continue;
      const text = el.innerText || "";
      if (!text.includes("$") || text.length > 100) continue;
      const cashMatch = /(-?\$?\d{1,5}|\$-?\d{1,5})/.exec(text);
      if (!cashMatch) continue;
      const rawCash = cashMatch[1].replace(/\$/g, "");
      const parsedCash = parseInt(rawCash, 10);
      if (isNaN(parsedCash)) continue;
      const beforeDollar = text.split("$")[0].trim();
      const candidateLines = beforeDollar.split("\n").map((l) => l.trim()).filter(Boolean);
      let candidateName = null;
      for (const line of candidateLines) {
        const clean = line.replace(/[->\]]+/g, "").trim();
        if (clean.length >= 2 && clean.length <= 24 && !BOARD_LABELS_BLACKLIST.has(clean.toLowerCase()) && !clean.toLowerCase().includes("share") && !/^\d+$/.test(clean)) {
          candidateName = clean;
          break;
        }
      }
      if (!candidateName) continue;
      const hasLeaveIcon = Boolean(
        el.querySelector('[class*="leave" i], [class*="exit" i], [title*="leave" i], [aria-label*="leave" i]') || el.innerHTML.includes("->") || el.innerHTML.includes("M17 16l4") || el.innerHTML.includes("M11 16l-4-4") || el.innerHTML.includes("M15 3h4a2")
      );
      const isKnownMe = currentName && candidateName.toLowerCase() === currentName.toLowerCase();
      GameMemory.players[candidateName] = GameMemory.players[candidateName] || { cash: parsedCash, pos: 0, isMe: false };
      GameMemory.players[candidateName].cash = parsedCash;
      if (hasLeaveIcon || isKnownMe) {
        GameMemory.players[candidateName].isMe = true;
        GameMemory.setMyName(candidateName);
        GameMemory.myCash = parsedCash;
        GameMemory.cashVerified = true;
        return;
      }
    }
    if (GameMemory.myName && GameMemory.players[GameMemory.myName]) {
      GameMemory.myCash = GameMemory.players[GameMemory.myName].cash;
      GameMemory.cashVerified = true;
    }
  }
  function syncBoardTilePricesFromDOM() {
    const hud = document.getElementById("rubot-hud-panel");
    const allEls = document.querySelectorAll('div, [class*="tile"], [class*="cell"]');
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      if (hud && hud.contains(el)) continue;
      const text = el.innerText || "";
      if (!text.includes("$") || text.length > 80) continue;
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        if (new RegExp(`\\b${tile.name}\\b`, "i").test(text)) {
          const m = /(\d{2,4})\s*\$|\$\s*(\d{2,4})/.exec(text);
          if (m) {
            const price = parseInt(m[1] || m[2], 10);
            if (!isNaN(price) && price >= 50 && price <= 500) {
              tile.price = price;
            }
          }
        }
      }
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
        if (tile.group && lower === tile.name.toLowerCase()) {
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
    for (const tileId of Object.keys(GameMemory.ownership)) {
      if (GameMemory.isMe(GameMemory.ownership[tileId]?.owner) && !foundTileIds.has(Number(tileId))) {
        GameMemory.ownership[tileId].owner = null;
        GameMemory.ownership[tileId].houses = 0;
      }
    }
  }
  function scanTextNodesAndActivityLogs() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    const hud = document.getElementById("rubot-hud-panel");
    let node = walker.nextNode();
    while (node) {
      if (!hud || !hud.contains(node.parentElement)) {
        const val = node.nodeValue ? node.nodeValue.trim() : "";
        if (val) textNodes.push({ text: val, el: node.parentElement });
      }
      node = walker.nextNode();
    }
    const cashCandidates = [];
    for (let i = 0; i < textNodes.length; i++) {
      const item = textNodes[i];
      const m = /^(-?\$?\d{1,5}|\$-?\d{1,5})$/.exec(item.text);
      if (m && item.text.includes("$")) {
        const numeric = parseInt(item.text.replace(/\$/g, ""), 10);
        const prevText = i > 0 ? textNodes[i - 1].text.trim() : "";
        const prevLower = prevText.toLowerCase();
        if (!isNaN(numeric) && prevText.length >= 2 && prevText.length <= 24 && !/^\$|%|\d|^x\s*\$/i.test(prevText) && !BOARD_LABELS_BLACKLIST.has(prevLower)) {
          GameMemory.players[prevText] = GameMemory.players[prevText] || { cash: numeric, pos: 0, isMe: false };
          GameMemory.players[prevText].cash = numeric;
          cashCandidates.push({ name: prevText, cash: numeric });
        }
      }
      const line = item.text;
      if (line.length > 8 && line.length < 120 && !GameMemory.processedLogs.has(line)) {
        parseActivityLogLine(line);
      }
    }
    if (!GameMemory.cashVerified && cashCandidates.length > 0) {
      if (GameMemory.myName) {
        const myEntry = cashCandidates.find((c) => c.name.toLowerCase() === GameMemory.myName.toLowerCase());
        if (myEntry) {
          GameMemory.myCash = myEntry.cash;
          GameMemory.cashVerified = true;
        }
      }
    }
  }
  function parseActivityLogLine(line) {
    let m = /^(.+?)\s+bought a house in\s+(.+?)\.?$/i.exec(line);
    if (m) {
      const tile = TILE_BY_NAME[m[2].trim().toLowerCase()];
      if (tile && GameMemory.ownership[tile.id]) {
        GameMemory.ownership[tile.id].owner = m[1].trim();
        GameMemory.ownership[tile.id].houses = Math.min(5, (GameMemory.ownership[tile.id].houses || 0) + 1);
        GameMemory.processedLogs.add(line);
      }
      return;
    }
    m = /^(.+?)\s+bought a hotel in\s+(.+?)\.?$/i.exec(line);
    if (m) {
      const tile = TILE_BY_NAME[m[2].trim().toLowerCase()];
      if (tile && GameMemory.ownership[tile.id]) {
        GameMemory.ownership[tile.id].owner = m[1].trim();
        GameMemory.ownership[tile.id].houses = 5;
        GameMemory.processedLogs.add(line);
      }
      return;
    }
    m = /^(.+?)\s+bought\s+([A-Za-z\s]+?)(?:\s+by auction.*|\.?)$/i.exec(line);
    if (m) {
      const rawTile = m[2].trim().toLowerCase();
      const tile = TILE_BY_NAME[rawTile];
      if (tile && GameMemory.ownership[tile.id]) {
        GameMemory.ownership[tile.id].owner = m[1].trim();
        GameMemory.processedLogs.add(line);
      }
      return;
    }
    m = /^(.+?)\s+bankrupted/i.exec(line);
    if (m) {
      const bankruptPlayer = m[1].trim();
      for (const id of Object.keys(GameMemory.ownership)) {
        if (GameMemory.ownership[id].owner === bankruptPlayer) {
          GameMemory.ownership[id].owner = null;
          GameMemory.ownership[id].houses = 0;
          GameMemory.ownership[id].mortgaged = false;
        }
      }
      GameMemory.processedLogs.add(line);
    }
  }
  function scrapeTradeModalDOM() {
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="trade-modal"]');
    const modalText = modal ? modal.innerText : "";
    const mentionedTiles = BOARD_TILES.filter((t) => t.group && new RegExp(`\\b${t.name}\\b`, "i").test(modalText));
    const givenTiles = [];
    const receivedTiles = [];
    for (const t of mentionedTiles) {
      const owner = GameMemory.ownership[t.id]?.owner;
      if (GameMemory.isMe(owner)) givenTiles.push(t);
      else receivedTiles.push(t);
    }
    let partnerName = "Opponent";
    for (const t of receivedTiles) {
      const owner = GameMemory.ownership[t.id]?.owner;
      if (owner && !GameMemory.isMe(owner)) {
        partnerName = owner;
        break;
      }
    }
    if (partnerName === "Opponent") {
      for (const pName of Object.keys(GameMemory.players)) {
        if (!GameMemory.isMe(pName) && new RegExp(`\\b${pName}\\b`, "i").test(modalText)) {
          partnerName = pName;
          break;
        }
      }
    }
    if (partnerName === "Opponent") {
      const allTradeRows = Array.from(document.querySelectorAll("*")).map((e) => e.innerText || "").filter((t) => (t.includes("\u2194") || t.includes("<->")) && t.length < 60);
      for (const rowText of allTradeRows) {
        for (const pName of Object.keys(GameMemory.players)) {
          if (!GameMemory.isMe(pName) && rowText.toLowerCase().includes(pName.toLowerCase())) {
            partnerName = pName;
            break;
          }
        }
      }
    }
    let givenCash = 0;
    let receivedCash = 0;
    const cashMatches = modalText.match(/\$\s*(\d{1,4})/g);
    if (cashMatches && cashMatches.length >= 1) {
      receivedCash = parseInt(cashMatches[0].replace(/\D/g, ""), 10) || 0;
    }
    return {
      partnerName,
      givenTiles,
      receivedTiles,
      givenCash,
      receivedCash
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
     * Enforces strict survival reserve when facing deadly enemy hotels ahead!
     */
    shouldBuyProperty(tile, price, myCash) {
      const reserve = this.computeDynamicReserve(GameMemory.myPos);
      const danger = this.analyzeDangerAhead(GameMemory.myPos);
      if (danger.maxDangerWindowLoss >= 300 || danger.expectedLoss1Turn >= 120) {
        const postCash = myCash - price;
        if (postCash < reserve * 0.75) {
          return {
            buy: false,
            reason: `Hotel Danger Veto: Enemy hotels ($${danger.maxDangerWindowLoss} rent) ahead! Preserving $${myCash} cash to survive.`
          };
        }
      }
      if (CONFIG.ALWAYS_BUY_AFFORDABLE) {
        return {
          buy: true,
          reason: `Acquiring ${tile ? tile.name : "property"} ($${price})`
        };
      }
      if (!tile || !tile.group) {
        return { buy: true, reason: `Acquiring standard property ($${price})` };
      }
      const mySet = GameMemory.getGroupCount(tile.group, "__ME__");
      if (mySet.owned === mySet.total - 1 || tile.group === "USA" || tile.group === "Brazil") {
        return { buy: true, reason: `CRITICAL: Completes ${tile.group} Monopoly!` };
      }
      if (HIGH_TRAFFIC_GROUPS.has(tile.group)) {
        return { buy: true, reason: `High-Traffic Strategic Asset: ${tile.name} (${tile.group})` };
      }
      const effectiveCash = Math.max(myCash, price);
      if (effectiveCash - price >= reserve * 0.6) {
        return {
          buy: true,
          reason: `EV+ Buy: ${tile.name} ($${price}) | Safe Cash Reserve $${Math.round(reserve)}`
        };
      }
      return {
        buy: false,
        reason: `Preserving survival reserve ($${reserve}) for danger ahead`
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

  // src/memory/opponentTracker.js
  var OpponentTracker = {
    /**
     * Comprehensive scan of all opponents
     */
    analyzeOpponents() {
      const myName = GameMemory.myName || "__ME__";
      const analysis = {};
      for (const [pName, pData] of Object.entries(GameMemory.players)) {
        if (GameMemory.isMe(pName) || pData.bankrupt) continue;
        const ownedTiles = [];
        const hungrySets = [];
        let totalPropertyNetWorth = 0;
        for (const tile of BOARD_TILES) {
          if (!tile.group) continue;
          const info = GameMemory.ownership[tile.id];
          if (info && info.owner === pName) {
            ownedTiles.push(tile);
            totalPropertyNetWorth += tile.price;
          }
        }
        for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
          if (tiles[0].type !== "property") continue;
          const ownedCount = tiles.filter((t) => GameMemory.ownership[t.id]?.owner === pName).length;
          if (ownedCount === tiles.length - 1) {
            const missingTile = tiles.find((t) => GameMemory.ownership[t.id]?.owner !== pName);
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
        if (tiles[0].type !== "property") continue;
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
     * Assets we own that are SAFE to trade away as sweeteners.
     * Singletons that do NOT complete any opponent's monopoly.
     */
    getSafeTradeSacrifices() {
      const blockers = new Set(this.getCriticalBlockers().map((b) => b.tile.id));
      const sacrifices = [];
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (info && GameMemory.isMe(info.owner) && info.houses === 0 && !blockers.has(tile.id)) {
          const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
          if (owned < total - 1) {
            sacrifices.push(tile);
          }
        }
      }
      return sacrifices;
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
     * Rule: We almost ALWAYS buy directly! Auctioning is only for when we are broke,
     * or when ALL opponents are so broke that we can steal the property for $20.
     */
    shouldSendToAuctionInsteadOfBuy(tile, price, myCash) {
      if (!tile) return { auction: false, reason: "Direct Buy" };
      if (myCash < price) {
        return {
          auction: true,
          reason: `Cannot afford direct buy ($${myCash} < $${price}). Sending to auction.`
        };
      }
      let maxOppCash = 0;
      for (const [pName, pData] of Object.entries(GameMemory.players)) {
        if (!GameMemory.isMe(pName) && !pData.bankrupt) {
          if ((pData.cash || 0) > maxOppCash) maxOppCash = pData.cash;
        }
      }
      const mySet = GameMemory.getGroupCount(tile.group, "__ME__");
      const completesMyMonopoly = tile.group && mySet.owned === mySet.total - 1;
      const blocksOpponent = OpponentTracker.isBlockerAgainstAnyOpponent(tile);
      if (completesMyMonopoly || blocksOpponent) {
        return {
          auction: false,
          reason: `Direct Buy: Crucial asset (${completesMyMonopoly ? "Monopoly" : "Blocker"}). Never risk auctioning!`
        };
      }
      if (maxOppCash < 60 && price >= 200) {
        return {
          auction: true,
          reason: `Auction Steal: Opponents are broke (Max Opp Cash $${maxOppCash}). Auctioning to buy for cheap!`
        };
      }
      return {
        auction: false,
        reason: `Direct Buy: Securing ${tile.name} without auction risk.`
      };
    },
    /**
     * Decides whether to bid +$10, +$50, or Pass in an ongoing auction
     */
    evaluateAuctionStep(tile, currentBid, myCash) {
      const { maxBid, reason } = this.calculateCeilingBid(tile, myCash);
      if (currentBid + 10 <= maxBid && currentBid + 10 <= myCash - 30) {
        return {
          shouldBid: true,
          increment: 10,
          maxBid,
          reason: `Bidding $${currentBid + 10} <= Max $${maxBid} (${reason})`
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
      const baseEV = tile.price * (1 + tile.markov * 18);
      if (!tile.group) return baseEV;
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
    evaluateIncomingTrade(tradeData) {
      const {
        partnerName = "__OPP__",
        givenTiles = [],
        receivedTiles = [],
        givenCash = 0,
        receivedCash = 0
      } = tradeData;
      let givesOppMonopoly = false;
      for (const tile of givenTiles) {
        if (tile.group && tile.type === "property") {
          const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
          if (oppSet.owned === oppSet.total - 1) {
            givesOppMonopoly = true;
            break;
          }
        }
      }
      let completesMyMonopoly = false;
      for (const tile of receivedTiles) {
        if (tile.group && tile.type === "property") {
          const mySet = GameMemory.getGroupCount(tile.group, "__ME__");
          if (mySet.owned === mySet.total - 1) {
            completesMyMonopoly = true;
            break;
          }
        }
      }
      if (givesOppMonopoly && !completesMyMonopoly) {
        return {
          accept: false,
          reason: `MONOPOLY VETO: Trade would grant ${partnerName} a monopoly without giving us one!`,
          chatReply: "Can't give you a monopoly for that offer, that's game over for me."
        };
      }
      let myGain = receivedCash - givenCash;
      let oppGain = givenCash - receivedCash;
      for (const tile of receivedTiles) {
        myGain += this.scoreTileForPlayer(tile, "__ME__");
      }
      for (const tile of givenTiles) {
        myGain -= this.scoreTileForPlayer(tile, "__ME__");
        oppGain += this.scoreTileForPlayer(tile, partnerName);
      }
      const acceptable = myGain > 0 && (myGain >= oppGain * CONFIG.TRADE_MIN_ADVANTAGE_RATIO || completesMyMonopoly);
      GameMemory.lastTradeVerdict = acceptable ? "ACCEPTABLE" : "UNFAVORABLE";
      return {
        accept: acceptable,
        myGain: Math.round(myGain),
        oppGain: Math.round(oppGain),
        reason: acceptable ? `EV+ Trade: Net gain +$${Math.round(myGain)} vs Opp +$${Math.round(oppGain)}` : `Unfavorable utility: Net gain $${Math.round(myGain)} < requirement`,
        chatReply: acceptable ? "Pleasure doing business with you!" : "Numbers don't work out for me. Sweeten the cash offer and I'll consider it."
      };
    },
    /**
     * Scans for Mutual Monopoly Swaps:
     * We have 2/3 of Group A, Opponent has 1/3 of Group A.
     * Opponent has 2/3 of Group B, We have 1/3 of Group B.
     */
    scanMutualMonopolySwaps() {
      const opportunities = [];
      const myMissing = OpponentTracker.getMyMissingCards();
      const opponents = OpponentTracker.analyzeOpponents();
      for (const myNeed of myMissing) {
        if (!myNeed.heldBy || myNeed.isUnowned) continue;
        const targetOppName = myNeed.heldBy;
        const targetOpp = opponents[targetOppName];
        if (!targetOpp) continue;
        for (const oppNeed of targetOpp.hungrySets) {
          if (oppNeed.weHoldIt && oppNeed.missingTile) {
            const myCardValue = this.scoreTileForPlayer(oppNeed.missingTile, targetOppName);
            const theirCardValue = this.scoreTileForPlayer(myNeed.missingTile, "__ME__");
            const cashDiff = myCardValue - theirCardValue;
            let cashOffer = 0;
            let cashDemand = 0;
            if (cashDiff > 0) {
              cashDemand = Math.min(targetOpp.cash, Math.round(cashDiff * 0.4));
            } else if (cashDiff < 0) {
              cashOffer = Math.min(GameMemory.myCash - 100, Math.round(Math.abs(cashDiff) * 0.4));
            }
            opportunities.push({
              targetOwner: targetOppName,
              myGivenTile: oppNeed.missingTile,
              myReceivedTile: myNeed.missingTile,
              cashOffer: Math.max(0, cashOffer),
              cashDemand: Math.max(0, cashDemand),
              summary: `SWAP: Give ${oppNeed.missingTile.name} -> Get ${myNeed.missingTile.name}`,
              pitch: `@${targetOppName} Let's swap ${oppNeed.missingTile.name} for ${myNeed.missingTile.name}. Both of us get a set to fight the lobby!`
            });
          }
        }
      }
      return opportunities;
    }
  };

  // src/ui/chatEngine.js
  var ChatEngine = {
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
      ],
      tradeNegotiate: [
        "Close, but let's counter-offer. Sweeten the deal?",
        "I'm interested, but let's adjust terms to make it fair.",
        "Counter-proposal sent, check if this works."
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
          }, 80);
        } catch (err) {
          logToBot(`Chat error: ${err}`);
        }
      }, 300);
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
    executeProposal(swap, onComplete) {
      if (this.isExecuting) return;
      this.isExecuting = true;
      logToBot(`[TRADE CREATOR] Starting automated proposal for ${swap.targetOwner}...`);
      const snapshot = createDOMSnapshot();
      const createBtn = snapshot.findCreateTradeButton();
      if (!createBtn) {
        logToBot("[TRADE CREATOR] Could not find [+ Create] trade button.");
        this.isExecuting = false;
        if (onComplete) onComplete(false);
        return;
      }
      delayClick(createBtn, "Opening Create Trade dialog");
      setTimeout(() => {
        const snap2 = createDOMSnapshot();
        const playerBtn = snap2.findPlayerSelectButton(swap.targetOwner);
        if (!playerBtn) {
          logToBot(`[TRADE CREATOR] Could not find player button for "${swap.targetOwner}".`);
          this.closeTradeModal();
          this.isExecuting = false;
          if (onComplete) onComplete(false);
          return;
        }
        delayClick(playerBtn, `Selecting trade partner: ${swap.targetOwner}`);
        setTimeout(() => {
          const snap3 = createDOMSnapshot();
          const myPropCard = snap3.findTradePropertyCard(swap.myGivenTile.name);
          if (myPropCard) {
            delayClick(myPropCard, `Selecting offer property: ${swap.myGivenTile.name}`);
          } else {
            logToBot(`[TRADE CREATOR] Could not find offer property: ${swap.myGivenTile.name}`);
          }
          setTimeout(() => {
            const snap4 = createDOMSnapshot();
            const theirPropCard = snap4.findTradePropertyCard(swap.myReceivedTile.name);
            if (theirPropCard) {
              delayClick(theirPropCard, `Selecting request property: ${swap.myReceivedTile.name}`);
            } else {
              logToBot(`[TRADE CREATOR] Could not find request property: ${swap.myReceivedTile.name}`);
            }
            this.adjustCashInTradeModal(swap);
            setTimeout(() => {
              const snap5 = createDOMSnapshot();
              const sendBtn = snap5.findSendTradeButton();
              if (sendBtn) {
                delayClick(sendBtn, `Submitting trade proposal to ${swap.targetOwner}`);
                this.lastProposedTimes.set(swap.targetOwner, Date.now());
                setTimeout(() => {
                  ChatEngine.sendChatMessage("tradeOffer", swap.pitch);
                }, 500);
                this.isExecuting = false;
                if (onComplete) onComplete(true);
              } else {
                logToBot("[TRADE CREATOR] Could not find [Send trade] button.");
                this.closeTradeModal();
                this.isExecuting = false;
                if (onComplete) onComplete(false);
              }
            }, 400);
          }, 350);
        }, 450);
      }, 380);
    },
    adjustCashInTradeModal(swap) {
      try {
        const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="trade"]');
        if (!modal) return;
        const inputs = modal.querySelectorAll('input[type="number"], input[type="range"], input[type="text"]');
        if (inputs.length >= 2) {
          if (swap.cashOffer > 0 && inputs[0]) {
            this.setNativeInputValue(inputs[0], swap.cashOffer);
          } else if (swap.cashDemand > 0 && inputs[1]) {
            this.setNativeInputValue(inputs[1], swap.cashDemand);
          }
        }
      } catch (err) {
        logToBot(`Cash adjust note: ${err}`);
      }
    },
    setNativeInputValue(input, val) {
      try {
        input.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeSetter) nativeSetter.call(input, String(val));
        else input.value = String(val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {
      }
    },
    closeTradeModal() {
      const closeBtn = document.querySelector('[class*="close" i], button[aria-label*="close" i], button:has(svg)');
      if (closeBtn) {
        closeBtn.click();
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
      for (const tile of BOARD_TILES) {
        if (!tile.group) continue;
        const info = GameMemory.ownership[tile.id];
        if (!info || !GameMemory.isMe(info.owner) || info.mortgaged) continue;
        const { owned, total } = GameMemory.getGroupCount(tile.group, "__ME__");
        let sacrificeScore = tile.price * (1 + tile.markov * 10);
        if (owned === total) {
          sacrificeScore *= 10;
        } else if (owned === total - 1) {
          sacrificeScore *= 4;
        }
        if (blockers.has(tile.id)) {
          sacrificeScore *= 5;
        }
        const mortgageValue = Math.round(tile.price / 2);
        const houseSellValue = Math.round(tile.houseCost / 2);
        targets.push({
          tile,
          houses: info.houses,
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
    }
  };

  // src/engine/ollamaClient.js
  var OllamaClient = {
    status: "unchecked",
    // 'connected' | 'offline' | 'error'
    /**
     * Universal HTTP helper using GM_xmlhttpRequest if present, else fetch
     */
    httpRequest({ method = "POST", url, data = null, timeout = 2800 }) {
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
            ontimeout: () => reject(new Error("Ollama request timed out (>2.8s)")),
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
              role: "system",
              content: 'You are a Grandmaster Monopoly / RichUp AI player. Evaluate trade offers with sharp strategic vision. Output ONLY valid JSON in format: {"decision": "CONFIRM" | "DECLINE" | "NEGOTIATE", "reason": "concise rationale under 15 words", "chatReply": "short casual in-game message under 15 words"}'
            },
            {
              role: "user",
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
          method: "POST",
          url: `${CONFIG.OLLAMA_HOST}/api/chat`,
          data: payload,
          timeout: CONFIG.OLLAMA_TIMEOUT_MS || 2800
        });
        const rawContent = data?.message?.content || "";
        const parsed = this.parseJsonSafely(rawContent);
        if (parsed && (parsed.decision === "CONFIRM" || parsed.decision === "DECLINE" || parsed.decision === "NEGOTIATE")) {
          return {
            accept: parsed.decision === "CONFIRM",
            negotiate: parsed.decision === "NEGOTIATE",
            reason: `[Ollama ${CONFIG.OLLAMA_MODEL}] ${parsed.reason}`,
            chatReply: parsed.chatReply || ""
          };
        }
        return TradeEngine.evaluateIncomingTrade(tradeData);
      } catch (_) {
        return TradeEngine.evaluateIncomingTrade(tradeData);
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
      return `=== RICHUP FULL GAME-STATE BRIEFING ===
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

=== GRANDMASTER DIRECTIVE ===
You are an elite Grandmaster Monopoly AI. Using the full context of everyone's money, existing houses, and post-trade building power:
1. Decision: CONFIRM (if highly advantageous or safe win-win), DECLINE (if kingmaking opponent or danger too high), or NEGOTIATE (if close but needs more cash or counter-property).
2. Reason: Under 15 words explaining the strategic reasoning based on opponent money, houses, or monopolies.
3. Chat Reply: Under 15 words, a psychological, clever in-game chat message directed at ${partner}.

Respond ONLY with valid JSON:
{
  "decision": "CONFIRM" | "DECLINE" | "NEGOTIATE",
  "reason": "concise rationale under 15 words",
  "chatReply": "short casual in-game message under 15 words"
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
    }
  };

  // src/ui/hudPanel.js
  var HUDPanel = {
    elements: {},
    maxLogs: 60,
    pendingAdvisorAction: null,
    drag: {
      active: false,
      startX: 0,
      startY: 0,
      initialLeft: 20,
      initialTop: 20
    },
    inject(onToggleMaster, onExecuteAdvisor, onSkipAdvisor) {
      if (document.getElementById("rubot-hud-panel")) return;
      let savedGeom = { left: 20, top: 20, width: 330, height: 460 };
      try {
        const raw = localStorage.getItem("richup_hud_geometry");
        if (raw) savedGeom = Object.assign(savedGeom, JSON.parse(raw));
      } catch (_) {
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
                min-width: 290px;
                min-height: 380px;
                max-width: 550px;
                max-height: 800px;
                resize: both;
                overflow: hidden;
                background: rgba(16, 11, 28, 0.96);
                backdrop-filter: blur(12px);
                border: 1px solid #7c3aed;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 15px rgba(124, 58, 237, 0.25);
                color: #f3e8ff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                font-size: 11.5px;
                z-index: 9999999;
                display: flex;
                flex-direction: column;
                user-select: none;
            }
            .rubot-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 9px 14px;
                background: linear-gradient(90deg, #6d28d9, #4c1d95);
                cursor: grab;
                font-weight: 700;
                letter-spacing: 0.5px;
            }
            .rubot-title {
                display: flex;
                align-items: center;
                gap: 6px;
                color: #fff;
            }
            .rubot-badge {
                font-size: 9.5px;
                font-weight: 700;
                padding: 2px 7px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.15);
                color: #e9d5ff;
            }
            .rubot-badge.active {
                background: #10b981;
                color: #fff;
            }
            .rubot-body {
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 9px;
                flex: 1;
                overflow-y: auto;
            }
            .rubot-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .rubot-stat-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
                background: rgba(255, 255, 255, 0.04);
                padding: 8px;
                border-radius: 6px;
                border: 1px solid rgba(139, 92, 246, 0.2);
            }
            .rubot-stat-label {
                font-size: 9px;
                font-weight: 600;
                color: #a78bfa;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .rubot-stat-val {
                font-size: 13px;
                font-weight: 700;
                color: #fff;
            }
            .rubot-stat-val.violet { color: #c084fc; }
            .rubot-stat-val.green { color: #34d399; }
            .rubot-stat-val.amber { color: #fbbf24; }
            .rubot-name-input {
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid #7c3aed;
                color: #fff;
                font-family: inherit;
                font-size: 11px;
                padding: 4px 8px;
                border-radius: 5px;
                width: 120px;
                outline: none;
            }
            .rubot-name-input:focus {
                border-color: #a78bfa;
                box-shadow: 0 0 8px rgba(167, 139, 250, 0.5);
            }
            .rubot-mode-selector {
                display: flex;
                background: rgba(0, 0, 0, 0.4);
                border-radius: 6px;
                padding: 3px;
                border: 1px solid rgba(139, 92, 246, 0.3);
            }
            .rubot-mode-btn {
                flex: 1;
                background: transparent;
                border: none;
                color: #c4b5fd;
                font-weight: 600;
                font-size: 10.5px;
                padding: 5px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .rubot-mode-btn.active {
                background: #7c3aed;
                color: #fff;
                box-shadow: 0 2px 6px rgba(124, 58, 237, 0.4);
            }
            .rubot-advisor-box {
                background: linear-gradient(135deg, rgba(124, 58, 237, 0.25), rgba(76, 29, 149, 0.35));
                border: 1px solid #a78bfa;
                border-radius: 6px;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                animation: rubot-pulse 2s infinite ease-in-out;
            }
            @keyframes rubot-pulse {
                0%, 100% { border-color: #a78bfa; }
                50% { border-color: #c084fc; box-shadow: 0 0 10px rgba(192, 132, 252, 0.3); }
            }
            .rubot-advisor-title {
                font-weight: 700;
                font-size: 11.5px;
                color: #e9d5ff;
            }
            .rubot-advisor-desc {
                font-size: 10.5px;
                color: #ddd6fe;
                line-height: 1.3;
            }
            .rubot-advisor-btns {
                display: flex;
                gap: 6px;
            }
            .rubot-adv-btn {
                flex: 1;
                padding: 6px;
                border: none;
                border-radius: 5px;
                font-weight: 700;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .rubot-adv-btn.exec {
                background: #10b981;
                color: #fff;
            }
            .rubot-adv-btn.exec:hover {
                background: #059669;
            }
            .rubot-adv-btn.skip {
                background: rgba(255, 255, 255, 0.15);
                color: #f3e8ff;
            }
            .rubot-adv-btn.skip:hover {
                background: rgba(255, 255, 255, 0.25);
            }
            .rubot-master-btn {
                background: linear-gradient(135deg, #7c3aed, #6d28d9);
                border: none;
                color: #fff;
                padding: 8px 12px;
                font-weight: 700;
                font-size: 12px;
                border-radius: 6px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
                transition: all 0.2s;
            }
            .rubot-master-btn:hover {
                background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                box-shadow: 0 4px 16px rgba(139, 92, 246, 0.5);
            }
            .rubot-master-btn.active {
                background: linear-gradient(135deg, #10b981, #059669);
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
            }
            .rubot-toggles {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 5px;
                font-size: 10px;
                color: #c4b5fd;
            }
            .rubot-toggles label {
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
            }
            .rubot-ollama-section {
                background: rgba(124, 58, 237, 0.08);
                border: 1px solid rgba(139, 92, 246, 0.25);
                border-radius: 6px;
                padding: 6px 8px;
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .rubot-btn-ping {
                background: rgba(139, 92, 246, 0.2);
                border: 1px solid rgba(139, 92, 246, 0.4);
                color: #e9d5ff;
                padding: 2px 7px;
                border-radius: 4px;
                font-size: 9.5px;
                font-weight: 600;
                cursor: pointer;
            }
            .rubot-btn-ping:hover {
                background: rgba(139, 92, 246, 0.4);
            }
            .rubot-ollama-fields {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin-top: 3px;
            }
            .rubot-field-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .rubot-field-label {
                font-size: 9.5px;
                color: #a78bfa;
                min-width: 36px;
            }
            .rubot-mini-input {
                flex: 1;
                background: rgba(0, 0, 0, 0.35);
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 4px;
                color: #fff;
                padding: 2px 6px;
                font-size: 10px;
                font-family: inherit;
            }
            .rubot-mini-input:focus {
                outline: none;
                border-color: #8b5cf6;
            }
            .rubot-ollama-status {
                font-size: 9px;
                color: #a78bfa;
                font-style: italic;
            }
            .rubot-terminal {
                flex: 1;
                min-height: 80px;
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid rgba(139, 92, 246, 0.2);
                border-radius: 6px;
                padding: 7px;
                overflow-y: auto;
                font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 9.5px;
                color: #c4b5fd;
                display: flex;
                flex-direction: column-reverse;
            }
            .rubot-terminal .log-line {
                margin-bottom: 2px;
                word-break: break-all;
            }
            .rubot-terminal .log-line.green { color: #34d399; }
            .rubot-terminal .log-line.violet { color: #c084fc; }
            .rubot-terminal .log-line.amber { color: #fbbf24; }
        `;
      document.head.appendChild(style);
      const panel = document.createElement("div");
      panel.id = "rubot-hud-panel";
      panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <span class="rubot-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    RICHUP BOT
                </span>
                <span class="rubot-badge" id="rubot-phase-badge">STANDBY</span>
            </div>
            <div class="rubot-body">
                <div class="rubot-row">
                    <span style="font-weight:600; color:#c4b5fd;">MY NAME:</span>
                    <input type="text" id="rubot-input-myname" class="rubot-name-input" placeholder="Your username" value="${GameMemory.myName || ""}">
                </div>

                <div class="rubot-mode-selector">
                    <button class="rubot-mode-btn active" id="rubot-btn-mode-auto">AUTO-PILOT</button>
                    <button class="rubot-mode-btn" id="rubot-btn-mode-advisor">ADVISOR MODE</button>
                </div>

                <div class="rubot-stat-grid">
                    <div>
                        <div class="rubot-stat-label">CASH</div>
                        <div class="rubot-stat-val green" id="rubot-val-cash">$${GameMemory.myCash}</div>
                    </div>
                    <div>
                        <div class="rubot-stat-label">POSITION</div>
                        <div class="rubot-stat-val violet" id="rubot-val-pos">Tile #${GameMemory.myPos}</div>
                    </div>
                    <div>
                        <div class="rubot-stat-label">DANGER EV</div>
                        <div class="rubot-stat-val amber" id="rubot-val-ev">$0</div>
                    </div>
                    <div>
                        <div class="rubot-stat-label">SURVIVAL RESERVE</div>
                        <div class="rubot-stat-val violet" id="rubot-val-rsv">$${CONFIG.BASE_MIN_RESERVE}</div>
                    </div>
                </div>

                <!-- Advisor Decision Confirmation Box (Hidden until action proposed) -->
                <div id="rubot-advisor-box" class="rubot-advisor-box" style="display: none;">
                    <div class="rubot-advisor-title" id="rubot-adv-title">ADVISOR RECOMMENDATION</div>
                    <div class="rubot-advisor-desc" id="rubot-adv-desc">Waiting for next turn...</div>
                    <div class="rubot-advisor-btns">
                        <button class="rubot-adv-btn exec" id="rubot-adv-exec">\u2713 EXECUTE</button>
                        <button class="rubot-adv-btn skip" id="rubot-adv-skip">\u2715 SKIP</button>
                    </div>
                </div>

                <button class="rubot-master-btn" id="rubot-master-btn">START BOT [=]</button>

                <!-- Hybrid Ollama Brain Card -->
                <div class="rubot-ollama-section">
                    <div class="rubot-row">
                        <label style="font-weight:700; color:#c4b5fd; cursor:pointer;">
                            <input type="checkbox" id="rubot-chk-ollama" ${CONFIG.OLLAMA_ENABLED ? "checked" : ""}> Hybrid Ollama Brain
                        </label>
                        <button class="rubot-btn-ping" id="rubot-btn-ollama-ping">\u26A1 Test</button>
                    </div>
                    <div class="rubot-ollama-fields" id="rubot-ollama-fields" style="${CONFIG.OLLAMA_ENABLED ? "" : "display:none;"}">
                        <div class="rubot-field-row">
                            <span class="rubot-field-label">Host:</span>
                            <input type="text" id="rubot-input-ollama-host" class="rubot-mini-input" value="${CONFIG.OLLAMA_HOST}">
                        </div>
                        <div class="rubot-field-row">
                            <span class="rubot-field-label">Model:</span>
                            <input type="text" id="rubot-input-ollama-model" class="rubot-mini-input" value="${CONFIG.OLLAMA_MODEL}">
                        </div>
                        <div class="rubot-ollama-status" id="rubot-ollama-status">Status: Standby (Minimax Fallback)</div>
                    </div>
                </div>

                <div class="rubot-toggles">
                    <label><input type="checkbox" id="rubot-chk-alwaysbuy" checked> Buy Land</label>
                    <label><input type="checkbox" id="rubot-chk-ambush" checked> Hotel Ambush</label>
                    <label><input type="checkbox" id="rubot-chk-auction" checked> Auto-Auction</label>
                    <label><input type="checkbox" id="rubot-chk-trade" checked> Auto-Trade</label>
                    <label><input type="checkbox" id="rubot-chk-build" checked> Auto-Build</label>
                    <label><input type="checkbox" id="rubot-chk-reserve" checked> Smart Reserve</label>
                </div>

                <div class="rubot-terminal" id="rubot-terminal"></div>
            </div>
        `;
      document.body.appendChild(panel);
      this.elements.panel = panel;
      this.elements.masterBtn = document.getElementById("rubot-master-btn");
      this.elements.phaseBadge = document.getElementById("rubot-phase-badge");
      this.elements.valCash = document.getElementById("rubot-val-cash");
      this.elements.valPos = document.getElementById("rubot-val-pos");
      this.elements.valEV = document.getElementById("rubot-val-ev");
      this.elements.valRsv = document.getElementById("rubot-val-rsv");
      this.elements.terminal = document.getElementById("rubot-terminal");
      this.elements.nameInput = document.getElementById("rubot-input-myname");
      this.elements.advisorBox = document.getElementById("rubot-advisor-box");
      this.elements.advTitle = document.getElementById("rubot-adv-title");
      this.elements.advDesc = document.getElementById("rubot-adv-desc");
      this.elements.advExec = document.getElementById("rubot-adv-exec");
      this.elements.advSkip = document.getElementById("rubot-adv-skip");
      this.elements.btnModeAuto = document.getElementById("rubot-btn-mode-auto");
      this.elements.btnModeAdv = document.getElementById("rubot-btn-mode-advisor");
      this.elements.masterBtn.addEventListener("click", () => {
        if (onToggleMaster) onToggleMaster();
      });
      this.elements.btnModeAuto.addEventListener("click", () => {
        CONFIG.ADVISOR_MODE = false;
        this.elements.btnModeAuto.classList.add("active");
        this.elements.btnModeAdv.classList.remove("active");
        this.hideAdvisorBox();
        this.logTerminal("Switched to: AUTO-PILOT MODE");
      });
      this.elements.btnModeAdv.addEventListener("click", () => {
        CONFIG.ADVISOR_MODE = true;
        this.elements.btnModeAdv.classList.add("active");
        this.elements.btnModeAuto.classList.remove("active");
        this.logTerminal("Switched to: ADVISOR MODE (Asks you before acting!)");
      });
      this.elements.advExec.addEventListener("click", () => {
        if (onExecuteAdvisor) onExecuteAdvisor();
      });
      this.elements.advSkip.addEventListener("click", () => {
        if (onSkipAdvisor) onSkipAdvisor();
      });
      const handleNameUpdate = (val) => {
        if (!val) return;
        const trimmed = val.trim();
        if (BOARD_LABELS_BLACKLIST.has(trimmed.toLowerCase())) return;
        GameMemory.setMyName(trimmed);
        this.logTerminal(`Identity saved: "${GameMemory.myName}"`);
      };
      this.elements.nameInput.addEventListener("change", (e) => handleNameUpdate(e.target.value));
      this.elements.nameInput.addEventListener("input", (e) => handleNameUpdate(e.target.value));
      const chkOllama = document.getElementById("rubot-chk-ollama");
      const fieldsOllama = document.getElementById("rubot-ollama-fields");
      const inputHost = document.getElementById("rubot-input-ollama-host");
      const inputModel = document.getElementById("rubot-input-ollama-model");
      const statusOllama = document.getElementById("rubot-ollama-status");
      const btnPing = document.getElementById("rubot-btn-ollama-ping");
      chkOllama.addEventListener("change", (e) => {
        CONFIG.OLLAMA_ENABLED = e.target.checked;
        localStorage.setItem("richup_ollama_enabled", e.target.checked ? "true" : "false");
        fieldsOllama.style.display = e.target.checked ? "flex" : "none";
        this.logTerminal(`Hybrid Brain (Ollama) ${e.target.checked ? "ENABLED" : "DISABLED"}`);
      });
      inputHost.addEventListener("change", (e) => {
        CONFIG.OLLAMA_HOST = e.target.value.trim();
        localStorage.setItem("richup_ollama_host", CONFIG.OLLAMA_HOST);
        this.logTerminal(`Ollama host set to: ${CONFIG.OLLAMA_HOST}`);
      });
      inputModel.addEventListener("change", (e) => {
        CONFIG.OLLAMA_MODEL = e.target.value.trim();
        localStorage.setItem("richup_ollama_model", CONFIG.OLLAMA_MODEL);
        this.logTerminal(`Ollama model set to: ${CONFIG.OLLAMA_MODEL}`);
      });
      btnPing.addEventListener("click", async () => {
        statusOllama.textContent = "Testing connection...";
        statusOllama.style.color = "#fbbf24";
        this.logTerminal(`Pinging Ollama at ${CONFIG.OLLAMA_HOST}...`);
        const res = await OllamaClient.checkHealth();
        if (res.ok) {
          const modelFound = res.hasTargetModel ? `(${CONFIG.OLLAMA_MODEL} ready)` : `(models: ${res.models.slice(0, 2).join(", ") || "none"})`;
          statusOllama.textContent = `\u{1F7E2} Connected ${modelFound}`;
          statusOllama.style.color = "#34d399";
          this.logTerminal(`Ollama online! Models: ${res.models.join(", ") || "none"}`);
        } else {
          statusOllama.textContent = `\u26AA Offline (Minimax Math Fallback)`;
          statusOllama.style.color = "#94a3b8";
          this.logTerminal(`Ollama offline: ${res.error || "Connection failed"}. Auto-fallback active.`);
        }
      });
      document.getElementById("rubot-chk-alwaysbuy").addEventListener("change", (e) => {
        CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked;
      });
      document.getElementById("rubot-chk-ambush").addEventListener("change", (e) => {
        CONFIG.AMBUSH_BUILD_ONLY = e.target.checked;
      });
      document.getElementById("rubot-chk-auction").addEventListener("change", (e) => {
        CONFIG.AUTO_AUCTION_ENABLED = e.target.checked;
      });
      document.getElementById("rubot-chk-trade").addEventListener("change", (e) => {
        CONFIG.AUTO_TRADE_ENABLED = e.target.checked;
      });
      document.getElementById("rubot-chk-build").addEventListener("change", (e) => {
        CONFIG.AUTO_BUILD_ENABLED = e.target.checked;
      });
      document.getElementById("rubot-chk-reserve").addEventListener("change", (e) => {
        CONFIG.SMART_RESERVE_ENABLED = e.target.checked;
      });
      this.initDragAndPersistence();
      window.__richupLogTerminal = (msg) => this.logTerminal(msg);
      this.logTerminal("Violet HUD v3.0 loaded. Press = or START BOT.");
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
        this.elements.masterBtn.textContent = "STOP BOT [=]";
        this.elements.phaseBadge.classList.add("active");
        this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? "ADVISOR" : "ACTIVE";
      } else {
        this.elements.masterBtn.classList.remove("active");
        this.elements.masterBtn.textContent = "START BOT [=]";
        this.elements.phaseBadge.classList.remove("active");
        this.elements.phaseBadge.textContent = "STANDBY";
      }
    },
    updateTelemetry() {
      if (!this.elements.valCash) return;
      this.elements.valCash.textContent = `$${GameMemory.myCash}`;
      this.elements.valPos.textContent = `Tile #${GameMemory.myPos}`;
      this.elements.valEV.textContent = `$${GameMemory.lastDangerEV}`;
      this.elements.valRsv.textContent = `$${GameMemory.lastDynamicReserve}`;
      if (this.elements.nameInput && document.activeElement !== this.elements.nameInput && GameMemory.myName) {
        if (this.elements.nameInput.value !== GameMemory.myName) {
          this.elements.nameInput.value = GameMemory.myName;
        }
      }
    },
    logTerminal(msg) {
      if (!this.elements.terminal) return;
      const line = document.createElement("div");
      line.className = "log-line";
      if (msg.includes("ACTION") || msg.includes("EV+") || msg.includes("AMBUSH")) line.classList.add("green");
      if (msg.includes("SWAP") || msg.includes("Trade") || msg.includes("ADVISOR")) line.classList.add("violet");
      if (msg.includes("Hotel Danger") || msg.includes("Veto") || msg.includes("Preserving")) line.classList.add("amber");
      line.textContent = `\u2022 ${msg}`;
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
    }
  };

  // src/dom/actionExecutor.js
  var isActing = false;
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
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        } catch (_) {
        }
        el.click();
      } catch (err) {
        logToBot(`Click error: ${err}`);
      } finally {
        setTimeout(() => {
          isActing = false;
        }, 120);
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
      if (!CONFIG.AUTO_TRADE_ENABLED) {
        if (declineBtn) {
          delayClick(declineBtn, "Auto-declining trade (Auto-Trade disabled)");
          return true;
        }
        return false;
      }
      const tradeData = scrapeTradeModalDOM();
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
          }
        });
      }
      return false;
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
      const decision = JailStrategy.shouldPayToLeaveJail(GameMemory.myCash);
      if (decision.exit) {
        if (pardonBtn) {
          return executeOrAdvise({
            el: pardonBtn,
            title: "USE PARDON CARD",
            reason: decision.reason,
            onExecute: () => delayClick(pardonBtn, decision.reason)
          });
        }
        if (payBailBtn) {
          return executeOrAdvise({
            el: payBailBtn,
            title: "PAY $50 JAIL BAIL",
            reason: decision.reason,
            onExecute: () => delayClick(payBailBtn, decision.reason)
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
      const buyBtn = snapshot.findBuyPropertyButton();
      const auctionBtn = snapshot.findExactOrIncludes(["auction", "pass", "don't buy"]);
      if (!buyBtn && !auctionBtn) return false;
      const tile = BOARD_TILES[GameMemory.myPos] || null;
      if (buyBtn) {
        const btnText = normalizeText(buyBtn);
        const priceMatch = /\$?\s*(\d{2,4})/.exec(btnText);
        const price = priceMatch ? parseInt(priceMatch[1], 10) : tile?.price || 150;
        const auctionCheck = AuctionSniper.shouldSendToAuctionInsteadOfBuy(tile, price, GameMemory.myCash);
        if (auctionCheck.auction && auctionBtn) {
          return executeOrAdvise({
            el: auctionBtn,
            title: "TRIGGER AUCTION (Discount Steal)",
            reason: auctionCheck.reason,
            onExecute: () => delayClick(auctionBtn, auctionCheck.reason)
          });
        }
        const decision = MarkovRisk.shouldBuyProperty(tile, price, GameMemory.myCash);
        if (decision.buy) {
          return executeOrAdvise({
            el: buyBtn,
            title: `BUY ${tile ? tile.name.toUpperCase() : "PROPERTY"} ($${price})`,
            reason: decision.reason,
            onExecute: () => {
              if (tile && GameMemory.ownership[tile.id]) {
                GameMemory.ownership[tile.id].owner = GameMemory.myName || "__ME__";
              }
              delayClick(buyBtn, decision.reason);
            }
          });
        }
      }
      if (auctionBtn) {
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
      const bidBtn = snapshot.findAuctionBidButton();
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
      return false;
    },
    handleHouseBuilding(snapshot) {
      if (!CONFIG.AUTO_BUILD_ENABLED) return false;
      const modalUpgradeBtn = snapshot.findModalUpgradeButton();
      if (modalUpgradeBtn) {
        return executeOrAdvise({
          el: modalUpgradeBtn,
          title: "UPGRADE PROPERTY [\u2191]",
          reason: "Building house on selected property.",
          onExecute: () => delayClick(modalUpgradeBtn, "Clicking [\u2191] to build house")
        });
      }
      const upgrades = HouseBuilder.rankHouseUpgrades(GameMemory.myCash);
      if (upgrades.length === 0) {
        if (CONFIG.AUTO_MORTGAGE_ENABLED) {
          for (const [groupName, tiles] of Object.entries(GROUP_TILES)) {
            if (tiles[0].type !== "property") continue;
            const { owned, total } = GameMemory.getGroupCount(groupName, "__ME__");
            if (owned === total) {
              const houseCounts = tiles.map((t) => GameMemory.ownership[t.id]?.houses || 0);
              const minHouses = Math.min(...houseCounts);
              if (minHouses < 3) {
                const candidates = DebtRecovery.findStrategicMortgageCandidates();
                if (candidates.length > 0) {
                  const target = candidates[0];
                  const sidebarProp = snapshot.findSidebarPropertyItem(target.tile.name);
                  if (sidebarProp) {
                    return executeOrAdvise({
                      el: sidebarProp,
                      title: `STRATEGIC MORTGAGE: ${target.tile.name.toUpperCase()}`,
                      reason: `Mortgaging dead asset (+$${target.mortgageValue}) to fund 3-house rush on ${groupName}`,
                      onExecute: () => delayClick(sidebarProp, `Opening ${target.tile.name} for strategic mortgage`)
                    });
                  }
                }
              }
            }
          }
        }
        return false;
      }
      const top = upgrades[0];
      const sidebarItem = snapshot.findSidebarPropertyItem(top.tile.name);
      if (sidebarItem) {
        return executeOrAdvise({
          el: sidebarItem,
          title: `SELECT ${top.tile.name.toUpperCase()} TO UPGRADE`,
          reason: `Opening property menu to build house (${top.nextHouses} houses, ROI: ${top.roi})`,
          onExecute: () => delayClick(sidebarItem, `Opening ${top.tile.name} from sidebar`)
        });
      }
      return false;
    },
    handleDebtRecovery(snapshot) {
      const isDebt = GameMemory.myCash < 0;
      if (!CONFIG.AUTO_MORTGAGE_ENABLED || !isDebt) return false;
      logToBot(`[DEBT RECOVERY] Negative balance ($${GameMemory.myCash}). Liquidating assets to survive...`);
      const mortgageBtn = snapshot.findModalMortgageButton();
      const sellHouseBtn = snapshot.findModalSellHouseButton();
      if (mortgageBtn) {
        return executeOrAdvise({
          el: mortgageBtn,
          title: "MORTGAGE PROPERTY [\u{1F5D1}]",
          reason: `Cash is negative ($${GameMemory.myCash})! Mortgaging asset to clear debt.`,
          onExecute: () => delayClick(mortgageBtn, "Clicking [\u{1F5D1}] to mortgage property")
        });
      }
      if (sellHouseBtn) {
        return executeOrAdvise({
          el: sellHouseBtn,
          title: "SELL HOUSE [\u2193]",
          reason: `Cash is negative ($${GameMemory.myCash})! Selling house to clear debt.`,
          onExecute: () => delayClick(sellHouseBtn, "Clicking [\u2193] to sell house")
        });
      }
      const targets = DebtRecovery.rankLiquidationTargets();
      if (targets.length > 0) {
        const bestTarget = targets[0];
        const sidebarProp = snapshot.findSidebarPropertyItem(bestTarget.tile.name);
        if (sidebarProp) {
          return executeOrAdvise({
            el: sidebarProp,
            title: `OPEN ${bestTarget.tile.name.toUpperCase()} TO LIQUIDATE`,
            reason: `Cash is negative ($${GameMemory.myCash}). Selecting lowest sacrifice asset to mortgage.`,
            onExecute: () => delayClick(sidebarProp, `Opening ${bestTarget.tile.name} for debt recovery`)
          });
        }
      }
      return false;
    },
    handleRollDice(snapshot) {
      const rollBtn = snapshot.findExactOrIncludes(["roll the dice", "roll again"]);
      if (rollBtn) {
        GameMemory.isMyTurn = true;
        return executeOrAdvise({
          el: rollBtn,
          title: `ROLL THE DICE (Turn #${GameMemory.turnCount + 1})`,
          reason: `My turn! Cash: $${GameMemory.myCash} | Pos: Tile #${GameMemory.myPos}`,
          onExecute: () => {
            GameMemory.turnCount++;
            delayClick(rollBtn, `Rolling dice`);
          }
        });
      }
      return false;
    },
    handleEndTurn(snapshot) {
      const endTurnBtn = snapshot.findExactOrIncludes(["end turn", "done", "continue", "ok"]);
      if (endTurnBtn) {
        GameMemory.isMyTurn = false;
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
      syncBoardStateFromDOM();
      HUDPanel.updateTelemetry();
      const snapshot = createDOMSnapshot();
      if (await ActionExecutor.handleTrade(snapshot)) return;
      if (ActionExecutor.handleDebtRecovery(snapshot)) return;
      if (ActionExecutor.handleJail(snapshot)) return;
      if (ActionExecutor.handleRollDice(snapshot)) return;
      if (ActionExecutor.handleBuyOrAuction(snapshot)) return;
      if (ActionExecutor.handleAuction(snapshot)) return;
      if (ActionExecutor.handleHouseBuilding(snapshot)) return;
      if (ActionExecutor.handleProactiveTrade(snapshot)) return;
      ActionExecutor.handleEndTurn(snapshot);
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
