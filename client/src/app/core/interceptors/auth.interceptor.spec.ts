import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../../environments/environment';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('includes credentials for API requests', () => {
    const url = `${environment.apiUrl}/api/auth/me`;
    TestBed.inject(HttpClient).get(url).subscribe();

    const request = httpMock.expectOne(url);
    expect(request.request.withCredentials).toBe(true);
    request.flush({});
  });

  it('does not include credentials for non-API requests', () => {
    const url = 'https://example.com/data';
    TestBed.inject(HttpClient).get(url).subscribe();

    const request = httpMock.expectOne(url);
    expect(request.request.withCredentials).toBe(false);
    request.flush({});
  });
});
