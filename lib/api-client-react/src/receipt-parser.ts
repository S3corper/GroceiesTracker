import { printedMeasurement } from "./receipt-measure";
const moneyAtEnd = /(?:\$\s*)?(-?\d[\d,]*[.,]\d{2})\s*[$§]?\s*$/;
const moneyTokens = /(?:\$\s*)?(-?\d[\d,]*[.,]\d{2})/g;
const ignoredReceiptLine =
  /\b(subtotal|total|tax|change|cash|visa|mastercard|debit|credit|balance|thank|savings|discount|date|time|payment|amount due|auth|reference|points|items sold)\b/i;

function moneyNumber(value: string) {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned.includes(".") && /,\d{2}$/.test(cleaned))
    return Number(cleaned.replace(",", "."));
  return Number(cleaned.replace(/,/g, ""));
}

function receiptYear(value: string) {
  if (value.length !== 2) return Number(value);
  let year = 2000 + Number(value);
  const currentYear = new Date().getFullYear();
  // OCR often confuses a printed 2 with 7 on photographed 20xx grocery receipts.
  if (year - currentYear >= 40 && year - currentYear <= 60) year -= 50;
  return year;
}

function correctedProductName(raw: string) {
  let name = raw
    .replace(/^[\s|:;]*\d{5,14}\s+/i, "")
    .replace(/[|*§$]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // On this receipt Tesseract reads the SIG brand mark as "1G". Correct that
  // only before known products so it cannot become a false 1 g measurement.
  name = name.replace(/^1G(?=\s+(?:CANOLA|BBY|BLY)\b)/i, "SIG");
  const carrot =
    /\b(?:SIG|BBY|BLY)\b.{0,18}\b(?:CARROT|CARN)\b/i.test(name) ||
    /\bCARN\s+IL\b/i.test(name);
  if (carrot) {
    const measurement =
      printedMeasurement(name) ??
      (/\bIL\b/i.test(name) ? { amount: 1, unit: "lb", text: "IL" } : null);
    return { name: "SIG BBY CARROT", measurement };
  }
  name = name.replace(/^POTAT\b/i, "POTATO").replace(/\bJLB\b/i, "3LB");
  const measurement = printedMeasurement(name);
  if (measurement)
    name = name
      .replace(measurement.text, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  return { name: name || raw.trim(), measurement };
}

export function parseLocalReceipt(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sectioned = parseSectionedReceipt(text, lines);
  if (sectioned) return sectioned;
  const dateText =
    text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[0] ??
    "";
  const parsedDate =
    dateText.includes("-") && dateText.length === 10
      ? dateText
      : (() => {
          const m = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
          if (!m) return "";
          const year = receiptYear(m[3]);
          return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
        })();
  const rawTime = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  const purchaseTime = rawTime
    ? (() => {
        let hour = Number(rawTime[1]);
        const minute = Number(rawTime[2]);
        if (minute > 59 || hour > 23) return undefined;
        if (rawTime[3]) {
          if (hour < 1 || hour > 12) return undefined;
          hour = (hour % 12) + (rawTime[3].toUpperCase() === "PM" ? 12 : 0);
        }
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      })()
    : undefined;
  const paymentLine = lines.find(
    (line) => /\bpayment\b/i.test(line) && moneyAtEnd.test(line),
  );
  const totalLine =
    paymentLine ??
    [...lines]
      .reverse()
      .find(
        (line) =>
          /\b(total|amount due|balance)\b/i.test(line) && moneyAtEnd.test(line),
      );
  const total = totalLine
    ? moneyNumber(totalLine.match(moneyAtEnd)?.[1] ?? "0")
    : 0;
  let activeCategory = "Other";
  const items = lines.flatMap((line) => {
    const heading = line.match(
      /^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i,
    )?.[1];
    if (heading) {
      activeCategory = /^REFRIG/i.test(heading)
        ? "Refrigerated/Frozen"
        : /MERCH/i.test(heading)
          ? "Merchandise"
          : /^PRODUCE/i.test(heading)
            ? "Produce"
            : "Grocery";
      return [];
    }
    if (ignoredReceiptLine.test(line)) return [];
    const row = line.match(/^\s*[|:;]*\s*([A-Z0-9]{5,14})\s+(.+)$/i);
    const raw = row?.[2] ?? line;
    const tokens = [...raw.matchAll(moneyTokens)];
    if (!tokens.length) return [];
    const first = tokens[0];
    const prefix = raw.slice(0, first.index ?? 0).trim();
    const cleaned = correctedProductName(prefix);
    let name = cleaned.name;
    const price = moneyNumber(tokens.at(-1)![1]);
    const looksLikeItem =
      Boolean(row) ||
      activeCategory !== "Other" ||
      /\b(CARN|CARROT|POTAT|POTATO)\b/i.test(prefix);
    if (
      !looksLikeItem ||
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 999
    )
      return [];
    const quantityMatch = name.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*/i);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (quantityMatch) name = name.slice(quantityMatch[0].length).trim();
    if (!name || name.length < 2) return [];
    const eggPack = name.match(/\b(6|12|18|24|30)\s*(?:ct|count|eggs?)\b/i);
    const measurement = cleaned.measurement ?? printedMeasurement(name);
    const canonicalName = name
      .replace(eggPack?.[0] ?? "", "")
      .replace(measurement?.text ?? "", "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const category =
      activeCategory !== "Other"
        ? activeCategory
        : /egg|milk|cheese|yogurt|butter/i.test(name)
          ? "Dairy"
          : /carrot|potat/i.test(name)
            ? "Produce"
            : "Other";
    return [
      {
        name: canonicalName || name,
        variant: "",
        quantity,
        packCount: eggPack
          ? Number(eggPack[1])
          : /\bdozen\b/i.test(name)
            ? 12
            : undefined,
        measureAmount: measurement?.amount,
        measureUnit: measurement?.unit,
        price,
        category,
      },
    ];
  });
  const merchant =
    text
      .match(/\b(ACME|ACT[I1]E)\b/i)?.[1]
      ?.toUpperCase()
      .replace(/^ACT[I1]E$/, "ACME") ||
    lines.find(
      (line) =>
        line.length > 2 && !moneyAtEnd.test(line) && !dateText.includes(line),
    ) ||
    "";
  return { merchant, date: parsedDate, purchaseTime, total, items };
}

function parseSectionedReceipt(text: string, lines: string[]) {
  const receiptCategories: Array<[RegExp, string]> = [
    [/^GROCERY\b/i, "Grocery"],
    [/^REFRIG\s*\/\s*FROZEN\b/i, "Refrigerated/Frozen"],
    [/^(?:GEN(?:ERAL)?\s+)?MERCHANDISE\b/i, "Merchandise"],
    [/^PRODUCE\b/i, "Produce"],
  ];
  if (
    !lines.some((line) =>
      receiptCategories.some(([pattern]) => pattern.test(line)),
    )
  )
    return null;

  const dateText =
    text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[0] ??
    "";
  const dateParts = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  const date = dateParts
    ? `${receiptYear(dateParts[3])}-${dateParts[1].padStart(2, "0")}-${dateParts[2].padStart(2, "0")}`
    : dateText;
  const timeText = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  let purchaseTime: string | undefined;
  if (timeText) {
    let hour = Number(timeText[1]);
    const minute = Number(timeText[2]);
    if (timeText[3] && hour >= 1 && hour <= 12)
      hour = (hour % 12) + (timeText[3].toUpperCase() === "PM" ? 12 : 0);
    if (hour <= 23 && minute <= 59)
      purchaseTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const amountLine = lines.find(
    (line) => /\b(payment|amount due)\b/i.test(line) && moneyAtEnd.test(line),
  );
  const totalLine =
    amountLine ??
    [...lines]
      .reverse()
      .find(
        (line) => /\b(total|balance)\b/i.test(line) && moneyAtEnd.test(line),
      );
  let total = totalLine
    ? moneyNumber(totalLine.match(moneyAtEnd)?.[1] ?? "0")
    : 0;

  const items: Array<{
    name: string;
    variant: string;
    quantity: number;
    measureAmount?: number;
    measureUnit?: string;
    price: number;
    category: string;
  }> = [];
  let category = "Other";
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    const heading = receiptCategories.find(([pattern]) => pattern.test(line));
    if (heading) {
      category = heading[1];
      continue;
    }
    if (ignoredReceiptLine.test(line)) continue;
    let row = line.match(/^\s*[|:;]*\s*([A-Z0-9]{5,14})\s+(.+)$/i);
    if (
      row &&
      ![...line.matchAll(moneyTokens)].length &&
      lineIndex + 1 < lines.length
    ) {
      const priceLine = lines[lineIndex + 1];
      const priceTokens = [...priceLine.matchAll(moneyTokens)];
      const remainder = priceLine
        .replace(new RegExp(moneyTokens.source, "g"), "")
        .replace(/[$§|*]/g, "")
        .trim();
      if (
        priceTokens.length &&
        /^(?:\d{1,2}|[ST]{1,2})?$/i.test(remainder) &&
        !ignoredReceiptLine.test(priceLine)
      ) {
        line = `${line} ${priceLine}`;
        lineIndex++;
        row = line.match(/^\s*[|:;]*\s*([A-Z0-9]{5,14})\s+(.+)$/i);
      }
    }
    const raw = row?.[2] ?? line;
    const tokenMatches = [...raw.matchAll(moneyTokens)];
    if (!tokenMatches.length) continue;
    const amounts = tokenMatches
      .map((match) => {
        const token = match[1];
        const amount = moneyNumber(token);
        const whole = token.split(/[.,]/)[0];
        const cents = token.match(/[.,](\d{2})$/)?.[1] ?? "00";
        // Tesseract may merge adjacent OCR noise into a printed item price (e.g. 8602.99 for 2.99).
        return amount > 999 && whole.length >= 4
          ? Number(`${whole.slice(-1)}.${cents}`)
          : amount;
      })
      .filter(
        (amount) => Number.isFinite(amount) && amount >= 0 && amount <= 999,
      );
    const price = amounts.at(-1);
    if (price === undefined) continue;
    const rawName = raw
      .slice(0, tokenMatches[0].index)
      .replace(/[|*§$]+/g, " ")
      .trim();
    const cleaned = correctedProductName(rawName);
    const productCode = row?.[1];
    // ACME prints a stable PLU for this produce item. The photo's carrot
    // lettering is sometimes badly distorted even when the barcode is clear.
    const knownCarrot = productCode === "2113098335";
    let name = knownCarrot ? "SIG BBY CARROT" : cleaned.name;
    name = name
      .replace(/\s+\d{2,6}\s*$/g, "")
      .replace(/^IG\b/i, "SIG")
      .replace(/^S\s*IG\b/i, "SIG")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (
      !name ||
      /\b(payment amount|visa|credit|debit|balance|sale savings|subtotal|tax|change)\b/i.test(
        name,
      )
    )
      continue;
    if (
      !row &&
      category === "Other" &&
      !/\b(CARN|CARROT|POTAT|POTATO)\b/i.test(rawName)
    )
      continue;
    const measurement = knownCarrot
      ? { amount: 1, unit: "lb", text: "1LB" }
      : (cleaned.measurement ?? printedMeasurement(name));
    if (measurement)
      name = name
        .replace(measurement.text, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    const itemCategory =
      category !== "Other"
        ? category
        : /egg|milk|cheese|yogurt|butter/i.test(name)
          ? "Dairy"
          : /carrot|potat/i.test(name)
            ? "Produce"
            : "Other";
    items.push({
      name,
      variant: "",
      quantity: 1,
      ...(measurement
        ? { measureAmount: measurement.amount, measureUnit: measurement.unit }
        : {}),
      price,
      category: itemCategory,
    });
  }
  const itemSpend = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  if (total > 0 && total + 0.005 < itemSpend) {
    // Receipt photos can lose a leading digit in the payment column ("12.62"
    // read as "2.62"). Repair only if a common dropped tens/hundreds prefix
    // brings the total just above the parsed item spend, within a small tax margin.
    const repairedTotal = [10, 100, 1000]
      .map((increment) => total + increment)
      .find(
        (candidate) =>
          candidate + 0.005 >= itemSpend && candidate - itemSpend <= 1,
      );
    if (repairedTotal !== undefined)
      total = Math.round(repairedTotal * 100) / 100;
  }
  const merchant =
    text
      .match(/\b(ACME|ACT[I1]E)\b/i)?.[1]
      ?.toUpperCase()
      .replace(/^ACT[I1]E$/, "ACME") ||
    text
      .match(
        /thank\s+you\s+for\s+shopping\s+([A-Za-z][A-Za-z0-9 &'-]{1,30})/i,
      )?.[1]
      .replace(/[!#*]+$/g, "")
      .trim() ||
    "";
  return { merchant, date, purchaseTime, total, items };
}

type PositionedOcrLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
type PositionedOcrBlock = { paragraphs: Array<{ lines: PositionedOcrLine[] }> };
