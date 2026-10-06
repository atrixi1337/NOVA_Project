import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// ErrorBoundary turns a throwing render into a VISIBLE card + console error
// instead of a silent blank page (the 2026-10-06 outage symptom).
ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)

// PWA: installable + offline app shell (see static/sw.js). The `?v=2` query
// cache-busts the registration URL so a browser that still holds the old
// nova-shell-v1 SW is forced to fetch the fresh v2 script and activate it —
// otherwise a CDN purge (which only clears the edge, not the browser) leaves
// the stale SW in place and the page stays blank. Bump this on every
// service-worker-affecting deploy.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=2').catch(() => {})
  })
}
