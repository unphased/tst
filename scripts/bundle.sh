#!/bin/bash
set -xe

# TODO It looks like a sane way to go about this might be to write this in typescript eventually. Esbuild has a JS
# api, etc.
# Some plans for that:
# - I think `npm run X` calls from here should probably be eliminated. I'm thinking it can be a build entry point with
# an arg parser, so it's like a small codebase that implements what to do in clear code/data driven sections for each
# responsibility. Can implement command lists to make it more bash-like.

npm run build

# metaprogramming needs to be done for the plotting client software to neatly assemble them as self-contained artifacts. 
# 1. The vega-lite frontend plotting bundle is built out of plotting/static
# 2. build/ is replicated into build2/ to prepare. A special babel pass is performed here in the plotting subdirectory
#    to transform readFileSync calls into direct string literals with those source files' content.
# 3. The main bundle is built with esbuild off of build2/ (needs 1 and 2 above)

# Generate the vega-lite flexible plotter codebase into a bundle.
esbuild ./build/plotting/static/vega-lite.js --bundle --platform=browser --sourcemap --outfile=./dist/vega-lite-bundle.js --format=esm "--external:./node_modules/*"

# Copy entire build/ dir into build2/
cp -r build/ build2
# clear out the plotting dir because somehow babel doesn't do work if targets are there
rm -rf build2/plotting

# Standard babel transform without code inlining
babel src/plotting/ --config-file ./babel.config.js --out-dir ./build2/plotting --extensions ".ts"

# Warning: Removing code inlining may cause runtime errors and bundling issues
echo "Warning: Code inlining has been removed. Ensure all required files are present at runtime."

# We can run a recursive diff between build/ and build2/ to see the inlining

# Generate main bundle. src/index.ts is the framework entry point.
esbuild ./build2/index.js --bundle --platform=node --sourcemap --format=esm --outfile=./dist/bundle.js --external:express --external:deep-equal

