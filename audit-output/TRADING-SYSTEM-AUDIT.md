# TrendGuard trading-system audit

Audit date: 25 September 2026. Scope: current working-tree source, configuration, tests, dashboard, saved SQLite account/candles/models, current saved backtest, and older verification artifacts. Existing staged changes were included as the current implementation and left untouched. This is a paper-only system; no exchange order execution exists.

Evidence labels: **Observed** means inspected source or saved records; **Calculated** means recomputed from those records; **Reproduced** means a controlled synthetic/in-memory execution; **Inference** means a plausible consequence requiring further measurement. No trading code, configuration, account, model, or saved backtest was changed by this audit. Only audit artifacts were created. Existing tests ran successfully: **25 passed, 0 failed**, Node v24.21.0 on Windows.

## A. Executive summary

The system has sensible research safeguards, but it has **not established a profitable trading edge**. Both current models fail their holdout gate. The saved paper account has no trades, and normal/stressed historical runs also have no trades. Zero P&L and drawdown therefore demonstrate inactivity, not robustness.

The feature pipeline is causal and the nested chronological training splits include conservative label-horizon purges. Fee-inclusive cash accounting, one-position enforcement, the persistent daily loss lock, and stop-first OHLC ambiguity handling are useful controls. I did not find direct future-price leakage in the normal contiguous-data feature/training path.

Material deficiencies remain: indicator initialization differs between training and paper inference; the historical strategy does not reproduce model freshness/retraining rules; entry freshness checks can expire while awaiting another market; state validation is incomplete; and model validation does not establish expected value at the entry threshold. These prevent treating the backtest as validation of the running system.

**Assessment:** internally coherent in its basic long-only accounting and signal intent; incomplete as an execution simulator and statistical validation framework. Keep the failed-model gate. Lowering the threshold or removing validation merely to produce trades is not supported by the evidence.

## B. How the trading system currently works

1. Download Binance BTCUSDT and ETHUSDT 15-minute OHLCV, retain completed candles, reject malformed/gapped responses, and compare the computer clock with exchange time.
2. Compute eight features: 1/10/20-bar close returns, population standard deviation of 20 one-bar returns, close/EMA50 and close/EMA200 distances, volume relative to the previous 20 bars, and candle range divided by close.
3. Label historical examples using next-open entry plus slippage. A positive label means the net-profit target is reached before the stop within 24 bars; stop-first or timeout is negative. Same-bar ambiguity resolves to stop.
4. Train logistic gradient boosting with decision stumps. Select 0–80 rounds on an earlier chronological tuning set, refit on the outer training set, and evaluate on the untouched final 20%. Purge horizons at both boundaries.
5. Require a nonzero-tree model whose holdout Brier score beats a constant prediction equal to training positive-label frequency. Paper entries also require matching assumptions and model/data age at most 24 hours.
6. Buy only when score >=0.60, EMA50 > EMA200, close > EMA50, close > previous 20-bar high, and volume > previous 20-bar mean. Require a narrow spread, <=0.3% entry drift, first two minutes after candle completion, and no active loss lock/position.
7. Fill at ask plus 0.05% assumed slippage; debit stake plus 0.1% entry fee. Monitor bid quotes approximately every 15 seconds. Exit at stop, net target, six-hour expiry, manual instruction, or recovery after a monitoring gap.
8. Credit sale proceeds after slippage and exit fee. Two negative closed P&Ls in one UTC day block both assets until 00:05 UTC the next day. Wins do not clear the lock.

There is no bearish short signal. SELL closes an existing long; HOLD means retaining it until an exit rule; avoid means entry prerequisites failed. BTC receives priority when both assets qualify because symbols are processed in configured order.

## C. Trading strategy logic review

This is a **trend-following momentum breakout** strategy with an additional predictive filter. EMA direction, a new 20-bar high, and elevated volume form a coherent continuation hypothesis. It is not a mean-reversion strategy.

EMA50/EMA200 direction and distance features overlap in information; the three returns also overlap. This is not automatically a bug, but feature-ablation evidence is absent. Close > EMA50 is not universally implied by a breakout, so it is not strictly redundant. Strict inequalities make boundary cases sensitive to small price/volume differences. Fixed 1% stop, 2% net target, six-hour horizon and 0.60 cutoff have no documented parameter-stability evidence.

