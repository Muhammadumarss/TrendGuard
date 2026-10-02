# Trading strategy review — 28 September 2026

The bot remains **paper-only, spot-style and long-only**. This review fixes an exit-quote validation gap and adds reproducible, separate strategy diagnostics. It does not enable counter-trend entries, loosen risk limits, change model parameters, publish models or alter the running paper account. Existing uncommitted work was preserved; `before/src/` and `before/config.json` capture the actual starting implementation for this review, rather than the older Git HEAD or earlier audits.

## Original behavior and complete flow

1. **Market data:** `src/market.js` downloads public Binance 15-minute trade-price candles and bid/ask quotes. `src/data.js` checks prices, timestamp alignment, duplicates and gaps. Only completed candles enter features. Entry snapshots require both assets to be healthy, quotes at most 15 seconds old, spread at most 0.2%, and a synchronized clock. The signal must be within two minutes of candle completion and must not already have been consumed.
2. **Features:** `src/features.js` uses an identical trailing 299-candle EMA initialization for training, replay and inference. Inputs are 1/10/20-bar returns, recent return volatility, EMA50/EMA200 distances, relative volume and candle range. The breakout is the previous 20 candles' high, excluding the signal candle. All inputs are causal.
3. **Labels and model:** `src/training.js` predicts long take-profit before stop/expiry, not simply an up move or profitable exit. Labels include next-open entry, midpoint-spread assumptions, fees, slippage, gaps and stop-first ambiguous candles. Timeout profits remain negative classification labels but retain their actual economic return. The rolling window is split chronologically into fitting, calibration and final validation; event horizons are purged at boundaries, and complexity tuning uses an earlier internal split. The final evaluation does not select trees or calibration parameters.
4. **Entry:** `src/risk.js:signal` requires EMA50 > EMA200, close > EMA50, close > previous 20-bar high, volume > previous 20-bar average, and model score >= 0.60. `src/decision.js` additionally requires validated/fresh/configuration-compatible models, supported fitting-feature ranges, positive selected-payoff evidence for the current regime, score within that evidence's observed range, acceptable spread/drift and sufficient risk budget. There is no forced entry.
5. **Account risk:** `src/risk.js` and `src/engine.js:openPaper` enforce one position across BTC/ETH, no borrowing, available cash including fees, 0.25% planned equity risk, a 20% stake cap, and minimum stake. Sizing divides the risk budget by stop plus round-trip fee/slippage allowance and also caps it by remaining daily/weekly loss budgets. Two closed losses in one UTC day lock both assets until 00:05 the following day. Existing gross daily/weekly loss limits, loss-streak cooldown and persistent drawdown halt remain intact.
6. **Execution and exits:** a paper buy fills at ask plus slippage. The stop is 1% below actual entry; the bid target accounts for exit slippage and both fees to seek 2% net return. Expiry is 24 bars/six hours. Sells liquidate the held quantity at bid minus slippage; they never open a short. Stop takes precedence over expiry, then target. Pausing entries or rejecting models does not disable exits. A monitoring outage over 90 seconds results in a current-quote recovery close if no normal barrier already applies. Position-specific costs and levels survive configuration changes.
7. **Persistence and evaluation:** SQLite transactions validate accounting conservation and immutable trade history. `src/backtest.js` uses aligned histories, full rolling training windows, a one-bar publication delay, shared decisions/risk functions, next-open fills, stop-first OHLC exits and terminal liquidation. New entries now carry `context.setup = "trend_following"` in paper and historical execution.

## Direction, confirmation, invalidation and exits

| Setup | Entry and confirmation | Invalidation and exits | Executable status |
|---|---|---|---|
| Trend-following long | Bullish EMA alignment, price above EMA50, completed 20-bar breakout, increased volume, accepted model score and positive regime evidence | A failed condition invalidates entry; after entry the fixed stop, net profit target, six-hour expiry and recovery/manual exits manage the position. There is no EMA-cross exit. | Existing paper policy retained |
| Counter-trend long hypothesis | EMA50 below EMA200 and close below EMA50; previous candle closes below its open and sweeps below the preceding 20-bar low; current completed candle closes above the previous high and its own open with above-average volume | Missing sweep/recovery/volume means no candidate. Diagnostic entries use the same stop, target, expiry, costs, drift/spread guards and account risk budgets. No wider stop or added exposure. No claim that this fixed target is optimal for rebounds. | Offline research only; no executable route |

The EMA alignment, price-above-EMA50 and breakout conditions structurally exclude bearish rebound buys. That alone is **not a confirmed strategy bug**. The existing selected-payoff evidence is drawn specifically from bullish breakout signals and cannot validate a different counter-trend setup. Removing the EMA filters, reversing signals or treating high model confidence as sufficient would reuse unsupported evidence. The data below does not establish any valid counter-trend edge being unnecessarily blocked.

The counter-trend screen is a separately stated hypothesis, not an optimized strategy or a shortcut around production validation. It intentionally retains the original long payoff and account controls for comparison. It is implemented only under `verification/`, never imported by the paper entry path.

