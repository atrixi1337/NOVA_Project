import React from 'react'

// Catches render errors in the SPA so a single throwing component doesn't
// collapse the whole tree into a silent blank page. Renders a visible card with
// the error + component stack (and logs it) so a breakage is diagnosable from
// the browser instead of "blank." Used to wrap <App /> in main.jsx.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null, info: null }
  }
  static getDerivedStateFromError(err) {
    return { err, info: null }
  }
  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error('[Sallaapam] render error:', err, info?.componentStack)
    this.setState({ info })
  }
  render() {
    if (this.state.err) {
      const msg = this.state.err && this.state.err.toString
        ? this.state.err.toString()
        : String(this.state.err)
      return (
        <div className="fixed inset-0 bg-bg text-text p-4 overflow-auto">
          <pre className="mb-2 whitespace-pre-wrap text-[12px] text-err bg-panel2 p-3 rounded-lg border border-err/30 break-all">
            {msg}
            {this.state.info?.componentStack ? `\n\nComponent stack:\n${this.state.info.componentStack}` : ''}
          </pre>
          <p className="text-[11px] text-muted/60">
            This is a visible fallback (not a silent crash). Reload the page to retry; the
            error is also in the browser DevTools Console.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
