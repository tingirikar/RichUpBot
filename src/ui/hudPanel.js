import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OllamaClient } from '../engine/ollamaClient.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { requestFullStateResync } from '../protocol/socketHook.js';

/**
 * TABULAR MINIMAL HUD PANEL v5.0
 * 
 * Design:
 * 1. Minimal, sleek dark violet glassmorphic layout (no cramped stat cards)
 * 2. Tab Navigation:
 *    - Tab 1: Brain (Ollama) [Initial default page]
 *    - Tab 2: Toggles (Feature switches with clear names)
 *    - Tab 3: Activity Log (Dedicated spacious action terminal)
 * 3. Master Start/Stop Bot button & Auto-Pilot / Advisor mode selector
 * 4. Automatic Ollama connection check on launch
 */
export const HUDPanel = {
    elements: {},
    maxLogs: 120,
    pendingAdvisorAction: null,
    activeTab: 'brain',
    drag: {
        active: false,
        startX: 0,
        startY: 0,
        initialLeft: 20,
        initialTop: 20
    },

    inject(onToggleMaster, onExecuteAdvisor, onSkipAdvisor) {
        if (document.getElementById('rubot-hud-panel')) return;

        // Restore saved geometry
        let savedGeom = { left: 20, top: 20, width: 340, height: 460 };
        try {
            const raw = localStorage.getItem('richup_hud_geometry');
            if (raw) savedGeom = Object.assign(savedGeom, JSON.parse(raw));
        } catch (_) {}

        // Google Fonts
        if (!document.getElementById('rubot-font-link')) {
            const link = document.createElement('link');
            link.id = 'rubot-font-link';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
            document.head.appendChild(link);
        }

        const style = document.createElement('style');
        style.id = 'rubot-hud-style';
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

        const panel = document.createElement('div');
        panel.id = 'rubot-hud-panel';

        panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <div class="rubot-title-wrap">
                    <div class="rubot-logo" id="rubot-logo-btn" title="Click to force full state resync" style="cursor: pointer;">🎲</div>
                    <span class="rubot-title-main">RICHUP BOT</span>
                </div>
                <div class="rubot-badge" id="rubot-badge-status">STANDBY</div>
            </div>

            <div class="rubot-top-controls">
                <button class="rubot-master-btn" id="rubot-btn-master">▶ START BOT  [=]</button>
                <div class="rubot-mode-wrap">
                    <button class="rubot-mode-btn ${!CONFIG.ADVISOR_MODE ? 'active' : ''}" id="rubot-mode-auto">⚡ AUTO-PILOT</button>
                    <button class="rubot-mode-btn ${CONFIG.ADVISOR_MODE ? 'active' : ''}" id="rubot-mode-adv">💬 ADVISOR</button>
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
                <button class="rubot-tab-btn active" data-tab="brain">🧠 Brain</button>
                <button class="rubot-tab-btn" data-tab="intel">📊 Intel</button>
                <button class="rubot-tab-btn" data-tab="toggles">⚙️ Features</button>
                <button class="rubot-tab-btn" data-tab="logs">📋 Activity Log</button>
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
                            <option value="qwen2.5:7b" ${CONFIG.OLLAMA_MODEL === 'qwen2.5:7b' ? 'selected' : ''}>qwen2.5:7b (1st Priority Logic & Math)</option>
                            <option value="llama3.2:3b" ${CONFIG.OLLAMA_MODEL === 'llama3.2:3b' ? 'selected' : ''}>llama3.2:3b (2nd Priority Fast Fallback)</option>
                            <option value="llama3.1:8b" ${CONFIG.OLLAMA_MODEL === 'llama3.1:8b' ? 'selected' : ''}>llama3.1:8b (Deep Valuation)</option>
                            <option value="qwen3.5:4b" ${CONFIG.OLLAMA_MODEL === 'qwen3.5:4b' ? 'selected' : ''}>qwen3.5:4b (Thinking & Reasoning)</option>
                            <option value="llama3.2-vision:latest" ${CONFIG.OLLAMA_MODEL === 'llama3.2-vision:latest' ? 'selected' : ''}>llama3.2-vision:latest (Vision Capable)</option>
                            <option value="custom">Custom model...</option>
                        </select>
                        <input type="text" class="rubot-input" id="rubot-custom-model" style="display:none; margin-top: 4px;" placeholder="Model tag (e.g. qwen2.5:7b)" value="${CONFIG.OLLAMA_MODEL}" />
                    </div>

                    <button class="rubot-btn-test" id="rubot-btn-ping">⚡ Test & Connect Ollama</button>

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
                                <input type="checkbox" id="rubot-chk-buy" ${CONFIG.ALWAYS_BUY_AFFORDABLE ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Win-Win Trading</span>
                                <span class="rubot-toggle-desc">Always accept monopoly completers & propose swaps</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-trade" ${CONFIG.AUTO_TRADE_ENABLED ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Build Houses</span>
                                <span class="rubot-toggle-desc">Proactively build houses & rush 3-house monopolies</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-build" ${CONFIG.AUTO_BUILD_ENABLED ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Mortgage / Debt</span>
                                <span class="rubot-toggle-desc">Liquidate dead assets to clear debt and avoid bankruptcy</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-mortgage" ${CONFIG.AUTO_MORTGAGE_ENABLED ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Auto Auction Sniping</span>
                                <span class="rubot-toggle-desc">Snipe underpriced auctions & block enemy sets</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-auction" ${CONFIG.AUTO_AUCTION_ENABLED ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Smart Cash Reserve</span>
                                <span class="rubot-toggle-desc">Reserve cash dynamically against enemy landing zones</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-reserve" ${CONFIG.SMART_RESERVE_ENABLED ? 'checked' : ''}>
                                <div class="rubot-pill-track"></div>
                            </div>
                        </label>

                        <label class="rubot-toggle-item">
                            <div class="rubot-toggle-info">
                                <span class="rubot-toggle-name">Chat Engagement</span>
                                <span class="rubot-toggle-desc">Auto-replies & trade talk (OFF = completely silent)</span>
                            </div>
                            <div class="rubot-toggle-pill">
                                <input type="checkbox" id="rubot-chk-chat" ${CONFIG.CHAT_ENABLED ? 'checked' : ''}>
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
            phaseBadge: document.getElementById('rubot-badge-status'),
            masterBtn: document.getElementById('rubot-btn-master'),
            modeAuto: document.getElementById('rubot-mode-auto'),
            modeAdv: document.getElementById('rubot-mode-adv'),
            advisorBox: document.getElementById('rubot-advisor-box'),
            advTitle: document.getElementById('rubot-adv-title'),
            advDesc: document.getElementById('rubot-adv-desc'),
            advExec: document.getElementById('rubot-adv-exec'),
            advSkip: document.getElementById('rubot-adv-skip'),
            terminal: document.getElementById('rubot-terminal'),
            dotOllama: document.getElementById('rubot-dot-ollama'),
            statusOllama: document.getElementById('rubot-status-ollama'),
            hostInput: document.getElementById('rubot-host-ollama'),
            selectModel: document.getElementById('rubot-select-model'),
            customModel: document.getElementById('rubot-custom-model'),
            btnPing: document.getElementById('rubot-btn-ping'),
            logoBtn: document.getElementById('rubot-logo-btn')
        };

        // Resync button on logo click
        if (this.elements.logoBtn) {
            this.elements.logoBtn.addEventListener('click', () => {
                requestFullStateResync();
                this.logTerminal('🔄 Requested full authoritative game state resync from server!');
            });
        }

        // Master toggle
        this.elements.masterBtn.addEventListener('click', onToggleMaster);

        // Mode toggles
        this.elements.modeAuto.addEventListener('click', () => {
            CONFIG.ADVISOR_MODE = false;
            this.elements.modeAuto.classList.add('active');
            this.elements.modeAdv.classList.remove('active');
            this.hideAdvisorBox();
            this.logTerminal('Mode: AUTO-PILOT (Fully Autonomous)');
        });

        this.elements.modeAdv.addEventListener('click', () => {
            CONFIG.ADVISOR_MODE = true;
            this.elements.modeAdv.classList.add('active');
            this.elements.modeAuto.classList.remove('active');
            this.logTerminal('Mode: ADVISOR (Human Approval)');
        });

        // Advisor execution buttons
        this.elements.advExec.addEventListener('click', () => {
            if (this.pendingAdvisorAction?.onExec) {
                this.pendingAdvisorAction.onExec();
            }
            this.hideAdvisorBox();
        });

        this.elements.advSkip.addEventListener('click', () => {
            if (this.pendingAdvisorAction?.onSkip) {
                this.pendingAdvisorAction.onSkip();
            }
            this.hideAdvisorBox();
        });

        // Tab Navigation
        const tabBtns = panel.querySelectorAll('.rubot-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                panel.querySelectorAll('.rubot-tab-page').forEach(page => {
                    page.classList.remove('active');
                });
                const targetPage = document.getElementById(`rubot-page-${targetTab}`);
                if (targetPage) targetPage.classList.add('active');
                this.activeTab = targetTab;
                if (targetTab === 'intel') this.updateIntelTab();
            });
        });

        // Clear Log
        document.getElementById('rubot-btn-clear-log').addEventListener('click', () => {
            if (this.elements.terminal) this.elements.terminal.innerHTML = '';
        });

        // Copy Log to Clipboard
        const copyBtn = document.getElementById('rubot-btn-copy-log');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const term = this.elements.terminal;
                if (!term) return;
                const lineEls = Array.from(term.querySelectorAll('.log-line'));
                const text = lineEls.reverse().map(l => l.innerText).join('\n') || term.innerText;
                try {
                    await navigator.clipboard.writeText(text);
                } catch (_) {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                const oldText = copyBtn.innerText;
                copyBtn.innerText = 'Copied!';
                copyBtn.style.color = '#34d399';
                copyBtn.style.borderColor = 'rgba(52,211,153,0.5)';
                setTimeout(() => {
                    copyBtn.innerText = oldText;
                    copyBtn.style.color = '';
                    copyBtn.style.borderColor = '';
                }, 1500);
            });
        }

        // Ollama Settings
        this.elements.hostInput.addEventListener('change', (e) => {
            CONFIG.OLLAMA_HOST = e.target.value.trim();
            localStorage.setItem('richup_ollama_host', CONFIG.OLLAMA_HOST);
            this.logTerminal(`Ollama host set to: ${CONFIG.OLLAMA_HOST}`);
        });

        this.elements.selectModel.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                this.elements.customModel.style.display = 'block';
            } else {
                this.elements.customModel.style.display = 'none';
                CONFIG.OLLAMA_MODEL = e.target.value;
                localStorage.setItem('richup_ollama_model', CONFIG.OLLAMA_MODEL);
                this.logTerminal(`Ollama model: ${CONFIG.OLLAMA_MODEL}`);
            }
        });

        this.elements.customModel.addEventListener('change', (e) => {
            CONFIG.OLLAMA_MODEL = e.target.value.trim();
            localStorage.setItem('richup_ollama_model', CONFIG.OLLAMA_MODEL);
            this.logTerminal(`Ollama model set to: ${CONFIG.OLLAMA_MODEL}`);
        });

        const testOllama = async () => {
            this.elements.statusOllama.textContent = 'Connecting...';
            this.elements.dotOllama.className = 'rubot-status-dot';
            const res = await OllamaClient.checkHealth();
            if (res.ok) {
                this.elements.dotOllama.className = 'rubot-status-dot online';
                const found = res.models.find(m => m.includes(CONFIG.OLLAMA_MODEL)) || res.models[0] || CONFIG.OLLAMA_MODEL;
                this.elements.statusOllama.textContent = `Connected (${CONFIG.OLLAMA_MODEL})`;
                CONFIG.OLLAMA_ENABLED = true;
                localStorage.setItem('richup_ollama_enabled', 'true');
                this.logTerminal(`Ollama connected: ${found}. Brain online!`);
            } else {
                this.elements.dotOllama.className = 'rubot-status-dot offline';
                this.elements.statusOllama.textContent = `Disconnected: ${res.error || 'Check host'}`;
                this.logTerminal(`Ollama offline: ${res.error || 'Connection failed'}`);
            }
        };

        this.elements.btnPing.addEventListener('click', testOllama);

        // Feature Toggles listeners (persisted to localStorage)
        document.getElementById('rubot-chk-buy').addEventListener('change', e => { 
            CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked; 
            localStorage.setItem('richup_cfg_buy', String(e.target.checked));
        });
        document.getElementById('rubot-chk-trade').addEventListener('change', e => { 
            CONFIG.AUTO_TRADE_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_trade', String(e.target.checked));
        });
        document.getElementById('rubot-chk-build').addEventListener('change', e => { 
            CONFIG.AUTO_BUILD_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_build', String(e.target.checked));
        });
        document.getElementById('rubot-chk-mortgage').addEventListener('change', e => { 
            CONFIG.AUTO_MORTGAGE_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_mortgage', String(e.target.checked));
        });
        document.getElementById('rubot-chk-auction').addEventListener('change', e => { 
            CONFIG.AUTO_AUCTION_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_auction', String(e.target.checked));
        });
        document.getElementById('rubot-chk-reserve').addEventListener('change', e => { 
            CONFIG.SMART_RESERVE_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_reserve', String(e.target.checked));
        });
        document.getElementById('rubot-chk-chat').addEventListener('change', e => { 
            CONFIG.CHAT_ENABLED = e.target.checked; 
            localStorage.setItem('richup_cfg_chat', String(e.target.checked));
            this.logTerminal(`Chat Engagement: ${e.target.checked ? 'ENABLED (Casual human replies)' : 'DISABLED (100% silent)'}`);
        });

        // Toolbar Action Listeners (Export JSONL, Copy, Clear)
        const exportBtn = document.getElementById('rubot-btn-export-log');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const logs = Array.from(this.elements.terminal?.querySelectorAll('.log-line') || [])
                    .reverse()
                    .map(el => ({
                        ts: el.querySelector('.log-ts')?.textContent || '',
                        msg: el.querySelector('.log-msg')?.textContent || ''
                    }));
                const trace = {
                    exportedAt: new Date().toISOString(),
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
                const blob = new Blob([jsonl], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `richup_trace_${GameMemory.currentRoomId || 'match'}_${Date.now()}.jsonl`;
                a.click();
                URL.revokeObjectURL(url);
                this.logTerminal(`Match trace exported: ${a.download}`);
            });
        }

        this.initDragAndPersistence();

        window.__richupLogTerminal = (msg) => this.logTerminal(msg);
        this.logTerminal('RichUp Bot v5.0 initialized. Ready for gameplay.');

        // Periodic live Game Memory intel sync
        setInterval(() => {
            if (this.activeTab === 'intel') {
                this.updateIntelTab();
            }
        }, 1200);

        // Automatic background connection test on launch
        setTimeout(testOllama, 400);
    },

    isProposalActive(title) {
        return Boolean(
            this.pendingAdvisorAction &&
            this.elements.advisorBox &&
            this.elements.advisorBox.style.display !== 'none' &&
            this.elements.advTitle &&
            this.elements.advTitle.textContent === title
        );
    },

    showAdvisorProposal(title, desc, onExec, onSkip) {
        if (!this.elements.advisorBox) return;
        this.elements.advTitle.textContent = title;
        this.elements.advDesc.textContent = desc;
        this.elements.advisorBox.style.display = 'flex';
        this.pendingAdvisorAction = { onExec, onSkip };
    },

    hideAdvisorBox() {
        if (!this.elements.advisorBox) return;
        this.elements.advisorBox.style.display = 'none';
        this.pendingAdvisorAction = null;
    },

    updateMasterButton(isActive) {
        if (!this.elements.masterBtn) return;
        if (isActive) {
            this.elements.masterBtn.classList.add('active');
            this.elements.masterBtn.textContent = '■ STOP BOT  [=]';
            this.elements.phaseBadge.classList.add('active');
            this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? 'ADVISOR' : 'ACTIVE';
        } else {
            this.elements.masterBtn.classList.remove('active');
            this.elements.masterBtn.textContent = '▶ START BOT  [=]';
            this.elements.phaseBadge.classList.remove('active');
            this.elements.phaseBadge.textContent = 'STANDBY';
        }
    },

    updateTelemetry() {
        // Keeps state synchronized without cramped DOM cards
        if (this.elements.phaseBadge) {
            const isActive = this.elements.masterBtn && this.elements.masterBtn.classList.contains('active');
            if (isActive) {
                this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? 'ADVISOR' : 'ACTIVE';
            }
        }
        if (this.activeTab === 'intel') {
            this.updateIntelTab();
        }
    },

    appendLog(msg) {
        this.logTerminal(msg);
    },

    logTerminal(msg) {
        if (!this.elements.terminal) return;
        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const line = document.createElement('div');
        line.className = 'log-line';
        const tsPart = document.createElement('span');
        tsPart.className = 'log-ts';
        tsPart.textContent = ts;
        const msgPart = document.createElement('span');
        msgPart.className = 'log-msg';
        msgPart.textContent = msg;

        if (msg.includes('ACTION') || msg.includes('EV+') || msg.includes('Accept') || msg.includes('online') || msg.includes('Deal')) {
            line.classList.add('green');
        } else if (msg.includes('TRADE') || msg.includes('Brain') || msg.includes('Ollama') || msg.includes('STRATEGY')) {
            line.classList.add('violet');
        } else if (msg.includes('Caution') || msg.includes('Reserve') || msg.includes('Decline')) {
            line.classList.add('amber');
        } else if (msg.includes('ERROR') || msg.includes('DEBT') || msg.includes('MORTGAGE') || msg.includes('offline') || msg.includes('Bankrupt')) {
            line.classList.add('red');
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
            localStorage.setItem('richup_hud_geometry', JSON.stringify(geom));
        } catch (_) {}
    },

    initDragAndPersistence() {
        const handle = document.getElementById('rubot-hud-drag');
        const panel = this.elements.panel;

        handle.addEventListener('mousedown', (e) => {
            this.drag.active = true;
            this.drag.startX = e.clientX;
            this.drag.startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            this.drag.initialLeft = rect.left;
            this.drag.initialTop = rect.top;
            handle.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (this.drag.active) {
                e.preventDefault();
                const deltaX = e.clientX - this.drag.startX;
                const deltaY = e.clientY - this.drag.startY;
                panel.style.left = `${Math.max(0, this.drag.initialLeft + deltaX)}px`;
                panel.style.top = `${Math.max(0, this.drag.initialTop + deltaY)}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.drag.active) {
                this.drag.active = false;
                if (handle) handle.style.cursor = 'grab';
                this.saveGeometry();
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            this.saveGeometry();
        });
        resizeObserver.observe(panel);
    },

    updateIntelTab() {
        const container = document.getElementById('rubot-intel-container');
        if (!container) return;

        // Check if inside a live match room
        const inRoom = window.location.pathname.includes('/room/') || !!document.querySelector('[class*="board" i]');
        if (!inRoom) {
            container.innerHTML = `
                <div style="text-align: center; padding: 28px 14px; color: rgba(196,181,253,0.8);">
                    <div style="font-size: 28px; margin-bottom: 8px;">🎮</div>
                    <div style="font-weight: 700; font-size: 13px; color: #a78bfa; margin-bottom: 6px; letter-spacing: 0.5px;">WAITING FOR GAME TO START</div>
                    <div style="font-size: 11px; line-height: 1.5; color: rgba(196,181,253,0.6);">Join or create a match room to populate live player inventories, monopoly trackers, and real-time trade analytics.</div>
                </div>
            `;
            return;
        }

        const myName = GameMemory.myName || 'matrix';
        const myCash = GameMemory.myCash;
        
        // 1. My Holdings
        const myTiles = GameMemory.getAllTiles().filter(t => t.group && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
        const myMonopolies = [];
        for (const [groupName, groupTiles] of Object.entries(GameMemory.getGroupTiles())) {
            if (groupName === 'Airport' || groupName === 'Utility') continue;
            if (groupTiles.every(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
                myMonopolies.push(groupName);
            }
        }

        // 2. Opponents Analysis
        const oppData = OpponentTracker.analyzeOpponents();

        // 3. Unowned Properties
        const unownedCount = GameMemory.getUnownedPropertyCount();

        let html = `
            <div class="rubot-intel-card">
                <div class="rubot-intel-title">
                    <span>👑 ME (${myName})</span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <span class="rubot-intel-badge ${GameMemory.autoActedTurns >= 1 ? 'rose' : 'green'}">Strikes: ${GameMemory.autoActedTurns || 0}/2</span>
                        <span class="rubot-intel-badge violet">Tile #${GameMemory.myPos || 0}</span>
                        <span class="rubot-intel-badge green">$${myCash}</span>
                    </div>
                </div>
                <div class="rubot-intel-content" style="margin-top:2px;">
                    <div style="display:flex;gap:6px;margin-bottom:4px;font-size:9.5px;color:#c4b5fd;">
                        <span>🗺️ Board: <b>${GameMemory.getBoardLength()} Tiles</b></span>
                        <span>🏖️ Vacation Pot: <b>$${GameMemory.vacationCash || 0}</b></span>
                        <span>🛡️ Pardon: <b>${GameMemory.pardonCards.treasure || GameMemory.pardonCards.surprise ? 'YES' : 'No'}</b></span>
                    </div>
                    <b>Properties (${myTiles.length}):</b> ${myTiles.length > 0 ? myTiles.map(t => {
                        const h = GameMemory.ownership[t.id]?.houses || 0;
                        const hStr = h === 5 ? ' [🏨]' : (h > 0 ? ` [🏠x${h}]` : '');
                        return `${t.name}${hStr}`;
                    }).join(', ') : '<span style="color:#6b7280">None yet</span>'}<br>
                    <b>Monopolies:</b> ${myMonopolies.length > 0 ? myMonopolies.map(m => `<span class="rubot-intel-badge green">${m}</span>`).join(' ') : '<span style="color:#6b7280">None</span>'}
                </div>
            </div>

            <div class="rubot-intel-card">
                <div class="rubot-intel-title">
                    <span>👥 OPPONENTS INVENTORIES</span>
                    <span class="rubot-intel-badge amber">${Object.keys(oppData).length} Tracked</span>
                </div>
                <div class="rubot-intel-content">
        `;

        const oppEntries = Object.entries(oppData);
        if (oppEntries.length === 0) {
            html += `<span style="color:#6b7280; font-style:italic;">Scanning scoreboard...</span>`;
        } else {
            for (const [pName, data] of oppEntries) {
                const hungryStr = data.hungrySets.length > 0 
                    ? data.hungrySets.map(h => `<span class="rubot-intel-badge red">${h.group} ${h.ownedCount}/${h.total}</span>`).join(' ')
                    : '';
                const propStr = data.ownedTiles.length > 0
                    ? data.ownedTiles.map(t => t.name).join(', ')
                    : '<span style="color:#6b7280">None yet</span>';

                const declCount = typeof GameMemory.getDeclinedCountForPlayer === 'function' ? GameMemory.getDeclinedCountForPlayer(pName) : 0;
                const declBadge = declCount > 0 ? `<span class="rubot-intel-badge red">${declCount} Declined</span>` : '';
                const pos = GameMemory.players[pName]?.pos;
                const posStr = typeof pos === 'number' ? `Tile #${pos}` : 'Tile #0';

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
                    <span>🗺️ BOARD & STRATEGY STATUS</span>
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
