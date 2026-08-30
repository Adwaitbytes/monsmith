/**
 * The official Monsmith emblem, served from /public/monsmith-logo.svg (twin
 * violet wings forming an M, a glowing four-point star, and the dot sequence).
 * Rendered as an <img> so the 155KB vector loads and caches once rather than
 * inlining into every instance. The background square was stripped from the
 * source file, so it sits transparent on both themes.
 */
export function MonsmithMark({
  size = 28,
  className,
  title = "Monsmith",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/monsmith-logo.svg"
      width={size}
      height={size}
      alt={title}
      draggable={false}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
