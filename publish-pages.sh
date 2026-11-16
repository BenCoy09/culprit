#!/usr/bin/env bash
# Put the real run's report on the public site (GitHub Pages serves /docs), then push.
# Usage: bash publish-pages.sh   (run after run-demo.sh)
cd "$(dirname "$0")"
[ -f culprit-report/index.html ] || { echo "Run bash run-demo.sh first."; exit 1; }
mkdir -p docs/report
cp culprit-report/index.html culprit-report/result.json docs/report/
cp run-result.txt gate0-result.txt docs/report/ 2>/dev/null
touch docs/.nojekyll
git add -A && git commit -m "docs: publish site and real run report" && git push
echo "Site: https://bencoy09.github.io/culprit/  (enable Pages: Settings > Pages > main > /docs)"
