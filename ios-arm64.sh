#!/usr/bin/env bash
set -e

NODEJS_MOBILE_GYP_BIN_FILE=node_modules/nodejs-mobile-gyp/bin/node-gyp.js
NODEJS_HEADERS_DIR="$( cd node_modules/nodejs-mobile-react-native/ios/libnode/ && pwd )"

mkdir -p prebuilds/ios-arm64

GYP_DEFINES='OS=ios' \
CARGO_BUILD_TARGET='aarch64-apple-ios' \
npm_config_nodedir="$NODEJS_HEADERS_DIR" \
npm_config_platform='ios' \
npm_config_format='make-ios' \
npm_config_arch='arm64' \
node $NODEJS_MOBILE_GYP_BIN_FILE \
  --target_platform=ios \
  --target_arch=arm64 \
  --napi \
  --strip

mv build/Release/*.node prebuilds/ios-arm64/