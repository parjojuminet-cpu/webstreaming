import React, { useState } from 'react';
import { Film } from 'lucide-react';

interface MediaImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  loading?: 'eager' | 'lazy';
}

export const MediaImage: React.FC<MediaImageProps> = ({
  src,
  alt,
  className = '',
  fallbackTitle,
  loading = 'lazy',
}) => {
  const [hasError, setHasError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center bg-gradient-to-br from-[#1B1C27] via-[#151621] to-[#11121A] border border-white/10 text-[#A5A6B2] p-4 ${className}`}
        role="img"
        aria-label={alt}
      >
        <Film className="w-7 h-7 text-[#A78BFA]/70 mb-2" aria-hidden="true" />
        {fallbackTitle && (
          <span className="text-xs font-medium text-center text-[#A5A6B2] line-clamp-2 max-w-[180px]">
            {fallbackTitle}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#1B1C27] ${className}`}>
      {!loaded && (
        <div
          className="absolute inset-0 bg-[#1B1C27] animate-pulse"
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
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
