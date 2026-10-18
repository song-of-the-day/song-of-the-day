import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { createAppRouter } from './app/router';
import './styles/fonts';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element in index.html');
}

const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
