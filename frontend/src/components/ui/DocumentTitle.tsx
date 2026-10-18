export const APP_NAME = 'song of the day';

export interface DocumentTitleProps {
  /** The page's name; omit for the bare app name. */
  title?: string;
}

/**
 * Sets the document title to "<title> · song of the day" while mounted (React hoists `<title>`
 * into `<head>`), so every route has a distinct, descriptive title.
 */
export function DocumentTitle({ title }: DocumentTitleProps) {
  return <title>{title === undefined ? APP_NAME : `${title} · ${APP_NAME}`}</title>;
}
