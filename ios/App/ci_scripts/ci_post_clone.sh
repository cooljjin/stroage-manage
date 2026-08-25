#!/bin/sh

set -eux

HOMEBREW_NO_AUTO_UPDATE=1 brew install node
export PATH="$(brew --prefix node)/bin:$PATH"

cd "$CI_WORKSPACE"
node --version
npm --version
npm ci
npm run ios:prepare

cd ios/App
pod install
