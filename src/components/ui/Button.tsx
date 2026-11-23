import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#7957ED] hover:bg-[#6743DF] text-[#F5F5F7] shadow-sm shadow-[#7957ED]/20 border border-transparent',
  secondary:
    'bg-[#1B1C27] hover:bg-[#242636] text-[#F5F5F7] border border-white/10',
  outline:
    'bg-transparent hover:bg-white/5 text-[#F5F5F7] border border-white/15 hover:border-[#A78BFA]/50',
  ghost:
    'bg-transparent hover:bg-white/5 text-[#A5A6B2] hover:text-[#F5F5F7] border border-transparent',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] sm:min-h-[40px] px-4 py-2 text-xs font-semibold gap-1.5',
  md: 'min-h-[44px] px-5 py-2.5 text-sm font-semibold gap-2',
  lg: 'min-h-[48px] px-6 py-3 text-sm font-semibold gap-2.5',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}) => {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center rounded-xl sm:rounded-lg whitespace-nowrap shrink-0 active:scale-[0.98] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] focus-visible:ring-offset-2 focus-visible:ring-offset-[#11121A] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <span
          className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!isLoading && rightIcon}
    </button>
  );
};
