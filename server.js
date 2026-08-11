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

    const url = `https://webapi.niftytrader.in/webapi/Option/oi-time-range?symbol=${symbol}&start_time=${startTime}&end_time=${endTime}&expiry=${expiry}&exchange=${exchange}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`NiftyTrader OI API returned status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching OI data:', error.message);
    res.status(500).json({ error: 'Failed to fetch OI data', details: error.message });
  }
});

// MCX Commodities OI route (CRUDEOIL, CRUDEOILM) — uses change-oi-time-range endpoint
app.get('/api/mcx-oi-data', async (req, res) => {
  try {
    const symbol    = req.query.symbol    || 'CRUDEOIL';
    const startTime = req.query.start_time || '09:00:00';
    const endTime   = req.query.end_time   || '23:30:00';
    const expiry = req.query.expiry || '';
    const exchange = req.query.exchange || 'mcx';

    const url = `https://webapi.niftytrader.in/webapi/Option/change-oi-time-range?symbol=${symbol}&start_time=${startTime}&end_time=${endTime}&expiry=${expiry}&exchange=${exchange}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`NiftyTrader MCX OI API returned status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching MCX OI data:', error.message);
    res.status(500).json({ error: 'Failed to fetch MCX OI data', details: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
