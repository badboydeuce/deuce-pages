export function rootLandingPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="DEUCE Pages application and API service endpoint.">
    <title>DEUCE Pages | Application Service</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #07110d;
        color: #e8fff2;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 32px 20px;
        background: radial-gradient(circle at top left, rgba(124, 255, 178, 0.12), transparent 38%), #07110d;
      }
      main {
        width: min(760px, 100%);
        padding: clamp(28px, 6vw, 56px);
        border: 1px solid rgba(124, 255, 178, 0.24);
        border-radius: 24px;
        background: rgba(10, 25, 18, 0.92);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
      }
      .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 32px; }
      .mark {
        display: grid;
        width: 46px;
        height: 46px;
        place-items: center;
        border-radius: 13px;
        background: #7cffb2;
        color: #07110d;
        font-weight: 900;
      }
      .brand strong { display: block; font-size: 1.05rem; }
      .brand span:last-child { color: #9bb9a8; font-size: 0.85rem; }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 11px;
        border: 1px solid rgba(124, 255, 178, 0.24);
        border-radius: 999px;
        color: #aaf8c9;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .status::before {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #7cffb2;
        content: "";
        box-shadow: 0 0 14px rgba(124, 255, 178, 0.9);
      }
      h1 { margin: 22px 0 14px; font-size: clamp(2.2rem, 7vw, 4rem); line-height: 1.02; letter-spacing: -0.055em; }
      .intro { margin: 0; color: #b8cfc2; font-size: clamp(1rem, 2.5vw, 1.16rem); line-height: 1.7; }
      .notice {
        margin: 28px 0;
        padding: 18px 20px;
        border-left: 3px solid #7cffb2;
        border-radius: 4px 14px 14px 4px;
        background: rgba(124, 255, 178, 0.07);
        color: #d9f7e5;
        line-height: 1.55;
      }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; }
      a {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        padding: 0 18px;
        border: 1px solid rgba(124, 255, 178, 0.28);
        border-radius: 11px;
        color: #dfffea;
        font-weight: 750;
        text-decoration: none;
      }
      a:first-child { background: #7cffb2; color: #07110d; }
      a:hover, a:focus-visible { border-color: #7cffb2; outline: none; }
      footer { margin-top: 30px; color: #789586; font-size: 0.82rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <span class="mark" aria-hidden="true">D2</span>
        <span><strong>DEUCE Pages</strong><span>Application and API service</span></span>
      </div>
      <span class="status">Service available</span>
      <h1>DEUCE Pages service endpoint</h1>
      <p class="intro">
        This domain operates the DEUCE Pages application and API. It is the platform service address,
        not a customer website and not a representation of any third-party organization.
      </p>
      <p class="notice">
        Package previews and published sites use controlled preview routes or verified live domains.
        Administrative and package-management features require an authenticated DEUCE account.
      </p>
      <div class="actions">
        <a href="/app#login">Open DEUCE workspace</a>
        <a href="/api/health">View API health</a>
      </div>
      <footer>
        No customer page, imported journey, credential form, or package content is served from this root address.
      </footer>
    </main>
  </body>
</html>`;
}
