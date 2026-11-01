import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import { callables } from '../lib/firebase';
import { LANG_NAMES } from '../lib/i18n';
import type { Lang } from '../lib/types';

export default function Setup() {
  const { user, authReady, householdId, householdReady, t, lang, setLocalLang } = useHousehold();
  const nav = useNavigate();
  const [memberName, setMemberName] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('Pune');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (authReady && !user) return <Navigate to="/login" replace />;
  if (householdReady && householdId) return <Navigate to="/home" replace />;

  async function create() {
    setBusy(true);
    setError('');
    try {
      await callables.createHousehold({ name, city, languagePref: lang, memberName });
      nav('/home', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 pb-10 pt-8">
      <h1 className="mb-6 text-2xl font-bold text-brand-800">{t('setupTitle')}</h1>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="me">{t('yourName')}</label>
          <input id="me" className="field" value={memberName} onChange={(e) => setMemberName(e.target.value)} autoComplete="given-name" />
        </div>
        <div>
          <label className="label" htmlFor="hn">{t('householdName')}</label>
          <input id="hn" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sharma home" />
        </div>
        <div>
          <label className="label" htmlFor="city">{t('city')}</label>
          <input id="city" className="field" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <span className="label">{t('language')}</span>
          <div className="flex gap-2">
            {(['mr', 'hi', 'en'] as Lang[]).map((l) => (
              <button key={l} onClick={() => setLocalLang(l)}
                className={`chip min-h-tap px-4 ${lang === l ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-gray-300'}`}>
                {LANG_NAMES[l]}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <button className="btn-primary w-full text-lg" disabled={busy || !memberName.trim()} onClick={create}>
          {busy ? '…' : t('createHousehold')}
        </button>
      </div>

      <div className="card mt-10">
        <label className="label" htmlFor="code">{t('haveCode')}</label>
        <div className="flex gap-2">
          <input id="code" className="field uppercase tracking-widest" value={code} maxLength={8}
            onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn-secondary" disabled={code.length < 6} onClick={() => nav(`/join/${code}`)}>{t('join')}</button>
        </div>
      </div>
    </main>
  );
}
