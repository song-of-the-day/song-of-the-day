/**
 * The route table, in React Router's library (data router) mode. Static
 * routes take precedence over `/:username`; `shared/usernames.json` reserves their names.
 */
import { createBrowserRouter, type RouteObject } from 'react-router';

import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { ProfileRoute } from '@/features/profile/ProfileRoute';

import { NotFoundPage } from './NotFoundPage';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { RootRedirect } from './RootRedirect';
import { RouteError } from './RouteError';

export const routes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RootRedirect /> },
      {
        element: <RedirectIfAuthed />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignupPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'profile', element: <RootRedirect /> },
      { path: ':username', element: <ProfileRoute /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** The app's data router. */
export type AppRouter = ReturnType<typeof createBrowserRouter>;

/**
 * Creates the app's browser router. Call it once per page load, outside React rendering.
 *
 * @returns A data router over {@link routes}.
 */
export function createAppRouter(): AppRouter {
  return createBrowserRouter(routes);
}
