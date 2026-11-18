#!/usr/bin/env bash
# Stores the Linux screenshots of the browser tests from any machine that has Docker, by
# running the tests in a Linux container (a small Linux system that Docker runs for one
# command). See "Screenshots" under "Browser tests" in the README.
#
# The container is Playwright's own image: the same Ubuntu release as CI's machines, with the
# browsers of the installed Playwright version and the system libraries they need.
#
# Usage, from anywhere in the repository:  pnpm test:browser:update:linux
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
screenshots="$repo/packages/filter-react/browser/__screenshots__/linux"

# Both versions are read from the package files, so they are never stated twice.
playwright="$(node -p "require('$repo/packages/filter-react/package.json').devDependencies.playwright")"
pnpm_version="$(node -p "require('$repo/package.json').packageManager.replace(/^pnpm@/, '').replace(/\+.*$/, '')")"

mkdir -p "$screenshots"

# The repository is mounted read-only and copied inside the container. An install in the
# container fetches Linux builds of the tools, which must not replace this machine's own in
# `node_modules`. Only the screenshots folder can be written to.
#
# `linux/amd64` is the kind of processor CI's machines have. Text is drawn slightly
# differently on another kind, so it is asked for by name even where it runs slower.
docker run --rm --platform linux/amd64 --ipc=host \
  --volume "$repo:/repo:ro" \
  --volume "$screenshots:/screenshots" \
  --env "PNPM_VERSION=$pnpm_version" \
  "mcr.microsoft.com/playwright:v${playwright}-noble" \
  bash -euo pipefail -c '
    mkdir /work
    tar --directory /repo --exclude=node_modules --exclude=.git --exclude=dist \
      --exclude=.vitest --exclude=__screenshots__ --create --file - . |
      tar --directory /work --extract --file -
    cd /work
    # The image has Node but no pnpm. This fetches the pnpm version the repository names,
    # as the program pnpm publishes with each release.
    mkdir /opt/pnpm
    curl --fail --silent --show-error --location \
      "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-x64.tar.gz" |
      tar --directory /opt/pnpm --extract --gzip --file -
    export PATH="/opt/pnpm:$PATH"
    pnpm install --frozen-lockfile
    pnpm test:browser:update
    cp -R packages/filter-react/browser/__screenshots__/linux/. /screenshots/
  '

echo "Stored the Linux screenshots in $screenshots"