All entry conditions are conjunctive. In the current holdouts, 42 BTC and 33 ETH rows pass the price/volume trend filter, but **zero rows for either asset reach 0.60**. Consequently, the validation gate is not the only reason entries are absent. These are holdout diagnostics, not counts of independent executable trades.

Volume is Binance base-asset volume, compared with the same pair's past volume; this relative measure is coherent. No order-book depth, spread feature, higher-timeframe regime filter, volatility-scaled barrier, or news information is used. The model estimates a barrier event, not a future price or a guaranteed directional move.

## D. Prediction-model review

The saved models were trained at **2026-09-25 13:40:55.731 UTC**, on completed data through **13:29:59.999 UTC**. Reconstructing their latest 5,760-bar/60-day input windows reproduced their stored Brier scores exactly.

| Calculated/observed metric | BTCUSDT | ETHUSDT |
|---|---:|---:|
| Outer training examples | 4,403 | 4,403 |
| Holdout examples | 1,107 | 1,107 |
| Trees | 76 | 80 |
| Model Brier | 0.04907181 | 0.11396144 |
| Constant baseline Brier | 0.04560945 | 0.10413096 |
| Brier skill, 1 - model/baseline | about -7.59% | about -9.44% |
| Training target-hit rate | 4.2925% | 6.4047% |
| Holdout target-hit rate | 4.7877% (53/1,107) | 11.4724% (127/1,107) |
| Entry-threshold examples | 0 | 0 |
| Current quality gate | Failed | Failed |

The earlier explanation of your ETH message is confirmed: baseline means the **constant training target-hit rate**, not buy-and-hold or another profitable trading strategy. Brier is mean squared probability error. Neither 0.1140 nor 1-0.1140 is accuracy or win rate.

Observed reliability problems are visible in the holdout reconstruction:

| Asset / score interval | Rows | Mean score | Actual target-hit frequency |
|---|---:|---:|---:|
| BTC 0.20–0.30 | 66 | 25.40% | 4.55% |
| BTC 0.30–0.40 | 37 | 32.99% | 0% |
| ETH 0.10–0.20 | 207 | 11.63% | 31.40% |
| ETH 0.30–0.40 | 41 | 37.92% | 0% |
| ETH 0.40–0.50 | 93 | 43.17% | 12.90% |

These are descriptive diagnostics on dependent observations, not independent-trial significance tests. They show that higher score did not consistently imply higher target-hit frequency in this period. The ETH event frequency also shifted substantially from training to holdout. Distribution shift and model instability are plausible explanations; neither proves a specific causal market regime or definitively diagnoses overfitting.

The held-out observations overlap across six-hour event windows. 1,107 rows represent about 11.5 days of signals, not 1,107 independent trades. Purging prevents boundary leakage but does not remove dependence within the evaluation period. Use paired block bootstrap or other dependence-aware uncertainty analysis and multiple genuinely later periods. A tiny Brier improvement alone should not authorize claims of statistical superiority.

