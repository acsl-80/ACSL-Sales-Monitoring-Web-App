import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * A dropdown you can type into.
 *
 * WHY THIS EXISTS
 *
 * Nothing in this app let you narrow a list by typing. A native `<select>`
 * answers a keystroke by jumping to the first option starting with that letter
 * and then forgetting it, so picking one of 422 partners meant scrolling four
 * hundred rows while knowing the name the whole time. The app has 41 native
 * selects and 92 shadcn ones, and none of them searched.
 *
 * Built on `Popover` + `Command`, which were already in this repo (`cmdk` is
 * installed) and are the canonical shadcn combobox. A hand-rolled second
 * implementation is what this replaces, not what it adds.
 *
 * THE THRESHOLD, WHICH IS THE WHOLE DESIGN
 *
 * Search does NOT appear on every list. A search field over "Yes / No" - which
 * is a real dropdown on the Data Centre settings page - is strictly worse than
 * two options and a click: it adds a step, moves focus, and asks somebody to
 * type where they were about to point.
 *
 * So the component decides, from how many options it holds, rather than each
 * caller deciding and remembering. Above `searchAfter` (8 by default) the input
 * appears; below it the list is just a list. One rule, applied everywhere,
 * which is the only way a standard stays a standard across a hundred call
 * sites.
 *
 * WHAT IT IS NOT
 *
 * Not a fetch-as-you-type control. Options arrive already loaded, which is
 * right at the sizes here: 422 organizations is one small request the screens
 * already make, and matching in the browser is instant where a round trip per
 * keystroke is not. A list that outgrows that wants a server search and a
 * different component.
 */

export type SearchableOption = {
  value: string;
  label: string;
  /** Shown dimmed beside the label. For disambiguating like-named rows. */
  hint?: string | null;
  disabled?: boolean;
};

export type SearchableSelectProps = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  /** Accessible name. Use when there is no visible <label> pointing at `id`. */
  ariaLabel?: string;
  className?: string;
  /** Rendered above the options and never filtered away. */
  pinned?: SearchableOption | null;
  /** Show the search field once there are more than this many options. */
  searchAfter?: number;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Choose one",
  searchPlaceholder = "Type to narrow the list",
  emptyLabel = "Nothing matches that",
  disabled = false,
  id,
  ariaLabel,
  className,
  pinned = null,
  searchAfter = 8,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);

  const all = React.useMemo(
    () => (pinned ? [pinned, ...options] : options),
    [pinned, options],
  );
  const chosen = React.useMemo(
    () => all.find((o) => o.value === value) ?? null,
    [all, value],
  );
  const searchable = options.length > searchAfter;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !chosen && "text-muted-foreground")}>
            {chosen?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        // Tailwind v4 reads a bare custom property with parentheses; the
        // bracket form is v3 and silently produces no width here.
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        {/*
          `shouldFilter` follows the same threshold. With no input rendered,
          cmdk's filtering has nothing to filter by and would hide everything
          the moment a stray keystroke reached it.
        */}
        <Command shouldFilter={searchable}>
          {searchable && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {all.map((o) => (
                <CommandItem
                  key={o.value}
                  /*
                    cmdk matches on `value`, and these are ids as often as
                    names - a partner's uuid is not what anybody types. The
                    label plus the hint is.
                  */
                  value={`${o.label} ${o.hint ?? ""}`.trim()}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      o.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-1.5 truncate text-xs text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default SearchableSelect;
