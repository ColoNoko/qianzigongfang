#!/usr/bin/env node
import { runArchiveCli } from './local-release.mjs'
runArchiveCli('source', process.argv.slice(2))
