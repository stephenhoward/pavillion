/**
 * The settings layout renders exactly one page header, so its h1 is the one
 * match for this selector. Callers that move focus to the page title (the
 * skip control, the resize-down handler, the page-mode focus rule) go through
 * {@link focusSettingsHeading} rather than wiring a ref through the layout.
 */
export const SETTINGS_HEADING_SELECTOR = '.settings-page-header__title';

/** Move focus to the settings page heading, if one is rendered. */
export function focusSettingsHeading(): void {
  document.querySelector<HTMLElement>(SETTINGS_HEADING_SELECTOR)?.focus();
}
