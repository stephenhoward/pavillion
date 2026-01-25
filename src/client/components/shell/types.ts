import type { RouteLocationRaw } from 'vue-router';
import type { Component } from 'vue';

/**
 * Navigation item configuration
 */
export interface NavigationItem {
  /** Unique identifier for the navigation item */
  id: string;

  /** Display label for the navigation item */
  label: string;

  /** Lucide icon component */
  icon: Component;

  /** Vue Router destination */
  to: RouteLocationRaw;

  /** Optional notification badge count */
  badge?: number;
}

/**
 * Navigation item with computed active state
 */
export interface NavigationItemWithState extends NavigationItem {
  /** Whether this navigation item is currently active */
  isActive: boolean;
}

/**
 * Navigation item variant for styling
 */
export type NavItemVariant = 'sidebar' | 'bottom';
