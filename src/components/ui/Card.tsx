import React from 'react';

type CardProps = React.PropsWithChildren<{
  className?: string;
  title?: string | React.ReactNode;
  footer?: React.ReactNode;
}>;

export default function Card({ className = '', title, children, footer }: CardProps) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {title ? (
        <div className="border-b px-4 py-3 text-sm font-semibold text-gray-700">
          {title}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
      {footer ? <div className="border-t px-4 py-3">{footer}</div> : null}
    </div>
  );
}