import React from 'react';
import ReactDOM from 'react-dom/client';
import AccountShell from './AccountShell';
import './styles.css';
import './readability.css';
import './notifications.css';
import './accounts.css';
import './controls.css';
import './polish.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AccountShell />
  </React.StrictMode>,
);
