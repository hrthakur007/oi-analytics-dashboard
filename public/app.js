// Global App State
let refreshTimer = null;
let countdown = 60;
const REFRESH_INTERVAL_SEC = 60;
let isFetching = false;
let oiVerticalChartInstance = null;
let volumeChartInstance = null;
let currentSymbol = 'nifty'; // 'nifty' or 'sensex'
let strikeRange = 5; // ATM ± strikeRange, default is 5

// ----------------------------------------------------
// Chart Colour Palette (user-customisable)
// ----------------------------------------------------
const DEFAULT_COLORS = {
  callPos: '#ff4d4d', // Call Writing  (bearish)
  callNeg: '#00d2ff', // Call Unwinding (bullish)
  putPos:  '#00e676', // Put Writing   (bullish)
  putNeg:  '#ffa726', // Put Unwinding (bearish)
};
let chartColors = { ...DEFAULT_COLORS };

// Load saved colours from localStorage (if any)
function loadSavedColors() {
  try {
    const saved = localStorage.getItem('oi_chart_colors');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Only merge known keys to avoid stale/corrupt data
      ['callPos','callNeg','putPos','putNeg'].forEach(k => {
        if (parsed[k] && /^#[0-9a-fA-F]{6}$/.test(parsed[k])) {
          chartColors[k] = parsed[k];
        }
      });
    }
  } catch(e) { /* ignore parse errors */ }
}
// Darken a hex colour ~30 % for use as border colour
function darkenHex(hex, factor = 0.65) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const dr = Math.round(r * factor).toString(16).padStart(2,'0');
  const dg = Math.round(g * factor).toString(16).padStart(2,'0');
  const db = Math.round(b * factor).toString(16).padStart(2,'0');
  return `#${dr}${dg}${db}`;
}

// Apply chartColors to CSS vars, legend dots, and all active chart datasets
function applyColors() {
  // Persist to localStorage so colours survive page refresh
  try { localStorage.setItem('oi_chart_colors', JSON.stringify(chartColors)); } catch(e) {}

  // 1. Update CSS vars so .legend-dot classes & any CSS consumers stay in sync
  document.documentElement.style.setProperty('--color-call-pos', chartColors.callPos);
  document.documentElement.style.setProperty('--color-call-neg', chartColors.callNeg);
  document.documentElement.style.setProperty('--color-put-pos',  chartColors.putPos);
  document.documentElement.style.setProperty('--color-put-neg',  chartColors.putNeg);

  // 2. Sync colour pickers to current values
  const clrCallPos = document.getElementById('clr-calls-pos');
  const clrCallNeg = document.getElementById('clr-calls-neg');
  const clrPutPos  = document.getElementById('clr-puts-pos');
  const clrPutNeg  = document.getElementById('clr-puts-neg');
  if (clrCallPos) clrCallPos.value = chartColors.callPos;
  if (clrCallNeg) clrCallNeg.value = chartColors.callNeg;
  if (clrPutPos)  clrPutPos.value  = chartColors.putPos;
  if (clrPutNeg)  clrPutNeg.value  = chartColors.putNeg;

  // 3. Push colours into live Chart.js instances
  updateAllChartColors();
}


function updateAllChartColors() {
  if (oiVerticalChartInstance) {
    // Dataset 0 = Calls, Dataset 1 = Puts
    oiVerticalChartInstance.data.datasets[0].backgroundColor = (ctx) =>
      ctx.raw >= 0 ? chartColors.callPos : chartColors.callNeg;
    oiVerticalChartInstance.data.datasets[0].borderColor = (ctx) =>
      ctx.raw >= 0 ? darkenHex(chartColors.callPos) : darkenHex(chartColors.callNeg);
    oiVerticalChartInstance.data.datasets[1].backgroundColor = (ctx) =>
      ctx.raw >= 0 ? chartColors.putPos : chartColors.putNeg;
    oiVerticalChartInstance.data.datasets[1].borderColor = (ctx) =>
      ctx.raw >= 0 ? darkenHex(chartColors.putPos) : darkenHex(chartColors.putNeg);
    oiVerticalChartInstance.update('none');
  }
  if (volumeChartInstance) {
    volumeChartInstance.data.datasets[0].backgroundColor = chartColors.callPos + 'bf'; // 75% opacity
    volumeChartInstance.data.datasets[0].borderColor = darkenHex(chartColors.callPos);
    volumeChartInstance.data.datasets[1].backgroundColor = chartColors.putPos + 'bf';
    volumeChartInstance.data.datasets[1].borderColor = darkenHex(chartColors.putPos);
    volumeChartInstance.update('none');
  }
}

// Alert State
let alertThresholdIncrease = null;
let alertThresholdDecrease = null;
let alertSoundEnabled = true;
let alertDesktopEnabled = false;
window.oiHistoryQueue = {}; // Maps symbol -> array of { timestamp, timeString, lookupCache }
window.lastProcessedAlertTime = null;

// Timeline Slider State
let isLiveMode = true;
let selectedStartMinutes = 550; // 09:10 AM
let selectedEndMinutes = 940; // 03:40 PM

// DOM Elements
const niftyLtpEl = document.getElementById('nifty-ltp');
const niftyChangeEl = document.getElementById('nifty-change');
const niftyOpenEl = document.getElementById('nifty-open');
const niftyCloseEl = document.getElementById('nifty-close');
const niftyLowEl = document.getElementById('nifty-low');
const niftyHighEl = document.getElementById('nifty-high');
const niftyAvgEl = document.getElementById('nifty-avg');
const niftyRangeFill = document.getElementById('nifty-range-fill');
const niftyRangePointer = document.getElementById('nifty-range-pointer');

const vixValueEl = document.getElementById('vix-value');
const vixChangeEl = document.getElementById('vix-change');
const vixSentimentEl = document.getElementById('vix-sentiment');

const sentimentBadge = document.getElementById('sentiment-badge');
const sentimentPointer = document.getElementById('sentiment-pointer');
const oiPcrEl = document.getElementById('oi-pcr');
const maxPainEl = document.getElementById('max-pain');
const expiryDateDisplay = document.getElementById('expiry-date-display');

const timerRing = document.getElementById('timer-ring');
const timerText = document.getElementById('timer-text');
const btnManualRefresh = document.getElementById('btn-manual-refresh');
const marketStatusBadge = document.getElementById('market-status-badge');
const lastUpdatedText = document.getElementById('last-updated-text');


// ----------------------------------------------------
// Utility Functions
// ----------------------------------------------------

