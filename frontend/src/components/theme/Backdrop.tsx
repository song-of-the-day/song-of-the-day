import { uploadUrl, type ThemeBackground } from '@/lib/theme';

export interface BackdropProps {
  /** The theme's background settings. */
  background: ThemeBackground;
}

/**
 * The decorative page background: a fixed layer behind everything, in
 * `--sotd-bg`, with either the uploaded image (fill or tile) or the pattern. When an image is
 * set, the pattern is ignored. Styles live in `styles/patterns.css`.
 */
export function Backdrop({ background }: BackdropProps) {
  const { image_upload_id: imageId, image_fit: imageFit, pattern } = background;
  if (imageId !== null) {
    return (
      <div
        aria-hidden="true"
        className="sotd-backdrop"
        data-image-fit={imageFit}
        style={{ backgroundImage: `url("${uploadUrl(imageId)}")` }}
      />
    );
  }
  return <div aria-hidden="true" className="sotd-backdrop" data-pattern={pattern} />;
}
