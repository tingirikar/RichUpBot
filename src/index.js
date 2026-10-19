import { CONFIG } from './config.js';
import { GameMemory } from './memory/gameMemory.js';
import { installWebSocketHook } from './dom/socketHook.js';
import { createDOMSnapshot } from './dom/elementFinder.js';
import { syncBoardStateFromDOM } from './dom/boardScanner.js';
import { ActionExecutor, getIsActing, logToBot } from './dom/actionExecutor.js';
import { HUDPanel } from './ui/hudPanel.js';

// =========================================================================
// INSTANCE CLEANUP (Prevent duplicate observers/timers on hot reloads)
// =========================================================================
if (window.__richupAuto && typeof window.__richupAuto.cleanup === 'function') {
    window.__richupAuto.cleanup();
}

const state = window.__richupAuto = {
    status: false,
    observer: null,
    timeouts: new Set(),
    intervals: new Set(),
    evaluateTimeout: null,
    keydownHandler: null,
    cleanup() {
        this.status = false;
        if (this.observer) this.observer.disconnect();
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

function checkGameStarted(snapshot) {
    // In lobby or color selection, game has not started yet
    return !snapshot.findExactOrIncludes(['change color', 'join game', 'create game', 'ready up']);
}

let isEvaluating = false;

async function evaluateAndAct() {
    try {
        if (!state.status || getIsActing() || isEvaluating) return;
        isEvaluating = true;

        syncBoardStateFromDOM();
        HUDPanel.updateTelemetry();

        const snapshot = createDOMSnapshot();

        // 1. Check for incoming trade modal (Hybrid Ollama / Minimax)
        if (await ActionExecutor.handleTrade(snapshot)) return;

        // 2. Check for Debt Recovery / Mortgaging (Negative cash must be resolved to proceed)
        if (ActionExecutor.handleDebtRecovery(snapshot)) return;

        // 3. Check for Jail decisions (room & phase aware)
        if (ActionExecutor.handleJail(snapshot)) return;

        // 4. Roll Dice if it's our turn to roll!
        if (ActionExecutor.handleRollDice(snapshot)) return;

        // 5. Check for landing on unowned property (Buy vs Auction)
        if (ActionExecutor.handleBuyOrAuction(snapshot)) return;

        // 6. Check for ongoing Auction bidding
        if (ActionExecutor.handleAuction(snapshot)) return;

        // 7. Check for House Building upgrades (on monopolies)
        if (ActionExecutor.handleHouseBuilding(snapshot)) return;

        // 8. Check for Proactive Mutual Monopoly Swaps
        if (ActionExecutor.handleProactiveTrade(snapshot)) return;

        // 9. Standard Turn Completion (End Turn)
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
            logToBot('Lobby detected. Bot will activate once match starts.');
        } else {
            logToBot('GRANDMASTER AI ENGAGED. AUTONOMOUS GAMEPLAY ACTIVE.');
        }
        evaluateAndAct();
    } else {
        logToBot('Automation Paused (STANDBY).');
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

    // Heartbeat fallback polling
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
