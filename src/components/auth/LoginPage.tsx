'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Pill, Loader2, Eye, EyeOff } from 'lucide-react';
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
  const { login, appName, appTagline } = useAppStore();

  const {
    register,
    handleSubmit,
    setValue,
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

  const fillDemo = (email: string, password: string) => {
    // Use react-hook-form's setValue — reacts to form state reliably
    // instead of fragile DOM value setter manipulation.
    setValue('email', email, { shouldValidate: true });
    setValue('password', password, { shouldValidate: true });
  };

  return (
    <div className="flex min-h-screen">
      {/* Left branding panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden" style={{ background: 'linear-gradient(to bottom right, var(--accent-gradient-from), var(--accent-gradient-via), var(--accent-gradient-to))' }}>
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

        <div className="relative z-10 flex flex-col items-center justify-center px-12 text-center">
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
            className="mb-4 text-4xl font-bold tracking-tight text-white"
          >
            {appName}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mb-12 text-lg opacity-90"
          >
            {appTagline}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="space-y-4 text-left text-white/80"
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
      <div className="flex w-full items-center justify-center px-4 py-12 lg:w-1/2 bg-slate-50/50">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-primary)' }}>
              <Pill className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{appName}</h1>
            <p className="text-sm text-slate-500">{appTagline}</p>
          </div>

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

              {/* Demo credentials */}
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Demo Credentials
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => fillDemo('admin@pharmacy.com', 'admin123')}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 transition-colors"
                  >
                    <div>
                      <span className="font-medium text-slate-700">Admin</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-slate-500">admin@pharmacy.com / admin123</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemo('cashier@pharmacy.com', 'sales123')}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 transition-colors"
                  >
                    <div>
                      <span className="font-medium text-slate-700">Sales</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-slate-500">cashier@pharmacy.com / sales123</span>
                    </div>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* PWA Install Prompt */}
      <InstallPrompt />
      <InstallFAB />
    </div>
  );
}