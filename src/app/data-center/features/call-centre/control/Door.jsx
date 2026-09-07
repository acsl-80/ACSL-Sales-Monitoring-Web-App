import Link from "@/compat/Link";

/**
 * A link that is a door: a route goes through the router, an in-page anchor
 * goes through a plain `<a>`. The router would fold a hash into the path and
 * drop the queue's search; a plain anchor scrolls. Same rule the old tiles
 * carried, in one place.
 */
export default function Door({ href, children, ...rest }) {
  if (href && href.startsWith("#")) {
    return <a href={href} {...rest}>{children}</a>;
  }
  return <Link href={href} {...rest}>{children}</Link>;
}
