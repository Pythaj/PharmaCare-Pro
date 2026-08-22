/**
 * Single source of truth for application settings (Rule 18).
 *
 * The canonical store is the SystemSetting database table, keyed by
 * dot-notation strings (e.g. "pharmacy.taxRate"). A localStorage copy under
 * STORAGE_KEY mirrors the same nested shape for fast/offline reads —
 * written through by SettingsView and consumers of usePharmacySettings().
 */

// ─── Types ───────────────────────────────────────────────────────

export interface PharmacyInfo {
  appName: string;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  taxRate: number;
  logoUrl: string;
  faviconUrl: string;
}

export interface ReceiptSettings {
  headerText: string;
  footerText: string;
  width: string;
  showTax: boolean;
  showDiscount: boolean;
}

export interface DisplaySettings {
  currency: string;
  dateFormat: string;
  timeFormat: string;
  primaryColor: string;
}

export interface POSSettings {
  defaultPaymentMethod: string;
  autoPrintReceipt: boolean;
  defaultDiscount: number;
  requireCustomer: boolean;
  allowNegativeStock: boolean;
  maxLineItems: number;
}

export interface NotificationSettings {
  lowStockThreshold: number;
  expiryAlertDays: number;
  enableNotifications: boolean;
}

export interface BusinessSettings {
  enableHours: boolean;
  openTime: string;
  closeTime: string;
  closedDays: string;
}

export interface DataSettings {
  autoBackup: string;
  sessionTimeout: number;
  requirePassword: boolean;
}

export interface AllSettings {
  pharmacy: PharmacyInfo;
  receipt: ReceiptSettings;
  display: DisplaySettings;
  pos: POSSettings;
  notifications: NotificationSettings;
  business: BusinessSettings;
  data: DataSettings;
}

// ─── Storage ─────────────────────────────────────────────────────

export const SETTINGS_STORAGE_KEY = 'pharmacy_settings';

// ─── Defaults ────────────────────────────────────────────────────

export const defaultSettings: AllSettings = {
  pharmacy: {
    appName: 'PharmaCare Pro',
    name: 'GreenLife Pharmacy',
    tagline: 'Pharmacy Management',
    address: '123 Health Street, Accra, Ghana',
    phone: '+233 30 123 4567',
    email: 'info@greenlifepharmacy.com',
    taxRate: 12.5,
    logoUrl: '',
    faviconUrl: '',
  },
  receipt: {
    headerText: 'GreenLife Pharmacy — Your Health, Our Priority',
    footerText: 'Thank you for your purchase!',
    width: '80mm',
    showTax: true,
    showDiscount: false,
  },
  display: {
    currency: 'GHS',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: 'HH:mm',
    primaryColor: 'emerald',
  },
  pos: {
    defaultPaymentMethod: 'cash',
    autoPrintReceipt: true,
    defaultDiscount: 0,
    requireCustomer: false,
    allowNegativeStock: false,
    maxLineItems: 50,
  },
  notifications: {
    lowStockThreshold: 10,
    expiryAlertDays: 30,
    enableNotifications: true,
  },
  business: {
    enableHours: false,
    openTime: '08:00',
    closeTime: '18:00',
    closedDays: '0',
  },
  data: {
    autoBackup: 'off',
    sessionTimeout: 480,
    requirePassword: true,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

/** Converts the nested settings object into flat dot-notation key-value pairs for the API. */
export function flattenSettings(s: AllSettings): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, key);
      } else {
        result[key] = String(v);
      }
    }
  };
  walk(s as unknown as Record<string, unknown>, '');
  return result;
}

/**
 * Converts flat API key-value pairs back into the nested settings shape.
 * NOTE: numeric-looking strings are coerced to numbers — callers dealing
 * with leading-zero values (e.g. phone numbers) must read them as raw
 * strings from the API instead of via this helper.
 */
export function unflattenSettings(flat: Record<string, string>): Partial<AllSettings> {
  const result: Record<string, unknown> = {};
  for (const [compoundKey, value] of Object.entries(flat)) {
    const parts = compoundKey.split('.');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    // Parse numbers and booleans
    let parsed: string | number | boolean = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (value !== '' && !isNaN(Number(value))) parsed = Number(value);
    current[parts[parts.length - 1]] = parsed;
  }
  return result as unknown as Partial<AllSettings>;
}
