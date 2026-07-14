interface Props {
  bgColor: string;
  bgImage: string;
  gradientEnabled: boolean;
  gradientColor: string;
  gradientAngle: number;
  cardColor: string;
  buttonColor: string;
  logoUrl: string;
}

/**
 * A lightweight mock of the GoHighLevel login screen that mirrors the agency's
 * login-page branding live as it's edited. Purely presentational - reads the same
 * login* fields the editor collects and renders them the same way renderLoginRules
 * (server) delivers them: image > gradient > solid for the background.
 */
export function LoginPreview({
  bgColor,
  bgImage,
  gradientEnabled,
  gradientColor,
  gradientAngle,
  cardColor,
  buttonColor,
  logoUrl,
}: Props) {
  const base = bgColor || "#0f172a";
  const bg = bgImage
    ? `url("${bgImage}") center / cover no-repeat`
    : gradientEnabled && gradientColor
      ? `linear-gradient(${gradientAngle}deg, ${base}, ${gradientColor})`
      : base;
  const card = cardColor || "#ffffff";
  const btn = buttonColor || "#4f46e5";

  return (
    <div className="mp-wrap">
      <div className="mp-caption">Login preview</div>
      <div className="lp-frame" style={{ background: bg }}>
        <div className="lp-card" style={{ background: card }}>
          <div className="lp-logo">
            {logoUrl ? <img src={logoUrl} alt="" /> : <span className="lp-logo-ph">Your Logo</span>}
          </div>
          <div className="lp-field" />
          <div className="lp-field" />
          <button className="lp-btn" style={{ background: btn }}>
            Sign in
          </button>
          <div className="lp-forgot">Forgot password?</div>
        </div>
      </div>
    </div>
  );
}
