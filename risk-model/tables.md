# P0 risk tables (generated — do not hand-edit)

Params: payout 1.85x, fee 1.5%, liability 1.0%/round, whale cap 20% of liability-implied max.

House edge per $1 staked @50/50: **9.00%**

## Max-bet table per bankroll tier

| Bankroll | Round liability (1%) | Max single bet (raw) | Whale-capped bet |
| --- | --- | --- | --- |
| $1,000 | $10.00 | $11.76 | $2.35 |
| $10,000 | $100.00 | $117.65 | $23.53 |
| $100,000 | $1000.00 | $1176.47 | $235.29 |

## Ruin probability (lose 50% of bankroll before doubling it)

| Daily handle ratio (H/L) | Implied q (lose unit) | P(ruin) |
| --- | --- | --- |
| 2x | 0.4100 | 1.25e-8 |
| 4x | 0.3200 | 4.29e-17 |
| 8x | 0.1400 | 3.81e-40 |

## Daily projection (5m rounds, 288/day @30% fill ≈ 86 rounds, 8 bets/round @ tier-scaled avg)

| Bankroll | Avg bet | Handle/day | Expected gross/day |
| --- | --- | --- | --- |
| $1,000 | $1.18 | $809 | $73 |
| $10,000 | $11.76 | $8094 | $728 |
| $100,000 | $117.65 | $80941 | $7285 |
