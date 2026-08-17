const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.get('/api/spot-data', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'NIFTY 50';
    const exchange = req.query.exchange || 'nse';
    const url = `https://webapi.niftytrader.in/webapi/symbol/today-spot-data?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`NiftyTrader Spot API returned status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching spot data:', error.message);
    res.status(500).json({ error: 'Failed to fetch spot data', details: error.message });
  }
});

app.get('/api/oi-data', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'nifty';
    const startTime = req.query.start_time || '09:10:00';
    const endTime = req.query.end_time || '15:40:00';
    const expiry = req.query.expiry || '';
    const exchange = req.query.exchange || 'nse';

    const oiUrl = `https://webapi.niftytrader.in/webapi/Option/oi-time-range?symbol=${symbol}&start_time=${startTime}&end_time=${endTime}&expiry=${expiry}&exchange=${exchange}`;
    const chainUrl = `https://webapi.niftytrader.in/webapi/option/option-chain-data?symbol=${encodeURIComponent(symbol.toLowerCase())}&expiryDate=${expiry}&exchange=${exchange.toUpperCase()}&atmBelow=0&atmAbove=0`;

    const [oiRes, chainRes] = await Promise.all([
      fetch(oiUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' } }),
      fetch(chainUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' } }).catch(() => null)
    ]);

    if (!oiRes.ok) {
      throw new Error(`NiftyTrader OI API returned status ${oiRes.status}`);
    }

    const oiData = await oiRes.json();

    if (chainRes && chainRes.ok && oiData && Array.isArray(oiData.resultData)) {
      try {
        const chainData = await chainRes.json();
        if (chainData && chainData.resultData && Array.isArray(chainData.resultData.opDatas)) {
          const ltpMap = new Map();
          chainData.resultData.opDatas.forEach(item => {
            ltpMap.set(item.strike_price, {
              calls_ltp: item.calls_ltp || (item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0),
              puts_ltp: item.puts_ltp || (item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0),
              calls_average_price: item.calls_average_price || item.calls_ltp || 0,
              puts_average_price: item.puts_average_price || item.puts_ltp || 0
            });
          });

          oiData.resultData.forEach(item => {
            const ltpInfo = ltpMap.get(item.strike_price);
            if (ltpInfo) {
              item.calls_ltp = ltpInfo.calls_ltp;
              item.puts_ltp = ltpInfo.puts_ltp;
              item.calls_average_price = ltpInfo.calls_average_price;
              item.puts_average_price = ltpInfo.puts_average_price;
            } else {
              item.calls_ltp = item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0;
              item.puts_ltp = item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0;
              item.calls_average_price = item.calls_ltp;
              item.puts_average_price = item.puts_ltp;
            }
          });
        }
      } catch (err) {
        console.warn('Failed to parse option chain data for LTP:', err.message);
      }
    } else if (oiData && Array.isArray(oiData.resultData)) {
      oiData.resultData.forEach(item => {
        item.calls_ltp = item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0;
        item.puts_ltp = item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0;
        item.calls_average_price = item.calls_ltp;
        item.puts_average_price = item.puts_ltp;
      });
    }

    res.json(oiData);
  } catch (error) {
    console.error('Error fetching OI data:', error.message);
    res.status(500).json({ error: 'Failed to fetch OI data', details: error.message });
  }
});

