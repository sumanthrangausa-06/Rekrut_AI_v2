import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, X, SlidersHorizontal } from "lucide-react"

export type FilterOption = {
  id: string
  label: string
  type: "select" | "multi" | "range"
  options?: { value: string; label: string }[]
}

export type FilterBarProps = {
  searchPlaceholder?: string
  onSearch?: (query: string) => void
  filters: FilterOption[]
  activeFilters: Record<string, string | string[]>
  onFilterChange: (id: string, value: string | string[]) => void
  onClearFilters: () => void
  className?: string
}

export function FilterBar({
  searchPlaceholder = "Search...",
  onSearch,
  filters,
  activeFilters,
  onFilterChange,
  onClearFilters,
  className,
}: FilterBarProps) {
  const [search, setSearch] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  const activeCount = Object.values(activeFilters).filter(
    (v) => v !== "" && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  ).length

  const handleSearch = (value: string) => {
    setSearch(value)
    onSearch?.(value)
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-1"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {activeCount}
              </Badge>
            )}
          </Button>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1">
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border bg-card p-3">
          {filters.map((filter) => (
            <div key={filter.id} className="min-w-[160px] flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {filter.label}
              </label>
              <Select
                value={activeFilters[filter.id] as string}
                onValueChange={(value) => onFilterChange(filter.id, value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`All ${filter.label}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All {filter.label}</SelectItem>
                  {filter.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
