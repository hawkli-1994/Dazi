'use client';

import * as React from 'react';

import { Paper, type PaperProps } from '@/components/ui/paper';
import { usePaperDecor } from '@/hooks/use-paper-object';
import type { EdgeSpec } from '@/lib/ink/paper/edges';
import { useInk, useMergedRef } from '@/lib/ink/react';
import { pageRecipe, type PageHoles } from '@/lib/ink/recipes/page-ink';
import { titleMarkRecipe, type TitleMark } from '@/lib/ink/recipes/paper-set-ink';
import { cn } from '@/lib/utils';

type PageElement = 'div' | 'main' | 'article' | 'section' | 'form';
type PageWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

type PageProps = Omit<PaperProps, 'as' | 'edge'> & {
  as?: PageElement;
  width?: PageWidth;
  holes?: PageHoles | boolean;
  reinforced?: boolean;
  stain?: boolean;
  torn?: boolean | 'top' | 'bottom' | 'both';
  edge?: EdgeSpec;
};

const WIDTH: Record<PageWidth, string> = {
  sm: 'max-w-lg',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-none',
};

function tornEdge(torn: PageProps['torn']): EdgeSpec | undefined {
  if (!torn) return undefined;
  if (torn === 'both') return { top: 'torn', bottom: 'torn' };
  if (torn === 'bottom') return { bottom: 'torn' };
  return { top: 'torn' };
}

function Page({
  className,
  children,
  ref,
  as = 'div',
  width = 'md',
  holes: holesProp = false,
  reinforced = false,
  stain = false,
  torn,
  edge,
  tilt,
  seed,
  size,
  style,
  ...props
}: PageProps) {
  const holes: PageHoles = holesProp === true ? 'start' : holesProp || 'none';
  const o = usePaperDecor({
    recipe: pageRecipe,
    params: { holes, reinforce: reinforced, stain },
    kind: 'page',
    ref,
    seed,
    tilt,
    tiltMax: 0.35,
    size,
    enabled: holes !== 'none' || stain,
  });
  return (
    <Paper
      data-slot="page"
      data-holes={holes === 'none' ? undefined : holes}
      as={as}
      edge={edge ?? tornEdge(torn)}
      size={size}
      {...o.paper}
      {...props}
      className={cn(
        o.paper.className,
        'mx-auto flex w-full flex-col gap-6 px-6 py-8 text-foreground sm:px-10 sm:py-10 rtl:[&>[data-slot=paper-rules]]:-scale-x-100',
        holes === 'start' && 'ps-14 sm:ps-[4.25rem]',
        holes === 'top' && 'pt-14 sm:pt-16',
        WIDTH[width],
        className,
      )}
      style={{ ...o.paper.style, ...style }}
    >
      {o.decor}
      {children}
    </Paper>
  );
}

function PageHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="page-header" className={cn('flex flex-col gap-2', className)} {...props} />
  );
}

type PageTitleProps = React.ComponentProps<'h1'> & {
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'div';
  underline?: TitleMark | 'none';
  seed?: string | number;
};

function PageTitle({
  className,
  children,
  ref,
  as = 'h1',
  underline = 'single',
  seed,
  ...props
}: PageTitleProps) {
  const Comp = as as React.ElementType;
  const drawn = underline !== 'none';
  const { hostRef, hostProps, node } = useInk({
    recipe: titleMarkRecipe,
    params: { kind: drawn ? underline : 'single' },
    kind: 'mark',
    seed,
    still: true,
  });
  const merged = useMergedRef<HTMLElement>(
    drawn ? hostRef : undefined,
    ref as React.Ref<HTMLElement>,
  );
  return (
    <Comp
      data-slot="page-title"
      ref={merged}
      {...(drawn && node ? hostProps : {})}
      className={cn(
        'relative isolate w-fit font-script text-[2.6rem] leading-[1.08] font-bold text-balance pb-1.5',
        className,
      )}
      {...props}
    >
      {drawn ? node : null}
      {children}
    </Comp>
  );
}

function PageDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="page-description"
      className={cn('max-w-prose text-base text-muted-foreground', className)}
      {...props}
    />
  );
}

function PageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-content"
      className={cn('flex flex-1 flex-col gap-4', className)}
      {...props}
    />
  );
}

function PageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-footer"
      className={cn(
        'mt-auto flex items-center justify-between gap-4 pt-2 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Page, PageHeader, PageTitle, PageDescription, PageContent, PageFooter };
export type { PageProps, PageTitleProps };
