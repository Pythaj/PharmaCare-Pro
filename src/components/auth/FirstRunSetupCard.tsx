'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Eye, EyeOff, Lock, ShieldCheck, KeyRound, Mail, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import type { User } from '@/types';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

interface FirstRunSetupCardProps {
  /** The signed-in account that is still on its temporary password. */
  user: User;
  /** Called with the updated user once setup succeeds. */
  onComplete: (user: User) => void;
  /** Called when the user backs out — the host is responsible for signing out. */
  onCancel: () => void;
}

/**
 * First-time credential setup for an account created with a temporary password.
 *
 * Shared by the sign-in screen (POST /api/auth returns mustChangePassword) and
 * the forced-setup gate shown when a persisted session belongs to an account
 * that still owes a password change — one form, one policy, one place to fix a
 * bug.
 */
export default function FirstRunSetupCard({ user, onComplete, onCancel }: FirstRunSetupCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error('Password too short', {
        description: `Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`,
      });
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match', {
        description: 'Please re-enter the same password in both fields.',
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          email: email.trim() || undefined,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Setup failed');
      }

      onComplete(result.user as User);
    } catch (err) {
      toast.error('Setup Failed', {
        description: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card className="border-slate-200 shadow-lg shadow-slate-200/50 overflow-hidden">
        {/* Setup hero header */}
        <div className="px-6 py-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(to bottom right, var(--accent-gradient-from), var(--accent-gradient-via), var(--accent-gradient-to))' }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '16px 16px' }} />
          <div className="relative flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/25">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">Welcome, {user.name}!</h2>
              <p className="text-[11px] text-white/85 truncate">Complete your account setup to continue</p>
            </div>
          </div>
          <p className="relative mt-3 text-[11px] leading-relaxed text-white/85">
            Your account is using a temporary password. Set your own password below to secure your
            workspace — it only takes a moment.
          </p>
        </div>
        <CardContent className="space-y-3.5 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="setup-email" className="text-xs font-medium text-slate-600">
              Email address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <Input
                id="setup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@pharmacy.com"
                disabled={isLoading}
                className="h-11 border-slate-200 bg-white pr-3 pl-9 text-sm focus-visible:border-[var(--accent-primary)]"
              />
            </div>
            <p className="text-[10px] text-slate-400">Pre-filled with your temporary email — change it if you like.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-password" className="text-xs font-medium text-slate-600">
              New password
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <Input
                id="setup-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password"
                disabled={isLoading}
                className="h-11 border-slate-200 bg-white pr-10 pl-9 text-sm focus-visible:border-[var(--accent-primary)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-confirm" className="text-xs font-medium text-slate-600">
              Confirm password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <Input
                id="setup-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                disabled={isLoading}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                className="h-11 border-slate-200 bg-white pr-3 pl-9 text-sm focus-visible:border-[var(--accent-primary)]"
              />
            </div>
          </div>

          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading || !password.trim()}
              className="h-11 w-full text-white font-medium transition-colors"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                'Finish Setup & Enter App'
              )}
            </Button>
          </motion.div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            Sign out instead
          </button>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Your password is encrypted before being stored</span>
      </div>
    </>
  );
}
