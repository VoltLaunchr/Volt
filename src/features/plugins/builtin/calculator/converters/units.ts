/**
 * Unit conversion system
 * Supports: temperature, distance, weight, volume, data, time, speed
 */

export interface ConversionResult {
  value: number;
  fromUnit: string;
  toUnit: string;
  category: string;
}

// Conversion tables - all conversions go through a base unit
const CONVERSIONS = {
  // Temperature (special handling - non-linear)
  temperature: {
    units: ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'],
    // Conversion functions
    c_to_f: (c: number) => (c * 9) / 5 + 32,
    f_to_c: (f: number) => ((f - 32) * 5) / 9,
    c_to_k: (c: number) => c + 273.15,
    k_to_c: (k: number) => k - 273.15,
  },

  // Distance (base: meters)
  distance: {
    m: 1,
    meter: 1,
    meters: 1,
    km: 1000,
    kilometer: 1000,
    kilometers: 1000,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    mi: 1609.34,
    mile: 1609.34,
    miles: 1609.34,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
  },

  // Weight/Mass (base: kilograms)
  weight: {
    kg: 1,
    kilogram: 1,
    kilograms: 1,
    g: 0.001,
    gram: 0.001,
    grams: 0.001,
    mg: 0.000001,
    milligram: 0.000001,
    milligrams: 0.000001,
    lb: 0.453592,
    lbs: 0.453592,
    pound: 0.453592,
    pounds: 0.453592,
    oz: 0.0283495,
    ounce: 0.0283495,
    ounces: 0.0283495,
    ton: 1000,
    tons: 1000,
    tonne: 1000,
    tonnes: 1000,
  },

  // Volume (base: liters)
  volume: {
    l: 1,
    liter: 1,
    liters: 1,
    litre: 1,
    litres: 1,
    ml: 0.001,
    milliliter: 0.001,
    milliliters: 0.001,
    millilitre: 0.001,
    millilitres: 0.001,
    gal: 3.78541,
    gallon: 3.78541,
    gallons: 3.78541,
    qt: 0.946353,
    quart: 0.946353,
    quarts: 0.946353,
    pt: 0.473176,
    pint: 0.473176,
    pints: 0.473176,
    cup: 0.24,
    cups: 0.24,
    fl_oz: 0.0295735,
    'fluid ounce': 0.0295735,
    'fluid ounces': 0.0295735,
  },

  // Data/Storage (base: bytes)
  data: {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    kilobyte: 1024,
    kilobytes: 1024,
    mb: 1024 * 1024,
    megabyte: 1024 * 1024,
    megabytes: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    gigabyte: 1024 * 1024 * 1024,
    gigabytes: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    terabyte: 1024 * 1024 * 1024 * 1024,
    terabytes: 1024 * 1024 * 1024 * 1024,
    pb: 1024 * 1024 * 1024 * 1024 * 1024,
    petabyte: 1024 * 1024 * 1024 * 1024 * 1024,
    petabytes: 1024 * 1024 * 1024 * 1024 * 1024,
  },

  // Time (base: seconds)
  time: {
    s: 1,
    sec: 1,
    second: 1,
    seconds: 1,
    min: 60,
    minute: 60,
    minutes: 60,
    h: 3600,
    hr: 3600,
    hour: 3600,
    hours: 3600,
    d: 86400,
    day: 86400,
    days: 86400,
    wk: 604800,
    week: 604800,
    weeks: 604800,
    month: 2592000, // 30 days
    months: 2592000,
    year: 31536000, // 365 days
    years: 31536000,
  },

  // Speed (base: meters per second)
  speed: {
    'm/s': 1,
    'km/h': 0.277778,
    'mi/h': 0.44704,
    mph: 0.44704,
    'ft/s': 0.3048,
    knot: 0.514444,
    knots: 0.514444,
  },
} as const;

/**
 * Convert a value from one unit to another
 */
