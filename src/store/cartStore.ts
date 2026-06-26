import { create } from "zustand";
import type { Product } from "@/core/types/models";
import type { CartLine } from "@/core/utils/totals";

// Cart state — emits new immutable snapshots on every change (BLoC analogue).

interface CartState {
  lines: CartLine[];
  discount: number;
  customerName: string;
  customerPhone: string;
  addProduct: (product: Product, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeLine: (productId: string) => void;
  setDiscount: (amount: number) => void;
  setCustomer: (name: string, phone: string) => void;
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
  };
}

export const useCart = create<CartState>((set) => ({
  lines: [],
  discount: 0,
  customerName: "",
  customerPhone: "",

  addProduct: (product, qty = 1) =>
    set((state) => {
      const existing = state.lines.find((l) => l.product.id === product.id);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.product.id === product.id ? { ...l, qty: l.qty + qty } : l,
          ),
        };
      }
      return { lines: [...state.lines, { product: toLineProduct(product), qty }] };
    }),

  setQty: (productId, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.product.id === productId ? { ...l, qty } : l))
        .filter((l) => l.qty > 0),
    })),

  increment: (productId) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.product.id === productId ? { ...l, qty: l.qty + 1 } : l,
      ),
    })),

  decrement: (productId) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.product.id === productId ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    })),

  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.product.id !== productId) })),

  setDiscount: (amount) => set({ discount: Math.max(0, amount || 0) }),

  setCustomer: (customerName, customerPhone) => set({ customerName, customerPhone }),

  clear: () => set({ lines: [], discount: 0, customerName: "", customerPhone: "" }),
}));
