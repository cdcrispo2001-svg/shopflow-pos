import { resolveProductImage, type ImageSubject } from "@/core/catalog/productImages";

interface Props {
  product: ImageSubject;
  size?: number;
}

/** Product picture (photo, catalogue image or initials) in a rounded tile. */
export function ProductImage({ product, size = 44 }: Props) {
  const image = resolveProductImage(product);
  const style = { width: size, height: size };
  if (!image) {
    return <div className="thumb" style={style}>{product.name.slice(0, 2).toUpperCase()}</div>;
  }
  return (
    <div className={`thumb thumb-img ${image.kind === "photo" ? "is-photo" : ""}`} style={style}>
      <img src={image.src} alt={image.label} loading="lazy" draggable={false} />
    </div>
  );
}