// Format OI numbers for quick reading (Indian system style - Lakhs for Equity, Absolute for MCX)
function formatOI(value) {
  if (value === 0 || value === null || value === undefined) return "0";
  const sym = currentSymbol.toLowerCase();
  const isMCX = sym === 'crudeoil' || sym === 'crudeoilm';
  if (isMCX) {
    const isNeg = value < 0;
    const absVal = Math.abs(value);
    const formatted = absVal.toLocaleString('en-IN');
    return isNeg ? "-" + formatted : "+" + formatted;
  }
  
  const isNeg = value < 0;
  const absVal = Math.abs(value);
  let formatted = "";
  
  if (absVal >= 100000) {
    // Convert to Lakhs (1 Lakh = 100,000)
    formatted = (absVal / 100000).toFixed(2) + " L";
  } else if (absVal >= 1000) {
    // Convert to Thousands (1 K = 1,000)
    formatted = (absVal / 1000).toFixed(1) + " K";
  } else {
    formatted = absVal.toString();
  }
  
  return isNeg ? "-" + formatted : "+" + formatted;
}

// Format full share count with commas
function formatShares(value) {
  if (value === null || value === undefined) return "0";
  return value.toLocaleString('en-IN');
}

// Parse ISO Dates to human readable times/dates
function formatTime(dateStr) {
  if (!dateStr) return '--:--:--';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-IN', { hour12: false });
}

function formatDate(dateStr) {
  if (!dateStr) return '-- -- ----';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function minutesToTimeString(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const hrStr = hours.toString().padStart(2, '0');
  const minStr = mins.toString().padStart(2, '0');
  return `${hrStr}:${minStr}:00`;
}

function minutesToDisplayTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const minStr = mins.toString().padStart(2, '0');
  return `${displayHours}:${minStr} ${ampm}`;
}

// ----------------------------------------------------
// Timer & Automatic Refresh Logic
// ----------------------------------------------------

function startTimer() {
  clearInterval(refreshTimer);
  if (!isLiveMode) {
    timerText.textContent = '||';
    timerRing.style.strokeDashoffset = 94.24;
    return;
  }
  
  countdown = REFRESH_INTERVAL_SEC;
  updateTimerUI();
  
  refreshTimer = setInterval(() => {
    countdown--;
    updateTimerUI();
    
    if (countdown <= 0) {
      clearInterval(refreshTimer);
      fetchDashboardData();
    }
  }, 1000);
}

function updateTimerUI() {
  timerText.textContent = countdown;
  
  // Progress Ring Stroke Calculation
  // r=15, circumference = 2 * PI * r = 94.24
  const strokeCircumference = 94.24;
  const progressFraction = countdown / REFRESH_INTERVAL_SEC;
  const offset = strokeCircumference - (progressFraction * strokeCircumference);
  timerRing.style.strokeDashoffset = offset;
}

// ----------------------------------------------------
// Fetch and Process Data
// ----------------------------------------------------

async function fetchDashboardData() {
  if (isFetching) return;
  isFetching = true;
  
  btnManualRefresh.classList.add('spinning');
  
  try {
    const sym = currentSymbol.toLowerCase();
    const isSensex    = sym === 'sensex';
    const isBankNifty = sym === 'banknifty';
    const isCrudeOil  = sym === 'crudeoil';
    const isCrudeOilM = sym === 'crudeoilm';
    const isMCX       = isCrudeOil || isCrudeOilM;

    let spotSymbol  = 'NIFTY 50';
    let spotExchange = 'nse';
    let oiSymbol    = 'nifty';
    let oiExchange  = 'nse';

    if (isSensex) {
      spotSymbol = 'sensex'; spotExchange = 'bse';
      oiSymbol   = 'sensex'; oiExchange   = 'bse';
    } else if (isBankNifty) {
      spotSymbol = 'NIFTY BANK'; spotExchange = 'nse';
      oiSymbol   = 'banknifty'; oiExchange   = 'nse';
    } else if (isCrudeOil) {
      spotSymbol = 'CRUDEOIL'; spotExchange = 'mcx';
      oiSymbol   = 'CRUDEOIL'; oiExchange   = 'mcx';
    } else if (isCrudeOilM) {
      spotSymbol = 'CRUDEOILM'; spotExchange = 'mcx';
      oiSymbol   = 'CRUDEOILM'; oiExchange   = 'mcx';
    }

    // Use the custom slider state variables directly
    const startTimeStr = minutesToTimeString(selectedStartMinutes);
    // In live mode: equity closes at 15:40, MCX crude at 23:30
    const liveEndTime  = isMCX ? '23:30:00' : '15:40:00';
    const endTimeStr   = isLiveMode ? liveEndTime : minutesToTimeString(selectedEndMinutes);

    const spotUrl = `/api/spot-data?symbol=${encodeURIComponent(spotSymbol)}&exchange=${spotExchange}`;
    // MCX uses the change-oi-time-range endpoint via /api/mcx-oi-data
    const oiUrl = isMCX
      ? `/api/mcx-oi-data?symbol=${oiSymbol}&exchange=${oiExchange}&start_time=${startTimeStr}&end_time=${endTimeStr}`
      : `/api/oi-data?symbol=${oiSymbol}&exchange=${oiExchange}&start_time=${startTimeStr}&end_time=${endTimeStr}`;

    // Fetch Spot Data and OI Data concurrently
    const [spotRes, oiRes] = await Promise.all([
      fetch(spotUrl),
      fetch(oiUrl)
    ]);
    
    if (!spotRes.ok || !oiRes.ok) {
      throw new Error("One or more API requests failed");
    }
    
    const spotJson = await spotRes.ok ? await spotRes.json() : null;
    const oiJson = await oiRes.ok ? await oiRes.json() : null;
    
    if (spotJson && spotJson.result === 1 && oiJson && oiJson.result === 1) {
      window.lastReceivedSpotData = spotJson.resultData;
      window.lastReceivedOiData = oiJson.resultData;
      
      // Dynamic slider snapping in live mode based on exchange timestamp
      if (oiJson.resultData && oiJson.resultData.length > 0) {
        const rawTime = oiJson.resultData[0].time; // e.g. "2026-08-10T15:40:00"
        if (rawTime && rawTime.includes('T')) {
          const timeParts = rawTime.split('T')[1].split(':');
          const fetchedHours = parseInt(timeParts[0]);
          const fetchedMinutes = parseInt(timeParts[1]);
          const fetchedTotalMinutes = fetchedHours * 60 + fetchedMinutes;
          
          if (isLiveMode) {
            selectedEndMinutes = fetchedTotalMinutes;
            renderSliderUI();
          }
        }
      }
      
      // Update last updated time
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-IN', { hour12: false });
      lastUpdatedText.textContent = `Last Updated: ${timeString}`;
      
      updateDashboard(spotJson.resultData, oiJson.resultData, timeString);
      
      // Update market status connection
      marketStatusBadge.querySelector('.status-dot').className = 'status-dot pulsing';
      marketStatusBadge.querySelector('.status-text').textContent = 'Live Connected';
    } else {
      console.warn("API returned unsuccessful results:", spotJson, oiJson);
      marketStatusBadge.querySelector('.status-dot').className = 'status-dot closed';
      marketStatusBadge.querySelector('.status-text').textContent = 'Data Idle';
    }
  } catch (error) {
    console.error("Error updating dashboard:", error);
    marketStatusBadge.querySelector('.status-dot').className = 'status-dot closed';
    marketStatusBadge.querySelector('.status-text').textContent = 'Connection Error';
  } finally {
    isFetching = false;
    btnManualRefresh.classList.remove('spinning');
    startTimer();
  }
}

