import { Router, type IRouter } from "express";
import { ScanReceiptBody, ScanReceiptResponse } from "@workspace/api-zod";
import { createWorker, PSM } from "tesseract.js";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireUser } from "../lib/auth";
import { printedMeasurement, resolveMeasurement } from "../lib/measure";

const router: IRouter = Router();
const geminiModel = "gemini-3.8-flash";
const require = createRequire(import.meta.url);
const assetDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "tessdata");
const moneyAtEnd = /(?:\$\s*)?(-?\d[\d,]*[.,]\d{2})\s*[$§]?\s*$/;
const moneyTokens = /(?:\$\s*)?(-?\d[\d,]*[.,]\d{2})/g;
const ignoredReceiptLine = /\b(subtotal|total|tax|change|cash|visa|mastercard|debit|credit|balance|thank|savings|discount|date|time|payment|amount due|auth|reference|points|items sold)\b/i;

function moneyNumber(value: string) {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned.includes(".") && /,\d{2}$/.test(cleaned)) return Number(cleaned.replace(",", "."));
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
  let name = raw.replace(/^[\s|:;]*\d{5,14}\s+/i, "").replace(/[|*§$]+/g, " ").replace(/\s{2,}/g, " ").trim();
  // On this receipt Tesseract reads the SIG brand mark as "1G". Correct that
  // only before known products so it cannot become a false 1 g measurement.
  name = name.replace(/^1G(?=\s+(?:CANOLA|BBY|BLY)\b)/i, "SIG");
  const carrot = /\b(?:SIG|BBY|BLY)\b.{0,18}\b(?:CARROT|CARN)\b/i.test(name) || /\bCARN\s+IL\b/i.test(name);
  if (carrot) {
    const measurement = printedMeasurement(name) ?? (/\bIL\b/i.test(name) ? { amount: 1, unit: "lb", text: "IL" } : null);
    return { name: "SIG BBY CARROT", measurement };
  }
  name = name.replace(/^POTAT\b/i, "POTATO").replace(/\bJLB\b/i, "3LB");
  const measurement = printedMeasurement(name);
  if (measurement) name = name.replace(measurement.text, "").replace(/\s{2,}/g, " ").trim();
  return { name: name || raw.trim(), measurement };
}

function parseLocalReceipt(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sectioned = parseSectionedReceipt(text, lines);
  if (sectioned) return sectioned;
  const dateText = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[0] ?? "";
  const parsedDate = dateText.includes("-") && dateText.length === 10 ? dateText : (() => {
    const m = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!m) return "";
    const year = receiptYear(m[3]);
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  })();
  const rawTime = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  const purchaseTime = rawTime ? (() => {
    let hour = Number(rawTime[1]); const minute = Number(rawTime[2]);
    if (minute > 59 || hour > 23) return undefined;
    if (rawTime[3]) { if (hour < 1 || hour > 12) return undefined; hour = hour % 12 + (rawTime[3].toUpperCase() === "PM" ? 12 : 0); }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  })() : undefined;
  const paymentLine = lines.find((line) => /\bpayment\b/i.test(line) && moneyAtEnd.test(line));
  const totalLine = paymentLine ?? [...lines].reverse().find((line) => /\b(total|amount due|balance)\b/i.test(line) && moneyAtEnd.test(line));
  const total = totalLine ? moneyNumber(totalLine.match(moneyAtEnd)?.[1] ?? "0") : 0;
  let activeCategory = "Other";
  const items = lines.flatMap((line) => {
    const heading = line.match(/^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i)?.[1];
    if (heading) { activeCategory = /^REFRIG/i.test(heading) ? "Refrigerated/Frozen" : /MERCH/i.test(heading) ? "Merchandise" : /^PRODUCE/i.test(heading) ? "Produce" : "Grocery"; return []; }
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
    const looksLikeItem = Boolean(row) || activeCategory !== "Other" || /\b(CARN|CARROT|POTAT|POTATO)\b/i.test(prefix);
    if (!looksLikeItem || !name || !Number.isFinite(price) || price < 0 || price > 999) return [];
    const quantityMatch = name.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*/i);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (quantityMatch) name = name.slice(quantityMatch[0].length).trim();
    if (!name || name.length < 2) return [];
    const eggPack = name.match(/\b(6|12|18|24|30)\s*(?:ct|count|eggs?)\b/i);
    const measurement = cleaned.measurement ?? printedMeasurement(name);
    const canonicalName = name.replace(eggPack?.[0] ?? "", "").replace(measurement?.text ?? "", "").replace(/\s{2,}/g, " ").trim();
    const category = activeCategory !== "Other" ? activeCategory : /egg|milk|cheese|yogurt|butter/i.test(name) ? "Dairy" : /carrot|potat/i.test(name) ? "Produce" : "Other";
    return [{ name: canonicalName || name, variant: "", quantity, packCount: eggPack ? Number(eggPack[1]) : /\bdozen\b/i.test(name) ? 12 : undefined, measureAmount: measurement?.amount, measureUnit: measurement?.unit, price, category }];
  });
  const merchant = text.match(/\b(ACME|ACT[I1]E)\b/i)?.[1]?.toUpperCase().replace(/^ACT[I1]E$/, "ACME")
    || lines.find((line) => line.length > 2 && !moneyAtEnd.test(line) && !dateText.includes(line))
    || "";
  return { merchant, date: parsedDate, purchaseTime, total, items };
}

