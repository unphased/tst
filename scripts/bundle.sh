#!/bin/bash
set -e

# TODO It looks like a sane way to go about this might be to write this in typescript eventually. Esbuild has a JS
# api, etc.
# Some plans for that:
# - I think `npm run X` calls from here should probably be eliminated. I'm thinking it can be a build entry point with
# an arg parser, so it's like a small codebase that implements what to do in clear code/data driven sections for each
# responsibility. Can implement command lists to make it more bash-like.

npm run build

# Generate main bundle. src/index.ts is the framework entry point.
esbuild ./build/index.js --bundle --platform=node --sourcemap --format=esm --outfile=./dist/bundle.js --external:express --external:deep-equal

# Generate the vega-lite flexible plotter codebase into a bundle.
esbuild ./build/plotting/static/vega-lite.js --bundle --platform=browser --sourcemap --outfile=./dist/vega-lite-bundle.js --format=esm "--external:./node_modules/*"

# Surgery must be performed on main bundle to close the loop for plot html artifacts when leveraged out of the release
# software bundle. In all plot types, the html embedding loads some handler code to bring life to the plot data injected
# earlier into the html artifact. When this code is run out of source, the source will specify the correct relative
# paths to fetch these script payloads for insertion into the html artifacts. When bundling they will land on the wrong
# spot and we do surgery here to close this gap. It's mild metaprogramming, as we will be replacing string interpolation
# fs.readFileSync calls with their content inserted into those string literals.

# This replacement job is sufficiently complex that I'll do it with a js script in here.

sed -e '/readFileSync.*['"'"'"](payload|dist)['"'"'"]/r ' dist/bundle.js > dist/bundle.done.js

