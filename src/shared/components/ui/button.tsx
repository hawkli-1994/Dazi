import type { ComponentProps } from 'react';
import { Button as LooseleafButton } from '@/components/ui/button';

type LooseleafButtonProps = ComponentProps<typeof LooseleafButton>;
type LegacyVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'attention'
  | 'danger'
  | LooseleafButtonProps['variant'];
type LegacySize = 'default' | 'small' | 'icon' | LooseleafButtonProps['size'];

const variantMap = {
  primary: 'default',
  attention: 'default',
  danger: 'destructive',
  secondary: 'secondary',
  ghost: 'ghost',
} as const;

const sizeMap = {
  default: 'default',
  small: 'sm',
  icon: 'icon',
} as const;

export type ButtonProps = Omit<LooseleafButtonProps, 'variant' | 'size'> & {
  variant?: LegacyVariant;
  size?: LegacySize;
};

export function Button({ variant = 'secondary', size = 'default', ...props }: ButtonProps) {
  const mappedVariant =
    variant && variant in variantMap
      ? variantMap[variant as keyof typeof variantMap]
      : (variant as LooseleafButtonProps['variant']);
  const mappedSize =
    size && size in sizeMap
      ? sizeMap[size as keyof typeof sizeMap]
      : (size as LooseleafButtonProps['size']);
  return <LooseleafButton variant={mappedVariant} size={mappedSize} {...props} />;
}

export { cn } from '@/lib/utils';