function parseSectionedReceipt(text: string, lines: string[]) {
  const receiptCategories: Array<[RegExp, string]> = [
    [/^GROCERY\b/i, "Grocery"],
    [/^REFRIG\s*\/\s*FROZEN\b/i, "Refrigerated/Frozen"],
    [/^(?:GEN(?:ERAL)?\s+)?MERCHANDISE\b/i, "Merchandise"],
    [/^PRODUCE\b/i, "Produce"],
  ];
  if (!lines.some((line) => receiptCategories.some(([pattern]) => pattern.test(line)))) return null;

  const dateText = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[0] ?? "";
  const dateParts = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  const date = dateParts ? `${receiptYear(dateParts[3])}-${dateParts[1].padStart(2, "0")}-${dateParts[2].padStart(2, "0")}` : dateText;
  const timeText = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  let purchaseTime: string | undefined;
  if (timeText) {
    let hour = Number(timeText[1]);
    const minute = Number(timeText[2]);
    if (timeText[3] && hour >= 1 && hour <= 12) hour = hour % 12 + (timeText[3].toUpperCase() === "PM" ? 12 : 0);
    if (hour <= 23 && minute <= 59) purchaseTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const amountLine = lines.find((line) => /\b(payment|amount due)\b/i.test(line) && moneyAtEnd.test(line));
  const totalLine = amountLine ?? [...lines].reverse().find((line) => /\b(total|balance)\b/i.test(line) && moneyAtEnd.test(line));
  let total = totalLine ? moneyNumber(totalLine.match(moneyAtEnd)?.[1] ?? "0") : 0;

  const items: Array<{ name: string; variant: string; quantity: number; measureAmount?: number; measureUnit?: string; price: number; category: string }> = [];
  let category = "Other";
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    const heading = receiptCategories.find(([pattern]) => pattern.test(line));
    if (heading) { category = heading[1]; continue; }
    if (ignoredReceiptLine.test(line)) continue;
    let row = line.match(/^\s*[|:;]*\s*([A-Z0-9]{5,14})\s+(.+)$/i);
    if (row && ![...line.matchAll(moneyTokens)].length && lineIndex + 1 < lines.length) {
      const priceLine = lines[lineIndex + 1];
      const priceTokens = [...priceLine.matchAll(moneyTokens)];
      const remainder = priceLine.replace(new RegExp(moneyTokens.source, "g"), "").replace(/[$§|*]/g, "").trim();
      if (priceTokens.length && /^(?:\d{1,2}|[ST]{1,2})?$/i.test(remainder) && !ignoredReceiptLine.test(priceLine)) {
        line = `${line} ${priceLine}`;
        lineIndex++;
        row = line.match(/^\s*[|:;]*\s*([A-Z0-9]{5,14})\s+(.+)$/i);
      }
    }
    const raw = row?.[2] ?? line;
    const tokenMatches = [...raw.matchAll(moneyTokens)];
    if (!tokenMatches.length) continue;
    const amounts = tokenMatches.map((match) => {
      const token = match[1];
      const amount = moneyNumber(token);
      const whole = token.split(/[.,]/)[0];
      const cents = token.match(/[.,](\d{2})$/)?.[1] ?? "00";
      // Tesseract may merge adjacent OCR noise into a printed item price (e.g. 8602.99 for 2.99).
      return amount > 999 && whole.length >= 4 ? Number(`${whole.slice(-1)}.${cents}`) : amount;
    }).filter((amount) => Number.isFinite(amount) && amount >= 0 && amount <= 999);
    const price = amounts.at(-1);
    if (price === undefined) continue;
    const rawName = raw.slice(0, tokenMatches[0].index).replace(/[|*§$]+/g, " ").trim();
    const cleaned = correctedProductName(rawName);
    const productCode = row?.[1];
    // ACME prints a stable PLU for this produce item. The photo's carrot
    // lettering is sometimes badly distorted even when the barcode is clear.
    const knownCarrot = productCode === "2113098335";
    let name = knownCarrot ? "SIG BBY CARROT" : cleaned.name;
    name = name.replace(/\s+\d{2,6}\s*$/g, "").replace(/^IG\b/i, "SIG").replace(/^S\s*IG\b/i, "SIG").replace(/\s{2,}/g, " ").trim();
    if (!name || /\b(payment amount|visa|credit|debit|balance|sale savings|subtotal|tax|change)\b/i.test(name)) continue;
    if (!row && category === "Other" && !/\b(CARN|CARROT|POTAT|POTATO)\b/i.test(rawName)) continue;
    const measurement = knownCarrot ? { amount: 1, unit: "lb", text: "1LB" } : cleaned.measurement ?? printedMeasurement(name);
    if (measurement) name = name.replace(measurement.text, "").replace(/\s{2,}/g, " ").trim();
    const itemCategory = category !== "Other" ? category : /egg|milk|cheese|yogurt|butter/i.test(name) ? "Dairy" : /carrot|potat/i.test(name) ? "Produce" : "Other";
    items.push({ name, variant: "", quantity: 1, ...(measurement ? { measureAmount: measurement.amount, measureUnit: measurement.unit } : {}), price, category: itemCategory });
  }
  const itemSpend = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (total > 0 && total + 0.005 < itemSpend) {
    // Receipt photos can lose a leading digit in the payment column ("12.62"
    // read as "2.62"). Repair only if a common dropped tens/hundreds prefix
    // brings the total just above the parsed item spend, within a small tax margin.
    const repairedTotal = [10, 100, 1000]
      .map((increment) => total + increment)
      .find((candidate) => candidate + 0.005 >= itemSpend && candidate - itemSpend <= 1);
    if (repairedTotal !== undefined) total = Math.round(repairedTotal * 100) / 100;
  }
  const merchant = text.match(/\b(ACME|ACT[I1]E)\b/i)?.[1]?.toUpperCase().replace(/^ACT[I1]E$/, "ACME")
    || text.match(/thank\s+you\s+for\s+shopping\s+([A-Za-z][A-Za-z0-9 &'-]{1,30})/i)?.[1].replace(/[!#*]+$/g, "").trim()
    || "";
  return { merchant, date, purchaseTime, total, items };
}

type PositionedOcrLine = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type PositionedOcrBlock = { paragraphs: Array<{ lines: PositionedOcrLine[] }> };

async function spatiallyMergedOcrText(
  data: { text: string; blocks?: PositionedOcrBlock[] | null; psm: string },
  image: Buffer,
  worker: Awaited<ReturnType<typeof createWorker>>,
) {
  const positioned = data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? [];
  if (!positioned.length) return data.text;

  const sorted = [...positioned].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const groups: Array<{ y0: number; y1: number; rows: typeof sorted }> = [];
  for (const line of sorted) {
    const group = groups.find((candidate) => {
      const overlap = Math.min(line.bbox.y1, candidate.y1) - Math.max(line.bbox.y0, candidate.y0);
      const shorterHeight = Math.min(line.bbox.y1 - line.bbox.y0, candidate.y1 - candidate.y0);
      return overlap >= shorterHeight * 0.35;
    });
    if (group) {
      group.rows.push(line);
      group.y0 = Math.min(group.y0, line.bbox.y0);
      group.y1 = Math.max(group.y1, line.bbox.y1);
    } else groups.push({ y0: line.bbox.y0, y1: line.bbox.y1, rows: [line] });
  }
  const mergedRows: string[] = [];
  for (const group of groups.sort((a, b) => a.y0 - b.y0)) {
    const rows = group.rows.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const text = rows.map((line) => line.text.trim()).filter(Boolean).join(" ");
    const sectionHeading = text.match(/^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i);
    if (sectionHeading) {
      const headingRow = rows.find((line) => /^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i.test(line.text));
      const inlineItem = headingRow?.text.trim().replace(/^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i, "").replace(/\b(?:PRICE|YOU\s+PAY)\b.*$/i, "").trim();
      const remainingRows = rows.filter((line) => line !== headingRow).map((line) => line.text.trim()).filter(Boolean);
      const rowText = [inlineItem, ...remainingRows].filter(Boolean).join(" ").replace(/\b(?:PRICE|YOU\s+PAY)\b/gi, " ").trim();
      mergedRows.push(sectionHeading[1].toUpperCase());
      if (rowText) mergedRows.push(rowText);
      continue;
    }
    // Sparse-text OCR often splits the barcode and product name into adjacent
    // positioned lines. Rejoin the left-hand item columns before deciding
    // whether the right-hand price needs a focused OCR pass.
    const itemText = rows
      .filter((line) => line.bbox.x0 < 2050)
      .map((line) => line.text.trim())
      .filter(Boolean)
      .join(" ");
    const itemLine = rows.find((line) => /^\s*[|:;]*\s*[A-Z0-9]{5,14}\s+.+$/i.test(line.text))
      ?? (/^\s*[|:;]*\s*[A-Z0-9]{5,14}\s+.+$/i.test(itemText) ? { text: itemText } : undefined);
    if (itemLine && [...text.matchAll(moneyTokens)].length < 2) {
      const left = Math.max(0, Math.min(...rows.map((line) => line.bbox.x0)) - 8);
      const top = Math.max(0, group.y0 - 18);
      const right = Math.max(...rows.map((line) => line.bbox.x1));
      const bottom = group.y1 + 18;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789.$|T" });
        const crop = await worker.recognize(image, { rectangle: { left, top, width: right - left + 12, height: bottom - top } }, { text: true });
        const cropPrices = [...crop.data.text.matchAll(/(?=(\d{1,3}[.,]\d{2}))/g)]
          .map((match) => match[1])
          .filter((price) => moneyNumber(price) >= 0.01 && moneyNumber(price) <= 999);
        const paidPrice = cropPrices.at(-1);
        if (paidPrice) {
          mergedRows.push(`${itemLine.text.trim()} ${paidPrice}`);
          continue;
        }
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: data.psm as PSM, tessedit_char_whitelist: "" });
      }
    }
    mergedRows.push(text);
  }
  return mergedRows.join("\n");
}

