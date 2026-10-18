import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const variants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      attention: 'button-attention',
      danger: 'button-danger',
    },
    size: { default: '', icon: 'button-icon', small: 'button-small' },
  },
  defaultVariants: { variant: 'secondary', size: 'default' },
});
export function Button({
  className,
  variant,
  size,
  ...props
}: BaseButton.Props & VariantProps<typeof variants>) {
  return <BaseButton className={cn(variants({ variant, size }), className)} {...props} />;
}
