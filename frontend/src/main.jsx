import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './index.css'
import './theme-breeze.css'
import App from './App.jsx'
import { getToken } from './api'
import { applyStoredTheme } from './theme'

if (getToken()) applyStoredTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
