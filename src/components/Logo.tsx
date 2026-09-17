export interface LogoProps {
  /** Hoogte van het woordmerk in px (breedte is ~4,7x de hoogte). */
  size?: number;
  /** Behouden voor compatibiliteit; het logo is altijd het woordmerk. */
  withWordmark?: boolean;
  className?: string;
}

/** Officiële Navimoto-woordmerk (wit met rode i-punt), zie public/brand/. */
export function Logo({ size = 40, className = '' }: LogoProps) {
  const src = `${import.meta.env.BASE_URL}brand/navimoto-wordmark.svg`;
  return (
    <img
      src={src}
      alt="Navimoto"
      height={size}
      width={Math.round(size * (750 / 160))}
      className={`inline-block select-none ${className}`}
      style={{ height: size, width: 'auto' }}
      draggable={false}
    />
  );
}
