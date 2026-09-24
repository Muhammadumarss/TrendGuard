# TrendGuard — JavaScript edition

**Runs directly on Windows with Node.js 24 LTS. No Docker, Python, build tools, API keys or paid AI service needed.**

This is a Node.js + Express trading agent with a local browser dashboard, native SQLite persistence, CPU model training, and a historical backtester. It automatically opens and manages **simulated paper trades using public BTC/ETH market data**. This edition does not implement real-money exchange order execution; setting `mode` to `live` is rejected.

## Start here — Windows

1. Install **Node.js 24 LTS** from https://nodejs.org and close/reopen PowerShell. Check `node --version`; it must start with `v24.`. Python 3.14 is not used.
2. Extract the ZIP to a **new folder**, such as `Desktop\TrendGuard-Node`. Do not copy this over the old Python project.
3. Double-click **START-WINDOWS.cmd**. It installs the locked dependencies on first run and starts the app.
4. Open **http://localhost:3000**. Keep the terminal running.
5. Click **Start paper agent**. It downloads data and trains models automatically, then waits for a valid signal. Training progress and errors are displayed in the dashboard.

Alternatively, open PowerShell in the extracted folder containing `package.json` and run:

```powershell
npm.cmd ci
npm.cmd start
```

Using `npm.cmd` avoids the common PowerShell restriction on `npm.ps1`. All files are at the ZIP root: there is no extra inner project folder. If a command says `package.json` is missing, run `dir` and move into the folder where `package.json` is actually present.

No Angular build is required: Express serves a responsive HTML/CSS/JavaScript dashboard. This keeps installation small while still using a JavaScript backend and frontend.

## What changed from the original project

| Original | This edition |
|---|---|
| Docker + Python + Freqtrade/FreqAI | Native Node.js + Express |
| LightGBM | Pure JavaScript logistic gradient boosting with decision stumps |
| FreqUI dashboard | Included local trading dashboard |
| Freqtrade trade database | Built-in Node SQLite, stored in `data/paper.sqlite` |
| Optional live configuration | Paper execution only; no live-order adapter |

The model is **not LightGBM** and should not be presented as having the same performance. Both use boosted trees, but this JavaScript implementation is smaller and has a binary target: **take-profit reached first** versus **stop-loss or time barrier reached first**. Model scores are uncalibrated and are not guaranteed chances of winning. Neither implementation is a validated profitable strategy.

## Controls

- **Start paper agent:** enables automatic entries and schedules training when needed.
- **Pause new entries:** prevents new positions. Existing positions continue to be monitored and closed by their exit rules.
- **Train models:** downloads the last 60 days of 15-minute BTC/ETH candles and trains in a worker thread, keeping the dashboard and trade monitoring responsive.
- **Run backtest:** uses downloaded history for chronological walk-forward evaluation, plus a separate doubled-fee/slippage stress run. Results appear on the dashboard and in `data/backtest.json`.
- **Close paper position:** closes the simulated position using a current bid quote and configured slippage/fees. It counts toward the daily loss rule.

Wait for training to finish before backtesting. No trade is forced merely to populate the dashboard. If validation fails or there is no signal, the correct behavior is to wait.

## Trading and risk behavior

- BTCUSDT and ETHUSDT spot, long only, no leverage, one position across the whole account.
- Trend filter: EMA50 above EMA200, price above EMA50, a close above the previous 20-candle high, and above-average volume.
- Prediction filter: score at least 0.60, matching model configuration, passing holdout validation and model age under 24 hours.
- Only the first two minutes after a completed 15-minute candle are eligible for new entries. A signal is evaluated once per symbol/candle, preventing repeated entries after a restart.
- Entry uses the current ask plus 0.05% assumed slippage. Exit uses the current bid minus 0.05%. Fees are 0.1% on each side. Entry drift may not exceed 0.3% from signal close and spread may not exceed 0.2%.
- Stop: 1% below the simulated entry. Profit target: price needed for 2% net return after the configured fee/slippage costs. Maximum holding time: 24 candles / six hours.
- Position sizing: 0.25% of equity divided by planned stop plus round-trip fee/slippage allowance, capped at 20% of equity and available cash. Below 10 USDT, no entry. These are simulated limits, not synchronized exchange lot-size filters.
- **The first fully closed losing trade after fees stops all new entries across both pairs.** Exactly zero does not trigger the lock.
- **Eligibility returns at 00:05 UTC on the calendar day after the loss closes**, subject to data/model checks and manual pause state. A loss at 00:01 UTC still waits until the next day.
- The loss record, balance, open position and manual entry state survive restarts. A later win cannot clear an active loss lock. The daily reset is a time check, not a scheduled restart, and does not improve the predictions.

The default account has 1,000 simulated USDT. The app never asks for or accepts exchange API keys. Paper results are not exchange executions.

## Model validation and backtesting

The model has eight causal features: 1/10/20-bar returns, 20-bar return volatility, distance from EMA50/EMA200, relative volume and candle range. Labels assume entry at the next candle's opening price. Same-candle stop/profit ambiguity is resolved conservatively in favor of the stop. Incomplete label horizons are excluded.

