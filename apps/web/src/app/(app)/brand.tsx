export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em] text-ink ${className}`}>
      <svg aria-hidden="true" width="22" height="14" viewBox="0 0 22 14" fill="none">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="15" cy="7" r="6" fill="var(--color-accent)" fillOpacity="0.9" />
      </svg>
      <span>Nexo</span>
    </span>
  );
}
