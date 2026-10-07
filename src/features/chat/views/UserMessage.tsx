import type { ChatImage } from './types';
import './UserMessage.css';

export interface UserMessageProps {
  content: string;
  /** Images sent with the message sit above the bubble, as in ChatGPT. */
  images?: ChatImage[];
  /** Opens an image full size (wiring decides how). */
  onOpenImage?: (image: ChatImage) => void;
}

/** A user turn: right-aligned gray bubble, sent images as thumbnails above it. */
export function UserMessage({ content, images = [], onOpenImage }: UserMessageProps) {
  return (
    <div className="ch-user" data-selectable>
      {images.length > 0 && (
        <div className="ch-user-media">
          {images.map((image) => {
            const alt = image.alt ?? image.name;
            const picture = <img src={image.src} alt={alt} draggable={false} />;
            return onOpenImage ? (
              <button
                key={image.id}
                type="button"
                className="ch-user-image"
                aria-label={`Open image: ${image.name}`}
                onClick={() => onOpenImage(image)}
              >
                {picture}
              </button>
            ) : (
              <figure key={image.id} className="ch-user-image">
                {picture}
              </figure>
            );
          })}
        </div>
      )}
      {content && <div className="ch-bubble">{content}</div>}
    </div>
  );
}
