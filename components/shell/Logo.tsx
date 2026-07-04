// Horizontal header lockup: a compact node-graph mark (brand palette) + the
// "Causent" wordmark. The full stacked logo lives at /public/logo.svg for
// marketing/favicon use; this is the purpose-built in-app header variant.

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      {/* connections */}
      <g stroke="#D4D7DC" strokeWidth="1.6">
        <line x1="9" y1="12" x2="22" y2="8" />
        <line x1="9" y1="12" x2="10" y2="27" />
        <line x1="22" y1="8" x2="31" y2="18" />
        <line x1="10" y1="27" x2="24" y2="31" />
        <line x1="31" y1="18" x2="24" y2="31" />
        <line x1="22" y1="8" x2="24" y2="31" />
      </g>
      {/* nodes */}
      <circle cx="9" cy="12" r="4.4" fill="#377DED" />
      <circle cx="22" cy="8" r="4.4" fill="#F0B73E" />
      <circle cx="31" cy="18" r="4.4" fill="#00A29C" />
      <circle cx="10" cy="27" r="4.4" fill="#00A29C" />
      <circle cx="24" cy="31" r="4.4" fill="#595959" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <LogoMark />
      <span className="text-[22px] font-semibold tracking-tight text-[#3a3d42]">
        Causent
      </span>
    </div>
  );
}
