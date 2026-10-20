import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OllamaClient } from '../engine/ollamaClient.js';

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

        const panel = document.createElement('div');
        panel.id = 'rubot-hud-panel';

        panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <div class="rubot-title-wrap">
                    <div class="rubot-logo">🎲</div>
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
                            <option value="llama3.2-vision:latest" ${CONFIG.OLLAMA_MODEL === 'llama3.2-vision:latest' ? 'selected' : ''}>llama3.2-vision:latest (1st Priority Vision)</option>
                            <option value="qwen2.5:7b" ${CONFIG.OLLAMA_MODEL === 'qwen2.5:7b' ? 'selected' : ''}>qwen2.5:7b (2nd Priority Reasoning)</option>
                            <option value="llama3.2:3b" ${CONFIG.OLLAMA_MODEL === 'llama3.2:3b' ? 'selected' : ''}>llama3.2:3b (Fastest 3B)</option>
                            <option value="llama3.1:8b" ${CONFIG.OLLAMA_MODEL === 'llama3.1:8b' ? 'selected' : ''}>llama3.1:8b (Deep Valuation)</option>
                            <option value="qwen3.5:4b" ${CONFIG.OLLAMA_MODEL === 'qwen3.5:4b' ? 'selected' : ''}>qwen3.5:4b (Vision & Thinking)</option>
                            <option value="custom">Custom model...</option>
                        </select>
                        <input type="text" class="rubot-input" id="rubot-custom-model" style="display:none; margin-top: 4px;" placeholder="Model tag (e.g. llama3.2-vision:latest)" value="${CONFIG.OLLAMA_MODEL}" />
                    </div>

                    <button class="rubot-btn-test" id="rubot-btn-ping">⚡ Test & Connect Ollama</button>

                    <div class="rubot-info-box">
                        Ollama LLM acts as the master brain: evaluates trades, prevents unfair deficits, secures monopolies, plans building, and negotiates with players.
                    </div>
                </div>

                <!-- TAB 2: FEATURE TOGGLES -->
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
                                <span class="rubot-toggle-name">Natural AI Chat</span>
                                <span class="rubot-toggle-desc">Converses naturally with opponents during match</span>
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
                            <button class="rubot-btn-clear" id="rubot-btn-clear-log">Clear</button>
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
            btnPing: document.getElementById('rubot-btn-ping')
        };

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
            });
        });

        // Clear Log
        document.getElementById('rubot-btn-clear-log').addEventListener('click', () => {
            if (this.elements.terminal) this.elements.terminal.innerHTML = '';
        });

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

        // Feature Toggles listeners
        document.getElementById('rubot-chk-buy').addEventListener('change', e => { CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked; });
        document.getElementById('rubot-chk-trade').addEventListener('change', e => { CONFIG.AUTO_TRADE_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-build').addEventListener('change', e => { CONFIG.AUTO_BUILD_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-mortgage').addEventListener('change', e => { CONFIG.AUTO_MORTGAGE_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-auction').addEventListener('change', e => { CONFIG.AUTO_AUCTION_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-reserve').addEventListener('change', e => { CONFIG.SMART_RESERVE_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-chat').addEventListener('change', e => { CONFIG.CHAT_ENABLED = e.target.checked; });

        this.initDragAndPersistence();

        window.__richupLogTerminal = (msg) => this.logTerminal(msg);
        this.logTerminal('RichUp Bot v5.0 initialized. Ready for gameplay.');

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
    }
};
