import { Download } from 'lucide-react';

import { useExportData } from '@/api/hooks/account';
import { describeApiError } from '@/api/messages';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';

import { AccountSection } from './AccountSection';
import { EXPORT_STARTED_MESSAGE } from './copy';

/** Downloads every entry, note and setting as a JSON file named by the server. */
export function ExportDataSection() {
  const toast = useToast();
  const exportData = useExportData();
  return (
    <AccountSection
      title="Export your data"
      description="Download your songs, notes and settings as a JSON file. It's yours to keep."
    >
      <FormError message={exportData.isError ? describeApiError(exportData.error) : null} />
      <Button
        variant="secondary"
        loading={exportData.isPending}
        icon={<Download aria-hidden="true" className="size-4" />}
        className="self-start"
        onClick={() => {
          exportData.mutate(undefined, {
            onSuccess: () => {
              toast.show(EXPORT_STARTED_MESSAGE, { tone: 'success' });
            },
          });
        }}
      >
        Download my data
      </Button>
    </AccountSection>
  );
}
