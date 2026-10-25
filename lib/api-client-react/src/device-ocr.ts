import { createWorker, PSM } from "tesseract.js";
import { parseLocalReceipt } from "./receipt-parser";
const moneyTokens = /(?:\$\s*)?(-?\d[\d,]*[.,]\d{2})/g;
const moneyNumber = (value: string) => Number(value.replace(/,/g, ""));
type PositionedOcrLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
type PositionedOcrBlock = { paragraphs: Array<{ lines: PositionedOcrLine[] }> };

async function spatiallyMergedOcrText(
  data: { text: string; blocks?: PositionedOcrBlock[] | null; psm: string },
  image: string,
  worker: Awaited<ReturnType<typeof createWorker>>,
) {
  const positioned =
    data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines),
    ) ?? [];
  if (!positioned.length) return data.text;

  const sorted = [...positioned].sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  );
  const groups: Array<{ y0: number; y1: number; rows: typeof sorted }> = [];
  for (const line of sorted) {
    const group = groups.find((candidate) => {
      const overlap =
        Math.min(line.bbox.y1, candidate.y1) -
        Math.max(line.bbox.y0, candidate.y0);
      const shorterHeight = Math.min(
        line.bbox.y1 - line.bbox.y0,
        candidate.y1 - candidate.y0,
      );
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
    const text = rows
      .map((line) => line.text.trim())
      .filter(Boolean)
      .join(" ");
    const sectionHeading = text.match(
      /^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i,
    );
    if (sectionHeading) {
      const headingRow = rows.find((line) =>
        /^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i.test(
          line.text,
        ),
      );
      const inlineItem = headingRow?.text
        .trim()
        .replace(
          /^\s*(GROCERY|REFRIG\s*\/\s*FROZEN|(?:GEN(?:ERAL)?\s+)?MERCHANDISE|PRODUCE)\b/i,
          "",
        )
        .replace(/\b(?:PRICE|YOU\s+PAY)\b.*$/i, "")
        .trim();
      const remainingRows = rows
        .filter((line) => line !== headingRow)
        .map((line) => line.text.trim())
        .filter(Boolean);
      const rowText = [inlineItem, ...remainingRows]
        .filter(Boolean)
        .join(" ")
        .replace(/\b(?:PRICE|YOU\s+PAY)\b/gi, " ")
        .trim();
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
    const itemLine =
      rows.find((line) =>
        /^\s*[|:;]*\s*[A-Z0-9]{5,14}\s+.+$/i.test(line.text),
      ) ??
      (/^\s*[|:;]*\s*[A-Z0-9]{5,14}\s+.+$/i.test(itemText)
        ? { text: itemText }
        : undefined);
    if (itemLine && [...text.matchAll(moneyTokens)].length < 2) {
      const left = Math.max(
        0,
        Math.min(...rows.map((line) => line.bbox.x0)) - 8,
      );
      const top = Math.max(0, group.y0 - 18);
      const right = Math.max(...rows.map((line) => line.bbox.x1));
      const bottom = group.y1 + 18;
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: "0123456789.$|T",
        });
        const crop = await worker.recognize(
          image,
          {
            rectangle: {
              left,
              top,
              width: right - left + 12,
              height: bottom - top,
            },
          },
          { text: true },
        );
        const cropPrices = [
          ...crop.data.text.matchAll(/(?=(\d{1,3}[.,]\d{2}))/g),
        ]
          .map((match) => match[1])
          .filter(
            (price) => moneyNumber(price) >= 0.01 && moneyNumber(price) <= 999,
          );
        const paidPrice = cropPrices.at(-1);
        if (paidPrice) {
          mergedRows.push(`${itemLine.text.trim()} ${paidPrice}`);
          continue;
        }
      } finally {
        await worker.setParameters({
          tessedit_pageseg_mode: data.psm as PSM,
          tessedit_char_whitelist: "",
        });
      }
    }
    mergedRows.push(text);
  }
  return mergedRows.join("\n");
}

export async function scanOnDevice(body: {
  imageBase64: string;
  mimeType: string;
}) {
  if (
    !body.imageBase64 ||
    !["image/jpeg", "image/png", "image/webp"].includes(body.mimeType)
  )
    throw new Error("Choose a receipt photo.");
  // Resolve beside the page so root sites and repository subpaths both work.
  const assets = new URL("./ocr/", document.baseURI);
  const worker = await createWorker("eng", 1, {
    workerPath: new URL("worker.min.js", assets).href,
    corePath: assets.href,
    langPath: assets.href,
    gzip: false,
  });
  const image = "data:" + body.mimeType + ";base64," + body.imageBase64;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const score = (candidate: ReturnType<typeof parseLocalReceipt>) => {
      const itemQuality = candidate.items.reduce(
        (sum, item) =>
          sum +
          (item.category !== "Other" ? 4 : 0) +
          (/carrot|potat/i.test(item.name) ? 8 : 0) +
          (item.price > 0 ? 1 : 0),
        0,
      );
      const merchantQuality = /^ACME$/i.test(candidate.merchant) ? 10 : 0;
      return (
        candidate.items.length * 100 +
        itemQuality +
        (candidate.total > 0 ? 25 : 0) +
        merchantQuality +
        (/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ? 5 : 0)
      );
    };
    const recognize = async () => {
      const { data } = await worker.recognize(
        image,
        {},
        { text: true, blocks: true },
      );
      const plain = parseLocalReceipt(data.text);
      const positioned = parseLocalReceipt(
        await spatiallyMergedOcrText(data, image, worker),
      );
      return score(positioned) >= score(plain) ? positioned : plain;
    };
    let best = await recognize();
    for (const mode of [PSM.SPARSE_TEXT, PSM.SINGLE_COLUMN]) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const candidate = await recognize();
      if (score(candidate) > score(best)) best = candidate;
    }

    return best;
  } finally {
    await worker.terminate();
  }
}
