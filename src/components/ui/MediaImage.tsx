import React, { useEffect, useState } from 'react';
import { Film } from 'lucide-react';

interface MediaImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  loading?: 'eager' | 'lazy';
  fit?: 'cover' | 'contain';
  transparentBg?: boolean;
}

export const MediaImage: React.FC<MediaImageProps> = ({
  src,
  alt,
  className = '',
  fallbackTitle,
  loading = 'lazy',
  fit = 'cover',
  transparentBg = false,
}) => {
  const [hasError, setHasError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setHasError(false);
    setLoaded(false);
  }, [src]);

  if (hasError || !src) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 p-4 ${className}`}
        role="img"
        aria-label={alt}
      >
        <Film className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mb-2" aria-hidden="true" />
        {fallbackTitle && (
          <span className="text-xs font-medium text-center text-slate-600 dark:text-slate-300 line-clamp-2 max-w-[180px]">
            {fallbackTitle}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${
        transparentBg
          ? 'bg-transparent'
          : fit === 'contain'
          ? 'bg-slate-950'
          : 'bg-slate-100 dark:bg-slate-800'
      } ${className}`}
    >
      {!loaded && (
        <div
          className="absolute inset-0 bg-slate-200 dark:bg-slate-800 animate-pulse"
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading={loading}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setHasError(true)}
        className={`w-full h-full ${
          fit === 'contain' ? 'object-contain' : 'object-cover'
        } transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