// ----------------------------------------------------
// Update UI Components
// ----------------------------------------------------

function updateDashboard(spotData, oiData, timeString) {
  const sym         = currentSymbol.toLowerCase();
  const isSensex    = sym === 'sensex';
  const isBankNifty = sym === 'banknifty';
  const isCrudeOil  = sym === 'crudeoil';
  const isCrudeOilM = sym === 'crudeoilm';
  const isMCX       = isCrudeOil || isCrudeOilM;

  // Update header subtitle dynamically
  const subtitleMap = {
    sensex: 'Sensex Live Open Interest Tracker',
    banknifty: 'Bank Nifty Live Open Interest Tracker',
    crudeoil: 'Crude Oil (MCX) Live Open Interest Tracker',
    crudeoilm: 'Crude Oil Mini (MCX) Live Open Interest Tracker',
  };
  document.getElementById('app-subtitle').textContent =
    subtitleMap[sym] || 'Nifty 50 Live Open Interest Tracker';

  // Update spot card labels dynamically
  const spotLabelMap = {
    sensex: 'SENSEX INDEX', banknifty: 'BANK NIFTY INDEX',
    crudeoil: 'CRUDE OIL (MCX)', crudeoilm: 'CRUDE OIL MINI (MCX)',
  };
  document.querySelector('#card-nifty-spot .card-label').textContent =
    spotLabelMap[sym] || 'NIFTY 50 INDEX';

  const sentLabelMap = {
    sensex: `CHG OI SENTIMENT (Sensex ± ${strikeRange})`,
    banknifty: `CHG OI SENTIMENT (Bank Nifty ± ${strikeRange})`,
    crudeoil: `CHG OI SENTIMENT (CrudeOil ± ${strikeRange})`,
    crudeoilm: `CHG OI SENTIMENT (CrudeOilM ± ${strikeRange})`,
  };
  document.querySelector('#card-oi-sentiment .card-label').textContent =
    sentLabelMap[sym] || `CHG OI SENTIMENT (Nifty ± ${strikeRange})`;

  // 1. Update Spot Card
  let ltp = spotData.last_trade_price || 0;
  
  // If in historical mode, overwrite ltp and high/low from options chain index_close to align markers
  if (!isLiveMode && oiData && oiData.length > 0 && oiData[0].index_close) {
    ltp = oiData[0].index_close;
  }
  niftyLtpEl.textContent = ltp.toFixed(2);
  
  const changeValue = spotData.change_value;
  const changePer = spotData.change_per;
  const changeSign = changeValue >= 0 ? '+' : '';
  niftyChangeEl.textContent = `${changeSign}${changeValue.toFixed(2)} (${changeSign}${changePer.toFixed(2)}%)`;
  niftyChangeEl.className = `value-change ${changeValue >= 0 ? 'positive' : 'negative'}`;
  
  niftyOpenEl.textContent = spotData.open.toFixed(2);
  niftyCloseEl.textContent = spotData.close.toFixed(2);
  niftyLowEl.textContent = spotData.low.toFixed(2);
  niftyHighEl.textContent = spotData.high.toFixed(2);
  niftyAvgEl.textContent = spotData.average_price ? spotData.average_price.toFixed(2) : '--';

  // 2. Update Intraday Range Indicator
  const rangeTotal = spotData.high - spotData.low;
  if (rangeTotal > 0) {
    const rangePositionPct = ((ltp - spotData.low) / rangeTotal) * 100;
    niftyRangeFill.style.width = `${rangePositionPct}%`;
    niftyRangePointer.style.left = `${rangePositionPct}%`;
  }

  // 3. Update VIX Card
  const vix = spotData.vix_value;
  const vixChange = spotData.vix_change;
  
  if (vix !== null && vix !== undefined) {
    vixValueEl.textContent = vix.toFixed(2);
    if (vixChange !== null && vixChange !== undefined) {
      const vixSign = vixChange >= 0 ? '+' : '';
      vixChangeEl.textContent = `${vixSign}${vixChange.toFixed(2)}%`;
      vixChangeEl.className = `value-change ${vixChange < 0 ? 'positive' : 'negative'}`;
    } else {
      vixChangeEl.textContent = '--';
      vixChangeEl.className = 'value-change';
    }
    
    if (vix > 18) {
      vixSentimentEl.textContent = 'High Volatility (Fearful)';
      vixSentimentEl.style.color = 'var(--color-call-pos)';
    } else if (vix > 14) {
      vixSentimentEl.textContent = 'Moderate Volatility';
      vixSentimentEl.style.color = 'var(--color-put-neg)';
    } else {
      vixSentimentEl.textContent = 'Low Volatility (Complacent)';
      vixSentimentEl.style.color = 'var(--color-put-pos)';
    }
  } else {
    vixValueEl.textContent = 'N/A';
    vixChangeEl.textContent = '--';
    vixChangeEl.className = 'value-change';
    vixSentimentEl.textContent = 'Volatility Data Unavailable';
    vixSentimentEl.style.color = 'var(--text-muted)';
  }

  // 4. Calculate ATM Strike
  // Nifty: 50, Sensex/BankNifty: 100, CrudeOil/CrudeOilM: 50
  const strikeSpacing = (isSensex || isBankNifty) ? 100 : 50;
  const atmStrike = Math.round(ltp / strikeSpacing) * strikeSpacing;
  maxPainEl.textContent = spotData.max_pain ? spotData.max_pain.toFixed(2) : 'N/A';

  // 5. Filter and Process OI Data
  // Sort OI array by strike price
  oiData.sort((a, b) => a.strike_price - b.strike_price);
  
  // Find closest strike index
  let closestIndex = -1;
  let minDiff = Infinity;
  for (let i = 0; i < oiData.length; i++) {
    const diff = Math.abs(oiData[i].strike_price - atmStrike);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }

  if (closestIndex === -1) { return; }

  // Setup globals for vertical spot line plugin
  window.currentSpotPrice = ltp;
  
  // Extract strikes around ATM based on dynamic strikeRange selection (default ± 5 strikes)
  const startIndex = Math.max(0, closestIndex - strikeRange);
  const endIndex = Math.min(oiData.length - 1, closestIndex + strikeRange);
  const selectedOI = oiData.slice(startIndex, endIndex + 1);
  
  // Set current strikes range for vertical chart plugins
  window.currentStrikesData = selectedOI.map(item => item.strike_price);

  // 5.2. Check Open Interest alert thresholds
  checkOIAlerterThresholds(selectedOI, timeString);

  // Expiry Date Displays
  if (selectedOI.length > 0) {
    const expiryStr = selectedOI[0].expiry_date;
    expiryDateDisplay.textContent = formatDate(expiryStr);
  }

  // Calculate Aggregates for selected strikes
  let totalCallChgOI = 0;
  let totalPutChgOI = 0;
  
  selectedOI.forEach(strike => {
    totalCallChgOI += strike.calls_change_oi;
    totalPutChgOI += strike.puts_change_oi;
  });

  // Put-Call Ratio for Change in OI
  const pcr = totalCallChgOI !== 0 ? totalPutChgOI / totalCallChgOI : 0;
  oiPcrEl.textContent = pcr.toFixed(3);

  // Sentiment Scoring
  // Standard thresholds: PCR > 1.2 Bullish, PCR < 0.8 Bearish, else Neutral
  let sentiment = 'Neutral';
  let badgeClass = 'neutral';
  let pointerPosition = 50; // percentage

  if (pcr >= 1.5) {
    sentiment = 'Extremely Bullish';
    badgeClass = 'bullish';
    pointerPosition = 90;
  } else if (pcr >= 1.1) {
    sentiment = 'Mildly Bullish';
    badgeClass = 'bullish';
    pointerPosition = 70;
  } else if (pcr <= 0.6) {
    sentiment = 'Extremely Bearish';
    badgeClass = 'bearish';
    pointerPosition = 10;
  } else if (pcr <= 0.9) {
    sentiment = 'Mildly Bearish';
    badgeClass = 'bearish';
    pointerPosition = 30;
  }

  sentimentBadge.textContent = sentiment;
  sentimentBadge.className = `badge ${badgeClass}`;
  sentimentPointer.style.left = `${pointerPosition}%`;

  // 6. Render Vertical Charts
  renderVerticalChart(selectedOI, atmStrike);
  renderVolumeChart(selectedOI, atmStrike);
}

