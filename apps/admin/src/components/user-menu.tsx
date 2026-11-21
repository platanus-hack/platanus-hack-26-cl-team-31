import {
  ChevronsUpDownIcon,
  FlaskConicalIcon,
  LaptopIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useTheme } from "@/components/theme-provider"
import { isMock } from "@/lib/api"
import { refreshSession, useSession } from "@/lib/session"

function initials(name: string | null, email: string) {
  const source = name ?? email
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}

export const roleLabel = { operator: "Operador", viewer: "Lector" } as const

async function setMock(patch: {
  role?: "viewer" | "operator"
  fresh?: boolean
}) {
  const { writeMockState } = await import("@/mocks/handlers")
  writeMockState(patch)
  await refreshSession()
}

function MockControls() {
  const { session } = useSession()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FlaskConicalIcon />
        Simulación (mock)
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Rol</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={session.user.role}
            onValueChange={(role) =>
              void setMock({ role: role as "viewer" | "operator" })
            }
          >
            <DropdownMenuRadioItem value="operator">
              Operador
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="viewer">Lector</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={session.session.fresh}
            onCheckedChange={(fresh) => void setMock({ fresh: fresh === true })}
          >
            Sesión fresca
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function UserMenu() {
  const { session, logout } = useSession()
  const { theme, setTheme } = useTheme()
  const { isMobile } = useSidebar()
  const { user } = session

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Avatar className="size-8 rounded-lg">
                {user.image ? (
                  <AvatarImage src={user.image} alt={user.name ?? user.email} />
                ) : null}
                <AvatarFallback className="rounded-lg">
                  {initials(user.name, user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {user.name ?? user.email}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
                <Badge
                  variant={user.role === "operator" ? "default" : "secondary"}
                >
                  {roleLabel[user.role]}
                </Badge>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Tema
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as typeof theme)}
              >
                <DropdownMenuRadioItem value="dark">
                  <MoonIcon />
                  Oscuro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <SunIcon />
                  Claro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <LaptopIcon />
                  Sistema
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            {isMock ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <MockControls />
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOutIcon />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
