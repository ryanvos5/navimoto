import { NavLink } from 'react-router-dom';
import { Map, Newspaper, Route, User } from 'lucide-react';

const TABS = [
  { to: '/ritten', label: 'Ritten', Icon: Route },
  { to: '/kaart', label: 'Kaart', Icon: Map },
  { to: '/nieuws', label: 'Nieuws', Icon: Newspaper },
  { to: '/profiel', label: 'Profiel', Icon: User },
] as const;

export function TabBar() {
  return (
    <nav
      className="safe-bottom shrink-0 border-t border-line bg-surface-2"
      style={{ height: 'calc(var(--tabbar-height) + var(--safe-bottom))' }}
      aria-label="Hoofdnavigatie"
    >
      <ul className="grid h-[var(--tabbar-height)] grid-cols-4">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="min-w-0">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  isActive ? 'text-brand' : 'text-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={24} strokeWidth={isActive ? 2.5 : 2} aria-hidden />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