// ----------------------------------------------------
// Event Listeners & Initialization
// ----------------------------------------------------

// Index Selector controls
document.querySelectorAll('.index-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isFetching) return;
    
    document.querySelectorAll('.index-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    currentSymbol = btn.getAttribute('data-index');

    // Update slider min/max for the newly selected symbol
    SLIDER_MIN_VAL     = getLiveStartMinutes();
    SLIDER_MAX_VAL     = getLiveCloseMinutes();
    selectedStartMinutes = SLIDER_MIN_VAL;
    selectedEndMinutes   = SLIDER_MAX_VAL;
    isLiveMode = true;
    const liveBtnEl = document.getElementById('btn-live-chart');
    if (liveBtnEl) liveBtnEl.classList.add('active');
    renderSliderUI();

    // Destroy vertical chart to allow fresh instantiation with new scales
    if (oiVerticalChartInstance) {
      oiVerticalChartInstance.destroy();
      oiVerticalChartInstance = null;
    }
    if (volumeChartInstance) {
      volumeChartInstance.destroy();
      volumeChartInstance = null;
    }
    
    fetchDashboardData();
  });
});

// Strike Range Selector
const strikeRangeSelect = document.getElementById('strike-range-select');
strikeRangeSelect.addEventListener('change', (e) => {
  strikeRange = parseInt(e.target.value);
  if (window.lastReceivedSpotData && window.lastReceivedOiData) {
    updateDashboard(window.lastReceivedSpotData, window.lastReceivedOiData);
  }
});

// Alert Threshold Inputs
const inputOiIncrease = document.getElementById('input-oi-increase');
inputOiIncrease.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  alertThresholdIncrease = isNaN(val) || val <= 0 ? null : val;
  // Trigger comparison instantly using current cached data
  if (window.lastReceivedSpotData && window.lastReceivedOiData) {
    updateDashboard(window.lastReceivedSpotData, window.lastReceivedOiData);
  }
});

const inputOiDecrease = document.getElementById('input-oi-decrease');
inputOiDecrease.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  alertThresholdDecrease = isNaN(val) || val <= 0 ? null : val;
  // Trigger comparison instantly using current cached data
  if (window.lastReceivedSpotData && window.lastReceivedOiData) {
    updateDashboard(window.lastReceivedSpotData, window.lastReceivedOiData);
  }
});

// Preferences Toggles
const chkAlertSound = document.getElementById('chk-alert-sound');
chkAlertSound.addEventListener('change', (e) => {
  alertSoundEnabled = e.target.checked;
});

const chkAlertDesktop = document.getElementById('chk-alert-desktop');
chkAlertDesktop.addEventListener('change', (e) => {
  alertDesktopEnabled = e.target.checked;
  if (alertDesktopEnabled) {
    requestNotificationPermission();
  }
});

// Test Alert Button
const btnTestAlert = document.getElementById('btn-test-alert');
btnTestAlert.addEventListener('click', () => {
  playAlertChime();
  showToastAlert("Test Alert", "OI Alerts system is working normally!");
  if (alertDesktopEnabled) {
    sendDesktopNotification("Test Alert", "Alert settings test was successful!");
  }
});