The first 80% of complete labeled history supplies training candidates. Within that portion, an earlier 80/20 chronological split selects zero to 80 boosting rounds using tuning Brier score, with a full label-horizon purge at the split. The selected number of rounds is refitted on the outer training portion. A full label horizon is also purged before the final 20% chronological holdout, which does not select model complexity. A model may trade only if it has at least one tree and its holdout Brier score beats a constant score based on the training win frequency. Training records the selected tree count, outcome frequencies and rejection reason. The backtester uses the same training procedure. This is a small research gate, not proof of profitability or calibration. Repeated development against this holdout can overfit it; keep separate untouched historical periods for serious evaluation.

Automatic retraining occurs after 12 hours; failed network attempts retry no more than hourly. A failed *quality assessment* saves a rejected model and blocks entries for that symbol. A download or training exception may leave a previous model available until it expires; errors are shown in the activity/job panel.

The backtester starts after 65% of the downloaded dataset, retrains on earlier data every seven days, and applies the same holdout gate and daily loss rule. It uses 15-minute OHLC simulation, next-open entries, opening-gap fills, stop-first ambiguity and fee/slippage deductions. It is separate from the active paper account and does not modify that account's trades or lock.

The stress run doubles execution fees and slippage while leaving the prediction model's label assumptions unchanged. This tests sensitivity, not actual order-book execution. Inspect net profit, trade count, drawdown, profit factor and loss-lock violations in the JSON report. Zero trades is not successful strategy validation. Do not optimize a strategy to one short sample and assume it will generalize.

Command-line alternatives:

```powershell
npm.cmd run train
npm.cmd run backtest
npm.cmd test
```

Avoid running separate training/backtest CLI jobs at the same time as dashboard jobs. Only run one server against an account database.

## Reliability and limitations

The app polls quotes every 15 seconds. A price can touch a barrier and move away between polls; the paper engine will miss that event. Real fills, order-book depth, partial fills, rounding constraints, exchange rejections and hosted stops are not simulated by the running paper engine. The historical backtester follows a different OHLC approximation, so exact agreement is not expected.

Closing the terminal, sleeping the computer or losing the network stops monitoring. On recovery after more than 90 seconds without a successful position quote, the bot first applies any currently triggered stop/profit/time exit; otherwise it closes at the recovered quote with reason `recovery_quote`. It does **not** invent historical fills during the missing period. This can understate losses or miss gains. Recovery closes still update fees, P&L and the daily loss lock.

SQLite uses transactions, WAL and full synchronization. Corrupt state fails closed instead of silently creating a fresh balance. Preserve the entire `data` folder; stop the app before backup and include SQLite companion files. Deleting the database creates a fresh paper account and erases its risk history. There is intentionally no reset-balance API or dashboard button.

The server binds to `127.0.0.1`, rejects unexpected Host headers, uses same-origin/token checks for controls, and does not load external dashboard scripts. This is a single-user local app, not a public multi-user service. Do not expose it through port forwarding or a public reverse proxy without adding proper authentication and deployment hardening.

Changing `config.json` requires a restart. Fee/slippage/stop/target/horizon changes invalidate saved models until retraining. An existing position retains its original fee assumptions, exit levels and expiry. Changing `initialBalance` does not reset an existing account. The current BTC/ETH paper configuration is a research default, not a recommendation to invest.

## Troubleshooting

**PowerShell says running scripts is disabled:** use `npm.cmd ci` and `npm.cmd start`, or double-click `START-WINDOWS.cmd`. No execution-policy change is needed.

**`node` is not recognized:** install Node.js 24 LTS, then reopen the terminal.

**`node:sqlite` unavailable:** the Node version is too old. This app uses the built-in SQLite module to avoid native dependency compilation.

**Port 3000 in use:** stop the other app, or change `port` in `config.json` and use that new port in the browser. The launcher's printed shortcut assumes the default 3000; the server prints the actual configured address.

**Model not ready / no trades:** check the Model validation and Activity panels. Data download, class coverage, holdout quality, model freshness, breakout conditions, spread, entry timing and the daily loss lock can all legitimately block entries.

**HTTP 403/451 / timeout / market data failed:** public Binance data is inaccessible or unreliable from your location/network. The app retries transient failures and blocks entries if data is unavailable. It does not bypass exchange restrictions or substitute fake data. The computer clock must also be synchronized to within 30 seconds of exchange time.

**Dashboard doesn't open:** check the terminal for startup errors. Keep `npm start` running and use `http://localhost:3000`, not an HTTPS URL.

## Source layout

- `src/server.js`: Express API, local access controls and worker scheduling.
- `src/engine.js`: paper fills, position lifecycle and entry guards.
- `src/risk.js`: persistent-history loss lock, sizing and signal conditions.
- `src/store.js`: SQLite persistence and atomic account changes.
- `src/features.js`, `src/model.js`, `src/training.js`: features, labels, boosted-tree learning and chronological validation.
- `src/market.js`: public market-data access, clock and data checks.
- `src/backtest.js`: historical simulation and lock audit.
- `src/jobs.js`: off-thread training and backtest tasks.
- `public/`: browser dashboard.
- `test/`: risk, restart recovery, model, backtest and HTTP integration tests.

References used for implementation: [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Express setup](https://expressjs.com/en/starter/installing/), [Binance public market data](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [market endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).
