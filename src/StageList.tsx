import { memo } from "react";
import { STAGES } from "./config";

/**
 * Static content: memoised so the soundtrack toggle and the festival-mode button, which are the
 * only things in the tree that re-render, never drag eighteen list items through reconciliation.
 */
export const StageList = memo(function StageList({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "stage-list stage-list--compact" : "stage-list"}>
      {STAGES.map((stage, stageIndex) => (
        <section className="stage-column" key={stage.name} aria-label={stage.name}>
          <p className="stage-name"><span>0{stageIndex + 1}</span>{stage.name}</p>
          <ol>
            {stage.artists.map((artist, index) => (
              <li className={index < 2 ? "artist artist--major" : "artist"} key={artist}>{artist}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
});
