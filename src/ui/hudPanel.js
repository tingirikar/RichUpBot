import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { BOARD_LABELS_BLACKLIST } from '../data/boardTiles.js';
import { OllamaClient } from '../engine/ollamaClient.js';

/**
 * PREMIUM GLASSMORPHISM HUD PANEL v4.0
 *
 * Features:
 * 1. Deep violet dark glassmorphism with neon glow accents
 * 2. Animated stat cards with gradient text
 * 3. Pill-style toggle switches (replaces raw checkboxes)
 * 4. Glowing terminal with HH:MM:SS timestamps
 * 5. Fully resizable + draggable with localStorage persistence
 * 6. Advisor Mode with animated proposal card
 */
export const HUDPanel = {
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
        if (document.getElementById('rubot-hud-panel')) return;

        // Restore saved position & size
        let savedGeom = { left: 20, top: 20, width: 340, height: 560 };
        try {
            const raw = localStorage.getItem('richup_hud_geometry');
            if (raw) savedGeom = Object.assign(savedGeom, JSON.parse(raw));
        } catch (_) {}

        // Load Google Fonts
        if (!document.getElementById('rubot-font-link')) {
            const link = document.createElement('link');
            link.id = 'rubot-font-link';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap';
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
                min-width: 300px; min-height: 420px;
                max-width: 560px; max-height: 840px;
                resize: both; overflow: hidden;
                background: linear-gradient(160deg, rgba(10,7,22,0.97) 0%, rgba(18,10,38,0.97) 100%);
                backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(139,92,246,0.35);
                border-radius: 16px;
                box-shadow: 0 0 0 1px rgba(139,92,246,0.08), 0 8px 32px rgba(0,0,0,0.7), 0 0 60px rgba(109,40,217,0.12), inset 0 1px 0 rgba(255,255,255,0.06);
                color: #f3e8ff;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 11.5px; z-index: 9999999;
                display: flex; flex-direction: column; user-select: none;
            }
            .rubot-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 13px 16px 12px;
                background: linear-gradient(90deg, rgba(109,40,217,0.6) 0%, rgba(76,29,149,0.5) 60%, rgba(139,92,246,0.3) 100%);
                border-bottom: 1px solid rgba(139,92,246,0.25);
                border-radius: 16px 16px 0 0; cursor: grab; flex-shrink: 0;
            }
            .rubot-title-wrap { display: flex; align-items: center; gap: 9px; }
            .rubot-logo {
                width: 28px; height: 28px; border-radius: 8px;
                background: linear-gradient(135deg, #8b5cf6, #6d28d9);
                display: flex; align-items: center; justify-content: center;
                font-size: 14px; flex-shrink: 0;
                box-shadow: 0 2px 8px rgba(109,40,217,0.6), inset 0 1px 0 rgba(255,255,255,0.15);
            }
            .rubot-title-text { display: flex; flex-direction: column; line-height: 1; }
            .rubot-title-main { font-size: 12px; font-weight: 800; color: #fff; letter-spacing: 1.5px; text-shadow: 0 0 12px rgba(167,139,250,0.8); }
            .rubot-title-sub { font-size: 8.5px; font-weight: 500; color: rgba(196,181,253,0.7); letter-spacing: 0.5px; margin-top: 2px; }
            .rubot-badge {
                font-size: 8.5px; font-weight: 700; padding: 3px 9px;
                border-radius: 20px; letter-spacing: 0.8px;
                background: rgba(255,255,255,0.08); color: rgba(196,181,253,0.8);
                border: 1px solid rgba(139,92,246,0.2); transition: all 0.3s ease;
            }
            .rubot-badge.active {
                background: linear-gradient(90deg, #10b981, #059669); color: #fff;
                border-color: transparent; box-shadow: 0 0 10px rgba(16,185,129,0.5);
                animation: rubot-badge-glow 2s ease-in-out infinite;
            }
            @keyframes rubot-badge-glow {
                0%, 100% { box-shadow: 0 0 8px rgba(16,185,129,0.4); }
                50% { box-shadow: 0 0 18px rgba(16,185,129,0.7); }
            }
            .rubot-body {
                padding: 12px; display: flex; flex-direction: column;
                gap: 10px; flex: 1; overflow-y: auto;
                scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.4) transparent;
            }
            .rubot-body::-webkit-scrollbar { width: 4px; }
            .rubot-body::-webkit-scrollbar-track { background: transparent; }
            .rubot-body::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.4); border-radius: 2px; }
            .rubot-section-label {
                font-size: 8px; font-weight: 700; letter-spacing: 1.5px;
                color: rgba(139,92,246,0.7); text-transform: uppercase; margin-bottom: -4px;
            }
            .rubot-identity-row {
                display: flex; align-items: center; gap: 8px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(139,92,246,0.18);
                border-radius: 10px; padding: 8px 10px;
            }
            .rubot-identity-icon { font-size: 14px; flex-shrink: 0; }
            .rubot-name-input {
                flex: 1; background: transparent; border: none; color: #fff;
                font-family: 'Inter', sans-serif; font-size: 11.5px; font-weight: 600;
                outline: none; min-width: 0;
            }
            .rubot-name-input::placeholder { color: rgba(167,139,250,0.4); }
            .rubot-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
            .rubot-stat-card {
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(139,92,246,0.15);
                border-radius: 10px; padding: 9px 10px;
                display: flex; flex-direction: column; gap: 4px;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .rubot-stat-card:hover { border-color: rgba(139,92,246,0.35); box-shadow: 0 0 12px rgba(109,40,217,0.1); }
            .rubot-stat-label { font-size: 8.5px; font-weight: 600; color: rgba(167,139,250,0.6); text-transform: uppercase; letter-spacing: 0.8px; }
            .rubot-stat-val {
                font-size: 17px; font-weight: 800; line-height: 1;
                background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            }
            .rubot-stat-val.green { background-image: linear-gradient(135deg, #34d399, #10b981); }
            .rubot-stat-val.violet { background-image: linear-gradient(135deg, #c084fc, #a78bfa); }
            .rubot-stat-val.amber { background-image: linear-gradient(135deg, #fbbf24, #f59e0b); }
            .rubot-stat-val.blue { background-image: linear-gradient(135deg, #60a5fa, #3b82f6); }
            .rubot-stat-val.red { background-image: linear-gradient(135deg, #f87171, #ef4444); }
            .rubot-mode-wrap {
                display: flex; background: rgba(0,0,0,0.35);
                border-radius: 10px; padding: 3px;
                border: 1px solid rgba(139,92,246,0.2); gap: 3px;
            }
            .rubot-mode-btn {
                flex: 1; background: transparent; border: none;
                color: rgba(196,181,253,0.6); font-family: 'Inter', sans-serif;
                font-weight: 700; font-size: 10px; letter-spacing: 0.5px;
                padding: 6px 4px; border-radius: 7px; cursor: pointer; transition: all 0.2s ease;
            }
            .rubot-mode-btn:hover { color: #c4b5fd; }
            .rubot-mode-btn.active {
                background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
                box-shadow: 0 2px 8px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.1);
            }
            .rubot-advisor-box {
                background: linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(76,29,149,0.2) 100%);
                border: 1px solid rgba(167,139,250,0.5);
                border-radius: 10px; padding: 11px 12px;
                display: flex; flex-direction: column; gap: 9px;
                animation: rubot-adv-pulse 2.5s ease-in-out infinite;
                position: relative; overflow: hidden;
            }
            .rubot-advisor-box::before {
                content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(167,139,250,0.7), transparent);
            }
            @keyframes rubot-adv-pulse {
                0%, 100% { box-shadow: 0 0 10px rgba(124,58,237,0.2); }
                50% { box-shadow: 0 0 22px rgba(167,139,250,0.35); }
            }
            .rubot-adv-header { display: flex; align-items: center; gap: 7px; }
            .rubot-adv-dot {
                width: 7px; height: 7px; border-radius: 50%; background: #a78bfa; flex-shrink: 0;
                box-shadow: 0 0 6px rgba(167,139,250,0.8);
                animation: rubot-dot-blink 1.2s ease-in-out infinite;
            }
            @keyframes rubot-dot-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            .rubot-advisor-title { font-weight: 700; font-size: 10.5px; color: #e9d5ff; letter-spacing: 0.3px; }
            .rubot-advisor-desc { font-size: 10.5px; color: #ddd6fe; line-height: 1.45; }
            .rubot-advisor-btns { display: flex; gap: 7px; }
            .rubot-adv-btn {
                flex: 1; padding: 7px; border: none; border-radius: 8px;
                font-family: 'Inter', sans-serif; font-weight: 700; font-size: 10.5px;
                letter-spacing: 0.3px; cursor: pointer; transition: all 0.15s ease;
            }
            .rubot-adv-btn.exec {
                background: linear-gradient(135deg, #10b981, #059669); color: #fff;
                box-shadow: 0 3px 10px rgba(16,185,129,0.35);
            }
            .rubot-adv-btn.exec:hover { box-shadow: 0 4px 15px rgba(16,185,129,0.55); transform: translateY(-1px); }
            .rubot-adv-btn.skip {
                background: rgba(255,255,255,0.07); color: #c4b5fd;
                border: 1px solid rgba(139,92,246,0.25);
            }
            .rubot-adv-btn.skip:hover { background: rgba(255,255,255,0.12); }
            .rubot-master-btn {
                background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%);
                border: none; color: #fff; padding: 11px 16px;
                font-family: 'Inter', sans-serif; font-weight: 800; font-size: 12px;
                letter-spacing: 1px; border-radius: 10px; cursor: pointer;
                box-shadow: 0 4px 15px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.12);
                transition: all 0.2s ease; position: relative; overflow: hidden;
            }
            .rubot-master-btn::after {
                content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
                transition: left 0.5s ease;
            }
            .rubot-master-btn:hover::after { left: 150%; }
            .rubot-master-btn:hover { box-shadow: 0 6px 22px rgba(109,40,217,0.6); transform: translateY(-1px); }
            .rubot-master-btn:active { transform: translateY(0); }
            .rubot-master-btn.active {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                box-shadow: 0 4px 15px rgba(16,185,129,0.45), inset 0 1px 0 rgba(255,255,255,0.12);
            }
            .rubot-master-btn.active:hover { box-shadow: 0 6px 22px rgba(16,185,129,0.6); }
            .rubot-ollama-section {
                background: rgba(109,40,217,0.06);
                border: 1px solid rgba(139,92,246,0.2);
                border-radius: 10px; padding: 9px 11px;
                display: flex; flex-direction: column; gap: 7px;
            }
            .rubot-ollama-header { display: flex; align-items: center; gap: 8px; }
            .rubot-toggle-pill { position: relative; width: 34px; height: 18px; flex-shrink: 0; }
            .rubot-toggle-pill input { opacity: 0; width: 0; height: 0; position: absolute; }
            .rubot-pill-track {
                position: absolute; inset: 0; background: rgba(255,255,255,0.1);
                border-radius: 20px; border: 1px solid rgba(139,92,246,0.3);
                cursor: pointer; transition: all 0.25s ease;
            }
            .rubot-pill-track::after {
                content: ''; position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
                width: 12px; height: 12px; border-radius: 50%;
                background: rgba(196,181,253,0.5); transition: all 0.25s ease;
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track {
                background: linear-gradient(135deg, #7c3aed, #6d28d9);
                border-color: #8b5cf6; box-shadow: 0 0 8px rgba(124,58,237,0.5);
            }
            .rubot-toggle-pill input:checked + .rubot-pill-track::after { left: calc(100% - 14px); background: #fff; }
            .rubot-ollama-label { font-size: 11px; font-weight: 700; color: #c4b5fd; flex: 1; }
            .rubot-btn-ping {
                background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.35);
                color: #c4b5fd; padding: 3px 9px; border-radius: 6px;
                font-family: 'Inter', sans-serif; font-size: 9.5px; font-weight: 600;
                cursor: pointer; transition: all 0.15s; letter-spacing: 0.3px;
            }
            .rubot-btn-ping:hover { background: rgba(139,92,246,0.3); color: #e9d5ff; border-color: rgba(139,92,246,0.55); }
            .rubot-ollama-fields { display: flex; flex-direction: column; gap: 5px; }
            .rubot-field-row { display: flex; align-items: center; gap: 7px; }
            .rubot-field-label { font-size: 9.5px; font-weight: 600; color: rgba(167,139,250,0.6); min-width: 38px; }
            .rubot-mini-input {
                flex: 1; background: rgba(0,0,0,0.3);
                border: 1px solid rgba(139,92,246,0.2); border-radius: 6px;
                color: #e9d5ff; padding: 3px 7px;
                font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
                outline: none; transition: border-color 0.2s;
            }
            .rubot-mini-input:focus { border-color: rgba(139,92,246,0.6); }
            .rubot-ollama-status { font-size: 9px; color: rgba(167,139,250,0.5); font-style: italic; letter-spacing: 0.2px; }
            .rubot-toggles-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
            .rubot-toggle-row {
                display: flex; align-items: center; gap: 7px;
                background: rgba(255,255,255,0.02);
                border: 1px solid rgba(139,92,246,0.1); border-radius: 8px;
                padding: 6px 8px; cursor: pointer; transition: border-color 0.2s;
            }
            .rubot-toggle-row:hover { border-color: rgba(139,92,246,0.25); }
            .rubot-toggle-row-label { font-size: 10px; font-weight: 600; color: rgba(196,181,253,0.75); flex: 1; line-height: 1.2; }
            .rubot-terminal-wrap {
                flex: 1; display: flex; flex-direction: column;
                min-height: 80px; background: rgba(0,0,0,0.45);
                border: 1px solid rgba(139,92,246,0.15); border-radius: 10px; overflow: hidden;
            }
            .rubot-terminal-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 5px 9px; background: rgba(139,92,246,0.07);
                border-bottom: 1px solid rgba(139,92,246,0.12);
            }
            .rubot-terminal-title { font-size: 8px; font-weight: 700; color: rgba(139,92,246,0.7); letter-spacing: 1.5px; text-transform: uppercase; }
            .rubot-terminal-dots { display: flex; gap: 4px; }
            .rubot-terminal-dots span { width: 6px; height: 6px; border-radius: 50%; }
            .rubot-terminal-dots span:nth-child(1) { background: rgba(239,68,68,0.5); }
            .rubot-terminal-dots span:nth-child(2) { background: rgba(251,191,36,0.5); }
            .rubot-terminal-dots span:nth-child(3) { background: rgba(52,211,153,0.5); }
            .rubot-terminal {
                flex: 1; overflow-y: auto; padding: 7px 9px;
                font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 9.5px; color: rgba(196,181,253,0.75);
                display: flex; flex-direction: column-reverse; gap: 1px;
                scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.3) transparent;
            }
            .rubot-terminal::-webkit-scrollbar { width: 3px; }
            .rubot-terminal::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
            .rubot-terminal .log-line { padding: 1.5px 0; word-break: break-word; line-height: 1.4; display: flex; gap: 5px; }
            .rubot-terminal .log-ts { color: rgba(109,40,217,0.5); flex-shrink: 0; font-size: 8.5px; }
            .rubot-terminal .log-line.green .log-msg { color: #34d399; }
            .rubot-terminal .log-line.violet .log-msg { color: #c084fc; }
            .rubot-terminal .log-line.amber .log-msg { color: #fbbf24; }
            .rubot-terminal .log-line.red .log-msg { color: #f87171; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'rubot-hud-panel';
        panel.innerHTML = `
            <div class="rubot-header" id="rubot-hud-drag">
                <div class="rubot-title-wrap">
                    <div class="rubot-logo">🎲</div>
                    <div class="rubot-title-text">
                        <span class="rubot-title-main">RICHUP BOT</span>
                        <span class="rubot-title-sub">AI-POWERED MONOPOLY ENGINE</span>
                    </div>
                </div>
                <span class="rubot-badge" id="rubot-phase-badge">STANDBY</span>
            </div>

            <div class="rubot-body">

                <div class="rubot-identity-row">
                    <span class="rubot-identity-icon">👤</span>
                    <input type="text" id="rubot-input-myname" class="rubot-name-input" placeholder="Your in-game username…" value="${GameMemory.myName || ''}">
                </div>

                <div class="rubot-stat-grid">
                    <div class="rubot-stat-card">
                        <div class="rubot-stat-label">💰 My Cash</div>
                        <div class="rubot-stat-val green" id="rubot-val-cash">$${GameMemory.myCash}</div>
                    </div>
                    <div class="rubot-stat-card">
                        <div class="rubot-stat-label">📍 Position</div>
                        <div class="rubot-stat-val violet" id="rubot-val-pos">Tile #${GameMemory.myPos}</div>
                    </div>
                    <div class="rubot-stat-card">
                        <div class="rubot-stat-label">⚠️ Danger EV</div>
                        <div class="rubot-stat-val amber" id="rubot-val-ev">$0</div>
                    </div>
                    <div class="rubot-stat-card">
                        <div class="rubot-stat-label">🛡️ Reserve</div>
                        <div class="rubot-stat-val blue" id="rubot-val-rsv">$${CONFIG.BASE_MIN_RESERVE}</div>
                    </div>
                </div>

                <div class="rubot-mode-wrap">
                    <button class="rubot-mode-btn active" id="rubot-btn-mode-auto">🤖 AUTO-PILOT</button>
                    <button class="rubot-mode-btn" id="rubot-btn-mode-advisor">🧠 ADVISOR</button>
                </div>

                <div id="rubot-advisor-box" class="rubot-advisor-box" style="display: none;">
                    <div class="rubot-adv-header">
                        <div class="rubot-adv-dot"></div>
                        <div class="rubot-advisor-title" id="rubot-adv-title">ADVISOR RECOMMENDATION</div>
                    </div>
                    <div class="rubot-advisor-desc" id="rubot-adv-desc">Waiting for next turn…</div>
                    <div class="rubot-advisor-btns">
                        <button class="rubot-adv-btn exec" id="rubot-adv-exec">✓ EXECUTE</button>
                        <button class="rubot-adv-btn skip" id="rubot-adv-skip">✕ SKIP</button>
                    </div>
                </div>

                <button class="rubot-master-btn" id="rubot-master-btn">▶ START BOT  [=]</button>

                <div class="rubot-ollama-section">
                    <div class="rubot-ollama-header">
                        <label class="rubot-toggle-pill">
                            <input type="checkbox" id="rubot-chk-ollama" ${CONFIG.OLLAMA_ENABLED ? 'checked' : ''}>
                            <span class="rubot-pill-track"></span>
                        </label>
                        <span class="rubot-ollama-label">⚡ Hybrid Ollama Brain</span>
                        <button class="rubot-btn-ping" id="rubot-btn-ollama-ping">Test</button>
                    </div>
                    <div class="rubot-ollama-fields" id="rubot-ollama-fields" style="${CONFIG.OLLAMA_ENABLED ? '' : 'display:none;'}">
                        <div class="rubot-field-row">
                            <span class="rubot-field-label">Host</span>
                            <input type="text" id="rubot-input-ollama-host" class="rubot-mini-input" value="${CONFIG.OLLAMA_HOST}">
                        </div>
                        <div class="rubot-field-row">
                            <span class="rubot-field-label">Model</span>
                            <input type="text" id="rubot-input-ollama-model" class="rubot-mini-input" value="${CONFIG.OLLAMA_MODEL}">
                        </div>
                        <div class="rubot-ollama-status" id="rubot-ollama-status">● Standby — Minimax Math Fallback Active</div>
                    </div>
                </div>

                <div class="rubot-section-label">Feature Toggles</div>
                <div class="rubot-toggles-grid">
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-alwaysbuy" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Buy Land</span>
                    </label>
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-ambush" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Hotel Ambush</span>
                    </label>
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-auction" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Auto-Auction</span>
                    </label>
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-trade" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Auto-Trade</span>
                    </label>
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-build" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Auto-Build</span>
                    </label>
                    <label class="rubot-toggle-row">
                        <label class="rubot-toggle-pill"><input type="checkbox" id="rubot-chk-reserve" checked><span class="rubot-pill-track"></span></label>
                        <span class="rubot-toggle-row-label">Smart Reserve</span>
                    </label>
                </div>

                <div class="rubot-terminal-wrap">
                    <div class="rubot-terminal-header">
                        <span class="rubot-terminal-title">Activity Log</span>
                        <div class="rubot-terminal-dots"><span></span><span></span><span></span></div>
                    </div>
                    <div class="rubot-terminal" id="rubot-terminal"></div>
                </div>

            </div>
        `;
        document.body.appendChild(panel);

        this.elements.panel = panel;
        this.elements.masterBtn = document.getElementById('rubot-master-btn');
        this.elements.phaseBadge = document.getElementById('rubot-phase-badge');
        this.elements.valCash = document.getElementById('rubot-val-cash');
        this.elements.valPos = document.getElementById('rubot-val-pos');
        this.elements.valEV = document.getElementById('rubot-val-ev');
        this.elements.valRsv = document.getElementById('rubot-val-rsv');
        this.elements.terminal = document.getElementById('rubot-terminal');
        this.elements.nameInput = document.getElementById('rubot-input-myname');
        this.elements.advisorBox = document.getElementById('rubot-advisor-box');
        this.elements.advTitle = document.getElementById('rubot-adv-title');
        this.elements.advDesc = document.getElementById('rubot-adv-desc');
        this.elements.advExec = document.getElementById('rubot-adv-exec');
        this.elements.advSkip = document.getElementById('rubot-adv-skip');
        this.elements.btnModeAuto = document.getElementById('rubot-btn-mode-auto');
        this.elements.btnModeAdv = document.getElementById('rubot-btn-mode-advisor');

        // Master toggle
        this.elements.masterBtn.addEventListener('click', () => {
            if (onToggleMaster) onToggleMaster();
        });

        // Mode buttons
        this.elements.btnModeAuto.addEventListener('click', () => {
            CONFIG.ADVISOR_MODE = false;
            this.elements.btnModeAuto.classList.add('active');
            this.elements.btnModeAdv.classList.remove('active');
            this.hideAdvisorBox();
            this.logTerminal('Mode → AUTO-PILOT');
        });

        this.elements.btnModeAdv.addEventListener('click', () => {
            CONFIG.ADVISOR_MODE = true;
            this.elements.btnModeAdv.classList.add('active');
            this.elements.btnModeAuto.classList.remove('active');
            this.logTerminal('Mode → ADVISOR (Awaiting your approval each turn)');
        });

        // Advisor actions
        this.elements.advExec.addEventListener('click', () => {
            if (onExecuteAdvisor) onExecuteAdvisor();
        });

        this.elements.advSkip.addEventListener('click', () => {
            if (onSkipAdvisor) onSkipAdvisor();
        });

        // Identity input
        const handleNameUpdate = (val) => {
            if (!val) return;
            const trimmed = val.trim();
            if (BOARD_LABELS_BLACKLIST.has(trimmed.toLowerCase())) return;
            GameMemory.setMyName(trimmed);
            GameMemory.cashVerified = false;
            this.logTerminal(`Identity → "${GameMemory.myName}"`);
        };

        this.elements.nameInput.addEventListener('change', (e) => handleNameUpdate(e.target.value));
        this.elements.nameInput.addEventListener('input', (e) => handleNameUpdate(e.target.value));

        // Hybrid Ollama Brain Wiring
        const chkOllama = document.getElementById('rubot-chk-ollama');
        const fieldsOllama = document.getElementById('rubot-ollama-fields');
        const inputHost = document.getElementById('rubot-input-ollama-host');
        const inputModel = document.getElementById('rubot-input-ollama-model');
        const statusOllama = document.getElementById('rubot-ollama-status');
        const btnPing = document.getElementById('rubot-btn-ollama-ping');

        chkOllama.addEventListener('change', (e) => {
            CONFIG.OLLAMA_ENABLED = e.target.checked;
            localStorage.setItem('richup_ollama_enabled', e.target.checked ? 'true' : 'false');
            fieldsOllama.style.display = e.target.checked ? 'flex' : 'none';
            this.logTerminal(`Hybrid Brain (Ollama) ${e.target.checked ? 'ENABLED' : 'DISABLED'}`);
        });

        inputHost.addEventListener('change', (e) => {
            CONFIG.OLLAMA_HOST = e.target.value.trim();
            localStorage.setItem('richup_ollama_host', CONFIG.OLLAMA_HOST);
            this.logTerminal(`Ollama host set to: ${CONFIG.OLLAMA_HOST}`);
        });

        inputModel.addEventListener('change', (e) => {
            CONFIG.OLLAMA_MODEL = e.target.value.trim();
            localStorage.setItem('richup_ollama_model', CONFIG.OLLAMA_MODEL);
            this.logTerminal(`Ollama model set to: ${CONFIG.OLLAMA_MODEL}`);
        });

        btnPing.addEventListener('click', async () => {
            statusOllama.textContent = '⏳ Testing connection…';
            statusOllama.style.color = '#fbbf24';
            this.logTerminal(`Pinging Ollama @ ${CONFIG.OLLAMA_HOST}…`);
            const res = await OllamaClient.checkHealth();
            if (res.ok) {
                const modelFound = res.hasTargetModel ? `(${CONFIG.OLLAMA_MODEL} ✓)` : `(available: ${res.models.slice(0, 2).join(', ') || 'none'})`;
                statusOllama.textContent = `🟢 Connected ${modelFound}`;
                statusOllama.style.color = '#34d399';
                this.logTerminal(`Ollama online! Models: ${res.models.join(', ') || 'none'}`);
            } else {
                statusOllama.textContent = `⚪ Offline — Minimax Math Fallback Active`;
                statusOllama.style.color = 'rgba(167, 139, 250, 0.5)';
                this.logTerminal(`Ollama offline: ${res.error || 'Connection failed'}. Fallback active.`);
            }
        });

        // Checkbox toggles
        document.getElementById('rubot-chk-alwaysbuy').addEventListener('change', e => { CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked; });
        document.getElementById('rubot-chk-ambush').addEventListener('change', e => { CONFIG.AMBUSH_BUILD_ONLY = e.target.checked; });
        document.getElementById('rubot-chk-auction').addEventListener('change', e => { CONFIG.AUTO_AUCTION_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-trade').addEventListener('change', e => { CONFIG.AUTO_TRADE_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-build').addEventListener('change', e => { CONFIG.AUTO_BUILD_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-reserve').addEventListener('change', e => { CONFIG.SMART_RESERVE_ENABLED = e.target.checked; });

        this.initDragAndPersistence();

        window.__richupLogTerminal = (msg) => this.logTerminal(msg);
        this.logTerminal('RichUp Bot v4.0 ready — press = or click START BOT.');
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
        if (!this.elements.valCash) return;
        this.elements.valCash.textContent = `$${GameMemory.myCash}`;
        if (GameMemory.myCash < 0) {
            this.elements.valCash.classList.remove('green');
            this.elements.valCash.classList.add('red');
        } else {
            this.elements.valCash.classList.remove('red');
            this.elements.valCash.classList.add('green');
        }
        if (GameMemory.inJail) {
            this.elements.valPos.textContent = `In Jail (#10)`;
        } else {
            this.elements.valPos.textContent = `Tile #${GameMemory.myPos}`;
        }
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
        if (msg.includes('ACTION') || msg.includes('EV+') || msg.includes('AMBUSH') || msg.includes('ready') || msg.includes('online')) line.classList.add('green');
        else if (msg.includes('SWAP') || msg.includes('Trade') || msg.includes('ADVISOR') || msg.includes('Mode') || msg.includes('Identity')) line.classList.add('violet');
        else if (msg.includes('Hotel Danger') || msg.includes('Veto') || msg.includes('Preserving') || msg.includes('Pinging')) line.classList.add('amber');
        else if (msg.includes('ERROR') || msg.includes('offline') || msg.includes('failed') || msg.includes('Offline')) line.classList.add('red');
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

        // Save geometry on resize as well
        const resizeObserver = new ResizeObserver(() => {
            this.saveGeometry();
        });
        resizeObserver.observe(panel);
    }
};
