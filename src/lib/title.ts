/** The app name, and the one place the tab-title format is decided. */
export const APP_NAME = 'TechDecks';

/** `Two Sum | TechDecks`. The bare app name when there is nothing to qualify it. */
export function pageTitle(page?: string | null): string {
  return page ? `${page} | ${APP_NAME}` : APP_NAME;
}
