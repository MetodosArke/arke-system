import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  onAddNew?: (value: string) => Promise<void> | void;
  addNewLabel?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Selecione...",
  onAddNew,
  addNewLabel = "Adicionar",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

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
      onValueChange(search.trim());
      setSearch("");
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  const handleSelect = (opt: string) => {
    onValueChange(opt);
    setSearch("");
    setOpen(false);
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
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between font-normal"
        onClick={() => setOpen(!open)}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

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
                  value === opt && "bg-accent"
                )}
                onClick={() => handleSelect(opt)}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    value === opt ? "opacity-100" : "opacity-0"
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
