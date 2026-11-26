[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Hoppererin/token-radar-01-v6/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Hoppererin/token-radar-01-v6/reward.svg)](https://make.fun/bounty/token-radar-01)

# token-radar-01 v6

A token-launch radar: it ranks 198 pre-token protocols by an implied value its model fits at runtime from the sealed snapshot's own figures, shows each value's uncertainty as an interval, accounts for all 758 protocols in a ledger, and gives every row a concrete farm plan with costs and times.

v6 keeps the v5 model unchanged (grouped comps curve 0.7 + ridge median 0.3) and adds two display levers: a P25–P75 uncertainty interval under every board row (P10–P90 in the detail view), from the model's own leave-one-out residuals, and a ledger bar plus a 10-row coverage table so no protocol is silently dropped.

Run it locally:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, TypeScript, standard library only, no network at runtime. See DESIGN.md for the model, the interval and the ledger.

[Token Radar bounty on make.fun](https://make.fun/bounty/token-radar-01)

Optional: earn referral rewards — [join make.fun with my referral link](https://make.fun/r/dhj53q2r).
