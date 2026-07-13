import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, LockKeyhole, Shield, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await login(email, password);
      const requested = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
      const destination = requested?.pathname?.startsWith('/')
        ? `${requested.pathname}${requested.search ?? ''}`
        : '/';
      navigate(destination, { replace: true });
    } catch {
      // Store owns the user-facing error.
    }
  };

  return (
    <main className="grid min-h-screen bg-surface-950 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.72fr)]">
      <section className="relative hidden overflow-hidden border-r border-surface-800 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,oklch(68.5%_0.126_210/0.13),transparent_32%)]" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-primary-500/30 bg-primary-500/10 text-primary-300">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </span>
          <div><p className="font-bold text-surface-50">OneAlert</p><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-surface-500">AI Security OS</p></div>
        </div>
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-300">Industrial defense, governed</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-surface-50 xl:text-5xl">See the signal.<br />Protect the process.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-surface-400">A dense operations workspace for OT visibility, investigation, and human-approved response.</p>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-px overflow-hidden rounded-md border border-surface-800 bg-surface-800">
            {[['Passive', 'Asset discovery'], ['Gated', 'Response actions'], ['Audited', 'Agent decisions']].map(([value, label]) => (
              <div key={value} className="bg-surface-900 p-4"><p className="text-sm font-bold text-primary-200">{value}</p><p className="mt-1 text-xs text-surface-500">{label}</p></div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-surface-500"><Activity className="h-4 w-4 text-success" aria-hidden="true" /> Secure operator workspace</div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Shield className="mb-5 h-9 w-9 text-primary-300 lg:hidden" aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-300">Operator access</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-surface-50">Welcome back</h2>
          <p className="mt-2 text-sm text-surface-400">Sign in to OneAlert</p>

          <div className="oa-panel mt-7 p-5 sm:p-6">
            {error && (
              <div id="login-error" className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={clearError} aria-label="Dismiss sign-in error" className="text-danger/70 hover:text-danger">&times;</button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-surface-300">Email</label>
                <input id="login-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} aria-describedby={error ? 'login-error' : undefined} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3.5 py-2.5 text-surface-50 placeholder-surface-500 transition focus:border-primary-500 focus:outline-none" placeholder="you@company.com" required />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-surface-300">Password</label>
                <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} aria-describedby={error ? 'login-error' : undefined} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3.5 py-2.5 text-surface-50 placeholder-surface-500 transition focus:border-primary-500 focus:outline-none" placeholder="Enter your password" required />
              </div>
              <button type="submit" disabled={isLoading} className="w-full rounded-md bg-primary-500 px-4 py-2.5 font-semibold text-surface-950 transition-colors hover:bg-primary-400 disabled:opacity-50">
                {isLoading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-surface-500"><span className="h-px flex-1 bg-surface-700" />or<span className="h-px flex-1 bg-surface-700" /></div>
            <button type="button" onClick={() => { window.location.href = '/api/v1/auth/github/login'; }} className="flex w-full items-center justify-center gap-2 rounded-md border border-surface-600 bg-surface-800 px-4 py-2.5 font-semibold text-surface-100 hover:border-surface-500 hover:bg-surface-700">
              <svg className="h-5 w-5" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.1c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23A11.5 11.5 0 0 1 12 6.4c1.02 0 2.05.14 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" /></svg> Continue with GitHub
            </button>

            <p className="mt-6 text-center text-sm text-surface-400">Don't have an account? <Link to="/register" className="font-semibold text-primary-300 hover:text-primary-200">Sign up</Link></p>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-surface-500"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Session protected with an HttpOnly cookie</div>
        </div>
      </section>
    </main>
  );
}
