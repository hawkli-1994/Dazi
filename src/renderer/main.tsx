import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InkProvider } from '@/lib/ink/react';
import './theme/looseleaf.css';
import './theme/dazi-app.css';
import './theme/layout.css';
import './theme/components.css';
import './theme/responsive.css';
import './theme/agent.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InkProvider textures>
      <App />
    </InkProvider>
  </StrictMode>,
);
