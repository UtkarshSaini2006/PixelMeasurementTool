# PixelMeasure Pro 📐 — Chrome Screen Ruler & Distance Inspector

**PixelMeasure Pro** is a high-precision, pixel-perfect on-screen ruler, coordinate finder, and distance measurement Chrome extension built with Manifest V3 and isolated Shadow DOM architecture.

---

## ✨ Features

### 1. 🔲 Box Ruler Mode (`Key: 1`)
- **Bounding Box Measurement**: Click and drag across any area of the browser window.
- **Full Geometry Breakdown**:
  - Exact Width ($\Delta X$) and Height ($\Delta Y$) in pixels.
  - Euclidean Diagonal Distance ($d = \sqrt{w^2 + h^2}$).
  - Angle in degrees ($\theta$) and Aspect Ratio.
  - Start & End coordinates: $(X_1, Y_1) \to (X_2, Y_2)$.
- **8-Point Resize Handles**: Grab any handle (corners or edges) for single-pixel precision adjustments.
- **Relocate Box**: Drag inside the box to move it anywhere on the page.
- **Keyboard Nudge**:
  - `Arrow Keys`: Move box by 1px (or `Shift + Arrow` for 10px).
  - `Alt + Arrow Keys`: Resize box width/height by 1px (or `Alt + Shift + Arrow` for 10px).

### 2. 📏 2-Point Laser Line Distance (`Key: 2`)
- **Direct Point-to-Point Distance**: Measure straight-line distance between any two points on the screen.
- **Midpoint Spec Badge**: Displays direct distance ($d$), horizontal delta ($\Delta X$), vertical delta ($\Delta Y$), and angle.
- **Glowing Endpoints**: Point $A(x_1, y_1)$ and Point $B(x_2, y_2)$ labeled coordinates.

### 3. 🎯 Element Guides & Gap Inspector (`Key: 3`)
- **DOM Element Inspection**: Hover over any HTML element to display its exact bounding rectangle, tag name, class, and dimensions.
- **Perpendicular Laser Guides**: Automatically projects distance lines to all 4 edges of the viewport.
- **Element-to-Element Gap Measurement**: Click an element to **lock** onto it, then hover over any adjacent element to see the exact gap (padding/margin) between them in pixels!

### 4. ➕ Crosshair & Relative Origin Pinning (`Key: 4`)
- **Infinite Crosshair Hairlines**: Precision horizontal and vertical tracking lines across the entire window.
- **Live Coordinates Tag**: Displays real-time $(X, Y)$ client coordinates and document page coordinates.
- **Custom Relative Origin Pinning (`Key: O`)**: Click anywhere to anchor a $(0, 0)$ origin. Moving the cursor shows the relative delta: `Δ: (+ΔX, +ΔY) [Distance px]`.

### 5. 📏 Top & Left Edge Canvas Rulers
- Persistent pixel rulers along the top and left edges with tick marks at 10px, 50px, and labeled numbers at 100px.

### 6. 📋 Instant CSS & Spec Export (`Key: C`)
- Copies formatted dimensions directly to your clipboard:
  ```css
  /* PixelMeasure Dimensions */
  width: 300px;
  height: 150px;
  top: 330px;
  left: 45px;
  diagonal: 335.4px;
  start: (45, 330);
  end: (345, 480);
  ```

---

## 🚀 How to Install in Google Chrome

1. Open **Google Chrome** (or any Chromium browser like Brave, Edge, or Opera).
2. Navigate to: `chrome://extensions/`
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the project folder:
   ```
   c:\Users\saini\OneDrive\Desktop\PixelMeasurementTool
   ```
6. The **PixelMeasure Pro** extension icon will now appear in your extensions toolbar! (Pin it for quick access).

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt + M</kbd> | Toggle ruler overlay ON / OFF on the active tab |
| <kbd>1</kbd> | Switch to **Box Ruler** mode |
| <kbd>2</kbd> | Switch to **2-Point Line Distance** mode |
| <kbd>3</kbd> | Switch to **Element Guides & Gap** mode |
| <kbd>4</kbd> | Switch to **Crosshair & Origin** mode |
| <kbd>O</kbd> | Pin / Reset Origin $(0, 0)$ at cursor position |
| <kbd>C</kbd> | Copy measurement specs (CSS / Coordinates) |
| <kbd>Arrows</kbd> | Nudge active measurement box by 1px |
| <kbd>Shift + Arrows</kbd> | Nudge active measurement box by 10px |
| <kbd>Alt + Arrows</kbd> | Resize active measurement box by 1px |
| <kbd>Del</kbd> / <kbd>Backspace</kbd> | Clear current measurement |
| <kbd>Esc</kbd> | Clear measurement or close ruler |

---

## 🧪 Interactive Calibration Bench

A test bench page is included in [`test/test-page.html`](test/test-page.html).
You can open this page directly in Chrome to calibrate:
- Known **300 × 150px** and **200 × 200px** fixed boxes.
- Fixed **40px CSS gap** to test element spacing inspection.
- Classic **3-4-5 (300px × 400px → 500.0px)** Pythagorean triangle to test diagonal line distance calculation.

---

## 🛡️ Architecture & Styling

- **Manifest V3**: Compliant with the latest Google Chrome extension standards.
- **Shadow DOM Isolation**: All UI elements (HUD, crosshairs, rulers, labels) are encapsulated inside `<pixel-measure-host>` shadow root so host website styles never break or interfere with the tool.
- **Zero Heavy Dependencies**: Pure, performant vanilla JavaScript and modern CSS with GPU-accelerated transforms and glassmorphic filters.
