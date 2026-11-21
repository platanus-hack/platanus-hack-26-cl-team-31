import type { ReactNode } from "react";

export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-[rise_240ms_var(--ease-smooth-out)]">{children}</div>;
}
