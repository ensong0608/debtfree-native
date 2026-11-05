# Financial worked scenarios — T-020

2026-11-04. All amounts and dates below are synthetic. Results are hand-derived from the stated assumptions, independently of both prototype and native engines. They are not lender statements or approved product rules. The [decision register](./FINANCIAL_DECISION_REGISTER.md) identifies the user gates. Unless a scenario says otherwise, assume USD, no charges/fees/new borrowing, one monthly period, nonnegative obligation, constant APR, interest on opening balance at APR/12 rounded to cents half away from zero, then minimums, then extra; payments cannot exceed amount owed, unused cap is reported. A fixed cap, cap treatment, rounding, order, recurrence, diagnostics and the rules for ranking and credits are **conditional proposals**, not confirmed policies.

## Approval update and decimal entry example

The decision register's foundation v1 record now approves money, rates, calendar and signed-contract basics; remaining payoff assumptions above are still conditional. Two-decimal examples describe USD, not every currency.

For a USD field, keys `4`, `2`, `5`, `.`, `2`, `5` preserve text `4`, `42`, `425`, `425.`, `425.2`, `425.25`; final exact value is 42,525 cents. Editing `425.` must not become `4.25` or `4.25.25`. A second period must not save a reinterpreted amount. Deleting/retyping fractional digits preserves the integer part. This is an approved future input-integration requirement separate from committed-money parsing; no UI verification is claimed.

## S1 — Zero interest and final payment

**Input:** $100 balance, 0% APR, $30 fixed monthly commitment, no minimum beyond the commitment; four monthly periods, first date unspecified. **Derivation:** 100 − 30 = 70; 70 − 30 = 40; 40 − 30 = 10; 10 − min(30,10) = 0. **Expected:** payments $30, $30, $30, $10; interest $0; final unused $20; paid in four periods. Date needs D7; unused-fund behavior needs D5. This models a forecast, not a recorded overpayment.

## S2 — Monthly interest

**Input:** $1,000 opening, 12% nominal APR, $100 payment. **Derivation:** 12%/12 = 1%; 1,000 × .01 = $10 interest; 1,000 + 10 − 100 = $910 closing; 100 − 10 = $90 reduction. **Expected:** interest $10, payment $100, reduction $90, balance $910. Monthly approximation and interest/payment order require D6; actual issuer accrual may differ.

## S3 — Minimums first and same-period rollover

**Input:** A $40, B $100; 0% APR; manually entered minimums A $10, B $20; fixed cap $100; A first priority. Treat entered minimums as fixed and cap each at owed. **Derivation:** minimums allocate $10 to A and $20 to B; $70 remains. A owes $30, receives $30, then B receives remaining $40. **Expected:** A total $40 and closes $0; B total $60 and closes $40; total $100, unused $0. Required order, same-period rollover and treatment of manual minimums await D4–D5. A different allocation policy yields different results.

**Next-period check under the same fixed-cap policy:** A requires $0, B's capped entered minimum is $20; the remaining $80 budget pays B's final $20 and leaves $60 unused. Total second-period payment $40; total across both periods $140 equals initial debt. A's released minimum stays in the fixed cap; it does not reduce the next commitment automatically.

## S4 — Ordering and stable ties

**Input:** balances A $100, B $100, C $200; APRs A 10%, B 10%, C 20%; stable IDs A, B, C; ranking uses opening balances/rates, no name tie-break. Assume snowball = lowest balance then highest APR then ascending stable ID; avalanche = highest APR then lowest balance then ascending stable ID. **Derivation:** equal A/B balance and APR resolves A before B; C has highest APR. **Expected:** snowball A, B, C; avalanche C, A, B. Allocation order and ranking snapshot await D3/D5; no implication that this matches existing code or that custom strategy is supported.

## S5 — Shortfall, nonamortization and horizon are distinct

**Shortfall input:** two required minimums $60 and $50, fixed available cap $100. **Derivation:** 60 + 50 − 100 = $10. **Expected under proposed shortfall policy:** required $110, available $100, shortfall $10; report the period and do not assert a successful schedule or invent allocation. Future increases may make an initially affordable fixed cap insufficient; do not increase it silently.

**Nonamortizing input:** $1,000 at 12% APR, cap $5, no minimum constraint, constant terms indefinitely. **Derivation:** first interest = $10; close = 1,000 + 10 − 5 = $1,005. At 1% positive rate the interest is at least $10 in subsequent periods as balance rises, so $5 cannot reduce it under these unchanged assumptions. **Expected:** nonamortizing under these assumptions, not a universal claim about future changed terms. A single increasing month alone is insufficient where later rates, charges or payments change.

**Horizon input:** $100 at 0%, cap $1, projection limit 3 periods. **Derivation:** 100 − 3 × 1 = $97. **Expected:** horizon reached, $97 remaining; not proof of impossibility (at unchanged terms payoff would take 100 periods). Diagnostic names and exact stop rules await D5–D6.

