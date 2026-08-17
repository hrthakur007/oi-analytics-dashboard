// Delta Exchange Crypto Options JS Engine
document.addEventListener('DOMContentLoaded', () => {
  let symbolExpiriesMap = {}; // Maps Symbol -> Array of expiry date strings
  let currentSymbol = 'BTC';
  let currentExpiry = '';
  let selectedStrikeCount = '20';
  let rawOptionChainItems = [];
  let oiChartInstance = null;

  // DOM Elements
  const symbolSelect      = document.getElementById('delta-symbol-select');
  const expirySelect      = document.getElementById('delta-expiry-select');
  const strikeRangeSelect = document.getElementById('delta-strike-range-select');
  const btnRefresh        = document.getElementById('btn-manual-refresh');
  const spotPriceEl       = document.getElementById('delta-spot-price');
  const pcrEl             = document.getElementById('delta-pcr');
  const chgOiPcrEl        = document.getElementById('delta-chg-oi-pcr');
  const lotSizeEl         = document.getElementById('delta-lot-size');
  const expRangeEl        = document.getElementById('delta-expected-range');
  const tableBodyEl       = document.getElementById('delta-table-body');

  // Initialize
  init();

  async function init() {
    setupEventListeners();
    await fetchSymbolExpiryList();
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

    btnRefresh.addEventListener('click', () => {
      fetchOptionChain();
    });

    // Auto refresh every 2 minutes (120,000 ms)
    setInterval(() => {
      fetchOptionChain();
    }, 120000);
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
    }
  }

  // Process and Prepare Summary Metrics
  function processOptionChainData(items) {
    // Sort items by strike price ascending
    items.sort((a, b) => a.strike_price - b.strike_price);
    rawOptionChainItems = items;

    const firstItem = items[0];
    const spotPrice = firstItem.spot_price || 0;
    const lotSize   = firstItem.contract_value || 0.001;

    // Spot Price UI
    spotPriceEl.textContent = `$${spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Lot Size UI
    lotSizeEl.textContent = lotSize.toString();

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

  // Filter strikes based on strikeRangeSelect and render Chart + Table
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

    let displayItems = rawOptionChainItems;

    if (selectedStrikeCount !== 'all') {
      const targetCount = parseInt(selectedStrikeCount, 10);
      const half = Math.floor(targetCount / 2);

      let startIdx = Math.max(0, atmIndex - half);
      let endIdx = startIdx + targetCount;

      if (endIdx > rawOptionChainItems.length) {
        endIdx = rawOptionChainItems.length;
        startIdx = Math.max(0, endIdx - targetCount);
      }

      displayItems = rawOptionChainItems.slice(startIdx, endIdx);
    }

    // Render Chart and Table with filtered display items
    renderCharts(displayItems, spotPrice, atmStrike);
    renderOptionChainTable(displayItems, spotPrice, atmStrike);
  }

  // Calculate Days to Expiry
  function getDaysToExpiry(expiryDateStr) {
    if (!expiryDateStr) return 1;
    const expDate = new Date(expiryDateStr + 'T23:59:59Z');
    const now = new Date();
    const diffMs = expDate - now;
    return Math.max(diffMs / (1000 * 60 * 60 * 24), 0.1);
  }

  // Render Open Interest Bar Chart
  function renderCharts(items, spotPrice, atmStrike) {
    const strikes = items.map(i => i.strike_price);
    const callOi  = items.map(i => i.calls_oi_value_usd || 0);
    const putOi   = items.map(i => i.puts_oi_value_usd || 0);

    // Save globals for spot line plugin
    window.currentDeltaSpotPrice = spotPrice;
    window.currentDeltaStrikes = strikes;

    const ctxOi = document.getElementById('deltaOiChart').getContext('2d');
    if (oiChartInstance) {
      oiChartInstance.data.labels = strikes;
      oiChartInstance.data.datasets[0].data = callOi;
      oiChartInstance.data.datasets[1].data = putOi;
      oiChartInstance.options.scales.x.ticks.callback = function(val, idx) {
        const s = strikes[idx];
        return s === atmStrike ? `${s} (ATM)` : s;
      };
      oiChartInstance.update();
    } else {
      oiChartInstance = new Chart(ctxOi, {
        type: 'bar',
        data: {
          labels: strikes,
          datasets: [
            { 
              label: 'Call OI', 
              data: callOi, 
              backgroundColor: '#ef4444', // Red for Call OI (Resistance)
              borderColor: '#b91c1c', 
              borderRadius: 4 
            },
            { 
              label: 'Put OI', 
              data: putOi, 
              backgroundColor: '#10b981', // Green for Put OI (Support)
              borderColor: '#047857', 
              borderRadius: 4 
            }
          ]
        },
        options: getChartOptions(strikes, atmStrike),
        plugins: [deltaDatalabelsPlugin, deltaSpotLinePlugin]
      });
    }
  }

  function getChartOptions(strikes, atmStrike) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 45, bottom: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: function(val, idx) {
              const s = strikes[idx];
              return s === atmStrike ? `${s} (ATM)` : s;
            }
          }
        },
        y: {
          grace: '20%',
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: function(val) { return formatUsd(val); }
          }
        }
      }
    };
  }

  // Data Labels Plugin for Delta Exchange Bar Chart
  const deltaDatalabelsPlugin = {
    id: 'deltaDatalabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;

        meta.data.forEach((bar, index) => {
          const val = dataset.data[index];
          if (val === undefined || val === null || val === 0) return;

          const label = formatUsd(val);
          const isPositive = val >= 0;
          const padding = 6;
          ctx.textBaseline = isPositive ? 'bottom' : 'top';
          const yPos = isPositive ? bar.y - padding : bar.y + padding;

          // Dataset 0 = Call OI (Red #ff8080), Dataset 1 = Put OI (Green #80ffc2)
          ctx.fillStyle = datasetIndex === 0 ? '#ff8080' : '#80ffc2';
          ctx.fillText(label, bar.x, yPos);
        });
      });
      ctx.restore();
    }
  };

  // Spot Line & ATM Badges Plugin for Delta Exchange
  const deltaSpotLinePlugin = {
    id: 'deltaSpotLine',
    afterDraw(chart) {
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      if (!x || !window.currentDeltaSpotPrice || !window.currentDeltaStrikes) return;

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
