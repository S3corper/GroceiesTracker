const unitAliases: Record<string, string> = { lbs: "lb", kgs: "kg", ozs: "oz", gs: "g", mls: "ml" };

export function printedMeasurement(text: string) {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs|oz|ozs|g|gs|ml|mls|l)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rawUnit = match[2].toLowerCase();
  return { amount, unit: unitAliases[rawUnit] ?? rawUnit, text: match[0] };
}

export function resolveMeasurement(name: string, variant: string, amount: unknown, unit: unknown) {
  // A size printed in the product description is stronger evidence than an OCR model's unit field.
  const printed = printedMeasurement(name) ?? printedMeasurement(variant);
  if (printed) return { amount: printed.amount, unit: printed.unit };
  const numericAmount = Number(amount);
  const rawUnit = String(unit ?? "").trim().toLowerCase();
  const normalizedUnit = unitAliases[rawUnit] ?? rawUnit;
  if (Number.isFinite(numericAmount) && numericAmount > 0 && ["kg", "g", "lb", "oz", "l", "ml"].includes(normalizedUnit)) {
    return { amount: numericAmount, unit: normalizedUnit };
  }
  return null;
}

export function comparablePrice(linePrice: number, quantity: number, amount: number, unit: string) {
  const poundsPerUnit: Record<string, number> = { g: 1 / 453.59237, kg: 1000 / 453.59237, oz: 1 / 16, lb: 1 };
  const litersPerUnit: Record<string, number> = { ml: 1 / 1000, l: 1 };
  const pounds = poundsPerUnit[unit];
  if (pounds) return { unitPrice: linePrice / (amount * pounds * quantity), unitPriceUnit: "lb" };
  const liters = litersPerUnit[unit];
  if (liters) return { unitPrice: linePrice / (amount * liters * quantity), unitPriceUnit: "l" };
  return null;
}
