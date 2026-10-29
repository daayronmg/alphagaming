export * from 'lucide-react';
import type { LucideProps } from 'lucide-react';

/** Batuta (icono propio) */
export function Baton({ size = 24, strokeWidth = 2, ...p }: LucideProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...(p as any)}>
      <path d="M4 20 18 6" /><path d="m16 4 4 4" /><circle cx="5" cy="19" r="2" />
    </svg>
  );
}
