# Landing Page

Simple static landing page for Habitat HQ.

This page is a single self-contained `index.html` (all CSS inline — no external
assets). The CI workflow copies **only** this file to the deployment, so keep it
self-contained.

At deploy time it sits at the root of the GitHub Pages layout alongside each built
app (`./habitat/`, `./hearth/`, ...), which is why the "Launch" cards use relative
links.

## Local development

Iterate on the landing UX with a live-reloading static server:

```bash
pnpm dev:landing   # serves apps/landing at http://localhost:4200, reloads on save
```

Note: the Launch cards will 404 locally — `./habitat/` and `./hearth/` only exist in
the deployed layout. That's expected when working on the landing page itself.

## Testing the real launch flow

To verify the cards actually open the apps, mirror what CI does — build each app with
its base URL and serve them beside the landing page:

```bash
for app in habitat hearth; do
  NUXT_APP_BASE_URL="/$app/" pnpm --filter "$app" build:pwa
done
rm -rf _site && mkdir _site
cp apps/landing/index.html _site/index.html
cp -r apps/habitat/.output/public _site/habitat
cp -r apps/hearth/.output/public  _site/hearth
npx serve _site    # cards launch the apps at http://localhost:3000
```
