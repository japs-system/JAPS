#!/usr/bin/env node
/**
 * Prints a sample JAPS ticket on a BLE thermal printer using the same pipeline as the
 * conductor portal (client/src/app/core/services/printer-setup.service.ts):
 *
 *   receipt markup/styles from ticketing.html -> off-screen copy 384px wide
 *   -> html2canvas-pro (scale 1) -> 1-bit bitmap (luminance < 200 = black)
 *   -> ESC @ + 300 ms wake-up pause, then ESC @, ESC a 1, GS v 0 raster image, ESC d 8
 *   -> written to the printer's first writable characteristic in 100-byte chunks, 50 ms apart.
 *
 * Nothing is rendered or sent until a printer is connected.
 *
 * Usage:
 *   node print-sample-ticket.js                    wait for a printer (BLE service 18F0), then print
 *   node print-sample-ticket.js --name MPT         match the printer by name instead
 *   node print-sample-ticket.js --preview out.png  save the exact 1-bit image, no Bluetooth
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

// Same GATT "Printer Service" the web app filters on (000018f0-0000-1000-8000-00805f9b34fb).
const PRINTER_SERVICE_UUID = '18f0';
const PRINTER_SERVICE_UUID_LONG = '000018f000001000800000805f9b34fb';

const ESC = 0x1b;
const GS = 0x1d;

// 58mm thermal paper prints at 384 dots wide.
const PRINTER_WIDTH_DOTS = 384;
const CHUNK_SIZE = 100;
const CHUNK_DELAY_MS = 50;
// Pause after the wake-up/initialize command, before any image data (same as the web app).
const WAKE_DELAY_MS = 300;
const CONNECT_TIMEOUT_MS = 15000;

const LOGO_PATH = path.resolve(__dirname, '../../client/public/assets/images/JAPS (black).png');

// Mirrors the `printed` object built in TicketingPage.printTicketSubmit().
// A group ticket: one ticket number covering several passengers.
const SAMPLE_TICKET = {
  ticketNumber: 25,
  passengers: [
    { category: 'regular', quantity: 1, unit_fare: 29, subtotal: 29 },
    { category: 'student', quantity: 1, unit_fare: 23.2, subtotal: 23.2 },
    { category: 'senior_citizen', quantity: 1, unit_fare: 23.2, subtotal: 23.2 },
  ],
  passengerCount: 3,
  boardingPoint: 'Cubao',
  droppingPoint: 'Baguio City',
  distance: 12,
  fare: 75.4,
  bus: { bus_number: 'JAPS-01', plate_number: 'ABC 1234' },
};

// Same labels as TicketingPage.getCategoryLabel().
const CATEGORY_LABELS = {
  regular: 'Regular',
  student: 'Student',
  senior_citizen: 'Senior Citizen',
  pwd: 'PWD',
  discounted: 'Discounted',
};

// ---------------------------------------------------------------------------- args

function parseArgs(argv) {
  const args = { name: null, preview: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--preview') args.preview = argv[++i] || 'sample-ticket.png';
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms))),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------- receipt HTML

const escapeHtml = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Angular DatePipe 'medium' (en-US): "Sep 28, 2026, 3:04:05 PM" */
function formatMediumDate(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

/** Angular DecimalPipe '1.2-2' (en-US) */
const formatMoney = (v) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The #receiptContent block from ticketing.html, with the Tailwind v4 utilities it uses
 *  written out as plain CSS (including the global Poppins override from styles.css, which
 *  beats `font-mono` in the app too). */
function buildReceiptHtml(t) {
  const logo = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  const e = escapeHtml;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" />
<style>
  /* Tailwind preflight (the parts that matter here) + styles.css globals */
  *, ::before, ::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
  *, *::before, *::after { font-family: 'Poppins', sans-serif !important; }
  html { line-height: 1.5; -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: #fff; }
  img { display: block; max-width: 100%; }
  h4 { font-size: inherit; font-weight: inherit; }

  /* Tailwind v4 utilities used by the receipt */
  .bg-white { background-color: #fff; }
  .px-2 { padding-inline: 0.5rem; }
  .py-4 { padding-block: 1rem; }
  .text-base { font-size: 1rem; line-height: 1.5; }
  .text-lg { font-size: 1.125rem; line-height: calc(1.75 / 1.125); }
  .text-xl { font-size: 1.25rem; line-height: calc(1.75 / 1.25); }
  .text-2xl { font-size: 1.5rem; line-height: calc(2 / 1.5); }
  .text-black { color: #000; }
  .max-h-\\[70vh\\] { max-height: 70vh; }
  .overflow-y-auto { overflow-y: auto; }
  :where(.space-y-1 > :not(:last-child)) { margin-block-end: 0.25rem; }
  :where(.space-y-3 > :not(:last-child)) { margin-block-end: 0.75rem; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .h-8 { height: 2rem; }
  .h-14 { height: 3.5rem; }
  .mx-auto { margin-inline: auto; }
  .font-medium { font-weight: 500; }
  .font-bold { font-weight: 700; }
  .tracking-wider { letter-spacing: 0.05em; }
  .tracking-widest { letter-spacing: 0.1em; }
  .border-t-2 { border-top-width: 2px; }
  .border-dashed { border-style: dashed; }
  .border-black { border-color: #000; }
  .mt-1 { margin-top: 0.25rem; }
  .pt-2 { padding-top: 0.5rem; }
  .flex { display: flex; }
  .gap-2 { gap: 0.5rem; }
  .justify-between { justify-content: space-between; }
  .justify-center { justify-content: center; }
  .items-center { align-items: center; }
  .capitalize { text-transform: capitalize; }
  .uppercase { text-transform: uppercase; }
</style>
</head>
<body>
  <div style="width:${PRINTER_WIDTH_DOTS}px">
    <div id="receiptContent" class="bg-white px-2 py-4 font-mono text-xl font-medium text-black space-y-3 max-h-[70vh] overflow-y-auto">
      <div class="text-center space-y-1">
        <img src="${logo}" alt="JAPS" class="h-14 mx-auto" />
        <h4 class="text-2xl">JAPS Transport Services</h4>
        <p class="text-lg">${e(formatMediumDate(new Date()))}</p>
      </div>

      <div class="border-t-2 border-dashed border-black"></div>

      <div class="space-y-1">
        <div class="flex justify-between gap-2 font-bold text-2xl"><span>TICKET NO:</span><span>#${e(t.ticketNumber)}</span></div>
        <div class="flex justify-between gap-2"><span>PLATE NO:</span><span class="text-right">${e(t.bus?.plate_number)}</span></div>
        <div class="flex justify-between gap-2"><span>FROM:</span><span class="text-right font-bold">${e(t.boardingPoint)}</span></div>
        <div class="flex justify-between gap-2"><span>TO:</span><span class="text-right font-bold">${e(t.droppingPoint)}</span></div>
      </div>

      <div class="border-t-2 border-dashed border-black"></div>

      <div class="space-y-1">
        ${t.passengers
          .map(
            (l) =>
              `<div class="flex justify-between gap-2"><span>${e(CATEGORY_LABELS[l.category] ?? l.category)} ×${e(l.quantity)}</span><span class="text-right">₱${formatMoney(l.subtotal)}</span></div>`,
          )
          .join('')}
        <div class="flex justify-between gap-2 font-bold">
          <span>PASSENGERS:</span><span class="text-right">${e(t.passengerCount)}</span>
        </div>
        <div class="flex justify-between gap-2 font-bold text-2xl pt-2 border-t-2 border-black">
          <span>TOTAL:</span><span class="text-right">₱${formatMoney(t.fare)}</span>
        </div>
      </div>

      <div class="border-t-2 border-dashed border-black"></div>

      <div class="text-center text-lg">
        <p>Thank you for riding JAPS Transit!</p>
        <p class="font-bold text-base uppercase mt-1">Please keep this ticket for validation</p>
      </div>

      <div class="h-8"></div>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------- rendering

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Could not find Chrome or Edge. Set CHROME_PATH to a Chromium-based browser.');
  return found;
}

/** Renders the receipt in headless Chromium and runs the exact capture -> resize ->
 *  threshold steps from PrinterSetupService, returning the 1-bit bitmap. */
async function renderTicketBitmap(ticket) {
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setContent(buildReceiptHtml(ticket), { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const hasPoppins = await page.evaluate(() => document.fonts.check('500 12px Poppins'));
    if (!hasPoppins) console.warn('! Poppins font not loaded (offline?) - falling back to sans-serif.');

    // The package's "exports" hides dist/ subpaths, so locate the browser UMD build next to its main entry.
    const html2canvasUmd = path.join(path.dirname(require.resolve('html2canvas-pro')), 'html2canvas-pro.js');
    await page.addScriptTag({ path: html2canvasUmd });

    return await page.evaluate(async (targetWidth) => {
      const element = document.getElementById('receiptContent');
      const html2canvas = window.html2canvas.default || window.html2canvas;

      // captureAtPrinterWidth()
      const copy = element.cloneNode(true);
      copy.style.position = 'fixed';
      copy.style.left = '-10000px';
      copy.style.top = '0';
      copy.style.width = `${targetWidth}px`;
      copy.style.maxHeight = 'none';
      copy.style.overflow = 'visible';
      document.body.appendChild(copy);
      let canvas;
      try {
        canvas = await html2canvas(copy, { backgroundColor: '#ffffff', scale: 1 });
      } finally {
        copy.remove();
      }

      // resizeToWidth()
      const targetHeight = Math.round((canvas.height / canvas.width) * targetWidth);
      const out = document.createElement('canvas');
      out.width = targetWidth;
      out.height = targetHeight;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

      // toMonochromeBitmap()
      const { width, height } = out;
      const { data: pixels } = ctx.getImageData(0, 0, width, height);
      const bytesPerRow = Math.ceil(width / 8);
      const data = new Uint8Array(bytesPerRow * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const alpha = pixels[i + 3];
          const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          if (alpha > 0 && luminance < 200) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
        }
      }

      // Preview of exactly what the print head will burn.
      const preview = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const on = data[y * bytesPerRow + (x >> 3)] & (0x80 >> x % 8);
          const i = (y * width + x) * 4;
          preview.data[i] = preview.data[i + 1] = preview.data[i + 2] = on ? 0 : 255;
          preview.data[i + 3] = 255;
        }
      }
      ctx.putImageData(preview, 0, 0);

      return { width, height, bytesPerRow, data: Array.from(data), previewPng: out.toDataURL('image/png') };
    }, PRINTER_WIDTH_DOTS);
  } finally {
    await browser.close();
  }
}

/** Same byte sequence as PrinterSetupService.printTicketImage(). */
function buildPayload(bitmap) {
  const { bytesPerRow, height } = bitmap;
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), // initialize
    Buffer.from([ESC, 0x61, 0x01]), // center align
    Buffer.from([
      GS,
      0x76,
      0x30,
      0x00, // m: normal mode
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      height & 0xff,
      (height >> 8) & 0xff,
    ]),
    Buffer.from(bitmap.data),
    Buffer.from([ESC, 0x64, 0x08]), // feed 8 lines
  ]);
}

// ---------------------------------------------------------------------------- bluetooth

function createPrinterLink(noble, nameFilter) {
  const label = (p) => `${p.advertisement?.localName || 'Unknown Printer'} [${p.address || p.id}]`;

  const matches = (p) => {
    if (nameFilter) {
      return (p.advertisement?.localName || '').toLowerCase().includes(nameFilter.toLowerCase());
    }
    return (p.advertisement?.serviceUuids || []).some(
      (u) => u === PRINTER_SERVICE_UUID || u.replace(/-/g, '') === PRINTER_SERVICE_UUID_LONG,
    );
  };

  function waitForPoweredOn() {
    return new Promise((resolve) => {
      if (noble.state === 'poweredOn') return resolve();
      console.log('Waiting for the Bluetooth adapter to turn on...');
      const onState = (state) => {
        if (state === 'poweredOn') {
          noble.removeListener('stateChange', onState);
          resolve();
        } else {
          console.log(`  Bluetooth adapter is "${state}" - turn Bluetooth on to continue.`);
        }
      };
      noble.on('stateChange', onState);
    });
  }

  function discoverOne() {
    return new Promise((resolve, reject) => {
      const onDiscover = (p) => {
        if (!matches(p)) return;
        noble.removeListener('discover', onDiscover);
        noble.stopScanningAsync().finally(() => resolve(p));
      };
      noble.on('discover', onDiscover);
      // With --name we can't rely on the printer advertising 18F0, so scan everything.
      noble.startScanningAsync(nameFilter ? [] : [PRINTER_SERVICE_UUID], false).catch(reject);
    });
  }

  async function connect(peripheral) {
    await withTimeout(peripheral.connectAsync(), CONNECT_TIMEOUT_MS, 'connection timed out');
    const { characteristics } = await withTimeout(
      peripheral.discoverSomeServicesAndCharacteristicsAsync([PRINTER_SERVICE_UUID], []),
      CONNECT_TIMEOUT_MS,
      'service discovery timed out',
    );
    const writable = characteristics.find(
      (c) => c.properties.includes('write') || c.properties.includes('writeWithoutResponse'),
    );
    if (!writable) throw new Error('No write characteristic found on this printer.');
    return { peripheral, characteristic: writable, name: label(peripheral) };
  }

  /** Blocks until a printer is found AND connected; keeps retrying otherwise. */
  async function waitForPrinter() {
    await waitForPoweredOn();
    console.log(
      nameFilter
        ? `Waiting for a Bluetooth printer named "${nameFilter}"... (turn the printer on)`
        : 'Waiting for a Bluetooth thermal printer (service 18F0)... (turn the printer on)',
    );
    for (;;) {
      const peripheral = await discoverOne();
      console.log(`Found ${label(peripheral)}, connecting...`);
      try {
        return await connect(peripheral);
      } catch (err) {
        console.log(`  Could not connect: ${err.message}. Retrying...`);
        await peripheral.disconnectAsync().catch(() => {});
        await sleep(2000);
      }
    }
  }

  return { waitForPrinter };
}

async function sendPayload({ peripheral, characteristic }, payload) {
  // Web Bluetooth's writeValue() writes with response when the characteristic supports it.
  const withoutResponse = !characteristic.properties.includes('write');
  await characteristic.writeAsync(Buffer.from([ESC, 0x40]), withoutResponse);
  await sleep(WAKE_DELAY_MS);
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    if (peripheral.state !== 'connected') throw new Error('Printer disconnected while printing.');
    await characteristic.writeAsync(payload.subarray(i, i + CHUNK_SIZE), withoutResponse);
    await sleep(CHUNK_DELAY_MS);
    process.stdout.write(`\r  Sending ${Math.min(i + CHUNK_SIZE, payload.length)}/${payload.length} bytes`);
  }
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.preview) {
    const bitmap = await renderTicketBitmap(SAMPLE_TICKET);
    fs.writeFileSync(args.preview, Buffer.from(bitmap.previewPng.split(',')[1], 'base64'));
    console.log(`Saved ${bitmap.width}x${bitmap.height} preview to ${path.resolve(args.preview)}`);
    return;
  }

  const noble = require('@stoprocent/noble');
  const link = createPrinterLink(noble, args.name);

  let printer = await link.waitForPrinter();
  console.log(`Connected to ${printer.name}.`);

  // Rendered only after connecting, so the ticket's date is the actual print time.
  console.log('Rendering ticket...');
  const bitmap = await renderTicketBitmap(SAMPLE_TICKET);
  const payload = buildPayload(bitmap);

  if (printer.peripheral.state !== 'connected') {
    console.log('Printer dropped while rendering - reconnecting before printing.');
    printer = await link.waitForPrinter();
  }

  console.log(`Printing ${bitmap.width}x${bitmap.height} ticket...`);
  await sendPayload(printer, payload);
  console.log('Done.');

  await printer.peripheral.disconnectAsync().catch(() => {});
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
