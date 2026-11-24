/**
 * "My links" on the creator dashboard: add, reorder (drag, touch, keyboard or
 * the up/down buttons), feature, hide, rename, change icon, group into
 * sections and delete links, with each link's clicks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  acceptsProfileUsername,
  expandProfileUsername,
  normalizeProfileAddress,
} from "@/lib/links/profile-address";
import { linkDisplayHost, safeLinkHref } from "@/lib/safe-url";
import {
  cleanLinkTitle,
  getPlatform,
  ICON_CHOICES,
  LINK_TITLE_MAX,
  linkDisplay,
  PLATFORM_CATEGORIES,
  PLATFORMS,
} from "@/lib/platforms";
import {
  groupLinks,
  moveItem,
  renumber,
  reorderInGroup,
  SECTION_SUGGESTIONS,
  settleAfterRegroup,
  type LinkGroup,
  type LinkSection,
} from "@/lib/links/groups";
import {
  clickLabel,
  saveOrder,
  saveSectionOrder,
  type LinkClicks,
  type ManagedLink,
} from "@/lib/links/api";
import { SortableList } from "./SortableList";

const BAD_URL = "Links must be a plain web address (https://...), mailto:, tel: or sms:";
const NO_SECTION = "__none__";
const DEFAULT_ICON = "__platform__";

function friendly(message: string): string {
  if (/social_links_title|title.*check/i.test(message))
    return `Titles can be up to ${LINK_TITLE_MAX} characters.`;
  if (/up to 20 sections/i.test(message)) return "You can have up to 20 sections.";
  if (/link_sections_title|check constraint/i.test(message))
    return "Section names need 1 to 40 characters.";
  if (/blocked/i.test(message)) return "Links to that site aren't allowed on Yooits.me.";
  return message;
}

export function LinkManager({
  userId,
  links,
  setLinks,
  sections,
  setSections,
  clicks,
  onChanged,
}: {
  userId: string;
  links: ManagedLink[];
  setLinks: (next: ManagedLink[] | ((prev: ManagedLink[]) => ManagedLink[])) => void;
  sections: LinkSection[];
  setSections: (next: LinkSection[] | ((prev: LinkSection[]) => LinkSection[])) => void;
  clicks: LinkClicks;
  onChanged: () => void;
}) {
  const [newPlatform, setNewPlatform] = useState<string>("instagram");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const [addingSection, setAddingSection] = useState(false);

  const groups = useMemo(() => groupLinks(links, sections, { keepEmpty: true }), [links, sections]);
  const sectionTitles = new Set(sections.map((s) => s.title.toLowerCase()));

  const persistOrder = async (
    before: ManagedLink[],
    next: ManagedLink[],
    changed: { id: string; display_order: number }[],
  ) => {
    setLinks(next);
    if (changed.length === 0) return;
    setBusy(true);
    const ok = await saveOrder(changed);
    setBusy(false);
    if (!ok) {
      setLinks(before);
      toast.error("We couldn't save the new order. Please try again.");
    }
  };

  const moveWithin = (groupKey: string, from: number, to: number) => {
    if (busy) return;
    const before = links;
    const { links: next, changed } = reorderInGroup(links, sections, groupKey, from, to);
    void persistOrder(before, next, changed);
  };

  const patchLink = async (id: string, patch: Partial<ManagedLink>, success?: string) => {
    const before = links;
    let next = links.map((l) => (l.id === id ? { ...l, ...patch } : l));
    let changed: { id: string; display_order: number }[] = [];
    const regrouped = "featured" in patch || "section_id" in patch;
    if (regrouped) ({ links: next, changed } = settleAfterRegroup(next, sections, id));
    setLinks(next);
    const { error } = await supabase.from("social_links").update(patch).eq("id", id);
    if (error) {
      setLinks(before);
      toast.error(friendly(error.message));
      return false;
    }
    if (changed.length && !(await saveOrder(changed)))
      toast.error("We couldn't save the new order. Please try again.");
    if (success) toast.success(success);
    onChanged();
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("social_links").delete().eq("id", id);
    if (error) {
      toast.error(friendly(error.message));
      return;
    }
    setLinks((p) => p.filter((l) => l.id !== id));
    setEditing(null);
    toast.success("Link deleted");
    onChanged();
  };

  const acceptsUsername = acceptsProfileUsername(newPlatform);
  const expandedAddress = expandProfileUsername(newPlatform, newUrl);
  const add = async () => {
    if (adding) return;
    if (!newUrl.trim()) {
      toast.error(`Enter your ${getPlatform(newPlatform).label} link first.`);
      return;
    }
    const url = normalizeProfileAddress(newPlatform, newUrl);
    if (!url) {
      toast.error(acceptsUsername ? "Enter a valid username or full link." : BAD_URL);
      return;
    }
    setAdding(true);
    // New links go at the end of the main list.
    const nextOrder = Math.max(0, ...links.map((l) => l.display_order)) + 1;
    const { data, error } = await supabase
      .from("social_links")
      .insert({
        platform: newPlatform,
        url,
        display_order: nextOrder,
        enabled: true,
        user_id: userId,
      })
      .select()
      .single();
    setAdding(false);
    if (error) {
      toast.error(friendly(error.message));
      return;
    }
    if (data) {
      setLinks((p) => [...p, data as ManagedLink]);
      setNewUrl("");
      toast.success(`${getPlatform(newPlatform).label} added`);
      onChanged();
    }
  };

  const addSection = async (raw: string) => {
    const title = raw.trim().slice(0, 40);
    if (!title || addingSection) return;
    if (sectionTitles.has(title.toLowerCase())) {
      toast.error("You already have a section with that name.");
      return;
    }
    setAddingSection(true);
    const order = Math.max(0, ...sections.map((s) => s.display_order)) + 1;
    const { data, error } = await supabase
      .from("link_sections")
      .insert({ user_id: userId, title, display_order: order })
      .select("id, title, display_order")
      .single();
    setAddingSection(false);
    if (error) {
      toast.error(friendly(error.message));
      return;
    }
    setSections((s) => [...s, data as LinkSection]);
    setNewSection("");
    toast.success(`Section "${title}" added. Move links into it from a link's Edit.`);
  };

  const renameSection = async (id: string, raw: string) => {
    const title = raw.trim().slice(0, 40);
    if (!title) return false;
    const { error } = await supabase.from("link_sections").update({ title }).eq("id", id);
    if (error) {
      toast.error(friendly(error.message));
      return false;
    }
    setSections((s) => s.map((x) => (x.id === id ? { ...x, title } : x)));
    return true;
  };

  const deleteSection = async (id: string) => {
    const { error } = await supabase.from("link_sections").delete().eq("id", id);
    if (error) {
      toast.error(friendly(error.message));
      return;
    }
    // The database moves its links out of the section; mirror that here.
    const remaining = sections.filter((s) => s.id !== id);
    const freed = links.map((l) => (l.section_id === id ? { ...l, section_id: null } : l));
    const { items, changed } = renumber(
      groupLinks(freed, remaining, { keepEmpty: true }).flatMap((g) => g.links),
    );
    setSections(remaining);
    setLinks(items);
    if (changed.length) await saveOrder(changed);
    toast.success("Section removed. Its links are still here.");
  };

  const moveSection = async (index: number, dir: -1 | 1) => {
    const ordered = [...sections].sort((a, b) => a.display_order - b.display_order);
    const moved = moveItem(ordered, index, index + dir);
    if (moved === ordered) return;
    const before = sections;
    const { items, changed } = renumber(moved);
    setSections(items);
    // Links follow their sections, so renumber them too.
    const { items: relinked, changed: linkChanges } = renumber(
      groupLinks(links, items, { keepEmpty: true }).flatMap((g) => g.links),
    );
    setLinks(relinked);
    const ok = (await saveSectionOrder(changed)) && (await saveOrder(linkChanges));
    if (!ok) {
      setSections(before);
      toast.error("We couldn't save the new order. Please try again.");
    }
  };

  const orderedSections = [...sections].sort((a, b) => a.display_order - b.display_order);

  return (
    <div>
      {/* Add a link */}
      <div className="rounded-2xl border border-dashed border-border p-4">
        <div className="mb-3 text-sm font-semibold">Add a link</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={newPlatform} onValueChange={setNewPlatform}>
            <SelectTrigger className="sm:w-52" aria-label="Platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_CATEGORIES.map((cat, i) => (
                <div key={cat.label}>
                  {i > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel>{cat.label}</SelectLabel>
                    {cat.keys
                      .filter((k) => PLATFORMS[k])
                      .map((k) => {
                        const Icon = PLATFORMS[k].icon;
                        return (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {PLATFORMS[k].label}
                            </span>
                          </SelectItem>
                        );
                      })}
                  </SelectGroup>
                </div>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={acceptsUsername ? "@username or full URL" : getPlatform(newPlatform).hint}
            aria-label={`New ${getPlatform(newPlatform).label} link`}
            inputMode={acceptsUsername ? "text" : "url"}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <Button onClick={add} disabled={adding || !newUrl.trim()}>
            <Plus className="mr-2 h-4 w-4" /> {adding ? "Adding" : "Add"}
          </Button>
        </div>
        {expandedAddress && <p className="mt-2 break-all text-xs text-muted-foreground">{expandedAddress}</p>}
      </div>

      {links.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No links yet. Add your first one above and it shows on your page straight away.
        </p>
      )}

      {/* Groups */}
      <div className="mt-4 space-y-6">
        {groups.map((g) => {
          const sectionIndex = g.section
            ? orderedSections.findIndex((s) => s.id === g.section!.id)
            : -1;
          if (
            g.kind === "main" &&
            g.links.length === 0 &&
            links.length > 0 &&
            sections.length === 0
          )
            return null;
          return (
            <GroupBlock
              key={g.key}
              group={g}
              sectionIndex={sectionIndex}
              sectionCount={orderedSections.length}
              onRenameSection={renameSection}
              onDeleteSection={deleteSection}
              onMoveSection={moveSection}
            >
              {g.links.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                  {g.kind === "section"
                    ? "No links in this section yet. Open a link's Edit and choose this section."
                    : "Every link is in a section or featured."}
                </p>
              ) : (
                <SortableList
                  items={g.links}
                  getId={(l) => l.id}
                  getLabel={(l) => linkDisplay(l).label}
                  onMove={(from, to) => moveWithin(g.key, from, to)}
                  disabled={busy}
                  className="space-y-3"
                  listLabel={
                    g.section?.title ?? (g.kind === "featured" ? "Featured links" : "Links")
                  }
                  renderItem={(link, index, handle, dragging) => (
                    <LinkRow
                      link={link}
                      index={index}
                      count={g.links.length}
                      handle={handle}
                      dragging={dragging}
                      busy={busy}
                      clicks={clicks}
                      sections={orderedSections}
                      editing={editing === link.id}
                      onEdit={(open) => setEditing(open ? link.id : null)}
                      onMove={(dir) => moveWithin(g.key, index, index + dir)}
                      onPatch={(patch, msg) => patchLink(link.id, patch, msg)}
                      onDelete={() => remove(link.id)}
                    />
                  )}
                />
              )}
            </GroupBlock>
          );
        })}
      </div>

      {links.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Featured links show first on your page. Hidden links and links with no address don't show
          at all.
        </p>
      )}

      {/* Sections */}
      <div className="mt-6 rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FolderPlus className="h-4 w-4" /> Sections
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Group links under a heading on your page, like Social Media, Shop, Videos or Contact.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SECTION_SUGGESTIONS.filter((s) => !sectionTitles.has(s.toLowerCase())).map((s) => (
            <Button
              key={s}
              size="sm"
              variant="secondary"
              onClick={() => addSection(s)}
              disabled={addingSection}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> {s}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={newSection}
            onChange={(e) => setNewSection(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addSection(newSection);
              }
            }}
            placeholder="Your own section name"
            aria-label="New section name"
            maxLength={40}
          />
          <Button
            variant="secondary"
            onClick={() => addSection(newSection)}
            disabled={!newSection.trim() || addingSection}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  sectionIndex,
  sectionCount,
  onRenameSection,
  onDeleteSection,
  onMoveSection,
  children,
}: {
  group: LinkGroup<ManagedLink>;
  sectionIndex: number;
  sectionCount: number;
  onRenameSection: (id: string, title: string) => Promise<boolean>;
  onDeleteSection: (id: string) => void;
  onMoveSection: (index: number, dir: -1 | 1) => void;
  children: React.ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(group.section?.title ?? "");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setTitle(group.section?.title ?? ""), [group.section?.title]);

  const heading =
    group.kind === "featured" ? (
      <span className="flex items-center gap-1.5">
        <Star className="h-4 w-4 fill-current text-amber-500" /> Featured
      </span>
    ) : group.kind === "main" ? (
      "Links"
    ) : (
      group.section!.title
    );

  return (
    <section aria-label={typeof heading === "string" ? heading : "Featured"}>
      <div className="mb-2 flex min-h-9 items-center gap-2">
        {renaming && group.section ? (
          <>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 40))}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (await onRenameSection(group.section!.id, title)) setRenaming(false);
                }
                if (e.key === "Escape") setRenaming(false);
              }}
              aria-label="Section name"
              maxLength={40}
              className="h-9"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Save section name"
              onClick={async () => {
                if (await onRenameSection(group.section!.id, title)) setRenaming(false);
              }}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => setRenaming(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <h3 className="flex-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {heading}
            </h3>
            {group.section && !confirming && (
              <div className="flex items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Move section ${group.section.title} up`}
                  disabled={sectionIndex <= 0}
                  onClick={() => onMoveSection(sectionIndex, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Move section ${group.section.title} down`}
                  disabled={sectionIndex >= sectionCount - 1}
                  onClick={() => onMoveSection(sectionIndex, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Rename section ${group.section.title}`}
                  onClick={() => setRenaming(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Delete section ${group.section.title}`}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
            {group.section && confirming && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Delete section? Links stay.</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setConfirming(false);
                    onDeleteSection(group.section!.id);
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

function LinkRow({
  link,
  index,
  count,
  handle,
  dragging,
  busy,
  clicks,
  sections,
  editing,
  onEdit,
  onMove,
  onPatch,
  onDelete,
}: {
  link: ManagedLink;
  index: number;
  count: number;
  handle: import("./SortableList").HandleProps;
  dragging: boolean;
  busy: boolean;
  clicks: LinkClicks;
  sections: LinkSection[];
  editing: boolean;
  onEdit: (open: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: Partial<ManagedLink>, success?: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const display = linkDisplay(link);
  const Icon = display.icon;
  const href = safeLinkHref(link.url);
  const host = linkDisplayHost(href) ?? (link.url || "No address yet");
  const c = clicks.byLink[link.id];

  return (
    <div
      className={`rounded-2xl border bg-card transition-shadow ${dragging ? "border-primary shadow-xl" : "border-border"} ${
        link.enabled ? "" : "opacity-70"
      }`}
      style={dragging ? undefined : { boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2 p-3 sm:gap-3">
        <button
          type="button"
          {...handle}
          className="-ml-1 flex h-11 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${display.color} text-white`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{display.label}</span>
            {link.featured && (
              <Star
                className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500"
                aria-label="Featured"
              />
            )}
            {!link.enabled && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium uppercase text-muted-foreground">
                Hidden
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {host}
            {clicks.enabled && (
              <span title={`${c?.last_30 ?? 0} in the last 30 days`}> · {clickLabel(c)}</span>
            )}
          </div>
        </div>
        <div className="hidden flex-col sm:flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-7"
            onClick={() => onMove(-1)}
            disabled={index === 0 || busy}
            aria-label={`Move ${display.label} up`}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-7"
            onClick={() => onMove(1)}
            disabled={index === count - 1 || busy}
            aria-label={`Move ${display.label} down`}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-pressed={link.featured}
          aria-label={
            link.featured ? `Stop featuring ${display.label}` : `Feature ${display.label}`
          }
          title={link.featured ? "Featured: shows first" : "Feature this link"}
          onClick={() =>
            onPatch(
              { featured: !link.featured },
              link.featured ? "No longer featured" : "Featured: it shows first on your page",
            )
          }
        >
          <Star
            className={`h-5 w-5 ${link.featured ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-pressed={!link.enabled}
          aria-label={link.enabled ? `Hide ${display.label}` : `Show ${display.label}`}
          title={link.enabled ? "Showing on your page" : "Hidden from your page"}
          onClick={() =>
            onPatch(
              { enabled: !link.enabled },
              link.enabled ? "Hidden from your page" : "Showing on your page",
            )
          }
        >
          {link.enabled ? (
            <Eye className="h-5 w-5" />
          ) : (
            <EyeOff className="h-5 w-5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant={editing ? "secondary" : "ghost"}
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-expanded={editing}
          aria-label={`Edit ${display.label}`}
          onClick={() => onEdit(!editing)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
      {editing && (
        <LinkEditor
          link={link}
          sections={sections}
          canMoveUp={index > 0 && !busy}
          canMoveDown={index < count - 1 && !busy}
          onMove={onMove}
          onCancel={() => onEdit(false)}
          onSave={async (patch) => {
            if (await onPatch(patch, "Saved")) onEdit(false);
          }}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function LinkEditor({
  link,
  sections,
  onSave,
  onCancel,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  link: ManagedLink;
  sections: LinkSection[];
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (patch: Partial<ManagedLink>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const platform = getPlatform(link.platform);
  const [title, setTitle] = useState(link.title ?? "");
  const [url, setUrl] = useState(link.url);
  const [icon, setIcon] = useState(link.icon ?? DEFAULT_ICON);
  const [section, setSection] = useState(link.section_id ?? NO_SECTION);
  const [enabled, setEnabled] = useState(link.enabled);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  const acceptsUsername = acceptsProfileUsername(link.platform);
  const expandedAddress = expandProfileUsername(link.platform, url);
  const save = async () => {
    const clean = url === link.url ? url : normalizeProfileAddress(link.platform, url);
    if (clean === null) {
      toast.error(acceptsUsername ? "Enter a valid username or full link." : BAD_URL);
      return;
    }
    const patch: Partial<ManagedLink> = {};
    const t = cleanLinkTitle(title);
    if (t !== (link.title ?? null)) patch.title = t;
    if (clean !== link.url) patch.url = clean;
    const i = icon === DEFAULT_ICON ? null : icon;
    if (i !== (link.icon ?? null)) patch.icon = i;
    const s = section === NO_SECTION ? null : section;
    if (s !== (link.section_id ?? null)) patch.section_id = s;
    if (enabled !== link.enabled) patch.enabled = enabled;
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    await onSave(patch);
    setSaving(false);
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`title-${link.id}`}>Title</Label>
        <Input
          id={`title-${link.id}`}
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, LINK_TITLE_MAX))}
          onKeyDown={onEnter}
          placeholder={platform.label}
          maxLength={LINK_TITLE_MAX}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`url-${link.id}`}>{acceptsUsername ? "Username or address" : "Address"}</Label>
        <Input
          id={`url-${link.id}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onEnter}
          placeholder={acceptsUsername ? "@username or full URL" : platform.hint}
          inputMode={acceptsUsername ? "text" : "url"}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {expandedAddress && <p className="break-all text-xs text-muted-foreground">{expandedAddress}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>Icon</Label>
        <Select value={icon} onValueChange={setIcon}>
          <SelectTrigger aria-label="Icon">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_ICON}>
              <span className="flex items-center gap-2">
                <platform.icon className="h-4 w-4" /> {platform.label} (default)
              </span>
            </SelectItem>
            <SelectSeparator />
            {ICON_CHOICES.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                <span className="flex items-center gap-2">
                  <c.icon className="h-4 w-4" /> {c.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Section</Label>
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger aria-label="Section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SECTION}>No section</SelectItem>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sections.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add sections below the list to group links.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 sm:hidden">
        <Button variant="secondary" size="sm" onClick={() => onMove(-1)} disabled={!canMoveUp}>
          <ChevronUp className="mr-1 h-4 w-4" /> Move up
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onMove(1)} disabled={!canMoveDown}>
          <ChevronDown className="mr-1 h-4 w-4" /> Move down
        </Button>
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Switch id={`vis-${link.id}`} checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor={`vis-${link.id}`}>Show on my page</Label>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <div className="ml-auto">
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              Delete this link?
              <Button size="sm" variant="destructive" onClick={onDelete}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-2 h-4 w-4 text-destructive" /> Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
