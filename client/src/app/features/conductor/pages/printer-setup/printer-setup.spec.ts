import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrinterSetupPage } from './printer-setup';
import { PrinterSetupService } from '../../../../core/services/printer-setup.service';

describe('PrinterSetupPage', () => {
  let component: PrinterSetupPage;
  let fixture: ComponentFixture<PrinterSetupPage>;
  let printSampleTicketImage: ReturnType<typeof vi.fn>;
  let connect: ReturnType<typeof vi.fn>;
  let markConfigured: ReturnType<typeof vi.fn>;
  let connected: boolean;

  beforeEach(async () => {
    connected = false;
    printSampleTicketImage = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockImplementation(async () => {
      connected = true;
    });
    markConfigured = vi.fn();

    await TestBed.configureTestingModule({
      imports: [PrinterSetupPage],
      providers: [
        provideRouter([]),
        {
          provide: PrinterSetupService,
          useValue: {
            printSampleTicketImage,
            connect,
            markConfigured,
            reset: vi.fn(),
            isConfigured: () => false,
            isConnected: () => connected,
            deviceName: () => 'Test Printer',
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PrinterSetupPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('connects to the printer when connectPrinter is called', async () => {
    await component.connectPrinter();
    expect(connect).toHaveBeenCalled();
    expect(component.isConnected()).toBe(true);
  });

  it('sends a sample ticket image when sendTestPrint is called', async () => {
    await component.sendTestPrint();
    expect(printSampleTicketImage).toHaveBeenCalled();
    expect(component.showConfirmation()).toBe(true);
  });

  it('marks configured and clears confirmation on confirmSuccess', async () => {
    await component.sendTestPrint();
    component.confirmSuccess();
    expect(markConfigured).toHaveBeenCalled();
    expect(component.showConfirmation()).toBe(false);
  });

  it('shows troubleshooting and clears confirmation on confirmFailure', async () => {
    await component.sendTestPrint();
    component.confirmFailure();
    expect(markConfigured).not.toHaveBeenCalled();
    expect(component.showConfirmation()).toBe(false);
    expect(component.showTroubleshooting()).toBe(true);
  });
});
