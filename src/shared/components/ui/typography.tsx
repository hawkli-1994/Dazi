import type { ComponentProps } from 'react';
import { cn } from './button';
export function Title({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 className={cn('page-title', className)} data-testid="page-title" {...props} />;
}
export function SectionTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('section-title', className)} {...props} />;
}
export function Muted({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('muted', className)} {...props} />;
}
