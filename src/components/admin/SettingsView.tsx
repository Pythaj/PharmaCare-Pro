'use client';

import { useState, useEffect } from 'react';
import { Save, Building2, Phone, Mail, MapPin, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface PharmacySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxRate: number;
}

interface DisplaySettings {
  currency: string;
  dateFormat: string;
}

const defaultPharmacy: PharmacySettings = {
  name: 'GreenLife Pharmacy',
  address: '123 Health Street, Accra, Ghana',
  phone: '+233 30 123 4567',
  email: 'info@greenlifepharmacy.com',
  taxRate: 12.5,
};

const defaultDisplay: DisplaySettings = {
  currency: 'GHS',
  dateFormat: 'dd/MM/yyyy',
};

export default function SettingsView() {
  const [pharmacy, setPharmacy] = useState<PharmacySettings>(defaultPharmacy);
  const [display, setDisplay] = useState<DisplaySettings>(defaultDisplay);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const savedPharmacy = localStorage.getItem('pharmacy_settings');
      if (savedPharmacy) setPharmacy(JSON.parse(savedPharmacy));
      const savedDisplay = localStorage.getItem('display_settings');
      if (savedDisplay) setDisplay(JSON.parse(savedDisplay));
    } catch { /* silent */ }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem('pharmacy_settings', JSON.stringify(pharmacy));
      localStorage.setItem('display_settings', JSON.stringify(display));
      toast.success('Settings saved successfully');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      {/* Pharmacy Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" />
            Pharmacy Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Pharmacy Name</Label>
            <div className="relative mt-1">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={pharmacy.name}
                onChange={(e) => setPharmacy({ ...pharmacy, name: e.target.value })}
                className="pl-10"
              />
            </div>
          </div>
          <div>
            <Label>Address</Label>
            <div className="relative mt-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={pharmacy.address}
                onChange={(e) => setPharmacy({ ...pharmacy, address: e.target.value })}
                className="pl-10"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Phone</Label>
              <div className="relative mt-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={pharmacy.phone}
                  onChange={(e) => setPharmacy({ ...pharmacy, phone: e.target.value })}
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={pharmacy.email}
                  onChange={(e) => setPharmacy({ ...pharmacy, email: e.target.value })}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Tax Rate (%)</Label>
            <div className="relative mt-1">
              <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                step="0.1"
                value={pharmacy.taxRate}
                onChange={(e) => setPharmacy({ ...pharmacy, taxRate: Number(e.target.value) || 0 })}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Display Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Display Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Currency</Label>
            <Select value={display.currency} onValueChange={(v) => setDisplay({ ...display, currency: v })}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GHS">GHS - Ghana Cedi</SelectItem>
                <SelectItem value="USD">USD - US Dollar</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="GBP">GBP - British Pound</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date Format</Label>
            <Select value={display.dateFormat} onValueChange={(v) => setDisplay({ ...display, dateFormat: v })}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dd/MM/yyyy">DD/MM/YYYY</SelectItem>
                <SelectItem value="MM/dd/yyyy">MM/DD/YYYY</SelectItem>
                <SelectItem value="yyyy-MM-dd">YYYY-MM-DD</SelectItem>
                <SelectItem value="dd-MMM-yyyy">DD-MMM-YYYY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-8"
          onClick={handleSave}
          disabled={saving}
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}