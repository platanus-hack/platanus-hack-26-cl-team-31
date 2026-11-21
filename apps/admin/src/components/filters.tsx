// Controles de filtro compartidos: barra en una fila, búsqueda con ícono y selección de estados.
import * as React from "react"
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  )
}

// Input con debounce: actualiza el filtro 250 ms después de dejar de escribir.
export function SearchInput({
  value,
  onChange,
  placeholder,
  mono,
  className,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  mono?: boolean
  className?: string
  label: string
}) {
  const [draft, setDraft] = React.useState(value)
  const [synced, setSynced] = React.useState(value)
  if (value !== synced) {
    setSynced(value)
    setDraft(value)
  }
  React.useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 250)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])
  return (
    <InputGroup className={cn("h-8 w-full sm:w-56", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className={cn(mono && "font-mono text-xs")}
      />
      {draft ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Limpiar"
            onClick={() => setDraft("")}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

export function MultiSelectFilter<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string
  options: readonly T[]
  value: T[]
  onChange: (value: T[]) => void
  renderOption: (option: T) => React.ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(value.length === 0 && "border-dashed")}
        >
          {label}
          {value.length ? (
            <Badge variant="secondary" className="font-mono">
              {value.length}
            </Badge>
          ) : null}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {label}
          </DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={value.includes(option)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, option]
                    : value.filter((v) => v !== option)
                )
              }
            >
              {renderOption(option)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {value.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onChange([])}>
                Limpiar selección
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ALL = "__all"

export function SelectFilter<T extends string>({
  label,
  allLabel,
  options,
  value,
  onChange,
  renderOption,
  className,
}: {
  label: string
  allLabel: string
  options: readonly T[]
  value: T | undefined
  onChange: (value: T | undefined) => void
  renderOption?: (option: T) => React.ReactNode
  className?: string
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : (next as T))}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("min-w-36", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {renderOption ? renderOption(option) : option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function ClearFilters({
  visible,
  onClear,
}: {
  visible: boolean
  onClear: () => void
}) {
  if (!visible) return null
  return (
    <Button variant="ghost" size="sm" onClick={onClear}>
      <XIcon data-icon="inline-start" />
      Limpiar
    </Button>
  )
}
