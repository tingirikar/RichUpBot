import { CONFIG } from '../config.js';
import { GameMemory } from '../memory/gameMemory.js';
import { BOARD_LABELS_BLACKLIST } from '../data/boardTiles.js';

/**
 * MODERN VIOLET RESIZABLE HUD PANEL
 * 
 * Features:
 * 1. Sleek, minimal dark-violet color palette
 * 2. Fully resizable with position & dimension persistence in localStorage
 * 3. Advisor Mode: Asks for human confirmation with [EXECUTE] / [SKIP]
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

        // Restore saved position & size from localStorage
        let savedGeom = { left: 20, top: 20, width: 330, height: 460 };
        try {
            const raw = localStorage.getItem('richup_hud_geometry');
            if (raw) savedGeom = Object.assign(savedGeom, JSON.parse(raw));
        } catch (_) {}

        const style = document.createElement('style');
        style.id = 'rubot-hud-style';
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

        const panel = document.createElement('div');
        panel.id = 'rubot-hud-panel';
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
                    <input type="text" id="rubot-input-myname" class="rubot-name-input" placeholder="Your username" value="${GameMemory.myName || ''}">
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
                        <button class="rubot-adv-btn exec" id="rubot-adv-exec">✓ EXECUTE</button>
                        <button class="rubot-adv-btn skip" id="rubot-adv-skip">✕ SKIP</button>
                    </div>
                </div>

                <button class="rubot-master-btn" id="rubot-master-btn">START BOT [=]</button>

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
            this.logTerminal('Switched to: AUTO-PILOT MODE');
        });

        this.elements.btnModeAdv.addEventListener('click', () => {
            CONFIG.ADVISOR_MODE = true;
            this.elements.btnModeAdv.classList.add('active');
            this.elements.btnModeAuto.classList.remove('active');
            this.logTerminal('Switched to: ADVISOR MODE (Asks you before acting!)');
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
            this.logTerminal(`Identity saved: "${GameMemory.myName}"`);
        };

        this.elements.nameInput.addEventListener('change', (e) => handleNameUpdate(e.target.value));
        this.elements.nameInput.addEventListener('input', (e) => handleNameUpdate(e.target.value));

        // Checkbox toggles
        document.getElementById('rubot-chk-alwaysbuy').addEventListener('change', e => { CONFIG.ALWAYS_BUY_AFFORDABLE = e.target.checked; });
        document.getElementById('rubot-chk-ambush').addEventListener('change', e => { CONFIG.AMBUSH_BUILD_ONLY = e.target.checked; });
        document.getElementById('rubot-chk-auction').addEventListener('change', e => { CONFIG.AUTO_AUCTION_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-trade').addEventListener('change', e => { CONFIG.AUTO_TRADE_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-build').addEventListener('change', e => { CONFIG.AUTO_BUILD_ENABLED = e.target.checked; });
        document.getElementById('rubot-chk-reserve').addEventListener('change', e => { CONFIG.SMART_RESERVE_ENABLED = e.target.checked; });

        this.initDragAndPersistence();

        window.__richupLogTerminal = (msg) => this.logTerminal(msg);
        this.logTerminal('Violet HUD v3.0 loaded. Press = or START BOT.');
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
            this.elements.masterBtn.textContent = 'STOP BOT [=]';
            this.elements.phaseBadge.classList.add('active');
            this.elements.phaseBadge.textContent = CONFIG.ADVISOR_MODE ? 'ADVISOR' : 'ACTIVE';
        } else {
            this.elements.masterBtn.classList.remove('active');
            this.elements.masterBtn.textContent = 'START BOT [=]';
            this.elements.phaseBadge.classList.remove('active');
            this.elements.phaseBadge.textContent = 'STANDBY';
        }
    },

    updateTelemetry() {
        if (!this.elements.valCash) return;
        this.elements.valCash.textContent = `$${GameMemory.myCash}`;
        this.elements.valPos.textContent = `Tile #${GameMemory.myPos}`;
        this.elements.valEV.textContent = `$${GameMemory.lastDangerEV}`;
        this.elements.valRsv.textContent = `$${GameMemory.lastDynamicReserve}`;
        if (!this.elements.nameInput.value && GameMemory.myName) {
            this.elements.nameInput.value = GameMemory.myName;
        }
    },

    logTerminal(msg) {
        if (!this.elements.terminal) return;
        const line = document.createElement('div');
        line.className = 'log-line';
        if (msg.includes('ACTION') || msg.includes('EV+') || msg.includes('AMBUSH')) line.classList.add('green');
        if (msg.includes('SWAP') || msg.includes('Trade') || msg.includes('ADVISOR')) line.classList.add('violet');
        if (msg.includes('Hotel Danger') || msg.includes('Veto') || msg.includes('Preserving')) line.classList.add('amber');
        line.textContent = `• ${msg}`;
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
