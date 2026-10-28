// PixelMeasure Pro - High-Performance Content Script Engine
(() => {
  // Prevent duplicate injection
  if (window.__PIXEL_MEASURE_INITIALIZED__) {
    return;
  }
  window.__PIXEL_MEASURE_INITIALIZED__ = true;
  const RULER_SIZE = 24;

  class PixelMeasureController {
    constructor() {
      this.isActive = false;
      this.mode = 'box'; // 'box' | 'line' | 'element' | 'crosshair'
      this.hostElement = null;
      this.shadowRoot = null;
      this.dom = null;
      this.unit = 'px';
      this.remBase = 16;
      this.showEdgeRulers = true;

      // Coordinates
      this.cursor = { x: 0, y: 0, pageX: 0, pageY: 0 };
      this.originPin = null; // { x, y }

      // Box measurement state
      this.isDrawingBox = false;
      this.isDraggingBox = false;
      this.isResizingBox = false;
      this.activeHandle = null;
      this.boxStart = { x: 0, y: 0 };
      this.currentBox = null; // { x, y, w, h }
      this.dragOffset = { x: 0, y: 0 };

      // Line measurement state
      this.isDrawingLine = false;
      this.lineStart = null; // { x, y }
      this.currentLine = null; // { x1, y1, x2, y2 }

      // Element measurement state
      this.hoveredElement = null;
      this.lockedElement = null;
      this.lastInspectedX = -1;
      this.lastInspectedY = -1;

      // Performance: rAF batching & throttling
      this.rafId = null;
      this.resizeRaf = null;
      this.needsRender = false;
      this.toastTimeout = null;

      // Bound event handlers
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseDown = this.handleMouseDown.bind(this);
      this.handleMouseUp = this.handleMouseUp.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleWindowResize = this.handleWindowResize.bind(this);
      this.onAnimationFrame = this.onAnimationFrame.bind(this);

      // HUD drag handlers
      this.handleHudMouseDown = null;
      this.handleHudMouseMove = null;
      this.handleHudMouseUp = null;
    }

    // Toggle the measurement overlay
    toggle() {
      if (this.isActive) {
        this.deactivate();
      } else {
        this.activate();
      }
      return this.isActive;
    }

    activate() {
      if (this.isActive) return;
      this.isActive = true;
      this.createOverlay();
      this.attachEvents();
      this.needsRender = true;
      this.scheduleFrame();
      this.notifyState();
    }

    deactivate() {
      if (!this.isActive) return;
      this.isActive = false;
      this.detachEvents();
      this.removeOverlay();
      this.notifyState();
    }

    notifyState() {
      if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'OVERLAY_STATE_CHANGED',
          active: this.isActive,
          mode: this.mode
        }).catch(() => {});
      }
    }

    createOverlay() {
      if (this.hostElement) return;

      this.hostElement = document.createElement('pixel-measure-host');
      this.hostElement.id = 'pixel-measure-root';
      this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

      // Link external CSS file
      const linkElem = document.createElement('link');
      linkElem.rel = 'stylesheet';
      const cssUrl = (window.chrome && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('content/overlay.css')
        : (window.__PIXEL_MEASURE_CSS_PATH__ || '../content/overlay.css');
      linkElem.href = cssUrl;
      this.shadowRoot.appendChild(linkElem);

      // Main container
      const container = document.createElement('div');
      container.className = `pm-overlay-container mode-${this.mode}`;
      container.id = 'pm-container';

      container.innerHTML = `
        <!-- Corner Origin Block -->
        <div class="pm-ruler-corner">px</div>

        <!-- Edge Rulers -->
        <div class="pm-ruler-edge-h" id="pm-ruler-h">
          <canvas class="pm-ruler-canvas" id="pm-canvas-h"></canvas>
          <div class="pm-ruler-indicator-h" id="pm-ind-h"></div>
        </div>
        <div class="pm-ruler-edge-v" id="pm-ruler-v">
          <canvas class="pm-ruler-canvas" id="pm-canvas-v"></canvas>
          <div class="pm-ruler-indicator-v" id="pm-ind-v"></div>
        </div>

        <!-- Crosshair Guidelines -->
        <div class="pm-crosshair-h" id="pm-crosshair-h"></div>
        <div class="pm-crosshair-v" id="pm-crosshair-v"></div>

        <!-- Cursor Coordinates Badge -->
        <div class="pm-cursor-badge" id="pm-cursor-badge">
          <span><span class="coord-val" id="pm-coord-x">0</span>, <span class="coord-val" id="pm-coord-y">0</span></span>
          <span class="coord-delta" id="pm-coord-delta" style="display:none;"></span>
        </div>

        <!-- Origin Pin Marker -->
        <div class="pm-origin-pin" id="pm-origin-pin" style="display: none;"></div>

        <!-- Dynamic SVG measurement layer -->
        <svg class="pm-svg-canvas" id="pm-svg" xmlns="http://www.w3.org/2000/svg"></svg>

        <!-- Dynamic HTML measurement elements container -->
        <div id="pm-interactive-layer"></div>

        <!-- Toast Feedback -->
        <div class="pm-toast" id="pm-toast">
          <span id="pm-toast-msg">Copied</span>
        </div>

        <!-- Minimalist Floating HUD (32px Height) -->
        <div class="pm-hud" id="pm-hud">
          <div class="pm-hud-drag-handle" id="pm-hud-drag" title="Drag">
            <svg width="6" height="12" viewBox="0 0 6 12" fill="currentColor">
              <circle cx="1.5" cy="2" r="1"></circle>
              <circle cx="4.5" cy="2" r="1"></circle>
              <circle cx="1.5" cy="6" r="1"></circle>
              <circle cx="4.5" cy="6" r="1"></circle>
              <circle cx="1.5" cy="10" r="1"></circle>
              <circle cx="4.5" cy="10" r="1"></circle>
            </svg>
          </div>

          <div class="pm-hud-modes">
            <button class="pm-hud-btn ${this.mode === 'box' ? 'active' : ''}" data-mode="box" id="btn-mode-box">Box</button>
            <button class="pm-hud-btn ${this.mode === 'line' ? 'active' : ''}" data-mode="line" id="btn-mode-line">Line</button>
            <button class="pm-hud-btn ${this.mode === 'element' ? 'active' : ''}" data-mode="element" id="btn-mode-element">Element</button>
            <button class="pm-hud-btn ${this.mode === 'crosshair' ? 'active' : ''}" data-mode="crosshair" id="btn-mode-crosshair">Point</button>
          </div>

          <div class="pm-hud-divider"></div>

          <div class="pm-hud-readout">
            <span class="val" id="pm-hud-val-x">0</span>, <span class="val" id="pm-hud-val-y">0</span>
          </div>

          <div class="pm-hud-divider"></div>

          <div class="pm-hud-actions">
            <button class="pm-action-btn" id="pm-btn-origin" title="Pin Origin (O)">Pin</button>
            <button class="pm-action-btn" id="pm-btn-copy" title="Copy Specs (C)">Copy</button>
            <button class="pm-action-btn" id="pm-btn-clear" title="Clear (Del)">Clear</button>
            <button class="pm-action-btn btn-close" id="pm-btn-close" title="Close (Esc)">✕</button>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(container);
      document.documentElement.appendChild(this.hostElement);

      this.initDomReferences();
      this.initRulers();
      this.initHudDragging();
      this.initHudControls();
    }

    // Cache DOM references and create persistent element pools to eliminate GC churn
    initDomReferences() {
      const root = this.shadowRoot;
      const svg = root.getElementById('pm-svg');
      const layer = root.getElementById('pm-interactive-layer');

      // 1. Persistent Box DOM Pool
      const boxEl = document.createElement('div');
      boxEl.className = 'pm-box active';
      boxEl.style.display = 'none';

      const handles = ['tl', 'tr', 'br', 'bl'];
      handles.forEach(h => {
        const handle = document.createElement('div');
        handle.className = `pm-handle ${h}`;
        handle.dataset.handle = h;
        boxEl.appendChild(handle);
      });

      const boxPill = document.createElement('div');
      boxPill.className = 'pm-dimension-pill pill-top';
      const boxPillText = document.createTextNode('0 × 0');
      boxPill.appendChild(boxPillText);
      const pillUnit = document.createElement('span');
      pillUnit.className = 'unit';
      pillUnit.textContent = 'px';
      boxPill.appendChild(pillUnit);
      boxEl.appendChild(boxPill);
      layer.appendChild(boxEl);

      // 2. Persistent Line SVG/DOM Pool
      const svgNS = 'http://www.w3.org/2000/svg';
      const svgLine = document.createElementNS(svgNS, 'line');
      svgLine.setAttribute('stroke', '#0ea5e9');
      svgLine.setAttribute('stroke-width', '1.2');
      svgLine.style.display = 'none';
      svg.appendChild(svgLine);

      const createDot = () => {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', '#ffffff');
        dot.setAttribute('stroke', '#0284c7');
        dot.setAttribute('stroke-width', '1');
        dot.style.display = 'none';
        svg.appendChild(dot);
        return dot;
      };
      const svgDot1 = createDot();
      const svgDot2 = createDot();

      const lineBadge = document.createElement('div');
      lineBadge.className = 'pm-line-badge';
      lineBadge.style.display = 'none';
      const lineDistSpan = document.createElement('span');
      const lineBadgeDist = document.createTextNode('0 px');
      lineDistSpan.appendChild(lineBadgeDist);
      const lineBadgeSub = document.createElement('span');
      lineBadgeSub.className = 'sub-stats';
      lineBadge.appendChild(lineDistSpan);
      lineBadge.appendChild(lineBadgeSub);
      layer.appendChild(lineBadge);

      // 3. Persistent Element Mode DOM Pool
      const elementHighlight1 = document.createElement('div');
      elementHighlight1.className = 'pm-element-highlight';
      elementHighlight1.style.display = 'none';
      const elementTag1 = document.createElement('div');
      elementTag1.className = 'pm-element-tag';
      elementHighlight1.appendChild(elementTag1);
      layer.appendChild(elementHighlight1);

      const elementHighlight2 = document.createElement('div');
      elementHighlight2.className = 'pm-element-highlight';
      elementHighlight2.style.borderColor = '#38bdf8';
      elementHighlight2.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
      elementHighlight2.style.display = 'none';
      layer.appendChild(elementHighlight2);

      // Pool of 4 laser guide lines and 4 badges
      const laserGuidePool = [];
      const laserBadgePool = [];
      for (let i = 0; i < 4; i++) {
        const l = document.createElementNS(svgNS, 'line');
        l.setAttribute('stroke', '#10b981');
        l.setAttribute('stroke-width', '1.5');
        l.setAttribute('stroke-dasharray', '3 3');
        l.style.display = 'none';
        svg.appendChild(l);
        laserGuidePool.push(l);

        const b = document.createElement('div');
        b.className = 'pm-guide-badge';
        b.style.display = 'none';
        layer.appendChild(b);
        laserBadgePool.push(b);
      }

      this.dom = {
        container: root.getElementById('pm-container'),
        canvasH: root.getElementById('pm-canvas-h'),
        canvasV: root.getElementById('pm-canvas-v'),
        indH: root.getElementById('pm-ind-h'),
        indV: root.getElementById('pm-ind-v'),
        crosshairH: root.getElementById('pm-crosshair-h'),
        crosshairV: root.getElementById('pm-crosshair-v'),
        cursorBadge: root.getElementById('pm-cursor-badge'),
        coordX: root.getElementById('pm-coord-x'),
        coordY: root.getElementById('pm-coord-y'),
        coordDelta: root.getElementById('pm-coord-delta'),
        originPin: root.getElementById('pm-origin-pin'),
        svg,
        layer,
        toast: root.getElementById('pm-toast'),
        toastMsg: root.getElementById('pm-toast-msg'),
        hud: root.getElementById('pm-hud'),
        hudDrag: root.getElementById('pm-hud-drag'),
        hudValX: root.getElementById('pm-hud-val-x'),
        hudValY: root.getElementById('pm-hud-val-y'),
        modeBtns: root.querySelectorAll('.pm-hud-btn'),
        // Box
        boxEl,
        boxPill,
        boxPillText,
        // Line
        svgLine,
        svgDot1,
        svgDot2,
        lineBadge,
        lineBadgeDist,
        lineBadgeSub,
        // Element
        elementHighlight1,
        elementTag1,
        elementHighlight2,
        laserGuidePool,
        laserBadgePool
      };
    }

    removeOverlay() {
      // Cancel active animation frames
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.resizeRaf) {
        cancelAnimationFrame(this.resizeRaf);
        this.resizeRaf = null;
      }
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }

      // Cleanup HUD drag window listeners if still attached
      if (this.handleHudMouseMove) {
        window.removeEventListener('mousemove', this.handleHudMouseMove, true);
        this.handleHudMouseMove = null;
      }
      if (this.handleHudMouseUp) {
        window.removeEventListener('mouseup', this.handleHudMouseUp, true);
        this.handleHudMouseUp = null;
      }

      if (this.hostElement && this.hostElement.parentNode) {
        this.hostElement.parentNode.removeChild(this.hostElement);
      }
      this.hostElement = null;
      this.shadowRoot = null;
      this.dom = null;
      this.currentBox = null;
      this.currentLine = null;
      this.originPin = null;
      this.lockedElement = null;
      this.hoveredElement = null;
      this.lastInspectedX = -1;
      this.lastInspectedY = -1;
    }

    attachEvents() {
      window.addEventListener('mousemove', this.handleMouseMove, true);
      window.addEventListener('mousedown', this.handleMouseDown, true);
      window.addEventListener('mouseup', this.handleMouseUp, true);
      window.addEventListener('keydown', this.handleKeyDown, true);
      window.addEventListener('resize', this.handleWindowResize, true);
    }

    detachEvents() {
      window.removeEventListener('mousemove', this.handleMouseMove, true);
      window.removeEventListener('mousedown', this.handleMouseDown, true);
      window.removeEventListener('mouseup', this.handleMouseUp, true);
      window.removeEventListener('keydown', this.handleKeyDown, true);
      window.removeEventListener('resize', this.handleWindowResize, true);
    }

    // Initialize Edge Rulers with batched path draws
    initRulers() {
      if (!this.dom) return;
      const { canvasH, canvasV } = this.dom;
      if (!canvasH || !canvasV) return;

      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth - RULER_SIZE;
      const height = window.innerHeight - RULER_SIZE;

      // 1. Horizontal ruler
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(RULER_SIZE * dpr);
      if (canvasH.width !== targetW || canvasH.height !== targetH) {
        canvasH.width = targetW;
        canvasH.height = targetH;
      }

      const ctxH = canvasH.getContext('2d', { alpha: true });
      ctxH.setTransform(dpr, 0, 0, dpr, 0.5, 0.5);
      ctxH.clearRect(-0.5, -0.5, width + 1, RULER_SIZE + 1);
      ctxH.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctxH.lineWidth = 1;

      // Minor ticks (every 10px, except 50s and 100s)
      ctxH.beginPath();
      for (let screenX = 0; screenX <= window.innerWidth; screenX += 10) {
        if (screenX % 50 !== 0) {
          const x = screenX - RULER_SIZE;
          if (x >= 0) {
            ctxH.moveTo(x, 18);
            ctxH.lineTo(x, 23);
          }
        }
      }
      ctxH.strokeStyle = '#3f3f46';
      ctxH.stroke();

      // Medium ticks (every 50px, except 100s)
      ctxH.beginPath();
      for (let screenX = 50; screenX <= window.innerWidth; screenX += 100) {
        const x = screenX - RULER_SIZE;
        if (x >= 0) {
          ctxH.moveTo(x, 14);
          ctxH.lineTo(x, 23);
        }
      }
      ctxH.strokeStyle = '#52525b';
      ctxH.stroke();

      // Major ticks (every 100px)
      ctxH.beginPath();
      for (let screenX = 100; screenX <= window.innerWidth; screenX += 100) {
        const x = screenX - RULER_SIZE;
        if (x >= 0) {
          ctxH.moveTo(x, 9);
          ctxH.lineTo(x, 23);
        }
      }
      ctxH.strokeStyle = '#71717a';
      ctxH.stroke();

      // Labels (every 100px) - Bold, bright, crystal-clear white
      ctxH.fillStyle = '#ffffff';
      for (let screenX = 100; screenX <= window.innerWidth; screenX += 100) {
        const x = screenX - RULER_SIZE;
        if (x >= 0) {
          ctxH.fillText(screenX.toString(), x + 3, 11);
        }
      }

      // 2. Vertical ruler
      const targetVW = Math.round(RULER_SIZE * dpr);
      const targetVH = Math.round(height * dpr);
      if (canvasV.width !== targetVW || canvasV.height !== targetVH) {
        canvasV.width = targetVW;
        canvasV.height = targetVH;
      }

      const ctxV = canvasV.getContext('2d', { alpha: true });
      ctxV.setTransform(dpr, 0, 0, dpr, 0.5, 0.5);
      ctxV.clearRect(-0.5, -0.5, RULER_SIZE + 1, height + 1);
      ctxV.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctxV.lineWidth = 1;

      // Minor ticks
      ctxV.beginPath();
      for (let screenY = 0; screenY <= window.innerHeight; screenY += 10) {
        if (screenY % 50 !== 0) {
          const y = screenY - RULER_SIZE;
          if (y >= 0) {
            ctxV.moveTo(18, y);
            ctxV.lineTo(23, y);
          }
        }
      }
      ctxV.strokeStyle = '#3f3f46';
      ctxV.stroke();

      // Medium ticks
      ctxV.beginPath();
      for (let screenY = 50; screenY <= window.innerHeight; screenY += 100) {
        const y = screenY - RULER_SIZE;
        if (y >= 0) {
          ctxV.moveTo(14, y);
          ctxV.lineTo(23, y);
        }
      }
      ctxV.strokeStyle = '#52525b';
      ctxV.stroke();

      // Major ticks
      ctxV.beginPath();
      for (let screenY = 100; screenY <= window.innerHeight; screenY += 100) {
        const y = screenY - RULER_SIZE;
        if (y >= 0) {
          ctxV.moveTo(9, y);
          ctxV.lineTo(23, y);
        }
      }
      ctxV.strokeStyle = '#71717a';
      ctxV.stroke();

      // Labels (rotated, every 100px) - Bold, bright, crystal-clear white
      ctxV.fillStyle = '#ffffff';
      for (let screenY = 100; screenY <= window.innerHeight; screenY += 100) {
        const y = screenY - RULER_SIZE;
        if (y >= 0) {
          ctxV.save();
          ctxV.translate(10, y + 3);
          ctxV.rotate(Math.PI / 2);
          ctxV.fillText(screenY.toString(), 0, 0);
          ctxV.restore();
        }
      }
    }

    // Throttled window resize via requestAnimationFrame
    handleWindowResize() {
      if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = null;
        this.initRulers();
        this.needsRender = true;
        this.scheduleFrame();
      });
    }

    // Draggable HUD functionality with leak-free listener lifecycles
    initHudDragging() {
      if (!this.dom) return;
      const { hud, hudDrag } = this.dom;
      if (!hud || !hudDrag) return;

      let isDraggingHud = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

      this.handleHudMouseMove = (e) => {
        if (!isDraggingHud) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxLeft = window.innerWidth - hud.offsetWidth - 10;
        const maxTop = window.innerHeight - hud.offsetHeight - 10;
        hud.style.left = `${Math.max(10, Math.min(maxLeft, initialLeft + dx))}px`;
        hud.style.top = `${Math.max(25, Math.min(maxTop, initialTop + dy))}px`;
      };

      this.handleHudMouseUp = () => {
        if (!isDraggingHud) return;
        isDraggingHud = false;
        window.removeEventListener('mousemove', this.handleHudMouseMove, true);
        window.removeEventListener('mouseup', this.handleHudMouseUp, true);
      };

      this.handleHudMouseDown = (e) => {
        isDraggingHud = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = hud.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        hud.style.left = `${initialLeft}px`;
        hud.style.top = `${initialTop}px`;
        hud.style.bottom = 'auto';
        hud.style.transform = 'none';
        e.stopPropagation();

        window.addEventListener('mousemove', this.handleHudMouseMove, true);
        window.addEventListener('mouseup', this.handleHudMouseUp, true);
      };

      hudDrag.addEventListener('mousedown', this.handleHudMouseDown);
    }

    initHudControls() {
      const root = this.shadowRoot;
      if (!root) return;

      // Mode switch buttons
      const modeBtns = root.querySelectorAll('.pm-hud-btn');
      modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setMode(btn.dataset.mode);
        });
      });

      // Actions
      root.getElementById('pm-btn-origin').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleOriginPin();
      });

      root.getElementById('pm-btn-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyMeasurement();
      });

      root.getElementById('pm-btn-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        this.clear();
      });

      root.getElementById('pm-btn-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deactivate();
      });
    }

    setMode(newMode) {
      if (this.mode === newMode) return;
      this.mode = newMode;

      if (this.dom) {
        this.dom.container.className = `pm-overlay-container mode-${this.mode}`;
        this.dom.modeBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === newMode);
        });
      }

      this.showToast(`Mode: ${newMode.toUpperCase()}`);
      this.needsRender = true;
      this.scheduleFrame();
      this.notifyState();
    }

    toggleOriginPin() {
      if (!this.dom) return;
      const { originPin, coordDelta } = this.dom;

      if (this.originPin) {
        this.originPin = null;
        originPin.style.display = 'none';
        coordDelta.style.display = 'none';
        this.showToast('Origin Reset');
      } else {
        this.originPin = { x: this.cursor.x, y: this.cursor.y };
        originPin.style.display = 'block';
        originPin.style.transform = `translate3d(${this.originPin.x}px, ${this.originPin.y}px, 0)`;
        this.showToast(`Pinned Origin at (${this.originPin.x}, ${this.originPin.y})`);
      }
      this.updateCursorBadge();
    }

    // Keyboard handlers
    handleKeyDown(e) {
      if (!this.isActive) return;

      // Close on Escape
      if (e.key === 'Escape') {
        if (this.currentBox || this.currentLine || this.lockedElement) {
          this.clear();
        } else {
          this.deactivate();
        }
        e.preventDefault();
        return;
      }

      // Mode Shortcuts (1, 2, 3, 4)
      if (e.key === '1') { this.setMode('box'); e.preventDefault(); }
      else if (e.key === '2') { this.setMode('line'); e.preventDefault(); }
      else if (e.key === '3') { this.setMode('element'); e.preventDefault(); }
      else if (e.key === '4') { this.setMode('crosshair'); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'o') { this.toggleOriginPin(); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) { this.copyMeasurement(); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { this.clear(); e.preventDefault(); }

      // Nudge active measurement box with arrow keys
      if (this.currentBox && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const step = e.shiftKey ? 10 : 1;
        if (e.altKey) {
          // Resize box
          if (e.key === 'ArrowRight') this.currentBox.w = Math.max(1, this.currentBox.w + step);
          if (e.key === 'ArrowLeft') this.currentBox.w = Math.max(1, this.currentBox.w - step);
          if (e.key === 'ArrowDown') this.currentBox.h = Math.max(1, this.currentBox.h + step);
          if (e.key === 'ArrowUp') this.currentBox.h = Math.max(1, this.currentBox.h - step);
        } else {
          // Move box
          if (e.key === 'ArrowRight') this.currentBox.x += step;
          if (e.key === 'ArrowLeft') this.currentBox.x -= step;
          if (e.key === 'ArrowDown') this.currentBox.y += step;
          if (e.key === 'ArrowUp') this.currentBox.y -= step;
        }
        this.needsRender = true;
        this.scheduleFrame();
        e.preventDefault();
      }
    }

    // Mouse Move: Lightweight tracking with deferred rAF rendering
    handleMouseMove(e) {
      if (!this.isActive) return;

      this.cursor.x = Math.round(e.clientX);
      this.cursor.y = Math.round(e.clientY);
      this.cursor.pageX = Math.round(e.pageX);
      this.cursor.pageY = Math.round(e.pageY);

      // Handle drawing or resizing box
      if (this.isDrawingBox) {
        const x = Math.min(this.boxStart.x, this.cursor.x);
        const y = Math.min(this.boxStart.y, this.cursor.y);
        const w = Math.abs(this.cursor.x - this.boxStart.x);
        const h = Math.abs(this.cursor.y - this.boxStart.y);
        this.currentBox = { x, y, w, h };
        this.needsRender = true;
      } else if (this.isDraggingBox && this.currentBox) {
        this.currentBox.x = this.cursor.x - this.dragOffset.x;
        this.currentBox.y = this.cursor.y - this.dragOffset.y;
        this.needsRender = true;
      } else if (this.isResizingBox && this.currentBox && this.activeHandle) {
        this.resizeBoxWithHandle(this.activeHandle, this.cursor.x, this.cursor.y);
        this.needsRender = true;
      } else if (this.isDrawingLine && this.lineStart) {
        this.currentLine = {
          x1: this.lineStart.x,
          y1: this.lineStart.y,
          x2: this.cursor.x,
          y2: this.cursor.y
        };
        this.needsRender = true;
      }

      this.scheduleFrame();
    }

    // Schedule frame rendering on monitor refresh
    scheduleFrame() {
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(this.onAnimationFrame);
      }
    }

    onAnimationFrame() {
      this.rafId = null;
      if (!this.isActive || !this.dom) return;

      this.updateCrosshair();
      this.updateCursorBadge();
      this.updateHudReadout();

      if (this.mode === 'element') {
        this.inspectElementUnderCursor(this.cursor.x, this.cursor.y);
      }

      if (this.needsRender) {
        this.needsRender = false;
        this.render();
      }
    }

    // Resize box using handles
    resizeBoxWithHandle(handle, mx, my) {
      const b = this.currentBox;
      const right = b.x + b.w;
      const bottom = b.y + b.h;

      if (handle === 'tl') {
        b.w = Math.max(2, right - mx);
        b.h = Math.max(2, bottom - my);
        b.x = right - b.w;
        b.y = bottom - b.h;
      } else if (handle === 'tr') {
        b.w = Math.max(2, mx - b.x);
        b.h = Math.max(2, bottom - my);
        b.y = bottom - b.h;
      } else if (handle === 'br') {
        b.w = Math.max(2, mx - b.x);
        b.h = Math.max(2, my - b.y);
      } else if (handle === 'bl') {
        b.w = Math.max(2, right - mx);
        b.h = Math.max(2, my - b.y);
        b.x = right - b.w;
      }
    }

    // Inspect underlying page element without style invalidation
    inspectElementUnderCursor(clientX, clientY) {
      if (Math.abs(clientX - this.lastInspectedX) < 2 && Math.abs(clientY - this.lastInspectedY) < 2) {
        return;
      }
      this.lastInspectedX = clientX;
      this.lastInspectedY = clientY;

      const elements = document.elementsFromPoint(clientX, clientY);
      if (!elements || elements.length === 0) return;

      const target = elements.find(el =>
        el !== this.hostElement &&
        !this.hostElement.contains(el) &&
        el !== document.documentElement &&
        el !== document.body
      );

      if (target && target !== this.hoveredElement) {
        this.hoveredElement = target;
        this.renderElementGuides();
      }
    }

    // Mouse Down
    handleMouseDown(e) {
      if (!this.isActive || !this.dom) return;

      this.cursor.x = Math.round(e.clientX);
      this.cursor.y = Math.round(e.clientY);
      this.cursor.pageX = Math.round(e.pageX);
      this.cursor.pageY = Math.round(e.pageY);

      // Allow clicks inside HUD
      if (this.dom.hud && (e.target instanceof Node) && this.dom.hud.contains(e.target)) return;

      // Element mode lock
      if (this.mode === 'element') {
        if (this.hoveredElement) {
          if (this.lockedElement === this.hoveredElement) {
            this.lockedElement = null;
            this.showToast('Unlocked Element');
          } else {
            this.lockedElement = this.hoveredElement;
            this.showToast(`Locked: <${this.lockedElement.tagName.toLowerCase()}>`);
          }
          this.renderElementGuides();
        }
        return;
      }

      // Crosshair mode origin toggle
      if (this.mode === 'crosshair') {
        this.toggleOriginPin();
        return;
      }

      // Line mode
      if (this.mode === 'line') {
        this.isDrawingLine = true;
        this.lineStart = { x: this.cursor.x, y: this.cursor.y };
        this.currentLine = {
          x1: this.lineStart.x,
          y1: this.lineStart.y,
          x2: this.cursor.x,
          y2: this.cursor.y
        };
        this.needsRender = true;
        this.scheduleFrame();
        return;
      }

      // Box mode
      if (this.mode === 'box') {
        if (e.target && e.target.classList && e.target.classList.contains('pm-handle')) {
          this.isResizingBox = true;
          this.activeHandle = e.target.dataset.handle;
          e.stopPropagation();
          return;
        }

        if (this.currentBox &&
            this.cursor.x >= this.currentBox.x && this.cursor.x <= this.currentBox.x + this.currentBox.w &&
            this.cursor.y >= this.currentBox.y && this.cursor.y <= this.currentBox.y + this.currentBox.h) {
          this.isDraggingBox = true;
          this.dragOffset = {
            x: this.cursor.x - this.currentBox.x,
            y: this.cursor.y - this.currentBox.y
          };
          e.stopPropagation();
          return;
        }

        // Start drawing new box
        this.isDrawingBox = true;
        this.boxStart = { x: this.cursor.x, y: this.cursor.y };
        this.currentBox = { x: this.cursor.x, y: this.cursor.y, w: 0, h: 0 };
        this.needsRender = true;
        this.scheduleFrame();
      }
    }

    // Mouse Up
    handleMouseUp(e) {
      if (!this.isActive) return;

      if (e) {
        this.cursor.x = Math.round(e.clientX);
        this.cursor.y = Math.round(e.clientY);
        this.cursor.pageX = Math.round(e.pageX);
        this.cursor.pageY = Math.round(e.pageY);
      }

      if (this.isDrawingBox) {
        this.isDrawingBox = false;
        if (this.currentBox && (this.currentBox.w < 3 || this.currentBox.h < 3)) {
          this.currentBox = null;
        }
        this.needsRender = true;
        this.scheduleFrame();
      }

      if (this.isDraggingBox) {
        this.isDraggingBox = false;
      }

      if (this.isResizingBox) {
        this.isResizingBox = false;
        this.activeHandle = null;
      }

      if (this.isDrawingLine) {
        this.isDrawingLine = false;
        if (this.currentLine) {
          const dist = Math.hypot(this.currentLine.x2 - this.currentLine.x1, this.currentLine.y2 - this.currentLine.y1);
          if (dist < 3) {
            this.currentLine = null;
          }
        }
        this.needsRender = true;
        this.scheduleFrame();
      }
    }

    // GPU-accelerated crosshair and ruler indicators
    updateCrosshair() {
      if (!this.dom) return;
      const { crosshairH, crosshairV, indH, indV } = this.dom;

      crosshairH.style.transform = `translate3d(0, ${this.cursor.y}px, 0)`;
      crosshairV.style.transform = `translate3d(${this.cursor.x}px, 0, 0)`;

      if (this.cursor.x >= RULER_SIZE) {
        indH.style.transform = `translate3d(${this.cursor.x - RULER_SIZE}px, 0, 0)`;
      }
      if (this.cursor.y >= RULER_SIZE) {
        indV.style.transform = `translate3d(0, ${this.cursor.y - RULER_SIZE}px, 0)`;
      }
    }

    // GPU-accelerated cursor badge
    updateCursorBadge() {
      if (!this.dom) return;
      const { cursorBadge, coordX, coordY, coordDelta } = this.dom;

      coordX.textContent = `${this.cursor.x}`;
      coordY.textContent = `${this.cursor.y}`;

      const badgeX = this.cursor.x + 18 > window.innerWidth - 220 ? this.cursor.x - 210 : this.cursor.x + 18;
      const badgeY = this.cursor.y + 18 > window.innerHeight - 50 ? this.cursor.y - 42 : this.cursor.y + 18;
      cursorBadge.style.transform = `translate3d(${badgeX}px, ${badgeY}px, 0)`;

      if (this.originPin) {
        const dx = this.cursor.x - this.originPin.x;
        const dy = this.cursor.y - this.originPin.y;
        const dist = Math.hypot(dx, dy).toFixed(1);
        coordDelta.style.display = 'inline';
        coordDelta.textContent = `Δ (${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy}) · ${dist}px`;
      } else {
        coordDelta.style.display = 'none';
      }
    }

    updateHudReadout() {
      if (!this.dom) return;
      this.dom.hudValX.textContent = `${this.cursor.x}`;
      this.dom.hudValY.textContent = `${this.cursor.y}`;
    }

    // Main render router
    render() {
      if (!this.dom) return;

      if (this.mode === 'box') {
        this.renderBox();
        this.hideLineElements();
        this.hideElementGuideElements();
      } else if (this.mode === 'line') {
        this.renderLine();
        this.hideBoxElements();
        this.hideElementGuideElements();
      } else if (this.mode === 'element') {
        this.renderElementGuides();
        this.hideBoxElements();
        this.hideLineElements();
      } else {
        this.hideBoxElements();
        this.hideLineElements();
        this.hideElementGuideElements();
      }
    }

    // High performance box rendering via persistent element recycling
    renderBox() {
      const b = this.currentBox;
      const { boxEl, boxPill, boxPillText } = this.dom;
      if (!b || b.w < 1 || b.h < 1) {
        boxEl.style.display = 'none';
        return;
      }

      boxEl.style.display = 'block';
      boxEl.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
      boxEl.style.width = `${b.w}px`;
      boxEl.style.height = `${b.h}px`;

      boxPillText.nodeValue = `${b.w} × ${b.h}`;
      if (b.y < 30) {
        boxPill.className = 'pm-dimension-pill pill-bottom';
      } else {
        boxPill.className = 'pm-dimension-pill pill-top';
      }
    }

    hideBoxElements() {
      if (this.dom && this.dom.boxEl) {
        this.dom.boxEl.style.display = 'none';
      }
    }

    // High performance straight line rendering via persistent SVG/DOM recycling
    renderLine() {
      const l = this.currentLine;
      const { svgLine, svgDot1, svgDot2, lineBadge, lineBadgeDist, lineBadgeSub } = this.dom;
      if (!l) {
        this.hideLineElements();
        return;
      }

      const dx = l.x2 - l.x1;
      const dy = l.y2 - l.y1;
      const dist = Math.hypot(dx, dy);
      const midX = (l.x1 + l.x2) / 2;
      const midY = (l.y1 + l.y2) / 2;

      svgLine.setAttribute('x1', l.x1);
      svgLine.setAttribute('y1', l.y1);
      svgLine.setAttribute('x2', l.x2);
      svgLine.setAttribute('y2', l.y2);
      svgLine.style.display = '';

      svgDot1.setAttribute('cx', l.x1);
      svgDot1.setAttribute('cy', l.y1);
      svgDot1.style.display = '';

      svgDot2.setAttribute('cx', l.x2);
      svgDot2.setAttribute('cy', l.y2);
      svgDot2.style.display = '';

      lineBadgeDist.nodeValue = `${dist.toFixed(1)} px`;
      lineBadgeSub.textContent = `Δx ${Math.abs(dx)} · Δy ${Math.abs(dy)}`;
      lineBadge.style.transform = `translate3d(${midX}px, ${midY}px, 0) translate(-50%, -50%)`;
      lineBadge.style.display = 'flex';
    }

    hideLineElements() {
      if (!this.dom) return;
      const { svgLine, svgDot1, svgDot2, lineBadge } = this.dom;
      svgLine.style.display = 'none';
      svgDot1.style.display = 'none';
      svgDot2.style.display = 'none';
      lineBadge.style.display = 'none';
    }

    // High performance element guides rendering via object pooling
    renderElementGuides() {
      if (!this.dom) return;
      const { elementHighlight1, elementTag1, elementHighlight2, laserGuidePool, laserBadgePool } = this.dom;

      const target = this.lockedElement || this.hoveredElement;
      if (!target) {
        this.hideElementGuideElements();
        return;
      }

      const rect = target.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Element 1 highlight
      elementHighlight1.style.display = 'block';
      elementHighlight1.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      elementHighlight1.style.width = `${rect.width}px`;
      elementHighlight1.style.height = `${rect.height}px`;

      const classStr = target.className && typeof target.className === 'string' ? '.' + target.className.trim().split(/\s+/)[0] : '';
      elementTag1.textContent = `${target.tagName.toLowerCase()}${classStr} (${Math.round(rect.width)} × ${Math.round(rect.height)}px)`;

      // Guide pooling helper
      let guideIndex = 0;
      const applyGuide = (x1, y1, x2, y2, val, labelX, labelY) => {
        if (guideIndex >= laserGuidePool.length) return;
        const line = laserGuidePool[guideIndex];
        const badge = laserBadgePool[guideIndex];

        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.style.display = '';

        badge.style.transform = `translate3d(${labelX}px, ${labelY}px, 0) translate(-50%, -50%)`;
        badge.textContent = `${Math.round(val)}px`;
        badge.style.display = 'block';

        guideIndex++;
      };

      // Gap between locked and hovered elements
      if (this.lockedElement && this.hoveredElement && this.lockedElement !== this.hoveredElement) {
        const r1 = this.lockedElement.getBoundingClientRect();
        const r2 = this.hoveredElement.getBoundingClientRect();

        elementHighlight2.style.display = 'block';
        elementHighlight2.style.transform = `translate3d(${r2.left}px, ${r2.top}px, 0)`;
        elementHighlight2.style.width = `${r2.width}px`;
        elementHighlight2.style.height = `${r2.height}px`;

        if (r2.left > r1.right) {
          const gap = r2.left - r1.right;
          applyGuide(r1.right, (r1.top + r1.bottom) / 2, r2.left, (r1.top + r1.bottom) / 2, gap, r1.right + gap / 2, (r1.top + r1.bottom) / 2);
        } else if (r1.left > r2.right) {
          const gap = r1.left - r2.right;
          applyGuide(r2.right, (r2.top + r2.bottom) / 2, r1.left, (r2.top + r2.bottom) / 2, gap, r2.right + gap / 2, (r2.top + r2.bottom) / 2);
        }

        if (r2.top > r1.bottom) {
          const gap = r2.top - r1.bottom;
          applyGuide((r1.left + r1.right) / 2, r1.bottom, (r1.left + r1.right) / 2, r2.top, gap, (r1.left + r1.right) / 2, r1.bottom + gap / 2);
        } else if (r1.top > r2.bottom) {
          const gap = r1.top - r2.bottom;
          applyGuide((r2.left + r2.right) / 2, r2.bottom, (r2.left + r2.right) / 2, r1.top, gap, (r2.left + r2.right) / 2, r2.bottom + gap / 2);
        }
      } else {
        elementHighlight2.style.display = 'none';

        const midX = rect.left + rect.width / 2;
        const midY = rect.top + rect.height / 2;

        if (rect.top > 0) {
          applyGuide(midX, rect.top, midX, RULER_SIZE, rect.top - RULER_SIZE, midX, (rect.top + RULER_SIZE) / 2);
        }
        if (vh - rect.bottom > 0) {
          applyGuide(midX, rect.bottom, midX, vh, vh - rect.bottom, midX, rect.bottom + (vh - rect.bottom) / 2);
        }
        if (rect.left > 0) {
          applyGuide(rect.left, midY, RULER_SIZE, midY, rect.left - RULER_SIZE, (rect.left + RULER_SIZE) / 2, midY);
        }
        if (vw - rect.right > 0) {
          applyGuide(rect.right, midY, vw, midY, vw - rect.right, rect.right + (vw - rect.right) / 2, midY);
        }
      }

      // Hide remaining pooled guides
      for (let i = guideIndex; i < laserGuidePool.length; i++) {
        laserGuidePool[i].style.display = 'none';
        laserBadgePool[i].style.display = 'none';
      }
    }

    hideElementGuideElements() {
      if (!this.dom) return;
      const { elementHighlight1, elementHighlight2, laserGuidePool, laserBadgePool } = this.dom;
      elementHighlight1.style.display = 'none';
      elementHighlight2.style.display = 'none';
      for (let i = 0; i < laserGuidePool.length; i++) {
        laserGuidePool[i].style.display = 'none';
        laserBadgePool[i].style.display = 'none';
      }
    }

    // Clear active measurements
    clear() {
      this.currentBox = null;
      this.currentLine = null;
      this.lockedElement = null;
      this.hoveredElement = null;
      this.render();
      this.showToast('Cleared Measurements');
    }

    // Copy measurements to clipboard
    copyMeasurement() {
      let text = '';
      if (this.currentBox) {
        const b = this.currentBox;
        const diag = Math.hypot(b.w, b.h).toFixed(1);
        text = `/* PixelMeasure Dimensions */\nwidth: ${b.w}px;\nheight: ${b.h}px;\ntop: ${b.y}px;\nleft: ${b.x}px;\ndiagonal: ${diag}px;\nstart: (${b.x}, ${b.y});\nend: (${b.x + b.w}, ${b.y + b.h});`;
      } else if (this.currentLine) {
        const l = this.currentLine;
        const dist = Math.hypot(l.x2 - l.x1, l.y2 - l.y1).toFixed(1);
        text = `/* PixelMeasure 2-Point Distance */\ndistance: ${dist}px;\nfrom: (${l.x1}, ${l.y1});\nto: (${l.x2}, ${l.y2});\ndeltaX: ${Math.abs(l.x2 - l.x1)}px;\ndeltaY: ${Math.abs(l.y2 - l.y1)}px;`;
      } else if (this.hoveredElement || this.lockedElement) {
        const target = this.lockedElement || this.hoveredElement;
        const r = target.getBoundingClientRect();
        text = `/* PixelMeasure Element Spec */\ntag: <${target.tagName.toLowerCase()}>\nwidth: ${Math.round(r.width)}px;\nheight: ${Math.round(r.height)}px;\ntop: ${Math.round(r.top)}px;\nleft: ${Math.round(r.left)}px;`;
      } else {
        text = `X: ${this.cursor.x}px, Y: ${this.cursor.y}px (Page: ${this.cursor.pageX}px, ${this.cursor.pageY}px)`;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('Copied Specs to Clipboard!');
        }).catch(() => {
          this.fallbackCopy(text);
        });
      } else {
        this.fallbackCopy(text);
      }
    }

    fallbackCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.showToast('Copied Specs to Clipboard!');
      } catch {
        this.showToast('Copy Failed');
      }
    }

    showToast(message) {
      if (!this.dom) return;
      const { toast, toastMsg } = this.dom;
      if (toast && toastMsg) {
        toastMsg.textContent = message;
        toast.classList.add('show');
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => {
          toast.classList.remove('show');
        }, 1800);
      }
    }
  }

  // Instantiate singleton
  const controller = new PixelMeasureController();
  window.__PixelMeasureInstance = controller;

  // Listen for messages from background or popup
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TOGGLE_RULER') {
        if (request.mode && controller.mode !== request.mode) {
          controller.setMode(request.mode);
        }
        const active = controller.toggle();
        sendResponse({ active, mode: controller.mode });
        return true;
      }

      if (request.action === 'GET_STATUS') {
        sendResponse({ active: controller.isActive, mode: controller.mode });
        return true;
      }

      if (request.action === 'SET_MODE') {
        controller.setMode(request.mode);
        if (request.activateIfInactive && !controller.isActive) {
          controller.activate();
        }
        sendResponse({ success: true, active: controller.isActive, mode: controller.mode });
        return true;
      }
    });
  }
})();
