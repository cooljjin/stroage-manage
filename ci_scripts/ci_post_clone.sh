#!/bin/sh

set -e

npm ci
npm run ios:prepare

cd ios/App
pod install
