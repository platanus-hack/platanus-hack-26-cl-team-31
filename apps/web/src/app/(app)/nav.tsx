"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Inicio" },
  { href: "/friends", label: "Amigos" },
  { href: "/rules", label: "Reglas" },
  { href: "/agents", label: "Agentes" },
  { href: "/activity", label: "Actividad" },
  { href: "/cable", label: "El cable" },
];

export function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="-mx-1 flex flex-wrap gap-1 sm:mx-0">
      {links.map(({ href, label }) => {
        const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-[#e7eee1] text-[#28513b]" : "text-[#525e50] hover:bg-[#f0f2e9]"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
