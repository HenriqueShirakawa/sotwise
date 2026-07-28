"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.id === value);
  const filtered = options
    .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-white px-3 text-sm"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className={selected ? "text-slate-800" : "text-muted-foreground"}>
            {selected?.name ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-9"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No results.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {o.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