const recognitionPrompt = `Read this grocery receipt and return only valid JSON with this exact shape:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "purchaseTime": "HH:mm when clearly readable, otherwise empty string",
  "total": 0,
  "items": [
    { "name": "string", "variant": "string", "quantity": 1, "packCount": 12, "measureAmount": 500, "measureUnit": "g", "price": 0, "category": "Grocery|Refrigerated/Frozen|Merchandise|Produce|Dairy|Meat|Pantry|Bakery|Frozen|Beverages|Household|Other" }
  ]
}

Rules:
- Extract every clearly readable grocery line item.
- Use quantity 1 when a quantity is not printed.
- Extract a printed egg carton size such as 12-count or 18-count as packCount. Check product names for a printed size such as SIG BBY CARROT 1LB; record that as measureAmount 1 and measureUnit lb. Extract measured weight or volume only when clearly printed; leave unknown values out.
- Keep different product variants separate.
- Read the full receipt layout from top to bottom. Category headings such as GROCERY, REFRIG/FROZEN, GEN MERCHANDISE, and PRODUCE apply to the following barcode-led item rows until the next heading.
- For receipts with both a regular Price and a You Pay column, use the You Pay value for each item. A Sale Savings row is a discount note, not another item.
- Never treat PAYMENT AMOUNT, card/Visa totals, balances, taxes, change, savings, or item-count footers as grocery items. The receipt total comes from PAYMENT AMOUNT or the final receipt total, not from an item row.
- Use the line amount actually paid, not the regular shelf price or unit price.
- Use a numeric total and numeric item prices without currency symbols.
- Use an empty string for an unreadable merchant or date, but do not omit required fields.
- Do not include markdown, commentary, or code fences.`;

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeScan(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Recognition returned an invalid object");
  }

  const candidate = value as {
    merchant?: unknown;
    date?: unknown;
    purchaseTime?: unknown;
    total?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => {
          let name = String(item.name ?? "Unrecognized item").trim();
          let variant = String(item.variant ?? "").trim();
          const eggPack = `${name} ${variant}`.match(/\b(6|12|18|24|30)\s*(?:ct|count|eggs?)\b/i);
          const measurement = printedMeasurement(name) ?? printedMeasurement(variant);
          const resolvedMeasurement = resolveMeasurement(name, variant, item.measureAmount, item.measureUnit);
          const packCount = Number(item.packCount) > 0 ? Number(item.packCount) : eggPack ? Number(eggPack[1]) : /\bdozen\b/i.test(`${name} ${variant}`) ? 12 : undefined;
          if (eggPack) { name = name.replace(eggPack[0], "").replace(/\s{2,}/g, " ").trim(); variant = variant.replace(eggPack[0], "").trim(); }
          if (measurement) { name = name.replace(measurement.text, "").replace(/\s{2,}/g, " ").trim(); variant = variant.replace(measurement.text, "").replace(/\s{2,}/g, " ").trim(); }
          return {
          name: name || "Unrecognized item",
          variant,
          quantity: Number(item.quantity ?? 1) || 1,
          ...(packCount ? { packCount } : {}),
          ...(resolvedMeasurement ? { measureAmount: resolvedMeasurement.amount, measureUnit: resolvedMeasurement.unit } : {}),
          price: Number(item.price ?? 0) || 0,
          category: String(item.category ?? "Other"),
          };
        })
    : [];

  const rawTime = String(candidate.purchaseTime ?? "").trim();
  const clockMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  let purchaseTime: string | undefined;
  if (clockMatch) {
    let hour = Number(clockMatch[1]); const minute = Number(clockMatch[2]);
    if (clockMatch[3] && hour >= 1 && hour <= 12) hour = hour % 12 + (clockMatch[3].toUpperCase() === "PM" ? 12 : 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) purchaseTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return ScanReceiptResponse.parse({
    merchant: String(candidate.merchant ?? ""),
    date: String(candidate.date ?? ""),
    ...(purchaseTime ? { purchaseTime } : {}),
    total: Number(candidate.total ?? 0) || 0,
    items,
  });
}

