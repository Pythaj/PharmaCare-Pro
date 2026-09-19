'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { Plus, Search, ChevronDown, ChevronRight, Trash2, Tag, TrendingUp, DollarSign, Pencil, ArrowRightLeft, CircleAlert, Percent, Calculator, Zap, Check, X, PackagePlus, Boxes, RefreshCcw, Package, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/use-permissions';
import type { Product, Batch, Category } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

function formatNum(value: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function calcMargin(cost: number, selling: number): number {
  if (!selling || selling <= 0) return 0;
  return ((selling - cost) / selling) * 100;
}

function calcMarkup(cost: number, selling: number): number {
  if (!cost || cost <= 0) return 0;
  return ((selling - cost) / cost) * 100;
}

function applyMarkup(cost: number, markupPct: number): number {
  return Math.round((cost * (1 + markupPct / 100)) * 100) / 100;
}

interface ProductWithStock extends Product {
  totalStock: number;
  batches: (Batch & { currentQty: number })[];
  earliestExpiry?: string | null;
  daysToExpiry?: number | null;
  hasExpiringBatches?: boolean;
  hasExpiredBatches?: boolean;
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
  expiryStatus?: 'good' | 'expiring_soon' | 'expired';
}

/** A batch row being edited inside the Edit Drug dialog. */
interface BatchEditRow {
  key: string;
  id?: string;
  batchNumber: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  expiryDate: string;
}

/** Converts a date (ISO string or Date) into a YYYY-MM-DD value for <input type="date">. */
function toDateInputValue(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Drug Auto-Detect Knowledge Base ───
// Maps a recognised drug (or keyword) to its therapeutic category, generic
// name and recommended unit. This powers the "Add Product" auto-detection so
// the right category + generic name are selected automatically as the owner
// types. Normalised keys (UPPER + no spaces/punctuation) are matched loosely.
// Curated from the pharmacy's standard catalogue categories.

interface DrugKnowledge {
  category: string;
  genericName: string;
  unit: string;
}

const DRUG_KNOWLEDGE: Record<string, DrugKnowledge> = {
  PARACETAMOL: { category: 'Analgesics', genericName: 'Acetaminophen', unit: 'pcs' },
  ACETAMINOPHEN: { category: 'Analgesics', genericName: 'Acetaminophen', unit: 'pcs' },
  IBUPROFEN: { category: 'Analgesics', genericName: 'Ibuprofen', unit: 'pcs' },
  DICLOFENAC: { category: 'Analgesics', genericName: 'Diclofenac', unit: 'tablets' },
  NAPROXEN: { category: 'Analgesics', genericName: 'Naproxen', unit: 'pcs' },
  ASPIRIN: { category: 'Analgesics', genericName: 'Acetylsalicylic acid', unit: 'pcs' },
  MORPHINE: { category: 'Analgesics', genericName: 'Morphine', unit: 'pcs' },
  TRAMADOL: { category: 'Analgesics', genericName: 'Tramadol', unit: 'tablets' },
  PREDNISOLONE: { category: 'Analgesics', genericName: 'Prednisolone', unit: 'pcs' },
  ARFEN: { category: 'Analgesics', genericName: 'Artenam/Paracetamol', unit: 'pcs' },
  PINOYCAM: { category: 'Analgesics', genericName: 'Piroxicam', unit: 'pcs' },
  LETACAM: { category: 'Analgesics', genericName: 'Antimalarial/analgesic', unit: 'pcs' },
  HYDROCORTISONE: { category: 'Analgesics', genericName: 'Hydrocortisone', unit: 'tablets' },
  INDOMETHACIN: { category: 'Analgesics', genericName: 'Indomethacin', unit: 'capsules' },

  AMOXICILLIN: { category: 'Antibiotics', genericName: 'Amoxicillin', unit: 'capsules' },
  AMPICILLIN: { category: 'Antibiotics', genericName: 'Ampicillin', unit: 'capsules' },
  AMOXYCLAV: { category: 'Antibiotics', genericName: 'Amoxicillin/Clavulanate', unit: 'capsules' },
  CEFUROXIME: { category: 'Antibiotics', genericName: 'Cefuroxime', unit: 'tablets' },
  CEFTRIAXONE: { category: 'Antibiotics', genericName: 'Ceftriaxone', unit: 'pcs' },
  CEFIXIME: { category: 'Antibiotics', genericName: 'Cefixime', unit: 'tablets' },
  CHLORAMPHENICOL: { category: 'Antibiotics', genericName: 'Chloramphenicol', unit: 'capsules' },
  CLOXACILLIN: { category: 'Antibiotics', genericName: 'Cloxacillin', unit: 'capsules' },
  COTRIMOXAZOLE: { category: 'Antibiotics', genericName: 'Co-trimoxazole', unit: 'tablets' },
  DOXYCYCLINE: { category: 'Antibiotics', genericName: 'Doxycycline', unit: 'capsules' },
  FLUCLOXACILLIN: { category: 'Antibiotics', genericName: 'Flucloxacillin', unit: 'capsules' },
  CIPROFLOXACIN: { category: 'Antibiotics', genericName: 'Ciprofloxacin', unit: 'tablets' },
  CIPRO: { category: 'Antibiotics', genericName: 'Ciprofloxacin', unit: 'tablets' },
  METRONIDAZOLE: { category: 'Antibiotics', genericName: 'Metronidazole', unit: 'tablets' },
  PENICILLIN: { category: 'Antibiotics', genericName: 'Penicillin V', unit: 'tablets' },
  TETRACYCLINE: { category: 'Antibiotics', genericName: 'Tetracycline', unit: 'capsules' },
  AZITHROMYCIN: { category: 'Antibiotics', genericName: 'Azithromycin', unit: 'tablets' },
  ERYTHROMYCIN: { category: 'Antibiotics', genericName: 'Erythromycin', unit: 'tablets' },
  ZYFLOXACIN: { category: 'Antibiotics', genericName: 'Ofloxacin', unit: 'tablets' },

  FLUCONAZOLE: { category: 'Antifungals', genericName: 'Fluconazole', unit: 'capsules' },
  GRISEOFULVIN: { category: 'Antifungals', genericName: 'Griseofulvin', unit: 'tablets' },
  KETOCONAZOLE: { category: 'Antifungals', genericName: 'Ketoconazole', unit: 'tablets' },
  NYSTATIN: { category: 'Antifungals', genericName: 'Nystatin', unit: 'pcs' },
  CLOTRIMAZOLE: { category: 'Antifungals', genericName: 'Clotrimazole', unit: 'tube' },

  ALBENDAZOLE: { category: 'Anthelmintics', genericName: 'Albendazole', unit: 'tablets' },
  MEBENDAZOLE: { category: 'Anthelmintics', genericName: 'Mebendazole', unit: 'tablets' },
  VERMOX: { category: 'Anthelmintics', genericName: 'Mebendazole', unit: 'tablets' },

  ARTEMETHER: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'tablets' },
  LUMEFANTRINE: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'tablets' },
  QUININE: { category: 'Antimalarials', genericName: 'Quinine', unit: 'tablets' },
  CHLOROQUINE: { category: 'Antimalarials', genericName: 'Chloroquine', unit: 'tablets' },
  LONGART: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'tablets' },
  LYART: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'tablets' },
  VIMOL: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'tablets' },
  ARJAN: { category: 'Antimalarials', genericName: 'Artemether/Lumefantrine', unit: 'bottle' },

  OMEPRAZOLE: { category: 'Gastrointestinal', genericName: 'Omeprazole', unit: 'capsules' },
  LANSOPRAZOLE: { category: 'Gastrointestinal', genericName: 'Lansoprazole', unit: 'capsules' },
  PANTOPRAZOLE: { category: 'Gastrointestinal', genericName: 'Pantoprazole', unit: 'tablets' },
  RANITIDINE: { category: 'Gastrointestinal', genericName: 'Ranitidine', unit: 'tablets' },
  ANTACID: { category: 'Gastrointestinal', genericName: 'Antacid', unit: 'tablets' },
  ENTERA: { category: 'Gastrointestinal', genericName: 'Enzyme supplement', unit: 'tablets' },
  SENNA: { category: 'Gastrointestinal', genericName: 'Senna', unit: 'bottle' },
  BUSCOPAN: { category: 'Gastrointestinal', genericName: 'Hyoscine butylbromide', unit: 'tablets' },

  ATS: { category: 'Injections', genericName: 'Tetanus antitoxin (ATS)', unit: 'units' },
  INJECTIONS: { category: 'Injections', genericName: 'Injectable medication', unit: 'units' },

  FAMILYPLANNING: { category: 'Hormonal & Reproductive Health', genericName: 'Contraceptive (family planning)', unit: 'pack' },
  FAMILY: { category: 'Hormonal & Reproductive Health', genericName: 'Contraceptive (family planning)', unit: 'pack' },

  METFORMIN: { category: 'Cardiovascular', genericName: 'Metformin', unit: 'tablets' },
  NIFEDIPINE: { category: 'Cardiovascular', genericName: 'Nifedipine', unit: 'tablets' },
  NETIDIPINE: { category: 'Cardiovascular', genericName: 'Nifedipine', unit: 'tablets' },
  AMLODIPINE: { category: 'Cardiovascular', genericName: 'Amlodipine', unit: 'tablets' },
  ATENOLOL: { category: 'Cardiovascular', genericName: 'Atenolol', unit: 'tablets' },
  LISINOPRIL: { category: 'Cardiovascular', genericName: 'Lisinopril', unit: 'tablets' },
  ATORVASTATIN: { category: 'Cardiovascular', genericName: 'Atorvastatin', unit: 'tablets' },
  ENAPROST: { category: 'Cardiovascular', genericName: 'Enalapril', unit: 'tablets' },

  VITAMIN: { category: 'Vitamins & Supplements', genericName: 'Multivitamin', unit: 'tablets' },
  MULTIVITAMIN: { category: 'Vitamins & Supplements', genericName: 'Multivitamin', unit: 'tablets' },
  ABYLITE: { category: 'Vitamins & Supplements', genericName: 'Multivitamin', unit: 'tablets' },
  FOLIC: { category: 'Vitamins & Supplements', genericName: 'Folic acid', unit: 'tablets' },
  IRON: { category: 'Vitamins & Supplements', genericName: 'Iron supplement', unit: 'tablets' },
  CALCIUM: { category: 'Vitamins & Supplements', genericName: 'Calcium supplement', unit: 'tablets' },
  ZINC: { category: 'Vitamins & Supplements', genericName: 'Zinc supplement', unit: 'tablets' },
  APETAMIN: { category: 'Vitamins & Supplements', genericName: 'Multivitamin', unit: 'tablets' },
  POLYFER: { category: 'Vitamins & Supplements', genericName: 'Iron/folate syrup', unit: 'syrup' },
  RONAC: { category: 'Vitamins & Supplements', genericName: 'Multivitamin', unit: 'capsules' },
  BEECROFT: { category: 'Vitamins & Supplements', genericName: 'Multivitamin tonic', unit: 'bottle' },
  BONGPLEX: { category: 'Vitamins & Supplements', genericName: 'Vitamin B complex', unit: 'bottle' },

  SALBUTAMOL: { category: 'Respiratory', genericName: 'Salbutamol', unit: 'bottle' },
  BRONCHOLIN: { category: 'Respiratory', genericName: 'Bronchodilator', unit: 'bottle' },
  EPHEDRINE: { category: 'Respiratory', genericName: 'Ephedrine', unit: 'bottle' },
  LINCTUS: { category: 'Respiratory', genericName: 'Cough linctus', unit: 'bottle' },
  SAMALIN: { category: 'Respiratory', genericName: 'Cough syrup', unit: 'bottle' },
  BILNCTUS: { category: 'Respiratory', genericName: 'Cough syrup', unit: 'bottle' },
  COUGH: { category: 'Respiratory', genericName: 'Cough syrup', unit: 'bottle' },
  KOFFEE: { category: 'Respiratory', genericName: 'Cough syrup', unit: 'bottle' },

  PRETERM: { category: 'Hormonal & Reproductive Health', genericName: 'Hormonal contraceptive', unit: 'tablets' },
  POSTINOR: { category: 'Hormonal & Reproductive Health', genericName: 'Levonorgestrel', unit: 'tablets' },
  LEVON: { category: 'Hormonal & Reproductive Health', genericName: 'Levonorgestrel', unit: 'tablets' },
  LEVONORGESTREL: { category: 'Hormonal & Reproductive Health', genericName: 'Levonorgestrel', unit: 'tablets' },
  EMERGENCY: { category: 'Hormonal & Reproductive Health', genericName: 'Levonorgestrel', unit: 'tablets' },

  HYDROCORTISONE_CREAM: { category: 'Skin Care', genericName: 'Hydrocortisone', unit: 'tube' },
  CREAM: { category: 'Skin Care', genericName: 'Skin care cream', unit: 'tube' },
  OINTMENT: { category: 'Skin Care', genericName: 'Skin ointment', unit: 'tube' },
  OINT: { category: 'Skin Care', genericName: 'Skin ointment', unit: 'tube' },
  BALM: { category: 'Skin Care', genericName: 'Analgesic balm', unit: 'tube' },
  GENTIAN: { category: 'Skin Care', genericName: 'Gentian violet', unit: 'bottle' },
  DERMON: { category: 'Skin Care', genericName: 'Skin care lotion', unit: 'tube' },
  GRINSTMENT: { category: 'Skin Care', genericName: 'Skin ointment', unit: 'tube' },

  HERBAL: { category: 'Herbal Remedies', genericName: 'Herbal preparation', unit: 'bottle' },
  MIXTURE: { category: 'Herbal Remedies', genericName: 'Herbal preparation', unit: 'bottle' },
  ABONKYI: { category: 'Herbal Remedies', genericName: 'Herbal tonic', unit: 'bottle' },

  BANDAGE: { category: 'Medical Supplies', genericName: 'Bandage', unit: 'roll' },
  GAUZE: { category: 'Medical Supplies', genericName: 'Gauze', unit: 'roll' },
  PLASTER: { category: 'Medical Supplies', genericName: 'Plaster', unit: 'roll' },
  SYRINGE: { category: 'Medical Supplies', genericName: 'Syringe', unit: 'pcs' },
  GLOVES: { category: 'Medical Supplies', genericName: 'Disposable gloves', unit: 'box' },
  ELASTIC: { category: 'Medical Supplies', genericName: 'Elastic bandage', unit: 'roll' },
  PREGNANCY: { category: 'Medical Supplies', genericName: 'Pregnancy test kit', unit: 'pack' },
  ENVELOPE: { category: 'Medical Supplies', genericName: 'Envelope', unit: 'pack' },
  PAD: { category: 'Medical Supplies', genericName: 'Sanitary pad', unit: 'pack' },

  EYEDROP: { category: 'Eye Care', genericName: 'Eye drops', unit: 'bottle' },
  EYEDROPS: { category: 'Eye Care', genericName: 'Eye drops', unit: 'bottle' },
  EYE: { category: 'Eye Care', genericName: 'Eye drops', unit: 'bottle' },
  MOUTHWASH: { category: 'Oral Care', genericName: 'Mouthwash', unit: 'bottle' },
  MOUTH: { category: 'Oral Care', genericName: 'Mouthwash', unit: 'bottle' },
};

