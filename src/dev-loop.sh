#!/bin/bash

# file save triggers build and test run. Requires watchexec on the system
watchexec -w src -w test --only-emit-events --emit-events-to=json-stdio | jq
