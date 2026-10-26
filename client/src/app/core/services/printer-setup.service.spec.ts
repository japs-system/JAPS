import { TestBed } from '@angular/core/testing';
import { PrinterSetupService } from './printer-setup.service';

vi.mock('html2canvas-pro', () => ({
  default: vi.fn(),
}));

import html2canvas from 'html2canvas-pro';

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas: any = { width, height };
  canvas.getContext = () => ({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    // Reads canvas.width/height live, since resizeToWidth mutates them after creation.
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255),
    })),
  });
  return canvas as HTMLCanvasElement;
}

const realCreateElement = document.createElement.bind(document);

describe('PrinterSetupService', () => {
  let service: PrinterSetupService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PrinterSetupService);
    vi.mocked(html2canvas).mockReset();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? fakeCanvas(384, 100) : realCreateElement(tag),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports not configured by default', () => {
    expect(service.isConfigured()).toBe(false);
  });

  it('reports configured after markConfigured and persists across instances', () => {
    service.markConfigured();
    expect(service.isConfigured()).toBe(true);

    const fresh = TestBed.inject(PrinterSetupService);
    expect(fresh.isConfigured()).toBe(true);
  });

  it('reports not configured after reset', () => {
    service.markConfigured();
    service.reset();
    expect(service.isConfigured()).toBe(false);
  });

  it('printTicketImage throws when no printer is connected', async () => {
    const el = document.createElement('div');
    await expect(service.printTicketImage(el)).rejects.toThrow('Printer not connected.');
  });

  it('connects to a printer over Web Bluetooth and reports connected state', async () => {
    const writeValue = vi.fn().mockResolvedValue(undefined);
    const characteristic = { properties: { write: true, writeWithoutResponse: false }, writeValue };
    const service_ = {
      getCharacteristics: vi.fn().mockResolvedValue([characteristic]),
    };
    const gatt = {
      connected: true,
      connect: vi.fn().mockResolvedValue({ getPrimaryService: vi.fn().mockResolvedValue(service_) }),
      disconnect: vi.fn(),
    };
    const device = {
      id: 'device-1',
      name: 'Cheap Thermal Printer',
      gatt,
      addEventListener: vi.fn(),
    };

    (navigator as any).bluetooth = {
      requestDevice: vi.fn().mockResolvedValue(device),
    };

    await service.connect();

    expect(service.isConnected()).toBe(true);
    expect(service.deviceName()).toBe('Cheap Thermal Printer');

    vi.mocked(html2canvas).mockResolvedValue(fakeCanvas(8, 8));
    // Skip the real 50ms inter-chunk delay so the test doesn't pay for it.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as any;
    }) as any);

    await service.printTicketImage(document.createElement('div'));
    expect(writeValue).toHaveBeenCalled();
  });

  it('disconnect clears connection state', async () => {
    const characteristic = { properties: { write: true, writeWithoutResponse: false }, writeValue: vi.fn() };
    const gatt = {
      connected: true,
      connect: vi
        .fn()
        .mockResolvedValue({ getPrimaryService: vi.fn().mockResolvedValue({ getCharacteristics: vi.fn().mockResolvedValue([characteristic]) }) }),
      disconnect: vi.fn(),
    };
    const device = { id: 'device-1', name: 'Printer', gatt, addEventListener: vi.fn() };
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device) };

    await service.connect();
    expect(service.isConnected()).toBe(true);

    service.disconnect();
    expect(service.isConnected()).toBe(false);
    expect(gatt.disconnect).toHaveBeenCalled();
  });
});
