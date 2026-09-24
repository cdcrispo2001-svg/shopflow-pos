import { create } from "zustand";
import type { Product } from "@/core/types/models";
import type { CartLine } from "@/core/utils/totals";

// Cart state — emits new immutable snapshots on every change (BLoC analogue).

interface CartState {
  lines: CartLine[];
  discount: number;
  customerName: string;
  customerPhone: string;
  /** Returns false (and leaves the cart unchanged) when stock would run out. */
  addProduct: (product: Product, qty?: number) => boolean;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string) => boolean;
  decrement: (productId: string) => void;
  removeLine: (productId: string) => void;
  setDiscount: (amount: number) => void;
  customerTin: string;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  setCustomerTin: (tin: string) => void;
  clear: () => void;
}

function toLineProduct(p: Product): CartLine["product"] {
  return {
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    price: p.price,
    cost: p.cost,
    taxRate: p.taxRate,
    stock: p.stock,
  };
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  discount: 0,
  customerName: "",
  customerPhone: "",
  customerTin: "",

  addProduct: (product, qty = 1) => {
    const existing = get().lines.find((l) => l.product.id === product.id);
    if ((existing?.qty ?? 0) + qty > product.stock) return false;
    set((state) => {
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.product.id === product.id
              ? { product: toLineProduct(product), qty: l.qty + qty }
              : l,
          ),
        };
      }
      return { lines: [...state.lines, { product: toLineProduct(product), qty }] };
    });
    return true;
  },

  setQty: (productId, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.product.id === productId ? { ...l, qty } : l))
        .filter((l) => l.qty > 0),
    })),

  increment: (productId) => {
    const line = get().lines.find((l) => l.product.id === productId);
    if (!line) return false;
    if (line.product.stock !== undefined && line.qty + 1 > line.product.stock) return false;
    set((state) => ({
      lines: state.lines.map((l) =>
        l.product.id === productId ? { ...l, qty: l.qty + 1 } : l,
      ),
    }));
    return true;
  },

  decrement: (productId) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.product.id === productId ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    })),

  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.product.id !== productId) })),

  setDiscount: (amount) => set({ discount: Math.max(0, amount || 0) }),

  setCustomerName: (customerName) => set({ customerName }),

  setCustomerPhone: (customerPhone) => set({ customerPhone }),

  setCustomerTin: (customerTin) => set({ customerTin: customerTin.replace(/\D/g, "").slice(0, 10) }),

  clear: () => set({ lines: [], discount: 0, customerName: "", customerPhone: "", customerTin: "" }),
}));