// MCX Commodities OI route (CRUDEOIL, CRUDEOILM) — uses change-oi-time-range endpoint + option-chain-data for volume & LTP
app.get('/api/mcx-oi-data', async (req, res) => {
  try {
    const symbol    = req.query.symbol    || 'CRUDEOIL';
    const startTime = req.query.start_time || '09:00:00';
    const endTime   = req.query.end_time   || '23:30:00';
    const expiry    = req.query.expiry || '';
    const exchange  = req.query.exchange || 'mcx';

    const oiUrl    = `https://webapi.niftytrader.in/webapi/Option/change-oi-time-range?symbol=${symbol}&start_time=${startTime}&end_time=${endTime}&expiry=${expiry}&exchange=${exchange}`;
    const chainUrl = `https://webapi.niftytrader.in/webapi/option/option-chain-data?symbol=${encodeURIComponent(symbol.toLowerCase())}&expiryDate=${expiry}&exchange=${exchange.toUpperCase()}&atmBelow=0&atmAbove=0`;

    const [oiRes, chainRes] = await Promise.all([
      fetch(oiUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' } }),
      fetch(chainUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' } }).catch(() => null)
    ]);

    if (!oiRes.ok) {
      throw new Error(`NiftyTrader MCX OI API returned status ${oiRes.status}`);
    }

    const oiData = await oiRes.json();

    if (chainRes && chainRes.ok && oiData && Array.isArray(oiData.resultData)) {
      try {
        const chainData = await chainRes.json();
        if (chainData && chainData.resultData && Array.isArray(chainData.resultData.opDatas)) {
          const infoMap = new Map();
          chainData.resultData.opDatas.forEach(item => {
            infoMap.set(item.strike_price, {
              calls_volume: item.calls_volume || 0,
              puts_volume: item.puts_volume || 0,
              calls_ltp: item.calls_ltp || (item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0),
              puts_ltp: item.puts_ltp || (item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0),
              calls_average_price: item.calls_average_price || item.calls_ltp || 0,
              puts_average_price: item.puts_average_price || item.puts_ltp || 0
            });
          });

          oiData.resultData.forEach(item => {
            const info = infoMap.get(item.strike_price);
            if (info) {
              item.calls_volume = info.calls_volume;
              item.puts_volume = info.puts_volume;
              item.calls_ltp = info.calls_ltp;
              item.puts_ltp = info.puts_ltp;
              item.calls_average_price = info.calls_average_price;
              item.puts_average_price = info.puts_average_price;
            } else {
              item.calls_ltp = item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0;
              item.puts_ltp = item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0;
              item.calls_average_price = item.calls_ltp;
              item.puts_average_price = item.puts_ltp;
            }
          });
        }
      } catch (err) {
        console.warn('Failed to merge MCX chain data:', err.message);
      }
    } else if (oiData && Array.isArray(oiData.resultData)) {
      oiData.resultData.forEach(item => {
        item.calls_ltp = item.calls_oi > 0 ? item.calls_oi_value / item.calls_oi : 0;
        item.puts_ltp = item.puts_oi > 0 ? item.puts_oi_value / item.puts_oi : 0;
        item.calls_average_price = item.calls_ltp;
        item.puts_average_price = item.puts_ltp;
      });
    }

    res.json(oiData);
  } catch (error) {
    console.error('Error fetching MCX OI data:', error.message);
    res.status(500).json({ error: 'Failed to fetch MCX OI data', details: error.message });
  }
});


// Delta Exchange HTML Route
app.get('/deltaexchange', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'deltaexchange.html'));
});

// Delta Exchange Symbol & Expiry List Proxy API
app.get('/api/delta/symbol-expiry-list', async (req, res) => {
  try {
    const url = 'https://webapi.niftytrader.in/webapi/Symbol/delta-symbol-expiry-list';
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });
    if (!response.ok) {
      throw new Error(`Delta symbol expiry list API returned status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching Delta symbol expiry list:', error.message);
    res.status(500).json({ error: 'Failed to fetch Delta symbol expiry list', details: error.message });
  }
});

// Delta Exchange Option Chain Proxy API
app.get('/api/delta/option-chain', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'btc';
    const expiryDate = req.query.expiryDate || '';
    const atmBelow = req.query.atmBelow || '0';
    const atmAbove = req.query.atmAbove || '0';

    const url = `https://webapi.niftytrader.in/webapi/Option/delta-option-chain?symbol=${encodeURIComponent(symbol)}&expiryDate=${encodeURIComponent(expiryDate)}&atmBelow=${atmBelow}&atmAbove=${atmAbove}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`Delta option chain API returned status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching Delta option chain:', error.message);
    res.status(500).json({ error: 'Failed to fetch Delta option chain', details: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
