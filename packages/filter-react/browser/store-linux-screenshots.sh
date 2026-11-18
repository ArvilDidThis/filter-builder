#!/usr/bin/env bash
# Stores the Linux screenshots of the browser tests from any machine that has Docker, by
# running the tests in a Linux container (a small Linux system that Docker runs for one
# command). See "Screenshots" under "Browser tests" in the README.
#
# The container is Playwright's own image, with the browsers of the installed Playwright
# version and the system libraries they need. CI runs its browser tests in the same image
# (see `.github/workflows/browser-tests.yml`), so pictures stored here match there. "noble"
# in its name is Ubuntu 24.04. Change both places together.
#
# Usage, from anywhere in the repository:  pnpm test:browser:update:linux
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
screenshots="$repo/packages/filter-react/browser/__screenshots__/linux"

# Both versions are read from the package files, so they are never stated twice.
playwright="$(node -p "require('$repo/packages/filter-react/package.json').devDependencies.playwright")"
pnpm_version="$(node -p "require('$repo/package.json').packageManager.replace(/^pnpm@/, '').replace(/\+.*$/, '')")"

# The SHA-256 (a fingerprint of a file's exact content) of pnpm's Linux download for the pnpm
# version named beside it. A download that does not match is never unpacked. When the
# repository moves to another pnpm version, set both lines from that release's page.
checked_pnpm_version="12.6.0"
checked_pnpm_sha256="3f4c66f668d0e84219679982d095b30da68325e1fac9284e7f5dc1584bd3d13e"

if [ "$pnpm_version" != "$checked_pnpm_version" ]; then
  echo "package.json names pnpm $pnpm_version, but this script holds the fingerprint of" >&2
  echo "pnpm $checked_pnpm_version. Update checked_pnpm_version and checked_pnpm_sha256 in $0." >&2
  exit 1
fi

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
  --env "PNPM_SHA256=$checked_pnpm_sha256" \
  "mcr.microsoft.com/playwright:v${playwright}-noble" \
  bash -euo pipefail -c '
    mkdir /work
    tar --directory /repo --exclude=node_modules --exclude=.git --exclude=dist \
      --exclude=.vitest --exclude=__screenshots__ --create --file - . |
      tar --directory /work --extract --file -
    cd /work
    # The image has Node but no pnpm. This fetches the pnpm version the repository names,
    # as the program pnpm publishes with each release. The download is saved first and
    # compared with the expected fingerprint, so a changed file stops here and never runs.
    mkdir /opt/pnpm
    curl --fail --silent --show-error --location --output /tmp/pnpm.tar.gz \
      "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-x64.tar.gz"
    echo "${PNPM_SHA256}  /tmp/pnpm.tar.gz" | sha256sum --check --quiet
    tar --directory /opt/pnpm --extract --gzip --file /tmp/pnpm.tar.gz
    export PATH="/opt/pnpm:$PATH"
    pnpm install --frozen-lockfile
    pnpm test:browser:update
    cp -R packages/filter-react/browser/__screenshots__/linux/. /screenshots/
  '

echo "Stored the Linux screenshots in $screenshots"
