'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The inline "this load failed, and here is what to do" banner.
 *
 * A failed fetch used to be indistinguishable from an empty result across most
 * screens: the error was swallowed and the view rendered its zero/empty state.
 * For a pharmacy that reads as a fact — "no stock", "no customers", "GHS 0.00
 * taken" — rather than a broken request, which is exactly the wrong conclusion.
 *
 * Kept as one component so every screen says it the same way and so the retry
 * affordance is never forgotten. It is deliberately not a toast: toasts vanish,
 * and the user may not have been looking when it appeared.
 */
export function LoadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 ${
        className ?? ''
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message}</p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-amber-400 bg-transparent text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          Try again
        </Button>
      )}
    </div>
  );
}
