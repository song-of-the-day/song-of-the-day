import { Link } from 'react-router';

import { buttonClassName } from '@/components/ui/buttonStyles';
import { CenteredPage } from '@/components/ui/CenteredPage';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { Window } from '@/components/ui/Window';

/** Any unknown path. */
export function NotFoundPage() {
  return (
    <CenteredPage>
      <DocumentTitle title="Page not found" />
      <Window
        title="404 ✦ page not found"
        headingLevel={1}
        className="w-full max-w-sm"
        bodyClassName="flex flex-col items-start gap-4 p-6"
      >
        <p className="text-sm text-fg">
          This page skipped a track: there&apos;s nothing at this address.
        </p>
        <Link to="/" className={buttonClassName()}>
          Take me home
        </Link>
      </Window>
    </CenteredPage>
  );
}
