import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SearchableMultiSelectProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: string[];
  placeholder?: string;
  onAddNew?: (value: string) => Promise<void> | void;
  addNewLabel?: string;
}

export function SearchableMultiSelect({
  value,
  onValueChange,
  options,
  placeholder = "Selecione...",
  onAddNew,
  addNewLabel = "Adicionar",
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const searchLower = search.toLowerCase();
  const filtered = React.useMemo(
    () =>
      search
        ? options.filter((opt) => opt.toLowerCase().includes(searchLower))
        : options,
    [options, searchLower]
  );

  const showAddNew =
    onAddNew &&
    search.trim().length > 0 &&
    !options.some((opt) => opt.toLowerCase() === search.trim().toLowerCase());

  const handleAddNew = async () => {
    if (!onAddNew || !search.trim() || adding) return;
    setAdding(true);
    try {
      await onAddNew(search.trim());
      onValueChange([...value, search.trim()]);
      setSearch("");
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = (opt: string) => {
    if (value.includes(opt)) {
      onValueChange(value.filter((v) => v !== opt));
    } else {
      onValueChange([...value, opt]);
    }
  };

  const handleRemove = (opt: string) => {
    onValueChange(value.filter((v) => v !== opt));
  };

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  return (
    <div className="relative w-full">
      <div
        ref={triggerRef}
        role="combobox"
        aria-expanded={open}
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors",
          open && "ring-2 ring-ring"
        )}
        onClick={() => setOpen(!open)}
      >
        {value.length === 0 && (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        {value.map((v) => (
          <Badge
            key={v}
            variant="secondary"
            className="text-xs gap-1 pr-1"
          >
            {v}
            <button
              type="button"
              className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(v);
              }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md"
          style={{ left: 0 }}
        >
          <div className="p-2">
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
              autoFocus
            />
          </div>
          <div
            className="px-1 pb-1 overflow-y-auto"
            style={{
              maxHeight: "200px",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
              overscrollBehavior: "contain",
            }}
          >
            {filtered.length === 0 && !showAddNew && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum resultado encontrado.
              </p>
            )}
            {filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
                  value.includes(opt) && "bg-accent"
                )}
                onClick={() => handleToggle(opt)}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    value.includes(opt) ? "opacity-100" : "opacity-0"
                  )}
                />
                {opt}
              </button>
            ))}
            {showAddNew && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer text-primary hover:bg-accent transition-colors"
                onClick={handleAddNew}
                disabled={adding}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                {addNewLabel} &quot;{search.trim()}&quot;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