// Toggle alert settings display panel collapse
const btnToggleAlertPanel = document.getElementById('btn-toggle-alert-panel');
const alertSettingsPanel = document.getElementById('alert-settings-panel');
btnToggleAlertPanel.addEventListener('click', () => {
  const isCollapsed = alertSettingsPanel.classList.toggle('collapsed');
  btnToggleAlertPanel.textContent = isCollapsed ? 'Expand Settings' : 'Collapse Settings';
});

// Manual refresh trigger
btnManualRefresh.addEventListener('click', () => {
  fetchDashboardData();
});


// ============================================================
// ============================================================
// Single End-Time Handle Slider (start time fixed at 09:10 AM)
// ============================================================
const SLIDER_MIN_VAL_EQUITY = 550; // 09:10 AM
const SLIDER_MIN_VAL_MCX    = 540; // 09:00 AM
let   SLIDER_MIN_VAL = 550;  // current; overridden on symbol switch
let   SLIDER_MAX_VAL = 940;  // 03:40 PM (equity default); overridden for MCX

// Returns the market-open time in minutes for the selected symbol
function getLiveStartMinutes() {
  const sym = currentSymbol.toLowerCase();
  return (sym === 'crudeoil' || sym === 'crudeoilm') ? SLIDER_MIN_VAL_MCX : SLIDER_MIN_VAL_EQUITY;
}

// Returns the market-close time in minutes for the selected symbol
function getLiveCloseMinutes() {
  const sym = currentSymbol.toLowerCase();
  return (sym === 'crudeoil' || sym === 'crudeoilm') ? 1410 : 940; // 23:30 vs 15:40
}

const dualSlider  = document.getElementById('dual-slider');
const thumbMax    = document.getElementById('slider-thumb-max');
const trackFillEl = document.getElementById('slider-track-fill');
const timeLabelEl = document.getElementById('slider-time-label');

function renderSliderUI() {
  if (!dualSlider || !thumbMax || !trackFillEl || !timeLabelEl) return;
  const totalRange = SLIDER_MAX_VAL - SLIDER_MIN_VAL;
  const rightPct   = ((selectedEndMinutes - SLIDER_MIN_VAL) / totalRange) * 100;

  // Fill always starts from left (09:10) and extends to end handle
  thumbMax.style.left      = `${rightPct}%`;
  trackFillEl.style.left   = '0%';
  trackFillEl.style.width  = `${rightPct}%`;

  // Label: fixed start time + selected end time
  timeLabelEl.textContent =
    `${minutesToDisplayTime(SLIDER_MIN_VAL)} - ${minutesToDisplayTime(selectedEndMinutes)}`;
}

function pxToMinutes(clientX) {
  if (!dualSlider) return SLIDER_MIN_VAL;
  const rect = dualSlider.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(SLIDER_MIN_VAL + pct * (SLIDER_MAX_VAL - SLIDER_MIN_VAL));
}

function enterHistoricalMode() {
  isLiveMode = false;
  const btn = document.getElementById('btn-live-chart');
  if (btn) btn.classList.remove('active');
  clearInterval(refreshTimer);
  refreshTimer = null;
  const timerEl = document.getElementById('timer-text');
  if (timerEl) timerEl.textContent = '||';
}

// Drag state
let isDragging = false;

function onThumbMouseDown(e) {
  e.preventDefault();
  isDragging = true;
  document.body.style.userSelect = 'none';
  if (thumbMax) thumbMax.style.cursor = 'grabbing';
}

function onDocMouseMove(e) {
  if (!isDragging) return;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const newVal  = pxToMinutes(clientX);
  // Clamp: must stay above SLIDER_MIN_VAL + 1 and below SLIDER_MAX_VAL
  selectedEndMinutes = Math.max(SLIDER_MIN_VAL + 1, Math.min(newVal, SLIDER_MAX_VAL));
  renderSliderUI();
}

function onDocMouseUp() {
  if (!isDragging) return;
  if (thumbMax) thumbMax.style.cursor = 'grab';
  isDragging = false;
  document.body.style.userSelect = '';
  // Fetch new data for selected end time
  enterHistoricalMode();
  fetchDashboardData();
}

// Attach drag listeners to the end handle thumb
if (thumbMax) {
  thumbMax.addEventListener('mousedown',  onThumbMouseDown);
  thumbMax.addEventListener('touchstart', onThumbMouseDown, { passive: false });
}
document.addEventListener('mousemove', onDocMouseMove);
document.addEventListener('touchmove', onDocMouseMove, { passive: false });
document.addEventListener('mouseup',   onDocMouseUp);
document.addEventListener('touchend',  onDocMouseUp);

// Click on track (not on thumb) → jump end handle to clicked position
if (dualSlider) {
  dualSlider.addEventListener('click', (e) => {
    if (e.target === thumbMax) return; // handled by drag
    selectedEndMinutes = Math.max(SLIDER_MIN_VAL + 1, Math.min(pxToMinutes(e.clientX), SLIDER_MAX_VAL));
    renderSliderUI();
    enterHistoricalMode();
    fetchDashboardData();
  });
}

// Live Chart button — snap handles back to live range and restart auto-refresh
const btnLiveChart = document.getElementById('btn-live-chart');
if (btnLiveChart) {
  btnLiveChart.addEventListener('click', () => {
    isLiveMode = true;
    btnLiveChart.classList.add('active');
    SLIDER_MIN_VAL       = getLiveStartMinutes(); // update min for current symbol
    SLIDER_MAX_VAL       = getLiveCloseMinutes(); // update max for current symbol
    selectedStartMinutes = SLIDER_MIN_VAL;
    selectedEndMinutes   = SLIDER_MAX_VAL;
    renderSliderUI();
    window.lastProcessedAlertTime = null;
    fetchDashboardData();
  });
}

// Shim for any legacy callers
function updateSliderTrackFill() { renderSliderUI(); }

