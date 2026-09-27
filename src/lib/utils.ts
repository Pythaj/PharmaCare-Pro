import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts a Prisma Decimal (or anything numeric) to a plain number — single
 * source of truth (Rule 18) for money that is about to be summed.
 *
 * Every money column in this schema is Decimal, so `acc + row.totalAmount` is a
 * type error and, more importantly, keeps mixing Decimal objects into values
 * that later get `JSON.stringify`d (where they serialise as strings) or printed.
 * Normalising once at the edge keeps the arithmetic honest.
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (value === null || value === undefined) return 0
  const n = Number(value as { toString(): string })
  return Number.isFinite(n) ? n : 0
}
