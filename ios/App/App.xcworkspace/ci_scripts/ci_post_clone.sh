#!/bin/sh

set -e

repository_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
while [ ! -f "$repository_root/package.json" ] && [ "$repository_root" != "/" ]; do
  repository_root="$(dirname "$repository_root")"
done

test -f "$repository_root/package.json"
cd "$repository_root"
npm ci
npm run ios:prepare

cd "$repository_root/ios/App"
pod install
