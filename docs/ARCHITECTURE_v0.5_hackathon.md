# Monad Blitz Architecture: Hackathon Baseline v0.5

> Repository adoption dated 2026-10-17, based on the supplied v0.5 draft. The three final review additions are included: authorized NFT recovery, explicit deadline guards in the interface table, and the Mining/Escrow isolation statement. Related repository documents have been aligned. This supersedes the earlier architecture baseline. Nothing here has been implemented, deployed, gas-measured, load-tested or audited.

## 0. Changes from v0.3

| Earlier draft said | v0.5 baseline | Why |
|---|---|---|
| Reward = `budget × (end − start) / total` | Reward = `floor(budget × end / total) − floor(budget × start / total)` | Rounding each interval separately leaves dust. For example, 8 units split three ways leaves 2 minimum units. The floor-difference form telescopes to exactly the budget. |
| All 1,000 BLITZ go to group A | Keep the 800 A / 200 B split. B is disabled in the first version, and its 200 stay locked | Re-allocating changes the product rules, so it isn't a simplification. The 200 cannot be moved to A automatically. |
| Timeouts and disputes are optional | The fund exit paths are mandatory | If deposits are accepted, users must always be able to get funds back. |
| A single named arbiter decides disputes | No arbiter. Zero protection period, contract-only settlement | Verifiable same-chain NFTs need no human judgment. Human dispute handling waits for off-chain goods. |
| NFT "in escrow or approved" left open | The NFT must actually be in escrow | An approval can be revoked, or the NFT moved away by the seller. |
| Storage packing helps with Monad write contention | Packing saves gas only. It does not remove the shared-state hotspot | Every submission in a round updates that round's total points. |
| "No judging criteria are published" | Corrected: the scoring page lists core requirements, completion level and business model | Per your review. I could not open the Notion page myself, so I rely on your report. |

## 1. Event constraints

