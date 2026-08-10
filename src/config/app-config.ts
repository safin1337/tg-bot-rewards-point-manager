export interface AppConfiguration {
  brand: {
    name: string;
    heading: string;
    taglines: readonly string[];
  };
  rewards: {
    earning: {
      spendBdt: number;
      earnPoints: number;
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
      spendBdt: 50,
      earnPoints: 1
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

export interface RuntimeAppConfiguration {
  brand: {
    name: string;
    heading: string;
    fullHeading: string;
    taglines: readonly string[];
    filenameSlug: string;
  };
  rewards: {
    earning: {
      spendBdt: number;
      earnPoints: number;
      pointUnitsPerBdt: number;
      policyId: string;
    };
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

  const pointUnitsPerBdt = exactPointUnitsPerBdt(
    config.rewards.earning.earnPoints,
    config.rewards.earning.spendBdt,
    "APP_CONFIG.rewards.earning"
  );
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
      earning: {
        spendBdt: config.rewards.earning.spendBdt,
        earnPoints: config.rewards.earning.earnPoints,
        pointUnitsPerBdt,
        policyId: `earning:${config.rewards.earning.spendBdt}:${config.rewards.earning.earnPoints}:${pointUnitsPerBdt}`
      },
      redemption: {
        points: config.rewards.redemption.points,
        valueBdt: config.rewards.redemption.valueBdt,
        pointUnitsPerRewardBdt
      }
    }
  };
};

export const APP_RUNTIME_CONFIG = deriveAppConfiguration(APP_CONFIG);
