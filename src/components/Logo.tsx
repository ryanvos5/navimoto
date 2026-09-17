export interface LogoProps {
  /** Grootte van het beeldmerk in px; het woordmerk schaalt mee. */
  size?: number;
  withWordmark?: boolean;
}

/**
 * Navimoto-logo: hetzelfde beeldmerk als public/icons/icon.svg (donker afgerond vierkant,
 * rode S-bocht, witte pijlpunt naar rechtsboven), optioneel met het woordmerk "Navimoto".
 */
export function Logo({ size = 40, withWordmark = true }: LogoProps) {
  return (
    <span className="inline-flex items-center" style={{ fontSize: size * 0.5, gap: size * 0.2 }}>
      <svg
        viewBox="0 0 512 512"
        width={size}
        height={size}
        className="shrink-0"
        role={withWordmark ? undefined : 'img'}
        aria-label={withWordmark ? undefined : 'Navimoto'}
        aria-hidden={withWordmark || undefined}
      >
        {/* Donkere afgeronde achtergrond; dunne rand zodat het vierkant ook op de donkere app-achtergrond zichtbaar is */}
        <rect x="4" y="4" width="504" height="504" rx="94" fill="#0b1220" stroke="#2a3852" strokeWidth="8" />
        {/* Route: S-bocht van linksonder naar rechtsboven */}
        <path
          d="M132 396 C132 236 136 246 256 246 C336 246 336 172 378 130"
          fill="none"
          stroke="#e2131d"
          strokeWidth="58"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Pijlpunt die naar rechtsboven wijst */}
        <path d="M299 117 L391 117 L391 209" fill="none" stroke="#ffffff" strokeWidth="50" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withWordmark && (
        <span className="font-bold leading-none tracking-tight">
          <span className="text-ink">Navi</span>
          <span className="text-brand">moto</span>
        </span>
      )}
    </span>
  );
}
