import { ArrowDown, ArrowUp, EyeOff, Gift, Link2, Newspaper, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROFILE_BLOCKS, PROFILE_BLOCK_LABELS, type ProfileBlock } from "@/lib/profile-blocks";

const icons = { links: Link2, wishlists: Gift, posts: Newspaper, products: Package };

export function PageSections({
  blocks,
  busy,
  postsAvailable,
  productsAvailable = false,
  onChange,
  onEdit,
}: {
  blocks: ProfileBlock[];
  busy: boolean;
  postsAvailable: boolean;
  productsAvailable?: boolean;
  onChange: (next: ProfileBlock[], added?: ProfileBlock) => void;
  onEdit: (block: ProfileBlock) => void;
}) {
  const available = PROFILE_BLOCKS.filter(
    (key) => !blocks.includes(key) && (key !== "products" || productsAvailable),
  );
  const move = (index: number, by: number) => {
    const next = [...blocks];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  return (
    <section
      aria-labelledby="page-sections-title"
      className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="page-sections-title" className="text-lg font-bold">
          Your page sections
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={busy}>
              <Plus className="mr-1.5 size-4" /> Add Something
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {available.length === 0 && (
              <DropdownMenuItem disabled>All sections are on your page</DropdownMenuItem>
            )}
            {available.map((key) => {
              const Icon = icons[key];
              return (
                <DropdownMenuItem
                  key={key}
                  disabled={key === "posts" && !postsAvailable}
                  onSelect={() => onChange([...blocks, key], key)}
                >
                  <Icon className="mr-2 size-4" /> {PROFILE_BLOCK_LABELS[key]}
                  {key === "posts" && !postsAvailable && (
                    <span className="ml-2 text-xs">Requires creator approval</span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Choose what you want to show on your page.</p>
      ) : (
        <ol aria-label="Public section order" className="space-y-1.5">
          {blocks.map((key, index) => {
            const Icon = icons[key];
            const label = PROFILE_BLOCK_LABELS[key];
            return (
              <li
                key={key}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1"
              >
                <Icon aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 pl-1.5 text-sm font-medium">{label}</span>
                {(key !== "posts" || postsAvailable) &&
                  (key !== "products" || productsAvailable) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${label}`}
                      onClick={() => onEdit(key)}
                    >
                      Edit
                    </Button>
                  )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={busy || index === 0}
                  aria-label={`Move ${label} up`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={busy || index === blocks.length - 1}
                  aria-label={`Move ${label} down`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={busy}
                  aria-label={`Hide ${label}`}
                  onClick={() => onChange(blocks.filter((block) => block !== key))}
                >
                  <EyeOff className="size-4" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