## Behavior across markets

| Market | Current behavior and limitation | Evaluation coverage, asset-bars |
|---|---|---:|
| Rising / bullish | Can buy confirmed breakouts only when model and economic gates pass. Lagging EMAs can miss an early reversal. | 1,965 |
| Falling / bearish | No fresh production longs or shorts. Existing longs still exit normally. Research examines completed rebound confirmations, not falling prices alone. | 1,891 |
| Mixed / range | Breakout policy generally abstains when bullish alignment is absent. The regime label is an EMA proxy, not proof of sideways price action. No range-edge claim. | 2,458 |
| High volatility | Existing policy requires evidence in that volatility regime; it does not automatically widen stops. Fixed stops, gaps and sparse regime samples remain limitations. | 2,108 across the above categories |

All six trend/volatility combinations occur in the evaluation. High volatility means 20-bar return volatility scaled by the square root of the holding horizon exceeds the configured stop distance. These are causal descriptions, not independent market forecasts. All production evaluations abstained because model readiness failed.

## Confirmed issues and fixes

- **Exit boundary accepted stale quotes.** Entry decisions checked quote freshness, but `Engine.tick()` and `Engine.closeNow()` trusted their quote provider on exits. Targeted tests reproduced an automatic fill on a 15,001-ms-old quote and a manual close that failed to reject that quote. Added `freshExitQuote` validation before any account mutation or recovery timestamp update. It rejects stale, future-dated, crossed, non-finite or invalid quotes. The current REST adapter already performs basic checks; the engine now enforces its own execution contract too.
- **Exit validation must preserve protective selling.** Reusing the full entry validator would block stops during a wide spread. Exit validation deliberately checks validity/freshness without imposing the entry spread cap. This behavior is tested.
- **Setup attribution was implicit.** New engine/backtest positions explicitly record trend-following setup identity. Existing position/trade history is not rewritten.
- **Documentation incorrectly called the current scores uncalibrated.** README now describes the separate chronological calibration while retaining the warning that scores are not guaranteed winning probabilities.

No new look-ahead or train/validation leakage was found in the current feature and model pipeline. Existing tests cover future-data invariance, purging and held-out independence. The new counter-trend research features have prefix/future-mutation checks. Model expiry, configuration signatures, feature-domain checks and regime support were retained. No setup-specific predictive evidence exists for counter-trend trading, and both rules-only diagnostics below have negative net expectancy.

## Chronological comparison

The frozen snapshot contains **8,917 contiguous 15-minute candles per asset**, with common coverage from **27 June 2026 18:45 UTC to 28 September 2026 15:59:59 UTC**. The first 60 days supply the rolling window; evaluation is **26 August 18:45 UTC through 28 September 15:59:59 UTC**, or **32.8854 days**. Each asset retrains every 12 hours using only preceding completed history. There are **132 fits, zero training exceptions, and zero accepted fits**. The revised replay uses the identical frozen model schedule because feature, label, training and strategy settings were unchanged.

| Policy | Setup | Trades | Net return after costs | Maximum sampled drawdown | Expectancy, USDT/trade | Profit factor |
|---|---|---:|---:|---:|---:|---:|
| Original | Trend-following | 0 | 0.00% | 0.00% | undefined | undefined |
| Revised | Trend-following | 0 | 0.00% | 0.00% | undefined | undefined |
| Original | Counter-trend, absent/disabled | 0 | 0.00% | 0.00% | undefined | undefined |
| Revised | Counter-trend, research-only | 0 | 0.00% | 0.00% | undefined | undefined |

All 6,314 asset-level entry evaluations returned `Model not validated/fresh`. Zero trades imply no observed trading loss, **not** a demonstrated profitable or low-risk strategy. The quote-freshness fix is validated by execution regressions; candle history cannot demonstrate its benefit because it contains no stale quote arrival stream.

### Separate rules-only diagnostics — not deployable results

To investigate opportunities without inventing accepted models, two independent simulated accounts start with 1,000 USDT on the same evaluation dates. These diagnostic replays intentionally omit model score, feature-domain and model/economic acceptance gates, while retaining entry execution checks, one-position exposure, position sizing, all account loss limits and exits. The paper strategy is unchanged. Results are not combined into a multi-setup portfolio and do not estimate that portfolio's performance.

| Hypothesis | Rule candidates | Trades | Net P&L, USDT | Net return | Maximum sampled drawdown | Expectancy, USDT/trade | Profit factor |
|---|---:|---:|---:|---:|---:|---:|---:|
| Trend-following breakout | 144 | 36 | -14.9797 | -1.4980% | 2.6643% | -0.4161 | 0.6438 |
| Counter-trend rebound | 13 | 7 | -9.7704 | -0.9770% | 1.1944% | -1.3958 | 0.0318 |

Both runs have zero loss-lock violations. Costs are 0.1% fee per side, 0.05% slippage per side, and a declared 0.10% full midpoint spread scenario. Equity is marked net of liquidation costs at entries, observed exits and candle closes. Drawdown is sampled, not a tick-level maximum. The actual configured 0.3% entry-drift and 0.2% spread limits remain in force. Gap losses can exceed the planned budget.

