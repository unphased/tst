#!/bin/bash

# Gave up on putting the dev looping logic into npm scripts. it's too boneheaded and undocumented.
echo START WATCH args: "$@"
while sleep 0.1; do
    node -r source-map-support/register "$@" # the main loop behavior is to run an app. assuming it doesn't get broken it will auto watch for code and auto rebuild itself and then exit.
    CODE=$?
    if [ $CODE -eq 115 ]; then
        echo "dev-loop.sh: exit code 115 indicating quit, breaking loop"
        break
    fi
    if [ $CODE -ne 0 ]; then
        # if main app does not exit cleanly, it failed somehow, so we now launch watch-only in order to block until code changes.
        echo "dev-loop.sh: exit code $CODE indicating runtime failure"
        # Now we need to loop until the build succeeds before returning to the main loop
        node build/watch-only.js
        WOCODE=$?
        if [ $WOCODE -eq 0 ]; then
            echo "dev-loop.sh: watch-only indicating successful build"
        else
            echo watch-only fails, so we are waiting and attempting a manual rebuild and break to run the main command
            sleep 7
            npm run build-backend
        fi
    fi
done
