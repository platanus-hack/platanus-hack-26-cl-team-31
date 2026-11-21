import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { getOwnerAccount } from "@/lib/auth-owner";

import { AccountMenu } from "./account-menu";
import { Brand } from "./brand";
import { Navigation } from "./nav";

export const metadata: Metadata = {
  title: "Sideband",
  description: "Gestiona tus solicitudes, reglas y agentes en Sideband.",
};

type OwnerAccount = Awaited<ReturnType<typeof getOwnerAccount>>;

function profile({ user, address, displayName }: OwnerAccount) {
  return address ? { name: displayName || user.name || address, address, email: user.email, image: user.image } : undefined;
}

async function HeaderAccount({ account }: { account: Promise<OwnerAccount> }) {
  const value = profile(await account);
  return value && <div className="ml-auto lg:hidden"><AccountMenu account={value} compact /></div>;
}

async function Sidebar({ account }: { account: Promise<OwnerAccount> }) {
  const value = profile(await account);
  return value && (
    <aside className="lg:sticky lg:top-[68px] lg:flex lg:h-[calc(100dvh-68px)] lg:w-[220px] lg:shrink-0 lg:flex-col lg:pt-6 lg:pb-4">
      <Navigation />
      <div className="mt-auto hidden lg:block"><AccountMenu account={value} /></div>
    </aside>
  );
}

// Not async on purpose: awaiting the account here would hold back the page, so its data would only
// start loading after the account arrived. Both now load in parallel and still appear together,
// because the only Suspense boundary is the one around Workspace.
function Workspace({ children }: { children: ReactNode }) {
  const account = getOwnerAccount();

  return (
    <>
      <header className="sticky top-0 z-20 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1220px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Sideband, inicio" className="rounded-full"><Brand /></Link>
          <HeaderAccount account={account} />
        </div>
      </header>
      <div className="mx-auto flex max-w-[1220px] flex-col gap-6 px-4 pb-20 sm:px-6 lg:flex-row lg:gap-14">
        <Sidebar account={account} />
        <main id="contenido" className="min-w-0 flex-1 pt-4 lg:pt-8">{children}</main>
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <a href="#contenido" className="sr-only rounded-full bg-menu px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:z-30 focus:m-3">Saltar al contenido</a>
      <Suspense fallback={<p role="status" className="mx-auto max-w-[1220px] px-6 py-10 text-[13px] text-muted">Cargando…</p>}>
        <Workspace>{children}</Workspace>
      </Suspense>
    </div>
  );
}
