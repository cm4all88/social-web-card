import { ProfileQrCode } from "./ProfileQrCode";
import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Pause, Play, QrCode } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { usePrefersReducedMotion } from "@/components/skins/SkinLayer";
import type { ThemeTokens } from "@/lib/themes";

export function ProfileAvatars({
  avatar,
  gallery,
  qrUrl,
  name,
  size,
  theme,
  interactive,
}: {
  avatar?: string | null;
  gallery?: string[] | null;
  qrUrl?: string;
  name: string;
  size: number;
  theme: ThemeTokens;
  interactive?: boolean;
}) {
  const photos = [...new Set([avatar, ...(gallery ?? [])].filter((url): url is string => !!url))];
  const portraits = photos.length ? photos : [null];
  const slideCount = portraits.length + (qrUrl ? 1 : 0);
  const multiple = slideCount > 1;
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const clicked = useRef<HTMLButtonElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const [viewport, api] = useEmblaCarousel({ loop: true, active: multiple, watchDrag: multiple });
  const rotating =
    !!interactive &&
    photos.length > 1 &&
    current < portraits.length &&
    playing &&
    !reduced &&
    !hovered &&
    !focused &&
    !openPhoto;

  useEffect(() => {
    if (!api) return;
    const sync = () => setCurrent(api.selectedScrollSnap());
    api.on("select", sync).on("reInit", sync);
    sync();
    return () => {
      api.off("select", sync).off("reInit", sync);
    };
  }, [api]);

  useEffect(() => {
    if (!api || !rotating) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) api.scrollTo((api.selectedScrollSnap() + 1) % photos.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [api, photos.length, rotating]);

  const navigate = (offset: number) => {
    if (!api) return;
    const next = (api.selectedScrollSnap() + offset + slideCount) % slideCount;
    api.scrollTo(next, reduced);
  };
  const frame = {
    width: `min(${size}px, 100%)`,
    background: theme.accent,
    boxShadow: `0 10px 40px -10px ${theme.accent}`,
  };
  const portraitClass =
    "flex h-full w-full items-center justify-center overflow-hidden rounded-full text-3xl font-bold";
  const portraitStyle = { background: theme.card, color: theme.cardForeground };
  if (!photos.length && !qrUrl) {
    return (
      <div className="mb-5 aspect-square rounded-full p-1" style={frame}>
        <div className={portraitClass} style={portraitStyle}>
          {name.slice(0, 1).toUpperCase()}
        </div>
      </div>
    );
  }
  const arrow =
    "grid size-8 shrink-0 place-items-center rounded-full border hover:opacity-100 opacity-70";
  const active = Math.min(current, slideCount - 1);
  const qrActive = active === portraits.length;
  const rounding = qrActive ? "rounded-xl" : "rounded-full";
  const content = (
    <div
      className="mb-5 flex w-full flex-col items-center gap-2"
      role={multiple ? "region" : undefined}
      aria-roledescription={multiple ? "carousel" : undefined}
      aria-label={multiple ? `${name}'s profile photos and QR code` : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (!multiple || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <div className="flex w-full items-center justify-center gap-2">
        {multiple && (
          <button
            type="button"
            className={arrow}
            aria-label="Previous profile slide"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
        )}
        <div data-avatar-frame className={`min-w-0 p-1 ${rounding}`} style={frame}>
          <div
            ref={viewport}
            className={`aspect-square overflow-hidden ${rounding}`}
            style={portraitStyle}
          >
            <div className="flex h-full touch-pan-y">
              {portraits.map((photo, index) => {
                if (!photo) {
                  return (
                    <div
                      key="initial"
                      className={`min-w-0 flex-[0_0_100%] ${portraitClass}`}
                      aria-hidden={index !== active}
                    >
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                  );
                }
                const picture = (
                  <img
                    src={photo}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                );
                return interactive ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      clicked.current = event.currentTarget;
                      setOpenPhoto(photo);
                    }}
                    key={photo}
                    aria-label={
                      photos.length > 1
                        ? `Enlarge photo ${index + 1} of ${name}`
                        : `Enlarge ${name}'s photo`
                    }
                    aria-hidden={index !== active}
                    tabIndex={index === active ? 0 : -1}
                    className="h-full min-w-0 flex-[0_0_100%] cursor-zoom-in"
                  >
                    {picture}
                  </button>
                ) : (
                  <div
                    key={photo}
                    aria-hidden={index !== active}
                    className="h-full min-w-0 flex-[0_0_100%]"
                  >
                    {picture}
                  </div>
                );
              })}
              {qrUrl &&
                (interactive ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label="Enlarge profile QR code"
                    aria-hidden={!qrActive}
                    tabIndex={qrActive ? 0 : -1}
                    className="grid h-full min-w-0 flex-[0_0_100%] cursor-zoom-in place-items-center bg-white"
                    onClick={(event) => {
                      clicked.current = event.currentTarget;
                      setOpenPhoto("qr");
                    }}
                  >
                    <ProfileQrCode url={qrUrl} size={size - 8} />
                  </button>
                ) : (
                  <div
                    className="grid h-full min-w-0 flex-[0_0_100%] place-items-center bg-white"
                    aria-hidden={!qrActive}
                  >
                    <ProfileQrCode url={qrUrl} size={size - 8} />
                  </div>
                ))}
            </div>
          </div>
        </div>
        {multiple && (
          <button
            type="button"
            className={arrow}
            aria-label="Next profile slide"
            onClick={() => navigate(1)}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {multiple && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: slideCount }, (_, index) => (
              <span
                key={index}
                className={`size-1.5 rounded-full bg-current ${index === active ? "opacity-100" : "opacity-30"}`}
              />
            ))}
          </div>
          <span className="sr-only" aria-live={rotating ? "off" : "polite"}>
            {qrActive ? "Profile QR code" : `Photo ${active + 1} of ${portraits.length}`}
          </span>
          {qrActive && interactive && <span className="text-xs">Scan or tap to enlarge</span>}
          {qrUrl && (
            <button
              type="button"
              aria-label="Show profile QR code"
              aria-pressed={qrActive}
              className="grid size-7 place-items-center rounded-full border opacity-70 hover:opacity-100"
              onClick={() => api?.scrollTo(portraits.length, reduced)}
            >
              <QrCode aria-hidden="true" className="size-3.5" />
            </button>
          )}
          {interactive && photos.length > 1 && !reduced && !qrActive && (
            <button
              type="button"
              aria-label={playing ? "Pause profile photos" : "Play profile photos"}
              className="grid size-7 place-items-center rounded-full border opacity-70 hover:opacity-100"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? (
                <Pause aria-hidden="true" className="size-3" />
              ) : (
                <Play aria-hidden="true" className="size-3" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
  return interactive ? (
    <Dialog
      open={!!openPhoto}
      onOpenChange={(open) => {
        if (!open) setOpenPhoto(null);
      }}
    >
      {content}
      <DialogContent
        className="max-w-[min(90vw,36rem)] p-4"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          clicked.current?.focus();
        }}
      >
        {openPhoto === "qr" && qrUrl ? (
          <>
            <DialogTitle className="text-center">Profile QR code</DialogTitle>
            <div className="mx-auto mt-2 w-fit">
              <ProfileQrCode url={qrUrl} size={300} />
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{name}'s profile photo</DialogTitle>
            {openPhoto && (
              <img
                src={openPhoto}
                alt={name}
                className="max-h-[75vh] w-full rounded-lg object-contain"
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  ) : (
    content
  );
}
