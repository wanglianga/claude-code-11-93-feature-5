import React from 'react';
import ReactDOM from 'react-dom/client';
import Shell from './App';
import { WorldProvider } from './state/WorldContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorldProvider>
      <Shell />
    </WorldProvider>
  </React.StrictMode>,
);
