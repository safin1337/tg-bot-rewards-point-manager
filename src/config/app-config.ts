export type EarningMode = "flat" | "bracketed";

export interface EarningRatioConfiguration {
  policyId: string;
  spendBdt: number;
  earnPoints: number;
}

export interface EarningBracketConfiguration {
  maxPurchaseBdt: number | null;
  spendBdt: number;
  earnPoints: number;
}

export interface AppConfiguration {
  brand: {
    name: string;
    heading: string;
    taglines: readonly string[];
  };
  rewards: {
    earning: {
      mode: EarningMode;
      flat: EarningRatioConfiguration;
      bracketed: {
        policyId: string;
        pointFloorProtection: boolean;
        brackets: readonly EarningBracketConfiguration[];
      };
    };
    redemption: {
      points: number;
      valueBdt: number;
    };
  };
}

export const APP_CONFIG = {
  brand: {
    name: "SoulShop",
    heading: "Rewards Point System",

    taglines: [
      "Buy More to Earn More",
      "Thank you for purchasing from us",
      "Best Wishes from {brand}"
    ]

    /**
     * BRANDING GUIDE
     *
     * The generated heading is:
     * SoulShop Rewards Point System
     *
     * The {brand} placeholder automatically produces:
     * Best Wishes from SoulShop
     *
     * If the brand name is changed to:
     * name: "Example Store"
     *
     * The generated heading and closing line become:
     * Example Store Rewards Point System
     * Best Wishes from Example Store
     *
     * You may replace any tagline or change the heading independently.
     * Keep {brand} wherever the configured brand name should appear
     * automatically.
     */
  },

  rewards: {
    earning: {
      /**
       * EARNING MODE GUIDE
       *
       * "flat" keeps one earning rate for every positive whole-BDT purchase.
       * "bracketed" applies one configured rate to the complete purchase
       * amount according to the first matching upper boundary below.
       *
       * Purchase input remains positive whole-number BDT only in both modes.
       * Earned points are always rounded half-up to four decimal places before
       * their integer point units are stored.
       */
      mode: "bracketed", // "flat" | "bracketed"

      flat: {
        policyId: "flat-50-v1",
        spendBdt: 50,
        earnPoints: 1
      },

      bracketed: {
        policyId: "bracketed-50-60-70-80-100-v1",

        /**
         * POINT-FLOOR PROTECTION GUIDE
         *
         * true: prevents a higher purchase from earning fewer points than the
         * protected maximum at the preceding bracket boundary.
         *
         * false: applies only the selected whole-order bracket rate. This can
         * cause a point drop immediately after a boundary.
         *
         * Example with whole-BDT input:
         * BDT 2,000 at the BDT-50 rate earns 40.0000 points.
         * BDT 2,001 at the BDT-60 rate normally earns 33.3500 points.
         * With protection enabled, BDT 2,001 earns at least 40.0000 points.
         */
        pointFloorProtection: true,

        brackets: [
          // Whole-order purchase range: BDT 1-2,000.
          { maxPurchaseBdt: 2_000, spendBdt: 50, earnPoints: 1 },
          // Whole-order purchase range: BDT 2,001-4,000.
          { maxPurchaseBdt: 4_000, spendBdt: 60, earnPoints: 1 },
          // Whole-order purchase range: BDT 4,001-6,000.
          { maxPurchaseBdt: 6_000, spendBdt: 70, earnPoints: 1 },
          // Whole-order purchase range: BDT 6,001-25,000.
          { maxPurchaseBdt: 25_000, spendBdt: 80, earnPoints: 1 },
          // Whole-order purchase range: BDT 25,001 and above (unbounded).
          { maxPurchaseBdt: null, spendBdt: 100, earnPoints: 1 }
        ]
      }
    },

    /**
     * WARNING:
     * Configure the redemption rate before the application begins storing
     * production customer data.
     *
     * Changing this rate after production data exists will make previously
     * stored reward values and historical reward snapshots inconsistent unless
     * a reviewed D1 migration/backfill is performed.
     *
     * Resetting all D1 data is an alternative only for disposable or test
     * installations. Never reset a production database without an approved
     * backup and migration plan.
     */
    redemption: {
      points: 4,
      valueBdt: 1
    }
  }
} as const satisfies AppConfiguration;

const POINT_UNITS_PER_POINT = 10_000n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const FALLBACK_FILENAME_SLUG = "loyalty-rewards";
const POLICY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface RuntimeEarningRatioConfiguration {
  policyId: string;
  spendBdt: number;
  earnPoints: number;
}

