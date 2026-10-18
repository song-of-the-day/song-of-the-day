import { Button } from '@/components/ui/Button';
import { CenteredPage } from '@/components/ui/CenteredPage';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { TEXT_LINK_CLASS_NAME } from '@/components/ui/TextLink';
import { Window } from '@/components/ui/Window';

function reloadPage(): void {
  window.location.reload();
}

export interface ErrorFallbackProps {
  /** Reloads the app (defaults to a full page reload). */
  onReload?: () => void;
}

/**
 * The friendly screen shown when rendering fails unexpectedly. It works without the router or
 * query client (it may replace them), so "go home" is a plain link that reloads the app.
 */
export function ErrorFallback({ onReload = reloadPage }: ErrorFallbackProps) {
  return (
    <CenteredPage>
      <DocumentTitle title="Something went wrong" />
      <Window
        title="something went wrong ✦"
        headingLevel={1}
        className="w-full max-w-sm"
        bodyClassName="flex flex-col gap-4 p-6"
      >
        <p className="text-sm text-fg">
          This page hit a snag and couldn&apos;t load. Your journal is safe; reloading usually fixes
          it.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button onClick={onReload}>Reload page</Button>
          <a href="/" className={`${TEXT_LINK_CLASS_NAME} text-sm`}>
            Go to the start page
          </a>
        </div>
      </Window>
    </CenteredPage>
  );
}
