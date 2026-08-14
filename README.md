# Telegram Bot: Loyalty Rewards Point Manager

A production-ready Telegram bot for managing customer loyalty and reward points
for a business. It allows an authorized administrator to register customers,
record purchases, manually add points, redeem points, check balances, review
transaction history, view leaderboards, and export operational data.

The application is deployed as a Cloudflare Worker and uses Cloudflare D1, a
managed serverless SQL database built on SQLite. It requires no continuously
running server and is designed for secure, low-maintenance operation.

This project was originally developed for **SoulShop — Bangladesh's E-Shop**,
an online store offering digital solutions for everyday needs. The public
version retains SoulShop as its default configuration while allowing other
businesses to customize the branding, headings, taglines, and reward policy.

No AI service, paid database, custom domain, or production long polling is
required.

## Customize it for another business

All non-secret runtime branding and reward-policy settings live in
[`src/config/app-config.ts`](src/config/app-config.ts). The complete safety and
infrastructure checklist is in [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md).

For example, a fork can use:

```ts
brand: {
  name: "Example Store",
  heading: "Customer Loyalty Program"
}

rewards: {
  earning: {
    mode: "flat",
    flat: {
      policyId: "flat-100-v1",
      spendBdt: 100,
      earnPoints: 1
    }
  }
}
```
For a new installation, follow the complete
[Fresh Installation Guide](docs/Fresh-Installation.md). It is the authoritative
setup runbook.

Runtime headings, escaped taglines, purchase calculations, help text, and the
CSV filename prefix derive from these settings. Configure the redemption rate
before production data exists; changing it later is migration-sensitive and
must not be treated as a casual presentation change.

`APP_CONFIG` does not rename the Cloudflare Worker, D1 database, Telegram bot
username, GitHub repository, npm package, public Worker URL, or Cloudflare
account configuration. Those infrastructure identifiers are intentionally
separate; follow the checklist in `docs/CUSTOMIZATION.md` if they also need to
change.

## Architecture

```text
Authorized administrator
        |
        v
Telegram Bot API
        |
        v  HTTPS POST /webhook + secret header
Cloudflare Worker (TypeScript)
        |
        +-- D1 conversation state and bounded operational receipts
        +-- D1 authoritative customer balances
        +-- D1 newest-40 detailed transactions
        +-- D1 weekly/monthly leaderboard aggregates and reset generations
        |
        v
Telegram messages and CSV documents
```

The Worker exposes:

- `GET /health`: returns only `{"status":"ok"}`.
- `POST /webhook`: accepts validated Telegram messages and callback queries.
- Other methods and routes return safe `404` or `405` responses.

The source is split into domain calculations, validated D1 repositories, atomic application services, Telegram transport and templates, workflow routing, and exports.

## Loyalty rules

- `1 point = 10,000 point units`.
- V2.0.5 centralizes both `flat` and `bracketed` earning modes in `APP_CONFIG`.
- V2.0.5 ships with `bracketed` mode active. It applies one rate to the complete
  purchase: BDT
  1-2,000 at 50:1, 2,001-4,000 at 60:1, 4,001-6,000 at 70:1, 6,001-25,000 at
  80:1, and 25,001+ at 100:1. It is not progressive.
- The alternative `flat` mode applies `BDT 50 spent = 1 point` to every positive
  whole-BDT purchase.
- Bracketed `pointFloorProtection` is independently configurable. When enabled,
  it prevents a larger purchase from earning fewer points at a boundary; when
  disabled, the raw whole-order bracket rate applies.
- `1 point = BDT 0.25` reward value.
- The redemption policy remains `4 points = BDT 1`.
- Rounded reward BDT is `floor((point units + 20,000) / 40,000)`.
- Branding and both reward policies are validated from `APP_CONFIG` using
  integer arithmetic, ordered boundaries, safe ranges, and one final unbounded
  bracket.
- Point balances and transaction deltas use integers only. JavaScript floating point is never the source of truth.
- Purchase input remains positive whole-number BDT only. Decimal purchase input
  is rejected in both earning modes.
- Earned purchase points are rounded half-up once to four decimal places before
  their integer point units are stored. The separate Telegram display rule
  still rounds to two decimals.
- Manual additions and redemptions accept up to four decimal places.
- The redemption amount prompt also offers `Redeem All Points`. It selects the
  customer's exact stored integer balance, then shows the normal confirmation
  before any mutation. This avoids treating a two-decimal display value as the
  underlying exact amount.
- Detailed history retains the newest 40 rows per customer across all three transaction types combined. The deterministic order is `created_at_utc DESC, id DESC`.
- Completed mutation receipts correspond to retained detail rows; a per-customer update-ID high-water mark rejects delayed updates after their bounded receipts are pruned.

Example:

```text
BDT 500 = 100,000 units = 10 points
10 points ≈ BDT 3 displayed reward value
```

Telegram displays that exact balance as `10.00 points`. All Telegram-visible
point amounts use exactly two decimal places and standard half-up rounding at
the third decimal place, with comma-grouped thousands such as `1,356.70`. The
underlying point units, calculations, parsing, leaderboard ranking, and CSV
exports retain their exact precision.

