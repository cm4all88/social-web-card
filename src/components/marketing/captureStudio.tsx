import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import { StudioGraphic } from "./StudioGraphic";
import { STUDIO_CANVASES, type StudioGraphicSpec } from "@/lib/marketing/studio";

async function withStage<T>(
  spec: StudioGraphicSpec,
  index: number,
  headline: string | undefined,
  cta: string | undefined,
  render: (stage: HTMLElement) => Promise<T>,
): Promise<T> {
  const mount = document.createElement("div");
  mount.setAttribute("aria-hidden", "true");
  mount.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none";
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    flushSync(() =>
      root.render(
        <StudioGraphic
          profile={spec.profiles[index]}
          canvas={spec.canvas}
          presentation={spec.presentation}
          headline={headline}
          cta={cta}
        />,
      ),
    );
    await document.fonts.ready;
    await Promise.all(Array.from(mount.querySelectorAll("img"), (image) => image.decode()));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return await render(mount.firstElementChild as HTMLElement);
  } finally {
    root.unmount();
    mount.remove();
  }
}

function rasterOptions(spec: StudioGraphicSpec) {
  const { width, height } = STUDIO_CANVASES[spec.canvas];
  return { width: width / 2, height: height / 2, pixelRatio: 2, preferredFontFormat: "woff2" };
}

export async function captureStudio(
  spec: StudioGraphicSpec,
  index: number,
  headline?: string,
  cta?: string,
): Promise<Blob> {
  return withStage(spec, index, headline, cta, async (stage) => {
    const canvas = await toCanvas(stage, rasterOptions(spec));
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not render the graphic."));
      }, "image/png"),
    );
  });
}

function recordFrames(
  canvas: HTMLCanvasElement,
  paint: () => void,
  mimeType: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      reject(error);
      return;
    }
    const chunks: Blob[] = [];
    let tick = 0;
    let deadline: number | undefined;
    const cleanUp = () => {
      cancelAnimationFrame(tick);
      window.clearTimeout(deadline);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      cleanUp();
      reject(new Error("The browser could not encode the MP4."));
    };
    recorder.onstop = () => {
      cleanUp();
      if (chunks.length) resolve(new Blob(chunks, { type: "video/mp4" }));
      else reject(new Error("The MP4 recording was empty."));
    };
    try {
      paint();
      recorder.start();
      const frame = () => {
        paint();
        tick = requestAnimationFrame(frame);
      };
      tick = requestAnimationFrame(frame);
      deadline = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 4500);
    } catch (error) {
      cleanUp();
      reject(error);
    }
  });
}

export async function captureStudioVideo(
  spec: StudioGraphicSpec,
  index: number,
  headline?: string,
  cta?: string,
) {
  const types = ["video/mp4;codecs=avc1.420034", "video/mp4"];
  const mime = types.find(
    (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
  );
  if (!mime)
    throw new Error(
      "MP4 export requires a browser with an MP4 encoder. Try current Chrome or Edge.",
    );
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    throw new Error("Turn off reduced motion temporarily to record an animated skin.");
  }
  return withStage(spec, index, headline, cta, async (stage) => {
    const back = stage.querySelector<HTMLCanvasElement>("canvas[data-skin]");
    const front = stage.querySelector<HTMLCanvasElement>("canvas[data-skin-front]");
    const surface = stage.matches("[data-profile-surface]")
      ? stage
      : stage.querySelector<HTMLElement>("[data-profile-surface]");
    if (!back || !front || !surface) throw new Error("Choose an animated skin to export an MP4.");

    // Snapshot the static DOM in two passes. Composite the live SkinLayer
    // canvases in their original positions and stacking order for each frame.
    const options = rasterOptions(spec);
    const fontEmbedCSS = await getFontEmbedCSS(stage, options);
    const contents = [...stage.querySelectorAll<HTMLElement>("main, [data-studio-copy]")].map(
      (node) => ({ node, visibility: node.style.visibility }),
    );
    let lower: HTMLCanvasElement;
    try {
      contents.forEach(({ node }) => {
        node.style.visibility = "hidden";
      });
      lower = await toCanvas(stage, {
        ...options,
        fontEmbedCSS,
        filter: (node) => node.nodeName !== "CANVAS",
      });
    } finally {
      contents.forEach(({ node, visibility }) => {
        node.style.visibility = visibility;
      });
    }
    const previousOuter = stage.style.background;
    const previousSurface = surface.style.background;
    stage.style.background = "transparent";
    surface.style.background = "transparent";
    let upper: HTMLCanvasElement;
    try {
      upper = await toCanvas(stage, {
        ...options,
        fontEmbedCSS,
        filter: (node) =>
          node.nodeName !== "CANVAS" &&
          !(
            node instanceof HTMLElement &&
            (node.hasAttribute("data-background") ||
              node.hasAttribute("data-background-scrim") ||
              node.hasAttribute("data-skin-overlay"))
          ),
      });
    } finally {
      stage.style.background = previousOuter;
      surface.style.background = previousSurface;
    }

    const canvas = document.createElement("canvas");
    canvas.width = lower.width;
    canvas.height = lower.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas is unavailable.");
    const box = stage.getBoundingClientRect();
    const layers = [back, front].map((layer) => {
      const rect = layer.getBoundingClientRect();
      return {
        layer,
        x: (rect.left - box.left) * 2,
        y: (rect.top - box.top) * 2,
        w: rect.width * 2,
        h: rect.height * 2,
      };
    });
    const drawLayer = ({ layer, x, y, w, h }: (typeof layers)[number]) => {
      ctx.drawImage(layer, x, y, w, h);
    };
    return recordFrames(
      canvas,
      () => {
        ctx.drawImage(lower, 0, 0);
        drawLayer(layers[0]);
        ctx.drawImage(upper, 0, 0);
        drawLayer(layers[1]);
      },
      mime,
    );
  });
}
