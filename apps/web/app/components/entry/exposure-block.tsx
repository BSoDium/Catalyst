import { Icon } from "~/components/ui";
import { splitFigure, type Exposure } from "~/lib/exposure";

/**
 * How a photograph was taken (#385), under the title: a thin aperture mark (the icon set's, quiet like the units) as tall as the text beside it (from the top of the camera's capitals to the baseline of the
 * settings: `.entry-exposure` in app.css), the camera and the lens in the ink, and the settings with their figures in the ink and their prefixes and units quiet.
 */
export function ExposureBlock({ exposure }: { exposure: Exposure }) {
  return (
    <div data-slot="entry-exposure" className="entry-exposure type-meta">
      <Icon name="aperture" className="entry-exposure-mark" />
      <div className="entry-exposure-text">
        {exposure.gear.length > 0 && (
          <span data-slot="entry-gear" className="entry-exposure-line entry-exposure-gear">
            {exposure.gear.join(" \u00b7 ")}
          </span>
        )}
        {exposure.settings.length > 0 && (
          <span data-slot="entry-settings" className="entry-exposure-line">
            {exposure.settings.map((setting, i) => {
              const { before, figure, after } = splitFigure(setting);
              return (
                <span key={i} className="entry-exposure-setting">
                  {i > 0 && <span className="entry-exposure-sep">{" \u00b7 "}</span>}
                  {before}
                  <span className="entry-exposure-figure">{figure}</span>
                  {after}
                </span>
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}
