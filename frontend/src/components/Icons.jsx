import React from 'react'

/**
 * Shared, theme-consistent SVG icon set.
 *
 * All icons use a 24x24 viewBox + `stroke="currentColor"` so they inherit the
 * surrounding text color — matching the existing icon style used in Header /
 * Sidebar. This replaces the previous mix of emoji characters (✨📎✕🧠🛠📊)
 * and inline SVGs, giving the UI a single, polished visual language.
 */

const svg = (path, extra = {}) => ({ className = 'w-5 h-5', ...props }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...extra}
    {...props}
  >
    {React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: extra.strokeWidth || 1.5,
      d: path,
    })}
  </svg>
)

export const Sparkle = svg(
  'M12 3v2.531m3.447-.369 1.782-1.742.912 3.365-2.325 2.289 2.325 2.29-1.168 3.187-3.447-1.781V12m-9.367 9h3.465M4 18l2.98-6.07 2.98 1.47-2.98 6.07zM15.5 11.5a1 1 0 11-2 0 1 1 0 012 0z'
)
export const AttachmentPaperclip = svg(
  'M16.41 13.69l-3.5-3.5a.75.75 0 00-1.06 0L9 13.188V17a.75.75 0 00.75.75h1.5a.75.75 0 00.75-.75v-2.79l2.82-2.82a2.75 2.75 0 00-3.89-3.89l-3.5 3.5'
)
export const Remove = svg(
  'M6 18L18 6M6 6l12 12',
  { strokeWidth: 2 },
)
export const Copy = svg(
  'M16 3.55v1.694a1.694 1.694 0 01-1.695 1.695h-1.61a1.694 1.694 0 01-1.695-1.695V3.55a1.694 1.694 0 011.695-1.695h2.21a1.694 1.694 0 011.695 1.695zM12 8.75v8.5a.75.75 0 001.5 0v-8.5a.75.75 0 00-1.5 0zM7.75 5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z'
)
export const Check = svg(
  'M4.5 12.75l5 5 7-7',
  { strokeWidth: 2 },
)
export const Send = svg(
  'M6 12h12M12 6l6 6-6 6',
  { strokeWidth: 2 },
)
export const SendSolid = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 13l8-8v5h6v-5l8 8H3z" />
  </svg>
)
export const Brain = svg(
  'M12 7.5v6m6-3a6 6 0 11-12 0 6 6 0 0112 0z'
)
export const Wrench = svg(
  'M11.995 16.5a4.5 4.5 0 01-4.49-4.49 4.5 4.5 0 118.98 0 4.5 4.5 0 01-4.49 4.49z'
)
export const ToolTrace = svg(
  'M11.995 16.5a4.5 4.5 0 01-4.49-4.49 4.5 4.5 0 118.98 0 4.5 4.5 0 01-4.49 4.49zm4.05-11.05a.75.75 0 00-1.06 0l-2 2a.75.75 0 101.06 1.06l2-2a.75.75 0 000-1.06z'
)
export const ChartBar = svg(
  'M9 19V10m3 9v-4m3 4v-6M4 19h16'
)
export const Search = svg(
  'M21 21l-4.35-4.35M9.5 18a8.5 8.5 0 110-17 8.5 8.5 0 010 17z'
)
export const Clock = svg(
  'M12 8v4l2 2'
)
export const Plus = svg(
  'M12 5v14m7-7H5',
  { strokeWidth: 2 },
)
export const ChevronDown = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)
export const ChevronLeft = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
)
export const ChevronRight = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)
export const X = Remove

export const Shield = ({ className = 'w-5 h-5' }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M12 2l7 3v5c0 4.42-3.06 8.23-7 9.73C8.06 15.23 5 11.42 5 10V5l7-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M9 12l2 2 3-3" />
  </svg>
)
