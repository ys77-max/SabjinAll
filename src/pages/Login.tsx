import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { LANG_NAMES } from '../lib/i18n';
import type { Lang } from '../lib/types';

export default function Login() {
  const { user, authReady, t, lang, setLocalLang } = useHousehold();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/home';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const verifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => () => verifier.current?.clear(), []);

  if (authReady && user) return <Navigate to={from} replace />;

  async function sendOtp() {
    setError('');
    const digits = phone.replace(/\D/g, '');
    const e164 = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    setBusy(true);
    try {
      verifier.current ??= new RecaptchaVerifier(auth, 'recaptcha-anchor', { size: 'invisible' });
      setConfirmation(await signInWithPhoneNumber(auth, e164, verifier.current));
    } catch (e) {
      setError((e as Error).message);
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!confirmation) return;
    setBusy(true);
    setError('');
    try {
      await confirmation.confirm(code.trim());
      nav(from, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-8 pt-12">
      <img src="/icons/icon.svg" alt="" className="mb-4 h-20 w-20" />
      <h1 className="text-3xl font-bold text-brand-800">SabziList</h1>
      <p className="mb-8 mt-1 text-gray-600">{t('loginTitle')}</p>

      <div className="mb-6 flex gap-2" role="radiogroup" aria-label={t('language')}>
        {(['mr', 'hi', 'en'] as Lang[]).map((l) => (
          <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLocalLang(l)}
            className={`chip min-h-tap px-4 ${lang === l ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-gray-300'}`}>
            {LANG_NAMES[l]}
          </button>
        ))}
      </div>

      {!confirmation ? (
        <>
          <label className="label" htmlFor="phone">{t('phone')}</label>
          <div className="flex gap-2">
            <span className="field flex w-auto items-center bg-gray-50">+91</span>
            <input id="phone" className="field" inputMode="tel" autoComplete="tel-national" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" />
          </div>
        </>
      ) : (
        <>
          <label className="label" htmlFor="otp">{t('otp')}</label>
          <input id="otp" className="field text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-ghost mt-2 self-start px-0" onClick={() => { setConfirmation(null); setCode(''); }}>{t('changeNumber')}</button>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex-1" />
      <button id="recaptcha-anchor" className="btn-primary w-full text-lg" disabled={busy || (!confirmation ? phone.replace(/\D/g, '').length < 10 : code.length !== 6)}
        onClick={confirmation ? verify : sendOtp}>
        {busy ? '…' : confirmation ? t('verify') : t('sendOtp')}
      </button>
    </main>
  );
}
