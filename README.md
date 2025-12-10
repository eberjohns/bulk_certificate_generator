# Bulk Certificate Generator

A small static web app to generate certificates in bulk from spreadsheet data.

## Deploying

- Recommended: Netlify or Vercel (both support direct GitHub deploys and are free for static sites).
  - Netlify: connect the GitHub repo, set `publish` directory to the repository root (default), and deploy. `netlify.toml` is included.
  - Vercel: connect repo and deploy — it will detect a static site.
  - GitHub Pages: works too; enable Pages in repository settings and choose the `main` branch root.

## SEO & Deployment checklist

- Replace `https://your-site.example/` in `index.html` and `sitemap.xml` with your actual site URL.
- Add a real social image and update the `og:image` and `twitter:image` paths.
- After deploying, submit your sitemap URL to Google Search Console.

## Local testing

Open `index.html` in a browser. For some features (file loading) local file:// works in modern browsers; if you face restrictions, run a simple static server:

PowerShell example:

```powershell
# from project folder
python -m http.server 8000; # or use any static server
```

Then open `http://localhost:8000`.

## Notes

- The page now includes basic SEO meta tags and structured data (JSON-LD). Update placeholders before publishing.
- Accessibility: `canvas` and `status-message` have ARIA attributes for better screen reader behavior.