export function convertUnit(value: number, from: string, to: string): ConversionResult | null {
  // Normalize units to lowercase
  const fromUnit = from.toLowerCase().trim();
  const toUnit = to.toLowerCase().trim();

  // Same unit - no conversion needed
  if (fromUnit === toUnit) {
    return {
      value,
      fromUnit,
      toUnit,
      category: findCategory(fromUnit, toUnit) || 'unknown',
    };
  }

  // Find the category
  const category = findCategory(fromUnit, toUnit);
  if (!category) {
    return null; // Invalid conversion
  }

  // Special handling for temperature (non-linear)
  if (category === 'temperature') {
    const result = convertTemperature(value, fromUnit, toUnit);
    if (result === null) return null;
    return {
      value: result,
      fromUnit,
      toUnit,
      category,
    };
  }

  // Standard linear conversion: from → base → to
  const conversions = CONVERSIONS[category as keyof typeof CONVERSIONS];
  if (typeof conversions === 'object' && 'units' in conversions) {
    // Skip temperature object
    return null;
  }

  const fromFactor = conversions[fromUnit as keyof typeof conversions];
  const toFactor = conversions[toUnit as keyof typeof conversions];

  if (fromFactor === undefined || toFactor === undefined) {
    return null;
  }

  const baseValue = value * (fromFactor as number);
  const result = baseValue / (toFactor as number);

  return {
    value: result,
    fromUnit,
    toUnit,
    category,
  };
}

/**
 * Convert temperature (special non-linear conversions)
 */
function convertTemperature(value: number, from: string, to: string): number | null {
  const fromNorm = normalizeTemperatureUnit(from);
  const toNorm = normalizeTemperatureUnit(to);

  if (!fromNorm || !toNorm) return null;
  if (fromNorm === toNorm) return value;

  // Convert to Celsius first
  let celsius = value;
  if (fromNorm === 'f') {
    celsius = CONVERSIONS.temperature.f_to_c(value);
  } else if (fromNorm === 'k') {
    celsius = CONVERSIONS.temperature.k_to_c(value);
  }

  // Convert from Celsius to target
  if (toNorm === 'c') {
    return celsius;
  } else if (toNorm === 'f') {
    return CONVERSIONS.temperature.c_to_f(celsius);
  } else if (toNorm === 'k') {
    return CONVERSIONS.temperature.c_to_k(celsius);
  }

  return null;
}

/**
 * Normalize temperature unit names
 */
function normalizeTemperatureUnit(unit: string): 'c' | 'f' | 'k' | null {
  const normalized = unit.toLowerCase();
  if (normalized === 'c' || normalized === 'celsius') return 'c';
  if (normalized === 'f' || normalized === 'fahrenheit') return 'f';
  if (normalized === 'k' || normalized === 'kelvin') return 'k';
  return null;
}

/**
 * Find which category a unit belongs to
 */
function findCategory(from: string, to: string): string | null {
  const fromNorm = from.toLowerCase();
  const toNorm = to.toLowerCase();

  for (const [category, units] of Object.entries(CONVERSIONS)) {
    if (category === 'temperature') {
      // Special handling for temperature
      const tempUnits = CONVERSIONS.temperature.units as readonly string[];
      if (tempUnits.includes(fromNorm) && tempUnits.includes(toNorm)) {
        return 'temperature';
      }
      continue;
    }

    // Check if both units exist in this category
    const unitKeys = Object.keys(units);
    if (unitKeys.includes(fromNorm) && unitKeys.includes(toNorm)) {
      return category;
    }
  }

  return null;
}

/**
 * Get all supported units for a category
 */
export function getSupportedUnits(category: string): string[] {
  const conversions = CONVERSIONS[category as keyof typeof CONVERSIONS];
  if (!conversions) return [];

  if (category === 'temperature') {
    return [...CONVERSIONS.temperature.units];
  }

  return Object.keys(conversions);
}

/**
 * Check if a unit is valid
 */
export function isValidUnit(unit: string): boolean {
  const normalized = unit.toLowerCase();

  for (const [category, units] of Object.entries(CONVERSIONS)) {
    if (category === 'temperature') {
      if ((CONVERSIONS.temperature.units as readonly string[]).includes(normalized)) {
        return true;
      }
      continue;
    }

    if (Object.keys(units).includes(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Get category for a unit
 */
export function getCategoryForUnit(unit: string): string | null {
  const normalized = unit.toLowerCase();

  for (const [category, units] of Object.entries(CONVERSIONS)) {
    if (category === 'temperature') {
      if ((CONVERSIONS.temperature.units as readonly string[]).includes(normalized)) {
        return 'temperature';
      }
      continue;
    }

    if (Object.keys(units).includes(normalized)) {
      return category;
    }
  }

  return null;
}
