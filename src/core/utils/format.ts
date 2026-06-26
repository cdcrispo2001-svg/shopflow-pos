// Formatting helpers — currency, dates, receipt numbers.

export function formatMoney(
  amount: number,
  symbol = "USh",
  decimals = 0,
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = safe.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol} ${formatted}`.trim();
}

export function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}

/** Generates a sortable, collision-resistant id without external deps. */
export function newId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}

/** Builds a human-friendly receipt number from a running count. */
export function receiptNumber(count: number): string {
  return `R-${String(count + 1).padStart(6, "0")}`;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
