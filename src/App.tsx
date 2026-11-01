import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useHousehold } from './lib/household';
import { listenForeground } from './lib/push';
import { BottomNav } from './components/BottomNav';
import { OfflineBanner, ToastHost } from './components/ui';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Join from './pages/Join';
import Home from './pages/Home';
import OrderPage from './pages/Order';
import OrderCheck from './pages/OrderCheck';
import Pantry from './pages/Pantry';
import Catalogue from './pages/Catalogue';
import Vendors from './pages/Vendors';
import History from './pages/History';
import Settings from './pages/Settings';
import More from './pages/More';

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <img src="/icons/icon.svg" alt="SabziList" className="h-20 w-20 animate-pulse" />
    </div>
  );
}

/** Requires sign-in and a household. */
function Gate() {
  const { user, authReady, householdId, householdReady } = useHousehold();
  const loc = useLocation();
  if (!authReady) return <Splash />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!householdReady) return <Splash />;
  if (!householdId) return <Navigate to="/setup" replace />;
  return (
    <>
      <OfflineBanner />
      <Outlet />
      <BottomNav />
      <ToastHost />
    </>
  );
}

export default function App() {
  const { householdId } = useHousehold();
  useEffect(() => {
    if (householdId) listenForeground();
  }, [householdId]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/join/:code" element={<Join />} />
      <Route element={<Gate />}>
        <Route path="/home" element={<Home />} />
        <Route path="/order/:id" element={<OrderPage />} />
        <Route path="/order/:id/check" element={<OrderCheck />} />
        <Route path="/pantry" element={<Pantry />} />
        <Route path="/catalogue" element={<Catalogue />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/more" element={<More />} />
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
