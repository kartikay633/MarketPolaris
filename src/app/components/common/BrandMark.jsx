// Vector brand mark — the same paths the 3D intro extrudes, so the app and the intro share one logo.
import React from 'react';
import { CONFIG } from '../../../intro/config';

export default function BrandMark({ className, title }) {
  return (
    <svg
      className={className}
      viewBox="-5.2 -4.1 10.4 8.2"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <g transform="scale(1,-1)">
        <path d={CONFIG.logo.whitePath} fill="currentColor" />
        <path d={CONFIG.logo.bluePath} fill={CONFIG.colors.blueHex} />
      </g>
    </svg>
  );
}
