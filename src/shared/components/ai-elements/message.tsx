import type { ComponentProps } from 'react';
import { cn } from '../ui/button';
// ai-elements Message composition: semantic container/content/response, adapted
// to Dazi's token-only appearance. No model/provider dependency in the renderer.
export function Message({
  from,
  className,
  ...props
}: ComponentProps<'article'> & { from: 'user' | 'assistant' | 'system' }) {
  return <article className={cn('message', `message-${from}`, className)} {...props} />;
}
export function MessageContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('message-content', className)} {...props} />;
}
export function MessageResponse({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('message-response', className)} {...props} />;
}
