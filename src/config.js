/**
 * CONFIGURATION & HYPERPARAMETERS
 */
export const CONFIG = {
    // Action timing delays (in milliseconds) for human-like interaction
    ACTION_DELAY_MIN: 160,
    ACTION_DELAY_MAX: 320,
    OBSERVER_DEBOUNCE_MS: 100,
    POLL_INTERVAL_MS: 1200,
    SELF_HEAL_INTERVAL_MS: 1000,
    STALL_TIMEOUT_SEC: 8,

    // AI Operation Mode: false = FULL_AUTO, true = ADVISOR (Asks human before acting)
    ADVISOR_MODE: false,

    // AI Strategy Toggles
    ALWAYS_BUY_AFFORDABLE: true,     // Buy unowned lands when safe
    SMART_RESERVE_ENABLED: true,     // Maintain dynamic cash reserve against opponent monopolies
    AMBUSH_BUILD_ONLY: true,         // Never build when facing enemy hotels; build when enemies enter strike zone
    AUTO_TRADE_ENABLED: true,        // Evaluate and propose win-win trades
    AUTO_AUCTION_ENABLED: true,      // Intelligent auction bidding sniper
    AUTO_BUILD_ENABLED: true,        // Rush 3 houses on monopolies
    AUTO_MORTGAGE_ENABLED: true,     // Liquidate lowest-EV assets when in debt
    CHAT_ENABLED: true,              // Contextual trade negotiation chat

    // Math & Game-Theory Parameters
    BASE_MIN_RESERVE: 60,            // Absolute cash floor on empty board
    RISK_AVERSION_FACTOR: 1.75,      // Multiplier on 1-turn expected rent loss
    WORST_CASE_WEIGHT: 0.30,         // Weight on worst-case single roll in 5-9 window
    TRADE_MIN_ADVANTAGE_RATIO: 1.10, // Require at least 10% utility edge in trades
    AUCTION_MAX_OVERBID_RATIO: 1.40, // Max bid for critical blocker/completer
    CHAT_COOLDOWN_MS: 20000,         // Cooldown between chat negotiation messages

    // Hybrid Vision / LLM Brain Configuration (Local Ollama)
    OLLAMA_ENABLED: localStorage.getItem('richup_ollama_enabled') === 'true',
    OLLAMA_HOST: localStorage.getItem('richup_ollama_host') || 'http://localhost:11434',
    OLLAMA_MODEL: localStorage.getItem('richup_ollama_model') || 'llama3.2-vision',
    OLLAMA_TIMEOUT_MS: 2800          // Strict 2.8s cap to avoid stalling turns
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
