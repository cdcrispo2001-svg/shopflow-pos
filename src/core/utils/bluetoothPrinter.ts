import { type Result, ok, fail, attempt } from "@/core/types/result";

// Optional native thermal printing over Web Bluetooth (GATT).
// Supported on Chrome/Edge for Android & desktop; not available on iOS Safari,
// where the app falls back to browser print. We keep a single connected device
// per session and write the ESC/POS payload in MTU-sized chunks.

// Common BLE serial service/characteristic UUIDs used by cheap ESC/POS printers.
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // generic thermal printer service
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10 style serial
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip transparent UART
];

interface BtState {
  device?: BluetoothDevice;
  characteristic?: BluetoothRemoteGATTCharacteristic;
}

const state: BtState = {};

export function bluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export function connectedPrinterName(): string | null {
  return state.device?.name ?? null;
}

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic | null> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
  }
  return null;
}

/** Prompts the OS device picker, connects, and caches the printer. */
export async function pairPrinter(): Promise<Result<string>> {
  if (!bluetoothSupported()) {
    return fail("Web Bluetooth is not available in this browser. Use Chrome on Android/desktop, or the browser-print fallback.");
  }
  return attempt(async () => {
    const device = await navigator.bluetooth.requestDevice({
      filters: PRINTER_SERVICES.map((s) => ({ services: [s] })),
      optionalServices: PRINTER_SERVICES,
    });
    const server = await device.gatt!.connect();
    const characteristic = await findWritableCharacteristic(server);
    if (!characteristic) throw new Error("No writable characteristic found on this printer.");
    device.addEventListener("gattserverdisconnected", () => {
      state.characteristic = undefined;
    });
    state.device = device;
    state.characteristic = characteristic;
    return device.name || "Thermal printer";
  }, "Pairing printer");
}

async function ensureConnected(): Promise<Result<BluetoothRemoteGATTCharacteristic>> {
  if (state.characteristic && state.device?.gatt?.connected) {
    return ok(state.characteristic);
  }
  if (state.device?.gatt) {
    const r = await attempt(async () => {
      const server = await state.device!.gatt!.connect();
      const c = await findWritableCharacteristic(server);
      if (!c) throw new Error("No writable characteristic.");
      state.characteristic = c;
      return c;
    }, "Reconnecting printer");
    return r;
  }
  return fail("No printer paired. Pair a printer in Settings first.");
}

/** Writes raw ESC/POS bytes to the connected printer in safe chunks. */
export async function printBytes(data: Uint8Array): Promise<Result<true>> {
  const conn = await ensureConnected();
  if (!conn.ok) return conn;
  const characteristic = conn.value;
  return attempt(async () => {
    const chunkSize = 180; // stay under typical BLE MTU
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      // brief pause so the printer buffer keeps up
      await new Promise((r) => setTimeout(r, 24));
    }
    return true as const;
  }, "Printing");
}

export function forgetPrinter() {
  try {
    state.device?.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  state.device = undefined;
  state.characteristic = undefined;
}
