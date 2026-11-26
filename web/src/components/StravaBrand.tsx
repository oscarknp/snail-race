// Official Strava brand assets (web/public/strava, unmodified per Strava's brand guidelines).
// Logos switch between Strava's own orange and white versions for day and night; the
// files themselves are never recoloured, resized out of proportion or animated.

/** The official "Connect with Strava" button. It starts the OAuth flow to strava.com/oauth/authorize. */
export function StravaConnectButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  return (
    <span className="strava-connect-wrap">
      <button type="button" className="strava-connect" onClick={onClick} aria-busy={busy} disabled={busy}>
        <img src="/strava/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width={237} height={48} />
      </button>
      {busy && <span className="faint" role="status">Opening Strava…</span>}
    </span>
  );
}

function ThemedLogo({ name, alt, height }: { name: "pwrdBy" | "cptblWith"; alt: string; height: number }) {
  const width = Math.round(height * (name === "pwrdBy" ? 365 : 437) / 37);
  return (
    <>
      <img className="theme-light-only" src={`/strava/api_logo_${name}_strava_horiz_orange.svg`} alt={alt} height={height} width={width} />
      <img className="theme-dark-only" src={`/strava/api_logo_${name}_strava_horiz_white.svg`} alt={alt} height={height} width={width} />
    </>
  );
}

/** Credit shown wherever data that came from Strava is displayed. */
export function PoweredByStrava({ align = "end" }: { align?: "start" | "end" }) {
  return (
    <div className={`strava-credit ${align}`}>
      <ThemedLogo name="pwrdBy" alt="Powered by Strava" height={16} />
    </div>
  );
}

/** Interoperability mark for general places (the site footer). */
export function CompatibleWithStrava() {
  return <ThemedLogo name="cptblWith" alt="Compatible with Strava" height={14} />;
}
