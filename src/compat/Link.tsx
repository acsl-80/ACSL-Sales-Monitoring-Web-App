// Compatibility shim for `next/link`, backed by TanStack Router's Link.
// Exposes a Next-style `href` prop and forwards common anchor props.
import { Link as TanstackLink } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children?: ReactNode;
  // Accepted for API compatibility; ignored by TanStack.
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
};

export default function Link({
  href,
  children,
  prefetch: _prefetch,
  scroll: _scroll,
  passHref: _passHref,
  legacyBehavior: _legacyBehavior,
  replace,
  ...rest
}: NextLinkProps) {
  // External / non-route links fall back to a plain anchor.
  const isExternal = /^(https?:)?\/\//.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
  if (isExternal) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <TanstackLink to={href} replace={replace} {...rest}>
      {children}
    </TanstackLink>
  );
}
