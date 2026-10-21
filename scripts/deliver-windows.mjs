#!/usr/bin/env node
// Archive an already-built app. Never builds, replaces a live app, or launches it.
import { runArchiveCli } from './local-release.mjs'
runArchiveCli('app', process.argv.slice(2))
