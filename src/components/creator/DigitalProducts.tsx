import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  buyDigitalProduct,
  createDigitalProduct,
  listPublicProducts,
  listSellerProducts,
  setProductPublished,
} from "@/lib/digital-products/functions";

const price = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const message = (error: unknown) => (error instanceof Error ? error.message : "Please try again.");

export function ProductEditor({
  items,
  reload,
}: {
  items: Awaited<ReturnType<typeof listSellerProducts>>["items"];
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("asset");
    if (!(file instanceof File) || file.size === 0) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    const format = extension === "pdf" || extension === "zip" ? extension : "video";
    const eligible =
      format === "video"
        ? (extension === "mp4" || extension === "mov") && file.size <= 500 * 1024 * 1024
        : file.size <= 50 * 1024 * 1024;
    if (!eligible) {
      setNotice("Choose a PDF or ZIP up to 50 MB, or an MP4 or MOV up to 500 MB.");
      return;
    }

    setBusy(true);
    setNotice("Preparing upload…");
    try {
      const { upload } = await createDigitalProduct({
        data: {
          title: String(fields.get("title")),
          description: String(fields.get("description")),
          price: Math.round(Number(fields.get("price")) * 100),
          format,
        },
      });
      if (upload.kind === "video") {
        const { Upload } = await import("tus-js-client");
        await new Promise<void>((resolve, reject) =>
          new Upload(file, {
            endpoint: "https://video.bunnycdn.com/tusupload",
            headers: upload.headers,
            metadata: { filetype: file.type || "video/mp4", title: String(fields.get("title")) },
            chunkSize: 8 * 1024 * 1024,
            retryDelays: [0, 1000, 3000, 5000],
            storeFingerprintForResuming: false,
            onProgress: (sent, total) =>
              setNotice(`Uploading… ${Math.floor((sent / total) * 100)}%`),
            onError: reject,
            onSuccess: () => resolve(),
          }).start(),
        );
        setNotice("Video uploaded. Publish when processing is complete.");
      } else {
        setNotice("Uploading file…");
        const { error } = await supabase.storage
          .from("digital-products")
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: format === "pdf" ? "application/pdf" : "application/zip",
          });
        if (error) throw error;
        setNotice("File uploaded. Publish when you're ready.");
      }
      form.reset();
    } catch (error) {
      setNotice(message(error));
    } finally {
      reload();
      setBusy(false);
    }
  }

  async function publish(id: string, published: boolean) {
    setBusy(true);
    setNotice("");
    try {
      await setProductPublished({ data: { id, published } });
      reload();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4" aria-labelledby="products-title">
      <h2 id="products-title" className="text-xl font-bold">
        Digital products
      </h2>
      <form onSubmit={create} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          Title
          <Input name="title" required maxLength={100} />
        </label>
        <label className="grid gap-1 text-sm">
          Description
          <Textarea name="description" maxLength={500} />
        </label>
        <label className="grid gap-1 text-sm">
          Price in USD
          <Input name="price" type="number" min="1" max="1000" step="0.01" required />
        </label>
        <label className="grid gap-1 text-sm">
          PDF, ZIP, MP4 or MOV
          <Input name="asset" type="file" accept=".pdf,.zip,.mp4,.mov" required />
        </label>
        <Button className="justify-self-start" disabled={busy}>
          Upload product
        </Button>
      </form>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <b>{item.title}</b>
              <p className="text-sm">
                {price(item.price_cents)} · {item.published ? "Published" : "Draft"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void publish(item.id, !item.published)}
            >
              {item.published ? "Unpublish" : "Publish"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PublicProducts({
  sellerId,
  username,
  theme,
}: {
  sellerId: string;
  username: string;
  theme: { foreground: string; accent: string };
}) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listPublicProducts>>>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    listPublicProducts({ data: { sellerId } }).then(
      (rows) => {
        if (current) setItems(rows);
      },
      () => {
        if (current) setItems([]);
      },
    );
    void supabase.auth.getSession().then(({ data }) => {
      if (current) setViewer(data.session?.user.id ?? null);
    });
    return () => {
      current = false;
    };
  }, [sellerId]);

  async function checkout(id: string) {
    setBusy(true);
    setNotice("");
    try {
      const { url } = await buyDigitalProduct({ data: { id } });
      window.location.assign(url);
    } catch (error) {
      setNotice(message(error));
      setBusy(false);
    }
  }

  if (!items.length) return null;
  return (
    <section className="mt-6 w-full space-y-3" style={{ color: theme.foreground }}>
      <h2 className="text-lg font-bold">Digital products</h2>
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border p-4 text-left"
          style={{ borderColor: theme.accent }}
        >
          <h3 className="font-semibold">{item.title}</h3>
          <p className="text-sm">{item.kind === "video" ? "Streaming video" : "File download"}</p>
          {item.description && (
            <p className="my-2 whitespace-pre-wrap text-sm">{item.description}</p>
          )}
          {viewer !== sellerId &&
            (viewer ? (
              <Button
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() => void checkout(item.id)}
              >
                Buy for {price(item.price_cents)}
              </Button>
            ) : (
              <Button size="sm" className="mt-2" asChild>
                <Link to="/auth" search={{ next: `/${username}` }}>
                  Sign in to buy · {price(item.price_cents)}
                </Link>
              </Button>
            ))}
        </article>
      ))}
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
