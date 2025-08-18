import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  isLoading?: boolean;
};

export function Button({
  variant = 'primary',
  className = '',
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary:
      'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300 focus:ring-gray-400',
    ghost:
      'bg-transparent text-gray-700 hover:bg-gray-100 border border-transparent focus:ring-gray-300',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading ? <span className="animate-pulse">...</span> : null}
      {children}
    </button>
  );
}