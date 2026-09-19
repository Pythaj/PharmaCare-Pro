'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Pill, Loader2, Eye, EyeOff, Lock, ShieldCheck, KeyRound, Mail, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import type { User } from '@/types';
import InstallPrompt, { InstallFAB } from '@/components/InstallPrompt';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // First-time login: account was created with a temporary password
  const [pendingSetup, setPendingSetup] = useState<User | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const { login, appName, appTagline } = useAppStore();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Login failed');
      }

      const result = await res.json();
      const user: User = result.user;

      // Temporary credentials — route into the first-run setup instead
      if (result.mustChangePassword) {
        setPendingSetup(user);
        return;
      }

      login(user);
      toast.success(`Welcome back, ${user.name}!`, {
        description: 'You have successfully signed in.',
      });
    } catch (err) {
      toast.error('Login Failed', {
        description: err instanceof Error ? err.message : 'Invalid credentials. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFirstRunSubmit = async () => {
    if (setupPassword.length < 8) {
      toast.error('Password too short', {
        description: 'Use at least 8 characters for your new password.',
      });
      return;
    }
    if (setupPassword !== setupConfirm) {
      toast.error('Passwords do not match', {
        description: 'Please re-enter the same password in both fields.',
      });
      return;
    }

    setSetupLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: setupPassword,
          email: setupEmail.trim() || undefined,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Setup failed');
      }

      const user: User = result.user;
      login(user);
      toast.success('Welcome to your workspace!', {
        description: 'Your credentials are set up and you are signed in.',
      });
    } catch (err) {
      toast.error('Setup Failed', {
        description: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-slate-50/60">
      {/* Left branding panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 h-full relative overflow-hidden" style={{ background: 'linear-gradient(to bottom right, var(--accent-gradient-from), var(--accent-gradient-via), var(--accent-gradient-to))' }}>
        {/* Decorative elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-white" />
          <div className="absolute top-1/2 -right-32 h-80 w-80 rounded-full bg-white" />
          <div className="absolute -bottom-20 left-1/3 h-64 w-64 rounded-full bg-white" />
        </div>
        <div className="absolute inset-0 opacity-5">
          <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
              <Pill className="h-10 w-10 text-white" />
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-3 text-7xl font-extrabold tracking-tight text-white drop-shadow-lg"
            style={{ fontSize: '4.5rem', fontWeight: 800, letterSpacing: '-0.025em', textShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
            suppressHydrationWarning
          >
            {appName}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mb-10 text-lg opacity-90"
          >
            {appTagline}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="space-y-3.5 text-left text-white/80"
          >
            {[
              'Point of Sale & Billing',
              'Inventory & Stock Management',
              'Purchase & Procurement',
              'Customer Relationship Management',
              'Comprehensive Reports & Analytics',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex w-full lg:w-1/2 h-full items-center justify-center overflow-hidden px-4 py-6 lg:py-0 bg-slate-50/60">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md max-h-full overflow-y-auto no-scrollbar"
          suppressHydrationWarning
        >
          {/* Mobile logo */}
          <div className="mb-6 flex flex-col items-center lg:hidden">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-primary)' }}>
              <Pill className="h-7 w-7 text-white" />
            </div>
            <h1
              className="text-5xl font-extrabold tracking-tight text-slate-900"
              style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.025em' }}
              suppressHydrationWarning
            >{appName}</h1>
            <p className="text-sm text-slate-500">{appTagline}</p>
          </div>

          {pendingSetup ? (
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
                      <h2 className="text-base font-bold leading-tight">Welcome, {pendingSetup.name}!</h2>
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
                        value={setupEmail}
                        onChange={(e) => setSetupEmail(e.target.value)}
                        defaultValue={pendingSetup.email}
                        placeholder="you@pharmacy.com"
                        disabled={setupLoading}
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
                        type={showSetupPassword ? 'text' : 'password'}
                        value={setupPassword}
                        onChange={(e) => setSetupPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        disabled={setupLoading}
                        className="h-11 border-slate-200 bg-white pr-10 pl-9 text-sm focus-visible:border-[var(--accent-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSetupPassword(!showSetupPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        tabIndex={-1}
                      >
                        {showSetupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                        type={showSetupPassword ? 'text' : 'password'}
                        value={setupConfirm}
                        onChange={(e) => setSetupConfirm(e.target.value)}
                        placeholder="Re-enter your new password"
                        autoComplete="new-password"
                        disabled={setupLoading}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFirstRunSubmit(); }}
                        className="h-11 border-slate-200 bg-white pr-3 pl-9 text-sm focus-visible:border-[var(--accent-primary)]"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={handleFirstRunSubmit}
                    disabled={setupLoading || !setupPassword.trim()}
                    className="h-11 w-full text-white font-medium transition-colors"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    {setupLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Setting up...
                      </>
                    ) : (
                      'Finish Setup & Enter App'
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setPendingSetup(null)}
                    disabled={setupLoading}
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
          ) : (
          <Card className="border-slate-200 shadow-lg shadow-slate-200/50">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold text-slate-900">Sign In</CardTitle>
              <CardDescription className="text-slate-500">
                Enter your credentials to access your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    autoComplete="email"
                    disabled={isLoading}
                    className="h-11 border-slate-200 bg-white text-sm placeholder:text-slate-400 focus-visible:border-[var(--accent-primary)]"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      disabled={isLoading}
                      className="h-11 border-slate-200 bg-white pr-10 text-sm placeholder:text-slate-400 focus-visible:border-[var(--accent-primary)]"
                      {...register('password')}
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
                  {errors.password && (
                    <p className="text-xs text-red-500">{errors.password.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="h-11 w-full text-white font-medium transition-colors"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>

              {/* Mobile Features (hidden on desktop) */}
              <div className="mt-6 lg:hidden">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 select-none py-2">
                    <span>Features</span>
                    <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="mt-2 space-y-2 text-sm text-slate-600">
                    {[
                      'Point of Sale & Billing',
                      'Inventory & Stock Management',
                      'Purchase & Procurement',
                      'Customer Relationship Management',
                      'Comprehensive Reports & Analytics',
                    ].map((feature) => (
                      <div key={feature} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent-primary-muted)' }}>
                          <svg className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-xs">{feature}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

            </CardContent>
          </Card>
          )}

          {/* Security footer */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Secured with encrypted authentication</span>
            <Lock className="ml-2 h-3 w-3" />
          </div>
        </motion.div>
      </div>

      {/* PWA Install Prompt */}
      <InstallPrompt />
      <InstallFAB />
    </div>
  );
}