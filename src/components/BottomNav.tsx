import { NavLink, useLocation } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import type { TKey } from '../lib/i18n';

const TABS: { to: string; key: TKey; icon: JSX.Element; match: string[] }[] = [
  {
    to: '/home', key: 'navHome', match: ['/home'],
    icon: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    to: '/pantry', key: 'navPantry', match: ['/pantry'],
    icon: <path d="M4 9h16l-1.6 10.2A2 2 0 0 1 16.4 21H7.6a2 2 0 0 1-2-1.8zM3 9h18M9 9l2-5M15 9l-2-5" />,
  },
  {
    to: '/history', key: 'navOrders', match: ['/history', '/order'],
    icon: <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h3" />,
  },
  {
    to: '/more', key: 'navMore', match: ['/more', '/catalogue', '/vendors', '/settings'],
    icon: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={4} />,
  },
];

export function BottomNav() {
  const { t } = useHousehold();
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {TABS.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                `flex h-[68px] flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive || tab.match.some((m) => pathname.startsWith(m)) ? 'text-brand-700' : 'text-gray-500'
                }`
              }
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {tab.icon}
              </svg>
              {t(tab.key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