/** Normalise a name for fuzzy matching: UPPER + strip everything non-alphanumeric. */
function normalizeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ─── Premium Margin Badge ───
function MarginBadge({ cost, selling }: { cost: number; selling: number }) {
  const margin = calcMargin(cost, selling);
  const markup = calcMarkup(cost, selling);

  if (cost === 0 && selling === 0) {
    return <span className="text-slate-400 text-xs">Not set</span>;
  }
  if (selling === 0) {
    return <span className="text-slate-400 text-xs">No price</span>;
  }

  const isProfit = margin > 0;
  const isLoss = margin < 0;

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[11px] font-bold tabular-nums ${
        isProfit ? 'text-emerald-600' : isLoss ? 'text-red-500' : 'text-slate-500'
      }`}>
        {isProfit ? '+' : ''}{margin.toFixed(1)}% margin
      </span>
      <span className="text-[9px] text-slate-400 tabular-nums">
        {markup.toFixed(0)}% markup
      </span>
    </div>
  );
}

// ─── Premium Markup Calculator ───
function MarkupCalculator({
  costPrice,
  sellingPrice,
  onCostChange,
  onSellingChange,
}: {
  costPrice: number;
  sellingPrice: number;
  onCostChange: (v: number) => void;
  onSellingChange: (v: number) => void;
}) {
  const [markupInput, setMarkupInput] = useState('');
  const [activePreset, setActivePreset] = useState<number | null>(null);

  const presets = [
    { label: '25%', value: 25 },
    { label: '30%', value: 30 },
    { label: '50%', value: 50 },
    { label: '75%', value: 75 },
    { label: '100%', value: 100 },
    { label: '150%', value: 150 },
  ];

  const handleApplyMarkup = (pct: number) => {
    if (costPrice <= 0) {
      toast.error('Set cost price first');
      return;
    }
    const newSelling = applyMarkup(costPrice, pct);
    onSellingChange(newSelling);
    setMarkupInput(String(pct));
    setActivePreset(pct);
  };

  const handleCustomMarkup = () => {
    const pct = parseFloat(markupInput);
    if (isNaN(pct) || pct < 0) return;
    handleApplyMarkup(pct);
  };

  const profit = sellingPrice - costPrice;
  const margin = calcMargin(costPrice, sellingPrice);
  const markup = calcMarkup(costPrice, sellingPrice);

  return (
    <div className="space-y-3">
      {/* Preset markup buttons */}
      <div>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5 block">
          Quick Markup
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleApplyMarkup(p.value)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all ${
                activePreset === p.value
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom markup */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-[11px] text-slate-500">Custom %</Label>
          <div className="relative mt-1">
            <Input
              type="number"
              placeholder="e.g. 40"
              value={markupInput}
              onChange={(e) => { setMarkupInput(e.target.value); setActivePreset(null); }}
              className="pr-7 h-9 text-sm bg-white/70 border-emerald-200/50"
              onKeyDown={(e) => e.key === 'Enter' && handleCustomMarkup()}
            />
            <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 px-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          onClick={handleCustomMarkup}
        >
          Apply
        </Button>
      </div>

      {/* Live stats */}
      {(costPrice > 0 || sellingPrice > 0) && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Profit</p>
            <p className={`text-sm font-bold tabular-nums mt-0.5 ${profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-red-500' : 'text-slate-500'}`}>
              {formatGHS(profit)}
            </p>
          </div>
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Margin</p>
            <p className={`text-sm font-bold tabular-nums mt-0.5 ${margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-red-500' : 'text-slate-500'}`}>
              {margin.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Markup</p>
            <p className="text-sm font-bold tabular-nums mt-0.5 text-slate-700">
              {markup.toFixed(0)}%
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Quick Price Popover ───
function InlinePriceEditor({
  product,
  onUpdated,
}: {
  product: ProductWithStock;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [costPrice, setCostPrice] = useState(product.defaultCostPrice ?? 0);
  const [sellingPrice, setSellingPrice] = useState(product.defaultSellingPrice ?? 0);
  const [applyToBatches, setApplyToBatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markupInput, setMarkupInput] = useState('');

  useEffect(() => {
    if (open) {
      setCostPrice(product.defaultCostPrice ?? 0);
      setSellingPrice(product.defaultSellingPrice ?? 0);
      setApplyToBatches(false);
      setMarkupInput('');
    }
  }, [open, product]);

  const handleQuickSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${product.id}/update-prices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCostPrice: costPrice, defaultSellingPrice: sellingPrice, applyToBatches }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update');
      }
      toast.success(`Price updated for "${product.name}"`);
      setOpen(false);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickMarkup = () => {
    const pct = parseFloat(markupInput);
    if (isNaN(pct) || pct < 0 || costPrice <= 0) return;
    setSellingPrice(applyMarkup(costPrice, pct));
  };

  const profit = sellingPrice - costPrice;
  const margin = calcMargin(costPrice, sellingPrice);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="group inline-flex items-center gap-1.5 font-bold text-emerald-700 hover:text-emerald-800 transition-colors rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-emerald-50/80"
          onClick={(e) => e.stopPropagation()}
        >
          {product.defaultSellingPrice > 0 ? formatGHS(product.defaultSellingPrice) : <span className="text-amber-500 font-medium text-xs">Set Price</span>}
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0 gap-0" align="start" side="bottom" sideOffset={4}>
        <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <p className="font-semibold text-xs text-slate-800 truncate">{product.name}</p>
          <p className="text-[10px] text-slate-400">Quick Price Editor</p>
        </div>
        <div className="p-3.5 space-y-3">
          {/* Price inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Cost Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice || ''}
                onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
                className="mt-1 h-8 text-sm bg-white border-slate-200 font-mono"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Selling Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice || ''}
                onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                className="mt-1 h-8 text-sm bg-white border-emerald-200 font-mono font-semibold text-emerald-700 focus-visible:ring-emerald-300/50"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick markup row */}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              placeholder="%"
              value={markupInput}
              onChange={(e) => setMarkupInput(e.target.value)}
              className="h-7 w-16 text-[11px] text-center bg-slate-50 border-slate-200"
              onKeyDown={(e) => e.key === 'Enter' && handleQuickMarkup()}
            />
            <Percent className="h-3 w-3 text-slate-400 -ml-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 ml-1"
              onClick={handleQuickMarkup}
            >
              <Calculator className="h-3 w-3 mr-1" />
              Apply Markup
            </Button>
          </div>

          {/* Live profit preview */}
          {(costPrice > 0 || sellingPrice > 0) && (
            <div className={`flex items-center justify-between rounded-lg px-2.5 py-2 border ${
              profit > 0 ? 'bg-emerald-50/80 border-emerald-200/60' : profit < 0 ? 'bg-red-50/80 border-red-200/60' : 'bg-slate-50 border-slate-200'
            }`}>
              <span className="text-[10px] text-slate-500">Profit per unit</span>
              <span className={`text-xs font-bold tabular-nums ${profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {formatGHS(profit)} · {margin.toFixed(1)}% margin
              </span>
            </div>
          )}

          {/* Apply to batches */}
          {(product._count?.batches ?? 0) > 0 && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <Switch checked={applyToBatches} onCheckedChange={setApplyToBatches} className="scale-90" />
              <span className="text-[11px] text-slate-500 group-hover:text-slate-700 transition-colors">
                Also update <span className="font-semibold text-slate-700">{product._count?.batches}</span> batch{((product._count?.batches ?? 0) !== 1) ? 'es' : ''}
              </span>
            </label>
          )}

          {/* Save */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleQuickSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : <><Check className="h-3 w-3 mr-1" /> Save Price</>}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════════
// ─── MAIN COMPONENT ───
// ═══════════════════════════════════════════════

export default function ProductsView() {
  const { canManageProducts } = usePermissions();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    genericName: '',
    categoryId: '',
    unit: 'pcs',
    reorderLevel: 10,
    defaultCostPrice: 0,
    defaultSellingPrice: 0,
  });
  // Track an auto-detected category/generic so we can show a clear "auto-filled"
  // affordance without clobbering deliberate edits by the owner.
  const [addAutoDetected, setAddAutoDetected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProductWithStock | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showIncludedInactive, setShowIncludedInactive] = useState(false);
  const includeInactiveRef = useRef(false);

  // Edit Price dialog state
  const [showEditPriceDialog, setShowEditPriceDialog] = useState(false);
  const [editPriceProduct, setEditPriceProduct] = useState<ProductWithStock | null>(null);
  const [editCostPrice, setEditCostPrice] = useState(0);
  const [editSellingPrice, setEditSellingPrice] = useState(0);
  const [editApplyToBatches, setEditApplyToBatches] = useState(false);
  const [updatingPrice, setUpdatingPrice] = useState(false);

  // Edit Drug dialog state — full product + batch/stock management
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductWithStock | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    genericName: '',
    categoryId: '',
    unit: 'pcs',
    reorderLevel: 10,
  });
  const [editBatches, setEditBatches] = useState<BatchEditRow[]>([]);
  const [editBatchesOriginal, setEditBatchesOriginal] = useState<BatchEditRow[]>([]);
  const [editActiveBatchKey, setEditActiveBatchKey] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Memoized product name → product lookup for O(1) exact matches
  const productNameMap = useMemo(() => {
    const map = new Map<string, ProductWithStock>();
    for (const p of products) {
      const key = p.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [products]);

  // Debounced auto-detect: only runs after user pauses typing (150ms)
  const detectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectDrugInfo = useCallback((name: string) => {
    const key = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) return null;

    // 1) Exact DB match via Map (O(1))
    const dbHit = productNameMap.get(key);
    if (dbHit) {
      return {
        categoryId: dbHit.categoryId ?? '',
        genericName: dbHit.genericName ?? '',
        unit: dbHit.unit || 'pcs',
      };
    }

    // 2) Knowledge base prefix match
    for (let len = key.length; len >= 3; len--) {
      const sub = key.slice(0, len);
      const hit = DRUG_KNOWLEDGE[sub];
      if (hit) {
        const cat = categories.find((c) => c.name === hit.category);
        return {
          categoryId: cat?.id ?? '',
          genericName: hit.genericName,
          unit: hit.unit,
        };
      }
    }
    return null;
  }, [productNameMap, categories]);

  const debouncedDetect = useCallback((name: string, cb: (res: ReturnType<typeof detectDrugInfo>) => void) => {
    if (detectRef.current) clearTimeout(detectRef.current);
    detectRef.current = setTimeout(() => cb(detectDrugInfo(name)), 150);
  }, [detectDrugInfo]);

  // Fetches the full catalog (optionally including deactivated products) once;
  // search + category filtering happen client-side so typing never re-queries
  // the server. Callers may pass the old (query, category) args — they are
  // ignored by design.
  const fetchProducts = useCallback(async (_query?: string, _cat?: string) => {
    try {
      const url = includeInactiveRef.current ? '/api/products?includeInactive=true' : '/api/products';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [prodRes, catRes] = await Promise.all([
          fetch('/api/products'),
          fetch('/api/categories'),
        ]);
        if (prodRes.ok) {
          const data = await prodRes.json();
          setProducts(data.products ?? []);
        }
        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data.categories ?? []);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, []);

  const handleToggleInactive = (value: boolean) => {
    setShowIncludedInactive(value);
    includeInactiveRef.current = value;
    fetchProducts();
  };

  const handleSearch = (value: string) => {
    setSearch(value);
  };

  const handleCategoryChange = (value: string) => {
    setCategoryFilter(value);
  };

  // Client-side filtering mirrors the server's /api/products contract:
  // case-insensitive search across name/generic/description/category/batch
  // numbers, exact category match and the active flag when "Deactivated"
  // is not toggled.
  const visibleProducts = useMemo(() => {
    let list = showIncludedInactive ? products : products.filter((p) => p.active);
    if (categoryFilter && categoryFilter !== 'all') {
      list = list.filter((p) => p.categoryId === categoryFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const haystack = [
          p.name,
          p.genericName,
          p.description,
          p.category?.name,
          ...(p.batches ?? []).map((b) => b.batchNumber),
        ];
        return haystack.some((field) => field && field.toLowerCase().includes(q));
      });
    }
    return list;
  }, [products, search, categoryFilter, showIncludedInactive]);

  const getProductStatusBadges = (product: ProductWithStock) => {
    const badges: { label: string; className: string }[] = [];

    if (product.totalStock === 0) {
      badges.push({ label: 'Out of Stock', className: 'bg-red-500 text-white hover:bg-red-500' });
    } else if (product.totalStock <= product.reorderLevel) {
      badges.push({ label: 'Low Stock', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-300' });
    }

    if (product.hasExpiredBatches) {
      badges.push({ label: 'Expired Batch', className: 'bg-red-100 text-red-700 hover:bg-red-100' });
    } else if (product.hasExpiringBatches) {
      badges.push({ label: 'Expiring Soon', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-300' });
    }

    if (badges.length === 0) {
      badges.push({ label: 'In Stock', className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-300' });
    }

    return badges;
  };

  const isAlertProduct = (product: ProductWithStock) => {
    return product.stockStatus !== 'in_stock' || product.hasExpiredBatches || product.hasExpiringBatches;
  };

  // ─── Auto-detect category + generic name from the typed product name ───
  const handleAddNameChange = (value: string) => {
    setAddForm((cur) => ({ ...cur, name: value }));

    debouncedDetect(value, (suggestion) => {
      if (!suggestion) return;
      setAddForm((cur) => ({
        ...cur,
        categoryId: cur.categoryId || suggestion.categoryId || '',
        genericName: cur.genericName.trim()
          ? cur.genericName
          : (suggestion.genericName ?? ''),
        unit: cur.unit === 'pcs'
          ? (suggestion.unit ?? cur.unit)
          : cur.unit,
      }));
      const isNewInput = !addForm.categoryId && !addForm.genericName.trim();
      setAddAutoDetected(Boolean(suggestion) && value.trim().length > 0 && isNewInput);
    });
  };

  const handleAddProduct = async () => {
    if (!addForm.name.trim()) { toast.error('Product name is required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add product');
      }
      toast.success(`"${addForm.name}" added with price ${formatGHS(addForm.defaultSellingPrice)}`);
      setShowAddDialog(false);
      setAddAutoDetected(false);
      setAddForm({
        name: '',
        genericName: '',
        categoryId: '',
        unit: 'pcs',
        reorderLevel: 10,
        defaultCostPrice: 0,
        defaultSellingPrice: 0,
      });
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add product');
    } finally {
      setSubmitting(false);
    }
  };

  const [batches, setBatches] = useState<(Batch & { currentQty: number })[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const handleExpandRow = async (productId: string) => {
    if (expandedRow === productId) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(productId);
    setLoadingBatches(true);
    try {
      const res = await fetch(`/api/products/${productId}`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches ?? []);
      }
    } catch { /* silent */ }
    setLoadingBatches(false);
  };

  const handleDeleteProduct = async (permanent = false) => {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/products/${productToDelete.id}${permanent ? '?permanent=true' : ''}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove product');
      }
      const data = await res.json().catch(() => ({}));
      toast.success(data.message || `Product "${productToDelete.name}" ${permanent ? 'permanently deleted' : 'deactivated'}`);
      setShowDeleteDialog(false);
      setProductToDelete(null);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error('Could not delete product', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreProduct = async (product: ProductWithStock) => {
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to restore product');
      }
      toast.success(`"${product.name}" restored to inventory`);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error('Restore failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  };

  // ---- Edit Price handlers ----
  const openEditPriceDialog = (product: ProductWithStock) => {
    setEditPriceProduct(product);
    setEditCostPrice(product.defaultCostPrice ?? 0);
    setEditSellingPrice(product.defaultSellingPrice ?? 0);
    setEditApplyToBatches(false);
    setShowEditPriceDialog(true);
  };

  const handleUpdatePrice = async () => {
    if (!editPriceProduct) return;
    setUpdatingPrice(true);
    try {
      const res = await fetch(`/api/products/${editPriceProduct.id}/update-prices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCostPrice: editCostPrice,
          defaultSellingPrice: editSellingPrice,
          applyToBatches: editApplyToBatches,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update prices');
      }
      const data = await res.json();
      toast.success(data.message || `Prices updated for "${editPriceProduct.name}"`);
      setShowEditPriceDialog(false);
      setEditPriceProduct(null);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update prices');
    } finally {
      setUpdatingPrice(false);
    }
  };

  // ---- Edit Drug handlers (product info + batch/stock) ----
  const openEditDialog = async (product: ProductWithStock) => {
    setEditProduct(product);
    setEditForm({
      name: product.name,
      genericName: product.genericName ?? '',
      categoryId: product.categoryId ?? '',
      unit: product.unit,
      reorderLevel: product.reorderLevel,
    });
    setEditBatches([]);
    setEditBatchesOriginal([]);
    setEditActiveBatchKey('');
    setShowEditDialog(true);

    try {
      const res = await fetch(`/api/products/${product.id}`);
      if (res.ok) {
        const data = await res.json();
        const rows: BatchEditRow[] = (Array.isArray(data.batches) ? data.batches : []).map(
          (b: Batch & { currentQty?: number }, i: number) => ({
            key: `existing-${b.id ?? i}`,
            id: b.id,
            batchNumber: b.batchNumber,
            quantity: Number(b.quantity) || 0,
            costPrice: Number(b.costPrice) || 0,
            sellingPrice: Number(b.sellingPrice) || 0,
            expiryDate: toDateInputValue(b.expiryDate),
          })
        );
        setEditBatches(rows);
        setEditBatchesOriginal(rows);
        if (rows.length > 0) setEditActiveBatchKey(rows[0].key);
      }
    } catch { /* silent */ }
  };

  const updateBatchRow = (key: string, patch: Partial<BatchEditRow>) => {
    setEditBatches((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addBatchRow = () => {
    const exp = new Date();
    exp.setMonth(exp.getMonth() + 24);
    const row: BatchEditRow = {
      key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      batchNumber: `BATCH-${String(editBatches.length + 1).padStart(3, '0')}`,
      quantity: 0,
      costPrice: 0,
      sellingPrice: 0,
      expiryDate: toDateInputValue(exp),
    };
    setEditBatches((prev) => [...prev, row]);
    setEditActiveBatchKey(row.key);
  };

  const removeBatchRow = (key: string) => {
    setEditBatches((prev) => {
      const next = prev.filter((r) => r.key !== key);
      setEditActiveBatchKey((active) =>
        active === key ? (next.length > 0 ? next[0].key : '') : active
      );
      return next;
    });
  };

  const handleSaveEdit = async () => {
    if (!editProduct) return;
    if (!editForm.name.trim()) { toast.error('Product name is required'); return; }

    const activeBatch = editBatches.find((r) => r.key === editActiveBatchKey);

    if (editBatches.length === 0) {
      toast.error('Add at least one stock batch for this drug before saving.');
      return;
    }
    if (activeBatch?.quantity != null && Number(activeBatch.quantity) < 0) {
      toast.error('Stock quantity cannot be negative.');
      return;
    }
    if (!activeBatch?.batchNumber.trim()) {
      toast.info('Leave batch number blank to auto-generate one.');
    }

    setSavingEdit(true);
    const errors: string[] = [];
    try {
      // 1) Update the product's core information
      const prodRes = await fetch(`/api/products/${editProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          genericName: editForm.genericName || null,
          categoryId: editForm.categoryId || null,
          unit: editForm.unit,
          reorderLevel: editForm.reorderLevel,
        }),
      });
      if (!prodRes.ok) {
        const data = await prodRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update product');
      }

      // 2) Delete batches that were removed from the list
      const originalIds = new Set(editBatchesOriginal.map((r) => r.id).filter(Boolean));
      const currentIds = new Set(editBatches.map((r) => r.id).filter(Boolean));
      for (const id of originalIds) {
        if (!currentIds.has(id)) {
          const res = await fetch(`/api/batches/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            errors.push(data.error || 'Failed to delete a batch');
          }
        }
      }

      // 3) Update existing batches and create new ones
      for (const row of editBatches) {
        const payload = {
          batchNumber: row.batchNumber.trim(),
          quantity: Number(row.quantity) || 0,
          costPrice: Number(row.costPrice) || 0,
          sellingPrice: Number(row.sellingPrice) || 0,
          expiryDate: row.expiryDate,
        };

        if (row.id) {
          const res = await fetch(`/api/batches/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            errors.push(data.error || `Failed to update batch ${row.batchNumber}`);
          }
        } else {
          const res = await fetch('/api/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: editProduct.id, ...payload }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            errors.push(data.error || `Failed to create batch ${row.batchNumber}`);
          }
        }
      }

      if (errors.length > 0) {
        toast.warning(`${errors.length} issue(s) saving — review the batches below. First issue: ${errors[0]}`);
      } else {
        toast.success(`"${editForm.name.trim()}" updated successfully`);
      }
      setShowEditDialog(false);
      setEditProduct(null);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update product');
    } finally {
      setSavingEdit(false);
    }
  };

  // Price stats
  const productsWithPrice = products.filter(p => p.defaultSellingPrice > 0).length;
  const productsWithoutPrice = products.length - productsWithPrice;

  // Number of columns
  const totalCols = canManageProducts ? 11 : 10;

  return (
    <div className="space-y-4 p-6">

      {/* ─── Header Bar ─── */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-3 items-center">
          <Select value={categoryFilter} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className={`h-9 gap-1.5 text-xs ${showIncludedInactive ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'text-slate-500'}`}
            onClick={() => handleToggleInactive(!showIncludedInactive)}
            title="Show products that were deactivated"
          >
            <Boxes className="h-3.5 w-3.5" />
            Deactivated
          </Button>
          {canManageProducts && (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setShowAddDialog(true); setAddAutoDetected(false); }}>
              <Plus className="h-4 w-4 mr-1" />
              Add Product
            </Button>
          )}
        </div>
      </div>

      {/* ─── Price Summary Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-slate-200/80">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-slate-500" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total Products</p>
                <p className="text-lg font-bold text-slate-800 tabular-nums">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/60 bg-emerald-50/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Tag className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-emerald-600/70 uppercase tracking-wider">Priced</p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">{productsWithPrice}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {productsWithoutPrice > 0 && (
          <Card className="border-amber-200/60 bg-amber-50/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <CircleAlert className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-[10px] text-amber-600/70 uppercase tracking-wider">No Price</p>
                  <p className="text-lg font-bold text-amber-700 tabular-nums">{productsWithoutPrice}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="border-slate-200/80">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Avg Margin</p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">
                  {productsWithPrice > 0
                    ? (products.filter(p => p.defaultSellingPrice > 0).reduce((sum, p) => sum + calcMargin(p.defaultCostPrice, p.defaultSellingPrice), 0) / productsWithPrice).toFixed(1) + '%'
                    : '—'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Products Table ─── */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Cost Price</TableHead>
                  <TableHead className="text-right">Selling Price</TableHead>
                  <TableHead className="text-center hidden md:table-cell">Margin</TableHead>
                  <TableHead className="hidden md:table-cell">Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageProducts && <TableHead className="w-20 text-center">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      {canManageProducts && <TableCell><Skeleton className="h-4 w-20 mx-auto" /></TableCell>}
                    </TableRow>
                  ))
                ) : visibleProducts.length > 0 ? (
                  visibleProducts.map((product, index) => {
                    const badges = getProductStatusBadges(product);
                    const hasAlert = isAlertProduct(product);
                    const isExpanded = expandedRow === product.id;
                    const rowKey = product.id || `product-${index}`;
                    return (
                      <Fragment key={rowKey}>
                        <TableRow
                          className={`cursor-pointer hover:bg-muted/50 ${
                            hasAlert
                              ? product.totalStock === 0
                                ? 'bg-red-50/40'
                                : product.hasExpiredBatches
                                  ? 'bg-red-50/20'
                                  : 'bg-amber-50/20'
                              : ''
                          }`}
                          onClick={() => handleExpandRow(rowKey)}
                        >
                          <TableCell>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">{product.name}</span>
                              {product.genericName && (
                                <span className="text-[11px] text-muted-foreground">{product.genericName}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] px-1.5">{product.category?.name ?? '—'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono font-semibold text-sm ${
                              product.totalStock === 0 ? 'text-red-600' :
                              product.totalStock <= product.reorderLevel ? 'text-amber-600' :
                              'text-slate-900'
                            }`}>
                              {product.totalStock}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-0.5">{product.unit}</span>
                          </TableCell>
                          <TableCell className="text-right hidden md:table-cell">
                            {product.defaultCostPrice > 0 ? (
                              <span className="text-xs text-slate-500 font-mono">{formatGHS(product.defaultCostPrice)}</span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canManageProducts ? (
                              <InlinePriceEditor
                                product={product}
                                onUpdated={() => fetchProducts(search, categoryFilter)}
                              />
                            ) : (
                              product.defaultSellingPrice > 0 ? (
                                <span className="font-bold text-emerald-700 text-sm">{formatGHS(product.defaultSellingPrice)}</span>
                              ) : (
                                <span className="text-amber-500 font-medium text-xs">Not set</span>
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-center hidden md:table-cell">
                            <MarginBadge cost={product.defaultCostPrice} selling={product.defaultSellingPrice} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {product.earliestExpiry ? (
                              <div className="flex items-center gap-1">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  product.daysToExpiry !== null && product.daysToExpiry < 0 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 30 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 90 ? 'bg-amber-500' :
                                  'bg-emerald-500'
                                }`} />
                                <span className="text-[11px]">{new Date(product.earliestExpiry).toLocaleDateString('en-GH')}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {badges.map((b) => (
                                <Badge
                                  key={b.label}
                                  variant="outline"
                                  className={`text-[10px] px-1.5 py-0 h-5 ${b.className}`}
                                >
                                  {b.label}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          {canManageProducts && (
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={(e) => { e.stopPropagation(); openEditDialog(product); }}
                                  title="Edit Drug — info, stock, prices & expiry"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={(e) => { e.stopPropagation(); openEditPriceDialog(product); }}
                                  title="Edit Price"
                                >
                                  <Tag className="h-4 w-4" />
                                </Button>
                                {product.active === false ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                    onClick={(e) => { e.stopPropagation(); handleRestoreProduct(product); }}
                                    title="Restore this product to inventory"
                                  >
                                    <RefreshCcw className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                    onClick={(e) => { e.stopPropagation(); setProductToDelete(product); setShowDeleteDialog(true); }}
                                    title="Remove Product"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${rowKey}-batches`}>
                            <TableCell colSpan={totalCols} className="bg-muted/30 px-8 py-3">
                              {loadingBatches ? (
                                <div className="space-y-2">
                                  {Array.from({ length: 2 }).map((_, i) => (
                                    <Skeleton key={`batch-skel-${i}`} className="h-10 w-full" />
                                  ))}
                                </div>
                              ) : batches.length > 0 ? (
                                <div className="text-sm">
                                  <p className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                    Batches for {product.name}
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-dotted">
                                          <th className="text-left py-1.5 font-medium text-muted-foreground">Batch#</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Qty</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Cost Price</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Selling Price</th>
                                          <th className="text-center py-1.5 font-medium text-muted-foreground">Margin</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Expiry Date</th>
                                          <th className="text-center py-1.5 font-medium text-muted-foreground">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {batches.map((batch) => {
                                          const now = new Date();
                                          const expiry = new Date(batch.expiryDate);
                                          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                          const isExpired = diffDays < 0;
                                          const isExpiringSoon = !isExpired && diffDays < 90;
                                          const isDepleted = batch.currentQty <= 0;

                                          let statusLabel: string;
                                          let statusClass: string;
                                          let dotColor: string;

                                          if (isDepleted) {
                                            statusLabel = 'Depleted';
                                            statusClass = 'bg-slate-100 text-slate-500';
                                            dotColor = 'bg-slate-400';
                                          } else if (isExpired) {
                                            statusLabel = 'Expired';
                                            statusClass = 'bg-red-100 text-red-700';
                                            dotColor = 'bg-red-500';
                                          } else if (isExpiringSoon) {
                                            statusLabel = diffDays < 30 ? `${diffDays}d left` : 'Expiring Soon';
                                            statusClass = diffDays < 30
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-amber-100 text-amber-700';
                                            dotColor = diffDays < 30 ? 'bg-red-500' : 'bg-amber-500';
                                          } else {
                                            statusLabel = 'Good';
                                            statusClass = 'bg-emerald-100 text-emerald-700';
                                            dotColor = 'bg-emerald-500';
                                          }

                                          const batchMargin = calcMargin(batch.costPrice, batch.sellingPrice);

                                          return (
                                            <tr key={batch.id || `batch-${batch.batchNumber}`} className={`border-b border-dotted ${isExpired ? 'bg-red-50/40' : ''}`}>
                                              <td className="py-1.5 font-mono">{batch.batchNumber}</td>
                                              <td className="text-right font-mono font-medium">{batch.currentQty}</td>
                                              <td className="text-right font-mono">{formatGHS(batch.costPrice)}</td>
                                              <td className="text-right font-mono font-semibold text-emerald-700">{formatGHS(batch.sellingPrice)}</td>
                                              <td className="text-center">
                                                <span className={`text-[10px] font-semibold tabular-nums ${
                                                  batchMargin > 0 ? 'text-emerald-600' : batchMargin < 0 ? 'text-red-500' : 'text-slate-400'
                                                }`}>
                                                  {batchMargin > 0 ? '+' : ''}{batchMargin.toFixed(1)}%
                                                </span>
                                              </td>
                                              <td className="text-right">
                                                <span className={isExpired ? 'text-red-600 font-medium' : ''}>
                                                  {new Date(batch.expiryDate).toLocaleDateString('en-GH')}
                                                </span>
                                              </td>
                                              <td className="text-center">
                                                <Badge className={`text-[10px] px-1.5 py-0 h-5 ${statusClass}`}>
                                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} mr-1`} />
                                                  {statusLabel}
                                                </Badge>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  {canManageProducts && batches.length > 0 && (
                                    <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
                                      <Tag className="h-3 w-3" />
                                      To update batch prices, click the <span className="font-medium text-emerald-600">selling price</span> above or use the <span className="font-medium text-emerald-600">Edit Price</span> button with <span className="font-medium">&quot;Apply to batches&quot;</span>.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">No batches found</p>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={totalCols} className="text-center text-muted-foreground py-12">
                      No products found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── ADD PRODUCT DIALOG (Premium with Pricing) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={showAddDialog} onOpenChange={(open) => {
        if (!open) {
          setAddForm({
            name: '',
            genericName: '',
            categoryId: '',
            unit: 'pcs',
            reorderLevel: 10,
            defaultCostPrice: 0,
            defaultSellingPrice: 0,
          });
          setAddAutoDetected(false);
        }
        setShowAddDialog(open);
      }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Plus className="h-4 w-4 text-white" />
              </div>
              Add New Product
            </DialogTitle>
            <DialogDescription>Set up the product details and pricing below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {/* Basic Info Section */}
            <div className="space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <div className="h-1 w-4 rounded-full bg-slate-300" />
                Basic Information
              </div>
              <div>
                <Label className="text-xs font-medium">Product Name <span className="text-red-500">*</span></Label>
                <div className="relative">
                  <Input value={addForm.name} onChange={(e) => handleAddNameChange(e.target.value)} placeholder="e.g. Paracetamol 500mg" className="mt-1 pr-24" />
                  {addAutoDetected && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                      <Zap className="h-2.5 w-2.5" /> Auto-detected
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Category & generic name are auto-filled as you type — adjust if needed.</p>
              </div>
              <div>
                <Label className="text-xs font-medium">Generic Name</Label>
                <div className="relative">
                  <Input value={addForm.genericName} onChange={(e) => {
                    setAddForm({ ...addForm, genericName: e.target.value });
                    setAddAutoDetected(false);
                  }} placeholder="e.g. Acetaminophen" className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium">Category</Label>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1">
                    <Select value={addForm.categoryId} onValueChange={(v) => {
                      setAddForm({ ...addForm, categoryId: v });
                      setAddAutoDetected(false);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {addAutoDetected && addForm.categoryId && (
                    <span className="shrink-0 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1.5 flex items-center gap-1">
                      <Check className="h-2.5 w-2.5" /> Auto
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Unit</Label>
                  <Select value={addForm.unit} onValueChange={(v) => setAddForm({ ...addForm, unit: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pcs">Pieces</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="strip">Strip</SelectItem>
                      <SelectItem value="bottle">Bottle</SelectItem>
                      <SelectItem value="sachet">Sachet</SelectItem>
                      <SelectItem value="tube">Tube</SelectItem>
                      <SelectItem value="pack">Pack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Reorder Level</Label>
                  <Input type="number" value={addForm.reorderLevel} onChange={(e) => setAddForm({ ...addForm, reorderLevel: Number(e.target.value) || 0 })} className="mt-1" />
                </div>
              </div>
            </div>

            {/* ─── Premium Pricing Section ─── */}
            <div className="relative rounded-xl border-2 border-emerald-200/60 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />
              <div className="relative p-5 space-y-4">
                {/* Section header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-200">
                      <DollarSign className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold text-emerald-800">Set Product Price</Label>
                      <p className="text-[10px] text-emerald-600/60">Define cost and selling price for this drug</p>
                    </div>
                  </div>
                  {addForm.defaultSellingPrice > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                      <Check className="h-2.5 w-2.5 mr-1" />
                      Price set
                    </Badge>
                  )}
                </div>

                {/* Price inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Cost Price (GHS)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={addForm.defaultCostPrice || ''}
                        onChange={(e) => setAddForm({ ...addForm, defaultCostPrice: parseFloat(e.target.value) || 0 })}
                        className="h-10 bg-white/80 border-emerald-200/60 focus-visible:ring-emerald-300/50 font-mono text-sm pl-8"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">GHS</span>
                    </div>
                    <p className="text-[10px] text-slate-400">What you paid the supplier</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wider">Selling Price (GHS)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={addForm.defaultSellingPrice || ''}
                        onChange={(e) => setAddForm({ ...addForm, defaultSellingPrice: parseFloat(e.target.value) || 0 })}
                        className="h-10 bg-white/80 border-emerald-300/60 focus-visible:ring-emerald-400/50 font-mono text-sm font-bold text-emerald-700 pl-8"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-500 font-semibold">GHS</span>
                    </div>
                    <p className="text-[10px] text-emerald-600/60">What the customer pays</p>
                  </div>
                </div>

                {/* Markup Calculator */}
                <MarkupCalculator
                  costPrice={addForm.defaultCostPrice}
                  sellingPrice={addForm.defaultSellingPrice}
                  onCostChange={(v) => setAddForm({ ...addForm, defaultCostPrice: v })}
                  onSellingChange={(v) => setAddForm({ ...addForm, defaultSellingPrice: v })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]"
              onClick={handleAddProduct}
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Adding...</span>
              ) : (
                <><Plus className="h-4 w-4 mr-1" /> Add Product</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── EDIT PRICE DIALOG (Premium with Comparison) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={showEditPriceDialog} onOpenChange={setShowEditPriceDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Tag className="h-4 w-4 text-white" />
              </div>
              <div>
                <span className="block">Update Price</span>
                <span className="text-sm font-normal text-slate-500">{editPriceProduct?.name}</span>
              </div>
            </DialogTitle>
            <DialogDescription>Change the default cost and selling price for this product.</DialogDescription>
          </DialogHeader>

          {editPriceProduct && (
            <div className="space-y-4">
              {/* Current vs New comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Current Prices</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-slate-400">Cost</p>
                      <p className="text-base font-semibold font-mono">{formatGHS(editPriceProduct.defaultCostPrice ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">Selling</p>
                      <p className="text-base font-bold font-mono text-emerald-700">{formatGHS(editPriceProduct.defaultSellingPrice ?? 0)}</p>
                    </div>
                    <div className="pt-1.5 border-t border-slate-200/60">
                      <MarginBadge cost={editPriceProduct.defaultCostPrice ?? 0} selling={editPriceProduct.defaultSellingPrice ?? 0} />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border-2 border-emerald-200/60 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2">New Prices</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-slate-400">Cost</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editCostPrice || ''}
                        onChange={(e) => setEditCostPrice(parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm font-mono bg-white/70 border-emerald-200/50 focus-visible:ring-emerald-300/50"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">Selling</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editSellingPrice || ''}
                        onChange={(e) => setEditSellingPrice(parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm font-mono font-bold text-emerald-700 bg-white/70 border-emerald-200/50 focus-visible:ring-emerald-300/50"
                      />
                    </div>
                    <div className="pt-1.5 border-t border-emerald-200/40">
                      <MarginBadge cost={editCostPrice} selling={editSellingPrice} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Price change indicator */}
              {(editCostPrice !== (editPriceProduct.defaultCostPrice ?? 0) || editSellingPrice !== (editPriceProduct.defaultSellingPrice ?? 0)) && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border ${
                  editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0)
                    ? 'bg-emerald-50 border-emerald-200/60'
                    : editSellingPrice < (editPriceProduct.defaultSellingPrice ?? 0)
                    ? 'bg-red-50 border-red-200/60'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <ArrowRightLeft className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="text-xs">
                    {editSellingPrice !== (editPriceProduct.defaultSellingPrice ?? 0) && (
                      <span className="font-medium">
                        Selling: {formatGHS(editPriceProduct.defaultSellingPrice ?? 0)} → {formatGHS(editSellingPrice)}
                        {' '}
                        <span className={editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0) ? 'text-emerald-600' : 'text-red-500'}>
                          ({editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0) ? '+' : ''}{formatGHS(editSellingPrice - (editPriceProduct.defaultSellingPrice ?? 0))})
                        </span>
                      </span>
                    )}
                    {editCostPrice !== (editPriceProduct.defaultCostPrice ?? 0) && (
                      <span className="text-muted-foreground ml-2">
                        Cost: {formatGHS(editCostPrice - (editPriceProduct.defaultCostPrice ?? 0))}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Markup Calculator */}
              <div className="rounded-lg border border-slate-200 p-4 bg-slate-50/30">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <Calculator className="h-3 w-3" />
                  Quick Markup Calculator
                </p>
                <MarkupCalculator
                  costPrice={editCostPrice}
                  sellingPrice={editSellingPrice}
                  onCostChange={setEditCostPrice}
                  onSellingChange={setEditSellingPrice}
                />
              </div>

              {/* Apply to batches toggle */}
              {(editPriceProduct._count?.batches ?? 0) > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 bg-white">
                  <Switch
                    checked={editApplyToBatches}
                    onCheckedChange={setEditApplyToBatches}
                    className="mt-0.5"
                    id="apply-to-batches"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="apply-to-batches" className="text-sm font-medium cursor-pointer">
                      Apply to existing batches
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Also update prices for all <span className="font-semibold text-slate-700">{editPriceProduct._count?.batches ?? 0}</span> existing batches of this product.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowEditPriceDialog(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[130px]"
              onClick={handleUpdatePrice}
              disabled={updatingPrice}
            >
              {updatingPrice ? (
                <span className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating...</span>
              ) : (
                <><Check className="h-4 w-4 mr-1" /> Update Prices</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── EDIT DRUG DIALOG (Info + Stock + Prices) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 shadow shadow-emerald-200 flex items-center justify-center shrink-0">
                <Pencil className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="block">Edit Drug</span>
                <span className="text-sm font-normal text-slate-500 truncate block">{editProduct?.name}</span>
              </div>
              {editProduct?.category?.name && (
                <Badge variant="outline" className="ml-auto text-[10px] px-2 bg-emerald-50 text-emerald-700 border-emerald-200">
                  {editProduct.category.name}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Update the drug's information, then set the real stock, prices and expiry for each batch.
            </DialogDescription>
          </DialogHeader>

          {editProduct && (
            <div className="space-y-5">
              {/* ── Live stock summary chips ── */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  <Boxes className="h-3.5 w-3.5 text-slate-400" />
                  {editBatches.length} batch{editBatches.length !== 1 ? 'es' : ''}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  <Package className="h-3.5 w-3.5 text-slate-400" />
                  Total stock: <strong className="text-slate-800">{editBatches.reduce((s, r) => s + (Number(r.quantity) || 0), 0)}</strong>
                </span>
                {editBatches.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-600 border border-amber-200">
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Edition mode
                  </span>
                )}
              </div>

              {/* ── Section 1: Drug Information ── */}
              <div className="space-y-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <div className="h-1 w-4 rounded-full bg-emerald-400" />
                  Drug Information
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Product Name <span className="text-red-500">*</span></Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Generic Name</Label>
                    <Input
                      value={editForm.genericName}
                      onChange={(e) => setEditForm({ ...editForm, genericName: e.target.value })}
                      placeholder="e.g. Acetaminophen"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Category</Label>
                    <Select value={editForm.categoryId} onValueChange={(v) => setEditForm({ ...editForm, categoryId: v })}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium">Unit</Label>
                      <Select value={editForm.unit} onValueChange={(v) => setEditForm({ ...editForm, unit: v })}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pcs">Pieces</SelectItem>
                          <SelectItem value="box">Box</SelectItem>
                          <SelectItem value="strip">Strip</SelectItem>
                          <SelectItem value="bottle">Bottle</SelectItem>
                          <SelectItem value="sachet">Sachet</SelectItem>
                          <SelectItem value="tube">Tube</SelectItem>
                          <SelectItem value="pack">Pack</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Reorder Level</Label>
                      <Input
                        type="number"
                        min="0"
                        value={editForm.reorderLevel}
                        onChange={(e) => setEditForm({ ...editForm, reorderLevel: Number(e.target.value) || 0 })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Section 2: Stock & Pricing (batches) ── */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <div className="h-1 w-4 rounded-full bg-emerald-400" />
                    Real Stock, Prices & Expiry
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-emerald-700 border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50"
                    onClick={addBatchRow}
                  >
                    <PackagePlus className="h-3.5 w-3.5 mr-1" />
                    Add Batch
                  </Button>
                </div>

                {editBatches.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
                    <Boxes className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">No stock batches yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Click <span className="font-medium text-emerald-600">Add Batch</span> to create the first stock entry for this drug.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editBatches.map((row, idx) => {
                      const isActive = editActiveBatchKey === row.key;
                      const rowMargin = calcMargin(row.costPrice, row.sellingPrice);
                      return (
                        <div
                          key={row.key}
                          className={`rounded-xl border transition-all ${
                            isActive
                              ? 'border-emerald-300 ring-2 ring-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/20'
                              : 'border-slate-200 bg-white'
                          }`}
                          onClick={() => setEditActiveBatchKey(row.key)}
                        >
                          {/* Batch header */}
                          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-dashed border-slate-100">
                            <div className="flex items-center gap-2">
                              <span className={`h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                                isActive ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                              }`}>
                                {idx + 1}
                              </span>
                              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Batch #{idx + 1}</span>
                              {row.id && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-slate-50 text-slate-400 border-slate-200">
                                  existing
                                </Badge>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50"
                              onClick={(e) => { e.stopPropagation(); removeBatchRow(row.key); }}
                              title="Remove batch"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="md:col-span-1">
                                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                                  Batch # <span className="normal-case text-slate-300">(optional — auto)</span>
                                </Label>
                                <Input
                                  value={row.batchNumber}
                                  onChange={(e) => { setEditActiveBatchKey(row.key); updateBatchRow(row.key, { batchNumber: e.target.value }); }}
                                  placeholder="auto-generate"
                                  className="mt-1 font-mono text-sm h-9"
                                />
                              </div>
                              <div className="md:col-span-1">
                                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                                  Expiry Date <span className="normal-case text-slate-300">(optional)</span>
                                </Label>
                                <Input
                                  type="date"
                                  value={row.expiryDate}
                                  onChange={(e) => { setEditActiveBatchKey(row.key); updateBatchRow(row.key, { expiryDate: e.target.value }); }}
                                  className="mt-1 text-sm h-9"
                                />
                              </div>
                              <div className="md:col-span-2 grid grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                                    Real Quantity <span className="text-emerald-500">●</span>
                                  </Label>
                                  <div className="relative">
                                    <Input
                                      type="number"
                                      min="0"
                                      value={row.quantity || ''}
                                      onChange={(e) => { setEditActiveBatchKey(row.key); updateBatchRow(row.key, { quantity: parseInt(e.target.value || '0', 10) || 0 }); }}
                                      className="mt-1 font-mono font-bold text-emerald-700 text-sm h-9 pl-8 border-emerald-200/70"
                                    />
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500 font-semibold">{editForm.unit}</span>
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Total Value</Label>
                                  <div className="mt-1 h-9 rounded-md bg-slate-50 border border-slate-200 px-2 flex items-center">
                                    <span className="text-sm font-mono text-slate-600">
                                      {formatGHS((Number(row.costPrice) || 0) * (Number(row.quantity) || 0))}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Prices row */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Cost Price (GHS)</Label>
                                <div className="relative">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={row.costPrice || ''}
                                    onChange={(e) => { setEditActiveBatchKey(row.key); updateBatchRow(row.key, { costPrice: parseFloat(e.target.value) || 0 }); }}
                                    className="mt-1 font-mono text-sm h-9 pl-8"
                                  />
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-medium">GHS</span>
                                </div>
                              </div>
                              <div>
                                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Selling Price (GHS)</Label>
                                <div className="relative">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={row.sellingPrice || ''}
                                    onChange={(e) => { setEditActiveBatchKey(row.key); updateBatchRow(row.key, { sellingPrice: parseFloat(e.target.value) || 0 }); }}
                                    className="mt-1 font-mono font-bold text-emerald-700 text-sm h-9 pl-8"
                                  />
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500 font-medium">GHS</span>
                                </div>
                              </div>
                            </div>

                            {/* Live margin badge */}
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-slate-400">
                                Profit per {editForm.unit}: {formatGHS((Number(row.sellingPrice) || 0) - (Number(row.costPrice) || 0))}
                              </span>
                              <MarginBadge cost={row.costPrice} selling={row.sellingPrice} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Markup calculator — applies to the active batch */}
                {editActiveBatchKey && editBatches.find((r) => r.key === editActiveBatchKey) && (() => {
                  const active = editBatches.find((r) => r.key === editActiveBatchKey)!;
                  return (
                    <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/30">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                        <Calculator className="h-3 w-3" />
                        Quick Markup Calculator
                        <span className="ml-auto normal-case font-medium text-slate-500">
                          Applies to batch {active.batchNumber || `#${editBatches.findIndex((r) => r.key === editActiveBatchKey) + 1}`}
                        </span>
                      </p>
                      <MarkupCalculator
                        costPrice={active.costPrice}
                        sellingPrice={active.sellingPrice}
                        onCostChange={(v) => updateBatchRow(editActiveBatchKey, { costPrice: v })}
                        onSellingChange={(v) => updateBatchRow(editActiveBatchKey, { sellingPrice: v })}
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[130px]"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editProduct}
            >
              {savingEdit ? (
                <span className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</span>
              ) : (
                <><Check className="h-4 w-4 mr-1" /> Save Drug</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Product Confirmation ─── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Product — {productToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  Deactivating hides the product from listings while keeping it (and its sales history) fully intact.
                  Permanently deleting erases the product and its stock records for good.
                </p>
                {productToDelete && (
                  <div className="rounded-lg bg-muted/50 p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <span className="text-muted-foreground">Units in stock</span>
                    <span className="text-right font-semibold tabular-nums">{productToDelete.totalStock} {productToDelete.unit}</span>
                    <span className="text-muted-foreground">Batches</span>
                    <span className="text-right font-semibold tabular-nums">{productToDelete._count?.batches ?? 0}</span>
                    <span className="text-muted-foreground">Linked sales</span>
                    <span className="text-right font-semibold tabular-nums">{productToDelete._count?.saleItems ?? 0}</span>
                  </div>
                )}
                {(productToDelete?._count?.saleItems ?? 0) > 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This product has sales records — it can be deactivated but never permanently deleted (that would
                    corrupt your sales history).
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-slate-200"
                onClick={() => handleDeleteProduct(false)}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deactivate'}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => handleDeleteProduct(true)}
                disabled={deleting || (productToDelete?._count?.saleItems ?? 0) > 0}
                title={(productToDelete?._count?.saleItems ?? 0) > 0 ? 'Cannot delete — product has sales history' : 'Permanently erase product and its stock records'}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Delete permanently
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}