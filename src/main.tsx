import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { HouseholdProvider } from './lib/household';
import './index.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <HouseholdProvider>
        <App />
      </HouseholdProvider>
    </BrowserRouter>
  </StrictMode>,
);