// Page Initialization
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  SLIDER_MIN_VAL       = getLiveStartMinutes();
  SLIDER_MAX_VAL       = getLiveCloseMinutes();
  selectedStartMinutes = SLIDER_MIN_VAL;
  selectedEndMinutes   = SLIDER_MAX_VAL;
  renderSliderUI();

  // Restore saved colours then apply (also seeds pickers & legend dots)
  loadSavedColors();
  applyColors();

  // Toggle colour picker panel
  const btnToggleColors = document.getElementById('btn-toggle-colors');
  const colorPanel      = document.getElementById('color-picker-panel');
  if (btnToggleColors && colorPanel) {
    btnToggleColors.addEventListener('click', () => {
      const open = colorPanel.style.display === 'flex';
      colorPanel.style.display = open ? 'none' : 'flex';
      btnToggleColors.style.background = open
        ? 'rgba(99,102,241,0.15)'
        : 'rgba(99,102,241,0.35)';
    });
  }

  // Individual colour pickers
  const pickerMap = {
    'clr-calls-pos': 'callPos',
    'clr-calls-neg': 'callNeg',
    'clr-puts-pos':  'putPos',
    'clr-puts-neg':  'putNeg',
  };
  Object.entries(pickerMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      chartColors[key] = e.target.value;
      applyColors();
    });
  });

  // Reset button — clears localStorage and restores defaults
  const btnResetColors = document.getElementById('btn-reset-colors');
  if (btnResetColors) {
    btnResetColors.addEventListener('click', () => {
      chartColors = { ...DEFAULT_COLORS };
      try { localStorage.removeItem('oi_chart_colors'); } catch(e) {}
      applyColors();
    });
  }

  fetchDashboardData();
});

function initTheme() {
  const currentTheme = localStorage.getItem('app_theme') || 'dark';
  setTheme(currentTheme);

  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      setTheme(isDark ? 'light' : 'dark');
    });
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('app_theme', theme);

  if (typeof updateChartsTheme === 'function') {
    updateChartsTheme();
  }
}

function updateChartsTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';
  const tickColor = isLight ? '#475569' : '#94a3b8';

  const charts = [
    typeof oiVerticalChartInstance !== 'undefined' ? oiVerticalChartInstance : null,
    typeof volumeChartInstance !== 'undefined' ? volumeChartInstance : null,
    typeof liveChartInstance !== 'undefined' ? liveChartInstance : null
  ];

  charts.forEach(chart => {
    if (!chart) return;
    if (chart.options.scales.x) {
      if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
      if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = tickColor;
    }
    if (chart.options.scales.y) {
      if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
      if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = tickColor;
    }
    chart.update();
  });
}


// ----------------------------------------------------
// Alert Notification & Audio Synthesis Helpers
// ----------------------------------------------------


function playAlertChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play dual beep chime using browser audio oscillator synth
    const playBeep = (time, freq, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(time);
      osc.stop(time + duration);
    };
    
    const now = audioCtx.currentTime;
    playBeep(now, 880, 0.12);
    playBeep(now + 0.14, 1200, 0.18);
  } catch (err) {
    console.error("Failed to play audio alert beep:", err);
  }
}

function requestNotificationPermission() {
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission !== 'granted') {
          alertDesktopEnabled = false;
          document.getElementById('chk-alert-desktop').checked = false;
        }
      });
    }
  }
}

function sendDesktopNotification(title, message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: message,
      icon: 'favicon.ico'
    });
  }
}

