# Customization guide

The public project keeps SoulShop as its default business configuration. Safe,
non-secret runtime customization is centralized in
`src/config/app-config.ts`. Change that file before deploying a fork; do not
scatter replacement strings or arithmetic constants through the codebase.

## Brand name and application heading

`brand.name` is the business name. `brand.heading` is the independently
editable application title placed after it:

```ts
brand: {
  name: "Example Store",
  heading: "Customer Loyalty Program",
  // ...
}
```

This generates `Example Store Customer Loyalty Program`. The default generates
`SoulShop Rewards Point System`.

Telegram HTML is not accepted as configuration markup. Branding is escaped at
the insertion boundary, so a name such as `Example & Sons <Store>` is displayed
as text instead of being interpreted as HTML.

## Closing taglines and `{brand}`

`brand.taglines` is an ordered array. Edit, add, remove, or reorder its entries
independently:

```ts
taglines: [
  "Earn with every purchase",
  "Thank you for shopping with us",
  "Best Wishes from {brand}"
]
```

Every `{brand}` occurrence is replaced with the configured brand name. With
`name: "Example Store"`, the last example becomes `Best Wishes from Example
Store`. All generated tagline text is escaped before Telegram HTML insertion.
History intentionally omits the closing taglines; purchase, manual-add,
redemption, and balance messages include them.

## Purchase earning policy

Both earning systems are centralized under `rewards.earning`. Select the active
system with one master switch:

```ts
earning: {
  mode: "bracketed", // "flat" | "bracketed"

  flat: {
    policyId: "flat-50-v1",
    spendBdt: 50,
    earnPoints: 1
  },

  bracketed: {
    policyId: "bracketed-50-60-70-80-100-v1",
    pointFloorProtection: true,
    brackets: [
      { maxPurchaseBdt: 2_000, spendBdt: 50, earnPoints: 1 },
      { maxPurchaseBdt: 4_000, spendBdt: 60, earnPoints: 1 },
      { maxPurchaseBdt: 6_000, spendBdt: 70, earnPoints: 1 },
      { maxPurchaseBdt: 25_000, spendBdt: 80, earnPoints: 1 },
      { maxPurchaseBdt: null, spendBdt: 100, earnPoints: 1 }
    ]
  }
}
```

`mode: "bracketed"` is active in V2.0.5 and selects one rate for the complete
purchase amount. `mode: "flat"` remains available and applies BDT 50 = 1 point
to every positive whole-BDT purchase.

| Accepted amount | Whole-order rate |
|---:|---:|
| BDT 1-2,000 | BDT 50 = 1 point |
| BDT 2,001-4,000 | BDT 60 = 1 point |
| BDT 4,001-6,000 | BDT 70 = 1 point |
| BDT 6,001-25,000 | BDT 80 = 1 point |
| BDT 25,001 and above | BDT 100 = 1 point |

This is not a progressive slab system. For example, BDT 4,000 uses the 60-BDT
rate for all BDT 4,000; it does not add points calculated separately from the
first and second ranges.

Purchase input remains positive whole-number BDT only. Values such as
`2000.50` remain invalid. A whole-BDT calculation can still produce fractional
points: BDT 2,002 at the 60-BDT rate is 33.366666... points. The Worker uses
integer rational arithmetic, rounds the final earned amount half-up once to
four decimal places, and stores 33.3667 points as 333,667 point units. Telegram
then displays 33.37 using its separate two-decimal rule.

### Point-floor protection

`pointFloorProtection` applies only in bracketed mode:

- `true` prevents a higher amount from earning fewer points at a boundary. BDT
  2,000 earns 40.0000 points; BDT 2,001 is protected at 40.0000 instead of
  dropping to 33.3500. The award remains flat until the new rate catches up.
- `false` applies only the selected whole-order bracket rate. BDT 2,001 then
  earns 33.3500 points, even though BDT 2,000 earns 40.0000.

Protected floors are recursive: each later bracket inherits the highest award
at every preceding boundary. Flat mode ignores this switch.

