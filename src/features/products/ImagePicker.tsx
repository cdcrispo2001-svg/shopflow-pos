import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { IMAGE_GROUPS, type ImageGroupId } from "@/core/catalog/productImageCatalog";
import {
  IMAGE_NONE, imageSrc, searchCatalog, suggestImages, type CatalogImage,
} from "@/core/catalog/productImages";
import { fileToProductPhoto } from "@/core/utils/imageFile";
import { useToast } from "@/core/components/Toast";
import { IconSearch, IconClose, IconCamera } from "@/core/components/icons";

interface Props {
  name: string;
  category?: string;
  selectedKey?: string;
  onPick: (imageKey: string) => void;
  onPhoto: (dataUrl: string) => void;
  onClose: () => void;
}

function Tile({ image, selected, onPick }: { image: CatalogImage; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`image-tile ${selected ? "selected" : ""}`} onClick={onPick} title={image.label}>
      <img src={imageSrc(image)} alt="" loading="lazy" draggable={false} />
      <span>{image.label}</span>
    </button>
  );
}

/** Catalogue picture browser with search, groups, suggestions and a photo option. */
export function ImagePicker({ name, category, selectedKey, onPick, onPhoto, onClose }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ImageGroupId | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => (name.trim() ? suggestImages(name, category) : []), [name, category]);
  const results = useMemo(() => searchCatalog(query, group), [query, group]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onPhoto(await fileToProductPhoto(file));
    } catch (error) {
      toast(error instanceof Error ? error.message : "That picture could not be used.", "error");
    }
  }

  return (
    <div>
      <div className="row gap-8">
        <button type="button" className="btn btn-primary grow" onClick={() => fileRef.current?.click()}>
          <IconCamera /> Take or upload photo
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onPick(IMAGE_NONE)}>No picture</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {suggestions.length > 0 && !query && !group && (
        <>
          <div className="section-title">Suggested for “{name.trim()}”</div>
          <div className="image-grid">
            {suggestions.map((image) => (
              <Tile key={image.key} image={image} selected={image.key === selectedKey} onPick={() => onPick(image.key)} />
            ))}
          </div>
        </>
      )}

      <div className="search-bar mt-16">
        <IconSearch />
        <input className="input" placeholder="Search pictures (e.g. sugar, soda, phone)"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="chip-row">
        <button type="button" className={`btn btn-sm ${!group ? "btn-primary" : "btn-ghost"}`} onClick={() => setGroup(undefined)}>All</button>
        {IMAGE_GROUPS.map((g) => (
          <button type="button" key={g.id} className={`btn btn-sm ${group === g.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setGroup(group === g.id ? undefined : g.id)}>{g.label}</button>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="empty"><p>No pictures match “{query}”. Try another word or take a photo.</p></div>
      ) : (
        <div className="image-grid">
          {results.map((image) => (
            <Tile key={image.key} image={image} selected={image.key === selectedKey} onPick={() => onPick(image.key)} />
          ))}
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-block mt-16" onClick={onClose}>
        <IconClose /> Back to product
      </button>
    </div>
  );
}