- Monad Blitz V3 Shanghai is a one-day event. Hacking runs 12:00–18:30 (about 6.5 hours), submissions close at 18:30, and demos run 19:00–20:00. Teams have at most 3 people.
- Judging looks at core requirements, completion level and business model. **Completion matters, so one working end-to-end flow beats several half-built ones.**
- Testnet chain ID is 10143. Primary RPC: `https://testnet-rpc.monad.xyz`, previously checked to return 10143. `https://rpc.testnet.monad.xyz` was reported by the developer hub but failed earlier connection checks; it is not an accepted fallback. Verify an independent backup before use. These are prior checks, not a new availability measurement.
- Starter resources: [Monad Developers](https://github.com/monad-developers) and the official deployment guides. Choosing a starter does not authorize implementing before the event or before the user requests code.

## 2. Scope

### In: 3 core contracts
1. `BLITZ`: fixed supply of 1,000.
2. `Mining`: group A rounds, verification and claims.
3. `Escrow`: same-chain NFT trades with the full refund and exit paths.

### Out (kept in the architecture, not built first)
- Group B mining (`UsageAdapter`). Its 200 BLITZ stay locked.
- Off-chain goods, protection periods, dispute resolution, arbiters.
- Registry of adapters, relays, price service, multisig operations, audit.

**Keep the general delivery interface in the overall architecture.** Escrow talks to a delivery check through a small interface (did the agreed fact happen?). The first version has one implementation, ERC-721 custody, and later goods plug in behind the same interface.

## 3. Components

| Component | Responsibility | Must not |
|---|---|---|
| `BLITZ` (ERC-20) | One-time initial supply of 1,000, standard transfers | Mint after initialization, expose burn/tax functions or upgrade |
| `Mining` | Round params, SHA-256 answer verification, dedupe, point ranges, close, claims | Take an uploaded score table, let an admin withdraw |
| `Escrow` | Orders, NFT custody, dual deposits, claimable balances, timeouts, refunds, settlement | Allow a payee change or use one order's funds for another |
| Frontend | Reads the chain over RPC, solves puzzles locally with consent, signs orders | Be a source of truth |
| Event reader (optional) | History views | Be required for any flow |

**Mining and Escrow do not call each other and cannot use each other's funds.** Mining normally calls BLITZ for payouts; Escrow normally calls the selected payment token and NFT contracts. ERC-721 safe transfers may invoke a receiver callback, so NFT transfers are external-call/reentrancy boundaries. Pull payments prohibit pushing payment tokens during settlement; they do not mean that NFT delivery makes no external call. The mock payment ERC-20 and mock ERC-721 are test fixtures, not extra core protocol modules.

## 4. Mining

### Budget model (total for the game instance, not per round)

| Group | Total | Rounds | Per round | First version |
|---|---|---|---|---|
| A | 800 | 100 valid rounds | 8 | Active |
| B | 200 | 100 valid rounds | 2 | Disabled, 200 stay locked |

- Only valid rounds consume quota. **An empty round (no accepted answer) does not use up quota**, and its budget returns to the pool.
- Total payouts can never exceed the group's total, and reopening rounds cannot create extra quota.
- The B allocation cannot be reassigned to A automatically.
- **What "locked" means for B:** this non-upgradable Mining instance holds all 1,000 initially but has only an 800-token A payout budget. It has no path to pay, withdraw, rescue or migrate the remaining 200. Those 200 stay permanently locked here. A future B implementation requires a separately disclosed new instance. Fresh issuance in another instance is not migration of these 200, does not unlock them, and must not be presented as the same asset or the same global 1,000-token supply.

### Puzzle
- **SHA-256 leading-zero challenge.** The browser searches for a nonce; the contract recomputes the hash and checks it.
- Initial difficulty is tentatively **d = 16 leading zero bits**. Final value is set from device-speed and gas tests before deployment and remains fixed per instance. **No gas data exists yet, so no cost is promised.**
- The hash input binds **chain ID, contract instance, round id, round seed, the miner's wallet and the nonce**, so an answer cannot be replayed on another chain, instance, round or wallet.
- **Scoring: every valid answer earns a uniform 1 point.** There is no bonus for extra leading zeros. At 16 bits this is the same as a uniform `2^16` expected work per point.
- Round length: 60 seconds for the demo round, 300 seconds for a normal round. These are design defaults, fixed per instance and untested.

### Flow
1. **Open.** Anyone, when no previous round remains open and A has fewer than 100 nonempty closed rounds. Reserve 8 A tokens; fix the seed, rule version and deadline at opening block time plus the instance round length. No second round overlaps. The seed uses the previous-block hash and the chain/instance/round domain; it is not unbiased randomness and is not used to allocate random prizes.
2. **Compute.** Browser, after the user agrees. Local speed is never a reward input.
3. **Submit.** The contract verifies, rejects duplicates, and appends a point range owned by the sender.
4. **Close.** Anyone, after the deadline. It freezes total points. An empty round releases its budget and does not count.
5. **Claim.** By contribution id. Reward = `floor(budget × end / total) − floor(budget × start / total)`. These telescope, so the claims of a closed round sum exactly to its budget.

### Cost and contention notes
- Verification includes SHA-256 and persistent state writes. Its gas cost and the effect of storage packing must be measured; a cheap hash does not by itself guarantee a cheap submission.
- Every submit in a round writes the same total-points slot. Packing storage lowers gas but does not remove this hotspot. For the demo this is fine. Do not claim it is solved on Monad.
- Contracts cannot act on their own: round opening, closing and claiming need someone to send the transaction. The UI needs visible "Open", "Close" and "Claim" actions.

## 5. Escrow (first version)

Scope: same-chain test NFTs, zero protection period, settlement entirely by contract, no human adjudication.

### Order terms (signed by both sides)
Both parties, payment asset, positive price P, NFT contract and token id, funding deadline, delivery deadline, chain ID, Escrow address, protocol version, nonce, and the fixed outcomes below. The default is a 10-minute funding window plus 5 minutes to delivery; signed absolute deadlines must satisfy `creation block time < funding deadline < delivery deadline`. Reusing the same NFT for two live orders is not permitted.

### Flow
1. **Create.** Both parties sign the same order.
2. **Fund.**
   - Buyer deposits P.
   - Seller deposits P and transfers the specified NFT into Escrow.
   - The order becomes deliverable only when the contract has confirmed it received the correct asset (the right NFT contract and token id), not merely an approval.
3. **Deliver.** When both deposits and the NFT are in, the contract completes the trade: the NFT goes to the buyer and the seller's claimable balance becomes **2P** (their deposit P back plus the payment P).
4. **Withdraw.** Balance owners pull their funds out.

### Exit paths (all mandatory)

| Situation | Outcome |
|---|---|
| Deposits incomplete when the funding deadline passes | Credit actual deposits to their original owners; separately record the original seller's NFT recovery right if custody exists |
| Deposited but not delivered when the delivery deadline passes | Credit P to each original depositor; separately record the original seller's NFT recovery right |
| Delivery succeeds | NFT to the buyer, seller receives 2P |

Anyone may trigger the applicable timeout exit once its deadline and state guard are met. A timeout creates payment-withdrawal rights without waiting for NFT return; it does not guarantee that a failing NFT/token contract, unavailable chain or lost wallet key can be repaired.

### Later (off-chain goods)
Protection periods and dispute resolution arrive with off-chain goods. After the seller's deposit has been refunded, only the remaining payment can be handled, so it must not be assumed that the deposit can still be recovered.

### 5a. Execution boundaries

**Time exclusivity and state guards.** Creation requires `now < fundingDeadline < deliveryDeadline`. Funding requires `now < fundingDeadline` and an active, not-yet-funded role. Completion requires all funds and NFT custody, a nonterminal order, and `now < deliveryDeadline`. A funding-timeout exit requires incomplete funding and `now >= fundingDeadline`; a delivery-timeout exit requires complete funding, no completed delivery, and `now >= deliveryDeadline`. Complete funding before its deadline remains deliverable until the delivery deadline; the funding timeout cannot cancel it. At an exact deadline the expired action is rejected. A terminal order cannot complete or create refund credits a second time.

**Separate refund credits and NFT recovery.** A timeout marks the order refunded and credits each original depositor exactly once; it makes no NFT return call. If the NFT is held, record a return entitlement for the original seller. `Recover NFT` is a separate action: only that seller, or a caller with the seller's specific recovery authorization, may choose a nonzero receiver other than Escrow. The authorization binds chain, Escrow, version, order, NFT/tokenId, receiver, action, nonce and expiry. A failed transfer leaves the entitlement pending and leaves payment credits untouched. A successful transfer consumes it once. Do not let an arbitrary timeout caller choose the receiver or redirect payment balances. Refunded terminal orders retain recovery rights without reopening the order.

**Signature binding.** An order signature (EIP-712) covers: both parties, the payment asset, price P, NFT contract and token id, all deadlines, chain ID, Escrow contract address, protocol version and a nonce. The contract records each order hash and nonce as used, and supports cancelling an unfunded order, so a signature cannot be replayed or revived after cancel. "EIP-712 plus a nonce" alone is not enough without this stored used/cancelled state.

**Default deadlines (design defaults, fixed in the signed order, untested):** deposit window 10 minutes; delivery deadline 5 minutes after the deposit deadline.

### Rules
- Pull payment tokens only: credit claimable balances, then let their owners withdraw. Successful delivery still transfers the NFT to the fixed buyer and may invoke its receiver callback; payment crediting and NFT delivery must be atomic. On failure, no seller payment credit or completed state persists.
- Reentrancy protection on every withdrawal and NFT transfer path.
- Each order is isolated, with its own state and funds, and has terminal states that never change.
- Signature checks with a nonce so an order cannot be replayed.

## 6. System diagram

```
            Browser (frontend)
   ┌───────────────┬──────────────────┐
   │ Miner UI      │ Trade UI         │
   │ local solver  │ EIP-712 signing  │
   └──────┬────────┴────────┬─────────┘
          │ RPC (Monad testnet, chain 10143)
   ┌──────▼──────┐   ┌──────▼──────┐
   │   Mining    │   │   Escrow    │
   │ rounds,     │   │ NFT custody,│
   │ ranges,     │   │ deposits,   │
   │ claims      │   │ exits       │
   └──────┬──────┘   └───┬─────┬───┘
          │ holds        │     │ delivery interface
   ┌──────▼──────┐   ┌───▼───┐ ┌▼────────────┐
   │   BLITZ     │   │ test  │ │ ERC-721     │
   │  (ERC-20)   │   │ ERC-20│ │ custody     │
   └─────────────┘   └───────┘ └─────────────┘
   Events ──► optional event reader ──► history views only
```

## 7. Interface spec (behaviour only)

**Mining**

| Action | Who | Precondition | Effect |
|---|---|---|---|
| Open round | anyone | no round open, group A quota left | Fixes seed, deadline, budget; reserves budget |
| Submit | anyone | round open, before deadline, valid and new answer | Appends a point range for the sender |
| Close | anyone | past deadline | Freezes totals; empty round releases budget and keeps quota |
| Claim | anyone, pays the recorded owner | round closed, not claimed | Pays the floor-difference share |

**Escrow**

| Action | Who | Precondition | Effect |
|---|---|---|---|
| Create | either party, with both signatures | valid complete terms, unused/uncancelled nonce, positive P, `now < fundingDeadline < deliveryDeadline` | Stores immutable terms; consumes order authorization once |
| Fund | the corresponding buyer or seller | active order, own role not funded, `now < fundingDeadline`; seller must provide the exact unreserved NFT | Locks exactly P once per role; records correct NFT custody |
| Complete | anyone | fully funded, correct NFT held for this order, nonterminal, `now < deliveryDeadline` | Atomically transfers NFT to fixed buyer and credits seller 2P; failed transfer rolls back completion |
| Funding-timeout exit | anyone | incomplete funding, nonterminal, `now >= fundingDeadline` | Marks refunded; credits actual original deposits once; records seller NFT return entitlement if held |
| Delivery-timeout exit | anyone | fully funded but undelivered, nonterminal, `now >= deliveryDeadline` | Marks refunded; credits each depositor P once; records seller NFT return entitlement |
| Recover NFT | original seller or specifically authorized caller | refunded order, pending entitlement, NFT held; receiver nonzero and not Escrow | Transfers NFT to seller-selected receiver once; failure cannot revert existing refund credits |
| Withdraw | balance owner | balance above zero | Pays out |

**Logical data model:** `Round {id, seed, openedAt, deadline, closed, reservedBudget, totalPoints}`, `Contribution {owner, round, start, end, claimed}`, `MiningBudget {remainingA, openReserveA, closedUnclaimedA, paidA, validRounds, lockedB}`, `Order {buyer, seller, paymentAsset, price, nft, tokenId, deadlines, version, nonce, roleFunding, custody, state}`, `Balance[address][asset]`, used/cancelled order authorizations, and `NFTReturn {seller, nft, tokenId, pending, recovered, recoveryNonce}`. A per-NFT live-order reservation prevents duplicate custody attribution. These are behavior fields, not prescribed storage layout.

## 8. Invariants to test
- The claims of a nonempty closed round sum exactly to its budget, including 8 minimum units and 8 BLITZ across 3 equal contributions. An empty closed round refunds its reserve and has no reward claims.
- Total payouts never exceed 800 for group A, and the 200 for group B never move.
- BLITZ total supply never changes.
- Payment assets held cover credited plus still-locked liabilities (excluding unrelated accidental transfers). Each order's deposited minus actual withdrawals equals its remaining liabilities; the NFT is in custody, delivered to the fixed buyer, or recovered to the original seller's authorized receiver.
- Once an order reaches a terminal stage, the **order stage** cannot be reversed. Funds already credited to a balance can still be withdrawn afterwards.
- Every timeout path credits funds to the original depositor exactly once, even when later NFT recovery fails.
- Only the original seller can select or authorize the recovery receiver, and the entitlement cannot be consumed twice.
- The same NFT cannot be attributed to two live orders; recovering one order cannot take another order's asset.
- Complete and exit can never both succeed for the same order.
- A used or cancelled order signature cannot be accepted again.

## 9. Build order for 6.5 hours
1. `BLITZ` and `Mining` plus a minimal frontend. This is the demo.
2. `Escrow` happy path, both timeout exits, independent payment withdrawal and authorized NFT recovery. These are part of the done condition, not extras.
3. Event reader, only if time remains.
Anything not built is shown as "designed, not built", and the doc keeps its honest caveats: unaudited, not load-tested, multisig is not decentralization.

## 10. Remaining open points
Resolved in v0.5: scoring (uniform 1 point), deadlines (defaults in sections 4 and 5a), primary RPC (`https://testnet-rpc.monad.xyz`, verified to return 10143).

1. Final difficulty: tentatively 16 bits. Measure device speed and the gas cost per submit and per close on testnet, then freeze it. There is no gas data yet.
2. The backup RPC URL still has to be checked for availability on its own.
3. The deadline defaults above are untested and need a dry run.
4. How a separately disclosed future B version obtains its own assets and preserves clear supply/asset identity. The current instance's 200 cannot be migrated or unlocked (section 4).
