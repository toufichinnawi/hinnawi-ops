/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

export type LocationCode = 'PK' | 'MK' | 'ONT' | 'CT' | 'FAC';

export const LOCATION_COLORS: Record<string, string> = {
  PK: '#3b82f6',
  MK: '#10b981',
  ONT: '#f59e0b',
  CT: '#8b5cf6',
  FAC: '#ef4444',
};

export const LOCATION_LABELS: Record<string, string> = {
  PK: 'President Kennedy',
  MK: 'Mackay',
  ONT: 'Ontario',
  CT: 'Cathcart Tunnel',
  FAC: 'Factory',
};
