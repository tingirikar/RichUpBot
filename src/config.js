/**
 * CONFIGURATION & HYPERPARAMETERS
 */
export const CONFIG = {
    // Action timing delays (in milliseconds) for human-like interaction
    ACTION_DELAY_MIN: 400,
    ACTION_DELAY_MAX: 1800,
    OBSERVER_DEBOUNCE_MS: 200,
    POLL_INTERVAL_MS: 1200,
    SELF_HEAL_INTERVAL_MS: 1000,
    STALL_TIMEOUT_SEC: 8,

    // AI Operation Mode: false = FULL_AUTO, true = ADVISOR (Asks human before acting)
    ADVISOR_MODE: false,

    // AI Strategy Toggles (Persisted in localStorage)
    ALWAYS_BUY_AFFORDABLE: localStorage.getItem('richup_cfg_buy') !== 'false',
    SMART_RESERVE_ENABLED: localStorage.getItem('richup_cfg_reserve') !== 'false',
    AMBUSH_BUILD_ONLY: false,        // Proactively build houses on monopolies whenever safe & affordable
    AUTO_TRADE_ENABLED: localStorage.getItem('richup_cfg_trade') !== 'false',
    AUTO_AUCTION_ENABLED: localStorage.getItem('richup_cfg_auction') !== 'false',
    AUTO_BUILD_ENABLED: localStorage.getItem('richup_cfg_build') !== 'false',
    AUTO_MORTGAGE_ENABLED: localStorage.getItem('richup_cfg_mortgage') !== 'false',
    CHAT_ENABLED: localStorage.getItem('richup_cfg_chat') !== 'false',

    // Math & Game-Theory Parameters
    BASE_MIN_RESERVE: 250,           // Absolute cash floor to prevent low-cash building traps
    RISK_AVERSION_FACTOR: 1.5,       // Balanced multiplier on 1-turn expected rent loss
    WORST_CASE_WEIGHT: 0.25,         // Weight on worst-case single roll
    TRADE_MIN_ADVANTAGE_RATIO: 1.05, // Require at least 5% utility edge in trades
    AUCTION_MAX_OVERBID_RATIO: 1.40, // Max bid for critical blocker/completer
    CHAT_COOLDOWN_MS: 20000,         // Cooldown between trade negotiation messages
    AUTO_REPLY_CHAT: true,           // Natural AI replies to opponent in-game chat ("chat if not bot", etc.)
    CHAT_REPLY_COOLDOWN_MS: 7000,    // Cooldown between chat conversational replies
    DELIBERATE_BEFORE_END_TURN: true,// LLM strategic review right before ending turn

    // Hybrid Vision / LLM Brain Configuration (Local Ollama)
    OLLAMA_ENABLED: localStorage.getItem('richup_ollama_enabled') !== 'false', // Default to true!
    OLLAMA_HOST: localStorage.getItem('richup_ollama_host') || 'http://localhost:11434',
    OLLAMA_MODEL: localStorage.getItem('richup_ollama_model') || 'qwen2.5:7b',
    OLLAMA_TIMEOUT_MS: 6000          // Cap to allow local LLMs to reason without early timeout
};

export const STATES = Object.freeze({
    IDLE: 'idle',
    ROLLING: 'rolling',
    JAIL_DECISION: 'jail_eval',
    BUYING: 'buying',
    AUCTION: 'auction_eval',
    TRADING: 'trade_eval',
    BUILDING: 'roi_build',
    LIQUIDATING: 'debt_recovery',
    ENDING_TURN: 'ending_turn'
});
