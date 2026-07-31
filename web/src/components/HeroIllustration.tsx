// A flat-vector kanban board, in the same construction style as
// schloss's own castle illustration (flat filled shapes, no strokes, one
// light recess tone, one small signature accent mark borrowed from a
// sibling app's color rather than this app's own accent) - part of the
// same visual family, different subject and color.
export function HeroIllustration({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size * (110 / 140)}
      viewBox="0 0 140 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Tafel"
      className={className}
    >
      {/* Board frame */}
      <rect x="6" y="6" width="128" height="98" rx="6" fill="#d97706" />

      {/* Cards - two in progress, one in the pale "done" recess tone */}
      <rect x="18" y="20" width="32" height="42" rx="3" fill="#f59e0b" />
      <rect x="58" y="20" width="32" height="26" rx="3" fill="#f59e0b" />
      <rect x="98" y="20" width="24" height="58" rx="3" fill="#fef3c7" />

      {/* Signature dot - schloss's own violet, a small cross-service
          wink tying the illustration family together. */}
      <circle cx="34" cy="90" r="6" fill="#863bff" />
    </svg>
  )
}
