import { useEffect, useState } from "react";
import { MEDIA_QUERIES, type FilmTier } from "./config";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/**
 * Data Saver and 2G are treated the same way a small screen is: ship the lighter master. Read once
 * per evaluation rather than cached at module scope, so a tier switch mid-session sees current
 * conditions.
 */
const constrainedConnection = () => {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? ""));
};

const wantsMobileAssets = () => (
  window.matchMedia(MEDIA_QUERIES.mobileAssets).matches || constrainedConnection()
);

/**
 * Which master to load and whether to animate at all. Both are resolved during the first render —
 * getting this wrong on mount would download one master and then immediately replace it.
 */
export function useViewportProfile() {
  const [tier, setTier] = useState<FilmTier>(() => (wantsMobileAssets() ? "mobile" : "desktop"));
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia(MEDIA_QUERIES.reducedMotion).matches,
  );

  useEffect(() => {
    const assets = window.matchMedia(MEDIA_QUERIES.mobileAssets);
    const motion = window.matchMedia(MEDIA_QUERIES.reducedMotion);
    const connection = (navigator as Navigator & {
      connection?: NetworkInformation & EventTarget;
    }).connection;

    const chooseTier = () => setTier(wantsMobileAssets() ? "mobile" : "desktop");
    const chooseMotion = () => setReducedMotion(motion.matches);

    chooseTier();
    chooseMotion();
    assets.addEventListener("change", chooseTier);
    motion.addEventListener("change", chooseMotion);
    connection?.addEventListener?.("change", chooseTier);

    return () => {
      assets.removeEventListener("change", chooseTier);
      motion.removeEventListener("change", chooseMotion);
      connection?.removeEventListener?.("change", chooseTier);
    };
  }, []);

  return { tier, reducedMotion };
}
