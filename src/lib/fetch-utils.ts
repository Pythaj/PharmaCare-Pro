/**
 * Enhanced fetch wrapper with automatic error handling for the Pharmacy Management System.
 *
 * Features:
 * - Automatic JSON parsing
 * - Error toast for non-OK responses (extracts error from API response body)
 * - Network error detection with toast
 * - Configurable silent mode for background fetches
 */

import { toast } from 'sonner';

interface FetchOptions extends RequestInit {
  /** Set to true to suppress error toasts (for background/optimistic fetches) */
  silent?: boolean;
  /** Custom error message to show instead of the API response error */
  errorMessage?: string;
}

interface FetchResult<T = unknown> {
  ok: boolean;
  data: T | null;
  status: number;
  error?: string;
}

/**
 * Enhanced fetch with automatic error handling.
 * Shows toast errors for failed requests unless `silent` is true.
 *
 * @example
 * const { ok, data, error } = await apiFetch<{ customers: Customer[] }>('/api/customers');
 * if (ok) { setCustomers(data!.customers); }
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult<T>> {
  const { silent = false, errorMessage, ...fetchOptions } = options;

  try {
    const res = await fetch(url, fetchOptions);

    // Handle non-JSON responses gracefully
    const contentType = res.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!res.ok) {
      let apiError = errorMessage || `Request failed (${res.status})`;

      if (isJson) {
        try {
          const body = await res.json();
          if (body.error) apiError = body.error;
        } catch {
          // Use default error message
        }
      }

      if (!silent) {
        toast.error(apiError);
      }

      return { ok: false, data: null, status: res.status, error: apiError };
    }

    if (isJson) {
      const data = await res.json();
      return { ok: true, data: data as T, status: res.status };
    }

    return { ok: true, data: null, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    const isNetworkError = message.includes('fetch') || message.includes('network') || message.includes('Failed to fetch');

    if (!silent) {
      toast.error(isNetworkError ? 'Connection error. Please check your network.' : message);
    }

    return { ok: false, data: null, status: 0, error: message };
  }
}

/**
 * Quick GET helper.
 * @example const { data } = await apiGet<{ products: Product[] }>('/api/products');
 */
export async function apiGet<T = unknown>(
  url: string,
  options?: FetchOptions
): Promise<FetchResult<T>> {
  return apiFetch<T>(url, { ...options, method: 'GET' });
}

/**
 * Quick POST helper with JSON body.
 * @example const { ok, data } = await apiPost<Customer>('/api/customers', { body: { name: 'John' } });
 */
export async function apiPost<T = unknown>(
  url: string,
  body?: unknown,
  options?: FetchOptions
): Promise<FetchResult<T>> {
  return apiFetch<T>(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Quick PATCH helper with JSON body.
 */
export async function apiPatch<T = unknown>(
  url: string,
  body?: unknown,
  options?: FetchOptions
): Promise<FetchResult<T>> {
  return apiFetch<T>(url, {
    ...options,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Quick DELETE helper.
 */
export async function apiDelete<T = unknown>(
  url: string,
  options?: FetchOptions
): Promise<FetchResult<T>> {
  return apiFetch<T>(url, { ...options, method: 'DELETE' });
}
