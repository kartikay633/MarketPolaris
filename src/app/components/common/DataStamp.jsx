// Small freshness tag for a market-data block: 'Live', 'As of 16 Oct close' or 'End of day · 16 Oct'.
import React from 'react';
import { dataStamp } from '../../utils/formatters';

export default function DataStamp({ source, asOf, isOpen, className = '' }) {
  const label = dataStamp(source, asOf, isOpen);
  if (!label) return null;
  const live = label === 'Live';
  return (
    <span className={`fd-lbl fd-stamp${live ? ' fd-stamp--live' : ''}${className ? ` ${className}` : ''}`} title={asOf ? `Data as of ${asOf}` : undefined}>
      {label}
    </span>
  );
}