**Zero-payment checks:** $100 at 0%, cap $0 and no required minimum stays $100 each period: no finite payoff under unchanged assumptions, zero interest and zero payments. If instead an entered $10 minimum is required, cap $0 produces a $10 shortfall before discretionary allocation. These outcomes differ from a known zero obligation and from a merely truncated amortizing schedule.

## S6 — Zero, credit, unavailable and invalid inputs

**Input:** known complete inventory containing $0 and −$20 recorded balances; $50 cap; positive means owed. **Derivation:** max(0,0) + max(−20,0) = $0 obligation; no payment is due. **Expected:** signed records stay $0 and −$20, obligations $0, allocation $0, unused $50; no cross-account credit netting. Credit and zero-payoff semantics await D2/D5. If inventory is unavailable, no debt-free assertion follows. `NaN`, infinity, malformed text or negative input in a nonnegative-only field produces invalid input, not $0; an unsupported currency is a distinct error. Unknown APR is insufficient data if required, not a fabricated 0%.

**Positive-debt companion:** A has −$20 recorded credit, B owes $100 at 0%, cap $50. Derived obligation is $0 + $100 = $100, rather than the $80 signed aggregate. Pay $50 to B; records close A −$20, B $50; remaining payoff obligation $50. No automatic transfer of A's credit occurs.

## S7 — Exact parsing, rounding and bounds

**Conditional input rules:** D1's two-decimal canonical strings, signed values permitted only where designated, half away from zero at the explicitly named rounding boundary, bound ±9,000,000,000,000 minor units and checked sums. **Derivation/expected:** `0.01` = 1 cent; `12.34` = 1,234 cents; `12.345` and `1e2` reject at input, not round; `-0.01` = −1 cent in a signed field. Exact derived +0.5 cent → +1 cent and −0.5 cent → −1 cent; 100 × 1 cent = 100 cents. Maximum `90000000000.00` = 9,000,000,000,000 cents is permitted; adding 1 cent or parsing `90000000000.01` exceeds the proposed bound and returns range error. Intermediate products must be exact or checked at a separately adequate bound. No mixing USD and CAD without conversion policy. Grammar, limits and ties remain user gates; rejecting excess input precision differs from rounding derived interest.

**Interest-boundary check:** $1.50 opening at 12% APR gives exact monthly interest $0.015, rounded to $0.02. With a $1 payment, closing = $1.50 + $0.02 − $1 = $0.52. Next exact interest = $0.0052, rounded to $0.01; final payment $0.53, unused $0.47. Total interest $0.03 and total payments $1.53 reconcile to initial $1.50 plus interest. This assumes monthly rounding without fractional-cent carry, another explicit D1/D6 proposal.

## S8 — Calendar, time zone and income periods

**Conditional recurrence input:** first payment 2024-01-31, monthly on requested day 31, clamp to last day only when unavailable. **Expected/derivation:** Jan 31 → Feb 29 (2024 leap year) → Mar 31 → Apr 30; 2025-01-31 → Feb 28. This is not “one month after previous clamped date.” First-payment and recurrence await D7.

**Year boundary:** first date 2024-12-31, requested day 31 → 2025-01-31 → 2025-02-28 → 2025-03-31. The clamped February date does not permanently change the requested day to 28. A first payment in the calculation month versus the following month shifts all payoff labels; neither default is approved here.

**Conditional period input:** IANA America/Los_Angeles, event instant 2025-03-01 07:30 UTC, monthly windows [local month start, next month start). **Derivation:** PST is UTC−8 at that instant, so local time is 2025-02-28 23:30. **Expected:** event belongs to February, not March. At 2025-03-01 08:00 UTC local March begins; the half-open rule assigns that instant to March exactly once. The event-date basis and zone await D7.

**Income input:** $1,200 each biweekly payday versus $1,200 twice monthly. **Derivation:** 1,200 × 26 / 12 = $2,600 monthly equivalent; 1,200 × 2 = $2,400. A biweekly calendar month with two paydays receives $2,400, one with three receives $3,600; the equivalent is neither actual figure. Normalization frequency is existing confirmed direction; rounding and actual receipt source await D8.

## S9 — Payment, reduction and historical progress

**Input:** observed opening $1,000; during a fully covered period, $10 recorded interest and $100 recorded payment, no other changes; closing observation $910. **Derivation:** 1,000 + 10 − 100 = 910; net balance reduction = 1,000 − 910 = $90; cash payment = $100; in this simple allocation $10 interest and $90 principal. **Expected:** show $100 recorded payment and $90 net reduction; $90 principal only if the recorded/approved allocation supports it. A $0 closing snapshot alone does not prove an account payoff event. If only the two snapshots exist, the $90 net change is observable under comparable scope, but neither the $100 payment nor $90 principal is known. A later $20 refund or correction can change balances without a new payment. Period definitions, classification, reversals and coverage await D7/D9/D10; no historical values are synthesized.
