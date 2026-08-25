#!/bin/sh

set -e

brew install node

cd "$CI_WORKSPACE"
npm ci
npm run ios:prepare

cd ios/App
pod install
