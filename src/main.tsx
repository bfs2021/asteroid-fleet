import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { engine } from './game/engine';
import { App } from './ui/App';
import './ui/styles.css';

void engine.init().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
