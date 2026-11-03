import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Title({ className, ...props }: ComponentProps<'h1'>) {
  return (
    <h1
      className={cn(
        'font-script text-[2rem] leading-tight font-semibold text-foreground',
        className,
      )}
      data-testid="page-title"
      {...props}
    />
  );
}

export function SectionTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn(
        'font-hand text-sm font-bold tracking-wide text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Muted({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
  );
}
