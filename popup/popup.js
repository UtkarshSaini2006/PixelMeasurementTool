// PixelMeasure - Minimalist Popup Controller
document.addEventListener('DOMContentLoaded', () => {
  const masterSwitch = document.getElementById('master-switch');
  const statusText = document.getElementById('status-text');
  const segBtns = document.querySelectorAll('.seg-btn');
  const btnOpenDemo = document.getElementById('btn-open-demo');

  let isActive = false;
  let currentMode = 'box';

  function updateStateUI(active, mode) {
    isActive = Boolean(active);
    if (mode) currentMode = mode;

    masterSwitch.checked = isActive;
    if (isActive) {
      statusText.textContent = `Active (${currentMode})`;
      statusText.classList.add('active');
    } else {
      statusText.textContent = 'Inactive';
      statusText.classList.remove('active');
    }

    segBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });
  }

  // Fetch initial tab status
  try {
    chrome.runtime.sendMessage({ action: 'GET_STATUS_FROM_POPUP' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        updateStateUI(false, 'box');
      } else {
        updateStateUI(res.active, res.mode);
      }
    });
  } catch {
    updateStateUI(false, 'box');
  }

  // Master Switch Change
  masterSwitch.addEventListener('change', () => {
    chrome.runtime.sendMessage({ action: 'TOGGLE_FROM_POPUP', mode: currentMode }, (res) => {
      if (res && res.success) {
        updateStateUI(res.active, res.mode || currentMode);
      } else if (res && res.reason === 'restricted_url') {
        masterSwitch.checked = false;
        alert('PixelMeasure cannot run on internal browser pages (chrome://). Please open a normal webpage or the demo page.');
      } else {
        masterSwitch.checked = false;
      }
    });
  });

  // Segmented Mode Switching
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      currentMode = mode;

      segBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

      chrome.runtime.sendMessage({
        action: 'SET_MODE_FROM_POPUP',
        mode,
        activateIfInactive: true
      }, (res) => {
        if (res && res.success) {
          updateStateUI(res.active, res.mode || mode);
        } else if (res && res.reason === 'restricted_url') {
          updateStateUI(false, mode);
          alert('PixelMeasure cannot run on internal browser pages (chrome://). Please open a normal webpage or the demo page.');
        } else {
          updateStateUI(true, mode);
        }
      });
    });
  });

  // Open Calibration Bench
  btnOpenDemo.addEventListener('click', () => {
    const demoUrl = chrome.runtime.getURL('test/test-page.html');
    chrome.tabs.create({ url: demoUrl });
  });
});