function showToastAlert(title, message) {
  // Inject toast container element if missing
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = 'toast-alert glass-panel';
  toast.style.background = 'rgba(15, 23, 42, 0.95)';
  toast.style.borderLeft = '4px solid var(--primary-color)';
  toast.style.padding = '12px 18px';
  toast.style.borderRadius = '8px';
  toast.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.5)';
  toast.style.minWidth = '280px';
  toast.style.animation = 'slideIn 0.3s ease-out';
  
  toast.innerHTML = `
    <div style="font-weight: 700; font-size: 0.85rem; color: #ffffff; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
      <span>🔔</span> <span>${title}</span>
    </div>
    <div style="font-size: 0.78rem; color: var(--text-secondary);">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Slide out and remove toast after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function addAlertToHistoryLog(crossing, LakhsValue, timeString) {
  const isBearish = (crossing.type === 'CE Writing' || crossing.type === 'PE Unwinding');
  const targetListId = isBearish ? 'bearish-log-list' : 'bullish-log-list';
  const logList = document.getElementById(targetListId);
  if (!logList) return;
  
  // Remove empty message if present
  const emptyMsg = logList.querySelector('.log-empty-msg');
  if (emptyMsg) {
    emptyMsg.remove();
  }
  
  const logItem = document.createElement('div');
  logItem.className = 'log-item';
  
  const textClass = isBearish ? 'log-text writing' : 'log-text unwinding';
  
  logItem.innerHTML = `
    <span class="log-time">[${timeString}]</span>
    <span class="${textClass}">${currentSymbol.toUpperCase()} Strike ${crossing.strike} ${crossing.type}: ${LakhsValue}L (5m delta)</span>
  `;
  
  logList.insertBefore(logItem, logList.firstChild);
  
  // Keep only the last 30 logs to avoid DOM overload
  while (logList.children.length > 30) {
    logList.removeChild(logList.lastChild);
  }
}

function checkOIAlerterThresholds(oiList, timeString) {
  // If timeString is not provided or we are not in live mode, skip alerts checks
  if (!timeString || !isLiveMode) {
    return;
  }
  
  // If alerts for this specific timestamp have already been handled, skip duplicates
  if (window.lastProcessedAlertTime === timeString) return;
  window.lastProcessedAlertTime = timeString;
  
  const currentTimestamp = Date.now();
  
  // Construct current dataset lookup cache
  const currentCache = {};
  oiList.forEach(item => {
    currentCache[item.strike_price] = {
      calls_change_oi: item.calls_change_oi,
      puts_change_oi: item.puts_change_oi
    };
  });
  
  // Initialize queue for this symbol if not present
  if (!window.oiHistoryQueue[currentSymbol]) {
    window.oiHistoryQueue[currentSymbol] = [];
  }
  
  // Push the current data into the queue
  window.oiHistoryQueue[currentSymbol].push({
    timestamp: currentTimestamp,
    timeString: timeString,
    lookupCache: currentCache
  });
  
  // Clean up entries older than 8 minutes to save memory
  const maxAge = 8 * 60 * 1000;
  window.oiHistoryQueue[currentSymbol] = window.oiHistoryQueue[currentSymbol].filter(entry => {
    return (currentTimestamp - entry.timestamp) <= maxAge;
  });
  
  // Check if we are on a 5-minute clock boundary (minutes ending in 0 or 5, e.g. 10:00, 10:05)
  const currentMinute = new Date().getMinutes();
  const isFiveMinBoundary = (currentMinute % 5 === 0);
  if (!isFiveMinBoundary) {
    return; // Cache current data, but skip alert delta computations on other minutes
  }
  
  // Find historical entry closest to 5 minutes ago (300,000 ms ago)
  const targetTime = currentTimestamp - (5 * 60 * 1000);
  let bestMatch = null;
  let minDiff = Infinity;
  
  window.oiHistoryQueue[currentSymbol].forEach(entry => {
    const diff = Math.abs(entry.timestamp - targetTime);
    // Allow matching only if it's within 45 seconds tolerance of 5 minutes ago
    if (diff < minDiff && diff < 45 * 1000) {
      minDiff = diff;
      bestMatch = entry;
    }
  });
  
  const crossings = [];
  
  // Calculate rolling delta compared to the matched 5-minute-ago historical data point
  if (bestMatch) {
    const prevCache = bestMatch.lookupCache;
    
    oiList.forEach(strike => {
      const strikeVal = strike.strike_price;
      const prev = prevCache[strikeVal];
      
      if (prev) {
        // Calculate the difference over the rolling 5-minute window
        const callDeltaLakhs = (strike.calls_change_oi - prev.calls_change_oi) / 100000;
        const putDeltaLakhs = (strike.puts_change_oi - prev.puts_change_oi) / 100000;
        
        if (alertThresholdIncrease !== null) {
          if (callDeltaLakhs >= alertThresholdIncrease) {
            crossings.push({ strike: strikeVal, type: 'CE Writing', desc: 'Call Writing (Bearish)', value: callDeltaLakhs });
          }
          if (putDeltaLakhs >= alertThresholdIncrease) {
            crossings.push({ strike: strikeVal, type: 'PE Writing', desc: 'Put Writing (Bullish)', value: putDeltaLakhs });
          }
        }
        
        if (alertThresholdDecrease !== null) {
          if (callDeltaLakhs <= -alertThresholdDecrease) {
            crossings.push({ strike: strikeVal, type: 'CE Unwinding', desc: 'Call Unwinding (Bullish)', value: callDeltaLakhs });
          }
          if (putDeltaLakhs <= -alertThresholdDecrease) {
            crossings.push({ strike: strikeVal, type: 'PE Unwinding', desc: 'Put Unwinding (Bearish)', value: putDeltaLakhs });
          }
        }
      }
    });
  }
  
  if (crossings.length > 0) {
    if (alertSoundEnabled) {
      playAlertChime();
    }
    
    crossings.forEach(c => {
      const LakhsValue = Math.abs(c.value).toFixed(1);
      const prefixSymbol = c.value >= 0 ? '+' : '-';
      const msg = `${currentSymbol.toUpperCase()} Strike ${c.strike} ${c.type} crossed threshold with ${prefixSymbol}${LakhsValue}L delta (5m)!`;
      
      addAlertToHistoryLog(c, prefixSymbol + LakhsValue, timeString);
      showToastAlert(c.type + " Alert", msg);
      
      if (alertDesktopEnabled) {
        sendDesktopNotification(c.type + " Alert", msg);
      }
    });
  }
}

// ----------------------------------------------------
// Custom Chart.js Plugins & Vertical Chart Rendering
// ----------------------------------------------------

const datalabelsPlugin = {
  id: 'datalabels',
  afterDatasetsDraw(chart, args, options) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    
    const sym = currentSymbol.toLowerCase();
    const isMCX = sym === 'crudeoil' || sym === 'crudeoilm';
    
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((bar, index) => {
        const val = dataset.data[index];
        if (val === 0 || val === null || val === undefined) return;
        
        let label = "";
        if (isMCX) {
          // Absolute value for CRUDEOIL and CRUDEOILM (e.g. 13,439 or -1,547)
          label = val.toLocaleString('en-IN');
        } else {
          // Shorthand (L / K) for Equity symbols
          const absVal = Math.abs(val);
          if (absVal >= 100000) {
            label = (val / 100000).toFixed(1) + "L";
          } else if (absVal >= 1000) {
            label = (val / 1000).toFixed(0) + "K";
          } else {
            label = val.toString();
          }
        }
        
        const isPositive = val >= 0;
        const padding = 6;
        ctx.textBaseline = isPositive ? 'bottom' : 'top';
        const yPos = isPositive ? bar.y - padding : bar.y + padding;
        
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        ctx.fillStyle = isLight
          ? (datasetIndex === 0 ? '#dc2626' : '#059669')
          : (datasetIndex === 0 ? '#ff8080' : '#80ffc2');
        ctx.fillText(label, bar.x, yPos);
      });
    });
    ctx.restore();
  }
};

const spotLinePlugin = {
  id: 'spotLine',
  afterDraw(chart, args, options) {
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
    if (!x || !window.currentSpotPrice || !window.currentStrikesData) return;
    
    const spot = window.currentSpotPrice;
    const strikes = window.currentStrikesData;
    
    let idxA = -1;
    let idxB = -1;
    for (let i = 0; i < strikes.length - 1; i++) {
      if (spot >= strikes[i] && spot <= strikes[i + 1]) {
        idxA = i;
        idxB = i + 1;
        break;
      }
    }
    
    let xPixel = null;
    if (idxA !== -1 && idxB !== -1) {
      const pixelA = x.getPixelForTick(idxA);
      const pixelB = x.getPixelForTick(idxB);
      const fraction = (spot - strikes[idxA]) / (strikes[idxB] - strikes[idxA]);
      xPixel = pixelA + (pixelB - pixelA) * fraction;
    } else {
      const idx = strikes.indexOf(Math.round(spot / 50) * 50);
      if (idx !== -1) {
        xPixel = x.getPixelForTick(idx);
      }
    }
    
    if (xPixel === null) return;
    
    ctx.save();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xPixel, top);
    ctx.lineTo(xPixel, bottom);
    ctx.stroke();
    
    const label = `SPOT: ${spot.toFixed(2)}`;
    ctx.font = 'bold 9px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + 8;
    const boxHeight = 16;
    const boxX = xPixel - boxWidth / 2;
    const boxY = top - 18; // Shifting above top grid line
    
    ctx.fillStyle = 'rgba(234, 88, 12, 0.9)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 3);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, xPixel, boxY + boxHeight / 2);
    
    const atmLabel = 'ATM';
    const atmTextWidth = ctx.measureText(atmLabel).width;
    const atmBoxWidth = atmTextWidth + 8;
    const atmBoxHeight = 14;
    const atmBoxX = xPixel - atmBoxWidth / 2;
    const atmBoxY = top - 35; // Shifting above SPOT label box
    
    ctx.fillStyle = 'rgba(37, 99, 235, 0.9)';
    ctx.beginPath();
    ctx.roundRect(atmBoxX, atmBoxY, atmBoxWidth, atmBoxHeight, 3);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(atmLabel, xPixel, atmBoxY + atmBoxHeight / 2);
    
    ctx.restore();
  }
};

const appRatioTicksPlugin = {
  id: 'appRatioTicks',
  afterDraw(chart) {
    if (!chart.config.options || !chart.config.options.ratioData) return;
    const { strikes, data1, data2 } = chart.config.options.ratioData;
    if (!strikes || !data1 || !data2) return;

    const { ctx, chartArea, scales: { x } } = chart;
    if (!x) return;

    ctx.save();
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';

    const ratioY = x.bottom + 26;

    strikes.forEach((s, idx) => {
      const xPixel = x.getPixelForTick(idx);
      if (xPixel === undefined || xPixel === null) return;
      if (xPixel < chartArea.left - 10 || xPixel > chartArea.right + 10) return;

      const ratioStr = calculateRatio(data1[idx], data2[idx]);
      ctx.fillText(ratioStr, xPixel, ratioY);
    });

    ctx.restore();
  }
};

function calculateRatio(val1, val2) {
  const v1 = Math.abs(val1 || 0);
  const v2 = Math.abs(val2 || 0);
  if (v1 === 0 && v2 === 0) return '1:1';
  if (v1 === 0 || v2 === 0) {
    const nonZero = Math.max(v1, v2);
    return nonZero > 0 ? '>99:1' : '1:1';
  }
  const bigger = Math.max(v1, v2);
  const smaller = Math.min(v1, v2);
  const ratio = bigger / smaller;
  const ratioStr = (ratio % 1 === 0) ? ratio.toFixed(0) : ratio.toFixed(1);
  return `${ratioStr}:1`;
}

function renderVerticalChart(oiList, atmStrike) {
  const strikes = oiList.map(item => item.strike_price.toString());
  const callsData = oiList.map(item => item.calls_change_oi);
  const putsData = oiList.map(item => item.puts_change_oi);
  
  const ctx = document.getElementById('oiVerticalChart').getContext('2d');
  
  if (oiVerticalChartInstance) {
    oiVerticalChartInstance.data.labels = strikes;
    oiVerticalChartInstance.data.datasets[0].data = callsData;
    oiVerticalChartInstance.data.datasets[1].data = putsData;
    
    oiVerticalChartInstance.options.scales.x.ticks.callback = function(val, idx) {
      const strikeVal = parseInt(strikes[idx]);
      return strikeVal === atmStrike ? `${strikeVal} (ATM)` : strikeVal.toString();
    };
    oiVerticalChartInstance.options.ratioData = { strikes, data1: callsData, data2: putsData };
    oiVerticalChartInstance.update();
    return;
  }
  
  oiVerticalChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: strikes,
      datasets: [
        {
          label: 'Call Change in OI',
          data: callsData,
          backgroundColor: function(context) {
            return context.raw >= 0 ? chartColors.callPos : chartColors.callNeg;
          },
          borderColor: function(context) {
            return context.raw >= 0 ? darkenHex(chartColors.callPos) : darkenHex(chartColors.callNeg);
          },
          borderWidth: 1,
          borderRadius: 3
        },
        {
          label: 'Put Change in OI',
          data: putsData,
          backgroundColor: function(context) {
            return context.raw >= 0 ? chartColors.putPos : chartColors.putNeg;
          },
          borderColor: function(context) {
            return context.raw >= 0 ? darkenHex(chartColors.putPos) : darkenHex(chartColors.putNeg);
          },
          borderWidth: 1,
          borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 45,
          bottom: 45
        }
      },
      ratioData: { strikes, data1: callsData, data2: putsData },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: false
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            lineWidth: 1
          },
          ticks: {
            color: '#94a3b8',
            font: {
              family: "'JetBrains Mono', monospace",
              weight: 600
            },
            padding: 4,
            callback: function(val, idx) {
              const strikeVal = parseInt(strikes[idx]);
              return strikeVal === atmStrike ? `${strikeVal} (ATM)` : strikeVal.toString();
            }
          }
        },
        y: {
          grace: '20%',
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            lineWidth: 1
          },
          ticks: {
            color: '#94a3b8',
            font: {
              family: "'JetBrains Mono', monospace"
            },
            callback: function(value) {
              return formatOI(value);
            }
          }
        }
      }
    },
    plugins: [datalabelsPlugin, spotLinePlugin, appRatioTicksPlugin]
  });
}

// ============================================================
// Volume Bar Chart (calls_volume + puts_volume)
// ============================================================
function renderVolumeChart(oiList, atmStrike) {
  const strikes    = oiList.map(item => item.strike_price.toString());
  const callsVol   = oiList.map(item => item.calls_volume || 0);
  const putsVol    = oiList.map(item => item.puts_volume  || 0);

  const ctx = document.getElementById('volumeChart').getContext('2d');

  if (volumeChartInstance) {
    volumeChartInstance.data.labels = strikes;
    volumeChartInstance.data.datasets[0].data = callsVol;
    volumeChartInstance.data.datasets[1].data = putsVol;
    volumeChartInstance.options.scales.x.ticks.callback = function(val, idx) {
      const s = parseInt(strikes[idx]);
      return s === atmStrike ? `${s} (ATM)` : s.toString();
    };
    volumeChartInstance.options.ratioData = { strikes, data1: callsVol, data2: putsVol };
    volumeChartInstance.update();
    return;
  }

  volumeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: strikes,
      datasets: [
        {
          label: 'Call Volume',
          data: callsVol,
          backgroundColor: chartColors.callPos + 'bf',
          borderColor: darkenHex(chartColors.callPos),
          borderWidth: 1,
          borderRadius: 3
        },
        {
          label: 'Put Volume',
          data: putsVol,
          backgroundColor: chartColors.putPos + 'bf',
          borderColor: darkenHex(chartColors.putPos),
          borderWidth: 1,
          borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 45, bottom: 45 } },
      ratioData: { strikes, data1: callsVol, data2: putsVol },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)', lineWidth: 1 },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", weight: 600 },
            padding: 4,
            callback: function(val, idx) {
              const s = parseInt(strikes[idx]);
              return s === atmStrike ? `${s} (ATM)` : s.toString();
            }
          }
        },
        y: {
          grace: '20%',
          grid: { color: 'rgba(255,255,255,0.05)', lineWidth: 1 },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace" },
            callback: function(v) { return formatOI(v); }
          }
        }
      }
    },
    plugins: [datalabelsPlugin, spotLinePlugin, appRatioTicksPlugin]
  });
}

