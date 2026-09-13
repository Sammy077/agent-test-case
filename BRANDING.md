# Wing slide background — developer handoff

This update uses the original green-to-blue background from the user's uploaded `POS_Final_Presentation.pptx`. The image is copied unchanged from `ppt/media/image1.png` into `public/brand-background.png`; all 13 source slides reference that asset. The application uses it at full opacity on the login, administration, testing, QA and four TV pages. The earlier decorative diagonal bands have been removed.

The source background is 1920 × 1080 pixels, with SHA-256 `b6fba1675aa7a58874d09c1a67be7406e5373d08e0898efc2c997d618497ae4a`. It is the uploaded slide artwork, not a recreated gradient. The source deck's business content is not included in this application package.

Cards, forms and countdown labels retain opaque surfaces for text readability. The background scales to fill the viewport while preserving its aspect ratio. The local Wing logo and other interface colour tokens retain their separately documented public-reference provenance.

## Change the theme

Edit `public/brand.css`; no JavaScript build or package installation is needed.

| Token | Default | Purpose |
| --- | --- | --- |
| `--wing-green` | `#ABD037` | Header rule, progress bars, background accent |
| `--wing-blue` | `#0077FF` | Background accent |
| `--wing-ink` | `#0B1E2B` | Heading ink and the basis of the dark TV theme |
| `--wing-white` | `#FFFFFF` | Logo/header surface |
| `--brand-font` | Segoe UI, Arial, sans-serif | Locally available fonts only |
| `--brand-background-image` | `url('/brand-background.png')` | Original uploaded slide background |
| `--brand-background-opacity` | `1` | Full visibility of the original artwork |

Green and blue above are the fill colours extracted from the public logo SVG. The ink, panel, button and status shades are design choices, not claimed official brand specifications. Website assets can differ from an internal guideline. Brand blue is darkened for small white-text buttons to improve contrast. Status colours use separate tokens; do not make all statuses green.

The `body.tv` section provides dark-surface tokens. `public/style.css` holds layout and components. Headers keep the logo in full colour on white, with its aspect ratio preserved; do not stretch it, recolour it through CSS filters, or place it over the QR code.

## Background configuration

The uploaded slide background is already included and enabled. Its shared configuration in `public/brand.css` is:

```css
--brand-background-image: url('/brand-background.png');
--brand-background-opacity: 1;
```

To substitute a later supplied template, replace `public/brand-background.png` with that original artwork. Keep the data panels above it. Refresh the browser after replacing assets and rebuild the container image if using Docker.

The server also explicitly allows `brand-background.jpg`, `brand-background.webp`, and `brand-background.svg`. Use the matching filename in the CSS if a later template uses another format. SVGs should contain only inert geometry: no scripts, embedded HTML, remote references or inline CSS. Nothing requests these optional alternatives unless configured.

## Replace the logo

Replace `public/wing-logo.svg` with the brand team's approved SVG. Keep the filename. Update the `width`/`height` attributes in the `logo` constant in `public/app.js` and `.brand-logo` dimensions in the stylesheet if its aspect ratio differs. The shipped SVG has its original geometry and colours; embedded CSS was mechanically converted into SVG fill attributes to remain compatible with the existing Content Security Policy.

This asset remains Wing Bank's property. Inclusion is for the requested Wing-branded internal prototype; it is not a grant of brand rights or bank endorsement.

## Coverage and screen sizing

| Screen | URL | Intended desktop layout |
| --- | --- | --- |
| Management | `/tv/management` | Eight metrics; 30 participants; result summary and countdown |
| Technical & QA | `/tv/technical` | Defect list, owner and workflow status |
| Agents | `/tv/agents` | 20 participants, five columns by four rows |
| Branches | `/tv/branches` | 10 participants, five columns by two rows; same tile component |
| Individual testing | `/my-tests` | Priority queue and current assignment status |
| Administration | `/admin` | Participant creation, CSV import and QR links |
| QA / technical editing | `/qa` | Defect updates |
| Sign-in | `/login` | Branded account sign-in |

TV typography scales with viewport width up to 4K. Full-grid targets assume a 16:9 browser viewport of 1920×1080 or larger, fullscreen, 100% zoom. Small/short viewports switch to a scrolling responsive layout, rather than shrinking labels indefinitely. Physical inches alone do not define the browser viewport. Test on the actual 55-inch and 85-inch TVs and mobile browsers before approval. Oversized rosters or long names may need scrolling; automatic TV rotation/pagination is not implemented.

QR output remains dark-on-white with the original quiet zone and signing logic. Styling did not change QR destinations or implement missing observer assignment authorization.

## Asset references

- Background: user-uploaded `POS_Final_Presentation.pptx`, `ppt/media/image1.png`; copied unchanged on 7 September 2026.
- The following public references concern the bundled logo and interface colour tokens:

- Wing Bank public homepage: https://www.wingbank.com.kh/en
- Logo linked from that page: https://www.wingbank.com.kh/images/wb-logo.svg
- Reference fetched on 5 September 2026. The page's browser theme colour was `#A9CF38`, while its logo fills were `#ABD037` and `#0077FF`; this package follows the logo fills.

There are no links to these external resources in the running UI, no analytics, no external font downloads, and no external QR service. This does not by itself make the application's existing backend production-secure; read `PRODUCTION-GAPS.md`.
