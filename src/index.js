import { CONFIG } from './config.js';
import { GameMemory } from './memory/gameMemory.js';
import { installWebSocketHook, setSocketMessageCallback } from './protocol/socketHook.js';
import { ActionExecutor, getIsActing, logToBot } from './protocol/actionExecutor.js';
import { TradeProposalExecutor } from './engine/tradeProposalExecutor.js';
import { ChatEngine } from './ui/chatEngine.js';
import { HUDPanel } from './ui/hudPanel.js';

// =========================================================================
// INSTANCE CLEANUP (Prevent duplicate timers on hot reloads)
// =========================================================================
if (window.__richupAuto && typeof window.__richupAuto.cleanup === 'function') {
    window.__richupAuto.cleanup();
}

const state = window.__richupAuto = {
    status: false,
    timeouts: new Set(),
    intervals: new Set(),
    evaluateTimeout: null,
    keydownHandler: null,
    cleanup() {
        this.status = false;
        this.timeouts.forEach(id => clearTimeout(id));
        this.intervals.forEach(id => clearInterval(id));
        this.timeouts.clear();
        this.intervals.clear();
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
        }
    }
};

// Install native network sniffer immediately
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

let isEvaluating = false;

/**
 * Pure Protocol Event-Driven Evaluation
 * Operates 100% on network state - Zero DOM queries
 */
async function evaluateAndAct() {
    try {
        if (!state.status || getIsActing() || isEvaluating) return;
        isEvaluating = true;

        // Keep HUD stats up to date
        try {
            HUDPanel.updateTelemetry();
        } catch (_) {}

        // Check for opponent chat messages (non-blocking background task)
        try {
            ChatEngine.scanAndRespondToOpponentChat().catch(() => {});
        } catch (_) {}

        // 0. Turn-Clock & Anti-AFK Safety Watchdog (Auto-grants/requests time & prevents timeouts)
        try {
            TradeProposalExecutor.cancelStaleProposal();
            if (ActionExecutor.handleTurnClockWatchdog()) return;
        } catch (err) {
            logToBot(`[Clock Watchdog Warning] ${err}`);
        }

        // 1. Check for incoming trade offer (minimax / Ollama)
        try {
            if (await ActionExecutor.handleTrade()) return;
        } catch (err) {
            logToBot(`[Trade Warning] ${err}`);
        }

        // 2. Check for Debt Recovery / Liquidation (negative cash must be cleared to proceed)
        try {
            if (ActionExecutor.handleDebtRecovery()) return;
        } catch (err) {
            logToBot(`[Debt Warning] ${err}`);
        }

        // 3. Check for Jail decisions (bail / pardon / doubles)
        try {
            if (ActionExecutor.handleJail()) return;
        } catch (err) {
            logToBot(`[Jail Warning] ${err}`);
        }

        // 4. Check for landing on unowned property (Buy vs Auction)
        try {
            if (ActionExecutor.handleBuyOrAuction()) return;
        } catch (err) {
            logToBot(`[Buy/Auction Warning] ${err}`);
        }

        // 5. Roll Dice if it's our turn to roll
        try {
            if (ActionExecutor.handleRollDice()) return;
        } catch (err) {
            logToBot(`[Roll Warning] ${err}`);
        }

        // 6. Check for ongoing Auction bidding
        try {
            if (ActionExecutor.handleAuction()) return;
        } catch (err) {
            logToBot(`[Auction Warning] ${err}`);
        }

        // 7. Check for House Building upgrades on completed monopolies
        try {
            if (await ActionExecutor.handleHouseBuilding()) return;
        } catch (err) {
            logToBot(`[Build Warning] ${err}`);
        }

        // 8. Check for Autonomous Unmortgaging (surplus cash)
        try {
            if (ActionExecutor.handleUnmortgage()) return;
        } catch (err) {
            logToBot(`[Unmortgage Warning] ${err}`);
        }

        // 9. Check for Proactive Mutual Monopoly Swaps
        try {
            if (ActionExecutor.handleProactiveTrade()) return;
        } catch (err) {
            logToBot(`[Trade Swap Warning] ${err}`);
        }

        // 10. Deliberate Strategic Review & Turn Completion (End Turn)
        try {
            await ActionExecutor.deliberateBeforeEndTurn();
        } catch (err) {
            logToBot(`[End Turn Warning] ${err}`);
            try { ActionExecutor.handleEndTurn(); } catch (_) {}
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
        logToBot('🚀 GRANDMASTER AI ENGAGED. PURE PROTOCOL ACTIVE.');
        evaluateAndAct();
    } else {
        logToBot('⏸️ Automation Paused (STANDBY).');
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

    // Event-driven reactive wakeup on any server WebSocket packet
    setSocketMessageCallback((eventName) => {
        if (state.status) {
            scheduleEvaluate();
        }
        try {
            HUDPanel.updateTelemetry();
        } catch (_) {}
    });

    // 250ms Heartbeat polling (keeps turn clock & HUD stats live)
    scheduleInterval(() => {
        if (state.status && !getIsActing()) {
            evaluateAndAct();
        } else {
            try {
                HUDPanel.updateTelemetry();
            } catch (_) {}
        }
    }, 250);

    // Hotkey '=' to toggle AI on/off
    state.keydownHandler = (e) => {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === '=') {
            e.preventDefault();
            toggleAutomation();
        }
    };
    document.addEventListener('keydown', state.keydownHandler);
}

initWhenReady();
