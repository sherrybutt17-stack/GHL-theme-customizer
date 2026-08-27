import {
  resolveLoginBackground,
  resolveLoginCard,
  resolveLoginButton,
  unbrandedLoginParts,
} from "./themeDefaults";

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
 * A lightweight mock of the GoHighLevel login screen that mirrors the agency's login-page
 * branding live as it's edited.
 *
 * The resolution is `themeDefaults.ts`'s, not its own — this component used to answer
 * `bgColor || "#0f172a"` and `cardColor || "#ffffff"`, so an agency who had set nothing saw
 * a dark-slate login screen with a white box and an indigo button, and got GoHighLevel's
 * own page live. It also required only a gradient COLOUR where the server requires a base
 * colour too, so a gradient could render here and be absent from the stylesheet entirely.
 *
 * An unset part is drawn as a neutral placeholder and NAMED underneath, because the one
 * thing a preview must never do is invent branding the agency has not chosen.
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
  const look = { bgColor, bgImage, gradientEnabled, gradientColor, gradientAngle, cardColor, buttonColor };
  const bg = resolveLoginBackground(look);
  const card = resolveLoginCard(cardColor);
  const btn = resolveLoginButton(buttonColor);
  const unbranded = unbrandedLoginParts({ ...look, logoUrl });

  return (
    <div className="mp-wrap">
      <div className="mp-caption">Login preview</div>
      <div className={`lp-frame${bg ? "" : " lp-unset"}`} style={bg ? { background: bg } : undefined}>
        <div className={`lp-card${card ? "" : " lp-unset"}`} style={card ? { background: card } : undefined}>
          <div className="lp-logo">
            {logoUrl ? <img src={logoUrl} alt="" /> : <span className="lp-logo-ph">Your Logo</span>}
          </div>
          <div className="lp-field" />
          <div className="lp-field" />
          <button className={`lp-btn${btn ? "" : " lp-unset"}`} style={btn ? { background: btn } : undefined}>
            Sign in
          </button>
          <div className="lp-forgot">Forgot password?</div>
        </div>
      </div>
      {unbranded.length > 0 && (
        <div className="lp-note">
          Not branded yet: {unbranded.join(", ")}. Those stay as GoHighLevel ships them — the
          hatched areas above are not a colour you chose.
        </div>
      )}
    </div>
  );
}