Trend-following low-/high-volatility trades number 22/14, with net P&L -7.3966/-7.5830 USDT. Counter-trend low-/high-volatility trades number 5/2, with net P&L -9.4701/-0.3004 USDT. No hypothesis is selected or enabled based on these subdivisions. No candidate of either type reached the actual frozen model's 0.60 score threshold; none had a ready model. All 13 rebound candidates were inside the fitting-feature envelope, illustrating why feature coverage alone is insufficient.

The trend diagnostic's approximate moving-block interval for mean return on committed capital is **[-0.5268%, +0.0989%]**, which includes zero. Counter-trend has only seven trades and two blocks; the bootstrap correctly supplies no interval. It falls far below the existing minimum of 30 selected observations, even before separate regime and calibration requirements.

Doubling spread, fees and slippage produces zero new trades under the unchanged spread guard: a full midpoint spread of 0.20% corresponds to ask/bid minus one of about 0.2002%, exceeding the 0.20% entry limit. This is abstention under higher costs, not evidence of improved returns. The machine-readable summary also contains a fixed-trade doubled-fee/slippage calculation using the original quantities and exit quotes, to expose cost sensitivity without relaxing the spread limit. That calculation does not double spread or resimulate exits.

## Tests, reproduction and changed files

Baseline: **65/65 tests passed**. New exit regressions first failed on the starting code as expected. Final suite: **71/71 passed**, including six new tests for automatic/manual exit freshness, wide-spread stops, distinct rebound confirmation, rejection of counter-trend entries despite a bullish accepted model, feature causality and shared cross-asset risk controls in both diagnostics. Existing tests additionally cover configuration/live-mode rejection, gaps, stop-first ambiguity, costs, accounting, model freshness, daily/weekly budgets, drawdown/streak controls, persistence and pausing.

Changes made in this review:

- `src/risk.js`: independent exit-quote validator; entry validator reuses validity/freshness checks.
- `src/engine.js`: enforce fresh exits; record setup attribution.
- `src/backtest.js`: record matching setup attribution.
- `verification/counter-trend.js`: causal research-only rebound screen.
- `verification/setup-replay.js`: separate offline setup replay using shared execution and risk functions.
- `verification/strategy-review.js`: read-only frozen data snapshot, baseline/revised chronological comparison, cost diagnostics and provenance.
- `test/strategy-review.test.js`: six targeted regressions.
- `README.md`: corrected calibration description and review/reproduction guidance.
- `audit-output/strategy-review/`: starting source/config, immutable data and model schedule, before/after/cost/research outputs, logs, summary and this report.

Run from the project root:

```powershell
npm.cmd test
node verification/strategy-review.js
# Reuse fitted models only after their source/config/data/content hashes match:
node verification/strategy-review.js --reuse-models
```

The evaluator uses a read-only SQLite transaction only when creating its first snapshot. Later runs use saved JSON. It never invokes the training job publisher or starts the agent. Artifacts carry config/data/source and model-schedule hashes, plus the research script hash. Existing earlier audits and pre-existing changes are not this review's new work. No commit or application restart was performed.

## Remaining limitations and requirements before enabling counter-trend

The sample is short, has been inspected in prior work, and is not an untouched prospective test. Rolling model evaluation is temporally out of sample, but the newly specified rebound hypothesis is exploratory on previously accessible history. Its seven trades cannot establish reliability; the observed net result is negative. These findings neither prove all counter-trend approaches unprofitable nor justify enabling this one.

Before adding an executable counter-trend policy, freeze its setup, confirmation, invalidation and exit definitions; collect substantially longer independent history and forward paper observations across assets/regimes; fit/calibrate using earlier data only; and require setup-specific, non-overlapping positive net-payoff evidence with uncertainty bounds, sufficient per-regime coverage and an untouched chronological evaluation. Then evaluate coexistence with trend trades under the same shared account limits, including opportunity conflicts and turnover. Do not pool bullish evidence into counter-trend validation or tune thresholds repeatedly on this evaluation period.

Historical candles contain trades, not quote/depth paths. The spread is an assumption; partial fills, market impact, exchange rounding/rejections and between-poll touches are absent. REST book ticker reports bid/ask without an exchange event timestamp, so freshness is still measured by request duration and local receipt time. The new check cannot prove the venue itself is current. See [Binance market-data endpoint definitions](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints). Actual spot orders also have symbol filters such as price/lot-size/notional rules; the paper minimum is not exchange-rule synchronization ([Binance filters](https://developers.binance.com/docs/binance-spot-api-docs/filters)). No live adapter or short-selling support was introduced.

Stops are simulated; outages, gaps and illiquidity can exceed loss budgets. Fixed volatility-independent stops, simplified OHLC ordering, finite EMA warmup and empirical feature envelopes remain explicit limitations. A running process must load the changed source on its next normal restart; this review did not interrupt monitoring or activate trading. No profitability guarantee is made.
