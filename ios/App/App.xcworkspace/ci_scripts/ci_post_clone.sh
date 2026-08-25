#!/bin/sh

set -e

cd "$CI_WORKSPACE"
npm ci
npm run ios:prepare

cd "$CI_WORKSPACE/ios/App"
pod install