The score is an uncalibrated sigmoid output for TP-first. Timeout profits are still negative labels. Thus TP probability differs from profitable-close probability and cannot alone specify expected trade P&L. Brier also measures more than calibration; lower Brier does not guarantee better calibration. See the [scikit-learn probability-calibration documentation](https://scikit-learn.org/stable/modules/calibration.html).

## E. Risk-management review

The default stake is min(equity × 0.0025 / 0.013, equity × 0.20, cash / 1.001). With 1,000 USDT and no open position, this is **192.307692 USDT**, costing **192.50 USDT** including the entry fee. Using cash as equity is correct at this entry point because the system allows only one position and must be flat to enter.

Calculated example at ask=100: entry=100.05, stop bid=99.0495, target bid=102.30645954. Exact stop fill produces about **-2.400866 USDT**, or **-0.2401% of account equity**. Exact target produces **+3.85 USDT**, or **+0.385% of equity**. The fee-inclusive reward/risk is about **1.604:1**, not 2:1. Under an artificial two-outcome exact-stop/exact-target model, break-even hit rate is about **38.41%**. This does not apply directly to timeouts, quote gaps, or the uncalibrated model score.

The target formula correctly delivers 2% return on total entry cost after modeled exit costs. Entry slippage is already embedded in entry price. The sizing allowance is slightly conservative for an exact stop; it is not a guaranteed loss cap. A gap or outage can lose far more than 0.25%. With no borrowing, liquidation from leverage does not apply; a severe asset loss could still consume nearly the entire allocated position, about 19.25% of initial equity in this example.

| Control | Assessment |
|---|---|
| Leverage | None; appropriate for the stated spot paper scope |
| Single-asset and total concurrent exposure | One position, stake cap 20% plus entry fee |
| Correlation | No simultaneous BTC/ETH exposure, but sequential trades can share the same market factor |
| Daily loss control | Two closed losses per UTC day; loss-count control, not a currency/percentage budget |
| Weekly loss / account drawdown circuit breaker | Absent |
| Consecutive losses across days | No separate control; daily lock intentionally counts nonconsecutive losses too |
| Volatility-adjusted sizing | Absent; volatility is only a feature |
| Stops | Local polling rules, not exchange-hosted orders |
| Trading costs | Fixed fee/slippage assumptions; live quotes include spread, historical candles do not |

## F. Backtesting review

The simulator computes causal full-history features, trains only on candles earlier than each fold, processes existing positions on each candle, and enters at the next open. This normal contiguous-data path does not trade at a signal candle's already-known close. Gap-stop fills and stop-first intrabar ambiguity are defensible conservative conventions. Account capital is updated after closes, and subsequent sizing uses updated capital: compounding is implemented through cash rather than summing percentage returns.

However, it retrains weekly on expanding stored history, while paper operation retrains every 12 hours on a rolling 60 days and rejects old models. It does not model bid/ask spread, partial fills, order sizes, latency, quote-polling misses, or the two-minute execution window. It timestamps opening-gap and expiry fills at candle end. Stress execution changes fees/slippage, which also changes stake size and the target price through shared functions; it is not an identical-trades cost-only sensitivity comparison.

Drawdown is measured from sampled close equity, misses intrabar equity lows, and is not updated after final forced liquidation. The complete equity curve is not retained. Intersection of asset timestamps can hide missing candles, and next-open code assumes the next common candle is exactly one bar later. These limitations are detailed below.

## G. Data-quality review

**Calculated on stored data:** 6,023 candles per symbol, from **2026-07-24 19:45 UTC** through **2026-09-25 13:29:59.999 UTC**. Both assets were continuous at 15-minute spacing. No malformed OHLC relationships, nonfinite numeric fields, negative volumes, zero-volume candles, or close-to-close moves over the audit's coarse 10% outlier threshold were found. That threshold is a screening rule, not proof that every price is correct. Duplicate stored symbol/time keys are prevented by SQLite's primary key, and reads explicitly sort by time.

The live model uses the latest 5,760 candles; the database retains older bars because saveCandles upserts without pruning. This explains the larger historical store. No independent exchange/source reconciliation or raw-response hash exists, so original-download accuracy cannot be independently certified. Upsert can overwrite earlier values without revision history.

parseBars validates basic price relationships, continuity and candle duration. Missing or nonfinite end times can be removed by its pre-validation completed-candle filter rather than explicitly rejected. Absolute quarter-hour alignment is not checked. Backtests consume stored JSON without applying the same full validation to the entire historical series.

Binance documents klines and best bid/ask as separate market-data endpoints; candle OHLC should not be assumed to be executable bid/ask history. See [Binance spot market-data documentation](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market).

## H. Performance analysis and prediction versus outcome

| Metric | Saved paper account | Normal backtest | Doubled-cost backtest |
|---|---:|---:|---:|
| Closed trades | 0 | 0 | 0 |
| Open positions | 0 | 0 at completion | 0 at completion |
| Cash / ending balance | 1,000 USDT | 1,000 USDT | 1,000 USDT |
| Realized net P&L | 0 | 0 | 0 |
| Reported max drawdown | No recorded equity history | 0% | 0% |
| Win rate / average win / average loss | Undefined | Undefined | Undefined |
| Profit factor / expectancy | Undefined | Undefined | Undefined |
| Sharpe / Sortino / Calmar | Not estimable | Undefined on constant inactive equity | Undefined on constant inactive equity |
| Mean duration / win-loss streaks | No observations | No observations | No observations |
| Asset / regime / long-short attribution | No trades | No trades | No trades |

Saved backtest interval: **2026-09-03 14:15 UTC to 2026-09-25 13:15 UTC**, approximately 22 days and four weekly folds. BTC passed two folds; ETH passed none. A BTC passing fold improved Brier by only about 0.000148. There is no measured positive post-cost expectancy. September's simulated account change is zero; it is not a full-month strategy performance estimate. Short-side performance is inapplicable because shorts are not implemented.

There is no append-only record of every historical live prediction, model version, decision, quote and rejection reason. Models are overwritten; market snapshots are in memory; events retain only the last 200 entries. Therefore **every actual historical prediction cannot be audited** from the available files.

To make the available evidence inspectable, this audit exported **all 1,107 holdout predictions per current model**, with signal time, uncalibrated score, actual barrier label, trend eligibility, hypothetical next-open entry, stop/target, simulated exit/reason, net return, and full-horizon favorable/adverse excursions:

- [BTC reconstruction](BTCUSDT-holdout-reconstruction.csv)
- [ETH reconstruction](ETHUSDT-holdout-reconstruction.csv)
- [Exact metrics and all score bins](holdout-summary.json)

These are reconstructed hypothetical examples, not executed trades, not an independent forward test, and not an investable portfolio: their horizons overlap and many violate entry filters. Excursions use the full 24-bar path even if a barrier was hit earlier. They are explicitly labeled full-horizon MFE/MAE, not realized trade excursions; 15-minute OHLC cannot establish the sequence of extremes inside an exit candle. Entry direction is always long. There is no model-predicted price target: the target is configured mechanically.

## I. Market-regime analysis

No saved regime labels or sufficient executed trades exist. The following are **mechanistic expectations to test**, not measured regime performance:

| Regime | Expected behavior and unresolved risk |
|---|---|
| Strong bullish | More trend/breakout candidates; pullbacks can stop late entries |
| Strong bearish | Trend filter should reduce entries; slow EMAs can lag reversals; cannot profit through shorts |
| Sideways/ranging | Fewer entries, but false breakouts and repeated small losses remain possible |
| High volatility | Fixed 1% stop can be small relative to noise; gaps and adverse fills dominate |
| Low volatility | Six-hour 2% net target may be rarely attainable; many timeout-negative labels |
| Sudden news movement | No news filter; quote polling and fixed slippage cannot capture fast execution deterioration |

Robustness across these conditions remains unvalidated. Define regimes using information available at signal time, freeze definitions before final evaluation, and report uncertainty and counts per asset/regime. Do not claim regime coverage merely because the training window contains 60 days.

## J. Critical/high-risk issues

No present real-money execution defect is classified as an immediate critical capital incident: this project cannot place real orders. The following high-priority issues are blockers to stronger validation claims.

### H1. Training and paper inference initialize EMAs differently

**Issue:** indicator values depend on the arbitrary start of the supplied history. **Evidence:** src/features.js:3–5 seeds both EMAs from the first close; src/market.js:34 requests 300 bars, usually 299 completed, whereas training uses 5,760 and historical simulation uses the full stored series. A rolling 299-completed-bar comparison against full stored history found maximum EMA200 differences of **0.532% BTC / 0.693% ETH**. **Why it matters:** EMA distances drive the model and EMA ordering drives eligibility. **Risk level:** high methodology risk. **Expected impact:** changed scores/entries near thresholds; no qualifying-signal flips occurred using the current rejected models, which never reached the entry cutoff. **Recommended fix:** one deterministic indicator-state/warmup policy for training, historical evaluation and paper replay, with versioned feature identity. **How to test:** compare every feature and decision at identical timestamps across all three paths, including restart recovery and near-boundary examples.

### H2. Backtest evaluates a materially different model lifecycle

**Issue:** weekly expanding-window models can trade when the paper engine would reject them. **Evidence:** src/backtest.js:12,18–23,45; compare src/engine.js:27–28 and src/jobs.js rolling history download. No modelReady check exists in the simulator. **Why it matters:** an apparently successful historical strategy might never be eligible in paper operation. **Risk level:** high. **Expected impact:** different trade sets and unrepresentative performance in either direction. **Recommended fix:** replay the same rolling training window, retraining schedule, data availability, quality gate and model expiry, including a documented training-completion delay. **How to test:** deterministic replay asserting equal readiness/entry decisions between engine and backtest over several retraining cycles, including failed training and expiry.

### H3. Entry checks can expire while waiting for the other symbol

**Issue:** quote freshness is checked before all snapshots finish; candle age uses exchange time captured before network requests. **Evidence:** src/engine.js:59–78. **Reproduced:** delaying the second snapshot caused an entry with a **140-second-old first-symbol quote**, **150.001 seconds after candle completion**, violating both configured guards. This was a synthetic scheduling proof, not an observed account trade. **Why it matters:** simulated entry may use an untradeable old price and a signal outside its authorized window. **Risk level:** high. **Expected impact:** optimistic or simply inaccurate entries under slow requests. **Recommended fix:** revalidate quote, candle age, model readiness and current model identity immediately before the transaction; refresh the chosen quote if needed. Use current clock-adjusted exchange time. **How to test:** independent delayed symbol responses, retraining completing while awaiting responses, and exact 15-second/120-second boundaries; all expired snapshots must fail closed.

### H4. Malformed position state can corrupt the account before rejection

**Issue:** read() checks only selected numeric fields and change() does not validate the resulting state before commit. **Evidence:** src/store.js:18–26 does not require finite fee, slippage, expiry, entry fee, lastPoll, or positive quantities. **Reproduced:** deleting fee/expiry from an in-memory position passed read(); closePaper then committed cash/P&L/fees as null because NaN serialized to null. **Why it matters:** restart recovery or malformed persisted state can destroy accounting continuity. **Risk level:** high reliability risk, conditional on malformed state; no such corruption found in the saved account. **Expected impact:** lost trustworthy balance/trade accounting and subsequent trading failure. **Recommended fix:** complete versioned schema validation before and after every mutation, relational invariants, and migration/fail-closed handling. **How to test:** inject missing, NaN-equivalent, negative and out-of-range fields; mutations must roll back and preserve the previous valid state.

### H5. Holdout acceptance does not validate the traded decision rule

**Issue:** any strict all-row Brier improvement can pass, without dependence-aware uncertainty, calibration, entry-region coverage or net economic evaluation. **Evidence:** src/training.js:28; current holdouts have zero observations at >=0.60; timeout gains and losses share label 0 in src/features.js:27. **Why it matters:** a model can improve low-score predictions while having no validated edge on selected trades. **Risk level:** high statistical/model risk. **Expected impact:** unjustified readiness or confidence after a marginal passing result. **Recommended fix:** retain the gate but supplement it with independent sequential strategy evaluation, coverage counts, calibration analysis and cost-adjusted payoff evidence on the selected region. Consider modeling stop/target/timeout outcomes and conditional payoff distributions. **How to test:** low-Brier models with poor selected-trade expectancy must not be declared economically validated; evaluate uncertainty in temporally coherent blocks and reserve a final untouched period.

## K. Medium-risk issues

### M1. Risk controls limit planned losses, not realized account drawdown

**Issue:** no monetary daily/weekly budget, drawdown stop or volatility-adjusted risk exists; polling can miss barriers. **Evidence:** src/risk.js:6–24 and src/engine.js:48–54. **Why it matters:** gaps can exceed planned loss and one loss/day can continue across many days without the two-loss rule engaging. **Risk level:** medium in paper scope, high if extrapolated to funded trading. **Expected impact:** risk underestimated despite correct direction predictions. **Recommended fix:** explicit equity/realized-loss budgets and a documented gap/execution stress policy; evaluate volatility-scaled stops with matching sizing on untouched data. **How to test:** crash/recovery, overnight loss sequences, low/high volatility and single catastrophic loss scenarios.

### M2. Spread and execution paths differ between historical and paper results

**Issue:** candles are treated as executable prices with fixed slippage, while paper uses bid/ask polling. Stress runs also move targets and reduce stake. **Evidence:** src/backtest.js:14,32–48 versus src/engine.js:11,21,49. **Why it matters:** these assumptions affect entry, exit and payoff, not just a final cost deduction. **Risk level:** medium. **Expected impact:** historical results can overstate fills and are not directly comparable to paper execution. **Recommended fix:** quote/trade replay or documented spread/latency/liquidity scenarios; report both identical-trade cost stress and fully resimulated stress with changed stake/target behavior. **How to test:** spread spikes, gap-through stops, barrier touch/reversal between polls, fill depth, partial fills and increasing cost scenarios with attribution.

### M3. Historical drawdown and exit timestamps are incomplete

**Issue:** drawdown omits intrabar lows and final liquidation costs; opening/expiry fills receive candle-end timestamps. **Evidence:** src/backtest.js:37,39–41,52. **Why it matters:** understates some losses and misstates duration/exit timing by up to one candle. **Risk level:** medium. **Expected impact:** misleading risk and duration statistics once trades occur. **Recommended fix:** preserve an equity series, update after every transaction including terminal close, distinguish known open-time fills from interval-censored intrabar exits, and report sampled versus intrabar drawdown separately. **How to test:** final-candle open-position liquidation, a large intrabar dip with recovery, and exact expiry/open-gap timing.

### M4. Historical alignment silently discards missing timestamps

**Issue:** intersection hides gaps; next common open can be assigned an earlier assumed entry timestamp. **Evidence:** src/backtest.js:8–9,46–48. **Why it matters:** a missing bar can change holding periods, skip barriers and use a later price as if available sooner. **Risk level:** medium, conditional; current stored series are complete. **Expected impact:** invalid trades on incomplete future/corrupted datasets. **Recommended fix:** validate both complete series and exact alignment before simulation; fail or explicitly process missing intervals without inventing times. **How to test:** remove one candle from only one symbol and from both; reject rather than silently skip.

### M5. Historical prediction and model provenance are not retained

**Issue:** current-only models and capped events cannot reproduce the historical decision stream. **Evidence:** src/store.js:29,35; src/engine.js:69–80; saved trade schema omits model/feature/signal identity. **Why it matters:** confidence-vs-outcome, model drift and execution attribution cannot be audited completely. **Risk level:** medium. **Expected impact:** failures cannot be reliably diagnosed and repeated holdout reuse is hard to track. **Recommended fix:** append-only model/data/config hashes, score and feature snapshots, decision reasons, quote timestamps, and trade links; keep raw prediction targets distinct from realized P&L. **How to test:** replay a persisted decision record after retraining/restart and obtain identical score/eligibility and linked outcome.

### M6. Market-data parser and storage boundary validation are incomplete

**Issue:** invalid close timestamps may be filtered before validation; absolute bar alignment and full backtest input validation are absent. **Evidence:** src/market.js:26–30; src/store.js:30–34. **Why it matters:** malformed data can be silently omitted, particularly at response boundaries. **Risk level:** medium data-integrity risk; no malformed saved bars detected. **Expected impact:** shortened or shifted histories and inconsistent features. **Recommended fix:** validate raw structure/timestamps before separating open/completed bars, check interval alignment and sequence at every ingestion boundary, and preserve source/revision metadata. **How to test:** invalid terminal timestamps, duplicate rows, shuffled pages, off-grid timestamps and corrupt stored JSON must yield explicit failures.

## L. Low-risk improvements

### L1. Operational scalability and single-process assumptions

**Issue:** account JSON includes all trades, synchronous mutations serialize it repeatedly, and loss locks scan full history; busy protects one Engine instance only. **Evidence:** src/store.js:19,26; src/risk.js:9; src/engine.js:31. **Why it matters:** history growth and multiple server instances weaken timing/operational reliability. **Risk level:** low for this empty single-user account. **Expected impact:** future latency and cross-process lifecycle inconsistencies. **Recommended fix:** normalized immutable trade records, indexed daily summaries and an explicit single-server lease; preserve atomic financial updates. **How to test:** large-history latency benchmarks and a controlled two-instance startup test.

### L2. Display and verification provenance

**Issue:** score percentages can invite a probability reading despite the existing disclaimer; verification documentation refers to older 22-test results/models; backtest JSON lacks complete config/source/data hashes. **Evidence:** public/app.js:19, VERIFICATION.md and src/backtest.js:64. **Why it matters:** users may compare stale evidence with current behavior. **Risk level:** low. **Expected impact:** misunderstanding confidence or report freshness. **Recommended fix:** display score on a 0–1 scale with target definition and sample support, embed run provenance, and regenerate versioned verification summaries. **How to test:** changed config/model/source versions are visibly distinguishable; undefined metrics render as unavailable rather than zero.

## M. Recommended improvements, in order

1. Correct H1–H4 and the conditional historical gap behavior before interpreting future backtest returns.
2. Share the strategy/model lifecycle and execution-event semantics between deterministic replay and the paper engine. Preserve conservative ambiguity assumptions and explicitly document remaining resolution limits.
3. Add prediction/model/config/data provenance and a timestamped equity curve. Without these, deeper performance diagnosis will remain incomplete.
4. Define economic acceptance criteria before model/threshold changes: sufficient selected observations across independent periods, uncertainty-aware cost-adjusted expectancy, drawdown budget and realistic stress results. There is no universal adequate trade count independent of effect size and dependence.
5. Expand evaluation to distinct bull/bear/range/volatility periods. Keep tuning, calibration, threshold selection and final testing temporally separated with appropriate purges. Compare against a no-model version of the same breakout strategy as well as constant probability and relevant investment benchmarks.
6. Evaluate complexity only after the pipeline is reproducible. More trees or a different library cannot repair execution mismatch, unsuitable labels, or absent trade evidence. Treat the current 80-tree selection at the search boundary as a diagnostic, not a reason to automatically increase it.

## N. Tests that should be added

The 25 existing tests cover cash/fees, loss locks and reset boundaries, persistence/rollback, basic malformed data, feature causality, class coverage, tuning/holdout separation, stale/failed models, single-instance concurrency, paused exits, recovery, HTTP controls and nonzero synthetic historical execution. Passing them validates these behaviors, not profitability.

Add the specific regression tests listed under H1–H5 and M1–M6. Prioritize the two reproduced failures, exact feature parity, model-age parity, missing-bar rejection, and final-equity accounting. Also add:

- Property-based accounting conservation: cash plus liquidation value, fees, quantities and realized P&L reconcile across arbitrary valid trade sequences.
- Direct next-open and first-entry-candle stop/target tests, opening-gap precedence, timeout target gaps, and ambiguous-candle tests for the backtester itself rather than labels alone.
- Synthetic signal/score boundaries around 0.60, equal volume/breakout values, spread/drift limits, and once-per-candle restart behavior.
- Rejected-model publication while an entry snapshot is pending; final readiness must use the current stored model.
- Block-based model comparison and calibration diagnostics with explicit empty/rare-class handling. Never encode a synthetic profitable result as expected real-market performance.
- Reproducible report metadata and replay with known timestamps, including the one-position cross-asset priority policy.

## O. Questions and assumptions that cannot be validated

- Every historical live score and the model that generated it: records are not retained.
- True realized MFE/MAE, fills, depth, latency, spread and stop execution: no executed trades or historical quote path exists.
- Profitable expected value, stable calibration at >=0.60, Sharpe/Sortino/Calmar, full-month performance or regime robustness: insufficient observations.
- Original exchange-response authenticity/revisions: no immutable raw responses or independent source comparison.
- Actual fee tier, minimum notional/lot rounding and funded exchange behavior: this is intentionally a simplified paper account with no exchange adapter.
- Whether earlier development choices were repeatedly optimized against these same periods: commit/run provenance is insufficient to certify an untouched research history.
- Acceptable monetary loss budget, drawdown tolerance and intended future deployment constraints: not specified. Current risk parameters are implementation defaults, not evidence that they suit any particular investor.

The justified conclusion is that the current ETH rejection is functioning as intended. The available evidence supports blocking the present models and improving validation fidelity; it does not support a forecast of future profits or losses.
