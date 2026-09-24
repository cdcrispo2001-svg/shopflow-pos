import type { EfrisTaxCategory, Product, Sale, ShopSettings } from "@/core/types/models";
import type { EfrisConfig } from "@/features/efris/efrisStore";
import type { EfrisGoods } from "@/features/efris/efrisClient";
import { ugandaTime } from "@/features/efris/efrisProtocol";

// Pure mapping from ShopFlow sales/products to URA EFRIS payloads:
// T109 invoice upload, T110 credit note application, T130 goods upload.
// All EFRIS amounts are tax-inclusive (gross); VAT is backed out at 18%.

export class InvoiceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceDataError";
  }
}

export interface InvoiceContext {
  config: Pick<EfrisConfig, "tin" | "brn" | "legalName" | "businessName" | "deviceNo" | "vatRegistered">;
  shop: Pick<ShopSettings, "name" | "address" | "phone" | "email" | "currency" | "taxInclusive" | "cashierName">;
  products: Map<string, Product>;
}

const VAT = 0.18;
const PAYMENT_MODES: Record<Sale["paymentMethod"], string> = {
  cash: "102",
  mobile_money: "105",
  card: "106",
  credit: "101",
};
const RATE_TEXT: Record<EfrisTaxCategory, string> = { "01": "0.18", "02": "0", "03": "-" };
const RATE_NAME: Record<EfrisTaxCategory, string> = { "01": "Standard", "02": "Zero rated", "03": "Exempt" };
const EXCISE_BLANKS = {
  deemedFlag: "2", exciseFlag: "2", categoryId: "", categoryName: "", goodsCategoryName: "",
  exciseRate: "", exciseRule: "", exciseTax: "", pack: "", stick: "", exciseUnit: "",
  exciseCurrency: "", exciseRateName: "", vatApplicableFlag: "1",
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => r2(n).toFixed(2);
const taxOf = (category: EfrisTaxCategory, gross: number) => (category === "01" ? r2((gross * VAT) / (1 + VAT)) : 0);

/** VAT category for EFRIS: the product's choice, else 18% → standard, 0% → exempt. */
export function taxCategoryFor(product: Pick<Product, "efris"> | undefined, taxRate: number): EfrisTaxCategory {
  return product?.efris?.taxCategory ?? (taxRate > 0 ? "01" : "03");
}

export function goodsCodeFor(product: Pick<Product, "id" | "barcode" | "efris">): string {
  return (product.efris?.goodsCode || product.barcode || product.id).trim().slice(0, 50);
}

/** Our unique reference for a sale at URA (device + receipt number). */
export function referenceNo(sale: Pick<Sale, "receiptNo">, deviceNo: string): string {
  return `${deviceNo}-${sale.receiptNo}`;
}

interface InvoiceLine {
  orderNumber: number;
  name: string;
  code: string;
  qty: number;
  unit: string;
  commodity: string;
  category: EfrisTaxCategory;
  unitGross: number;
  gross: number;
  discount: number;
  tax: number;
  discountTax: number;
}

/** Sale lines with EFRIS codes, gross amounts and the sale discount spread across them. */
export function invoiceLines(sale: Sale, ctx: InvoiceContext): InvoiceLine[] {
  const lines = sale.items.map((item): InvoiceLine => {
    const product = ctx.products.get(item.productId);
    const efris = product?.efris;
    if (!efris?.commodityCode) {
      throw new InvoiceDataError(`${item.name}: add its URA commodity code (Products → edit → URA EFRIS).`);
    }
    const category = taxCategoryFor(product, item.taxRate);
    if (category === "01" && item.taxRate !== 18) {
      throw new InvoiceDataError(`${item.name}: standard-rated items must use 18% VAT for EFRIS.`);
    }
    const unitGross = ctx.shop.taxInclusive ? item.price : r2(item.price * (1 + item.taxRate / 100));
    const gross = r2(unitGross * item.qty);
    return {
      orderNumber: 0, name: item.name, code: product ? goodsCodeFor(product) : item.productId, qty: item.qty,
      unit: efris.unitCode || "101", commodity: efris.commodityCode, category, unitGross, gross,
      discount: 0, tax: taxOf(category, gross), discountTax: 0,
    };
  });

  const total = r2(lines.reduce((sum, line) => sum + line.gross, 0));
  const discount = Math.min(r2(sale.discount), total);
  if (discount > 0 && total > 0) {
    for (const line of lines) line.discount = Math.min(line.gross, r2((discount * line.gross) / total));
    let rest = r2(discount - lines.reduce((sum, line) => sum + line.discount, 0));
    for (const line of lines) {
      if (rest === 0) break;
      const change = rest > 0 ? Math.min(rest, r2(line.gross - line.discount)) : Math.max(rest, -line.discount);
      line.discount = r2(line.discount + change);
      rest = r2(rest - change);
    }
  }

  let order = 0;
  for (const line of lines) {
    line.discountTax = taxOf(line.category, line.discount);
    line.orderNumber = order;
    order += line.discount > 0 ? 2 : 1; // a discounted item is followed by its discount line
  }
  return lines;
}

function taxDetails(parts: { category: EfrisTaxCategory; gross: number; tax: number }[], sign: 1 | -1) {
  const byCategory = new Map<EfrisTaxCategory, { gross: number; tax: number }>();
  for (const part of parts) {
    const sum = byCategory.get(part.category) ?? { gross: 0, tax: 0 };
    sum.gross = r2(sum.gross + part.gross);
    sum.tax = r2(sum.tax + part.tax);
    byCategory.set(part.category, sum);
  }
  const details = [...byCategory].map(([category, sum]) => ({
    taxCategoryCode: category,
    netAmount: money(sign * (sum.gross - sum.tax)),
    taxRate: RATE_TEXT[category],
    taxAmount: money(sign * sum.tax),
    grossAmount: money(sign * sum.gross),
    exciseUnit: "",
    exciseCurrency: "",
    taxRateName: RATE_NAME[category],
  }));
  const gross = r2([...byCategory.values()].reduce((sum, part) => sum + part.gross, 0));
  const tax = r2([...byCategory.values()].reduce((sum, part) => sum + part.tax, 0));
  return { details, gross, tax };
}

function payWay(sale: Sale, gross: number) {
  if (sale.paymentMethod !== "credit") {
    return [{ paymentMode: PAYMENT_MODES[sale.paymentMethod], paymentAmount: money(gross), orderNumber: "a" }];
  }
  const repaid = (sale.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  const deposit = Math.min(gross, r2(Math.max(0, sale.amountPaid - repaid)));
  const ways = [];
  if (gross - deposit > 0 || deposit === 0) ways.push({ paymentMode: "101", paymentAmount: money(gross - deposit), orderNumber: "a" });
  if (deposit > 0) ways.push({ paymentMode: "102", paymentAmount: money(deposit), orderNumber: ways.length ? "b" : "a" });
  return ways;
}

const invoiceKind = (ctx: InvoiceContext) => (ctx.config.vatRegistered ? "1" : "2"); // invoice | receipt

/** T109 invoice/receipt upload payload for a completed sale. */
export function buildInvoice(sale: Sale, ctx: InvoiceContext, now = Date.now()) {
  const lines = invoiceLines(sale, ctx);
  const goodsDetails = lines.flatMap((line) => {
    const discounted = line.discount > 0;
    const goods = {
      item: line.name, itemCode: line.code, qty: String(line.qty), unitOfMeasure: line.unit,
      unitPrice: money(line.unitGross), total: money(line.gross), taxRate: RATE_TEXT[line.category],
      tax: money(line.tax), discountTotal: discounted ? money(-line.discount) : "",
      discountTaxRate: discounted ? RATE_TEXT[line.category] : "", orderNumber: line.orderNumber,
      discountFlag: discounted ? "1" : "2", goodsCategoryId: line.commodity, ...EXCISE_BLANKS,
    };
    if (!discounted) return [goods];
    const discountLine = {
      item: `${line.name} (Discount)`, itemCode: line.code, qty: "", unitOfMeasure: "", unitPrice: "",
      total: money(-line.discount), taxRate: RATE_TEXT[line.category], tax: money(-line.discountTax),
      discountTotal: "", discountTaxRate: "", orderNumber: line.orderNumber + 1, discountFlag: "0",
      goodsCategoryId: line.commodity, ...EXCISE_BLANKS,
    };
    return [goods, discountLine];
  });
  const tax = taxDetails(
    lines.map((line) => ({ category: line.category, gross: r2(line.gross - line.discount), tax: r2(line.tax - line.discountTax) })),
    1,
  );
  const { config, shop } = ctx;
  const buyerName = sale.customerName?.trim() ?? "";
  return {
    sellerDetails: {
      tin: config.tin, ninBrn: config.brn, legalName: config.legalName || shop.name,
      businessName: config.businessName || shop.name, address: shop.address, mobilePhone: shop.phone,
      linePhone: "", emailAddress: shop.email, placeOfBusiness: shop.address,
      referenceNo: referenceNo(sale, config.deviceNo), branchId: "", isCheckReferenceNo: "1",
    },
    basicInformation: {
      invoiceNo: "", antifakeCode: "", deviceNo: config.deviceNo, issuedDate: ugandaTime(sale.createdAt),
      operator: sale.cashier || shop.cashierName || "Cashier", currency: shop.currency || "UGX",
      oriInvoiceId: "", invoiceType: "1", invoiceKind: invoiceKind(ctx), dataSource: "103",
      invoiceIndustryCode: "101", isBatch: "0",
    },
    buyerDetails: {
      buyerTin: sale.customerTin ?? "", buyerNinBrn: "", buyerPassportNum: "", buyerLegalName: buyerName,
      buyerBusinessName: sale.customerTin ? buyerName : "", buyerAddress: "", buyerEmail: "",
      buyerMobilePhone: sale.customerPhone ?? "", buyerLinePhone: "", buyerPlaceOfBusi: "",
      buyerType: sale.customerTin ? "0" : "1", // 0 business, 1 consumer
      buyerCitizenship: "", buyerSector: "", buyerReferenceNo: "",
    },
    goodsDetails,
    taxDetails: tax.details,
    summary: {
      netAmount: money(tax.gross - tax.tax), taxAmount: money(tax.tax), grossAmount: money(tax.gross),
      itemCount: lines.length,
      modeCode: now - sale.createdAt <= 10 * 60_000 ? "1" : "0", // 0 = issued while offline
      remarks: "", qrCode: "",
    },
    payWay: payWay(sale, tax.gross),
    extend: { reason: "", reasonCode: "" },
  };
}

/** T110 credit note application reversing a fiscalised sale in full. */
export function buildCreditNote(sale: Sale, ctx: InvoiceContext, reasonCode: string, reason: string, now = Date.now()) {
  const fiscal = sale.efris;
  if (!fiscal?.invoiceNo || !fiscal.invoiceId) throw new InvoiceDataError("This sale has no URA fiscal document to credit.");
  const parts = invoiceLines(sale, ctx).map((line) => {
    const net = r2(line.gross - line.discount);
    const unit = Math.floor((net / line.qty) * 100) / 100; // never credit more than was paid
    const total = r2(unit * line.qty);
    return { line, unit, total, tax: taxOf(line.category, total) };
  });
  const tax = taxDetails(parts.map((part) => ({ category: part.line.category, gross: part.total, tax: part.tax })), -1);
  const { config, shop } = ctx;
  return {
    oriInvoiceId: fiscal.invoiceId, oriInvoiceNo: fiscal.invoiceNo, reasonCode, reason,
    applicationTime: ugandaTime(now), invoiceApplyCategoryCode: "101", currency: shop.currency || "UGX",
    contactName: sale.customerName || config.businessName || shop.name,
    contactMobileNum: sale.customerPhone || shop.phone, contactEmail: shop.email, source: "103",
    remarks: reason, sellersReferenceNo: `${referenceNo(sale, config.deviceNo)}-CN`,
    goodsDetails: parts.map(({ line, unit, total, tax: lineTax }) => ({
      item: line.name, itemCode: line.code, qty: String(-line.qty), unitOfMeasure: line.unit,
      unitPrice: money(unit), total: money(-total), taxRate: RATE_TEXT[line.category], tax: money(-lineTax),
      orderNumber: line.orderNumber, goodsCategoryId: line.commodity, ...EXCISE_BLANKS,
    })),
    taxDetails: tax.details,
    summary: {
      netAmount: money(-(tax.gross - tax.tax)), taxAmount: money(-tax.tax), grossAmount: money(-tax.gross),
      itemCount: parts.length, modeCode: "1", qrCode: "",
    },
    basicInformation: {
      operator: sale.cashier || shop.cashierName || "Cashier", invoiceKind: invoiceKind(ctx), invoiceIndustryCode: "101",
    },
  };
}

/** T130 goods registration entry for a product. */
export function buildGoodsUpload(product: Product, shop: Pick<ShopSettings, "taxInclusive">): EfrisGoods {
  const efris = product.efris;
  if (!efris?.commodityCode) throw new InvoiceDataError(`${product.name}: add its URA commodity code first.`);
  const unitGross = shop.taxInclusive ? product.price : product.price * (1 + product.taxRate / 100);
  return {
    operationType: efris.registeredAt ? "102" : "101",
    goodsName: product.name.slice(0, 200),
    goodsCode: goodsCodeFor(product),
    measureUnit: efris.unitCode || "101",
    unitPrice: money(unitGross),
    currency: "101", // UGX in URA's currency dictionary
    commodityCategoryId: efris.commodityCode,
    haveExciseTax: "102",
    description: product.name.slice(0, 1024),
    stockPrewarning: String(product.lowStockAt),
    havePieceUnit: "102",
    haveOtherUnit: "102",
    goodsTypeCode: "101",
  };
}
