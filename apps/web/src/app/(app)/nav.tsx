"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const groups = [
  {
    label: "General",
    links: [
      { href: "/", label: "Inicio", icon: icon(<path d="M2.5 7 8 2.5 13.5 7v6.5h-11Z" />) },
      { href: "/activity", label: "Actividad", icon: icon(<path d="M1.5 8h3l2-5 3 10 2-5h3" />) },
      { href: "/cable", label: "El cable", icon: icon(<><circle cx="8" cy="8" r="2" /><path d="M3.5 3.5a6.4 6.4 0 0 0 0 9M12.5 3.5a6.4 6.4 0 0 1 0 9" /></>) },
    ],
  },
  {
    label: "Personas",
    links: [
      { href: "/contacts", label: "Contactos", icon: icon(<><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" /></>) },
      { href: "/circles", label: "Círculos", icon: icon(<><circle cx="6" cy="8" r="4" /><circle cx="10" cy="8" r="4" /></>) },
    ],
  },
  {
    label: "Conexiones",
    links: [
      { href: "/agents", label: "Agentes", icon: icon(<><rect x="3" y="4.5" width="10" height="8" rx="2.5" /><path d="M8 2v2.5M6 8.5h0M10 8.5h0" /></>) },
    ],
  },
];

export function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0 lg:overflow-visible lg:pb-0">
      {groups.map((group) => (
        <div key={group.label} className="flex shrink-0 gap-1 lg:mb-3 lg:flex-col lg:gap-0">
          <p className="hidden h-8 items-center px-3 text-[11px] text-subtle lg:flex">{group.label}</p>
          {group.links.map(({ href, label, icon }) => {
            const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-2 text-[13px] font-medium transition-colors duration-150 lg:h-10 ${active ? "bg-white/8 text-[#f5f5f5] pill" : "text-[#ededed] hover:bg-white/4"}`}>
                <span className={`grid size-6 place-items-center rounded-md ${active ? "bg-white/10 text-white" : "bg-white/6 text-white/70"} tag`}>{icon}</span>
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