The application keeps `1 point = 10,000 point units`. Under the alternative
flat policy:

```text
1 point × 10,000 units ÷ BDT 50 = 200 point units per BDT
```

BDT 1 earns 200 units, BDT 50 earns 10,000 units (1 point), and BDT 500 earns
100,000 units (10 points). Runtime calculations and `/help` text derive from
the active settings. Validation rejects invalid modes, IDs, rates, boundaries,
unsafe arithmetic, missing final unbounded brackets, and unsupported results.
JavaScript binary floating point is never the business source of truth.

An earning-mode, rate, bracket, floor, or rounding-policy change affects only
purchases confirmed after the new Worker is deployed. It does not recalculate
or rewrite existing customer balances,
transactions, mutation receipts, reward snapshots, history, or leaderboard
aggregates, so no D1 migration is needed. A pending confirmation calculated by
an older Worker is rejected without mutation and must be restarted so its
displayed and committed point amounts always match.

If the rate changes during an active leaderboard week or month, that period can
legitimately contain purchases calculated under both policies. Document the
deployment time for operational interpretation.

## Redemption policy is migration-sensitive

The default remains:

```ts
redemption: {
  points: 4,
  valueBdt: 1
}
```

That means 4 points equal BDT 1, 1 point equals BDT 0.25, and one reward BDT is
40,000 point units. Configure this before production customer data exists.

Changing the redemption rate after production use changes how current balances
are valued while historical rows still contain reward snapshots calculated
under the earlier policy. A reviewed D1 migration/backfill and rollout plan is
required to make those records consistent. Resetting D1 is acceptable only for
a disposable local/test installation. Never reset a production database
without an approved backup, migration plan, and explicit authorization.

## CSV filename prefix

The configured brand is converted to a lowercase, hyphenated ASCII prefix:

- `SoulShop` becomes `soulshop`.
- `Example Store` becomes `example-store`.
- A name with no usable ASCII filename characters uses `loyalty-rewards`.

CSV content, exact four-decimal point values, privacy protections, and row/byte
limits are unchanged.

## Infrastructure rebranding checklist

`APP_CONFIG` intentionally does not change infrastructure. Review these items
separately, preferably before first production deployment:

1. Cloudflare Worker `name` in `wrangler.jsonc`.
2. D1 `database_name`, database ID, and the matching npm scripts.
3. Telegram bot display name and username in BotFather.
4. GitHub repository name and remotes.
5. npm package name in `package.json` and `package-lock.json`.
6. Public `workers.dev` or custom Worker URL.
7. Cloudflare account/environment configuration and CI variables.
8. Operational backup filenames and organization-specific documentation.

Do not rename existing production infrastructure merely to change Telegram
branding. Plan and verify each infrastructure rename independently.

## Secrets, customer data, and Git

Never put `BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, Cloudflare
credentials, real phone numbers, customer notes, exports, backups, or sensitive
logs in `APP_CONFIG`, source, tests, documentation, or commits. Keep local
secrets in ignored `.dev.vars`/environment variables and production secrets in
Cloudflare's secret storage. Confirm ignores before sharing a fork:

```powershell
git check-ignore -v .dev.vars
git check-ignore -v .env
git status --short
```

## Validate a customization locally

From PowerShell in the repository root:

```powershell
npm ci
npm run db:migrate:local
npm run check
git diff --check
git status --short
```

`npm run check` runs strict TypeScript, ESLint, the full Vitest suite, and a
Wrangler dry-run build. It does not deploy.

For branding-specific verification, temporarily customize `APP_CONFIG`, run
the checks, start the local Worker with `npm run dev`, and inspect `/start` and
`/help` only with safe local credentials. Confirm the heading, each tagline,
HTML-like characters, help rates, and CSV prefix. Restore or commit the intended
configuration deliberately; never use production secrets for a public test.

Before production, also test representative purchases (including exactly one
configured earning unit), balance, redemption, history, export, leaderboard,
authorization, and a deliberately stale purchase confirmation in an isolated
environment.
