// Delta Exchange Crypto Options JS Engine
document.addEventListener('DOMContentLoaded', () => {
  let symbolExpiriesMap = {}; // Maps Symbol -> Array of expiry date strings
  let currentSymbol = 'BTC';
  let currentExpiry = '';
  let selectedStrikeCount = '20';
  let rawOptionChainItems = [];
  let totalOiChartInstance = null;
  let oiChartInstance = null;
  let volumeChartInstance = null;
  let butterflyOiChartInstance = null;

  const REFRESH_INTERVAL_SEC = 30;
  let countdown = REFRESH_INTERVAL_SEC;
  let refreshTimer = null;

  const DEFAULT_DELTA_COLORS = {
    calls: '#ef4444', // Red for Call OI
    puts: '#10b981'   // Green for Put OI
  };

  let deltaChartColors = { ...DEFAULT_DELTA_COLORS };

  // DOM Elements
  const symbolSelect        = document.getElementById('delta-symbol-select');
  const expirySelect        = document.getElementById('delta-expiry-select');
  const strikeRangeSelect   = document.getElementById('delta-strike-range-select');
  const btnRefresh          = document.getElementById('btn-manual-refresh');
  const spotPriceEl         = document.getElementById('delta-spot-price');
  const pcrEl               = document.getElementById('delta-pcr');
  const chgOiPcrEl          = document.getElementById('delta-chg-oi-pcr');
  const expRangeEl          = document.getElementById('delta-expected-range');
  const tableBodyEl         = document.getElementById('delta-table-body');
  
  const btnToggleColors     = document.getElementById('btn-toggle-delta-colors');
  const colorPanel          = document.getElementById('delta-color-picker-panel');
  const inputClrCalls       = document.getElementById('clr-delta-calls');
  const inputClrPuts        = document.getElementById('clr-delta-puts');
  const btnResetColors      = document.getElementById('btn-reset-delta-colors');
  const legendCallDot       = document.getElementById('delta-legend-call-dot');
  const legendPutDot        = document.getElementById('delta-legend-put-dot');
  const legendVolCallDot    = document.getElementById('delta-legend-vol-call-dot');
  const legendVolPutDot     = document.getElementById('delta-legend-vol-put-dot');

  // Initialize
  init();

  async function init() {
    initTheme();
    loadSavedColors();
    setupEventListeners();
    await fetchSymbolExpiryList();
  }

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

    updateChartsTheme();
  }

  function updateChartsTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';
    const tickColor = isLight ? '#475569' : '#94a3b8';

    [totalOiChartInstance, volumeChartInstance, butterflyOiChartInstance].forEach(chart => {
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

  function loadSavedColors() {
    try {
      const saved = localStorage.getItem('delta_chart_colors');
      if (saved) {
        deltaChartColors = { ...DEFAULT_DELTA_COLORS, ...JSON.parse(saved) };
      }
    } catch (e) {
      deltaChartColors = { ...DEFAULT_DELTA_COLORS };
    }
  }

  function saveColors() {
    try {
      localStorage.setItem('delta_chart_colors', JSON.stringify(deltaChartColors));
    } catch (e) {}
  }

  function applyColors() {
    if (inputClrCalls) inputClrCalls.value = deltaChartColors.calls;
    if (inputClrPuts)  inputClrPuts.value  = deltaChartColors.puts;

    if (legendVolCallDot) legendVolCallDot.style.background = deltaChartColors.calls;
    if (legendVolPutDot)  legendVolPutDot.style.background  = deltaChartColors.puts;

    const totalCallDot = document.getElementById('delta-legend-total-call-dot');
    if (totalCallDot) totalCallDot.style.background = deltaChartColors.calls;
    const totalPutDot = document.getElementById('delta-legend-total-put-dot');
    if (totalPutDot) totalPutDot.style.background = deltaChartColors.puts;

    const butterflyCallDot = document.getElementById('delta-legend-butterfly-call-dot');
    if (butterflyCallDot) butterflyCallDot.style.background = deltaChartColors.calls;
    const butterflyPutDot = document.getElementById('delta-legend-butterfly-put-dot');
    if (butterflyPutDot) butterflyPutDot.style.background = deltaChartColors.puts;

    [totalOiChartInstance, volumeChartInstance, butterflyOiChartInstance].forEach(chart => {
      if (!chart) return;
      if (chart.data && chart.data.datasets && chart.data.datasets.length >= 2) {
        chart.data.datasets[0].backgroundColor = deltaChartColors.calls;
        chart.data.datasets[0].borderColor = deltaChartColors.calls;
        chart.data.datasets[1].backgroundColor = deltaChartColors.puts;
        chart.data.datasets[1].borderColor = deltaChartColors.puts;
      }
      chart.update();
    });

    saveColors();
  }

  function setupEventListeners() {
    symbolSelect.addEventListener('change', (e) => {
      currentSymbol = e.target.value;
      populateExpiries(currentSymbol);
      fetchOptionChain();
    });

    expirySelect.addEventListener('change', (e) => {
      currentExpiry = e.target.value;
      fetchOptionChain();
    });

    if (strikeRangeSelect) {
      strikeRangeSelect.addEventListener('change', (e) => {
        selectedStrikeCount = e.target.value;
        filterAndRender();
      });
    }

    if (btnToggleColors && colorPanel) {
      btnToggleColors.addEventListener('click', () => {
        const isOpen = colorPanel.style.display === 'flex';
        colorPanel.style.display = isOpen ? 'none' : 'flex';
        btnToggleColors.style.background = isOpen
          ? 'rgba(99,102,241,0.15)'
          : 'rgba(99,102,241,0.35)';
      });
    }

    if (inputClrCalls) {
      inputClrCalls.addEventListener('input', (e) => {
        deltaChartColors.calls = e.target.value;
        applyColors();
      });
    }

    if (inputClrPuts) {
      inputClrPuts.addEventListener('input', (e) => {
        deltaChartColors.puts = e.target.value;
        applyColors();
      });
    }

    if (btnResetColors) {
      btnResetColors.addEventListener('click', () => {
        deltaChartColors = { ...DEFAULT_DELTA_COLORS };
        try { localStorage.removeItem('delta_chart_colors'); } catch(e) {}
        applyColors();
      });
    }

    btnRefresh.addEventListener('click', () => {
      fetchOptionChain();
    });
  }

  function startAutoRefreshTimer() {
    clearInterval(refreshTimer);
    countdown = REFRESH_INTERVAL_SEC;
    updateTimerUI();

    refreshTimer = setInterval(() => {
      countdown--;
      updateTimerUI();

      if (countdown <= 0) {
        clearInterval(refreshTimer);
        fetchOptionChain();
      }
    }, 1000);
  }

  function updateTimerUI() {
    const countdownEl = document.getElementById('delta-timer-countdown');
    if (countdownEl) {
      countdownEl.textContent = countdown;
    }
  }

  // Fetch Symbol Expiry List from backend proxy
  async function fetchSymbolExpiryList() {
    try {
      const res = await fetch('/api/delta/symbol-expiry-list');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.result === 1 && Array.isArray(data.resultData)) {
        symbolExpiriesMap = {};
        
        data.resultData.forEach(item => {
          const sym = item.symbol_name.toUpperCase();
          // Extract date format YYYY-MM-DD from "2026-08-18T00:00:00"
          const expiryStr = item.expiry_date ? item.expiry_date.split('T')[0] : '';
          if (!symbolExpiriesMap[sym]) {
            symbolExpiriesMap[sym] = [];
          }
          if (expiryStr && !symbolExpiriesMap[sym].includes(expiryStr)) {
            symbolExpiriesMap[sym].push(expiryStr);
          }
        });

        // Update Symbol dropdown
        const symbols = Object.keys(symbolExpiriesMap);
        if (symbols.length > 0) {
          symbolSelect.innerHTML = symbols.map(s => `<option value="${s}" ${s === currentSymbol ? 'selected' : ''}>${s}</option>`).join('');
          if (!symbols.includes(currentSymbol)) {
            currentSymbol = symbols[0];
          }
        }

        populateExpiries(currentSymbol);
        await fetchOptionChain();
      }
    } catch (err) {
      console.error('Error fetching symbol expiry list:', err);
    }
  }

  // Populate Expiry Dates Dropdown for the selected symbol
  function populateExpiries(symbol) {
    const expiries = symbolExpiriesMap[symbol] || [];
    if (expiries.length === 0) {
      expirySelect.innerHTML = `<option value="">No Expiries Available</option>`;
      currentExpiry = '';
      return;
    }

    expirySelect.innerHTML = expiries.map(exp => {
      const formattedLabel = formatDateLabel(exp);
      return `<option value="${exp}">${formattedLabel}</option>`;
    }).join('');

    currentExpiry = expiries[0];
  }

  // Format YYYY-MM-DD to "18 Aug, 2026"
  function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00Z');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${day} ${month}, ${year}`;
  }

  // Fetch Option Chain for Selected Symbol & Expiry Date
  async function fetchOptionChain() {
    if (!currentSymbol || !currentExpiry) return;

    try {
      btnRefresh.textContent = '↻ Loading...';
      const res = await fetch(`/api/delta/option-chain?symbol=${currentSymbol.toLowerCase()}&expiryDate=${currentExpiry}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      btnRefresh.textContent = '↻ Refresh';

      if (data && data.result === 1 && Array.isArray(data.resultData) && data.resultData.length > 0) {
        processOptionChainData(data.resultData);
      } else {
        tableBodyEl.innerHTML = `<tr><td colspan="19" style="text-align:center; padding: 30px; color: var(--text-muted);">No option chain data available for ${currentSymbol} on ${currentExpiry}</td></tr>`;
      }
    } catch (err) {
      console.error('Error fetching option chain:', err);
      btnRefresh.textContent = '↻ Refresh';
      tableBodyEl.innerHTML = `<tr><td colspan="19" style="text-align:center; padding: 30px; color: #f87171;">Failed to load data. Please try again.</td></tr>`;
    } finally {
      startAutoRefreshTimer();
    }
  }

  // Process and Prepare Summary Metrics
  function processOptionChainData(items) {
    // Sort items by strike price ascending
    items.sort((a, b) => a.strike_price - b.strike_price);
    rawOptionChainItems = items;

    const firstItem = items[0];
    const spotPrice = firstItem.spot_price || 0;

    // Spot Price UI
    spotPriceEl.textContent = `$${spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Summary Totals over full chain
    let totalCallOiUsd = 0;
    let totalPutOiUsd  = 0;
    let totalCallChgOiUsd = 0;
    let totalPutChgOiUsd  = 0;
    let sumCallIv = 0, callIvCount = 0;

    items.forEach(item => {
      const callOiUsd = item.calls_oi_value_usd || 0;
      const putOiUsd  = item.puts_oi_value_usd || 0;
      totalCallOiUsd += callOiUsd;
      totalPutOiUsd  += putOiUsd;

      totalCallChgOiUsd += (item.calls_oi_change_usd_6h || 0);
      totalPutChgOiUsd  += (item.puts_oi_change_usd_6h || 0);

      if (item.calls_quotes_mark_iv > 0) {
        sumCallIv += item.calls_quotes_mark_iv;
        callIvCount++;
      }
    });

    // PCR Calculations
    const pcr = totalCallOiUsd > 0 ? totalPutOiUsd / totalCallOiUsd : 0;
    pcrEl.textContent = pcr.toFixed(4);

    const chgOiPcr = Math.abs(totalCallChgOiUsd) > 0 ? (totalPutChgOiUsd / totalCallChgOiUsd) : 0;
    chgOiPcrEl.textContent = isFinite(chgOiPcr) ? chgOiPcr.toFixed(4) : '0.0000';
    chgOiPcrEl.style.color = chgOiPcr >= 1 ? '#4ade80' : '#f87171';

    // Expected Range Calculation
    const avgIv = callIvCount > 0 ? (sumCallIv / callIvCount) : 0.45;
    const daysToExpiry = getDaysToExpiry(currentExpiry);
    const expectedMove = spotPrice * avgIv * Math.sqrt(Math.max(daysToExpiry, 0.25) / 365.0);
    const lowerRange = Math.round((spotPrice - expectedMove) / 100) * 100;
    const upperRange = Math.round((spotPrice + expectedMove) / 100) * 100;
    expRangeEl.textContent = `${lowerRange.toLocaleString()} - ${upperRange.toLocaleString()}`;

    // Filter and Render UI components
    filterAndRender();
  }

  // Filter strikes for Chart ONLY; Option Chain Table ALWAYS shows ALL strikes!
  function filterAndRender() {
    if (!rawOptionChainItems || rawOptionChainItems.length === 0) return;

    const firstItem = rawOptionChainItems[0];
    const spotPrice = firstItem.spot_price || 0;

    // Find ATM Strike
    let closestDiff = Infinity;
    let atmIndex = 0;
    let atmStrike = rawOptionChainItems[0].strike_price;

    rawOptionChainItems.forEach((item, index) => {
      const diff = Math.abs(item.strike_price - spotPrice);
      if (diff < closestDiff) {
        closestDiff = diff;
        atmIndex = index;
        atmStrike = item.strike_price;
      }
    });

    let displayChartItems = rawOptionChainItems;

    if (selectedStrikeCount !== 'all') {
      const targetCount = parseInt(selectedStrikeCount, 10);
      const half = Math.floor(targetCount / 2);

      let startIdx = Math.max(0, atmIndex - half);
      let endIdx = startIdx + targetCount;

      if (endIdx > rawOptionChainItems.length) {
        endIdx = rawOptionChainItems.length;
        startIdx = Math.max(0, endIdx - targetCount);
      }

      displayChartItems = rawOptionChainItems.slice(startIdx, endIdx);
    }

    // Render Chart with filtered items
    renderCharts(displayChartItems, spotPrice, atmStrike);

    // Option Chain Table ALWAYS shows ALL strikes (rawOptionChainItems)
    renderOptionChainTable(rawOptionChainItems, spotPrice, atmStrike);

    // Apply color settings to chart and legend
    applyColors();
  }

  // Calculate Days to Expiry
  function getDaysToExpiry(expiryDateStr) {
    if (!expiryDateStr) return 1;
    const expDate = new Date(expiryDateStr + 'T23:59:59Z');
    const now = new Date();
    const diffMs = expDate - now;
    return Math.max(diffMs / (1000 * 60 * 60 * 24), 0.1);
  }

  // Render Total OI Contracts, Volume & Butterfly Total OI Bar Charts
  function renderCharts(items, spotPrice, atmStrike) {
    const strikes = items.map(i => i.strike_price);
    
    // Total OI Contracts (Positive for Calls, Negative for Puts in Butterfly chart)
    const callTotalOi = items.map(i => i.calls_oi_contracts || 0);
    const putTotalOi  = items.map(i => i.puts_oi_contracts || 0);
    const putTotalOiNeg = items.map(i => -(i.puts_oi_contracts || 0));

    // Volume Turnover USD
    const callVol = items.map(i => i.calls_turnover_usd || 0);
    const putVol  = items.map(i => i.puts_turnover_usd || 0);

    // Save globals for spot line plugin
    window.currentDeltaSpotPrice = spotPrice;
    window.currentDeltaStrikes = strikes;

    // 1. Total Open Interest (Contracts) Bar Chart
    const ctxTotalOi = document.getElementById('deltaTotalOiChart').getContext('2d');
    if (totalOiChartInstance) {
      totalOiChartInstance.data.labels = strikes;
      totalOiChartInstance.data.datasets[0].data = callTotalOi;
      totalOiChartInstance.data.datasets[1].data = putTotalOi;
      totalOiChartInstance.options.scales.x.ticks.callback = function(val, idx) {
        const s = strikes[idx];
        return s === atmStrike ? `${s} (ATM)` : `${s}`;
      };
      totalOiChartInstance.options.ratioData = { strikes, atmStrike, data1: callTotalOi, data2: putTotalOi };
      totalOiChartInstance.update();
    } else {
      totalOiChartInstance = new Chart(ctxTotalOi, {
        type: 'bar',
        data: {
          labels: strikes,
          datasets: [
            { 
              label: 'Call OI Contracts', 
              data: callTotalOi, 
              backgroundColor: deltaChartColors.calls, 
              borderColor: deltaChartColors.calls, 
              borderRadius: 4 
            },
            { 
              label: 'Put OI Contracts', 
              data: putTotalOi, 
              backgroundColor: deltaChartColors.puts, 
              borderColor: deltaChartColors.puts, 
              borderRadius: 4 
            }
          ]
        },
        options: getChartOptions(strikes, atmStrike, callTotalOi, putTotalOi),
        plugins: [deltaDatalabelsPlugin, deltaSpotLinePlugin, deltaRatioTicksPlugin]
      });
    }

    // 2. Volume Bar Chart
    const ctxVol = document.getElementById('deltaVolumeChart').getContext('2d');
    if (volumeChartInstance) {
      volumeChartInstance.data.labels = strikes;
      volumeChartInstance.data.datasets[0].data = callVol;
      volumeChartInstance.data.datasets[1].data = putVol;
      volumeChartInstance.options.scales.x.ticks.callback = function(val, idx) {
        const s = strikes[idx];
        return s === atmStrike ? `${s} (ATM)` : `${s}`;
      };
      volumeChartInstance.options.ratioData = { strikes, atmStrike, data1: callVol, data2: putVol };
      volumeChartInstance.update();
    } else {
      volumeChartInstance = new Chart(ctxVol, {
        type: 'bar',
        data: {
          labels: strikes,
          datasets: [
            { 
              label: 'Call Volume', 
              data: callVol, 
              backgroundColor: deltaChartColors.calls, 
              borderColor: deltaChartColors.calls, 
              borderRadius: 4 
            },
            { 
              label: 'Put Volume', 
              data: putVol, 
              backgroundColor: deltaChartColors.puts, 
              borderColor: deltaChartColors.puts, 
              borderRadius: 4 
            }
          ]
        },
        options: getChartOptions(strikes, atmStrike, callVol, putVol),
        plugins: [deltaDatalabelsPlugin, deltaSpotLinePlugin, deltaRatioTicksPlugin]
      });
    }

    // 3. Butterfly Total Open Interest (Contracts) Bar Chart (Unified Single Canvas 100% Mathematically Aligned)
    const callsMarkPrice = items.map(i => i.calls_mark_price || 0);
    const putsMarkPrice  = items.map(i => i.puts_mark_price || 0);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';
    const tickColor = isLight ? '#475569' : '#94a3b8';

    // Dynamically adjust Butterfly chart height based on strike count so rows never collapse!
    const butterflyCanvas = document.getElementById('deltaButterflyOiChart');
    if (butterflyCanvas && butterflyCanvas.parentElement) {
      const calcHeight = Math.max(strikes.length * 40 + 80, 500);
      butterflyCanvas.parentElement.style.height = `${calcHeight}px`;
    }

    const ctxButterfly = butterflyCanvas.getContext('2d');
    if (butterflyOiChartInstance) {
      butterflyOiChartInstance.data.labels = strikes;
      butterflyOiChartInstance.options.ratioData = { strikes, atmStrike, data1: callTotalOi, data2: putTotalOi, callsMarkPrice, putsMarkPrice };
      butterflyOiChartInstance.update();
    } else {
      butterflyOiChartInstance = new Chart(ctxButterfly, {
        type: 'bar',
        data: {
          labels: strikes,
          datasets: [{
            data: strikes.map(() => 0), // Dummy data to establish Y-scale ticks
            backgroundColor: 'transparent'
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { left: 10, right: 10, top: 15, bottom: 25 } },
          ratioData: { strikes, atmStrike, data1: callTotalOi, data2: putTotalOi, callsMarkPrice, putsMarkPrice },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: {
                color: tickColor,
                font: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' },
                callback: function(val) { return formatNumberCompact(Math.abs(val)); }
              }
            },
            y: {
              grid: { display: false },
              ticks: { display: false }
            }
          }
        },
        plugins: [deltaButterflyUnifiedPlugin]
      });
    }
  }

  function formatMarkPrice(val) {
    const v = Number(val) || 0;
    if (v === 0) return '$0';
    if (v >= 1000) {
      return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    return '$' + v.toFixed(2);
  }

  function calculateRatio(val1, val2) {
    const v1 = Math.abs(val1 || 0);
    const v2 = Math.abs(val2 || 0);
    if (v1 === 0 && v2 === 0) return '1';
    if (v1 === 0 || v2 === 0) {
      const nonZero = Math.max(v1, v2);
      return nonZero > 0 ? '>99' : '1';
    }
    const bigger = Math.max(v1, v2);
    const smaller = Math.min(v1, v2);
    const ratio = bigger / smaller;
    const ratioStr = (ratio % 1 === 0) ? ratio.toFixed(0) : ratio.toFixed(1);
    return `${ratioStr}`;
  }

  function getChartOptions(strikes, atmStrike, data1, data2) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';
    const tickColor = isLight ? '#475569' : '#94a3b8';

    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 45, bottom: 45 } },
      ratioData: { strikes, atmStrike, data1, data2 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' },
            padding: 4,
            callback: function(val, idx) {
              const s = strikes[idx];
              return s === atmStrike ? `${s} (ATM)` : `${s}`;
            }
          }
        },
        y: {
          grace: '20%',
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            callback: function(val) { return formatNumberCompact(val); }
          }
        }
      }
    };
  }

  function getButterflyChartOptions(strikes, atmStrike, data1, data2) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.05)';
    const tickColor = isLight ? '#475569' : '#94a3b8';

    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 55, right: 55, top: 15, bottom: 15 } },
      ratioData: { strikes, atmStrike, data1, data2 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grace: '15%',
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' },
            callback: function(val) { return formatNumberCompact(Math.abs(val)); }
          }
        },
        y: {
          grid: { display: false },
          ticks: { display: false }
        }
      }
    };
  }

  // Plugin to render ratio numbers with distinct color and 10px gap below strike prices
  const deltaRatioTicksPlugin = {
    id: 'deltaRatioTicks',
    afterDraw(chart) {
      if (!chart.config.options || !chart.config.options.ratioData) return;
      const { strikes, data1, data2 } = chart.config.options.ratioData;
      if (!strikes || !data1 || !data2) return;

      const { ctx, chartArea, scales: { x } } = chart;
      if (!x) return;

      ctx.save();
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
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

  // 100% Mathematically Aligned Unified Butterfly Chart Plugin
  const deltaButterflyUnifiedPlugin = {
    id: 'deltaButterflyUnified',
    afterDraw(chart) {
      if (!chart.config.options || !chart.config.options.ratioData) return;
      const { strikes, atmStrike, data1, data2, callsMarkPrice, putsMarkPrice } = chart.config.options.ratioData;
      if (!strikes || !data1 || !data2 || strikes.length === 0) return;

      const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
      if (!y) return;

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      ctx.save();

      const totalWidth = right - left;
      const centerX = left + totalWidth / 2;
      const gapWidth = 170; // 170px center gap
      const leftMargin = centerX - gapWidth / 2;
      const rightMargin = centerX + gapWidth / 2;

      const outerPadding = 115; // Space for OI number + 20px gap + Mark Price
      const leftAvailableWidth = leftMargin - (left + outerPadding);
      const rightAvailableWidth = (right - outerPadding) - rightMargin;

      const maxVal = Math.max(...data1, ...data2, 100);

      // 1. Draw Vertical Gap Boundaries (Dashed dividing lines)
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(leftMargin, top);
      ctx.lineTo(leftMargin, bottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rightMargin, top);
      ctx.lineTo(rightMargin, bottom);
      ctx.stroke();

      ctx.setLineDash([]);

      // Calculate bar height dynamically from tick spacing
      const tickSpacing = strikes.length > 1
        ? Math.abs(y.getPixelForTick(1) - y.getPixelForTick(0))
        : 35;
      const barHeight = Math.min(Math.max(tickSpacing * 0.72, 12), 32);
      const badgeHeight = Math.min(barHeight + 2, 30);
      const badgeWidth = gapWidth - 10; // 160px

      const markClr = isLight ? '#0284c7' : '#38bdf8'; // Distinct Cyan / Sky Blue for Mark Price

      // 2. Render each Strike Price row (Bars + Datalabels + Mark Price + Center Badge)
      strikes.forEach((s, idx) => {
        const yPixel = y.getPixelForTick(idx);
        if (yPixel === undefined || yPixel === null) return;
        if (yPixel < top - 10 || yPixel > bottom + 10) return;

        const isAtm = (s === atmStrike);
        const callVal = data1[idx] || 0;
        const putVal  = data2[idx] || 0;
        const ratioStr = calculateRatio(callVal, putVal);

        // A. Draw Left Call Bar (Starts at leftMargin, grows LEFTWARDS)
        if (callVal > 0) {
          const callWidth = Math.max((callVal / maxVal) * leftAvailableWidth, 3);
          const barX = leftMargin - callWidth;
          const barY = yPixel - barHeight / 2;

          let callClr = deltaChartColors.calls;
          if (isLight && callClr === '#ef4444') callClr = '#dc2626';

          ctx.fillStyle = callClr;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(barX, barY, callWidth, barHeight, 4);
          } else {
            ctx.rect(barX, barY, callWidth, barHeight);
          }
          ctx.fill();

          // Left Call OI Datalabel
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = callClr;
          const callOiText = formatNumberCompact(callVal);
          const callOiX = barX - 6;
          ctx.fillText(callOiText, callOiX, yPixel);

          // Left Call Mark Price (20px gap to the left of OI text in Cyan / Sky Blue)
          if (callsMarkPrice && callsMarkPrice[idx] !== undefined) {
            const callOiWidth = ctx.measureText(callOiText).width;
            const callMarkX = callOiX - callOiWidth - 20; // 20px gap!
            const callMarkText = formatMarkPrice(callsMarkPrice[idx]);

            ctx.fillStyle = markClr;
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.fillText(callMarkText, callMarkX, yPixel);
          }
        }

        // B. Draw Right Put Bar (Starts at rightMargin, grows RIGHTWARDS)
        if (putVal > 0) {
          const putWidth = Math.max((putVal / maxVal) * rightAvailableWidth, 3);
          const barX = rightMargin;
          const barY = yPixel - barHeight / 2;

          let putClr = deltaChartColors.puts;
          if (isLight && putClr === '#10b981') putClr = '#059669';

          ctx.fillStyle = putClr;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(barX, barY, putWidth, barHeight, 4);
          } else {
            ctx.rect(barX, barY, putWidth, barHeight);
          }
          ctx.fill();

          // Right Put OI Datalabel
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = putClr;
          const putOiText = formatNumberCompact(putVal);
          const putOiX = barX + putWidth + 6;
          ctx.fillText(putOiText, putOiX, yPixel);

          // Right Put Mark Price (20px gap to the right of OI text in Cyan / Sky Blue)
          if (putsMarkPrice && putsMarkPrice[idx] !== undefined) {
            const putOiWidth = ctx.measureText(putOiText).width;
            const putMarkX = putOiX + putOiWidth + 20; // 20px gap!
            const putMarkText = formatMarkPrice(putsMarkPrice[idx]);

            ctx.fillStyle = markClr;
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.fillText(putMarkText, putMarkX, yPixel);
          }
        }

        // C. Draw Center Column Badge (Centered at exact same yPixel!)
        const bX = centerX - badgeWidth / 2;
        const bY = yPixel - badgeHeight / 2;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bX, bY, badgeWidth, badgeHeight, 6);
        } else {
          ctx.rect(bX, bY, badgeWidth, badgeHeight);
        }

        if (isAtm) {
          ctx.fillStyle = isLight ? '#ffedd5' : '#1e1b4b';
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = isLight ? '#ffffff' : '#0f172a';
          ctx.strokeStyle = isLight ? '#cbd5e1' : '#334155';
          ctx.lineWidth = 1.2;
          ctx.fill();
          ctx.stroke();
        }

        // Strike Price (Left side of center badge)
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isAtm ? (isLight ? '#c2410c' : '#fb923c') : (isLight ? '#0f172a' : '#f8fafc');
        const strikeText = isAtm ? `${s} ATM` : `${s}`;
        ctx.fillText(strikeText, bX + 8, yPixel);

        // Ratio Number (Right side of center badge in 15px Bold Amber Gold)
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
        ctx.fillText(ratioStr, bX + badgeWidth - 8, yPixel);
      });

      // 3. Horizontal Spot Price Line (if applicable)
      if (window.currentDeltaSpotPrice && window.currentDeltaStrikes) {
        const spot = window.currentDeltaSpotPrice;
        const strikesArr = window.currentDeltaStrikes;
        let idxA = -1, idxB = -1;
        for (let i = 0; i < strikesArr.length - 1; i++) {
          if (spot >= strikesArr[i] && spot <= strikesArr[i + 1]) {
            idxA = i;
            idxB = i + 1;
            break;
          }
        }
        if (idxA !== -1 && idxB !== -1) {
          const yA = y.getPixelForTick(idxA);
          const yB = y.getPixelForTick(idxB);
          const frac = (spot - strikesArr[idxA]) / (strikesArr[idxB] - strikesArr[idxA]);
          const spotY = yA + frac * (yB - yA);
          if (spotY >= top && spotY <= bottom) {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(left, spotY);
            ctx.lineTo(right, spotY);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      ctx.restore();
    }
  };

  // Data Labels Plugin for Delta Exchange Bar Chart
  const deltaDatalabelsPlugin = {
    id: 'deltaDatalabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;

        meta.data.forEach((bar, index) => {
          const val = dataset.data[index];
          if (val === undefined || val === null || val === 0) return;

          const label = formatNumberCompact(Math.abs(val));
          const isPositive = val >= 0;
          const padding = 6;
          ctx.textBaseline = isPositive ? 'bottom' : 'top';
          const yPos = isPositive ? bar.y - padding : bar.y + padding;

          let fillClr = datasetIndex === 0 ? deltaChartColors.calls : deltaChartColors.puts;
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          if (isLight) {
            if (fillClr === '#ef4444') fillClr = '#dc2626';
            if (fillClr === '#10b981') fillClr = '#059669';
          }
          ctx.fillStyle = fillClr;
          ctx.fillText(label, bar.x, yPos);
        });
      });
      ctx.restore();
    }
  };

  // Center Column Ticks Plugin for Butterfly Horizontal Chart (Strike + Ratio)
  const deltaButterflyCenterTicksPlugin = {
    id: 'deltaButterflyCenterTicks',
    afterDatasetsDraw(chart) {
      if (!chart.config.options || !chart.config.options.ratioData) return;
      const { strikes, atmStrike, data1, data2 } = chart.config.options.ratioData;
      if (!strikes || !data1 || !data2) return;

      const { ctx, chartArea: { top, bottom }, scales: { x, y } } = chart;
      if (!x || !y) return;

      const centerX = x.getPixelForValue(0);
      if (centerX === undefined || centerX === null) return;

      ctx.save();
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';

      // Vertical center dividing line
      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(centerX, top);
      ctx.lineTo(centerX, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      const badgeWidth = 150;  // 150px wide center column gap
      const badgeHeight = 28; // Taller badge for double height bars
      const radius = 6;

      strikes.forEach((s, idx) => {
        const yPixel = y.getPixelForTick(idx);
        if (yPixel === undefined || yPixel === null) return;
        if (yPixel < top - 10 || yPixel > bottom + 10) return;

        const isAtm = (s === atmStrike);
        const ratioStr = calculateRatio(data1[idx], data2[idx]);

        const bX = centerX - badgeWidth / 2;
        const bY = yPixel - badgeHeight / 2;

        // Opaque Center Box to create clean gap between Left and Right bars
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bX, bY, badgeWidth, badgeHeight, radius);
        } else {
          ctx.rect(bX, bY, badgeWidth, badgeHeight);
        }

        if (isAtm) {
          ctx.fillStyle = isLight ? '#ffedd5' : '#1e1b4b'; // Opaque background
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = isLight ? '#ffffff' : '#0f172a'; // Opaque dark/light box
          ctx.strokeStyle = isLight ? '#cbd5e1' : '#334155';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
        }

        // Draw Strike Price (Left side of center box)
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isAtm ? (isLight ? '#c2410c' : '#fb923c') : (isLight ? '#0f172a' : '#f8fafc');
        const strikeText = isAtm ? `${s} ATM` : `${s}`;
        ctx.fillText(strikeText, bX + 10, yPixel);

        // Draw Ratio Number (Right side of center box in 15px Bold Amber Gold)
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
        ctx.fillText(ratioStr, bX + badgeWidth - 10, yPixel);
      });

      ctx.restore();
    }
  };

  // Outer Data Labels Plugin for Butterfly Horizontal Chart
  const deltaButterflyDatalabelsPlugin = {
    id: 'deltaButterflyDatalabels',
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x } } = chart;
      if (!x) return;

      ctx.save();
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;

        meta.data.forEach((bar, index) => {
          const val = dataset.data[index];
          if (val === undefined || val === null || val === 0) return;

          const label = formatNumberCompact(Math.abs(val));
          const isLeft = val < 0; // Call bar extends left
          const padding = 6;

          let fillClr = datasetIndex === 0 ? deltaChartColors.calls : deltaChartColors.puts;
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          if (isLight) {
            if (fillClr === '#ef4444') fillClr = '#dc2626';
            if (fillClr === '#10b981') fillClr = '#059669';
          }
          ctx.fillStyle = fillClr;

          if (isLeft) {
            ctx.textAlign = 'right';
            ctx.fillText(label, bar.x - padding, bar.y);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(label, bar.x + padding, bar.y);
          }
        });
      });
      ctx.restore();
    }
  };

  // Spot Line & ATM Badges Plugin for Delta Exchange
  const deltaSpotLinePlugin = {
    id: 'deltaSpotLine',
    afterDraw(chart) {
      const { ctx, chartArea: { top, bottom, left, right }, scales: { x, y } } = chart;
      if (!window.currentDeltaSpotPrice || !window.currentDeltaStrikes) return;

      const spot = window.currentDeltaSpotPrice;
      const strikes = window.currentDeltaStrikes;

      let idxA = -1;
      let idxB = -1;
      for (let i = 0; i < strikes.length - 1; i++) {
        if (spot >= strikes[i] && spot <= strikes[i + 1]) {
          idxA = i;
          idxB = i + 1;
          break;
        }
      }

      // Check if chart is horizontal (Butterfly)
      if (chart.config.options && chart.config.options.indexAxis === 'y') {
        if (idxA !== -1 && idxB !== -1 && y) {
          const yA = y.getPixelForTick(idxA);
          const yB = y.getPixelForTick(idxB);
          const ratio = (spot - strikes[idxA]) / (strikes[idxB] - strikes[idxA]);
          const yPixel = yA + ratio * (yB - yA);

          if (yPixel >= top && yPixel <= bottom) {
            ctx.save();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(left, yPixel);
            ctx.lineTo(right, yPixel);
            ctx.stroke();
            ctx.restore();
          }
        }
        return;
      }

      // Standard Vertical Chart Spot Line
      if (!x) return;

      let xPixel = null;
      if (idxA !== -1 && idxB !== -1) {
        const pixelA = x.getPixelForTick(idxA);
        const pixelB = x.getPixelForTick(idxB);
        const fraction = (spot - strikes[idxA]) / (strikes[idxB] - strikes[idxA]);
        xPixel = pixelA + (pixelB - pixelA) * fraction;
      } else {
        let closestDiff = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < strikes.length; i++) {
          const d = Math.abs(strikes[i] - spot);
          if (d < closestDiff) {
            closestDiff = d;
            closestIdx = i;
          }
        }
        if (closestIdx !== -1) {
          xPixel = x.getPixelForTick(closestIdx);
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

      const label = `SPOT: ${spot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      ctx.font = 'bold 9px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const textWidth = ctx.measureText(label).width;
      const boxWidth = textWidth + 10;
      const boxHeight = 16;
      const boxX = xPixel - boxWidth / 2;
      const boxY = top - 18;

      ctx.fillStyle = 'rgba(234, 88, 12, 0.95)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 3);
      } else {
        ctx.rect(boxX, boxY, boxWidth, boxHeight);
      }
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, xPixel, boxY + boxHeight / 2);

      const atmLabel = 'ATM';
      const atmTextWidth = ctx.measureText(atmLabel).width;
      const atmBoxWidth = atmTextWidth + 10;
      const atmBoxHeight = 14;
      const atmBoxX = xPixel - atmBoxWidth / 2;
      const atmBoxY = top - 35;

      ctx.fillStyle = 'rgba(37, 99, 235, 0.95)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(atmBoxX, atmBoxY, atmBoxWidth, atmBoxHeight, 3);
      } else {
        ctx.rect(atmBoxX, atmBoxY, atmBoxWidth, atmBoxHeight);
      }
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(atmLabel, xPixel, atmBoxY + atmBoxHeight / 2);

      ctx.restore();
    }
  };

  // Render Full Option Chain Table
  function renderOptionChainTable(items, spotPrice, atmStrike) {
    tableBodyEl.innerHTML = items.map(item => {
      const strike = item.strike_price;
      const isAtm = strike === atmStrike;
      const isCallItm = strike < spotPrice;
      const isPutItm  = strike > spotPrice;

      const rowClass = isAtm ? 'atm-row' : '';
      const callTdClass = isCallItm ? 'calls-itm' : '';
      const putTdClass  = isPutItm ? 'puts-itm' : '';

      // CALLS DATA
      const callDelta = item.calls_greeks_delta !== undefined ? item.calls_greeks_delta.toFixed(4) : '-';
      const callTheta = item.calls_greeks_theta !== undefined ? item.calls_greeks_theta.toFixed(4) : '-';
      const callBuiltupHtml = formatBuiltupBadge(item.calls_builtup);
      const callVolStr = formatUsd(item.calls_turnover_usd || 0);
      const callOiStr  = formatUsd(item.calls_oi_value_usd || 0);
      const callChgOiHtml = formatChgOiHtml(item.calls_oi_change_usd_6h);

      const callMarkPrice = item.calls_mark_price || 0;
      const callMarkIv = item.calls_quotes_mark_iv ? (item.calls_quotes_mark_iv * 100).toFixed(2) + '%' : '-';
      const callMarkPriceIvStr = `$${callMarkPrice.toFixed(2)} / ${callMarkIv}`;

      const call24hMarkChgHtml = formatChgPercentHtml(item.calls_mark_change_24h);
      const callLtp = item.calls_close || 0;
      const callLtpChgHtml = formatLtpChgHtml(callLtp, item.calls_ltp_change_24h);

      // PUTS DATA
      const putLtp = item.puts_close || 0;
      const putLtpChgHtml = formatLtpChgHtml(putLtp, item.puts_ltp_change_24h);
      const put24hMarkChgHtml = formatChgPercentHtml(item.puts_mark_change_24h);

      const putMarkPrice = item.puts_mark_price || 0;
      const putMarkIv = item.puts_quotes_mark_iv ? (item.puts_quotes_mark_iv * 100).toFixed(2) + '%' : '-';
      const putMarkPriceIvStr = `$${putMarkPrice.toFixed(2)} / ${putMarkIv}`;

      const putChgOiHtml = formatChgOiHtml(item.puts_oi_change_usd_6h);
      const putOiStr  = formatUsd(item.puts_oi_value_usd || 0);
      const putVolStr = formatUsd(item.puts_turnover_usd || 0);
      const putBuiltupHtml = formatBuiltupBadge(item.puts_builtup);
      const putTheta = item.puts_greeks_theta !== undefined ? item.puts_greeks_theta.toFixed(4) : '-';
      const putDelta = item.puts_greeks_delta !== undefined ? item.puts_greeks_delta.toFixed(4) : '-';

      return `
        <tr class="${rowClass}">
          <!-- CALLS -->
          <td class="${callTdClass}">${callDelta}</td>
          <td class="${callTdClass} text-muted">${callTheta}</td>
          <td class="${callTdClass}">${callBuiltupHtml}</td>
          <td class="${callTdClass}" style="color: #fbbf24;">${callVolStr}</td>
          <td class="${callTdClass}">${callOiStr}</td>
          <td class="${callTdClass}">${callChgOiHtml}</td>
          <td class="${callTdClass}">${callMarkPriceIvStr}</td>
          <td class="${callTdClass}">${call24hMarkChgHtml}</td>
          <td class="${callTdClass}">${callLtpChgHtml}</td>

          <!-- STRIKE -->
          <td class="strike-cell">${strike.toLocaleString()} ${isAtm ? '<span style="color:#6366f1; font-size:0.65rem;">(ATM)</span>' : ''}</td>

          <!-- PUTS -->
          <td class="${putTdClass}">${putLtpChgHtml}</td>
          <td class="${putTdClass}">${put24hMarkChgHtml}</td>
          <td class="${putTdClass}">${putMarkPriceIvStr}</td>
          <td class="${putTdClass}">${putChgOiHtml}</td>
          <td class="${putTdClass}">${putOiStr}</td>
          <td class="${putTdClass}" style="color: #fbbf24;">${putVolStr}</td>
          <td class="${putTdClass}">${putBuiltupHtml}</td>
          <td class="${putTdClass} text-muted">${putTheta}</td>
          <td class="${putTdClass}">${putDelta}</td>
        </tr>
      `;
    }).join('');
  }

  // Formatting Utilities
  function formatUsd(val) {
    if (!val || isNaN(val)) return '$0';
    const absVal = Math.abs(val);
    if (absVal >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
    if (absVal >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
    if (absVal >= 1e3) return `$${(val / 1e3).toFixed(2)}K`;
    return `$${val.toFixed(2)}`;
  }

  function formatNumberCompact(val) {
    if (!val || isNaN(val)) return '0';
    const absVal = Math.abs(val);
    if (absVal >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (absVal >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (absVal >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
    return `${val.toFixed(2)}`;
  }

  function formatChgOiHtml(val) {
    if (val === undefined || val === null || isNaN(val)) return '-';
    const sign = val > 0 ? '+' : '';
    const colorClass = val >= 0 ? 'text-green' : 'text-red';
    return `<span class="${colorClass}">${sign}${formatUsd(val)}</span>`;
  }

  function formatChgPercentHtml(val) {
    if (val === undefined || val === null || isNaN(val)) return '-';
    const sign = val > 0 ? '+' : '';
    const colorClass = val >= 0 ? 'text-green' : 'text-red';
    return `<span class="${colorClass}">${sign}${val.toFixed(2)}%</span>`;
  }

  function formatLtpChgHtml(ltp, chgPct) {
    const ltpStr = `$${(ltp || 0).toFixed(2)}`;
    if (chgPct === undefined || chgPct === null || isNaN(chgPct)) {
      return ltpStr;
    }
    const sign = chgPct > 0 ? '+' : '';
    const colorClass = chgPct >= 0 ? 'text-green' : 'text-red';
    return `<div>${ltpStr}</div><div class="${colorClass}" style="font-size:0.68rem;">(${sign}${chgPct.toFixed(2)}%)</div>`;
  }

  function formatBuiltupBadge(builtupStr) {
    if (!builtupStr) return '<span class="text-muted">-</span>';

    let badgeClass = 'buying';
    let label = builtupStr;

    if (builtupStr.includes('Buying')) {
      badgeClass = 'buying';
      label = builtupStr;
    } else if (builtupStr.includes('Writing')) {
      badgeClass = 'writing-green';
      label = builtupStr;
    } else if (builtupStr.includes('Covering') || builtupStr.includes('Short Cvr')) {
      badgeClass = 'covering';
      label = builtupStr.replace('Covering', 'Cvr');
    } else if (builtupStr.includes('Unwinding')) {
      badgeClass = 'unwinding';
      label = builtupStr;
    }

    return `<span class="builtup-badge ${badgeClass}">${label}</span>`;
  }

});