export interface RuntimeEarningBracketConfiguration {
  maxPurchaseBdt: number | null;
  spendBdt: number;
  earnPoints: number;
  protectedFloorUnits: number;
}

export interface RuntimeEarningConfiguration {
  mode: EarningMode;
  policyId: string;
  flat: RuntimeEarningRatioConfiguration;
  bracketed: {
    policyId: string;
    pointFloorProtection: boolean;
    brackets: readonly RuntimeEarningBracketConfiguration[];
  };
}

export interface RuntimeAppConfiguration {
  brand: {
    name: string;
    heading: string;
    fullHeading: string;
    taglines: readonly string[];
    filenameSlug: string;
  };
  rewards: {
    earning: RuntimeEarningConfiguration;
    redemption: {
      points: number;
      valueBdt: number;
      pointUnitsPerRewardBdt: number;
    };
  };
}

const requirePositiveSafeInteger = (value: number, path: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
};

const requirePolicyId = (value: string, path: string): void => {
  if (!POLICY_ID_PATTERN.test(value)) {
    throw new Error(`${path} must contain 1-64 letters, numbers, dots, underscores, or hyphens.`);
  }
};

const exactPointUnitsPerBdt = (
  points: number,
  bdt: number,
  path: string
): number => {
  requirePositiveSafeInteger(points, `${path}.points`);
  requirePositiveSafeInteger(bdt, `${path}.bdt`);
  const pointUnits = BigInt(points) * POINT_UNITS_PER_POINT;
  const bdtValue = BigInt(bdt);
  if (pointUnits % bdtValue !== 0n) {
    throw new Error(`${path} must produce an exact whole-number point-unit conversion per BDT.`);
  }
  const result = pointUnits / bdtValue;
  if (result <= 0n || result > MAX_SAFE_INTEGER) {
    throw new Error(`${path} produces an unsupported point-unit conversion.`);
  }
  return Number(result);
};

const roundedEarningUnits = (
  purchaseAmountBdt: number,
  earnPoints: number,
  spendBdt: number,
  path: string
): number => {
  requirePositiveSafeInteger(purchaseAmountBdt, `${path}.purchaseAmountBdt`);
  requirePositiveSafeInteger(earnPoints, `${path}.earnPoints`);
  requirePositiveSafeInteger(spendBdt, `${path}.spendBdt`);
  const numerator = BigInt(purchaseAmountBdt) * BigInt(earnPoints) * POINT_UNITS_PER_POINT;
  const denominator = BigInt(spendBdt);
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  if (rounded <= 0n || rounded > MAX_SAFE_INTEGER) {
    throw new Error(`${path} produces an unsupported point-unit value.`);
  }
  return Number(rounded);
};