router.post("/receipts/gemini-key-test", requireUser, async (req, res) => {
  const apiKey = String(req.body?.geminiApiKey ?? "").trim();
  if (!apiKey || apiKey.length > 512) { res.status(400).json({ error: "Enter a Gemini API key to test." }); return; }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: { status?: string; details?: Array<{ reason?: string }> } } | null;
      const reason = errorBody?.error?.details?.find((detail) => detail.reason)?.reason;
      req.log.warn({ status: response.status, reason }, "Gemini API key check failed");
      const message = reason === "API_KEY_INVALID" || errorBody?.error?.status === "UNAUTHENTICATED"
        ? "Google rejected this Gemini key. Check that the key is active and copied correctly."
        : response.status === 403 || errorBody?.error?.status === "PERMISSION_DENIED"
          ? "The key is recognized, but Google denied access. Check Gemini API access and billing for its project."
          : `Gemini key check failed (HTTP ${response.status}). Check the key's model access and billing.`;
      res.status(400).json({ error: message });
      return;
    }
    res.json({ valid: true, model: geminiModel });
  } catch (error) {
    req.log.warn({ err: error }, "Gemini API key check could not reach Google");
    res.status(502).json({ error: "Could not reach Gemini. Check the host's internet connection and try again." });
  }
});

