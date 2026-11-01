import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import { callables } from '../lib/firebase';

export default function Join() {
  const { code = '' } = useParams();
  const { user, authReady, householdId, householdReady, t } = useHousehold();
  const nav = useNavigate();
  const [memberName, setMemberName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (authReady && !user) return <Navigate to="/login" state={{ from: `/join/${code}` }} replace />;
  if (householdReady && householdId) return <Navigate to="/home" replace />;

  async function join() {
    setBusy(true);
    setError('');
    try {
      await callables.joinHousehold({ code, memberName });
      nav('/home', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 pt-10">
      <h1 className="mb-2 text-2xl font-bold text-brand-800">{t('joinTitle')}</h1>
      <p className="mb-6 font-mono text-xl tracking-widest text-gray-700">{code.toUpperCase()}</p>
      <label className="label" htmlFor="me">{t('yourName')}</label>
      <input id="me" className="field mb-4" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
      {error && <p className="mb-3 text-sm text-red-700" role="alert">{error}</p>}
      <button className="btn-primary w-full text-lg" disabled={busy || !memberName.trim()} onClick={join}>
        {busy ? '…' : t('join')}
      </button>
    </main>
  );
}
