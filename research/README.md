# Strategy improvement research

These tools test alternatives without publishing models or altering the paper account. None is imported by the production entry path. The frozen protocol is [strategy-protocol.json](strategy-protocol.json). It was written before evaluating candidate returns; its selection rules and parameters were not tuned after inspecting the holdout.

## What is being tested

All candidates use BTC/ETH spot-style long entries, completed UTC candles, next-15-minute-open execution, the configured spread/fees/slippage and entry-drift checks. The same shared account functions enforce the 0.25% planned risk budget, 20% allocation cap, one open position, cash/minimum stake, loss locks, monetary loss budgets, cooldown and drawdown halt. Initial stops remain 1%. New policies are independent research alternatives, so their outcome reports must not be represented as approved model trades.

| Candidate | Completed-candle confirmation | Research exit policy |
|---|---|---|
| Existing rules control | Original 15-minute bullish EMA breakout and volume rule, without its model gate | Original 1% stop, cost-aware 2% target, six-hour expiry |
| Hourly breakout, fixed | Four-hour SMA50 > SMA200 and price > SMA50; hourly close above prior 20 hourly highs with volume > prior 20-hour mean | Original fixed exits |
| Hourly breakout, trailing | Same signal as above | Original hard stop; close-based trailing; 24-hour expiry |
| Hourly pullback, trailing | Same four-hour uptrend; hourly recovery above SMA20 and previous high after prior close <= SMA20; above-average volume | Original hard stop; close-based trailing; 24-hour expiry |
| Daily momentum, trailing | Daily close crosses above SMA65 from below | Original hard stop; close-based trailing; seven-day expiry |
| Hourly counter-trend rebound | Four-hour SMA50 < SMA200 and price < SMA50; prior hourly close below its lower 20-period two-standard-deviation band and RSI < 30; current recovery above that band and previous high with RSI >= 30 and increased volume | Original fixed exits |

Research RSI uses the simple gain/loss ratio of the last 14 completed returns, not Wilder smoothing. This distinction is intentional and is part of the fixed hypothesis. Higher-timeframe indicators need 200 contiguous completed bars. Daily warmup can delay eligibility after a gap. These rules are new adaptations, not exact reproductions of published systems.

Trailing starts only once a completed bid close exceeds fee/slippage-adjusted breakeven by 1%. Its effective stop is the maximum of the original stop, previous trailing stop, fee-adjusted breakeven and 1% below that completed close. An update applies only to the following candle. It never widens the original stop. The fixed profit target is inactive for these research trailing policies, allowing winners to continue until trailing stop or expiry. The production six-hour expiry and fixed target are unchanged.

## Chronological protocol

- Data: checksum-verified Binance public spot 15-minute monthly archives, January 2022–December 2025. Python's standard library is needed only for this optional archive downloader; the bot remains Node-only.
- Development: after the initial 200-day warmup through 2023. No parameter search.
- Selection: calendar 2024. Choose at most one alternative per setup from eligible candidates, ordered by net return; otherwise select cash/no replacement. Save that selection before calculating 2025 returns.
- Final holdout: calendar 2025. Non-selected alternatives are disclosed descriptively, never selected retrospectively. A fresh simulated account starts each evaluation period; risk history is never reset within a period.
- Acceptance: at least 30 trades overall and 10 per asset, positive net return and a positive approximate block-bootstrap lower payoff bound, positive asset-level P&L, no drawdown halt/limit exceedance, no risk violations, and positive return with doubled fees/slippage. Both selection and test must pass. Untouched forward paper observation is additionally required before promotion.
- Benchmarks: unchanged ML-gated production policy, its rules-only control, cash, and separate passive BTC/ETH references with 20% initial allocation. Passive references have no stop/loss gates, are not rebalanced and can drift above the initial allocation.

Costs are charged at both entry and exit. Doubled-fee/slippage resimulation keeps the normal spread, avoiding a misleading all-cash result from a widened-spread entry rejection. Separate doubled-spread and one-candle execution-delay tests are also reported. Delay stress can reject entries under the unchanged drift limit. Stop-first ordering, adverse opening gaps and terminal liquidation are shared with the bot. Drawdown is sampled; the additional OHLC low-price bound is deliberately conservative.

The March 2023 archive contains a truncated zero-volume interval. It is quarantined and omitted, not filled or assigned a fabricated close time. Gaps remain in the quality report. Positions spanning a gap close at the next observed open; indicators rewarm after discontinuities. This approximation cannot reconstruct executions during the missing period.

## Reproduce

From the project root:

```powershell
python research/download-history.py
npm.cmd run research:strategies
node research/baseline-evaluation.js
node research/finalize-evaluation.js
node research/write-report.js
npm.cmd test
```

The full-year baseline retrains every 12 hours and takes several minutes. It uses the preserved source/config under `audit-output/strategy-improvement/before/`. Keep that snapshot for exact reproduction. The finalizer verifies data/config/schedule identity, re-fits six representative jobs to prove the diagnostic changes leave learned parameters and acceptance unchanged, then replays the current production policy with that schedule.

Outputs are saved in `audit-output/strategy-improvement/`. Archives and CSVs are local research data, not installed strategy code or exchange credentials. Nothing starts or restarts the server. A running app loads the diagnostic improvements at its next normal restart.

## Sources and limits

- [Binance public data](https://github.com/binance/binance-public-data): archive format, checksums and the 2025 migration to microsecond timestamps.
- [Catching Crypto Trends](https://concretumgroup.com/wp-content/uploads/2026/02/Catching-Crypto-Trends.pdf): motivation for testing different trend horizons and trailing exits. Its leverage/portfolio assumptions were not copied.
- [Trend-following Strategies for Crypto Investors](https://www.monash.edu/__data/assets/pdf_file/0011/3744821/Trend-following-Strategies-for-Crypto-Investors.pdf): motivation for a slower momentum/cash comparison.
- [Freqtrade BbandRsi](https://github.com/freqtrade/freqtrade-strategies/blob/main/user_data/strategies/berlinguyinca/BbandRsi.py): a simple mean-reversion reference. This experiment adds recovery confirmation and preserves the existing hard stop rather than copying its 25% stop.

This is retrospective historical testing. A reserved date range is not genuinely unseen future data, and public research already reflects knowledge of these years. Six candidates introduce selection risk; the bootstrap is approximate and cannot prove an edge. OHLC candles do not include quote paths, depth, partial fills or latency. A successful published strategy can fail after being adapted to different exposure limits, stops and exits. Negative results do not establish that all strategies in a family are unprofitable.
