import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './editor/App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/player.css';
import './styles/editor.css';
import './styles/scenes.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
