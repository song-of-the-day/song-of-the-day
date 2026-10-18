import { useState } from 'react';

import type { PublicProfile, Theme, User } from '@/api/types';
import { Backdrop } from '@/components/theme/Backdrop';
import { useThemeVars } from '@/components/theme/useThemeVars';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { AccountDialog } from '@/features/account/AccountDialog';
import { BoardView } from '@/features/board/BoardView';
import { CalendarView } from '@/features/calendar/CalendarView';
import { CustomizeSheet } from '@/features/customize/CustomizeSheet';
import { EntryDetailDialog } from '@/features/entries/EntryDetailDialog';
import { LogEntryDialog } from '@/features/entries/LogEntryDialog';
import { useToday } from '@/hooks/useToday';
import { cn } from '@/lib/cn';

import { ProfileDock } from './ProfileDock';
import { ProfileHeader } from './ProfileHeader';
import { profileTitle } from './profileTitle';
import { ProfileToolbar } from './ProfileToolbar';
import { TodayPlayer } from './TodayPlayer';
import { useProfileParams } from './useProfileParams';

export interface ProfilePageProps {
  /** The public profile at `/<username>`. */
  profile: PublicProfile;
  /** The logged-in viewer, or `null` for a logged-out visitor. */
  viewer: User | null;
}

/**
 * `/<username>`: the themed page — header, toolbar and the Calendar or Board
 * view (`?view`, else the theme's `default_view`) — plus the entry dialog (`?entry=<id>`). When
 * today has a song with a licensed player, a "today's song" strip under the header plays it on
 * load. In owner mode (the viewer's own username) the header adds [Share], a floating footer dock
 * holds [Customize] and [Account], and a newly logged song opens in the entry dialog; while the
 * customize sheet is open, its draft theme previews live on the whole page. In visitor mode it is
 * read-only, and the header carries the home-linked wordmark and, for logged-out visitors,
 * [Log in] / [Start your own] (there is no separate top bar).
 */
export function ProfilePage({ profile, viewer }: ProfilePageProps): React.JSX.Element {
  const { username } = profile;
  const owner = viewer !== null && viewer.username === username;
  const readOnly = !owner;
  const today = useToday();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  /** The date the log dialog starts on; `null` leaves it empty for the user to pick. */
  const [logDate, setLogDate] = useState<string | null>(null);
  const [preview, setPreview] = useState<Theme | null>(null);
  const theme = (owner ? preview : null) ?? profile.theme;
  useThemeVars(theme);
  const params = useProfileParams(theme.default_view, today);

  /** Opens the log dialog; a `null` date (the [Log a day] button) means "pick one". */
  function openLog(date: string | null) {
    setLogDate(date);
    setLogOpen(true);
  }

  function logToday() {
    openLog(today);
  }

  return (
    <>
      <DocumentTitle title={profileTitle(profile)} />
      <Backdrop background={theme.background} />
      <div
        className={cn(
          'mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6',
          // Leave room for the floating dock so it never covers the last of the page.
          owner && 'pb-24 sm:pb-28',
        )}
      >
        <ProfileHeader profile={profile} isOwner={owner} loggedIn={viewer !== null} />
        {/* Logged-out visitors always auto-play; a logged-in viewer follows their own preference. */}
        <TodayPlayer
          username={username}
          today={today}
          autoPlay={viewer === null ? true : viewer.autoplay_previews}
        />
        <main className="flex flex-col gap-3 sm:gap-4">
          <ProfileToolbar
            username={username}
            readOnly={readOnly}
            today={today}
            view={params.view}
            onViewChange={params.setView}
            onLogToday={logToday}
            onLogDay={() => {
              openLog(null);
            }}
            onOpenEntry={params.openEntry}
          />
          {params.view === 'board' ? (
            <BoardView
              username={username}
              readOnly={readOnly}
              cardStyle={theme.card_style}
              onOpenEntry={params.openEntry}
              onLogToday={logToday}
            />
          ) : (
            <CalendarView
              username={username}
              readOnly={readOnly}
              month={params.month}
              today={today}
              onMonthChange={params.setMonth}
              onOpenEntry={params.openEntry}
              onLogDate={openLog}
            />
          )}
        </main>
      </div>
      {/*
        Rendered whenever the viewer owns the page — never conditionally on the sheets/dialogs:
        the dock holds the buttons that open them, so unmounting it on open would strip the
        focused trigger and drop focus to <body> on close (Radix restores focus to the opener).
        While a modal is open it sits, inert, behind the overlay; the non-modal customize sheet
        covers it on phones and sits beside it on wider screens.
      */}
      {owner && (
        <ProfileDock
          onCustomize={() => {
            setCustomizeOpen(true);
          }}
          onAccount={() => {
            setAccountOpen(true);
          }}
        />
      )}
      <EntryDetailDialog
        username={username}
        entryId={params.entryId}
        onClose={params.closeEntry}
        readOnly={readOnly}
      />
      {/*
        The owner's dialogs stay mounted for any logged-in viewer (they render nothing while
        closed, and only owner controls open them), so a username change, which briefly makes
        the old URL a visitor page, doesn't unmount an open sheet mid-save.
      */}
      {viewer !== null && (
        <>
          <LogEntryDialog
            open={logOpen}
            initialDate={logDate ?? undefined}
            onOpenChange={(open) => {
              if (!open) {
                setLogOpen(false);
              }
            }}
            onSaved={(saved) => {
              params.openEntry(saved.id);
            }}
            onOpenExisting={params.openEntry}
          />
          <CustomizeSheet
            open={customizeOpen}
            onOpenChange={(open) => {
              setCustomizeOpen(open);
              if (!open) {
                setPreview(null);
              }
            }}
            onPreviewChange={setPreview}
          />
          <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
        </>
      )}
    </>
  );
}