Existing balances, transactions, mutation receipts, history, and leaderboard
totals remain exactly as stored when the earning mode or rate changes. The new policy
applies only to purchases confirmed after the new Worker is deployed. A
leaderboard week or month spanning deployment can therefore contain purchases
calculated under both earning policies. Confirmations prepared under an older
policy are rejected without mutation and must be restarted.

Purchase and manual-add results label the post-transaction total as the
`updated reward balance`; balance checks use `current reward balance`.
Redemption results separately label the redeemed amount/value and the remaining
balance/value. These customer-facing labels do not change reward calculations.

## Leaderboard rules

- Weekly periods run Monday 12:00 AM through Sunday 11:59:59.999 PM in `Asia/Dhaka`.
- Available weekly views are the running week, the previous completed week, and two weeks ago.
- Available monthly views are the running month and the previous completed month.
- `PURCHASE` and `MANUAL_ADD` contribute positive gross earned point units. `REDEEM` never changes leaderboard earnings.
- Rankings use exact `earned_point_units DESC`, then the earliest qualifying earning timestamp, then `customer_id ASC`.
- Results show normalized phone numbers, never customer names, and are limited to 10 entries.
- Display uses deterministic two-decimal rounding, while storage remains exact integer point units with four-decimal point precision.
- Weekly and monthly resets are independent. A reset starts a new generation/cutoff for only the current period; balances and detailed history do not change.

## Commands

| Command | Purpose |
|---|---|
| `/start` | Open the dashboard |
| `/purchase` | Record a purchase |
| `/addpoints` | Add fractional points manually |
| `/redeem` | Redeem a typed fractional amount or the exact full balance |
| `/balance` | Check the latest balance |
| `/history` | View newest-first reward history |
| `/addcustomer` | Register a zero-point customer |
| `/export` | Export customers and/or transactions |
| `/leaderboard` | View weekly/monthly rankings or reset the current period |
| `/restart` | Restart the active workflow |
| `/cancel` | Cancel the active workflow |
| `/help` | Show bot instructions |

Inline-button navigation uses one active bot message where chronological order
allows it. Confirmation panels become success results after commit, while
responses following typed input are sent below that input. Telegram edit
failures use one safe send-message fallback without repeating database work.
The first screen inside an operation keeps `Cancel` as the dashboard exit.
Deeper customer-search, amount, note, and confirmation screens also provide a
tokenized `Back` action that returns one logical step, clears later collected
values, and invalidates buttons from the abandoned screen.
Record Purchase uses the `🛍️` emoji. After `Search by Last Digits` or `Enter
Full Number` is selected, the number-entry prompt repeats the active operation
above its instructions. Customer-search navigation uses the compact
`⬅️ Back` label.

After a customer is selected for Record Purchase or Add Points, the amount-entry
panel shows the newest retained earning transaction (`PURCHASE` or
`MANUAL_ADD`) and skips redemptions. Purchase entries include the purchase
amount; manual additions include the safely escaped reason when present. If no
eligible row exists among the customer's retained newest 40 transactions, the
panel shows `No Prior Data Found!`. This is a read-only display and does not
change the customer's balance or history.
See [the active-message workflow contract](docs/TELEGRAM-WORKFLOWS.md).

## Installation and deployment

For a new installation, follow the complete
[Fresh Installation Guide](docs/Fresh-Installation.md). It is the authoritative
setup runbook for:

- Required software and exact Windows PowerShell commands.
- Values each new owner must replace.
- Cloudflare authentication, Worker configuration, and D1 creation.
- Local and remote migrations.
- Telegram bot creation, administrator ID, and webhook secret generation.
- Local development and validation.
- Production secrets, deployment, webhook registration, and command setup.
- Acceptance testing, logs, D1 queries, exports, backups, secret rotation, and
  troubleshooting.

Do not run remote migrations, deploy, or register a webhook until the guide's
prerequisites and replacement checklist are complete. Existing SoulShop
operators preparing this release should also use the
[V2.0.5 release guide](docs/V2.0.5-RELEASE.md).

## Security summary

- One administrator ID is checked before any customer query or mutation.
- The webhook secret header is required.
- Telegram updates, callback values, D1 rows, state JSON, point inputs, and phones are validated.
- Balance, detailed transaction, applicable leaderboard totals, completed receipt, paired pruning, and the mutation high-water mark are one atomic D1 batch guarded by the expected balance.
- Retained receipts reject duplicate Telegram updates; the per-customer high-water mark rejects older updates after receipt pruning.
- Callback panels are edited in place where chronologically safe; a failed edit falls back to one new message without changing the committed business result.
- Notes and dynamic values are HTML escaped.
- CSV formula injection is neutralized.
- No real token or secret belongs in source control.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License status

This repository does not currently include a `LICENSE` file. The owner should
select and add an appropriate open-source license before announcing the project
as publicly reusable. No license has been chosen automatically by this release.
