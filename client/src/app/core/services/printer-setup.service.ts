import { Injectable, signal } from '@angular/core';
import html2canvas from 'html2canvas-pro';

const STORAGE_KEY = 'japs.printerSetup.configured';
const DEVICE_ID_KEY = 'japs.printerSetup.deviceId';

// GATT "Printer Service" UUID exposed by common cheap BLE thermal printers.
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';

// Standard GATT Battery Service / Battery Level characteristic (not all printers expose this).
const BATTERY_SERVICE_UUID = 'battery_service';
const BATTERY_LEVEL_CHARACTERISTIC_UUID = 'battery_level';

const ESC = 0x1b;
const GS = 0x1d;

// 58mm thermal paper prints at 384 dots wide.
const PRINTER_WIDTH_DOTS = 384;

@Injectable({ providedIn: 'root' })
export class PrinterSetupService {
  private _configured = signal<boolean>(localStorage.getItem(STORAGE_KEY) === 'true');
  private _connected = signal<boolean>(false);
  private _deviceName = signal<string>('');
  private _batteryLevel = signal<number | null>(null);

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  isConfigured(): boolean {
    return this._configured();
  }

  isConnected(): boolean {
    return this._connected();
  }

  deviceName(): string {
    return this._deviceName();
  }

  /** Battery percentage (0-100) reported by the printer, or null if it doesn't expose
   *  the standard GATT battery service. */
  batteryLevel(): number | null {
    return this._batteryLevel();
  }

