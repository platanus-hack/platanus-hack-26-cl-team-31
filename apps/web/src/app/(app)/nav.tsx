"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Inicio" },
  { href: "/contacts", label: "Contactos" },
  { href: "/circles", label: "Círculos" },
  { href: "/agents", label: "Agentes" },
  { href: "/activity", label: "Actividad" },
  { href: "/cable", label: "El cable" },
];

export function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="-mx-1 flex flex-wrap gap-0.5 sm:mx-0">
      {links.map(({ href, label }) => {
        const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 ${active ? "bg-white/6 text-ink" : "text-muted hover:bg-white/6 hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
