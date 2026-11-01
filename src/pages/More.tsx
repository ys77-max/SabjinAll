import { Link } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import { Header } from '../components/ui';
import type { TKey } from '../lib/i18n';

const LINKS: { to: string; key: TKey; icon: string }[] = [
  { to: '/catalogue', key: 'catalogueTitle', icon: '🥬' },
  { to: '/vendors', key: 'vendorsTitle', icon: '🛺' },
  { to: '/history', key: 'historyTitle', icon: '🧾' },
  { to: '/settings', key: 'settingsTitle', icon: '⚙️' },
];

export default function More() {
  const { t } = useHousehold();
  return (
    <main className="page">
      <Header title={t('moreTitle')} />
      <ul className="space-y-2">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex min-h-[64px] items-center gap-4 rounded-2xl bg-white px-4 text-lg font-semibold ring-1 ring-black/5">
              <span aria-hidden className="text-2xl">{l.icon}</span>
              <span className="flex-1">{t(l.key)}</span>
              <span aria-hidden className="text-gray-400">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
