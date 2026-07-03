// Compatibility shim for `next/image`. Renders a plain <img> (no build-time
// optimization). Accepts the common next/image props and ignores the ones that
// don't map to a native image.
import type { ImgHTMLAttributes } from "react";

type NextImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  alt?: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  unoptimized?: boolean;
  loader?: unknown;
};

export default function Image({
  src,
  alt = "",
  width,
  height,
  fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  unoptimized: _unoptimized,
  loader: _loader,
  style,
  ...rest
}: NextImageProps) {
  const resolvedSrc = typeof src === "string" ? src : src?.src;
  const fillStyle = fill
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const }
    : undefined;
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