  markConfigured(): void {
    localStorage.setItem(STORAGE_KEY, 'true');
    this._configured.set(true);
  }

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEVICE_ID_KEY);
    this._configured.set(false);
    this.disconnect();
  }

  /** Connects to a BLE thermal printer. Reuses a previously granted device if the
   *  browser supports it (no new chooser prompt); otherwise opens the device chooser
   *  (must be called from a user gesture, e.g. a button click). */
  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error(
        window.isSecureContext
          ? 'This browser does not support Web Bluetooth. Use a Chromium-based browser (e.g. Chrome) on Android.'
          : 'Bluetooth requires a secure connection. Open this app over HTTPS (or localhost), not a plain http:// address.',
      );
    }

    const rememberedId = localStorage.getItem(DEVICE_ID_KEY);

    if (rememberedId && typeof navigator.bluetooth.getDevices === 'function') {
      const known = await navigator.bluetooth.getDevices();
      const match = known.find((d) => d.id === rememberedId);
      if (match) {
        await this.connectToDevice(match);
        return;
      }
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [PRINTER_SERVICE_UUID] }],
      optionalServices: [PRINTER_SERVICE_UUID, BATTERY_SERVICE_UUID],
    });

    localStorage.setItem(DEVICE_ID_KEY, device.id);
    await this.connectToDevice(device);
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.characteristic = null;
    this._connected.set(false);
    this._deviceName.set('');
    this._batteryLevel.set(null);
  }

  /** Captures the given DOM element (the on-screen ticket preview) as a bitmap and
   *  prints it as an image on the connected thermal printer, so the physical receipt
   *  is a faithful copy of what's shown on screen rather than a re-typed plain-text
   *  approximation. */
  async printTicketImage(element: HTMLElement): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Printer not connected.');
    }

    const canvas = await this.captureAtPrinterWidth(element);
    const resized = this.resizeToWidth(canvas, PRINTER_WIDTH_DOTS);
    const bitmap = this.toMonochromeBitmap(resized);

    const payload = this.concatBuffers([
      new Uint8Array([ESC, 0x40]), // initialize
      new Uint8Array([ESC, 0x61, 0x01]), // center align
      this.buildRasterImageCommand(bitmap),
      new Uint8Array([ESC, 0x64, 0x01]), // feed 1 line
    ]);

    const chunkSize = 180;
    const delayMs = 10;
    const useNoResponse =
      !!this.characteristic.properties.writeWithoutResponse &&
      typeof (this.characteristic as any).writeValueWithoutResponse === 'function';

    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      if (useNoResponse) {
        await (this.characteristic as any).writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /** Builds a small sample ticket off-screen and prints it as an image, used by the
   *  printer setup page's "Send Test Print" button. */
  async printSampleTicketImage(): Promise<void> {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed; left:-9999px; top:0; padding:16px 8px; background:#fff; color:#000; font-size:20px; font-weight:500; text-align:center;';
    el.innerHTML = `
      <div style="font-weight:bold; font-size:24px;">JAPS TRANSIT</div>
      <div style="font-size:18px;">Bus Operations &amp; Ticketing</div>
      <div style="font-size:18px;">${new Date().toLocaleString()}</div>
      <div style="border-top:2px dashed #000; margin:12px 0;"></div>
      <div style="font-weight:bold;">*** TEST PRINT ***</div>
      <div style="border-top:2px dashed #000; margin:12px 0;"></div>
      <div>If you can read this clearly, your printer is set up correctly.</div>
    `;
    document.body.appendChild(el);
    try {
      await this.printTicketImage(el);
    } finally {
      document.body.removeChild(el);
    }
  }

  /** Captures an off-screen copy of `element` laid out exactly PRINTER_WIDTH_DOTS CSS px
   *  wide at scale 1, so one CSS pixel is one printer dot on every device. Capturing the
   *  on-screen element directly would make the printed size depend on the phone's screen
   *  width, and the stretch to 384 dots blurs text before it's thresholded to 1-bit. */
  private async captureAtPrinterWidth(element: HTMLElement): Promise<HTMLCanvasElement> {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.style.position = 'fixed';
    copy.style.left = '-10000px';
    copy.style.top = '0';
    copy.style.width = `${PRINTER_WIDTH_DOTS}px`;
    // The on-screen preview scrolls (max-h/overflow-auto); capture it in full instead.
    copy.style.maxHeight = 'none';
    copy.style.overflow = 'visible';
    document.body.appendChild(copy);
    try {
      return await html2canvas(copy, { backgroundColor: '#ffffff', scale: 1 });
    } finally {
      copy.remove();
    }
  }

  /** Downscales/upscales a captured canvas to the printer's fixed dot width, preserving
   *  aspect ratio, onto a plain (unscaled) canvas. */
  private resizeToWidth(source: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
    const targetHeight = Math.round((source.height / source.width) * targetWidth);
    const out = document.createElement('canvas');
    out.width = targetWidth;
    out.height = targetHeight;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return out;
  }

  /** Converts a canvas to a 1-bit-per-pixel bitmap (MSB first, 1 = print/black),
   *  the format ESC/POS raster image commands expect. */
  private toMonochromeBitmap(canvas: HTMLCanvasElement): {
    width: number;
    height: number;
    bytesPerRow: number;
    data: Uint8Array;
  } {
    const { width, height } = canvas;
    const ctx = canvas.getContext('2d')!;
    const { data: pixels } = ctx.getImageData(0, 0, width, height);
    const bytesPerRow = Math.ceil(width / 8);
    const data = new Uint8Array(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const alpha = pixels[i + 3];
        const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        const isBlack = alpha > 0 && luminance < 200;
        if (isBlack) {
          const byteIndex = y * bytesPerRow + (x >> 3);
          data[byteIndex] |= 0x80 >> x % 8;
        }
      }
    }

    return { width, height, bytesPerRow, data };
  }

  /** Builds the ESC/POS "GS v 0" raster bit image command for a monochrome bitmap. */
  private buildRasterImageCommand(bitmap: {
    width: number;
    height: number;
    bytesPerRow: number;
    data: Uint8Array;
  }): Uint8Array {
    const { bytesPerRow, height, data } = bitmap;
    const header = new Uint8Array([
      GS,
      0x76,
      0x30,
      0x00, // m: normal mode
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      height & 0xff,
      (height >> 8) & 0xff,
    ]);
    return this.concatBuffers([header, data]);
  }

  private async connectToDevice(device: BluetoothDevice): Promise<void> {
    device.addEventListener('gattserverdisconnected', () => {
      this._connected.set(false);
      this.characteristic = null;
      this._batteryLevel.set(null);
    });

    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse);

    if (!writable) {
      throw new Error('No write characteristic found on this printer.');
    }

    this.device = device;
    this.characteristic = writable;
    this._connected.set(true);
    this._deviceName.set(device.name ?? 'Unknown Printer');

    await this.watchBatteryLevel(server);
  }

  /** Not all printers expose the battery service — this is best-effort and silently
   *  no-ops (leaving batteryLevel() as null) if it's unsupported. */
  private async watchBatteryLevel(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
      const batteryCharacteristic = await batteryService.getCharacteristic(
        BATTERY_LEVEL_CHARACTERISTIC_UUID,
      );

      const readLevel = (value: DataView) => this._batteryLevel.set(value.getUint8(0));

      const initial = await batteryCharacteristic.readValue();
      readLevel(initial);

      batteryCharacteristic.addEventListener('characteristicvaluechanged', () => {
        if (batteryCharacteristic.value) readLevel(batteryCharacteristic.value);
      });
      await batteryCharacteristic.startNotifications();
    } catch {
      this._batteryLevel.set(null);
    }
  }

  private concatBuffers(buffers: Uint8Array[]): Uint8Array {
    const total = buffers.reduce((sum, b) => sum + b.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) {
      out.set(b, offset);
      offset += b.length;
    }
    return out;
  } 
}
