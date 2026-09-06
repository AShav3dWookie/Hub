#!/usr/bin/env bash
# Cut a release: bump every package.json, commit, tag, push.
#
#   npm run release -- patch     0.1.0 -> 0.1.1
#   npm run release -- minor     0.1.0 -> 0.2.0
#   npm run release -- major     0.1.0 -> 1.0.0
#   npm run release -- 1.4.0     explicit
#
# Pushing the tag is what triggers .github/workflows/release.yml, which builds and publishes
# ghcr.io/ashav3dwookie/hub:<version>. Nothing here touches the registry directly.
# See docs/deployment.md.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_URL="https://github.com/AShav3dWookie/Hub"
PKGS=(package.json shared/package.json server/package.json client/package.json)

die() { echo "error: $*" >&2; exit 1; }

BUMP="${1:-}"
[ -n "$BUMP" ] || die "usage: npm run release -- <patch|minor|major|X.Y.Z>"

# --- guards -------------------------------------------------------------------------------
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH'; releases are cut from main"
[ -z "$(git status --porcelain)" ] || die "working tree is dirty; commit or stash first"

git fetch origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || die "main is not in sync with origin/main — pull or push first"

# --- work out the new version ---------------------------------------------------------------
CUR=$(node -p "require('./package.json').version")
IFS=. read -r MA MI PA <<<"$CUR"
case "$BUMP" in
  major) NEW="$((MA + 1)).0.0" ;;
  minor) NEW="$MA.$((MI + 1)).0" ;;
  patch) NEW="$MA.$MI.$((PA + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*) NEW="$BUMP" ;;
  *) die "unrecognised bump '$BUMP' (patch|minor|major|X.Y.Z)" ;;
esac

# `if`, not `&& die`: under `set -e` a failing left-hand side of && would abort silently.
if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  die "tag v$NEW already exists"
fi

echo "==> $CUR -> $NEW"

# --- bump ------------------------------------------------------------------------------------
# An explicit version, never a bump keyword: with a keyword each workspace bumps from its own
# current version, which would amplify any drift between them. This also rewrites the workspace
# entries in package-lock.json, which is not optional — the Docker builder runs `npm ci`, and
# npm ci aborts on a lockfile whose versions disagree with the package.json files.
npm version "$NEW" \
  --workspaces --include-workspace-root \
  --no-git-tag-version --allow-same-version

for pkg in "${PKGS[@]}"; do
  GOT=$(node -p "require('./$pkg').version")
  [ "$GOT" = "$NEW" ] \
    || die "$pkg is $GOT, expected $NEW — nothing committed, run 'git checkout -- .'"
done
grep -q "\"version\": \"$NEW\"" package-lock.json \
  || die "package-lock.json was not updated — nothing committed, run 'git checkout -- .'"

# Cheap proof that `npm ci` will still resolve in the Docker builder.
npm ls --workspaces --depth 0 >/dev/null

# --- commit, tag, push -------------------------------------------------------------------------
git add "${PKGS[@]}" package-lock.json
git commit -m "Release v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push origin main --follow-tags

cat <<EOF

==> pushed v$NEW
    workflow: $REPO_URL/actions/workflows/release.yml
    package:  https://github.com/users/AShav3dWookie/packages/container/package/hub

    once the run is green, on the home server:
      # set IMAGE_TAG=$NEW in .env, then
      docker compose -f docker-compose.prod.yml pull
      docker compose -f docker-compose.prod.yml up -d
      curl -s localhost:8090/api/health   # -> {"status":"ok","version":"$NEW"}
EOF
