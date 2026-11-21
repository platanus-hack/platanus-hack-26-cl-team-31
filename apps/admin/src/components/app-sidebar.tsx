import { useQuery } from "@tanstack/react-query"
import {
  BellRingIcon,
  BotIcon,
  BugIcon,
  InboxIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  RadioIcon,
  ScrollTextIcon,
  UsersIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react"
import { NavLink, useLocation } from "react-router"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { BrandMark } from "@/components/brand"
import { UserMenu } from "@/components/user-menu"
import { isMock } from "@/lib/api"
import { overviewQuery } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { useTimeWindow } from "@/lib/window"

type NavItem = {
  title: string
  to: string
  icon: LucideIcon
  operatorOnly?: boolean
  badge?: "stuck" | "errors"
}

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Observar",
    items: [
      { title: "Resumen", to: "/", icon: LayoutDashboardIcon },
      {
        title: "Solicitudes",
        to: "/solicitudes",
        icon: InboxIcon,
        badge: "stuck",
      },
      { title: "Trazas", to: "/trazas", icon: WaypointsIcon },
      { title: "En vivo", to: "/en-vivo", icon: RadioIcon },
      { title: "Flujo", to: "/flujo", icon: NetworkIcon },
      { title: "Errores", to: "/errores", icon: BugIcon, badge: "errors" },
    ],
  },
  {
    label: "Entidades",
    items: [
      { title: "Personas", to: "/personas", icon: UsersIcon },
      { title: "Agentes", to: "/agentes", icon: BotIcon },
      { title: "Avisos", to: "/avisos", icon: BellRingIcon },
    ],
  },
  {
    label: "Administración",
    items: [
      { title: "Auditoría", to: "/auditoria", icon: ScrollTextIcon },
      {
        title: "Tokens MCP",
        to: "/tokens",
        icon: KeyRoundIcon,
        operatorOnly: true,
      },
    ],
  },
]

export function AppSidebar() {
  const { isOperator } = useSession()
  const { window } = useTimeWindow()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const overview = useQuery(overviewQuery(window))

  const badgeValue = (badge: NavItem["badge"]) => {
    if (!overview.data || !badge) return 0
    return badge === "stuck"
      ? overview.data.requests.stuck
      : overview.data.errors.total
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/" onClick={() => setOpenMobile(false)}>
                <BrandMark />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Sideband Admin</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Observabilidad
                  </span>
                </div>
                {isMock ? <Badge variant="secondary">mock</Badge> : null}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const items = group.items.filter(
            (item) => !item.operatorOnly || isOperator
          )
          if (items.length === 0) return null
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active =
                      item.to === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.to)
                    const count = badgeValue(item.badge)
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                        >
                          <NavLink
                            to={item.to}
                            onClick={() => setOpenMobile(false)}
                          >
                            <item.icon />
                            <span>{item.title}</span>
                          </NavLink>
                        </SidebarMenuButton>
                        {count > 0 ? (
                          <SidebarMenuBadge className="font-mono tabular-nums">
                            {count}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
