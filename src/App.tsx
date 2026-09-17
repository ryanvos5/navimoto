import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/useAuth';
import { useSettings } from '@/store/useSettings';
import { useRides } from '@/store/useRides';
import { TabBar } from '@/components/TabBar';
import { Spinner } from '@/components/ui/Spinner';
import { ToastViewport } from '@/components/ui/Toast';

// Alle pagina's hebben een default export.
const MapPage = lazy(() => import('@/pages/MapPage'));
const RidesPage = lazy(() => import('@/pages/RidesPage'));
const RouteDetailPage = lazy(() => import('@/pages/RouteDetailPage'));
const TrackDetailPage = lazy(() => import('@/pages/TrackDetailPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const NavigationPage = lazy(() => import('@/pages/NavigationPage'));

function FullScreenSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <Spinner size="lg" />
    </div>
  );
}

/** Start auth en laadt profiel + ritten zodra er een gebruiker is. */
function Bootstrap({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    void useAuth.getState().init();
  }, []);

  useEffect(() => {
    if (user) {
      void useSettings.getState().load(user);
      void useRides.getState().load(user.id);
    } else {
      useSettings.getState().clear();
      useRides.getState().clear();
    }
  }, [user]);

  if (status === 'loading') return <FullScreenSpinner />;
  return <>{children}</>;
}

function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status !== 'signedIn') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'signedIn') return <Navigate to="/kaart" replace />;
  return <>{children}</>;
}

/**
 * Tab-layout. De kaartpagina blijft altijd gemount (MapLibre-instantie en plannerstatus blijven
 * behouden bij het wisselen van tab); andere tabs renderen via <Outlet/>.
 */
function TabLayout() {
  const { pathname } = useLocation();
  const mapActive = pathname === '/kaart' || pathname.startsWith('/kaart/');
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="relative min-h-0 flex-1">
        <div className={mapActive ? 'absolute inset-0' : 'invisible pointer-events-none absolute inset-0'} aria-hidden={!mapActive}>
          <Suspense fallback={<FullScreenSpinner />}>
            <MapPage active={mapActive} />
          </Suspense>
        </div>
        {!mapActive && (
          <div className="absolute inset-0 overflow-y-auto">
            <Suspense fallback={<FullScreenSpinner />}>
              <Outlet />
            </Suspense>
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Bootstrap>
        <Suspense fallback={<FullScreenSpinner />}>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfSignedIn>
                  <LoginPage />
                </RedirectIfSignedIn>
              }
            />
            <Route element={<RequireAuth />}>
              <Route path="/rijden" element={<NavigationPage />} />
              <Route element={<TabLayout />}>
                <Route path="/kaart" element={null} />
                <Route path="/ritten" element={<RidesPage />} />
                <Route path="/ritten/route/:id" element={<RouteDetailPage />} />
                <Route path="/ritten/rit/:id" element={<TrackDetailPage />} />
                <Route path="/profiel" element={<ProfilePage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/kaart" replace />} />
          </Routes>
        </Suspense>
        <ToastViewport />
      </Bootstrap>
    </BrowserRouter>
  );
}
