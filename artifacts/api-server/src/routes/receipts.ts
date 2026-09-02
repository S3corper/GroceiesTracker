import { Router, type IRouter } from "express";
import { ScanReceiptBody, ScanReceiptResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const recognitionPrompt = `Read this grocery receipt and return only valid JSON with this exact shape:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "total": 0,
  "items": [
    { "name": "string", "quantity": 1, "price": 0, "category": "Produce|Dairy|Meat|Pantry|Bakery|Frozen|Beverages|Household|Other" }
  ]
}

Rules:
- Extract every clearly readable grocery line item.
- Use quantity 1 when a quantity is not printed.
- Use the line total as price, not the unit price.
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
    total?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          name: String(item.name ?? "Unrecognized item"),
          quantity: Number(item.quantity ?? 1) || 1,
          price: Number(item.price ?? 0) || 0,
          category: String(item.category ?? "Other"),
        }))
    : [];

  return ScanReceiptResponse.parse({
    merchant: String(candidate.merchant ?? ""),
    date: String(candidate.date ?? ""),
    total: Number(candidate.total ?? 0) || 0,
    items,
  });
}

router.post("/receipts/scan", async (req, res) => {
  const parsedBody = ScanReceiptBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "A receipt image and supported image type are required." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(502).json({ error: "Receipt recognition is not configured yet." });
    return;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: recognitionPrompt },
                {
                  inline_data: {
                    mime_type: parsedBody.data.mimeType,
                    data: parsedBody.data.imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      req.log.error({ status: response.status, errorText }, "Gemini receipt recognition request failed");
      res.status(502).json({ error: "Receipt recognition failed. Please try another photo." });
      return;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
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