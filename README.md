# SignalBridge — Trade Copier

> Cloud webhook relay: receive TradingView alerts → route live orders to DX Trade, MT4/MT5, and Tradovate.

[![CI](https://github.com/brandononchain/tradecopy/actions/workflows/ci.yml/badge.svg)](https://github.com/brandononchain/tradecopy/actions)

---

## How It Works

```
TradingView Alert (POST JSON)
         │
         ▼
https://your-relay/hook/:token/signal
         │
    ┌────┴─────────────────────────────┐
    │  SignalBridge Relay              │
    │  1. Validate payload             │
    │  2. Deduplicate signal           │
    │  3. Check risk limits            │
    │  4. Map TV symbol → broker sym   │
    │  5. Fan-out to matching routes   │
    └────┬─────────────────────────────┘
         │
    ┌────┼──────────────────┐
    ▼    ▼                  ▼
DX Trade  MT4 / MT5     Tradovate
REST API  EA Bridge     REST API
```

---

## Quick Start

### 1. Clone & configure
```bash
git clone https://github.com/brandononchain/tradecopy.git
cd tradecopy
cp .env.example .env
# Fill in your broker credentials in .env
```

### 2. Install & run
```bash
npm install
npm start
# → http://localhost:3000
```

### 3. Set up TradingView alert

**Webhook URL:**
```
https://your-domain.com/hook/YOUR_TOKEN/signal
```

**Alert Message (JSON):**
```json
{
  "action":  "{{strategy.order.action}}",
  "symbol":  "{{ticker}}",
  "qty":     "{{strategy.order.contracts}}",
  "price":   "{{close}}",
  "sl":      "{{plot_0}}",
  "tp":      "{{plot_1}}",
  "comment": "{{strategy.order.comment}}"
}
```

---

## MT4 / MT5 Setup

1. Copy `ea/SignalBridge_EA_v2.mq5` → your `MQL5/Experts/` folder
2. Compile it in MetaEditor (F7)
3. Attach to any chart (e.g. EURUSD M1)
4. In EA Inputs set:
   - `ApiKey` = your SignalBridge API key
   - `RelayHost` = your relay hostname
5. In MT5: **Tools → Options → Expert Advisors → Allow WebRequests** for your relay domain

---

## Symbol Mapping

TradingView tickers are automatically translated to broker-specific symbols:

| TradingView | DX Trade | MT5     | Tradovate |
|-------------|----------|---------|-----------|
| `EURUSD`    | EURUSD   | EURUSD  | EUR/USD   |
| `NQ1!`      | NAS100   | NQ100   | NQU4      |
| `ES1!`      | US500    | SP500   | ESU4      |
| `XAUUSD`    | GOLD     | XAUUSD  | GCQ4      |
| `BTCUSD`    | BTC/USD  | BTCUSD  | BTCUSD    |
| `CL1!`      | USOIL    | USOIL   | CLQ4      |

Custom mappings can be added via the dashboard or `PUT /api/symbols`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `WEBHOOK_SECRET` | Secret for signing tokens |
| `MT5_RELAY_HOST` | MT5 bridge relay hostname |
| `MT5_API_KEY` | MT5 bridge API key |
| `DXTRADE_HOST` | DX Trade server URL |
| `DXTRADE_API_KEY` | DX Trade API key |
| `TRADOVATE_HOST` | Tradovate API base URL |
| `TRADOVATE_USERNAME` | Tradovate login |
| `TRADOVATE_PASSWORD` | Tradovate password |
| `TRADOVATE_APP_ID` | Tradovate app ID |
| `TRADOVATE_APP_SECRET` | Tradovate app secret |
| `TRADOVATE_ACCOUNT_SPEC` | Tradovate account spec |

---

## API Reference

### Webhook

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/hook/:token/signal` | Receive TradingView signal |
| `POST` | `/hook/:token/test` | Dry-run (no real orders) |

### Management API

All API routes require header `X-Api-Token: YOUR_TOKEN`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/routes` | List signal routes |
| `POST` | `/api/routes` | Create route |
| `PATCH` | `/api/routes/:id` | Update route |
| `DELETE` | `/api/routes/:id` | Delete route |
| `GET` | `/api/symbols` | Get symbol map |
| `POST` | `/api/symbols` | Add symbol mapping |
| `PUT` | `/api/symbols` | Replace entire symbol map |
| `DELETE` | `/api/symbols/:tv` | Remove symbol mapping |
| `GET` | `/api/connectors` | List connectors (masked) |
| `PUT` | `/api/connectors/:platform` | Update connector credentials |
| `POST` | `/api/connectors/:platform/test` | Test broker connection |
| `GET` | `/api/settings` | Get risk settings |
| `PATCH` | `/api/settings` | Update settings |
| `GET` | `/api/log` | Signal history |
| `GET` | `/api/stats` | Today's stats |
| `GET` | `/health` | Health check |

---

## Deploy

### Railway (recommended — 1 click)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

```bash
npm install -g @railway/cli
railway login
railway up
```

### Render
Connect this repo → New Web Service → `node src/server.js`

### Docker
```bash
docker build -t signalbridge .
docker run -p 3000:3000 --env-file .env signalbridge
```

### Fly.io
```bash
fly launch
fly secrets import < .env
fly deploy
```

---

## Risk Controls

Configure via dashboard or `PATCH /api/settings`:

- **Max position size** — cap order qty globally
- **Daily loss limit** — auto-halt trading when breached
- **Duplicate window** — ignore repeated signal within N seconds
- **Reverse signals** — flip buy/sell (mirror trading)
- **Per-route multiplier** — scale lot size per destination

---

## License

MIT © SignalBridge
