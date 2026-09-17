export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-10 w-10 border-4' : 'h-6 w-6 border-2';
  return (
    <span
      role="status"
      aria-label="Laden"
      className={`inline-block animate-spin rounded-full border-brand border-t-transparent ${dim} ${className}`}
    />
  );
}