const deriveEarningConfiguration = (
  config: AppConfiguration["rewards"]["earning"]
): RuntimeEarningConfiguration => {
  const rawMode: unknown = config.mode;
  if (rawMode !== "flat" && rawMode !== "bracketed") {
    throw new Error('APP_CONFIG.rewards.earning.mode must be "flat" or "bracketed".');
  }
  requirePolicyId(config.flat.policyId, "APP_CONFIG.rewards.earning.flat.policyId");
  requirePositiveSafeInteger(config.flat.spendBdt, "APP_CONFIG.rewards.earning.flat.spendBdt");
  requirePositiveSafeInteger(config.flat.earnPoints, "APP_CONFIG.rewards.earning.flat.earnPoints");
  roundedEarningUnits(
    1,
    config.flat.earnPoints,
    config.flat.spendBdt,
    "APP_CONFIG.rewards.earning.flat"
  );

  const bracketedPath = "APP_CONFIG.rewards.earning.bracketed";
  requirePolicyId(config.bracketed.policyId, `${bracketedPath}.policyId`);
  if (typeof config.bracketed.pointFloorProtection !== "boolean") {
    throw new Error(`${bracketedPath}.pointFloorProtection must be a boolean.`);
  }
  const rawBrackets: unknown = config.bracketed.brackets;
  if (!Array.isArray(rawBrackets)) {
    throw new Error(`${bracketedPath}.brackets must be an array.`);
  }
  const bracketsConfig: readonly EarningBracketConfiguration[] = config.bracketed.brackets;
  if (bracketsConfig.length === 0) {
    throw new Error(`${bracketedPath}.brackets must contain at least one bracket.`);
  }

  let previousMax = 0;
  let protectedFloorUnits = 0;
  const brackets = bracketsConfig.map((bracket, index) => {
    const path = `${bracketedPath}.brackets[${index}]`;
    requirePositiveSafeInteger(bracket.spendBdt, `${path}.spendBdt`);
    requirePositiveSafeInteger(bracket.earnPoints, `${path}.earnPoints`);
    const final = index === bracketsConfig.length - 1;
    if (bracket.maxPurchaseBdt === null) {
      if (!final) throw new Error(`${path}.maxPurchaseBdt may be null only for the final bracket.`);
    } else {
      requirePositiveSafeInteger(bracket.maxPurchaseBdt, `${path}.maxPurchaseBdt`);
      if (bracket.maxPurchaseBdt <= previousMax) {
        throw new Error(`${path}.maxPurchaseBdt must be strictly greater than the previous boundary.`);
      }
      if (final) throw new Error(`${path}.maxPurchaseBdt must be null for the final unbounded bracket.`);
    }
    roundedEarningUnits(previousMax + 1, bracket.earnPoints, bracket.spendBdt, path);
    const runtimeBracket: RuntimeEarningBracketConfiguration = {
      maxPurchaseBdt: bracket.maxPurchaseBdt,
      spendBdt: bracket.spendBdt,
      earnPoints: bracket.earnPoints,
      protectedFloorUnits
    };
    if (bracket.maxPurchaseBdt !== null) {
      const boundaryUnits = roundedEarningUnits(
        bracket.maxPurchaseBdt,
        bracket.earnPoints,
        bracket.spendBdt,
        path
      );
      protectedFloorUnits = Math.max(protectedFloorUnits, boundaryUnits);
      previousMax = bracket.maxPurchaseBdt;
    }
    return runtimeBracket;
  });

  const flat = {
    policyId: config.flat.policyId,
    spendBdt: config.flat.spendBdt,
    earnPoints: config.flat.earnPoints
  };
  const bracketed = {
    policyId: config.bracketed.policyId,
    pointFloorProtection: config.bracketed.pointFloorProtection,
    brackets
  };
  const activePolicy = config.mode === "flat"
    ? `${flat.policyId}:${flat.spendBdt}:${flat.earnPoints}`
    : `${bracketed.policyId}:${bracketed.pointFloorProtection ? "floor-on" : "floor-off"}:${brackets
      .map((bracket) => `${bracket.maxPurchaseBdt ?? "infinite"},${bracket.spendBdt},${bracket.earnPoints}`)
      .join("|")}`;
  const policyId = `earning:${config.mode}:${activePolicy}:round-half-up-4`;
  if (policyId.length > 500) {
    throw new Error("The active earning-policy fingerprint is too long.");
  }

  return { mode: config.mode, policyId, flat, bracketed };
};

export const createBrandFilenameSlug = (brandName: string): string => {
  const slug = brandName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || FALLBACK_FILENAME_SLUG;
};

export const deriveAppConfiguration = (config: AppConfiguration): RuntimeAppConfiguration => {
  const name = config.brand.name.trim();
  const heading = config.brand.heading.trim();
  if (name.length === 0) throw new Error("APP_CONFIG.brand.name must not be empty.");
  if (heading.length === 0) throw new Error("APP_CONFIG.brand.heading must not be empty.");
  if (!Array.isArray(config.brand.taglines)) {
    throw new Error("APP_CONFIG.brand.taglines must be an array of strings.");
  }
  const taglines = config.brand.taglines.map((tagline, index) => {
    if (typeof tagline !== "string") {
      throw new Error(`APP_CONFIG.brand.taglines[${index}] must be a string.`);
    }
    return tagline.replaceAll("{brand}", name);
  });

  const earning = deriveEarningConfiguration(config.rewards.earning);
  const pointUnitsPerRewardBdt = exactPointUnitsPerBdt(
    config.rewards.redemption.points,
    config.rewards.redemption.valueBdt,
    "APP_CONFIG.rewards.redemption"
  );

  return {
    brand: {
      name,
      heading,
      fullHeading: `${name} ${heading}`,
      taglines,
      filenameSlug: createBrandFilenameSlug(name)
    },
    rewards: {
      earning,
      redemption: {
        points: config.rewards.redemption.points,
        valueBdt: config.rewards.redemption.valueBdt,
        pointUnitsPerRewardBdt
      }
    }
  };
};

export const APP_RUNTIME_CONFIG = deriveAppConfiguration(APP_CONFIG);
