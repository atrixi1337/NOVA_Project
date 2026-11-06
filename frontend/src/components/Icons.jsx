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
  'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zm7 12l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z'
)
export const AttachmentPaperclip = svg(
  'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48'
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

export const Gear = svg(
  'M10.725 4.317c.426-1.756 2.124-1.756 2.55 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.124 1.756-2.55 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z'
)
export const ArrowDown = svg(
  'M12 5v14m7-7l-7 7-7-7',
  { strokeWidth: 2 },
)
export const Globe = svg(
  'M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18'
)
export const Refresh = svg(
  'M21 12a9 9 0 11-2.64-6.36M21 3v6h-6',
  { strokeWidth: 2 },
)
export const Pencil = svg(
  'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-1.5-9.5l3 3L9 15l-4 1 1-4 9.5-9.5z',
  { strokeWidth: 1.5 },
)
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

export const MoreHorizontal = svg(
  'M5 12h.01M12 12h.01M19 12h.01',
  { strokeWidth: 2.5 },
)
export const Sun = svg(
  'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4m0-12.8l-1.4 1.4m-10 10l-1.4 1.4M16 12a4 4 0 11-8 0 4 4 0 018 0z'
)
export const Moon = svg(
  'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'
)
export const Pin = svg(
  'M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z'
)
export const Archive = svg(
  'M3 5h18v4H3zM5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4'
)
export const Download = svg(
  'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16'
)
export const Fork = svg(
  'M6 3v12a3 3 0 003 3h9M6 7a2 2 0 100-4 2 2 0 000 4zM18 15l3 3-3 3'
)
export const Compare = svg(
  'M4 8h13m0 0l-3-3m3 3l-3 3M20 16H7m0 0l3-3m-3 3l3 3'
)
export const Database = svg(
  'M12 3c4.42 0 8 1.34 8 3s-3.58 3-8 3-8-1.34-8-3 3.58-3 8-3zM4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6'
)