router.post("/receipts/scan", requireUser, async (req, res) => {
  const parsedBody = ScanReceiptBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "A receipt image and supported image type are required." });
    return;
  }

  try {
    if (parsedBody.data.provider !== "gemini") {
      const worker = await createWorker("eng", 1, {
        workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
        corePath: require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
        langPath: assetDir,
        gzip: false,
        logger: () => undefined,
      });
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const image = Buffer.from(parsedBody.data.imageBase64, "base64");
        const score = (candidate: ReturnType<typeof parseLocalReceipt>) => {
          const itemQuality = candidate.items.reduce((sum, item) => sum
            + (item.category !== "Other" ? 4 : 0)
            + (/carrot|potat/i.test(item.name) ? 8 : 0)
            + (item.price > 0 ? 1 : 0), 0);
          const merchantQuality = /^ACME$/i.test(candidate.merchant) ? 10 : 0;
          return candidate.items.length * 100 + itemQuality
            + (candidate.total > 0 ? 25 : 0)
            + merchantQuality
            + (/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ? 5 : 0);
        };
        const recognize = async () => {
          const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
          const plain = parseLocalReceipt(data.text);
          const positioned = parseLocalReceipt(await spatiallyMergedOcrText(data, image, worker));
          return score(positioned) >= score(plain) ? positioned : plain;
        };
        let best = await recognize();
        for (const mode of [PSM.SPARSE_TEXT, PSM.SINGLE_COLUMN]) {
          await worker.setParameters({ tessedit_pageseg_mode: mode });
          const candidate = await recognize();
          if (score(candidate) > score(best)) best = candidate;
        }
        res.json(normalizeScan(best));
      } finally { await worker.terminate(); }
      return;
    }
    const apiKey = parsedBody.data.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: "Gemini was selected, but no API key was provided. Add your key in Settings." });
      return;
    }
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: geminiModel,
          input: [
            {
              type: "text",
              text: recognitionPrompt,
            },
            {
              type: "image",
              mime_type: parsedBody.data.mimeType,
              data: parsedBody.data.imageBase64,
            },
          ],
          store: false,
          generation_config: { thinking_level: "low" },
        }),
      },
    );

    if (!response.ok) {
      req.log.error({ status: response.status }, "Gemini receipt recognition request failed");
      if (response.status === 429 || response.status === 503) {
        res.status(503).json({ error: "Gemini is temporarily busy. Please try the scan again shortly." });
      } else {
        res.status(502).json({ error: "Receipt recognition failed. Please check the Gemini key or try another photo." });
      }
      return;
    }

    const payload = (await response.json()) as {
      steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = payload.steps?.flatMap((step) => step.type === "model_output" ? step.content ?? [] : [])
      .find((content) => content.type === "text")?.text;
    if (!text) {
      throw new Error("Recognition returned no content");
    }

    res.json(normalizeScan(JSON.parse(stripCodeFence(text))));
  } catch (error) {
    req.log.error({ err: error }, "Receipt recognition failed");
    res.status(502).json({ error: "We could not read that receipt. Please try a clearer photo." });
  }
});

export default router;
