import * as React from "react"
import { ClockIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react"
import { Link, Outlet, useMatches, type UIMatch } from "react-router"
import { Window } from "@shared/contract"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { useTheme } from "@/components/theme-provider"
import { windowLabel, useTimeWindow } from "@/lib/window"

export type Crumb = { label: string; to?: string; mono?: boolean }
export type RouteHandle = {
  crumbs: (params: Record<string, string | undefined>) => Crumb[]
}

function useCrumbs(): Crumb[] {
  const matches = useMatches() as UIMatch<unknown, RouteHandle | undefined>[]
  const last = [...matches].reverse().find((m) => m.handle?.crumbs)
  return last?.handle?.crumbs(last.params) ?? []
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" && document.documentElement.classList.contains("dark"))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Cambiar tema"
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Cambiar tema <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function WindowSelect() {
  const { window, setWindow } = useTimeWindow()
  return (
    <Select
      value={window}
      onValueChange={(value) => setWindow(value as Window)}
    >
      <SelectTrigger
        size="sm"
        className="font-mono text-xs"
        aria-label="Ventana de tiempo"
      >
        <ClockIcon />
        <SelectValue>{window}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {Window.options.map((option) => (
            <SelectItem key={option} value={option}>
              <span className="font-mono text-xs">{option}</span>
              <span className="text-muted-foreground">
                {windowLabel[option]}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function AppLayout() {
  const [commandOpen, setCommandOpen] = React.useState(false)
  const crumbs = useCrumbs()
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur md:rounded-t-xl">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 hidden data-[orientation=vertical]:h-4 sm:block"
          />
          <Breadcrumb className="hidden min-w-0 sm:block">
            <BreadcrumbList className="flex-nowrap">
              {crumbs.map((crumb, i) => (
                <React.Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem className="min-w-0">
                    {crumb.to && i < crumbs.length - 1 ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage
                        className={
                          crumb.mono ? "truncate font-mono text-xs" : "truncate"
                        }
                      >
                        {crumb.label}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-9 justify-start text-muted-foreground sm:w-64 lg:w-80"
              onClick={() => setCommandOpen(true)}
              aria-label="Buscar"
            >
              <SearchIcon data-icon="inline-start" />
              <span className="hidden truncate font-normal sm:inline">
                Buscar request, trace, error, persona…
              </span>
              <KbdGroup className="ml-auto hidden sm:inline-flex">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            </Button>
            <WindowSelect />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </SidebarProvider>
  )
}
